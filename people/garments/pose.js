// Poses for garments (R5): skin a set of rest vertices with the walker's bones, and make offline poses (sit, stoop) by forward kinematics over the
// same 21 bones, in the walker's own layout, so the garments see one kind of input: bones = { W (B x 9 row-major world rotations), P (B x 3 posed joint
// positions) }, the arrays walk.js leaves in w.Wm and w.Pm.
import { BONES, B } from "../shape.js";
import { BI } from "./wearer.js";

const D = Math.PI / 180;
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mm = (A, C) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[3 * i + j] = A[3 * i] * C[j] + A[3 * i + 1] * C[3 + j] + A[3 * i + 2] * C[6 + j]; return o; };
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];

/** The walker's pose at a gait phase as bones { W, P } (copies, safe to keep). */
export function walkBones(w, phase, bones = { W: new Float64Array(B * 9), P: new Float64Array(B * 3) }, poseInto) {
  const W = new Array(B), Pp = new Array(B);
  poseInto(w, phase, W, Pp);
  for (let b = 0; b < B; b++) { bones.W.set(W[b], b * 9); bones.P.set(Pp[b], b * 3); }
  return bones;
}

/** Forward kinematics from local rotations about x (radians) per bone name (the walker's rest has every bone at identity), the root moved by `shift`.
 *  `flat` names bones whose world rotation is set back to identity (feet flat). `arms` is an outfit's arm rest, { abd, flex } in degrees (as the walker takes
 *  it, walk.js): the upper arms turned out from the side by abd and forward by flex, under whatever the pose does to the trunk. Returns bones { W, P }. */
export function fkBones(J, angles, shift = [0, 0, 0], flat = [], arms = null) {
  const W = new Float64Array(B * 9), P = new Float64Array(B * 3), world = new Array(B);
  for (let b = 0; b < B; b++) {
    const name = BONES[b][0], pa = BONES[b][1];
    let R = angles[name] ? Rx(angles[name]) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (arms && (name === "upperarmL" || name === "upperarmR")) R = mm(mm(Rz((name === "upperarmL" ? 1 : -1) * arms.abd * D), Rx(-arms.flex * D)), R);
    if (pa >= 0) R = mm(world[pa], R);
    if (flat.includes(name)) R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    world[b] = R;
    if (pa < 0) { P[0] = J[0][0] + shift[0]; P[1] = J[0][1] + shift[1]; P[2] = J[0][2] + shift[2]; }
    else {
      const d = [J[b][0] - J[pa][0], J[b][1] - J[pa][1], J[b][2] - J[pa][2]], M = world[pa];
      P[b * 3] = P[pa * 3] + M[0] * d[0] + M[1] * d[1] + M[2] * d[2]; P[b * 3 + 1] = P[pa * 3 + 1] + M[3] * d[0] + M[4] * d[1] + M[5] * d[2]; P[b * 3 + 2] = P[pa * 3 + 2] + M[6] * d[0] + M[7] * d[1] + M[8] * d[2];
    }
    W.set(R, b * 9);
  }
  return { W, P };
}

const lowest = (bones, J, tipToe) => {          // how far the ankles and toes are below where the rest stance has them (negative: below)
  let low = Infinity;
  for (const n of ["footL", "footR"]) { const b = BI[n]; low = Math.min(low, bones.P[3 * b + 1] - J[b][1]); }
  for (const [n, k] of [["toeL", "toeL"], ["toeR", "toeR"]]) {
    const b = BI[n], t = tipToe[k], d = [t[0] - J[b][0], t[1] - J[b][1], t[2] - J[b][2]], M = bones.W.subarray(b * 9, b * 9 + 9);
    low = Math.min(low, bones.P[3 * b + 1] + M[3] * d[0] + M[4] * d[1] + M[5] * d[2] - t[1]);
  }
  return low;
};

/** Offline poses, as the sweep and the stills use them. `sit`: thighs forward about 85 degrees, knees bent about 90, feet flat, the arms forward (the upper arms hanging, the elbows 70 (the upper arm forward drags the sleeve over the base layer at the cap: the bars say so)), as a hand resting on her lap would be, the pelvis put so the
 *  feet stand on the floor; `stoop`: the trunk bent forward about 40 degrees (spine, chest, neck) with the knees a little bent. Each returns { bones,
 *  seat } where seat is the height of the seat the sit pose rests on (0 for the others). */
export function offlinePose(kind, J, tip, arms = null, keepout = null) {
  const A = {}, flat = ["footL", "footR", "toeL", "toeR"];
  if (kind === "sit") { for (const S of ["L", "R"]) { A["thigh" + S] = -85 * D; A["shin" + S] = 90 * D; A["upperarm" + S] = 0 * D; A["forearm" + S] = -70 * D; } }          // hands forward, over the lap: the keep-out puts them on it
  else if (kind === "stoop") { A.spine = 22 * D; A.chest = 14 * D; A.neck = 6 * D; for (const S of ["L", "R"]) { A["thigh" + S] = -14 * D; A["shin" + S] = 24 * D; } }
  else throw new Error("offlinePose: " + kind);
  let bones = fkBones(J, A, [0, 0, 0], flat, arms);
  const drop = lowest(bones, J, { toeL: tip.toeL, toeR: tip.toeR });
  bones = fkBones(J, A, [0, -drop, 0], flat, arms);
  if (keepout) keepout.apply(bones, { phase: 0, sway: 0 });          // the arms out of what she wears (keepout.js)
  return { bones };
}

/** x' = sum w (W_b (x - J_b) + P_b) for the vertices in `ids` (or all of 0..n), reading skinIndex/skinWeight with K = 4 influences, into out (3 per vertex). */
export function skinVertices(pos, skinIndex, skinWeight, J, bones, out, ids = null, K = 4) {
  const { W, P } = bones, n = ids ? ids.length : pos.length / 3;
  for (let i = 0; i < n; i++) {
    const v = ids ? ids[i] : i, px = pos[3 * v], py = pos[3 * v + 1], pz = pos[3 * v + 2];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < K; k++) {
      const wt = skinWeight[v * K + k]; if (!wt) continue;
      const b = skinIndex[v * K + k], m = b * 9, j = J[b], dx = px - j[0], dy = py - j[1], dz = pz - j[2];
      x += wt * (W[m] * dx + W[m + 1] * dy + W[m + 2] * dz + P[3 * b]); y += wt * (W[m + 3] * dx + W[m + 4] * dy + W[m + 5] * dz + P[3 * b + 1]); z += wt * (W[m + 6] * dx + W[m + 7] * dy + W[m + 8] * dz + P[3 * b + 2]);
    }
    const o = ids ? i : v; out[3 * o] = x; out[3 * o + 1] = y; out[3 * o + 2] = z;
  }
  return out;
}
