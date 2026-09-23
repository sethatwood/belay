// The logbook: .belay/logbook/<handle>.jsonl, committed and append-only. One
// JSON object per line, never edited and never reordered. This module appends,
// reads, and derives a skill's state by replaying the lines in order.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { findSkill, type SkillMap } from "./map.js";
import { logbookDir, logbookPath, nowIso } from "./paths.js";

export interface Entry {
  t: string;
  kind: string;
  skill?: string;
  [key: string]: unknown;
}

export interface ReadResult {
  entries: Entry[];
  malformed: number;
}

export type SkillState = "unearned" | "earned" | "mastered";

export type DerivedKind = "earned" | "demoted" | "mastered";

export interface Derived {
  state: SkillState;
  runs: number;
  streak: number;
  // The last earned, demoted, or mastered entry seen for this skill, which is
  // what says whether the derived entry for the current state is still owed.
  lastDerived: DerivedKind | null;
  needsEarned: boolean;
  needsDemoted: boolean;
  needsMastered: boolean;
}

export function read(root: string, handle: string): ReadResult {
  const path = logbookPath(root, handle);
  if (!existsSync(path)) return { entries: [], malformed: 0 };
  const entries: Entry[] = [];
  let malformed = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      malformed += 1;
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.kind !== "string") {
      malformed += 1;
      continue;
    }
    entries.push({ ...obj, t: typeof obj.t === "string" ? obj.t : "", kind: obj.kind } as Entry);
  }
  return { entries, malformed };
}

export function append(root: string, handle: string, entry: Omit<Entry, "t"> & { t?: string }): Entry {
  const { t, ...rest } = entry;
  const full = { t: t ?? nowIso(), ...rest } as Entry;
  mkdirSync(logbookDir(root), { recursive: true });
  appendFileSync(logbookPath(root, handle), `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

// The logbook holds a digest of the question an unaided run answered, not its
// text, because the question names what the person got wrong. The text stays
// in the private journal beside the same digest, so the person can show
// anyone which question a run answered. Entries written before 0.2.0 hold
// the text itself, and both count the same.
export function questionDigest(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function countsAsRun(entry: Entry, accepted: string[]): boolean {
  const witness = entry.witness;
  if (witness === null || typeof witness !== "object") return false;
  const w = witness as Record<string, unknown>;
  if (w.pass !== true) return false;
  if (typeof w.kind !== "string" || !accepted.includes(w.kind)) return false;
  return typeof entry.question === "string" && entry.question.length > 0;
}

// The state rule, replayed in file order. Primitive kinds drive it; derived
// kinds only say whether the matching derived entry has been written yet.
export function derive(entries: Entry[], skillId: string, map: SkillMap): Derived {
  const skill = findSkill(map, skillId);
  const accepted: string[] = skill !== null ? skill.witness : ["test"];
  const threshold = map.threshold;
  const mastery = map.mastery;

  let state: SkillState = "unearned";
  let runs = 0;
  let streak = 0;
  let lastDerived: DerivedKind | null = null;

  for (const entry of entries) {
    if (entry.skill !== skillId) continue;
    switch (entry.kind) {
      case "unaided": {
        if (!countsAsRun(entry, accepted)) break;
        runs += 1;
        if (runs >= threshold && state === "unearned") state = "earned";
        break;
      }
      case "calibrated": {
        if (entry.state === "earned") {
          state = "earned";
          runs = threshold;
        }
        break;
      }
      case "review": {
        if (state === "earned") {
          if (entry.correct === true) {
            streak += 1;
            if (streak >= mastery) state = "mastered";
          } else if (entry.correct === false) {
            state = "unearned";
            runs = threshold - 1;
            streak = 0;
          }
        } else if (state === "mastered" && entry.correct === false) {
          state = "unearned";
          runs = threshold - 1;
          streak = 0;
        }
        break;
      }
      case "earned":
      case "demoted":
      case "mastered": {
        lastDerived = entry.kind;
        break;
      }
      default:
        break;
    }
  }

  return {
    state,
    runs,
    streak,
    lastDerived,
    needsEarned: state === "earned" && lastDerived !== "earned",
    needsDemoted: state === "unearned" && lastDerived !== null && lastDerived !== "demoted",
    needsMastered: state === "mastered" && lastDerived !== "mastered",
  };
}
