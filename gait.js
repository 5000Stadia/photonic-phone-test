// Photonic R6 prep: a walker from data. Pure functions, no three.js, no DOM.
//
//   const P = params(recipe, basis)   // once per person (and again when their state changes)
//   const a = pose(P, phase)          // joint angles at a phase (cycles; 0 = left heel strike)
//   const j = fk(P, a, x)             // joint positions in metres (x forward, y left, z up), root advanced to x
//
// The basis (data/gait-basis.json) is fitted by tools/gait/fit.py from Van Criekinge et al. 2023 (CC0): per joint angle
// a mean plus three harmonics (four at the ankle), linear axes for age, sex, height and BMI, and six eigenwalkers.
// Speed comes from dynamic similarity: Froude number from the fitted timing model, stride/leg = a * Fr^e (fitted:
// e = 0.315, Alexander's 0.3), cadence = speed / stride. The phase advances by `f * dt` in the caller's clock (seconds).
// Children (no open data) use the Sutherland/Hof table for timing and a hand-set child/toddler layer; stoop, load and
// mood are hand-set pose layers on top of the fitted walk, as design/research/r6-gait.md recommends.

const G = 9.81;
const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerpTable = (tab, x) => {           // tab: [[x, y], ...] ascending
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return tab[tab.length - 1][1];
};
// small deterministic RNG (mulberry32) and normal draws, so the same seed is the same walk
function rng(seed) {
  let a = (typeof seed === "number" ? seed : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703)) >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, n: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}

// ---------- bodies (stand-in proportions until R5's body owns them) ----------
// Heights: WHO/CDC medians, approximate [mem]; adults lose ~1 cm per decade after 50.
const HEIGHT = { m: [[1, .76], [2, .87], [3, .96], [4, 1.03], [5, 1.10], [6, 1.16], [8, 1.28], [10, 1.38], [12, 1.49], [14, 1.64], [16, 1.73], [18, 1.76], [50, 1.76], [90, 1.71]],
                 f: [[1, .74], [2, .86], [3, .95], [4, 1.02], [5, 1.09], [6, 1.15], [8, 1.27], [10, 1.38], [12, 1.51], [14, 1.60], [16, 1.62], [18, 1.63], [50, 1.63], [90, 1.58]] };
// Leg length (hip joint to floor) / height: Sutherland/Hof table's L over WHO height for children; 0.53 adult.
const LEG_RATIO = [[1, .42], [3, .46], [7, .50], [14, .52], [18, .53]];
const HEAD_RATIO = [[1, .25], [3, .20], [7, .165], [14, .14], [18, .13]];   // chin to crown / height
// Sutherland/Hof normalised speed and stride/leg by age, divided by the adult row: the child maturation factors.
const NORM_SPEED = [[1, .36], [1.5, .38], [2, .37], [2.5, .40], [3, .41], [3.5, .46], [4, .45], [5, .47], [7, .47], [18, .46]];
const NORM_STRIDE = [[1, 1.36], [1.5, 1.39], [2, 1.41], [2.5, 1.49], [3, 1.51], [3.5, 1.59], [4, 1.58], [5, 1.58], [18, 1.57]];

export function body(age, sex, height) {
  const s = sex > 0 ? "m" : "f";
  const H = height || lerpTable(HEIGHT[s], age);
  const leg = lerpTable(LEG_RATIO, age) * H;           // hip joint height
  const ankleH = 0.039 * H;
  const thigh = (leg - ankleH) * 0.5, shank = (leg - ankleH) * 0.5;
  const head = lerpTable(HEAD_RATIO, age) * H;
  const neck = 0.035 * H;
  const shoulderH = H - head - neck * 0.6;
  const trunk = shoulderH - leg;                        // hip joint centre to shoulder line
  const arm = lerpTable([[1, .38], [3, .40], [10, .43], [18, .44]], age) * H;
  return {
    H, leg, ankleH, thigh, shank, head, neck, trunk,
    upperArm: arm * 0.42, foreArm: arm * 0.33, hand: arm * 0.25,
    hipW: H * lerpTable([[1, .13], [7, .11], [18, .10]], age) * (sex > 0 ? 0.97 : 1.05),
    shoulderW: H * (sex > 0 ? 0.225 : 0.205) * lerpTable([[1, .95], [10, .95], [18, 1]], age),
    foot: H * lerpTable([[1, .17], [3, .16], [18, .152]], age),
  };
}

// ---------- the basis ----------
export function loadBasis(json) {
  const B = { ...json, axes: json.axes, dofs: json.dofs };
  B.index = Object.fromEntries(json.dofs.map((d, i) => [d, i]));
  return B;
}
function coefsFor(B, traits, k) {
  const c = new Float64Array(B.n_coef);
  for (let p = 0; p < traits.length; p++) { const row = B.axes[p]; for (let j = 0; j < c.length; j++) c[j] += traits[p] * row[j]; }
  for (let i = 0; i < k.length; i++) { const d = B.eigen.dirs[i], s = B.eigen.sd[i] * k[i]; for (let j = 0; j < c.length; j++) c[j] += s * d[j]; }
  return c;
}

// ---------- the hand-set layers: offsets to a DoF's mean and scales of its swing ----------
// Each is {dof: [offsetDeg, swingScale]}; sides "L"/"R" apply to one limb only.
const CHILD = {            // weight 1 at age 1 fading to 0 at 7: wider base, toes out, arms a little out, more sway
  hip_add: [-3, 1], foot_prog: [-5, 1], shoulder_abd: [6, 0.9], shoulder_flex: [0, 0.8], elbow_flex: [5, 0.8],
  pelvis_obl: [0, 1.3], trans_lat: [0, 1.5], spine_lat: [0, 1.3], knee_flex: [3, 1], hip_flex: [3, 1],
};
const TODDLER = {          // weight 1 at age 1 fading to 0 at 3.5 (Hallemans 2006; high guard, flexed stance, flat foot)
  hip_add: [-6, 1], foot_prog: [-6, 1], hip_flex: [8, 0.9], knee_flex: [10, 0.7], ankle_dors: [3, 0.5],
  shoulder_abd: [35, 0.3], shoulder_flex: [12, 0.25], shoulder_rot: [-20, 0.3], elbow_flex: [55, 0.3],
  spine_flex: [6, 1], trans_lat: [0, 1.6], pelvis_obl: [0, 1.4], pelvis_rot: [0, 1.4], trans_up: [0, 0.7],
};
const STOOP = {            // per degree of thoracic flexion (kyphosis); the head comes up to look ahead
  spine_flex: [1, 1], neck_flex: [-0.75, 1], shoulder_flex: [-0.55, 1], knee_flex: [0.12, 1], hip_flex: [0.15, 1],
};
const LOADS = {
  none: { layer: {}, fr: 1, stride: 1 },
  box: {                   // a box held in front with both arms: arms locked, trunk leans back (§3.4)
    layer: { shoulder_flex: [22, 0.05], shoulder_abd: [6, 0.2], elbow_flex: [48, 0.05], spine_flex: [-6, 1], neck_flex: [4, 1], spine_rot: [0, 0.6], pelvis_rot: [0, 0.8] },
    fr: 0.88, stride: 0.95,
  },
  bag: {                   // a heavy bag in the right hand: that arm hangs straight and out, the trunk leans left
    layer: { spine_lat: [-5, 1] }, R: { shoulder_abd: [10, 0.1], shoulder_flex: [-2, 0.1], elbow_flex: [-30, 0.15] },
    L: { shoulder_abd: [6, 1.2] }, fr: 0.9, stride: 0.96,
  },
};
const MOODS = {
  neutral: { layer: {}, fr: 1 },
  tired: { layer: { spine_flex: [8, 1], neck_flex: [10, 1], shoulder_flex: [-3, 0.55], elbow_flex: [-8, 0.55], trans_up: [0, 0.7], spine_lat: [0, 1.3], pelvis_rot: [0, 0.8], knee_flex: [3, 1] }, fr: 0.62 },
  brisk: { layer: { spine_flex: [3, 1], neck_flex: [-3, 1], shoulder_flex: [0, 1.35], elbow_flex: [18, 1.4], spine_rot: [0, 1.2], pelvis_rot: [0, 1.2] }, fr: 1.45 },
};

function addLayer(off, scl, layer, w = 1) {
  for (const [d, [o, s]] of Object.entries(layer)) { off[d] = (off[d] || 0) + w * o; scl[d] = (scl[d] ?? 1) * (1 + w * (s - 1)); }
}

// ---------- params: recipe -> one person's walk ----------
// recipe: { age, sex: +1 male / -1 female (continuous allowed), height (m), bmi, mood: neutral|tired|brisk,
//           load: none|box|bag, seed, stoop (deg, or omit to draw), personal (0..1 eigenwalker scale), speed (Fr factor) }
export function params(recipe, B) {
  const r = rng(recipe.seed ?? 1);
  const age = recipe.age ?? 35;
  const sex = recipe.sex ?? 1;
  const bd = body(age, sex, recipe.height);
  const L = bd.leg;
  // traits for the data axes: adult pattern below 21 (children differ by scaling plus the child layers)
  const aAge = clamp(age, 21, 92);
  const st = B.trait_stats;
  const [hm, hs] = sex > 0 ? st.height_m : st.height_f;
  const hz = recipe.heightZ ?? (age >= 18 ? clamp(((bd.H * 1000) - hm) / hs, -3, 3) : 0);
  const bmiz = clamp(((recipe.bmi ?? st.bmi[0]) - st.bmi[0]) / st.bmi[1], -3, 3);
  const sexMotion = recipe.sexMotion ?? clamp(sex + 0.25 * r.n(), -1.6, 1.6);    // overlapping, modest: sex reads weakly from motion
  const traits = [1, (aAge - 50) / 10, Math.max(0, aAge - 60) / 10, sexMotion, hz, bmiz];
  const personal = recipe.personal ?? 1;
  const k = recipe.k ?? B.eigen.sd.map(() => personal * clamp(r.n(), -2.2, 2.2));
  const c = coefsFor(B, traits, k);

  // layers
  const off = {}, scl = {}, side = { L: [{}, {}], R: [{}, {}] };
  const wChild = clamp((7 - age) / 6, 0, 1), wTod = clamp((3.5 - age) / 2.5, 0, 1);
  addLayer(off, scl, CHILD, wChild);
  addLayer(off, scl, TODDLER, wTod);
  // stoop: drawn per person, P ~ 0 below 60 rising to ~0.45 by 90 (Kado 2007: 20-40% of older adults)
  const stoopDraw = r.u(), stoopSize = r.u();
  const pStoop = clamp((age - 60) / 30, 0, 1) * 0.45;
  const stoop = recipe.stoop ?? (stoopDraw < pStoop ? 10 + 18 * stoopSize * clamp((age - 55) / 30, 0.3, 1) : 0);
  addLayer(off, scl, STOOP, stoop);
  for (const d in STOOP) scl[d] = scl[d] ?? 1;            // STOOP swing factors are 1; offsets scale with degrees
  const load = LOADS[recipe.load || "none"], mood = MOODS[recipe.mood || "neutral"];
  addLayer(off, scl, load.layer); addLayer(off, scl, mood.layer);
  for (const s of ["L", "R"]) if (load[s]) addLayer(side[s][0], side[s][1], load[s]);

  // timing: Froude from the fitted model (adult axes), child maturation, mood, load, a personal residual
  const T = B.timing;
  const dot = (w) => w.reduce((a, wi, i) => a + wi * traits[i], 0);
  const matFr = age < 3.5 ? (lerpTable(NORM_SPEED, age) / 0.46) ** 2 : 1;
  const matStride = age < 3.5 ? lerpTable(NORM_STRIDE, age) / 1.57 : 1;
  const frRes = 0.5 * T.log_fr_res_sd * clamp(r.n(), -2, 2);
  const fr = Math.exp(dot(T.log_fr) + frRes) * matFr * mood.fr * load.fr * (recipe.speed ?? 1);
  const [a0, e, b1, c1] = T.lam_vs_fr.coef;
  const lam = Math.exp(a0 + e * Math.log(fr) + b1 * (aAge - 50) / 10 + c1 * Math.max(0, aAge - 60) / 10) * matStride * load.stride;
  const v = Math.sqrt(fr * G * L), stride = lam * L, f = v / stride;
  const duty = clamp(dot(T.duty) + 0.04 * wTod + 0.04 * (mood === MOODS.tired), 0.55, 0.7);

  // head: data's neck pitch carries a per-marker-set offset; make the population's mean head level
  const iN = B.layout.neck_flex[0], iS = B.layout.spine_flex[0], iP = B.layout.pelvis_tilt[0];
  const neck0 = B.axes[0][iN] + B.axes[0][iS] + B.axes[0][iP];
  const P = { recipe, age, sex, body: bd, L, c, off, scl, side, traits, k, stoop, fr, lam, v, stride, f, duty, neck0, legGain: 1, B };
  calibrate(P);
  if (recipe.root !== "fitted") rootFromFeet(P);
  return P;
}

// ---------- pose: params, phase -> joint angles (degrees; trans in metres) ----------
function ev(P, d, ph, s) {
  const B = P.B, [o, K] = B.layout[d], c = P.c;
  let dyn = 0;
  const w = 2 * Math.PI * ph;
  for (let k = 1; k <= K; k++) dyn += c[o + 2 * k - 1] * Math.cos(k * w) + c[o + 2 * k] * Math.sin(k * w);
  let sc = P.scl[d] ?? 1, of = P.off[d] || 0;
  if (s) { const [so, ss] = P.side[s]; of += so[d] || 0; sc *= ss[d] ?? 1; }
  if (d === "hip_flex" || d === "knee_flex") sc *= P.legGain;
  return c[o] + of + sc * dyn;
}
const LIMB = ["hip_flex", "hip_add", "hip_rot", "knee_flex", "ankle_dors", "foot_prog", "shoulder_flex", "shoulder_abd", "shoulder_rot", "elbow_flex"];

export function pose(P, phase) {
  const p = phase - Math.floor(phase);
  const g = (d) => ev(P, d, p);
  const out = {
    phase: p,
    pelvis: [g("pelvis_tilt"), g("pelvis_obl"), g("pelvis_rot")],     // anterior tilt, left up, left forward
    spine: [g("spine_flex"), g("spine_lat"), g("spine_rot")],
    neck: [g("neck_flex") - P.neck0, g("neck_lat"), g("neck_rot")],
    trans: P.root ? P.root.map((cs) => series(cs, p)) : [g("trans_fwd") * P.L / 100, g("trans_lat") * P.L / 100, g("trans_up") * P.L / 100],
  };
  for (const [s, ps] of [["L", p], ["R", (p + 0.5) % 1]]) {
    const o = {};
    for (const d of LIMB) o[d] = ev(P, d, ps, s);
    out[s] = o;
  }
  return out;
}

function series(c, p) {
  let v = c[0];
  const w = 2 * Math.PI * p;
  for (let k = 1; 2 * k < c.length; k++) v += c[2 * k - 1] * Math.cos(k * w) + c[2 * k] * Math.sin(k * w);
  return v;
}

// ---------- forward kinematics (for drawing and for measuring feet) ----------
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mm = (A, B2) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B2[j] + A[3 * i + 1] * B2[3 + j] + A[3 * i + 2] * B2[6 + j]; return C; };
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const add = (a, b, k = 1) => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];

// Joint positions. rootX: forward distance travelled; h0 sets the hip height (calibrated so stance feet touch z=0).
// Conventions (checked against Plug-in Gait segment axes, see tools/gait/fit.py): pelvis Ry(+tilt) is anterior tilt;
// hip Ry(-flex) puts the knee forward; knee Ry(+flex); ankle Ry(-dors); thorax relative to pelvis rolls and yaws
// against the pelvis (the data's spine lateral/rotation correlate +1.0/+0.9 with pelvis obliquity/rotation).
export function fk(P, a, rootX = 0, opt = {}) {
  const b = P.body, d = D2R;
  const [tf, tl, tu] = a.trans;
  const root = [rootX + tf, tl, (P.h0 ?? b.leg) + tu];
  const Rp = mm(mm(Rz(-a.pelvis[2] * d), Rx(a.pelvis[1] * d)), Ry(a.pelvis[0] * d));
  // the data's pelvis tilt includes the ASIS-PSIS slope (~10 deg anterior when standing upright); remove it for the frame
  const Rpel = mm(Rp, Ry(-P.c[P.B.layout.pelvis_tilt[0]] * d));
  const J = { root };
  const Rthx = mm(Rp, mm(mm(Rz(a.spine[2] * d), Rx(-a.spine[1] * d)), Ry(a.spine[0] * d)));
  const Rhead = mm(Rthx, mm(mm(Rz(a.neck[2] * d), Rx(-a.neck[1] * d)), Ry(a.neck[0] * d)));
  // the thorax pitch above includes the pelvis's ASIS offset: the data's thorax angle is pelvis tilt + spine flexion
  // two spine segments: the lumbar carries half the data's spine motion, the thorax the rest plus any stoop (kyphosis)
  const lf = 0.5 * (a.spine[0] - (P.stoop || 0));
  const Rlum = mm(Rp, mm(mm(Rz(0.5 * a.spine[2] * d), Rx(-0.5 * a.spine[1] * d)), Ry(lf * d)));
  J.waist = add(root, mv(Rlum, [0, 0, 0.42 * b.trunk]));
  J.chest = add(J.waist, mv(Rthx, [0, 0, 0.58 * b.trunk]));
  J.neck = add(J.chest, mv(Rhead, [0, 0, b.neck]));
  J.headC = add(J.neck, mv(Rhead, [0.01 * b.H, 0, b.head * 0.45]));
  J.rot = { thx: Rthx, head: Rhead, pel: Rpel };
  for (const s of ["L", "R"]) {
    const m = s === "L" ? 1 : -1, q = a[s];
    const hip = add(root, mv(Rpel, [0, m * b.hipW / 2, 0]));
    let Rth = mm(Rp, mm(mm(Ry(-q.hip_flex * d), Rx(-m * q.hip_add * d)), Rz(0)));
    const knee = add(hip, mv(Rth, [0, 0, -b.thigh]));
    const Rsh = mm(Rth, Ry(q.knee_flex * d));
    const ankle = add(knee, mv(Rsh, [0, 0, -b.shank]));
    // the foot: pitch from the shank and ankle, yaw from the measured foot progression (absolute, toe-out negative)
    const Rf0 = mm(Rsh, Ry(-q.ankle_dors * d));
    const fwd = mv(Rf0, [1, 0, 0]);
    const yaw = -m * q.foot_prog * d, h = Math.hypot(fwd[0], fwd[1]);
    const fdir = [h * Math.cos(yaw), h * Math.sin(yaw), fwd[2]];
    const down = mv(Rf0, [0, 0, -1]);
    const heel = add(add(ankle, down, b.ankleH), fdir, -0.24 * b.foot);
    const ball = add(heel, fdir, 0.72 * b.foot);
    // the toes hinge at the ball: they never point below the floor plane of the ball, as when bent in push-off
    let toe = add(heel, fdir, b.foot);
    const tl = 0.28 * b.foot, tz = toe[2] - ball[2];
    if (tz < 0) { const hx = fdir[0], hy = fdir[1], hn = Math.hypot(hx, hy) || 1; toe = [ball[0] + hx / hn * tl, ball[1] + hy / hn * tl, ball[2]]; }
    const sho = add(J.chest, mv(Rthx, [0, m * b.shoulderW / 2, -0.02 * b.H]));
    const Rua = mm(Rthx, mm(Ry(-q.shoulder_flex * d), Rx(m * q.shoulder_abd * d)));
    const elb = add(sho, mv(Rua, [0, 0, -b.upperArm]));
    const Rfa = mm(Rua, Ry(-q.elbow_flex * d));
    const wri = add(elb, mv(Rfa, [0, 0, -b.foreArm]));
    const hand = add(wri, mv(Rfa, [0, 0, -b.hand * 0.6]));
    J[s] = { hip, knee, ankle, heel, ball, toe, sho, elb, wri, hand };
  }
  if (opt.plant) plantFeet(P, a, J, rootX);
  return J;
}

// ---------- stride calibration and foot measures ----------
// In stance the contact point (heel, then ball) is still in the world, so relative to the pelvis it travels back at -v.
// Over stance (duty * T) the root advances duty * stride (+ the fitted surge). The leg's sagittal swing is scaled
// (legGain) until the kinematic excursion equals that, so speed = stride x cadence holds for these limbs.
function contactX(P, ph, s) {
  const a = pose(P, ph), J = fk(P, a, 0);
  return { heel: J[s].heel, ball: J[s].ball, root: J.root };
}
function excursion(P) {
  const s0 = contactX(P, 0, "L"), s1 = contactX(P, P.duty, "L");
  // heel at strike to ball at toe-off, both pelvis-relative, plus the heel-to-ball distance on the floor
  return (s0.heel[0] - s0.root[0]) - (s1.ball[0] - s1.root[0]) + 0.72 * P.body.foot
         + (s1.root[0] - s0.root[0]);           // the fitted surge between the two instants
}
function calibrate(P) {
  const want = P.duty * P.stride;
  let g0 = 1, e0 = excursion(P) - want;
  let g1 = 1.15; P.legGain = g1; let e1 = excursion(P) - want;
  for (let i = 0; i < 6 && Math.abs(e1) > 1e-4; i++) {
    const g2 = g1 - e1 * (g1 - g0) / (e1 - e0);
    g0 = g1; e0 = e1; g1 = clamp(g2, 0.4, 2.2); P.legGain = g1; e1 = excursion(P) - want;
  }
  // hip height: put the stance contact points on the floor on average over stance
  P.h0 = P.body.leg;
  let sum = 0, n = 0;
  for (let i = 0; i <= 20; i++) {
    const ph = P.duty * i / 20, J = fk(P, pose(P, ph), 0);
    sum += Math.min(J.L.heel[2], J.L.ball[2]); n++;
  }
  P.h0 -= sum / n;
}

// The root (pelvis) path from the feet. The fitted pelvis translation is close but not exact for these limbs, so the
// stance feet would skate. Instead: walk three cycles, pin each stance foot's contact point (heel, then ball, switching
// where the ball becomes the lower) where it lands, put the root where the pinned foot says, and blend between the two
// feet over double support. The last cycle, less its steady advance, becomes a periodic series (12 harmonics) so pose()
// stays a pure function of phase. Speed stays v; the stride is the one these legs make, and cadence = v / stride.
// toes bend at the ball (metatarsophalangeal joint), so the stance contacts are the heel and the ball
const lowest = (j) => (j.heel[2] <= j.ball[2] ? "heel" : "ball");
function rootFromFeet(P) {
  const n = 192, cycles = 3, ds = Math.max(0.02, P.duty - 0.5);
  P.root = [[0], [0], [0]]; P.h0 = 0;
  const pin = { L: null, R: null }, pt = { L: null, R: null }, rec = { L: {}, R: {} };
  let root = [0, 0, P.body.leg];
  const path = [];
  for (let i = 0; i <= cycles * n; i++) {
    const p = i / n, a = pose(P, p), J = fk(P, a, 0);
    let sum = [0, 0, 0], wsum = 0;
    for (const s of ["L", "R"]) {
      const sp = ((s === "L" ? p : p + 0.5) % 1 + 1) % 1;
      if (sp >= P.duty) { pin[s] = null; continue; }
      const j = J[s], q = lowest(j);
      if (!pin[s] || pt[s] !== q) {
        pin[s] = [root[0] + j[q][0], root[1] + j[q][1], 0]; pt[s] = q;
        if (Math.floor(p - sp + 1e-9) === cycles - 1) rec[s][q] = pin[s];   // the pins of the steady cycle
      }
      const est = [pin[s][0] - j[q][0], pin[s][1] - j[q][1], -j[q][2]];
      // the landing foot takes over within the first 30% of double support: a trailing foot about to lift hides a
      // slide far better than a landing heel does
      const t = clamp(sp / (0.3 * ds), 0, 1), w = t * t * (3 - 2 * t) + 1e-6;
      sum = add(sum, est, w); wsum += w;
    }
    if (wsum > 0) root = sum.map((x) => x / wsum);
    path.push(root);
  }
  const last = path.slice((cycles - 1) * n);
  const adv = [last[n][0] - last[0][0], last[n][1] - last[0][1]];
  const D = [[], [], []];
  for (let i = 0; i < n; i++) {
    const p = i / n;
    D[0].push(last[i][0] - adv[0] * p); D[1].push(last[i][1] - adv[1] * p); D[2].push(last[i][2]);
  }
  const K = 12;
  P.root = D.map((x) => {
    const m = x.reduce((a, b) => a + b, 0) / n, c = [m];
    for (let k = 1; k <= K; k++) {
      let ca = 0, sa = 0;
      for (let i = 0; i < n; i++) { ca += x[i] * Math.cos(2 * Math.PI * k * i / n); sa += x[i] * Math.sin(2 * Math.PI * k * i / n); }
      c.push(2 * ca / n, 2 * sa / n);
    }
    return c;
  });
  const mx = P.root[0][0], my = P.root[1][0];
  P.root[0][0] = 0; P.root[1][0] = 0;
  P.strideTarget = P.stride;
  P.stride = Math.hypot(adv[0], adv[1]);
  P.f = P.v / P.stride;
  P.drift = adv[1];
  // pins relative to the start of their stride, for the pure planting below (runtime root = stride * phase + series)
  P.pins = {};
  for (const s of ["L", "R"]) {
    P.pins[s] = {};
    for (const q in rec[s]) P.pins[s][q] = [rec[s][q][0] - mx, rec[s][q][1] - my];   // mx carries the sim's (cycles-1) strides
  }
}

// Planting (optional, every tier can afford it): each stance foot's contact point is held at its pin from the
// precomputed path; the ankle moves by the error and hip-knee-ankle is re-solved as a two-bone chain. The error is
// blended out over early swing. Pure: rootX must be stride * (unwrapped phase), as when phase = f t and rootX = v t.
function plantDelta(P, J, s, sp, rootX) {
  const j = J[s], q = lowest(j), pn = P.pins?.[s]?.[q];
  if (!pn) return [0, 0, 0];
  const base = rootX - P.stride * sp - (s === "R" ? 0.5 * P.stride : 0);
  return [pn[0] + base - j[q][0], pn[1] - j[q][1], -j[q][2]];
}
function plantFeet(P, a, J, rootX) {
  J.plantDelta = 0;
  for (const s of ["L", "R"]) {
    const sp = s === "L" ? a.phase : (a.phase + 0.5) % 1;
    let delta;
    if (sp < P.duty) delta = plantDelta(P, J, s, sp, rootX);
    else {
      const w = clamp(1 - (sp - P.duty) / 0.12, 0, 1);
      if (w <= 0) continue;
      const back = sp - P.duty + 1e-4, ph0 = a.phase - back, x0 = rootX - P.stride * back;
      const J0 = fk(P, pose(P, ph0), x0), sp0 = s === "L" ? ((ph0 % 1) + 1) % 1 : (((ph0 + 0.5) % 1) + 1) % 1;
      delta = plantDelta(P, J0, s, sp0, x0).map((x) => x * w * w * (3 - 2 * w));
    }
    J.plantDelta = Math.max(J.plantDelta, Math.hypot(...delta));
    if (delta.every((x) => Math.abs(x) < 1e-6)) continue;
    const j = J[s];
    const target = add(j.ankle, delta);
    const L1 = P.body.thigh, L2 = P.body.shank;
    const hv = [target[0] - j.hip[0], target[1] - j.hip[1], target[2] - j.hip[2]];
    const hl = Math.hypot(...hv), dist = clamp(hl, Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    const u = hv.map((x) => x / hl);
    // keep the knee in the plane of hip, old knee and target
    const kOld = [j.knee[0] - j.hip[0], j.knee[1] - j.hip[1], j.knee[2] - j.hip[2]];
    const kd = kOld[0] * u[0] + kOld[1] * u[1] + kOld[2] * u[2];
    let nn = [kOld[0] - kd * u[0], kOld[1] - kd * u[1], kOld[2] - kd * u[2]];
    const nl = Math.hypot(...nn) || 1; nn = nn.map((x) => x / nl);
    const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), up = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    const knee = [j.hip[0] + u[0] * along + nn[0] * up, j.hip[1] + u[1] * along + nn[1] * up, j.hip[2] + u[2] * along + nn[2] * up];
    const ankle = [j.hip[0] + u[0] * dist, j.hip[1] + u[1] * dist, j.hip[2] + u[2] * dist];
    const sh = [ankle[0] - j.ankle[0], ankle[1] - j.ankle[1], ankle[2] - j.ankle[2]];
    j.knee = knee; j.ankle = ankle; j.heel = add(j.heel, sh); j.ball = add(j.ball, sh); j.toe = add(j.toe, sh);
    j.reach = hl > L1 + L2 - 1e-4;     // the leg could not reach: a residual remains
  }
}

// Foot sliding in stance, measured in the world. The root moves at v plus its periodic path. The contact point is the
// lower of heel and ball; its horizontal travel while it stays the contact point and is on the floor (under 10 mm)
// is the slide (mm per step).
// Also reports the contact point's height range in stance (float or sink, mm).
export function footSlide(P, { steps = 200, plant = false } = {}) {
  const T = 1 / P.f;
  const out = {};
  let corr = 0;
  for (const s of ["L", "R"]) out[s] = { slide: 0, zmin: 1e9, zmax: -1e9 };
  let prev = null;
  for (let i = 0; i <= 2 * steps; i++) {
    const ph = i / steps;                          // two cycles; the first warms the pins
    const a = pose(P, ph), J = fk(P, a, P.v * ph * T, plant ? { plant: true } : {});
    if (i > steps && plant) corr = Math.max(corr, J.plantDelta);
    const cur = {};
    for (const s of ["L", "R"]) {
      const sp = s === "L" ? ph % 1 : (ph + 0.5) % 1, j = J[s];
      const pt = lowest(j);
      cur[s] = { st: sp < P.duty && sp > 0.002 && j[pt][2] < 0.01, pt, p: j[pt] };
      if (i > steps && cur[s].st) {
        const o = out[s];
        o.zmin = Math.min(o.zmin, j[pt][2]); o.zmax = Math.max(o.zmax, j[pt][2]);
        if (prev && prev[s].st && prev[s].pt === pt) o.slide += Math.hypot(j[pt][0] - prev[s].p[0], j[pt][1] - prev[s].p[1]);
      }
    }
    prev = cur;
  }
  const mm1 = (x) => Math.round(x * 10000) / 10;
  return { slide_mm_per_step: mm1((out.L.slide + out.R.slide) / 2), sink_mm: mm1(Math.min(out.L.zmin, out.R.zmin)), float_mm: mm1(Math.max(out.L.zmax, out.R.zmax)),
           slide_pct_of_step: Math.round(1000 * (out.L.slide + out.R.slide) / 2 / (P.stride / 2)) / 10, max_ankle_correction_mm: mm1(corr) };
}

// A held-out real subject (data/heldout.json) as params: its own mean cycle (six harmonics), its own speed, stride and
// duty, drawn through the same body, root and FK as the model. Also its twin: the model from its traits, plus its own
// eigenwalker coefficients (the residual projected onto the six eigenwalkers): what "a person's walk" costs in numbers.
const dftc = (x, K) => {
  const n = x.length, c = [x.reduce((a, b) => a + b, 0) / n];
  for (let k = 1; k <= K; k++) {
    let ca = 0, sa = 0;
    for (let i = 0; i < n; i++) { ca += x[i] * Math.cos(2 * Math.PI * k * i / n); sa += x[i] * Math.sin(2 * Math.PI * k * i / n); }
    c.push(2 * ca / n, 2 * sa / n);
  }
  return c;
};
export function realParams(subj, B, extra = {}) {
  const K = 6, layout = {}, c = [];
  for (const d of B.dofs) { layout[d] = [c.length, K]; c.push(...dftc(subj.cycle[d], K)); }
  const L = lerpTable(LEG_RATIO, subj.age) * subj.height / 1000;
  const fr = subj.v * subj.v / (G * L), lam = subj.stride / L;
  const zero = c.map(() => 0);
  const Br = { ...B, layout, n_coef: c.length, axes: [c, zero, zero, zero, zero, zero], eigen: { dirs: [], sd: [] },
    timing: { ...B.timing, log_fr: [Math.log(fr), 0, 0, 0, 0, 0], duty: [subj.duty, 0, 0, 0, 0, 0], log_fr_res_sd: 0, lam_vs_fr: { coef: [Math.log(lam), 0, 0, 0] } } };
  // the head-level reference comes from the subject's own mean (head-marker placement differs per subject)
  return params({ age: subj.age, sex: subj.sex, height: subj.height / 1000, seed: 1, personal: 0, sexMotion: 0, heightZ: 0, ...extra }, Br);
}
export function twinParams(subj, B, { eigen = true, ...extra } = {}) {
  const bmi = subj.mass / (subj.height / 1000) ** 2;
  const base = { age: subj.age, sex: subj.sex, height: subj.height / 1000, bmi, seed: 1, personal: 0, sexMotion: subj.sex, ...extra };
  let k = B.eigen.sd.map(() => 0);
  if (eigen) {
    // residual of the subject's own coefficients (model layout) from the traits prediction, onto the eigenwalkers
    const own = [];
    for (const d of B.dofs) own.push(...dftc(subj.cycle[d], B.layout[d][1]));
    const t = subj.traits, pred = new Float64Array(B.n_coef);
    for (let p = 0; p < t.length; p++) for (let j = 0; j < pred.length; j++) pred[j] += t[p] * B.axes[p][j];
    k = B.eigen.dirs.map((dir, i) => dir.reduce((a, dj, j) => a + dj * (own[j] - pred[j]), 0) / B.eigen.sd[i]);
    base.sexMotion = t[3]; base.heightZ = t[4];
  }
  return params({ ...base, k }, B);
}

export function summary(P) {
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { age: P.age, H: r3(P.body.H), L: r3(P.L), fr: r3(P.fr), speed: r3(P.v), stride: r3(P.stride), cadence_steps_min: Math.round(P.f * 120), duty: r3(P.duty), legGain: r3(P.legGain), stoop: Math.round(P.stoop) };
}
