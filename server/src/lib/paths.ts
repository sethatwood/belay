// Where Belay keeps things, and how it names them.
//
// The repo side lives in .belay/ at the repo root. The private side lives in
// the home directory, under ~/.belay. Set BELAY_HOME to point that private
// side somewhere else; tests use it so they never touch a real home directory.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export function homeRoot(): string {
  const override = process.env.BELAY_HOME;
  return override !== undefined && override.length > 0 ? resolve(override) : homedir();
}

export function homeBelayDir(): string {
  return join(homeRoot(), ".belay");
}

// The output style setting that turns the coaching contract on. A plugin's
// style is named with the plugin's name in front.
export const STYLE_SETTING = "belay:Belay";

export function configPath(): string {
  return join(homeBelayDir(), "config.json");
}

// Where Claude Code started the session. It stays put when Claude runs cd or
// enters a worktree, and both the hooks and the MCP server are given it, so
// resolving from here keeps the two sides on one state file. A hook's own cwd
// follows cd, and a cd into a submodule would otherwise leave the gate reading
// a state file the server never writes.
export function projectDir(fallback?: string): string | undefined {
  const dir = process.env.CLAUDE_PROJECT_DIR;
  return dir !== undefined && dir.length > 0 ? dir : fallback;
}

// The home directory is never a repo root. It holds ~/.belay, the private
// side, and sometimes a .git for dotfiles, and neither makes it a project.
export function isHomeDir(dir: string): boolean {
  const at = resolve(dir);
  return at === homeRoot() || at === resolve(homedir());
}

// Walk up from the hook's cwd, or from this process's, to the first directory
// that holds a .belay or a .git, stopping below the home directory. When
// neither turns up, the starting directory is the answer, which keeps every
// caller working on a plain folder.
export function findRepoRoot(start?: string): string {
  const from = resolve(start !== undefined && start.length > 0 ? start : process.cwd());
  let dir = from;
  for (;;) {
    if (isHomeDir(dir)) return from;
    if (existsSync(join(dir, ".belay")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

export function belayDir(root: string): string {
  return join(root, ".belay");
}

export function mapPath(root: string): string {
  return join(belayDir(root), "map.json");
}

export function statePath(root: string): string {
  return join(belayDir(root), "state.json");
}

export function logbookDir(root: string): string {
  return join(belayDir(root), "logbook");
}

export function logbookPath(root: string, handle: string): string {
  return join(logbookDir(root), `${handle}.jsonl`);
}

// Run git and hand back its output, or null when git is missing, the directory
// is not a repo, or the command fails. Nothing here treats that as an error.
export function git(root: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

// Lowercase, every run of characters outside a-z0-9 becomes one dash, leading
// and trailing dashes trimmed, and "anonymous" when nothing is left.
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "anonymous";
}

// The handle names the logbook file. It comes from ~/.belay/config.json, and
// is seeded from git config user.name the first time anything asks for it.
export function readHandle(root: string): string {
  const path = configPath();
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8")) as { handle?: unknown };
      if (typeof cfg.handle === "string" && cfg.handle.length > 0) return cfg.handle;
    } catch {
      // A config that will not parse is replaced below rather than reported.
    }
  }
  const handle = slugify(git(root, ["config", "user.name"]) ?? "");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ handle }, null, 2)}\n`, "utf8");
  return handle;
}

// The repo directory name plus the first eight characters of a hash of the
// remote URL, or of the path when the repo has no remote.
export function repoSlug(root: string): string {
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  const seed = remote !== null && remote.length > 0 ? remote : root;
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return `${slugify(basename(root))}-${hash}`;
}

export function journalPath(root: string, date: string): string {
  return join(homeBelayDir(), "journal", repoSlug(root), `${date}.jsonl`);
}

// UTC ISO 8601, to the second, the way every t field in the logbook reads.
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
