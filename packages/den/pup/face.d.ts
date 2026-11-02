// Types for face.js.
import type * as THREE from "three";
import type { PupModel } from "./model";

export interface Face { blinkAt: number; blink: number; lid: number; jaw: number; jawVel: number; pup: PupModel }
export function makeFace(pup: PupModel): Face;
export function updateFace(face: Face, dt: number, t: number, o: { lidTarget?: number; mouth?: number; camera: THREE.Camera; light: THREE.DirectionalLight }): void;
