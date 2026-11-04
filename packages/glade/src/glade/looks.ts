/**
 * How the glade is lit on each theme. On a dark theme it is night: moonlight, the fire, the lamps,
 * fireflies. On a light theme it is a misty morning: the sun low through the trees, the lamps out,
 * the fire burnt down, the whole picture pale enough for a frosted panel's text to read over it.
 * With Colour off, either is drawn in the theme's two colours instead.
 *
 * Colours here are linear light, except the paper and the theme's page and text, which are as the
 * screen shows them.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import type { Scene } from "./render";
import { weather, type Life } from "./life";

type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const screen = (hex: string): V3 => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

export interface Lighting {
  night: boolean;
  fire: number;
  lamps: number;
  base: Omit<Scene, "time" | "wind" | "lights" | "lightCount" | "sprites" | "spriteCount" | "ripples" | "mist" | "wet" | "rain">;
  /** Mist at its least, and how much more the weather adds. */
  mist: [number, number];
}

const NIGHT: Omit<Lighting, "base"> & { base: Omit<Lighting["base"], "theme" | "darkTheme" | "page" | "text"> } = {
  night: true, fire: 2.7, lamps: 1, mist: [0.12, 0.5],
  base: {
    moonDir: norm([-0.35, 0.75, 0.55]), moon: [0.1, 0.125, 0.22],
    skyAmb: [0.03, 0.037, 0.066], groundAmb: [0.008, 0.009, 0.013],
    fog: [0.014, 0.018, 0.032], fogK: 1 / 190, fogMax: 0.92,
    rainCol: [0.06, 0.07, 0.09], stillGlow: 1, sheen: [0.006, 0.009, 0.018, 0.5],
    skyLift: 1, stars: 1, skyMix: 0, skyTop: [0, 0, 0], skyBottom: [0, 0, 0],
    exposure: 1.05, glow: 1.0, vignette: 0.55, paper: [1, 1, 1], lo: 0, hi: 1, chroma: 1,
  },
};

const MORNING: typeof NIGHT = {
  night: false, fire: 0.7, lamps: 0, mist: [0.05, 0.35],
  base: {
    moonDir: norm([-0.55, 0.7, 0.45]), moon: [0.95, 0.86, 0.7],
    skyAmb: [0.42, 0.46, 0.52], groundAmb: [0.16, 0.16, 0.14],
    fog: [0.72, 0.75, 0.76], fogK: 1 / 190, fogMax: 0.4,
    rainCol: [0.5, 0.55, 0.6], stillGlow: 0.25, sheen: [0.25, 0.3, 0.36, 0.6],
    skyLift: 0, stars: 0, skyMix: 1, skyTop: [0.5, 0.6, 0.72], skyBottom: [0.8, 0.8, 0.76],
    exposure: 1.1, glow: 0.4, vignette: 0, paper: [1, 0.985, 0.955], lo: 0.74, hi: 1.0, chroma: 0.75,
  },
};

export function lighting(look: WallpaperLook): Lighting {
  const l = look.dark ? NIGHT : MORNING;
  return { ...l, base: { ...l.base, theme: !look.colour, darkTheme: look.dark, page: screen(look.page), text: screen(look.text) } };
}

/** The frame's scene: the look's lighting, and what the life and the weather give it now. */
export function sceneOf(light: Lighting, life: Life): Scene {
  life.night = light.night;
  life.collect(light.fire, light.lamps);
  const w = weather(life.t);
  return {
    ...light.base,
    time: life.t,
    wind: 0.55 + 0.3 * Math.sin(life.t * 0.05) + w.rain * 0.5,
    lights: life.lights, lightCount: life.lightCount,
    sprites: life.sprites, spriteCount: life.spriteCount,
    ripples: life.rippleData,
    mist: light.mist[0] + (w.mist - 0.15) * light.mist[1],
    wet: w.wet, rain: w.rain,
    // Cloud comes over with the rain: the stars and the moon dim.
    stars: light.base.stars * (1 - w.rain * 0.85),
  };
}
