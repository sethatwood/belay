import { describe, it, expect } from "vitest";
import { formatMoney, sumCents } from "./money";

describe("formatMoney", () => {
  it("renders cents as a currency string, sign in front", () => {
    expect(formatMoney(1999)).toBe("$19.99");
    expect(formatMoney(4900, "usd")).toBe("$49.00");
    expect(formatMoney(5, "usd")).toBe("$0.05");
    expect(formatMoney(-250)).toBe("-$2.50");
  });

  it("refuses a fractional cent", () => {
    expect(() => formatMoney(10.5)).toThrow("money must be whole cents");
  });
});

describe("sumCents", () => {
  it("adds a list of amounts", () => {
    expect(sumCents([4900, 1500])).toBe(6400);
    expect(sumCents([])).toBe(0);
  });
});
