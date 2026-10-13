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
export function skirtSpec(near, cutName = "gentlewoman") {
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
  const ws = lm.waistY, hem = { s: c.hem.side * ws * 1.0, f: c.hem.front * ws, b: c.hem.back * ws };
  const rs = new Float32Array(RINGS), rf = new Float32Array(RINGS), rb = new Float32Array(RINGS);
  for (let k = 0; k < RINGS; k++) {
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
    if (sx > 0) { const eb = (c.belly ?? 1.5) * e; rs[k] = Math.max(rs[k], sx + eb); rf[k] = Math.max(rf[k], sz1 - cz + eb); rb[k] = Math.max(rb[k], cz - sz0 + eb); }          // the belly with more room: it moves against the pelvis's ring when the trunk bends
  }
  // the legs
  const radii = legRadii(w, 1);
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
  return unpackSpec(packSpec({ rs, rf, rb, thigh: radii.thigh, shin: radii.shin, foot, waistRest: A0, hipsJoint: J[BI.hips], spineJoint: J[BI.spine], toeJoint: [J[BI.toeL], J[BI.toeR]], tipToe: [w.tip.toeL, w.tip.toeR], waistY: ws }, 1 / H), H, cutName);
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
/** The spec of a wearer of height H from its packed numbers at unit height (a table's, or packSpec's) and a cut. */
export function unpackSpec(v, H, cutName = "gentlewoman") {
  const c = SKIRTS[cutName], u = H / 1.62; let n = 0;
  const take = (len, Ctor = Float32Array) => { const a = new Ctor(len); for (let i = 0; i < len; i++) a[i] = v[n++] * H; return a; };
  const rs = take(RINGS), rf = take(RINGS), rb = take(RINGS), thigh = take(5), shin = take(5), foot = v[n++] * H, waistRest = take(3, Array), hipsJoint = take(3, Array), spineJoint = take(3, Array);
  const toeJoint = [take(3, Array), take(3, Array)], tipToe = [take(3, Array), take(3, Array)], ws = v[n++] * H;
  return {
    cut: cutName, c, H, u, rs, rf, rb, ring: { s: rs, f: rf, b: rb }, waistRest, hipsJoint, spineJoint, toeJoint, tipToe, thigh, shin, foot,
    waistSpine: c.waistSpine ?? 0.5, trainTuck: c.trainTuck ?? 0.85, fall: c.fall ?? 0.02, hemY: c.hemClear * H, legClear: c.legClear * H, sway: c.sway * H, bend: (c.bend ?? 0.075) * H, waistY: ws,
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
  const hemY = floor + spec.hemY, a4x = a3x, a4y = Math.min(a3y - 0.01 * spec.H, hemY), a4z = a3z;
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
  ANC[0] = a0x; ANC[1] = a0y; ANC[2] = a0z; ANC[3] = a1x; ANC[4] = a1y; ANC[5] = a1z; ANC[6] = a2x; ANC[7] = a2y; ANC[8] = a2z; ANC[9] = a3x; ANC[10] = a3y; ANC[11] = a3z; ANC[12] = a4x; ANC[13] = a4y; ANC[14] = a4z;
  SEGS[0] = 0;
  for (let i = 0; i < 4; i++) {
    const dx = ANC[3 * i + 3] - ANC[3 * i], dy = ANC[3 * i + 4] - ANC[3 * i + 1], dz = ANC[3 * i + 5] - ANC[3 * i + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    SEGD[3 * i] = dx / l; SEGD[3 * i + 1] = dy / l; SEGD[3 * i + 2] = dz / l; SEGL[i] = l; SEGS[i + 1] = SEGS[i] + l;
  }
  SEGD[12] = 0; SEGD[13] = -1; SEGD[14] = 0;                       // past the hem anchor the path goes straight down
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
    const g = smooth(R_KNEE, R_ANKLE, k);
    nx = lerp(nx, 0, g); ny = lerp(ny, -1, g); nz = lerp(nz, 0, g);
    let nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
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
  EX[0] = hx; EX[1] = hz; EX[2] = a2x; EX[3] = a2z; EX[4] = a3x; EX[5] = a3z;
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
      const th = (j / AROUND) * p2, sn = Math.sin(th), cs = Math.cos(th), r = Math.max(RAW[base + j], 0.5 * (RAW[base + (j + AROUND - 1) % AROUND] + RAW[base + (j + 1) % AROUND]));
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
  if (seat > 0) {
    const top = seat + 0.004;
    for (let i = 0; i < (R_KNEE + 1) * AROUND; i++) if (out[3 * i + 1] < top) { out[3 * i + 1] = top; LIFT[i] = 1; } else LIFT[i] = 0;           // the lap lies on the seat from the hips to the knee
    // flat on the seat the lap's underside runs forward from the hips to the knee, ring after ring: one that came out behind the ring before it (the knee's back radius
    // reaches back under the thigh) is carried forward onto it
    for (let j = 0; j < AROUND; j++) for (let k = 1; k <= R_KNEE; k++) {
      const i = k * AROUND + j, p = i - AROUND;
      if (!LIFT[i] || !LIFT[p]) continue;
      const sdk = out[3 * i] * hx + out[3 * i + 2] * hz, sdp = out[3 * p] * hx + out[3 * p + 2] * hz;
      if (sdk < sdp + 0.002) { out[3 * i] += hx * (sdp + 0.002 - sdk); out[3 * i + 2] += hz * (sdp + 0.002 - sdk); }
    }
    for (let i = (R_KNEE + 1) * AROUND; i < SKIRT_V; i++) {
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
const VC = new Float64Array(RINGS * 3), VN = new Float64Array(RINGS * 3), VF = new Float64Array(RINGS * 3), VD = new Float64Array(RINGS);
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
let VS = null;
export function skirtVolume(spec, bones, ctx = {}) {
  ringFrames(spec, bones, ctx);
  VC.set(ringC); VN.set(ringN); VF.set(ringF); VS = spec;
  return VOL;
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
