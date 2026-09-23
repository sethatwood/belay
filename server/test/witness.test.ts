// Command recognition and pass detection for the witness hook.

import assert from "node:assert/strict";
import test from "node:test";
import { parseSummary, passed, recognize, recognizeAll, summary } from "../src/lib/witness.js";
import { VITEST_FAIL, VITEST_PASS } from "./helpers.js";

const WITNESSES: [string, string, string][] = [
  ["npx vitest run", "test", "vitest"],
  ["vitest", "test", "vitest"],
  ["npx jest --ci", "test", "jest"],
  ["node --test", "test", "node --test"],
  ["node --test --import tsx test/", "test", "node --test"],
  ["npm test", "test", "npm test"],
  ["npm run test", "test", "npm test"],
  ["pnpm test", "test", "pnpm test"],
  ["bun test", "test", "bun test"],
  ["pytest", "test", "pytest"],
  ["pytest -q tests/test_verify.py", "test", "pytest"],
  ["python -m pytest", "test", "python -m pytest"],
  ["python3 -m pytest -q", "test", "python3 -m pytest"],
  ["python -m unittest discover", "test", "python -m unittest"],
  ["python3 -m unittest", "test", "python3 -m unittest"],
  ["uv run pytest", "test", "pytest"],
  ["poetry run pytest -q", "test", "pytest"],
  ["python3.12 -m pytest", "test", "python3 -m pytest"],
  ["pnpm exec vitest run", "test", "vitest"],
  ["yarn test", "test", "yarn test"],
  ["npm run test:unit", "test", "npm test"],
  ["cd server && npm test", "test", "npm test"],
  ["env CI=1 npx vitest run", "test", "vitest"],
  ["npm run typecheck", "types", "npm run typecheck"],
  ["pnpm typecheck", "types", "pnpm typecheck"],
  ["mypy src", "types", "mypy"],
  ["uv run mypy .", "types", "mypy"],
  ["pyright", "types", "pyright"],
  ["npx pyright src", "types", "pyright"],
  ["npx tsc --noEmit", "types", "tsc"],
  ["tsc -p tsconfig.json", "types", "tsc"],
  ["npm run build", "build", "npm run build"],
  ["pnpm build", "build", "pnpm build"],
  ["pnpm run build", "build", "pnpm build"],
  ["bun run build", "build", "bun run build"],
  ["npx vite build", "build", "vite build"],
  ["next build", "build", "next build"],
  ["esbuild src/index.ts --bundle", "build", "esbuild"],
];

for (const [command, kind, label] of WITNESSES) {
  test(`recognizes ${command} as a ${kind} witness`, () => {
    const r = recognize(command);
    assert.notEqual(r, null, `${command} should be a witness`);
    assert.equal(r?.kind, kind);
    assert.equal(r?.label, label);
  });
}

const NOT_WITNESSES = [
  "git status",
  "git diff",
  "ls -la src",
  "cat package.json",
  "grep -rn signature src",
  "find . -name '*.ts'",
  "npm install zod",
  "echo done",
  "npx prettier --write .",
  "cd server",
  "echo 'vitest: 12 passed'",
  "cat vitest.config.ts",
  "cat pytest.ini",
  "grep pytest requirements.txt",
  "pip install pytest",
  "npm ls jest",
  "ls node_modules/.bin/tsc",
  "npm run lint",
];

for (const command of NOT_WITNESSES) {
  test(`does not treat ${command} as a witness`, () => {
    assert.equal(recognize(command), null);
  });
}

test("an exit code in the tool response decides the pass", () => {
  assert.equal(passed({ exitCode: 0, stdout: "" }), true);
  assert.equal(passed({ exitCode: 1, stdout: "" }), false);
  assert.equal(passed({ exit_code: 0 }), true);
});

test("an interrupted command is a fail whatever it printed", () => {
  assert.equal(passed({ ...VITEST_PASS, interrupted: true }), false);
});

test("a vitest summary line decides the pass when there is no exit code", () => {
  assert.equal(passed(VITEST_PASS), true);
  assert.equal(passed(VITEST_FAIL), false);
});

test("node --test, jest, and tsc summaries all parse", () => {
  assert.equal(parseSummary("# pass 12\n# fail 0\n"), true);
  assert.equal(parseSummary("# pass 11\n# fail 1\n"), false);
  assert.equal(parseSummary("Tests:       12 passed, 12 total"), true);
  assert.equal(parseSummary("Tests:       1 failed, 11 passed, 12 total"), false);
  assert.equal(parseSummary("src/x.ts(14,3): error TS2345: no."), false);
  assert.equal(parseSummary("Found 0 errors."), true);
});

test("a pytest summary line decides the pass, and a run with no tests is a fail", () => {
  assert.equal(parseSummary("======== 12 passed in 0.31s ========"), true);
  assert.equal(parseSummary("==== 1 failed, 11 passed in 0.12s ===="), false);
  assert.equal(parseSummary("=========== no tests ran in 0.01s ==========="), false);
  assert.equal(
    parseSummary("FAILED tests/test_verify.py::test_bad - assert False\n1 failed, 11 passed in 0.2s"),
    false,
  );
});

test("unittest says OK or FAILED, and both parse", () => {
  assert.equal(parseSummary("....\n----\nRan 4 tests in 0.001s\n\nOK\n"), true);
  assert.equal(parseSummary("Ran 4 tests in 0.002s\n\nOK (skipped=1)\n"), true);
  assert.equal(parseSummary("Ran 4 tests in 0.002s\n\nFAILED (failures=1)\n"), false);
  assert.equal(parseSummary("Ran 4 tests in 0.002s\n\nFAILED (errors=2)\n"), false);
});

test("mypy and pyright summaries parse, whichever way they count", () => {
  assert.equal(parseSummary("Success: no issues found in 3 source files"), true);
  assert.equal(parseSummary("src/x.py:14: error: Incompatible types\nFound 1 error in 1 file (checked 3 source files)"), false);
  assert.equal(parseSummary("Found 3 errors in 2 files (checked 5 source files)"), false);
  assert.equal(parseSummary("0 errors, 0 warnings, 0 informations "), true);
  assert.equal(parseSummary("3 errors, 1 warning, 0 informations "), false);
});

test("a build that says it finished passes, and silence counts as a fail", () => {
  assert.equal(parseSummary("dist/index.js  1.2mb\n\nbuilt in 41ms"), true);
  assert.equal(parseSummary(""), false);
  assert.equal(passed({ stdout: "", stderr: "" }), false);
});

test("every witness in a line is found, in order, and a pipe or ; after one masks its exit code", () => {
  const both = recognizeAll("npx tsc --noEmit && npx vitest run");
  assert.deepEqual(both.map((w) => [w.label, w.masked]), [["tsc", false], ["vitest", false]]);
  assert.equal(recognize("npx vitest run | tail -5")?.masked, true);
  assert.equal(recognize("npx vitest run 2>&1 | tail -5")?.masked, true);
  assert.equal(recognize("npx vitest run || true")?.masked, true);
  assert.equal(recognize("npx vitest run; echo done")?.masked, true);
  assert.equal(recognize("cd app && npx vitest run")?.masked, false);
  assert.equal(recognize("npx vitest run")?.masked, false);
});

test("PostToolUse means exit 0, so a silent witness passes unless something hid its exit code", () => {
  assert.equal(passed({ stdout: "", stderr: "" }, false), true, "a clean tsc prints nothing");
  assert.equal(passed({ stdout: "\n  dist/index.js  812.4kb\n\n\u26a1 Done in 41ms\n", stderr: "" }, false), true);
  assert.equal(passed({ stdout: "", stderr: "" }, true), false, "masked silence proves nothing");
  assert.equal(passed(VITEST_FAIL, false), false, "output that says it failed wins");
  assert.equal(passed({ stdout: "\u2718 [ERROR] Could not resolve \"./verify\"", stderr: "" }, false), false);
});

test("the summary says pass, fail, or nothing", () => {
  assert.equal(summary(""), null);
  assert.equal(summary("Exit code 1\nError: Cannot find module 'express'"), false);
  assert.equal(summary("Tests  12 passed (12)"), true);
});
