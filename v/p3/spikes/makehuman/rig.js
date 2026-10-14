// The MakeHuman body's rig (M2, R5): MakeHuman's game_engine skin weights and joint cubes (CC0) put onto the walker's 21 bones
// (spikes/crowd/body.js BONES), so a baked person is skinned and walked exactly as the stand-in body is. Data packed by
// tools/mh/rig.py into data/rig.json + rig.bin.gz. Deterministic: + - * and sqrt only, so every machine gets the same joints.
//
//   rig(P, { neutral = true })
//     P      the packed vertices of a baked person (bake()'s P, or build()'s P after its scaling): 14,888 x 3, the original
//            body vertices first, then the eye helpers, then the base layer's. Any length unit.
//   returns
//     joints     { J, tip, u, sk } in body.js joints(p)'s layout: J[21] bone heads, tip.{head,handL,handR,toeL,toeR}, u = height / 1.75,
//                sk the shin length. In P's unit, feet where P has them.
//     position   P, with the A-pose put to the walker's neutral stance (below); use it in place of P
//     body       { skinIndex Uint16Array(4 x UVN), skinWeight Float32Array(4 x UVN) } the drawn body, seam copies taking their
//                original's weights
//     garment    the same for the base layer's vertices (a local index, like build()'s cloth geometry)
//     skinIndex, skinWeight   the same over all 14,888 packed vertices (eyes, then base layer, as packed)
//   The weights are the same for every person, so body, garment, skinIndex and skinWeight are shared between calls: read only.
//   A call takes about 2 ms warm (the bake is about 1 ms), so it belongs where the bake runs.
//
// The neutral stance. MakeHuman's base is in an A-pose (arms 40 degrees out, forearms forward) with the legs a little apart; the
// walker's bones all start at identity rotation, with arms and legs hanging straight down. So the person is put in the walker's
// rest pose once, at build, by skinning the rest shape with the walker's own bones: each arm turned about the shoulder and elbow
// to hang (slightly out, so the hands clear the hips), each leg turned about the hip and knee to stand vertical, the feet kept
// flat. The same weights do it, so the same candy-wrapper rules hold at the shoulder and elbow here as in the walk. The body
// is lowered or raised so its lowest point stays where it was.
import { SEAM } from "./index.js";
import { gz, json } from "./load.js";

const DATA = new URL("./data/", import.meta.url);
const H = await json(new URL("rig.json", DATA));
const buf = await gz(new URL("rig.bin.gz", DATA));

export const BONES = H.bones;
export const N = H.vertices, BODY = H.body;           // packed vertices; the first BODY are the drawn body's originals
const [GS, GN] = H.garment, K = H.influences;
const SKIN_I = new Uint8Array(buf, 0, N * K), SKIN_W = new Uint8Array(buf, N * K, N * K);
const SHELLS = [];
{
  let o = 2 * N * K;
  for (const j of H.joints) { SHELLS.push(new Uint16Array(buf.slice(o, o + j.n * 2))); o += j.n * 2; }
}
const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));
const INV255 = 1 / 255;

// the weights are the same for every person: decoded once, shared, never written to
const skinIndex = new Uint16Array(N * K), skinWeight = new Float32Array(N * K);
for (let i = 0; i < N * K; i++) { skinIndex[i] = SKIN_I[i]; skinWeight[i] = SKIN_W[i] * INV255; }
const nCopies = SEAM ? SEAM.length : 0, UVN = BODY + nCopies;
const body = { skinIndex: new Uint16Array(UVN * K), skinWeight: new Float32Array(UVN * K) };
body.skinIndex.set(skinIndex.subarray(0, BODY * K)); body.skinWeight.set(skinWeight.subarray(0, BODY * K));
for (let j = 0; j < nCopies; j++) {
  body.skinIndex.set(skinIndex.subarray(SEAM[j] * K, SEAM[j] * K + K), (BODY + j) * K);
  body.skinWeight.set(skinWeight.subarray(SEAM[j] * K, SEAM[j] * K + K), (BODY + j) * K);
}
const garment = { skinIndex: skinIndex.slice(GS * K, (GS + GN) * K), skinWeight: skinWeight.slice(GS * K, (GS + GN) * K) };

/** The skin weights, shared by everyone: over all packed vertices (4 influences each), the drawn body, and the base layer. Read only. */
export const SKIN = { influences: K, skinIndex, skinWeight, body, garment };

// unit vector and the rotation (row-major 3x3) that turns unit a onto unit b by the shortest way
const unit = (v) => { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1, i = 1 / l; return [v[0] * i, v[1] * i, v[2] * i]; };
function turn(a, b) {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0], c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k = 1 / (1 + c);        // the arms and legs never turn through 180 degrees
  return [1 + (-z * z - y * y) * k, -z + x * y * k, y + x * z * k,
          z + x * y * k, 1 + (-z * z - x * x) * k, -x + y * z * k,
          -y + x * z * k, x + y * z * k, 1 + (-y * y - x * x) * k];
}
const mul = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; };
const apply = (R, t, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + t[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + t[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + t[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], Z3 = [0, 0, 0];
// x' = R x + t about a pivot that moves to `to`
const about = (R, pivot, to) => { const r = apply(R, Z3, pivot); return [R, [to[0] - r[0], to[1] - r[1], to[2] - r[2]]]; };

export function rig(P, opts = {}) {
  if (P.length !== N * 3) throw new Error(`rig: expected ${N} packed vertices, got ${P.length / 3}`);
  // ---- joints: the mean of each joint's shell plus its offset from the base mesh, the offset scaled by the shell's growth
  const at = H.joints.map((j, k) => {
    const s = SHELLS[k], m = [0, 0, 0], inv = 1 / s.length;
    for (let i = 0; i < s.length; i++) { const o = s[i] * 3; m[0] += P[o]; m[1] += P[o + 1]; m[2] += P[o + 2]; }
    m[0] *= inv; m[1] *= inv; m[2] *= inv;
    let q = 0;
    for (let i = 0; i < s.length; i++) { const o = s[i] * 3, a = P[o] - m[0], b = P[o + 1] - m[1], c = P[o + 2] - m[2]; q += a * a + b * b + c * c; }
    const g = Math.sqrt(q * inv) / j.spread;
    return [m[0] + j.offset[0] * g, m[1] + j.offset[1] * g, m[2] + j.offset[2] * g];
  });
  const B = BONES.length, J = at.slice(0, B), tip = {};
  H.joints.forEach((j, k) => { if (j.kind === "tip") tip[j.name] = at[k]; });
  const T = BONES.map(() => [ID, Z3]);                  // the neutral stance: x' = R x + t per walker bone
  let position = P;
  if (opts.neutral !== false) {
    for (const [S, s] of [["L", 1], ["R", -1]]) {
      const sh = J[BI["upperarm" + S]], el = J[BI["forearm" + S]], wr = J[BI["hand" + S]];
      const lean = unit([s * 0.12, -1, 0]);              // 7 degrees out
      const R1 = turn(unit(sub(el, sh)), lean), [, t1] = about(R1, sh, sh);
      const el2 = apply(R1, t1, el);
      const R2 = mul(turn(unit(apply(R1, Z3, sub(wr, el))), lean), R1), [, t2] = about(R2, el, el2);
      T[BI["upperarm" + S]] = [R1, t1]; T[BI["forearm" + S]] = [R2, t2]; T[BI["hand" + S]] = [R2, t2];
      const hp = J[BI["thigh" + S]], kn = J[BI["shin" + S]], an = J[BI["foot" + S]];
      const leg = (a, b, in_) => { const d = unit(sub(b, a)); return unit([-s * in_ * -d[1], d[1], d[2]]); };   // the frontal lean goes to 1 degree in
      const R3 = turn(unit(sub(kn, hp)), leg(hp, kn, 0.02)), [, t3] = about(R3, hp, hp);
      const kn2 = apply(R3, t3, kn);
      const R4 = mul(turn(unit(apply(R3, Z3, sub(an, kn))), leg(kn, an, 0.02)), R3), [, t4] = about(R4, kn, kn2);
      const an2 = apply(R4, t4, an);
      T[BI["thigh" + S]] = [R3, t3]; T[BI["shin" + S]] = [R4, t4];
      T[BI["foot" + S]] = [ID, sub(an2, an)]; T[BI["toe" + S]] = [ID, sub(an2, an)];
    }
    const M = new Float64Array(B * 12), moved = new Uint8Array(B);     // per bone: R row-major, then t
    for (let b = 0; b < B; b++) {
      const [R, t] = T[b];
      for (let i = 0; i < 9; i++) M[b * 12 + i] = R[i];
      for (let i = 0; i < 3; i++) M[b * 12 + 9 + i] = t[i];
      moved[b] = (R !== ID || t[0] !== 0 || t[1] !== 0 || t[2] !== 0) ? 1 : 0;
    }
    position = new Float32Array(P.length);
    for (let v = 0; v < N; v++) {
      const px = P[3 * v], py = P[3 * v + 1], pz = P[3 * v + 2], v4 = v * K;
      let any = 0;
      for (let k = 0; k < K; k++) any |= moved[SKIN_I[v4 + k]] & (SKIN_W[v4 + k] > 0 ? 1 : 0);
      if (!any) { position[3 * v] = px; position[3 * v + 1] = py; position[3 * v + 2] = pz; continue; }
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < K; k++) {
        const w = SKIN_W[v4 + k]; if (!w) continue;
        const o = SKIN_I[v4 + k] * 12, f = w * INV255;
        x += f * (M[o] * px + M[o + 1] * py + M[o + 2] * pz + M[o + 9]); y += f * (M[o + 3] * px + M[o + 4] * py + M[o + 5] * pz + M[o + 10]); z += f * (M[o + 6] * px + M[o + 7] * py + M[o + 8] * pz + M[o + 11]);
      }
      position[3 * v] = x; position[3 * v + 1] = y; position[3 * v + 2] = z;
    }
    for (let b = 0; b < B; b++) J[b] = apply(T[b][0], T[b][1], J[b]);
    for (const n of Object.keys(tip)) { const b = n === "head" ? BI.head : BI[n]; tip[n] = apply(T[b][0], T[b][1], tip[n]); }
    // the lowest body vertex stays where it was
    let lo0 = Infinity, lo1 = Infinity;
    for (let v = 0; v < BODY; v++) { lo0 = Math.min(lo0, P[3 * v + 1]); lo1 = Math.min(lo1, position[3 * v + 1]); }
    const dy = lo0 - lo1;
    for (let v = 0; v < N; v++) position[3 * v + 1] += dy;
    for (const q of J) q[1] += dy;
    for (const n of Object.keys(tip)) tip[n][1] += dy;
  }
  let hi = -Infinity, lo = Infinity;
  for (let v = 0; v < BODY; v++) { const y = position[3 * v + 1]; if (y > hi) hi = y; if (y < lo) lo = y; }
  const hgt = hi - lo, sk = Math.sqrt((J[BI.shinL][0] - J[BI.footL][0]) ** 2 + (J[BI.shinL][1] - J[BI.footL][1]) ** 2 + (J[BI.shinL][2] - J[BI.footL][2]) ** 2);
  return { joints: { J, tip, u: hgt / 1.75, sk }, position, body, garment, skinIndex, skinWeight };
}
