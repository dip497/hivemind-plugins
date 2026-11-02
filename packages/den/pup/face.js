// The face each frame: lids that blink and narrow with mood, catchlights that sit where
// the light and the camera would put them, and the jaw that opens with the voice.
import * as THREE from 'three';
import { FACE } from './shape.js';

const LID_OPEN = 1.02; // open, but the lid still trims the top of the eye (the camera looks down on it)
const LID_SHUT = -1.42;
const v = new THREE.Vector3();
const w = new THREE.Vector3();
const q = new THREE.Quaternion();
const eyeWorld = new THREE.Vector3();

export function makeFace(pup) {
  return { blinkAt: 1.5, blink: 0, lid: 0, jaw: 0, jawVel: 0, pup };
}

// lidTarget: 0 open .. 1 shut (0.45 reads as a happy squint). mouth: 0..1 how far open.
export function updateFace(face, dt, t, { lidTarget = 0, mouth = 0, camera, light }) {
  if (t > face.blinkAt) {
    face.blink = 1;
    face.blinkAt = t + 1.8 + Math.random() * 3.4;
  }
  face.blink = Math.max(0, face.blink - dt * 7);
  const closing = Math.max(lidTarget, Math.sin(face.blink * Math.PI));
  face.lid += (closing - face.lid) * Math.min(1, dt * 22);

  // The jaw is a stiff spring so a yip snaps open and a squeal holds.
  const k = 380, c = 26;
  face.jawVel += (k * (mouth - face.jaw) - c * face.jawVel) * dt;
  face.jaw += face.jawVel * dt;
  face.pup.bones.jaw.rotation.z = -Math.max(0, face.jaw) * 0.42;

  for (const e of face.pup.eyes) {
    e.lidPivot.rotation.z = LID_OPEN + (LID_SHUT - LID_OPEN) * face.lid;
    e.pivot.getWorldPosition(eyeWorld);
    e.pivot.getWorldQuaternion(q).invert();
    const toCam = v.copy(camera.position).sub(eyeWorld).normalize();
    const toLight = w.copy(light.position).sub(light.target.position).normalize();
    const main = toCam.clone().multiplyScalar(0.62).add(toLight.multiplyScalar(0.38)).add(new THREE.Vector3(0, 0.2, 0)).normalize().applyQuaternion(q);
    e.glint.position.copy(main).multiplyScalar(FACE.eyeR * 0.9);
    const low = toCam.clone().add(new THREE.Vector3(0, -0.55, 0)).normalize().applyQuaternion(q);
    e.glint2.position.copy(low).multiplyScalar(FACE.eyeR * 0.95);
    const shown = face.lid < 0.55;
    e.glint.visible = shown;
    e.glint2.visible = face.lid < 0.3;
  }
}
