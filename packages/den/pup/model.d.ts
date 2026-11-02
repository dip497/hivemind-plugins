// Types for model.js, so the Den wallpaper's TypeScript can use the pup.
import type * as THREE from "three";

export interface Coat { base: string; dark: string; cream: string; inner: string; tip: string; eye: string }
export const COATS: Record<"ash" | "ember" | "frost", Coat>;
export interface PupGeometry { geo: THREE.BufferGeometry; jawGeo: THREE.BufferGeometry; shape: unknown; buildMs: number; triangles: number }
export interface PupModel {
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  bones: Record<string, THREE.Bone>;
  skeleton: THREE.Skeleton;
  eyes: { pivot: THREE.Group; lidPivot: THREE.Group; glint: THREE.Mesh; glint2: THREE.Mesh; side: number }[];
  fur: { flow: { value: THREE.Vector3 }; comb: { value: THREE.Vector3 }; density: { value: number }; rim: { value: number }; coat: Record<string, { value: THREE.Color }> };
  mats: THREE.Material[];
  coat: Coat;
}
export function buildPupGeometry(opts?: { form?: Record<string, number>; step?: number }): PupGeometry;
export function buildPup(opts?: { coat?: Coat; form?: Record<string, number>; shells?: number; step?: number; geometry?: PupGeometry | null }): PupModel;
export function setCoat(fur: PupModel["fur"], coat: Coat): void;
