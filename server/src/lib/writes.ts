// Which Bash commands write files. The gate denies these on a step the person
// is meant to do themselves, and names the pattern that matched so Claude can
// relay a reason instead of a refusal.
//
// The list: a redirect that is not an fd duplication and not /dev/null,
// including >|; heredocs; tee, cp, mv, rm, mkdir, touch, ln, rsync, install,
// truncate, dd, unzip, shred, ed; sed -i, perl -i, awk -i inplace, patch; tar
// x; find with -delete or -exec; curl or wget saving to a file; a shell or
// eval given a command string, scanned inside; an interpreter running inline
// code (node -e, python -c, bun -e, deno eval, tsx -e, ruby -e, perl -e, php
// -r); a formatter or linter told to rewrite files (prettier --write, eslint
// --fix, ruff --fix or format, black, isort, biome --write); git subcommands
// that rewrite the working tree; npx create-, npm init, npm install and their
// equivalents; and the Python installers, pip, uv, poetry, and pipx, which all
// report as one pattern named package install.
// Read-only git, test, build, type-check, ls, cat, grep, and find all pass,
// and so do wrappers like sudo, env, xargs, and timeout around them, and
// runners like npx, pnpm exec, uv run, and poetry run, which are read through
// to the command they run.

// One command the shell runs on its own, and the operator that follows it:
// ";", "|", "||", "&&", "&", a newline, a bracket, or "" at the end.
export interface Segment {
  tokens: string[];
  next: string;
}

interface Scan {
  redirect: boolean;
  heredoc: boolean;
  segments: Segment[];
}

const BREAKERS = new Set([";", "|", "&", "(", ")", "{", "}", "\n", "`"]);

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "'" || first === '"') && first === last) return token.slice(1, -1);
  }
  return token;
}

// One pass over the command line. It tracks quoting so a > inside a string is
// text, splits the line into the segments a shell would run separately, and
// notes redirects and heredocs as it goes.
function scan(command: string): Scan {
  const segments: Segment[] = [];
  let segment: string[] = [];
  let token = "";
  let redirect = false;
  let heredoc = false;

  const endToken = (): void => {
    if (token.length > 0) {
      segment.push(token);
      token = "";
    }
  };
  const endSegment = (next: string): void => {
    endToken();
    if (segment.length > 0) segments.push({ tokens: segment, next });
    segment = [];
  };

  // Read a redirect target, starting just after the > or >>.
  const readTarget = (from: number): { target: string; next: number } => {
    let i = from;
    while (i < command.length && (command[i] === " " || command[i] === "\t")) i += 1;
    let target = "";
    let quote: string | null = null;
    while (i < command.length) {
      const ch = command[i];
      if (quote !== null) {
        if (ch === quote) quote = null;
        else target += ch;
        i += 1;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        i += 1;
        continue;
      }
      if (/\s/.test(ch) || BREAKERS.has(ch) || ch === "<" || ch === ">") break;
      target += ch;
      i += 1;
    }
    return { target, next: i };
  };

  let i = 0;
  let quote: string | null = null;
  while (i < command.length) {
    const ch = command[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else token += ch;
      i += 1;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\" && i + 1 < command.length) {
        token += command[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') quote = null;
      else token += ch;
      i += 1;
      continue;
    }

    if (ch === "\\" && i + 1 < command.length) {
      token += command[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }

    // $( opens a subshell, which runs its own command.
    if (ch === "$" && command[i + 1] === "(") {
      endSegment("$(");
      i += 2;
      continue;
    }

    if (ch === "<") {
      if (command[i + 1] === "<" && command[i + 2] === "<") {
        // A herestring feeds text in. It writes nothing.
        endToken();
        i += 3;
        continue;
      }
      if (command[i + 1] === "<") {
        heredoc = true;
        endToken();
        i += 2;
        if (command[i] === "-") i += 1;
        while (i < command.length && /\s/.test(command[i])) i += 1;
        while (i < command.length && !/\s/.test(command[i]) && !BREAKERS.has(command[i])) i += 1;
        continue;
      }
      endToken();
      i += 1;
      continue;
    }

    // &> and &>> redirect both streams to a file.
    if (ch === "&" && command[i + 1] === ">") {
      i += 1;
      continue;
    }

    if (ch === ">") {
      endToken();
      i += 1;
      // >> appends and >| overwrites past noclobber. Both write the target.
      if (command[i] === ">" || command[i] === "|") i += 1;
      let j = i;
      while (j < command.length && (command[j] === " " || command[j] === "\t")) j += 1;
      if (command[j] === "&") {
        // An fd duplication such as 2>&1. Nothing reaches the filesystem.
        i = j + 1;
        while (i < command.length && /[0-9-]/.test(command[i])) i += 1;
        continue;
      }
      const { target, next } = readTarget(i);
      if (target.length > 0 && target !== "/dev/null") redirect = true;
      i = next;
      continue;
    }

    if (BREAKERS.has(ch)) {
      i += 1;
      // && and || are one operator of two characters.
      const doubled = (ch === "&" || ch === "|") && command[i] === ch;
      if (doubled) i += 1;
      endSegment(doubled ? ch + ch : ch);
      continue;
    }

    if (/\s/.test(ch)) {
      endToken();
      i += 1;
      continue;
    }

    token += ch;
    i += 1;
  }
  endSegment("");
  return { redirect, heredoc, segments };
}

// The commands a line runs, each with the operator after it. The witness
// uses these to find a test run by its command word rather than anywhere in
// the line, and to tell when a pipe hides that command's exit code.
export function segments(command: string): Segment[] {
  return scan(command).segments;
}

const WRAPPERS = new Set(["sudo", "command", "nohup", "time", "env", "exec", "xargs", "then", "do", "else", "timeout"]);
const FILE_WRITERS = new Set(["cp", "mv", "rm", "mkdir", "touch", "ln", "tee", "rsync", "install", "truncate", "dd", "unzip", "shred", "ed"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
// Wrapper flags that take a value, so the value is not mistaken for the command.
const VALUE_FLAGS: Record<string, Set<string>> = {
  sudo: new Set(["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-D"]),
  xargs: new Set(["-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a", "-J", "-R", "-S"]),
};
// A git subcommand that rewrites the working tree, whatever its flags.
const GIT_TREE_WRITERS = new Set([
  "apply", "restore", "checkout", "switch", "clean", "rm", "mv", "merge", "rebase", "cherry-pick", "pull", "revert",
]);
// An interpreter flag that runs code given on the command line. That code can
// write anything, so on a coached step it is a write.
const INLINE_FLAGS: Record<string, Set<string>> = {
  node: new Set(["-e", "--eval", "-p", "--print"]),
  bun: new Set(["-e", "--eval", "-p", "--print"]),
  tsx: new Set(["-e", "--eval", "-p", "--print"]),
  "ts-node": new Set(["-e", "--eval", "-p", "--print"]),
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  ruby: new Set(["-e"]),
  perl: new Set(["-e", "-E"]),
  php: new Set(["-r"]),
};
// Runners that run another command, and the flags of theirs that take a
// value. npx vitest is vitest, and uv run python -c is python -c.
const RUNNERS: Record<string, { subs: Set<string> | null; valued: Set<string> }> = {
  npx: { subs: null, valued: new Set(["-p", "--package", "--cache", "--userconfig"]) },
  bunx: { subs: null, valued: new Set(["-p", "--package"]) },
  pnpm: { subs: new Set(["exec", "dlx"]), valued: new Set(["-C", "--dir", "--filter", "-F"]) },
  yarn: { subs: new Set(["exec", "dlx"]), valued: new Set(["--cwd"]) },
  uv: { subs: new Set(["run"]), valued: new Set(["--with", "--python", "-p", "--project", "--directory", "--group", "--extra", "--env-file", "--package"]) },
  poetry: { subs: new Set(["run"]), valued: new Set(["-C", "--directory", "-P", "--project"]) },
  pipenv: { subs: new Set(["run"]), valued: new Set() },
};
const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const INSTALL_SUBS = new Set(["install", "i", "add", "ci", "update", "upgrade"]);
// The Python installers. Installing rewrites the environment and usually a
// lockfile with it, so on a coached step it is a write. Running a tool through
// one of them, and listing what is installed, are reads.
const PACKAGE_INSTALL = "package install";
const PIP_SUBS = new Set(["install", "uninstall"]);
const UV_SUBS = new Set(["add", "remove", "sync"]);
const POETRY_SUBS = new Set(["add", "install", "remove", "update"]);
const PIPX_SUBS = new Set(["install", "uninstall", "upgrade", "inject"]);

function base(token: string): string {
  const bare = stripQuotes(token);
  const slash = bare.lastIndexOf("/");
  return slash >= 0 ? bare.slice(slash + 1) : bare;
}

// python3.12 reads as python3, so a versioned interpreter meets the same rules.
export function interpreter(name: string): string {
  if (/^python3(?:\.\d+)*$/.test(name)) return "python3";
  if (/^python2(?:\.\d+)*$/.test(name)) return "python";
  return name;
}

function firstArg(args: string[]): string {
  for (const arg of args) {
    if (!arg.startsWith("-")) return base(arg);
  }
  return "";
}

// pip, uv, poetry, and pipx, by the subcommand that follows them. uv carries
// pip's own subcommands under uv pip, so that one is read a word further in.
function pythonInstall(cmd: string, args: string[]): string | null {
  const words = args.filter((a) => !a.startsWith("-")).map(base);
  const first = words[0] ?? "";
  if (cmd === "pip" || cmd === "pip3") return PIP_SUBS.has(first) ? PACKAGE_INSTALL : null;
  if (cmd === "poetry") return POETRY_SUBS.has(first) ? PACKAGE_INSTALL : null;
  if (cmd === "pipx") return PIPX_SUBS.has(first) ? PACKAGE_INSTALL : null;
  if (cmd === "uv") {
    if (first === "pip") return PIP_SUBS.has(words[1] ?? "") ? PACKAGE_INSTALL : null;
    return UV_SUBS.has(first) ? PACKAGE_INSTALL : null;
  }
  return null;
}

// Peel off assignments, wrappers, and the wrappers' own flags, in any order,
// until the real command shows: env FOO=1 sudo -u me rm f is rm.
function unwrap(tokens: string[]): string[] {
  let i = 0;
  for (;;) {
    if (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
      i += 1;
      continue;
    }
    if (i < tokens.length && WRAPPERS.has(base(tokens[i]))) {
      const wrapper = base(tokens[i]);
      i += 1;
      // timeout takes a duration before the command.
      if (wrapper === "timeout") {
        while (i < tokens.length && tokens[i].startsWith("-")) i += 1;
        if (i < tokens.length) i += 1;
      }
      const valued = VALUE_FLAGS[wrapper] ?? new Set<string>();
      while (i < tokens.length && tokens[i].startsWith("-")) {
        const flag = tokens[i];
        i += 1;
        if (valued.has(flag) && i < tokens.length) i += 1;
      }
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

// Read through a runner to the command it runs. Anything that is not a
// runner, or a runner with nothing after it, comes back as it was.
function throughRunner(rest: string[]): string[] {
  const cmd = rest.length > 0 ? base(rest[0]) : "";
  const runner = RUNNERS[cmd];
  if (runner === undefined) return rest;
  let i = 1;
  if (runner.subs !== null) {
    while (i < rest.length && rest[i].startsWith("-")) i += runner.valued.has(rest[i]) ? 2 : 1;
    if (i >= rest.length || !runner.subs.has(base(rest[i]))) return rest;
    i += 1;
  }
  while (i < rest.length && rest[i].startsWith("-")) i += runner.valued.has(rest[i]) ? 2 : 1;
  return i < rest.length ? rest.slice(i) : rest;
}

// The command a segment runs once wrappers and runners are read through, as
// its bare name and its arguments with quotes taken off.
export function commandOf(tokens: string[]): { cmd: string; args: string[] } | null {
  const rest = throughRunner(unwrap(tokens));
  if (rest.length === 0) return null;
  return { cmd: interpreter(base(rest[0])), args: rest.slice(1).map(stripQuotes) };
}

// A formatter or linter told to rewrite files in place.
function formatter(cmd: string, args: string[]): boolean {
  const has = (...flags: string[]): boolean => args.some((a) => flags.includes(a));
  const words = args.filter((a) => !a.startsWith("-"));
  if (cmd === "prettier") return has("--write", "-w");
  if (cmd === "eslint" || cmd === "stylelint") return has("--fix");
  if (cmd === "ruff") return has("--fix") || (words[0] === "format" && !has("--check", "--diff"));
  if (cmd === "black" || cmd === "isort") return !has("--check", "--check-only", "--diff");
  if (cmd === "biome") return has("--write", "--apply", "--apply-unsafe", "--fix");
  if (cmd === "autopep8") return has("-i", "--in-place");
  return false;
}

// curl and wget, when they save what they fetch into a file.
function download(cmd: string, args: string[]): boolean {
  const discard = (value: string | undefined): boolean => value === "-" || value === "/dev/null";
  if (cmd === "curl") {
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (a === "--output" || a === "-o") {
        if (!discard(args[i + 1])) return true;
      } else if (a === "--remote-name" || a === "--remote-name-all" || /^-[A-Za-z]*O[A-Za-z]*$/.test(a)) {
        return true;
      } else if (/^-[A-Za-z]*o$/.test(a)) {
        if (!discard(args[i + 1])) return true;
      } else if (/^-o./.test(a) && !discard(a.slice(2))) {
        return true;
      }
    }
    return false;
  }
  if (cmd === "wget") {
    if (args.includes("--spider")) return false;
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (a === "-O" || a === "--output-document") return !discard(args[i + 1]);
      if (a.startsWith("--output-document=")) return !discard(a.slice("--output-document=".length));
      if (/^-[A-Za-z]*O-?$/.test(a)) return a.endsWith("-") ? false : !discard(args[i + 1]);
    }
    return true;
  }
  return false;
}

function segmentPattern(tokens: string[]): string | null {
  const unwrapped = unwrap(tokens);
  if (unwrapped.length === 0) return null;
  // npx create-app and uv add read the runner itself, before it is read through.
  const outer = base(unwrapped[0]);
  const outerArgs = unwrapped.slice(1).map(stripQuotes);
  if ((outer === "npx" || outer === "bunx") && outerArgs.some((a) => base(a).startsWith("create-"))) return "npx create-";
  const installer = pythonInstall(outer, outerArgs);
  if (installer !== null) return installer;

  const found = commandOf(tokens);
  if (found === null) return null;
  const { cmd, args } = found;

  if (FILE_WRITERS.has(cmd)) return cmd;

  // A shell given a command string runs that string, so look inside it.
  if (SHELLS.has(cmd)) {
    const at = args.indexOf("-c");
    if (at >= 0 && at + 1 < args.length) return writePattern(args[at + 1]);
    return null;
  }
  if (cmd === "eval") return writePattern(args.join(" "));

  if (cmd === "sed" && args.some((a) => /^-[A-Za-z]*i/.test(a) || a === "--in-place")) return "sed -i";
  if (cmd === "perl" && args.some((a) => /^-[A-Za-z]*i/.test(a))) return "perl -i";
  if ((cmd === "awk" || cmd === "gawk") && args.some((a, i) => a === "inplace" && args[i - 1] === "-i")) {
    return "awk -i inplace";
  }
  if (cmd === "patch") return "patch";
  if (formatter(cmd, args)) return "formatter";
  if (download(cmd, args)) return "download";

  const inline = INLINE_FLAGS[cmd];
  if (inline !== undefined && args.some((a) => inline.has(a))) return `${cmd} inline`;
  if (cmd === "deno" && firstArg(args) === "eval") return "deno inline";

  // python -m pip install is pip, whichever interpreter runs it.
  if (cmd === "python" || cmd === "python3") {
    const at = args.indexOf("-m");
    if (at >= 0 && at + 1 < args.length && base(args[at + 1]) === "pip") {
      return pythonInstall("pip", args.slice(at + 2));
    }
  }

  const python = pythonInstall(cmd, args);
  if (python !== null) return python;

  if (cmd === "tar" && args.length > 0 && /^-?[A-Za-z]*x/.test(args[0])) return "tar x";
  if (cmd === "tar" && args.some((a) => a === "--extract" || a === "-x")) return "tar x";
  if (cmd === "find" && args.some((a) => a === "-delete" || a === "-exec" || a === "-execdir" || a === "-ok" || a === "-okdir")) {
    return "find -exec";
  }

  if (cmd === "git") {
    const sub = firstArg(args);
    if (GIT_TREE_WRITERS.has(sub)) return `git ${sub}`;
    if (sub === "stash") {
      const after = args.slice(args.indexOf("stash") + 1).filter((a) => !a.startsWith("-"));
      // Listing and showing a stash read. Everything else moves files.
      if (after[0] === "list" || after[0] === "show") return null;
      return "git stash";
    }
    if (sub === "reset" && (args.includes("--hard") || args.includes("--merge"))) return "git reset --hard";
    return null;
  }

  if (PACKAGE_RUNNERS.has(cmd)) {
    const sub = firstArg(args);
    if (sub === "init") return "npm init";
    if (sub === "create") return "npx create-";
    if (INSTALL_SUBS.has(sub)) return "npm install";
    if (sub === "" && cmd === "yarn") return "npm install";
    return null;
  }

  return null;
}

// The name of the write pattern this command matches, or null when nothing
// about it reaches the filesystem.
export function writePattern(command: string): string | null {
  const scanned = scan(command);
  if (scanned.redirect) return "redirect";
  if (scanned.heredoc) return "heredoc";
  for (const segment of scanned.segments) {
    const pattern = segmentPattern(segment.tokens);
    if (pattern !== null) return pattern;
  }
  return null;
}
