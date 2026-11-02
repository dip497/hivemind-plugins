// Look development: one pup on a plain ground under the game's light, for judging the
// character. Opened with #lookdev; tools/shot.mjs drives it through window.__den. Opened with
// #sprite, the pup stands on nothing but a soft shadow over a transparent page, for the frames of
// the Den widget's sprite sheet (tools/sprites.mjs).
import * as THREE from 'three';
import { buildPup, COATS } from '../../pup/model.js';
import { makeFace, updateFace } from '../../pup/face.js';
import { Animator } from '../../pup/pose.js';
import { mountPup, COM } from '../../pup/mount.js';

export function lookdev(canvas, { sprite = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: sprite, preserveDrawingBuffer: sprite });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bcd3d6');
  scene.fog = new THREE.Fog('#bcd3d6', 6, 14);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);
  const hemi = new THREE.HemisphereLight('#e8f1ff', '#6d7b4c', 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe4c2', 2.6);
  sun.position.set(2.5, 5, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -2; sun.shadow.camera.right = 2; sun.shadow.camera.top = 2; sun.shadow.camera.bottom = -2;
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.004;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: '#8fae6a', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  if (sprite) {
    scene.background = null;
    scene.fog = null;
    ground.visible = false;
    renderer.setClearColor(0x000000, 0);
    document.body.style.background = 'transparent';
    // A soft shadow under the pup, so it stands on something wherever the widget sits.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(20,16,12,0.42)');
    grd.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.62), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.002;
    scene.add(blob);
  }
  const coatName = new URLSearchParams(location.search).get('coat') || 'ash';
  const pup = buildPup({ coat: COATS[coatName] || COATS.ash });
  const mount = mountPup(pup);
  scene.add(mount.holder);
  const face = makeFace(pup);
  const anim = new Animator(pup);
  // A ball it can hold in its mouth (the widget's fetch), on the jaw so it opens with it.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.058, 24, 16), new THREE.MeshStandardMaterial({ color: '#c9dc3e', roughness: 0.85 }));
  ball.position.set(0.515 - 0.36, 0.556 - 0.575, 0);
  ball.castShadow = true;
  ball.visible = false;
  pup.bones.jaw.add(ball);
  // roll: over onto its back, about its length; turn: round on the spot, seen from where it was.
  const state = { yaw: -0.6, pitch: 0.18, dist: 2.4, lid: 0, mouth: 0, t: 0, auto: true, pose: 'stand', hang: 0, wag: 0, paddle: 0, look: [0, 0], ears: 0, shake: 0, phase: 0, vy: 0, lift: 0, flip: 0, roll: 0, turn: 0, ball: false };
  mount.holder.rotation.order = 'YXZ';

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function place() {
    const target = new THREE.Vector3(0.02, 0.42 + (state.ty || 0), 0);
    camera.position.set(target.x + Math.sin(state.yaw) * Math.cos(state.pitch) * state.dist, target.y + Math.sin(state.pitch) * state.dist, target.z + Math.cos(state.yaw) * Math.cos(state.pitch) * state.dist);
    camera.lookAt(target);
  }
  function frame(dt, draw = true) {
    state.t += dt;
    const m = { ...state };
    const moving = { run: 2.5, trot: 1.5, walk: 0.85 }[state.pose];
    if (moving) { m.speed = moving; state.phase += dt * (moving / (moving > 1.5 ? 0.8 : 0.34)) * Math.PI * 2; m.phase = state.phase; }
    anim.update(dt, moving ? 'stand' : state.pose, m);
    mount.holder.position.set(0, COM.y + state.lift, 0);
    mount.holder.rotation.set(state.roll, state.turn, state.hang + state.flip);
    ball.visible = state.ball;
    place();
    updateFace(face, dt, state.auto ? state.t : -1, { lidTarget: state.lid, mouth: state.mouth, camera, light: sun });
    if (draw) renderer.render(scene, camera);
  }
  resize();
  addEventListener('resize', resize);
  let last = performance.now();
  function loop(now) {
    if (!state.paused) frame(Math.max(0, Math.min(0.05, (now - last) / 1000)));
    last = now;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.__den = {
    ready: true,
    info: { buildMs: pup.root.userData.buildMs, triangles: pup.root.userData.triangles },
    set(o) { Object.assign(state, o); const n = 40 + Math.round((o.t || 0) * 100); for (let i = 0; i < n; i++) frame(1 / 60, i === n - 1); },
    // Exact control for the sprite tool: advance by n steps of dt, drawing after the last.
    advance(o, n, dt) {
      Object.assign(state, o);
      // Springs step stably only in small steps: split each dt into sixtieths.
      const sub = Math.max(1, Math.ceil(dt * 60 - 1e-6));
      for (let i = 0; i < n; i++) for (let j = 0; j < sub; j++) frame(dt / sub, i === n - 1 && j === sub - 1);
    },
    pup,
    anim,
    state,
    THREE,
  };
}
