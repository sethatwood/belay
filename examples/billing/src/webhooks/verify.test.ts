import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

// The webhook verifier does not exist yet. Write src/webhooks/verify.ts so that
// verifyWebhookSignature(rawBody, header, secret) returns true for a header this
// secret produced over this exact body, and false for anything else.
type VerifyWebhookSignature = (
  rawBody: string | Buffer,
  header: string,
  secret: string,
) => boolean;

// Imported inside the test so a missing module reports as a failing test.
async function loadVerifier(): Promise<VerifyWebhookSignature> {
  const mod = (await import("./verify")) as {
    verifyWebhookSignature: VerifyWebhookSignature;
  };
  return mod.verifyWebhookSignature;
}

const secret = "whsec_kQ4mZ2nR8tLpXv6bYc1dHs3g";

// Stripe sends "t=<unix seconds>,v1=<hex hmac of t.payload>".
function signatureHeader(payload: string, signingSecret: string, at = 1790000000): string {
  const signed = createHmac("sha256", signingSecret)
    .update(`${at}.${payload}`)
    .digest("hex");
  return `t=${at},v1=${signed}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature and rejects a tampered body or a wrong secret", async () => {
    const verifyWebhookSignature = await loadVerifier();

    const payload = JSON.stringify({
      id: "evt_1001",
      type: "invoice.paid",
      data: { object: { id: "in_1002", amount_paid: 4900 } },
    });
    const header = signatureHeader(payload, secret);

    expect(verifyWebhookSignature(payload, header, secret)).toBe(true);

    const tampered = payload.replace("4900", "1");
    expect(verifyWebhookSignature(tampered, header, secret)).toBe(false);

    expect(verifyWebhookSignature(payload, header, "whsec_someoneelses")).toBe(false);
  });
});
