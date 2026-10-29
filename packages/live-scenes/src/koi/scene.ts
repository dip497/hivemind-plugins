/** Koi Pond: koi under lily pads, a koi of every variety, and fry darting between them. The World
 *  swims them as it does Shoal's sharks; the renderer draws the pond. */
import type { Species } from "../species";
import { World, type Habits } from "../world";
import { KOI_KINDS } from "./shapes";

/** The pond's small fish: fry in loose schools, and medaka, which wander. */
const FRY: Species[] = [
  {
    name: "fry",
    cruise: 30, maxSpeed: 58, minSpeed: 12, weight: 2,
    schoolSize: [8, 14], spacing: [1.6, 1.1],
    align: 2.2, cohesion: 1.2, jitter: 40, mill: 0, verticalDrag: 0.8,
  },
  {
    name: "medaka",
    cruise: 24, maxSpeed: 50, minSpeed: 10, weight: 1,
    schoolSize: [5, 9], spacing: [1.8, 1.2],
    align: 1.1, cohesion: 1, jitter: 70, mill: 0, verticalDrag: 0.6,
  },
];

/** What a koi does of its own accord: cruises mostly, idles deep and slow, comes up to mouth at the
 *  surface, and now and then goes after the fry. */
const HABITS: Habits = {
  cruise: { odds: 0.5, secs: [12, 26] },
  rest: { odds: 0.18, secs: [10, 22] },
  surface: { odds: 0.2, secs: [6, 12] },
  hunt: { odds: 0.12, secs: [8, 14] },
};

/** A koi to each 130,000 px² of window (ten on a laptop's, one of each variety at least), at most
 *  fourteen; smaller than sharks against the window, and the pond holds a third of the fish. Koi
 *  are tame: they come to the pointer and to food. */
export const koiWorld = () =>
  new World({ kinds: KOI_KINDS, stock: { area: 130_000, max: 14 }, habits: HABITS, tame: true, share: 0.17, species: FRY, fishArea: 14000 });
