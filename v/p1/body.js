// The crowd probe's stand-in body (M1, R2): a procedural humanoid with 21 bones, a few thousand vertices and a walk made of a few
// sine harmonics per joint. Pure JS (no three.js) so it runs in Node too. Its looks don't matter; it exists to compare crowd mechanisms.
// Everything is deterministic from a seed.
//
// A body is built from 16 proportion parameters (PARAMS). Bones have identity rest rotations, so the gait's world rotations are the
// same for every body; only the joint positions differ. For a body with rest joints j and a gait frame, bone b's skinning transform is
//   x' = R_b x + u_b,  u_b = P_b - R_b j_b
// where R_b is the bone's world rotation (shared by everyone) and P_b its posed joint position (per body). So a rig is R (shared) plus
// u per body per frame: one vec3 per bone per frame.

export const PARAMS = [
  // name, mean, spread (+-), what it does
  ["height", 1.72, 0.22], ["leg", 0.48, 0.035], ["arm", 1.0, 0.09], ["shoulder", 1.0, 0.12],
  ["hip", 1.0, 0.15], ["chest", 1.0, 0.2], ["belly", 1.0, 0.3], ["limb", 1.0, 0.22],
  ["head", 1.0, 0.12], ["neck", 1.0, 0.25], ["foot", 1.0, 0.12], ["thigh", 1.0, 0.25],
  ["slope", 1.0, 0.5], ["depth", 1.0, 0.18], ["hand", 1.0, 0.15], ["torso", 1.0, 0.08],
];
export const MEAN = PARAMS.map(p => p[1]);

export function rng(seed) {             // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// a person's parameters: roughly normal around the mean, clipped to +-1.6 spreads
export function randomParams(r) {
  return PARAMS.map(([, m, s]) => { const g = (r() + r() + r() - 1.5) * 2; return m + s * Math.max(-1.6, Math.min(1.6, g)); });
}

// bones: name, parent
export const BONES = [
  ["hips", -1], ["spine", 0], ["chest", 1], ["neck", 2], ["head", 3],
  ["clavL", 2], ["upperarmL", 5], ["forearmL", 6], ["handL", 7],
  ["clavR", 2], ["upperarmR", 9], ["forearmR", 10], ["handR", 11],
  ["thighL", 0], ["shinL", 13], ["footL", 14], ["toeL", 15],
  ["thighR", 0], ["shinR", 17], ["footR", 18], ["toeR", 19],
];
export const B = BONES.length;
const BI = Object.fromEntries(BONES.map(([n], i) => [n, i]));

// rest joints (bone heads) plus the end points of the chain tips, from parameters. Metres, feet at y=0, facing +z.
export function joints(p) {
  const [H, leg, arm, sh, hip, , , , head, neck, foot, , slope, , hand, torso] = p, u = H / 1.75;
  const hipY = H * leg, hh = 0.235 * u * head, neckTop = H - hh, nl = 0.075 * u * neck;
  const shoulderY = hipY + (neckTop - nl - 0.03 * u - hipY) * 0.95 * torso;
  const T = shoulderY - hipY, sw = 0.185 * u * sh, hw = 0.088 * u * hip, drop = 0.035 * u * slope;
  const J = new Array(B), tip = {};
  J[BI.hips] = [0, hipY, 0];
  J[BI.spine] = [0, hipY + 0.28 * T, 0];
  J[BI.chest] = [0, hipY + 0.62 * T, 0];
  J[BI.neck] = [0, shoulderY + 0.02 * u, -0.01 * u];
  J[BI.head] = [0, neckTop, 0];
  tip.head = [0, H, 0.01 * u];
  const ua = 0.30 * u * arm, fa = 0.26 * u * arm, ha = 0.18 * u * hand;
  const th = (hipY - 0.07 * u) * 0.52, sk = (hipY - 0.07 * u) * 0.48, fl = 0.2 * u * foot;
  for (const [s, S] of [[1, "L"], [-1, "R"]]) {
    J[BI["clav" + S]] = [s * 0.025 * u, shoulderY - 0.01 * u, 0];
    J[BI["upperarm" + S]] = [s * sw, shoulderY - drop, -0.01 * u];
    J[BI["forearm" + S]] = [s * (sw + 0.035 * u), shoulderY - drop - ua, -0.02 * u];
    J[BI["hand" + S]] = [s * (sw + 0.05 * u), shoulderY - drop - ua - fa, 0.0];
    tip["hand" + S] = [s * (sw + 0.055 * u), shoulderY - drop - ua - fa - ha, 0.01 * u];
    J[BI["thigh" + S]] = [s * hw, hipY - 0.05 * u, 0];
    J[BI["shin" + S]] = [s * hw * 0.95, hipY - 0.05 * u - th, 0.01 * u];
    J[BI["foot" + S]] = [s * hw * 0.92, 0.075 * u, -0.01 * u];
    J[BI["toe" + S]] = [s * hw * 0.98, 0.025 * u, -0.01 * u + fl * 0.72];
    tip["toe" + S] = [s * hw, 0.02 * u, -0.01 * u + fl];
  }
  return { J, tip, u, sk };
}

// segments: the bone, its start (the bone's joint) and end (a child joint or tip), cross-section radii (width, depth) at both ends,
// extensions past each end (for overlap at joints), ring and radial counts, and which neighbour bones blend in at each end.
function segments(p, jt) {
  const [, , , , hip, chest, belly, limb, head, , foot, thigh, , depth, hand] = p, { J, tip, u } = jt;
  const L = limb, D = depth, S = [];
  const seg = (bone, a, b, r0, r1, rings, radial, ext0, ext1, blend0, blend1) => S.push({ bone: BI[bone], a, b, r0, r1, rings, radial, ext0, ext1, blend0: blend0 == null ? -1 : BI[blend0], blend1: blend1 == null ? -1 : BI[blend1] });
  seg("hips", J[BI.hips].map((v, i) => i === 1 ? v - 0.09 * u : v), J[BI.spine], [0.165 * u * hip, 0.11 * u * D], [0.14 * u * belly, 0.10 * u * D * belly], 12, 22, 0.15, 0.1, null, "spine");
  seg("spine", J[BI.spine], J[BI.chest], [0.14 * u * belly, 0.10 * u * D * belly], [0.16 * u * chest, 0.105 * u * D * chest], 10, 22, 0.1, 0.15, "hips", "chest");
  seg("chest", J[BI.chest], J[BI.neck], [0.16 * u * chest, 0.105 * u * D * chest], [0.13 * u * chest, 0.08 * u * D], 12, 22, 0.1, 0.25, "spine", "neck");
  seg("neck", J[BI.neck], J[BI.head], [0.05 * u * L, 0.05 * u * L], [0.048 * u * L, 0.05 * u * L], 5, 12, 0.1, 0.2, "chest", "head");
  seg("head", J[BI.head].map((v, i) => i === 1 ? v - 0.02 * u : v), tip.head, [0.08 * u * head, 0.095 * u * head], [0.075 * u * head, 0.09 * u * head], 12, 18, 0.25, 0.25, "neck", null);
  for (const S_ of ["L", "R"]) {
    seg("clav" + S_, J[BI["clav" + S_]], J[BI["upperarm" + S_]], [0.05 * u, 0.05 * u], [0.06 * u * L, 0.055 * u * L], 5, 10, 0.1, 0.4, "chest", "upperarm" + S_);
    seg("upperarm" + S_, J[BI["upperarm" + S_]], J[BI["forearm" + S_]], [0.05 * u * L, 0.055 * u * L], [0.04 * u * L, 0.042 * u * L], 9, 12, 0.15, 0.12, "clav" + S_, "forearm" + S_);
    seg("forearm" + S_, J[BI["forearm" + S_]], J[BI["hand" + S_]], [0.04 * u * L, 0.042 * u * L], [0.03 * u * L, 0.025 * u * L], 9, 12, 0.12, 0.12, "upperarm" + S_, "hand" + S_);
    seg("hand" + S_, J[BI["hand" + S_]], tip["hand" + S_], [0.035 * u * hand, 0.016 * u * hand], [0.03 * u * hand, 0.013 * u * hand], 6, 10, 0.1, 0.15, "forearm" + S_, null);
    seg("thigh" + S_, J[BI["thigh" + S_]], J[BI["shin" + S_]], [0.085 * u * thigh, 0.09 * u * thigh], [0.055 * u * L, 0.06 * u * L], 11, 14, 0.25, 0.12, "hips", "shin" + S_);
    seg("shin" + S_, J[BI["shin" + S_]], J[BI["foot" + S_]], [0.055 * u * L, 0.06 * u * L], [0.037 * u * L, 0.04 * u * L], 11, 14, 0.12, 0.1, "thigh" + S_, "foot" + S_);
    seg("foot" + S_, J[BI["foot" + S_]], J[BI["toe" + S_]], [0.042 * u * foot, 0.04 * u * foot], [0.045 * u * foot, 0.025 * u * foot], 6, 10, 0.25, 0.1, "shin" + S_, "toe" + S_);
    seg("toe" + S_, J[BI["toe" + S_]], tip["toe" + S_], [0.045 * u * foot, 0.022 * u * foot], [0.035 * u * foot, 0.015 * u * foot], 4, 10, 0.1, 0.2, "foot" + S_, null);
  }
  return S;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// The body: positions, normals, skinIndex (4 per vertex), skinWeight, index; the topology is the same for every parameter set.
export function buildBody(p) {
  const jt = joints(p), S = segments(p, jt);
  const pos = [], si = [], sw = [], idx = [];
  for (const s of S) {
    const d = sub(s.b, s.a), len = Math.hypot(...d), ax = norm(d);
    const ref = Math.abs(ax[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(sub(ref, ax.map(v => v * dot(ax, ref)))), e2 = cross(ax, e1);
    const base = pos.length / 3, t0 = -s.ext0, t1 = 1 + s.ext1;
    const ring = (t, k) => {     // k: 0..1 along the extended length; ends pinch to a cap
      const tc = Math.max(0, Math.min(1, t)), rx = s.r0[0] + (s.r1[0] - s.r0[0]) * tc, rz = s.r0[1] + (s.r1[1] - s.r0[1]) * tc;
      const e = 2 * k - 1, cap = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(e), 6)));
      return [rx * cap, rz * cap];
    };
    const weights = t => {        // bone, start neighbour, end neighbour
      let wb = 1, w0 = 0, w1 = 0;
      if (s.blend0 >= 0 && t < 0.2) { w0 = 0.5 * (1 - smooth(t0, 0.2, t)); }
      if (s.blend1 >= 0 && t > 0.8) { w1 = 0.5 * smooth(0.8, t1, t); }
      wb = 1 - w0 - w1;
      return [[s.bone, Math.max(0, s.blend0), Math.max(0, s.blend1), 0], [wb, w0, w1, 0]];
    };
    const R = s.rings, N = s.radial;
    for (let r = 0; r <= R; r++) {
      const k = r / R, t = t0 + (t1 - t0) * k, c = s.a.map((v, i) => v + d[i] * t), [rx, rz] = ring(t, k), [ii, ww] = weights(t);
      for (let n = 0; n < N; n++) {
        const th = (n / N) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        pos.push(c[0] + e1[0] * rx * cs + e2[0] * rz * sn, c[1] + e1[1] * rx * cs + e2[1] * rz * sn, c[2] + e1[2] * rx * cs + e2[2] * rz * sn);
        si.push(...ii); sw.push(...ww);
      }
    }
    for (let r = 0; r < R; r++) for (let n = 0; n < N; n++) {
      const a = base + r * N + n, b = base + r * N + (n + 1) % N, c = a + N, e = b + N;
      idx.push(a, b, c, b, e, c);
    }
    // the rings at k=0 and k=1 have zero radius, so the tube is closed without separate caps
    void len;
  }
  const P = new Float32Array(pos), I = new Uint32Array(idx);
  return { position: P, normal: computeNormals(P, I), skinIndex: new Uint16Array(si), skinWeight: new Float32Array(sw), index: I, joints: jt };
}

export function computeNormals(P, I) {
  const Nn = new Float32Array(P.length);
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { Nn[v] += nx; Nn[v + 1] += ny; Nn[v + 2] += nz; }
  }
  for (let v = 0; v < Nn.length; v += 3) { const l = Math.hypot(Nn[v], Nn[v + 1], Nn[v + 2]) || 1; Nn[v] /= l; Nn[v + 1] /= l; Nn[v + 2] /= l; }
  return Nn;
}

// ---- the walk: local rotations per bone as a few sine harmonics of the phase (0..1), and a hip bob and sway ----
const TAU = Math.PI * 2;
function localEuler(b, ph) {             // [pitch about x, yaw about y, roll about z]; body faces +z, so a leg swings forward at negative pitch
  const s1 = Math.sin(TAU * ph), c1 = Math.cos(TAU * ph), s2 = Math.sin(2 * TAU * ph);
  const name = BONES[b][0], side = name.endsWith("R") ? 0.5 : 0, q = ph + side, S1 = Math.sin(TAU * q), S2 = Math.sin(2 * TAU * q), C1 = Math.cos(TAU * q);
  const sg = name.endsWith("R") ? -1 : 1;
  switch (name) {
    case "hips": return [0.04 + 0.02 * s2, 0.10 * s1, 0.05 * c1];
    case "spine": return [0.02, -0.06 * s1, -0.03 * c1];
    case "chest": return [0.01 + 0.015 * s2, -0.10 * s1, -0.02 * c1];
    case "neck": return [-0.02, 0.05 * s1, 0.01 * c1];
    case "head": return [-0.03 - 0.01 * s2, 0.03 * s1, 0];
    case "clavL": case "clavR": return [0.04 * S1, 0, 0];
    case "upperarmL": case "upperarmR": return [0.38 * S1 + 0.03 * S2 + 0.02, 0, sg * 0.10];
    case "forearmL": case "forearmR": return [-0.25 - 0.15 * Math.max(0, S1) - 0.05 * S2, 0, 0];
    case "handL": case "handR": return [-0.05 + 0.05 * S1, 0, 0];
    case "thighL": case "thighR": return [-0.42 * S1 - 0.06 * S2 - 0.05, 0, sg * -0.02 * C1];
    case "shinL": case "shinR": return [Math.max(0, 0.32 + 0.30 * Math.sin(TAU * q - 1.3) + 0.22 * Math.sin(2 * TAU * q - 0.4)), 0, 0];
    case "footL": case "footR": return [0.18 * Math.sin(TAU * q + 0.6) - 0.05 * S2, 0, 0];
    case "toeL": case "toeR": return [Math.max(0, -0.4 * Math.sin(TAU * q + 1.2)), 0, 0];
  }
  return [0, 0, 0];
}
// rotation matrices, row-major 3x3 in flat arrays
function eulerMat([x, y, z]) {          // R = Ry * Rx * Rz
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Ry, mul3(Rx, Rz));
}
export function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

// world rotations of every bone at a phase: shared by all bodies (rest rotations are identity)
export function worldRotations(ph) {
  const W = new Array(B);
  for (let b = 0; b < B; b++) { const L = eulerMat(localEuler(b, ph)), pa = BONES[b][1]; W[b] = pa < 0 ? L : mul3(W[pa], L); }
  return W;
}
// a body's skinning offsets u_b = P_b - R_b j_b at a phase, given its rest joints
export function offsets(J, W, ph, hipY) {
  const P = new Array(B), U = new Array(B);
  for (let b = 0; b < B; b++) {
    const pa = BONES[b][1];
    if (pa < 0) P[b] = [J[b][0] + 0.012 * hipY * Math.sin(TAU * ph), J[b][1] - 0.008 * hipY + 0.022 * hipY * Math.cos(2 * TAU * ph), J[b][2]];
    else P[b] = mv(W[pa], sub(J[b], J[pa])).map((v, i) => v + P[pa][i]);
    const RJ = mv(W[b], J[b]); U[b] = [P[b][0] - RJ[0], P[b][1] - RJ[1], P[b][2] - RJ[2]];
  }
  return U;
}

// The rig bake. F frames, plus a copy of frame 0 at column F, so hardware linear filtering between columns interpolates the cycle
// without wrapping. rot: width F+1, height B*3 (the three columns of R_b). off: rigs packed in blocks of F+1 columns, P blocks a row,
// B rows per block row.
export function bakeRig(jointSets, F = 32, maxWidth = 2048) {
  const Wf = [];
  for (let f = 0; f <= F; f++) Wf.push(worldRotations((f % F) / F));
  const rot = new Float32Array((F + 1) * B * 3 * 4);
  for (let f = 0; f <= F; f++) for (let b = 0; b < B; b++) for (let c = 0; c < 3; c++) {
    const o = ((b * 3 + c) * (F + 1) + f) * 4, m = Wf[f][b];
    rot[o] = m[c]; rot[o + 1] = m[3 + c]; rot[o + 2] = m[6 + c]; rot[o + 3] = 0;
  }
  const R = jointSets.length, perRow = Math.max(1, Math.floor(maxWidth / (F + 1))), blocksX = Math.min(R, perRow), rowsBlocks = Math.ceil(R / perRow);
  const offW = blocksX * (F + 1), offH = rowsBlocks * B, off = new Float32Array(offW * offH * 4);
  jointSets.forEach((J, r) => {
    const bx = r % perRow, by = Math.floor(r / perRow), hipY = J[0][1];
    for (let f = 0; f <= F; f++) {
      const U = offsets(J, Wf[f], (f % F) / F, hipY);
      for (let b = 0; b < B; b++) { const o = ((by * B + b) * offW + bx * (F + 1) + f) * 4; off[o] = U[b][0]; off[o + 1] = U[b][1]; off[o + 2] = U[b][2]; off[o + 3] = 0; }
    }
  });
  return { F, rot, rotW: F + 1, rotH: B * 3, off, offW, offH, perRow };
}

// CPU reference skinning of one body at a phase (for checking the shader in Node, and for pictures without a GPU)
export function skinCPU(body, J, ph) {
  const W = worldRotations(ph), U = offsets(J, W, ph, J[0][1]), P = body.position, out = new Float32Array(P.length);
  for (let v = 0; v < P.length / 3; v++) {
    const x = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    for (let k = 0; k < 4; k++) {
      const w = body.skinWeight[v * 4 + k]; if (!w) continue;
      const b = body.skinIndex[v * 4 + k], y = mv(W[b], x);
      out[v * 3] += w * (y[0] + U[b][0]); out[v * 3 + 1] += w * (y[1] + U[b][1]); out[v * 3 + 2] += w * (y[2] + U[b][2]);
    }
  }
  return out;
}

// a bone's local rotation at a phase as [x, y, z] Euler angles (order YXZ: R = Ry Rx Rz), for three's own Bone objects
export const localEulerAt = (b, ph) => localEuler(b, ph);
