// An idempotency key lets a caller retry a write without repeating its effect.

const keyPattern = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidIdempotencyKey(key: string): boolean {
  return keyPattern.test(key);
}

// Read the key off a request, or null when the caller did not send one.
export function readIdempotencyKey(headers: Headers): string | null {
  const raw = headers.get("idempotency-key");
  if (raw === null) {
    return null;
  }
  const key = raw.trim();
  return isValidIdempotencyKey(key) ? key : null;
}

// A record of results already produced, keyed by the caller's key.
export class IdempotencyStore<T> {
  private readonly seen = new Map<string, T>();

  remember(key: string, value: T): T {
    const existing = this.seen.get(key);
    if (existing !== undefined) {
      return existing;
    }
    this.seen.set(key, value);
    return value;
  }

  recall(key: string): T | undefined {
    return this.seen.get(key);
  }
}
