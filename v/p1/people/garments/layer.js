// An outfit's base layer (R5): nobody is ever drawn unclothed, so the base layer (the tights helper's short-sleeved, high-collared suit, at every age) is always
// built and always there. An outfit may declare how it reads, its colour and its neck cut. The gentlewoman's reads as the white linen shift (the smock): the
// collar is cut down to just above the bodice's neckline, so the layer ends in a white edge on the bodice's edge, never in skin between them. Above the edge is the
// bare neck and shoulders of an off-the-shoulder gown, which is period-correct (V&A 429-1889; Lely's ladies).
//
// The cut is a number per layer vertex, s: its height above the cut line (metres; positive is cut away). The shader draws the triangles between vertices with
// the interpolation of s, and discards where it is positive, so the edge lies on the line itself whatever the mesh's density, and no index changes with the wearer
// (one mesh for everyone, one draw). The line is the bodice's neckline (its top ring, fitted to this wearer) plus a margin, as a function of the angle round the
// body, found without trigonometry (pseudo-angles: + - * / only) so every engine cuts the same triangles.
import { UVN, BASE_LAYER } from "../../spikes/makehuman/index.js";

export const LAYER_COUNT = BASE_LAYER.count;

/** A monotone stand-in for the angle of (dx, dz) about the origin, from -1 to 3 (0 straight ahead, +z; 1 to the wearer's left, +x), + - * / only. */
export const pseudoAngle = (dx, dz) => { const q = dx / (Math.abs(dx) + Math.abs(dz) || 1); return dz > 0 ? q : 2 - q; };

/** The neckline of a fitted bodice as a function of the pseudo-angle: { ys, rho } for its top ring, rho ascending in 0..4, wrapping. */
export function neckline(bodice) {
  const { start, rings, around } = bodice.template.grids[0], P = bodice.position;
  let cx = 0, cz = 0; const top = start + (rings - 1) * around;
  for (let j = 0; j < around; j++) { cx += P[3 * (top + j)]; cz += P[3 * (top + j) + 2]; }
  cx /= around; cz /= around;
  const rho = new Float64Array(around), ys = new Float64Array(around);
  for (let j = 0; j < around; j++) { const r = pseudoAngle(P[3 * (top + j)] - cx, P[3 * (top + j) + 2] - cz); rho[j] = r < 0 ? r + 4 : r; ys[j] = P[3 * (top + j) + 1]; }
  const order = Array.from({ length: around }, (_, j) => j).sort((a, b) => rho[a] - rho[b]);
  return { cx, cz, rho: Float64Array.from(order, (j) => rho[j]), ys: Float64Array.from(order, (j) => ys[j]),
    /** the neckline's height at the point (x, z) */
    at(x, z) {
      let r = pseudoAngle(x - cx, z - cz); if (r < 0) r += 4;
      const n = order.length; let i = 0; while (i < n && this.rho[i] <= r) i++;           // the first one past r
      const a = (i + n - 1) % n, b = i % n, ra = this.rho[a] - (i === 0 ? 4 : 0), rb = this.rho[b] + (i === n ? 4 : 0);
      const t = (r - ra) / (rb - ra || 1);
      return this.ys[a] + (this.ys[b] - this.ys[a]) * t;
    } };
}

/** The cut of a wearer's base layer: s per layer vertex (Float32Array, LAYER_COUNT), the height above the shift's edge (the neckline plus `margin` x the wearer's
 *  height), so positive is cut away. `position` is the wearer's near body (vertices 0 to UVN the body, then the layer's own). Every vertex above the line is cut, the short sleeve's shoulder cap too (it is under the bodice's sleeve). */
export function layerCut(position, bodice, height, margin = 0.006) {
  const nk = neckline(bodice), s = new Float32Array(LAYER_COUNT), m = margin * height;
  for (let i = 0; i < LAYER_COUNT; i++) {
    const o = 3 * (UVN + i), y = position[o + 1];
    s[i] = y - (nk.at(position[o], position[o + 2]) + m);
  }
  return s;
}
