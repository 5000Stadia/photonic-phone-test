// Captured starts, stops and the turn before sitting (hero motion study, round 4, 2026-10-16; design/research/hero-motion.md, "Round 4").
// The walk and the standing idle were captured; going from one to the other was a blend of the two (motion.js `between`, 0.45 to 0.55 s), in which
// a hand moved up to 3.7 m/s, and the turn before a sit was a 0.5 s spin on the spot. Here those are captures too, from 100STYLE's Neutral takes (the
// actor and session of the walk and the idle loop; vendor/walk/100style/NOTICE.md):
//   start  standing, the weight onto the right foot, the left foot first, three steps up to the walk (the full idle take, after its idle cut)
//   stop   the walk, two shortening steps, the feet closing (the forward walk take, a stop mid-trial: the idle take's stops end in gestures)
//   turn   the walk, an about-turn on two pivot steps (the right foot, then the left), two settling steps, standing facing back (the idle take's start)
// Each is cut to a body as the walk is (mocap.js: the same standing reference and rest, the pelvis at the capture's height scaled by hip height), and
// then fitted to where it has to go without changing its poses: its path is re-laid, the distance it covers scaled (`scaleIn` while it still walks,
// `scaleOut` from there on, `shift` spread over the same steps) and its turn warped (`warp`, degrees added as the capture turns), each pose kept as far
// off the path, and as turned against it, as the capture is off its own. Its feet are held where they land: a planted foot's ball stays put while the
// capture's is still (mid-stance through the push-off, and a pivot) by leg IK, the heel's rocker before that as captured; a lifting foot leaves from
// where it was held and lands where the re-laid step puts it. The walk side of a move (the stop's and the turn's start, the start's end) is the phase of
// our walk cycle matched to the capture (`entryPhase`, `exitPhase`: the cycle's own phase, mocap.js CYCLE), blended over a quarter second as the draw
// bakes it (draw.js bakeMove).
//
// A move: { kind, duration (s), dt, n, frames: [{ W, P }] (n poses, every dt), traj(t) -> [x, z, yaw] (the path it takes, smoothed over a step: where
// the person is and faces), end: { x, z, yaw, feet } } in its own frame: the person where the move begins at the origin, facing +z (yaw 0; x their left,
// as the person's frame is).
import { BONES } from "../body.js";
import { mv } from "../bvh.js";
import { captureFunctions, loadCapture, CAPTURE_SOLE, lowest, makeIdleWalker } from "./mocap.js";
import { between, ease } from "./motion.js";

const B = BONES.length;
export const MOVES_VERSION = "neutral-moves-v1";
// The cuts' rows (30 a second; source frame = first + 2 x row; vendor/walk/100style/NOTICE.md). Phases are the walk cycle's own (mocap.js CYCLE, the
// left heel strike at 0), matched to the capture by joint positions and velocities about the hips (design/research/hero-motion.md, Round 4).
// `walking`: the share of the move (0..1) that still walks at the walk's pace, at its start (stop, turn) or its end (start).
// `idleArms`: rows where the captured arms are not the walk's or the idle's (the idle take's actor stands with folded arms before his start and folds them
// again after his turn): there the arms are the idle's own (hanging, against the chest), eased in from `in` to `full` and out from `full` to `out`.
// `turnAt`: where a move that hardly turns of itself takes a warp (its share of the way through, from and to): a start over its first step (a turn toward
// the way, made as it sets off; a turn of 150 degrees or more over its first two), a stop over its last two (a turn to face a seat, made as it arrives).
export const MOVE_DEFS = {
  start: { take: "start", from: 0, to: 65, exitPhase: 0.09, walking: [0.6, 1], idleArms: { full: 5, out: 17 }, turnAt: [0.03, 0.4, 0.65] },
  stop: { take: "stop", from: 0, to: 52, entryPhase: 0.05, walking: [0, 0.12], turnAt: [0.35, 0.85] },
  turn: { take: "turn", from: 0, to: 76, entryPhase: 0.12, walking: [0, 0.21], idleArms: { in: 58, full: 68 } },
};
// the takes: where each cut is in its source (its first source frame; vendor/walk/100style/NOTICE.md)
const TAKES = { start: { file: "Neutral_start", source: "Neutral_ID", first: 1714 }, stop: { file: "Neutral_stop", source: "Neutral_FW", first: 5820 }, turn: { file: "Neutral_turn", source: "Neutral_ID", first: 128 } };
let loading = null, takes = null;
/** Load the moves' captures (once; about 160 KB). Resolves when makeMove can be used. */
export function loadMoves() {
  return loading ??= Promise.all(Object.entries(TAKES).map(async ([name, t]) => [name, await loadCapture(t.file)])).then((list) => {
    takes = Object.fromEntries(list.map(([name, C]) => [name, { ...prepareTake(C, TAKES[name].first), source: TAKES[name].source }]));
    return takes;
  }).catch((e) => { loading = null; throw e; });
}
export const movesReady = () => !!takes;
export const moveTake = (kind) => takes?.[MOVE_DEFS[kind].take] ?? null;

const edge = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const KNEE_SLACK = (10 * Math.PI) / 180;              // a knee straightens at most this far past its captured angle to reach (mocap.js)
const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
// A take: its retarget (mocap.js captureFunctions, the cut's own mean facing taken out) and, row by row, how still each foot's heel and ball are in the
// capture (1 still, 0 moving: horizontal speed through 0.12 to 0.3 m/s, as the walk's contacts are found) and whether the foot is planted at all.
function prepareTake(C, first) {
  const F = captureFunctions(C, [0, C.rows.length - 1], MOVES_VERSION, { idle: true }), n = C.rows.length;
  const soleAt = (f, side) => CAPTURE_SOLE.map(([name, q]) => { const fr = C.frames[Math.max(0, Math.min(n - 1, f))][C.index[side + name]]; return mv(fr.W, q).map((v, k) => (v + fr.P[k]) / 100); });
  const still = ["Left", "Right"].map((side) => Array.from({ length: n }, (_, f) => {
    const a = soleAt(f - 1, side), b = soleAt(f + 1, side), dt = (Math.min(n - 1, f + 1) - Math.max(0, f - 1)) * C.dt;
    return a.map((p, k) => 1 - edge(0.12, 0.3, Math.hypot(b[k][0] - p[0], b[k][2] - p[2]) / dt));
  }));
  // planted: any sole point still, gaps and flickers of a tenth of a second closed and dropped (the stance intervals)
  const R = 2, planted = still.map((s) => {
    const any = s.map((v) => (Math.max(...v) > 0.5 ? 1 : 0)), m = (arr, op) => arr.map((_, i) => { let v = arr[i]; for (let j = -R; j <= R; j++) v = op(v, arr[Math.max(0, Math.min(n - 1, i + j))]); return v; });
    return m(m(m(m(any, Math.max), Math.min), Math.min), Math.max);
  });
  // the ball's own speed (m/s), row by row: its locks (finishMove)
  const ballSpeed = ["Left", "Right"].map((side) => Array.from({ length: n }, (_, f) => { const a = soleAt(f - 1, side)[1], b = soleAt(f + 1, side)[1]; return Math.hypot(b[0] - a[0], b[2] - a[2]) / ((Math.min(n - 1, f + 1) - Math.max(0, f - 1)) * C.dt); }));
  return { C, F, n, dt: C.dt, first, still, planted, ballSpeed };
}

// Our rig's sole points (mocap.js rigSole, the walker's `sole`): 0 the flat heel, 1 the rounded heel, 2 the ball, 3 the toe tip.
const pointOf = (W, P, [b, q]) => [W[b * 9] * q[0] + W[b * 9 + 1] * q[1] + W[b * 9 + 2] * q[2] + P[b * 3], W[b * 9 + 3] * q[0] + W[b * 9 + 4] * q[1] + W[b * 9 + 5] * q[2] + P[b * 3 + 1], W[b * 9 + 6] * q[0] + W[b * 9 + 7] * q[1] + W[b * 9 + 8] * q[2] + P[b * 3 + 2]];
const yawOf = (W) => Math.atan2(W[2], W[8]);
/** A pose turned by `yaw` (the heading added) about the vertical through (ox, oz), that point then moved to (tx, tz). In place. */
export function turnPose(W, P, yaw, ox, oz, tx, tz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let b = 0; b < B; b++) {
    const o = b * 9;
    for (let k = 0; k < 3; k++) { const a = W[o + k], z = W[o + 6 + k]; W[o + k] = c * a + s * z; W[o + 6 + k] = -s * a + c * z; }
    const x = P[b * 3] - ox, z = P[b * 3 + 2] - oz; P[b * 3] = tx + c * x + s * z; P[b * 3 + 2] = tz - s * x + c * z;
  }
}
// left and right swapped and x negated (a mirrored move: the stop on the other foot, the turn the other way round)
const MIRROR = BONES.map(([n]) => BONES.findIndex(([m]) => m === (n.endsWith("L") ? n.slice(0, -1) + "R" : n.endsWith("R") ? n.slice(0, -1) + "L" : n)));
function mirrorPose(W, P) {
  const w2 = new Float64Array(B * 9), p2 = new Float64Array(B * 3);
  for (let b = 0; b < B; b++) {
    const m = MIRROR[b], o = b * 9, q = m * 9;
    // M R M with M = diag(-1, 1, 1): the entries pairing x with y or z change sign
    w2[o] = W[q]; w2[o + 1] = -W[q + 1]; w2[o + 2] = -W[q + 2]; w2[o + 3] = -W[q + 3]; w2[o + 4] = W[q + 4]; w2[o + 5] = W[q + 5]; w2[o + 6] = -W[q + 6]; w2[o + 7] = W[q + 7]; w2[o + 8] = W[q + 8];
    p2[b * 3] = -P[m * 3]; p2[b * 3 + 1] = P[m * 3 + 1]; p2[b * 3 + 2] = P[m * 3 + 2];
  }
  W.set(w2); P.set(p2);
}
// Two-bone leg IK (mocap.js legTo) with the knee bending toward the thigh's own forward: legTo takes the bend from where the knee is, which a straight leg
// (a heel strike: 1 degree) leaves to rounding, and which an ankle moved to hold a foot can put on the far side of the new hip-ankle line, so the knee
// flipped (8 m/s at a heel strike in the start). The foot and toe keep their world rotations.
const RT = new Float64Array(9);
function turnInto(o, ax, ay, az, bx, by, bz) {
  const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1; ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
  const c = ax * bx + ay * by + az * bz;
  if (c < -0.999999) { o.set([1, 0, 0, 0, -1, 0, 0, 0, -1]); return o; }
  const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, k = 1 / (1 + c);
  o[0] = 1 - (z * z + y * y) * k; o[1] = -z + x * y * k; o[2] = y + x * z * k; o[3] = z + x * y * k; o[4] = 1 - (z * z + x * x) * k; o[5] = -x + y * z * k; o[6] = -y + x * z * k; o[7] = x + y * z * k; o[8] = 1 - (y * y + x * x) * k; return o;
}
function leftMul(W, o, R) { for (let k = 0; k < 3; k++) { const a = W[o + k], b = W[o + 3 + k], c = W[o + 6 + k]; W[o + k] = R[0] * a + R[1] * b + R[2] * c; W[o + 3 + k] = R[3] * a + R[4] * b + R[5] * c; W[o + 6 + k] = R[6] * a + R[7] * b + R[8] * c; } }
function legToPole(w, side, target, reach = Infinity) {
  const hip = side ? 17 : 13, knee = hip + 1, ankle = hip + 2, toe = hip + 3, P = w.Pm, W = w.Wm, [l1, l2] = w.legs[side];
  const hx = P[hip * 3], hy = P[hip * 3 + 1], hz = P[hip * 3 + 2], kx = P[knee * 3], ky = P[knee * 3 + 1], kz = P[knee * 3 + 2], ax = P[ankle * 3], ay = P[ankle * 3 + 1], az = P[ankle * 3 + 2];
  const dx = target[0] - hx, dy = target[1] - hy, dz = target[2] - hz, dist = Math.hypot(dx, dy, dz) || 1e-9, d = Math.min(l1 + l2 - 1e-9, reach, Math.max(Math.abs(l1 - l2) + 1e-9, dist));
  const ux = dx / dist, uy = dy / dist, uz = dz / dist, along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), radius = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // the bend's direction: the thigh's own forward (its local +z, the way a knee bends), off the hip-target line. The knee's offset from that line is not
  // used: with the ankle moved to hold a foot, the captured knee can fall on the far side of the new line and the knee would bend backward
  const ox = kx - hx, oy = ky - hy, oz = kz - hz, fx = W[hip * 9 + 2], fy = W[hip * 9 + 5], fz = W[hip * 9 + 8];
  let bx = fx, by = fy, bz = fz; const dot = bx * ux + by * uy + bz * uz; bx -= dot * ux; by -= dot * uy; bz -= dot * uz;
  const bl = Math.hypot(bx, by, bz) || 1;
  const nkx = hx + along * ux + (radius * bx) / bl, nky = hy + along * uy + (radius * by) / bl, nkz = hz + along * uz + (radius * bz) / bl, nax = hx + d * ux, nay = hy + d * uy, naz = hz + d * uz;
  leftMul(W, hip * 9, turnInto(RT, ox, oy, oz, nkx - hx, nky - hy, nkz - hz));
  leftMul(W, knee * 9, turnInto(RT, ax - kx, ay - ky, az - kz, nax - nkx, nay - nky, naz - nkz));
  P[knee * 3] = nkx; P[knee * 3 + 1] = nky; P[knee * 3 + 2] = nkz; P[ankle * 3] = nax; P[ankle * 3 + 1] = nay; P[ankle * 3 + 2] = naz;
  P[toe * 3] += nax - ax; P[toe * 3 + 1] += nay - ay; P[toe * 3 + 2] += naz - az;
}
// The idle's arms on this body, each arm bone's rotation against the chest (the idle loop's first frame: the arms hanging), cached on their walker
const ARM = [5, 6, 7, 8, 9, 10, 11, 12];
function idleArms(walker) {
  if (walker._idleArms) return walker._idleArms;
  const idle = makeIdleWalker(walker.J, { age: walker.age ?? 30, seed: 0, build: walker.build ?? 0.5 });
  idle.pose(idle, 0);
  const W = idle.Wm, ch = 2 * 9, rel = {};
  for (const b of ARM) { const o = b * 9, r = new Float64Array(9); for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) r[i * 3 + k] = W[ch + i] * W[o + k] + W[ch + 3 + i] * W[o + 3 + k] + W[ch + 6 + i] * W[o + 6 + k]; rel[b] = r; }
  return (walker._idleArms = rel);
}
// a pose's arms turned `wt` of the way to the idle's (against its own chest), and their joints put back on the chain
const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1];
function quatOf(m, o, q) {
  const m00 = m[o], m11 = m[o + 4], m22 = m[o + 8], tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q[3] = 0.25 * s; q[0] = (m[o + 7] - m[o + 5]) / s; q[1] = (m[o + 2] - m[o + 6]) / s; q[2] = (m[o + 3] - m[o + 1]) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q[3] = (m[o + 7] - m[o + 5]) / s; q[0] = 0.25 * s; q[1] = (m[o + 1] + m[o + 3]) / s; q[2] = (m[o + 2] + m[o + 6]) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q[3] = (m[o + 2] - m[o + 6]) / s; q[0] = (m[o + 1] + m[o + 3]) / s; q[1] = 0.25 * s; q[2] = (m[o + 5] + m[o + 7]) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q[3] = (m[o + 3] - m[o + 1]) / s; q[0] = (m[o + 2] + m[o + 6]) / s; q[1] = (m[o + 5] + m[o + 7]) / s; q[2] = 0.25 * s; }
  return q;
}
function armsTo(f, rel, wt, Dj) {
  const W = f.W, P = f.P, ch = 2 * 9, t = new Float64Array(9);
  for (const b of ARM) {
    const r = rel[b], o = b * 9;
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) t[i * 3 + k] = W[ch + i * 3] * r[k] + W[ch + i * 3 + 1] * r[3 + k] + W[ch + i * 3 + 2] * r[6 + k];
    quatOf(W, o, qa); quatOf(t, 0, qb);
    let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3], sg = 1; if (d < 0) { d = -d; sg = -1; }
    let ka = 1 - wt, kb = wt; if (d < 0.9995) { const th = Math.acos(d), sn = Math.sin(th); ka = Math.sin((1 - wt) * th) / sn; kb = Math.sin(wt * th) / sn; }
    const x = ka * qa[0] + kb * sg * qb[0], y = ka * qa[1] + kb * sg * qb[1], z = ka * qa[2] + kb * sg * qb[2], w = ka * qa[3] + kb * sg * qb[3], nq = Math.hypot(x, y, z, w);
    const X = x / nq, Y = y / nq, Z = z / nq, Q = w / nq;
    W[o] = 1 - 2 * (Y * Y + Z * Z); W[o + 1] = 2 * (X * Y - Z * Q); W[o + 2] = 2 * (X * Z + Y * Q); W[o + 3] = 2 * (X * Y + Z * Q); W[o + 4] = 1 - 2 * (X * X + Z * Z); W[o + 5] = 2 * (Y * Z - X * Q); W[o + 6] = 2 * (X * Z - Y * Q); W[o + 7] = 2 * (Y * Z + X * Q); W[o + 8] = 1 - 2 * (X * X + Y * Y);
  }
  for (const b of ARM) { const pa = BONES[b][1], m = pa * 9, d = Dj[b]; for (let r = 0; r < 3; r++) P[b * 3 + r] = W[m + r * 3] * d[0] + W[m + r * 3 + 1] * d[1] + W[m + r * 3 + 2] * d[2] + P[pa * 3 + r]; }
}
/** The take's walker for this body (cached on theirs): the walk's retarget and rest, and the walk's floor offset (the feet on the floor as the walk's are). */
function takeWalker(walker, T) {
  const cache = (walker._moves ??= new Map());
  let w = cache.get(T);
  if (!w) {
    w = T.F.makeMocapWalker(walker.J, { seed: 0, age: walker.age ?? 30, build: walker.build ?? 0.5 });
    w.floorOffset = walker.floorOffset ?? w.floorOffset; w.gain = 1; w.keepout = null; w.stoop = walker.stoop ?? 0; w.postureKey = [w.stoop, w.build];
    cache.set(T, w);
  }
  return w;
}

/**
 * A person's captured move. `walker`: their own walker (rec.walker: its rest joints, the floor offset that puts its feet on the floor). `kind`: start,
 * stop or turn. opts:
 *   mirror       the move on the other foot (the stop entered on the right foot, the turn the other way round)
 *   scaleIn      the distance covered while it still walks, as a share of the capture's (the person's own pace against the capture's)
 *   scaleOut     the distance covered over the rest (the stop's and turn's last steps: where the move must end)
 *   warp         degrees of turn added over the move (a start toward a route a little off where they face; a stop that ends facing a seat)
 *   shift        [x, z] metres added to where it ends, spread over its steps after the walk (what scaling leaves of a landing: aside, or on)
 *   entry        { pose(t) -> { W, P } (the walk's pose t s into the move, in the move's frame), anchor: [side, x, z] (the walk's planted foot's ball) }
 *   exit         { pose(t) -> { W, P } (the walk's pose t s after the move's end (t <= 0), in the move's frame) }
 *   feet         [[x, z], [x, z]] the balls of the feet to start from (a start: where the idle has them, in the move's frame)
 *   endFeet      [[x, z], [x, z]] where its last steps must leave the balls (a turn or stop into a sit-down: its first stance), in the move's frame
 *   keepout      the arms' keep-out (keepout.js) to apply, searched every fourth pose and blended between
 *   rate         poses a second (60)
 */
export function makeMove(walker, kind, opts = {}) {
  if (!takes) throw Error("moves: loadMoves() first");
  const def = MOVE_DEFS[kind], T = takes[def.take], F = T.F, w = takeWalker(walker, T);
  const mirror = !!opts.mirror, sIn = opts.scaleIn ?? 1, sOut = opts.scaleOut ?? sIn, warp = ((opts.warp ?? 0) * Math.PI) / 180;
  const duration = (def.to - def.from) * T.dt, n = opts.frames ?? Math.max(2, Math.round(duration * (opts.rate ?? 60)) + 1), dt = duration / (n - 1), N = T.n - 1;
  const rowAt = (j) => def.from + (j * dt) / T.dt;
  // pass 1: the raw poses (the take's own path, in the take's frame), and their path smoothed over a step (the hips' place and facing, sigma 0.25 s).
  // The raw poses depend on nothing but the body, the move, the foot and the count: kept on their walker (a move again costs about a third less)
  const raws = (walker._moveRaws ??= new Map()), rawKey = `${kind}${mirror ? "~" : ""}:${n}`;
  if (!raws.has(rawKey)) raws.set(rawKey, Array.from({ length: n }, (_, j) => {
    F.rawPose(w, Math.min(rowAt(j), N - 1e-6) / N, 0, false);
    const W = Float64Array.from(w.Wm), P = Float64Array.from(w.Pm);
    if (mirror) mirrorPose(W, P);
    return { W, P };
  }));
  const frames = raws.get(rawKey).map(({ W, P }) => ({ W: Float64Array.from(W), P: Float64Array.from(P) }));
  let unwrapped = yawOf(frames[0].W);
  const yawRaw = frames.map(({ W }, j) => (j ? (unwrapped += wrapPi(yawOf(W) - yawOf(frames[j - 1].W))) : unwrapped));
  const px = smoothPath(frames.map((f) => f.P[0]), 0.25 / dt), pz = smoothPath(frames.map((f) => f.P[2]), 0.25 / dt), py = smoothPath(yawRaw, 0.25 / dt);
  // pass 2: the path re-laid in the move's frame (its first smoothed place at the origin, its first smoothed facing ahead): each step of the raw path,
  // taken in the raw path's own frame, scaled and laid along the re-laid facing (the raw one less the first, plus the warp's share)
  const walkShare = walkShareOf(def);
  const tx = new Float64Array(n), tz = new Float64Array(n), ty = new Float64Array(n), wv = new Float64Array(n);
  // `shift` spread over the steps after the walk, by the distance each covers (a landing's last few centimetres: steps a little aside or on)
  const shift = opts.shift ?? [0, 0];
  let restLen = 0;
  for (let j = 1; j < n; j++) restLen += (1 - walkShare(j / (n - 1))) * Math.hypot(px[j] - px[j - 1], pz[j] - pz[j - 1]);
  // the warp's share at each pose: as the capture itself turns (the turn's pivots), so a planted foot turns only where the captured one does; a move that
  // hardly turns of itself takes it where its def says (turnAt; its planted feet pivoting on the ball past 25 degrees: finishMove)
  const warpAt = warpShare(def, py, n, warp);
  for (let j = 0; j < n; j++) {
    const s = j / (n - 1);
    wv[j] = warp * warpAt(j); ty[j] = py[j] - py[0] + wv[j];
    if (!j) continue;
    const dx = px[j] - px[j - 1], dz = pz[j] - pz[j - 1], a = py[j], ca = Math.cos(a), sa = Math.sin(a);
    const lx = ca * dx - sa * dz, lz = sa * dx + ca * dz;                    // the step in the raw path's own frame (forward +z)
    const k = sOut + (sIn - sOut) * walkShare(s), c = Math.cos(ty[j]), sn = Math.sin(ty[j]), r = restLen > 1e-9 ? ((1 - walkShare(s)) * Math.hypot(dx, dz)) / restLen : 0;
    tx[j] = tx[j - 1] + k * (c * lx + sn * lz) + shift[0] * r; tz[j] = tz[j - 1] + k * (-sn * lx + c * lz) + shift[1] * r;
  }
  // pass 3: each pose put on the re-laid path, as far off it and as turned against it as the capture is off its own smoothed path
  for (let j = 0; j < n; j++) turnPose(frames[j].W, frames[j].P, ty[j] - py[j], px[j], pz[j], tx[j], tz[j]);
  // the arms the idle's where the capture's are folded (def.idleArms)
  if (def.idleArms) {
    const ia = def.idleArms, rel = idleArms(walker);
    for (let j = 0; j < n; j++) { const r = rowAt(j), wt = ia.in !== undefined ? edge(ia.in, ia.full, r) : 1 - edge(ia.full, ia.out, r); if (wt > 0) armsTo(frames[j], rel, wt, w.Dj); }
  }
  return finishMove({ kind, def, T, w, frames, tx, tz, ty, wv, n, dt, duration, mirror, opts, rowAt });
}

/**
 * What a move does on this body, without its poses: how far it goes while it still walks and after (`walk`, `rest`: metres along its path at scale 1),
 * the speed it walks at (`speed`, m/s, where it walks), its duration, and its path (the hips' smoothed place and facing, 61 samples, in the take's frame)
 * for movePath. Cached per walker. The population plans a stop or a turn with it (where to begin, how much to scale its steps) before any pose is made.
 */
export function moveShape(walker, kind, mirror = false) {
  const key = kind + (mirror ? "~" : ""), cache = (walker._moveShapes ??= new Map());
  if (cache.has(key)) return cache.get(key);
  const def = MOVE_DEFS[kind], T = takes[def.take], w = takeWalker(walker, T), n = 61, duration = (def.to - def.from) * T.dt, dt = duration / (n - 1), N = T.n - 1;
  const xr = [], zr = [], yr = [];
  let prevYaw = null, unwrapped = 0;
  for (let j = 0; j < n; j++) {
    T.F.rawPose(w, Math.min(def.from + (j * dt) / T.dt, N - 1e-6) / N, 0, false);
    const sg = mirror ? -1 : 1, yaw = sg * yawOf(w.Wm);
    if (prevYaw !== null) unwrapped += wrapPi(yaw - prevYaw); else unwrapped = yaw; prevYaw = yaw;
    xr.push(sg * w.Pm[0]); zr.push(w.Pm[2]); yr.push(unwrapped);
  }
  const px = smoothPath(xr, 0.25 / dt), pz = smoothPath(zr, 0.25 / dt), py = smoothPath(yr, 0.25 / dt);
  const share = walkShareOf(def);
  let walk = 0, rest = 0, walkTime = 0;
  for (let j = 1; j < n; j++) { const d = Math.hypot(px[j] - px[j - 1], pz[j] - pz[j - 1]), u = share(j / (n - 1)); walk += u * d; rest += (1 - u) * d; walkTime += u * dt; }
  const out = { kind, mirror, walk, rest, speed: walk / Math.max(1e-6, walkTime), duration, n, px, pz, py, share };
  cache.set(key, out);
  return out;
}
/**
 * Where a move ends on this body for a warp (degrees), as the two parts its scales take: end = scaleIn x `walk` + scaleOut x `rest` (+ shift) ([x, z]
 * each, in the move's frame), facing `yaw` (radians). The same re-laying as makeMove's, on moveShape's path: linear in the scales, so the population
 * solves them.
 */
export function movePath(walker, kind, { mirror = false, warp = 0 } = {}) {
  const S = moveShape(walker, kind, mirror), { n, px, pz, py, share } = S, wr = (warp * Math.PI) / 180, warpAt = warpShare(MOVE_DEFS[kind], py, n, wr);
  const walk = [0, 0], rest = [0, 0];
  for (let j = 1; j < n; j++) {
    const y = py[j] - py[0] + wr * warpAt(j), dx = px[j] - px[j - 1], dz = pz[j] - pz[j - 1], a = py[j], ca = Math.cos(a), sa = Math.sin(a);
    const lx = ca * dx - sa * dz, lz = sa * dx + ca * dz, c = Math.cos(y), sn = Math.sin(y), sx = c * lx + sn * lz, sz = -sn * lx + c * lz, u = share(j / (n - 1));
    walk[0] += u * sx; walk[1] += u * sz; rest[0] += (1 - u) * sx; rest[1] += (1 - u) * sz;
  }
  return { walk, rest, yaw: py[n - 1] - py[0] + wr, speed: S.speed, duration: S.duration };
}
// the share of a warp (radians) taken by pose j of n: as the capture's own turn goes (py, its smoothed facing), or for a move that hardly turns, over its
// def's turnAt span (a start's span reaching further for a warp from 60 to 150 degrees)
function warpShare(def, py, n, warp) {
  const turned = py[n - 1] - py[0];
  if (Math.abs(turned) > 0.2) return (j) => Math.max(0, Math.min(1, (py[j] - py[0]) / turned));
  const [a, b, far = b] = def.turnAt ?? [0.1, 0.6], to = b + (far - b) * Math.max(0, Math.min(1, (Math.abs(warp) - Math.PI / 3) / (Math.PI / 2)));
  return (j) => edge(a, to, j / (n - 1));
}
// a path smoothed over sigma samples (Gaussian), carried on past either end by reflecting it through its end point, so an end that walks keeps its speed
function smoothPath(v, sig) {
  const n = v.length, K = Math.ceil(3 * sig), at = (i) => (i < 0 ? 2 * v[0] - v[Math.min(n - 1, -i)] : i > n - 1 ? 2 * v[n - 1] - v[Math.max(0, 2 * (n - 1) - i)] : v[i]);
  return Array.from({ length: n }, (_, j) => { let s = 0, ws = 0; for (let i = -K; i <= K; i++) { const g = Math.exp(-0.5 * (i / sig) ** 2); s += g * at(j + i); ws += g; } return s / ws; });
}
// the share (0..1) of a move at progress u (0..1) that still walks: at its start (stop, turn) or its end (start)
function walkShareOf(def) { const [wa, wb] = def.walking; return (u) => (wa === 0 ? 1 - edge(wb * 0.6, wb * 1.4, u) : edge(wa * 0.85, Math.min(1, wa * 1.15), u)); }

// the feet held where they land, the walk blended in and out, the arms kept out of the clothes
function finishMove(m) {
  const { T, w, frames, n, dt, mirror, opts, rowAt } = m;
  const sideOf = (side) => (mirror ? 1 - side : side);            // the capture's foot this rig foot takes its contacts from
  const lerpRow = (arr, f) => { const i = Math.max(0, Math.min(arr.length - 2, Math.floor(f))), a = Math.max(0, Math.min(1, f - i)); return [arr[i], arr[i + 1], a]; };
  const at = (arr, f) => { const [p, q, a] = lerpRow(arr, f); return p * (1 - a) + q * a; };
  // ball locks: where the capture's ball is still (under 0.06 m/s: mid-stance to push-off, and a pivot), in poses, per foot; the heel's rocker before it is
  // left as captured (its heel pivot rolls 1 to 2 cm itself)
  const locks = [0, 1].map((side) => { const sp = T.ballSpeed[sideOf(side)], out = []; let on = null;
    for (let j = 0; j < n; j++) { const still = at(sp, rowAt(j)) < 0.06; if (still && on === null) on = j; if ((!still || j === n - 1) && on !== null) { const b = still ? j : j - 1; if (b - on >= Math.round(0.05 / dt)) out.push({ a: on, b }); on = null; } }
    return out; });
  // a planted foot keeps the warp it had as its lock began (the warp turns the body, not a foot on the floor, which only the capture's own pivot turns),
  // to within PIVOT of the body's (a start turned well round: there the foot pivots on its ball, the lock holding the ball); in the air it comes round to
  // the body's: each foot turned about its ankle by what it holds back, before anything is anchored
  const wv = m.wv, FOOT = [15, 19], TOE = [16, 20], PIVOT = (25 * Math.PI) / 180;
  for (const side of [0, 1]) {
    const list = locks[side];
    for (let j = 0; j < n; j++) {
      const L = list.find((l) => j >= l.a && j <= l.b);
      let held = wv[j];
      // (a lock's foot leaves with the turn it ended on, its pivot included: L.held)
      if (L) { held = Math.max(wv[j] - PIVOT, Math.min(wv[j] + PIVOT, wv[L.a])); if (j === L.b) L.held = held; }
      else { const prev = list.filter((l) => l.b < j).at(-1), next = list.find((l) => l.a > j); if (prev) { const end = next ? next.a : n - 1, k = ease((j - prev.b) / Math.max(1, end - prev.b)); held = prev.held + ((next ? wv[next.a] : wv[j]) - prev.held) * k; } }
      const d = held - wv[j];
      if (Math.abs(d) < 1e-6) continue;
      const p = frames[j], c = Math.cos(d), sn = Math.sin(d), f = FOOT[side], t = TOE[side];
      for (const b of [f, t]) { const o = b * 9; for (let k = 0; k < 3; k++) { const a = p.W[o + k], z = p.W[o + 6 + k]; p.W[o + k] = c * a + sn * z; p.W[o + 6 + k] = -sn * a + c * z; } }
      const dj = w.Dj[t], o = f * 9; p.P[t * 3] = p.W[o] * dj[0] + p.W[o + 1] * dj[1] + p.W[o + 2] * dj[2] + p.P[f * 3]; p.P[t * 3 + 1] = p.W[o + 3] * dj[0] + p.W[o + 4] * dj[1] + p.W[o + 5] * dj[2] + p.P[f * 3 + 1]; p.P[t * 3 + 2] = p.W[o + 6] * dj[0] + p.W[o + 7] * dj[1] + p.W[o + 8] * dj[2] + p.P[f * 3 + 2];
    }
  }
  const ball = (side, j) => { const p = frames[j]; return pointOf(p.W, p.P, w.sole[side][2]); };
  // each foot's horizontal correction: through a lock, the ball held at its anchor; out of a lock, what it carried at release turning into what the next
  // lock needs as it begins (nothing: the swing lands where the re-laid step puts it), or after the last, fading. An anchor is where the ball lands,
  // except the first lock's when the move begins with that foot down (`feet`: the idle's, a start; `entry.anchor`: the walk's planted ball, a stop or a
  // turn: held there from the move's first pose), and the last lock's when the move must leave the feet somewhere (`endFeet`: a sit-down's first stance)
  const corr = [0, 1].map(() => new Float64Array(n * 2)), early = Math.round(0.35 / dt);
  for (const side of [0, 1]) {
    const C = corr[side], list = locks[side];
    const given = opts.feet ? opts.feet[side] : opts.entry?.anchor && opts.entry.anchor[0] === side ? opts.entry.anchor.slice(1) : null, final = opts.endFeet?.[side] ?? null;
    let carry = [0, 0], from = 0;
    for (let i = 0; i <= list.length; i++) {
      const L = list[i], until = L ? L.a : n;
      const target = !L ? null : i === 0 && given && L.a <= early ? given : i === list.length - 1 && final ? final : null;
      const b0 = L ? ball(side, L.a) : null, need = target ? [target[0] - b0[0], target[1] - b0[2]] : [0, 0];
      if (i === 0 && target && target === given) carry = need;
      for (let j = from; j < until; j++) {
        const k = i === list.length && i > 0 ? Math.max(0, 1 - ease((j - from) / Math.max(1, Math.round(0.4 / dt)))) : 1 - ease((j - from) / Math.max(1, until - from));
        C[2 * j] = carry[0] * k + need[0] * (1 - k); C[2 * j + 1] = carry[1] * k + need[1] * (1 - k);
      }
      if (!L) break;
      const anchor = [b0[0] + need[0], b0[2] + need[1]];
      L.anchor = anchor;
      for (let j = L.a; j <= L.b; j++) { const b = ball(side, j); C[2 * j] = anchor[0] - b[0]; C[2 * j + 1] = anchor[1] - b[2]; }
      carry = [C[2 * L.b], C[2 * L.b + 1]]; from = L.b + 1;
    }
  }
  // on the floor: 1 while the capture has the foot down (any sole point still), eased over 0.08 s either side
  const contact = [0, 1].map((side) => { const pl = T.planted[sideOf(side)], c = Float64Array.from({ length: n }, (_, j) => at(pl, rowAt(j))), r = Math.max(1, Math.round(0.08 / dt)), out = new Float64Array(n);
    for (let j = 0; j < n; j++) { let s = 0, ws = 0; for (let i = -r; i <= r; i++) { const g = 1 - Math.abs(i) / (r + 1); s += g * c[Math.max(0, Math.min(n - 1, j + i))]; ws += g; } out[j] = s / ws; }
    return out; });
  for (let j = 0; j < n; j++) {
    const p = frames[j]; w.Wm.set(p.W); w.Pm.set(p.P);
    // legs to the targets: the ankle moved by the foot's correction (the foot keeps its world rotation), on the floor while planted and only ever lifted
    // out of it in the air; never straighter than 10 degrees past the captured knee; a leg that cannot reach lowers the pelvis first (smoothly)
    const reach = [0, 0], ank = [0, 1].map((side) => {
      const hip = (side ? 17 : 13) * 3, k = hip + 3, a = hip + 6, [l1, l2] = w.legs[side], h = lowest(w, side), c = contact[side][j], dy = -c * h + (1 - c) * Math.max(0, -h);
      const ux = w.Pm[k] - w.Pm[hip], uy = w.Pm[k + 1] - w.Pm[hip + 1], uz = w.Pm[k + 2] - w.Pm[hip + 2], vx = w.Pm[a] - w.Pm[k], vy = w.Pm[a + 1] - w.Pm[k + 1], vz = w.Pm[a + 2] - w.Pm[k + 2];
      const knee = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (l1 * l2)))), bent = Math.max(0.12, knee - KNEE_SLACK);
      reach[side] = Math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * Math.cos(bent));
      return [w.Pm[a] + corr[side][2 * j], w.Pm[a + 1] + dy, w.Pm[a + 2] + corr[side][2 * j + 1]];
    });
    let short = 0;
    for (const side of [0, 1]) { const hip = (side ? 17 : 13) * 3; short = Math.max(short, contact[side][j] * (Math.hypot(ank[side][0] - w.Pm[hip], ank[side][1] - w.Pm[hip + 1], ank[side][2] - w.Pm[hip + 2]) - reach[side])); }
    const drop = 0.004 * Math.log1p(Math.exp(Math.min(40, short / 0.004)));
    if (drop > 1e-7) for (let b = 0; b < B; b++) w.Pm[b * 3 + 1] -= drop;
    for (const side of [0, 1]) legToPole(w, side, ank[side], reach[side]);
    p.W.set(w.Wm); p.P.set(w.Pm);
  }
  const stances = locks;
  // the walk blended in over the first quarter second (stop, turn) or out over the last (start), the feet kept honest (motion.js between)
  const sc = { J: w.J, Dj: w.Dj, legs: w.legs, sole: w.sole, Wm: new Float64Array(B * 9), Pm: new Float64Array(B * 3) }, blendN = Math.max(1, Math.round(0.25 / dt));
  if (opts.entry?.pose) for (let j = 0; j <= blendN && j < n; j++) { between(sc, opts.entry.pose(j * dt), frames[j], ease(j / blendN)); frames[j].W.set(sc.Wm); frames[j].P.set(sc.Pm); }
  if (opts.exit?.pose) for (let j = 0; j <= blendN && j < n; j++) { const i = n - 1 - j; between(sc, opts.exit.pose(-j * dt), frames[i], ease(j / blendN)); frames[i].W.set(sc.Wm); frames[i].P.set(sc.Pm); }
  // the arms out of the clothes: the keep-out searched every fourth pose (with the idle's and the walk's clearance), its openings blended between (a
  // pose's own search costs a fraction of a ms)
  if (opts.keepout) {
    const step = 4, open = [];
    for (let j = 0; j < n; j += step) { w.Wm.set(frames[j].W); w.Pm.set(frames[j].P); opts.keepout.apply(w.bones, { phase: 0, sway: 1, extraClearance: 0.012, step: 4 }); open.push([...opts.keepout.openings].map((v) => v ?? 0)); }
    for (let j = 0; j < n; j++) {
      const u = j / step, i = Math.min(open.length - 1, Math.floor(u)), k = Math.min(open.length - 1, i + 1), a = u - i;
      w.Wm.set(frames[j].W); w.Pm.set(frames[j].P);
      opts.keepout.apply(w.bones, { phase: 0, sway: 1, opening: [0, 1].map((s) => open[i][s] * (1 - a) + open[k][s] * a + Math.PI / 360) });
      frames[j].W.set(w.Wm); frames[j].P.set(w.Pm);
    }
  }
  const last = frames[n - 1], end = { x: m.tx[n - 1], z: m.tz[n - 1], yaw: m.ty[n - 1], feet: [16, 20].map((b) => [last.P[b * 3], last.P[b * 3 + 2]]) };
  const traj = (t) => { const u = Math.max(0, Math.min(n - 1, t / dt)), i = Math.min(n - 2, Math.floor(u)), a = u - i; return [m.tx[i] + (m.tx[i + 1] - m.tx[i]) * a, m.tz[i] + (m.tz[i + 1] - m.tz[i]) * a, m.ty[i] + (m.ty[i + 1] - m.ty[i]) * a]; };
  return { kind: m.kind, mirror, duration: m.duration, dt, n, frames, traj, tx: m.tx, tz: m.tz, ty: m.ty, end, stances, version: MOVES_VERSION };
}
