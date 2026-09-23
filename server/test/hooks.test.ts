// The six hook handlers, each fed the hook event JSON Claude Code sends.

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attribute, gate, prompt, sessionStart, stop, witness } from "../src/lib/handlers.js";
import { belayAsk, belayBeginStep, belayEndStep } from "../src/lib/tools.js";
import { read as readState, write as writeState } from "../src/lib/state.js";
import { VITEST_FAIL, VITEST_PASS, makeRepo, rec, unaidedEntry, writeFile } from "./helpers.js";

const HOOKS_ENTRY = fileURLToPath(new URL("../src/hooks.ts", import.meta.url));

function ctx(output: Record<string, unknown> | null): Record<string, unknown> {
  assert.notEqual(output, null);
  return rec(rec(output).hookSpecificOutput);
}

test("session-start names the handle and counts the skills by state", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    const out = ctx(sessionStart({ cwd: f.root, hook_event_name: "SessionStart", source: "startup", session_id: "abc123" }));
    assert.equal(out.hookEventName, "SessionStart");
    const text = String(out.additionalContext);
    assert.match(text, /Belay is active in this repo\./);
    assert.match(text, /The handle is test-person\./);
    assert.match(text, /3 unearned, 1 earned, 0 mastered/);
    assert.match(text, /belay_begin_step/);
  } finally {
    f.cleanup();
  }
});

test("session-start in a repo with no map offers the two skills", () => {
  const f = makeRepo();
  try {
    const out = ctx(sessionStart({ cwd: f.home, hook_event_name: "SessionStart", source: "startup" }));
    assert.match(String(out.additionalContext), /no map.*\/belay:learn.*\/belay:team/s);
  } finally {
    f.cleanup();
  }
});

test("prompt reports no step, then the open step, then the last result once", () => {
  const f = makeRepo();
  try {
    const idle = ctx(prompt({ cwd: f.root, hook_event_name: "UserPromptSubmit", prompt: "add stripe webhooks" }));
    assert.equal(idle.hookEventName, "UserPromptSubmit");
    assert.equal(idle.additionalContext, "belay: no step in progress");

    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    const open = ctx(prompt({ cwd: f.root, hook_event_name: "UserPromptSubmit", prompt: "done" }));
    assert.equal(
      open.additionalContext,
      "belay: step verify-webhook-signature · mode you · hints 0 · witnesses none",
    );

    belayEndStep("changed task", f.root);
    const closed = ctx(prompt({ cwd: f.root, hook_event_name: "UserPromptSubmit", prompt: "next" }));
    assert.match(String(closed.additionalContext), /last step verify-webhook-signature · ended/);

    const after = ctx(prompt({ cwd: f.root, hook_event_name: "UserPromptSubmit", prompt: "next again" }));
    assert.equal(after.additionalContext, "belay: no step in progress");
  } finally {
    f.cleanup();
  }
});

test("the gate stays out of the way with no step and on review and quiet steps", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    const edit = { cwd: f.root, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/x.ts", content: "" } };
    assert.equal(gate(edit), null);
    belayBeginStep("add-route", "write the route", false, f.root);
    assert.equal(gate(edit), null);
    assert.equal(gate({ ...edit, tool_name: "Bash", tool_input: { command: "rm -rf dist" } }), null);
  } finally {
    f.cleanup();
  }
});

test("the gate denies every edit tool on a you step", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
      const out = ctx(gate({ cwd: f.root, hook_event_name: "PreToolUse", tool_name: tool, tool_input: { file_path: "src/x.ts" } }));
      assert.equal(out.permissionDecision, "deny");
      assert.equal(out.permissionDecisionReason, "verify-webhook-signature is unearned. You write it. Want a hint?");
    }
    assert.equal(gate({ cwd: f.root, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "src/x.ts" } }), null);
  } finally {
    f.cleanup();
  }
});

test("the gate denies a writing Bash command and names the pattern, and allows the rest", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    const out = ctx(
      gate({
        cwd: f.root,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat > src/webhooks/verify.ts", description: "write the verifier" },
      }),
    );
    assert.equal(out.permissionDecision, "deny");
    assert.equal(
      out.permissionDecisionReason,
      "verify-webhook-signature is unearned. You write it. That command matches the write pattern redirect. Want a hint?",
    );
    assert.equal(gate({ cwd: f.root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npx vitest run" } }), null);
  } finally {
    f.cleanup();
  }
});

test("attribute records a tool edit once, relative to the repo root", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    belayBeginStep("add-route", "write the route", false, f.root);
    const event = {
      cwd: f.root,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(f.root, "src/routes/webhooks.ts"), content: "x" },
      tool_response: { filePath: join(f.root, "src/routes/webhooks.ts"), type: "create" },
      duration_ms: 12,
    };
    assert.equal(attribute(event), null);
    attribute(event);
    assert.deepEqual(readState(f.root).step?.toolEdits, ["src/routes/webhooks.ts"]);
  } finally {
    f.cleanup();
  }
});

test("attribute does nothing when no step is open", () => {
  const f = makeRepo();
  try {
    attribute({ cwd: f.root, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "src/x.ts" } });
    assert.equal(readState(f.root).step, null);
  } finally {
    f.cleanup();
  }
});

test("the witness ignores a command that is not a witness", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    const out = witness({
      cwd: f.root,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status --porcelain" },
      tool_response: { stdout: "?? src/x.ts", stderr: "", interrupted: false, isImage: false },
    });
    assert.equal(out, null);
    assert.deepEqual(readState(f.root).step?.witnesses, []);
  } finally {
    f.cleanup();
  }
});

test("a failing witness is recorded and reported, and sets nothing pending", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => false;\n");
    const out = ctx(
      witness({
        cwd: f.root,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npx vitest run" },
        tool_response: VITEST_FAIL,
      }),
    );
    assert.equal(out.additionalContext, "witnessed: vitest fail");
    const step = readState(f.root).step;
    assert.equal(step?.pending, null);
    assert.equal(step?.witnesses.length, 1);
    assert.equal(step?.witnesses[0].pass, false);
  } finally {
    f.cleanup();
  }
});

test("a passing witness after a tool edit says the run is not unaided", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    const state = readState(f.root);
    if (state.step !== null) state.step.toolEdits = ["src/webhooks/verify.ts"];
    writeState(f.root, state);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");

    const out = ctx(
      witness({
        cwd: f.root,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npx vitest run" },
        tool_response: VITEST_PASS,
      }),
    );
    assert.equal(out.additionalContext, "witnessed: vitest pass · not unaided: Claude edited src/webhooks/verify.ts");
    assert.equal(readState(f.root).step?.pending, null);
  } finally {
    f.cleanup();
  }
});

test("a passing witness of a kind the skill does not accept sets nothing pending", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    const out = ctx(
      witness({
        cwd: f.root,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npx tsc --noEmit" },
        tool_response: { stdout: "Found 0 errors.", stderr: "", interrupted: false, isImage: false },
      }),
    );
    assert.equal(out.additionalContext, "witnessed: tsc pass");
    assert.equal(readState(f.root).step?.pending, null);
  } finally {
    f.cleanup();
  }
});

test("the witness records the run on a review step and says nothing to Claude", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    belayBeginStep("add-route", "write the route", false, f.root);
    const out = witness({
      cwd: f.root,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: VITEST_PASS,
    });
    assert.equal(out, null);
    assert.equal(readState(f.root).step?.witnesses.length, 1);
  } finally {
    f.cleanup();
  }
});

test("stop blocks until the question is stored, on both a you step and a review step", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  const event = { cwd: f.root, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "done" };
  try {
    assert.equal(stop(event), null);

    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    assert.equal(stop(event), null, "nothing witnessed yet, so nothing is owed");
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    const blocked = rec(stop(event));
    assert.equal(blocked.decision, "block");
    assert.equal(blocked.reason, "Ask one question before ending. Call belay_ask, then ask it.");
    belayAsk("verify-webhook-signature", "what is line 1?", "a constant-time compare", f.root);
    assert.equal(stop(event), null);

    belayEndStep("moving on", f.root);
    belayBeginStep("add-route", "write the route", false, f.root);
    assert.equal(stop(event), null, "nothing written yet, so nothing is owed");
    attribute({ cwd: f.root, tool_name: "Write", tool_input: { file_path: join(f.root, "src/routes/webhooks.ts") } });
    assert.equal(rec(stop(event)).decision, "block");
  } finally {
    f.cleanup();
  }
});

test("the entry point reads stdin, prints the handler's JSON, and exits 0", () => {
  const f = makeRepo({ logbook: [unaidedEntry("add-route")] });
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    const input = JSON.stringify({
      session_id: "abc123",
      cwd: f.root,
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: join(f.root, "src/webhooks/verify.ts"), old_string: "a", new_string: "b" },
      tool_use_id: "toolu_01ABC",
    });
    const out = execFileSync(process.execPath, ["--import", "tsx", HOOKS_ENTRY, "gate"], {
      input,
      encoding: "utf8",
      env: { ...process.env, BELAY_HOME: f.home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = rec(JSON.parse(out));
    assert.equal(rec(parsed.hookSpecificOutput).permissionDecision, "deny");
  } finally {
    f.cleanup();
  }
});

test("the entry point exits 0 and says nothing when the input is not JSON", () => {
  const f = makeRepo();
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", HOOKS_ENTRY, "stop"], {
      input: "not json at all",
      encoding: "utf8",
      env: { ...process.env, BELAY_HOME: f.home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.equal(out, "");
  } finally {
    f.cleanup();
  }
});

test("stop lets the turn end when Claude Code is already continuing after a stop hook", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    assert.equal(rec(stop({ cwd: f.root, hook_event_name: "Stop", stop_hook_active: false })).decision, "block");
    assert.equal(stop({ cwd: f.root, hook_event_name: "Stop", stop_hook_active: true }), null);
  } finally {
    f.cleanup();
  }
});

test("a Bash write command marks the changed files as Claude's", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    belayBeginStep("add-route", "write the route", false, f.root);
    writeFile(f.root, "src/routes/summary.ts", "export const summary = 1;\n");
    const out = witness({
      cwd: f.root,
      tool_name: "Bash",
      tool_input: { command: "cat > src/routes/summary.ts <<'EOF'\nexport const summary = 1;\nEOF" },
      tool_response: { stdout: "", stderr: "" },
    });
    assert.equal(out, null, "a write command is not a witness");
    const step = readState(f.root).step;
    assert.ok(step !== null);
    assert.deepEqual(step.toolEdits, ["src/routes/summary.ts"]);
  } finally {
    f.cleanup();
  }
});

test("a Bash write that slips past the gate on a you step spoils the unaided run", () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "tee src/webhooks/verify.ts" }, tool_response: { stdout: "" } });
    const out = rec(witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS }));
    const text = String(rec(out.hookSpecificOutput).additionalContext);
    assert.match(text, /not unaided: Claude edited src\/webhooks\/verify\.ts/);
    assert.equal(readState(f.root).step?.pending ?? null, null);
  } finally {
    f.cleanup();
  }
});

test("stop blocks on a review step when the tree changed, whatever tool wrote it", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    belayBeginStep("add-route", "write the route", false, f.root);
    const event = { cwd: f.root, hook_event_name: "Stop", stop_hook_active: false };
    assert.equal(stop(event), null);
    writeFile(f.root, "src/routes/summary.ts", "export const summary = 1;\n");
    assert.equal(rec(stop(event)).decision, "block");
  } finally {
    f.cleanup();
  }
});

test("work that was already in the tree before the step began is not the step's", () => {
  const f = makeRepo({ logbook: [{ t: "x", kind: "calibrated", skill: "add-route", state: "earned" }] });
  try {
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    belayBeginStep("add-route", "write the route", false, f.root);
    const event = { cwd: f.root, hook_event_name: "Stop", stop_hook_active: false };
    assert.equal(stop(event), null, "the earlier file predates the step");
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => false;\n");
    assert.equal(rec(stop(event)).decision, "block", "a change to it during the step counts");
  } finally {
    f.cleanup();
  }
});

test("a you step's unaided files are only what changed during the step", () => {
  const f = makeRepo();
  try {
    writeFile(f.root, "notes.md", "earlier\n");
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    witness({ cwd: f.root, tool_name: "Bash", tool_input: { command: "npx vitest run" }, tool_response: VITEST_PASS });
    assert.deepEqual(readState(f.root).step?.pending?.files, ["src/webhooks/verify.ts"]);
  } finally {
    f.cleanup();
  }
});

// Claude Code runs the hooks for parallel tool calls at the same time. Each
// one reads the state, changes it, and writes it back, so without the lock the
// last writer wins and the other witnesses are lost.
function runHook(name: string, input: unknown, home: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", HOOKS_ENTRY, name], {
      env: { ...process.env, BELAY_HOME: home },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("close", () => resolvePromise());
    child.stdin.end(JSON.stringify(input));
  });
}

test("witnesses from parallel tool calls all stick, and the pending run survives", async () => {
  const f = makeRepo();
  try {
    belayBeginStep("verify-webhook-signature", "reject bad signatures", false, f.root);
    writeFile(f.root, "src/webhooks/verify.ts", "export const verify = () => true;\n");
    const commands = ["npx vitest run", "npx tsc --noEmit", "npm run build", "npx jest", "mypy .", "pyright"];
    await Promise.all(
      commands.map((command) =>
        runHook(
          "witness",
          { cwd: f.root, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, tool_response: VITEST_PASS },
          f.home,
        ),
      ),
    );
    const step = readState(f.root).step;
    assert.equal(step?.witnesses.length, commands.length);
    assert.notEqual(step?.pending, null);
  } finally {
    f.cleanup();
  }
});
