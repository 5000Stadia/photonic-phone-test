// Keep-out (R5; Kabe, 2026-10-13: "if her hand automatically wanted to go to a location that was not clipping the dress ... such a simple way to handle that"): a person's
// limbs have a preference not to be inside what they wear, carry or sit on, as walkers have a preference not to walk into each other. A few probe points on each arm (the
// elbow, the middle of the forearm, the wrist, the palm, the fingertips), each a small sphere, are tested against cheap analytic keep-out volumes (never a mesh against a mesh).
// A probe that is inside, or nearer than a small clearance, is moved out to the nearest point of the volume's surface plus the clearance, smoothly with the depth (nothing
// moves until a probe comes within the clearance and the move grows from zero, so no snap), and the arm follows by two-bone IK: the shoulder stays, the wrist goes to the target,
// the elbow takes the nearest place on its circle to where it was (or where its own probe asks), so the elbow follows naturally. Contact is allowed, even wanted: a hand
// comes to rest ON a lap, not in it and not off it.
//
// A volume is { signed(x, y, z, n) }: the signed distance of the point to its surface (negative inside) and, into n[0..2], the surface's outward unit normal there.
// Anything that can say that is a volume: a sphere, a capsule, a skirt's rings (garments/skirt.js skirtVolume), later a seat, a table, a carried tray.
//
// Runs on the bones { W (B x 9 world rotations, row-major), P (B x 3 joint positions) } of a pose, in place: baked into a person's walk once (walk.js bakes the 32 frames; the
// crowd pays nothing a frame), live for the near tier and for offline poses. + - * / and sqrt only (no trigonometry), so every engine bakes the same bits.
import { BONES } from "../body.js";

const BI = Object.fromEntries(BONES.map(([n], i) => [n, i]));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** A sphere volume (centre c, radius r). */
export const sphereVolume = (c, r) => ({ signed(x, y, z, n) { const dx = x - c[0], dy = y - c[1], dz = z - c[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz); if (l < 1e-9) { n[0] = 0; n[1] = 1; n[2] = 0; } else { n[0] = dx / l; n[1] = dy / l; n[2] = dz / l; } return l - r; } });
/** A capsule volume from a to b with radius ra at a and rb at b (rb = ra when left out). a and b are read at each call, so they may be moved between calls (a bone's joints). */
export const capsuleVolume = (a, b, ra, rb = ra) => ({
  a, b, ra, rb,
  signed(x, y, z, n) {
    const a = this.a, b = this.b, ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], px = x - a[0], py = y - a[1], pz = z - a[2], t = clamp((px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez || 1), 0, 1);
    const dx = px - ex * t, dy = py - ey * t, dz = pz - ez * t, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-9) { n[0] = 0; n[1] = 1; n[2] = 0; } else { n[0] = dx / l; n[1] = dy / l; n[2] = dz / l; }
    return l - (this.ra + (this.rb - this.ra) * t);
  },
});

// the arm: the probes, each on a bone (0 the forearm's, 1 the hand's) at a place in that bone's rest frame, in units of the forearm's length l2: `along` the forearm's
// direction from the bone's joint, `lat` sideways (negative toward the body: the hand is a plate lying inward of the wrist's axis, a 0.35 l2 wide), `dep` forward (the thumb's
// side), and a radius `r` (also in l2). From the hand's own vertices on an adult, a girl, a toddler and an old woman: along 0 to 0.74, lat -0.31 to 0.04, dep -0.23 to 0.33,
// the same in every body.
export const ARM_PROBES = [
  { name: "upper arm 1", bone: 2, along: 0.55, lat: 0, dep: 0, r: 0.22 },          // (bone 2: the upper arm's own, along its length l1; the shoulder is the pivot and stays)
  { name: "upper arm 2", bone: 2, along: 0.85, lat: 0, dep: 0, r: 0.2 },
  { name: "elbow", bone: 0, along: 0, lat: 0, dep: 0, r: 0.22 },
  { name: "forearm 1", bone: 0, along: 0.3, lat: 0, dep: 0, r: 0.21 },
  { name: "forearm 2", bone: 0, along: 0.6, lat: 0, dep: 0, r: 0.20 },
  { name: "forearm 3", bone: 0, along: 0.9, lat: 0, dep: 0, r: 0.19 },
  // the hand: nine spheres from a farthest-point clustering of an adult's hand vertices (the cloud is the same in every body, in units of l2), each as large as its cluster
  { name: "hand 1", bone: 1, along: 0.07, lat: -0.05, dep: 0.07, r: 0.15 },
  { name: "hand 2", bone: 1, along: 0.17, lat: -0.05, dep: -0.08, r: 0.17 },
  { name: "hand 3", bone: 1, along: 0.25, lat: -0.15, dep: 0.18, r: 0.17 },
  { name: "hand 4", bone: 1, along: 0.30, lat: -0.25, dep: 0.28, r: 0.10 },
  { name: "hand 5", bone: 1, along: 0.39, lat: -0.10, dep: -0.12, r: 0.16 },
  { name: "hand 6", bone: 1, along: 0.47, lat: -0.11, dep: 0.05, r: 0.18 },
  { name: "hand 7", bone: 1, along: 0.51, lat: -0.15, dep: -0.17, r: 0.12 },
  { name: "hand 8", bone: 1, along: 0.58, lat: -0.18, dep: 0.17, r: 0.12 },
  { name: "hand 9", bone: 1, along: 0.65, lat: -0.19, dep: -0.04, r: 0.12 },
];
const RHOMIN = 0.05;
const SOFT = 0.010;                          // metres (at 1.62 m): the move eases in over this much, and out to the clearance

// how far a probe must move: 0 when it is further than the clearance (plus the ease), growing smoothly to the whole of the depth (C1 at the start: the quadratic, then the line)
function must(delta, w) { return delta <= 0 ? 0 : delta >= w ? delta - 0.5 * w : (delta * delta) / (2 * w); }

const m3 = (o, a, b) => {            // o = a b (9 numbers, row-major)
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
  o[0] = a0 * b[0] + a1 * b[3] + a2 * b[6]; o[1] = a0 * b[1] + a1 * b[4] + a2 * b[7]; o[2] = a0 * b[2] + a1 * b[5] + a2 * b[8];
  o[3] = a3 * b[0] + a4 * b[3] + a5 * b[6]; o[4] = a3 * b[1] + a4 * b[4] + a5 * b[7]; o[5] = a3 * b[2] + a4 * b[5] + a5 * b[8];
  o[6] = a6 * b[0] + a7 * b[3] + a8 * b[6]; o[7] = a6 * b[1] + a7 * b[4] + a8 * b[7]; o[8] = a6 * b[2] + a7 * b[5] + a8 * b[8];
};
// the rotation taking unit vector a to unit vector b by the shortest turn (Rodrigues; the opposite case, a nearly -b, turns about an axis square to a)
function between(o, ax, ay, az, bx, by, bz) {
  const vx = ay * bz - az * by, vy = az * bx - ax * bz, vz = ax * by - ay * bx, c = ax * bx + ay * by + az * bz;
  if (c < -0.9999) { const sx = Math.abs(ax) < 0.9 ? 1 : 0, sy = sx ? 0 : 1; let ux = ay * 0 - az * sy, uy = az * sx - ax * 0, uz = ax * sy - ay * sx; const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; ux /= ul; uy /= ul; uz /= ul; o[0] = 2 * ux * ux - 1; o[1] = 2 * ux * uy; o[2] = 2 * ux * uz; o[3] = 2 * ux * uy; o[4] = 2 * uy * uy - 1; o[5] = 2 * uy * uz; o[6] = 2 * ux * uz; o[7] = 2 * uy * uz; o[8] = 2 * uz * uz - 1; return o; }
  const k = 1 / (1 + c);
  o[0] = 1 - k * (vy * vy + vz * vz); o[1] = -vz + k * vx * vy; o[2] = vy + k * vx * vz;
  o[3] = vz + k * vx * vy; o[4] = 1 - k * (vx * vx + vz * vz); o[5] = -vx + k * vy * vz;
  o[6] = -vy + k * vx * vz; o[7] = vx + k * vy * vz; o[8] = 1 - k * (vx * vx + vy * vy);
  return o;
}
const vm = (R, x, y, z, o) => { o[0] = R[0] * x + R[1] * y + R[2] * z; o[1] = R[3] * x + R[4] * y + R[5] * z; o[2] = R[6] * x + R[7] * y + R[8] * z; };

const GH = new Float64Array(3), GF = new Float64Array(3), N = new Float64Array(3), T = new Float64Array(3), R1 = new Float64Array(9), R2 = new Float64Array(9), R3 = new Float64Array(9), RT = new Float64Array(9), tmp3 = new Float64Array(3);
const W0 = new Float64Array(27), P0 = new Float64Array(9);          // the arm's three bones as the pose had them: world rotations, joint positions

/** A keep-out for the arms of one person: the rig's rest joints J (the walker's), the person's height H, and a list of volumes' makers. Returns { apply(bones, ctx) }:
 *  `volumes(bones, ctx)` returns the volumes of this pose (they depend on the pose: a skirt's rings follow the legs). The arms' own probes are not volumes. */
export function armKeepOut(J, H, volumes, { clearance = 0.008, iterations = 4 } = {}) {
  const u = H / 1.62, sides = ["L", "R"].map((s) => {
    const up = BI["upperarm" + s], fo = BI["forearm" + s], ha = BI["hand" + s];
    const l1 = Math.hypot(J[fo][0] - J[up][0], J[fo][1] - J[up][1], J[fo][2] - J[up][2]), l2 = Math.hypot(J[ha][0] - J[fo][0], J[ha][1] - J[fo][1], J[ha][2] - J[fo][2]);
    // the probes in their bone's rest frame (every bone is at identity at rest): along the forearm's direction f, sideways along the inward axis (x taken off f, for the left
    // arm, mirrored for the right), and forward (z taken off f)
    const g = [(J[fo][0] - J[up][0]) / l1, (J[fo][1] - J[up][1]) / l1, (J[fo][2] - J[up][2]) / l1];
    const f = [(J[ha][0] - J[fo][0]) / l2, (J[ha][1] - J[fo][1]) / l2, (J[ha][2] - J[fo][2]) / l2], sg = s === "L" ? 1 : -1;
    let ax = [1 - f[0] * f[0], -f[0] * f[1], -f[0] * f[2]]; const al = Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]); ax = ax.map((x) => (x * sg) / al);
    let cz = [-f[2] * f[0], -f[2] * f[1], 1 - f[2] * f[2]]; const cl = Math.sqrt(cz[0] * cz[0] + cz[1] * cz[1] + cz[2] * cz[2]); cz = cz.map((x) => x / cl);
    return { up, fo, ha, l1, l2, probes: ARM_PROBES.map((p) => ({ ...p, q: p.bone === 2 ? [0, 1, 2].map((k) => g[k] * p.along * l1) : [0, 1, 2].map((k) => (f[k] * p.along + ax[k] * p.lat + cz[k] * p.dep) * l2), r: p.r * l2 })) };
  });
  const clear = clearance * u, soft = SOFT * u, vols = [];

  // where a probe is in the pose `W0 / P0` (the arm's three bones, indexed 0 upper, 1 fore, 2 hand), and the move that gets it out: adds the push (a vector) into out and returns the depth asked
  function probe(side, pr, out) {
    const b = pr.bone === 2 ? 0 : pr.bone === 0 ? 1 : 2;
    vm(W0.subarray(9 * b, 9 * b + 9), pr.q[0], pr.q[1], pr.q[2], tmp3);
    const x = P0[3 * b] + tmp3[0], y = P0[3 * b + 1] + tmp3[1], z = P0[3 * b + 2] + tmp3[2];
    let best = 0;
    for (const v of vols) {
      const d = v.signed(x, y, z, N), delta = clear + pr.r - d;                    // how far inside the clearance
      const m = must(delta, soft);
      if (m > best) { best = m; out[0] = N[0]; out[1] = N[1]; out[2] = N[2]; }
    }
    return best;
  }

  return {
    /** Where each probe stands in a pose against the volumes: [{ side, name, gap }], gap the distance from the probe's sphere to the nearest volume (negative: inside). For checks. */
    report(bones, ctx = {}) {
      vols.length = 0; for (const v of volumes(bones, ctx)) vols.push(v);
      const out = [];
      for (const [i, sd] of sides.entries()) {
        for (let k = 0; k < 3; k++) { const b = [sd.up, sd.fo, sd.ha][k]; for (let c = 0; c < 9; c++) W0[9 * k + c] = bones.W[9 * b + c]; for (let c = 0; c < 3; c++) P0[3 * k + c] = bones.P[3 * b + c]; }
        for (const pr of sd.probes) {
          const b = pr.bone === 2 ? 0 : pr.bone === 0 ? 1 : 2; vm(W0.subarray(9 * b, 9 * b + 9), pr.q[0], pr.q[1], pr.q[2], tmp3);
          let gap = Infinity; for (const v of vols) gap = Math.min(gap, v.signed(P0[3 * b] + tmp3[0], P0[3 * b + 1] + tmp3[1], P0[3 * b + 2] + tmp3[2], N) - pr.r);
          out.push({ side: i ? "R" : "L", name: pr.name, gap });
        }
      }
      return out;
    },
    apply(bones, ctx = {}) {
      vols.length = 0; for (const v of volumes(bones, ctx)) vols.push(v);
      if (!vols.length) return;
      const { W, P } = bones;
      for (const sd of sides) {
        const { up, fo, ha } = sd;
        // the pose as it came
        for (const [i, b] of [up, fo, ha].entries()) { for (let k = 0; k < 9; k++) W0[9 * i + k] = W[9 * b + k]; for (let k = 0; k < 3; k++) P0[3 * i + k] = P[3 * b + k]; }
        const E0x = P0[3], E0y = P0[4], E0z = P0[5], T0x = P0[6], T0y = P0[7], T0z = P0[8];
        originalBend(sd, W, P);                     // the side her elbow is on, and how far: U0, RHO0
        // the wrist target and the elbow's hint, found from the original pose and moved by what the probes ask, the arm re-posed by IK each round (rounds, not a solve: the
        // hand's probes move with the forearm's turn)
        let tx = T0x, ty = T0y, tz = T0z, hx = 0, hy = 0, hz = 0, moved = false;          // (hx, hy, hz): what the elbow's own probes have asked of it
        for (let it = 0; it < iterations; it++) {
          // the arm as IK puts it for the target (tx, ty, tz) and the elbow's hint (hx, hy, hz): into W0 / P0
          solve(sd, W, P, tx, ty, tz, hx, hy, hz);
          // the deepest probe of each part of the arm decides that part's move (not the sum: the probes of a hand overlap, and nine pushes on one wrist would overshoot ninefold).
          // A probe part-way along the arm is moved by turning the arm about the shoulder: the wrist goes by the push over the probe's share of the way out (so the elbow, half way,
          // asks twice its depth of the wrist, to at most 1.6 times: the rounds make up the rest, and the move stays gentle), and the elbow's own side is moved by the push.
          let any = false, mh = 0, mf = 0, me = 0, sf = 1, se = 1;
          for (const pr of sd.probes) {
            const m = probe(sd, pr, T);
            if (m <= 1e-7) continue;
            any = true;
            const share = clamp(pr.bone === 2 ? (pr.along * sd.l1) / (sd.l1 + sd.l2) : pr.bone === 0 ? (sd.l1 + pr.along * sd.l2) / (sd.l1 + sd.l2) : 1, 0.3, 1);
            if (pr.bone === 1) { if (m > mh) { mh = m; GH[0] = T[0]; GH[1] = T[1]; GH[2] = T[2]; } }
            else if (m / share > mf / sf) { mf = m; sf = share; GF[0] = T[0]; GF[1] = T[1]; GF[2] = T[2]; }
          }
          if (mh) { tx += GH[0] * mh; ty += GH[1] * mh; tz += GH[2] * mh; }                // the hand's probes move the wrist
          if (mf) { hx += GF[0] * mf; hy += GF[1] * mf; hz += GF[2] * mf; const g = Math.min(1 / sf, 1.6); tx += GF[0] * mf * g; ty += GF[1] * mf * g; tz += GF[2] * mf * g; }
          moved = moved || any;
          if (!any) break;
        }
        if (!moved) continue;
        solve(sd, W, P, tx, ty, tz, hx, hy, hz);
        for (const [i, b] of [up, fo, ha].entries()) { for (let k = 0; k < 9; k++) W[9 * b + k] = W0[9 * i + k]; for (let k = 0; k < 3; k++) P[3 * b + k] = P0[3 * i + k]; }
      }
    },
  };

  // the side the elbow was on and how far from the line shoulder-to-wrist (U0 a unit vector square to that line, RHO0 the distance), read from the pose as it came; a straight arm has
  // no side of its own, so it bends the way an elbow does (back, the forearm's flexion carrying it forward: the upper arm's own -z)
  function originalBend(sd, W, P) {
    const { up, fo, ha, l1, l2 } = sd, sx = P[3 * up], sy = P[3 * up + 1], sz = P[3 * up + 2];
    let dx = P[3 * ha] - sx, dy = P[3 * ha + 1] - sy, dz = P[3 * ha + 2] - sz; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9; dx /= d; dy /= d; dz /= d;
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    let ux = P[3 * fo] - sx - dx * a, uy = P[3 * fo + 1] - sy - dy * a, uz = P[3 * fo + 2] - sz - dz * a;
    let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (ul > 1e-4 * l1) { sd.rho0 = ul; sd.u0 = [ux / ul, uy / ul, uz / ul]; return; }
    ux = -W[9 * up + 2]; uy = -W[9 * up + 5]; uz = -W[9 * up + 8]; const pn = ux * dx + uy * dy + uz * dz; ux -= pn * dx; uy -= pn * dy; uz -= pn * dz; ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    sd.rho0 = 0; sd.u0 = [ux / ul, uy / ul, uz / ul];
  }

  // two-bone IK from the shoulder (as the bones had it, in W and P: which are never written until the end) to the wrist target (tx..), the elbow on its circle on the side it was
  // (sd.u0), moved by what its probes asked (hx..: the push, so with none it is where it was, and a tiny push turns it a tiny way: the elbow's offset has at least RHOMIN of the
  // upper arm's length, so a straight arm has a side to turn from), written into W0 / P0.
  function solve(sd, W, P, tx, ty, tz, hx, hy, hz) {
    const { up, fo, ha, l1, l2 } = sd, sx = P[3 * up], sy = P[3 * up + 1], sz = P[3 * up + 2];
    let dx = tx - sx, dy = ty - sy, dz = tz - sz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    const dmax = l1 + l2, dmin = Math.abs(l1 - l2) + 1e-4, dd = clamp(d, dmin, dmax);
    dx /= d; dy /= d; dz /= d;
    const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), rho = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const cx = sx + dx * a, cy = sy + dy * a, cz = sz + dz * a;
    // the elbow on its circle: the side it was on (square to the new line) with the push added
    let u0x = sd.u0[0], u0y = sd.u0[1], u0z = sd.u0[2]; const pn0 = u0x * dx + u0y * dy + u0z * dz; u0x -= pn0 * dx; u0y -= pn0 * dy; u0z -= pn0 * dz;
    const u0l = Math.sqrt(u0x * u0x + u0y * u0y + u0z * u0z) || 1; u0x /= u0l; u0y /= u0l; u0z /= u0l;
    const pn1 = hx * dx + hy * dy + hz * dz, w0 = Math.max(sd.rho0, RHOMIN * l1);
    let ux = u0x * w0 + (hx - pn1 * dx), uy = u0y * w0 + (hy - pn1 * dy), uz = u0z * w0 + (hz - pn1 * dz);
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const Ex = cx + ux * rho, Ey = cy + uy * rho, Ez = cz + uz * rho, Tx = sx + dx * dd, Ty = sy + dy * dd, Tz = sz + dz * dd;
    // the upper arm turns from where it pointed to the new elbow, the forearm from where it then points to the wrist
    const ox = P[3 * fo] - sx, oy = P[3 * fo + 1] - sy, oz = P[3 * fo + 2] - sz, ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
    between(R1, ox / ol, oy / ol, oz / ol, (Ex - sx) / l1, (Ey - sy) / l1, (Ez - sz) / l1);
    const fx = P[3 * ha] - P[3 * fo], fy = P[3 * ha + 1] - P[3 * fo + 1], fz = P[3 * ha + 2] - P[3 * fo + 2], fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    vm(R1, fx / fl, fy / fl, fz / fl, tmp3);
    between(R2, tmp3[0], tmp3[1], tmp3[2], (Tx - Ex) / l2, (Ty - Ey) / l2, (Tz - Ez) / l2);
    m3(R3, R2, R1);
    for (const [R, b, i] of [[R1, up, 0], [R3, fo, 1], [R3, ha, 2]]) { m3(RT, R, W.subarray(9 * b, 9 * b + 9)); for (let k = 0; k < 9; k++) W0[9 * i + k] = RT[k]; }
    P0[0] = sx; P0[1] = sy; P0[2] = sz; P0[3] = Ex; P0[4] = Ey; P0[5] = Ez; P0[6] = Tx; P0[7] = Ty; P0[8] = Tz;
  }
}
