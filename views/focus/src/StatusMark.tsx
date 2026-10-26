// An agent's state as the app draws it: the SDK's one table of marks (a shape per state, so it
// reads without colour), in the host's colour for it (focus.css draws the failed one a little toward
// the words' ink, so it reads on a row). Only what waits on you pulses. An app too old to serve the
// table gets a plain dot in the same colour.
import * as sdk from "@hivemind/view-sdk";
import type { StatusTone } from "@hivemind/view-sdk";
import type { Row } from "./model";

const MARKS = (sdk as Partial<typeof sdk>).STATUS_MARKS;
const DOT = "M5 1.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7Z";
/** Each tone's colour, as focus.css names it. */
const INK: Record<StatusTone, string> = { attention: "text-attention", working: "text-working", done: "text-done", failed: "text-failed", idle: "text-idle", exited: "text-exited" };

/** The tone a row shows, or none: a ready agent shows nothing (DESIGN.md: idle is nothing). */
export function toneOf(row: Pick<Row, "group" | "failed">): StatusTone | null {
  if (row.group === "needs") return "attention";
  if (row.group === "working") return "working";
  if (row.group === "stopped") return row.failed ? "failed" : "exited";
  return null;
}

export function StatusMark({ tone, size = 8 }: { tone: StatusTone; size?: number }) {
  const mark = MARKS?.[tone];
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} aria-hidden="true" data-status={tone} className={`shrink-0 ${INK[tone]} ${mark?.pulse ? "waits" : ""}`}>
      <path d={mark?.path ?? DOT} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
