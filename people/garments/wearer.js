// The wearer: what a garment reads off a person's near body (shape.js buildNear): the drawn body's vertices, triangles and skin, the base
// layer, the rig's joints, and measurements taken from the mesh itself (landmarks and cross-sections) so a garment can be cut for any body.
// Everything here is plain JS and deterministic; it runs when a template is built or a person is fitted, never per frame.
import { UVN, DRAWN_INDEX, BASE_LAYER } from "../../spikes/makehuman/index.js";
import { BONES } from "../shape.js";

export const BI = Object.fromEntries(BONES.map(([n], i) => [n, i]));
export const K = 4;
export const NBODY = UVN;                                      // drawn body vertices: originals, then UV seam copies
export const BODY_INDEX = DRAWN_INDEX;
export const LAYER_INDEX = (() => { const o = new Uint16Array(BASE_LAYER.index.length); for (let i = 0; i < o.length; i++) o[i] = BASE_LAYER.index[i] - BASE_LAYER.start + UVN; return o; })();
// the surface a garment must clear: the drawn body and the base layer over it (planeSegments and trianglesWhere read both)
export const FULL_INDEX = (() => { const o = new Uint16Array(BODY_INDEX.length + LAYER_INDEX.length); o.set(BODY_INDEX); o.set(LAYER_INDEX, BODY_INDEX.length); return o; })();
export const NFULL = UVN + BASE_LAYER.count;
const ARM = new Set(["upperarmL", "forearmL", "handL", "upperarmR", "forearmR", "handR"].map((n) => BI[n]));
const TRUNK = new Set(["hips", "spine", "chest", "clavL", "clavR", "upperarmL", "upperarmR"].map((n) => BI[n]));
const FORE = new Set(["forearmL", "handL", "forearmR", "handR"].map((n) => BI[n]));
const LEG = new Set(["thighL", "shinL", "footL", "toeL", "thighR", "shinR", "footR", "toeR"].map((n) => BI[n]));

/** A person's near body as a garment sees it: { pos (body vertices then the layer's), nBody, height, J (rest joints), u, skin, ... }. */
export function wearer(near) {
  const w = { pos: near.position, nBody: NBODY, height: near.height, J: near.joints.J, tip: near.joints.tip, u: near.joints.u, skinIndex: near.skinIndex, skinWeight: near.skinWeight };
  const arm = new Uint8Array(NFULL), leg = new Uint8Array(NFULL), fore = new Uint8Array(NFULL), trunk = new Uint8Array(NFULL);
  for (let v = 0; v < NFULL; v++) {
    let a = 0, l = 0, f = 0, t = 0;
    for (let k = 0; k < K; k++) { const b = near.skinIndex[v * K + k], x = near.skinWeight[v * K + k]; if (ARM.has(b)) a += x; if (LEG.has(b)) l += x; if (FORE.has(b)) f += x; if (TRUNK.has(b)) t += x; }
    arm[v] = a >= 0.5 ? 1 : 0; leg[v] = l >= 0.5 ? 1 : 0; fore[v] = f >= 0.5 ? 1 : 0; trunk[v] = t >= 0.5 ? 1 : 0;
  }
  w.arm = arm; w.leg = leg; w.fore = fore; w.trunk = trunk;      // arm: upper arm, forearm or hand; fore: forearm or hand (not under a sleeve that ends above the elbow)
  return w;
}

/** A y-bucketed index over a triangle list (a Uint32Array of triangle numbers into FULL_INDEX), so a horizontal slice reads only the triangles that reach its height:
 *  attached as `tris.bins`, where planeSegments finds it. `cell` metres a bucket. */
export function binByHeight(pos, tris, cell = 0.02) {
  let lo = Infinity, hi = -Infinity;
  const yOf = (t) => [pos[3 * FULL_INDEX[3 * t] + 1], pos[3 * FULL_INDEX[3 * t + 1] + 1], pos[3 * FULL_INDEX[3 * t + 2] + 1]];
  for (let i = 0; i < tris.length; i++) for (const y of yOf(tris[i])) { if (y < lo) lo = y; if (y > hi) hi = y; }
  const nb = Math.max(1, Math.ceil((hi - lo) / cell) + 1), count = new Uint32Array(nb + 1);
  const span = (t) => { const y = yOf(t); return [Math.floor((Math.min(...y) - lo) / cell), Math.floor((Math.max(...y) - lo) / cell)]; };
  for (let i = 0; i < tris.length; i++) { const [a, b] = span(tris[i]); for (let k = a; k <= b; k++) count[k + 1]++; }
  for (let k = 1; k <= nb; k++) count[k] += count[k - 1];
  const items = new Uint32Array(count[nb]), fill = count.slice(0, -1);
  for (let i = 0; i < tris.length; i++) { const [a, b] = span(tris[i]); for (let k = a; k <= b; k++) items[fill[k]++] = tris[i]; }
  tris.bins = { at(y) { const k = Math.floor((y - lo) / cell); return k < 0 || k >= nb ? [] : items.subarray(count[k], count[k + 1]); } };
  return tris;
}

/** The triangles of the drawn body and its base layer whose vertices all pass `keep(v)`: a Uint32Array of triangle indices (into FULL_INDEX / 3). */
export function trianglesWhere(keep) {
  const out = [];
  for (let t = 0; t < FULL_INDEX.length; t += 3) if (keep(FULL_INDEX[t]) && keep(FULL_INDEX[t + 1]) && keep(FULL_INDEX[t + 2])) out.push(t / 3);
  return Uint32Array.from(out);
}

/** The outline where the plane through `o` with unit normal `n` cuts the given triangles of the body, in plane coordinates (e1, e2 unit, in the
 *  plane): a flat array s1, s2, s1, s2 per segment end pair (4 numbers a segment). */
export function planeSegments(pos, tris, o, n, e1, e2) {
  const out = [], d = new Float64Array(3), horizontal = n[0] === 0 && n[1] === 1 && n[2] === 0, bins = horizontal && tris.bins ? tris.bins : null;
  const list = bins ? bins.at(o[1]) : tris;
  for (let ti = 0; ti < list.length; ti++) {
    const t = list[ti] * 3; let neg = 0, posv = 0;
    for (let k = 0; k < 3; k++) { const v = FULL_INDEX[t + k] * 3; d[k] = (pos[v] - o[0]) * n[0] + (pos[v + 1] - o[1]) * n[1] + (pos[v + 2] - o[2]) * n[2]; if (d[k] < 0) neg++; else posv++; }
    if (neg === 0 || posv === 0) continue;
    const hit = [];
    for (let k = 0; k < 3; k++) {
      const a = k, b = (k + 1) % 3;
      if ((d[a] < 0) === (d[b] < 0)) continue;
      const s = d[a] / (d[a] - d[b]), va = FULL_INDEX[t + a] * 3, vb = FULL_INDEX[t + b] * 3;
      const x = pos[va] + (pos[vb] - pos[va]) * s - o[0], y = pos[va + 1] + (pos[vb + 1] - pos[va + 1]) * s - o[1], z = pos[va + 2] + (pos[vb + 2] - pos[va + 2]) * s - o[2];
      hit.push(x * e1[0] + y * e1[1] + z * e1[2], x * e2[0] + y * e2[1] + z * e2[2]);
    }
    if (hit.length === 4) out.push(hit[0], hit[1], hit[2], hit[3]);
  }
  return out;
}

/** The farthest hit of the ray from (c1, c2) in direction (d1, d2) against a segment list (planeSegments), or -1. */
export function rayFar(seg, c1, c2, d1, d2) {
  let best = -1;
  for (let i = 0; i < seg.length; i += 4) {
    const ax = seg[i] - c1, ay = seg[i + 1] - c2, bx = seg[i + 2] - c1, by = seg[i + 3] - c2, ex = bx - ax, ey = by - ay;
    const den = d1 * ey - d2 * ex; if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den, s = (ax * d2 - ay * d1) / den;     // c + t d = a + s e  ->  solve
    if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
  }
  return best;
}

/** The torso as a table: radius r[j][i] from the axis (cx(y), cz(y)) at angle theta_j (0 = straight ahead +z, +90 degrees = +x, the wearer's left)
 *  and height y_i, over the torso triangles (no arms, no legs), every `dy` metres from y0 to y1. */
export function torsoTable(w, y0, y1, dy = 0.004, nTheta = 72) {
  const tris = binByHeight(w.pos, trianglesWhere((v) => !w.arm[v] && !w.leg[v])), E1 = [1, 0, 0], E2 = [0, 0, 1], N = [0, 1, 0];
  const ny = Math.round((y1 - y0) / dy) + 1, r = new Float32Array(nTheta * ny), cx = new Float32Array(ny), cz = new Float32Array(ny);
  for (let i = 0; i < ny; i++) {
    const y = y0 + i * dy, seg = planeSegments(w.pos, tris, [0, y, 0], N, E1, E2);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < seg.length; k += 2) { if (seg[k] < x0) x0 = seg[k]; if (seg[k] > x1) x1 = seg[k]; if (seg[k + 1] < z0) z0 = seg[k + 1]; if (seg[k + 1] > z1) z1 = seg[k + 1]; }
    cx[i] = 0.5 * (x0 + x1); cz[i] = 0.5 * (z0 + z1);
    for (let j = 0; j < nTheta; j++) {
      const th = (j / nTheta) * 2 * Math.PI, hit = rayFar(seg, cx[i], cz[i], Math.sin(th), Math.cos(th));
      r[j * ny + i] = hit;
    }
    for (let j = 0; j < nTheta; j++) if (r[j * ny + i] < 0) {          // a ray that missed: from its neighbours
      let a = j, b = j; while (r[(a % nTheta) * ny + i] < 0 && a > j - nTheta) a--; while (r[(b % nTheta) * ny + i] < 0 && b < j + nTheta) b++;
      r[j * ny + i] = 0.5 * (r[((a % nTheta + nTheta) % nTheta) * ny + i] + r[(b % nTheta) * ny + i]);
    }
  }
  return { r, cx, cz, y0, dy, ny, nTheta,
    /** radius at angle th (radians) and height y, bilinear */
    at(th, y) {
      const f = ((th / (2 * Math.PI)) % 1 + 1) % 1 * nTheta, j0 = Math.floor(f) % nTheta, j1 = (j0 + 1) % nTheta, s = f - Math.floor(f);
      const g = Math.max(0, Math.min(ny - 1.0001, (y - y0) / dy)), i0 = Math.floor(g), t = g - i0;
      const a = r[j0 * ny + i0] * (1 - t) + r[j0 * ny + i0 + 1] * t, b = r[j1 * ny + i0] * (1 - t) + r[j1 * ny + i0 + 1] * t;
      return a * (1 - s) + b * s;
    },
    centre(y) { const g = Math.max(0, Math.min(ny - 1.0001, (y - y0) / dy)), i0 = Math.floor(g), t = g - i0; return [cx[i0] * (1 - t) + cx[i0 + 1] * t, cz[i0] * (1 - t) + cz[i0 + 1] * t]; },
  };
}

/** Landmarks and spans of a wearer, read from its joints and its torso table (metres). `u`: the wearer's height over 1.62 m, which scales the sampling steps (1 for the
 *  bodice's templates, which have always been cut on bodies read at these steps; the skirt's spec passes its own, so it reads a body at any height the same). */
export function landmarks(w, table, u = 1) {
  const J = w.J, H = w.height, hipsY = J[BI.hips][1], shoulderY = J[BI.upperarmL][1], neckY = J[BI.neck][1];
  const half = (y) => table.at(Math.PI / 2, y) + table.at(-Math.PI / 2, y);          // width at y (the two sides)
  const span = shoulderY - hipsY;
  // the waist: the narrowest of the smoothed width in the middle of the trunk
  let waistY = hipsY + 0.46 * span, best = Infinity;
  for (let y = hipsY + 0.30 * span; y <= hipsY + 0.62 * span; y += 0.004 * u) {
    let s = 0; for (let k = -2; k <= 2; k++) s += half(y + k * 0.01 * u);
    if (s < best) { best = s; waistY = y; }
  }
  // the bust: a share of the way from the waist to the shoulders (the front's reach is nearly level from the belly to the chest on these bodies, so it does not mark a height)
  const bustY = waistY + 0.6 * (shoulderY - waistY);
  return {
    H, hipsY, waistY, bustY, shoulderY, neckY, span,
    waistW: half(waistY), waistD: table.at(0, waistY) + table.at(Math.PI, waistY), bustW: half(bustY), bustD: table.at(0, bustY) + table.at(Math.PI, bustY),
    shoulderW: 2 * Math.abs(J[BI.upperarmL][0]), armLen: Math.hypot(...[0, 1, 2].map((k) => J[BI.forearmL][k] - J[BI.upperarmL][k])),
    thighLen: Math.hypot(...[0, 1, 2].map((k) => J[BI.shinL][k] - J[BI.thighL][k])), shinLen: Math.hypot(...[0, 1, 2].map((k) => J[BI.footL][k] - J[BI.shinL][k])),
  };
}
