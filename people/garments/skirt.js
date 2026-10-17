// The skirt over the bum roll (R5; design/research/r5-dress-1660.md): a loose, stateless garment whose vertices are a function of the bones' pose,
// the gait phase and two inputs, a floor height and a seat height. It follows the pose and is never simulated, so it can run per vertex for
// 300 people (the TSL version is the next step; this file is the plain-JS reference it is written against: bones in, vertices out, only
// + - * / sqrt min max sin cos, no state, no allocation in the loop).
//
// The skirt is a tube of K rings along a path through the wearer: the waist (on the pelvis), the hips (between the two hip joints), the knees, the ankles,
// and straight down to the hem. Each ring lies in the plane the path crosses it at, the planes below the knee turned to gravity (horizontal). A ring has
// its design radii (the profile: the waist, the bum roll that stands the skirt out from the hips, the bell to the hem), and a floor: it is never closer to
// its centre than the wearer's legs there (each leg is capsules, their sections in the ring's plane found exactly, ellipses for oblique legs), so the legs
// stay inside whatever the pose. The hem is held above the floor, and where a seat is given the skirt is held above it. Sway rides on top, from the gait phase.
//
//   skirtSpec(near, cut)             what the skirt needs of one wearer, from their body at rest: the profile, the leg radii (computed once, ~ 10 ms)
//   skirtPose(spec, bones, ctx, out) the vertices (Float32Array 3 per vertex, world) for the bones' pose; bones = { W (B x 9, row-major world rotations),
//                                    P (B x 3, posed joint positions) } as the walker leaves them (walk.js poseInto: w.Wm, w.Pm)
//   ctx = { phase, sway (0..1, 0 when not walking), floor (m, default 0), seat (m, 0 for none) }
//   skirtFootprint(spec)             the horizontal radius the skirt asks of the floor round its wearer, to step aside for
import { capsuleVolume } from "../keepout.js";
import { wearer as readWearer, torsoTable, landmarks, planeSegments, trianglesWhere, binByHeight, BI } from "./wearer.js";

export const RINGS = 16, AROUND = 40;
// Breeches on a seat ease out by this share of the height, as far as the knees are bent (flex, 0 standing to 1 at a right angle), at the
// rings round the hip and the upper thigh (full to ring 5, none from the knee band, ring 9, down): as the hip bends a thigh comes to lie
// across those rings, is no longer counted in their floor, and would show through their front. It was 3.5% of the height on every ring
// at once when a sit-down began: a barrel round each thigh that popped out at the sit-down's start and in at the rise's end. 2.5% here is
// the least that keeps the legs of the gentleman and the workman (a man, a labourer, a stout man) inside through all the CMU frames
// (tools/people/sitting-clothes.mjs; the stout workman keeps a 2.4 mm touch at the knee seated).
export const SEAT_EASE = 0.025, SEAT_EASE_FROM = 1;
export const seatEaseRing = (k) => 1 - smooth(R_HIP + SEAT_EASE_FROM, R_KNEE, k);
export const seatEase = (H, flex, k) => SEAT_EASE * H * flex * seatEaseRing(k);
// Fitted breeches (a cut with `fit`, spec.fitted) ease out behind instead, as far as the tube's own hip is bent, seated or not: cut to the body standing and striding, they
// stood clear of the thigh's front seated (the legs came out nowhere there with no seat ease at all), but the buttock, pulled out as the hip bends, came 19 mm out behind at
// the start of 113_15's sit-down, 27 seated and 72 at its deepest bend (the hero; tools: clothes-ease.mjs). The ease is this share of the height for each unit of
// (1 - cos) of the hip's bend past SEAT_BACK_FROM (about 32 degrees, past a stride's), on the rings of the seat ease, the back half only (cos^2 of the column's angle there):
// 15 mm seated on the hero, 80 at the deepest bend, nothing in a walk. The crowd's uniform seat ease (all round, by the knees' bend) stood the seated lap 5 cm off
// the thigh's top and the waistband 4 cm off the belly, out through the doublet's skirts.
export const SEAT_BACK = 0.043, SEAT_BACK_FROM = 0.15;
// (the waistband's top rings, under the doublet's skirts, ease out only past 0.4, about 53 degrees: seated they stay inside the doublet; in the sit-down's deep bend the lower
// back comes out behind the doublet's skirts, and the waistband goes out over it. From 0.55 the lower back showed 19 mm early in the sit-down, from 0.3 the waistband came 5 mm
// through the doublet seated.)
export const seatBackFrom = (k) => SEAT_BACK_FROM + (0.4 - SEAT_BACK_FROM) * (1 - smooth(0.5, 2, k));
export const seatBack = (H, hip, k, cs) => (cs < 0 ? SEAT_BACK * H * Math.max(0, hip - seatBackFrom(k)) * seatEaseRing(k) * cs * cs : 0);
// The fitted breeches' knee band turns from the thigh toward the shin as the knee bends (rings 13 to 15, these shares of the way), and its last ring sits on the shin,
// `drop` below the knee: the band is tied round the leg under the knee, so seated it hugs the top of the shin and the cloth goes over the knee. Along the thigh, as the
// crowd's cut has it, the tube ran on past a bent knee and ended in an open pipe in front of it (the stocking's knee seen inside it), and the kneecap came 26 mm out
// of the band's front in a stride.
export const KNEE_TURN = [0.3, 0.6, 0.95];
const AROUND_DEFAULT = AROUND, BRIDGE_GAIN = 0.7;                 // 640 vertices
export const R_WAIST = 0, R_HIP = 4, R_KNEE = 9, R_ANKLE = 14, R_HEM = 15;
export const SKIRT_V = RINGS * AROUND;

export const SKIRTS = {
  gentlewoman: {
    waistSpine: 0.7, ease: 0.012,                       // m at 1.62 m: the waistband over the base layer
    roll: { side: 0.050, back: 0.075, front: 0.020 },     // the bum roll's standoff beyond the hips (H)
    hem: { side: 0.36, front: 0.38, back: 0.45 },         // hem radii, in units of the waist's height above the floor
    bell: 0.9,                         // how the radius grows from the roll to the hem (an exponent of the way down)
    hemClear: 0.012,                   // hem above the floor (H): "ending a little above the floor"
    legClear: 0.007,                   // the skirt's floor round the legs (H)
    sway: 0.012,                       // gentle sway at the hem (H)
    bend: 0.15,                        // half-width (H) of the window that averages the path's direction: how gently a bend is spread over the rings
  },
  // a child's and a girl's skirt: no roll, to the ankle
  girl: { waistSpine: 0.7, belly: 3.5, ease: 0.012, roll: { side: 0.035, back: 0.040, front: 0.020 }, hem: { side: 0.34, front: 0.36, back: 0.40 }, bell: 0.65, hemClear: 0.026, legClear: 0.008, sway: 0.012, bend: 0.20 },
};
SKIRTS.small = { ...SKIRTS.girl, roll: { side: 0.02, back: 0.025, front: 0.01 }, hem: { side: 0.32, front: 0.34, back: 0.36 }, hemClear: 0.022, bend: 0.25 };

// The petticoat breeches of the gentleman (r5-dress-1660.md, V&A O356780: 58 cm long, waist 84 cm, the legs "very full", gathered at the knee; the gentry's fashion of 1660-65), DIVIDED: one tube for each
// leg (`legs`), each the skirt's machinery with a shorter path of its own: from the waist, down through the hip, a share (`kneeShare`) of the way along its own thigh, to its own knee and a little (`drop`, H)
// below it. The path's anchors are the skirt's (the waist, the hips, the knees, the ankles, the floor: rings 0, 4, 9, 14, 15) moved onto the leg: the first two a share (`lateral`) of the way from the
// middle of the pelvis to this leg's hip joint, the rest on the leg itself, so the two tubes part with the legs in a stride and overlap across the middle above them, where each one's side reach
// is more than its own half: together they are the waistband, the seat and the fork. A tube holds its own thigh and shin by the floor of the ring (the other leg's capsules are not its business).
// The profile: full at the hips (`roll`: the standoff beyond the hips), drawn in toward the knee through a bag (`bag`, H) to a gathered band (`hemEase`, H, the last two rings: the ribbon). No train,
// and a little sway: breeches are sewn at the waist and gathered at the knee.
SKIRTS.breeches = {
  waistSpine: 0.7, belly: 2.5, ease: 0.024, roll: { side: 0.034, back: 0.050, front: 0.030 }, hemEase: 0.012, bag: 0.022,
  hemClear: 0.012, legClear: 0.007, sway: 0.004, bend: 0.18, trainTuck: 0,
  short: 1, kneeShare: 0.5, drop: 0.014, lateral: [0.15, 0.5], legs: true,
};

// The working dress's two loose pieces (R5 working dress; r5-dress-1660.md: the working woman's skirt "ankle length, no roll", Hollar's country woman, the working man's closed breeches).
// workwoman: the stateless skirt with no bum roll (the hips only a little eased, the waist drawn in by the apron strings), ankle length (the hem about 7 cm above the floor at 1.62 m: the shoe and
// the stocking show) and hanging fairly straight, with no train: the hem 0.24 of the waist's height at the sides and 0.25 at the back, instead of the gentlewoman's 0.36 and 0.45. The girl's and the small child's (workgirl, worksmall) are the gentlewoman's girl's and child's with the same narrower hem, shorter.
SKIRTS.workwoman = {
  waistSpine: 0.7, ease: 0.012, roll: { side: 0.012, back: 0.020, front: 0.008 }, hem: { side: 0.24, front: 0.24, back: 0.25 }, bell: 0.9,
  hemClear: 0.050, legClear: 0.007, sway: 0.014, bend: 0.15,
};
SKIRTS.workgirl = { ...SKIRTS.girl, hem: { side: 0.25, front: 0.25, back: 0.26 }, bell: 0.8, hemClear: 0.045 };
SKIRTS.worksmall = { ...SKIRTS.small, hem: { side: 0.30, front: 0.30, back: 0.31 }, bell: 0.8, hemClear: 0.040 };
// closed: the working man's breeches, the gentleman's divided machinery with the petticoat's fullness taken out: a close fit with a little ease at the seat, ending just below the knee (the band's rings are painted a shade darker, outfit.painted.band) and gathered close to it (no ribbon, no bag).
SKIRTS.closed = { ...SKIRTS.breeches, bellyAbs: 0.060, ease: 0.034, roll: { side: 0.025, back: 0.050, front: 0.020 }, hemEase: 0.004, bag: 0.002, drop: 0.032 };
// closed-fit: the same breeches cut to the wearer (fitRings), tried first on the hero's page (garments/outfit.js setFit); `exact`: there is no table for it, its spec is the wearer's own
// (tables.js). The ease, a share of the height at ring k (0 the waistband, 4 the hips, 9 mid-thigh, 14 the knee band), front, back and sides: close at the waistband (gathered into
// it over the shirt), the seat's fullness behind (3 cm on a man of 1.78 m), the thigh's 2 to 2.5, a little more above the knee where the gathered cloth blouses over the band, and
// the band close round the leg (0.6 cm).
// The waistband's back (rings 0 to 2) is under the doublet's skirts, which follow the body there more closely than half-ellipses can (the small of the back is hollow): it
// is cut 0.2% of the height inside the body's reach there, so the doublet stays outside it (at 0.45% out it came through the doublet's back, 12 mm walking and 25 seated); the
// body under it is not drawn. Its front keeps its ease: a round belly comes out below the doublet's hem, and the waistband must hold it.
SKIRTS["closed-fit"] = { ...SKIRTS.closed, exact: true, fit: {
  front: [[0, 0.0045], [3, 0.0045], [5, 0.009], [8, 0.011], [12, 0.013], [14, 0.0035], [15, 0.0035]],
  back: [[0, -0.002], [2, -0.002], [3.5, 0.006], [5, 0.017], [8, 0.014], [12, 0.008], [14, 0.0035], [15, 0.0035]],
  side: [[0, 0.002], [2, 0.002], [3.5, 0.004], [5, 0.009], [8, 0.010], [12, 0.010], [14, 0.0035], [15, 0.0035]],          // (less at the sides above the knee: seated the knees read as balls from the front)
} };

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- what a wearer gives the skirt, once ----------------------------------------------------------------------------------------
const SAMPLES = [0.0, 0.25, 0.5, 0.75, 1.0];     // leg radii sampled at these shares along the thigh and the shin
function legRadii(w, side) {
  const S = side > 0 ? "L" : "R", J = w.J, mid = 0.0123 * w.height;
  const tris = trianglesWhere((v) => w.leg[v] && (side > 0 ? w.pos[3 * v] > -mid : w.pos[3 * v] < mid)), out = { thigh: [], shin: [] };
  for (const [name, a, b] of [["thigh", J[BI["thigh" + S]], J[BI["shin" + S]]], ["shin", J[BI["shin" + S]], J[BI["foot" + S]]]]) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d), n = d.map((x) => x / l);
    const e1 = (() => { const t = [1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]], tl = Math.hypot(...t); return t.map((x) => x / tl); })();
    const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    for (const f of SAMPLES) {
      // a section near the end of a segment reaches over the joint: sample at the share, take the bigger of the section's reach from the axis
      const o = [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f];
      let rad = 0;
      for (const df of [-0.03, 0, 0.03]) {
        const oo = [o[0] + n[0] * l * df, o[1] + n[1] * l * df, o[2] + n[2] * l * df];
        const seg = planeSegments(w.pos, tris, oo, n, e1, e2);
        // the leg's own section only: the points within 0.3 m of the axis, near the axis side (the other leg is 0.2 m away)
        for (let i = 0; i < seg.length; i += 2) { const r = Math.hypot(seg[i], seg[i + 1]); if (r < 0.2 * w.height && r > rad) rad = r; }
      }
      out[name].push(rad);
    }
  }
  return out;
}

/** The skirt of a wearer (shape.js buildNear's result `near`), from their body at rest. `cutName`: SKIRTS key. The spec is plain numbers: the ring radii
 *  (the design profile), the leg radii, and the anchors' rest offsets, so it could be a few uniforms per person. */
export function skirtSpec(near, cutName = "gentlewoman", leg = 0) {
  const c = SKIRTS[cutName], w = readWearer(near), H = near.height, J = w.J, u = H / 1.62;
  const table = torsoTable(w, J[BI.hips][1] - 0.2 * H, J[BI.neck][1], 0.004 * u, 24);        // the skirt reads only the waist and the sides, front and back: a coarse table
  const lm = landmarks(w, table, u);
  // the hips and buttocks: the silhouette of everything but the arms there (the torso table leaves leg-weighted vertices out)
  const hipTris = binByHeight(w.pos, trianglesWhere((v) => !w.arm[v]));
  const hipY = 0.5 * (J[BI.hips][1] + J[BI.thighL][1]) + 0.012 * H, hseg = planeSegments(w.pos, hipTris, [0, hipY, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  let x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < hseg.length; i += 2) { if (hseg[i] > x1) x1 = hseg[i]; if (hseg[i + 1] < z0) z0 = hseg[i + 1]; if (hseg[i + 1] > z1) z1 = hseg[i + 1]; }
  const waistC = table.centre(lm.waistY), A0 = [waistC[0], lm.waistY, waistC[1]];
  const A1 = [0, 0.5 * (J[BI.thighL][1] + J[BI.thighR][1]), 0.5 * (J[BI.thighL][2] + J[BI.thighR][2])];
  // radii of the design rings (side, front, back) from their centres, rest
  const wr = { s: 0.5 * (table.at(Math.PI / 2, lm.waistY) + table.at(-Math.PI / 2, lm.waistY)), f: table.at(0, lm.waistY), b: table.at(Math.PI, lm.waistY) };
  const hr = { s: x1, f: z1 - A1[2], b: A1[2] - z0 };
  const e = c.ease * u, roll = c.roll;
  const roll4 = { s: hr.s + roll.side * H, f: hr.f + roll.front * H, b: hr.b + roll.back * H };
  const ws = lm.waistY, hem = c.hem ? { s: c.hem.side * ws * 1.0, f: c.hem.front * ws, b: c.hem.back * ws } : null;
  const rs = new Float32Array(RINGS), rf = new Float32Array(RINGS), rb = new Float32Array(RINGS), radii = legRadii(w, 1);
  // divided breeches (c.short): each ring's radii are measured from its tube's own centre, which is `shiftAt` of the half-width between the hip joints toward its leg (a0 and a1 are moved by `lateral`, the rest
  // are on the leg): the outer reach from the middle is the body's (the waist's, the hips' with their roll, the knee's), the front and back are the body's, and the inner reach goes past the middle
  const dHip = 0.5 * Math.abs(J[BI.thighL][0] - J[BI.thighR][0]), shiftAt = (k) => (k <= R_HIP ? lerp(c.lateral[0], c.lateral[1], k / R_HIP) : k <= R_KNEE ? lerp(c.lateral[1], 1, (k - R_HIP) / (R_KNEE - R_HIP)) : 1);
  const rKnee = Math.max(radii.thigh[4], radii.shin[0]) + c.hemEase * H || 0, X0 = wr.s + e, X4 = roll4.s;
  for (let k = 0; k < RINGS; k++) {
    if (c.short) {
      const kk = Math.min(k, R_KNEE + 5), t = Math.min(1, Math.max(0, (kk - R_HIP) / (R_KNEE + 5 - R_HIP))), bag = c.bag * H * Math.sin(Math.PI * Math.pow(t, 0.9));
      let X, F, B;
      if (k <= R_HIP) { const q = Math.pow(Math.sin((k / R_HIP) * Math.PI / 2), 1.5); X = lerp(X0, X4, q); F = lerp(wr.f + e, roll4.f, q); B = lerp(wr.b + e, roll4.b, q); }
      else { X = lerp(X4, dHip + rKnee, t) + bag; F = lerp(roll4.f, rKnee, t) + bag; B = lerp(roll4.b, rKnee, t) + bag; }
      rs[k] = Math.max(X - shiftAt(k) * dHip, 0.5 * rKnee); rf[k] = F; rb[k] = B;
      continue;
    }
    let a, b, t;
    if (k <= R_HIP) { a = { s: wr.s + e, f: wr.f + e, b: wr.b + e }; b = roll4; t = Math.pow(Math.sin((k / R_HIP) * Math.PI / 2), 1.5); }
    else { a = roll4; b = hem; t = Math.pow((k - R_HIP) / (R_HEM - R_HIP), c.bell); }
    rs[k] = lerp(a.s, Math.max(b.s, a.s), t); rf[k] = lerp(a.f, Math.max(b.f, a.f), t); rb[k] = lerp(a.b, Math.max(b.b, a.b), t);
  }
  // the belly and the hips between the waist and the hip ring: the design radii are never inside the body there, whatever its shape (a toddler's belly swells below the waist)
  for (let k = 1; k < R_HIP; k++) {
    const t = k / R_HIP, y = lerp(lm.waistY, A1[1], t), cz = lerp(A0[2], A1[2], t), seg = planeSegments(w.pos, hipTris, [0, y, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    let sx = 0, sz0 = Infinity, sz1 = -Infinity;
    for (let i = 0; i < seg.length; i += 2) { if (seg[i] > sx) sx = seg[i]; if (seg[i + 1] < sz0) sz0 = seg[i + 1]; if (seg[i + 1] > sz1) sz1 = seg[i + 1]; }
    // (bellyAbs, in H: the room beyond the body at the hip ring, growing from the waist: close breeches under a doublet that covers the waist keep their waistband inside it)
    if (sx > 0) { const eb = c.bellyAbs !== undefined ? c.bellyAbs * H * Math.pow(k / R_HIP, 1.5) : (c.belly ?? 1.5) * e; rs[k] = Math.max(rs[k], sx + eb - (c.short ? shiftAt(k) * dHip : 0)); rf[k] = Math.max(rf[k], sz1 - cz + eb); rb[k] = Math.max(rb[k], cz - sz0 + eb); }          // the belly with more room: it moves against the pelvis's ring when the trunk bends
  }
  // the legs
  const foot = (() => {   // the foot as a capsule from the ankle to the toe tip: its radius
    let r = 0; const a = J[BI.footL], b = w.tip.toeL, d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dl = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let v = 0; v < w.nBody; v++) {
      let isFoot = 0; for (let k = 0; k < 4; k++) { const bb = near.skinIndex[v * 4 + k]; if (bb === BI.footL || bb === BI.toeL) isFoot += near.skinWeight[v * 4 + k]; }
      if (isFoot < 0.5) continue;
      const px = w.pos[3 * v] - a[0], py = w.pos[3 * v + 1] - a[1], pz = w.pos[3 * v + 2] - a[2], t = Math.max(0, Math.min(1, (px * d[0] + py * d[1] + pz * d[2]) / dl));
      r = Math.max(r, Math.hypot(px - d[0] * t, py - d[1] * t, pz - d[2] * t));
    }
    return r;
  })();
  const sp = { rs, rf, rb, thigh: radii.thigh, shin: radii.shin, foot, waistRest: A0, hipsJoint: J[BI.hips], spineJoint: J[BI.spine], toeJoint: [J[BI.toeL], J[BI.toeR]], tipToe: [w.tip.toeL, w.tip.toeR], waistY: ws };
  if (c.fit) fitRings(sp, w, c, H, cutName, near);
  return unpackSpec(packSpec(sp, 1 / H), H, cutName, leg);
}

// ---- fitted breeches (round 3 of the hero study; SKIRTS[cut].fit) -------------------------------------------------------------------------------------------------------------
// Kabe, 2026-10-16: "The clothes still look like colorful trashbags." The closed breeches stood off his thigh 7 to 8 cm at the back of the seat and thigh (about 47 cm of ease
// round, against a leg of about 55), 4 cm round the knee band, because each ring's design radius ran straight from the hips' reach (the buttocks', round the whole ring) down to
// the knee's, and the leg capsules the rings rest on are round about the femur at the leg's widest reach (14.5 cm at the top of the thigh, the buttock's). Here each ring is cut to
// this wearer: the section of the drawn body and its base layer in the ring's own plane at rest, the nearest crossing of each column's ray from the ring's centre, plus the cut's
// ease there (a share of the height: front, back and sides, ring by ring); the smallest half-ellipses (front and back, the sides shared) that hold every column's target are the
// ring's radii; and the capsules are held to the leg's narrowest reach, so they no longer set the shape. The fullness of a period pair (V&A O110590: "very full", gathered into the
// waistband and at the knee) is left to the seat and above the knee band, and to the gathers the shading draws.
let FIT_TRIS = null;
// the drawn body and its base layer skinned to a pose (the wearer's pos layout: the body's vertices, then the layer's)
function skinAll(near, J, bones, out) {
  const { W, P } = bones, n = out.length / 3, si = near.skinIndex, sw = near.skinWeight, src = near.position;
  for (let v = 0; v < n; v++) {
    const px = src[3 * v], py = src[3 * v + 1], pz = src[3 * v + 2]; let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) { const wt = sw[4 * v + k]; if (!wt) continue; const b = si[4 * v + k], m = b * 9, j = J[b], dx = px - j[0], dy = py - j[1], dz = pz - j[2];
      x += wt * (W[m] * dx + W[m + 1] * dy + W[m + 2] * dz + P[3 * b]); y += wt * (W[m + 3] * dx + W[m + 4] * dy + W[m + 5] * dz + P[3 * b + 1]); z += wt * (W[m + 6] * dx + W[m + 7] * dy + W[m + 8] * dz + P[3 * b + 2]); }
    out[3 * v] = x; out[3 * v + 1] = y; out[3 * v + 2] = z;
  }
  return out;
}
const REST = (() => { const W = new Float64Array(21 * 9); for (let b = 0; b < 21; b++) W.set([1, 0, 0, 0, 1, 0, 0, 0, 1], b * 9); return W; })();
/** The ease a fitted cut asks at ring k (a fraction, 0 at the waist ring to 15 at the knee band) and column angle th (0 the front, pi the back), in units of the height. */
export function fitEase(f, k, th) {
  const at = (pts) => { if (k <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (k <= pts[i][0]) { const [k0, a] = pts[i - 1], [k1, b] = pts[i], t = (k - k0) / (k1 - k0); return a + (b - a) * t * t * (3 - 2 * t); } return pts[pts.length - 1][1]; };
  const c = Math.cos(th), s = Math.sin(th), wf = Math.max(0, c) ** 2, wb = Math.max(0, -c) ** 2, ws = s * s;
  return (wf * at(f.front) + wb * at(f.back) + ws * at(f.side)) / (wf + wb + ws);
}
// the rest pose with the left leg swung at the hip (deg, forward positive) and bent at the knee: the stride's reach of the thigh and buttock in the rings' own frames
function legPose(J, hip, knee) {
  const W = Float64Array.from(REST), P = new Float64Array(21 * 3); for (let b = 0; b < 21; b++) P.set(J[b], b * 3);
  const rx = (deg) => { const a = (-deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }, mul = (A, B) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return o; };
  const Wt = rx(hip), Ws = mul(Wt, rx(-knee)), at = (Wm, b, a) => [0, 1, 2].map((r) => Wm[r * 3] * (J[b][0] - J[a][0]) + Wm[r * 3 + 1] * (J[b][1] - J[a][1]) + Wm[r * 3 + 2] * (J[b][2] - J[a][2]) + P[a * 3 + r]);
  W.set(Wt, BI.thighL * 9); W.set(Ws, BI.shinL * 9); W.set(Ws, BI.footL * 9); W.set(Ws, BI.toeL * 9);
  P.set(at(Wt, BI.shinL, BI.thighL), BI.shinL * 3); P.set(at(Ws, BI.footL, BI.shinL), BI.footL * 3); P.set(at(Ws, BI.toeL, BI.footL), BI.toeL * 3);
  return { W, P };
}
function fitRings(sp, w, c, H, cutName, near) {
  const J = w.J, f = c.fit;
  const spec = unpackSpec(packSpec(sp, 1 / H), H, cutName, 1);
  FIT_TRIS ??= trianglesWhere((v) => !w.arm[v]);
  // the nearest crossing of the ray from (0, 0) along (x, y) in the plane's coordinates, among the segments (4 numbers each)
  const cross = (seg, x, y) => { let best = Infinity; for (let i = 0; i < seg.length; i += 4) { const ax = seg[i], ay = seg[i + 1], bx = seg[i + 2] - ax, by = seg[i + 3] - ay, den = x * by - y * bx; if (Math.abs(den) < 1e-12) continue; const sR = (ax * by - ay * bx) / den, t = (ax * y - ay * x) / den; if (sR > 1e-4 && t >= 0 && t <= 1 && sR < best) best = sR; } return best; };
  // the body's reach along each ring's columns, the most of: standing, and the stride's two ends (the thigh 30 degrees forward with the knee bent 25, and 15 back): the
  // buttock's fold moves with the hip, and a ring cut to the standing body alone let it out 14 mm walking. Each pose's body is skinned (the body and its base layer).
  const reach = new Float64Array(RINGS * AROUND).fill(NaN), pos = new Float32Array(w.pos.length);
  for (const [hip, knee] of [[0, 0], [30, 25], [-15, 5]]) {
    const bones = hip || knee ? legPose(J, hip, knee) : { W: REST, P: (() => { const P = new Float64Array(63); for (let b = 0; b < 21; b++) P.set(J[b], b * 3); return P; })() };
    const pp = hip || knee ? skinAll(near, J, bones, pos) : w.pos;
    ringFrames(spec, bones, { floor: 0, phase: 0, sway: 0 });
    for (let k = 0; k < RINGS; k++) {
      const o = [ringC[3 * k], ringC[3 * k + 1], ringC[3 * k + 2]], n = [ringN[3 * k], ringN[3 * k + 1], ringN[3 * k + 2]], fw = [ringF[3 * k], ringF[3 * k + 1], ringF[3 * k + 2]];
      const l = [fw[1] * n[2] - fw[2] * n[1], fw[2] * n[0] - fw[0] * n[2], fw[0] * n[1] - fw[1] * n[0]], seg = planeSegments(pp, FIT_TRIS, o, n, l, fw);
      // a tube reaches across the middle of the body only as far as it overlaps the other (3 cm on a man of 1.78 m): the ray toward the other side is cut there, not at the far hip
      // (the middle: the pelvis's own, x = 0, in every pose here, for only the left leg moves)
      for (let j = 0; j < AROUND; j++) {
        const th = (j / AROUND) * 2 * Math.PI, sn = Math.sin(th), cs = Math.cos(th), dx = sn * l[0] + cs * fw[0], toMid = dx * Math.sign(o[0]) < -1e-3 ? Math.abs(o[0] / dx) + 0.017 * H : Infinity;
        const r = Math.min(cross(seg, sn, cs), toMid), q = k * AROUND + j;
        if (Number.isFinite(r) && !(reach[q] >= r)) reach[q] = r;
      }
    }
  }
  const T = new Float64Array(AROUND);
  for (let k = 0; k < RINGS; k++) {
    let ok = 0;
    for (let j = 0; j < AROUND; j++) { const r = reach[k * AROUND + j], th = (j / AROUND) * 2 * Math.PI; T[j] = Number.isFinite(r) ? r + fitEase(f, k, th) * H : NaN; if (Number.isFinite(r)) ok++; }
    if (ok < AROUND * 0.75) continue;          // (a ring whose centre is not inside the body keeps the profile's radii)
    // a column whose ray ran out past the leg (through a gap to another part of the body) asks no more than half again the ring's middling reach
    const fin = Array.from(T).filter(Number.isFinite).sort((x, y) => x - y), cap = 1.5 * fin[fin.length >> 1];
    for (let j = 0; j < AROUND; j++) if (T[j] > cap) T[j] = cap;
    // the smallest half-ellipses holding every target: the sides first (a little over the widest sideways reach, so no column asks an endless front or back), then each half
    let rs = 0; for (let j = 0; j < AROUND; j++) if (Number.isFinite(T[j])) rs = Math.max(rs, T[j] * Math.abs(Math.sin((j / AROUND) * 2 * Math.PI)));
    rs *= 1.04; let rf = 0, rb = 0;
    for (let j = 0; j < AROUND; j++) {
      if (!Number.isFinite(T[j])) continue;
      const th = (j / AROUND) * 2 * Math.PI, sn = Math.sin(th), cs = Math.cos(th), q = 1 - (T[j] * sn / rs) ** 2, rr = Math.abs(cs) < 1e-6 ? 0 : (T[j] * Math.abs(cs)) / Math.sqrt(Math.max(q, 1e-3));
      if (cs >= 0) rf = Math.max(rf, rr); else rb = Math.max(rb, rr);
    }
    sp.rs[k] = rs; sp.rf[k] = Math.max(rf, 0.3 * rs); sp.rb[k] = Math.max(rb, 0.3 * rs);
  }
  // the legs the rings rest on: no longer the leg's widest reach (the buttock's, round the whole of the top of the thigh) but its narrowest, so the fitted radii set the shape
  for (const [key, a, b] of [["thigh", BI.thighL, BI.shinL], ["shin", BI.shinL, BI.footL]]) {
    const A = J[a], B = J[b], d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...d), u = d.map((x) => x / L);
    const e1n = [1 - u[0] * u[0], -u[0] * u[1], -u[0] * u[2]], e1l = Math.hypot(...e1n), e1 = e1n.map((x) => x / e1l), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    sp[key] = Array.from(sp[key], (r0, i) => {
      const t = [0.08, 0.25, 0.5, 0.75, 0.95][i], seg = planeSegments(w.pos, FIT_TRIS, [A[0] + d[0] * t, A[1] + d[1] * t, A[2] + d[2] * t], u, e1, e2);
      let m = Infinity; for (let q = 0; q < 24; q++) { const a2 = (q / 24) * 2 * Math.PI; m = Math.min(m, cross(seg, Math.cos(a2), Math.sin(a2))); }
      return Number.isFinite(m) ? Math.min(r0, m) : r0;
    });
  }
}

// ---- the spec as numbers ----------------------------------------------------------------------------------------------------------
// What a skirt needs of its wearer is 81 numbers (the ring radii, the leg radii, the joints it hangs from) that scale with the wearer's height, so they are tabulated at unit
// height over the four sliders (tools/people/skirt-table.mjs, spikes/makehuman/skirt.js) exactly as the far tier's coefficients are, and a person's spec is read from that
// table in a few microseconds: the exact path (skirtSpec) reads the whole body and takes 30 ms. A shader reads the same 81 numbers.
export const SPEC_CHANNELS = 3 * RINGS + 5 + 5 + 1 + 3 * 5 + 6 + 1;       // rs, rf, rb; thigh, shin; foot; waistRest, hipsJoint, spineJoint; toeJoint x2, tipToe x2; waistY
/** A spec's numbers at the height scale `k` (1 / H for unit height): Float64Array(SPEC_CHANNELS). */
export function packSpec(sp, k = 1) {
  const o = new Float64Array(SPEC_CHANNELS); let n = 0;
  const put = (a) => { for (let i = 0; i < a.length; i++) o[n++] = a[i] * k; };
  put(sp.rs); put(sp.rf); put(sp.rb); put(sp.thigh); put(sp.shin); o[n++] = sp.foot * k; put(sp.waistRest); put(sp.hipsJoint); put(sp.spineJoint); put(sp.toeJoint[0]); put(sp.toeJoint[1]); put(sp.tipToe[0]); put(sp.tipToe[1]); o[n++] = sp.waistY * k;
  return o;
}
/** The spec of a wearer of height H from its packed numbers at unit height (a table's, or packSpec's) and a cut; `leg`: 0 for a skirt, 1 or -1 for the left or right tube of divided breeches. */
export function unpackSpec(v, H, cutName = "gentlewoman", leg = 0) {
  const c = SKIRTS[cutName], u = H / 1.62; let n = 0;
  const take = (len, Ctor = Float32Array) => { const a = new Ctor(len); for (let i = 0; i < len; i++) a[i] = v[n++] * H; return a; };
  const rs = take(RINGS), rf = take(RINGS), rb = take(RINGS), thigh = take(5), shin = take(5), foot = v[n++] * H, waistRest = take(3, Array), hipsJoint = take(3, Array), spineJoint = take(3, Array);
  const toeJoint = [take(3, Array), take(3, Array)], tipToe = [take(3, Array), take(3, Array)], ws = v[n++] * H;
  return {
    cut: cutName, c, H, u, rs, rf, rb, ring: { s: rs, f: rf, b: rb }, waistRest, hipsJoint, spineJoint, toeJoint, tipToe, thigh, shin, foot,
    waistSpine: c.waistSpine ?? 0.5, trainTuck: c.trainTuck ?? 0.85, leg, short: c.short ?? 0, fitted: c.fit ? 1 : 0, kneeShare: c.kneeShare ?? 0.5, drop: (c.drop ?? 0) * H, lateral: c.lateral ?? [0, 0], fall: c.fall ?? 0.02, hemY: c.hemClear * H, legClear: c.legClear * H, sway: c.sway * H, bend: (c.bend ?? 0.075) * H, waistY: ws,
  };
}

// ---- topology ---------------------------------------------------------------------------------------------------------------------
/** The triangles of a skirt of RINGS rings of `around` columns (vertex k * around + j; the order is the one the 40-column skirt has always had). */
export function skirtIndex(around = AROUND) {
  const t = [];
  for (let k = 0; k < RINGS - 1; k++) for (let j = 0; j < around; j++) {
    const a = k * around + j, b = k * around + (j + 1) % around, c = (k + 1) * around + (j + 1) % around, d = (k + 1) * around + j;
    t.push(a, c, b, a, d, c);
  }
  return Uint16Array.from(t);
}
export const SKIRT_INDEX = skirtIndex(AROUND);
export const MAX_AROUND = 64;

// ---- the pose function --------------------------------------------------------------------------------------------------------------
// scratch, so a call allocates nothing
const PAIR = new Float64Array(RINGS), RIN = new Float64Array(RINGS * 3), RHO = new Float64Array(RINGS), ANC = new Float64Array(15), SEGD = new Float64Array(15), SEGL = new Float64Array(4), SEGS = new Float64Array(5), SEG_AT = [0, R_HIP, R_KNEE, R_ANKLE, R_HEM], ringC = new Float64Array(RINGS * 3), ringN = new Float64Array(RINGS * 3), ringF = new Float64Array(RINGS * 3);
const LIFT = new Uint8Array(RINGS * MAX_AROUND), RAW = new Float64Array(RINGS * MAX_AROUND), UD = new Float64Array(RINGS * MAX_AROUND * 3), BEST = new Float64Array(RINGS * MAX_AROUND);
const CAP = new Float64Array(6 * 8);        // per capsule: a(3), b(3), ra, rb
const CAP_A = [BI.thighL, BI.shinL, BI.thighR, BI.shinR], CAP_B = [BI.shinL, BI.footL, BI.shinR, BI.footR];
const tmp = new Float64Array(12), EX = new Float64Array(8);

const mulv = (W, b, x, y, z, o, i) => { const m = b * 9; o[i] = W[m] * x + W[m + 1] * y + W[m + 2] * z; o[i + 1] = W[m + 3] * x + W[m + 4] * y + W[m + 5] * z; o[i + 2] = W[m + 6] * x + W[m + 7] * y + W[m + 8] * z; };

/** The skirt's ring frames for a pose, into the module's scratch (ringC centres, ringN normals, ringF forward axes: RINGS x 3 each) and EX (the pelvis's flat heading hx, hz;
 *  the knees' middle a2x, a2z and the ankles' a3x, a3z): everything the skirt's rings stand on, from the bones alone. skirtPose goes on from them to the vertices; the
 *  keep-out volume (skirtVolume) needs no more. */
function ringFrames(spec, bones, ctx) {
  const { W, P } = bones, floor = ctx.floor ?? 0, phase = ctx.phase ?? 0, swayAmp = ctx.sway ?? 0;
  const hips = BI.hips, thL = BI.thighL, thR = BI.thighR, shL = BI.shinL, shR = BI.shinR, fL = BI.footL, fR = BI.footR, tL = BI.toeL, tR = BI.toeR;
  const P3 = (b, k) => P[b * 3 + k];
  // anchors: waist (on the pelvis), hips, knees, ankles (the middles of the two legs), then straight down to the hem
  const J0 = spec.hipsJoint, w0 = spec.waistRest;
  // the waist: part on the pelvis, part on the spine (cut.waistSpine), as the body's own waist is, so the skirt stays under the bodice's edge when the trunk bends
  const spine = BI.spine, Js = spec.spineJoint;
  mulv(W, hips, w0[0] - J0[0], w0[1] - J0[1], w0[2] - J0[2], tmp, 0);
  mulv(W, spine, w0[0] - Js[0], w0[1] - Js[1], w0[2] - Js[2], tmp, 3);
  const ws = spec.waistSpine, a0x = (1 - ws) * (P3(hips, 0) + tmp[0]) + ws * (P3(spine, 0) + tmp[3]), a0y = (1 - ws) * (P3(hips, 1) + tmp[1]) + ws * (P3(spine, 1) + tmp[4]), a0z = (1 - ws) * (P3(hips, 2) + tmp[2]) + ws * (P3(spine, 2) + tmp[5]);
  const a1x = 0.5 * (P3(thL, 0) + P3(thR, 0)), a1y = 0.5 * (P3(thL, 1) + P3(thR, 1)), a1z = 0.5 * (P3(thL, 2) + P3(thR, 2));
  const a2x = 0.5 * (P3(shL, 0) + P3(shR, 0)), a2y = 0.5 * (P3(shL, 1) + P3(shR, 1)), a2z = 0.5 * (P3(shL, 2) + P3(shR, 2));
  const a3x = 0.5 * (P3(fL, 0) + P3(fR, 0)), a3y = 0.5 * (P3(fL, 1) + P3(fR, 1)), a3z = 0.5 * (P3(fL, 2) + P3(fR, 2));
  const hemY = floor + spec.hemY;
  // the path's end. A skirt's anchors are the middles of the knees, the ankles and the floor. A tube of the divided breeches (spec.short, 1) is on one leg (spec.leg, 1 the left, -1 the right): its waist and
  // hip anchors are moved from the middle of the pelvis toward its hip joint by the cut's `lateral` shares, then a share of the way down its thigh, its knee, and a little below the knee (short is 0 or 1)
  const sh = spec.short, share = spec.kneeShare, ownT = spec.leg < 0 ? thR : thL, ownK = spec.leg < 0 ? shR : shL;
  const dlx = P3(ownT, 0) - a1x, dly = P3(ownT, 1) - a1y, dlz = P3(ownT, 2) - a1z, kx = P3(ownK, 0), ky = P3(ownK, 1), kz = P3(ownK, 2);
  const t0x = P3(ownT, 0), t0y = P3(ownT, 1), t0z = P3(ownT, 2);
  const sa0x = a0x + sh * spec.lateral[0] * dlx, sa0y = a0y + sh * spec.lateral[0] * dly, sa0z = a0z + sh * spec.lateral[0] * dlz;
  const sa1x = a1x + sh * spec.lateral[1] * dlx, sa1y = a1y + sh * spec.lateral[1] * dly, sa1z = a1z + sh * spec.lateral[1] * dlz;
  const b2x = lerp(a2x, t0x + (kx - t0x) * share, sh), b2y = lerp(a2y, t0y + (ky - t0y) * share, sh), b2z = lerp(a2z, t0z + (kz - t0z) * share, sh);
  const b3x = lerp(a3x, kx, sh), b3y = lerp(a3y, ky, sh), b3z = lerp(a3z, kz, sh);
  const tdl = Math.sqrt((kx - t0x) ** 2 + (ky - t0y) ** 2 + (kz - t0z) ** 2) || 1, tdx = (kx - t0x) / tdl, tdy = (ky - t0y) / tdl, tdz = (kz - t0z) / tdl;          // down the thigh
  const a4x = lerp(b3x, kx + tdx * spec.drop, sh), a4y = lerp(Math.min(a3y - 0.01 * spec.H, hemY), ky + tdy * spec.drop, sh), a4z = lerp(b3z, kz + tdz * spec.drop, sh);          // a tube goes on a little past the knee along the thigh
  // (fitted breeches: the knee band turns down the shin, KNEE_TURN; the shin's direction, the own foot from the own knee)
  const turn = spec.fitted && sh, ownF = spec.leg < 0 ? fR : fL;
  let sdx = P3(ownF, 0) - kx, sdy = P3(ownF, 1) - ky, sdz = P3(ownF, 2) - kz; const sdl = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) || 1; sdx /= sdl; sdy /= sdl; sdz /= sdl;
  // heading: the pelvis's forward axis, flat
  mulv(W, hips, 0, 0, 1, tmp, 0);
  let hx = tmp[0], hz = tmp[2]; const hl = Math.sqrt(hx * hx + hz * hz) || 1; hx /= hl; hz /= hl;
  // pelvis' own forward (for the upper rings): tilted
  const pfx = tmp[0], pfy = tmp[1], pfz = tmp[2];
  mulv(W, hips, 0, -1, 0, tmp, 0);
  const pdx = tmp[0], pdy = tmp[1], pdz = tmp[2];                  // the pelvis's down axis
  // ---- ring centres and normals. The path is the polyline through the anchors; ring k sits at its own arc length (rings 0, 4, 9, 14, 15 on the
  // anchors); its plane is perpendicular to the path's direction averaged over a window of half-width `bend` about it (a box filter along the arc), so a 90
  // degree bend (the hip when sitting) is spread over several rings and the inside of the bend never folds over itself.
  ANC[0] = sa0x; ANC[1] = sa0y; ANC[2] = sa0z; ANC[3] = sa1x; ANC[4] = sa1y; ANC[5] = sa1z; ANC[6] = b2x; ANC[7] = b2y; ANC[8] = b2z; ANC[9] = b3x; ANC[10] = b3y; ANC[11] = b3z; ANC[12] = a4x; ANC[13] = a4y; ANC[14] = a4z;
  SEGS[0] = 0;
  for (let i = 0; i < 4; i++) {
    const dx = ANC[3 * i + 3] - ANC[3 * i], dy = ANC[3 * i + 4] - ANC[3 * i + 1], dz = ANC[3 * i + 5] - ANC[3 * i + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    SEGD[3 * i] = dx / l; SEGD[3 * i + 1] = dy / l; SEGD[3 * i + 2] = dz / l; SEGL[i] = l; SEGS[i + 1] = SEGS[i] + l;
  }
  SEGD[12] = sh * tdx; SEGD[13] = lerp(-1, tdy, sh); SEGD[14] = sh * tdz;                       // past the hem anchor the path goes straight down (a tube of breeches: on down its thigh)
  const bend = spec.bend, sway = swayAmp * spec.sway, p2 = 2 * Math.PI;
  for (let k = 0; k < RINGS; k++) {
    let s = 0; while (s < 3 && k >= SEG_AT[s + 1]) s++;
    const t = (k - SEG_AT[s]) / (SEG_AT[s + 1] - SEG_AT[s]), sk = SEGS[s] + t * SEGL[s];
    let cx = lerp(ANC[3 * s], ANC[3 * s + 3], t), cy = lerp(ANC[3 * s + 1], ANC[3 * s + 4], t), cz = lerp(ANC[3 * s + 2], ANC[3 * s + 5], t);
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 5; i++) {
      const hi = i < 4 ? SEGS[i + 1] : SEGS[4] + 10, ov = Math.min(sk + bend, hi) - Math.max(sk - bend, SEGS[i]);
      if (ov > 0) { nx += ov * SEGD[3 * i]; ny += ov * SEGD[3 * i + 1]; nz += ov * SEGD[3 * i + 2]; }
    }
    // below the knee the rings turn toward gravity: a share g of the way to straight down
    const g = smooth(R_KNEE, R_ANKLE, k) * (1 - sh);          // (a tube of the breeches stays across its thigh to the knee band: it hangs on the leg, not from the waist)
    nx = lerp(nx, 0, g); ny = lerp(ny, -1, g); nz = lerp(nz, 0, g);
    let nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (turn && k >= RINGS - KNEE_TURN.length) {
      const wt = KNEE_TURN[k - RINGS + KNEE_TURN.length];
      nx = lerp(nx, sdx, wt); ny = lerp(ny, sdy, wt); nz = lerp(nz, sdz, wt); nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (k === RINGS - 1) { cx = kx + sdx * spec.drop; cy = ky + sdy * spec.drop; cz = kz + sdz * spec.drop; }
    }
    // the ring's frame: the pelvis's forward axis carried by the shortest turn of the pelvis's down axis onto the ring's normal (the way a pipe's frame
    // follows its bends), so over the lap the front lies on top of the thighs and under the knee it faces forward again
    const vx = pdy * nz - pdz * ny, vy = pdz * nx - pdx * nz, vz = pdx * ny - pdy * nx, cc = pdx * nx + pdy * ny + pdz * nz, kk = 1 / (1 + cc);
    let fx = pfx + (vy * pfz - vz * pfy) + kk * (vy * (vx * pfy - vy * pfx) - vz * (vz * pfx - vx * pfz));
    let fy = pfy + (vz * pfx - vx * pfz) + kk * (vz * (vy * pfz - vz * pfy) - vx * (vx * pfy - vy * pfx));
    let fz = pfz + (vx * pfy - vy * pfx) + kk * (vx * (vz * pfx - vx * pfz) - vy * (vy * pfz - vz * pfy));
    const d = fx * nx + fy * ny + fz * nz; fx -= d * nx; fy -= d * ny; fz -= d * nz;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    // sway: the hem lags the legs, from the knee down, growing with the way down
    const sd = smooth(R_HIP, R_HEM, k), sa = sway * sd * sd;
    if (sa > 0) {
      const lx = fy * nz - fz * ny, lz = fx * ny - fy * nx;           // lateral: f x n, in x and z (horizontal part)
      cx += sa * (Math.sin(p2 * (2 * phase + 0.15)) * hx * 0.7 + Math.sin(p2 * (phase + 0.3)) * lx * 0.8);
      cz += sa * (Math.sin(p2 * (2 * phase + 0.15)) * hz * 0.7 + Math.sin(p2 * (phase + 0.3)) * lz * 0.8);
    }
    ringC[3 * k] = cx; ringC[3 * k + 1] = cy; ringC[3 * k + 2] = cz; ringN[3 * k] = nx; ringN[3 * k + 1] = ny; ringN[3 * k + 2] = nz; ringF[3 * k] = fx; ringF[3 * k + 1] = fy; ringF[3 * k + 2] = fz;
  }
  EX[0] = hx; EX[1] = hz; EX[2] = a2x; EX[3] = a2z; EX[4] = a3x; EX[5] = a3z; EX[6] = 1 - (pdx * tdx + pdy * tdy + pdz * tdz);          // (the tube's own hip's bend, 1 - cos: SEAT_BACK)
}

/** The skirt's vertices for a pose. bones: { W, P } (world rotations B x 9 and joint positions B x 3, the walker's w.Wm and w.Pm). Fills `out` (RINGS x around x 3; around is
 *  ctx.around, 40 by default). Each of its passes reads only the one before (the radii of the pass before it, never ones this pass has just written), so each vertex is a function of
 *  its own ring and its neighbours and the whole is the same on a GPU (garments/skirt-tsl.js): the design radius with the bend limit and the legs' floor, the outward smoothing across
 *  the columns, the bridging of a dent down a column (ctx.bridge rounds, 1; 0 for none, the far tier's; each moves the vertex BRIDGE_GAIN of the way to the line: all of it, taken from the neighbours' old places, over-fills a dent that spans several rings and folds the cloth in a sit), then the seat and the floor. */
export function skirtPose(spec, bones, ctx = {}, out = new Float32Array(RINGS * (ctx.around ?? AROUND) * 3)) {
  const { W, P } = bones, floor = ctx.floor ?? 0, seat = ctx.seat ?? 0, AROUND = ctx.around ?? AROUND_DEFAULT, SKIRT_V = RINGS * AROUND, rounds = ctx.bridge ?? 1, gain = ctx.bridgeGain ?? BRIDGE_GAIN;
  const thL = BI.thighL, thR = BI.thighR, shL = BI.shinL, shR = BI.shinR, fL = BI.footL, fR = BI.footR, tL = BI.toeL, tR = BI.toeR, P3 = (b, k) => P[b * 3 + k], p2 = 2 * Math.PI;
  ringFrames(spec, bones, ctx);
  const hx = EX[0], hz = EX[1], a2x = EX[2], a2z = EX[3], a3x = EX[4], a3z = EX[5];
  // the inside of each bend: where the path turns, the rings' planes meet at a distance rho = arc / turn from the axis, on the side the path turns toward; a wall
  // farther out than that on that side runs into the next ring (the inside of the knee when sitting). The design radius is held short of it.
  for (let k = 0; k < RINGS - 1; k++) {                          // between each two rings
    const dx = ringN[3 * k + 3] - ringN[3 * k], dy = ringN[3 * k + 4] - ringN[3 * k + 1], dz = ringN[3 * k + 5] - ringN[3 * k + 2];
    const turn = Math.sqrt(dx * dx + dy * dy + dz * dz), arc = Math.sqrt((ringC[3 * k + 3] - ringC[3 * k]) ** 2 + (ringC[3 * k + 4] - ringC[3 * k + 1]) ** 2 + (ringC[3 * k + 5] - ringC[3 * k + 2]) ** 2);
    PAIR[k] = turn > 1e-6 ? arc / turn : 1e3;
  }
  for (let k = 0; k < RINGS; k++) {
    const a = Math.max(0, k - 1), b = Math.min(RINGS - 2, k);
    let dx = ringN[3 * Math.min(RINGS - 1, k + 1)] - ringN[3 * a], dy = ringN[3 * Math.min(RINGS - 1, k + 1) + 1] - ringN[3 * a + 1], dz = ringN[3 * Math.min(RINGS - 1, k + 1) + 2] - ringN[3 * a + 2];
    const dn = dx * ringN[3 * k] + dy * ringN[3 * k + 1] + dz * ringN[3 * k + 2]; dx -= dn * ringN[3 * k]; dy -= dn * ringN[3 * k + 1]; dz -= dn * ringN[3 * k + 2];
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    RIN[3 * k] = dx / dl; RIN[3 * k + 1] = dy / dl; RIN[3 * k + 2] = dz / dl; RHO[k] = Math.min(PAIR[a], PAIR[b]);
  }
  // ---- the legs as capsules (the foot from the ankle to the toe tip)
  // the legs this tube holds: a skirt all of them, a tube of the breeches its own thigh and shin (not the foot: it ends at the knee)
  for (let c = 0; c < 6; c++) {
    const ci = c * 8;
    if (c < 4) {                                                   // thigh L, shin L, thigh R, shin R: joint to joint, the radius sampled at both ends
      const a = CAP_A[c], b = CAP_B[c], arr = c & 1 ? spec.shin : spec.thigh;
      CAP[ci] = P3(a, 0); CAP[ci + 1] = P3(a, 1); CAP[ci + 2] = P3(a, 2); CAP[ci + 3] = P3(b, 0); CAP[ci + 4] = P3(b, 1); CAP[ci + 5] = P3(b, 2); CAP[ci + 6] = arr[0]; CAP[ci + 7] = arr[4];
    } else {                                                       // the foot: the ankle to the toe tip
      const side = c - 4, toe = side ? tR : tL, foot = side ? fR : fL, tip = spec.tipToe[side], jt = spec.toeJoint[side];
      mulv(W, toe, tip[0] - jt[0], tip[1] - jt[1], tip[2] - jt[2], tmp, 0);
      CAP[ci] = P3(foot, 0); CAP[ci + 1] = P3(foot, 1); CAP[ci + 2] = P3(foot, 2); CAP[ci + 3] = P3(toe, 0) + tmp[0]; CAP[ci + 4] = P3(toe, 1) + tmp[1]; CAP[ci + 5] = P3(toe, 2) + tmp[2];
      CAP[ci + 6] = spec.foot; CAP[ci + 7] = spec.foot * 0.8;
    }
  }
  const clear = spec.legClear, chord = 1 / Math.cos(Math.PI / AROUND), bendHold = 0.8, behind = Math.min(0, (a3x - a2x) * hx + (a3z - a2z) * hz) - (Math.max(spec.shin[0], spec.shin[1], spec.shin[2]) + 0.015);          // behind the back of the calf (the shin leans back to the ankle): the seat's edge
  // how far the knees are bent: 0 standing, 1 at a right angle (the thigh's direction against the shin's, the two legs averaged). The train behind the legs tucks in as it
  // bends, since the back of the skirt would go under the thighs.
  let flex = 0;
  for (let side = 0; side < 2; side++) {
    const th = side ? thR : thL, sh = side ? shR : shL, fo = side ? fR : fL;
    let ax = P3(sh, 0) - P3(th, 0), ay = P3(sh, 1) - P3(th, 1), az = P3(sh, 2) - P3(th, 2), bx = P3(fo, 0) - P3(sh, 0), by = P3(fo, 1) - P3(sh, 1), bz = P3(fo, 2) - P3(sh, 2);
    const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1, bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
    flex += 0.5 * smooth(0.12, 0.7, 1 - (ax * bx + ay * by + az * bz) / (al * bl));
  }
  // ---- the vertices
  for (let k = 0; k < RINGS; k++) {
    const cx = ringC[3 * k], cy = ringC[3 * k + 1], cz = ringC[3 * k + 2], nx = ringN[3 * k], ny = ringN[3 * k + 1], nz = ringN[3 * k + 2], fx = ringF[3 * k], fy = ringF[3 * k + 1], fz = ringF[3 * k + 2];
    const lx = fy * nz - fz * ny, ly = fz * nx - fx * nz, lz = fx * ny - fy * nx;          // lateral = f x n
    const rs = spec.rs[k], rf = spec.rf[k], rb = spec.rb[k] * (1 - spec.trainTuck * flex * smooth(R_KNEE - 1, R_KNEE + 1, k)), ringR = Math.max(rs, rf, spec.rb[k]);
    for (let j = 0; j < AROUND; j++) {
      const th = (j / AROUND) * p2, sn = Math.sin(th), cs = Math.cos(th);
      // design radius: half ellipses front and back
      const rr = cs >= 0 ? rf : rb, den = Math.sqrt((sn * sn) / (rs * rs) + (cs * cs) / (rr * rr));
      let design = 1 / den;
      const inward = (sn * lx + cs * fx) * RIN[3 * k] + (sn * ly + cs * fy) * RIN[3 * k + 1] + (sn * lz + cs * fz) * RIN[3 * k + 2];
      if (inward > 0.1) design = Math.min(design, bendHold * RHO[k] / inward);
      // floor from the legs: the support of each capsule's section in this ring's plane, over this vertex's direction and its two neighbours' halves
      let need = 0;
      for (let m = -1; m <= 1; m++) {
        const tm = th + m * Math.PI / AROUND, sm = Math.sin(tm), cm = Math.cos(tm), ux = sm * lx + cm * fx, uy = sm * ly + cm * fy, uz = sm * lz + cm * fz;
        const scale = m === 0 ? 1 : chord;
        let best = 0;
        for (let c = 0; c < 6; c++) {
          if (spec.short && !(c < 4 && (c >> 1) === (spec.leg < 0 ? 1 : 0))) continue;          // a tube of the breeches holds its own thigh and shin only
          const o = c * 8, ax = CAP[o], ay = CAP[o + 1], az = CAP[o + 2], bx = CAP[o + 3], by = CAP[o + 4], bz = CAP[o + 5], ra = CAP[o + 6], rb2 = CAP[o + 7];
          const da = (ax - cx) * nx + (ay - cy) * ny + (az - cz) * nz, db = (bx - cx) * nx + (by - cy) * ny + (bz - cz) * nz;
          const rmax = Math.max(ra, rb2) + clear;
          // a leg lying in the ring's plane is another ring's to enclose: it counts as it crosses the plane (a thigh and a ring at 60 degrees or more, not at all)
          let wgt = 1;
          if (c < 4) { const dl = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2) || 1; wgt = smooth(0.3, 0.6, Math.abs(db - da) / dl); if (wgt === 0) continue; }
          if ((da > rmax && db > rmax) || (da < -rmax && db < -rmax)) continue;
          // t range inside the slab |d| <= rmax, clamped to the segment
          const e = db - da; let t0 = 0, t1 = 1;
          if (Math.abs(e) > 1e-9) { const ta = (-rmax - da) / e, tb = (rmax - da) / e; t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb)); }
          // in-plane position of the segment's points along u: p(t) = pa + t q
          const pa = (ax - cx) * ux + (ay - cy) * uy + (az - cz) * uz, q = ((bx - ax) * ux + (by - ay) * uy + (bz - az) * uz);
          const rm = lerp(ra, rb2, 0.5 * (t0 + t1)) + clear;
          // the best t: where the slope of p(t) + sqrt(r^2 - d(t)^2) vanishes, d(t) = da + t e: |D| = r |q| / sqrt(q^2 + e^2), the sign of q e
          let tc = t0;
          const qq = Math.sqrt(q * q + e * e);
          if (qq > 1e-12 && Math.abs(e) > 1e-9) { const D = Math.sign(q * e || 1) * rm * Math.abs(q) / qq; tc = (D - da) / e; }
          const tcc = Math.max(t0, Math.min(t1, tc));
          for (let q3 = 0; q3 < 3; q3++) {
            const t = q3 === 0 ? t0 : q3 === 1 ? t1 : tcc;
            const dd = da + t * e, r = lerp(ra, rb2, t) + clear, v = pa + t * q + Math.sqrt(Math.max(0, r * r - dd * dd));
            // a leg whose section lies far from the ring's axis (a knee in front of a ring at the waist) belongs to the rings along it, not this one
            const wx = ax + t * (bx - ax) - cx, wy = ay + t * (by - ay) - cy, wz = az + t * (bz - az) - cz, wn = wx * nx + wy * ny + wz * nz;
            const dist = Math.sqrt(Math.max(0, wx * wx + wy * wy + wz * wz - wn * wn)), wt = wgt * (1 - smooth(1.3, 1.8, dist / ringR));
            if (v * wt > best) best = v * wt;
          }
        }
        const v = best * scale; if (v > need) need = v;
      }
      RAW[k * AROUND + j] = Math.max(design, need);
    }
  }
  // a ring's radii, smoothed outward only: a dent between two neighbours (where one leg's support meets the bell, or a bend's limit) is filled, never made deeper
  for (let k = 0; k < RINGS; k++) {
    const cx = ringC[3 * k], cy = ringC[3 * k + 1], cz = ringC[3 * k + 2], nx = ringN[3 * k], ny = ringN[3 * k + 1], nz = ringN[3 * k + 2], fx = ringF[3 * k], fy = ringF[3 * k + 1], fz = ringF[3 * k + 2];
    const lx = fy * nz - fz * ny, ly = fz * nx - fx * nz, lz = fx * ny - fy * nx, base = k * AROUND;
    for (let j = 0; j < AROUND; j++) {
      const th = (j / AROUND) * p2, sn = Math.sin(th), cs = Math.cos(th), r = Math.max(RAW[base + j], 0.5 * (RAW[base + (j + AROUND - 1) % AROUND] + RAW[base + (j + 1) % AROUND])) + (spec.short ? (spec.fitted ? seatBack(spec.H, EX[6], k, cs) : seat > 0 && ctx.seatEdge !== undefined ? seatEase(spec.H, flex, k) : 0) : 0);          // (the seated ease; fitted breeches: behind, by the hip)
      const o = (base + j) * 3, ux = sn * lx + cs * fx, uy = sn * ly + cs * fy, uz = sn * lz + cs * fz;
      out[o] = cx + r * ux; out[o + 1] = cy + r * uy; out[o + 2] = cz + r * uz;
      UD[o] = ux; UD[o + 1] = uy; UD[o + 2] = uz;
    }
  }
  // a dent down a column (a ring closer to its axis than the rings either side of it: the inside of a bend, the crease at the hip and the back of the knee when sitting)
  // is bridged, as taut cloth is: the vertex goes outward to the line between the rings s above and s below it, for the s (1 to 3) that asks the most, never inward. Each round reads
  // the positions the round before left (all of them before any is moved), so no vertex depends on the order the others are taken in.
  for (let round = 0; round < rounds; round++) {
    BEST.fill(0, 0, SKIRT_V);
    for (let k = 1; k < RINGS - 1; k++) for (let j = 0; j < AROUND; j++) {
      const i = k * AROUND + j, o = 3 * i; let best = 0;
      for (let sp = 1; sp <= 3; sp++) {
        if (k - sp < 0 || k + sp >= RINGS) break;
        const a = o - 3 * AROUND * sp, c = o + 3 * AROUND * sp;
        const d = (0.5 * (out[a] + out[c]) - out[o]) * UD[o] + (0.5 * (out[a + 1] + out[c + 1]) - out[o + 1]) * UD[o + 1] + (0.5 * (out[a + 2] + out[c + 2]) - out[o + 2]) * UD[o + 2];
        if (d > best) best = d;
      }
      BEST[i] = best;
    }
    for (let i = 0; i < SKIRT_V; i++) if (BEST[i] > 0) { const o = 3 * i, g = BEST[i] * gain; out[o] += g * UD[o]; out[o + 1] += g * UD[o + 1]; out[o + 2] += g * UD[o + 2]; }
  }
  // ---- the seat: with one, the lap lies on it and the rest falls from its front edge. The seat's front edge is the line behind the calf (spec: behind); a vertex of the
  // lap's rings (to the knee) that lies behind it and below the seat's top is lifted onto it; a vertex of the rings below the knee that lies behind it is carried
  // forward onto the edge's vertical plane, so the skirt hangs from the seat's edge to the floor and never goes under the seat.
  if (seat > 0 && ctx.seatEdge !== undefined) {
    for(let k=0;k<RINGS;k++)for(let j=0;j<AROUND;j++) {
      const o=(k*AROUND+j)*3,p=seatKeepout([out[o],out[o+1],out[o+2]],k,spec,seat,ctx.seatEdge);
      out.set(p,o);
    }
  } else if (seat > 0) {
    const top = seat + 0.004;
    const lapRings = spec.short ? RINGS : R_KNEE + 1;           // a tube of the breeches lies on the seat all its length (it is on the thigh to the knee band)
    for (let i = 0; i < lapRings * AROUND; i++) if (out[3 * i + 1] < top) { out[3 * i + 1] = top; LIFT[i] = 1; } else LIFT[i] = 0;           // the lap lies on the seat from the hips to the knee
    // flat on the seat the lap's underside runs forward from the hips to the knee, ring after ring: one that came out behind the ring before it (the knee's back radius
    // reaches back under the thigh) is carried forward onto it
    for (let j = 0; j < AROUND; j++) for (let k = 1; k < lapRings; k++) {
      const i = k * AROUND + j, p = i - AROUND;
      if (!LIFT[i] || !LIFT[p]) continue;
      const sdk = out[3 * i] * hx + out[3 * i + 2] * hz, sdp = out[3 * p] * hx + out[3 * p + 2] * hz;
      if (sdk < sdp + 0.002) { out[3 * i] += hx * (sdp + 0.002 - sdk); out[3 * i + 2] += hz * (sdp + 0.002 - sdk); }
    }
    for (let i = lapRings * AROUND; i < SKIRT_V; i++) {
      const sd = (out[3 * i] - a2x) * hx + (out[3 * i + 2] - a2z) * hz;
      if (sd < behind + spec.fall * spec.H && out[3 * i + 1] < top + 0.03 * spec.H) { out[3 * i] += hx * (behind + spec.fall * spec.H - sd); out[3 * i + 2] += hz * (behind + spec.fall * spec.H - sd); }
    }
  }
  // ---- the floor: nothing below the hem line
  const lo = floor + spec.hemY;
  for (let i = 0; i < SKIRT_V; i++) if (out[3 * i + 1] < lo) out[3 * i + 1] = lo;
  return out;
}

// ---- the skirt as a keep-out volume (keepout.js) ------------------------------------------------------------------------------------
// The tube of its rings at their design radii (the profile: the waist, the roll, the bell), posed by the same ring frames as skirtPose, which is all a hand or an elbow needs
// to be kept out of the swell: the final skirt is never narrower than its design (the legs' floors only widen it). Cheap: the frames (about 5 microseconds) and a few probes.
function makeVolume() {
  const VC = new Float64Array(RINGS * 3), VN = new Float64Array(RINGS * 3), VF = new Float64Array(RINGS * 3); let VS = null;
/** The skirt's keep-out volume for a pose { signed(x, y, z, n) } (the signed distance to its surface along the radius of the ring through the point, negative inside, and the outward
 *  radial normal): the point is placed between the two rings whose planes it lies between, the design radius interpolated, found by the angle's cosine and sine in the ring's
 *  frame (no trigonometry). Above the waist and below the hem it is outside. One object, reused: its numbers are those of the last call. */
const VOL = {
  signed(x, y, z, n) {
    let dPrev = 0;
    for (let k = 0; k < RINGS; k++) {
      const d = (x - VC[3 * k]) * VN[3 * k] + (y - VC[3 * k + 1]) * VN[3 * k + 1] + (z - VC[3 * k + 2]) * VN[3 * k + 2];
      if (k > 0 && dPrev >= 0 && d < 0) {
        const lam = dPrev / (dPrev - d), a = k - 1, cx = VC[3 * a] + (VC[3 * k] - VC[3 * a]) * lam, cy = VC[3 * a + 1] + (VC[3 * k + 1] - VC[3 * a + 1]) * lam, cz = VC[3 * a + 2] + (VC[3 * k + 2] - VC[3 * a + 2]) * lam;
        let nx = VN[3 * a] + (VN[3 * k] - VN[3 * a]) * lam, ny = VN[3 * a + 1] + (VN[3 * k + 1] - VN[3 * a + 1]) * lam, nz = VN[3 * a + 2] + (VN[3 * k + 2] - VN[3 * a + 2]) * lam;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        let fx = VF[3 * a] + (VF[3 * k] - VF[3 * a]) * lam, fy = VF[3 * a + 1] + (VF[3 * k + 1] - VF[3 * a + 1]) * lam, fz = VF[3 * a + 2] + (VF[3 * k + 2] - VF[3 * a + 2]) * lam;
        const fd = fx * nx + fy * ny + fz * nz; fx -= fd * nx; fy -= fd * ny; fz -= fd * nz; const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= fl; fy /= fl; fz /= fl;
        const lx = fy * nz - fz * ny, ly = fz * nx - fx * nz, lz = fx * ny - fy * nx;           // lateral = f x n, as skirtPose has it
        let wx = x - cx, wy = y - cy, wz = z - cz; const wn = wx * nx + wy * ny + wz * nz; wx -= wn * nx; wy -= wn * ny; wz -= wn * nz;
        const xf = wx * fx + wy * fy + wz * fz, xl = wx * lx + wy * ly + wz * lz, rho = Math.sqrt(xf * xf + xl * xl);
        const rs = VS.rs[a] + (VS.rs[k] - VS.rs[a]) * lam, rr = xf >= 0 ? VS.rf[a] + (VS.rf[k] - VS.rf[a]) * lam : VS.rb[a] + (VS.rb[k] - VS.rb[a]) * lam;
        if (rho < 1e-6) { n[0] = fx; n[1] = fy; n[2] = fz; return -rs; }
        const cs = xf / rho, sn = xl / rho, R = 1 / Math.sqrt((sn * sn) / (rs * rs) + (cs * cs) / (rr * rr));
        n[0] = cs * fx + sn * lx; n[1] = cs * fy + sn * ly; n[2] = cs * fz + sn * lz;
        return rho - R;
      }
      dPrev = d;
    }
    n[0] = 0; n[1] = 1; n[2] = 0; return 1e3;
  },
};
  return { VOL, set(spec) { VC.set(ringC); VN.set(ringN); VF.set(ringF); VS = spec; return VOL; } };
}
const VOLUMES = [makeVolume(), makeVolume()];
export function skirtVolume(spec, bones, ctx = {}, which = 0) {
  ringFrames(spec, bones, ctx);
  return VOLUMES[which].set(spec);
}
/** The skirt's legs as keep-out capsules, thigh and shin of each leg from the posed joints, tapered by the spec's leg radii and the skirt's clearance round them: where the skirt's wall is
 *  the legs' own (the hips of a small child, whose arms reach as low as her thighs). Four objects, reused: pass them to a keep-out with skirtVolume's. */
const LEGS = ["L", "R"].flatMap((s) => [["thigh", "shin"], ["shin", "foot"]].map(([a, b]) => ({ a: BI[a + s], b: BI[b + s], vol: capsuleVolume([0, 0, 0], [0, 0, 0], 0) })));
export function legVolumes(spec, bones) {
  const P = bones.P, clear = spec.legClear + 0.004;
  LEGS.forEach((l, i) => {
    const v = l.vol, thigh = (i & 1) === 0;
    for (let k = 0; k < 3; k++) { v.a[k] = P[3 * l.a + k]; v.b[k] = P[3 * l.b + k]; }
    v.ra = (thigh ? spec.thigh[0] : spec.shin[0]) + clear; v.rb = (thigh ? spec.thigh[4] : spec.shin[4]) + clear;
  });
  return LEGS.map((l) => l.vol);
}

/** The horizontal radius the skirt asks of the floor round its wearer's root: the hem's largest radius, and the roll's. */
export function skirtFootprint(spec) {
  let m = 0;
  for (let k = R_HIP; k < RINGS; k++) m = Math.max(m, spec.rs[k], spec.rf[k], spec.rb[k]);
  return m;
}

// ---- reading a posed skirt as the solid it is (for the sweep) --------------------------------------------------------------------------
/** The skirt solid of a posed skirt `sk` (SKIRT_V x 3): per ring its centre, normal (down the path), in-plane axes and the polar radius of each vertex, so
 *  a point can be asked how far it lies outside the skirt along the radius, between the rings that bracket it. A tube, not a sheet: inside and outside
 *  are the radius against the wall's radius, with no nearest-triangle sign to confuse a fold. */
export function skirtSolid(sk, out = {}) {
  const C = out.C ?? (out.C = new Float64Array(RINGS * 3)), N = out.N ?? (out.N = new Float64Array(RINGS * 3)), Fa = out.F ?? (out.F = new Float64Array(RINGS * 3)), La = out.L ?? (out.L = new Float64Array(RINGS * 3)), Rr = out.R ?? (out.R = new Float64Array(RINGS * AROUND));
  for (let k = 0; k < RINGS; k++) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < AROUND; j++) { const o = 3 * (k * AROUND + j); cx += sk[o]; cy += sk[o + 1]; cz += sk[o + 2]; }
    cx /= AROUND; cy /= AROUND; cz /= AROUND;
    // the ring's normal by Newell's method (the sum of cross products about the centre), pointing down the path (the order of the vertices makes it so)
    let nx = 0, ny = 0, nz = 0;
    for (let j = 0; j < AROUND; j++) {
      const a = 3 * (k * AROUND + j), b = 3 * (k * AROUND + (j + 1) % AROUND), ax = sk[a] - cx, ay = sk[a + 1] - cy, az = sk[a + 2] - cz, bx = sk[b] - cx, by = sk[b + 1] - cy, bz = sk[b + 2] - cz;
      nx += ay * bz - az * by; ny += az * bx - ax * bz; nz += ax * by - ay * bx;
    }
    let l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    if (ny > 0) { nx = -nx; ny = -ny; nz = -nz; }          // all the normals' sense is the order of the vertices; flip it to point down (a ring never faces up)
    C[3 * k] = cx; C[3 * k + 1] = cy; C[3 * k + 2] = cz; N[3 * k] = nx; N[3 * k + 1] = ny; N[3 * k + 2] = nz;
    // in-plane axes from vertex 0 (the front) and the plane's normal; the angle of vertex j is its own
    let fx = sk[3 * k * AROUND] - cx, fy = sk[3 * k * AROUND + 1] - cy, fz = sk[3 * k * AROUND + 2] - cz; const d = fx * nx + fy * ny + fz * nz; fx -= d * nx; fy -= d * ny; fz -= d * nz;
    l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= l; fy /= l; fz /= l;
    Fa[3 * k] = fx; Fa[3 * k + 1] = fy; Fa[3 * k + 2] = fz;
    // lateral = f x n, as in skirtPose; if the ring was built the other way round (the normal flipped) the angle runs the other way: j then maps to -theta
    La[3 * k] = fy * nz - fz * ny; La[3 * k + 1] = fz * nx - fx * nz; La[3 * k + 2] = fx * ny - fy * nx;
    for (let j = 0; j < AROUND; j++) {
      const o = 3 * (k * AROUND + j), wx = sk[o] - cx, wy = sk[o + 1] - cy, wz = sk[o + 2] - cz, wn = wx * nx + wy * ny + wz * nz;
      Rr[k * AROUND + j] = Math.sqrt(Math.max(0, wx * wx + wy * wy + wz * wz - wn * wn));
    }
  }
  // does the vertex order run from f toward l (+) or from f toward -l? read it off vertex AROUND/4 (a quarter turn): its lateral component
  let sgn = 0;
  for (let k = 0; k < RINGS; k++) { const o = 3 * (k * AROUND + AROUND / 4); sgn += (sk[o] - C[3 * k]) * La[3 * k] + (sk[o + 1] - C[3 * k + 1]) * La[3 * k + 1] + (sk[o + 2] - C[3 * k + 2]) * La[3 * k + 2]; }
  out.dir = sgn >= 0 ? 1 : -1;
  return out;
}

/** How far the point (x, y, z) lies outside the posed skirt along the radius (metres; negative inside, its depth), or null when it is above the waist ring
 *  or below the hem ring, or far from the skirt's axis. */
export function skirtOutside(solid, sk, x, y, z) {
  const { C, N, F, L, R, dir } = solid;
  let best = null;
  let dPrev = 0;
  for (let k = 0; k < RINGS; k++) {
    const d = (x - C[3 * k]) * N[3 * k] + (y - C[3 * k + 1]) * N[3 * k + 1] + (z - C[3 * k + 2]) * N[3 * k + 2];
    if (k > 0 && dPrev >= 0 && d < 0) {
      // between rings k-1 and k: the point's place between their planes
      const lam = dPrev / (dPrev - d), a = k - 1;
      let cx = C[3 * a] + (C[3 * k] - C[3 * a]) * lam, cy = C[3 * a + 1] + (C[3 * k + 1] - C[3 * a + 1]) * lam, cz = C[3 * a + 2] + (C[3 * k + 2] - C[3 * a + 2]) * lam;
      let nx = N[3 * a] + (N[3 * k] - N[3 * a]) * lam, ny = N[3 * a + 1] + (N[3 * k + 1] - N[3 * a + 1]) * lam, nz = N[3 * a + 2] + (N[3 * k + 2] - N[3 * a + 2]) * lam;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      let wx = x - cx, wy = y - cy, wz = z - cz; const wn = wx * nx + wy * ny + wz * nz; wx -= wn * nx; wy -= wn * ny; wz -= wn * nz;
      const rho = Math.sqrt(wx * wx + wy * wy + wz * wz);
      // the angle of the point in the ring's own frame (the frame of ring a and of ring k, blended): theta from f toward l
      const fa = Math.atan2(wx * (L[3 * a] + (L[3 * k] - L[3 * a]) * lam) + wy * (L[3 * a + 1] + (L[3 * k + 1] - L[3 * a + 1]) * lam) + wz * (L[3 * a + 2] + (L[3 * k + 2] - L[3 * a + 2]) * lam),
        wx * (F[3 * a] + (F[3 * k] - F[3 * a]) * lam) + wy * (F[3 * a + 1] + (F[3 * k + 1] - F[3 * a + 1]) * lam) + wz * (F[3 * a + 2] + (F[3 * k + 2] - F[3 * a + 2]) * lam));
      const th = ((dir * fa) / (2 * Math.PI) + 1) % 1, g = th * AROUND, j0 = Math.floor(g) % AROUND, j1 = (j0 + 1) % AROUND, s = g - Math.floor(g);
      const ra = R[a * AROUND + j0] * (1 - s) + R[a * AROUND + j1] * s, rk = R[k * AROUND + j0] * (1 - s) + R[k * AROUND + j1] * s;
      const over = rho - (ra + (rk - ra) * lam);
      if (best === null || over < best) best = over;                // inside any of the lofts it is bracketed by is inside the skirt
    }
    dPrev = d;
  }
  return best;
}

// Reference for the GPU's finite front-edge keep-out. Rings through the knee
// rest on the top; the lower hem hangs in front of the board.
export function seatKeepout(p,ring,spec,seat,edge) {
  if(!(seat>0))return p;
  const lap=ring<=9||spec.short>.5,top=seat+.004;
  return [p[0],lap&&p[2]<=edge?Math.max(p[1],top):p[1],!lap&&p[1]<top+.03?Math.max(p[2],edge+.004):p[2]];
}

// How far the clothes stand off a seated wearer's thigh, for the hands to rest on them (sitting.js makeSitting `legs`, population.js prepareSit): from one
// seated pose (`bones`, as skirtPose takes them, in the wearer's frame) and the seat (ctx: seat, seatEdge), the outer surface's distance from the left
// femur's axis at nine shares along the thigh (hip to knee, eighths) and four directions round it (straight up, 30, 60 and 90 degrees toward the
// outside), the furthest of the surface (between the rings and their columns too) within 0.05 of the share and 8 degrees of the direction: a
// Float64Array of 36, share by share. `specs`: the skirt, or the two tubes of the breeches (the left is read; the right is its mirror). Resting by
// the bare thigh's girth put the hands 3 to 5 cm inside the workman's breeches and 6 to 8 inside the gentleman's.
export const COVER_SHARES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1], COVER_ANGLES = [0, 30, 60, 90];
const COVER = new Float32Array(SKIRT_V * 3);
export function thighCover(specs, bones, ctx) {
  const spec = specs.find((s) => !(s.leg < 0)) ?? specs[0], sk = skirtPose(spec, bones, { ...ctx, phase: 0, sway: 0, cross: false }, COVER), P = bones.P;
  const a = [P[3 * BI.thighL], P[3 * BI.thighL + 1], P[3 * BI.thighL + 2]], b = [P[3 * BI.shinL], P[3 * BI.shinL + 1], P[3 * BI.shinL + 2]];
  const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...ax), u = ax.map((v) => v / L);
  const up0 = [-u[1] * u[0], 1 - u[1] * u[1], -u[1] * u[2]], ul = Math.hypot(...up0) || 1, up = up0.map((v) => v / ul);
  let out = [u[1] * up[2] - u[2] * up[1], u[2] * up[0] - u[0] * up[2], u[0] * up[1] - u[1] * up[0]];
  if (out[0] * (a[0] - P[0]) + out[2] * (a[2] - P[2]) < 0) out = out.map((v) => -v);          // outward: away from the pelvis's middle
  const cover = new Float64Array(COVER_SHARES.length * COVER_ANGLES.length), cs = COVER_ANGLES.map((d) => Math.cos((d * Math.PI) / 180)), sn = COVER_ANGLES.map((d) => Math.sin((d * Math.PI) / 180));
  const N = 4, q = [0, 0, 0];
  for (let k = 0; k < RINGS - 1; k++) for (let j = 0; j < AROUND; j++) for (let s = 0; s < N; s++) for (let r = 0; r < N; r++) {
    const o00 = 3 * (k * AROUND + j), o01 = 3 * (k * AROUND + (j + 1) % AROUND), o10 = o00 + 3 * AROUND, o11 = o01 + 3 * AROUND, x = s / N, y = r / N;
    for (let c = 0; c < 3; c++) q[c] = (sk[o00 + c] * (1 - y) + sk[o01 + c] * y) * (1 - x) + (sk[o10 + c] * (1 - y) + sk[o11 + c] * y) * x - a[c];
    const t = (q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) / L;
    if (t < -0.05 || t > 1.05) continue;
    const pu = q[0] * up[0] + q[1] * up[1] + q[2] * up[2], po = q[0] * out[0] + q[1] * out[1] + q[2] * out[2];
    for (let i = 0; i < COVER_SHARES.length; i++) {
      if (Math.abs(t - COVER_SHARES[i]) > 0.05) continue;
      for (let d = 0; d < COVER_ANGLES.length; d++) {
        // the reach along this direction of a point within 8 degrees of it
        const along = pu * cs[d] + po * sn[d], across = Math.abs(po * cs[d] - pu * sn[d]);
        if (along > 0 && across < 0.14 * along && along > cover[i * COVER_ANGLES.length + d]) cover[i * COVER_ANGLES.length + d] = along;
      }
    }
  }
  return cover;
}
