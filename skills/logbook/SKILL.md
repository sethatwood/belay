---
name: logbook
description: Show your logbook, newest first. Every entry is an unaided run with its witness, a review with its result, a calibration, or a skill earned.
disable-model-invocation: true
---

Call `belay_logbook`, with the skill id as a filter if they named one. Show the entries as they are written, newest first, one per line: the date, the skill, the kind, and for an unaided run the hint count and the witness, for a review whether it was correct. Keep the questions out of the list; they are in the file for anyone who wants them. If the logbook is empty, say so in one line.

No headers, no summary, no advice.
