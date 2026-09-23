---
name: team
description: Set up Belay for a team. Add the team's own skills to the map, mark the zones that always need a human co-sign, and set how many unaided runs earn a skill.
disable-model-invocation: true
---

A senior is setting Belay up for their team's repo. Walk them through it in order, one question per turn, and write the result to the map.

1. If the repo has no `.belay/map.json`, ask which starter map fits, `typescript` or `python`, and call `belay_init` with it. If the map exists, call `belay_map` and show it as a plain list.
2. Ask which skills this codebase needs that the starter map does not name. For each one they give, ask for the one or two sentences a senior would say about it, which witness kinds count (test, build, types), which skills come before it, and one or two files that show it done well. Add it to `.belay/map.json` by editing the file: same shape as the others, id in kebab-case.
3. Ask which paths always need a human co-sign whatever the logbook says. Write them into `zones` as globs with `cosign: true`. Say plainly that version one records zones and does not enforce them yet; the CI check that enforces them is later.
4. Ask how many witnessed unaided runs should earn a skill here, and how many correct reviews in a row should master one. The defaults are three and five. Write `threshold` and `mastery`.
5. Show the finished map as a plain list and say what to commit: `.belay/map.json`, `.claude/settings.json`, and the `.gitignore` line. Say that each person's logbook is their own file under `.belay/logbook/`, committed with their work, and that what they struggled with never leaves their machine.

Edit the map directly with the file tools; no step is open, so the gate is not in the way. Keep the JSON valid and two-space indented. Short turns.
