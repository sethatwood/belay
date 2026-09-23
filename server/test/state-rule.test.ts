// The skill state rule, one test per numbered step in the design.

import assert from "node:assert/strict";
import test from "node:test";
import { append, derive, questionDigest, read, type Entry } from "../src/lib/logbook.js";
import { makeRepo, testMap, unaidedEntry } from "./helpers.js";

const map = testMap();
const SKILL = "add-route";

function replay(entries: Record<string, unknown>[]): ReturnType<typeof derive> {
  return derive(entries as Entry[], SKILL, map);
}

test("rule 1: a skill with no entries starts unearned with no runs and no streak", () => {
  const d = replay([]);
  assert.equal(d.state, "unearned");
  assert.equal(d.runs, 0);
  assert.equal(d.streak, 0);
  assert.equal(d.needsEarned, false);
  assert.equal(d.needsDemoted, false);
});

test("rule 2: a witnessed unaided run with a question counts, and three earn the skill", () => {
  assert.equal(replay([unaidedEntry(SKILL)]).runs, 1);
  const two = replay([unaidedEntry(SKILL), unaidedEntry(SKILL)]);
  assert.equal(two.state, "unearned");
  assert.equal(two.runs, 2);

  const three = replay([unaidedEntry(SKILL), unaidedEntry(SKILL), unaidedEntry(SKILL)]);
  assert.equal(three.state, "earned");
  assert.equal(three.runs, 3);
  assert.equal(three.needsEarned, true);
});

test("rule 2: a run holding the question's digest counts the same as one holding its text", () => {
  const older = unaidedEntry("add-route", { hints: 2 }) as unknown as Entry;
  const newer = { ...unaidedEntry("add-route"), question: questionDigest("What should it return?") } as unknown as Entry;
  delete (newer as Record<string, unknown>).hints;
  const d = derive([older, newer, newer], "add-route", testMap());
  assert.equal(d.state, "earned");
  assert.equal(d.runs, 3);
});

test("rule 2: the earned entry is owed only until it is written", () => {
  const entries = [unaidedEntry(SKILL), unaidedEntry(SKILL), unaidedEntry(SKILL), { t: "x", kind: "earned", skill: SKILL }];
  const d = replay(entries);
  assert.equal(d.state, "earned");
  assert.equal(d.needsEarned, false);
});

test("rule 2: a failing witness, an unaccepted kind, and a missing question all fail to count", () => {
  assert.equal(replay([unaidedEntry(SKILL, { pass: false })]).runs, 0);
  assert.equal(replay([unaidedEntry(SKILL, { kind: "build" })]).runs, 0);
  assert.equal(replay([unaidedEntry(SKILL, { question: null })]).runs, 0);
  assert.equal(replay([{ t: "x", kind: "unaided", skill: SKILL }]).runs, 0);
});

test("rule 2: a skill that accepts more kinds counts them", () => {
  const d = derive(
    [unaidedEntry("write-a-migration", { kind: "types" })] as Entry[],
    "write-a-migration",
    map,
  );
  assert.equal(d.runs, 1);
});

test("rule 3: a calibrated entry marked earned sets the state and fills the run count", () => {
  const d = replay([{ t: "x", kind: "calibrated", skill: SKILL, state: "earned" }]);
  assert.equal(d.state, "earned");
  assert.equal(d.runs, 3);
  assert.equal(d.needsEarned, true);
});

test("rule 3: a calibrated entry with any other state is ignored", () => {
  const d = replay([{ t: "x", kind: "calibrated", skill: SKILL, state: "unearned" }]);
  assert.equal(d.state, "unearned");
  assert.equal(d.runs, 0);
});

test("rule 4: correct reviews build a streak, and five master the skill", () => {
  const base: Record<string, unknown>[] = [
    { t: "x", kind: "calibrated", skill: SKILL, state: "earned" },
    { t: "x", kind: "earned", skill: SKILL },
  ];
  for (let i = 1; i <= 4; i += 1) {
    base.push({ t: "x", kind: "review", skill: SKILL, correct: true });
    const d = replay(base);
    assert.equal(d.state, "earned", `after ${i} correct reviews`);
    assert.equal(d.streak, i);
  }
  base.push({ t: "x", kind: "review", skill: SKILL, correct: true });
  const mastered = replay(base);
  assert.equal(mastered.state, "mastered");
  assert.equal(mastered.streak, 5);
  assert.equal(mastered.needsMastered, true);
});

test("rule 4: a wrong review while earned demotes the skill and leaves it one run short", () => {
  const d = replay([
    unaidedEntry(SKILL),
    unaidedEntry(SKILL),
    unaidedEntry(SKILL),
    { t: "x", kind: "earned", skill: SKILL },
    { t: "x", kind: "review", skill: SKILL, correct: false },
  ]);
  assert.equal(d.state, "unearned");
  assert.equal(d.runs, 2);
  assert.equal(d.streak, 0);
  assert.equal(d.needsDemoted, true);
});

test("rule 4: one more witnessed unaided run earns a demoted skill again", () => {
  const entries: Record<string, unknown>[] = [
    unaidedEntry(SKILL),
    unaidedEntry(SKILL),
    unaidedEntry(SKILL),
    { t: "x", kind: "earned", skill: SKILL },
    { t: "x", kind: "review", skill: SKILL, correct: false },
    { t: "x", kind: "demoted", skill: SKILL },
  ];
  assert.equal(replay(entries).needsDemoted, false);

  entries.push(unaidedEntry(SKILL));
  const again = replay(entries);
  assert.equal(again.state, "earned");
  assert.equal(again.runs, 3);
  assert.equal(again.needsEarned, true);
});

test("rule 5: a wrong review while mastered demotes the same way, and a correct one changes nothing", () => {
  const base: Record<string, unknown>[] = [{ t: "x", kind: "calibrated", skill: SKILL, state: "earned" }];
  for (let i = 0; i < 5; i += 1) base.push({ t: "x", kind: "review", skill: SKILL, correct: true });
  base.push({ t: "x", kind: "mastered", skill: SKILL });
  assert.equal(replay(base).state, "mastered");

  const steady = [...base, { t: "x", kind: "review", skill: SKILL, correct: true }];
  const after = replay(steady);
  assert.equal(after.state, "mastered");
  assert.equal(after.streak, 5);

  const demoted = replay([...base, { t: "x", kind: "review", skill: SKILL, correct: false }]);
  assert.equal(demoted.state, "unearned");
  assert.equal(demoted.runs, 2);
  assert.equal(demoted.streak, 0);
  assert.equal(demoted.needsDemoted, true);
});

test("rule 6: reviews before a skill is earned, other skills, and unknown kinds are ignored", () => {
  const d = replay([
    { t: "x", kind: "review", skill: SKILL, correct: true },
    { t: "x", kind: "review", skill: SKILL, correct: false },
    unaidedEntry("verify-webhook-signature"),
    { t: "x", kind: "cosign", skill: SKILL },
    { t: "x", kind: "whatever", skill: SKILL },
  ]);
  assert.equal(d.state, "unearned");
  assert.equal(d.runs, 0);
  assert.equal(d.streak, 0);
});

test("rule 6: malformed lines are counted and the good lines still derive", () => {
  const fixture = makeRepo({
    logbook: [
      JSON.stringify(unaidedEntry(SKILL)),
      "{ not json",
      "[1, 2, 3]",
      JSON.stringify({ t: "x", noKind: true }),
      "",
      JSON.stringify(unaidedEntry(SKILL)),
    ],
  });
  try {
    const { entries, malformed } = read(fixture.root, fixture.handle);
    assert.equal(malformed, 3);
    assert.equal(entries.length, 2);
    assert.equal(replay(entries as Record<string, unknown>[]).runs, 2);
  } finally {
    fixture.cleanup();
  }
});

test("the count shown as n of 3 is the run count while unearned", () => {
  const d = replay([unaidedEntry(SKILL), unaidedEntry(SKILL)]);
  assert.equal(`${d.runs} of ${map.threshold}`, "2 of 3");
});

test("append writes one line and read reads it back in order", () => {
  const fixture = makeRepo();
  try {
    append(fixture.root, fixture.handle, { kind: "earned", skill: SKILL });
    append(fixture.root, fixture.handle, { kind: "review", skill: SKILL, correct: true });
    const { entries, malformed } = read(fixture.root, fixture.handle);
    assert.equal(malformed, 0);
    assert.deepEqual(
      entries.map((e) => e.kind),
      ["earned", "review"],
    );
    assert.match(String(entries[0].t), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  } finally {
    fixture.cleanup();
  }
});
