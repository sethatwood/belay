// Money is stored as whole cents. Nothing in this service holds a float.

export type Currency = "usd" | "eur";

const symbols: Record<Currency, string> = {
  usd: "$",
  eur: "€",
};

// Render cents as a display string, for example 1999 usd becomes $19.99.
export function formatMoney(cents: number, currency: Currency = "usd"): string {
  if (!Number.isInteger(cents)) {
    throw new Error("money must be whole cents");
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = String(abs % 100).padStart(2, "0");
  return `${sign}${symbols[currency]}${whole}.${part}`;
}

// Add a list of cent amounts. Kept here so callers never reduce by hand.
export function sumCents(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}
