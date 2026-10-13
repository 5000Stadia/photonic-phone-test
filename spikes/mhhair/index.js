// Spike "mhhair" (R5, the hairstyle lineup): MakeHuman's painted hair shells (CC0 / CC BY, vendor/makehuman-hair/NOTICE.md), packed by
// tools/mh/hair-pack.py and fitted here to a person's DEFORMED body, so the hair follows any age and build.
//   loadStyles(THREE, ids) -> styles     fetches data/<id>.json, .bin.gz (fit rows, triangles, UVs, root-to-tip) and the atlas .png
//   wear(THREE, renderer, style, person, recipe, { tip, grey }) -> { group, stats, set(tip, grey), geometry }
//   scalpCheck(person, hair) -> how the shell sits against the head (signed distance to the nearest head vertex along its normal)
// The fit is MakeHuman's: a hair vertex = w1 p[i1] + w2 p[i2] + w3 p[i3] + offset x scale, where p are the person's own vertices (the body
// from the built person, the 428 helper-hair vertices re-deformed here from the same macro targets spikes/makehuman uses) and the scale per
// axis is a pair of body vertices' distance on this person over the same distance on the neutral base (checked on the base: it lands on the scalp).
import { bake, weights } from "../makehuman/index.js";
import { hairMaterials } from "./material.js";

const KEEP_OUT = 0.0025;
const DATA = new URL("./data/", import.meta.url);
const gunzip = async (name) => new Response((await fetch(new URL(name, DATA))).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
let helper = null;
async function loadHelper() {
  if (helper) return helper;
  const meta = await (await fetch(new URL("helper.json", DATA))).json(), buf = await gunzip("helper.bin.gz");
  const n = meta.count, base = new Float32Array(buf.slice(0, n * 12)), deltas = {};
  meta.targets.forEach((name, k) => { deltas[name] = new Int16Array(buf.slice(n * 12 + k * n * 6, n * 12 + (k + 1) * n * 6)); });
  return (helper = { ...meta, base, deltas });
}

export async function loadStyles(THREE, ids) {
  await loadHelper();
  const loader = new THREE.TextureLoader();
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const meta = await (await fetch(new URL(`${id}.json`, DATA))).json(), buf = await gunzip(`${id}.bin.gz`);
    const R = meta.rows, V = meta.vertices, Tn = meta.triangles;
    let o = 0;
    const take = (Cls, n) => { const a = new Cls(buf.slice(o, o + n * Cls.BYTES_PER_ELEMENT)); o += n * Cls.BYTES_PER_ELEMENT; return a; };
    const idx = take(Uint16Array, R * 3), w = take(Float32Array, R * 3), off = take(Float32Array, R * 3);
    const vmap = take(Uint16Array, V), uv = take(Float32Array, V * 2), rt = take(Uint8Array, V), tris = take(Uint16Array, Tn * 3);
    const atlas = await loader.loadAsync(new URL(`${id}.png`, DATA).href);
    atlas.colorSpace = THREE.NoColorSpace; atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping; atlas.anisotropy = 4;
    out[id] = { id, meta, idx, w, off, vmap, uv, rt, tris, atlas };
  }));
  return out;
}

// the person's vertices, metres: the body from the built person, then the helper-hair vertices deformed by the same macro targets
function personPoints(person, r, BODY) {
  const bp = person.children[0].geometry.attributes.position.array;
  if (bp.length < BODY * 3) throw new Error(`mhhair: the person's body has ${bp.length / 3} vertices, the pack expects ${BODY}`);   // the seam copies after the originals are not used here
  const { P } = bake(r);                                      // decimetres, before the person's height scale: the same bake the person was built from
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < BODY; i++) { const y = P[3 * i + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  const s = r.height / (hi - lo), H = helper, hp = Float32Array.from(H.base);
  for (const [name, wt] of weights(r)) { const d = H.deltas[name], k = wt * 0.001; for (let i = 0; i < hp.length; i++) hp[i] += d[i] * k; }
  const Pm = new Float32Array((BODY + H.count) * 3); Pm.set(bp.subarray(0, BODY * 3));
  for (let j = 0; j < H.count; j++) { const o = (BODY + j) * 3; Pm[o] = hp[3 * j] * s; Pm[o + 1] = (hp[3 * j + 1] - lo) * s; Pm[o + 2] = hp[3 * j + 2] * s; }
  return { Pm, s };
}

export function wear(THREE, renderer, style, person, r, { tip = "#5a3d26", grey = 0, strand = "v", tune = {} } = {}) {
  const t0 = performance.now(), m = style.meta, BODY = m.body, { Pm, s } = personPoints(person, r, BODY);
  const ratio = [0, 1, 2].map((ax) => { const [a, b] = m.scale[ax]; return Math.abs(Pm[a * 3 + ax] - Pm[b * 3 + ax]) / s / m.scaleBase[ax]; });
  const rows = new Float32Array(m.rows * 3);
  for (let i = 0; i < m.rows; i++) for (let ax = 0; ax < 3; ax++) {
    let v = style.off[3 * i + ax] * ratio[ax] * s;
    for (let k = 0; k < 3; k++) v += style.w[3 * i + k] * Pm[style.idx[3 * i + k] * 3 + ax];
    rows[3 * i + ax] = v;
  }
  const bp = person.children[0].geometry.attributes.position.array, bn = person.children[0].geometry.attributes.normal.array;
  let top = -Infinity; for (let i = 1; i < bp.length; i += 3) if (bp[i] > top) top = bp[i];
  // keep out: a shell vertex that falls inside the head (a fringe on a forehead, a lock at an ear) is lifted to 2.5 mm above the skin along the nearest head vertex's normal
  const head = []; for (let i = 0; i < bp.length / 3; i++) if (bp[3 * i + 1] > top - 0.14 * r.height) head.push(i);
  let lifted = 0;
  for (let v = 0; v < m.rows; v++) {
    const x = rows[3 * v], y = rows[3 * v + 1], z = rows[3 * v + 2];
    if (y < top - 0.14 * r.height - 0.04) continue;
    let bd = Infinity, bj = -1;
    for (const j of head) { const dx = x - bp[3 * j], dy = y - bp[3 * j + 1], dz = z - bp[3 * j + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bj = j; } }
    if (bd > 0.03 * 0.03) continue;
    const sd = (x - bp[3 * bj]) * bn[3 * bj] + (y - bp[3 * bj + 1]) * bn[3 * bj + 1] + (z - bp[3 * bj + 2]) * bn[3 * bj + 2], lift = KEEP_OUT - sd;
    if (lift > 0) { rows[3 * v] += bn[3 * bj] * lift; rows[3 * v + 1] += bn[3 * bj + 1] * lift; rows[3 * v + 2] += bn[3 * bj + 2] * lift; lifted++; }
  }
  // a head centre for the volume normals: the body's top 0.2 m
  const c = [0, 0, 0]; let nc = 0;
  for (let i = 0; i < bp.length; i += 3) if (bp[i + 1] > top - 0.2) { c[0] += bp[i]; c[1] += bp[i + 1]; c[2] += bp[i + 2]; nc++; }
  c[0] /= nc; c[1] /= nc; c[2] /= nc;
  // per-row normals from the triangles (rows, not split corners, so a UV seam does not show), then a little of the radial direction
  const nrm = new Float32Array(m.rows * 3), tr = style.tris, vm = style.vmap;
  for (let t = 0; t < m.triangles; t++) {
    const a = vm[tr[3 * t]], b = vm[tr[3 * t + 1]], d = vm[tr[3 * t + 2]];
    const ux = rows[3 * b] - rows[3 * a], uy = rows[3 * b + 1] - rows[3 * a + 1], uz = rows[3 * b + 2] - rows[3 * a + 2];
    const vx = rows[3 * d] - rows[3 * a], vy = rows[3 * d + 1] - rows[3 * a + 1], vz = rows[3 * d + 2] - rows[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, d]) { nrm[3 * q] += nx; nrm[3 * q + 1] += ny; nrm[3 * q + 2] += nz; }
  }
  const pos = new Float32Array(m.vertices * 3), nor = new Float32Array(m.vertices * 3), rtf = new Float32Array(m.vertices);
  for (let i = 0; i < m.vertices; i++) {
    const q = vm[i]; rtf[i] = style.rt[i] / 255;
    for (let ax = 0; ax < 3; ax++) pos[3 * i + ax] = rows[3 * q + ax];
    let nx = nrm[3 * q], ny = nrm[3 * q + 1], nz = nrm[3 * q + 2];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // the shell's own normal may face either way (double-sided): orient it outward from the head, then blend in the radial direction
    let rx = pos[3 * i] - c[0], ry = pos[3 * i + 1] - c[1], rz = pos[3 * i + 2] - c[2];
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const sg = nx * rx + ny * ry + nz * rz < 0 ? -1 : 1, k = 0.5 * (1 - rtf[i]);
    nx = nx * sg + rx * k; ny = ny * sg + ry * k; nz = nz * sg + rz * k;
    const l = Math.hypot(nx, ny, nz) || 1;
    nor[3 * i] = nx / l; nor[3 * i + 1] = ny / l; nor[3 * i + 2] = nz / l;
  }
  // the strand direction, root to tip: dP/dV of the UV mapping (dP/dU for a style whose strands run along U), per triangle, turned to run toward larger
  // root-to-tip and averaged on the vertices. Supplied as the tangent so three does not derive one (a degenerate UV triangle gives NaN there: white patches).
  const tan = new Float32Array(m.vertices * 3), alongU = strand === "u";
  for (let t = 0; t < m.triangles; t++) {
    const i0 = tr[3 * t], i1 = tr[3 * t + 1], i2 = tr[3 * t + 2], uv = style.uv;
    const du1 = uv[2 * i1] - uv[2 * i0], dv1 = uv[2 * i1 + 1] - uv[2 * i0 + 1], du2 = uv[2 * i2] - uv[2 * i0], dv2 = uv[2 * i2 + 1] - uv[2 * i0 + 1];
    const det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
    const g = [0, 0, 0], r0 = rtf[i0], dr = alongU ? (dv2 * (rtf[i1] - r0) - dv1 * (rtf[i2] - r0)) / det : (du1 * (rtf[i2] - r0) - du2 * (rtf[i1] - r0)) / det;
    for (let ax = 0; ax < 3; ax++) {
      const e1 = pos[3 * i1 + ax] - pos[3 * i0 + ax], e2 = pos[3 * i2 + ax] - pos[3 * i0 + ax];
      g[ax] = alongU ? (dv2 * e1 - dv1 * e2) / det : (du1 * e2 - du2 * e1) / det;
    }
    const gl = Math.hypot(g[0], g[1], g[2]); if (!(gl > 1e-9)) continue;
    const sg = dr < 0 ? -1 : 1, wgt = Math.abs(det) ** 0.5;
    for (const q of [i0, i1, i2]) for (let ax = 0; ax < 3; ax++) tan[3 * q + ax] += sg * g[ax] / gl * wgt;
  }
  const tg4 = new Float32Array(m.vertices * 4);
  for (let i = 0; i < m.vertices; i++) {
    let x = tan[3 * i], y = tan[3 * i + 1], z = tan[3 * i + 2];
    const nx = nor[3 * i], ny = nor[3 * i + 1], nz = nor[3 * i + 2], d = x * nx + y * ny + z * nz;
    x -= nx * d; y -= ny * d; z -= nz * d;                                    // orthogonal to the normal
    let l = Math.hypot(x, y, z);
    if (!(l > 1e-6)) { x = 0; y = -1; z = 0; const d2 = ny * -1; x -= nx * d2; y -= ny * d2; z -= nz * d2; l = Math.hypot(x, y, z) || 1; }   // no usable UV direction: down the hair
    tg4[4 * i] = x / l; tg4[4 * i + 1] = y / l; tg4[4 * i + 2] = z / l; tg4[4 * i + 3] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("tangent", new THREE.BufferAttribute(tg4, 4));
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(style.uv, 2)); geo.setAttribute("rt", new THREE.BufferAttribute(rtf, 1));
  geo.setIndex(new THREE.BufferAttribute(style.tris, 1));
  const mats = hairMaterials(THREE, renderer, style.atlas, { strand, ...tune });
  mats.set(tip, grey);
  const core = new THREE.Mesh(geo, mats.core), rim = new THREE.Mesh(geo, mats.rim);
  core.renderOrder = 0; rim.renderOrder = 1;
  const group = new THREE.Group(); group.name = "hair-" + style.id; group.add(core, rim);
  for (const o of group.children) { o.frustumCulled = false; o.castShadow = o.receiveShadow = false; }
  person.add(group);
  const stats = { id: style.id, triangles: m.triangles, vertices: m.vertices, draws: 2, ratio: ratio.map((x) => +x.toFixed(3)), lifted, fitMs: +(performance.now() - t0).toFixed(1) };
  return { group, stats, set: mats.set, tune: mats.tune, geometry: geo };
}

// the shell against the head: signed distance (m) of each near-head hair vertex to the nearest head vertex, along that vertex's normal;
// negative is inside the skin. Head = the body's top 0.14 x height.
export function scalpCheck(person, hair, height) {
  const g = person.children[0].geometry, bp = g.attributes.position.array, bn = g.attributes.normal.array, hp = hair.geometry.attributes.position.array;
  let top = -Infinity; for (let i = 1; i < bp.length; i += 3) if (bp[i] > top) top = bp[i];
  const head = []; for (let i = 0; i < bp.length / 3; i++) if (bp[3 * i + 1] > top - 0.14 * height) head.push(i);
  let near = 0, inside = 0, deep = 0, sum = 0, min = Infinity;
  for (let v = 0; v < hp.length / 3; v++) {
    let bd = Infinity, bj = -1;
    for (const j of head) { const dx = hp[3 * v] - bp[3 * j], dy = hp[3 * v + 1] - bp[3 * j + 1], dz = hp[3 * v + 2] - bp[3 * j + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bj = j; } }
    if (Math.sqrt(bd) > 0.04) continue;
    const sd = (hp[3 * v] - bp[3 * bj]) * bn[3 * bj] + (hp[3 * v + 1] - bp[3 * bj + 1]) * bn[3 * bj + 1] + (hp[3 * v + 2] - bp[3 * bj + 2]) * bn[3 * bj + 2];
    near++; sum += sd; if (sd < min) min = sd; if (sd < -0.002) inside++; if (sd < -0.006) deep++;
  }
  return { near, meanMm: +(sum / Math.max(near, 1) * 1000).toFixed(1), minMm: +(min * 1000).toFixed(1), insidePct: +(100 * inside / Math.max(near, 1)).toFixed(1), deepPct: +(100 * deep / Math.max(near, 1)).toFixed(1) };
}
