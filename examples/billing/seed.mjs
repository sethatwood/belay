// Seeds this example for whoever runs it. Writes three past unaided runs of
// add-route under your handle, so add-route is earned on the first step you
// take on it, and turns Belay's output style on for this folder.
//
// The handle rule matches the server: the handle in ~/.belay/config.json, or
// else git user.name, put through the slug rule either way. Lowercased, every
// run of characters outside a-z0-9 becomes one dash, ends trimmed,
// "anonymous" if empty.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

function gitName() {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function slugify(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return slug.length > 0 ? slug : "anonymous";
}

const configPath = join(process.env.BELAY_HOME || homedir(), ".belay", "config.json");
let handle = null;
if (existsSync(configPath)) {
  try {
    handle = JSON.parse(readFileSync(configPath, "utf8")).handle ?? null;
  } catch {
    handle = null;
  }
}
handle = typeof handle === "string" && handle.length > 0 ? slugify(handle) : slugify(gitName());

const runs = [
  ["2026-09-08T15:04:22Z", "4f1c9ab", "The list route reads the store directly. What does the caller get back when the store is empty?"],
  ["2026-09-14T10:41:07Z", "7d2e5b0", "This route answers 200 for an id that is not in the store. What should it answer?"],
  ["2026-09-18T17:26:53Z", "b93a1c4", "Both routes shape the invoice by hand. Where should that shaping live instead?"],
];

const lines = runs.map(([t, commit, question]) =>
  JSON.stringify({
    t,
    kind: "unaided",
    skill: "add-route",
    hints: 0,
    witness: { kind: "test", cmd: "npx vitest run", pass: true },
    commit,
    files: ["src/routes/billing.ts"],
    question,
  }),
);

mkdirSync(join(root, ".belay", "logbook"), { recursive: true });
writeFileSync(join(root, ".belay", "logbook", `${handle}.jsonl`), `${lines.join("\n")}\n`);

mkdirSync(join(root, ".claude"), { recursive: true });
const settingsPath = join(root, ".claude", "settings.json");
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    settings = {};
  }
}
settings.outputStyle = "belay:Belay";
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

const statePath = join(root, ".belay", "state.json");
if (existsSync(statePath)) writeFileSync(statePath, '{"version":1,"step":null,"last":null}\n');

console.log(`seeded .belay/logbook/${handle}.jsonl with three add-route runs, and .claude/settings.json with Belay's style`);
