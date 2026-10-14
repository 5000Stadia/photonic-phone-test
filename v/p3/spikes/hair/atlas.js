// Spike "hair" (M1, R2): the strand atlas, painted in code once at load and shared by every head and beard.
// It speaks the vendored shader's compact format (vendor/hair-shader.js): R coverage, G root-to-tip along the strand,
// B a per-strand seed. A second texture carries the strand's direction for three's anisotropy (RG the direction in
// the card's tangent frame, x across and y along, B strength), the "tangent map" that shader's GGX lobe reads.
// Kabe, 2026-10-11, on our old hair: "pretty bad tbh". The dissection (design/research/r2-vibe-human.md §8, A4) found
// that a card reads as hair when its texture holds many tapered strands that gather into locks, so the cards carry
// this texture.
// Layout: one 1024 x 1024 image of eight vertical tiles, 128 texels wide. Strands run up a tile, root at v = 0 and tip at
// v = 1, and a card maps its root-to-tip onto a tile's height and a slice of its columns onto its width:
//   straight  dense straight strands, a little clumped (the base layer)
//   clumped   straight strands gathering into two or three locks toward their tips (outer layers)
//   fine      sparse, fine strands: wisps, flyaways, a soft hairline
//   wavy      long waves, clumped        curly  ringlets: tight waves that gather
//   coily     loops and zigzags, dense and matte (afro-textured hair: the direction is weak, so the highlight is soft)
//   short     short strands scattered the whole way up the tile (a crop's texture: patches laid flat on the scalp)
//   coarse    thick, kinked, tapered strands (beards and moustaches)
// Painting is a capsule rasteriser over typed arrays, seeded by fixed numbers, so every device paints the same atlas.
// Strands are drawn back to front; where two overlap the nearer one owns G, B and the direction. Empty texels keep their
// row's root-to-tip and a neutral seed, so mipmaps never bleed black into strand edges.
//   paintAtlas() -> { W, H, data: Uint8Array RGBA, dir: Uint8Array RGBA, ms }      (pure: no three.js)
//   atlasTextures(THREE) -> { atlas, tangent }       (DataTextures with mipmaps, made once)
//   TILES: name -> index; tileU(name, a, b) -> [u0, u1] for columns a..b (0..1) of that tile
import { rng } from "./style.js";

export const W = 1024, H = 1024, TW = 128;
export const TILES = { straight: 0, clumped: 1, fine: 2, wavy: 3, curly: 4, coily: 5, short: 6, coarse: 7 };
export const tileU = (name, a = 0, b = 1) => { const t = TILES[name]; return [(t + 0.06 + a * 0.88) * TW / W, (t + 0.06 + b * 0.88) * TW / W]; };

// a tile's strands. Most run up the tile (y = t * len, monotonic) and are drawn by scanline; coily ones loop and are
// drawn as capsules. Each: { x(t), len, r radius px, a alpha, seed } or { pts: [[x, y]...], ... } for capsule strands.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function strandsFor(name, R) {
  const S = [], pick = (a, b) => a + (b - a) * R();
  // roots spread evenly across the tile but thinning over its outer 30% on each side, so a card's sides are soft
  const across = () => { for (;;) { const x = R(); if (R() < smooth(0, 0.3, x) * smooth(1, 0.7, x) + 0.03) return 1 + x * (TW - 2); } };
  const lin = { // straight families: count, clumps, tip gather, radius, alpha, cut (strand length / tile), wave amplitude px and cycles
    straight: { n: 300, k: 6, pull: 0.3, r: [0.35, 0.65], a: [0.4, 0.7], cut: [0.8, 1.0], amp: 0, cyc: 0 },
    clumped:  { n: 260, k: 3, pull: 0.8, r: [0.4, 0.7], a: [0.45, 0.75], cut: [0.7, 1.0], amp: 1.2, cyc: 0.7 },
    fine:     { n: 70, k: 5, pull: 0.25, r: [0.3, 0.45], a: [0.35, 0.6], cut: [0.5, 1.0], amp: 3, cyc: 0.6 },
    wavy:     { n: 260, k: 4, pull: 0.6, r: [0.4, 0.7], a: [0.45, 0.75], cut: [0.72, 1.0], amp: 10, cyc: 2.4 },
    curly:    { n: 250, k: 5, pull: 0.7, r: [0.45, 0.75], a: [0.5, 0.8], cut: [0.65, 1.0], amp: 7, cyc: 6 },
    coarse:   { n: 230, k: 5, pull: 0.3, r: [0.45, 0.8], a: [0.5, 0.8], cut: [0.55, 1.0], amp: 2.5, cyc: 2.2, lean: 8 },
  }[name];
  if (lin) {
    const C = Array.from({ length: lin.k }, (_, i) => ({ x: (i + 0.5 + (R() - 0.5) * 0.6) / lin.k * TW, ph: R() * 6.283, cyc: lin.cyc * pick(0.85, 1.15) }));
    for (let i = 0; i < lin.n; i++) {
      const x0 = across(), c = C.length ? C.reduce((b, v) => Math.abs(v.x - x0) < Math.abs(b.x - x0) ? v : b, C[0]) : null;
      const len = pick(...lin.cut) * H, pull = lin.pull * pick(0.3, 1.1), ph = (c ? c.ph : R() * 6.283) + pick(-0.5, 0.5);
      const amp = lin.amp * pick(0.7, 1.3), cyc = (c ? c.cyc : lin.cyc) * pick(0.93, 1.07), lean = (lin.lean ?? 0) * pick(-1, 1);
      const cut = len / H;
      S.push({ len, r: pick(...lin.r), a: pick(...lin.a), seed: R(),
        x: (t) => x0 + (c ? (c.x - x0) * pull * smooth(0.25, 1, t) : 0) + lean * t * t + amp * Math.sin(6.283 * cyc * t * cut + ph) * smooth(0, 0.2, t) });
    }
  } else if (name === "short") {
    // a crop's texture: short strands scattered the whole way up the tile, roughly along it, so a patch card laid flat
    // reads as short hair everywhere on it (no root at one end, so overlapping patches show no rows of scales)
    for (let i = 0; i < 900; i++) {
      const x0 = across(), y0 = pick(-60, H - 20), len = pick(40, 110), lean = pick(-0.18, 0.18), bend = pick(-0.1, 0.1);
      const pts = []; for (let j = 0; j <= 6; j++) { const t = j / 6; pts.push([x0 + (lean * t + bend * t * t) * len, y0 + t * len]); }
      S.push({ pts, r: pick(0.4, 0.65), a: pick(0.4, 0.75), seed: R() });
    }
  } else if (name === "coily") {
    // a dense mat of short springy coils: each a prolate trochoid (loops where the spoke passes the rim) wound along an
    // axis that bends as it goes, many angles, thinning toward the tile's tip and sides so the volume's edge is fuzzy
    for (let i = 0; i < 460; i++) {
      const x0 = across(), y0 = H * Math.pow(R(), 1.3) * 0.95 - 20, len = pick(45, 130), Rr = pick(1.6, 3.2), p = pick(3, 6), ph = R() * 6.283;
      let ang = pick(-0.7, 0.7); const bend = pick(-0.03, 0.03), pts = [], n = Math.ceil(len / p * 10);
      let ax = x0, ay = y0;
      for (let j = 0; j <= n; j++) {
        const t = j / n, th = ph + 6.283 * (len / p) * t, ca = Math.cos(ang), sa = Math.sin(ang);
        const u = Rr * Math.cos(th), v = Rr * 1.25 * Math.sin(th);
        pts.push([ax + u * ca + v * sa, ay + v * ca - u * sa]);
        ax += sa * len / n; ay += ca * len / n; ang += bend * len / n;
      }
      S.push({ pts, r: pick(0.35, 0.6), a: pick(0.45, 0.8), seed: R(), coily: true });
    }
  }
  return S;
}

export function paintAtlas() {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const N = W * H, cov = new Float32Array(N), ownA = new Float32Array(N);
  const g = new Float32Array(N), b = new Float32Array(N), dx = new Float32Array(N), dy = new Float32Array(N).fill(1), str = new Float32Array(N);
  const own = new Int32Array(N).fill(-1);
  // lay a strand's coverage c at texel i: composite over what is there; the nearer strand owns G, B and the direction
  const lay = (i, c, id, t, seed, ux, uy, s) => {
    if (own[i] === id) { if (c <= ownA[i]) return; cov[i] = 1 - (1 - cov[i]) / (1 - ownA[i] + 1e-6) * (1 - c); }
    else cov[i] = 1 - (1 - cov[i]) * (1 - c);
    if (own[i] !== id && c < ownA[i] * 0.6) return;
    own[i] = id; ownA[i] = c; g[i] = t; b[i] = seed; dx[i] = ux; dy[i] = uy; str[i] = s;
  };
  // alpha along a strand: fades in over the root, tapers out over the last eighth
  const along = (f) => Math.min(1, (f + 0.004) / 0.03) * Math.min(1, (1 - f) / 0.12);
  let id = 0; const xs = new Float32Array(H + 2);
  for (const [name, tile] of Object.entries(TILES)) {
    const R = rng(9001, tile), x0 = tile * TW;
    for (const s of strandsFor(name, R)) {
      id++;
      if (s.x) {   // scanline: per row, the strand's centre and its horizontal half-width (wider where it slants)
        const rows = Math.min(H, Math.ceil(s.len));
        for (let y = 0; y <= rows; y++) xs[y] = s.x(Math.min(1, (y + 0.5) / s.len));
        for (let y = 0; y < rows; y++) {
          const t = (y + 0.5) / s.len; if (t >= 1) break;
          const xc = xs[y], sl = (xs[Math.min(rows, y + 1)] - xs[Math.max(0, y - 1)]) / (Math.min(rows, y + 1) - Math.max(0, y - 1));
          const k = Math.sqrt(1 + sl * sl), hw = s.r * (1 - 0.5 * t) * k, a = s.a * along(t);
          if (a <= 0) continue;
          const lo = Math.max(0, Math.floor(xc - hw)), hi = Math.min(TW - 1, Math.floor(xc + hw)), row = y * W + x0;
          for (let x = lo; x <= hi; x++) {
            const c = Math.max(0, Math.min(x + 1, xc + hw) - Math.max(x, xc - hw)) * a;
            if (c > 0.003) lay(row + x, Math.min(1, c), id, t, s.seed, sl / k, 1 / k, 1);
          }
        }
      } else {     // capsules, for strands that loop
        const P = s.pts, n = P.length, L = [0];
        for (let j = 1; j < n; j++) { const ex = P[j][0] - P[j - 1][0], ey = P[j][1] - P[j - 1][1]; L.push(L[j - 1] + Math.sqrt(ex * ex + ey * ey)); }
        const len = L[n - 1] || 1;
        for (let j = 0; j < n - 1; j++) {
          const [ax, ay] = P[j], [bx, by] = P[j + 1], f = L[j] / len, r = s.r * (1 - 0.4 * f), a = s.a * along(f);
          const ex = bx - ax, ey = by - ay, e2 = ex * ex + ey * ey || 1, el = Math.sqrt(e2), sg = ey < 0 ? -1 : 1;
          const xlo = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), xhi = Math.min(TW - 1, Math.ceil(Math.max(ax, bx) + r));
          const ylo = Math.max(0, Math.floor(Math.min(ay, by) - r - 1)), yhi = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
          for (let y = ylo; y <= yhi; y++) for (let x = xlo; x <= xhi; x++) {
            const px = x + 0.5 - ax, py = y + 0.5 - ay, u = Math.max(0, Math.min(1, (px * ex + py * ey) / e2));
            const qx = px - ex * u, qy = py - ey * u, c = Math.min(1, Math.max(0, r + 0.5 - Math.sqrt(qx * qx + qy * qy))) * a;
            if (c > 0.003) lay(y * W + x0 + x, c, id, (L[j] + u * el) / len, s.seed, ex / el * sg, ey / el * sg, 0.25);
          }
        }
      }
    }
  }
  // empty texels keep their row's root-to-tip, a neutral seed and an upward direction, so filtering at a strand's edge
  // reads values that agree with it (no dilation pass needed)
  const filled = (i) => cov[i] > 0.002;
  const data = new Uint8Array(N * 4), dir = new Uint8Array(N * 4), q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < N; i++) {
    // empty texels away from any strand keep the root-to-tip of their row, so a card's tone is continuous under its gaps
    const row = Math.floor(i / W) / (H - 1), l = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
    data[4 * i] = q(cov[i]); const f = filled(i);
    data[4 * i + 1] = q(f ? g[i] : row); data[4 * i + 2] = q(f ? b[i] : 0.5); data[4 * i + 3] = 255;
    dir[4 * i] = q(l ? dx[i] / l * 0.5 + 0.5 : 0.5); dir[4 * i + 1] = q(l ? dy[i] / l * 0.5 + 0.5 : 1); dir[4 * i + 2] = q(f ? str[i] : 0.5); dir[4 * i + 3] = 255;
  }
  return { W, H, data, dir, ms: (typeof performance !== "undefined" ? performance.now() : 0) - t0 };
}

let made = null;
export function atlasTextures(THREE) {
  if (made) return made;
  const p = paintAtlas();
  const tex = (arr) => {
    const t = new THREE.DataTexture(arr, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4; t.needsUpdate = true; return t;
  };
  made = { atlas: tex(p.data), tangent: tex(p.dir), ms: p.ms };
  return made;
}
