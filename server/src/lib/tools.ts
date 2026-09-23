// The nine tools, as plain functions. index.ts registers them with the MCP
// server; the tests call them directly. Every one of them reads the map, the
// logbook, and the state fresh from disk, so nothing here holds a stale copy.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as journal from "./journal.js";
import * as logbook from "./logbook.js";
import * as map from "./map.js";
import * as maps from "./maps.js";
import * as stateFile from "./state.js";
import { STYLE_SETTING, belayDir, findRepoRoot, git, isHomeDir, mapPath, nowIso, projectDir, readHandle } from "./paths.js";
import { snapshot } from "./tree.js";

const HINT_KINDS = ["concept", "repo", "pseudocode"] as const;

interface Ctx {
  root: string;
  handle: string;
  map: map.SkillMap;
}

// The tests pass a cwd. The MCP server passes nothing, and the repo is found
// from where Claude Code started the session.
function rootFor(cwd?: string): string {
  return findRepoRoot(cwd ?? projectDir());
}

function context(cwd?: string): Ctx {
  const root = rootFor(cwd);
  if (isHomeDir(root)) throw new Error("Belay does not run in the home directory; open a project folder");
  const skillMap = map.read(root);
  if (skillMap === null) throw new Error("this repo has no .belay/map.json");
  return { root, handle: readHandle(root), map: skillMap };
}

function modeFor(state: logbook.SkillState): stateFile.Mode {
  if (state === "unearned") return "you";
  if (state === "earned") return "review";
  return "quiet";
}

function closeInto(state: stateFile.State, result: string, extra: Partial<stateFile.Last> = {}): void {
  const step = state.step;
  if (step === null) return;
  state.last = { skill: step.skill, mode: step.mode, result, at: nowIso(), ...extra };
  state.step = null;
}

export function belayMap(cwd?: string): unknown {
  const ctx = context(cwd);
  const { entries, malformed } = logbook.read(ctx.root, ctx.handle);
  const skills = ctx.map.skills.map((skill) => {
    const derived = logbook.derive(entries, skill.id, ctx.map);
    return {
      id: skill.id,
      name: skill.name,
      teaches: skill.teaches,
      witness: skill.witness,
      requires: skill.requires,
      precedents: skill.precedents,
      state: derived.state,
      runs: derived.runs,
      streak: derived.streak,
    };
  });
  return {
    version: ctx.map.version,
    threshold: ctx.map.threshold,
    mastery: ctx.map.mastery,
    handle: ctx.handle,
    skills,
    zones: ctx.map.zones,
    malformed,
  };
}

export function belayBeginStep(skill: string, goal: string, followUp?: boolean, cwd?: string): unknown {
  const ctx = context(cwd);
  if (map.findSkill(ctx.map, skill) === null) throw new Error(`no skill ${skill} in this repo's map`);
  return stateFile.update(ctx.root, (state) => beginStep(ctx, state, skill, goal, followUp));
}

function beginStep(ctx: Ctx, state: stateFile.State, skill: string, goal: string, followUp?: boolean): unknown {
  // A follow-up only makes sense straight after a step on the same skill. The
  // last closed step is the one this asks to carry on from.
  const asked = followUp === true;
  const isFollowUp = asked && state.last !== null && state.last.skill === skill;
  if (state.step !== null) closeInto(state, "ended");

  const before = logbook.read(ctx.root, ctx.handle);
  let derived = logbook.derive(before.entries, skill, ctx.map);
  let justEarned = false;
  if (derived.needsEarned) {
    logbook.append(ctx.root, ctx.handle, { kind: "earned", skill });
    justEarned = true;
    const after = logbook.read(ctx.root, ctx.handle);
    derived = logbook.derive(after.entries, skill, ctx.map);
  }

  const mode = modeFor(derived.state);
  state.step = {
    id: stateFile.newId(),
    skill,
    mode,
    goal,
    startedAt: nowIso(),
    baseline: git(ctx.root, ["rev-parse", "--short", "HEAD"]),
    snapshot: snapshot(ctx.root, git(ctx.root, ["rev-parse", "--short", "HEAD"])),
    followUp: isFollowUp,
    hints: 0,
    toolEdits: [],
    witnesses: [],
    pending: null,
    question: null,
  };

  const result: Record<string, unknown> = {
    mode,
    state: derived.state,
    runs: derived.runs,
    threshold: ctx.map.threshold,
    justEarned,
    followUp: isFollowUp,
  };
  if (asked && !isFollowUp) {
    result.note = `followUp was ignored: the last closed step was not on ${skill}, so this is a step of its own`;
  }
  return result;
}

export function belayHint(skill: string, text: string, cwd?: string): unknown {
  const ctx = context(cwd);
  return stateFile.update(ctx.root, (state) => hint(ctx, state, skill, text));
}

// The open step, checked against the skill Claude named, so a call meant for
// another skill fails plainly instead of landing on this one.
function openStep(state: stateFile.State, skill: string): stateFile.Step {
  const step = state.step;
  if (step === null) throw new Error("no step in progress");
  if (step.skill !== skill) throw new Error(`the open step is on ${step.skill}, not ${skill}`);
  return step;
}

function hint(ctx: Ctx, state: stateFile.State, skill: string, text: string): unknown {
  const step = openStep(state, skill);
  if (step.mode !== "you") throw new Error(`hints are only given on a you step, and ${step.skill} is a ${step.mode} step`);

  step.hints += 1;

  const rung = Math.min(step.hints, 4);
  journal.write(ctx.root, { kind: "hint", skill: step.skill, rung, note: text });

  if (rung === 4) return { rung: 4, of: 3, kind: "escalate" };
  const kind = HINT_KINDS[rung - 1];
  const result: Record<string, unknown> = { rung, of: 3, kind };
  if (rung === 2) {
    result.precedents = map.findSkill(ctx.map, step.skill)?.precedents ?? [];
  }
  return result;
}

export function belayAsk(skill: string, question: string, expected: string, cwd?: string): unknown {
  const ctx = context(cwd);
  return stateFile.update(ctx.root, (state) => ask(ctx, state, skill, question, expected));
}

function ask(ctx: Ctx, state: stateFile.State, skill: string, question: string, expected: string): unknown {
  const step = openStep(state, skill);
  if (step.mode === "you" && step.pending === null) {
    throw new Error("no witness is pending, so there is no unaided run to ask about yet");
  }

  step.question = { text: question, expected, askedAt: nowIso() };
  journal.write(ctx.root, { kind: "question", skill: step.skill, mode: step.mode, note: question, expected });
  return { ok: true, skill: step.skill, mode: step.mode };
}

export function belayAnswer(skill: string, correct: boolean, answer: string, cwd?: string): unknown {
  const ctx = context(cwd);
  return stateFile.update(ctx.root, (state) => recordAnswer(ctx, state, skill, correct, answer));
}

function recordAnswer(ctx: Ctx, state: stateFile.State, skill: string, correct: boolean, answer: string): unknown {
  const step = openStep(state, skill);
  const question = step.question;
  if (question === null) throw new Error("no question is stored, so call belay_ask first");

  journal.write(ctx.root, { kind: "answer", skill: step.skill, mode: step.mode, correct, note: answer });

  const written: string[] = [];

  // A follow-up fixes a flaw in the work that just closed. One task is one
  // run, so the answer is journaled and the step closes with nothing written.
  if (step.followUp) {
    const derived = logbook.derive(logbook.read(ctx.root, ctx.handle).entries, step.skill, ctx.map);
    closeInto(state, "follow-up answered", {
      state: derived.state,
      runs: derived.runs,
      threshold: ctx.map.threshold,
    });
    return {
      skill: step.skill,
      state: derived.state,
      runs: derived.runs,
      streak: derived.streak,
      threshold: ctx.map.threshold,
      mastery: ctx.map.mastery,
      followUp: true,
      recorded: null,
      wrote: written,
      stepOpen: false,
    };
  }

  if (step.mode === "you") {
    const pending = step.pending;
    if (pending === null) throw new Error("no witness is pending, so there is no unaided run to record");

    if (!correct) {
      // The step stays open. They revise, say done, and the next passing
      // witness starts the check over.
      step.pending = null;
      step.question = null;
      const still = logbook.derive(logbook.read(ctx.root, ctx.handle).entries, step.skill, ctx.map);
      return {
        skill: step.skill,
        state: still.state,
        runs: still.runs,
        streak: still.streak,
        threshold: ctx.map.threshold,
        recorded: null,
        wrote: written,
        stepOpen: true,
      };
    }

    logbook.append(ctx.root, ctx.handle, {
      kind: "unaided",
      skill: step.skill,
      hints: step.hints,
      witness: { kind: pending.witness.kind, cmd: pending.witness.cmd, pass: pending.witness.pass },
      commit: pending.commit,
      files: pending.files,
      question: question.text,
    });
    written.push("unaided");
  } else {
    logbook.append(ctx.root, ctx.handle, { kind: "review", skill: step.skill, correct });
    written.push("review");
  }

  const derived = logbook.derive(logbook.read(ctx.root, ctx.handle).entries, step.skill, ctx.map);
  if (derived.needsEarned) {
    logbook.append(ctx.root, ctx.handle, { kind: "earned", skill: step.skill });
    written.push("earned");
  }
  if (derived.needsMastered) {
    logbook.append(ctx.root, ctx.handle, { kind: "mastered", skill: step.skill });
    written.push("mastered");
  }
  if (derived.needsDemoted) {
    logbook.append(ctx.root, ctx.handle, { kind: "demoted", skill: step.skill });
    written.push("demoted");
  }

  const result = {
    skill: step.skill,
    state: derived.state,
    runs: derived.runs,
    streak: derived.streak,
    threshold: ctx.map.threshold,
    mastery: ctx.map.mastery,
    recorded: step.mode === "you" ? "unaided" : "review",
    wrote: written,
    stepOpen: false,
  };

  closeInto(state, `${result.recorded} recorded`, {
    state: derived.state,
    runs: derived.runs,
    threshold: ctx.map.threshold,
  });
  return result;
}

export function belayLogbook(skill?: string, limit?: number, cwd?: string): unknown {
  const root = rootFor(cwd);
  const handle = readHandle(root);
  const { entries, malformed } = logbook.read(root, handle);
  const picked = skill === undefined ? entries : entries.filter((e) => e.skill === skill);
  const newestFirst = [...picked].reverse();
  const capped = limit === undefined ? newestFirst : newestFirst.slice(0, limit);
  return { handle, malformed, count: capped.length, entries: capped };
}

export function belayEndStep(reason: string, cwd?: string): unknown {
  const root = rootFor(cwd);
  return stateFile.update(root, (state) => {
    if (state.step === null) return { ok: true, closed: false };
    const skill = state.step.skill;
    closeInto(state, "ended", { reason });
    return { ok: true, closed: true, skill };
  });
}

// The step file and its write-in-progress copies, then what each language
// installs into the project folder.
const IGNORE_LINES = [".belay/state.json", ".belay/*.tmp"];
const INSTALL_IGNORES: Record<string, string[]> = {
  typescript: ["node_modules/"],
  python: [".venv/", "__pycache__/", ".pytest_cache/", ".mypy_cache/"],
};

// The merged settings object, ready to write. Every other key survives, and a
// settings file that will not parse stops the whole of belay_init rather than
// being overwritten.
function mergedSettings(root: string): Record<string, unknown> {
  const path = join(root, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(".claude/settings.json is not valid JSON, so nothing was written");
    }
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      settings = raw as Record<string, unknown>;
    }
  }
  return { ...settings, outputStyle: STYLE_SETTING };
}

// Two spellings of one pattern, /node_modules and node_modules/, count as the
// same line.
function ignoreKey(line: string): string {
  return line.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

// True when a line had to be added. A file that does not end in a newline
// gets one first, so a line never lands on the end of somebody else's.
function ignoreLines(root: string, lines: string[]): boolean {
  const path = join(root, ".gitignore");
  const body = existsSync(path) ? readFileSync(path, "utf8") : "";
  const have = new Set(body.split("\n").map(ignoreKey));
  const missing = lines.filter((line) => !have.has(ignoreKey(line)));
  if (missing.length === 0) return false;
  const lead = body.length === 0 || body.endsWith("\n") ? "" : "\n";
  appendFileSync(path, `${lead}${missing.join("\n")}\n`, "utf8");
  return true;
}

// Belay reads the person's work from git, so a folder with no repo gets one.
// True when this call ran git init.
function ensureRepo(root: string): boolean {
  if (git(root, ["rev-parse", "--is-inside-work-tree"]) === "true") return false;
  if (git(root, ["init", "-q"]) === null) {
    throw new Error("git init failed here, and Belay needs git to see what changed; install git and run this again");
  }
  return true;
}

export function belayInit(name: string, precedents?: Record<string, string[]>, cwd?: string): unknown {
  const root = rootFor(cwd);
  if (isHomeDir(root)) {
    throw new Error("Belay sets up a project folder, not the home directory; make a folder for the project and start there");
  }
  const starter = maps.starter(name);
  if (starter === null) {
    throw new Error(`no starter map named ${name}; the maps are ${maps.names().join(" and ")}`);
  }
  if (existsSync(mapPath(root))) {
    throw new Error("this repo already has a .belay/map.json, so nothing was written");
  }

  const unknownPrecedents: string[] = [];
  if (precedents !== undefined) {
    for (const [id, files] of Object.entries(precedents)) {
      const skill = starter.skills.find((s) => s.id === id);
      if (skill === undefined) {
        unknownPrecedents.push(id);
        continue;
      }
      skill.precedents = (Array.isArray(files) ? files : []).filter((f) => typeof f === "string");
    }
  }

  // Read and merge before writing anything, so a settings file that will not
  // parse leaves the repo as it was.
  const settings = mergedSettings(root);
  const initialized = ensureRepo(root);

  const wrote: string[] = [];
  mkdirSync(belayDir(root), { recursive: true });
  writeFileSync(mapPath(root), `${JSON.stringify(starter, null, 2)}\n`, "utf8");
  wrote.push(".belay/map.json");

  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  wrote.push(".claude/settings.json");

  if (ignoreLines(root, [...IGNORE_LINES, ...(INSTALL_IGNORES[name] ?? [])])) wrote.push(".gitignore");

  return {
    map: name,
    skills: starter.skills.map((s) => s.id),
    outputStyle: STYLE_SETTING,
    wrote,
    gitInit: initialized,
    unknownPrecedents,
  };
}

export function belayCalibrate(skill: string, earned: boolean, note: string, cwd?: string): unknown {
  const ctx = context(cwd);
  if (map.findSkill(ctx.map, skill) === null) throw new Error(`no skill ${skill} in this repo's map`);

  const { entries } = logbook.read(ctx.root, ctx.handle);
  if (entries.some((entry) => entry.skill === skill)) {
    throw new Error(`${skill} already has logbook entries, so it is past calibrating`);
  }

  // The questions and the answers are the person's, so they stay private.
  journal.write(ctx.root, { kind: "calibration", skill, earned, note });

  const wrote: string[] = [];
  if (earned) {
    logbook.append(ctx.root, ctx.handle, { kind: "calibrated", skill, state: "earned" });
    wrote.push("calibrated");
  }

  const derived = logbook.derive(logbook.read(ctx.root, ctx.handle).entries, skill, ctx.map);
  return {
    skill,
    earned,
    state: derived.state,
    runs: derived.runs,
    threshold: ctx.map.threshold,
    wrote,
  };
}
