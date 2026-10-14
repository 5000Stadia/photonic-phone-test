// The gentlewoman for the mid and far tiers and the class meshes of every tier (R5; design/r5-plan.md "The wardrobe", "After the outside reviews"). Plain JS, no three.
//
// A reduced bodice (336 vertices: 24 round, 8 rings, sleeves 12 x 6; bodice.js CUTS "adult-r" ...) is cut on the cut's own mean body like the full one, but bound (the .mhclo-style
// binding, bind.js) to the REDUCED mesh's triangles, so it is fitted from a person's reduced body positions alone: the mid tier's exact ones (shape.js build().position) or the far tier's,
// read from the coefficients (farReducedPositions): never from the full body. The base layer is a flag on the reduced body (cloth), so the shift's neck cut is static per class here.
//
//   reducedTemplateFor(cutId)             the reduced bodice template of a cut ("adult", "girl", "small"): from the pack when there is one, else built (about 10 s: the shell is shaped to the full one and the
//                                         binding chosen by training people, "the reduced shell, made to match the full one" below)
//   buildReducedTemplate(cutId)           built from scratch (what the pack is made of)
//   fitReduced(template, redPositions, J, height)    { position, normal } of the bodice on a reduced body (Float32Array R x 3 or longer: the geometric vertices first)
//   bakeNear(near, params, outfit)        { cut, bodice: { template, position, normal }, layerCut } for the near tier (the full path, dress() without the skirt)
//   bakeReduced(redPositions, params, outfit, J)   { cut, bodice: { template, position, normal } } for the mid and far tiers
//   farReducedPositions(coef, scale, out) the far body's reduced positions at height `scale` from its 16 coefficients (far.position): Float32Array, the R geometric vertices first
//   hiddenReduced()                       Uint8Array(RED.D): the reduced body's vertices every cut's bodice hides; indexWithout(hidden) the reduced mesh MID.index without them
//   skirtIndexFor(rings, around)          the skirt tube's triangles (Uint16Array), the vertex of ring k, column j being k * around + j
//   outfitLayout(outfit, tier, opts)      the class mesh's static layout, below
//
// ---- outfitLayout(outfit, tier, { rings, around }) ------------------------------------------------------------------------------------------------------------------------------
// tier "near":    vertices [0, bodyV) the NEAR mesh (shape.js NEAR: the drawn body, its base layer, the eyes), then [bodyV, bodyV + bodiceV) the full bodice (624), then
//                 [bodyV + bodiceV, V) the skirt tube, 16 rings x 40 columns (640)
// tier "reduced": (mid) [0, bodyV) the reduced mesh with its eye fans (shape.js MID: V = D + 2 eye fans), then the reduced bodice (about 256), then the skirt tube, 16 x 24
// tier "far":     the same vertices as "reduced" (the far tier draws the reduced mesh too, TEMPLATE in bodies.js); { rings, around } choose another skirt profile for the far class, default
//                 the reduced one's
// Returned, all plain typed arrays over V vertices:
//   skinIndex (Uint16 x4), skinWeight (Float32 x4)   the body's, the bodice's (the ADULT cut's weights for every cut: one static set), zeros for the skirt (it is not skinned)
//   paint (Float32 x4: r, g, b, kind)   kind 0 the person's skin, 1 the person's tint (the base layer, when the outfit declares none), 2 the vertex's own colour (eyes), 3 the bodice (the
//                 person's bodice colour), 4 the skirt (the person's skirt colour), 5 the shift (the base layer when the outfit declares one: rgb is the outfit's layer colour, linear).
//                 6 the stockings (the person's own, agent texel 6; an outfit's `painted`). 7 the skirt's colour a shade darker (the working man's knee band, outfit.painted.band).
//                 near: the layer's vertices are 5; reduced and far: the body's cloth vertices (MID.paint.w = 1) are 5, except those above the shift's cut line on the adult's mean reduced
//                 body (the neckline of the reduced bodice plus the layer's margin), which are 0, bare neck and shoulders. The near layer's cut stays the per-person number layerCut. At reduced and far the
//                 bodice's top ring (its neckline's edge) is 5 as well, a painted band standing for the shift's edge, which the 2 cm triangles cannot cut.
//   skirtRC (Float32 x3)   ring k, column j and tube t (the leg: 0 or 1, for the divided breeches; 0 for a skirt) of each skirt vertex (zeros elsewhere); vertex of tube t, ring k, column j is skirt-first + (t * rings + k) * around + j
//   bodyV, bodiceV, skirtV, V, rings, around, ranges: { body: [a, b], bodice: [a, b], skirt: [a, b] }
//   indexFor(mask)   Uint16Array of triangles, mask bit 0 bodice worn, bit 1 skirt worn, bit 2 (4) the neckwear (the falling band, the neckerchief) off, bit 3 (8) the apron off: the body's (reduced and far: less the triangles of vertices the bodice hides, when it is worn;
//                    near: all), the bodice's (offset by bodyV) if bit 0, the skirt's (offset) if bit 1. Cached.
//   hidden (reduced and far only)   Uint8Array(bodyV) of the body vertices the bodice hides (the intersection over the three cuts)
import { RED, MID, NEAR, build, buildNear, paramsFor } from "../shape.js";
import { resolve } from "../../traits/resolve.js";
import { loadFar } from "../../spikes/makehuman/reduced.js";
import { bodiceGeometry, bindParts, bodiceSkin, relax, fit, pinShoulders, pinFieldOf, shoulderRef, normalsOf as bodiceNormals, CUTS, SET_OF } from "./bodice.js";
import { bind, bindToTriangle } from "./bind.js";
import { normalsOf, TriGrid } from "./geom.js";
import { BI } from "./wearer.js";
import { neckline, pseudoAngle } from "./layer.js";
import { GENTLEWOMAN, MEAN_BODIES, BASE_CUT, OUTFITS, cutFor, templateFor } from "./outfit.js";
import { layerCut } from "./layer.js";
import { bodyNormals } from "./bind.js";
import { packed } from "./pack.js";
import { RINGS } from "./skirt.js";

const R = RED.R, D = RED.D, K = 4;
const FAR = await loadFar("far-1500");

// ---- the reduced mesh as a bodice binds to it -------------------------------------------------------------------------------------------------------------------------------
const GEO = (() => { const g = new Uint16Array(RED.index.length); for (let i = 0; i < g.length; i++) g[i] = RED.owner[RED.index[i]]; return g; })();     // the triangles on the geometric vertices
const ARM_BONES = new Set(["upperarmL", "forearmL", "handL", "upperarmR", "forearmR", "handR"].map((n) => BI[n]));
const LEG_BONES = new Set(["thighL", "shinL", "footL", "toeL", "thighR", "shinR", "footR", "toeR"].map((n) => BI[n]));
const ARM = new Uint8Array(R), LEG = new Uint8Array(R);
for (let v = 0; v < R; v++) { let a = 0, l = 0; for (let k = 0; k < K; k++) { const b = MID.skinIndex[v * K + k], x = MID.skinWeight[v * K + k]; if (ARM_BONES.has(b)) a += x; if (LEG_BONES.has(b)) l += x; } ARM[v] = a >= 0.5 ? 1 : 0; LEG[v] = l >= 0.5 ? 1 : 0; }
const trianglesOf = (keep) => { const o = []; for (let t = 0; t < GEO.length; t += 3) if (keep(GEO[t]) && keep(GEO[t + 1]) && keep(GEO[t + 2])) o.push(GEO[t], GEO[t + 1], GEO[t + 2]); return Uint16Array.from(o); };
/** The reduced mesh's triangles (on geometric vertices) as a bodice binds to it: [torso, left arm, right arm], arms by the side of x in `pos` (R x 3 or longer). */
const SETS = (pos) => [trianglesOf((v) => !ARM[v] && !LEG[v]), trianglesOf((v) => ARM[v] && pos[3 * v] > 0), trianglesOf((v) => ARM[v] && pos[3 * v] < 0)];      // torso, left sleeve, right sleeve

export const bodySets = (pos) => SETS(pos);

// The vertex normals a binding's frames use: each part's own triangles only (torso, arms), so the armpit and the shoulder, where a vertex of an arm and a vertex of the chest share a triangle
// that no part uses, do not blend the two surfaces' normals (the frames there turned with the body's build and the sleeve's inner side slid through it).
let UNION = null;
const partNormals = (pos, out) => {
  if (!UNION) { const o = []; for (const t of SETS(pos)) for (const i of t) o.push(i); UNION = Uint16Array.from(o); }
  return normalsOf(pos.subarray(0, R * 3), UNION, out);
};

/** The binding of a generated bodice g (on the cut's mean full body) to the cut's mean reduced body `redPos`: the torso to the torso's triangles, each sleeve to its arm's, as bindParts does on the full body. */
function bindReduced(g, redPos, H, gpos = g.pos) {
  const ext = g.part.some((p) => p >= 7), nrm = ext ? normalsOf(redPos.subarray(0, R * 3), GEO) : partNormals(redPos), V = g.pos.length / 3, ids = new Uint16Array(V * 3), wt = new Float32Array(V * 3), off = new Float32Array(V * 3), dist = new Float32Array(V);
  const mid = 0.0123 * H, lower = ext ? [trianglesOf((v) => !ARM[v]), trianglesOf((v) => !ARM[v] && redPos[3 * v] > -mid), trianglesOf((v) => !ARM[v] && redPos[3 * v] < mid)] : [];       // the breeches: the hips and legs, each leg's side
  [...SETS(redPos), ...lower].forEach((tris, part) => {
    const sel = []; for (let v = 0; v < V; v++) if (SET_OF(g.part[v]) === part) sel.push(v);
    const pts = new Float32Array(sel.length * 3), anc = new Float32Array(sel.length * 3);
    sel.forEach((v, i) => { pts.set(gpos.subarray(3 * v, 3 * v + 3), 3 * i); anc.set(g.anchor.subarray(3 * v, 3 * v + 3), 3 * i); });
    const bd = bind(pts, redPos, tris, anc, nrm);
    sel.forEach((v, i) => { ids.set(bd.ids.subarray(3 * i, 3 * i + 3), 3 * v); wt.set(bd.w.subarray(3 * i, 3 * i + 3), 3 * v); off.set(bd.off.subarray(3 * i, 3 * i + 3), 3 * v); dist[v] = bd.dist[i]; });
  });
  return { n: V, ids, w: wt, off, dist, smooth: true };
}

// ---- the reduced shell, made to match the full one (R5 far torso) --------------------------------------------------------------------------------------------------------------
// design/r5-plan.md "Far torso" says what was measured. The reduced bodice (24 columns round, and 8 rings on the adult cut) is the full one (40 and 12) resampled and bound to the reduced body, and it
// misses the full one by 1.5 to 1.9 cm at the worst person. Three things made the miss, and three steps undo them, all here and all offline: the packs carry the result (garment-pack.mjs).
//   1. shapeToFull: on the very same mean body the two shells differ by 1.0 to 1.4 cm at the shoulder and the armhole, where the cut's edge turns between the coarse samples. The coarse parts' vertices
//      are moved, once, to where the full shell's surface asks of them: each full vertex pulls the three coarse vertices of the triangle nearest it, and each coarse vertex is pulled to the full surface,
//      the farther ones harder, so the worst are served first (the check's measure is a worst case). The parts on the same grid as the full cut's (the sleeves) are the full vertices already.
//   2. tuneBinding: a garment vertex is bound to the reduced triangle under the point it stands off from, which is right on the mean body and often not the best on everyone else's: at the armpit and
//      the shoulder, where the reduced mesh's few triangles cross a hollow, a vertex some centimetres off the surface turns with its triangle's frame, and that frame turns with the build more than the
//      full body's does. Each coarse vertex is offered its nearest triangles (bound so the template is reproduced on the mean body whichever is chosen) and keeps the one whose fit comes closest, over
//      training people, to the full template's fit to the same people (the target: the full shell at the same place on its rings and columns; the sum of fourth powers, so a rare bad person counts).
//      Then the offsets, by least squares over the same people.
//   3. (fitReduced) the fit reads the same normals the binding was made with: the doublet cuts' binding used every triangle's normals and the fit the parts', so even the mean body did not give the
//      template back (up to 7 cm on a sleeve).
// The training people are the far fit's own training set (its first 1,200 people, never the held-out 400 the checks use) of the cut's sex and ages.
const SHELL = { iters: 60, step: 0.5, weight: 300 };
const TUNE = { people: 300, candidates: 24, gain: 0.95, ridge: 1e-3, skipOffsets: [0] };      // (the offsets of the torso are left: a least-squares offset follows the full shell's lumps at the armpit and spends the tail)
function shapeToFull(pos, index, part, grids, full) {
  const parts = new Set();
  grids.forEach((g, i) => { const f = full.grids[i]; if (f && (f.rings !== g.rings || f.around !== g.around)) parts.add(i); });
  if (!parts.size) return pos;
  const free = new Uint8Array(pos.length / 3); for (let v = 0; v < free.length; v++) if (parts.has(part[v])) free[v] = 1;
  const out = Float32Array.from(pos), ex = full.pos, gb = new TriGrid(ex, full.index, 0.008), g = new Float64Array(out.length), W = new Float64Array(free.length);
  for (let it = 0; it < SHELL.iters; it++) {
    const ga = new TriGrid(out, index, 0.008); g.fill(0); W.fill(0);
    for (let v = 0; v < ex.length / 3; v++) {
      if (!parts.has(full.part[v])) continue;
      const h = ga.nearest(ex[3 * v], ex[3 * v + 1], ex[3 * v + 2]); if (!h) continue;
      const wt = 1 + SHELL.weight * Math.sqrt(h.d2);
      for (let k = 0; k < 3; k++) { const c = index[3 * h.tri + k], b = h.bary[k] * wt; if (!free[c]) continue; for (let a = 0; a < 3; a++) g[3 * c + a] += b * (ex[3 * v + a] - h.q[a]); W[c] += b * h.bary[k]; }
    }
    for (let v = 0; v < free.length; v++) {
      if (!free[v]) continue;
      const h = gb.nearest(out[3 * v], out[3 * v + 1], out[3 * v + 2]); if (!h) continue;
      const wt = 1 + SHELL.weight * Math.sqrt(h.d2);
      for (let a = 0; a < 3; a++) g[3 * v + a] += wt * (h.q[a] - out[3 * v + a]); W[v] += wt;
    }
    for (let v = 0; v < free.length; v++) if (free[v] && W[v] > 0) for (let a = 0; a < 3; a++) out[3 * v + a] += SHELL.step * g[3 * v + a] / W[v];
  }
  return out;
}

/** The far fit's training people of a cut's sex and ages (at most TUNE.people of them, evenly from the 1,200). */
function trainingPeople(cutId) {
  const outfit = Object.values(OUTFITS).find((o) => o.cuts.some((c) => c.bodice === cutId)), cut = outfit.cuts.find((c) => c.bodice === cutId), male = MEAN_BODIES[cutId].sex > 0.5, all = [];
  for (let i = 0, n = 0; n < 1200; i++) {
    const res = resolve({ id: `far-fit:${i}`, seed: 9000 + i * 7919, said: "" }); if (!res.ok) continue; n++;
    const params = paramsFor(res.values, res.derived);
    if (params.age >= cut.ages[0] && params.age < cut.ages[1] && params.age >= outfit.ages.from && (params.sex > 0.5) === male) all.push(params);
  }
  const step = Math.max(1, Math.ceil(all.length / TUNE.people));
  return all.filter((_, i) => i % step === 0);
}

/** The binding of a reduced template (t, with its own binding bound on the mean body) chosen by the people it serves, as said above: a binding { n, ids, w, off, dist, smooth }. `full` the cut's full template,
 *  `redMean` the mean reduced body's positions. */
function tuneBinding(t, full, cutId, redMean) {
  const V = t.V, nrmOf = (pos) => (t.cut.doublet ? normalsOf(pos.subarray(0, R * 3), GEO) : partNormals(pos)), sets = SETS(redMean), people = trainingPeople(cutId), own = t.binding, NC = TUNE.candidates;
  // the full shell's vertices each coarse vertex is to match: four corners and their weights, at the same place along the part's rings and round it
  const corner = new Int32Array(V * 4), cw = new Float32Array(V * 4);
  for (let v = 0; v < V; v++) {
    const q = t.part[v], gc = t.grids[q], gf = full.grids[q], l = v - gc.start, k = Math.floor(l / gc.around), m = l % gc.around;
    const kf = gc.rings > 1 ? (k * (gf.rings - 1)) / (gc.rings - 1) : 0, jf = (m * gf.around) / gc.around, k0 = Math.min(gf.rings - 1, Math.floor(kf + 1e-9)), k1 = Math.min(gf.rings - 1, k0 + 1);
    const j0 = Math.floor(jf + 1e-9) % gf.around, j1 = (j0 + 1) % gf.around, a = kf - k0, b = jf - Math.floor(jf + 1e-9), at = (kk, jj) => gf.start + kk * gf.around + jj;
    corner.set([at(k0, j0), at(k0, j1), at(k1, j0), at(k1, j1)], 4 * v); cw.set([(1 - a) * (1 - b), (1 - a) * b, a * (1 - b), a * b], 4 * v);
  }
  // the candidates: the template's own binding, then the nearest triangles of the vertex's set, each bound at the point of it nearest the vertex
  const nm = nrmOf(redMean), cands = [], bindings = [];
  for (let v = 0; v < V; v++) {
    const set = sets[SET_OF(t.part[v])], px = t.pos[3 * v], py = t.pos[3 * v + 1], pz = t.pos[3 * v + 2], near = [];
    for (let i = 0; i < set.length; i += 3) near.push(bindToTriangle(px, py, pz, redMean, set[i], set[i + 1], set[i + 2], nm));
    near.sort((a, b) => a.d2 - b.d2);
    cands.push(near.slice(0, NC - 1));
  }
  const put = (b, v, c) => { b.ids.set(c.ids, 3 * v); b.w.set(c.w, 3 * v); b.off.set(c.off, 3 * v); b.dist[v] = c.dist; };
  const blank = () => ({ n: V, ids: new Uint16Array(V * 3), w: new Float32Array(V * 3), off: new Float32Array(V * 3), dist: new Float32Array(V), smooth: true });
  for (let r = 0; r < NC; r++) {
    const b = blank();
    for (let v = 0; v < V; v++) put(b, v, r === 0 ? { ids: own.ids.subarray(3 * v, 3 * v + 3), w: own.w.subarray(3 * v, 3 * v + 3), off: own.off.subarray(3 * v, 3 * v + 3), dist: own.dist[v] } : cands[v][Math.min(r - 1, cands[v].length - 1)]);
    bindings.push(b);
  }
  // the share of a vertex that pinShoulders takes from the fit: the fitted position counts for the rest only
  const share = new Float32Array(V), cutc = t.cut, pf = pinFieldOf(t), g0 = t.grids[0];
  pf.idx.forEach((v, n) => { share[v] = Math.max(pf.put[n], pf.side[n]); });
  for (const q of [t.grids[1], t.grids[2]]) for (let k = 0; k < Math.min(q.rings, cutc.pinSleeve ?? 3); k++) for (let m = 0; m < q.around; m++) share[q.start + k * q.around + m] = cutc.pinSleeveW ?? 1;
  if (cutc.pinShirt && t.grids[4]) for (let k = 0; k < cutc.pinShirt.rings; k++) for (let j = 0; j < t.grids[4].around; j++) share[t.grids[4].start + k * t.grids[4].around + j] = cutc.pinShirt.w;
  if (cutc.pinHem) for (let k = 0; k < cutc.pinHem.rings; k++) for (let j = 0; j < g0.around; j++) share[g0.start + k * g0.around + j] = cutc.pinHem.w;
  const keep = Float64Array.from(share, (x) => (1 - x) * (1 - x)), E = new Float32Array(full.V * 3), F = new Float32Array(V * 3), TV = new Float32Array(V * 3);
  // each person's target: the full template's fit to them, sampled at the coarse vertices
  const target = (near) => {
    fit(full.binding, near.position, E, 1, 1, bodyNormals(near.position));
    for (let v = 0; v < V; v++) for (let a = 0; a < 3; a++) { let x = 0; for (let c = 0; c < 4; c++) x += cw[4 * v + c] * E[3 * corner[4 * v + c] + a]; TV[3 * v + a] = x; }
  };
  const err = Array.from({ length: NC }, () => new Float64Array(V));
  for (const params of people) {
    const near = buildNear(params), mid = build(params), nr = nrmOf(mid.position); target(near);
    for (let r = 0; r < NC; r++) {
      fit(bindings[r], mid.position, F, 1, 1, nr);
      for (let v = 0; v < V; v++) { const dx = F[3 * v] - TV[3 * v], dy = F[3 * v + 1] - TV[3 * v + 1], dz = F[3 * v + 2] - TV[3 * v + 2], d2 = dx * dx + dy * dy + dz * dz; err[r][v] += keep[v] * d2 * d2; }
    }
  }
  const out = blank(); out.ids.set(own.ids); out.w.set(own.w); out.off.set(own.off); out.dist.set(own.dist);
  for (let v = 0; v < V; v++) {
    let best = 0; for (let r = 1; r < NC; r++) if (err[r][v] < err[best][v]) best = r;
    if (best !== 0 && err[best][v] < TUNE.gain * err[0][v]) put(out, v, { ids: bindings[best].ids.subarray(3 * v, 3 * v + 3), w: bindings[best].w.subarray(3 * v, 3 * v + 3), off: bindings[best].off.subarray(3 * v, 3 * v + 3), dist: bindings[best].dist[v] });
  }
  // then the offsets: with the triangles fixed the fit is linear in a vertex's offset (its frame times the offset), so the offset that brings the vertex nearest the target on average is a 3 x 3 solve; the
  // mean residual in the frames removes what is the same for everyone (where the full shell stands against this triangle)
  const A = new Float64Array(V * 9), rhs = new Float64Array(V * 3), F0 = new Float32Array(V * 3), cols = [0, 1, 2].map(() => new Float32Array(V * 3));
  const bump = [0, 1, 2].map((c) => { const b = blank(); b.ids.set(out.ids); b.w.set(out.w); b.off.set(out.off); for (let v = 0; v < V; v++) b.off[3 * v + c] += 1; return b; });
  for (const params of people) {
    const near = buildNear(params), mid = build(params), nr = nrmOf(mid.position); target(near);
    fit(out, mid.position, F0, 1, 1, nr);
    for (let c = 0; c < 3; c++) { fit(bump[c], mid.position, cols[c], 1, 1, nr); for (let i = 0; i < V * 3; i++) cols[c][i] -= F0[i]; }
    for (let v = 0; v < V; v++) {
      const r = [0, 1, 2].map((a) => TV[3 * v + a] - F0[3 * v + a]);
      for (let c = 0; c < 3; c++) {
        for (let d = 0; d < 3; d++) A[9 * v + 3 * c + d] += keep[v] * (cols[c][3 * v] * cols[d][3 * v] + cols[c][3 * v + 1] * cols[d][3 * v + 1] + cols[c][3 * v + 2] * cols[d][3 * v + 2]);
        rhs[3 * v + c] += keep[v] * (cols[c][3 * v] * r[0] + cols[c][3 * v + 1] * r[1] + cols[c][3 * v + 2] * r[2]);
      }
    }
  }
  for (let v = 0; v < V; v++) {
    if (TUNE.skipOffsets.includes(t.part[v])) continue;
    const a = A.subarray(9 * v, 9 * v + 9), lam = TUNE.ridge * (a[0] + a[4] + a[8]) / 3; a[0] += lam; a[4] += lam; a[8] += lam;
    const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]); if (!(Math.abs(det) > 1e-30)) continue;
    const inv = [a[4] * a[8] - a[5] * a[7], a[2] * a[7] - a[1] * a[8], a[1] * a[5] - a[2] * a[4], a[5] * a[6] - a[3] * a[8], a[0] * a[8] - a[2] * a[6], a[2] * a[3] - a[0] * a[5], a[3] * a[7] - a[4] * a[6], a[1] * a[6] - a[0] * a[7], a[0] * a[4] - a[1] * a[3]].map((x) => x / det);
    for (let c = 0; c < 3; c++) out.off[3 * v + c] += inv[3 * c] * rhs[3 * v] + inv[3 * c + 1] * rhs[3 * v + 1] + inv[3 * c + 2] * rhs[3 * v + 2];
  }
  return out;
}

const reduced = new Map();
/** The reduced bodice template of a cut, built from scratch on the cut's mean body (the full one's generator at the "-r" cut), bound to the mean reduced body. */
const builtReduced = new Map();
export function buildReducedTemplate(cutId) {
  if (builtReduced.has(cutId)) return builtReduced.get(cutId);
  const params = MEAN_BODIES[cutId], near = buildNear(params), red = build(params), name = cutId + "-r", geo = bodiceGeometry(near, name), g = geo.g;
  const shell = shapeToFull(g.pos, g.index, g.part, g.grids, templateFor(cutId)), bound = bindReduced(g, red.position, near.height, shell);
  // one set of skin weights for every cut (the adult's), so the class mesh's attributes are static
  const skin = cutId === BASE_CUT[cutId] ? bodiceSkin(g, bindParts(g, geo.w), geo.w, geo.lm, geo.cut) : buildReducedTemplate(BASE_CUT[cutId]).skin;
  if (cutId !== BASE_CUT[cutId]) { const a = buildReducedTemplate(BASE_CUT[cutId]); if (a.V !== g.pos.length / 3 || a.index.some((x, i) => x !== g.index[i]) || a.part.some((x, i) => x !== g.part[i])) throw new Error(`reduced: the ${cutId} reduced bodice's topology is not the ${BASE_CUT[cutId]}'s`); }
  const t = { cut: geo.cut, cutName: name, V: g.pos.length / 3, grids: g.grids, index: g.index, part: g.part, ring: g.ring, edge: g.edge, binding: bound, skin, pos: shell, templateH: near.height, ref: shoulderRef(geo.w, geo.H) };
  t.binding = tuneBinding(t, templateFor(cutId), cutId, red.position);
  builtReduced.set(cutId, t);
  return t;
}
export function reducedTemplateFor(cutId) {
  let t = reduced.get(cutId);
  if (!t) { t = packed("reduced:" + cutId) ?? buildReducedTemplate(cutId); reduced.set(cutId, t); }
  return t;
}

// one round of relax() after the stays (the full path takes three on finer rings: on 8 rings and 12 columns more rounds bridge a bust's fold by whole centimetres; the far check says 1)
const RELAX_ITERS = 1;
const SCRATCH_N = new Float32Array(R * 3);
/** A reduced bodice fitted to a reduced body (positions R x 3 or longer, the geometric vertices first, at the person's height): { position, normal }. */
export function fitReduced(tpl, redPositions, J = null, height = 0) {
  // (the normals the binding was made with: bindReduced takes every triangle's for a cut with the doublet's parts, the parts' own for the rest; this read `tpl.cut.breeches`, which no cut has, so the doublets'
  // templates came back up to 7 cm off on a sleeve even on the mean body)
  const nrm = tpl.cut.doublet ? normalsOf(redPositions.subarray(0, R * 3), GEO, SCRATCH_N) : partNormals(redPositions, SCRATCH_N);
  const position = relax(fit(tpl.binding, redPositions, undefined, 1, 1, nrm), tpl, tpl.cut.relaxIters ?? RELAX_ITERS);
  if (J) pinShoulders(position, tpl, J, height);
  return { position, normal: bodiceNormals(position, tpl.index) };
}

/** The far tier's body positions (the geometric vertices of the reduced mesh, then its eye vertices) at height `scale` from its 16 coefficients: far.position, the shape the far tier draws. */
export function farReducedPositions(coef, scale, out = new Float32Array(FAR.header.vertices * 3)) { return FAR.position(coef, scale, out); }

/** What the near tier needs of a person's bodice: the full template fitted to their near body (shape.js buildNear's result) and the shift's neck cut over their base layer. `template`: another
 *  full template than the cut's own (the far check's reference with the right sleeve wound outward). */
export function bakeNear(near, params, outfit = GENTLEWOMAN, template = null) {
  const cut = cutFor(params.age, outfit), tpl = template ?? templateFor(cut.bodice);
  const position = pinShoulders(relax(fit(tpl.binding, near.position, undefined, 1, 1, bodyNormals(near.position)), tpl), tpl, near.joints.J, params.height), normal = bodiceNormals(position, tpl.index);
  const bodice = { template: tpl, position, normal };
  return { cut, bodice, layerCut: layerCut(near.position, bodice, params.height, outfit.layer.margin) };
}
/** What the mid and far tiers need: the reduced template of their cut fitted to their reduced body positions. */
export function bakeReduced(redPositions, params, outfit = GENTLEWOMAN, J = null) {
  const cut = cutFor(params.age, outfit), tpl = reducedTemplateFor(cut.bodice);
  return { cut, bodice: { template: tpl, ...fitReduced(tpl, redPositions, J, params.height) } };
}

// ---- what the bodice hides of the reduced body ------------------------------------------------------------------------------------------------------------------------------
const HIDDEN = new Map();
/** The reduced body's vertices that every cut of an outfit's bodice hides (the intersection of the cuts' hides.reduced): hide only what everyone's bodice covers, and only under its torso piece: the
 *  sleeves' (the upper arms) are left, for a reduced sleeve of 8 x 4 does not enclose the arm's inner side as the full one does (the check says: garment-far.mjs d). Uint8Array(RED.D). */
export function hiddenReduced(outfit = GENTLEWOMAN) {
  if (HIDDEN.has(outfit.id)) return HIDDEN.get(outfit.id);
  const h = outfit.cuts.map((c) => templateFor(c.bodice).hides.reduced(RED)), out = new Uint8Array(D);
  for (let v = 0; v < D; v++) out[v] = h.every((a) => a[v] === 1) ? 1 : 0;
  HIDDEN.set(outfit.id, out);
  return out;
}
/** MID.index (the reduced mesh and its eye fans) less the triangles whose three vertices are all hidden. */
/** A bodice template's triangles less those of one part (the neckwear is part 3). */
export function withoutPart(tpl, part) {
  const o = []; for (let t = 0; t < tpl.index.length; t += 3) if (tpl.part[tpl.index[t]] !== part) o.push(tpl.index[t], tpl.index[t + 1], tpl.index[t + 2]);
  return Uint16Array.from(o);
}
export function indexWithout(hidden) {
  const o = []; for (let t = 0; t < MID.index.length; t += 3) { const a = MID.index[t], b = MID.index[t + 1], c = MID.index[t + 2]; if (!(a < D && hidden[a] && b < D && hidden[b] && c < D && hidden[c])) o.push(a, b, c); }
  return Uint16Array.from(o);
}

/** The apron of an outfit (outfit.painted.apron: { rings: [r0, r1], half (rad) }) on a skirt of `rings` x `around`: its rectangle of columns -h..h (h the columns in `half`, wrapping at the front) and rings r0..r1, and the
 *  vertices of that rectangle's rim, which are duplicated so the apron's edge is sharp (`apron.soft` lists the tiers where it is not: the mid and far skirts are other meshes of the same cloth, 32 and 24 columns, unbridged at far, and a sharp
 *  white edge on them moves a centimetre or two against the tier before it, which the tier-switch check reads as 5% of a person's pixels against its bar of 3%; their edge is the rectangle's own vertices, a soft one over a column): a duplicate is painted the apron's colour and used by the apron's quads only, the original keeps the skirt's. Or null. */
export function apronOf(outfit, rings, around, tier = "near") {
  const a = outfit.painted?.apron; if (!a) return null;
  const sharp = !a.soft?.includes(tier);
  const h = Math.max(1, Math.round(a.half / (2 * Math.PI / around))), r0 = a.rings[0], r1 = Math.min(a.rings[1], rings - 2), dup = new Map(), rim = [];
  const col = (j) => (j + around) % around, id = (k, j) => k * around + col(j);
  for (let k = r0; k <= r1; k++) for (let j = -h; j <= h; j++) if (sharp && (k === r0 || k === r1 || j === -h || j === h)) { dup.set(id(k, j), dup.size); rim.push([k, col(j)]); }
  // the bare copies: every vertex of the rectangle once more, painted the skirt's, for the quads of a skirt whose apron is taken off (L.skirtIndexBare); they follow the duplicates
  const bare = new Map(); for (let k = r0; k <= r1; k++) for (let j = -h; j <= h; j++) bare.set(id(k, j), bare.size);
  return { h, r0, r1, dup, rim, bare, inside: (k, j) => k >= r0 && k <= r1 && j >= -h && j <= h, id, col };
}
/** The skirt tube's triangles for `rings` x `around` vertices, vertex k * around + j the ring k's column j (the same winding as skirt.js SKIRT_INDEX, which is the 16 x 40 one). */
export function skirtIndexFor(rings, around, apron = null, bare = false) {
  const t = [], base = rings * around;
  if (apron && bare) {          // the apron off: the skirt's own cloth, every vertex of the apron's rectangle on its bare copy (after the duplicates), so none of the linen's vertices is used
    const at = (k, j) => { const i = k * around + j; return apron.bare.has(i) ? base + apron.dup.size + apron.bare.get(i) : i; };
    for (let k = 0; k < rings - 1; k++) for (let j = 0; j < around; j++) { const j1 = (j + 1) % around, a = at(k, j), b = at(k, j1), c = at(k + 1, j1), d = at(k + 1, j); t.push(a, c, b, a, d, c); }
    return Uint16Array.from(t);
  }
  // (with an apron, its quads (columns -h..h-1 and rings r0..r1-1) take the duplicates of the rim's vertices, which come after the tube's own)
  const at = (k, j, ap) => { const i = k * around + j; return ap && apron.dup.has(i) ? base + apron.dup.get(i) : i; };
  for (let k = 0; k < rings - 1; k++) for (let j = 0; j < around; j++) {
    const jj = apron && j > around / 2 ? j - around : j, ap = !!apron && k >= apron.r0 && k < apron.r1 && jj >= -apron.h && jj < apron.h, j1 = (j + 1) % around;
    const a = at(k, j, ap), b = at(k, j1, ap), c = at(k + 1, j1, ap), d = at(k + 1, j, ap);
    t.push(a, c, b, a, d, c);
  }
  return Uint16Array.from(t);
}

// ---- the class mesh ---------------------------------------------------------------------------------------------------------------------------------------------------------
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const rgbOf = (hex) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
const PROFILES = { near: { rings: RINGS, around: 40 }, reduced: { rings: RINGS, around: 24 }, far: { rings: RINGS, around: 24 } };
const layouts = new Map();

// the cut's mean body at the reduced mesh, made once (every layout of a base cut at mid and far reads it)
const meanReducedBodies = new Map();
const meanReduced = (base) => { let p = meanReducedBodies.get(base); if (!p) meanReducedBodies.set(base, p = build(MEAN_BODIES[base]).position); return p; };

/** The static layout of an outfit's class mesh at a tier ("near", "reduced" for mid, "far"), as described at the top of this file. Cached by outfit, tier and skirt profile. */
export function outfitLayout(outfit = GENTLEWOMAN, tier = "near", opts = {}) {
  if (!PROFILES[tier]) throw new Error("outfitLayout: tier " + tier);
  const prof = { ...PROFILES[tier], ...opts }, key = `${outfit.id}|${tier}|${prof.rings}|${prof.around}`;
  let L = layouts.get(key); if (L) return L;
  const near = tier === "near", body = near ? NEAR : MID, bodyV = body.V, base = BASE_CUT[outfit.cuts[0].bodice], tpl = near ? templateFor(base) : reducedTemplateFor(base), bodiceV = tpl.V, { rings, around } = prof, tubes = outfit.loose.tubes ?? 1, apron = apronOf(outfit, rings, around, tier), skirtV = tubes * rings * around + (apron ? apron.dup.size + apron.bare.size : 0), V = bodyV + bodiceV + skirtV;
  const skinIndex = new Uint16Array(V * K), skinWeight = new Float32Array(V * K), paint = new Float32Array(V * 4), skirtRC = new Float32Array(V * 3);
  skinIndex.set(body.skinIndex); skinWeight.set(body.skinWeight); paint.set(body.paint);
  skinIndex.set(tpl.skin.skinIndex, bodyV * K); skinWeight.set(tpl.skin.skinWeight, bodyV * K);
  // the painted pieces (outfit.painted): the feet in shoes (kind 5, a colour of the outfit's own) and the legs in stockings (kind 6, the person's: agent texel 6), on the body's and the layer's vertices
  // that are a leg's (their weights on the thigh, shin, foot or toe bones): static attributes of the class mesh, as the shift's edge is
  if (outfit.painted) {
    const shoes = rgbOf(outfit.painted.shoes), nV = near ? NEAR.V : D;
    for (let v = 0; v < nV; v++) {
      const kind = paint[4 * v + 3]; if (kind !== 0 && kind !== 1) continue;
      let f = 0, l = 0; for (let k = 0; k < K; k++) { const b = body.skinIndex[v * K + k], x = body.skinWeight[v * K + k]; if (b === BI.footL || b === BI.toeL || b === BI.footR || b === BI.toeR) f += x; if (LEG_BONES.has(b)) l += x; }
      if (f >= 0.5) { paint.set(shoes, 4 * v); paint[4 * v + 3] = 5; }
      else if (l >= 0.5) paint[4 * v + 3] = 6;
    }
  }
  // the shift: the base layer drawn in the outfit's layer colour (kind 5)
  if (outfit.layer) {
    const c = rgbOf(outfit.layer.colour);
    if (near) { for (let v = 0; v < bodyV; v++) if (paint[4 * v + 3] === 1) { paint.set(c, 4 * v); paint[4 * v + 3] = 5; } }
    else {
      // the cloth flag of the reduced mesh is the layer: the vertices above the cut line (the adult's reduced neckline plus the margin, on the mean reduced body) are bare skin
      const mean = meanReduced(base), nk = neckline({ template: tpl, position: tpl.pos }), m = outfit.layer.margin * MEAN_BODIES[base].height;
      for (let v = 0; v < D; v++) {
        if (paint[4 * v + 3] !== 1) continue;
        // a vertex within 3.9 cm (of 1.62 m) below the line is bare too: the reduced mesh's triangles are 2 cm, a person's bodice may stand lower than the template's, and a white vertex just
        // under the line would show as a white blotch above her bodice's edge (the near tier's shift edge is a 6 mm line the reduced tiers cannot draw)
        const above = mean[3 * v + 1] - (nk.at(mean[3 * v], mean[3 * v + 2]) + m) > -0.024 * MEAN_BODIES[base].height;
        if (above) paint[4 * v + 3] = 0; else { paint.set(c, 4 * v); paint[4 * v + 3] = 5; }
      }
    }
  }
  for (let v = bodyV; v < bodyV + bodiceV; v++) paint[4 * v + 3] = 3;
  // an outfit whose shell is of more than one stuff (the gentleman's: the doublet, and the linen of the band, the shirt and its sleeves): the paint of each part (outfit.stuff)
  if (outfit.stuff) {
    const lin = rgbOf(outfit.layer.colour);
    for (let i = 0; i < bodiceV; i++) if (outfit.stuff[tpl.part[i]] === "linen") { paint.set(lin, 4 * (bodyV + i)); paint[4 * (bodyV + i) + 3] = 5; }
  }
  // the front lacing (outfit.painted.lacing): the torso's front column, every other ring, in the cord's colour (kind 5): the colours are made per vertex and blend into the cloth over the quad either side, which
  // reads as a laced front at 2 to 4 m (a painted line, no geometry)
  if (outfit.painted?.lacing) {
    const g0 = tpl.grids[0], c = rgbOf(outfit.painted.lacing.colour);
    for (let k = 0; k < g0.rings - 1; k += 2) { const v = bodyV + g0.start + k * g0.around; paint.set(c, 4 * v); paint[4 * v + 3] = 5; }
  }
  // the shift's edge at mid and far: the reduced mesh's triangles are 2 cm, so the near tier's 6 mm line cannot be cut there (the cloth vertices just under the line are left bare
  // instead, above) and the edge vanished. A painted band stands for it: the bodice's top ring, its neckline all round, takes the shift's colour (kind 5, the layer's own), and the
  // vertex colours blend it into the silk over the first ring below. A static attribute: it costs the shader and the far tier nothing.
  if (!near && outfit.layer) { const g0 = tpl.grids[0], top = bodyV + g0.start + (g0.rings - 1) * g0.around, c = rgbOf(outfit.layer.colour); for (let j = 0; j < g0.around; j++) { paint.set(c, 4 * (top + j)); paint[4 * (top + j) + 3] = 5; } }
  // the skirt's vertices: tube (a leg, for the divided breeches), ring and column; the last rings of a tube may be a ribbon (outfit.painted: kind 5, the ribbon's colour)
  const rib = outfit.painted?.ribbon ? rgbOf(outfit.painted.ribbon) : null, ribRings = outfit.painted?.ribbonRings ?? 0, shade = outfit.painted?.band?.rings ?? 0, tubeV = tubes * rings * around;
  const bareKeys = apron ? [...apron.bare.keys()] : [];
  for (let i = 0; i < skirtV; i++) {
    const v = bodyV + bodiceV + i, isBare = i >= tubeV + (apron ? apron.dup.size : 0), dupe = i >= tubeV && !isBare, o = dupe ? apron.rim[i - tubeV] : isBare ? [Math.floor(bareKeys[i - tubeV - apron.dup.size] / around), bareKeys[i - tubeV - apron.dup.size] % around] : null, tube = o ? 0 : Math.floor(i / (rings * around)), r = i % (rings * around);
    paint[4 * v + 3] = 4; skirtRC[3 * v] = o ? o[0] : Math.floor(r / around); skirtRC[3 * v + 1] = o ? o[1] : r % around; skirtRC[3 * v + 2] = tube;
    if (rib && skirtRC[3 * v] >= rings - ribRings) { paint.set(rib, 4 * v); paint[4 * v + 3] = 5; }
    else if (shade && skirtRC[3 * v] >= rings - shade) paint[4 * v + 3] = 7;          // the knee band, the breeches' colour darker (kind 7)
  }
  // the apron (outfit.painted.apron): the linen of the rectangle's duplicated rim, and of the vertices inside it (the originals on the rim keep the skirt's colour for the quads outside it)
  if (apron) {
    const c = rgbOf(outfit.painted.apron.colour), put = (v) => { paint.set(c, 4 * v); paint[4 * v + 3] = 5; };
    for (let i = 0; i < apron.dup.size; i++) put(bodyV + bodiceV + tubeV + i);
    for (let k = apron.r0; k <= apron.r1; k++) for (let j = -apron.h; j <= apron.h; j++) if (!apron.dup.has(apron.id(k, j))) put(bodyV + bodiceV + apron.id(k, j));
  }
  const hidden = near ? null : hiddenReduced(outfit), bodyIndex = { all: body.index, cut: near ? body.index : indexWithout(hidden) }, skirtIdx = (() => { const one = skirtIndexFor(rings, around, apron), o = new Uint16Array(one.length * tubes); for (let t = 0; t < tubes; t++) for (let q = 0; q < one.length; q++) o[t * one.length + q] = one[q] + (one[q] >= rings * around ? 0 : t * rings * around); return o; })(), cache = new Map();
  // the apron off: the same skirt on the bare copies (tubes: one, the only outfit with an apron)
  const skirtBare = apron ? skirtIndexFor(rings, around, apron, true) : null;
  L = {
    tier, outfit: outfit.id, bodyV, bodiceV, skirtV, V, rings, around, skinIndex, skinWeight, paint, skirtRC, hidden, bodiceIndex: tpl.index, bodiceTemplatePart: (i) => tpl.part[i], skirtIndex: skirtIdx, skirtIndexBare: skirtBare,
    ranges: { body: [0, bodyV], bodice: [bodyV, bodyV + bodiceV], skirt: [bodyV + bodiceV, V] },
    indexFor(mask) {
      let i = cache.get(mask); if (i) return i;
      const b = mask & 1 ? bodyIndex.cut : bodyIndex.all, parts = [b];
      if (mask & 1) parts.push(Uint16Array.from(mask & 4 ? withoutPart(tpl, 3) : tpl.index, (x) => x + bodyV));          // bit 2 (4): the neckwear (part 3, the falling band or the neckerchief) off
      if (mask & 2) parts.push(Uint16Array.from(mask & 8 && skirtBare ? skirtBare : skirtIdx, (x) => x + bodyV + bodiceV));          // bit 3 (8): the apron off
      i = new Uint16Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { i.set(p, o); o += p.length; }
      cache.set(mask, i); return i;
    },
  };
  layouts.set(key, L);
  return L;
}
export { CUTS, pseudoAngle };
