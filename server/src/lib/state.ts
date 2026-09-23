// The step in progress: .belay/state.json, gitignored. The server writes it at
// the start and end of a step, the hooks write what they see during one, and
// both read it fresh every time.

import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { belayDir, statePath } from "./paths.js";

export type Mode = "you" | "review" | "quiet";

export interface Witness {
  kind: string;
  cmd: string;
  pass: boolean;
  at: string;
}

export interface Pending {
  witness: Witness;
  commit: string | null;
  files: string[];
}

export interface Question {
  text: string;
  expected: string;
  askedAt: string;
}

export interface Step {
  id: string;
  skill: string;
  mode: Mode;
  goal: string;
  startedAt: string;
  baseline: string | null;
  // True when this step reopens the skill that just closed, to have a flaw
  // fixed. A follow-up asks its question and writes nothing to the logbook.
  followUp: boolean;
  hints: number;
  // Changed files and their hashes when the step began. Only what differs
  // from this counts as the step's work.
  snapshot: Record<string, string>;
  toolEdits: string[];
  witnesses: Witness[];
  pending: Pending | null;
  question: Question | null;
}

export interface Last {
  skill: string;
  mode: Mode;
  result: string;
  state?: string;
  runs?: number;
  threshold?: number;
  reason?: string;
  at: string;
  // Set once the prompt hook has shown this result. The result stays, because
  // a follow-up on the same skill reads it after the person's next message.
  shown?: boolean;
}

export interface State {
  version: number;
  step: Step | null;
  last: Last | null;
}

const EMPTY: State = { version: 1, step: null, last: null };

export function read(root: string): State {
  const path = statePath(root);
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
    return {
      version: typeof raw.version === "number" ? raw.version : 1,
      step: raw.step !== null && typeof raw.step === "object" ? normalizeStep(raw.step) : null,
      last: raw.last !== null && typeof raw.last === "object" ? (raw.last as Last) : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function normalizeStep(raw: unknown): Step | null {
  const s = raw as Partial<Step>;
  if (typeof s.skill !== "string" || typeof s.mode !== "string") return null;
  return {
    id: typeof s.id === "string" ? s.id : newId(),
    skill: s.skill,
    mode: s.mode as Mode,
    goal: typeof s.goal === "string" ? s.goal : "",
    startedAt: typeof s.startedAt === "string" ? s.startedAt : "",
    baseline: typeof s.baseline === "string" ? s.baseline : null,
    followUp: s.followUp === true,
    hints: typeof s.hints === "number" ? s.hints : 0,
    snapshot: s.snapshot !== null && typeof s.snapshot === "object" ? (s.snapshot as Record<string, string>) : {},
    toolEdits: Array.isArray(s.toolEdits) ? s.toolEdits.filter((p) => typeof p === "string") : [],
    witnesses: Array.isArray(s.witnesses) ? (s.witnesses as Witness[]) : [],
    pending: s.pending !== null && typeof s.pending === "object" ? (s.pending as Pending) : null,
    question: s.question !== null && typeof s.question === "object" ? (s.question as Question) : null,
  };
}

// Written whole to a temporary file and renamed into place, so a hook killed
// mid-write leaves the previous state rather than half of the next one.
export function write(root: string, state: State): void {
  mkdirSync(belayDir(root), { recursive: true });
  const path = statePath(root);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

// Claude Code runs the hooks for parallel tool calls at the same time, and
// each one reads the state, changes it, and writes it back. Without a lock the
// last writer wins and the other hook's witness is lost. The lock lives in the
// system temp directory, so a stale one never shows up in the repo.
const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10000;

function lockPath(root: string): string {
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
  return join(tmpdir(), `belay-${hash}.lock`);
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(path: string): boolean {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(path, "wx"));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
    }
    try {
      if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
        unlinkSync(path);
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() > deadline) return false;
    pause(5 + Math.floor(Math.random() * 10));
  }
}

// Read the state, let fn change it, and write it back, as one step under the
// lock. A lock that cannot be had within two seconds is gone around rather
// than waited on, because a hook must never hold up the person's work. The
// file is written only when fn changed something, and never in a folder with
// no .belay directory.
export function update<T>(root: string, fn: (state: State) => T): T {
  const hasBelay = existsSync(belayDir(root));
  const path = lockPath(root);
  const held = hasBelay && acquire(path);
  try {
    const state = read(root);
    const before = JSON.stringify(state);
    const result = fn(state);
    if (hasBelay && JSON.stringify(state) !== before) write(root, state);
    return result;
  } finally {
    if (held) {
      try {
        unlinkSync(path);
      } catch {
        // Already gone, which is what releasing it means.
      }
    }
  }
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// A sortable, opaque step id: the time in Crockford base32, then randomness.
export function newId(): string {
  let time = Date.now();
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out = CROCKFORD[time % 32] + out;
    time = Math.floor(time / 32);
  }
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i += 1) out += CROCKFORD[bytes[i] % 32];
  return out;
}
