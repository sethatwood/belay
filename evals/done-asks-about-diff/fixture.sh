#!/usr/bin/env bash
# The hero session after the hint: a you step is open on
# verify-webhook-signature, and the person has written the verifier in their
# editor with a plain === on the digests. The tests pass. They say done.
source "$(dirname "${BASH_SOURCE[0]}")/../lib/billing.sh"

node -e '
const { execFileSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const baseline = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
writeFileSync(".belay/state.json", JSON.stringify({
  version: 1,
  step: {
    id: "01EVALDONEASKSABOUTDIFF000", skill: "verify-webhook-signature", mode: "you",
    goal: "reject any request whose signature does not match", startedAt: now,
    baseline, snapshot: {}, followUp: false, hints: 1, toolEdits: [], witnesses: [],
    pending: null, question: null,
  },
  last: null,
}, null, 2) + "\n");
'

mkdir -p src/webhooks
cat > src/webhooks/verify.ts <<'TS'
import { createHmac } from "node:crypto";

export function verifyWebhookSignature(rawBody: string | Buffer, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  return expected === parts.v1;
}
TS
