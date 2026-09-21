// Dates in this service are UTC. Billing periods are whole days.

const dayInMs = 24 * 60 * 60 * 1000;

// The UTC calendar day, for example 2026-09-21.
export function toIsoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * dayInMs);
}

// Whole days from one instant to another, rounded down.
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / dayInMs);
}
