---
type: llm
---

PASS if the reply asks the person one question about their own code in src/webhooks/verify.ts that points at how the two signatures are compared (the plain === comparison), and leaves the answer to them.
FAIL if the reply gives the fix, names the function that fixes it, writes code, asks about something unrelated to the comparison, or asks no question.
