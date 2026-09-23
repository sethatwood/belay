# Belay: design

How the plugin works, precisely enough to build from. The landing page in `site/` says what Belay does. This says how.

## Principles

- **Hooks record facts. The model asks.** A test result, a build result, a diff, a file written by a tool call: hooks see these and write them down. Claude never records a witness, an unaided run, or a promotion by hand. It calls tools that read state and ask what to do next.
- **State derives from the logbook.** A skill's state is computed from logbook entries every time it is needed. Derived entries are written too, for people and for CI, and CI recomputes them.
- **Nothing enters the logbook without a witness and a human.** An unaided run needs a passing witness and the person's correct answer to one question about their own diff. A review needs the person's answer. A calibration needs the person's answers. A co-sign needs a second person.
- **The person edits outside Claude Code.** During a "you do it" step, every tool-mediated edit is Claude's, and the gate denies it. Any diff that appears is the person's.
- **Struggle stays private.** Hints, corrections, and wrong answers go to a journal in the home directory. The repo holds capability states and what witnessed them.

## Files

### `.belay/map.json`, committed, team-owned

```json
{
  "version": 1,
  "threshold": 3,
  "mastery": 5,
  "skills": [
    {
      "id": "verify-webhook-signature",
      "name": "Verify a webhook signature",
      "teaches": "Reject any request whose signature does not match, using the raw body and a constant-time compare.",
      "witness": ["test"],
      "requires": ["write-a-test"],
      "precedents": ["src/billing/charge.ts"]
    }
  ],
  "zones": [
    { "paths": ["src/payments/**", "src/auth/**"], "cosign": true }
  ]
}
```

- `threshold`: witnessed unaided runs that earn a skill. `mastery`: correct reviews in a row, after earning, that master it.
- `witness`: which witness kinds count for this skill, from `test`, `build`, `types`. Default `["test"]`.
- `requires`: skills that must be earned before this one is proposed in learn mode. The gate does not enforce prerequisites.
- `precedents`: files in this repo that show the pattern. Hint two points here.
- `zones`: paths that always need a human co-sign whatever the logbook says. Read by the CI policy gate later, not by version one.

### `.belay/logbook/<handle>.jsonl`, committed, append-only, one file per person

One JSON object per line. Never edited, never reordered. `t` is UTC ISO 8601. `handle` comes from `~/.belay/config.json`, seeded from `git config user.name` slugified, and is the filename. Slug rule: lowercase, every run of characters outside `a-z0-9` becomes one `-`, leading and trailing `-` trimmed, and `anonymous` when the name is empty.

```jsonl
{"t":"2026-10-04T14:12:09Z","kind":"unaided","skill":"verify-webhook-signature","witness":{"kind":"test","cmd":"npx vitest run","pass":true},"commit":"9f8e7d6c5b4a39281706f5e4d3c2b1a098765432","files":["src/webhooks/verify.ts"],"blobs":{"src/webhooks/verify.ts":"3b18e512dba79e4c8300dd08aeb37f8e728b8dad"},"question":"sha256:1ba6214f034c90bfec911a199f42fa943adcf62901a5a0ddf84b69e8cc026f3b"}
{"t":"2026-10-04T14:20:41Z","kind":"earned","skill":"add-route"}
{"t":"2026-10-04T14:25:03Z","kind":"review","skill":"add-route","correct":true}
{"t":"2026-10-06T09:02:11Z","kind":"demoted","skill":"add-route"}
{"t":"2026-10-06T09:40:00Z","kind":"calibrated","skill":"write-a-test","state":"earned"}
{"t":"2026-10-07T16:00:00Z","kind":"mastered","skill":"write-a-migration"}
```

Primitive kinds, which drive state: `unaided`, `review`, `calibrated`. Derived kinds, written for readability and checked by CI: `earned`, `demoted`, `mastered`. Later, for teams: `cosign`.

An unaided entry holds what the team may see and nothing more:

- `witness`: the kind, the command, and the pass.
- `commit`: the full SHA of HEAD when the witness ran. The person's work is usually not committed yet, so this is the commit the work sits on.
- `files`: the paths the person changed during the step.
- `blobs`: git's blob id for each of those files' content when the witness passed, from `git hash-object`. It is the id the file gets in a commit's tree once it lands as witnessed. The CI policy gate, later, finds the commit that lands the work and checks that its tree holds these blobs, so a logbook entry cannot vouch for code other than the code that passed.
- `question`: `sha256:` and the hex digest of the question the person answered. The question names what they got wrong, so its text goes to the private journal, beside the same digest. The person can prove which question a run answered by sharing that journal line.

Entries written before 0.2.0 carry a short `commit`, no `blobs`, the question's text, and a `hints` count. Readers accept both shapes, and the state rule counts them the same.

### `.belay/state.json`, gitignored

The step in progress. Written by the server and the hooks, read by the hooks and the server.

```json
{
  "version": 1,
  "step": {
    "id": "01J9Y7Q0K3M2X5R8W1V4N6P7T9",
    "skill": "verify-webhook-signature",
    "mode": "you",
    "goal": "reject any request whose signature does not match",
    "startedAt": "2026-10-04T14:01:00Z",
    "baseline": "9f8e7d6",
    "snapshot": {},
    "followUp": false,
    "hints": 1,
    "toolEdits": [],
    "witnesses": [
      {"kind":"test","cmd":"npx vitest run","pass":true,"at":"2026-10-04T14:12:09Z"}
    ],
    "pending": null,
    "question": null
  },
  "last": null
}
```

- `mode` is one of `you`, `review`, `quiet`, decided by the server from the skill's state at `belay_begin_step`.
- `followUp` is true when Belay opened this step to have a flaw fixed on the same skill as the step that just closed. A follow-up step asks its question and journals the answer, and writes nothing to the logbook. One task is one run; three separate pieces of work earn a skill, not one piece of work with rounds of fixes.
- `baseline` is HEAD when the step began. `snapshot` maps every file that already differed from it at that moment to a hash of its content. The step's work is whatever differs from the snapshot now, so a file left over from earlier work does not count as this step's, and an earlier file edited during the step does.
- `toolEdits` lists files written through Claude Code tools during the step, from the attribute hook. On a `you` step this should stay empty. If it does not, the run is not unaided.
- `pending` holds a passing witness that is waiting for the person's answer on a `you` step: `{"witness": {...}, "commit": "...", "files": [...]}`. The witness hook sets it. `belay_answer` consumes it.
- `question` holds the question Claude asked on this step, in either mode: `{"text": "...", "expected": "...", "askedAt": "..."}`. The stop hook reads it.
- `last` is the previous step's closing result. The prompt hook shows it once and marks it `shown`. It stays until the next step closes, because a follow-up on the same skill reads it after the person's next message.

Every change to `state.json` goes through one update: a lock in the system temp directory, then read, change, and write. Claude Code runs the hooks for parallel tool calls at the same time, and without the lock the last writer wins. The write goes to `state.json.<pid>.tmp` and is renamed into place, so a hook killed mid-write leaves the previous state whole. A lock that cannot be had within two seconds is gone around, because a hook never holds up the person's work.

### `~/.belay/journal/<repo-slug>/<date>.jsonl`, never committed

Every hint given, every correction asked, every review answer with the person's words. Same line format as the logbook with a `note` field. `repo-slug` is the repo directory name plus the first eight characters of a hash of the remote URL, or of the path when there is no remote.

### `~/.belay/config.json`

`{"handle": "seth"}`. Created on first use.

## Skill state

Computed from one person's logbook, per skill, by replaying entries in order:

1. Start `unearned`, with `runs = 0` and `streak = 0`.
2. `unaided` with a passing witness of a kind the skill accepts and a `question` field: `runs += 1`. When `runs` reaches `threshold`, state becomes `earned`, and an `earned` entry is written if the last derived entry for this skill is not already `earned`.
3. `calibrated` with `state: earned`: state becomes `earned`, `runs = threshold`.
4. `review` while `earned`: correct sets `streak += 1`, and at `mastery` the state becomes `mastered` with a `mastered` entry. Wrong sets state `unearned`, `runs = threshold - 1`, `streak = 0`, and writes a `demoted` entry. One more witnessed unaided run earns it again.
5. `review` while `mastered`: a wrong answer demotes the same way. Correct answers change nothing.
6. Anything else is ignored, including malformed lines, which are counted and reported by `belay_map`.

The count shown on the page as "n of 3" is `runs` while `unearned`.

## The server's tools

Nine tools. Every tool reads the map, the logbook, and the state fresh from disk on each call, so hooks and the server never hold stale copies.

- **`belay_map()`** Returns the map with each skill's state, `runs`, and `streak` for the current handle, plus the number of malformed logbook lines.
- **`belay_begin_step(skill, goal, followUp?)`** Closes any open step. Derives the skill's state. Writes a new step to `state.json` with the mode: `you` for unearned, `review` for earned, `quiet` for mastered. `followUp: true` is only honored when the last closed step was on the same skill; otherwise it is ignored and the response says so. Returns `{mode, state, runs, threshold, justEarned, followUp}`. `justEarned` is true when the derivation found the skill earned with no `earned` entry yet, in which case the server writes that entry now. Claude announces it in one line, the way the card on the landing page reads.
- **`belay_hint(skill, text)`** Only on a `you` step. Like `belay_ask` and `belay_answer`, it refuses a `skill` that is not the open step's and names the one that is. Increments `hints`. Returns `{rung, of: 3, kind}` where kind is `concept`, `repo`, or `pseudocode`, plus the skill's `precedents` on rung two. On a fourth call returns `{rung: 4, kind: "escalate"}`: Claude writes the senior a ten-minute question with what was tried, and gives no further hints. The hint's text, passed as `text`, is journaled and never written to the logbook.
- **`belay_ask(skill, question, expected)`** Stores the question in `state.json`. On a `you` step it needs `pending` set: the question is about the person's own diff. On a `review` step it is the question about the change Belay wrote. Returns ok.
- **`belay_answer(skill, correct, answer)`** Needs a stored question. Journals the answer. On a follow-up step, closes the step and writes nothing to the logbook whatever the answer. On a `you` step with `pending` and a correct answer, appends the `unaided` entry with the pending witness, commit, files, blob ids, and the question's digest (the hint count goes to the journal with the answer, where the question's text already is), applies the state rule, writes `earned` if reached, and closes the step into `last`. On a `you` step with a wrong answer, clears `pending` and `question` and keeps the step open: the person revises, says done, and a new passing witness starts the check again. On a `review` step, appends the `review` entry, applies the state rule, writes `demoted` or `mastered` if the rule says so, and closes the step. Returns the new state.
- **`belay_logbook(skill?, limit?)`** Returns entries newest first, as written.
- **`belay_end_step(reason)`** Closes a step without a result, for when the person changes task. Writes nothing to the logbook.
- **`belay_init(map, precedents?)`** Sets a repo up. `map` is `typescript` or `python`, naming a starter map shipped inside the server bundle. Runs `git init` when the folder has no repo, because Belay reads the person's work from git, and reports it as `gitInit`. Writes `.belay/map.json` from the starter, with `precedents` merged in per skill id when given; writes `"outputStyle": "belay:Belay"` into `.claude/settings.json`, creating the file or merging into it and keeping every other key; adds to `.gitignore` whichever of these lines it lacks: `.belay/state.json`, `.belay/*.tmp`, and what the language installs into the project (`node_modules/` for TypeScript; `.venv/`, `__pycache__/`, `.pytest_cache/`, `.mypy_cache/` for Python). Refuses to overwrite an existing map, and refuses the home directory. Returns the paths it wrote.
- **`belay_calibrate(skill, earned, note)`** Records the outcome of one calibration exchange. When `earned` is true, appends a `calibrated` entry with `state: earned`. Either way journals the note, which holds the questions asked and the answers given. Refuses on a skill that already has any logbook entry.

There is no tool that records a witness. Only the witness hook does that, and Claude cannot write an unaided entry without a witness the hook saw.

## The hooks

All six are thin shell wrappers that run `node ${CLAUDE_PLUGIN_ROOT}/server/dist/hooks.js <name>`, so hooks and server share one library. Each reads the hook event JSON from stdin. Each exits 0 in every case; blocking is done through JSON on stdout, never through exit codes, so a crash in a hook never blocks work by accident.

The hooks and the server find the repo the same way: from `CLAUDE_PROJECT_DIR`, the directory the session started in, falling back to the event's `cwd`. A hook's `cwd` follows Claude's `cd`, and a `cd` into a submodule would otherwise put the gate on a state file the server never writes. Walking up for `.belay` or `.git` stops below the home directory, which is never a repo: it holds `~/.belay`, the private side.

**`session-start`**
Reads: whether `.belay/map.json` exists, and the output style in effect.
Writes: nothing.
Returns, with a map: `additionalContext` naming the handle, the counts of skills by state, and the instruction to call `belay_begin_step` before each step of work. Without a map: `additionalContext` saying Belay is installed and this repo has no map, and to offer `/belay:learn` for learning or `/belay:team` for setting up a team map.
With a map, it also reads `outputStyle` the way Claude Code does, from `.claude/settings.local.json`, then `.claude/settings.json`, then `~/.claude/settings.json`. When the style in effect is not `belay:Belay`, it adds a line naming the file and the value, so Claude tells the person the contract is off. `/output-style` writes the local file, so one run of it silently outranks the committed setting.
In any repo, when `~/.belay/map.json` exists, it adds a line asking Claude to offer to remove what version 0.1.0 wrote when it mistook the home directory for a repo.

**`prompt`** (UserPromptSubmit)
Reads: `.belay/map.json`, `state.json`.
Writes: marks `last` shown after showing it once.
Returns: nothing in a repo with no map. Otherwise `additionalContext` with one line: the open step's skill, mode, hints, and witnesses so far, or "no step in progress", plus `last` if it has not been shown.

**`gate`** (PreToolUse on Edit, Write, MultiEdit, NotebookEdit, Bash)
Reads: `state.json`.
Writes: nothing.
Returns: nothing when there is no open step or the mode is `review` or `quiet`. On a `you` step, for the edit tools, denies with reason "`<skill>` is unearned. You write it. Want a hint?" For Bash on a `you` step, denies when the command matches a write pattern and allows otherwise. Write patterns: `>`, `>>`, or `>|` not followed by `&` and not targeting `/dev/null`; heredocs; `tee`; `sed -i`, `perl -i`, `awk -i inplace`; `cp`, `mv`, `rm`, `mkdir`, `touch`, `ln`, `rsync`, `install`, `truncate`, `dd`, `unzip`, `shred`, `ed`; `tar x`; `find` with `-delete` or `-exec`; `curl` or `wget` saving to a file; a shell or `eval` given a command string, read inside; inline code through `node -e`, `python -c` (any version), `bun -e`, `deno eval`, `tsx -e`, `ruby -e`, `perl -e`, `php -r`; a formatter or linter told to rewrite files (`prettier --write`, `eslint --fix`, `ruff --fix` or `ruff format`, `black`, `isort`, `biome --write`); git subcommands that rewrite the working tree (`apply`, `restore`, `checkout`, `switch`, `clean`, `merge`, `rebase`, `stash` other than `list` and `show`, `reset --hard`, and the rest); `patch`; `npx create-`, `npm init`, `npm install` and equivalents, including `pip install`, `uv add`, `uv pip install`, `poetry add`, `pipx install`. Wrappers (`sudo`, `env`, `xargs`, `timeout`) and runners (`npx`, `bunx`, `pnpm exec`, `yarn dlx`, `uv run`, `poetry run`) are read through to the command they run. Read-only git, test, build, type-check, `ls`, `cat`, `grep`, `find` are allowed. A denied Bash command's reason names the pattern that matched.

Denial shape:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"verify-webhook-signature is unearned. You write it. Want a hint?"}}
```

**`attribute`** (PostToolUse on the edit tools)
Reads: `state.json`, the tool input's file path.
Writes: appends the path to `step.toolEdits` when a step is open.
Returns: nothing.
Claude often writes files through Bash rather than an edit tool, so this hook is not the only record of Claude's edits. The witness hook covers the shell side.

**`witness`** (PostToolUse and PostToolUseFailure on Bash)
Reads: `state.json`, the command, the event, the tool response or the error.
First, whatever the command: if it matches a write pattern, every file changed against `baseline` is added to `step.toolEdits`, because a write that ran through a tool call is Claude's. On a `you` step the gate should have stopped it, and this spoils the unaided run if it did not. On a `review` step this is how Belay's own shell-written edits get recorded.
Then it recognizes witnesses by the command word of each command in the line, after wrappers and runners, so `echo vitest` or `cat vitest.config.ts` is never one: `vitest`, `jest`, `node --test`, `npm test`, `pnpm test`, `yarn test`, `bun test`, a `test` or `test:*` script, `pytest`, `python -m pytest`, `python -m unittest` are `test`; `tsc`, `mypy`, `pyright`, a `typecheck` script are `types`; a `build` or `build:*` script, `vite build`, `next build`, `esbuild` are `build`. A line can hold more than one, and each is recorded: `tsc && vitest` is two.
Pass comes from the event first. Claude Code sends PostToolUse only when the command exited 0, and PostToolUseFailure when it did not, so a failure event is a fail. On PostToolUse, a witness whose exit code nothing hides passes unless its output says it failed: a clean `tsc` prints nothing, and that is a pass. A pipe, `;`, or `||` after the witness hides its exit code, and then only the runner's summary line counts, with silence a fail. Anything else is not a witness and the hook returns nothing.
Writes: appends each witness to `step.witnesses`. Then, on a `you` step with a passing witness of an accepted kind, with `toolEdits` empty, and with a non-empty diff against `baseline` (tracked changes plus untracked files, excluding `.belay/` and installed packages under `node_modules`, `.venv`, `venv`, `__pycache__`, and the Python caches), sets `step.pending` to the witness, HEAD, and the files. It writes nothing to the logbook.
Returns: `additionalContext` with one line Claude acts on: "witnessed: vitest pass · verify-webhook-signature: read their diff, ask one question about it with belay_ask, then record the answer with belay_answer", or "witnessed: vitest pass · not unaided: Claude edited src/x.ts" when `toolEdits` is not empty, or "witnessed: vitest fail" on failure. Nothing when the step is not `you`.

**`stop`**
Reads: `state.json`.
Writes: nothing.
Returns: nothing when `stop_hook_active` is true, since Claude Code is already continuing after one block and a second would loop. Otherwise, on a `review` step where `toolEdits` is non-empty or the tree differs from `baseline`, with `question` null, or on a `you` step with `pending` set and `question` null, `{"decision":"block","reason":"Ask one question before ending. Call belay_ask, then ask it."}`. Otherwise nothing. Once the question is stored the turn may end, because the person's answer needs their turn.

## One library

`server/src/lib/` holds the format and the rules, and both `index.ts` (the MCP server) and `hooks.ts` (the hook entry point) import it. Modules: `paths` (find the repo root and `.belay/`, the home config, the journal), `map`, `logbook` (append, read, derive), `state`, `journal`, `witness` (command recognition), `writes` (Bash write patterns). Every rule in this document has a unit test in `server/test/`, run with `npm test`. The bundle produces `dist/index.js` and `dist/hooks.js`, both committed.

## The starter maps

`maps/typescript.json` and `maps/python.json`, shipped with the plugin and bundled into the server so `belay_init` can write them anywhere. Both use the same ten skill ids, so a logbook reads the same across languages; the `teaches` lines and witness kinds differ. The Python map's type witness is `mypy` or `pyright`. Ten skills, in the order a first project meets them, each with `teaches`, `witness`, and `requires`:

1. `write-a-test`
2. `debug-a-failing-test`
3. `add-route`
4. `add-endpoint-with-validation`
5. `write-a-migration`
6. `verify-webhook-signature`
7. `idempotency-key`
8. `retry-with-backoff`
9. `handle-an-error-boundary`
10. `add-a-background-job`

Precedents are empty in the shipped maps. `/belay:learn` fills them from the repo it runs in, through `belay_init`.

## The acceptance test

Weekend one is done when the landing page's hero transcript happens for real. The test repo, kept outside this one: a small TypeScript service with vitest, a billing route, eleven passing tests, and one failing test for a webhook verifier that does not exist yet. Seeded with the starter map as its `.belay/map.json`, and a logbook with three `unaided` add-route entries and no `earned` entry.

The session, with Belay's output style on, in the terminal and again in the extension:

1. Person: add Stripe webhook signature verification to the billing route.
2. Claude calls `belay_begin_step("verify-webhook-signature", …)`: mode `you`. Claude explains the goal and asks what they need first.
3. Person: just write it. Claude tries Edit. The gate denies it with the reason. Claude relays it and offers a hint.
4. Person asks for a hint. Claude calls `belay_hint`: rung 1. Claude tells them to write it in their editor and say done. Person writes `src/webhooks/verify.ts` in their editor with a plain string compare.
5. Person: done. Claude runs `npx vitest run`. The witness hook sees twelve passing, finds the person's file in the diff, finds no tool edits, sets `pending`, and returns the one-line instruction. Claude reads the diff, calls `belay_ask` with a question about the compare, and asks it. If Claude tries to end the turn before asking, the stop hook blocks it.
6. Person answers. Claude calls `belay_answer(correct: true)`: the `unaided` entry is written with the witness, the file, its blob id, and the question's digest, the hint and the question's text go to the journal, and the step closes. Claude relays the count and tells them to make the change.
7. Claude calls `belay_begin_step("add-route", …)`: state derives to earned from the three seeded runs, `justEarned` is true, the `earned` entry is written, and Claude announces it in one line.
8. Claude writes `src/routes/webhooks.ts`. The gate allows it, the attribute hook records the file.
9. Claude calls `belay_ask` and asks the one question. If Claude tries to end the turn without asking, the stop hook blocks it.
10. Person answers. Claude calls `belay_answer(correct: true)`. The `review` entry is written and the step closes.

Done means the logbook ends with these lines, in this order: `unaided` for verify-webhook-signature, `earned` for add-route, `review` for add-route. The words Claude uses are its own, and Claude may open a follow-up step on the same skill to have the flaw fixed, which adds an `unaided` line before the earned one.

Run on September 21, 2026, in the terminal, and it passed with that extra line. Three things it showed. The style has to be on, by its namespaced name, or Claude calls the tools and lectures the solution anyway. Claude classifies the skill itself and held add-endpoint-with-validation for the webhook endpoint when the person argued for add-route, which is right. Claude wrote its own files through Bash, so attribution reads the tree rather than trusting the edit tools.

## The style setting

A plugin's output style is namespaced by the plugin name, so the setting that turns the contract on is `"outputStyle": "belay:Belay"`. Claude Code's `force-for-plugin` frontmatter key would turn a plugin's style on wherever the plugin is enabled, overriding the person's own setting. Belay does not set it: for a user-scope install that would put the contract on every repo, map or not. The repo's committed `.claude/settings.json` carries the setting, so the contract is ambient for everyone who opens the repo, and `/belay:learn` and `/belay:team` write it. Without the style, Claude still calls the tools but explains the whole solution on an unearned step, which the first acceptance run showed.

## Not in weekend one

Learn mode's project proposals and repo mapping, calibration, the team skill, the CI policy gate, co-signs, the IDE diagnostics witness, and any check that the extension's bundled CLI and a standalone install behave the same. Their file formats are fixed above so they can be added without a migration.
