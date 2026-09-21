import { describe, it, expect } from "vitest";
import {
  isValidIdempotencyKey,
  readIdempotencyKey,
  IdempotencyStore,
} from "./idempotency";

describe("isValidIdempotencyKey", () => {
  it("accepts a plain key and rejects a short or odd one", () => {
    expect(isValidIdempotencyKey("order-2026-09-21")).toBe(true);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("has spaces in it")).toBe(false);
  });
});

describe("readIdempotencyKey", () => {
  it("reads and trims the header, or gives null when it is missing", () => {
    const headers = new Headers({ "idempotency-key": " order-2026-09-21 " });
    expect(readIdempotencyKey(headers)).toBe("order-2026-09-21");
    expect(readIdempotencyKey(new Headers())).toBe(null);
  });
});

describe("IdempotencyStore", () => {
  it("returns the first result for a repeated key", () => {
    const store = new IdempotencyStore<string>();
    expect(store.remember("order-2026-09-21", "charged")).toBe("charged");
    expect(store.remember("order-2026-09-21", "charged again")).toBe("charged");
    expect(store.recall("order-2026-09-21")).toBe("charged");
  });
});
