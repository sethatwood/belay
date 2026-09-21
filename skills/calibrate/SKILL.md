---
name: calibrate
description: Seed your map on the first session. A few questions per skill so what you already know starts earned and what you don't starts unearned.
disable-model-invocation: true
---

The person is new to this repo's map and some of its skills are ones they have done before. Find out which, honestly, and record it. Calibration is the only way a skill starts earned without three witnessed runs, so it has to be harder to pass than a review question.

1. Call `belay_map`. Skip every skill that already has a logbook entry; calibration is for untouched skills only.
2. Ask, once, which of the remaining skills they believe they have done alone before, in production or close to it. Take their list; do not calibrate the rest.
3. For each skill on their list, one at a time, ask two questions a senior would ask to tell whether someone has done it, not whether they have read about it. Ask about the case that goes wrong, the thing that is easy to get past a test, the decision they had to make. Judge the answers honestly. Two good answers and the skill is earned. Anything less and it stays unearned, and you say so in one line without softening it.
4. After each skill, call `belay_calibrate` with `earned` true or false and a note that holds both questions and both answers in their words.
5. When the list is done, call `belay_map` again and show the result as a plain list.

One question per turn. No hints during calibration; a hint would make the answer yours. No headers, no praise, no em dashes, and never record a skill as earned because they asked you to.
