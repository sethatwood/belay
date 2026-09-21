// Shared fixtures. Every test gets its own temporary git repo and its own
// temporary home directory, pointed at through BELAY_HOME, so nothing here
// ever reads or writes a real ~/.belay.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { normalize, type SkillMap } from "../src/lib/map.js";

export interface Fixture {
  base: string;
  root: string;
  home: string;
  handle: string;
  cleanup: () => void;
}

export const TEST_MAP = {
  version: 1,
  threshold: 3,
  mastery: 5,
  skills: [
    {
      id: "write-a-test",
      name: "Write a test",
      teaches: "Name the behavior, arrange the case, assert one thing.",
      witness: ["test"],
      requires: [],
      precedents: [],
    },
    {
      id: "add-route",
      name: "Add a route",
      teaches: "Register the path, parse the input, return the right status.",
      witness: ["test"],
      requires: ["write-a-test"],
      precedents: ["src/routes/health.ts"],
    },
    {
      id: "verify-webhook-signature",
      name: "Verify a webhook signature",
      teaches:
        "Reject any request whose signature does not match, using the raw body and a constant-time compare.",
      witness: ["test"],
      requires: ["write-a-test"],
      precedents: ["src/billing/charge.ts", "src/lib/hmac.ts"],
    },
    {
      id: "write-a-migration",
      name: "Write a migration",
      teaches: "Change the schema forward and back, in one reversible step.",
      witness: ["test", "types"],
      requires: [],
      precedents: [],
    },
  ],
  zones: [{ paths: ["src/payments/**"], cosign: true }],
};

export function testMap(): SkillMap {
  return normalize(TEST_MAP);
}

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Test Person",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test Person",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

export function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function writeFile(root: string, rel: string, body: string): string {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
  return path;
}

// A git repo with a first commit, a skill map, and whatever logbook lines the
// test wants. BELAY_HOME is set before anything reads it.
export function makeRepo(options: { logbook?: unknown[]; map?: unknown; handle?: string } = {}): Fixture {
  const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "belay-")));
  const root = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  process.env.BELAY_HOME = home;

  runGit(root, ["init", "-q", "-b", "main"]);
  runGit(root, ["config", "user.name", "Test Person"]);
  runGit(root, ["config", "user.email", "test@example.com"]);
  runGit(root, ["config", "commit.gpgsign", "false"]);

  writeFile(root, ".gitignore", ".belay/state.json\nnode_modules/\n");
  writeFile(root, "src/billing/charge.ts", "export const charge = () => true;\n");
  writeFile(root, ".belay/map.json", `${JSON.stringify(options.map ?? TEST_MAP, null, 2)}\n`);

  const handle = options.handle ?? "test-person";
  writeFile(home, ".belay/config.json", `${JSON.stringify({ handle }, null, 2)}\n`);

  if (options.logbook !== undefined) {
    const lines = options.logbook.map((e) => (typeof e === "string" ? e : JSON.stringify(e)));
    writeFile(root, `.belay/logbook/${handle}.jsonl`, `${lines.join("\n")}\n`);
  }

  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-q", "-m", "first"]);

  return {
    base,
    root,
    home,
    handle,
    cleanup: () => {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

// A plain directory with no git repo, no map, and no settings, which is what
// belay_init is handed the first time a repo meets Belay.
export function makeBare(): { root: string; cleanup: () => void } {
  const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "belay-bare-")));
  const root = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  process.env.BELAY_HOME = home;
  return {
    root,
    cleanup: () => {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export function unaidedEntry(
  skill: string,
  options: { t?: string; kind?: string; pass?: boolean; question?: string | null; hints?: number } = {},
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    t: options.t ?? "2026-10-04T14:12:09Z",
    kind: "unaided",
    skill,
    hints: options.hints ?? 0,
    witness: { kind: options.kind ?? "test", cmd: "npx vitest run", pass: options.pass ?? true },
    commit: "a1b2c3d",
    files: ["src/routes/webhooks.ts"],
  };
  const question = options.question === undefined ? "Line 14 is a plain string compare. What should it be?" : options.question;
  if (question !== null) entry.question = question;
  return entry;
}

export const VITEST_PASS = {
  stdout: " Test Files  2 passed (2)\n      Tests  12 passed (12)\n   Duration  412ms\n",
  stderr: "",
  interrupted: false,
  isImage: false,
};

export const VITEST_FAIL = {
  stdout: " Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 11 passed (12)\n",
  stderr: "",
  interrupted: false,
  isImage: false,
};

export function rec(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
