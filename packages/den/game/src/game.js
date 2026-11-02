// The feel test: one pup in the clearing, your hand, a camera that keeps the pup in view.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Pup, ctxCam } from './pup.js';
import { COATS } from '../../pup/model.js';
import { Hand } from './hand.js';
import { Voice } from './voice.js';
import { makeDust } from './effects.js';
import { makeHud, loadTune } from './hud.js';

export function game(canvas) {
  const small = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const quality = small ? 0.6 : 1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  const world = buildWorld(scene, { quality });
  const dust = makeDust(scene);
  const tune = loadTune();
  const voice = new Voice(1000);
  const hud = makeHud(tune, voice);

  const view = { target: new THREE.Vector3(0.2, 0.62, 0.6), dist: 7, height: 3.5, shake: 0 };
  const ELEV = THREE.MathUtils.degToRad(17);
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const wantW = camera.aspect >= 1 ? 4.4 : 2.5;
    view.dist = Math.max(wantW / (2 * tanH * camera.aspect), 2.7 / (2 * tanH));
    view.height = 2 * view.dist * tanH;
  }
  resize();
  addEventListener('resize', resize);

  let pup = null, hand = null;
  const events = {
    onApex: (m) => hud.onApex(m),
    onCatch: () => hud.onCatch(),
    onPet: () => hud.onPet(),
    onLand: (m, tossed) => hud.onLand(m, tossed),
    onImpact: (p, s) => {
      dust.puff(p, Math.min(1, s / 12));
      view.shake = Math.max(view.shake, Math.min(0.07, s * 0.005) * tune.shake);
    },
  };

  // Building the pup takes a moment; paint the clearing first.
  renderer.render(scene, camera);
  setTimeout(() => {
    pup = new Pup({ coat: COATS.ash, shells: small ? 8 : 12, step: small ? 0.0125 : 0.0105, voice, tune, events, solid: world.solid });
    scene.add(pup.object);
    // A throw is measured in screen heights per second, so it feels the same on any screen.
    const handEvents = {};
    hand = new Hand(canvas, camera, pup, voice, handEvents);
    const release = pup.release.bind(pup);
    pup.release = (v) => release(v.multiplyScalar(5.2 / view.height));
    hud.loaded();
    window.__den.pup = pup;
    window.__den.hand = hand;
    window.__den.ready = true;
  }, 30);

  const clock = new THREE.Clock();
  let t = 0;
  let paused = false;
  function tick(dt) {
    t += dt;
    if (pup) {
      hand.update();
      ctxCam.copy(camera.position);
      pup.update(dt, t, { camera, sun: world.sun, pointerWorld: hand.pointerWorld() });
      // Follow: drift a little with the pup, and rise to keep a toss in view.
      const goal = new THREE.Vector3(pup.p.x * 0.45, 0.62, 0.35 + pup.p.z * 0.3);
      const top = goal.y + view.height * 0.16;
      const ahead = pup.p.y + Math.max(0, pup.v.y) * 0.14;
      if (ahead > top) goal.y += ahead - top;
      view.target.lerp(goal, 1 - Math.exp(-(ahead > top ? 9 : 3) * dt));
      world.update(t, pup.p);
    } else {
      world.update(t, view.target);
    }
    dust.update(dt);
    view.shake *= Math.exp(-9 * dt);
    const sh = view.shake;
    camera.position.set(
      view.target.x + (Math.random() - 0.5) * sh,
      view.target.y + Math.sin(ELEV) * view.dist + (Math.random() - 0.5) * sh,
      view.target.z + Math.cos(ELEV) * view.dist,
    );
    camera.lookAt(view.target.x, view.target.y, view.target.z);
    camera.updateMatrixWorld();
  }
  function draw() {
    renderer.render(scene, camera);
    if (pup) {
      const head = pup.p.clone().add(new THREE.Vector3(0, 0.55, 0)).project(camera);
      const r = canvas.getBoundingClientRect();
      hud.place((head.x * 0.5 + 0.5) * r.width, (-head.y * 0.5 + 0.5) * r.height);
    }
  }
  function frame() {
    const dt = Math.min(1 / 30, clock.getDelta());
    if (!paused) { tick(dt); draw(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__den = {
    ready: false, renderer, camera, scene, tune, view, voice, THREE,
    // For tests: stop the clock, advance it by whole frames, draw one frame.
    pause(on = true) { paused = on; clock.getDelta(); },
    step(seconds, fps = 60) { const n = Math.round(seconds * fps); for (let i = 0; i < n; i++) tick(1 / fps); },
    stats() { const r = renderer.info.render; return { calls: r.calls, triangles: r.triangles }; },
    draw,
  };
}
