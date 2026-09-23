// Finding the repo, naming the handle, and naming the journal.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  configPath,
  findRepoRoot,
  homeBelayDir,
  isHomeDir,
  journalPath,
  logbookPath,
  readHandle,
  repoSlug,
  slugify,
} from "../src/lib/paths.js";
import * as journal from "../src/lib/journal.js";
import { makeRepo, runGit } from "./helpers.js";

test("the slug rule lowercases, collapses every other run to one dash, and trims", () => {
  assert.equal(slugify("Seth Atwood"), "seth-atwood");
  assert.equal(slugify("SETH"), "seth");
  assert.equal(slugify("  Seth   R.  Atwood  "), "seth-r-atwood");
  assert.equal(slugify("seth@example.com"), "seth-example-com");
  assert.equal(slugify("--Seth--"), "seth");
  assert.equal(slugify("Ada 42"), "ada-42");
  assert.equal(slugify(""), "anonymous");
  assert.equal(slugify("???"), "anonymous");
});

test("the repo root is the first directory above the cwd holding .belay or .git", () => {
  const f = makeRepo();
  try {
    const deep = join(f.root, "src", "webhooks", "handlers");
    mkdirSync(deep, { recursive: true });
    assert.equal(findRepoRoot(deep), f.root);
    assert.equal(findRepoRoot(f.root), f.root);
  } finally {
    f.cleanup();
  }
});

test("the handle comes from the config, and is seeded from git config user.name", () => {
  const f = makeRepo();
  try {
    assert.equal(readHandle(f.root), "test-person");

    rmSync(configPath(), { force: true });
    runGit(f.root, ["config", "user.name", "Ada Lovelace"]);
    assert.equal(readHandle(f.root), "ada-lovelace");
    assert.equal(JSON.parse(readFileSync(configPath(), "utf8")).handle, "ada-lovelace");
    assert.match(logbookPath(f.root, "ada-lovelace"), /\.belay\/logbook\/ada-lovelace\.jsonl$/);
  } finally {
    f.cleanup();
  }
});

test("the repo slug is the directory name and eight characters of a hash", () => {
  const f = makeRepo();
  try {
    const slug = repoSlug(f.root);
    assert.match(slug, /^repo-[0-9a-f]{8}$/);
    assert.equal(repoSlug(f.root), slug, "the slug is stable");
  } finally {
    f.cleanup();
  }
});

test("the journal lives under the home directory, never in the repo", () => {
  const f = makeRepo();
  try {
    journal.write(f.root, { kind: "hint", skill: "add-route", rung: 1, note: "raw body" }, "2026-10-04T14:01:00Z");
    const path = journalPath(f.root, "2026-10-04");
    assert.ok(path.startsWith(homeBelayDir()));
    assert.ok(existsSync(path));
    const line = JSON.parse(readFileSync(path, "utf8").trim());
    assert.deepEqual(line, { t: "2026-10-04T14:01:00Z", kind: "hint", skill: "add-route", rung: 1, note: "raw body" });
    assert.equal(existsSync(join(f.root, ".belay", "journal")), false);
  } finally {
    f.cleanup();
  }
});

test("the home directory is never the repo root, whatever it holds", () => {
  const f = makeRepo();
  try {
    const project = join(f.home, "projects", "new-thing");
    mkdirSync(project, { recursive: true });
    assert.ok(existsSync(homeBelayDir()), "the private side exists after first use");
    assert.equal(findRepoRoot(project), project);
    runGit(f.home, ["init", "-q"]);
    assert.equal(findRepoRoot(project), project, "a dotfiles repo in home does not count either");
    assert.equal(isHomeDir(f.home), true);
    assert.equal(isHomeDir(project), false);
  } finally {
    f.cleanup();
  }
});

test("a handle edited by hand still names a file inside the logbook directory", () => {
  const f = makeRepo();
  try {
    writeFileSync(configPath(), `${JSON.stringify({ handle: "../../Sam Rivera" })}\n`);
    assert.equal(readHandle(f.root), "sam-rivera");
  } finally {
    f.cleanup();
  }
});
