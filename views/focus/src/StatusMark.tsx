// An agent's state as a shape as well as a colour, so it reads without colour too: a diamond waits
// on you, a filled dot works, a ring is ready, a square has stopped, a cross has failed.
import type { Row } from "./model";
import { cn } from "./ui/cn";

export function StatusMark({ row, className }: { row: Pick<Row, "group" | "failed">; className?: string }) {
  const base = cn("size-3 shrink-0", className);
  if (row.group === "needs") return <svg viewBox="0 0 12 12" className={cn(base, "text-attention")} aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill="currentColor" /></svg>;
  if (row.group === "working") return <svg viewBox="0 0 12 12" className={cn(base, "text-working motion-safe:animate-pulse")} aria-hidden="true"><circle cx="6" cy="6" r="4" fill="currentColor" /></svg>;
  if (row.group === "ready") return <svg viewBox="0 0 12 12" className={cn(base, "text-idle")} aria-hidden="true"><circle cx="6" cy="6" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
  if (row.failed) return <svg viewBox="0 0 12 12" className={cn(base, "text-failed")} aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 12 12" className={cn(base, "text-idle")} aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}
