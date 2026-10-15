// Hand-overs between captured motions (hero motion study, 2026-10-15; design/research/hero-motion.md).
// Every clip is a captured one (100STYLE walk and idle, CMU sit); what is made here is only the few
// hundred milliseconds between two of them, as an eased blend of their poses with the feet kept honest:
// a foot planted in both stays exactly where it is, a foot that must move to its place in the next pose
// steps there on a low arc, and the legs reach the feet by IK (no foot ever slides). Easing is the
// quintic smootherstep (zero speed and acceleration at both ends), the offset-decay family used for
// inertialization (Bollo 2018; Holden's cubic closure is its lower-order cousin).
//
// Poses are { W: Float64Array(21 x 9) world rotations, P: Float64Array(21 x 3) joint positions } in the
// person's frame (metres, y up, z their forward), as walk.js bakes them.
import { BONES } from "../body.js";
import { lowest, legTo } from "./mocap.js";

const B = BONES.length;
// A captured walk's start and stop (population.js walkEase): the share of the full pace walked rises from FLOOR to 1 over IN seconds and
// falls back to FLOOR over the last OUT metres. The draw's stand-to-walk hand-over follows the same curve (walkedBy), so it meets the walk.
export const WALK_EASE = { in: 0.45, out: 0.45, floor: 0.3 };
const smooth01 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export const walkEaseAt = (t, rest = Infinity) => WALK_EASE.floor + (1 - WALK_EASE.floor) * Math.min(smooth01(t / WALK_EASE.in), smooth01(rest / WALK_EASE.out));
/** Seconds of full pace walked by `t` seconds into a walk (the integral of the start's share; the stop's is not in it). */
export function walkedBy(t) {
  const T = WALK_EASE.in, f = WALK_EASE.floor, x = Math.max(0, Math.min(1, t / T));
  return f * t + (1 - f) * (t > T ? T * 0.5 + (t - T) : T * (x * x * x - x * x * x * x / 2));
}
export const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (6 * t - 15) + 10); };

// rotation matrix (row-major) <-> unit quaternion [x, y, z, w]
function quat(m, o, q) {
  const m00 = m[o], m11 = m[o + 4], m22 = m[o + 8], tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q[3] = .25 * s; q[0] = (m[o + 7] - m[o + 5]) / s; q[1] = (m[o + 2] - m[o + 6]) / s; q[2] = (m[o + 3] - m[o + 1]) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q[3] = (m[o + 7] - m[o + 5]) / s; q[0] = .25 * s; q[1] = (m[o + 1] + m[o + 3]) / s; q[2] = (m[o + 2] + m[o + 6]) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q[3] = (m[o + 2] - m[o + 6]) / s; q[0] = (m[o + 1] + m[o + 3]) / s; q[1] = .25 * s; q[2] = (m[o + 5] + m[o + 7]) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q[3] = (m[o + 3] - m[o + 1]) / s; q[0] = (m[o + 2] + m[o + 6]) / s; q[1] = (m[o + 5] + m[o + 7]) / s; q[2] = .25 * s; }
  return q;
}
function mat(q, m, o) {
  const [x, y, z, w] = q;
  m[o] = 1 - 2 * (y * y + z * z); m[o + 1] = 2 * (x * y - z * w); m[o + 2] = 2 * (x * z + y * w);
  m[o + 3] = 2 * (x * y + z * w); m[o + 4] = 1 - 2 * (x * x + z * z); m[o + 5] = 2 * (y * z - x * w);
  m[o + 6] = 2 * (x * z - y * w); m[o + 7] = 2 * (y * z + x * w); m[o + 8] = 1 - 2 * (x * x + y * y);
}
const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1], qo = [0, 0, 0, 1];
function slerp(a, b, t, o) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1;
  if (d < 0) { d = -d; s = -1; }
  let ka, kb;
  if (d > .9995) { ka = 1 - t; kb = t; }
  else { const th = Math.acos(d), sn = Math.sin(th); ka = Math.sin((1 - t) * th) / sn; kb = Math.sin(t * th) / sn; }
  for (let i = 0; i < 4; i++) o[i] = ka * a[i] + kb * s * b[i];
  const n = Math.hypot(o[0], o[1], o[2], o[3]); for (let i = 0; i < 4; i++) o[i] /= n;
  return o;
}

/** A copy of a walker's current pose. */
export const snapshot = (w) => ({ W: Float64Array.from(w.Wm), P: Float64Array.from(w.Pm) });
/** Shift a pose by (dx, dz) in the person's frame (a copy). */
export function shifted(pose, dx, dz) { const P = Float64Array.from(pose.P); for (let b = 0; b < B; b++) { P[b * 3] += dx; P[b * 3 + 2] += dz; } return { W: pose.W, P }; }
/** Where a pose's ball (toe joint) of each foot is: [[x, z], [x, z]]. */
export const balls = (pose) => [16, 20].map((b) => [pose.P[b * 3], pose.P[b * 3 + 2]]);

/**
 * The pose between A and B at s (0 A .. 1 B), into the walker-shaped `out` ({ J, Dj, Wm, Pm, legs, sole }).
 * Rotations slerp bone by bone, the pelvis moves on the line between, and each foot goes from its place in
 * A to its place in B on an arc that lifts only as much as the distance asks (a planted foot has none), its
 * lowest sole point at the floor plus the arc. The legs reach the feet by IK; a leg that cannot reach
 * lowers the pelvis first, smoothly.
 */
export function between(out, A, B2, s) {
  const W = out.Wm, P = out.Pm;
  for (let b = 0; b < B; b++) { quat(A.W, b * 9, qa); quat(B2.W, b * 9, qb); mat(slerp(qa, qb, s, qo), W, b * 9); }
  for (let i = 0; i < 3; i++) P[i] = A.P[i] + (B2.P[i] - A.P[i]) * s;
  for (let b = 1; b < B; b++) {
    const pa = BONES[b][1], m = pa * 9, d = out.Dj[b], q = b * 3, o = pa * 3;
    P[q] = W[m] * d[0] + W[m + 1] * d[1] + W[m + 2] * d[2] + P[o];
    P[q + 1] = W[m + 3] * d[0] + W[m + 4] * d[1] + W[m + 5] * d[2] + P[o + 1];
    P[q + 2] = W[m + 6] * d[0] + W[m + 7] * d[1] + W[m + 8] * d[2] + P[o + 2];
  }
  // where each foot goes, and how high: the floor contact of A and of B (their lowest sole points), the ball between
  const targets = [0, 1].map((side) => {
    const t = side ? 20 : 16, a = side ? 19 : 15;
    const ax = A.P[t * 3], az = A.P[t * 3 + 2], bx = B2.P[t * 3], bz = B2.P[t * 3 + 2], dist = Math.hypot(bx - ax, bz - az);
    const hA = soleHeight(out, A, side), hB = soleHeight(out, B2, side);
    const lift = 4 * s * (1 - s) * Math.min(.05, Math.max(0, dist - .01) * .35);
    const x = ax + (bx - ax) * s, z = az + (bz - az) * s, y = hA + (hB - hA) * s + lift;
    return [P[a * 3] + x - P[t * 3], P[a * 3 + 1] + y - lowest(out, side), P[a * 3 + 2] + z - P[t * 3 + 2]];
  });
  let short = 0;
  for (const side of [0, 1]) { const hip = (side ? 17 : 13) * 3, [l1, l2] = out.legs[side]; short = Math.max(short, Math.hypot(targets[side][0] - P[hip], targets[side][1] - P[hip + 1], targets[side][2] - P[hip + 2]) - (l1 + l2 - .002)); }
  const SOFT = .004, drop = SOFT * Math.log1p(Math.exp(Math.min(40, short / SOFT)));
  if (drop > 1e-7) for (let b = 0; b < B; b++) P[b * 3 + 1] -= drop;
  for (const side of [0, 1]) legTo(out, side, targets[side]);
  return out;
}
// the height of a pose's lowest sole point on one side (the walker's sole points, posed by that pose)
function soleHeight(w, pose, side) {
  let m = Infinity;
  for (const [b, q] of w.sole[side]) { const o = b * 9, W = pose.W; const y = W[o + 3] * q[0] + W[o + 4] * q[1] + W[o + 5] * q[2] + pose.P[b * 3 + 1]; if (y < m) m = y; }
  return Math.max(0, m);
}

/** The feet for standing after a pose: the planted foot (`keep`: 0 left, 1 right, 2 both) stays where it is, the other goes to its place beside it in the idle's own stance. */
export function standingFeet(idle, from, keep) {
  const f = balls(from);
  if (keep === 2) return f;
  const h = idle.homeFeet, o = 1 - keep, out = [null, null];
  out[keep] = f[keep]; out[o] = [f[keep][0] + h[o][0] - h[keep][0], f[keep][1] + h[o][1] - h[keep][1]];
  return out;
}
