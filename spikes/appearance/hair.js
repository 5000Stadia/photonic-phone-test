// Spike "appearance" (M1, R2): hair forms, built from the person's own baked scalp so they fit any head.
//   bald      a cropped horseshoe round the sides and back
//   cropped   a thin shell (a few millimetres) over the painted scalp
//   short     a shell, an outer shell of tufts that breaks the silhouette, and a fringe of cards swept to one side
//   tied      a tight shell with fine tufts, and a bun or a ponytail at the back
//   loose     a shell with tufts, and long hair as locks: ribbon cards, each a chain stepped down under gravity and
//             pushed out of the body, in two layers, some falling in front of the shoulders and most behind
//   coif      a linen coif (women) or a wool cap (men): the period-neutral cover
// and a full beard as a shell over the jaw (stubble and moustaches stay painted).
// Edges are not geometry: every shell and card is cut by alpha test in its shader, from the rest-frame hairline
// (skin.js), so the hairline is a smooth line broken into fine strands, not the mesh's triangles. Shells' roots take
// the scalp paint's colour (hairRootNode), so where a shell thins out there is no seam.
// Materials are shared by everyone (one per variant and tier); the person's values come from params.js.
import { REST, SCALP, INDEX, L } from "./rest.js";
import { hairlineJS, earJS, beardJS, hairlineNode, earNode, beardNode, hairRootNode, strandsNode } from "./skin.js";
import { param, COLS } from "./params.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// a cheap deterministic value noise, for tufts and lock jitter
function vnoise(x, y, z, s) {
  const h = (i, j, k) => { let n = (i * 374761393 + j * 668265263 + k * 2147483647 + s * 1274126177) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++)
    r += h(xi + a, yi + b, zi + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w);
  return r;
}

// ---- materials: variant x tier, shared ----
//   shell   inner shell, cut at the hairline (or the beard's edge: "beard")
//   tufts   outer shell, cut into clumps along the strand direction
//   card    fringe and lock cards: tapered, ragged tips and sides
//   solid   bun and tail
//   cloth   coif and cap, cut at its hem
const made = new Map();
export function hairMaterial(THREE, variant, tier = "near") {
  const key = variant + "/" + tier;
  if (made.has(key)) return made.get(key);
  const T = THREE.TSL;
  const { attribute, vec3, vec2, float, mix, mx_noise_float, smoothstep, abs, max, clamp, sin, cos, atan } = T;
  const near = tier === "near", far = tier === "far";
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  const hp = param(THREE, COLS.hair), marks = param(THREE, COLS.marks), sc = param(THREE, COLS.scalp);
  const seed = marks.w, grey = hp.w;

  if (variant === "cloth") {
    const cap = param(THREE, COLS.cap), p = attribute("rest", "vec3");
    m.colorNode = near ? cap.xyz.mul(mx_noise_float(p.mul(60)).mul(0.06).add(1)).mul(mx_noise_float(p.mul(3)).mul(0.12).add(1)) : cap.xyz;
    m.roughness = 0.92;
    // the hem: the coif's face opening and lower edge, or the cap's brim (cap.w = 1 for a man's cap)
    const { az } = hairlineNode(T, p, float(0));
    const open = float(1.55).sub(smoothstep(7.45, 7.95, p.y).mul(0.6));
    const coif = smoothstep(open.add(0.04), open.add(0.1), az).add(smoothstep(7.95, 8.05, p.y)).clamp(0, 1)
      .mul(smoothstep(6.6, 6.68, p.y)).mul(float(1).sub(earNode(T, p)));
    const back = smoothstep(0.6, -0.2, p.z);
    const capm = smoothstep(7.8, 7.84, p.y.add(back.mul(0.3)));
    m.alphaTest = 0.5;
    m.opacityNode = mix(coif, capm, cap.w);
    m.name = key; made.set(key, m); return m;
  }

  // colour: the hair's own, greyed (salt and pepper near, an even mix further off), darker toward the roots
  const s = attribute("strand", "vec4");            // (sin a, cos a, along, depth 0 root .. 1 surface)
  // round the head; on a card the angle also runs across the lock, so its strands run along it (not in bands across)
  const ang = variant === "card" ? atan(s.x, s.y).add(attribute("card", "vec2").x.mul(0.15)) : null;
  const ring = ang ? (f) => vec3(sin(ang).mul(f), cos(ang).mul(f), 0) : (f) => vec3(s.x.mul(f), s.y.mul(f), 0);
  const streak = near ? mx_noise_float(ring(16).add(vec3(0, 0, s.z.mul(4).add(seed)))) : float(0);
  const clump = far ? float(0) : mx_noise_float(ring(2.6).add(vec3(0, 0, s.z.mul(1.5).add(seed).add(3))));
  const greyAvg = grey.mul(grey).mul(0.7).add(grey.mul(0.15));
  const greyMix = near
    ? smoothstep(float(1.05).sub(grey), float(1.25).sub(grey), mx_noise_float(ring(90).add(vec3(0, 0, s.z.mul(1.5).add(seed).add(7)))).mul(0.5).add(0.5)).mul(0.6).add(grey.mul(grey).mul(0.4))
    : greyAvg;
  const hc = mix(hp.xyz, vec3(0.66, 0.64, 0.61), greyMix);
  const root = hairRootNode(THREE);
  m.colorNode = mix(root, hc.mul(streak.mul(0.22).add(clump.mul(0.18)).add(1)), smoothstep(0.3, 1.0, s.w));
  m.roughnessNode = float(0.62).add(clump.mul(0.1));

  if (variant === "shell" || variant === "tufts" || variant === "beard") {
    const p = attribute("rest", "vec3");
    const str = near ? strandsNode(T, p, seed) : float(0.5);
    let cover;
    if (variant === "beard") cover = beardNode(T, p).sub(0.35).add(str.sub(0.5).mul(0.5));
    else {
      const { hl, az } = hairlineNode(T, p, sc.x);
      // bald: a horseshoe round the sides and back
      const shoe = mix(float(1), smoothstep(7.82, 7.76, p.y).mul(smoothstep(1.1, 1.25, az)), sc.z);
      cover = smoothstep(hl, hl.add(0.04), p.y.add(str.sub(0.5).mul(0.07))).mul(float(1).sub(earNode(T, p))).mul(shoe).sub(0.5);
    }
    if (variant === "tufts") {   // clumps that run along the strands, thinning toward the shell's outer edge
      const cl = far ? float(0.5) : mx_noise_float(vec3(s.x.mul(11), s.y.mul(11), s.z.mul(2.2).add(seed))).mul(0.5).add(0.5);
      // clumps only (finer breakup left isolated specks that caught the light like dust)
      cover = cover.min(smoothstep(0.5, 0.62, cl).sub(0.5));
    }
    m.alphaTest = 0.5;
    m.opacityNode = cover.add(0.5);
  } else if (variant === "card") {
    const c = attribute("card", "vec2");             // (across 0..1, along 0 root .. 1 tip)
    const lenJit = near ? mx_noise_float(vec3(c.x.mul(9), 0, seed.add(s.x.mul(7)))).mul(0.12) : float(0);
    const tip = smoothstep(1.0, 0.82, c.y.add(lenJit));
    const side = float(1).sub(abs(c.x.sub(0.5)).mul(2));
    const strands = near ? mx_noise_float(vec3(c.x.mul(40), c.y.mul(3), seed.add(s.y.mul(5)))).mul(0.5).add(0.5) : float(0.5);
    // a lock narrows to its tip and frays at its sides
    const width = mix(float(1), float(0.5), smoothstep(0.5, 1.0, c.y));
    m.alphaTest = 0.5;
    m.opacityNode = tip.mul(smoothstep(float(1).sub(width), float(1).sub(width).add(0.2), side.add(strands.sub(0.5).mul(0.3))));
  }
  m.name = key; made.set(key, m); return m;
}

// ---- geometry ----
// a form's shell at a rest-frame point: thickness in rest decimetres. The geometry reaches a little past the hairline
// (thin there); the shader makes the edge.
function shellDepth(form, lk, x, y, z, R) {
  if (earJS(x, y, z)) return 0;
  const hl = hairlineJS(x, y, z, lk.hair.recede);
  const n = vnoise(x * 6, y * 6, z * 6, R) - 0.5;
  const g = smooth(hl - 0.08, hl + 0.12, y);
  const top = smooth(7.3, 8.3, y), back = smooth(0.5, -0.3, z), side = smooth(0.5, 0.85, Math.abs(x));
  switch (form) {
    case "bald": {
      const a = Math.abs(Math.atan2(x, z - L.headC[2]));
      return g * smooth(7.92, 7.8, y) * smooth(1.0, 1.15, a) * 0.025;
    }
    case "cropped": return g * 0.03;
    case "short": return g * (0.06 + 0.1 * top + 0.03 * back + n * 0.04);
    case "tied":  return g * (0.04 + 0.04 * top + n * 0.01);
    case "loose": return g * (0.07 + 0.08 * top + 0.04 * side - 0.02 * back + n * 0.02);
    default: return 0;
  }
}

// face triangles (for beards): the jaw, chin, cheeks and upper lip
let FACE = null;
function faceTris() {
  if (FACE) return FACE;
  const keep = [];
  for (let t = 0; t < INDEX.length; t += 3) {
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) { const i = INDEX[t + k]; ok = REST[3 * i + 1] > 5.85 && REST[3 * i + 1] < 7.35 && REST[3 * i + 2] > 0.15; }
    if (ok) keep.push(INDEX[t], INDEX[t + 1], INDEX[t + 2]);
  }
  return (FACE = new Uint16Array(keep));
}

// a shell: the person's baked surface vertices (triangle set tris) pushed out along their normals by depth (rest dm,
// times k metres per rest dm), plus `extra` metres where depth > 0
function shell(THREE, P, N, depth, k, tris = SCALP, extra = 0, outer = 0) {
  const map = new Map(), src = [], idx = [];
  const vert = (i) => { if (!map.has(i)) { map.set(i, src.length); src.push(i); } return map.get(i); };
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (depth[a] <= 0 && depth[b] <= 0 && depth[c] <= 0) continue;
    idx.push(vert(a), vert(b), vert(c));
  }
  const n = src.length, pos = new Float32Array(n * 3), rest = new Float32Array(n * 3), strand = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const i = src[v], d = depth[i] * k * (1 + outer) + 0.0008 + extra * Math.min(1, depth[i] * 20);
    for (let c = 0; c < 3; c++) { pos[3 * v + c] = P[3 * i + c] + N[3 * i + c] * d; rest[3 * v + c] = REST[3 * i + c]; }
    const x = REST[3 * i], y = REST[3 * i + 1], z = REST[3 * i + 2], a = Math.atan2(x, z - L.headC[2]);
    strand.set([Math.sin(a), Math.cos(a), (L.crown - y) * 0.6, outer ? 1 : Math.min(1, 0.3 + depth[i] * 5)], 4 * v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("rest", new THREE.BufferAttribute(rest, 3));
  g.setAttribute("strand", new THREE.BufferAttribute(strand, 4));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ribbon cards along chains of points: each chain a lock, `width` metres across, its plane facing out from the axis
// through the head (so locks lie over the head and back rather than edge-on)
function cards(THREE, chains, head) {
  const pos = [], strand = [], card = [], idx = [];
  for (const { pts, width, a, twist = 0 } of chains) {
    const base = pos.length / 3, S = pts.length;
    for (let j = 0; j < S; j++) {
      const p = pts[j], q = pts[Math.min(S - 1, j + 1)], o = pts[Math.max(0, j - 1)];
      const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      const r = [p[0] - head[0], 0, p[2] - head[2]];                    // outward, horizontal
      let sd = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
      const sl = Math.hypot(...sd) || 1; sd = sd.map(v => v / sl);
      if (twist) {   // turn the card about its own line (crossed cards give a tail volume from every side)
        const dl = Math.hypot(...d) || 1, dn = d.map(v => v / dl);
        const b = [dn[1] * sd[2] - dn[2] * sd[1], dn[2] * sd[0] - dn[0] * sd[2], dn[0] * sd[1] - dn[1] * sd[0]];
        sd = sd.map((v, c) => v * Math.cos(twist) + b[c] * Math.sin(twist));
      }
      const w = width * (1 - 0.35 * j / (S - 1));
      for (const u of [0, 0.5, 1]) {
        const bulge = u === 0.5 ? 0.25 * w : 0;                          // a little round across the lock
        const rl = Math.hypot(r[0], r[2]) || 1;
        pos.push(p[0] + sd[0] * (u - 0.5) * w + r[0] / rl * bulge, p[1] + sd[1] * (u - 0.5) * w, p[2] + sd[2] * (u - 0.5) * w + r[2] / rl * bulge);
        strand.push(Math.sin(a), Math.cos(a), 0.3 + j / (S - 1), 0.6 + 0.4 * Math.min(1, j / 3));
        card.push(u, j / (S - 1));
      }
    }
    for (let j = 0; j < S - 1; j++) for (let c = 0; c < 2; c++) {
      const a0 = base + j * 3 + c, b0 = a0 + 3;
      idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("strand", new THREE.Float32BufferAttribute(strand, 4));
  g.setAttribute("card", new THREE.Float32BufferAttribute(card, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// a chain from p falling under gravity, pushed out of the body; drift adds a per-step pull (e.g. back, or forward)
function fall(p0, dir0, length, seg, push, clear, drift) {
  const p = p0.slice(), pts = [p.slice()], step = length / seg;
  let dir = dir0.slice();
  for (let j = 1; j <= seg; j++) {
    const n = Math.hypot(...dir); dir = dir.map(v => v / n);
    const q = [p[0] + dir[0] * step, p[1] + dir[1] * step, p[2] + dir[2] * step];
    push(q, clear);
    const dl = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) || 1;
    dir = [(q[0] - p[0]) / dl + drift[0], (q[1] - p[1]) / dl - 0.3 + drift[1], (q[2] - p[2]) / dl + drift[2]];
    p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; pts.push(p.slice());
  }
  return pts;
}
const at = (P, N, i, d) => [P[3 * i] + N[3 * i] * d, P[3 * i + 1] + N[3 * i + 1] * d, P[3 * i + 2] + N[3 * i + 2] * d];

// long loose hair: locks round the head, the face's sides falling in front of the shoulders, the rest behind
function locks(THREE, P, N, depth, k, lk, push, R, head) {
  const chains = [], len = (lk.age < 12 ? 0.24 : 0.36) * lk.hair.length * (k / 0.1), sk = k / 0.1;
  for (const layer of [0, 1]) {
    const n = layer ? 14 : 18;
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5 * layer + 0.3 * (vnoise(s * 1.7, layer * 5, 0, R) - 0.5)) / n;
      const a = 1.0 + t * 2 * (Math.PI - 1.0);                      // round the back, from one temple to the other
      const az = a > Math.PI ? a - 2 * Math.PI : a;
      const sideness = Math.min(1, Math.abs(Math.abs(az) - Math.PI) / (Math.PI - 1.0));
      const ay = 7.75 + 0.25 * sideness + (layer ? 0.3 : 0);       // the outer layer from near the crown, draping over the head
      const i = nearestRest(Math.sin(az) * 0.75, ay, L.headC[2] + Math.cos(az) * 0.95);
      const p0 = at(P, N, i, depth[i] * k + (layer ? 0.006 : 0.003) * sk);
      const front = sideness > 0.8 && vnoise(s, layer, 3, R) > 0.45;  // some side locks fall forward, over the shoulder
      const L0 = len * (0.8 + 0.35 * vnoise(s * 0.9, layer, 1, R) - (front ? 0.15 : 0.25 * sideness));
      const sx = Math.sign(P[3 * i] - head[0]);
      const pts = fall(p0, [N[3 * i] * 0.4, -0.6, N[3 * i + 2] * 0.4], L0, 14, push, (0.012 + layer * 0.006) * sk,
        front ? [0, 0, 0.05] : [-sx * 0.03 * sideness, 0, -0.1 * sideness]);
      chains.push({ pts, width: (0.05 + 0.02 * vnoise(s, layer, 7, R)) * sk, a: az });
    }
  }
  return cards(THREE, chains, head);
}

// a fringe: short cards from just inside the front hairline, swept to one side and down over the forehead's edge
function fringe(THREE, P, N, depth, k, lk, push, R, head, tight) {
  const chains = [], sk = k / 0.1, side = R % 2 ? 1 : -1;
  const n = tight ? 14 : 12;
  for (let s = 0; s < n; s++) {
    const az = -1.05 + 2.1 * (s + 0.5) / n;
    const hl = hairlineJS(Math.sin(az) * 0.7, 8.0, L.headC[2] + Math.cos(az) * 0.9, lk.hair.recede);
    const i = nearestRest(Math.sin(az) * 0.7, hl + (tight ? 0.12 : 0.22), L.headC[2] + Math.cos(az) * 0.95);
    const p0 = at(P, N, i, depth[i] * k * 0.8);
    // tight (tied hair): strands drawn straight back over the head; otherwise forward then down, swept to one side
    const dir = tight ? [-N[3 * i] * 0.2, 0.6, -1] : [N[3 * i] * 0.5 + side * 0.6, -0.15, N[3 * i + 2] * 0.6 + 0.3];
    const L0 = (tight ? 0.04 : 0.055 + 0.02 * vnoise(s, 2, 2, R)) * sk;
    const pts = fall(p0, dir, L0, 6, push, (0.004 + depth[i] * 0.06) * sk, tight ? [0, 0.32, -0.1] : [side * 0.08, 0.1, 0]);
    chains.push({ pts, width: (tight ? 0.018 : 0.026) * sk, a: az });
  }
  return cards(THREE, chains, head);
}

// a ponytail: crossed cards from the tie at the back of the head, spreading a little as they fall
function ponytail(THREE, P, N, depth, k, lk, push, R, head) {
  const sk = k / 0.1, i = nearestRest(0, 7.55, -0.32), p0 = at(P, N, i, depth[i] * k + 0.004 * sk);
  const len = 0.26 * lk.hair.length * sk, chains = [];
  for (let c = 0; c < 6; c++) {
    const sp = (vnoise(c, 1, 1, R) - 0.5) * 0.3;
    const pts = fall(p0, [sp, -1, -0.5], len * (0.85 + 0.25 * vnoise(c, 2, 2, R)), 12, push, 0.012 * sk, [sp * 0.05, -0.2, 0]);
    chains.push({ pts, width: 0.045 * sk, a: Math.PI + sp, twist: c * Math.PI / 3 });
  }
  return cards(THREE, chains, head);
}

function capDepth(lk, x, y, z) {
  if (lk.male) {
    const back = smooth(0.6, -0.2, z);
    return smooth(7.7, 7.8, y + back * 0.3) * (0.06 + 0.1 * smooth(7.9, 8.4, y) + 0.06 * back * smooth(7.6, 8.1, y));
  }
  if (earJS(x, y, z)) return 0;
  const a = Math.abs(Math.atan2(x, z - L.headC[2]));
  const open = 1.55 - 0.6 * smooth(7.45, 7.95, y);
  const outside = Math.min(1, smooth(open - 0.05, open + 0.15, a) + smooth(7.9, 8.12, y));
  const rim = smooth(open, open + 0.1, a) * smooth(open + 0.35, open + 0.15, a) * 0.06;
  const puff = 0.22 * Math.exp(-((x / 0.45) ** 2 + ((y - 7.55) / 0.4) ** 2 + ((z + 0.3) / 0.35) ** 2));
  return outside * smooth(6.5, 6.62, y) * (0.1 + rim + puff);
}

export function addHair(THREE, group, lk, tier = "near") {
  const t0 = performance.now();
  const body = group.children[0];
  const P = body.geometry.attributes.position.array, N = body.geometry.attributes.normal.array;
  const eyes = group.children.filter(o => o.name === "eye");
  const k = eyes.length === 2 ? eyes[0].position.distanceTo(eyes[1].position) / (2 * L.eye[0]) : 0.1;   // metres per rest dm
  const R = (lk.skin.shift * 1000) | 0, sk = k / 0.1;
  const form = lk.hair.form, made = [];
  const head = eyes.length === 2 ? [(eyes[0].position.x + eyes[1].position.x) / 2, 0, (eyes[0].position.z + eyes[1].position.z) / 2 - 0.07 * sk] : [0, 0, 0];
  const depth = new Float32Array(P.length / 3);
  let push = null;
  const eyeY = eyes.length ? eyes[0].position.y : P[3 * SCALP[0] + 1];
  const field = () => push ??= bodyField(P, N, eyeY - 0.6 * sk);   // the head, neck, shoulders and upper back
  const add = (geo, variant) => { const m = new THREE.Mesh(geo, hairMaterial(THREE, variant, tier)); m.userData.variant = variant; made.push(m); };
  if (form === "bald" || form === "cropped" || form === "short" || form === "tied" || form === "loose") {
    for (let t = 0; t < SCALP.length; t++) { const i = SCALP[t]; depth[i] = Math.max(0, shellDepth(form, lk, REST[3 * i], REST[3 * i + 1], REST[3 * i + 2], R)); }
    add(shell(THREE, P, N, depth, k), "shell");
    if (form === "short" || form === "loose" || form === "tied")   // tufts: an outer shell broken into clumps
      add(shell(THREE, P, N, depth, k, SCALP, (form === "tied" ? 0.003 : 0.008) * sk, 0.25), "tufts");
    if (form === "short") add(fringe(THREE, P, N, depth, k, lk, field(), R, head, false), "card");
    if (form === "tied") {
      if (R % 3) add(ponytail(THREE, P, N, depth, k, lk, field(), R, head), "card");
      else add(bun(THREE, P, N, depth, k), "solid");
    }
    if (form === "loose") add(locks(THREE, P, N, depth, k, lk, field(), R, head), "card");
  } else if (form === "coif") {
    const cd = new Float32Array(P.length / 3);
    for (let t = 0; t < SCALP.length; t++) { const i = SCALP[t]; cd[i] = capDepth(lk, REST[3 * i], REST[3 * i + 1], REST[3 * i + 2]); }
    add(shell(THREE, P, N, cd, k), "cloth");
  }
  if (lk.beard === "beard") {
    const F = faceTris(), bd = new Float32Array(P.length / 3);
    for (let t = 0; t < F.length; t++) {
      const i = F[t], z = beardJS(REST[3 * i], REST[3 * i + 1], REST[3 * i + 2]);
      bd[i] = smooth(0, 0.3, z) * (0.03 + 0.05 * smooth(6.6, 6.2, REST[3 * i + 1]));
    }
    add(shell(THREE, P, N, bd, k, F), "beard");
  }
  for (const m of made) { m.name = "hair"; m.castShadow = true; group.add(m); }
  return { ms: performance.now() - t0, triangles: made.reduce((s, m) => s + m.geometry.index.count / 3, 0) };
}

// switch a built person's hair materials to another tier
export function hairTier(THREE, group, tier) {
  group.traverse(o => { if (o.name === "hair" && o.userData.variant) o.material = hairMaterial(THREE, o.userData.variant, tier); });
}

// ---- helpers kept from round one ----
function bodyField(P, N, yMin) {
  const cell = 0.04, grid = new Map(), key = (x, y, z) => ((Math.floor(x / cell) + 512) * 1024 + Math.floor(y / cell) + 512) * 1024 + Math.floor(z / cell) + 512;
  for (let i = 0; i < P.length / 3; i++) {
    if (P[3 * i + 1] < yMin) continue;
    const k = key(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
  }
  // push p out so it stands at least `clear` metres outside the nearest surface vertex's tangent plane
  return (p, clear) => {
    let best = -1, bd = Infinity;
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(((cx + a + 512) * 1024 + cy + b + 512) * 1024 + cz + c + 512); if (!l) continue;
      for (const i of l) { const d = (P[3 * i] - p[0]) ** 2 + (P[3 * i + 1] - p[1]) ** 2 + (P[3 * i + 2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) return;
    const s = (p[0] - P[3 * best]) * N[3 * best] + (p[1] - P[3 * best + 1]) * N[3 * best + 1] + (p[2] - P[3 * best + 2]) * N[3 * best + 2];
    if (s < clear) for (let k = 0; k < 3; k++) p[k] += N[3 * best + k] * (clear - s);
  };
}
function nearestRest(x, y, z) {
  let best = 0, bd = Infinity;
  for (let t = 0; t < SCALP.length; t++) {
    const i = SCALP[t], d = (REST[3 * i] - x) ** 2 + (REST[3 * i + 1] - y) ** 2 + (REST[3 * i + 2] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function tail(THREE, P, N, depth, k, lk, push) {
  const i = nearestRest(0, 7.55, -0.3), d = depth[i] * k;
  const p = [P[3 * i] + N[3 * i] * d, P[3 * i + 1] + N[3 * i + 1] * d, P[3 * i + 2] + N[3 * i + 2] * d];
  const SEG = 12, SIDES = 8, len = 0.26 * lk.hair.length * (k / 0.1), r0 = 0.022 * (k / 0.1);
  let dir = [0, -0.4, -1]; const pts = [p.slice()];
  for (let j = 1; j <= SEG; j++) {
    const n = Math.hypot(...dir); dir = dir.map(v => v / n);
    const q = p.map((v, c) => v + dir[c] * len / SEG); push(q, r0 * 0.9);
    dir = [q[0] - p[0], q[1] - p[1] - 0.04, q[2] - p[2]]; p.splice(0, 3, ...q); pts.push(q);
  }
  const pos = [], strand = [], idx = [];
  for (let j = 0; j <= SEG; j++) {
    const t = j / SEG, r = r0 * (j === 0 ? 0.7 : (1 - 0.65 * t) * (1 + 0.25 * Math.sin(t * 3)));
    for (let s = 0; s < SIDES; s++) {
      const a = s / SIDES * Math.PI * 2;
      pos.push(pts[j][0] + Math.cos(a) * r, pts[j][1], pts[j][2] + Math.sin(a) * r);
      strand.push(Math.sin(a) * 0.5, Math.cos(a) * 0.5, t * 1.5, 1);
    }
  }
  for (let j = 0; j < SEG; j++) for (let s = 0; s < SIDES; s++) {
    const a = j * SIDES + s, b = j * SIDES + (s + 1) % SIDES;
    idx.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("strand", new THREE.Float32BufferAttribute(strand, 4));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function bun(THREE, P, N, depth, k) {
  const i = nearestRest(0, 7.75, -0.38), d = depth[i] * k;
  const g = new THREE.SphereGeometry(1, 14, 10);
  const r = 0.045 * (k / 0.1);
  const strand = [];
  const pa = g.attributes.position;
  for (let v = 0; v < pa.count; v++) { const a = Math.atan2(pa.getX(v), pa.getZ(v)); strand.push(Math.sin(a) * 0.5, Math.cos(a) * 0.5, pa.getY(v) * 0.5 + 0.5, 1); }
  g.setAttribute("strand", new THREE.Float32BufferAttribute(strand, 4));
  g.scale(r * 1.15, r * 0.9, r * 0.8);
  g.translate(P[3 * i] + N[3 * i] * (d + r * 0.45), P[3 * i + 1] + N[3 * i + 1] * (d + r * 0.45), P[3 * i + 2] + N[3 * i + 2] * (d + r * 0.45));
  return g;
}
