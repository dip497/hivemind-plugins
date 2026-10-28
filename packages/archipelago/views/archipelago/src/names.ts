// Where the floating names go on screen: each over what it names, the most important first, none over
// another name or over a panel. Worked out from boxes alone, so main.ts measures the names, asks here,
// and moves them.

/** A box on screen, in CSS pixels. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** A name that wants to show: the middle of its foot at `x`, `y` (where it stands over what it names),
 *  its size; whether it is an island's; and whether it shows whatever it meets (`keep`: the keyboard
 *  is on it). */
export interface Name { x: number; y: number; w: number; h: number; island?: boolean; keep?: boolean }

/** The room the names have: the window, the widget column the app floats down its left edge, and
 *  where they stop on the right (`right`, a docked terminal's edge less a gap; the window's by default). */
export interface Room { w: number; h: number; left: number; right?: number }

/** How far below the window's top a name's top stays. */
const TOP = 12;

/** Whether an island is in the picture for its name to show, from where the name's foot would stand and
 *  how far down the screen the island's middle is (`mid`): the foot 24 px inside the window's sides and
 *  bottom and clear of the widget column, and the middle 24 px below the top, even where the name would
 *  stand past it (the name stops there, placeNames). */
export function islandInSight(at: { x: number; y: number; mid: number }, room: Room): boolean {
  return at.x >= room.left + 24 && at.x <= room.w - 24 && at.mid >= 24 && at.y <= room.h - 24;
}

/** Where each name's foot stands, in the order given, or null for one with no room. Each stays inside
 *  the window, its top at least TOP below the window's top (one that would stand higher stops there), and
 *  an island's keeps clear of the widget column (`left` wide, down the window's left edge) as it does of
 *  the window's edge. A name a panel's edge would cover moves aside along its row, up to half its width,
 *  clear of it (the header moves right beside the widget cards, onto where a name pinned at the top of
 *  the window stands); one stopped at the top of the window that still meets a panel there stands just
 *  below it. A name that would still cover a panel or a name placed before it does not show, but an
 *  island's that meets only names tries once directly above them: an agent calling you stands on the
 *  island's top edge, under its name, and the island that needs you would be the one left unnamed. Not
 *  above a panel, which would take it far from its island. The one the keyboard is on (`keep`) shows
 *  whatever names it meets; where a panel would cover it, or it has no room between the widget column
 *  and `right`, it stands at the top of the window instead, above where a docked terminal starts. */
export function placeNames(names: readonly Name[], panels: readonly Box[], room: Room): ({ x: number; y: number } | null)[] {
  const walls: Box[] = [...panels], placed: Box[] = [];
  // The widget column the app floats over the view: what lies under it cannot be seen.
  if (room.left > 0) walls.push({ x0: 0, y0: 0, x1: room.left, y1: room.h });
  const boxOf = (n: Name, x: number, y: number): Box => ({ x0: x - n.w / 2 - 3, x1: x + n.w / 2 + 3, y0: y - n.h - 2, y1: y + 2 });
  const over = (r: Box) => (q: Box) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0;
  const right = room.right ?? room.w;
  return names.map((n) => {
    const from = (n.island ? room.left : 0) + n.w / 2 + 4;
    let x = Math.max(from, Math.min(right - n.w / 2 - 4, n.x));
    let y = Math.min(room.h - 4, Math.max(n.y, n.h + TOP));
    let r = boxOf(n, x, y);
    let wall = walls.some(over(r)) || r.x1 > right;
    if (wall && r.x1 <= right) {
      const hit = walls.filter(over(r));
      const shifts = [Math.max(...hit.map((q) => q.x1)) - r.x0, Math.min(...hit.map((q) => q.x0)) - r.x1].sort((a, b) => Math.abs(a) - Math.abs(b));
      for (const dx of shifts) {
        const moved = boxOf(n, x + dx, y);
        if (Math.abs(dx) <= n.w / 2 && x + dx >= from && moved.x1 <= right && !walls.some(over(moved))) { x += dx; r = moved; wall = false; break; }
      }
      // One stopped at the top of the window (what it names is above the picture) stands just below a
      // panel it meets there, the header say, still at the top.
      if (wall && n.y < n.h + TOP) {
        const down = Math.max(...walls.filter(over(r)).map((q) => q.y1)) + n.h + 4, moved = boxOf(n, x, down);
        if (down <= room.h - 4 && !walls.some(over(moved))) { y = down; r = moved; wall = false; }
      }
    }
    const met = placed.filter(over(r));
    let clear = !wall && !met.length;
    if (!clear && !wall && n.island) {
      const above = Math.min(...met.map((q) => q.y0)) - 2, up = boxOf(n, x, above);
      if (above - n.h >= TOP && !walls.some(over(up)) && !placed.some(over(up))) { y = above; r = up; clear = true; }
    }
    if (!clear && !n.keep) return null;
    if (wall && n.keep) { x = Math.max(from, Math.min(room.w - n.w / 2 - 4, n.x)); y = n.h + TOP; r = boxOf(n, x, y); }
    placed.push(r);
    return { x, y };
  });
}
