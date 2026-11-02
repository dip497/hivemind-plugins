// Puts a pup model in a holder whose origin is the pup's centre of mass, so the game can
// move, spin and squash it there. Squash scales about the centre; keep the feet on the
// ground by holding the centre at COM.y * scale.y while standing.
import * as THREE from 'three';

export const COM = new THREE.Vector3(0.0, 0.36, 0);
export const SCRUFF = new THREE.Vector3(0.19, 0.67, 0);

export function mountPup(pup) {
  const holder = new THREE.Group();
  const squash = new THREE.Group();
  holder.add(squash);
  squash.add(pup.root);
  pup.root.position.copy(COM).negate();
  holder.rotation.order = 'YZX';
  return { holder, squash };
}
