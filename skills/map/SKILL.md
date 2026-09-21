---
name: map
description: Show the skill map for this repo and where you stand on each skill: unearned, earned, or mastered, with unaided runs counted.
disable-model-invocation: true
---

Call `belay_map`. Show the result as a plain list, one skill per line in map order: the id, then the state, then the count as "n of 3" while unearned or the review streak while earned. Nothing else on the line. If the map reports malformed logbook lines, say how many in one sentence after the list. If the repo has no map, say so and offer `/belay:learn` or `/belay:team`.

No headers, no commentary, no advice about what to do next unless they ask.
