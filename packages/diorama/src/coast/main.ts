/**
 * Coast, a live wallpaper: an endless coast seen from high above like a scale model, drawn in
 * coloured characters. The camera drifts along it for ever: waves roll in and break white on the
 * sand and round the rocks, grass leans in the wind on the clifftops, lanterns line the path past
 * cottages and now and then a lighthouse, boats ride at sea and gulls wheel over it all. The
 * pointer is a breeze through the grass; a click on the sea sends rings out across it.
 *
 * A world of its own: it draws none of the person's agents and never says one is under the pointer.
 */
import * as THREE from "three";
import { connectWallpaper, type WallpaperLook } from "@hivemind/view-sdk";
import { buildCoast, type Shared } from "./scene";
import { AsciiPass } from "./ascii";
import { CAMERA, place } from "./camera";
import { PERIOD, shoreZ } from "./world";

const wp = await connectWallpaper();
const canvas = document.body.appendChild(document.createElement("canvas"));
Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", display: "block" });
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 400);
const shared: Shared = {
  uTime: { value: 0 },
  uCenter: { value: new THREE.Vector2() },
  uGust: { value: new THREE.Vector3() },
  uRipples: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -1, 0)) },
};
buildCoast(scene, shared);
const ascii = new AsciiPass(renderer);

// Where it is along the coast, and the scene's own clock (taken round every PERIOD seconds, so it
// never grows past what a float holds well).
let x = CAMERA.start;
let t = 0;
let gust = 0, gustTo = 0;
const pointer = new THREE.Vector2();
let ripple = 0;

wp.on("viewport", ({ w, h, dpr }) => {
  renderer.setPixelRatio(Math.min(dpr, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  ascii.resize(w, h, Math.min(dpr, 2));
});
wp.on("look", (look: WallpaperLook) => ascii.setLook(look));

// The pointer: a breeze through the grass round it. A click: rings across the sea, or a gust.
const ray = new THREE.Raycaster();
const onGround = (px: number, py: number) => {
  const { w, h } = wp.viewport;
  ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), camera);
  const hit = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.5), hit) ? hit : null;
};
wp.on("pointer", ({ x: px, y: py, over }) => {
  const at = over && wp.mode === "run" ? onGround(px, py) : null;
  if (at) pointer.set(at.x, at.z);
  gustTo = at ? 0.6 : 0;
});
wp.on("click", ({ x: px, y: py }) => {
  if (wp.mode !== "run") return;
  const at = onGround(px, py);
  if (!at) return;
  if (at.z > shoreZ(at.x)) {
    shared.uRipples.value[ripple % 4]!.set(at.x, at.z, t, 0);
    ripple++;
  } else {
    pointer.set(at.x, at.z);
    gust = 1.6;
  }
});

function frame() {
  const target = place(camera, x, t);
  shared.uCenter.value.set(target.x, target.z);
  shared.uTime.value = t;
  shared.uGust.value.set(pointer.x, pointer.y, gust);
}

wp.animate({
  step: (dt) => {
    t = (t + dt) % PERIOD;
    x = (x + CAMERA.speed * dt) % PERIOD;
    gust += (gustTo - gust) * Math.min(1, dt * 3);
  },
  draw: () => {
    frame();
    ascii.render(scene, camera, t);
  },
  // A still picture is the coast where it is now, the wind and the waves as they are: nothing to
  // settle, and the same picture each time it is asked for.
  settle: () => {},
});
