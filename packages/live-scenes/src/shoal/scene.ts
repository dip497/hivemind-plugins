/** Shoal: a reef's water seen from above, schools of small fish and the sharks that hunt them, a
 *  shark of every kind. */
import { World, type Habits } from "../world";
import { SHARK_KINDS } from "./shapes";

/** What a shark does of its own accord: hunts a while, cruises, and now and then rests near the
 *  bottom, over the reef. */
const HABITS: Habits = {
  hunt: { odds: 0.4, secs: [10, 22] },
  cruise: { odds: 0.45, secs: [14, 30] },
  rest: { odds: 0.15, secs: [12, 24], band: [0.72, 0.92] },
};

/** A shark to each 160,000 px² of window (eight, one of each kind, on a laptop's), at most twelve,
 *  a little smaller than the original's four, so as many sharks cover as much of the water. */
export const shoalWorld = () => new World({ kinds: SHARK_KINDS, stock: { area: 160_000, max: 12 }, habits: HABITS, share: 0.31 });
