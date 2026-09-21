// The private journal: ~/.belay/journal/<repo-slug>/<date>.jsonl, never
// committed. Hints, questions, answers, and what the person got wrong go here
// and nowhere else. The repo holds capability states, not struggles.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { journalPath, nowIso } from "./paths.js";

export interface JournalEntry {
  kind: string;
  skill?: string;
  note?: string;
  [key: string]: unknown;
}

export function write(root: string, entry: JournalEntry, at?: string): void {
  const t = at ?? nowIso();
  const date = t.slice(0, 10);
  const path = journalPath(root, date);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ t, ...entry })}\n`, "utf8");
}
