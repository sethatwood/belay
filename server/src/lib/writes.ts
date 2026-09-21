// Which Bash commands write files. The gate denies these on a step the person
// is meant to do themselves, and names the pattern that matched so Claude can
// relay a reason instead of a refusal.
//
// The list: a redirect that is not an fd duplication and not /dev/null;
// heredocs; tee, cp, mv, rm, mkdir, touch, ln, rsync, install, truncate, dd,
// unzip, shred; sed -i, perl -i, patch; tar x; find with -delete or -exec; a
// shell or eval given a command string, scanned inside; an interpreter running
// inline code (node -e, python -c, ruby -e, perl -e, php -r); git subcommands
// that rewrite the working tree; npx create-, npm init, npm install and their
// equivalents; and the Python installers, pip, uv, poetry, and pipx, which all
// report as one pattern named package install.
// Read-only git, test, build, type-check, ls, cat, grep, and find
// all pass, and so do wrappers like sudo, env, xargs, and timeout around them.

interface Scan {
  redirect: boolean;
  heredoc: boolean;
  segments: string[][];
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
  const segments: string[][] = [];
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
  const endSegment = (): void => {
    endToken();
    if (segment.length > 0) segments.push(segment);
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
      endSegment();
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
      if (command[i] === ">") i += 1;
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
      endSegment();
      i += 1;
      // Skip the second character of && and ||.
      if ((ch === "&" && command[i] === "&") || (ch === "|" && command[i] === "|")) i += 1;
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
  endSegment();
  return { redirect, heredoc, segments };
}

const WRAPPERS = new Set(["sudo", "command", "nohup", "time", "env", "exec", "xargs", "then", "do", "else", "timeout"]);
const FILE_WRITERS = new Set(["cp", "mv", "rm", "mkdir", "touch", "ln", "tee", "rsync", "install", "truncate", "dd", "unzip", "shred"]);
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
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  ruby: new Set(["-e"]),
  perl: new Set(["-e", "-E"]),
  php: new Set(["-r"]),
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

function segmentPattern(tokens: string[]): string | null {
  // Peel off assignments, wrappers, and the wrappers' own flags, in any order,
  // until the real command shows: env FOO=1 sudo -u me rm f is rm.
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
  const rest = tokens.slice(i);
  if (rest.length === 0) return null;

  const cmd = base(rest[0]);
  const args = rest.slice(1).map(stripQuotes);

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
  if (cmd === "patch") return "patch";

  const inline = INLINE_FLAGS[cmd];
  if (inline !== undefined && args.some((a) => inline.has(a))) return `${cmd} inline`;

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

  if (cmd === "npx" || cmd === "bunx") {
    if (args.some((a) => base(a).startsWith("create-"))) return "npx create-";
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
  const { redirect, heredoc, segments } = scan(command);
  if (redirect) return "redirect";
  if (heredoc) return "heredoc";
  for (const segment of segments) {
    const pattern = segmentPattern(segment);
    if (pattern !== null) return pattern;
  }
  return null;
}
