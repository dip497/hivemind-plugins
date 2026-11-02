// What the pup can bump into and stand on. Every solid thing in the clearing is a height
// profile over the ground: a dome (rocks, bushes, the den mound) or a lying log. The pup
// asks two questions: how high is the top here (to stand, land, or see a wall ahead), and
// which way is out (to bounce off a side).

export class Colliders {
  constructor() {
    this.shapes = [];
    this.perches = [];
  }

  // An ellipse-based dome: radii rx, rz, turned by rot about y, highest at `top`.
  // `stand: false` marks something to go round rather than climb (a bush).
  dome(x, z, rx, rz, top, rot = 0, perch = false, stand = true) {
    this.shapes.push({ kind: 'dome', x, z, rx, rz, top, c: Math.cos(rot), s: Math.sin(rot), stand });
    if (perch) this.perches.push({ x, z, y: top });
  }

  // A log lying on the ground from (ax, az) to (bx, bz), radius r, its axis at height y.
  log(ax, az, bx, bz, r, y, perch = false) {
    this.shapes.push({ kind: 'log', ax, az, bx, bz, r, y, stand: true });
    if (perch) this.perches.push({ x: (ax + bx) / 2, z: (az + bz) / 2, y: y + r });
  }

  // Height of one shape's top at (x, z), with the shape grown by `grow` all round
  // (so a body of that radius touches it); 0 where it is not.
  heightOf(sh, x, z, grow) {
    if (sh.kind === 'dome') {
      const dx = x - sh.x, dz = z - sh.z;
      const u = (dx * sh.c - dz * sh.s) / (sh.rx + grow);
      const w = (dx * sh.s + dz * sh.c) / (sh.rz + grow);
      const q = u * u + w * w;
      return q < 1 ? sh.top * Math.sqrt(1 - q) : 0;
    }
    const d = segDist(x, z, sh);
    const r = sh.r + grow;
    return d.d < r ? sh.y + Math.sqrt(r * r - d.d * d.d) * (sh.r / r) : 0;
  }

  top(x, z, grow = 0) {
    let h = 0;
    for (const sh of this.shapes) h = Math.max(h, this.heightOf(sh, x, z, grow));
    return h;
  }

  // Like top(), counting only what can be climbed onto.
  standTop(x, z, grow = 0) {
    let h = 0;
    for (const sh of this.shapes) if (sh.stand) h = Math.max(h, this.heightOf(sh, x, z, grow));
    return h;
  }

  // The best place to land jumping from (x, z) in direction (dx, dz): the highest point on
  // top within reach, the nearest of equals. Aiming at the ridge keeps a pup from jumping
  // clean over a narrow log.
  landingAlong(x, z, dx, dz, reach = 0.85) {
    let best = null, bh = -1;
    for (let d = 0.15; d <= reach + 1e-6; d += 0.05) {
      const px = x + dx * d, pz = z + dz * d;
      const h = this.standTop(px, pz, 0);
      if (h > bh + 0.01) { bh = h; best = { x: px, z: pz, y: h }; }
    }
    return best;
  }

  // The horizontal direction out of whatever is highest at (x, z).
  outward(x, z, grow = 0) {
    let best = null, bh = 0;
    for (const sh of this.shapes) {
      const h = this.heightOf(sh, x, z, grow);
      if (h > bh) { bh = h; best = sh; }
    }
    if (!best) return null;
    let nx, nz;
    if (best.kind === 'dome') {
      const dx = x - best.x, dz = z - best.z;
      // Gradient of the ellipse, back in world axes.
      const u = (dx * best.c - dz * best.s) / (best.rx * best.rx);
      const w = (dx * best.s + dz * best.c) / (best.rz * best.rz);
      nx = u * best.c + w * best.s;
      nz = -u * best.s + w * best.c;
    } else {
      const d = segDist(x, z, best);
      nx = x - d.x; nz = z - d.z;
    }
    const l = Math.hypot(nx, nz) || 1;
    return { x: nx / l, z: nz / l };
  }
}

function segDist(x, z, sh) {
  const vx = sh.bx - sh.ax, vz = sh.bz - sh.az;
  const t = Math.max(0, Math.min(1, ((x - sh.ax) * vx + (z - sh.az) * vz) / (vx * vx + vz * vz)));
  const px = sh.ax + vx * t, pz = sh.az + vz * t;
  return { d: Math.hypot(x - px, z - pz), x: px, z: pz };
}
