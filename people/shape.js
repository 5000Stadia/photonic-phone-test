// A person's shape (R5): from resolved traits to MakeHuman's hm08 body, on the two topologies the tiers draw.
//
//   paramsFor(values, derived)   the traits as a MakeHuman recipe: { sex (gender slider 0..1), age (years), build, muscle, height (m), skin }
//   build(params)                the mid and far tiers' body, on the reduced mesh (reduced-1500): { position, normal, ... , joints }
//   buildNear(params)            the near tier's, on the full drawn body plus its base layer and eyes, the same fields
//   MID, NEAR                    what is the same for everyone on each topology: index, skinIndex, skinWeight, uv, cloth, paint
//
// The pipeline for one person: bake the macro targets (spikes/makehuman, decimetres), place (metres, feet on y = 0), put the
// person into the walker's neutral stance with the rig (arms and legs hanging; spikes/makehuman/rig.js), set the height exactly
// (the stance straightens the legs a little), then either read the reduced mesh off it by the .mhclo-style binding (reduced.js)
// or take the full body as it is. The joints come from the rig, in body.js's layout, for the walker (walk.js).
// Deterministic: + - * / and sqrt only in paramsFor and the bake, so the same traits give the same body on every engine.
//
// `paint` is how a vertex takes its colour (draw.js): [r, g, b, kind], kind 0 skin (the person's own), 1 cloth (the garment's
// tint), 2 the colour in rgb (eyes). Nobody is drawn unclothed: both topologies carry the base layer (the reduced mesh as the
// `cloth` flag on its vertices, the near body as the layer's own vertices), and every build refuses without it.

import { bake, UVN, UV, SEAM, BODY_VERTICES as BODY, DRAWN_INDEX, BASE_LAYER, EYES, LAYER_OFFSET, settleArrays } from "../spikes/makehuman/index.js";
import { rig, SKIN, BONES as RIG_BONES } from "../spikes/makehuman/rig.js";
import { loadReduced, place } from "../spikes/makehuman/reduced.js";
import { humanPrior } from "../traits/priors.js";
import { BONES, B } from "../body.js";

export { BONES, B };
if (RIG_BONES.length !== B || RIG_BONES.some((n, i) => n !== BONES[i][0])) throw new Error("shape: the rig's bones are not the walker's");

export const RED = await loadReduced("reduced-1500");
const R = RED.R, D = RED.D, K = SKIN.influences;
const HEAD = RIG_BONES.indexOf("head");

// ---- the traits as a recipe -------------------------------------------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sat = (x) => x / (1 + Math.abs(x));                  // a soft limit to (-1, 1) from + × / only, so every engine gives the same bits
const SKIN_RAMP = [[0xf0, 0xd0, 0xb8], [0xe8, 0xc4, 0xa8], [0xd8, 0xa8, 0x88], [0xc9, 0x9a, 0x74], [0xb0, 0x78, 0x50], [0x8d, 0x5a, 0x3b], [0x6b, 0x44, 0x30], [0x4a, 0x2e, 0x20]];   // the lab's skin tones, fair to dark
const hex2 = (x) => Math.round(x).toString(16).padStart(2, "0");
function skinColour(melanin) {
  const x = clamp01(melanin) * (SKIN_RAMP.length - 1), i = Math.min(SKIN_RAMP.length - 2, Math.floor(x)), t = x - i, a = SKIN_RAMP[i], b = SKIN_RAMP[i + 1];
  return "#" + [0, 1, 2].map((c) => hex2(a[c] + (b[c] - a[c]) * t)).join("");
}

/** The traits as a MakeHuman recipe.
 *  sex     the gender slider, 0 female .. 1 male: the person's sex, shifted by body.MF (the frame owns the shoulders and hips; masculine is
 *          negative), softly limited so no one is the corner caricature (a typical man 0.85, a woman 0.15; a feminine-framed man 0.6)
 *  age     years (the person's own, not how old they look)
 *  build   the weight slider's input, 0..1 about 0.5 for the prior's mean adiposity (weights() maps it to 0.15..0.85)
 *  muscle  the same for muscle, from body.muscularity about its prior's mean
 *  height  metres, exact, from the growth curve and the stature z
 *  skin    sRGB hex from skin.melanin on the lab's skin ramp */
export function paramsFor(values, derived) {
  const sex = values.sex === "male" ? 1 : values.sex === "female" ? -1 : 0, age = typeof values.age === "number" ? values.age : 30;
  const MF = typeof values["body.MF"] === "number" ? values["body.MF"] : 0, amount = (id, d) => (typeof values[id] === "number" ? values[id] : d);
  const ctx = { sex: values.sex, age };
  return {
    sex: 0.5 + 0.5 * sat(1.2 * sex - 0.9 * MF),
    age,
    build: clamp01(0.5 + 1.2 * (amount("body.adiposity", 0.35) - humanPrior("body.adiposity", ctx).mean)),
    muscle: clamp01(0.5 + 1.2 * (amount("body.muscularity", 0.4) - humanPrior("body.muscularity", ctx).mean)),
    height: Math.max(0.4, (derived["body.height"] ?? 172) / 100),
    skin: skinColour(amount("skin.melanin", 0.25)),
  };
}

// ---- one person, placed, in the neutral stance, at the exact height ----------------------------------------------------
function person(params, { neutral = true } = {}) {
  if (!RED.cloth.some((c) => c) || !BASE_LAYER) throw new Error("shape: base layer missing; refusing to build an unclothed person");
  const { P } = bake(params);
  place(P, params.height, BODY);
  const g = rig(P, { neutral });
  let lo = Infinity, hi = -Infinity;
  const p = g.position;
  for (let i = 0; i < BODY; i++) { const y = p[3 * i + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  const s = params.height / (hi - lo);      // the stance straightens the legs and the tallest point rises a little: the height is exact
  for (let i = 0; i < p.length; i++) p[i] *= s;
  const { J, tip } = g.joints;
  for (const q of J) { q[0] *= s; q[1] *= s; q[2] *= s; }
  for (const q of Object.values(tip)) { q[0] *= s; q[1] *= s; q[2] *= s; }
  g.joints.u *= s; g.joints.sk *= s;
  return g;
}

// ---- the mid and far tiers: the reduced mesh ------------------------------------------------------------------------------
// The reduced face has sockets but no eyeballs: the eye openings are holes, and a hole reads as a blank scowl at a few metres. The
// cheapest fix that shows: each eye is a small fan on the eyeball's sphere appended to the reduced mesh (19 vertices, 30 triangles an
// eye): a dark iris in the middle, the white round it, bound to the head bone, seen through the opening and hidden by the skin
// round it. The eye vertices are part of the body vector, so the far basis carries them too (they follow the head's size and place).
const FAN = (() => {
  const dir = [[0, 0, 1]], role = [0], tri = [], rings = [[0.4, 0], [0.52, 1], [1.1, 2]], N = 6;      // sphere angle from straight ahead (rad), 0 iris / 1 white / 2 the white in the lids' shade
  for (const [phi] of rings) for (let i = 0; i < N; i++) { const a = (i / N) * 2 * Math.PI; dir.push([Math.sin(phi) * Math.cos(a), Math.sin(phi) * Math.sin(a), Math.cos(phi)]); role.push(rings.find((r) => r[0] === phi)[1]); }
  const out = (a, b, c) => { const p = [a, b, c].map((v) => dir[v]), u = p[1].map((x, k) => x - p[0][k]), w = p[2].map((x, k) => x - p[0][k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    tri.push(...(n[0] * p[0][0] + n[1] * p[0][1] + n[2] * p[0][2] > 0 ? [a, b, c] : [a, c, b])); };       // outward, whichever way round the ring runs
  for (let i = 0; i < N; i++) out(0, 1 + i, 1 + (i + 1) % N);
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < N; i++) {
    const a = 1 + r * N + i, b = 1 + r * N + (i + 1) % N, c = a + N, d = b + N;
    out(a, c, b); out(b, c, d);
  }
  return { dir, role, tri, count: dir.length };
})();
export const EYE_VERTICES = 2 * FAN.count;
const V_MID = D + EYE_VERTICES, HEADK = [HEAD, 0, 0, 0];

// The skin weights of a reduced vertex: the blend of its three bound vertices' weights, the four heaviest bones, renormalised.
// The same for everyone. Eye vertices follow the head.
function reducedSkin() {
  const si = new Uint16Array(V_MID * K), sw = new Float32Array(V_MID * K), acc = new Map();
  for (let r = 0; r < R; r++) {
    acc.clear();
    for (let j = 0; j < 3; j++) {
      const v = RED.ids[3 * r + j], w = RED.weights[3 * r + j];
      for (let k = 0; k < K; k++) { const ww = SKIN.skinWeight[v * K + k]; if (ww > 0) { const b = SKIN.skinIndex[v * K + k]; acc.set(b, (acc.get(b) ?? 0) + w * ww); } }
    }
    const top = [...acc].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, K);
    let sum = 0; for (const [, w] of top) sum += w;
    top.forEach(([b, w], k) => { si[r * K + k] = b; sw[r * K + k] = w / sum; });
  }
  for (let d = R; d < D; d++) { const o = RED.owner[d]; si.copyWithin(d * K, o * K, o * K + K); sw.copyWithin(d * K, o * K, o * K + K); }
  for (let v = D; v < V_MID; v++) { si.set(HEADK, v * K); sw[v * K] = 1; }
  return { skinIndex: si, skinWeight: sw };
}
const EYE_COLOURS = { 0: [0.09, 0.06, 0.04], 1: [0.82, 0.79, 0.74], 2: [0.34, 0.25, 0.21] };      // iris, the white of the eye, the white where the lids shade it
const MID = (() => {
  const index = new Uint16Array(RED.index.length + 2 * FAN.tri.length), uv = new Float32Array(V_MID * 2), cloth = new Uint8Array(V_MID), paint = new Float32Array(V_MID * 4);
  index.set(RED.index); uv.set(RED.uv); cloth.set(RED.cloth);
  RED.cloth.forEach((c, i) => { paint[i * 4 + 3] = c ? 1 : 0; });
  for (let e = 0; e < 2; e++) {
    const base = D + e * FAN.count;
    FAN.tri.forEach((t, i) => { index[RED.index.length + e * FAN.tri.length + i] = base + t; });
    FAN.role.forEach((r, i) => { paint.set(EYE_COLOURS[r], (base + i) * 4); paint[(base + i) * 4 + 3] = 2; });
  }
  return { V: V_MID, index, uv, cloth, ...reducedSkin(), paint };
})();
export { MID };

/** The far tier's vector for a built body: the geometric vertices' values, then the eyes' (the seam copies repeat their originals and
 *  are not part of it). Length FAR_VERTICES x 3. Works on position or normal. */
export const FAR_VERTICES = R + EYE_VERTICES;
export function farVec(a) {
  const o = new Float32Array(FAR_VERTICES * 3);
  o.set(a.subarray(0, R * 3)); o.set(a.subarray(D * 3, V_MID * 3), R * 3);
  return o;
}

/** The mid and far tiers' body: the reduced mesh at the person's size, in the walker's neutral stance. position and normal are this
 *  person's (D x 3 each, metres, feet on y = 0); everything else is MID's, shared and read only. `opts.neutral: false` keeps the bake's
 *  A-pose (tools/people/far-fit.mjs measures what the stance does). */
export function build(params, opts) {
  const g = person(params, opts);
  const out = RED.reduce(g.position, { position: new Float32Array(V_MID * 3), normal: new Float32Array(V_MID * 3) });
  placeEyes(eyeBalls(g.position), out.position, out.normal, D);
  return { ...MID, position: out.position, normal: out.normal, joints: g.joints, height: params.height };
}

// ---- the near tier: the full drawn body, its base layer, and simple eyes -------------------------------------------------
// Vertices: the drawn body (UVN, seam copies last), then the base layer's own (a local copy pushed out along its normals), then
// the eyes (a white ball, an iris and a pupil each, bound to the head bone). One mesh, so the tier is one draw.
const GS = BASE_LAYER.start, GN = BASE_LAYER.count, GT = BASE_LAYER.index.length;
// a unit ellipsoid's vertices (nu around, nv down), as unit directions, and its triangles
function sphere(nu, nv) {
  const dir = [], tri = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = (i / nu) * 2 * Math.PI, b = (j / nv) * Math.PI, sb = Math.sin(b);
    dir.push(Math.sin(a) * sb, Math.cos(b), Math.cos(a) * sb);          // +z is straight ahead
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; tri.push(a, a + 1, b, a + 1, b + 1, b); }
  return { dir, tri, count: (nu + 1) * (nv + 1) };
}
const EYE_PARTS = [   // radius share, flattening along z, centre pushed out along z (shares of the eyeball's radius), colour, (nu, nv)
  { r: 1, z: 1, push: 0, rgb: [0.88, 0.85, 0.8], shape: sphere(14, 9) },        // the white
  { r: 0.45, z: 0.35, push: 0.86, rgb: [0.2, 0.13, 0.08], shape: sphere(12, 6) },   // the iris
  { r: 0.18, z: 0.3, push: 0.97, rgb: [0.02, 0.02, 0.02], shape: sphere(8, 4) },   // the pupil
];
const EYE_V = EYE_PARTS.reduce((n, p) => n + p.shape.count, 0), EYE_T = EYE_PARTS.reduce((n, p) => n + p.shape.tri.length, 0);
const VN = UVN + GN + 2 * EYE_V;

const STATIC_NEAR = (() => {
  const index = new Uint16Array(DRAWN_INDEX.length + GT + 2 * EYE_T);
  index.set(DRAWN_INDEX);
  for (let i = 0; i < GT; i++) index[DRAWN_INDEX.length + i] = BASE_LAYER.index[i] - GS + UVN;
  let at = DRAWN_INDEX.length + GT, base = UVN + GN;
  const paint = new Float32Array(VN * 4), skinIndex = new Uint16Array(VN * K), skinWeight = new Float32Array(VN * K), uv = new Float32Array(VN * 2), cloth = new Uint8Array(VN);
  for (let v = UVN; v < UVN + GN; v++) { paint[v * 4 + 3] = 1; cloth[v] = 1; }
  for (let e = 0; e < 2; e++) for (const part of EYE_PARTS) {
    for (const t of part.shape.tri) index[at++] = base + t;
    for (let v = 0; v < part.shape.count; v++) { const o = (base + v) * 4; paint.set(part.rgb, o); paint[o + 3] = 2; skinIndex[(base + v) * K] = HEAD; skinWeight[(base + v) * K] = 1; }
    base += part.shape.count;
  }
  skinIndex.set(SKIN.body.skinIndex); skinWeight.set(SKIN.body.skinWeight);
  skinIndex.set(SKIN.garment.skinIndex, UVN * K); skinWeight.set(SKIN.garment.skinWeight, UVN * K);
  uv.set(UV);
  return { V: VN, index, uv, cloth, skinIndex, skinWeight, paint };
})();

// area-weighted vertex normals of a mesh with a local index (as three's computeVertexNormals)
function normalsOf(p, idx, n) {
  n.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const cx = p[c] - p[b], cy = p[c + 1] - p[b + 1], cz = p[c + 2] - p[b + 2], ax = p[a] - p[b], ay = p[a + 1] - p[b + 1], az = p[a + 2] - p[b + 2];
    const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}
const LAYER_LOCAL = BASE_LAYER.index.map((i) => i - GS);

/** A person's eyes: the centre and radius of each eye helper (the mean distance from its centre) in their placed body. */
function eyeBalls(p) {
  return [EYES.l, EYES.r].map(([start, n]) => {
    let x = 0, y = 0, z = 0;
    for (let i = start; i < start + n; i++) { x += p[3 * i]; y += p[3 * i + 1]; z += p[3 * i + 2]; }
    x /= n; y /= n; z /= n;
    let rad = 0;
    for (let i = start; i < start + n; i++) rad += Math.sqrt((p[3 * i] - x) ** 2 + (p[3 * i + 1] - y) ** 2 + (p[3 * i + 2] - z) ** 2) / n;
    return { c: [x, y, z], rad };
  });
}

// writes the two eye fans into position and normal from vertex `at`: the sphere cap of each eyeball, facing straight ahead
function placeEyes(balls, position, normal, at) {
  for (const { c, rad } of balls) for (const [x, y, z] of FAN.dir) {
    position[at * 3] = c[0] + x * rad; position[at * 3 + 1] = c[1] + y * rad; position[at * 3 + 2] = c[2] + z * rad;
    normal[at * 3] = x; normal[at * 3 + 1] = y; normal[at * 3 + 2] = z; at++;
  }
}

export function buildNear(params) {
  const g = person(params), p = g.position;
  const position = new Float32Array(VN * 3), normal = new Float32Array(VN * 3);
  position.set(p.subarray(0, BODY * 3));
  const bodyN = new Float32Array(UVN * 3);
  const bodyP = position.subarray(0, UVN * 3);
  settleArrays(bodyP, bodyN);
  normal.set(bodyN);
  // the base layer: the helper's own vertices, pushed out along their normals
  const lp = p.slice(GS * 3, (GS + GN) * 3), ln = new Float32Array(GN * 3);
  normalsOf(lp, LAYER_LOCAL, ln);
  const d = LAYER_OFFSET * params.height;
  for (let i = 0; i < lp.length; i++) lp[i] += ln[i] * d;
  normalsOf(lp, LAYER_LOCAL, ln);
  position.set(lp, UVN * 3); normal.set(ln, UVN * 3);
  // the eyes
  let at = UVN + GN;
  for (const { c, rad } of eyeBalls(p)) for (const part of EYE_PARTS) {
    const dir = part.shape.dir, cz = c[2] + rad * part.push;
    for (let v = 0; v < part.shape.count; v++, at++) {
      const x = dir[3 * v], y = dir[3 * v + 1], z = dir[3 * v + 2];
      position[at * 3] = c[0] + x * rad * part.r; position[at * 3 + 1] = c[1] + y * rad * part.r; position[at * 3 + 2] = cz + z * rad * part.r * part.z;
      normal[at * 3] = x; normal[at * 3 + 1] = y; normal[at * 3 + 2] = z;
    }
  }
  return { ...STATIC_NEAR, position, normal, joints: g.joints, height: params.height };
}
export const NEAR = STATIC_NEAR;
