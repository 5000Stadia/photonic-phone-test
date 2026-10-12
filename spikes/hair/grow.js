// Spike "hair" (M1, R2): guides grown on a person's own baked head from a plan's layers (rules.js). The groom practice
// the dissection describes (vibe-human §1.2-1.3, XGen): roots spread evenly over a region, each strand leaving the skin
// at a lift along its comb direction, bending under gravity once past its stiff root, kept off the body at its layer's
// stand-off, cut where its rule cuts it, then waved or curled about its own path. Written for Photonic, no hand on
// the guides: the shape is all rules.
//   head(person) -> the person's head: baked surface, cranium centre and radii, a rest-to-baked height map, and a
//                   collision field over head, neck, shoulders and back (each vertex's tangent plane, 3 cm grid)
//   grow(H, plan, seed) -> guides: [{ layer, name, pts, across, nrm, L (length), segs, pivot, free(j), width, tile, seed }]
//     pts, across (the card's width direction), nrm (the hair volume's outward normal): Float32Array (segs+1) * 3, metres
//     pivot: where the strand leaves the head's support (the force bend swings what hangs past it); free: arc length past it
// Deterministic from the seed; no three.js (the person's geometry is read as arrays).
import { REST, INDEX, SCALP } from "../appearance/rest.js";
import { rng } from "./style.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// face triangles (the beard and moustache regions): jaw, chin, cheeks, upper lip, under the chin
let FACE = null;
const faceTris = () => FACE ??= (() => { const k = [];
  for (let t = 0; t < INDEX.length; t += 3) { let ok = true; for (let j = 0; j < 3 && ok; j++) { const i = INDEX[t + j]; ok = REST[3 * i + 1] > 5.85 && REST[3 * i + 1] < 7.35 && REST[3 * i + 2] > 0.15; } if (ok) k.push(INDEX[t], INDEX[t + 1], INDEX[t + 2]); }
  return new Uint16Array(k); })();

export function head(person) {
  const body = person.children[0], P = body.geometry.attributes.position.array, N = body.geometry.attributes.normal.array, nv = P.length / 3;
  // cranium: the baked positions of the rest cranium above the brow; centre and radii from its extent
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, top = -1e9;
  for (let i = 0; i < nv; i++) if (REST[3 * i + 1] > 7.6) { x0 = Math.min(x0, P[3 * i]); x1 = Math.max(x1, P[3 * i]); z0 = Math.min(z0, P[3 * i + 2]); z1 = Math.max(z1, P[3 * i + 2]); top = Math.max(top, P[3 * i + 1]); }
  const rz = (z1 - z0) / 2, rx = (x1 - x0) / 2, ry = rz * 0.93, C = [(x0 + x1) / 2, top - ry, (z0 + z1) / 2 - rz * 0.06];
  // rest height -> baked height, by the crown and the chin
  const near = (x, y, z) => { let b = 0, bd = 1e9; for (let i = 0; i < nv; i++) { const d = (REST[3 * i] - x) ** 2 + (REST[3 * i + 1] - y) ** 2 + (REST[3 * i + 2] - z) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
  const ic = near(0, 8.49, 0.6), ich = near(0, 6.15, 1.45), yc = P[3 * ic + 1], ych = P[3 * ich + 1];
  const restY = (y) => ych + (y - 6.15) * (yc - ych) / (8.49 - 6.15);
  const scale = (yc - ych) / (8.49 - 6.15) * 10;          // metres per rest metre (rest is in decimetres)
  // the collision field: body vertices from the hips up, in a 3 cm grid
  const cell = 0.03, grid = new Map(), yMin = restY(6.15) - 0.75 * scale;
  const key = (a, b, c) => ((a + 512) * 1024 + b + 512) * 1024 + c + 512;
  for (let i = 0; i < nv; i++) { if (P[3 * i + 1] < yMin) continue; const k = key(Math.floor(P[3 * i] / cell), Math.floor(P[3 * i + 1] / cell), Math.floor(P[3 * i + 2] / cell)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i); }
  // keep p between `clear` and `most` above the nearest vertex's tangent plane (pushed out below, drawn back in above);
  // returns the height it stood at before
  const push = (p, clear, most = Infinity) => {
    let best = -1, bd = 1e9; const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(key(cx + a, cy + b, cz + c)); if (!l) continue;
      for (const i of l) { const d = (P[3 * i] - p[0]) ** 2 + (P[3 * i + 1] - p[1]) ** 2 + (P[3 * i + 2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) return 1;
    const s = (p[0] - P[3 * best]) * N[3 * best] + (p[1] - P[3 * best + 1]) * N[3 * best + 1] + (p[2] - P[3 * best + 2]) * N[3 * best + 2];
    if (s < clear) for (let k = 0; k < 3; k++) p[k] += N[3 * best + k] * (clear - s);
    else if (s > most) for (let k = 0; k < 3; k++) p[k] -= N[3 * best + k] * (s - most) * 0.7;
    return s;
  };
  // the hair volume's outward normal: from the cranium's centre near the head, from the body's axis below it
  const volNormal = (p) => {
    const e = norm3([(p[0] - C[0]) / (rx * rx), (p[1] - C[1]) / (ry * ry), (p[2] - C[2]) / (rz * rz)]);
    const r0 = norm3([p[0] - C[0], 0, p[2] - C[2] + rz * 0.25]), r = norm3([r0[0] * 0.55, 0, r0[2] + Math.sign(r0[2] || 1) * 0.45]), w = smooth(C[1] - 1.7 * ry, C[1] - 0.6 * ry, p[1]);
    return norm3([r[0] + (e[0] - r[0]) * w, r[1] + (e[1] - r[1]) * w, r[2] + (e[2] - r[2]) * w]);
  };
  const bakedOf = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  return { P, N, C, rx, ry, rz, restY, scale, push, volNormal, near, bakedOf };
}

// roots on a region: area-weighted candidates thinned by the layer's density, then spread (Poisson-disc elimination)
function roots(H, tris, density, count, R) {
  const { P, N } = H, nt = tris.length / 3, cdf = new Float64Array(nt);
  let A = 0;
  for (let t = 0; t < nt; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    const e1 = [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]], e2 = [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]];
    const r = [0, 1, 2].map(k => (REST[3 * a + k] + REST[3 * b + k] + REST[3 * c + k]) / 3);
    A += Math.hypot(...cross(e1, e2)) / 2 * Math.min(1, density(r) * 1.5); cdf[t] = A;
  }
  if (A <= 0) return [];
  const cand = [];
  for (let k = 0; k < count * 8 && cand.length < count * 5; k++) {
    let u = R() * A, lo = 0, hi = nt - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
    const ia = tris[3 * lo], ib = tris[3 * lo + 1], ic = tris[3 * lo + 2];
    let s = R(), t = R(); if (s + t > 1) { s = 1 - s; t = 1 - t; }
    const w = [1 - s - t, s, t], at = (arr, k) => arr[3 * ia + k] * w[0] + arr[3 * ib + k] * w[1] + arr[3 * ic + k] * w[2];
    const r = [0, 1, 2].map(k => at(REST, k));
    if (R() > density(r)) continue;
    cand.push({ p: [0, 1, 2].map(k => at(P, k)), n: norm3([0, 1, 2].map(k => at(N, k))), r });
  }
  // Poisson-disc: keep a candidate if none kept lies within the spacing; relax the spacing until enough are kept
  let rad = 0.8 * Math.sqrt(A / count);
  let kept = [];
  for (let pass = 0; pass < 4 && kept.length < count; pass++, rad *= 0.8) {
    const cell = rad, g = new Map(), key = (p) => [0, 1, 2].map(k => Math.floor(p[k] / cell)).join(",");
    for (const q of kept) { const k = key(q.p); (g.get(k) ?? g.set(k, []).get(k)).push(q); }
    for (const c of cand) {
      if (kept.length >= count || kept.includes(c)) continue;
      const [x, y, z] = c.p.map(v => Math.floor(v / cell)); let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (let d = -1; d <= 1 && ok; d++)
        for (const q of g.get(`${x + a},${y + b},${z + d}`) ?? []) if ((q.p[0] - c.p[0]) ** 2 + (q.p[1] - c.p[1]) ** 2 + (q.p[2] - c.p[2]) ** 2 < rad * rad) { ok = false; break; }
      if (ok) { kept.push(c); const k = key(c.p); (g.get(k) ?? g.set(k, []).get(k)).push(c); }
    }
  }
  kept.spacing = Math.sqrt(A / Math.max(1, kept.length));
  return kept;
}

// resample a polyline to n+1 points evenly spaced along it
function resample(pts, n) {
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const L = s[s.length - 1], out = []; let j = 0;
  for (let k = 0; k <= n; k++) { const t = L * k / n; while (j < s.length - 2 && s[j + 1] < t) j++; const f = (t - s[j]) / ((s[j + 1] - s[j]) || 1); out.push(pts[j].map((v, c) => v + (pts[j + 1][c] - v) * Math.min(1, Math.max(0, f)))); }
  return { out, L };
}

// one strand from a root: lift off the skin along the comb, bend under gravity past the stiff root, keep off the body
function strand(H, layer, root, R) {
  const L = layer.length(root.r), step = Math.min(0.01, L / 6), comb = layer.comb(root.r), lift = layer.lift(root.r);
  const stand = layer.standoff(root.r), cutY = layer.cutY != null ? H.restY(layer.cutY) : -1e9;
  let d = norm3(comb.map((c, k) => c * Math.cos(lift) + root.n[k] * Math.sin(lift)));
  const p = layer.float ? root.p.map((v, k) => v + root.n[k] * stand) : root.p.slice(), pts = [p.slice()], support = [true];
  if (layer.float) d = norm3(comb.map((c, k) => c - root.n[k] * (comb[0] * root.n[0] + comb[1] * root.n[1] + comb[2] * root.n[2])));
  let s = 0;
  for (let guard = 0; s < L - 1e-6 && guard < 400; guard++) {
    const h = Math.min(step, L - s), t = s / L;
    // gravity takes the strand past its stiff root; a tie or the comb's lingering pull keeps it on course
    const hanging = p[1] < H.C[1] - 1.05 * H.ry && !layer.hug && !layer.wrap;
    const gw = layer.gravity * smooth(layer.stiff * L, layer.stiff * L + Math.max(0.03, 0.2 * L), s) * (hanging ? 90 : 30) * h;
    d = norm3([d[0], d[1] - gw, d[2]]);
    if (layer.toward) { const tt = H.tieB; d = norm3(d.map((v, k) => v + (tt[k] - p[k]) * 6 * h / Math.max(0.02, Math.hypot(tt[0] - p[0], tt[1] - p[1], tt[2] - p[2])))); }
    if (layer.ends && t > 0.82) { const n = H.volNormal(p); d = norm3(d.map((v, k) => v - n[k] * (layer.ends === "under" ? 1 : -1) * 4 * h)); }
    // below the head, hair falls rather than sliding out over the shoulders: its sideways run is damped, and it goes
    // round the shoulder, behind it or (for the front of the sides, root.front) in front of it
    if (hanging && !layer.toward) {
      const z0 = root.front ? H.C[2] + H.rz * 1.15 : H.C[2] - H.rz * 0.95, w = smooth(H.C[1] - 1.05 * H.ry, H.C[1] - 2.0 * H.ry, p[1]);
      d = norm3([d[0] * (1 - 14 * h), d[1], d[2] + ((root.front ? Math.max(0, z0 - p[2]) : Math.min(0, z0 - p[2])) * 40 + (root.front ? 1 : -1) * 2) * h * w]);
    }
    const q = [p[0] + d[0] * h, p[1] + d[1] * h, p[2] + d[2] * h];
    const clear = 0.0015 + stand * (layer.float ? 1 : smooth(0, 0.04 + Math.min(0.08, stand * 2), s)) + (q[1] < H.C[1] - 1.2 * H.ry ? 0.008 : 0);
    // on the head the strand lies at its layer's height (the styling shell); below the head it falls freely
    const onHead = q[1] > H.C[1] - 1.05 * H.ry, most = (onHead || layer.hug) && !layer.free ? clear + (layer.slack ?? 0.006) : Infinity;
    const above = H.push(q, clear, most);
    support.push(above < clear + 0.015);
    d = norm3([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
    s += h;
    if (q[1] < cutY) { const f = (p[1] - cutY) / ((p[1] - q[1]) || 1); pts.push(p.map((v, k) => v + (q[k] - v) * f)); break; }
    p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; pts.push(p.slice());
    if (layer.toward && Math.hypot(H.tieB[0] - p[0], H.tieB[1] - p[1], H.tieB[2] - p[2]) < 0.012) break;
  }
  // the pivot: where the strand last rested on the body before hanging free to its tip
  let pv = support.length - 1; while (pv > 0 && !support[pv]) pv--;
  return { pts, pivotFrac: pts.length > 1 ? pv / (pts.length - 1) : 1 };
}

// the bun: strands wound round a centre at the tie, each a loop tilted its own way, covering a ball
function wound(H, layer, k, n, R) {
  const c = H.bunC, r = layer.wrap.radius, tilt = Math.acos(1 - 2 * (k + 0.5) / n), spin = k * 2.39996;
  const ax = [Math.sin(tilt) * Math.cos(spin), Math.cos(tilt), Math.sin(tilt) * Math.sin(spin)];
  const e1 = norm3(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(ax, e1);
  const pts = [], turns = 0.85 + 0.3 * R(), ph = R() * 6.283, rr = r * (0.75 + 0.25 * R());
  for (let j = 0; j <= 40; j++) { const a = ph + 6.283 * turns * j / 40; pts.push([0, 1, 2].map(i => c[i] + (e1[i] * Math.cos(a) + e2[i] * Math.sin(a)) * rr * (1 - 0.15 * j / 40))); }
  return { pts, pivotFrac: 1 };
}

export function grow(H, plan, seed) {
  const guides = [];
  if (plan.tie) {   // the tie, in the baked frame: on the scalp at the rest tie point; a bun sits just out from it
    const i = H.near(...plan.tie), n = [H.N[3 * i], H.N[3 * i + 1], H.N[3 * i + 2]];
    H.tieB = H.bakedOf(i).map((v, k) => v + n[k] * 0.012); H.tieN = n;
    H.bunC = H.tieB.map((v, k) => v + n[k] * 0.03);
  }
  plan.layers.forEach((layer, li) => {
    const R = rng(seed, 100 + li);
    let rs;
    if (layer.region === "tie") {   // roots on a small disc at the tie
      const n = H.tieN, e1 = norm3(cross(n, [0, 1, 0])), e2 = cross(n, e1);
      rs = Array.from({ length: layer.count }, (_, k) => { const a = k * 2.39996, rad = 0.016 * Math.sqrt((k + 0.5) / layer.count);
        return { p: H.tieB.map((v, i) => v + (e1[i] * Math.cos(a) + e2[i] * Math.sin(a)) * rad), n, r: plan.tie }; });
      rs.spacing = 0.016 * Math.sqrt(Math.PI / layer.count);
    } else rs = roots(H, layer.region === "face" || layer.region === "lip" ? faceTris() : SCALP, layer.density, layer.count, R);
    const width = layer.cover ? Math.max(layer.width, layer.cover * (rs.spacing ?? 0)) : layer.width;
    rs.forEach((root, k) => {
      const az = Math.abs(Math.atan2(root.r[0], root.r[2] - 0.55));
      root.front = az > 0.9 && az < 1.6 && R() < 0.55;
      const g = layer.wrap ? wound(H, layer, k, rs.length, R) : strand(H, layer, root, R);
      if (g.pts.length < 2) return;
      const { out: pts, L } = resample(g.pts, layer.segs);
      if (L < 0.003) return;
      const S = layer.segs, across = new Float32Array((S + 1) * 3), nrm = new Float32Array((S + 1) * 3), P = new Float32Array((S + 1) * 3);
      // the card's across direction: perpendicular to the strand within the volume's surface; kept continuous along it
      let prev = null;
      for (let j = 0; j <= S; j++) {
        const d = norm3(pts[Math.min(S, j + 1)].map((v, c) => v - pts[Math.max(0, j - 1)][c]));
        const n = layer.wrap ? norm3(pts[j].map((v, c) => v - H.bunC[c])) : H.volNormal(pts[j]);
        let a = cross(n, d); const al = Math.hypot(...a);
        a = al > 0.25 ? a.map(v => v / al) : prev ?? norm3(cross(root.n, d));
        if (prev && dot(a, prev) < 0) a = a.map(v => -v);
        prev = a;
        if (layer.twist) { const t = k * 2.39996, b = cross(d, a); a = norm3(a.map((v, c) => v * Math.cos(t) + b[c] * Math.sin(t))); }
        across.set(a, 3 * j); nrm.set(norm3(cross(d, a)), 3 * j);
      }
      // waves and curls: about the strand's own path, mostly in the card's plane, growing in past the root
      const cu = layer.curl;
      if (cu) { const ph = (root.r[1] * 3.1 + Math.atan2(root.r[0], root.r[2] - 0.55) * 1.3) + R() * 0.8, wl = cu.wave * (0.9 + 0.2 * R());
        for (let j = 1; j <= S; j++) { const s = L * j / S, amp = cu.amp * smooth(0, 0.3, j / S), w = 6.283 * s / wl + ph;
          for (let c = 0; c < 3; c++) pts[j][c] += amp * (Math.sin(w) * across[3 * j + c] + 0.2 * Math.cos(w) * nrm[3 * j + c]);
          H.push(pts[j], 0.002); } }
      if (layer.twist) { const t = k * 2.39996, sp = 0.012 + 0.02 * R();
        for (let j = 1; j <= S; j++) { const f = j / S, bulge = sp * Math.sin(Math.PI * Math.min(1, f * 1.3)), b = cross([0, 1, 0], across.slice(3 * j, 3 * j + 3));
          for (let c = 0; c < 3; c++) pts[j][c] += (across[3 * j + c] * Math.cos(t) + b[c] * Math.sin(t)) * bulge; } }
      for (let j = 0; j <= S; j++) P.set(pts[j], 3 * j);
      const pj = Math.round(g.pivotFrac * S);
      guides.push({ layer: li, name: layer.name, pts: P, across, nrm, L, segs: S, pivot: pts[pj], free: (j) => Math.max(0, (j - pj) / S * L),
        width: width * (0.8 + 0.4 * R()), tipTaper: layer.tipTaper, shade: layer.shade, tile: layer.tiles[Math.floor(R() * layer.tiles.length)], seed: R(), mirror: R() < 0.5 });
    });
  });
  return guides;
}
