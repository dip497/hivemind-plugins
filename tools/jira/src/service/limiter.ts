// How many Atlassian MCP calls the service makes (design jira-sync §9.0, §9.2): at most 3 in
// flight, an hourly budget that pull and push share (the org's Rovo limit may be shared), and a
// pause while Atlassian said to come back later (`Retry-After`). One limiter per sign-in.
import { TransportError } from "./transport.js";

export interface LimiterOptions {
  maxInFlight?: number;
  /** Calls per rolling hour. */
  budget: () => number;
  now?: () => number;
}

const HOUR = 3_600_000;

export class Limiter {
  private inFlight = 0;
  private readonly queue: (() => void)[] = [];
  /** When each call of the last hour started, oldest first. */
  private readonly calls: number[] = [];
  private pausedUntil = 0;
  /** The most calls ever in flight at once (for the tests and the log). */
  peak = 0;

  constructor(private readonly o: LimiterOptions) {}

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  private trim(): void {
    const t = this.now();
    while (this.calls.length && this.calls[0]! <= t - HOUR) this.calls.shift();
  }

  /** Calls made in the last hour, and the budget. */
  usage(): { used: number; limit: number } {
    this.trim();
    return { used: this.calls.length, limit: this.o.budget() };
  }

  /** Until when calls wait for Atlassian (`Retry-After`), or undefined. */
  rateLimitedUntil(): number | undefined {
    return this.pausedUntil > this.now() ? this.pausedUntil : undefined;
  }

  /** Atlassian said to come back in `ms`. */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  /** Run one call within the limits: refused (`rate-limited`) when the budget is spent or Atlassian
   *  asked for a pause, queued while 3 are in flight. */
  async run<T>(call: () => Promise<T>): Promise<T> {
    const paused = this.rateLimitedUntil();
    if (paused) throw new TransportError("rate-limited", `Atlassian asked to wait until ${new Date(paused).toISOString()}`, paused - this.now());
    this.trim();
    if (this.calls.length >= this.o.budget()) {
      const wait = this.calls[0]! + HOUR - this.now();
      throw new TransportError("rate-limited", `the hourly budget of ${this.o.budget()} Atlassian calls is spent`, wait);
    }
    // Count it now, so calls queued behind the 3 in flight can't overspend the budget.
    this.calls.push(this.now());
    if (this.inFlight >= (this.o.maxInFlight ?? 3)) await new Promise<void>((r) => this.queue.push(r));
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      return await call();
    } finally {
      this.inFlight--;
      this.queue.shift()?.();
    }
  }
}
