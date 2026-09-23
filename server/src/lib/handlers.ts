// The six hook handlers. Each one takes the hook event JSON that Claude Code
// wrote to stdin and returns the JSON to print, or null when the hook has
// nothing to say. None of them ever blocks by exiting non-zero.

import * as logbook from "./logbook.js";
import * as map from "./map.js";
import * as stateFile from "./state.js";
import { STYLE_SETTING, findRepoRoot, git, homeBelayDir, homeRoot, nowIso, projectDir, readHandle } from "./paths.js";
import { passed, recognizeAll } from "./witness.js";
import { changedSince } from "./tree.js";
import { writePattern } from "./writes.js";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export type HookInput = Record<string, unknown>;
export type HookOutput = Record<string, unknown> | null;
export type Handler = (input: HookInput) => HookOutput;

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function rootOf(input: HookInput): string {
  return findRepoRoot(projectDir(str(input.cwd)));
}

function context(event: string, additionalContext: string): HookOutput {
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

function settingsObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The output style in effect, and the file it comes from. Claude Code reads
// the local settings first, then the project's, then the person's own, so a
// /output-style run once in this repo quietly outranks the committed setting.
function styleInEffect(root: string): { style: string | null; from: string } {
  const sources: [string, string][] = [
    [join(root, ".claude", "settings.local.json"), ".claude/settings.local.json"],
    [join(root, ".claude", "settings.json"), ".claude/settings.json"],
    [join(homeRoot(), ".claude", "settings.json"), "~/.claude/settings.json"],
  ];
  for (const [path, from] of sources) {
    const style = settingsObject(path)?.outputStyle;
    if (typeof style === "string") return { style, from };
  }
  return { style: null, from: "" };
}

function styleWarning(root: string): string | null {
  const { style, from } = styleInEffect(root);
  if (style === STYLE_SETTING) return null;
  if (style === null) {
    return `Nothing turns Belay's output style on in this repo, so the coaching contract is off. Tell the person, and offer to add "outputStyle": "${STYLE_SETTING}" to .claude/settings.json.`;
  }
  return `${from} sets outputStyle to ${style}, which overrides ${STYLE_SETTING}, so the coaching contract is off in this repo. Tell the person, and offer to change that line to ${STYLE_SETTING} or remove it.`;
}

// Belay 0.1.0 could mistake the home directory for a repo and set itself up
// there. Nothing belongs in ~/.belay but the config and the journal.
function homeWarning(): string | null {
  if (!existsSync(join(homeBelayDir(), "map.json"))) return null;
  return `An earlier Belay version set itself up in the home directory by mistake: ~/.belay/map.json should not exist. Tell the person, and offer to remove ~/.belay/map.json, ~/.belay/state.json, and ~/.belay/logbook if they are there, the "outputStyle": "${STYLE_SETTING}" line in ~/.claude/settings.json, and the .belay/state.json line in ~/.gitignore. The config and the journal under ~/.belay stay.`;
}

export function sessionStart(input: HookInput): HookOutput {
  const root = rootOf(input);
  const skillMap = map.read(root);
  const lines: string[] = [];
  if (skillMap === null) {
    lines.push("Belay is installed and this repo has no map. Offer /belay:learn to learn something, or /belay:team to set up a team map.");
  } else {
    const handle = readHandle(root);
    const { entries } = logbook.read(root, handle);
    const counts = { unearned: 0, earned: 0, mastered: 0 };
    for (const skill of skillMap.skills) {
      counts[logbook.derive(entries, skill.id, skillMap).state] += 1;
    }
    lines.push(
      `Belay is active in this repo. The handle is ${handle}. Skills: ${counts.unearned} unearned, ${counts.earned} earned, ${counts.mastered} mastered. Call belay_begin_step before each step of work.`,
    );
    const style = styleWarning(root);
    if (style !== null) lines.push(style);
  }
  const home = homeWarning();
  if (home !== null) lines.push(home);
  return context("SessionStart", lines.join("\n"));
}

export function prompt(input: HookInput): HookOutput {
  const root = rootOf(input);
  const lines = stateFile.update(root, (state) => {
    const out: string[] = [];
    const step = state.step;
    if (step === null) {
      out.push("belay: no step in progress");
    } else {
      const witnesses =
        step.witnesses.length === 0
          ? "none"
          : step.witnesses.map((w) => `${w.kind} ${w.pass ? "pass" : "fail"}`).join(", ");
      out.push(`belay: step ${step.skill} · mode ${step.mode} · hints ${step.hints} · witnesses ${witnesses}`);
    }
    if (state.last !== null && state.last.shown !== true) {
      const last = state.last;
      const tail = last.state === undefined ? "" : ` · ${last.state}`;
      out.push(`belay: last step ${last.skill} · ${last.result}${tail}`);
      last.shown = true;
    }
    return out;
  });
  return context("UserPromptSubmit", lines.join("\n"));
}

function deny(reason: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function gate(input: HookInput): HookOutput {
  const root = rootOf(input);
  const step = stateFile.read(root).step;
  if (step === null || step.mode !== "you") return null;

  const tool = str(input.tool_name);
  if (tool === "Bash") {
    const pattern = writePattern(str(obj(input.tool_input).command));
    if (pattern === null) return null;
    return deny(
      `${step.skill} is unearned. You write it. That command matches the write pattern ${pattern}. Want a hint?`,
    );
  }
  if (EDIT_TOOLS.has(tool)) {
    return deny(`${step.skill} is unearned. You write it. Want a hint?`);
  }
  return null;
}

function filePathOf(toolInput: Record<string, unknown>): string {
  for (const key of ["file_path", "notebook_path", "path"]) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

// Paths read better relative to the repo root, which is how the witness hook
// names them back to Claude.
function within(root: string, path: string): string {
  if (!isAbsolute(path)) return path;
  const rel = relative(root, path);
  return rel.length > 0 && !rel.startsWith("..") ? rel : path;
}

export function attribute(input: HookInput): HookOutput {
  const root = rootOf(input);
  const path = filePathOf(obj(input.tool_input));
  if (path.length === 0) return null;
  const rel = within(root, path);
  stateFile.update(root, (state) => {
    const step = state.step;
    if (step !== null && !step.toolEdits.includes(rel)) step.toolEdits.push(rel);
  });
  return null;
}

// Runs on PostToolUse for Bash, when the command exited 0, and on
// PostToolUseFailure, when it did not. The event is the first word on whether
// a witness passed; the output only matters when a pipe hides the exit code.
export function witness(input: HookInput): HookOutput {
  const root = rootOf(input);
  const command = str(obj(input.tool_input).command);
  if (command.length === 0) return null;
  const event = str(input.hook_event_name) === "PostToolUseFailure" ? "PostToolUseFailure" : "PostToolUse";
  const message = stateFile.update(root, (state) => witnessStep(root, state, command, event, input));
  return message === null ? null : context(event, message);
}

function witnessStep(root: string, state: stateFile.State, command: string, event: string, input: HookInput): string | null {
  const step = state.step;
  if (step === null) return null;

  // A command that writes ran through a tool call, so whatever changed in the
  // tree is Claude's. On a you step the gate stops these first; this catches
  // the ones it misses, and on a review step it is how Belay's own edits are
  // recorded when they arrive through the shell instead of an edit tool.
  if (writePattern(command) !== null) {
    for (const file of changedSince(root, step.baseline, step.snapshot)) {
      if (!step.toolEdits.includes(file)) step.toolEdits.push(file);
    }
  }

  const found = recognizeAll(command);
  if (found.length === 0) return null;

  const at = nowIso();
  const failed = event === "PostToolUseFailure";
  const records: stateFile.Witness[] = found.map((w) => ({
    kind: w.kind,
    cmd: command,
    pass: !failed && passed(input.tool_response, w.masked),
    at,
  }));
  step.witnesses.push(...records);
  const seen = found.map((w, i) => `${w.label} ${records[i].pass ? "pass" : "fail"}`).join(", ");

  if (step.mode !== "you") return null;
  if (!records.some((r) => r.pass)) return `witnessed: ${seen}`;
  if (step.toolEdits.length > 0) {
    return `witnessed: ${seen} · not unaided: Claude edited ${step.toolEdits.join(", ")}`;
  }
  const skillMap = map.read(root);
  const skill = skillMap === null ? null : map.findSkill(skillMap, step.skill);
  const accepted = skill === null ? ["test"] : skill.witness;
  const hit = records.find((r) => r.pass && accepted.includes(r.kind));
  const files = changedSince(root, step.baseline, step.snapshot);
  if (hit === undefined || files.length === 0) return `witnessed: ${seen}`;
  step.pending = {
    witness: hit,
    commit: git(root, ["rev-parse", "--short", "HEAD"]),
    files,
  };
  return `witnessed: ${seen} · ${step.skill}: read their diff, ask one question about it with belay_ask, then record the answer with belay_answer`;
}

export function stop(input: HookInput): HookOutput {
  // Claude Code sets this when it is already continuing because a stop hook
  // blocked once. Blocking again would loop, so the second stop goes through.
  if (input.stop_hook_active === true) return null;
  const root = rootOf(input);
  const step = stateFile.read(root).step;
  if (step === null || step.question !== null) return null;
  // On a review step the tree itself says whether Belay wrote something,
  // whichever tool carried the write.
  const owed =
    (step.mode === "review" && (step.toolEdits.length > 0 || changedSince(root, step.baseline, step.snapshot).length > 0)) ||
    (step.mode === "you" && step.pending !== null);
  if (!owed) return null;
  return { decision: "block", reason: "Ask one question before ending. Call belay_ask, then ask it." };
}

export const handlers: Record<string, Handler> = {
  "session-start": sessionStart,
  prompt,
  gate,
  attribute,
  witness,
  stop,
};
