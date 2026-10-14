// Spike "hair" (M1, R2): guides become cards, one geometry per person (head and face together: one draw per pass).
// Each guide is a strip of three vertices across (edge, a raised middle, edge; at the far tier two, flat), its plane
// lying on the hair volume (rules.js and grow.js give the volume's normal), widening a little as it falls and gathering
// to its tip. It maps root to tip onto one atlas tile's height and the tile's width across (mirrored on half the cards),
// so neighbouring cards never show the same strands side by side. Every per-vertex value sits in one interleaved buffer
// (WebGPU gives a pipeline 8 vertex buffers; the hair uses three: this, the swatch and the force, index.js).
// Per vertex, beside position, normal, tangent and uv:
//   hair   (root-to-tip along the whole strand, shade, free length past the pivot in metres, the card's seed)
//          shade: the layer's own depth times how buried the point sits in the hair volume (a density of every guide in a
//          1.2 cm grid, gathered along the volume's normal outward): the self-shadow, baked at build, nothing per frame
//   pivot  where the strand leaves the head's support: the force bend (motion.js) swings what hangs past it
// The normal leans outward toward each edge, so a card shades round rather than flat; the tangent runs across the card,
// so the bitangent runs root to tip (three's anisotropy and the near lobes read the strand's direction from it).
//   cards(THREE, guides, { flat }) -> BufferGeometry      (stats on geometry.userData: cards, triangles, ms)
import { tileU } from "./atlas.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// how buried each guide point is: sum the guides' density stepping out along the volume's normal
function burial(guides) {
  const cell = 0.012, D = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const g of guides) for (let j = 0; j <= g.segs; j++) { const k = key(g.pts[3 * j], g.pts[3 * j + 1], g.pts[3 * j + 2]); D.set(k, (D.get(k) ?? 0) + g.width / 0.025); }
  return (g, j) => {
    let s = 0;
    for (let k = 1; k <= 4; k++) { const d = k * 0.009; s += D.get(key(g.pts[3 * j] + g.nrm[3 * j] * d, g.pts[3 * j + 1] + g.nrm[3 * j + 1] * d, g.pts[3 * j + 2] + g.nrm[3 * j + 2] * d)) ?? 0; }
    return Math.exp(-0.16 * s);
  };
}

export function cards(THREE, guides, { flat = false } = {}) {
  const t0 = performance.now(), bur = burial(guides), A = flat ? [[0, 0], [1, 1]] : [[0, 0], [1, 0.5], [2, 1]], na = A.length;
  let nv = 0, ni = 0; for (const g of guides) { nv += (g.segs + 1) * na; ni += g.segs * (na - 1) * 6; }
  // one interleaved buffer for every per-vertex value (WebGPU allows a pipeline 8 vertex buffers; this is one):
  // position 0, normal 3, tangent 6, uv 10, hair 12, pivot 16; stride 19 floats
  const ST = 19, buf = new Float32Array(nv * ST), idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
  let v = 0, i = 0;
  for (const g of guides) {
    const S = g.segs, [u0, u1] = tileU(g.tile, 0, 1), base = v;
    for (let j = 0; j <= S; j++) {
      const t = j / S, w = g.width * (1 + 0.45 * t) * (1 - g.tipTaper * smooth(0.55, 1, t)) * (j === 0 ? 0.55 : 1);
      // roots sit in the volume's shade only where the strand is long enough to bury them (not a crop's or a beard's)
      const shade = g.shade * (0.35 + 0.65 * bur(g, j)) * (1 - 0.45 * smooth(0.02, 0.1, g.L) * (1 - smooth(0, 0.35, t)));
      for (const [k, u] of A) {
        const off = (u - 0.5) * w, rise = u === 0.5 ? 0.22 * w : 0;
        const o = v * ST, n = [0, 1, 2].map(c => g.nrm[3 * j + c] + g.across[3 * j + c] * (u - 0.5) * 0.9), l = Math.hypot(...n);
        for (let c = 0; c < 3; c++) {
          buf[o + c] = g.pts[3 * j + c] + g.across[3 * j + c] * off + g.nrm[3 * j + c] * rise;
          buf[o + 3 + c] = n[c] / l;
          buf[o + 6 + c] = g.across[3 * j + c];
          buf[o + 16 + c] = g.pivot[c];
        }
        buf[o + 9] = -1;                                       // bitangent = cross(normal, tangent) * w: root to tip
        buf[o + 10] = g.mirror ? u1 + (u0 - u1) * u : u0 + (u1 - u0) * u; buf[o + 11] = t;
        buf.set([t, shade, g.free(j), g.seed], o + 12);
        v++;
      }
    }
    for (let j = 0; j < S; j++) for (let c = 0; c < na - 1; c++) {
      const a = base + j * na + c, b = a + na;
      idx.set([a, b, a + 1, a + 1, b, b + 1], i); i += 6;
    }
  }
  const geo = new THREE.BufferGeometry(), ib = new THREE.InterleavedBuffer(buf, ST);
  for (const [name, size, off] of [["position", 3, 0], ["normal", 3, 3], ["tangent", 4, 6], ["uv", 2, 10], ["hair", 4, 12], ["pivot", 3, 16]])
    geo.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, size, off));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.userData = { cards: guides.length, triangles: ni / 3, vertices: nv, ms: performance.now() - t0 };
  return geo;
}
