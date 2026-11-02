// Look development: one pup on a plain ground under the game's light, for judging the
// character. Opened with #lookdev; tools/shot.mjs drives it through window.__den.
import * as THREE from 'three';
import { buildPup, COATS } from '../../pup/model.js';
import { makeFace, updateFace } from '../../pup/face.js';
import { Animator } from '../../pup/pose.js';
import { mountPup, COM } from '../../pup/mount.js';

export function lookdev(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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

  const coatName = new URLSearchParams(location.search).get('coat') || 'ash';
  const pup = buildPup({ coat: COATS[coatName] || COATS.ash });
  const mount = mountPup(pup);
  scene.add(mount.holder);
  const face = makeFace(pup);
  const anim = new Animator(pup);
  const state = { yaw: -0.6, pitch: 0.18, dist: 2.4, lid: 0, mouth: 0, t: 0, auto: true, pose: 'stand', hang: 0, wag: 0, paddle: 0, look: [0, 0], ears: 0, shake: 0, phase: 0, vy: 0, lift: 0, flip: 0 };

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
    const moving = { run: 2.5, walk: 0.85 }[state.pose];
    if (moving) { m.speed = moving; state.phase += dt * (moving / (moving > 1.5 ? 0.8 : 0.34)) * Math.PI * 2; m.phase = state.phase; }
    anim.update(dt, moving ? 'stand' : state.pose, m);
    mount.holder.position.set(0, COM.y + state.lift, 0);
    mount.holder.rotation.set(0, 0, state.hang + state.flip);
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
    pup,
    anim,
    state,
    THREE,
  };
}
