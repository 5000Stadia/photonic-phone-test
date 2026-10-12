// A person's own walk (R9, R4; after r6-gait §7.2): the fitted walker of spikes/gait/gait.js evaluated
// per person per frame in JS, mapped onto the stand-in body's 21 bones, and written as one texture the skinning shader
// reads: per person, per bone, the three columns of the bone's world rotation and its offset u = P - R j (4 texels).
// The GPU pose pass replaces this only if the phone shows the CPU cost or the upload matters.
//
// Frames: gait.js works in x forward, y left, z up; body.js in x left, y up, z forward. A rotation moves between them
// by M_body = C M_gait Cᵀ, with C taking (x, y, z)_gait to (y, z, x).

// The phone page imports this file flat as walkers.js (lab/phone-test/assemble.sh rewrites these two paths).
import { params, pose } from "./gait.js";
import { BONES, B } from "./body.js";

const D = Math.PI / 180;
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mm = (A, Bm) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * Bm[j] + A[3 * i + 1] * Bm[3 + j] + A[3 * i + 2] * Bm[6 + j]; return C; };
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
// gait frame → body frame: rows and columns permuted, (x, y, z)_g → (y, z, x)_b
const PERM = [2, 0, 1]; // gait axis i becomes body axis PERM[i]
const toBody = (M) => { const O = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) O[PERM[i] * 3 + PERM[j]] = M[i * 3 + j]; return O; };
const BI = Object.fromEntries(BONES.map(([n], i) => [n, i]));

// The world rotations of the walker's segments at angles `a`, as gait.js's fk() builds them.
function segmentRotations(P, a) {
  const d = D;
  const Rp = mm(mm(Rz(-a.pelvis[2] * d), Rx(a.pelvis[1] * d)), Ry(a.pelvis[0] * d));
  const Rpel = mm(Rp, Ry(-P.c[P.B.layout.pelvis_tilt[0]] * d));
  const Rthx = mm(Rp, mm(mm(Rz(a.spine[2] * d), Rx(-a.spine[1] * d)), Ry(a.spine[0] * d)));
  const Rhead = mm(Rthx, mm(mm(Rz(a.neck[2] * d), Rx(-a.neck[1] * d)), Ry(a.neck[0] * d)));
  const lf = 0.5 * (a.spine[0] - (P.stoop || 0));
  const Rlum = mm(Rp, mm(mm(Rz(0.5 * a.spine[2] * d), Rx(-0.5 * a.spine[1] * d)), Ry(lf * d)));
  // the trunk's standing pitch (pelvis tilt's ASIS offset) is carried by the pelvis frame; take it out of the column above
  const off = Ry(-P.c[P.B.layout.pelvis_tilt[0]] * d);
  const out = { hips: Rpel, spine: mm(Rlum, off), chest: mm(Rthx, off), neck: mm(Rhead, off), head: mm(Rhead, off) };
  for (const s of ["L", "R"]) {
    const m = s === "L" ? 1 : -1, q = a[s];
    const Rth = mm(Rp, mm(Ry(-q.hip_flex * d), Rx(-m * q.hip_add * d)));
    const Rsh = mm(Rth, Ry(q.knee_flex * d));
    const Rf = mm(Rsh, Ry(-q.ankle_dors * d));
    const Rua = mm(mm(Rthx, off), mm(Ry(-q.shoulder_flex * d), Rx(m * q.shoulder_abd * d)));
    const Rfa = mm(Rua, Ry(-q.elbow_flex * d));
    Object.assign(out, { ["clav" + s]: mm(Rthx, off), ["upperarm" + s]: Rua, ["forearm" + s]: Rfa, ["hand" + s]: Rfa,
      ["thigh" + s]: Rth, ["shin" + s]: Rsh, ["foot" + s]: Rf, ["toe" + s]: Rf });
  }
  return out;
}

// One person's walker for a stand-in body with rest joints J (body.js). `who`: { age, sex (+1/-1), seed }.
export function makeWalker(J, who, basis) {
  const hipY = J[0][1], H = J[0][1] / 0.53;
  // root "fitted": the data's own pelvis path, 2 ms a person, against 16 ms for the root from the feet (65 against 42 mm
  // of slide a step). The crowd page bakes on the main thread; the engine moves the full root into a worker (R7).
  const P = params({ age: who.age, sex: who.sex, height: H, seed: who.seed, root: who.root ?? "fitted" }, basis);
  // timing from this body's own leg (dynamic similarity), so the feet don't slide on it
  const L = hipY, v = Math.sqrt(P.fr * 9.81 * L), stride = P.lam * L, f = v / stride;
  const scaleTrans = L / P.L;
  const w = { P, J, v, f, hipY, scaleTrans, drop: 0 };
  // lift so the lowest foot point over the cycle sits on the floor
  let low = Infinity;
  const W = new Array(B), Pp = new Array(B);
  for (let i = 0; i < 24; i++) {
    poseInto(w, i / 24, W, Pp);
    for (const t of ["toeL", "toeR", "footL", "footR"]) low = Math.min(low, Pp[BI[t]][1] - J[BI[t]][1] * (t.startsWith("toe") ? 1 : 1));
  }
  w.drop = low;
  return w;
}

// World rotations W[b] (body frame, row-major) and joint positions Pp[b] at a phase.
export function poseInto(w, phase, W, Pp) {
  const a = pose(w.P, phase), R = segmentRotations(w.P, a), J = w.J;
  for (let b = 0; b < B; b++) W[b] = toBody(R[BONES[b][0]]);
  const [tf, tl, tu] = a.trans;
  for (let b = 0; b < B; b++) {
    const pa = BONES[b][1];
    if (pa < 0) Pp[b] = [J[0][0] + tl * w.scaleTrans, J[0][1] + tu * w.scaleTrans - w.drop, J[0][2] + tf * w.scaleTrans];
    else { const r = mv(W[pa], [J[b][0] - J[pa][0], J[b][1] - J[pa][1], J[b][2] - J[pa][2]]); Pp[b] = [Pp[pa][0] + r[0], Pp[pa][1] + r[1], Pp[pa][2] + r[2]]; }
  }
}

// Write one person's bones into the live texture's row: per bone two texels, the world rotation as a quaternion
// (x, y, z, w) and the offset u = P - W j. 8 floats a bone, 168 a person.
const Ws = new Array(B), Ps = new Array(B);
export const TEXELS_PER_PERSON = 2 * B;
export function writeBones(w, phase, out, o) {
  poseInto(w, phase, Ws, Ps);
  const J = w.J;
  for (let b = 0; b < B; b++) {
    const M = Ws[b], j = J[b], p = Ps[b], k = o + b * 8;
    // rotation matrix (row-major) to quaternion, the numerically stable branch
    const m00 = M[0], m11 = M[4], m22 = M[8], tr = m00 + m11 + m22;
    let x, y, z, qw;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; qw = 0.25 * s; x = (M[7] - M[5]) / s; y = (M[2] - M[6]) / s; z = (M[3] - M[1]) / s; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (M[7] - M[5]) / s; x = 0.25 * s; y = (M[1] + M[3]) / s; z = (M[2] + M[6]) / s; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (M[2] - M[6]) / s; x = (M[1] + M[3]) / s; y = 0.25 * s; z = (M[5] + M[7]) / s; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (M[3] - M[1]) / s; x = (M[2] + M[6]) / s; y = (M[5] + M[7]) / s; z = 0.25 * s; }
    out[k] = x; out[k + 1] = y; out[k + 2] = z; out[k + 3] = qw;
    out[k + 4] = p[0] - (M[0] * j[0] + M[1] * j[1] + M[2] * j[2]);
    out[k + 5] = p[1] - (M[3] * j[0] + M[4] * j[1] + M[5] * j[2]);
    out[k + 6] = p[2] - (M[6] * j[0] + M[7] * j[1] + M[8] * j[2]);
    out[k + 7] = 0;
  }
}

// Bake everyone's own walk once: F frames of each person's bones (quaternion and offset), plus frame 0 again at the
// end, so the GPU's linear filtering interpolates the cycle. Blocks of F+1 columns, `perRow` people across; each person
// takes 2B rows (quaternion row, offset row per bone). Quaternions keep one sign along the cycle so filtering between
// frames never flips through the long way round. When a person's walk changes (mood, load), rebake their block.
export function bakeOwn(walkers, F = 32, maxWidth = 2048) {
  const N = walkers.length, perRow = Math.max(1, Math.floor(maxWidth / (F + 1)));
  const W = Math.min(N, perRow) * (F + 1), rows = Math.ceil(N / perRow), H = rows * 2 * B;
  const data = new Float32Array(W * H * 4), tmp = new Float32Array(TEXELS_PER_PERSON * 4);
  walkers.forEach((w, i) => bakeOne(w, i, F, perRow, W, data, tmp));
  return { data, W, H, perRow, F };
}
export function bakeOne(w, i, F, perRow, W, data, tmp = new Float32Array(TEXELS_PER_PERSON * 4)) {
  const bx = i % perRow, by = Math.floor(i / perRow), prev = new Float32Array(B * 4);
  for (let f = 0; f <= F; f++) {
    writeBones(w, (f % F) / F, tmp, 0);
    for (let b = 0; b < B; b++) {
      const k = b * 8;
      if (f > 0 && prev[b * 4] * tmp[k] + prev[b * 4 + 1] * tmp[k + 1] + prev[b * 4 + 2] * tmp[k + 2] + prev[b * 4 + 3] * tmp[k + 3] < 0)
        for (let c = 0; c < 4; c++) tmp[k + c] = -tmp[k + c];
      for (let c = 0; c < 4; c++) prev[b * 4 + c] = tmp[k + c];
      const col = bx * (F + 1) + f, rq = (by * B + b) * 2;
      data.set(tmp.subarray(k, k + 4), (rq * W + col) * 4);
      data.set(tmp.subarray(k + 4, k + 8), ((rq + 1) * W + col) * 4);
    }
  }
}
