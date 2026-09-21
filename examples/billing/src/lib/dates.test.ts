import { describe, it, expect } from "vitest";
import { toIsoDay, addDays, daysBetween } from "./dates";

describe("toIsoDay", () => {
  it("gives the UTC calendar day", () => {
    expect(toIsoDay(new Date("2026-09-21T23:40:00.000Z"))).toBe("2026-09-21");
  });
});

describe("addDays and daysBetween", () => {
  it("moves a date forward and measures whole days back", () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    const later = addDays(start, 30);
    expect(toIsoDay(later)).toBe("2026-10-01");
    expect(daysBetween(start, later)).toBe(30);
  });
});
