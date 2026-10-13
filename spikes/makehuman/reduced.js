// The reduced body (R5, the crowd's mid and far tiers): about 1.5-2k vertices a person instead of 13k, read off a baked full
// body by one fixed map, and the far tier's morph basis on it. Data: data/reduced-N.{json,bin.gz} (tools/mh/reduce.py),
// data/far-N.{json,bin.gz} (tools/mh/reduce-check.mjs).
//
// The binding is MakeHuman's clothing idea (.mhclo) applied to the body: each reduced vertex is three full-body vertices,
// barycentric weights, and an offset in that triangle's own frame (tangent along its first edge, bitangent, normal) in
// units of the triangle's mean edge length. So the reduced body of any baked person is their own full body, simplified,
// with nothing fitted per person. Only + - * / and sqrt, so every engine gives the same bits.
//
// Drawn vertices: 0..R-1 are the geometric vertices; R..D-1 are copies of one (copy[j - R]) that carry another UV chart
// or the other side of the base layer's hem, so a seam or a hem is a split and shading stays continuous across it
// (the same device as UV seam copies in index.js). `cloth` is 1 where the base layer (the tights) covers the body there:
// the layer is carried as a flag on the body, so a reduced person is one mesh and is never drawn unclothed.
import { gz, json as readJson } from "./load.js";
const DATA = new URL("./data/", import.meta.url);
const bytes = (name) => gz(new URL(name, DATA));
const json = (name) => readJson(new URL(name, DATA));

export async function loadReduced(name = "reduced-1500") {
  const h = await json(name + ".json"), buf = await bytes(name + ".bin.gz");
  const R = h.vertices, D = h.drawn, T = h.triangles;
  let o = 0;
  const take = (C, n, size) => { const a = new C(buf, o, n); o += n * size; return a; };
  const w = take(Float32Array, R * 3, 4), off = take(Float32Array, R * 3, 4), uv = take(Float32Array, D * 2, 4);
  const ids = take(Uint16Array, R * 3, 2), index = take(Uint16Array, T * 3, 2), copy = take(Uint16Array, D - R, 2);
  const cloth = take(Uint8Array, D, 1);
  const owner = new Uint16Array(D);                      // drawn vertex -> geometric vertex
  for (let i = 0; i < R; i++) owner[i] = i;
  for (let j = 0; j < D - R; j++) owner[R + j] = copy[j];
  const geo = new Uint16Array(T * 3);                    // the triangles on geometric vertices, for normals
  for (let i = 0; i < T * 3; i++) geo[i] = owner[index[i]];
  const R3 = R * 3;

  /** P: a baked full body (index.js bake().P, positions of the drawn body first) after `place`. Fills and returns
   *  { position, normal } over the D drawn vertices (Float32Array D*3 each; pass `out` to reuse the arrays). */
  function reduce(P, out = { position: new Float32Array(D * 3), normal: new Float32Array(D * 3) }) {
    const pos = out.position;
    for (let r = 0; r < R; r++) {
      const a = ids[3 * r] * 3, b = ids[3 * r + 1] * 3, c = ids[3 * r + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const ux = P[b] - ax, uy = P[b + 1] - ay, uz = P[b + 2] - az;      // first edge: the tangent
      const vx = P[c] - ax, vy = P[c + 1] - ay, vz = P[c + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz), nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const wx = P[c] - P[b], wy = P[c + 1] - P[b + 1], wz = P[c + 2] - P[b + 2];
      const s = (ul + Math.sqrt(wx * wx + wy * wy + wz * wz) + Math.sqrt(vx * vx + vy * vy + vz * vz)) / 3;   // the mean edge length
      const tx = ux / ul, ty = uy / ul, tz = uz / ul;
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;                          // n x t
      const w0 = w[3 * r], w1 = w[3 * r + 1], w2 = w[3 * r + 2], ot = off[3 * r] * s, ob = off[3 * r + 1] * s, on = off[3 * r + 2] * s;
      pos[3 * r] = ax * w0 + P[b] * w1 + P[c] * w2 + tx * ot + bx * ob + nx * on;
      pos[3 * r + 1] = ay * w0 + P[b + 1] * w1 + P[c + 1] * w2 + ty * ot + by * ob + ny * on;
      pos[3 * r + 2] = az * w0 + P[b + 2] * w1 + P[c + 2] * w2 + tz * ot + bz * ob + nz * on;
    }
    settle(out);
    return out;
  }

  /** Normals from the reduced triangles (area-weighted, as index.js settleBody), then the copies of position and normal.
   *  The far tier, which never has a full body, calls this alone after it fills position[0 .. R*3). */
  function settle(out) {
    const p = out.position, n = out.normal;
    n.fill(0, 0, R3);
    for (let t = 0; t < geo.length; t += 3) {
      const a = geo[t] * 3, b = geo[t + 1] * 3, c = geo[t + 2] * 3;
      const cx = p[c] - p[b], cy = p[c + 1] - p[b + 1], cz = p[c + 2] - p[b + 2], ax = p[a] - p[b], ay = p[a + 1] - p[b + 1], az = p[a + 2] - p[b + 2];
      const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
      for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
    }
    for (let i = 0; i < R3; i += 3) { const l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    for (let j = R; j < D; j++) {
      const a = j * 3, b = copy[j - R] * 3;
      p[a] = p[b]; p[a + 1] = p[b + 1]; p[a + 2] = p[b + 2]; n[a] = n[b]; n[a + 1] = n[b + 1]; n[a + 2] = n[b + 2];
    }
    return out;
  }
  return { name, header: h, R, D, T, index, copy, owner, uv, cloth, ids, weights: w, offset: off, fullBody: h.fullBody, reduce, settle };
}

/** Feet on y = 0 and the stated height, as index.js build() does, in place on a baked full body P (decimetres in, metres
 *  out; `bodyVertices` are the drawn body's, the first of them). Returns P. */
export function place(P, height, bodyVertices = 13380) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < bodyVertices; i++) { const y = P[3 * i + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  const s = height / (hi - lo);
  for (let i = 0, n = P.length / 3; i < n; i++) { P[3 * i] *= s; P[3 * i + 1] = (P[3 * i + 1] - lo) * s; P[3 * i + 2] *= s; }
  return P;
}

// ---- the far tier's basis: the reduced body at unit height is mean + sum of coef[k] * basis[k]; the person's height is an
// exact scale. Written by tools/people/far-fit.mjs (PCA on reduced bodies after the rig's repose, from the trait prior across
// every age), which also fits the normals (a least-squares line through the same coefficients, so shading follows the shape).
//   far-N.json   { reduced, vertices (R), k, meanScale, scale: per-direction steps (int16 -> unit-height metres),
//                  nMeanScale, nScale: the same for normals }
//   far-N.bin.gz position mean, k position directions, normal mean, k normal directions: each int16 x3R
export async function loadFar(name = "far-1500") {
  const h = await json(name + ".json"), buf = await bytes(name + ".bin.gz");
  const n = h.vertices * 3, k = h.k;
  const i16 = new Int16Array(buf);
  const mean = new Float32Array(n), basis = new Float32Array(k * n), nmean = new Float32Array(n), nbasis = new Float32Array(k * n);
  for (let i = 0; i < n; i++) mean[i] = i16[i] * h.meanScale;
  for (let j = 0; j < k; j++) for (let i = 0; i < n; i++) basis[j * n + i] = i16[n + j * n + i] * h.scale[j];
  const o = (1 + k) * n;
  if (h.nScale) {      // (a pack fitted before the normals were added has positions only)
    for (let i = 0; i < n; i++) nmean[i] = i16[o + i] * h.nMeanScale;
    for (let j = 0; j < k; j++) for (let i = 0; i < n; i++) nbasis[j * n + i] = i16[o + n + j * n + i] * h.nScale[j];
  }
  return {
    header: h, k, mean, basis, nmean, nbasis,
    /** the k coefficients of a reduced body (positions of the geometric vertices, metres) of the given height */
    coefs(position, height, c = new Float32Array(k)) {
      const inv = 1 / height;
      for (let j = 0; j < k; j++) { let s = 0; for (let i = 0; i < n; i++) s += (position[i] * inv - mean[i]) * basis[j * n + i]; c[j] = s; }
      return c;
    },
    /** fills position[0 .. R*3) from coefficients and the exact height */
    position(c, height, position) {
      for (let i = 0; i < n; i++) {
        let s = mean[i];
        for (let j = 0; j < k; j++) s += c[j] * basis[j * n + i];
        position[i] = s * height;
      }
      return position;
    },
    /** fills normal[0 .. R*3) from coefficients, normalised (what the far tier's shader does) */
    normal(c, normal) {
      for (let i = 0; i < n; i++) {
        let s = nmean[i];
        for (let j = 0; j < k; j++) s += c[j] * nbasis[j * n + i];
        normal[i] = s;
      }
      for (let i = 0; i < n; i += 3) { const l = Math.sqrt(normal[i] * normal[i] + normal[i + 1] * normal[i + 1] + normal[i + 2] * normal[i + 2]) || 1; normal[i] /= l; normal[i + 1] /= l; normal[i + 2] /= l; }
      return normal;
    },
  };
}
