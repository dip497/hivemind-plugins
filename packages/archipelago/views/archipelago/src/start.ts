// Starting an agent from the view: the island it goes on, the islands to choose from when that was only
// a guess, and knowing the agent when the app opens its tile, so the view can go to it.
import { LOOSE } from "./world";

/** An island a new agent can go on. */
export interface Isle { id: string; title: string }
/** Where a new agent goes; `guessed` when nobody chose it, so it is the island in the middle of the view. */
export interface Target extends Isle { guessed: boolean }

/** The island a new agent goes on: the one `chosen` (picked, the picked agent's, the one you walk on),
 *  else the one in view, a guess. Not the agents in no frame: they have no folder to start in, so there
 *  the app chooses (null). */
export function startTarget(islands: ReadonlyMap<string, Isle>, chosen: string | null | undefined, inView: string | null): Target | null {
  const id = chosen ?? inView;
  const isl = id && id !== LOOSE ? islands.get(id) : undefined;
  return isl ? { id: isl.id, title: isl.title, guessed: !chosen } : null;
}

/** The islands the start menu offers instead, when where the agent goes was only a guess and there is
 *  more than one it can go on; none when the person chose it. */
export function startChoices(islands: Iterable<Isle>, target: Target | null): Isle[] {
  if (target && !target.guessed) return [];
  const all = [...islands].filter((i) => i.id !== LOOSE).map(({ id, title }) => ({ id, title }));
  return all.length > 1 ? all : [];
}

/** How long after asking for an agent the view waits for its tile. One that opens later is taken to be
 *  someone else's: the view does not pull the person away to it. */
export const START_WAIT = 15_000;

/** A tile the app opened, as its `tileOpened` event says. */
export interface Opened { frameId: string | null; agent?: string; spawnedBy?: string }

/** The agents the view's own buttons asked the app to start, until each one's tile opens. */
export class Starts {
  private asks: { agent: string | null; frameId: string | null; at: number }[] = [];

  /** Asked for `agent` (null: the person's default) on `frameId` (null: where the app chooses), now. */
  ask(agent: string | null, frameId: string | null): void {
    this.asks.push({ agent, frameId, at: Date.now() });
  }

  /** Whether the tile that just opened is an agent asked for here: an agent tile no other agent
   *  started, of the agent and on the island asked for (either one left to the app takes any), within
   *  START_WAIT of the ask. The ask it answers is used up. Timed by this side's clock, as the ask is:
   *  the host's may be another machine's. */
  opened(e: Opened): boolean {
    const now = Date.now();
    this.asks = this.asks.filter((a) => now - a.at <= START_WAIT);
    if (!e.agent || e.spawnedBy) return false;
    const i = this.asks.findIndex((a) => (a.agent === null || a.agent === e.agent) && (a.frameId === null || a.frameId === e.frameId));
    if (i < 0) return false;
    this.asks.splice(i, 1);
    return true;
  }
}
