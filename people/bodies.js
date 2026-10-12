// The body provider (R4): from a resolved person's traits to a rest shape and joints. Until R5 this is the crowd
// probe's stand-in body (spikes/crowd/body.js, 16 proportion parameters, 21 bones); R5 swaps in the MakeHuman body
// behind the same three functions, so nothing that calls them changes.
//
//   paramsFor(values, derived)  the body's parameters from the traits (deterministic: same person, same body)
//   build(params)               { position, normal, skinIndex, skinWeight, index, joints: { J, ... } }
//   TEMPLATE                    the shared topology every body has (the instanced tiers draw it)

import { PARAMS, MEAN, buildBody } from "../body.js";

export { BONES, B } from "../body.js";
export const TEMPLATE = buildBody(MEAN);

const I = Object.fromEntries(PARAMS.map(([n], i) => [n, i]));
const z = (values, id) => (typeof values[id] === "number" ? values[id] : 0);
// a trait z (or a 0–1 amount centred on its usual value) to a parameter, within the probe's ±1.6 spreads
const set = (p, name, x) => { const [, m, s] = PARAMS[I[name]]; p[I[name]] = m + s * Math.max(-1.6, Math.min(1.6, x)); };

export function paramsFor(values, derived) {
  const p = MEAN.slice();
  p[I.height] = Math.max(0.5, (derived["body.height"] ?? 172) / 100);      // metres, from the growth curve and stature z
  set(p, "leg", z(values, "body.legLength") * 0.8);
  set(p, "arm", z(values, "body.armLength") * 0.8);
  set(p, "shoulder", z(values, "body.shoulderWidth") * 0.8 - z(values, "body.MF") * 0.35);   // masculine frames broader
  set(p, "hip", z(values, "body.hipWidth") * 0.8 + z(values, "body.MF") * 0.35);
  const fat = (z(values, "body.adiposity") - 0.35) / 0.15, muscle = (z(values, "body.muscularity") - 0.4) / 0.15;
  set(p, "chest", 0.5 * fat + 0.4 * muscle + z(values, "body.chestDepth") * 0.3);
  set(p, "belly", 0.9 * fat);
  set(p, "limb", 0.45 * fat + 0.45 * muscle);
  set(p, "thigh", 0.5 * fat + 0.4 * muscle);
  set(p, "head", z(values, "body.headSize") * 0.8);
  set(p, "neck", z(values, "body.neckLength") * 0.8);
  set(p, "foot", z(values, "body.footSize") * 0.8);
  set(p, "hand", z(values, "body.handSize") * 0.8);
  set(p, "depth", z(values, "body.chestDepth") * 0.8);
  set(p, "slope", 0);
  set(p, "torso", -z(values, "body.legLength") * 0.4);
  return p;
}

export const build = (params) => buildBody(params);

// The far tier's description of a body: coefficients on the one-spread morph basis at the mean height, and the height
// as an exact scale (the stand-in body is linear in height). draw.js and the tests share it.
export function farCoefs(params) {
  return { coef: params.map((v, t) => (t === 0 ? 0 : (v - MEAN[t]) / PARAMS[t][2])), scale: params[0] / MEAN[0] };
}
export function morphBasis(which = "position") {
  return PARAMS.map((_, t) => { const q = MEAN.slice(); q[t] += PARAMS[t][2]; const b = buildBody(q); return b[which].map((x, i) => x - TEMPLATE[which][i]); });
}
