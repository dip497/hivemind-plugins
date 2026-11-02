// The page film.ts and perf.ts drive: the Coast's own scene and characters, drawn one frame at a time
// at a time the film names, with the gust and ripples the pointer and clicks would give it. It draws
// what main.ts draws, without the clock, so a slow machine still makes a smooth film.
import * as THREE from "three";
import { buildCoast, type Shared } from "../src/coast/scene";
import { AsciiPass } from "../src/coast/ascii";
import { CAMERA, place } from "../src/coast/camera";
import type { WallpaperLook } from "@hivemind/view-sdk";

let ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; shared: Shared; ascii: AsciiPass; canvas: HTMLCanvasElement };
const w = window as unknown as Record<string, unknown>;

w.init = (width: number, height: number, look: WallpaperLook, dpr = 1) => {
  const canvas = document.body.appendChild(document.createElement("canvas"));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, width / height, 1, 400);
  const shared: Shared = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uGust: { value: new THREE.Vector3() },
    uRipples: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -1, 0)) },
  };
  buildCoast(scene, shared);
  const ascii = new AsciiPass(renderer);
  ascii.resize(width, height, dpr);
  ascii.setLook(look);
  ctx = { renderer, scene, camera, shared, ascii, canvas };
};

/** Frames at 30 a second from the start, each timed from the first call to the last pixel drawn. */
w.measure = (n: number) => {
  const gl = ctx.renderer.getContext(), px = new Uint8Array(4), times: number[] = [];
  for (let f = 0; f < n; f++) {
    const t = f / 30, t0 = performance.now();
    const target = place(ctx.camera, CAMERA.start + CAMERA.speed * t, t);
    ctx.shared.uCenter.value.set(target.x, target.z);
    ctx.shared.uTime.value = t;
    ctx.ascii.render(ctx.scene, ctx.camera, t);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the frame to be drawn
    times.push(performance.now() - t0);
  }
  return times;
};

/** One frame at x along the coast and scene time t; returns it as a JPEG data URL. */
w.frame = (x: number, t: number, gust: [number, number, number], ripples: [number, number, number][]) => {
  const target = place(ctx.camera, x, t);
  ctx.shared.uCenter.value.set(target.x, target.z);
  ctx.shared.uTime.value = t;
  ctx.shared.uGust.value.set(...gust);
  ripples.forEach((r, i) => ctx.shared.uRipples.value[i]!.set(r[0], r[1], r[2], 0));
  ctx.ascii.render(ctx.scene, ctx.camera, t);
  return ctx.canvas.toDataURL("image/jpeg", 0.92);
};

/** Where a point on the screen lands on the ground, as main.ts has it for the pointer and clicks. */
w.ground = (px: number, py: number, width: number, height: number) => {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((px / width) * 2 - 1, -(py / height) * 2 + 1), ctx.camera);
  const hit = new THREE.Vector3();
  ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.5), hit);
  return [hit.x, hit.z];
};
