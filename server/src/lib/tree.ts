// What changed in the working tree, and since when. A step records a snapshot
// of the changed files at its start, so only work done during the step counts
// as the step's, whichever tool or editor did it.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "./paths.js";

export type Snapshot = Record<string, string>;

// Every tracked file that differs from the baseline commit plus every
// untracked file, minus Belay's own directory.
export function changedPaths(root: string, baseline: string | null): string[] {
  const found = new Set<string>();
  if (baseline !== null && baseline.length > 0) {
    const tracked = git(root, ["diff", "--name-only", baseline, "--"]);
    if (tracked !== null) {
      for (const line of tracked.split("\n")) if (line.trim().length > 0) found.add(line.trim());
    }
  }
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked !== null) {
    for (const line of untracked.split("\n")) if (line.trim().length > 0) found.add(line.trim());
  }
  return [...found].filter((p) => !p.startsWith(".belay/"));
}

function hashOf(root: string, path: string): string {
  const full = join(root, path);
  if (!existsSync(full) || !statSync(full).isFile()) return "missing";
  return createHash("sha256").update(readFileSync(full)).digest("hex");
}

export function snapshot(root: string, baseline: string | null): Snapshot {
  const out: Snapshot = {};
  for (const path of changedPaths(root, baseline)) out[path] = hashOf(root, path);
  return out;
}

// The files that are new or different since the snapshot was taken.
export function changedSince(root: string, baseline: string | null, snap: Snapshot): string[] {
  return changedPaths(root, baseline).filter((path) => snap[path] !== hashOf(root, path));
}
