#!/usr/bin/env bash
# Runs one eval case as a real session: claude -p with this plugin loaded, in
# a workspace set up by the case's fixture.sh, with the repo's settings read
# the way a person's session reads them. claude plugin eval runs every case in
# isolation, and an isolated run loads no project settings, so Belay's output
# style, which a repo turns on in .claude/settings.json, is off there. This is
# how the contract itself gets tested.
#
#   evals/session.sh <case> [model]
#
# Prints Claude's reply, the files Claude created, the step from
# .belay/state.json (its witnesses and whether a question is stored), and a
# pass or fail for each of the case's regex and file_exists graders. The
# tool_used graders are read from the step line, and the llm graders from the
# reply. Belay's private side goes to a scratch home, never yours.

set -euo pipefail

CASE="$1"
MODEL="${2:-sonnet}"
EVALS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$(dirname "$EVALS")"
WORK="$(mktemp -d)"
mkdir -p "$WORK/repo" "$WORK/home"

cd "$WORK/repo"
bash "$EVALS/$CASE/fixture.sh"
before="$(git status --porcelain --untracked-files=all)"

# The prompt is prompt.md's body, after its frontmatter.
PROMPT="$(awk 'f>=2 {print} /^---$/ {f++}' "$EVALS/$CASE/prompt.md" | sed '/./,$!d')"

BELAY_HOME="$WORK/home" claude -p "$PROMPT" --plugin-dir "$PLUGIN" --model "$MODEL" \
  --permission-mode bypassPermissions --output-format json < /dev/null > "$WORK/out.json" 2> "$WORK/err.log" || true

node - "$WORK/out.json" "$before" "$EVALS/$CASE/graders" <<'JS'
const { readFileSync, readdirSync, existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const [outPath, before, graders] = process.argv.slice(2);
const out = JSON.parse(readFileSync(outPath, "utf8") || "{}");
const reply = (out.result ?? "").trim();
console.log(`reply: ${reply || "(none)"}`);

const now = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
const created = now.split("\n").filter((l) => l.startsWith("??") && !before.includes(l)).map((l) => l.slice(3));
console.log(`created: ${created.length > 0 ? created.join(", ") : "nothing"}`);

if (existsSync(".belay/state.json")) {
  const { step } = JSON.parse(readFileSync(".belay/state.json", "utf8"));
  const witnesses = step ? step.witnesses.map((w) => `${w.kind} ${w.pass ? "pass" : "fail"}`).join(", ") || "none" : "step closed";
  console.log(`step: ${step ? `${step.skill} ${step.mode}` : "none"} · witnesses: ${witnesses} · question: ${step?.question ? "stored" : "none"}`);
}

// The case's deterministic graders, read from their frontmatter. A pattern is
// a YAML double-quoted string, whose escapes are JSON's.
for (const file of readdirSync(graders).filter((f) => f.endsWith(".md")).sort()) {
  const front = readFileSync(`${graders}/${file}`, "utf8").split("---")[1] ?? "";
  const field = (key) => (new RegExp(`^${key}:\\s*(.+)$`, "m").exec(front) ?? [])[1]?.trim();
  const name = file.replace(/\.md$/, "");
  if (field("type") === "regex") {
    const raw = field("pattern") ?? "";
    const pattern = raw.startsWith('"') ? JSON.parse(raw) : raw;
    const target = field("target") ?? "last_message";
    const path = /path:\s*([^\s}]+)/.exec(target)?.[1];
    const text = path === undefined ? reply : existsSync(path) ? readFileSync(path, "utf8") : "";
    const found = new RegExp(pattern, field("flags") ?? "").test(text);
    const pass = field("match") === "not_contains" ? !found : found;
    console.log(`${pass ? "pass" : "FAIL"}  ${name}`);
  } else if (field("type") === "file_exists") {
    const made = created.includes(field("path"));
    const pass = (field("exists") ?? "true") === "false" ? !made : made;
    console.log(`${pass ? "pass" : "FAIL"}  ${name}`);
  }
}
JS
echo "workspace: $WORK/repo"
