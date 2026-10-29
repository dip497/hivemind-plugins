/**
 * Where a scene's creatures are and go: how many a window holds, spread over all of it when the
 * scene stocks itself, so its first frame is already full of life, and somewhere ahead to go on to
 * when one has got where it was going. Every scene's creatures go by these, so each fills the
 * screen the same way.
 */
import { angleDiff, clamp, rand } from "./math";

/** How many creatures a window holds: one to each `area` px² of it, at least `min` (every kind the
 *  scene has) and at most `max`, so a laptop's screen is alive and a big one is not crowded. */
export const stockOf = (width: number, height: number, area: number, min: number, max: number) =>
  clamp(Math.round((width * height) / area), min, max);

/** `n` points over a `width` by `height` window, one in each cell of an even grid, well inside it,
 *  the cells taken in a random order: spread over all of it, none bunched together. */
export function spread(n: number, width: number, height: number): { x: number; y: number }[] {
  const cols = Math.max(1, Math.round(Math.sqrt((n * width) / Math.max(1, height))));
  const rows = Math.ceil(n / cols);
  const cells = Array.from({ length: cols * rows }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }
  return cells.slice(0, n).map((k) => ({
    x: ((k % cols) + rand(0.2, 0.8)) * (width / cols),
    y: (Math.floor(k / cols) + rand(0.2, 0.8)) * (height / rows),
  }));
}

/** Somewhere for a creature at `from` to go next, between `top` and `bottom` (shares of the
 *  height): of a few tries, given its heading, the one it need turn least to face, at least `reach`
 *  away, so it goes on in long curves instead of doubling back. With no heading, anywhere there. */
export function goalAhead(
  width: number, height: number,
  top: number, bottom: number,
  from: { x: number; y: number; heading?: number; reach?: number },
) {
  const pick = () => ({ x: rand(width * 0.08, width * 0.92), y: rand(height * top, height * bottom) });
  if (from.heading === undefined) return pick();
  let best = pick();
  let bestCost = Infinity;
  for (let i = 0; i < 16; i++) {
    const p = i ? pick() : best;
    // A point too near counts as a half turn more.
    const cost = Math.abs(angleDiff(from.heading, Math.atan2(p.y - from.y, p.x - from.x))) + (Math.hypot(p.x - from.x, p.y - from.y) < (from.reach ?? 0) ? Math.PI : 0);
    if (cost < bestCost) {
      best = p;
      bestCost = cost;
    }
  }
  return best;
}
