// What changed in the working tree, and since when. A step records a snapshot
// of the changed files at its start, so only work done during the step counts
// as the step's, whichever tool or editor did it.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "./paths.js";

export type Snapshot = Record<string, string>;

// Installed packages are never anyone's work. A repo that forgot to ignore
// them would otherwise put thousands of paths into one unaided run.
const DEPENDENCY_DIRS = new Set(["node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache"]);

function paths(output: string | null): string[] {
  if (output === null) return [];
  return output.split("\0").filter((p) => p.length > 0);
}

// Every tracked file that differs from the baseline commit plus every
// untracked file, minus Belay's own directory and installed packages. The -z
// output keeps names with spaces or accents exactly as they are on disk, and
// --relative names tracked files from the Belay root, the way ls-files names
// untracked ones, when that root sits below the top of the git repo.
export function changedPaths(root: string, baseline: string | null): string[] {
  const found = new Set<string>();
  if (baseline !== null && baseline.length > 0) {
    for (const p of paths(git(root, ["diff", "--name-only", "--relative", "-z", baseline, "--"]))) found.add(p);
  }
  for (const p of paths(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))) found.add(p);
  return [...found].filter(
    (p) => !p.startsWith(".belay/") && !p.split("/").some((part) => DEPENDENCY_DIRS.has(part)),
  );
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
