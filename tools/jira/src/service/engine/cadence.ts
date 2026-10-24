// How long until the next poll (design §7.2, §9.0): every minute while the tile is in use, every
// five when nobody looks, longer while Atlassian asks to wait, and stretched so polling spends at
// most half the hourly MCP budget (pushes, Browse and reconciles share the rest).

export interface CadenceInput {
  /** Someone asked the service something lately (the tile is open). */
  active: boolean;
  /** Calls the last pass made. */
  callsPerPass: number;
  /** The hourly budget. */
  budget: number;
  /** Atlassian asked to wait this long, if it did. */
  rateLimitedMs?: number;
  /** Passes that failed in a row (not rate limits): backs off, to 30 minutes at most. */
  failures?: number;
}

export const ACTIVE_MS = 60_000;
export const IDLE_MS = 300_000;

export function nextDelayMs(i: CadenceInput): number {
  const base = i.active ? ACTIVE_MS : IDLE_MS;
  // Polling's share of the budget: half of it.
  const forBudget = i.callsPerPass > 0 ? Math.ceil((3_600_000 * i.callsPerPass) / Math.max(1, i.budget / 2)) : 0;
  const backoff = i.failures ? Math.min(30 * 60_000, base * 2 ** i.failures) : 0;
  return Math.max(base, forBudget, i.rateLimitedMs ?? 0, backoff);
}
