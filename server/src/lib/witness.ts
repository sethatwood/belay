// Command recognition for the witness hook. A witness is a test run, a type
// check, or a build. Everything else the person runs is not a witness and the
// hook stays quiet about it.
//
// A witness is found by the command word of each command in the line, after
// wrappers and runners like npx and uv run, so echo vitest or cat
// vitest.config.ts is never mistaken for a test run.

import type { WitnessKind } from "./map.js";
import { commandOf, segments } from "./writes.js";

export interface Recognized {
  kind: WitnessKind;
  // The short name of the runner, which is what the hook's one line reports.
  label: string;
  // True when a pipe, ;, or || after this command means the line's exit
  // code is not this command's.
  masked: boolean;
}

const DIRECT: Record<string, WitnessKind> = {
  vitest: "test",
  jest: "test",
  pytest: "test",
  "py.test": "test",
  tsc: "types",
  mypy: "types",
  pyright: "types",
  esbuild: "build",
};

const TYPECHECK_SCRIPTS = new Set(["typecheck", "type-check", "types", "check-types", "tsc"]);

// A package script named for what it runs: test and test:unit are tests,
// build and build:prod are builds, typecheck is a type check.
function script(name: string): WitnessKind | null {
  if (name === "test" || name.startsWith("test:")) return "test";
  if (name === "build" || name.startsWith("build:")) return "build";
  if (TYPECHECK_SCRIPTS.has(name)) return "types";
  return null;
}

const SCRIPT_LABEL: Record<WitnessKind, string> = { test: "test", build: "build", types: "typecheck" };

function words(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("-"));
}

function recognizeOne(tokens: string[]): Omit<Recognized, "masked"> | null {
  const found = commandOf(tokens);
  if (found === null) return null;
  const { cmd, args } = found;
  const rest = words(args);

  const direct = DIRECT[cmd];
  if (direct !== undefined) return { kind: direct, label: cmd === "py.test" ? "pytest" : cmd };

  if (cmd === "node" && args.includes("--test")) return { kind: "test", label: "node --test" };
  if (cmd === "vite" && rest[0] === "build") return { kind: "build", label: "vite build" };
  if (cmd === "next" && rest[0] === "build") return { kind: "build", label: "next build" };

  if (cmd === "python" || cmd === "python3") {
    const at = args.indexOf("-m");
    const module = at >= 0 ? args[at + 1] : undefined;
    if (module === "pytest") return { kind: "test", label: `${cmd} -m pytest` };
    if (module === "unittest") return { kind: "test", label: `${cmd} -m unittest` };
    if (module === "mypy") return { kind: "types", label: "mypy" };
    return null;
  }

  if (cmd === "npm" || cmd === "pnpm" || cmd === "yarn" || cmd === "bun") {
    const sub = rest[0] ?? "";
    // npm test, npm t, pnpm test, yarn test, and bun test run the test script
    // or runner directly.
    if (sub === "test" || (cmd === "npm" && (sub === "t" || sub === "tst"))) {
      return { kind: "test", label: `${cmd} test` };
    }
    const named = sub === "run" || sub === "run-script" ? rest[1] ?? "" : cmd === "npm" || cmd === "bun" ? "" : sub;
    const kind = script(named);
    if (kind === null) return null;
    if (kind === "test") return { kind, label: `${cmd} test` };
    const label = cmd === "pnpm" || cmd === "yarn" ? `${cmd} ${SCRIPT_LABEL[kind]}` : `${cmd} run ${SCRIPT_LABEL[kind]}`;
    return { kind, label };
  }

  return null;
}

// Every witness in the line, in the order the shell runs them. A command's
// exit code decides its pass only when nothing after it hides that code: the
// last command in the line, or one followed by &&, which stops the line when
// it fails.
export function recognizeAll(command: string): Recognized[] {
  const parts = segments(command);
  const out: Recognized[] = [];
  parts.forEach((segment, index) => {
    const hit = recognizeOne(segment.tokens);
    if (hit === null) return;
    const last = index === parts.length - 1;
    out.push({ ...hit, masked: !last && segment.next !== "&&" });
  });
  return out;
}

export function recognize(command: string): Recognized | null {
  return recognizeAll(command)[0] ?? null;
}

const CODE_KEYS = ["exitCode", "exit_code", "returnCode", "return_code", "code", "status"];

// The exit code from the tool response, when it carries one at all.
export function exitCodeOf(response: unknown): number | null {
  if (response === null || typeof response !== "object") return null;
  const obj = response as Record<string, unknown>;
  for (const key of CODE_KEYS) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function textOf(response: unknown): string {
  if (typeof response === "string") return response;
  if (response === null || typeof response !== "object") return "";
  const obj = response as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["stdout", "stderr", "output", "content", "text"]) {
    const value = obj[key];
    if (typeof value === "string") parts.push(value);
  }
  return parts.join("\n");
}

// What the runner's own output says: true for a pass, false for a fail, and
// null when it says neither, which is what a clean tsc prints.
export function summary(text: string): boolean | null {
  // Claude Code's failure text starts with the exit code.
  const exit = /^Exit code (\d+)/m.exec(text);
  if (exit !== null) return Number(exit[1]) === 0;

  const nodeTest = /^#\s*fail\s+(\d+)/m.exec(text);
  if (nodeTest !== null) return Number(nodeTest[1]) === 0;

  // pytest collected nothing. A run that tested nothing proves nothing.
  if (/\bno tests ran\b/i.test(text)) return false;
  // unittest's verdict line, which pytest also prints once per failing test.
  if (/^FAILED\b/m.test(text)) return false;

  if (/\berror TS\d+/.test(text)) return false;
  // esbuild and npm both say so when they stop on an error.
  if (/\[ERROR\]|\bnpm ERR!/.test(text)) return false;
  // mypy counts what it found, and says so in words when it found nothing.
  const found = /\bFound\s+(\d+)\s+errors?\b/.exec(text);
  if (found !== null) return Number(found[1]) === 0;
  if (/\bSuccess: no issues found\b/i.test(text)) return true;

  const failed = /(\d+)\s+failed/i.exec(text);
  if (failed !== null && Number(failed[1]) > 0) return false;

  const passedCount = /(\d+)\s+passed/i.exec(text);
  if (passedCount !== null && Number(passedCount[1]) > 0) return true;

  if (failed !== null) return true;

  // pyright counts its errors on one line, and prints a zero when there are none.
  const errors = /(\d+)\s+errors?\b/i.exec(text);
  if (errors !== null) return Number(errors[1]) === 0;

  // unittest's passing verdict, on its own line after the run.
  if (/^OK\b/m.test(text)) return true;

  if (/\bbuilt in\b|\bbuild (?:completed|succeeded)\b|\bcompiled successfully\b/i.test(text)) {
    return true;
  }
  return null;
}

// The summary, with anything unrecognized counted as a fail.
export function parseSummary(text: string): boolean {
  return summary(text) ?? false;
}

// Whether a witness passed, from a PostToolUse response. Claude Code sends
// PostToolUse only when the command exited 0, so when nothing hides the
// witness's own exit code, output that says nothing either way is a pass. A
// masked witness has only its output to go on, and silence there is a fail.
export function passed(response: unknown, masked = true): boolean {
  if (response !== null && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (obj.interrupted === true) return false;
    if (obj.is_error === true || obj.isError === true) return false;
  }
  const code = exitCodeOf(response);
  if (code !== null) return code === 0;
  return summary(textOf(response)) ?? !masked;
}
