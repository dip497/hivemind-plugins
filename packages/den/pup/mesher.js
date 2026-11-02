// Turns a signed distance function into a smooth triangle mesh (naive surface nets),
// with each vertex pulled onto the true surface and given the field's gradient as normal.

export function gradient(f, x, y, z, e = 0.0015) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  return [gx / (2 * e), gy / (2 * e), gz / (2 * e)];
}

export function surfaceNets(f, min, max, step) {
  const nx = Math.ceil((max[0] - min[0]) / step);
  const ny = Math.ceil((max[1] - min[1]) / step);
  const nz = Math.ceil((max[2] - min[2]) / step);
  const sx = nx + 1, sy = ny + 1;
  const vals = new Float32Array(sx * sy * (nz + 1));
  // Sample blocks of B³ corners at their centre first: a block far from the surface only
  // needs the right sign, so its corners take the centre's distance without evaluating f.
  const B = 4;
  const bx = Math.ceil(sx / B), by = Math.ceil(sy / B), bz = Math.ceil((nz + 1) / B);
  const coarse = new Float32Array(bx * by * bz);
  for (let k = 0; k < bz; k++)
    for (let j = 0; j < by; j++)
      for (let i = 0; i < bx; i++)
        coarse[i + bx * (j + by * k)] = f(min[0] + (i * B + (B - 1) / 2) * step, min[1] + (j * B + (B - 1) / 2) * step, min[2] + (k * B + (B - 1) / 2) * step);
  const far = B * step * 1.6;
  for (let k = 0; k <= nz; k++) {
    const z = min[2] + k * step;
    for (let j = 0; j <= ny; j++) {
      const y = min[1] + j * step;
      let o = sx * (j + sy * k);
      for (let i = 0; i <= nx; i++) {
        const c = coarse[((i / B) | 0) + bx * (((j / B) | 0) + by * ((k / B) | 0))];
        vals[o++] = Math.abs(c) > far ? c : f(min[0] + i * step, y, z);
      }
    }
  }
  const at = (i, j, k) => vals[i + sx * (j + sy * k)];
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const cell = (i, j, k) => i + nx * (j + ny * k);
  const pos = [];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (const [p, q] of EDGES) {
          const a = cv[p], b = cv[q];
          if ((a < 0) === (b < 0)) continue;
          const t = a / (a - b);
          const px = (p & 1) + t * ((q & 1) - (p & 1));
          const py = ((p >> 1) & 1) + t * (((q >> 1) & 1) - ((p >> 1) & 1));
          const pz = ((p >> 2) & 1) + t * (((q >> 2) & 1) - ((p >> 2) & 1));
          ax += px; ay += py; az += pz; n++;
        }
        cellVert[cell(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + ax / n) * step, min[1] + (j + ay / n) * step, min[2] + (k + az / n) * step);
      }
    }
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b];
    const d02 = dist2(pos, a, c), d13 = dist2(pos, b, d);
    if (d02 < d13) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = at(i, j, k) < 0;
        if (j > 0 && k > 0 && (at(i + 1, j, k) < 0) !== a) {
          quad(cellVert[cell(i, j, k)], cellVert[cell(i, j - 1, k)], cellVert[cell(i, j - 1, k - 1)], cellVert[cell(i, j, k - 1)], !a);
        }
        if (i > 0 && k > 0 && (at(i, j + 1, k) < 0) !== a) {
          quad(cellVert[cell(i, j, k)], cellVert[cell(i, j, k - 1)], cellVert[cell(i - 1, j, k - 1)], cellVert[cell(i - 1, j, k)], !a);
        }
        if (i > 0 && j > 0 && (at(i, j, k + 1) < 0) !== a) {
          quad(cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)], cellVert[cell(i - 1, j - 1, k)], cellVert[cell(i, j - 1, k)], !a);
        }
      }
    }
  }
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  for (let v = 0; v < positions.length; v += 3) {
    let x = positions[v], y = positions[v + 1], z = positions[v + 2];
    for (let it = 0; it < 3; it++) {
      const d = f(x, y, z);
      const g = gradient(f, x, y, z);
      const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2] || 1;
      x -= (d * g[0]) / g2; y -= (d * g[1]) / g2; z -= (d * g[2]) / g2;
    }
    const g = gradient(f, x, y, z);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    positions[v] = x; positions[v + 1] = y; positions[v + 2] = z;
    normals[v] = g[0] / l; normals[v + 1] = g[1] / l; normals[v + 2] = g[2] / l;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}

function dist2(p, a, b) {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}
