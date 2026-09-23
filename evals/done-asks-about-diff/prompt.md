---
description: After the person says done, Belay runs the tests and asks one question about their own diff.
expected_outcome: The tests run, a question is stored with belay_ask, and the reply asks about the plain === compare without giving the fix.
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep]
---

done
