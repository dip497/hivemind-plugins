// Signed distance primitives for sculpting soft bodies. Distances are in world units,
// negative inside. The shapes follow Inigo Quilez's formulas.

export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export function sphere(c, r) {
  return (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
}

export function ellipsoid(c, r) {
  const [rx, ry, rz] = r;
  return (x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2];
    const k0 = Math.hypot(px / rx, py / ry, pz / rz);
    const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  };
}

// A capsule whose radius changes from r1 at a to r2 at b.
export function roundCone(a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}

// A round cone flattened along `n` (unit) by `flat` (>1 makes it thinner). Used for ears.
export function flatCone(a, b, r1, r2, n, flat) {
  const cone = roundCone([0, 0, 0], [b[0] - a[0], b[1] - a[1], b[2] - a[2]], r1, r2);
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const d = (px * n[0] + py * n[1] + pz * n[2]) * (flat - 1);
    return cone(px + n[0] * d, py + n[1] * d, pz + n[2] * d) / flat;
  };
}

export function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
