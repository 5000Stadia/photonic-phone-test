// Spike "makehuman" (M1, R2): MakeHuman's CC0 hm08 base body, shaped by its macro corner targets and baked once on the
// CPU into a static mesh (no live morphs). The question: from a bench recipe, how good does that body look across ages
// 1 to 88, both sexes and builds, and what does one person cost to build in JS?
// Data: spikes/makehuman/data, packed from vendor/makehuman/raw by tools/mh/pack.py (our code; MPFB2's GPL code unused).
// Macro weighting re-derived from the data's layout (macro.json's anchors): each slider splits between its two
// neighbouring anchors, and a corner target's weight is the product of its slider shares:
//   universal-{gender}-{age}-{muscle}-{weight}   weight = G x A x M x W
//   neutral-{gender}-{age}                       weight = G x A   (the mean of the three race corners, packed offline)
// Height and proportions sliders stay at their neutral 0.5 (no targets); the recipe's height is met by uniform scale.
const DATA = new URL("./data/", import.meta.url);
const H = await (await fetch(new URL("body.json", DATA))).json();
const gz = await (await fetch(new URL("body.bin.gz", DATA))).body.pipeThrough(new DecompressionStream("gzip"));
const buf = await new Response(gz).arrayBuffer();

const N = H.vertices;
let off = 0;
const BASE = new Float32Array(buf, off, N * 3); off += N * 12;
const INDEX = new Uint16Array(buf, off, H.triangles * 3); off += H.triangles * 6;
// the base layer (tights helper cropped to torso, hips, upper legs, short sleeves): every person wears it
const GARMENT = H.garment && H.garment.triangles > 0 ? new Uint16Array(buf, off, H.garment.triangles * 3) : null;
if (GARMENT) off += H.garment.triangles * 6;
const TARGETS = {};
for (const t of H.targets) {
  const idx = new Uint16Array(buf, off, t.count); off += t.count * 2;
  const d = new Int16Array(buf, off, t.count * 3); off += t.count * 6;
  TARGETS[t.name] = { idx, d };
}
// the drawn body is the first BODY vertices; the eye-helper vertices after it only place the eyeballs
const BODY = Math.min(H.eyes.l[0], H.eyes.r[0]);
// UV seams (tools/mh/pack.py): the drawn body has UVs, so a vertex on a UV seam exists once per texture coordinate. The
// first BODY drawn vertices are the original ones, unchanged: everything that indexes by original vertex (the rest frame,
// hair growth, MakeHuman hair fitting, the targets) reads them as before. The seam copies follow, each naming its
// original; settleBody() writes their positions and normals, so a seam shades as one continuous surface.
export const UVN = H.uv ? H.uv.vertices : BODY;                   // drawn body vertices: originals, then seam copies
export let SEAM = null, UV = null, UV_INDEX = null;                // copy -> original (uint16), uv (float32 x2), drawn triangles (uint16)
if (H.uv) {
  const copies = H.uv.copies, o = tailOffset();
  SEAM = new Uint16Array(buf.slice(o, o + copies * 2));
  UV = new Float32Array(buf.slice(o + copies * 2, o + copies * 2 + UVN * 8));
  UV_INDEX = new Uint16Array(buf.slice(o + copies * 2 + UVN * 8, o + copies * 2 + UVN * 8 + H.uv.triangles * 6));
}
function tailOffset() { return N * 12 + H.triangles * 6 + (H.garment ? H.garment.triangles * 6 : 0) + H.targets.reduce((n, t) => n + t.count * 8, 0); }

// slider value -> {anchor: share}, between the two neighbouring anchors at the given positions
function split(v, anchors) {
  const out = {};
  for (let i = 0; i < anchors.length - 1; i++) {
    const [a, pa] = anchors[i], [b, pb] = anchors[i + 1];
    if (v <= pb || i === anchors.length - 2) {
      const t = Math.min(1, Math.max(0, (v - pa) / (pb - pa)));
      if (1 - t > 0) out[a] = 1 - t;
      if (t > 0) out[b] = (out[b] || 0) + t;
      return out;
    }
  }
}
// MakeHuman's age slider: 0 = 1 year, 0.1875 = 10 (child anchor), 0.5 = 25 (young), 1 = 90 (old)
const ageValue = (y) => y < 25 ? Math.max(0, (y - 1) / 24 * 0.5) : Math.min(1, 0.5 + (y - 25) / 65 * 0.5);

export function weights(r) {
  const G = split(Math.min(1, Math.max(0, r.sex)), [["female", 0], ["male", 1]]);
  const A = split(ageValue(r.age), [["baby", 0], ["child", 0.1875], ["young", 0.5], ["old", 1]]);
  const lv = [["min", 0], ["average", 0.5], ["max", 1]];
  const M = split(0.5, lv);                              // muscle: the bench recipe has none, so average
  const W = split(0.15 + 0.7 * r.build, lv);             // build 0..1 -> weight 0.15..0.85 (the extremes are caricatures)
  const w = [];
  for (const [g, wg] of Object.entries(G)) for (const [a, wa] of Object.entries(A)) {
    w.push([`neutral-${g}-${a}`, wg * wa]);
    for (const [m, wm] of Object.entries(M)) for (const [x, wx] of Object.entries(W))
      w.push([`universal-${g}-${a}-${m}muscle-${x}weight`, wg * wa * wm * wx]);
  }
  return w.filter(([n, v]) => v > 1e-4 && TARGETS[n].idx.length);
}

export function bake(r) {
  const P = BASE.slice(), W = weights(r);
  for (const [name, w] of W) {
    const { idx, d } = TARGETS[name], s = w * 0.001;
    for (let k = 0; k < idx.length; k++) {
      const o = idx[k] * 3;
      P[o] += d[3 * k] * s; P[o + 1] += d[3 * k + 1] * s; P[o + 2] += d[3 * k + 2] * s;
    }
  }
  return { P, targets: W.length };
}

// Normals as three computes them (area-weighted face normals, summed per vertex), on the original topology, then copied to
// the seam copies; positions of the copies follow their originals. Call after anything moves the body's vertices (age,
// identity and the arm pose do) in place of computeVertexNormals(), which on the drawn mesh would split every seam.
export function settleBody(geo) {
  const p = geo.attributes.position.array, n = geo.attributes.normal.array;
  if (SEAM) for (let j = 0; j < SEAM.length; j++) { const a = (BODY + j) * 3, b = SEAM[j] * 3; p[a] = p[b]; p[a + 1] = p[b + 1]; p[a + 2] = p[b + 2]; }
  n.fill(0, 0, BODY * 3);
  for (let t = 0; t < INDEX.length; t += 3) {
    const a = INDEX[t] * 3, b = INDEX[t + 1] * 3, c = INDEX[t + 2] * 3;
    const cx = p[c] - p[b], cy = p[c + 1] - p[b + 1], cz = p[c + 2] - p[b + 2], ax = p[a] - p[b], ay = p[a + 1] - p[b + 1], az = p[a + 2] - p[b + 2];
    const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < BODY * 3; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  if (SEAM) for (let j = 0; j < SEAM.length; j++) { const a = (BODY + j) * 3, b = SEAM[j] * 3; n[a] = n[b]; n[a + 1] = n[b + 1]; n[a + 2] = n[b + 2]; }
  geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
}

// Standing rule: no person is ever rendered unclothed, at any age. Without the base layer, build() refuses.
const CLOTH = "#5d6670";   // one neutral, opaque cloth colour
const OFFSET = 0.004;      // the layer sits this share of the height outside the tights helper's own fit, against z-fighting

export function build(THREE, r) {
  if (!GARMENT) throw new Error("makehuman: base layer missing from the packed data; refusing to draw an unclothed person");
  const t0 = performance.now();
  const { P, targets } = bake(r);
  // feet on y = 0, height = recipe height (soles to crown of the body vertices), metres
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < BODY; i++) { const y = P[3 * i + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  const s = r.height / (hi - lo);
  for (let i = 0; i < N; i++) { P[3 * i] *= s; P[3 * i + 1] = (P[3 * i + 1] - lo) * s; P[3 * i + 2] *= s; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(P.slice(0, UVN * 3), 3));    // the originals, then the seam copies (settleBody fills them)
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(UVN * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(UV_INDEX ?? INDEX, 1));
  if (UV) geo.setAttribute("uv", new THREE.BufferAttribute(UV, 2));
  settleBody(geo);
  // base layer: its own vertices (moved by the same targets), indexed locally, pushed out along their normals
  const [gs, gn] = H.garment.vertices;
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute("position", new THREE.BufferAttribute(P.slice(gs * 3, (gs + gn) * 3), 3));
  cloth.setIndex(new THREE.BufferAttribute(GARMENT.map(i => i - gs), 1));
  cloth.computeVertexNormals();
  const cp = cloth.attributes.position.array, cn = cloth.attributes.normal.array, d = OFFSET * r.height;
  for (let i = 0; i < cp.length; i++) cp[i] += cn[i] * d;
  cloth.computeVertexNormals();
  const ms = performance.now() - t0;
  console.log(`makehuman: age ${r.age} sex ${r.sex} build ${r.build}: ${targets} targets, baked in ${ms.toFixed(1)} ms`);

  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ color: r.skin, roughness: 0.6 })));
  const layer = new THREE.Mesh(cloth, new THREE.MeshStandardNodeMaterial({ color: CLOTH, roughness: 0.85, side: THREE.DoubleSide }));
  layer.name = "base-layer"; g.add(layer);
  // eyes: a sphere fitted to each eye helper (its centre and mean radius), a dark iris facing +z
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2eee6, roughness: 0.25 });
  const iris = new THREE.MeshStandardNodeMaterial({ color: ["#3b2a1d", "#4a6b8a", "#5b6b3a"][r.seed % 3], roughness: 0.3 });
  const black = new THREE.MeshStandardNodeMaterial({ color: 0x080808, roughness: 0.2 });
  for (const [start, n] of [H.eyes.l, H.eyes.r]) {
    const c = new THREE.Vector3();
    for (let i = start; i < start + n; i++) c.x += P[3 * i] / n, c.y += P[3 * i + 1] / n, c.z += P[3 * i + 2] / n;
    let rad = 0;
    for (let i = start; i < start + n; i++) rad += Math.hypot(P[3 * i] - c.x, P[3 * i + 1] - c.y, P[3 * i + 2] - c.z) / n;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(rad, 20, 14), white); ball.position.copy(c); g.add(ball);
    const iri = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.45, 16, 10), iris);
    iri.scale.z = 0.35; iri.position.copy(c).add(new THREE.Vector3(0, 0, rad * 0.86)); g.add(iri);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.18, 12, 8), black);
    pupil.scale.z = 0.3; pupil.position.copy(c).add(new THREE.Vector3(0, 0, rad * 0.97)); g.add(pupil);
  }
  if (!(layer.geometry.index.count > 0)) throw new Error("makehuman: empty base layer; refusing to draw");
  g.userData.bakeMs = ms;
  return g;
}
