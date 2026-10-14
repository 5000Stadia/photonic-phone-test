// Small geometry for the garments (R5): the nearest point on a triangle mesh (a uniform grid over its triangles), the signed distance
// of a point to a thin shell, and mesh normals. Plain JS on flat Float32Array/Float64Array positions (x, y, z per vertex), metres.
// Used at template-build time (binding a garment to a body) and by the sweep (penetration). Nothing here runs per frame in the game.

/** The closest point on triangle (a, b, c) to p: fills out = [x, y, z, u, v, w, kind] (barycentric u, v, w of a, b, c; kind 0 inside the face,
 *  1 on an edge, 2 at a corner) and returns the squared distance. Ericson, Real-Time Collision Detection 5.1.5. */
export function closestOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u, v, w, kind = 1;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; kind = 2; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; kind = 2; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0; }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; kind = 2; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - t; w = t; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; kind = 0; }
          }
        }
      }
    }
  }
  const qx = u * ax + v * bx + w * cx, qy = u * ay + v * by + w * cy, qz = u * az + v * bz + w * cz;
  out[0] = qx; out[1] = qy; out[2] = qz; out[3] = u; out[4] = v; out[5] = w; out[6] = kind;
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/** A uniform grid over a mesh's triangles. build(pos, index, cell) once per posed mesh; nearest(p, maxDist) then gives the closest triangle:
 *  { tri, d2, q: [x, y, z], bary: [u, v, w], kind } or null. */
export class TriGrid {
  constructor(pos, index, cell) {
    this.pos = pos; this.index = index; this.cell = cell;
    const nt = index.length / 3;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < x0) x0 = pos[i]; if (pos[i] > x1) x1 = pos[i]; if (pos[i + 1] < y0) y0 = pos[i + 1]; if (pos[i + 1] > y1) y1 = pos[i + 1];
      if (pos[i + 2] < z0) z0 = pos[i + 2]; if (pos[i + 2] > z1) z1 = pos[i + 2];
    }
    this.o = [x0 - cell, y0 - cell, z0 - cell];
    this.n = [Math.ceil((x1 - x0) / cell) + 3, Math.ceil((y1 - y0) / cell) + 3, Math.ceil((z1 - z0) / cell) + 3];
    const [nx, ny, nz] = this.n, count = new Uint32Array(nx * ny * nz + 1);
    const span = (t) => {
      const a = index[3 * t] * 3, b = index[3 * t + 1] * 3, c = index[3 * t + 2] * 3, r = [];
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(pos[a + k], pos[b + k], pos[c + k]), hi = Math.max(pos[a + k], pos[b + k], pos[c + k]);
        r.push(Math.floor((lo - this.o[k]) / cell), Math.floor((hi - this.o[k]) / cell));
      }
      return r;
    };
    const spans = new Int32Array(nt * 6);
    for (let t = 0; t < nt; t++) {
      const s = span(t); spans.set(s, t * 6);
      for (let z = s[4]; z <= s[5]; z++) for (let y = s[2]; y <= s[3]; y++) for (let x = s[0]; x <= s[1]; x++) count[(z * ny + y) * nx + x + 1]++;
    }
    for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
    this.start = count; this.items = new Uint32Array(count[count.length - 1]);
    const fill = count.slice(0, -1);
    for (let t = 0; t < nt; t++) {
      const s = spans.subarray(t * 6, t * 6 + 6);
      for (let z = s[4]; z <= s[5]; z++) for (let y = s[2]; y <= s[3]; y++) for (let x = s[0]; x <= s[1]; x++) this.items[fill[(z * ny + y) * nx + x]++] = t;
    }
    this.scratch = new Float64Array(7); this.seen = new Int32Array(nt).fill(-1); this.stamp = 0;
  }
  nearest(px, py, pz, maxDist = Infinity) {
    const { pos, index, cell, o, n, start, items, scratch, seen } = this, [nx, ny, nz] = n;
    const ci = Math.min(nx - 1, Math.max(0, Math.floor((px - o[0]) / cell))), cj = Math.min(ny - 1, Math.max(0, Math.floor((py - o[1]) / cell))), ck = Math.min(nz - 1, Math.max(0, Math.floor((pz - o[2]) / cell)));
    let best = maxDist * maxDist, found = null;
    const stamp = ++this.stamp, maxR = Math.min(Math.max(nx, ny, nz), Number.isFinite(maxDist) ? Math.ceil(maxDist / cell) + 1 : 1 << 30);
    for (let r = 0; r <= maxR; r++) {
      // a shell of cells at Chebyshev radius r; anything beyond is at least (r - 1) cells away
      if (found && (r - 1) * cell > Math.sqrt(best)) break;
      for (let k = Math.max(0, ck - r); k <= Math.min(nz - 1, ck + r); k++) for (let j = Math.max(0, cj - r); j <= Math.min(ny - 1, cj + r); j++) {
        const shellKJ = Math.abs(k - ck) === r || Math.abs(j - cj) === r;
        for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
          if (!shellKJ && Math.abs(i - ci) !== r) continue;
          const cellId = (k * ny + j) * nx + i;
          for (let s = start[cellId]; s < start[cellId + 1]; s++) {
            const t = items[s]; if (seen[t] === stamp) continue; seen[t] = stamp;
            const a = index[3 * t] * 3, b = index[3 * t + 1] * 3, c = index[3 * t + 2] * 3;
            const d2 = closestOnTriangle(px, py, pz, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2], scratch);
            if (d2 < best) { best = d2; found = t; this._q = [scratch[0], scratch[1], scratch[2]]; this._b = [scratch[3], scratch[4], scratch[5]]; this._k = scratch[6]; }
          }
        }
      }
    }
    return found === null ? null : { tri: found, d2: best, q: this._q, bary: this._b, kind: this._k };
  }
}

/** Area-weighted vertex normals of a mesh (unit length), into `out` (allocated when omitted). */
export function normalsOf(pos, index, out = new Float32Array(pos.length)) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { out[o] += nx; out[o + 1] += ny; out[o + 2] += nz; }
  }
  for (let i = 0; i < out.length; i += 3) { const l = Math.sqrt(out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
  return out;
}

/** Signed distance of p to a shell (a TriGrid over it, with the shell's unit face normals outward): positive when p lies on the outer side.
 *  Returns { d, tri, edge } (edge true when the closest point is on the shell's boundary or beyond it, where the sign means little), or null
 *  when nothing lies within maxDist. `open` is the boundary-edge test: a Uint8Array per triangle edge ([3t + k] is 1 when edge k of the
 *  triangle has no neighbour), from boundaryEdges(). */
export function shellDistance(grid, faceN, px, py, pz, maxDist, open) {
  const h = grid.nearest(px, py, pz, maxDist); if (!h) return null;
  const t = h.tri, d = Math.sqrt(h.d2), n = t * 3;
  const sgn = (px - h.q[0]) * faceN[n] + (py - h.q[1]) * faceN[n + 1] + (pz - h.q[2]) * faceN[n + 2];
  let edge = false;
  if (open) {
    const [u, v, w] = h.bary, eps = 1e-6;
    if ((w < eps && open[3 * t]) || (u < eps && open[3 * t + 1]) || (v < eps && open[3 * t + 2])) edge = true;   // edge 0: a-b, 1: b-c, 2: c-a
  }
  return { d: sgn >= 0 ? d : -d, tri: t, edge };
}

/** Unit face normals of a mesh (3 per triangle). */
export function faceNormals(pos, index, out = new Float32Array(index.length)) {
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[t] = nx / l; out[t + 1] = ny / l; out[t + 2] = nz / l;
  }
  return out;
}

/** For each triangle edge (3t + k: a-b, b-c, c-a) 1 when no other triangle shares it (the mesh's boundary). */
export function boundaryEdges(index) {
  const map = new Map(), open = new Uint8Array(index.length).fill(1);
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = index[t + k], b = index[t + (k + 1) % 3], key = a < b ? a * 65536 + b : b * 65536 + a, prev = map.get(key);
    if (prev === undefined) map.set(key, t + k); else { open[prev] = 0; open[t + k] = 0; }
  }
  return open;
}
