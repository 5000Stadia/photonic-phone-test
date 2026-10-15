// A person's own walk (R9, R4; after r6-gait §7.2): the fitted walker of spikes/gait/gait.js evaluated
// per person per frame in JS, mapped onto the stand-in body's 21 bones, and written as one texture the skinning shader
// reads: per person, per bone, the three columns of the bone's world rotation and its offset u = P - R j (4 texels).
// The GPU pose pass replaces this only if the phone shows the CPU cost or the upload matters.
//
// Frames: gait.js works in x forward, y left, z up; body.js in x left, y up, z forward. A rotation moves between them
// by M_body = C M_gait Cᵀ, with C taking (x, y, z)_gait to (y, z, x).

// The phone page imports this file flat as walkers.js (lab/phone-test/assemble.sh rewrites these two paths).
import { params, pose, planFor, evalPlan, CENTRE } from "../gait.js";
import { BONES, B } from "../body.js";

const D = Math.PI / 180;
// Rotation matrices are 9 numbers, row-major, in module scratch (Float64Array): a pose makes no allocation. The products are written
// as gait.js's mm() writes them (A row i . B column j, summed in the same order), so the numbers are the same bits as the allocating form.
const Rx = (o, a) => { const c = Math.cos(a), s = Math.sin(a); o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = c; o[5] = -s; o[6] = 0; o[7] = s; o[8] = c; };
const Ry = (o, a) => { const c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = 0; o[2] = s; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = -s; o[7] = 0; o[8] = c; };
const Rz = (o, a) => { const c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = -s; o[2] = 0; o[3] = s; o[4] = c; o[5] = 0; o[6] = 0; o[7] = 0; o[8] = 1; };
// o = A B (o may be A or B)
function mul(o, A, Bm) {
  const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3], a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7], a8 = A[8];
  const b0 = Bm[0], b1 = Bm[1], b2 = Bm[2], b3 = Bm[3], b4 = Bm[4], b5 = Bm[5], b6 = Bm[6], b7 = Bm[7], b8 = Bm[8];
  o[0] = a0 * b0 + a1 * b3 + a2 * b6; o[1] = a0 * b1 + a1 * b4 + a2 * b7; o[2] = a0 * b2 + a1 * b5 + a2 * b8;
  o[3] = a3 * b0 + a4 * b3 + a5 * b6; o[4] = a3 * b1 + a4 * b4 + a5 * b7; o[5] = a3 * b2 + a4 * b5 + a5 * b8;
  o[6] = a6 * b0 + a7 * b3 + a8 * b6; o[7] = a6 * b1 + a7 * b4 + a8 * b7; o[8] = a6 * b2 + a7 * b5 + a8 * b8;
}
// gait frame to body frame: rows and columns permuted, (x, y, z)_g to (y, z, x)_b; gait axis i becomes body axis PERM[i]
const PERM = [2, 0, 1];
const BI = Object.fromEntries(BONES.map(([n], i) => [n, i]));

// ---- one pose, from the walker's plan ----------------------------------------------------------------------------------
// gait.js pose() builds an object of angles for every degree of freedom; the walker uses 26 of them, so its plan (gait.js planFor) lists those
// once per person and a pose is a loop over them: the same sums, in the same order, as pose() gives (test/walk.test.mjs holds the two together).
const WALK_LIMB = ["hip_flex", "hip_add", "knee_flex", "ankle_dors", "shoulder_flex", "shoulder_abd", "elbow_flex"];
const A = new Float64Array(26);
function angles(w, p) {
  const P = w.P;
  if (!w.plan) {      // a walker whose root is built from the feet (not the crowd's "fitted"): gait.js's own pose
    const a = pose(P, p);
    [a.pelvis, a.spine, a.neck].forEach((v, i) => { A[3 * i] = v[0]; A[3 * i + 1] = v[1]; A[3 * i + 2] = v[2]; });
    A[9] = a.trans[0]; A[10] = a.trans[1]; A[11] = a.trans[2];
    ["L", "R"].forEach((s, k) => WALK_LIMB.forEach((d, i) => { A[12 + 7 * k + i] = a[s][d]; }));
  } else {
    evalPlan(w.plan, p, A, P.legGain);
    A[6] -= P.neck0;
    A[9] = A[9] * P.L / 100; A[10] = A[10] * P.L / 100; A[11] = A[11] * P.L / 100;
  }
  // The gait angles are measured from vertical, whereas the rig's rest arms
  // already lean out. Remove that rest spread before applying the gait.
  for (let side = 0; side < 2; side++) A[17 + 7 * side] -= w.armRest[side];
  // an outfit's arm rest (R5, outfits declare it): degrees added to both shoulders' flexion (forward) and abduction (out from the side), so a wearer's arms hang
  // over a skirt's swell instead of inside it. Others have none (w.arms is null) and walk as the data has them.
  if (w.arms) for (let s = 0; s < 2; s++) { A[16 + 7 * s] += w.arms.flex; A[17 + 7 * s] += w.arms.abd; }
}

// scratch rotations: the pelvis column, the thorax, the head, the lumbar, the trunk's standing pitch, temporaries; then per side the thigh, shin,
// foot, upper arm, forearm
const Rp = new Float64Array(9), Rpel = new Float64Array(9), Rthx = new Float64Array(9), Rhead = new Float64Array(9), Rlum = new Float64Array(9), Roff = new Float64Array(9),
  Rsp = new Float64Array(9), Rch = new Float64Array(9), Rnk = new Float64Array(9), T1 = new Float64Array(9), T2 = new Float64Array(9), T3 = new Float64Array(9);
const Rside = [0, 1].map(() => ({ th: new Float64Array(9), sh: new Float64Array(9), fo: new Float64Array(9), ua: new Float64Array(9), fa: new Float64Array(9) }));
// the rotation of each bone, from the scratch above: [side, name]; the walker's world rotations as gait.js's fk() builds them
function segmentRotations(P) {
  const d = D, a = A;
  Rz(T1, -a[2] * d); Rx(T2, a[1] * d); mul(T1, T1, T2); Ry(T2, a[0] * d); mul(Rp, T1, T2);                       // Rp = Rz Rx Ry (pelvis)
  Ry(Roff, -P.c[P.B.layout.pelvis_tilt[0]] * d);
  mul(Rpel, Rp, Roff);
  Rz(T1, a[5] * d); Rx(T2, -a[4] * d); mul(T1, T1, T2); Ry(T2, a[3] * d); mul(T1, T1, T2); mul(Rthx, Rp, T1);   // thorax
  Rz(T1, a[8] * d); Rx(T2, -a[7] * d); mul(T1, T1, T2); Ry(T2, a[6] * d); mul(T1, T1, T2); mul(Rhead, Rthx, T1); // head
  const lf = 0.5 * (a[3] - (P.stoop || 0));
  Rz(T1, 0.5 * a[5] * d); Rx(T2, -0.5 * a[4] * d); mul(T1, T1, T2); Ry(T2, lf * d); mul(T1, T1, T2); mul(Rlum, Rp, T1);   // lumbar
  // the trunk's standing pitch (pelvis tilt's ASIS offset) is carried by the pelvis frame; take it out of the column above
  mul(Rsp, Rlum, Roff); mul(Rch, Rthx, Roff); mul(Rnk, Rhead, Roff);
  const n = 12;
  for (let s = 0; s < 2; s++) {
    const m = s === 0 ? 1 : -1, b = n + s * 7, R = Rside[s];
    Ry(T1, -a[b] * d); Rx(T2, -m * a[b + 1] * d); mul(T1, T1, T2); mul(R.th, Rp, T1);
    Ry(T1, a[b + 2] * d); mul(R.sh, R.th, T1);
    Ry(T1, -a[b + 3] * d); mul(R.fo, R.sh, T1);
    Ry(T1, -a[b + 4] * d); Rx(T2, m * a[b + 5] * d); mul(T1, T1, T2); mul(R.ua, Rch, T1);
    Ry(T1, -a[b + 6] * d); mul(R.fa, R.ua, T1);
  }
}

// The bones' world rotations (body frame, row-major) in w.Wm (B x 9) and joint positions in w.Pm (B x 3) at a phase.
function poseCore(w, phase) {
  const drop = w.drop;           // first, not mid-pose: finding it poses the cycle
  angles(w, phase - Math.floor(phase));
  segmentRotations(w.P);
  const W = w.Wm, src = w.src;
  for (let b = 0; b < B; b++) {
    const M = src[b], o = b * 9;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) W[o + PERM[i] * 3 + PERM[j]] = M[i * 3 + j];
  }
  const Pm = w.Pm, J = w.J, Dj = w.Dj;
  Pm[0] = J[0][0] + A[10] * w.scaleTrans; Pm[1] = J[0][1] + A[11] * w.scaleTrans - drop; Pm[2] = J[0][2] + A[9] * w.scaleTrans;
  for (let b = 1; b < B; b++) {
    const pa = BONES[b][1], M = pa * 9, q = b * 3, d = Dj[b];
    Pm[q] = Pm[pa * 3] + (W[M] * d[0] + W[M + 1] * d[1] + W[M + 2] * d[2]);
    Pm[q + 1] = Pm[pa * 3 + 1] + (W[M + 3] * d[0] + W[M + 4] * d[1] + W[M + 5] * d[2]);
    Pm[q + 2] = Pm[pa * 3 + 2] + (W[M + 6] * d[0] + W[M + 7] * d[1] + W[M + 8] * d[2]);
  }
  // an outfit's keep-out (R5, keepout.js): the arms are moved out of what the person wears, baked into the frames this pose is written to, so the crowd pays nothing a frame
  if (w.keepout) w.keepout.apply(w.bones, { phase: phase - Math.floor(phase), sway: 1 });
}

// The lowest a foot point goes over the cycle (the foot and toe bones' joints below their rest height), sampled at the DROP_FRAMES phases the baked
// texture is sampled at, posed with the given drop.
export const DROP_FRAMES = 32;
const FEET = ["toeL", "toeR", "footL", "footR"].map((t) => BI[t]);
const footLow = (w) => { let low = Infinity; for (const b of FEET) low = Math.min(low, w.Pm[b * 3 + 1] - w.J[b][1]); return low; };
function lowestFoot(w, drop) {
  const keep = w._drop; w._drop = drop;
  let low = Infinity;
  for (let f = 0; f < DROP_FRAMES; f++) { poseCore(w, f / DROP_FRAMES); low = Math.min(low, footLow(w)); }
  w._drop = keep;
  return low;
}

// One person's walker for a body with rest joints J (the rig's, in body.js's layout). `who`: { age, sex (+1/-1), seed, height?, arms? }; the
// height is the body's own when given (R5: MakeHuman's children carry their hips lower than 0.53 of it), else the hips over 0.53. `arms`: { abd, flex }
// degrees added to both shoulders (an outfit's arm rest, garments/outfit.js); left out, the arms walk as the data has them. `keepout`: { apply(bones, ctx) }, run on every pose
// (keepout.js), so a wearer's arms stay out of her clothes; left out, nothing is done.
export function makeWalker(J, who, basis) {
  const hipY = J[0][1], H = who.height ?? J[0][1] / 0.53;
  // root "fitted": the data's own pelvis path, 2 ms a person, against 16 ms for the root from the feet (65 against 42 mm
  // of slide a step). The crowd page bakes on the main thread; the engine moves the full root into a worker (R7).
  const P = params({ age: who.age, sex: who.sex, height: H, seed: who.seed, root: who.root ?? "fitted" }, basis);
  // Retarget the capture's shoulder neutral offsets to a relaxed hang.
  // Keep its harmonics, sex/age axes and personal residuals; clearance is solved
  // against this wearer's clothes afterwards, never a population-wide arm spread.
  P.off.shoulder_abd = (P.off.shoulder_abd || 0) + 8 - basis.axes[0][basis.layout.shoulder_abd[0]];
  P.off.shoulder_flex = (P.off.shoulder_flex || 0) - basis.axes[0][basis.layout.shoulder_flex[0]];
  // Children beyond the high-guard toddler stage have a looser swing. The fitted
  // age axes already reduce the elders' excursion; leave that variation intact.
  if (who.age >= 3.5 && who.age < 12) P.scl.shoulder_flex = (P.scl.shoulder_flex ?? 1) * (1 + 0.2 * (12 - who.age) / 8.5);
  P.plan = null; // params() may have cached a plan while calibrating the legs.
  // timing from this body's own leg (dynamic similarity), so the feet don't slide on it
  const L = hipY, v = Math.sqrt(P.fr * 9.81 * L), stride = P.lam * L, f = v / stride;
  const scaleTrans = L / P.L;
  const plan = P.root ? null : planFor(P, CENTRE, WALK_LIMB);
  const w = { P, J, v, f, hipY, scaleTrans, _drop: null, plan, arms: who.arms ?? null, keepout: who.keepout ?? null, Wm: new Float64Array(B * 9), Pm: new Float64Array(B * 3),
    Dj: BONES.map(([, pa], b) => (pa < 0 ? null : [J[b][0] - J[pa][0], J[b][1] - J[pa][1], J[b][2] - J[pa][2]])), src: null };
  // which scratch rotation each bone takes; the head bone shares the neck's, the hand the forearm's, the toe the foot's
  const sideOf = (n) => Rside[n.endsWith("L") ? 0 : 1];
  w.armRest = ["L", "R"].map(s => {
    const a = J[BI["upperarm" + s]], b = J[BI["forearm" + s]];
    return Math.atan2(Math.abs(b[0] - a[0]), a[1] - b[1]) / D;
  });
  w.bones = { W: w.Wm, P: w.Pm };
  w.src = BONES.map(([n]) => n === "hips" ? Rpel : n === "spine" ? Rsp : n === "chest" ? Rch : n === "neck" || n === "head" ? Rnk : n.startsWith("clav") ? Rch
    : n.startsWith("upperarm") ? sideOf(n).ua : n.startsWith("forearm") || n.startsWith("hand") ? sideOf(n).fa : n.startsWith("thigh") ? sideOf(n).th
    : n.startsWith("shin") ? sideOf(n).sh : sideOf(n).fo);
  // lift so the lowest foot point over the cycle sits on the floor: w.drop, found the first time it is wanted (bakeOne finds it in the frames
  // it poses anyway, so a crowd's walkers never pose a cycle twice)
  Object.defineProperty(w, "drop", { get() { return this._drop ?? (this._drop = lowestFoot(this, 0)); }, set(v) { this._drop = v; }, enumerable: true });
  return w;
}

// World rotations W[b] (body frame, row-major) and joint positions Pp[b] at a phase.
export function poseInto(w, phase, W, Pp) {
  poseCore(w, phase);
  for (let b = 0; b < B; b++) { W[b] = Array.from(w.Wm.subarray(b * 9, b * 9 + 9)); Pp[b] = [w.Pm[b * 3], w.Pm[b * 3 + 1], w.Pm[b * 3 + 2]]; }
}

// Write one person's bones into the live texture's row: per bone two texels, the world rotation as a quaternion
// (x, y, z, w) and the offset u = P - W j. 8 floats a bone, 168 a person.
export const TEXELS_PER_PERSON = 2 * B;
export function writeBones(w, phase, out, o) {
  poseCore(w, phase);
  const J = w.J, Wm = w.Wm, Pm = w.Pm;
  for (let b = 0; b < B; b++) {
    const mo = b * 9, j = J[b], k = o + b * 8;
    // rotation matrix (row-major) to quaternion, the numerically stable branch
    const m00 = Wm[mo], m11 = Wm[mo + 4], m22 = Wm[mo + 8], tr = m00 + m11 + m22;
    let x, y, z, qw;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; qw = 0.25 * s; x = (Wm[mo + 7] - Wm[mo + 5]) / s; y = (Wm[mo + 2] - Wm[mo + 6]) / s; z = (Wm[mo + 3] - Wm[mo + 1]) / s; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (Wm[mo + 7] - Wm[mo + 5]) / s; x = 0.25 * s; y = (Wm[mo + 1] + Wm[mo + 3]) / s; z = (Wm[mo + 2] + Wm[mo + 6]) / s; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (Wm[mo + 2] - Wm[mo + 6]) / s; x = (Wm[mo + 1] + Wm[mo + 3]) / s; y = 0.25 * s; z = (Wm[mo + 5] + Wm[mo + 7]) / s; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (Wm[mo + 3] - Wm[mo + 1]) / s; x = (Wm[mo + 2] + Wm[mo + 6]) / s; y = (Wm[mo + 5] + Wm[mo + 7]) / s; z = 0.25 * s; }
    out[k] = x; out[k + 1] = y; out[k + 2] = z; out[k + 3] = qw;
    out[k + 4] = Pm[b * 3] - (Wm[mo] * j[0] + Wm[mo + 1] * j[1] + Wm[mo + 2] * j[2]);
    out[k + 5] = Pm[b * 3 + 1] - (Wm[mo + 3] * j[0] + Wm[mo + 4] * j[1] + Wm[mo + 5] * j[2]);
    out[k + 6] = Pm[b * 3 + 2] - (Wm[mo + 6] * j[0] + Wm[mo + 7] * j[1] + Wm[mo + 8] * j[2]);
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
const prev = new Float32Array(B * 4), stash = new Float32Array((DROP_FRAMES + 1) * TEXELS_PER_PERSON * 4);
export function bakeOne(w, i, F, perRow, W, data, tmp = new Float32Array(TEXELS_PER_PERSON * 4)) {
  const bx = i % perRow, by = Math.floor(i / perRow), n = TEXELS_PER_PERSON * 4;
  // Pass 1: pose the cycle (frames 0 .. F-1) with the drop as it stands. A walker that has none yet (a crowd's, new) poses at drop 0 and finds its drop in
  // these very frames when F is the drop's sampling, then lifts them; one posed with a drop, or baked at another F, is baked as it is.
  const lazy = w._drop === null && F === DROP_FRAMES;
  if (lazy) w._drop = 0;
  const frames = F <= DROP_FRAMES ? stash : new Float32Array(F * n);
  let low = Infinity;
  for (let f = 0; f < F; f++) { writeBones(w, f / F, frames, f * n); if (lazy) low = Math.min(low, footLow(w)); }
  if (lazy) w._drop = low;
  const shift = lazy ? low : 0;
  // Pass 2: each frame (and frame 0 again to close the cycle: phase 1 is phase 0), lifted, one quaternion sign along the cycle, into the texture.
  for (let f = 0; f <= F; f++) {
    const from = (f % F) * n;
    for (let b = 0; b < B; b++) {
      const k = b * 8, o = from + k;
      tmp[k] = frames[o]; tmp[k + 1] = frames[o + 1]; tmp[k + 2] = frames[o + 2]; tmp[k + 3] = frames[o + 3];
      if (f > 0 && prev[b * 4] * tmp[k] + prev[b * 4 + 1] * tmp[k + 1] + prev[b * 4 + 2] * tmp[k + 2] + prev[b * 4 + 3] * tmp[k + 3] < 0)
        for (let c = 0; c < 4; c++) tmp[k + c] = -tmp[k + c];
      for (let c = 0; c < 4; c++) prev[b * 4 + c] = tmp[k + c];
      const col = bx * (F + 1) + f, rq = (by * B + b) * 2, q = (rq * W + col) * 4, u = ((rq + 1) * W + col) * 4;
      data[q] = tmp[k]; data[q + 1] = tmp[k + 1]; data[q + 2] = tmp[k + 2]; data[q + 3] = tmp[k + 3];
      data[u] = frames[o + 4]; data[u + 1] = frames[o + 5] - shift; data[u + 2] = frames[o + 6]; data[u + 3] = frames[o + 7];
    }
  }
}
