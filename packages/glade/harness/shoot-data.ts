// What the harness gives the Glade: the looks, and the agents and tiles the app would send with them
// (a world of its own, it draws none of them; the tiles are laid over its pictures as panels).
export const LOOKS = {
  dark: { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "monospace" },
  light: { page: "#f5f3ee", text: "#26282b", attention: "#c77d12", dark: false, colour: false, mono: "monospace" },
};
export const CREATURES = [
  { id: "a", agent: "claude", kind: 0.1, size: 1, state: "working" },
  { id: "b", agent: "codex", kind: 0.35, size: 0.9, state: "ready" },
  { id: "c", agent: "claude", kind: 0.1, size: 0.95, state: "needs-you" },
  { id: "d", agent: "gemini", kind: 0.55, size: 0.85, state: "resting" },
  { id: "e", agent: "amp", kind: 0.8, size: 0.92, state: "working" },
] as const;
export const TILES = [
  { x0: 0, y0: 0, x1: 230, y1: 800 },
  { x0: 420, y0: 120, x1: 840, y1: 430, id: "c" },
  { x0: 900, y0: 470, x1: 1250, y1: 720, id: "b" },
];
