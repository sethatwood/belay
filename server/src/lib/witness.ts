// Command recognition for the witness hook. A witness is a test run, a type
// check, or a build. Everything else the person runs is not a witness and the
// hook stays quiet about it.

import type { WitnessKind } from "./map.js";

export interface Recognized {
  kind: WitnessKind;
  // The short name of the runner, which is what the hook's one line reports.
  label: string;
}

// First match wins, so the more specific patterns come first within a kind.
const TABLE: { kind: WitnessKind; label: string; re: RegExp }[] = [
  { kind: "test", label: "vitest", re: /\bvitest\b/ },
  { kind: "test", label: "jest", re: /\bjest\b/ },
  { kind: "test", label: "node --test", re: /\bnode\s+--test\b/ },
  { kind: "test", label: "npm test", re: /\bnpm\s+(?:run\s+)?test\b/ },
  { kind: "test", label: "pnpm test", re: /\bpnpm\s+(?:run\s+)?test\b/ },
  { kind: "test", label: "bun test", re: /\bbun\s+test\b/ },
  { kind: "test", label: "uv run pytest", re: /\buv\s+run\s+pytest\b/ },
  { kind: "test", label: "python3 -m pytest", re: /\bpython3\s+-m\s+pytest\b/ },
  { kind: "test", label: "python -m pytest", re: /\bpython\s+-m\s+pytest\b/ },
  { kind: "test", label: "python3 -m unittest", re: /\bpython3\s+-m\s+unittest\b/ },
  { kind: "test", label: "python -m unittest", re: /\bpython\s+-m\s+unittest\b/ },
  { kind: "test", label: "pytest", re: /\bpytest\b/ },
  { kind: "build", label: "npm run build", re: /\bnpm\s+run\s+build\b/ },
  { kind: "build", label: "pnpm build", re: /\bpnpm\s+(?:run\s+)?build\b/ },
  { kind: "build", label: "bun run build", re: /\bbun\s+run\s+build\b/ },
  { kind: "build", label: "vite build", re: /\bvite\s+build\b/ },
  { kind: "build", label: "next build", re: /\bnext\s+build\b/ },
  { kind: "build", label: "esbuild", re: /\besbuild\b/ },
  { kind: "types", label: "tsc", re: /\btsc\b/ },
  { kind: "types", label: "mypy", re: /\bmypy\b/ },
  { kind: "types", label: "pyright", re: /\bpyright\b/ },
];

export function recognize(command: string): Recognized | null {
  for (const row of TABLE) {
    if (row.re.test(command)) return { kind: row.kind, label: row.label };
  }
  return null;
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

// Parsed from the runner's summary line, for the common case where the tool
// response carries no exit code. Anything unrecognized counts as a fail.
export function parseSummary(text: string): boolean {
  const nodeTest = /^#\s*fail\s+(\d+)/m.exec(text);
  if (nodeTest !== null) return Number(nodeTest[1]) === 0;

  // pytest collected nothing. A run that tested nothing proves nothing.
  if (/\bno tests ran\b/i.test(text)) return false;
  // unittest's verdict line, which pytest also prints once per failing test.
  if (/^FAILED\b/m.test(text)) return false;

  if (/\berror TS\d+/.test(text)) return false;
  // mypy counts what it found, and says so in words when it found nothing.
  const found = /\bFound\s+(\d+)\s+errors?\b/.exec(text);
  if (found !== null) return Number(found[1]) === 0;
  if (/\bSuccess: no issues found\b/i.test(text)) return true;

  const failed = /(\d+)\s+failed/i.exec(text);
  if (failed !== null && Number(failed[1]) > 0) return false;

  const passed = /(\d+)\s+passed/i.exec(text);
  if (passed !== null && Number(passed[1]) > 0) return true;

  if (failed !== null) return true;

  // pyright counts its errors on one line, and prints a zero when there are none.
  const errors = /(\d+)\s+errors?\b/i.exec(text);
  if (errors !== null) return Number(errors[1]) === 0;

  // unittest's passing verdict, on its own line after the run.
  if (/^OK\b/m.test(text)) return true;

  if (/\bbuilt in\b|\bbuild (?:completed|succeeded)\b|\bcompiled successfully\b/i.test(text)) {
    return true;
  }
  return false;
}

export function passed(response: unknown): boolean {
  if (response !== null && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (obj.interrupted === true) return false;
    if (obj.is_error === true || obj.isError === true) return false;
  }
  const code = exitCodeOf(response);
  if (code !== null) return code === 0;
  return parseSummary(textOf(response));
}
