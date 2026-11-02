// Types for mount.js.
import type * as THREE from "three";
import type { PupModel } from "./model";

export const COM: THREE.Vector3;
export const SCRUFF: THREE.Vector3;
export function mountPup(pup: PupModel): { holder: THREE.Group; squash: THREE.Group };
