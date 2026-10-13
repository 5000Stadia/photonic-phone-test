// Spike "mhhair" v2: strand direction from the shell's root-to-tip, and the flyaway strands. Our own code.
//   flowTangents(pos, nor, tris, rtf, hair) -> Float32Array(4 per vertex): the surface gradient of rt (the way the hair runs, root to tip), per triangle, area-weighted onto
//     the corners, orthogonal to the normal; where there is no usable gradient it runs down. (v1 took it from the UV's V direction, wrong for any island that runs along U.)
//   strays(pos, nor, tan, tris, rtf, opts) -> { pos, nor, tan, uv, rt, hl, sp, index }: a few thin ribbons (two crossed, so they read from any side) that leave the shell
//     near its tips and silhouette and curl away, drawn in the rim pass with their own alpha (sp = flag, across, along). Deterministic from the seed.

export function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function flowTangents(pos, nor, tris, rtf, nV) {
  const acc = new Float32Array(nV * 3), nT = tris.length / 3;
  for (let t = 0; t < nT; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    const e1x = pos[3 * b] - pos[3 * a], e1y = pos[3 * b + 1] - pos[3 * a + 1], e1z = pos[3 * b + 2] - pos[3 * a + 2];
    const e2x = pos[3 * c] - pos[3 * a], e2y = pos[3 * c + 1] - pos[3 * a + 1], e2z = pos[3 * c + 2] - pos[3 * a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, n2 = nx * nx + ny * ny + nz * nz;
    if (n2 < 1e-16) continue;
    const d1 = rtf[b] - rtf[a], d2 = rtf[c] - rtf[a];
    // grad = ( d1 (e2 x N) + d2 (N x e1) ) / |N|^2
    const gx = (d1 * (e2y * nz - e2z * ny) + d2 * (ny * e1z - nz * e1y)) / n2, gy = (d1 * (e2z * nx - e2x * nz) + d2 * (nz * e1x - nx * e1z)) / n2, gz = (d1 * (e2x * ny - e2y * nx) + d2 * (nx * e1y - ny * e1x)) / n2;
    const gl = Math.hypot(gx, gy, gz); if (!(gl > 1e-6)) continue;
    const w = Math.sqrt(Math.sqrt(n2));
    for (const q of [a, b, c]) { acc[3 * q] += gx / gl * w; acc[3 * q + 1] += gy / gl * w; acc[3 * q + 2] += gz / gl * w; }
  }
  const out = new Float32Array(nV * 4);
  for (let i = 0; i < nV; i++) {
    let x = acc[3 * i], y = acc[3 * i + 1], z = acc[3 * i + 2];
    const nx = nor[3 * i], ny = nor[3 * i + 1], nz = nor[3 * i + 2], d = x * nx + y * ny + z * nz;
    x -= nx * d; y -= ny * d; z -= nz * d;
    let l = Math.hypot(x, y, z);
    if (!(l > 1e-6)) { x = 0; y = -1; z = 0; const d2 = -ny; x -= nx * d2; y -= ny * d2; z -= nz * d2; l = Math.hypot(x, y, z) || 1; }
    out[4 * i] = x / l; out[4 * i + 1] = y / l; out[4 * i + 2] = z / l; out[4 * i + 3] = 1;
  }
  return out;
}

export function strays(pos, nor, tan, tris, rtf, { seed = 1, count = 28, size = 1, minRt = 0.35 } = {}) {
  const rnd = mulberry32(seed * 2654435761 >>> 0), nT = tris.length / 3, cum = new Float64Array(nT);
  let tot = 0;
  for (let t = 0; t < nT; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    const e1x = pos[3 * b] - pos[3 * a], e1y = pos[3 * b + 1] - pos[3 * a + 1], e1z = pos[3 * b + 2] - pos[3 * a + 2], e2x = pos[3 * c] - pos[3 * a], e2y = pos[3 * c + 1] - pos[3 * a + 1], e2z = pos[3 * c + 2] - pos[3 * a + 2];
    const area = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / 2, r = (rtf[a] + rtf[b] + rtf[c]) / 3;
    tot += r < minRt ? 0 : area * r * r; cum[t] = tot;
  }
  const SEG = 4, P = [], N = [], Tn = [], UV = [], RT = [], SP = [], IDX = [];
  if (!(tot > 0)) return null;
  for (let k = 0; k < count; k++) {
    const x = rnd() * tot; let lo = 0, hi = nT - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    const a = tris[3 * lo], b = tris[3 * lo + 1], c = tris[3 * lo + 2];
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
    const bp = [0, 1, 2].map((ax) => w * pos[3 * a + ax] + u * pos[3 * b + ax] + v * pos[3 * c + ax]);
    const bn = [0, 1, 2].map((ax) => w * nor[3 * a + ax] + u * nor[3 * b + ax] + v * nor[3 * c + ax]);
    const bt = [0, 1, 2].map((ax) => w * tan[4 * a + ax] + u * tan[4 * b + ax] + v * tan[4 * c + ax]);
    const nl = Math.hypot(...bn) || 1, tl = Math.hypot(...bt) || 1; for (let i = 0; i < 3; i++) { bn[i] /= nl; bt[i] /= tl; }
    const bi = [bt[1] * bn[2] - bt[2] * bn[1], bt[2] * bn[0] - bt[0] * bn[2], bt[0] * bn[1] - bt[1] * bn[0]];            // across the hair, in the surface
    const rt0 = w * rtf[a] + u * rtf[b] + v * rtf[c];
    const len = size * (0.02 + 0.04 * rnd()) * (0.6 + 0.8 * rt0), out = size * (0.012 + 0.025 * rnd()), side = (rnd() * 2 - 1) * size * 0.025, curl = (rnd() * 2 - 1) * size * 0.02;
    const pts = [];
    for (let j = 0; j <= SEG; j++) {
      const s = j / SEG;
      pts.push([0, 1, 2].map((ax) => bp[ax] + bn[ax] * 0.0015 + bt[ax] * len * s + bn[ax] * out * Math.pow(s, 1.4) + bi[ax] * (side * s + curl * Math.sin(Math.PI * s))));
    }
    const hw = size * 0.0008, base0 = P.length / 3;
    for (let ribbon = 0; ribbon < 2; ribbon++) {
      for (let j = 0; j <= SEG; j++) {
        const q = pts[j], q1 = pts[Math.min(j + 1, SEG)], q0 = pts[Math.max(j - 1, 0)];
        let dx = q1[0] - q0[0], dy = q1[1] - q0[1], dz = q1[2] - q0[2]; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        // ribbon 0 is wide along the shell's normal x the direction, ribbon 1 across it
        const ref = ribbon === 0 ? bn : bi;
        let wx = dy * ref[2] - dz * ref[1], wy = dz * ref[0] - dx * ref[2], wz = dx * ref[1] - dy * ref[0]; const wl = Math.hypot(wx, wy, wz) || 1; wx /= wl; wy /= wl; wz /= wl;
        for (const sgn of [-1, 1]) {
          P.push(q[0] + wx * hw * sgn, q[1] + wy * hw * sgn, q[2] + wz * hw * sgn); N.push(bn[0], bn[1], bn[2]); Tn.push(dx, dy, dz, 1);
          UV.push(0.001, 0.001); RT.push(Math.min(1, rt0 + 0.1 * j / SEG)); SP.push(1, sgn < 0 ? 0 : 1, j / SEG);
        }
      }
      const o = base0 + ribbon * (SEG + 1) * 2;
      for (let j = 0; j < SEG; j++) { const i0 = o + 2 * j; IDX.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2); }
    }
  }
  return { pos: P, nor: N, tan: Tn, uv: UV, rt: RT, sp: SP, index: IDX };
}
