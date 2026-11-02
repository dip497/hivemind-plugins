/**
 * The camera: high above the coast and looking steeply down through a long lens, like a photograph
 * of a model, turned so the coast runs across the view at a slant, sea below and land above. It
 * drifts along x for ever, keeping the water's edge a little below the middle of the view, and
 * sways a few degrees either way over a minute.
 */
import * as THREE from "three";
import { shoreZ } from "./world";

export const CAMERA = {
  fov: 23, distance: 82, elevation: 58, yaw: 24,
  /** Units a second along the coast: a screen's width in about half a minute. */
  speed: 1.4,
  /** Where along the coast it starts, and where a still picture is taken from. */
  start: 333,
};

const rad = (d: number) => (d * Math.PI) / 180;

/** The water's edge near x, averaged over a stretch either side, so the camera does not wobble. */
export function coastNear(x: number) {
  let s = 0;
  for (let k = -4; k <= 4; k++) s += shoreZ(x + k * 7);
  return s / 9;
}

/** Point `camera` at the coast at x, at scene time t; returns where it looks. */
export function place(camera: THREE.PerspectiveCamera, x: number, t: number) {
  // The water's edge a little below the middle: the land, its path and its cottages in the sharp band.
  const target = new THREE.Vector3(x, 2, coastNear(x) - 9);
  const yaw = rad(CAMERA.yaw + 3 * Math.sin((t / 60) * Math.PI * 2));
  const el = rad(CAMERA.elevation), r = CAMERA.distance;
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(el) * r, target.y + Math.sin(el) * r, target.z + Math.cos(yaw) * Math.cos(el) * r);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return target;
}
