#!/usr/bin/env node

// src/lib/logbook.ts
import { appendFileSync, existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3 } from "node:fs";

// src/lib/map.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";

// src/lib/paths.ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
function homeRoot() {
  const override = process.env.BELAY_HOME;
  return override !== void 0 && override.length > 0 ? resolve(override) : homedir();
}
function homeBelayDir() {
  return join(homeRoot(), ".belay");
}
var STYLE_SETTING = "belay:Belay";
function configPath() {
  return join(homeBelayDir(), "config.json");
}
function projectDir(fallback) {
  const dir = process.env.CLAUDE_PROJECT_DIR;
  return dir !== void 0 && dir.length > 0 ? dir : fallback;
}
function isHomeDir(dir) {
  const at = resolve(dir);
  return at === homeRoot() || at === resolve(homedir());
}
function findRepoRoot(start) {
  const from = resolve(start !== void 0 && start.length > 0 ? start : process.cwd());
  let dir = from;
  for (; ; ) {
    if (isHomeDir(dir)) return from;
    if (existsSync(join(dir, ".belay")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}
function belayDir(root) {
  return join(root, ".belay");
}
function mapPath(root) {
  return join(belayDir(root), "map.json");
}
function statePath(root) {
  return join(belayDir(root), "state.json");
}
function logbookDir(root) {
  return join(belayDir(root), "logbook");
}
function logbookPath(root, handle) {
  return join(logbookDir(root), `${handle}.jsonl`);
}
function git(root, args) {
  try {
    const out = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.trim();
  } catch {
    return null;
  }
}
function slugify(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return slug.length > 0 ? slug : "anonymous";
}
function readHandle(root) {
  const path = configPath();
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      if (typeof cfg.handle === "string" && cfg.handle.length > 0) return slugify(cfg.handle);
    } catch {
    }
  }
  const handle = slugify(git(root, ["config", "user.name"]) ?? "");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ handle }, null, 2)}
`, "utf8");
  return handle;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// src/lib/map.ts
var KINDS = ["test", "types", "build"];
function strings(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
function kinds(value) {
  const out = strings(value).filter((v) => KINDS.includes(v));
  return out.length > 0 ? out : ["test"];
}
function normalize(raw) {
  const obj2 = raw !== null && typeof raw === "object" ? raw : {};
  const skills = [];
  const rawSkills = Array.isArray(obj2.skills) ? obj2.skills : [];
  for (const entry of rawSkills) {
    if (entry === null || typeof entry !== "object") continue;
    const s = entry;
    if (typeof s.id !== "string" || s.id.length === 0) continue;
    skills.push({
      id: s.id,
      name: typeof s.name === "string" ? s.name : s.id,
      teaches: typeof s.teaches === "string" ? s.teaches : "",
      witness: kinds(s.witness),
      requires: strings(s.requires),
      precedents: strings(s.precedents)
    });
  }
  const zones = [];
  const rawZones = Array.isArray(obj2.zones) ? obj2.zones : [];
  for (const entry of rawZones) {
    if (entry === null || typeof entry !== "object") continue;
    const z = entry;
    zones.push({ paths: strings(z.paths), cosign: z.cosign === true });
  }
  return {
    version: typeof obj2.version === "number" ? obj2.version : 1,
    threshold: typeof obj2.threshold === "number" && obj2.threshold > 0 ? obj2.threshold : 3,
    mastery: typeof obj2.mastery === "number" && obj2.mastery > 0 ? obj2.mastery : 5,
    skills,
    zones
  };
}
function read(root) {
  if (isHomeDir(root)) return null;
  const path = mapPath(root);
  if (!existsSync2(path)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    throw new Error(".belay/map.json is not valid JSON");
  }
  return normalize(raw);
}
function findSkill(map, id) {
  return map.skills.find((s) => s.id === id) ?? null;
}

// src/lib/logbook.ts
function read2(root, handle) {
  const path = logbookPath(root, handle);
  if (!existsSync3(path)) return { entries: [], malformed: 0 };
  const entries = [];
  let malformed = 0;
  for (const line of readFileSync3(path, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed;
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
    const obj2 = parsed;
    if (typeof obj2.kind !== "string") {
      malformed += 1;
      continue;
    }
    entries.push({ ...obj2, t: typeof obj2.t === "string" ? obj2.t : "", kind: obj2.kind });
  }
  return { entries, malformed };
}
function countsAsRun(entry, accepted) {
  const witness2 = entry.witness;
  if (witness2 === null || typeof witness2 !== "object") return false;
  const w = witness2;
  if (w.pass !== true) return false;
  if (typeof w.kind !== "string" || !accepted.includes(w.kind)) return false;
  return typeof entry.question === "string" && entry.question.length > 0;
}
function derive(entries, skillId, map) {
  const skill = findSkill(map, skillId);
  const accepted = skill !== null ? skill.witness : ["test"];
  const threshold = map.threshold;
  const mastery = map.mastery;
  let state = "unearned";
  let runs = 0;
  let streak = 0;
  let lastDerived = null;
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
    needsMastered: state === "mastered" && lastDerived !== "mastered"
  };
}

// src/lib/state.ts
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync as existsSync4, mkdirSync as mkdirSync3, openSync, readFileSync as readFileSync4, renameSync, statSync, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";
var EMPTY = { version: 1, step: null, last: null };
function read3(root) {
  if (isHomeDir(root)) return { ...EMPTY };
  const path = statePath(root);
  if (!existsSync4(path)) return { ...EMPTY };
  try {
    const raw = JSON.parse(readFileSync4(path, "utf8"));
    return {
      version: typeof raw.version === "number" ? raw.version : 1,
      step: raw.step !== null && typeof raw.step === "object" ? normalizeStep(raw.step) : null,
      last: raw.last !== null && typeof raw.last === "object" ? raw.last : null
    };
  } catch {
    return { ...EMPTY };
  }
}
function normalizeStep(raw) {
  const s = raw;
  if (typeof s.skill !== "string" || typeof s.mode !== "string") return null;
  return {
    id: typeof s.id === "string" ? s.id : newId(),
    skill: s.skill,
    mode: s.mode,
    goal: typeof s.goal === "string" ? s.goal : "",
    startedAt: typeof s.startedAt === "string" ? s.startedAt : "",
    baseline: typeof s.baseline === "string" ? s.baseline : null,
    followUp: s.followUp === true,
    hints: typeof s.hints === "number" ? s.hints : 0,
    snapshot: s.snapshot !== null && typeof s.snapshot === "object" ? s.snapshot : {},
    toolEdits: Array.isArray(s.toolEdits) ? s.toolEdits.filter((p) => typeof p === "string") : [],
    witnesses: Array.isArray(s.witnesses) ? s.witnesses : [],
    pending: s.pending !== null && typeof s.pending === "object" ? s.pending : null,
    question: s.question !== null && typeof s.question === "object" ? s.question : null
  };
}
function write(root, state) {
  mkdirSync3(belayDir(root), { recursive: true });
  const path = statePath(root);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync2(temp, `${JSON.stringify(state, null, 2)}
`, "utf8");
  renameSync(temp, path);
}
var LOCK_WAIT_MS = 2e3;
var LOCK_STALE_MS = 1e4;
function lockPath(root) {
  const hash = createHash("sha256").update(resolve2(root)).digest("hex").slice(0, 16);
  return join2(tmpdir(), `belay-${hash}.lock`);
}
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function acquire(path) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (; ; ) {
    try {
      closeSync(openSync(path, "wx"));
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") return false;
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
function update(root, fn) {
  const hasBelay = existsSync4(belayDir(root)) && !isHomeDir(root);
  const path = lockPath(root);
  const held = hasBelay && acquire(path);
  try {
    const state = read3(root);
    const before = JSON.stringify(state);
    const result = fn(state);
    if (hasBelay && JSON.stringify(state) !== before) write(root, state);
    return result;
  } finally {
    if (held) {
      try {
        unlinkSync(path);
      } catch {
      }
    }
  }
}
var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newId() {
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

// src/lib/writes.ts
var BREAKERS = /* @__PURE__ */ new Set([";", "|", "&", "(", ")", "{", "}", "\n", "`"]);
function stripQuotes(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "'" || first === '"') && first === last) return token.slice(1, -1);
  }
  return token;
}
function scan(command) {
  const segments2 = [];
  let segment = [];
  let token = "";
  let redirect = false;
  let heredoc = false;
  const endToken = () => {
    if (token.length > 0) {
      segment.push(token);
      token = "";
    }
  };
  const endSegment = (next) => {
    endToken();
    if (segment.length > 0) segments2.push({ tokens: segment, next });
    segment = [];
  };
  const readTarget = (from) => {
    let i2 = from;
    while (i2 < command.length && (command[i2] === " " || command[i2] === "	")) i2 += 1;
    let target = "";
    let quote2 = null;
    while (i2 < command.length) {
      const ch = command[i2];
      if (quote2 !== null) {
        if (ch === quote2) quote2 = null;
        else target += ch;
        i2 += 1;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote2 = ch;
        i2 += 1;
        continue;
      }
      if (/\s/.test(ch) || BREAKERS.has(ch) || ch === "<" || ch === ">") break;
      target += ch;
      i2 += 1;
    }
    return { target, next: i2 };
  };
  let i = 0;
  let quote = null;
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
    if (ch === "$" && command[i + 1] === "(") {
      endSegment("$(");
      i += 2;
      continue;
    }
    if (ch === "<") {
      if (command[i + 1] === "<" && command[i + 2] === "<") {
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
    if (ch === "&" && command[i + 1] === ">") {
      i += 1;
      continue;
    }
    if (ch === ">") {
      endToken();
      i += 1;
      if (command[i] === ">" || command[i] === "|") i += 1;
      let j = i;
      while (j < command.length && (command[j] === " " || command[j] === "	")) j += 1;
      if (command[j] === "&") {
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
  return { redirect, heredoc, segments: segments2 };
}
function segments(command) {
  return scan(command).segments;
}
var WRAPPERS = /* @__PURE__ */ new Set(["sudo", "command", "nohup", "time", "env", "exec", "xargs", "then", "do", "else", "timeout"]);
var FILE_WRITERS = /* @__PURE__ */ new Set(["cp", "mv", "rm", "mkdir", "touch", "ln", "tee", "rsync", "install", "truncate", "dd", "unzip", "shred", "ed"]);
var SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
var VALUE_FLAGS = {
  sudo: /* @__PURE__ */ new Set(["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-D"]),
  xargs: /* @__PURE__ */ new Set(["-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a", "-J", "-R", "-S"])
};
var GIT_TREE_WRITERS = /* @__PURE__ */ new Set([
  "apply",
  "restore",
  "checkout",
  "switch",
  "clean",
  "rm",
  "mv",
  "merge",
  "rebase",
  "cherry-pick",
  "pull",
  "revert"
]);
var INLINE_FLAGS = {
  node: /* @__PURE__ */ new Set(["-e", "--eval", "-p", "--print"]),
  bun: /* @__PURE__ */ new Set(["-e", "--eval", "-p", "--print"]),
  tsx: /* @__PURE__ */ new Set(["-e", "--eval", "-p", "--print"]),
  "ts-node": /* @__PURE__ */ new Set(["-e", "--eval", "-p", "--print"]),
  python: /* @__PURE__ */ new Set(["-c"]),
  python3: /* @__PURE__ */ new Set(["-c"]),
  ruby: /* @__PURE__ */ new Set(["-e"]),
  perl: /* @__PURE__ */ new Set(["-e", "-E"]),
  php: /* @__PURE__ */ new Set(["-r"])
};
var RUNNERS = {
  npx: { subs: null, valued: /* @__PURE__ */ new Set(["-p", "--package", "--cache", "--userconfig"]) },
  bunx: { subs: null, valued: /* @__PURE__ */ new Set(["-p", "--package"]) },
  pnpm: { subs: /* @__PURE__ */ new Set(["exec", "dlx"]), valued: /* @__PURE__ */ new Set(["-C", "--dir", "--filter", "-F"]) },
  yarn: { subs: /* @__PURE__ */ new Set(["exec", "dlx"]), valued: /* @__PURE__ */ new Set(["--cwd"]) },
  uv: { subs: /* @__PURE__ */ new Set(["run"]), valued: /* @__PURE__ */ new Set(["--with", "--python", "-p", "--project", "--directory", "--group", "--extra", "--env-file", "--package"]) },
  poetry: { subs: /* @__PURE__ */ new Set(["run"]), valued: /* @__PURE__ */ new Set(["-C", "--directory", "-P", "--project"]) },
  pipenv: { subs: /* @__PURE__ */ new Set(["run"]), valued: /* @__PURE__ */ new Set() }
};
var PACKAGE_RUNNERS = /* @__PURE__ */ new Set(["npm", "pnpm", "yarn", "bun"]);
var INSTALL_SUBS = /* @__PURE__ */ new Set(["install", "i", "add", "ci", "update", "upgrade"]);
var PACKAGE_INSTALL = "package install";
var PIP_SUBS = /* @__PURE__ */ new Set(["install", "uninstall"]);
var UV_SUBS = /* @__PURE__ */ new Set(["add", "remove", "sync"]);
var POETRY_SUBS = /* @__PURE__ */ new Set(["add", "install", "remove", "update"]);
var PIPX_SUBS = /* @__PURE__ */ new Set(["install", "uninstall", "upgrade", "inject"]);
function base(token) {
  const bare = stripQuotes(token);
  const slash = bare.lastIndexOf("/");
  return slash >= 0 ? bare.slice(slash + 1) : bare;
}
function interpreter(name) {
  if (/^python3(?:\.\d+)*$/.test(name)) return "python3";
  if (/^python2(?:\.\d+)*$/.test(name)) return "python";
  return name;
}
function firstArg(args) {
  for (const arg of args) {
    if (!arg.startsWith("-")) return base(arg);
  }
  return "";
}
function pythonInstall(cmd, args) {
  const words2 = args.filter((a) => !a.startsWith("-")).map(base);
  const first = words2[0] ?? "";
  if (cmd === "pip" || cmd === "pip3") return PIP_SUBS.has(first) ? PACKAGE_INSTALL : null;
  if (cmd === "poetry") return POETRY_SUBS.has(first) ? PACKAGE_INSTALL : null;
  if (cmd === "pipx") return PIPX_SUBS.has(first) ? PACKAGE_INSTALL : null;
  if (cmd === "uv") {
    if (first === "pip") return PIP_SUBS.has(words2[1] ?? "") ? PACKAGE_INSTALL : null;
    return UV_SUBS.has(first) ? PACKAGE_INSTALL : null;
  }
  return null;
}
function unwrap(tokens) {
  let i = 0;
  for (; ; ) {
    if (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
      i += 1;
      continue;
    }
    if (i < tokens.length && WRAPPERS.has(base(tokens[i]))) {
      const wrapper = base(tokens[i]);
      i += 1;
      if (wrapper === "timeout") {
        while (i < tokens.length && tokens[i].startsWith("-")) i += 1;
        if (i < tokens.length) i += 1;
      }
      const valued = VALUE_FLAGS[wrapper] ?? /* @__PURE__ */ new Set();
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
function throughRunner(rest) {
  const cmd = rest.length > 0 ? base(rest[0]) : "";
  const runner = RUNNERS[cmd];
  if (runner === void 0) return rest;
  let i = 1;
  if (runner.subs !== null) {
    while (i < rest.length && rest[i].startsWith("-")) i += runner.valued.has(rest[i]) ? 2 : 1;
    if (i >= rest.length || !runner.subs.has(base(rest[i]))) return rest;
    i += 1;
  }
  while (i < rest.length && rest[i].startsWith("-")) i += runner.valued.has(rest[i]) ? 2 : 1;
  return i < rest.length ? rest.slice(i) : rest;
}
function commandOf(tokens) {
  const rest = throughRunner(unwrap(tokens));
  if (rest.length === 0) return null;
  return { cmd: interpreter(base(rest[0])), args: rest.slice(1).map(stripQuotes) };
}
function formatter(cmd, args) {
  const has = (...flags) => args.some((a) => flags.includes(a));
  const words2 = args.filter((a) => !a.startsWith("-"));
  if (cmd === "prettier") return has("--write", "-w");
  if (cmd === "eslint" || cmd === "stylelint") return has("--fix");
  if (cmd === "ruff") return has("--fix") || words2[0] === "format" && !has("--check", "--diff");
  if (cmd === "black" || cmd === "isort") return !has("--check", "--check-only", "--diff");
  if (cmd === "biome") return has("--write", "--apply", "--apply-unsafe", "--fix");
  if (cmd === "autopep8") return has("-i", "--in-place");
  return false;
}
function download(cmd, args) {
  const discard = (value) => value === "-" || value === "/dev/null";
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
function segmentPattern(tokens) {
  const unwrapped = unwrap(tokens);
  if (unwrapped.length === 0) return null;
  const outer = base(unwrapped[0]);
  const outerArgs = unwrapped.slice(1).map(stripQuotes);
  if ((outer === "npx" || outer === "bunx") && outerArgs.some((a) => base(a).startsWith("create-"))) return "npx create-";
  const installer = pythonInstall(outer, outerArgs);
  if (installer !== null) return installer;
  const found = commandOf(tokens);
  if (found === null) return null;
  const { cmd, args } = found;
  if (FILE_WRITERS.has(cmd)) return cmd;
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
  if (inline !== void 0 && args.some((a) => inline.has(a))) return `${cmd} inline`;
  if (cmd === "deno" && firstArg(args) === "eval") return "deno inline";
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
function writePattern(command) {
  const scanned = scan(command);
  if (scanned.redirect) return "redirect";
  if (scanned.heredoc) return "heredoc";
  for (const segment of scanned.segments) {
    const pattern = segmentPattern(segment.tokens);
    if (pattern !== null) return pattern;
  }
  return null;
}

// src/lib/witness.ts
var DIRECT = {
  vitest: "test",
  jest: "test",
  pytest: "test",
  "py.test": "test",
  tsc: "types",
  mypy: "types",
  pyright: "types",
  esbuild: "build"
};
var TYPECHECK_SCRIPTS = /* @__PURE__ */ new Set(["typecheck", "type-check", "types", "check-types", "tsc"]);
function script(name) {
  if (name === "test" || name.startsWith("test:")) return "test";
  if (name === "build" || name.startsWith("build:")) return "build";
  if (TYPECHECK_SCRIPTS.has(name)) return "types";
  return null;
}
var SCRIPT_LABEL = { test: "test", build: "build", types: "typecheck" };
function words(args) {
  return args.filter((a) => !a.startsWith("-"));
}
function recognizeOne(tokens) {
  const found = commandOf(tokens);
  if (found === null) return null;
  const { cmd, args } = found;
  const rest = words(args);
  const direct = DIRECT[cmd];
  if (direct !== void 0) return { kind: direct, label: cmd === "py.test" ? "pytest" : cmd };
  if (cmd === "node" && args.includes("--test")) return { kind: "test", label: "node --test" };
  if (cmd === "vite" && rest[0] === "build") return { kind: "build", label: "vite build" };
  if (cmd === "next" && rest[0] === "build") return { kind: "build", label: "next build" };
  if (cmd === "python" || cmd === "python3") {
    const at = args.indexOf("-m");
    const module = at >= 0 ? args[at + 1] : void 0;
    if (module === "pytest") return { kind: "test", label: `${cmd} -m pytest` };
    if (module === "unittest") return { kind: "test", label: `${cmd} -m unittest` };
    if (module === "mypy") return { kind: "types", label: "mypy" };
    return null;
  }
  if (cmd === "npm" || cmd === "pnpm" || cmd === "yarn" || cmd === "bun") {
    const sub = rest[0] ?? "";
    if (sub === "test" || cmd === "npm" && (sub === "t" || sub === "tst")) {
      return { kind: "test", label: `${cmd} test` };
    }
    const named = sub === "run" || sub === "run-script" ? rest[1] ?? "" : cmd === "npm" || cmd === "bun" ? "" : sub;
    const kind = script(named);
    if (kind === null) return null;
    if (kind === "test") return { kind, label: `${cmd} test` };
    const label = cmd === "pnpm" || cmd === "yarn" ? `${cmd} ${SCRIPT_LABEL[kind]}` : `${cmd} run ${SCRIPT_LABEL[kind]}`;
    return { kind, label };
  }
  return null;
}
function recognizeAll(command) {
  const parts = segments(command);
  const out = [];
  parts.forEach((segment, index) => {
    const hit = recognizeOne(segment.tokens);
    if (hit === null) return;
    const last = index === parts.length - 1;
    out.push({ ...hit, masked: !last && segment.next !== "&&" });
  });
  return out;
}
var CODE_KEYS = ["exitCode", "exit_code", "returnCode", "return_code", "code", "status"];
function exitCodeOf(response) {
  if (response === null || typeof response !== "object") return null;
  const obj2 = response;
  for (const key of CODE_KEYS) {
    const value = obj2[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}
function textOf(response) {
  if (typeof response === "string") return response;
  if (response === null || typeof response !== "object") return "";
  const obj2 = response;
  const parts = [];
  for (const key of ["stdout", "stderr", "output", "content", "text"]) {
    const value = obj2[key];
    if (typeof value === "string") parts.push(value);
  }
  return parts.join("\n");
}
function summary(text) {
  const exit = /^Exit code (\d+)/m.exec(text);
  if (exit !== null) return Number(exit[1]) === 0;
  const nodeTest = /^#\s*fail\s+(\d+)/m.exec(text);
  if (nodeTest !== null) return Number(nodeTest[1]) === 0;
  if (/\bno tests ran\b/i.test(text)) return false;
  if (/^FAILED\b/m.test(text)) return false;
  if (/\berror TS\d+/.test(text)) return false;
  if (/\[ERROR\]|\bnpm ERR!/.test(text)) return false;
  const found = /\bFound\s+(\d+)\s+errors?\b/.exec(text);
  if (found !== null) return Number(found[1]) === 0;
  if (/\bSuccess: no issues found\b/i.test(text)) return true;
  const failed = /(\d+)\s+failed/i.exec(text);
  if (failed !== null && Number(failed[1]) > 0) return false;
  const passedCount = /(\d+)\s+passed/i.exec(text);
  if (passedCount !== null && Number(passedCount[1]) > 0) return true;
  if (failed !== null) return true;
  const errors = /(\d+)\s+errors?\b/i.exec(text);
  if (errors !== null) return Number(errors[1]) === 0;
  if (/^OK\b/m.test(text)) return true;
  if (/\bbuilt in\b|\bbuild (?:completed|succeeded)\b|\bcompiled successfully\b/i.test(text)) {
    return true;
  }
  return null;
}
function passed(response, masked = true) {
  if (response !== null && typeof response === "object") {
    const obj2 = response;
    if (obj2.interrupted === true) return false;
    if (obj2.is_error === true || obj2.isError === true) return false;
  }
  const code = exitCodeOf(response);
  if (code !== null) return code === 0;
  return summary(textOf(response)) ?? !masked;
}

// src/lib/tree.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync5, readFileSync as readFileSync5, statSync as statSync2 } from "node:fs";
import { join as join3 } from "node:path";
var DEPENDENCY_DIRS = /* @__PURE__ */ new Set(["node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache"]);
function paths(output) {
  if (output === null) return [];
  return output.split("\0").filter((p) => p.length > 0);
}
function changedPaths(root, baseline) {
  const found = /* @__PURE__ */ new Set();
  if (baseline !== null && baseline.length > 0) {
    for (const p of paths(git(root, ["diff", "--name-only", "--relative", "-z", baseline, "--"]))) found.add(p);
  }
  for (const p of paths(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))) found.add(p);
  return [...found].filter(
    (p) => !p.startsWith(".belay/") && !p.split("/").some((part) => DEPENDENCY_DIRS.has(part))
  );
}
function hashOf(root, path) {
  const full = join3(root, path);
  if (!existsSync5(full) || !statSync2(full).isFile()) return "missing";
  return createHash2("sha256").update(readFileSync5(full)).digest("hex");
}
function blobIds(root, files) {
  const present = files.filter((p) => existsSync5(join3(root, p)) && statSync2(join3(root, p)).isFile());
  if (present.length === 0) return {};
  const out = git(root, ["hash-object", "--", ...present]);
  if (out === null) return {};
  const ids = out.split("\n");
  const blobs = {};
  present.forEach((path, i) => {
    if (/^[0-9a-f]{40,64}$/.test(ids[i] ?? "")) blobs[path] = ids[i];
  });
  return blobs;
}
function changedSince(root, baseline, snap) {
  return changedPaths(root, baseline).filter((path) => snap[path] !== hashOf(root, path));
}

// src/lib/handlers.ts
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "node:fs";
import { isAbsolute, join as join4, relative } from "node:path";
var EDIT_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
function str(value) {
  return typeof value === "string" ? value : "";
}
function obj(value) {
  return value !== null && typeof value === "object" ? value : {};
}
function rootOf(input) {
  return findRepoRoot(projectDir(str(input.cwd)));
}
function context(event, additionalContext) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}
function settingsObject(path) {
  if (!existsSync6(path)) return null;
  try {
    const raw = JSON.parse(readFileSync6(path, "utf8"));
    return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}
function styleInEffect(root) {
  const sources = [
    [join4(root, ".claude", "settings.local.json"), ".claude/settings.local.json"],
    [join4(root, ".claude", "settings.json"), ".claude/settings.json"],
    [join4(homeRoot(), ".claude", "settings.json"), "~/.claude/settings.json"]
  ];
  for (const [path, from] of sources) {
    const style = settingsObject(path)?.outputStyle;
    if (typeof style === "string") return { style, from };
  }
  return { style: null, from: "" };
}
function styleWarning(root) {
  const { style, from } = styleInEffect(root);
  if (style === STYLE_SETTING) return null;
  if (style === null) {
    return `Nothing turns Belay's output style on in this repo, so the coaching contract is off. Tell the person, and offer to add "outputStyle": "${STYLE_SETTING}" to .claude/settings.json.`;
  }
  return `${from} sets outputStyle to ${style}, which overrides ${STYLE_SETTING}, so the coaching contract is off in this repo. Tell the person, and offer to change that line to ${STYLE_SETTING} or remove it.`;
}
function homeWarning() {
  if (!existsSync6(join4(homeBelayDir(), "map.json"))) return null;
  return `An earlier Belay version set itself up in the home directory by mistake: ~/.belay/map.json should not exist. Tell the person, and offer to remove ~/.belay/map.json, ~/.belay/state.json, and ~/.belay/logbook if they are there, the "outputStyle": "${STYLE_SETTING}" line in ~/.claude/settings.json, and the .belay/state.json line in ~/.gitignore. The config and the journal under ~/.belay stay.`;
}
function sessionStart(input) {
  const root = rootOf(input);
  const skillMap = read(root);
  const lines = [];
  if (skillMap === null) {
    lines.push("Belay is installed and this repo has no map. Offer /belay:learn to learn something, or /belay:team to set up a team map.");
  } else {
    const handle = readHandle(root);
    const { entries } = read2(root, handle);
    const counts = { unearned: 0, earned: 0, mastered: 0 };
    for (const skill of skillMap.skills) {
      counts[derive(entries, skill.id, skillMap).state] += 1;
    }
    lines.push(
      `Belay is active in this repo. The handle is ${handle}. Skills: ${counts.unearned} unearned, ${counts.earned} earned, ${counts.mastered} mastered. Call belay_begin_step before each step of work.`
    );
    const style = styleWarning(root);
    if (style !== null) lines.push(style);
  }
  const home = homeWarning();
  if (home !== null) lines.push(home);
  return context("SessionStart", lines.join("\n"));
}
function prompt(input) {
  const root = rootOf(input);
  if (read(root) === null) return null;
  const lines = update(root, (state) => {
    const out = [];
    const step = state.step;
    if (step === null) {
      out.push("belay: no step in progress");
    } else {
      const witnesses = step.witnesses.length === 0 ? "none" : step.witnesses.map((w) => `${w.kind} ${w.pass ? "pass" : "fail"}`).join(", ");
      out.push(`belay: step ${step.skill} \xB7 mode ${step.mode} \xB7 hints ${step.hints} \xB7 witnesses ${witnesses}`);
    }
    if (state.last !== null && state.last.shown !== true) {
      const last = state.last;
      const tail = last.state === void 0 ? "" : ` \xB7 ${last.state}`;
      out.push(`belay: last step ${last.skill} \xB7 ${last.result}${tail}`);
      last.shown = true;
    }
    return out;
  });
  return context("UserPromptSubmit", lines.join("\n"));
}
function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}
function gate(input) {
  const root = rootOf(input);
  const step = read3(root).step;
  if (step === null || step.mode !== "you") return null;
  const tool = str(input.tool_name);
  if (tool === "Bash") {
    const pattern = writePattern(str(obj(input.tool_input).command));
    if (pattern === null) return null;
    return deny(
      `${step.skill} is unearned. You write it. That command matches the write pattern ${pattern}. Want a hint?`
    );
  }
  if (EDIT_TOOLS.has(tool)) {
    return deny(`${step.skill} is unearned. You write it. Want a hint?`);
  }
  return null;
}
function filePathOf(toolInput) {
  for (const key of ["file_path", "notebook_path", "path"]) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}
function within(root, path) {
  if (!isAbsolute(path)) return path;
  const rel = relative(root, path);
  return rel.length > 0 && !rel.startsWith("..") ? rel : path;
}
function attribute(input) {
  const root = rootOf(input);
  const path = filePathOf(obj(input.tool_input));
  if (path.length === 0) return null;
  const rel = within(root, path);
  update(root, (state) => {
    const step = state.step;
    if (step !== null && !step.toolEdits.includes(rel)) step.toolEdits.push(rel);
  });
  return null;
}
function witness(input) {
  const root = rootOf(input);
  const command = str(obj(input.tool_input).command);
  if (command.length === 0) return null;
  const event = str(input.hook_event_name) === "PostToolUseFailure" ? "PostToolUseFailure" : "PostToolUse";
  const message = update(root, (state) => witnessStep(root, state, command, event, input));
  return message === null ? null : context(event, message);
}
function witnessStep(root, state, command, event, input) {
  const step = state.step;
  if (step === null) return null;
  if (writePattern(command) !== null) {
    for (const file of changedSince(root, step.baseline, step.snapshot)) {
      if (!step.toolEdits.includes(file)) step.toolEdits.push(file);
    }
  }
  const found = recognizeAll(command);
  if (found.length === 0) return null;
  const at = nowIso();
  const failed = event === "PostToolUseFailure";
  const records = found.map((w) => ({
    kind: w.kind,
    cmd: command,
    pass: !failed && passed(input.tool_response, w.masked),
    at
  }));
  step.witnesses.push(...records);
  const seen = found.map((w, i) => `${w.label} ${records[i].pass ? "pass" : "fail"}`).join(", ");
  if (step.mode !== "you") return null;
  if (!records.some((r) => r.pass)) return `witnessed: ${seen}`;
  if (step.toolEdits.length > 0) {
    return `witnessed: ${seen} \xB7 not unaided: Claude edited ${step.toolEdits.join(", ")}`;
  }
  const skillMap = read(root);
  const skill = skillMap === null ? null : findSkill(skillMap, step.skill);
  const accepted = skill === null ? ["test"] : skill.witness;
  const hit = records.find((r) => r.pass && accepted.includes(r.kind));
  const files = changedSince(root, step.baseline, step.snapshot);
  if (hit === void 0 || files.length === 0) return `witnessed: ${seen}`;
  step.pending = {
    witness: hit,
    commit: git(root, ["rev-parse", "HEAD"]),
    files,
    blobs: blobIds(root, files)
  };
  return `witnessed: ${seen} \xB7 ${step.skill}: read their diff, ask one question about it with belay_ask, then record the answer with belay_answer`;
}
function stop(input) {
  if (input.stop_hook_active === true) return null;
  const root = rootOf(input);
  const step = read3(root).step;
  if (step === null || step.question !== null) return null;
  const owed = step.mode === "review" && (step.toolEdits.length > 0 || changedSince(root, step.baseline, step.snapshot).length > 0) || step.mode === "you" && step.pending !== null;
  if (!owed) return null;
  return { decision: "block", reason: "Ask one question before ending. Call belay_ask, then ask it." };
}
var handlers = {
  "session-start": sessionStart,
  prompt,
  gate,
  attribute,
  witness,
  stop
};

// src/hooks.ts
async function readStdin() {
  if (process.stdin.isTTY === true) return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function oneLine(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0];
}
async function main() {
  const name = process.argv[2] ?? "";
  const handler = handlers[name];
  if (handler === void 0) {
    process.stderr.write(`belay: no hook named ${name}
`);
    return;
  }
  let input = {};
  try {
    const raw = await readStdin();
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") input = parsed;
    }
  } catch (error) {
    process.stderr.write(`belay ${name}: could not read the hook input: ${oneLine(error)}
`);
  }
  try {
    const output = handler(input);
    if (output !== null) process.stdout.write(JSON.stringify(output));
  } catch (error) {
    process.stderr.write(`belay ${name}: ${oneLine(error)}
`);
  }
}
await main().catch((error) => {
  process.stderr.write(`belay: ${oneLine(error)}
`);
});
process.exitCode = 0;
