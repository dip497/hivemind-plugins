/**
 * How the Blocks scenes paint a block's faces, pixel by pixel: in texels (a face is 8 by 8 of them,
 * whatever the block's size on the screen, so a block looks the same at any scale), each texel its
 * face's colour or a little lighter or darker by a fixed hash, so ground reads as grass, dirt or
 * stone without a picture of any. The back edges of a top catch the light; the top edge of a side is
 * a shade darker, so stacked blocks show their seams.
 */
import type { Rgb } from "./colour";
import { Face, mixRgb, type Paint } from "./iso";
import { hash2 } from "./rng";

/** A block's three face colours. */
export interface Faces {
  top: Rgb;
  left: Rgb;
  right: Rgb;
}

/** Texels along a face's edge. */
export const TEXELS = 8;
/** The most a texel is darkened toward black, or lightened toward white: the palettes' contrast
 *  bands allow for it (tests/blocks.test.ts). */
export const SPECK_DARK = 0.07;
export const SPECK_LIGHT = 0.07;
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

export const faceOf = (f: Faces, face: Face) => (face === Face.Top ? f.top : face === Face.Left ? f.left : f.right);
const texel = (u: number) => Math.min(TEXELS - 1, Math.floor(u * TEXELS));

/** The seam a texel is on, if any: a top's back edges catch the light; down a side, its top edge
 *  and its back edge are a shade darker and its front edge catches the light, so each block of a
 *  stack or a cliff shows. The colour, or null for a texel inside the face. */
function seam(c: Rgb, face: Face, tu: number, tv: number): Rgb | null {
  if (face === Face.Top) return tu === 0 || tv === 0 ? mixRgb(c, WHITE, SPECK_LIGHT) : null;
  if (tv === 0 || tu === 0) return mixRgb(c, BLACK, SPECK_DARK);
  if (tu === TEXELS - 1) return mixRgb(c, WHITE, SPECK_LIGHT * 0.8);
  return null;
}

/** Faces speckled lighter and darker, `density` of the texels each way, their seams showing. */
export function speckled(f: Faces, salt: number, density = 0.2, seams = true): Paint {
  return (face, u, v) => {
    const tu = texel(u);
    const tv = texel(v);
    const c = faceOf(f, face);
    const edge = seams ? seam(c, face, tu, tv) : null;
    if (edge) return edge;
    const h = hash2(tu + face * 17, tv + salt * 7, salt);
    if (h < density) return mixRgb(c, BLACK, SPECK_DARK * (0.6 + (h / density) * 0.4));
    if (h > 1 - density * 0.6) return mixRgb(c, WHITE, SPECK_LIGHT * 0.7);
    return c;
  };
}

/** A block with a turf on it: grass on top (a flower in it, if given), and down each side a band of
 *  grass with a ragged lower edge over the soil. */
export function turfed(grass: Faces, soil: Faces, salt: number, flower: Rgb | null = null, centre: Rgb | null = null): Paint {
  const top = speckled(grass, salt, 0.24);
  const side = speckled(soil, salt + 1, 0.22);
  const band = speckled(grass, salt + 2, 0.15);
  return (face, u, v) => {
    const tu = texel(u);
    const tv = texel(v);
    if (face === Face.Top) {
      if (flower) {
        // A flower of four petals round a middle, off to one side of the block.
        const fu = 2 + (salt % 3);
        const fv = 3 + (salt % 2);
        if (tu === fu && tv === fv) return centre ?? flower;
        if (Math.abs(tu - fu) + Math.abs(tv - fv) === 1) return flower;
      }
      return top(face, u, v);
    }
    // The turf's ragged edge: one or two texels deep, by column.
    const depth = 1 + (hash2(tu, face, salt + 5) < 0.45 ? 1 : 0);
    return tv < depth ? band(face, u, v) : side(face, u, v);
  };
}

/** Water: the surface in soft ripples a little lighter, the sides plain. */
export function watery(f: Faces, salt: number): Paint {
  return (face, u, v) => {
    if (face !== Face.Top) return faceOf(f, face);
    const tu = texel(u);
    const tv = texel(v);
    const h = hash2(tu, tv, salt);
    return (tu + tv * 2 + salt) % 5 === 0 && h < 0.6 ? mixRgb(f.top, WHITE, SPECK_LIGHT) : f.top;
  };
}

/** Wood: a trunk's bark in long grain down its sides, its rings on top. */
export function barked(f: Faces, salt: number): Paint {
  return (face, u, v) => {
    const tu = texel(u);
    const tv = texel(v);
    const c = faceOf(f, face);
    if (face === Face.Top) {
      const r = Math.max(Math.abs(tu - 3.5), Math.abs(tv - 3.5));
      return Math.round(r) % 2 === 0 ? mixRgb(c, WHITE, SPECK_LIGHT) : c;
    }
    const grain = hash2(tu, Math.floor(tv / 3), salt) < 0.35;
    return grain ? mixRgb(c, BLACK, SPECK_DARK) : c;
  };
}

/** Planks: boards across each face, a darker line between them. */
export function planked(f: Faces, salt: number): Paint {
  return (face, u, v) => {
    const tu = texel(u);
    const tv = texel(v);
    const c = faceOf(f, face);
    const row = face === Face.Top ? tu : tv;
    const along = face === Face.Top ? tv : tu;
    if (row % 3 === 2) return mixRgb(c, BLACK, SPECK_DARK);
    // A joint in each board, staggered.
    if ((along + Math.floor(row / 3) * 3 + salt) % 7 === 0) return mixRgb(c, BLACK, SPECK_DARK * 0.7);
    return c;
  };
}

/** Roof tiles: rows of tiles down the sides, each row's lower edge shaded. */
export function tiled(f: Faces): Paint {
  return (face, u, v) => {
    const tu = texel(u);
    const tv = texel(v);
    const c = faceOf(f, face);
    if (face === Face.Top) return (tu + tv) % 4 === 3 ? mixRgb(c, BLACK, SPECK_DARK * 0.7) : c;
    if (tv % 3 === 2) return mixRgb(c, BLACK, SPECK_DARK);
    return (tu + Math.floor(tv / 3) * 2) % 4 === 0 ? mixRgb(c, BLACK, SPECK_DARK * 0.5) : c;
  };
}

/** A face with a pane let into it (a window on the sides), framed, a cross of glazing bars over it. */
export function windowed(wall: Paint, pane: Rgb, frame: Rgb, sides: readonly Face[]): Paint {
  return (face, u, v) => {
    if (!sides.includes(face)) return wall(face, u, v);
    const tu = texel(u);
    const tv = texel(v);
    if (tu >= 2 && tu <= 5 && tv >= 2 && tv <= 5) {
      if (tu === 2 || tu === 5 || tv === 2 || tv === 5) return frame;
      return pane;
    }
    return wall(face, u, v);
  };
}

/** A face with a door in it, from the ground up, and its handle. */
export function doored(wall: Paint, door: Rgb, knob: Rgb, side: Face): Paint {
  return (face, u, v) => {
    if (face !== side) return wall(face, u, v);
    const tu = texel(u);
    const tv = texel(v);
    if (tu >= 2 && tu <= 5 && tv >= 1) return tu === 4 && tv === 4 ? knob : door;
    return wall(face, u, v);
  };
}
