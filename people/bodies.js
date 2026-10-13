// The body provider (R4, R5): from a resolved person's traits to a rest shape and joints. R4 drew the crowd probe's stand-in
// body here; R5 swapped in MakeHuman's hm08 body behind the same functions, so nothing that calls them changed. The shape itself
// (the recipe, the bake, the rig's stance, the reduced and near meshes) is shape.js; this file adds the far tier's basis.
//
//   paramsFor(values, derived)  the body's parameters from the traits (deterministic: same person, same body)
//   build(params)               the mid and far tiers' body on the reduced mesh: { position, normal, skinIndex, skinWeight, index, uv, cloth, paint, joints: { J, ... } }
//   buildNear(params)           the near tier's, on the full drawn body with its base layer and eyes (NEAR is its shared half)
//   TEMPLATE                    the topology the far and mid tiers draw: the far basis's mean at unit height, with the same shared fields
//   farCoefs(body)              the far tier's description of a built body: its 16 coefficients and its height as an exact scale
//   farBody(params)             the same, and the joints, for a person who has no built body: read from a table over the four sliders
//                               (spikes/makehuman/table.js, built by tools/people/far-table.mjs), a few microseconds instead of the 2 ms bake
//   morphBasis(which)           the 16 directions, "position" or "normal", over the drawn vertices (what the far tier adds, scaled by coefficients)

import { MID, RED, NEAR, FAR_VERTICES, farVec, build, buildNear, paramsFor, BONES, B } from "./shape.js";
import { loadFar } from "../spikes/makehuman/reduced.js";
import { loadFarTable } from "../spikes/makehuman/table.js";

export { BONES, B, NEAR, paramsFor, build, buildNear };

const FAR = await loadFar("far-1500");
if (!FAR.header.nScale) throw new Error("bodies: the far pack has no normals; refit it with tools/people/far-fit.mjs");
if (FAR.header.vertices !== FAR_VERTICES) throw new Error("bodies: the far pack is not for this reduced mesh");

// the far vector's values over the drawn vertices: the geometric ones, copies taking their original's, then the eyes
const drawn = (a) => {
  const R = RED.R, D = RED.D, o = new Float32Array(MID.V * 3);
  o.set(a.subarray(0, R * 3)); o.set(a.subarray(R * 3), D * 3);
  for (let d = R; d < D; d++) { const s = RED.owner[d] * 3; o[d * 3] = o[s]; o[d * 3 + 1] = o[s + 1]; o[d * 3 + 2] = o[s + 2]; }
  return o;
};
export const TEMPLATE = { ...MID, position: drawn(FAR.mean), normal: drawn(FAR.nmean) };
{ const nn = TEMPLATE.normal; for (let i = 0; i < nn.length; i += 3) { const l = Math.sqrt(nn[i] * nn[i] + nn[i + 1] * nn[i + 1] + nn[i + 2] * nn[i + 2]) || 1; nn[i] /= l; nn[i + 1] /= l; nn[i + 2] /= l; } }
export const FAR_K = FAR.k;
const TABLE = await loadFarTable("far-table-1500", FAR);       // refuses a table built for another far pack: re-run tools/people/far-table.mjs

/** The far tier's description of a built body (position at the person's height): coefficients on the basis at unit height, and the
 *  height as an exact scale. draw.js and the tests share it. */
export function farCoefs(body) {
  return { coef: Array.from(FAR.coefs(farVec(body.position), body.height)), scale: body.height };
}
/** The far tier's person from the traits alone: { coef (Float32Array, the far basis at unit height), scale (the height, exact), J (the rig's 21 joints
 *  at the person's height, for the walker) }. Interpolated from the table; within a few millimetres of farCoefs(build(params)) and its joints. */
export function farBody(params) {
  const o = TABLE.at(params.sex, params.age, params.muscle, params.build), k = TABLE.k, h = params.height, coef = new Float32Array(k), J = new Array(B);
  for (let i = 0; i < k; i++) coef[i] = o[i];
  for (let b = 0; b < B; b++) J[b] = [o[k + 3 * b] * h, o[k + 3 * b + 1] * h, o[k + 3 * b + 2] * h];
  return { coef, scale: h, J };
}
export function morphBasis(which = "position") {
  const src = which === "position" ? FAR.basis : FAR.nbasis, n = FAR_VERTICES * 3;
  return Array.from({ length: FAR.k }, (_, t) => drawn(src.subarray(t * n, (t + 1) * n)));
}
