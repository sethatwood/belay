// The nine tools, and the tool sequence the design's acceptance test walks.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  belayAnswer,
  belayAsk,
  belayBeginStep,
  belayCalibrate,
  belayEndStep,
  belayHint,
  belayInit,
  belayLogbook,
  belayMap,
} from "../src/lib/tools.js";
import * as maps from "../src/lib/maps.js";
import { attribute, gate, prompt, stop, witness } from "../src/lib/handlers.js";
import { read as readState } from "../src/lib/state.js";
import { journalPath, logbookPath, nowIso } from "../src/lib/paths.js";
import { questionDigest } from "../src/lib/logbook.js";
import { VITEST_PASS, makeBare, makeRepo, rec, runGit, unaidedEntry, writeFile } from "./helpers.js";

function lines(root: string, handle: string): Record<string, unknown>[] {
  const path = logbookPath(root, handle);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test("belay_map reports each skill's state, runs, and streak, and counts malformed lines", () => {
  const f = makeRepo({ logbook: [unaidedEntry("add-route"), unaidedEntry("add-route"), "{ broken"] });
  try {
    const result = rec(belayMap(f.root));
    assert.equal(result.threshold, 3);
    assert.equal(result.mastery, 5);
    assert.equal(result.handle, f.handle);
    assert.equal(result.malformed, 1);
    const skills = result.skills as Record<string, unknown>[];
    const addRoute = skills.find((s) => s.id === "add-route");
    assert.equal(addRoute?.state, "unearned");
    assert.equal(addRoute?.runs, 2);
    assert.equal(addRoute?.streak, 0);
  } finally {
    f.cleanup();
  }
});

test("belay_map refuses plainly in a repo with no map", () => {
  const f = makeRepo();
  try {
    const elsewhere = join(f.base, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    assert.throws(() => belayMap(elsewhere), /no .belay\/map.json/);
  } finally {
    f.cleanup();
  }
});

test("belay_begin_step names an unknown skill instead of guessing", () => {
  const f = makeRepo();
  try {
    assert.throws(() => belayBeginStep("not-a-skill", "goal", false, f.root), /no skill not-a-skill/);
  } finally {
    f.cleanup();
  }
});

test("belay_begin_step picks the mode from the state and closes any open step", () => {
  const f = makeRepo({
    logbook: [
      { t: "x", kind: "calibrated", skill: "write-a-test", state: "earned" },
      { t: "x", kind: "earned", skill: "write-a-test" },
    ],
  });
  try {
    const first = rec(belayBeginStep("add-route", "add the webhook route", false, f.root));
    assert.equal(first.mode, "you");
    assert.equal(first.state, "unearned");
    assert.equal(first.justEarned, false);

    const second = rec(belayBeginStep("write-a-test", "cover the verifier", false, f.root));
    assert.equal(second.mode, "review");
    assert.equal(second.state, "earned");

    const state = readState(f.root);
    assert.equal(state.step?.skill, "write-a-test");
    assert.equal(state.last?.skill, "add-route");
    assert.equal(state.last?.result, "ended");
  } finally {
    f.cleanup();
  }
});

test("belay_begin_step writes the owed earned entry once and reports justEarned", () => {
  const f = makeRepo({ logbook: [unaidedEntry("add-route"), unaidedEntry("add-route"), unaidedEntry("add-route")] });
  try {
    const first = rec(belayBeginStep("add-route", "add the webhook route", false, f.root));
    assert.equal(first.justEarned, true);
    assert.equal(first.mode, "review");
    assert.equal(lines(f.root, f.handle).filter((e) => e.kind === "earned").length, 1);

    const second = rec(belayBeginStep("add-route", "again", false, f.root));
    assert.equal(second.justEarned, false);
    assert.equal(lines(f.root, f.handle).filter((e) => e.kind === "earned").length, 1);
  } finally {
    f.cleanup();
  }
});

test("belay_hint climbs the three rungs, hands back precedents on rung two, then escalates", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    assert.deepEqual(rec(belayHint("verify-webhook-signature", "think about the raw body", f.root)), {
      rung: 1,
      of: 3,
      kind: "concept",
    });
    const second = rec(belayHint("verify-webhook-signature", "look at charge.ts", f.root));
    assert.equal(second.rung, 2);
    assert.equal(second.kind, "repo");
    assert.deepEqual(second.precedents, ["src/billing/charge.ts", "src/lib/hmac.ts"]);

    assert.equal(rec(belayHint("verify-webhook-signature", "pseudocode", f.root)).kind, "pseudocode");
    assert.equal(rec(belayHint("verify-webhook-signature", "out of hints", f.root)).kind, "escalate");
    assert.equal(readState(f.root).step?.hints, 4);
  } finally {
    f.cleanup();
  }
});

test("belay_hint refuses on a review step and with no step at all", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    assert.throws(() => belayHint("add-route", "text", f.root), /no step in progress/);
    belayBeginStep("add-route", "write the route", false, f.root);
    assert.throws(() => belayHint("add-route", "text", f.root), /only given on a you step/);
  } finally {
    f.cleanup();
  }
});

test("belay_ask on a you step waits for a pending witness", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    assert.throws(() => belayAsk("verify-webhook-signature", "what?", "a compare", f.root), /no witness is pending/);
  } finally {
    f.cleanup();
  }
});

test("belay_answer needs a stored question", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    belayBeginStep("add-route", "write the route", false, f.root);
    assert.throws(() => belayAnswer("add-route", true, "because", f.root), /no question is stored/);
  } finally {
    f.cleanup();
  }
});

test("a wrong answer on a you step clears the pending witness and keeps the step open", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    belayAsk("verify-webhook-signature", "what is line 14?", "a constant-time compare", f.root);

    const result = rec(belayAnswer("verify-webhook-signature", false, "a string compare is fine", f.root));
    assert.equal(result.recorded, null);
    assert.equal(result.stepOpen, true);

    const state = readState(f.root);
    assert.notEqual(state.step, null);
    assert.equal(state.step?.pending, null);
    assert.equal(state.step?.question, null);
    assert.equal(lines(f.root, f.handle).length, 0);
  } finally {
    f.cleanup();
  }
});

test("a wrong review answer records the review, demotes the skill, and writes the demoted entry", () => {
  const f = makeRepo({
    logbook: [
      { t: "x", kind: "calibrated", skill: "add-route", state: "earned" },
      { t: "x", kind: "earned", skill: "add-route" },
    ],
  });
  try {
    belayBeginStep("add-route", "write the route", false, f.root);
    belayAsk("add-route", "why 409 here?", "the key already exists", f.root);
    const result = rec(belayAnswer("add-route", false, "no idea", f.root));
    assert.equal(result.state, "unearned");
    assert.equal(result.runs, 2);
    assert.deepEqual(result.wrote, ["review", "demoted"]);
    assert.deepEqual(
      lines(f.root, f.handle).map((e) => e.kind),
      ["calibrated", "earned", "review", "demoted"],
    );
  } finally {
    f.cleanup();
  }
});

test("the fifth correct review masters the skill and writes the mastered entry", () => {
  const seeded: Record<string, unknown>[] = [
    { t: "x", kind: "calibrated", skill: "add-route", state: "earned" },
    { t: "x", kind: "earned", skill: "add-route" },
  ];
  for (let i = 0; i < 4; i += 1) seeded.push({ t: "x", kind: "review", skill: "add-route", correct: true });
  const f = makeRepo({ logbook: seeded });
  try {
    belayBeginStep("add-route", "write the route", false, f.root);
    belayAsk("add-route", "why 409 here?", "the key already exists", f.root);
    const result = rec(belayAnswer("add-route", true, "the key already exists", f.root));
    assert.equal(result.state, "mastered");
    assert.deepEqual(result.wrote, ["review", "mastered"]);
    assert.equal(rec(belayBeginStep("add-route", "again", false, f.root)).mode, "quiet");
  } finally {
    f.cleanup();
  }
});

test("belay_logbook returns entries newest first and honours the filter and the limit", () => {
  const f = makeRepo({
    logbook: [
      { t: "2026-10-01T00:00:00Z", kind: "unaided", skill: "add-route" },
      { t: "2026-10-02T00:00:00Z", kind: "earned", skill: "add-route" },
      { t: "2026-10-03T00:00:00Z", kind: "review", skill: "write-a-test", correct: true },
    ],
  });
  try {
    const all = rec(belayLogbook(undefined, undefined, f.root));
    assert.deepEqual((all.entries as Record<string, unknown>[]).map((e) => e.kind), ["review", "earned", "unaided"]);

    const filtered = rec(belayLogbook("add-route", undefined, f.root));
    assert.equal(filtered.count, 2);

    const capped = rec(belayLogbook(undefined, 1, f.root));
    assert.equal(capped.count, 1);
    assert.equal((capped.entries as Record<string, unknown>[])[0].kind, "review");
  } finally {
    f.cleanup();
  }
});

test("belay_end_step closes the step and writes nothing to the logbook", () => {
  const f = makeRepo();
  try {
    assert.equal(rec(belayEndStep("nothing open", f.root)).closed, false);
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    const result = rec(belayEndStep("they changed task", f.root));
    assert.equal(result.closed, true);
    const state = readState(f.root);
    assert.equal(state.step, null);
    assert.equal(state.last?.reason, "they changed task");
    assert.equal(lines(f.root, f.handle).length, 0);
  } finally {
    f.cleanup();
  }
});

test("the acceptance sequence ends with unaided, earned, review, in that order", () => {
  const f = makeRepo({
    logbook: [unaidedEntry("add-route"), unaidedEntry("add-route"), unaidedEntry("add-route")],
  });
  try {
    // Step one: the skill is unearned, so the person writes it.
    const begun = rec(belayBeginStep("verify-webhook-signature", "reject any request whose signature does not match", false, f.root));
    assert.equal(begun.mode, "you");
    assert.equal(begun.state, "unearned");

    // Claude tries to edit and the gate denies it.
    const denied = rec(
      gate({
        cwd: f.root,
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: join(f.root, "src/webhooks/verify.ts"), old_string: "a", new_string: "b" },
      }),
    );
    const decision = rec(denied.hookSpecificOutput);
    assert.equal(decision.permissionDecision, "deny");
    assert.equal(
      decision.permissionDecisionReason,
      "verify-webhook-signature is unearned. You write it. Want a hint?",
    );

    // One hint, then the person writes the file in their own editor.
    assert.equal(rec(belayHint("verify-webhook-signature", "constant time, raw body", f.root)).rung, 1);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = (a: string, b: string) => a === b;\n");

    // The witness sees the tests pass over their diff and sets pending.
    const seen = rec(
      witness({
        cwd: f.root,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npx vitest run" },
        tool_response: VITEST_PASS,
      }),
    );
    assert.match(String(rec(seen.hookSpecificOutput).additionalContext), /^witnessed: vitest pass · verify-webhook-signature: read their diff/);
    const pending = readState(f.root).step?.pending;
    assert.deepEqual(pending?.files, ["src/webhooks/verify.ts"]);

    // Ending the turn before the question is blocked.
    assert.equal(rec(stop({ cwd: f.root, hook_event_name: "Stop", stop_hook_active: false })).decision, "block");
    belayAsk("verify-webhook-signature", "Line 1 is a plain string compare. What should it be?", "a constant-time compare", f.root);
    assert.equal(stop({ cwd: f.root, hook_event_name: "Stop", stop_hook_active: false }), null);

    const answered = rec(belayAnswer("verify-webhook-signature", true, "timingSafeEqual on the raw body", f.root));
    assert.equal(answered.recorded, "unaided");
    assert.equal(answered.runs, 1);

    // Step two: add-route derives to earned from the three seeded runs.
    const second = rec(belayBeginStep("add-route", "mount the webhook route", false, f.root));
    assert.equal(second.justEarned, true);
    assert.equal(second.mode, "review");

    // Claude writes the file and the attribute hook records it.
    writeFile(f.root, "src/routes/webhooks.ts", "export const route = () => 200;\n");
    attribute({
      cwd: f.root,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(f.root, "src/routes/webhooks.ts"), content: "" },
      tool_response: { filePath: join(f.root, "src/routes/webhooks.ts"), type: "create" },
    });
    assert.deepEqual(readState(f.root).step?.toolEdits, ["src/routes/webhooks.ts"]);

    assert.equal(rec(stop({ cwd: f.root, hook_event_name: "Stop", stop_hook_active: false })).decision, "block");
    belayAsk("add-route", "What does this return when the signature is wrong?", "401", f.root);
    const reviewed = rec(belayAnswer("add-route", true, "401, before any work", f.root));
    assert.equal(reviewed.recorded, "review");

    const written = lines(f.root, f.handle);
    const tail = written.slice(-3);
    assert.deepEqual(
      tail.map((e) => [e.kind, e.skill]),
      [
        ["unaided", "verify-webhook-signature"],
        ["earned", "add-route"],
        ["review", "add-route"],
      ],
    );
    // The logbook says what was witnessed, and keeps the struggle out.
    assert.equal(tail[0].hints, undefined);
    const asked = "Line 1 is a plain string compare. What should it be?";
    assert.equal(tail[0].question, questionDigest(asked));
    assert.ok(!JSON.stringify(tail[0]).includes("plain string compare"));
    assert.match(journalText(f.root), new RegExp(`"digest":"${questionDigest(asked)}"`));
    assert.deepEqual(tail[0].files, ["src/webhooks/verify.ts"]);
    // The run is bound to the exact content that passed, and to a full commit.
    assert.match(String(tail[0].commit), /^[0-9a-f]{40}$/);
    assert.deepEqual(tail[0].blobs, { "src/webhooks/verify.ts": runGit(f.root, ["hash-object", "src/webhooks/verify.ts"]) });
    assert.equal(tail[2].correct, true);
    assert.equal(readState(f.root).step, null);
  } finally {
    f.cleanup();
  }
});

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function skillsOf(written: Record<string, unknown>): Record<string, unknown>[] {
  return written.skills as Record<string, unknown>[];
}

function journalText(root: string): string {
  return readFileSync(journalPath(root, nowIso().slice(0, 10)), "utf8");
}

// One witnessed run on a you step, answered correctly, so the next step on the
// same skill is allowed to ask to be a follow-up.
function closeOneRun(root: string, skill: string, body: string): void {
  belayBeginStep(skill, "reject any request whose signature does not match", false, root);
  writeFile(root, "src/webhooks/verify.ts", body);
  witness({ cwd: root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
  belayAsk(skill, "Line 1 is a plain string compare. What should it be?", "a constant-time compare", root);
  belayAnswer(skill, true, "a constant-time compare", root);
}

test("a follow-up on the same skill is honored, and its answer writes nothing", () => {
  const f = makeRepo();
  try {
    closeOneRun(f.root, "verify-webhook-signature", "export const verify = (a: string, b: string) => a === b;\n");
    assert.equal(lines(f.root, f.handle).length, 1);

    const begun = rec(belayBeginStep("verify-webhook-signature", "fix the compare", true, f.root));
    assert.equal(begun.followUp, true);
    assert.equal(begun.note, undefined);
    assert.equal(readState(f.root).step?.followUp, true);

    // The witness still sets pending on a follow-up, so a question is owed.
    writeFile(f.root, "src/webhooks/verify.ts", "import { timingSafeEqual } from 'node:crypto';\n");
    witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    assert.notEqual(readState(f.root).step?.pending, null);
    assert.equal(rec(stop({ cwd: f.root, hook_event_name: "Stop", stop_hook_active: false })).decision, "block");

    belayAsk("verify-webhook-signature", "Why timingSafeEqual?", "it compares in constant time", f.root);
    const answered = rec(belayAnswer("verify-webhook-signature", true, "it does not leak where the bytes differ", f.root));
    assert.equal(answered.recorded, null);
    assert.deepEqual(answered.wrote, []);
    assert.equal(answered.followUp, true);
    assert.equal(answered.state, "unearned");
    assert.equal(answered.runs, 1);

    assert.equal(lines(f.root, f.handle).length, 1, "the follow-up wrote nothing");
    assert.match(journalText(f.root), /does not leak where the bytes differ/);
    const state = readState(f.root);
    assert.equal(state.step, null);
    assert.equal(state.last?.result, "follow-up answered");
  } finally {
    f.cleanup();
  }
});

test("a follow-up is still honored after the person's next message", () => {
  const f = makeRepo();
  try {
    closeOneRun(f.root, "verify-webhook-signature", "export const verify = (a: string, b: string) => a === b;\n");
    // Belay says "change it", the turn ends, and the person comes back with done.
    prompt({ cwd: f.root, hook_event_name: "UserPromptSubmit", prompt: "done" });
    const begun = rec(belayBeginStep("verify-webhook-signature", "fix the compare", true, f.root));
    assert.equal(begun.followUp, true);
    assert.equal(begun.note, undefined);
  } finally {
    f.cleanup();
  }
});

test("a wrong answer on a follow-up closes the step just the same", () => {
  const f = makeRepo();
  try {
    closeOneRun(f.root, "verify-webhook-signature", "export const verify = (a: string, b: string) => a === b;\n");
    belayBeginStep("verify-webhook-signature", "fix the compare", true, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => false;\n");
    witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    belayAsk("verify-webhook-signature", "Why timingSafeEqual?", "it compares in constant time", f.root);

    const answered = rec(belayAnswer("verify-webhook-signature", false, "no idea", f.root));
    assert.equal(answered.recorded, null);
    assert.deepEqual(answered.wrote, []);
    assert.equal(answered.stepOpen, false);
    assert.equal(lines(f.root, f.handle).length, 1);
    assert.equal(readState(f.root).step, null);
  } finally {
    f.cleanup();
  }
});

test("a follow-up on a different skill is ignored, and the response says so", () => {
  const f = makeRepo();
  try {
    closeOneRun(f.root, "verify-webhook-signature", "export const verify = (a: string, b: string) => a === b;\n");
    const begun = rec(belayBeginStep("add-route", "mount the webhook route", true, f.root));
    assert.equal(begun.followUp, false);
    assert.match(String(begun.note), /followUp was ignored/);
    assert.equal(readState(f.root).step?.followUp, false);
  } finally {
    f.cleanup();
  }
});

test("a follow-up with no closed step behind it is ignored", () => {
  const f = makeRepo();
  try {
    const begun = rec(belayBeginStep("verify-webhook-signature", "reject bad signatures", true, f.root));
    assert.equal(begun.followUp, false);
    assert.match(String(begun.note), /followUp was ignored/);
    assert.equal(readState(f.root).step?.followUp, false);
  } finally {
    f.cleanup();
  }
});

test("a step that does not ask to be a follow-up is not one, and says nothing about it", () => {
  const f = makeRepo();
  try {
    closeOneRun(f.root, "verify-webhook-signature", "export const verify = (a: string, b: string) => a === b;\n");
    const begun = rec(belayBeginStep("verify-webhook-signature", "again", false, f.root));
    assert.equal(begun.followUp, false);
    assert.equal(begun.note, undefined);
  } finally {
    f.cleanup();
  }
});

test("both starter maps are bundled, with the same ten skill ids and requires in the same order", () => {
  assert.deepEqual(maps.names(), ["typescript", "python"]);
  const ts = maps.starter("typescript");
  const py = maps.starter("python");
  assert.notEqual(ts, null);
  assert.notEqual(py, null);
  assert.equal(py?.skills.length, 10);
  assert.equal(py?.threshold, 3);
  assert.equal(py?.mastery, 5);
  assert.deepEqual(py?.zones, []);
  assert.deepEqual(py?.skills.map((s) => s.id), ts?.skills.map((s) => s.id));
  assert.deepEqual(py?.skills.map((s) => s.requires), ts?.skills.map((s) => s.requires));
  for (const skill of py?.skills ?? []) {
    assert.deepEqual(skill.precedents, []);
    assert.ok(skill.teaches.length > 0, `${skill.id} teaches nothing`);
  }
  assert.equal(maps.starter("ruby"), null);
});

test("each starter map comes back as a copy, so merging into one leaves the next alone", () => {
  const first = maps.starter("python");
  assert.notEqual(first, null);
  first?.skills[0].precedents.push("tests/test_verify.py");
  assert.deepEqual(maps.starter("python")?.skills[0].precedents, []);
});

test("belay_init sets a fresh directory up", () => {
  const f = makeBare();
  try {
    const result = rec(belayInit("python", undefined, f.root));
    assert.deepEqual(result.wrote, [".belay/map.json", ".claude/settings.json", ".gitignore"]);
    assert.deepEqual(result.unknownPrecedents, []);
    assert.equal(result.gitInit, true);
    assert.ok(existsSync(join(f.root, ".git")), "a folder with no repo gets one");

    const written = readJson(join(f.root, ".belay/map.json"));
    assert.equal(written.threshold, 3);
    assert.equal(written.mastery, 5);
    assert.equal(skillsOf(written).length, 10);
    assert.equal(skillsOf(written)[0].id, "write-a-test");

    assert.deepEqual(readJson(join(f.root, ".claude/settings.json")), { outputStyle: "belay:Belay" });
    assert.equal(
      readFileSync(join(f.root, ".gitignore"), "utf8"),
      ".belay/state.json\n.belay/*.tmp\n.venv/\n__pycache__/\n.pytest_cache/\n.mypy_cache/\n",
    );
  } finally {
    f.cleanup();
  }
});

test("belay_init keeps every other key in an existing settings file, indented with two spaces", () => {
  const f = makeBare();
  try {
    writeFile(
      f.root,
      ".claude/settings.json",
      `${JSON.stringify({ model: "opus", permissions: { allow: ["Bash(npm test)"] } }, null, 2)}\n`,
    );
    belayInit("typescript", undefined, f.root);
    const text = readFileSync(join(f.root, ".claude/settings.json"), "utf8");
    const settings = readJson(join(f.root, ".claude/settings.json"));
    assert.equal(settings.model, "opus");
    assert.deepEqual(settings.permissions, { allow: ["Bash(npm test)"] });
    assert.equal(settings.outputStyle, "belay:Belay");
    assert.match(text, /^\{\n  "model": "opus",\n/);
    assert.ok(text.endsWith("\n"));
  } finally {
    f.cleanup();
  }
});

test("belay_init appends the missing ignore lines, with the newline the file was missing", () => {
  const f = makeBare();
  try {
    writeFile(f.root, ".gitignore", "/node_modules");
    const result = rec(belayInit("typescript", undefined, f.root));
    assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), "/node_modules\n.belay/state.json\n.belay/*.tmp\n");
    assert.ok((result.wrote as string[]).includes(".gitignore"));
  } finally {
    f.cleanup();
  }
});

test("belay_init leaves a .gitignore that already ignores everything alone", () => {
  const f = makeBare();
  try {
    writeFile(f.root, ".gitignore", "node_modules/\n.belay/state.json\n.belay/*.tmp\n");
    const result = rec(belayInit("typescript", undefined, f.root));
    assert.equal(readFileSync(join(f.root, ".gitignore"), "utf8"), "node_modules/\n.belay/state.json\n.belay/*.tmp\n");
    assert.equal((result.wrote as string[]).includes(".gitignore"), false);
  } finally {
    f.cleanup();
  }
});

test("belay_init refuses to overwrite a map that is already there", () => {
  const f = makeBare();
  try {
    belayInit("typescript", undefined, f.root);
    assert.throws(() => belayInit("python", undefined, f.root), /already has a \.belay\/map\.json/);
    const written = readJson(join(f.root, ".belay/map.json"));
    assert.equal(String(skillsOf(written)[2].teaches).includes("FastAPI"), false);
  } finally {
    f.cleanup();
  }
});

test("belay_init merges precedents by skill id and names the ids it did not know", () => {
  const f = makeBare();
  try {
    const result = rec(
      belayInit("typescript", { "add-route": ["src/routes/health.ts"], "not-a-skill": ["src/x.ts"] }, f.root),
    );
    assert.deepEqual(result.unknownPrecedents, ["not-a-skill"]);
    const written = readJson(join(f.root, ".belay/map.json"));
    const addRoute = skillsOf(written).find((s) => s.id === "add-route");
    assert.deepEqual(addRoute?.precedents, ["src/routes/health.ts"]);
    const bundled = maps.starter("typescript")?.skills.find((s) => s.id === "add-route");
    assert.deepEqual(bundled?.precedents, [], "the bundled map is untouched");
  } finally {
    f.cleanup();
  }
});

test("belay_init names a starter map it does not ship", () => {
  const f = makeBare();
  try {
    assert.throws(() => belayInit("ruby", undefined, f.root), /no starter map named ruby/);
    assert.equal(existsSync(join(f.root, ".belay/map.json")), false);
  } finally {
    f.cleanup();
  }
});

test("belay_calibrate on a fresh skill writes the calibrated entry and journals the exchange", () => {
  const f = makeRepo();
  try {
    const result = rec(
      belayCalibrate("add-route", true, "asked what the handler should not do; they named the work below it", f.root),
    );
    assert.equal(result.state, "earned");
    assert.equal(result.runs, 3);
    assert.deepEqual(result.wrote, ["calibrated"]);

    const written = lines(f.root, f.handle);
    assert.equal(written.length, 1);
    assert.equal(written[0].kind, "calibrated");
    assert.equal(written[0].skill, "add-route");
    assert.equal(written[0].state, "earned");
    assert.match(journalText(f.root), /the work below it/);
    assert.equal(rec(belayBeginStep("add-route", "mount the route", false, f.root)).mode, "review");
  } finally {
    f.cleanup();
  }
});

test("belay_calibrate refuses a skill that already has an entry", () => {
  const f = makeRepo({ logbook: [unaidedEntry("add-route")] });
  try {
    assert.throws(() => belayCalibrate("add-route", true, "note", f.root), /past calibrating/);
    assert.equal(lines(f.root, f.handle).length, 1);
  } finally {
    f.cleanup();
  }
});

test("belay_calibrate with earned false journals the note and writes nothing", () => {
  const f = makeRepo();
  try {
    const result = rec(belayCalibrate("add-route", false, "they could not say what the handler calls", f.root));
    assert.equal(result.state, "unearned");
    assert.equal(result.runs, 0);
    assert.deepEqual(result.wrote, []);
    assert.equal(lines(f.root, f.handle).length, 0);
    assert.match(journalText(f.root), /could not say what the handler calls/);
  } finally {
    f.cleanup();
  }
});

test("belay_calibrate names a skill that is not in the map", () => {
  const f = makeRepo();
  try {
    assert.throws(() => belayCalibrate("not-a-skill", true, "note", f.root), /no skill not-a-skill/);
  } finally {
    f.cleanup();
  }
});

// A person who has used Belay once has ~/.belay. A new project folder under
// the home directory, with no repo yet, is where /belay:learn starts.
function homeWithProject(): { home: string; project: string; cleanup: () => void } {
  const f = makeBare();
  const home = process.env.BELAY_HOME as string;
  writeFile(home, ".belay/config.json", `${JSON.stringify({ handle: "sam" }, null, 2)}\n`);
  const project = join(home, "projects", "habit-tracker");
  mkdirSync(project, { recursive: true });
  return { home, project, cleanup: f.cleanup };
}

test("belay_init in a new folder under the home directory sets up the folder, never the home directory", () => {
  const h = homeWithProject();
  try {
    const result = rec(belayInit("python", undefined, h.project));
    assert.equal(result.gitInit, true);
    assert.ok(existsSync(join(h.project, ".belay/map.json")));
    assert.ok(existsSync(join(h.project, ".claude/settings.json")));
    assert.equal(existsSync(join(h.home, ".belay/map.json")), false);
    assert.equal(existsSync(join(h.home, ".claude/settings.json")), false);
    assert.equal(existsSync(join(h.home, ".gitignore")), false);
  } finally {
    h.cleanup();
  }
});

test("belay_init refuses the home directory itself, even when it is a git repo", () => {
  const h = homeWithProject();
  try {
    runGit(h.home, ["init", "-q"]);
    assert.throws(() => belayInit("typescript", undefined, h.home), /not the home directory/);
    assert.equal(existsSync(join(h.home, ".belay/map.json")), false);
    assert.equal(existsSync(join(h.home, ".claude/settings.json")), false);
  } finally {
    h.cleanup();
  }
});

test("a fresh folder set up by belay_init records a pending run on the first passing witness", () => {
  const h = homeWithProject();
  try {
    belayInit("python", undefined, h.project);
    belayBeginStep("write-a-test", "the first failing test", false, h.project);
    writeFile(h.project, "test_habits.py", "def test_streak():\n    assert True\n");
    witness({ cwd: h.project, tool_input: { command: "python -m pytest" }, tool_response: { stdout: "1 passed in 0.01s", stderr: "" } });
    assert.deepEqual(readState(h.project).step?.pending?.files, ["test_habits.py"]);
  } finally {
    h.cleanup();
  }
});

test("packages installed during a step never count as the person's files", () => {
  const f = makeRepo();
  try {
    writeFile(f.root, ".gitignore", ".belay/state.json\n");
    runGit(f.root, ["add", "-A"]);
    runGit(f.root, ["commit", "-q", "-m", "forget node_modules"]);
    belayBeginStep("write-a-test", "a first test", false, f.root);
    for (let i = 0; i < 40; i += 1) writeFile(f.root, `node_modules/pkg${i}/index.js`, "x");
    writeFile(f.root, ".venv/lib/site.py", "x");
    writeFile(f.root, "src/café notes.test.ts", "test('x', () => {})\n");
    witness({ cwd: f.root, tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    assert.deepEqual(readState(f.root).step?.pending?.files, ["src/café notes.test.ts"]);
  } finally {
    f.cleanup();
  }
});

test("hint, ask, and answer refuse a skill that is not the open step's", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    assert.throws(() => belayHint("add-route", "the raw body", f.root), /open step is on verify-webhook-signature, not add-route/);
    assert.throws(() => belayAsk("add-route", "q", "e", f.root), /not add-route/);
    assert.throws(() => belayAnswer("add-route", true, "a", f.root), /not add-route/);
    assert.equal(readState(f.root).step?.hints, 0, "nothing landed on the open step");
  } finally {
    f.cleanup();
  }
});

test("belay_init gives a folder inside a dotfiles repo in home a repo of its own", () => {
  const h = homeWithProject();
  try {
    runGit(h.home, ["init", "-q"]);
    const result = rec(belayInit("typescript", undefined, h.project));
    assert.equal(result.gitInit, true);
    assert.ok(existsSync(join(h.project, ".git")));
  } finally {
    h.cleanup();
  }
});

test("a Belay root below the top of its git repo names the person's files from the Belay root", () => {
  const f = makeRepo();
  try {
    // A team puts Belay in one package of a monorepo.
    const pkg = join(f.root, "packages", "billing");
    writeFile(pkg, ".belay/map.json", readFileSync(join(f.root, ".belay/map.json"), "utf8"));
    writeFile(pkg, "src/routes.ts", "export const routes = [];\n");
    runGit(f.root, ["add", "-A"]);
    runGit(f.root, ["commit", "-q", "-m", "billing package"]);
    belayBeginStep("add-route", "the summary route", false, pkg);
    writeFile(pkg, "src/routes.ts", "export const routes = ['summary'];\n");
    writeFile(pkg, "src/summary.ts", "export const summary = () => 0;\n");
    witness({ cwd: pkg, tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    assert.deepEqual(readState(pkg).step?.pending?.files.sort(), ["src/routes.ts", "src/summary.ts"]);
  } finally {
    f.cleanup();
  }
});
