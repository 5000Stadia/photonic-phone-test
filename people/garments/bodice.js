// The boned bodice of the gentlewoman (R5; design/research/r5-dress-1660.md, V&A 429-1889): a shell on the body. A rigid cone of stays (the bust flattened, a
// straight front running to a long point below the natural waist), an off-the-shoulder neckline, short full sleeves to above the elbow.
//
// Built procedurally, once per cut, as a template on the mean body of that cut (outfit.js MEAN_BODIES), from the body's own measurements (wearer.js):
//   - the torso is rings round the body, each a closed loop whose height runs from the bottom edge (a V to the point in front) to the neckline (low across the
//     chest, up to the shoulder tips); its radius is the cross-section of the body and its base layer there, flattened in front to the upper hull of its profile
//     (the stays' straight busk) and eased out by a centimetre or two;
//   - each sleeve is rings along the upper arm: the arm's own cross-section, puffed full (a cap standing off the shoulder, gathered toward the ribs and the neck).
// The template is bound to the person (bind.js, MakeHuman's .mhclo idea: three vertices, barycentric weights, an offset in the triangle's frame): the torso to the
// base layer over the torso, the sleeves to the arm and the layer's sleeve. The offset is in units of the bound triangle's own mean edge length, so it grows with
// the wearer's measured span between those body vertices (the landmark-span scaling of MakeHuman's .mhclo), and along the smooth normal so a creased body does not
// ripple the cloth. Fitted to any body by that binding, then relax() makes the stays straight again (the cloth does not follow a sagging bust or a belly's fold).
// A girl and a small child take their own cuts (CUTS.girl, CUTS.small), built on a girl's and a toddler's body from their own landmarks, never the adult cut
// scaled down.
//
// It carries the body it hides (MakeHuman's delete_verts: a region id per body vertex, and per reduced-mesh vertex), what it covers (what the sweep measures
// penetration over) and its skin weights (the torso rigid: the body's own weights at the surface it stands off from, smoothed over the rings; the sleeve cap sewn to the
// chest and the sleeve below it on the arm).
import { TriGrid, faceNormals, boundaryEdges, normalsOf } from "./geom.js";
import { wearer as readWearer, torsoTable, landmarks, planeSegments, rayFar, trianglesWhere, BODY_INDEX, LAYER_INDEX, NBODY, NFULL, BI, K } from "./wearer.js";
import { bind, fit, blendSkin, bodyNormals } from "./bind.js";
import { BONES } from "../shape.js";

// All lengths in units of the wearer's height H (the template body's own, so a cut reads the same on a girl's body as on a woman's).
export const CUTS = {
  adult: {
    N: 40, rings: 12, sleeveN: 12, sleeveRings: 6, rightSleeveOut: true,
    ease: 0.0085,            // standoff from the body's surface (the base layer is 0.004 out): thickness of the stays over the shift
    coneEase: 0.004,         // extra standoff low in front, where the cone leaves the body under the bust and over the belly
    flatten: 1,              // how far the front is pressed flat to the upper hull of its profile (0 follows the body)
    sideDrop: 0.030, pointDrop: 0.062, pointPow: 1.25, pointHalf: 1.15, backDrop: 0.034,   // bottom edge below the natural waist: sides, extra at the front point (a V of half-angle pointHalf rad), back
    topFront: 0.060, topSide: 0.000, topBack: 0.038,                           // neckline below the shoulder line: front centre, shoulder tip, back centre
    sleeveTop: -0.026, sleeveEnd: 0.80, sleevePuff: 0.026, capPuff: 1.0, capLift: 0.006, innerCut: 0.7, capSew: 0.11, capArm: 0.25, sleeveEase: 0.009, skinSmooth: 30, // sleeve: starts above the shoulder joint (H), ends at this share of the upper arm; puff radius (H)
  },
};
CUTS.girl = { ...CUTS.adult, flatten: 0.4, pointDrop: 0.034, ease: 0.0095, topFront: 0.055 };
CUTS.small = { ...CUTS.girl, flatten: 0, pointDrop: 0.030, sideDrop: 0.030, backDrop: 0.034, ease: 0.0105, coneEase: 0.002 };

// The reduced cuts (R5, mid and far tiers; reduced.js): the same generator at lower resolution (24 round, 8 rings, sleeves 12 x 6: 336 vertices; fewer sleeve rings or columns put the sleeve cap 2 to 3 cm off the full one, which the far check measures), cut on the cut's own mean body
// and bound to the reduced mesh. The skin smoothing runs fewer rounds, for the rings are further apart.
// (rightSleeveOut: the right sleeve is the left's mirror, so the same winding faces inward on it; the full cuts have always been so, which the sweep never saw as it reads sleeves by a ray, and
// relax() and the lighting see: the reduced cuts wind it outward. Setting it on the full cuts too is one line, and changes the sweep's numbers for the right sleeve.)
for (const id of ["adult", "girl", "small"]) CUTS[id + "-r"] = { ...CUTS[id], rightSleeveOut: true, N: 24, rings: 8, sleeveN: 12, sleeveRings: 6, skinSmooth: 14 };

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// the upper concave envelope of samples (y ascending, r), as a function of y: the stays' straight busk
function upperHull(ys, rs) {
  const h = [];
  for (let i = 0; i < ys.length; i++) {
    while (h.length >= 2) { const a = h[h.length - 2], b = h[h.length - 1], c = i; if ((ys[b] - ys[a]) * (rs[c] - rs[a]) - (rs[b] - rs[a]) * (ys[c] - ys[a]) >= 0) h.pop(); else break; }
    h.push(i);
  }
  return (y) => {
    for (let k = 0; k < h.length - 1; k++) { const a = h[k], b = h[k + 1]; if (y <= ys[b]) return lerp(rs[a], rs[b], (y - ys[a]) / (ys[b] - ys[a] || 1)); }
    return rs[h[h.length - 1]];
  };
}

/** The template's geometry on a wearer w (its torso table `table` and landmarks `lm`): vertices (Float32Array), the triangles, which part each belongs to,
 *  and the boundary rings (the open edges). Positions are on w's body, in its rest stance. */
function generate(w, table, lm, cut) {
  const H = lm.H, N = cut.N, Kr = cut.rings, pos = [], anchor = [], part = [], ring = [], edgeRing = [], tri = [], grids = [{ start: 0, rings: Kr, around: N }];
  const bottom = (th) => { const c = Math.cos(th), b = Math.max(0, -c), a = Math.abs(((th + Math.PI) % (2 * Math.PI)) - Math.PI); return lm.waistY - H * (cut.sideDrop + cut.pointDrop * Math.pow(Math.max(0, 1 - a / cut.pointHalf), cut.pointPow) + (cut.backDrop - cut.sideDrop) * b * b); };
  const top = (th) => { const c = Math.cos(th), s = Math.sin(th), f = Math.max(0, c), b = Math.max(0, -c); return lm.shoulderY - H * (cut.topSide * s * s + cut.topFront * f * f + cut.topBack * b * b); };
  // torso rings
  for (let k = 0; k < Kr; k++) for (let j = 0; j < N; j++) {
    const th = (j / N) * 2 * Math.PI, yb = bottom(th), yt = top(th), t = k / (Kr - 1), y = lerp(yb, yt, t);
    // radius: the body's cross-section there, flattened to the front's hull
    const dy = table.dy, n = Math.max(2, Math.round((yt - yb) / dy) + 1), ys = new Float64Array(n), rs = new Float64Array(n);
    for (let i = 0; i < n; i++) { ys[i] = yb + (i / (n - 1)) * (yt - yb); rs[i] = table.at(th, ys[i]); }
    const hull = upperHull(ys, rs), front = Math.pow(Math.max(0, Math.cos(th)), 1.5) * cut.flatten;
    const rb = table.at(th, y), r = lerp(rb, Math.max(rb, hull(y)), front);
    const ease = H * (cut.ease + cut.coneEase * (1 - t) * Math.pow(Math.max(0, Math.cos(th)), 2));
    const c = table.centre(y);
    pos.push(c[0] + (r + ease) * Math.sin(th), y, c[1] + (r + ease) * Math.cos(th));
    anchor.push(c[0] + rb * Math.sin(th), y, c[1] + rb * Math.cos(th));                  // the surface it stands off from
    part.push(0); ring.push(k); edgeRing.push(k === 0 || k === Kr - 1 ? 1 : 0);
  }
  for (let k = 0; k < Kr - 1; k++) for (let j = 0; j < N; j++) {
    const a = k * N + j, b = k * N + (j + 1) % N, c = (k + 1) * N + (j + 1) % N, d = (k + 1) * N + j;
    tri.push(a, b, c, a, c, d);
  }
  // sleeves
  const M = cut.sleeveN, Ks = cut.sleeveRings;
  for (const [side, S] of [[1, "L"], [-1, "R"]]) {
    const ju = w.J[BI["upperarm" + S]], jf = w.J[BI["forearm" + S]], axis = norm3([jf[0] - ju[0], jf[1] - ju[1], jf[2] - ju[2]]);
    const e1 = norm3([1 - axis[0] * axis[0], -axis[0] * axis[1], -axis[0] * axis[2]]), e2 = norm3(cross(axis, e1));      // x projected off the axis; e2 about +z
    const tris = trianglesWhere((v) => w.arm[v] && (side > 0 ? w.pos[3 * v] > 0 : w.pos[3 * v] < 0));
    const base = pos.length / 3, s0 = cut.sleeveTop * H, s1 = cut.sleeveEnd * lm.armLen; let lastMean = null;
    grids.push({ start: base, rings: Ks, around: M });
    for (let k = 0; k < Ks; k++) {
      const s = lerp(s0, s1, k / (Ks - 1)), o = [ju[0] + axis[0] * s, ju[1] + axis[1] * s, ju[2] + axis[2] * s];
      const seg = planeSegments(w.pos, tris, o, axis, [side * e1[0], side * e1[1], side * e1[2]], e2);
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < seg.length; i += 2) { a0 = Math.min(a0, seg[i]); a1 = Math.max(a1, seg[i]); b0 = Math.min(b0, seg[i + 1]); b1 = Math.max(b1, seg[i + 1]); }
      if (!seg.length) { a0 = a1 = b0 = b1 = 0; }                 // the plane misses the arm (above the shoulder's cap): the axis point, and the radius of the ring below
      const ca = 0.5 * (a0 + a1), cb = 0.5 * (b0 + b1), hits = [];
      for (let m = 0; m < M; m++) { const th = (m / M) * 2 * Math.PI; hits.push(rayFar(seg, ca, cb, Math.cos(th), Math.sin(th))); }
      const good = hits.filter((x) => x > 0), mean = good.length ? good.reduce((x, y) => x + y, 0) / good.length : (lastMean ?? 0.05 * H) * 0.8; lastMean = good.length ? mean : lastMean;
      const t = k / (Ks - 1), puff = H * cut.sleevePuff * (cut.capPuff + (1 - cut.capPuff) * Math.sin(Math.PI * Math.pow(t, 0.8)));
      for (let m = 0; m < M; m++) {
        const th = (m / M) * 2 * Math.PI, d1 = Math.cos(th), d2 = Math.sin(th), r = (hits[m] > 0 ? hits[m] : mean) + H * (cut.sleeveEase + cut.capLift * (1 - t) * (1 - t)) + puff * (1 - cut.innerCut * Math.max(0, -d1));       // the side toward the ribs and the neck stays close
        // plane coordinates (ca + r d1, cb + r d2) back to 3D (e1 flipped for the right side so the angle runs the same way round the arm)
        const u1 = ca + r * d1, u2 = cb + r * d2;
        pos.push(o[0] + side * e1[0] * u1 + e2[0] * u2, o[1] + side * e1[1] * u1 + e2[1] * u2, o[2] + side * e1[2] * u1 + e2[2] * u2);
        const r0 = hits[m] > 0 ? hits[m] : mean, v1 = ca + r0 * d1, v2 = cb + r0 * d2;
        anchor.push(o[0] + side * e1[0] * v1 + e2[0] * v2, o[1] + side * e1[1] * v1 + e2[1] * v2, o[2] + side * e1[2] * v1 + e2[2] * v2);
        part.push(side > 0 ? 1 : 2); ring.push(k); edgeRing.push(k === 0 || k === Ks - 1 ? 1 : 0);
      }
    }
    for (let k = 0; k < Ks - 1; k++) for (let m = 0; m < M; m++) {
      const a = base + k * M + m, b = base + k * M + (m + 1) % M, c = base + (k + 1) * M + (m + 1) % M, d = base + (k + 1) * M + m;
      if (side < 0 && cut.rightSleeveOut) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d);
    }
    // the sleeve's top is closed by a fan over its first ring (no new vertices): an open top shows the sleeve's inside through the shoulder, which the renderer lights as a dark patch
    // (tools/people/garment-interior.mjs counts them), and on a broad shoulder it is a disc a centimetre or two across. The fan winds as the tube does, so its normal is the tube's outward.
    for (let m = 1; m < M - 1; m++) { const a = base, b = base + m, c = base + m + 1; if (side < 0 && cut.rightSleeveOut) tri.push(a, b, c); else tri.push(a, c, b); }
  }
  return { grids, pos: Float32Array.from(pos), anchor: Float32Array.from(anchor), index: Uint16Array.from(tri), part: Uint8Array.from(part), ring: Uint8Array.from(ring), edge: Uint8Array.from(edgeRing) };
}

// The skin weights of a grid of rings (a part), smoothed `iters` times over each vertex and its four neighbours, as dense weight vectors over the bones, then the four
// heaviest kept and renormalised. Rings with different weights turn against each other in a walk, and the cloth between them folds.
function smoothSkin({ start, rings, around }, si, sw, iters = 6) {
  const nb = BONES.length, V = rings * around; let cur = new Float32Array(V * nb), nxt = new Float32Array(V * nb);
  for (let i = 0; i < V; i++) for (let k = 0; k < K; k++) cur[i * nb + si[(start + i) * K + k]] += sw[(start + i) * K + k];
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < rings; k++) for (let j = 0; j < around; j++) {
      const i = k * around + j, a = k * around + (j + 1) % around, c = k * around + (j + around - 1) % around, u = k > 0 ? i - around : i, d = k < rings - 1 ? i + around : i;
      for (let q = 0; q < nb; q++) nxt[i * nb + q] = 0.4 * cur[i * nb + q] + 0.15 * (cur[a * nb + q] + cur[c * nb + q] + cur[u * nb + q] + cur[d * nb + q]);
    }
    [cur, nxt] = [nxt, cur];
  }
  for (let i = 0; i < V; i++) {
    const row = []; for (let q = 0; q < nb; q++) if (cur[i * nb + q] > 1e-4) row.push([q, cur[i * nb + q]]);
    row.sort((p, r) => r[1] - p[1] || p[0] - r[0]); const top = row.slice(0, K); let sum = 0; for (const [, x] of top) sum += x;
    for (let k = 0; k < K; k++) { si[(start + i) * K + k] = top[k] ? top[k][0] : 0; sw[(start + i) * K + k] = top[k] ? top[k][1] / sum : 0; }
  }
}

// Skin weights, the same for every wearer, fixed on the template. The stays are rigid, so the torso takes the body's own weights from the torso alone (the
// nearest torso triangle to the surface point it stands off from, never an arm hanging beside it), smoothed over the rings: chest above the waist, spine through it,
// a little hips where the point reaches the belly. The sleeve cap is sewn to the chest and the sleeve below it follows the arm, the full sleeve gathering between.
export function bodiceSkin(g, binding, w, lm, cut) {
  const V = g.pos.length / 3, si = new Uint16Array(V * K), sw = new Float32Array(V * K);
  const torsoTris = (() => { const o = []; for (let t = 0; t < BODY_INDEX.length; t += 3) if (!w.arm[BODY_INDEX[t]] && !w.arm[BODY_INDEX[t + 1]] && !w.arm[BODY_INDEX[t + 2]] && !w.leg[BODY_INDEX[t]] && !w.leg[BODY_INDEX[t + 1]] && !w.leg[BODY_INDEX[t + 2]]) o.push(BODY_INDEX[t], BODY_INDEX[t + 1], BODY_INDEX[t + 2]); return Uint16Array.from(o); })();
  const tp = [], ta = [], tv = [];
  for (let v = 0; v < V; v++) if (g.part[v] === 0) { tv.push(v); tp.push(g.pos[3 * v], g.pos[3 * v + 1], g.pos[3 * v + 2]); ta.push(g.anchor[3 * v], g.anchor[3 * v + 1], g.anchor[3 * v + 2]); }
  const tb = bind(Float32Array.from(tp), w.pos, torsoTris, Float32Array.from(ta)), tskin = blendSkin(tb, w.skinIndex, w.skinWeight);       // the body's own weights at the surface point it stands off from
  tv.forEach((v, i) => { for (let k = 0; k < K; k++) { si[v * K + k] = tskin.skinIndex[i * K + k]; sw[v * K + k] = tskin.skinWeight[i * K + k]; } });
  smoothSkin(g.grids[0], si, sw, cut.skinSmooth);              // stays are rigid: neighbouring rings turn together, so the cloth never folds between them
  // the sleeves take the arm's own skin weights through their binding to the arm (and the layer's sleeve over it): the shoulder cap turns with the shoulder as the
  // body there does, and the sleeve follows the upper arm below it. (A fixed blend of chest and arm left the cap behind the arm's swing: the arm came out of the cap.)
  const bs = blendSkin(binding, w.skinIndex, w.skinWeight);
  for (let v = 0; v < V; v++) {
    if (g.part[v] === 0) continue;
    // the cap is sewn to the bodice (it follows the chest) and the sleeve below it follows the arm; between, the full sleeve gathers. The arm swings inside the cap,
    // which stands off it far enough to hold it (cut.capPuff).
    const S = g.part[v] === 1 ? "L" : "R", ju = w.J[BI["upperarm" + S]], jf = w.J[BI["forearm" + S]], axis = [jf[0] - ju[0], jf[1] - ju[1], jf[2] - ju[2]], al = Math.hypot(...axis);
    const s = ((g.pos[3 * v] - ju[0]) * axis[0] + (g.pos[3 * v + 1] - ju[1]) * axis[1] + (g.pos[3 * v + 2] - ju[2]) * axis[2]) / al, lam = cut.capArm + (1 - cut.capArm) * smooth(0, cut.capSew * lm.H, s);
    const acc = new Map([[BI.chest, 1 - lam]]);
    for (let k = 0; k < K; k++) { const wt = bs.skinWeight[v * K + k]; if (wt > 0) { const bn = bs.skinIndex[v * K + k]; acc.set(bn, (acc.get(bn) ?? 0) + lam * wt); } }
    const top = [...acc].filter(([, x]) => x > 0).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, K);
    let sum = 0; for (const [, x] of top) sum += x;
    top.forEach(([bn, x], k) => { si[v * K + k] = bn; sw[v * K + k] = x / sum; });
  }
  return { skinIndex: si, skinWeight: sw };
}

// Each part binds to the part of the person it dresses: the torso to the torso's base layer alone (never an arm hanging beside it, which would carry the garment away
// from the torso on a body whose arms hang elsewhere), each sleeve to its own arm. The three bindings are one in the vertex order.
function trianglesOf(index, keep) {
  const o = [];
  for (let t = 0; t < index.length; t += 3) if (keep(index[t]) && keep(index[t + 1]) && keep(index[t + 2])) o.push(index[t], index[t + 1], index[t + 2]);
  return Uint16Array.from(o);
}
const join = (a, c) => { const o = new Uint16Array(a.length + c.length); o.set(a); o.set(c, a.length); return o; };
export function bindParts(g, w) {
  const nrm = bodyNormals(w.pos);
  const V = g.pos.length / 3, ids = new Uint16Array(V * 3), wt = new Float32Array(V * 3), off = new Float32Array(V * 3), dist = new Float32Array(V);
  const sets = [
    [0, trianglesOf(LAYER_INDEX, (v) => !w.arm[v] && !w.leg[v])],                               // the torso: the base layer over it (the garment must clear the layer, which stands 1 to 4 cm off the body and differs from person to person)
    [1, join(trianglesOf(BODY_INDEX, (v) => w.arm[v] && w.pos[3 * v] > 0), trianglesOf(LAYER_INDEX, (v) => w.arm[v] && w.pos[3 * v] > 0))],   // the sleeves: the arm, and the layer's short sleeve over it
    [2, join(trianglesOf(BODY_INDEX, (v) => w.arm[v] && w.pos[3 * v] < 0), trianglesOf(LAYER_INDEX, (v) => w.arm[v] && w.pos[3 * v] < 0))],
  ];
  for (const [part, tris] of sets) {
    const sel = []; for (let v = 0; v < V; v++) if (g.part[v] === part) sel.push(v);
    const pts = new Float32Array(sel.length * 3); sel.forEach((v, i) => pts.set(g.pos.subarray(3 * v, 3 * v + 3), 3 * i));
    const anc = new Float32Array(sel.length * 3); sel.forEach((v, i) => anc.set(g.anchor.subarray(3 * v, 3 * v + 3), 3 * i));
    const bd = bind(pts, w.pos, tris, anc, nrm);
    sel.forEach((v, i) => { ids.set(bd.ids.subarray(3 * i, 3 * i + 3), 3 * v); wt.set(bd.w.subarray(3 * i, 3 * i + 3), 3 * v); off.set(bd.off.subarray(3 * i, 3 * i + 3), 3 * v); dist[v] = bd.dist[i]; });
  }
  return { n: V, ids, w: wt, off, dist };
}

/** Which of a fitted garment's pieces cover each of a person's vertices (a bit per part, 1 torso, 2 and 4 the sleeves): the vertices whose nearest point on a piece
 *  is clear of its open edges by `margin`, within `maxDist`, and inside it or no more than `outside` out of it (the sweep takes a few centimetres, so a poor fit shows;
 *  the garment's own hides take none).
 *
 *  The body a garment hides, as MakeHuman's delete_verts: region[v] for each drawn body vertex v (0 shown, else the part of the garment over it: 1 the
 *  torso, 2 and 3 the sleeves), the vertices lying inside the shell and clear of its open edges by a ring, so no hole opens where it ends. The base
 *  layer is never hidden (nobody is drawn unclothed). `reduced(RED)` gives the same for the 1.5k mesh: a reduced vertex is hidden when the three body
 *  vertices it is bound to all are. */
export function hiddenBody(g, w, H, maxDist = 0.05, margin = 0.011, from = 0, to = NBODY, outside = 0) {
  const P = g.pos, region = new Uint8Array(to - from), mask = new Uint8Array(to - from);
  const rim = [], parts = [0, 1, 2].map((p) => {
    const idx = []; for (let t = 0; t < g.index.length; t += 3) if (g.part[g.index[t]] === p) idx.push(g.index[t], g.index[t + 1], g.index[t + 2]);
    const index = Uint16Array.from(idx), open = boundaryEdges(index), r = [];
    for (let e = 0; e < open.length; e++) if (open[e]) { const t = Math.floor(e / 3) * 3, k = e % 3; r.push(index[t + k] * 3, index[t + (k + 1) % 3] * 3); }
    return { grid: new TriGrid(P, index, 0.03), fn: faceNormals(P, index), rim: r };
  });
  const rimDist2 = (rim, x, y, z) => {
    let best = Infinity;
    for (let i = 0; i < rim.length; i += 2) {
      const a = rim[i], b = rim[i + 1], ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2], px = x - P[a], py = y - P[a + 1], pz = z - P[a + 2];
      const t = Math.max(0, Math.min(1, (px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez || 1)));
      const d = (px - ex * t) ** 2 + (py - ey * t) ** 2 + (pz - ez * t) ** 2; if (d < best) best = d;
    }
    return best;
  };
  const m2 = Math.max(margin * (H / 1.62), 0.0015) ** 2;                    // never closer than 1.5 mm to an open edge: a point past the edge has its nearest point on it
  let count = 0;
  for (let v = from; v < to; v++) {
    if (!w.trunk[v]) continue;                                    // the neck and head, the forearm and hand beside the waist, the legs (the skirt's) are not under the bodice
    const x = w.pos[3 * v], y = w.pos[3 * v + 1], z = w.pos[3 * v + 2];
    for (let p = 0; p < 3; p++) {
      if (w.arm[v] && p === 0) continue;                        // an upper arm beside the ribs is the arm's, not the torso piece's: it moves away from it in a walk
      const { grid, fn, rim } = parts[p], h = grid.nearest(x, y, z, maxDist * (H / 1.62)); if (!h) continue;
      const t = h.tri * 3, s = (x - h.q[0]) * fn[t] + (y - h.q[1]) * fn[t + 1] + (z - h.q[2]) * fn[t + 2];
      if (s >= outside || rimDist2(rim, h.q[0], h.q[1], h.q[2]) < m2) continue;                  // inside the piece, or no more than `outside` out of it
      mask[v - from] |= 1 << p; if (!region[v - from]) { region[v - from] = p + 1; count++; }
    }
  }
  return { region, mask, count, from, reduced(RED) { return reducedHides(region, RED); } };
}
/** A hides region (a region id per drawn body vertex) as the reduced mesh's: a reduced vertex is hidden when the three body vertices it is bound to all are, a seam or hem copy goes with its original. */
export function reducedHides(region, RED) {
  const out = new Uint8Array(RED.D);
  for (let r = 0; r < RED.R; r++) { const x = region[RED.ids[3 * r]], y = region[RED.ids[3 * r + 1]], z = region[RED.ids[3 * r + 2]]; if (x && y && z) out[r] = x; }
  for (let d = RED.R; d < RED.D; d++) out[d] = out[RED.owner[d]];
  return out;
}

/** Build the bodice template for a cut on a template wearer (`near` = shape.js buildNear of the cut's mean body).
 *  Returns { cut, V, index, part, ring, edge, binding, skin, hides, covers, lm, pos }, everything a fit and a draw need. */
export function bodiceGeometry(near, cutName = "adult") {
  const cut = CUTS[cutName], w = readWearer(near), H = near.height;
  const table = torsoTable(w, w.J[BI.hips][1] - 0.1 * H, w.J[BI.upperarmL][1] + 0.03 * H);
  const lm = landmarks(w, table);
  const g = generate(w, table, lm, cut);
  // outward normals: the winding is checked against the axis, and flipped when it faces in
  const fn = faceNormals(g.pos, g.index);
  let outward = 0, count = 0;
  for (let t = 0; t < g.index.length; t += 3) if (g.part[g.index[t]] === 0) {
    const a = g.index[t] * 3, y = g.pos[a + 1], c = table.centre(y); outward += fn[t] * (g.pos[a] - c[0]) + fn[t + 2] * (g.pos[a + 2] - c[1]); count++;
  }
  if (outward < 0) for (let t = 0; t < g.index.length; t += 3) { const x = g.index[t + 1]; g.index[t + 1] = g.index[t + 2]; g.index[t + 2] = x; }
  return { cut, w, H, table, lm, g };
}
export function bodiceTemplate(near, cutName = "adult") {
  const { cut, w, H, lm, g } = bodiceGeometry(near, cutName);
  const binding = bindParts(g, w);
  const skin = bodiceSkin(g, binding, w, lm, cut);
  const hides = hiddenBody(g, w, H);
  // what the shell covers at the template, clear of its open edges by 35 mm (a vertex nearer a rim is the rim's question: it moves in and out of the edge with the body's build):
  // the sweep measures penetration over these, the body's and the base layer's, in each person's fitted garment (rest and poses)
  const covers = { body: hiddenBody(g, w, H, 0.06, 0.035).mask, layer: hiddenBody(g, w, H, 0.06, 0.035, NBODY, NFULL).mask };      // bit p set: part p covers it
  return { cut, cutName, V: g.pos.length / 3, grids: g.grids, index: g.index, part: g.part, ring: g.ring, edge: g.edge, binding, skin, hides, covers, lm, pos: g.pos, templateH: H, templateWearer: w, ref: shoulderRef(w, H) };
}
/** What pinShoulders needs of the template's own body: its height and the two shoulder joints (the upper arms'). */
export const shoulderRef = (w, H) => ({ H, L: Array.from(w.J[BI.upperarmL]), R: Array.from(w.J[BI.upperarmR]) });

/** The shoulder girdle is held to the skeleton, and the neckline is never lower than the skeleton says (R5 polish: the bodice's near-to-mid rim gap).
 *  The binding carries a vertex by the triangle of body surface under it, which is right over a chest or a back but not at the shoulder: the straps of the neckline (the top two
 *  rings, where they run over the shoulder) and the sleeve's cap (its first three rings) stand 3 to 5 cm off the surface or on its far side (the template's binding says -5 to +5 cm
 *  there), so a body's shape and the mesh's resolution move them by centimetres, differently in the full body and in the reduced one. Those vertices are put where the shoulder
 *  joint puts them: the template's offset from its own joint, scaled by the height. And the neckline's top two rings (front, back and sides) are raised to where the skeleton
 *  puts them when the binding left them lower (a sagging chest's sternum), never lowered, so they never go into the body.
 *  `J` the wearer's rest joints (any tier's: the full body's, the reduced body's or the far table's agree to millimetres), `height` the wearer's. Only + - * /. */
export function pinShoulders(pos, template, J, height) {
  const ref = template.ref; if (!ref) return pos;
  const s = height / ref.H, T = template.pos, g = template.grids[0], top = g.start + (g.rings - 1) * g.around, Ju = J[BI.upperarmL], Jv = J[BI.upperarmR];
  let rmax = 0; for (let j = 0; j < g.around; j++) { const x = Math.abs(T[3 * (top + j)]); if (x > rmax) rmax = x; }
  const put = (v, Jp, Jt) => { for (let a = 0; a < 3; a++) pos[3 * v + a] = Jp[a] + (T[3 * v + a] - Jt[a]) * s; };
  for (let k = g.rings - 2; k < g.rings; k++) for (let j = 0; j < g.around; j++) {
    const v = g.start + k * g.around + j, ideal = Ju[1] + (T[3 * v + 1] - ref.L[1]) * s;
    if (pos[3 * v + 1] < ideal) pos[3 * v + 1] = ideal;
  }
  for (let k = g.rings - 2; k < g.rings; k++) for (let j = 0; j < g.around; j++) {
    const v = g.start + k * g.around + j, x = T[3 * v];
    if (Math.abs(x) >= 0.5 * rmax) put(v, x > 0 ? Ju : Jv, x > 0 ? ref.L : ref.R);
  }
  for (const [part, Jp, Jt] of [[1, Ju, ref.L], [2, Jv, ref.R]]) { const q = template.grids[part]; for (let k = 0; k < 3; k++) for (let m = 0; m < q.around; m++) put(q.start + k * q.around + m, Jp, Jt); }
  return pos;
}
/** The stays' straight front on a body of any shape: down each column of the torso's rings (the same angle round), the radius from the ring's centre is taken to the
 *  upper hull of its profile against height, as the template was cut (generate()), by the cut's own flattening and the front's weight. It bridges the creases
 *  under a sagging bust and over a belly that the binding carries over from the template's different body, and only ever moves a vertex out. */
function stays(pos, template) {
  const { start, rings, around } = template.grids[0], flat = template.cut.flatten;
  if (!(flat > 0)) return;
  const cx = new Float64Array(rings), cz = new Float64Array(rings), ys = new Float64Array(rings), rs = new Float64Array(rings);
  for (let k = 0; k < rings; k++) { let x = 0, z = 0; for (let j = 0; j < around; j++) { x += pos[3 * (start + k * around + j)]; z += pos[3 * (start + k * around + j) + 2]; } cx[k] = x / around; cz[k] = z / around; }
  for (let j = 0; j < around; j++) {
    const th = (j / around) * 2 * Math.PI, wgt = Math.pow(Math.max(0, Math.cos(th)), 1.5) * flat; if (wgt <= 0) continue;
    for (let k = 0; k < rings; k++) { const v = start + k * around + j; ys[k] = pos[3 * v + 1]; rs[k] = Math.hypot(pos[3 * v] - cx[k], pos[3 * v + 2] - cz[k]); }
    const hull = upperHull(ys, rs);
    for (let k = 0; k < rings; k++) {
      const v = start + k * around + j, r = lerp(rs[k], Math.max(rs[k], hull(ys[k])), wgt);
      if (r > rs[k] + 1e-6) { const s = r / (rs[k] || 1); pos[3 * v] = cx[k] + (pos[3 * v] - cx[k]) * s; pos[3 * v + 2] = cz[k] + (pos[3 * v + 2] - cz[k]) * s; }
    }
  }
}

/** Stiff cloth does not follow a body's creases: the garment's rings (each part is a grid of rings round) are smoothed, outward only, so a hollow in the body (the fold
 *  under a sagging bust, a belly's crease) is bridged and a ridge is kept. Each vertex moves along its own normal to the mean of its four neighbours when that is
 *  further out, never in: the shell stays clear of the body it was bound at. `normal` are the garment's vertex normals (normalsOf). */
export function relax(pos, template, iters = 3, tmp = new Float32Array(pos.length)) {
  stays(pos, template);
  for (let it = 0; it < iters; it++) {
    const normal = normalsOf(pos, template.index);
    tmp.set(pos);
    for (const { start, rings, around } of template.grids) for (let k = 0; k < rings; k++) for (let j = 0; j < around; j++) {
      const v = start + k * around + j, a = start + k * around + (j + 1) % around, c = start + k * around + (j + around - 1) % around, u = k > 0 ? start + (k - 1) * around + j : -1, d = k < rings - 1 ? start + (k + 1) * around + j : -1;
      let n = 2, mx = pos[3 * a] + pos[3 * c], my = pos[3 * a + 1] + pos[3 * c + 1], mz = pos[3 * a + 2] + pos[3 * c + 2];
      if (u >= 0) { mx += pos[3 * u]; my += pos[3 * u + 1]; mz += pos[3 * u + 2]; n++; }
      if (d >= 0) { mx += pos[3 * d]; my += pos[3 * d + 1]; mz += pos[3 * d + 2]; n++; }
      mx /= n; my /= n; mz /= n;
      const out = (mx - pos[3 * v]) * normal[3 * v] + (my - pos[3 * v + 1]) * normal[3 * v + 1] + (mz - pos[3 * v + 2]) * normal[3 * v + 2];
      if (out > 0) { tmp[3 * v] = pos[3 * v] + out * normal[3 * v]; tmp[3 * v + 1] = pos[3 * v + 1] + out * normal[3 * v + 1]; tmp[3 * v + 2] = pos[3 * v + 2] + out * normal[3 * v + 2]; }
    }
    pos.set(tmp);
  }
  return pos;
}
export { fit, normalsOf, bodyNormals };
