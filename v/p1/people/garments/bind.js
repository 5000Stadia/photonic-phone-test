// The binding (R5, after MakeHuman's .mhclo): each garment vertex is three body vertices, barycentric weights, and an offset in that
// triangle's own frame (tangent along its first edge, bitangent n x t, face normal) in units of the triangle's mean edge length, so a
// garment built once on one body is fitted to any other by the same fixed map (the way spikes/makehuman/reduced.js reads the reduced
// body off the full one). bind() makes it from a garment's vertices on a template body; fit() applies it to a wearer. Only + - * / and
// sqrt, so every engine gives the same bits. The offset's normal part is scaled by `ease` (the wearer's landmark span ratio over the
// template's, see fitScales in bodice.js), as MakeHuman scales offsets by the wearer's own measurements.
import { TriGrid, closestOnTriangle, normalsOf } from "./geom.js";
import { BODY_INDEX, FULL_INDEX, NFULL } from "./wearer.js";

const GRIDS = new Map();       // (positions, triangles) -> grid, kept for the last body bound
const gridFor = (pos, index) => {
  let e = GRIDS.get(index);
  if (!e || e.pos !== pos) { e = { pos, grid: new TriGrid(pos.subarray(0, NFULL * 3), index, 0.04) }; GRIDS.set(index, e); }
  return e.grid;
};

/** The binding of `points` (Float32Array 3 per vertex) to a body's drawn triangles (or the given subset of them). Each point is bound to the triangle nearest its
 *  `anchor` (the point on the surface it stands off from, when the builder knows it: the nearest triangle to a point several centimetres out is not stable, the one under
 *  its anchor is): { ids Uint16 x3, w Float32 x3, off Float32 x3 (t, b, n in
 *  mean-edge-length units), dist Float32 (each vertex's distance to the body, signed along the face normal) }. */
export function bind(points, bodyPos, index = BODY_INDEX, anchors = points, normals = null) {
  const n = points.length / 3, grid = gridFor(bodyPos, index), P = bodyPos;
  const ids = new Uint16Array(n * 3), w = new Float32Array(n * 3), off = new Float32Array(n * 3), dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const px = points[3 * i], py = points[3 * i + 1], pz = points[3 * i + 2], h = grid.nearest(anchors[3 * i], anchors[3 * i + 1], anchors[3 * i + 2]);
    const a = index[3 * h.tri], b = index[3 * h.tri + 1], c = index[3 * h.tri + 2];
    const [u, v, ww] = h.bary;
    ids[3 * i] = a; ids[3 * i + 1] = b; ids[3 * i + 2] = c; w[3 * i] = u; w[3 * i + 1] = v; w[3 * i + 2] = ww;
    const fr = frame(P, a * 3, b * 3, c * 3, normals, u, v, ww);
    const dx = px - h.q[0], dy = py - h.q[1], dz = pz - h.q[2];
    off[3 * i] = (dx * fr.tx + dy * fr.ty + dz * fr.tz) / fr.s; off[3 * i + 1] = (dx * fr.bx + dy * fr.by + dz * fr.bz) / fr.s; off[3 * i + 2] = (dx * fr.nx + dy * fr.ny + dz * fr.nz) / fr.s;
    dist[i] = off[3 * i + 2] * fr.s;
  }
  return { n, ids, w, off, dist, smooth: !!normals };
}

/** One point bound to the given triangle (body vertices a, b, c): the point of it nearest the point itself, and the offset in the triangle's frame, as bind() does for the triangle it finds;
 *  for choosing among several triangles (reduced.js tuneBinding). Returns { ids [a, b, c], w [u, v, w], off [t, b, n], dist }. */
export function bindToTriangle(px, py, pz, bodyPos, a, b, c, normals = null) {
  const P = bodyPos, q = new Float64Array(7);
  closestOnTriangle(px, py, pz, P[3 * a], P[3 * a + 1], P[3 * a + 2], P[3 * b], P[3 * b + 1], P[3 * b + 2], P[3 * c], P[3 * c + 1], P[3 * c + 2], q);
  const fr = frame(P, a * 3, b * 3, c * 3, normals, q[3], q[4], q[5]), dx = px - q[0], dy = py - q[1], dz = pz - q[2];
  const off = [(dx * fr.tx + dy * fr.ty + dz * fr.tz) / fr.s, (dx * fr.bx + dy * fr.by + dz * fr.bz) / fr.s, (dx * fr.nx + dy * fr.ny + dz * fr.nz) / fr.s];
  return { ids: [a, b, c], w: [q[3], q[4], q[5]], off, dist: off[2] * fr.s, d2: dx * dx + dy * dy + dz * dz };
}

const F = { tx: 0, ty: 0, tz: 0, bx: 0, by: 0, bz: 0, nx: 0, ny: 0, nz: 0, s: 1 };
// The triangle's frame: the first edge as the tangent, the normal either the face's or, given the body's vertex normals N and the point's barycentric weights, the
// smooth one blended from the three vertices'. A garment standing centimetres off a creased body (a sagging bust, a belly's folds) is placed along the smooth normal, so the
// creases' jitter in the faces' directions does not become ripples in the cloth.
function frame(P, a, b, c, N = null, w0 = 0, w1 = 0, w2 = 0) {
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1e-9, nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-9;
  const wx = P[c] - P[b], wy = P[c + 1] - P[b + 1], wz = P[c + 2] - P[b + 2];
  F.s = (ul + Math.sqrt(wx * wx + wy * wy + wz * wz) + Math.sqrt(vx * vx + vy * vy + vz * vz)) / 3;
  let tx = ux / ul, ty = uy / ul, tz = uz / ul;
  if (N) {
    nx = N[a] * w0 + N[b] * w1 + N[c] * w2; ny = N[a + 1] * w0 + N[b + 1] * w1 + N[c + 1] * w2; nz = N[a + 2] * w0 + N[b + 2] * w1 + N[c + 2] * w2;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    const d = tx * nx + ty * ny + tz * nz; tx -= d * nx; ty -= d * ny; tz -= d * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  } else { nx /= nl; ny /= nl; nz /= nl; }
  F.tx = tx; F.ty = ty; F.tz = tz; F.nx = nx; F.ny = ny; F.nz = nz; F.bx = ny * tz - nz * ty; F.by = nz * tx - nx * tz; F.bz = nx * ty - ny * tx;
  return F;
}

/** The body's vertex normals for a binding (area-weighted, over the drawn body and over the base layer, each its own surface), the way a wearer's are taken. */
export function bodyNormals(P) { const n = new Float32Array(NFULL * 3); normalsOf(P.subarray(0, NFULL * 3), FULL_INDEX, n); return n; }

/** The garment's vertices on a wearer's body positions P (a person's near body: the drawn body's vertices first): out (Float32Array 3 per vertex).
 *  `ease` scales the offsets' normal part, `slide` the tangent parts (1 and 1 on the template body give back the template). */
export function fit(binding, P, out = new Float32Array(binding.n * 3), ease = 1, slide = 1, normals = null) {
  const { n, ids, w, off } = binding;
  for (let i = 0; i < n; i++) {
    const a = ids[3 * i] * 3, b = ids[3 * i + 1] * 3, c = ids[3 * i + 2] * 3, w0 = w[3 * i], w1 = w[3 * i + 1], w2 = w[3 * i + 2], fr = frame(P, a, b, c, normals, w0, w1, w2);
    const ot = off[3 * i] * fr.s * slide, ob = off[3 * i + 1] * fr.s * slide, on = off[3 * i + 2] * fr.s * ease;
    out[3 * i] = P[a] * w0 + P[b] * w1 + P[c] * w2 + fr.tx * ot + fr.bx * ob + fr.nx * on;
    out[3 * i + 1] = P[a + 1] * w0 + P[b + 1] * w1 + P[c + 1] * w2 + fr.ty * ot + fr.by * ob + fr.ny * on;
    out[3 * i + 2] = P[a + 2] * w0 + P[b + 2] * w1 + P[c + 2] * w2 + fr.tz * ot + fr.bz * ob + fr.nz * on;
  }
  return out;
}

/** The skin weights of bound vertices: the blend of the three bound body vertices' weights (the wearer's skinIndex/skinWeight, 4 each),
 *  the four heaviest bones, renormalised: { skinIndex Uint16 x4, skinWeight Float32 x4 }. */
export function blendSkin(binding, skinIndex, skinWeight, K = 4) {
  const { n, ids, w } = binding, si = new Uint16Array(n * K), sw = new Float32Array(n * K), acc = new Map();
  for (let i = 0; i < n; i++) {
    acc.clear();
    for (let j = 0; j < 3; j++) {
      const v = ids[3 * i + j], ww = w[3 * i + j];
      for (let k = 0; k < K; k++) { const x = skinWeight[v * K + k]; if (x > 0) { const b = skinIndex[v * K + k]; acc.set(b, (acc.get(b) ?? 0) + ww * x); } }
    }
    const top = [...acc].filter(([, x]) => x > 0).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, K);
    let sum = 0; for (const [, x] of top) sum += x;
    top.forEach(([b, x], k) => { si[i * K + k] = b; sw[i * K + k] = x / (sum || 1); });
  }
  return { skinIndex: si, skinWeight: sw };
}
