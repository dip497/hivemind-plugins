// The clearing: a meadow floor, grass that sways, pines around the edge, the den mound,
// rocks and a log, under a warm afternoon sun whose shadow follows the pup.
import * as THREE from 'three';
import { Colliders } from './colliders.js';

export const CLEARING = 4.2; // how far from the centre the pup may go

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#86a35a';
  g.fillRect(0, 0, 512, 512);
  const r = rng(7);
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = r() * 512, rad = 20 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const l = 36 + r() * 14;
    grd.addColorStop(0, `hsla(${78 + r() * 20}, 34%, ${l}%, 0.35)`);
    grd.addColorStop(1, `hsla(${78 + r() * 20}, 34%, ${l}%, 0)`);
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 5000; i++) {
    const x = r() * 512, y = r() * 512, s = 1 + r() * 1.5;
    const l = 38 + r() * 18, h = 75 + r() * 25;
    g.fillStyle = `hsla(${h}, ${30 + r() * 14}%, ${l}%, ${0.18 + r() * 0.22})`;
    g.fillRect(x, y, s, s * (1 + r() * 2.5));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildWorld(scene, { quality = 1 } = {}) {
  const r = rng(11);
  const solid = new Colliders();
  const fogColor = new THREE.Color('#c9dccf');
  scene.fog = new THREE.Fog(fogColor, 9, 24);

  const hemi = new THREE.HemisphereLight('#eaf3ff', '#5f6f3c', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe2bd', 2.7);
  sun.position.set(3.2, 6.5, 4.5);
  sun.castShadow = true;
  const sm = quality > 0.6 ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -2.6; sc.right = 2.6; sc.top = 2.6; sc.bottom = -2.6; sc.near = 0.5; sc.far = 20;
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.004;
  scene.add(sun, sun.target);
  const sunOffset = sun.position.clone();

  // Floor: a wide disc that fades into the fog; a softer, lighter patch where the pup plays.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 96), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const patchTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(214,206,150,0.55)');
    grd.addColorStop(0.6, 'rgba(190,190,120,0.25)');
    grd.addColorStop(1, 'rgba(190,190,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshStandardMaterial({ map: patchTex, transparent: true, depthWrite: false, roughness: 1 }));
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = 0.002;
  patch.receiveShadow = true;
  scene.add(patch);

  // Grass: instanced blades, short in the middle, taller toward the trees, swaying.
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.008, 0, 0, 0.008, 0, 0, 0.004, 0.5, 0, -0.004, 0.5, 0, 0, 1, 0], 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1], 3));
  blade.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4]);
  const count = Math.round(7000 * quality);
  const grassMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, side: THREE.DoubleSide });
  const wind = { value: 0 };
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float bend = position.y * position.y;
vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float sway = sin(uWind * 1.7 + wp.x * 0.9 + wp.z * 0.6) * 0.5 + sin(uWind * 3.1 + wp.x * 2.3) * 0.2;
transformed.x += sway * bend * 0.18;
transformed.z += sway * bend * 0.08;`,
      );
  };
  const grass = new THREE.InstancedMesh(blade, grassMat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let x, z, d;
    do {
      x = (r() * 2 - 1) * 9;
      z = -9 + r() * 12.5;
      d = Math.hypot(x, z);
    } while (z > 2.6 && Math.abs(x) < 2.6 + (z - 2.6) * 1.6);
    p.set(x, 0, z);
    const tall = Math.min(1, Math.max(0, (d - 2.4) / 3.5));
    const h = 0.04 + r() * 0.05 + tall * (0.1 + r() * 0.2);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI);
    s.set(1 + r(), h, 1);
    m4.compose(p, q, s);
    grass.setMatrixAt(i, m4);
    col.setHSL(0.2 + r() * 0.05, 0.3 + r() * 0.1, 0.42 + r() * 0.1);
    grass.setColorAt(i, col);
  }
  grass.receiveShadow = true;
  scene.add(grass);

  // Flowers: small pale heads scattered in the taller grass.
  const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.022, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.round(260 * quality));
  for (let i = 0; i < fl.count; i++) {
    const a = r() * Math.PI * 2, d = 2.4 + r() * 6;
    p.set(Math.cos(a) * d, 0.12 + r() * 0.12, Math.sin(a) * d);
    m4.compose(p, q.identity(), s.set(1, 1, 1));
    fl.setMatrixAt(i, m4);
    fl.setColorAt(i, col.set(['#f4efe1', '#f2d46b', '#c9b6e6', '#f3f0f7'][(r() * 4) | 0]));
  }
  scene.add(fl);

  // Pines around the clearing: stacked soft cones, a few nearer ones to frame the view.
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4334', roughness: 1 });
  const needleMats = ['#3c5f43', '#46694a', '#36553f', '#52754c'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  const pine = (x, z, h) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * h, 0.11 * h, 0.9 * h, 7), trunkMat);
    trunk.position.y = 0.45 * h;
    trunk.castShadow = true;
    g.add(trunk);
    const tiers = 4;
    const mat = needleMats[(r() * needleMats.length) | 0];
    for (let i = 0; i < tiers; i++) {
      const w = (0.95 - i * 0.18) * h * (0.9 + r() * 0.2);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(w * 0.62, h * 0.85, 20, 1), mat);
      cone.position.y = h * (0.75 + i * 0.42);
      cone.rotation.y = r() * Math.PI;
      cone.castShadow = true;
      cone.receiveShadow = true;
      g.add(cone);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  };
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI * 0.05 - r() * Math.PI * 1.1;
    const d = 6.2 + r() * 5;
    pine(Math.cos(a) * d * 1.25, Math.sin(a) * d, 1.4 + r() * 1.4);
  }
  pine(-5.6, 1.6, 2.2);
  pine(6.0, 1.2, 2.5);
  // Soft bushes framing the sides.
  const bushMat = new THREE.MeshStandardMaterial({ color: '#557a45', roughness: 1 });
  for (const [x, z, sz] of [[-3.6, -0.6, 0.55], [-3.1, -0.2, 0.4], [3.7, 0.2, 0.6], [3.2, 0.6, 0.38], [-4.4, 1.4, 0.7], [4.6, 1.8, 0.65]]) {
    for (let k = 0; k < 3; k++) {
      const R = sz * (0.7 + r() * 0.4);
      const b = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), bushMat);
      b.position.set(x + (r() - 0.5) * sz, sz * 0.45, z + (r() - 0.5) * sz * 0.8);
      solid.dome(b.position.x, b.position.z, R * 0.95, R * 0.95, sz * 0.45 + R * 0.72, 0, false, false);
      b.scale.y = 0.75;
      b.castShadow = b.receiveShadow = true;
      scene.add(b);
    }
  }

  // The den: a low grassy mound with a dark, soft-edged mouth, back left.
  const den = new THREE.Group();
  const moundGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const mcol = [];
  const mp = moundGeo.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    col.setHSL(0.21 + (r() - 0.5) * 0.02, 0.32, 0.25 + y * 0.1 + (r() - 0.5) * 0.03);
    mcol.push(col.r, col.g, col.b);
  }
  moundGeo.setAttribute('color', new THREE.Float32BufferAttribute(mcol, 3));
  const mound = new THREE.Mesh(moundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mound.scale.set(1.45, 0.62, 1.15);
  mound.receiveShadow = true;
  mound.castShadow = true;
  den.add(mound);
  const holeTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 70, 8, 64, 64, 62);
    grd.addColorStop(0, 'rgba(14,10,7,1)');
    grd.addColorStop(0.62, 'rgba(26,19,13,0.95)');
    grd.addColorStop(1, 'rgba(60,45,30,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.66), new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false }));
  mouth.position.set(0.42, 0.2, 1.07);
  mouth.rotation.set(-0.28, 0.36, 0);
  den.add(mouth);
  den.position.set(-2.9, 0, -2.6);
  den.rotation.y = 0.2;
  solid.dome(-2.9, -2.6, 1.45, 1.15, 0.62, 0.2, true);
  scene.add(den);

  // Rocks and a log.
  const rockMat = new THREE.MeshStandardMaterial({ color: '#8e8c84', roughness: 0.92 });
  for (const [x, z, sz] of [[-1.7, -2.2, 0.32], [-1.3, -2.55, 0.2], [2.6, -2.4, 0.42], [3.1, -1.9, 0.22], [-3.6, 0.6, 0.28]]) {
    const geo = new THREE.SphereGeometry(sz, 28, 18); // indexed, so the bumps shade smooth
    const pos = geo.attributes.position;
    const sd = r() * 10;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const k = 1 + 0.12 * Math.sin(p.x * 9 + sd) * Math.sin(p.y * 7 + sd * 2) + 0.07 * Math.sin(p.z * 15 + sd);
      p.multiplyScalar(k);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, rockMat);
    rock.position.set(x, sz * 0.35, z);
    solid.dome(x, z, sz * 1.0, sz * 1.0, sz * 1.05, 0, sz > 0.3);
    rock.rotation.set(r(), r(), r());
    rock.scale.y = 0.72;
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
  }
  const bark = new THREE.MeshStandardMaterial({ color: '#6a4f3d', roughness: 1 });
  const cut = new THREE.MeshStandardMaterial({ color: '#c39d72', roughness: 0.9 });
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 2.2, 22), [bark, cut, cut]);
  log.rotation.set(0, 0.5, Math.PI / 2);
  log.position.set(3.0, 0.2, -1.2);
  {
    const dx = Math.cos(0.5) * 1.05, dz = -Math.sin(0.5) * 1.05;
    solid.log(3.0 - dx, -1.2 - dz, 3.0 + dx, -1.2 + dz, 0.21, 0.2, true);
  }
  log.castShadow = log.receiveShadow = true;
  scene.add(log);

  return {
    sun,
    solid,
    den: new THREE.Vector3(-2.2, 0, -1.6),
    update(t, focus) {
      wind.value = t;
      sun.target.position.set(focus.x, 0, focus.z);
      sun.position.copy(sunOffset).add(sun.target.position);
    },
  };
}
