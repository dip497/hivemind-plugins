// Dust puffs where the pup lands, from a small pool of soft sprites.
import * as THREE from 'three';

export function makeDust(scene, size = 24) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const pool = [];
  for (let i = 0; i < size; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: '#d8cfae', transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(m);
    s.visible = false;
    scene.add(s);
    pool.push({ s, life: 0, max: 1, v: new THREE.Vector3() });
  }
  let next = 0;
  return {
    puff(at, strength) {
      const n = Math.round(4 + strength * 8);
      for (let i = 0; i < n; i++) {
        const d = pool[next++ % pool.length];
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const sp = 0.4 + strength * 1.4 * (0.6 + Math.random() * 0.4);
        d.s.position.set(at.x + Math.cos(a) * 0.15, 0.05, at.z + Math.sin(a) * 0.12);
        d.v.set(Math.cos(a) * sp, 0.25 + Math.random() * 0.35, Math.sin(a) * sp * 0.8);
        d.life = d.max = 0.45 + Math.random() * 0.35;
        d.s.visible = true;
      }
    },
    update(dt) {
      for (const d of pool) {
        if (d.life <= 0) continue;
        d.life -= dt;
        const k = 1 - d.life / d.max;
        d.v.multiplyScalar(Math.exp(-4 * dt));
        d.s.position.addScaledVector(d.v, dt);
        d.s.scale.setScalar(0.12 + k * 0.38);
        d.s.material.opacity = 0.55 * (1 - k);
        if (d.life <= 0) d.s.visible = false;
      }
    },
  };
}
