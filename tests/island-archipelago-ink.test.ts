// Island and Archipelago write on the theme's own colours: a calling agent's name, the arrow to it and
// the bell's count on the attention colour, the primary buttons on the accent. A preset or a person may
// give either any colour, so the ink is worked out from it, and has to read on every one.
import { expect, test } from "bun:test";
import * as island from "../views/island/src/world";
import * as archipelago from "../packages/archipelago/views/archipelago/src/world";

/** WCAG 2 contrast of two `#rgb` or `#rrggbb` colours, worked out here and not by the views. */
const luminance = (hex: string) => {
  if (hex.length === 4) hex = hex.replace(/\w/g, "$&$&");
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

test("Island and Archipelago: the ink for words on the attention or accent colour reads at 4.5:1 on any colour a theme gives", () => {
  const steps = Array.from({ length: 18 }, (_, i) => (i * 15).toString(16).padStart(2, "0"));
  // Every colour on a grid through sRGB, and those the fixed inks failed on: Clean Light's attention,
  // a dark custom attention, Signal's near-white working, and the accents white was unreadable on.
  const fills = [
    ...steps.flatMap((r) => steps.flatMap((g) => steps.map((b) => `#${r}${g}${b}`))),
    "#a35f00", "#3a2a00", "#e2e5e9", "#5b6cff", "#38bdf8", "#a78bfa", "#b6f23f", "#fbbf24", "#34d399", "#5f6b7a",
  ];
  for (const view of [island, archipelago]) {
    expect(fills.filter((fill) => contrast(view.inkOn(fill), fill) < 4.5)).toEqual([]);
  }
});

/** Hue (degrees), saturation and lightness of `#rrggbb`, worked out here and not by the views. */
const hsl = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
  return { h, s, l };
};

test("Island and Archipelago: a calling agent's beam and ring keep the attention colour's hue, never darker than half lit", () => {
  const steps = Array.from({ length: 18 }, (_, i) => (i * 15).toString(16).padStart(2, "0"));
  // The grid, Clean Light's attention (a dark amber, for words on a pale page, that a sunlit sea drew
  // black) and the dark presets' ambers, which are lit already and stay as they are.
  const fills = [...steps.flatMap((r) => steps.flatMap((g) => steps.map((b) => `#${r}${g}${b}`))), "#964e00", "#a35f00", "#f59e0b", "#e0af68"];
  for (const view of [island, archipelago]) {
    const wrong = fills.filter((fill) => {
      const a = hsl(fill), b = hsl(view.lit(fill));
      const turned = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
      return b.l < 0.5 - 1 / 255 || (a.s > 0.05 && turned > 2) || Math.abs(a.s - b.s) > 0.03 || (a.l >= 0.5 && view.lit(fill) !== fill);
    });
    expect(wrong).toEqual([]);
  }
});
