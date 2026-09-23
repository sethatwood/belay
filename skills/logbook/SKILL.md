---
name: logbook
description: Show your logbook, newest first. Every entry is an unaided run with its witness, a review with its result, a calibration, or a skill earned.
disable-model-invocation: true
---

Call `belay_logbook`, with the skill id as a filter if they named one. Show the entries as they are written, newest first, one per line: the date, the skill, the kind, and for an unaided run the witness, for a review whether it was correct. Leave out hint counts and question text, which older entries may hold; since 0.2.0 an entry holds only a digest of its question, and the text is in the person's private journal. If the logbook is empty, say so in one line.

No headers, no summary, no advice.
