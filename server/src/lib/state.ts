// The step in progress: .belay/state.json, gitignored. The server writes it at
// the start and end of a step, the hooks write what they see during one, and
// both read it fresh every time.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function write(root: string, state: State): void {
  mkdirSync(belayDir(root), { recursive: true });
  writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
