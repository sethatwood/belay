// One version, everywhere it is written. Claude Code pins an installed plugin
// to the version in plugin.json and sends an update only when it changes, so
// a release that misses one of these never reaches anyone.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function json(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as Record<string, unknown>;
}

test("the plugin, the marketplace entry, the server, and its lockfile carry one version", () => {
  const server = json("../package.json").version;
  const lock = json("../package-lock.json");
  const marketplace = json("../../.claude-plugin/marketplace.json").plugins as Record<string, unknown>[];
  assert.equal(json("../../.claude-plugin/plugin.json").version, server);
  assert.equal(marketplace[0].version, server);
  assert.equal(lock.version, server);
  assert.equal((lock.packages as Record<string, Record<string, unknown>>)[""].version, server);
});
