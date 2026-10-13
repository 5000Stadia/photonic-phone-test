// The gentlewoman for the mid and far tiers and the class meshes of every tier (R5; design/r5-plan.md "The wardrobe", "After the outside reviews"). Plain JS, no three.
//
// A reduced bodice (336 vertices: 24 round, 8 rings, sleeves 12 x 6; bodice.js CUTS "adult-r" ...) is cut on the cut's own mean body like the full one, but bound (the .mhclo-style
// binding, bind.js) to the REDUCED mesh's triangles, so it is fitted from a person's reduced body positions alone: the mid tier's exact ones (shape.js build().position) or the far tier's,
// read from the coefficients (farReducedPositions): never from the full body. The base layer is a flag on the reduced body (cloth), so the shift's neck cut is static per class here.
//
//   reducedTemplateFor(cutId)             the reduced bodice template of a cut ("adult", "girl", "small"): from the pack when there is one, else built (about 0.3 s)
//   buildReducedTemplate(cutId)           built from scratch (what the pack is made of)
//   fitReduced(template, redPositions)    { position, normal } of the bodice on a reduced body (Float32Array R x 3 or longer: the geometric vertices first)
//   bakeNear(near, params, outfit)        { cut, bodice: { template, position, normal }, layerCut } for the near tier (the full path, dress() without the skirt)
//   bakeReduced(redPositions, params, outfit)   { cut, bodice: { template, position, normal } } for the mid and far tiers
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
//                 near: the layer's vertices are 5; reduced and far: the body's cloth vertices (MID.paint.w = 1) are 5, except those above the shift's cut line on the adult's mean reduced
//                 body (the neckline of the reduced bodice plus the layer's margin), which are 0, bare neck and shoulders. The near layer's cut stays the per-person number layerCut.
//   skirtRC (Float32 x2)   ring k, column j of each skirt vertex (zeros elsewhere); vertex of ring k, column j is skirt-first + k * around + j
//   bodyV, bodiceV, skirtV, V, rings, around, ranges: { body: [a, b], bodice: [a, b], skirt: [a, b] }
//   indexFor(mask)   Uint16Array of triangles, mask bit 0 bodice worn, bit 1 skirt worn: the body's (reduced and far: less the triangles of vertices the bodice hides, when it is worn;
//                    near: all), the bodice's (offset by bodyV) if bit 0, the skirt's (offset) if bit 1. Cached.
//   hidden (reduced and far only)   Uint8Array(bodyV) of the body vertices the bodice hides (the intersection over the three cuts)
import { RED, MID, NEAR, build, buildNear } from "../shape.js";
import { loadFar } from "../../spikes/makehuman/reduced.js";
import { bodiceGeometry, bindParts, bodiceSkin, relax, fit, normalsOf as bodiceNormals, CUTS } from "./bodice.js";
import { bind } from "./bind.js";
import { normalsOf } from "./geom.js";
import { BI } from "./wearer.js";
import { neckline, pseudoAngle } from "./layer.js";
import { GENTLEWOMAN, MEAN_BODIES, cutFor, templateFor } from "./outfit.js";
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
function bindReduced(g, redPos) {
  const nrm = partNormals(redPos), V = g.pos.length / 3, ids = new Uint16Array(V * 3), wt = new Float32Array(V * 3), off = new Float32Array(V * 3), dist = new Float32Array(V);
  SETS(redPos).forEach((tris, part) => {
    const sel = []; for (let v = 0; v < V; v++) if (g.part[v] === part) sel.push(v);
    const pts = new Float32Array(sel.length * 3), anc = new Float32Array(sel.length * 3);
    sel.forEach((v, i) => { pts.set(g.pos.subarray(3 * v, 3 * v + 3), 3 * i); anc.set(g.anchor.subarray(3 * v, 3 * v + 3), 3 * i); });
    const bd = bind(pts, redPos, tris, anc, nrm);
    sel.forEach((v, i) => { ids.set(bd.ids.subarray(3 * i, 3 * i + 3), 3 * v); wt.set(bd.w.subarray(3 * i, 3 * i + 3), 3 * v); off.set(bd.off.subarray(3 * i, 3 * i + 3), 3 * v); dist[v] = bd.dist[i]; });
  });
  return { n: V, ids, w: wt, off, dist, smooth: true };
}

const reduced = new Map();
/** The reduced bodice template of a cut, built from scratch on the cut's mean body (the full one's generator at the "-r" cut), bound to the mean reduced body. */
const builtReduced = new Map();
export function buildReducedTemplate(cutId) {
  if (builtReduced.has(cutId)) return builtReduced.get(cutId);
  const params = MEAN_BODIES[cutId], near = buildNear(params), red = build(params), name = cutId + "-r", geo = bodiceGeometry(near, name), g = geo.g;
  const binding = bindReduced(g, red.position);
  // one set of skin weights for every cut (the adult's), so the class mesh's attributes are static
  const skin = cutId === "adult" ? bodiceSkin(g, bindParts(g, geo.w), geo.w, geo.lm, geo.cut) : buildReducedTemplate("adult").skin;
  if (cutId !== "adult") { const a = buildReducedTemplate("adult"); if (a.V !== g.pos.length / 3 || a.index.some((x, i) => x !== g.index[i]) || a.part.some((x, i) => x !== g.part[i])) throw new Error(`reduced: the ${cutId} reduced bodice's topology is not the adult's`); }
  const t = { cut: geo.cut, cutName: name, V: g.pos.length / 3, grids: g.grids, index: g.index, part: g.part, ring: g.ring, edge: g.edge, binding, skin, pos: g.pos, templateH: near.height };
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
export function fitReduced(tpl, redPositions) {
  const nrm = partNormals(redPositions, SCRATCH_N);
  const position = relax(fit(tpl.binding, redPositions, undefined, 1, 1, nrm), tpl, RELAX_ITERS);
  return { position, normal: bodiceNormals(position, tpl.index) };
}

/** The far tier's body positions (the geometric vertices of the reduced mesh, then its eye vertices) at height `scale` from its 16 coefficients: far.position, the shape the far tier draws. */
export function farReducedPositions(coef, scale, out = new Float32Array(FAR.header.vertices * 3)) { return FAR.position(coef, scale, out); }

/** What the near tier needs of a person's bodice: the full template fitted to their near body (shape.js buildNear's result) and the shift's neck cut over their base layer. `template`: another
 *  full template than the cut's own (the far check's reference with the right sleeve wound outward). */
export function bakeNear(near, params, outfit = GENTLEWOMAN, template = null) {
  const cut = cutFor(params.age, outfit), tpl = template ?? templateFor(cut.bodice);
  const position = relax(fit(tpl.binding, near.position, undefined, 1, 1, bodyNormals(near.position)), tpl), normal = bodiceNormals(position, tpl.index);
  const bodice = { template: tpl, position, normal };
  return { cut, bodice, layerCut: layerCut(near.position, bodice, params.height, outfit.layer.margin) };
}
/** What the mid and far tiers need: the reduced template of their cut fitted to their reduced body positions. */
export function bakeReduced(redPositions, params, outfit = GENTLEWOMAN) {
  const cut = cutFor(params.age, outfit), tpl = reducedTemplateFor(cut.bodice);
  return { cut, bodice: { template: tpl, ...fitReduced(tpl, redPositions) } };
}

// ---- what the bodice hides of the reduced body ------------------------------------------------------------------------------------------------------------------------------
let HIDDEN = null;
/** The reduced body's vertices that every cut's bodice hides (the intersection of the three cuts' hides.reduced): hide only what everyone's bodice covers, and only under its torso piece: the
 *  sleeves' (the upper arms) are left, for a reduced sleeve of 8 x 4 does not enclose the arm's inner side as the full one does (the check says: garment-far.mjs d). Uint8Array(RED.D). */
export function hiddenReduced() {
  if (HIDDEN) return HIDDEN;
  const h = ["adult", "girl", "small"].map((c) => templateFor(c).hides.reduced(RED)), out = new Uint8Array(D);
  for (let v = 0; v < D; v++) out[v] = h.every((a) => a[v] === 1) ? 1 : 0;
  return (HIDDEN = out);
}
/** MID.index (the reduced mesh and its eye fans) less the triangles whose three vertices are all hidden. */
export function indexWithout(hidden) {
  const o = []; for (let t = 0; t < MID.index.length; t += 3) { const a = MID.index[t], b = MID.index[t + 1], c = MID.index[t + 2]; if (!(a < D && hidden[a] && b < D && hidden[b] && c < D && hidden[c])) o.push(a, b, c); }
  return Uint16Array.from(o);
}

/** The skirt tube's triangles for `rings` x `around` vertices, vertex k * around + j the ring k's column j (the same winding as skirt.js SKIRT_INDEX, which is the 16 x 40 one). */
export function skirtIndexFor(rings, around) {
  const t = [];
  for (let k = 0; k < rings - 1; k++) for (let j = 0; j < around; j++) { const a = k * around + j, b = k * around + (j + 1) % around, c = (k + 1) * around + (j + 1) % around, d = (k + 1) * around + j; t.push(a, c, b, a, d, c); }
  return Uint16Array.from(t);
}

// ---- the class mesh ---------------------------------------------------------------------------------------------------------------------------------------------------------
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const rgbOf = (hex) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
const PROFILES = { near: { rings: RINGS, around: 40 }, reduced: { rings: RINGS, around: 24 }, far: { rings: RINGS, around: 24 } };
const layouts = new Map();

/** The static layout of an outfit's class mesh at a tier ("near", "reduced" for mid, "far"), as described at the top of this file. Cached by outfit, tier and skirt profile. */
export function outfitLayout(outfit = GENTLEWOMAN, tier = "near", opts = {}) {
  if (!PROFILES[tier]) throw new Error("outfitLayout: tier " + tier);
  const prof = { ...PROFILES[tier], ...opts }, key = `${outfit.id}|${tier}|${prof.rings}|${prof.around}`;
  let L = layouts.get(key); if (L) return L;
  const near = tier === "near", body = near ? NEAR : MID, bodyV = body.V, tpl = near ? templateFor("adult") : reducedTemplateFor("adult"), bodiceV = tpl.V, { rings, around } = prof, skirtV = rings * around, V = bodyV + bodiceV + skirtV;
  const skinIndex = new Uint16Array(V * K), skinWeight = new Float32Array(V * K), paint = new Float32Array(V * 4), skirtRC = new Float32Array(V * 2);
  skinIndex.set(body.skinIndex); skinWeight.set(body.skinWeight); paint.set(body.paint);
  skinIndex.set(tpl.skin.skinIndex, bodyV * K); skinWeight.set(tpl.skin.skinWeight, bodyV * K);
  // the shift: the base layer drawn in the outfit's layer colour (kind 5)
  if (outfit.layer) {
    const c = rgbOf(outfit.layer.colour);
    if (near) { for (let v = 0; v < bodyV; v++) if (paint[4 * v + 3] === 1) { paint.set(c, 4 * v); paint[4 * v + 3] = 5; } }
    else {
      // the cloth flag of the reduced mesh is the layer: the vertices above the cut line (the adult's reduced neckline plus the margin, on the mean reduced body) are bare skin
      const mean = build(MEAN_BODIES.adult).position, nk = neckline({ template: tpl, position: tpl.pos }), m = outfit.layer.margin * MEAN_BODIES.adult.height;
      for (let v = 0; v < D; v++) {
        if (paint[4 * v + 3] !== 1) continue;
        // a vertex within 3.9 cm (of 1.62 m) below the line is bare too: the reduced mesh's triangles are 2 cm, a person's bodice may stand lower than the template's, and a white vertex just
        // under the line would show as a white blotch above her bodice's edge (the near tier's shift edge is a 6 mm line the reduced tiers cannot draw)
        const above = mean[3 * v + 1] - (nk.at(mean[3 * v], mean[3 * v + 2]) + m) > -0.024 * MEAN_BODIES.adult.height;
        if (above) paint[4 * v + 3] = 0; else { paint.set(c, 4 * v); paint[4 * v + 3] = 5; }
      }
    }
  }
  for (let v = bodyV; v < bodyV + bodiceV; v++) paint[4 * v + 3] = 3;
  for (let i = 0; i < skirtV; i++) { const v = bodyV + bodiceV + i; paint[4 * v + 3] = 4; skirtRC[2 * v] = Math.floor(i / around); skirtRC[2 * v + 1] = i % around; }
  const hidden = near ? null : hiddenReduced(), bodyIndex = { all: body.index, cut: near ? body.index : indexWithout(hidden) }, skirtIdx = skirtIndexFor(rings, around), cache = new Map();
  L = {
    tier, outfit: outfit.id, bodyV, bodiceV, skirtV, V, rings, around, skinIndex, skinWeight, paint, skirtRC, hidden, bodiceIndex: tpl.index, skirtIndex: skirtIdx,
    ranges: { body: [0, bodyV], bodice: [bodyV, bodyV + bodiceV], skirt: [bodyV + bodiceV, V] },
    indexFor(mask) {
      let i = cache.get(mask); if (i) return i;
      const b = mask & 1 ? bodyIndex.cut : bodyIndex.all, parts = [b];
      if (mask & 1) parts.push(Uint16Array.from(tpl.index, (x) => x + bodyV));
      if (mask & 2) parts.push(Uint16Array.from(skirtIdx, (x) => x + bodyV + bodiceV));
      i = new Uint16Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { i.set(p, o); o += p.length; }
      cache.set(mask, i); return i;
    },
  };
  layouts.set(key, L);
  return L;
}
export { CUTS, pseudoAngle };
