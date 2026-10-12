// Spike "appearance" (M1, R2): the skin, brows, lash line, lips, stubble and the scalp under the hair, as one TSL node
// material on the MakeHuman body. No texture: every mask is a function of the rest frame (rest.js), so it sits on the
// same place on everyone, at any resolution; the person's own values come from the shared parameter texture (params.js),
// so one compiled material per tier serves everyone. Tiers: near (all of it), mid (one octave of mottling, no
// freckles, spots or hair grain), far (no noise at all: regional colour only).
// Lighting: three's physical model plus a wrapped, red-shifted diffuse (light bleeding past the terminator, more in red,
// the cheap stand-in for subsurface scattering) so shadows on skin are soft and warm rather than grey: the painterly
// part of the brief. Works on WebGPU and WebGL 2 (node materials only).
import { L } from "./rest.js";
import { param, COLS } from "./params.js";

// The hairline, as a height on the rest head at each azimuth around it (0 = forehead, pi = nape), piecewise linear.
// Written once here as data; hairlineJS and the TSL version below both read it, so geometry and paint agree.
export const HAIRLINE = {
  a: [0, 0.7, 1.2, 1.9, Math.PI],
  h: [8.06, 7.86, 7.12, 7.05, 6.62],          // the line on a full head of hair
  recede: [0.30, 0.42, 0.10, 0, 0],           // added at full recession (men, with age): the M-shaped retreat
};
export function hairlineJS(x, y, z, recede) {
  const a = Math.abs(Math.atan2(x, z - L.headC[2]));
  const { a: A, h: Hh, recede: Rc } = HAIRLINE;
  let h = Hh[0] + Rc[0] * recede;
  for (let k = 1; k < A.length; k++) {
    const t = Math.min(1, Math.max(0, (a - A[k - 1]) / (A[k] - A[k - 1])));
    h += (Hh[k] - Hh[k - 1] + (Rc[k] - Rc[k - 1]) * recede) * t;
  }
  return h;
}
// the ear and a margin around it, which no hair covers (rest frame, either side)
export function earJS(x, y, z) {
  const dx = (Math.abs(x) - L.ear[0]) / 0.2, dy = (y - L.ear[1]) / 0.5, dz = (z - L.ear[2]) / 0.36;
  return dx * dx + dy * dy + dz * dz < 1;
}

// the full-beard zone (jaw, chin, cheeks below a line from the sideburn to the mouth), lips and ears left clear;
// the same formula as the TSL beardZone below, for the beard shell's geometry
export function beardJS(x, y, z) {
  const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const ax = Math.abs(x);
  const bt = 6.8 + (7.08 - 6.8) * sm(0.26, 0.74, ax) - sm(0.24, 0.34, ax) * sm(0.6, 0.4, ax) * 0.13;
  const u = x / L.mouthHalf, v = y - L.mouth[1], su = Math.max(0, 1 - u * u);
  const lip = Math.abs(u) < 1.08 && v < 0.085 * Math.sqrt(su) + 0.012 && v > -0.115 * su ** 0.55 - 0.018 ? 1 : 0;
  return sm(bt + 0.05, bt - 0.05, y) * sm(5.95, 6.15, y) * sm(0.3, 0.6, z) * (earJS(x, y, z) ? 0 : 1) * (1 - lip);
}


// ---- TSL versions of the shared masks, for any material with a rest attribute (skin, hair shells, beard) ----
export function hairlineNode(T, p, recede) {
  const { abs, atan, float, clamp } = T;
  const az = abs(atan(p.x, p.z.sub(L.headC[2])));
  let hl = float(HAIRLINE.h[0]).add(recede.mul(HAIRLINE.recede[0]));
  for (let k = 1; k < HAIRLINE.a.length; k++) {
    const t = clamp(az.sub(HAIRLINE.a[k - 1]).div(HAIRLINE.a[k] - HAIRLINE.a[k - 1]), 0, 1);
    hl = hl.add(t.mul(recede.mul(HAIRLINE.recede[k] - HAIRLINE.recede[k - 1]).add(HAIRLINE.h[k] - HAIRLINE.h[k - 1])));
  }
  return { hl, az };
}
export function earNode(T, p) {
  const { abs, vec3, length, smoothstep } = T;
  const ed = vec3(abs(p.x).sub(L.ear[0]).div(0.2), p.y.sub(L.ear[1]).div(0.5), p.z.sub(L.ear[2]).div(0.36));
  return smoothstep(1.0, 0.8, length(ed));
}
export function beardNode(T, p) {
  const { abs, mix, float, smoothstep } = T;
  const ax = abs(p.x), y = p.y;
  const bt = mix(float(6.8), float(7.08), smoothstep(0.26, 0.74, ax)).sub(smoothstep(0.24, 0.34, ax).mul(smoothstep(0.6, 0.4, ax)).mul(0.13));
  return smoothstep(bt.add(0.05), bt.sub(0.05), y).mul(smoothstep(5.95, 6.15, y)).mul(smoothstep(0.3, 0.6, p.z)).mul(float(1).sub(earNode(T, p)));
}
// the hair's colour at its roots, greyed: the scalp paint and every hair shell's inner face use it, so they meet
// without a seam
export function hairRootNode(THREE) {
  const T = THREE.TSL, h = param(THREE, COLS.hair), g = h.w;
  return T.mix(h.xyz, T.vec3(0.6, 0.58, 0.55), g.mul(g).mul(0.7).add(g.mul(0.15))).mul(0.62);
}
// fine strands across an edge: thin streaks running along the hair's direction (rest frame: down from the crown)
export function strandsNode(T, p, seed) {
  const { atan, vec3, mx_noise_float, sin, cos } = T;
  const a = atan(p.x, p.z.sub(L.headC[2]));
  return mx_noise_float(vec3(sin(a).mul(260), cos(a).mul(260), p.y.mul(6).add(seed))).mul(0.5).add(0.5);
}

export function lightingModel(THREE) {
  const { vec3, normalView, diffuseColor } = THREE.TSL;
  return class SkinLighting extends THREE.PhysicalLightingModel {
    direct(data, builder) {
      super.direct(data, builder);
      const { lightDirection, lightColor, reflectedLight } = data;
      const ndl = normalView.dot(lightDirection);
      const wrap = vec3(0.5, 0.26, 0.16);                        // red wraps furthest
      const wrapped = ndl.add(wrap).div(wrap.add(1)).clamp();
      const extra = wrapped.sub(ndl.clamp()).max(0);             // only what the plain Lambert term left out
      reflectedLight.directDiffuse.addAssign(extra.mul(lightColor).mul(diffuseColor.rgb).mul(1 / Math.PI));
    }
  };
}

export const TIERS = ["near", "mid", "far"];
const made = new Map();
export function skinMaterial(THREE, tier = "near") {
  const key = tier;
  if (made.has(key)) return made.get(key);
  const T = THREE.TSL;
  const { Fn, attribute, vec3, float, abs, clamp, exp, sqrt, pow, sin, mix, smoothstep, length,
    mx_fractal_noise_vec3, mx_noise_vec3, mx_noise_float, mx_worley_noise_float, mx_cell_noise_float, floor } = T;
  const near = tier === "near", far = tier === "far";
  const SkinLighting = lightingModel(THREE);
  class SkinMaterial extends THREE.MeshStandardNodeMaterial {
    setupLightingModel() { return new SkinLighting(); }
  }
  const P = (c) => param(THREE, c);
  const skinP = P(COLS.skin), lipP = P(COLS.lip), browP = P(COLS.brow), hairP = P(COLS.hair);
  const bs = P(COLS.browShape), marks = P(COLS.marks), sc = P(COLS.scalp), fa = P(COLS.facial);
  const u = {
    skin: skinP.xyz, blush: skinP.w, lip: lipP.xyz, lipFull: lipP.w, brow: browP.xyz, bThick: browP.w, grey: hairP.w,
    bArch: bs.x, bLift: bs.y, bGap: bs.z, bDense: bs.w,
    freckles: marks.x, mottle: marks.y, spots: marks.z, shift: marks.w,
    recede: sc.x, scalp: sc.y, bald: sc.z, stubble: sc.w, beard: fa.x, moOnly: fa.y,
  };
  const E = L.eye, ER = L.eyeR;

  const p = attribute("rest", "vec3");
  const ax = abs(p.x), y = p.y, z = p.z;
  const g2 = (dx, dy, rx, ry) => exp(dx.div(rx).pow(2).add(dy.div(ry).pow(2)).negate());
  const band = (v, lo, hi, s) => smoothstep(lo - s, lo + s, v).mul(smoothstep(hi + s, hi - s, v));

  // ---- noise, by tier: near 3 octaves (3 channels); mid one octave; far none ----
  const q = p.add(u.shift);
  const nf = far ? vec3(0) : near ? mx_fractal_noise_vec3(q.mul(2.2), 3, 2.0, 0.5) : mx_noise_vec3(q.mul(2.2));
  const front = smoothstep(0.85, 1.2, z);

  const { hl, az } = hairlineNode(T, p, u.recede);
  const ear = earNode(T, p);
  const scalpN = near ? mx_noise_float(q.mul(vec3(9, 40, 9))) : float(0);
  // the scalp paint: full at the hairline's inner edge, fading out through fine strands (near) over ~4 mm
  const strands = near ? strandsNode(T, p, u.shift) : float(0.5);
  let scalp = smoothstep(hl.sub(0.03), hl.add(0.03), y.add(strands.sub(0.5).mul(0.05))).mul(float(1).sub(ear));
  scalp = scalp.mul(mix(float(1), smoothstep(7.95, 7.75, y).mul(smoothstep(0.9, 1.4, az)), u.bald));

  const ColorFn = Fn(() => {
    const base = vec3(u.skin).toVar();
    if (!far) {
      base.mulAssign(float(1).add(nf.x.mul(0.06).mul(u.mottle)));
      base.mulAssign(vec3(1).add(vec3(0.05, -0.03, -0.03).mul(nf.y.mul(u.mottle))));
    }
    const cheek = g2(ax.sub(0.47), y.sub(6.93), 0.2, 0.17).mul(front);
    const nose = g2(p.x, y.sub(6.93), 0.13, 0.12).mul(smoothstep(1.4, 1.6, z));
    const earW = smoothstep(0.7, 0.8, ax).mul(band(y, 6.85, 7.65, 0.05)).mul(band(z, 0.2, 0.85, 0.08));
    const chin = g2(p.x, y.sub(6.3), 0.16, 0.1).mul(front);
    const warm = cheek.mul(u.blush).add(nose.mul(0.55)).add(earW.mul(0.6)).add(chin.mul(0.2));
    base.mulAssign(mix(vec3(1), vec3(1.06, 0.84, 0.82), clamp(warm, 0, 1)));
    const under = g2(ax.sub(0.31), y.sub(7.135), 0.13, 0.055).mul(front);
    base.mulAssign(mix(vec3(1), vec3(0.88, 0.86, 0.93), under));
    const lid = g2(ax.sub(0.32), y.sub(7.39), 0.14, 0.055).mul(front);
    base.mulAssign(mix(vec3(1), vec3(0.9, 0.84, 0.84), lid));

    if (near) {   // freckles and age spots: near only
      const w = mx_worley_noise_float(q.mul(26));
      const on = mx_cell_noise_float(floor(q.mul(26)));
      const frZone = g2(ax.sub(0.25), y.sub(7.0), 0.4, 0.3).mul(front).add(smoothstep(4.6, 5.2, y).mul(smoothstep(6.0, 5.6, y)).mul(0.5));
      const freck = smoothstep(0.32, 0.12, w).mul(on.greaterThan(0.45).select(1, 0)).mul(frZone).mul(u.freckles);
      base.mulAssign(mix(vec3(1), vec3(0.78, 0.62, 0.52), clamp(freck, 0, 1)));
      const w2 = mx_worley_noise_float(q.mul(11).add(13.7));
      const on2 = mx_cell_noise_float(floor(q.mul(11).add(13.7)));
      const spot = smoothstep(0.3, 0.12, w2).mul(on2.greaterThan(0.85).select(1, 0)).mul(u.spots).mul(0.55);
      base.mulAssign(mix(vec3(1), vec3(0.8, 0.68, 0.58), spot));
    }

    // lips
    const lu = p.x.div(L.mouthHalf), lv = y.sub(L.mouth[1]);
    const su = clamp(float(1).sub(lu.mul(lu)), 0, 1);
    const top = float(0.072).add(g2(abs(lu).sub(0.24), float(0), 0.14, 1).mul(0.014)).sub(g2(lu, float(0), 0.07, 1).mul(0.008))
      .mul(sqrt(su)).mul(u.lipFull);
    const bot = pow(su, 0.55).mul(-0.112).mul(u.lipFull);
    const lipM = smoothstep(top.add(0.006), top.sub(0.004), lv).mul(smoothstep(bot.sub(0.022), bot.add(0.012), lv))
      .mul(smoothstep(1.3, 1.45, z)).mul(smoothstep(1.02, 0.9, abs(lu)));
    base.assign(mix(base, vec3(u.lip).mul(float(1).add(nf.z.mul(0.08))), lipM.mul(0.75)));
    const mouthLine = g2(lu, lv.add(0.002), 1.1, 0.011).mul(smoothstep(1.3, 1.45, z));
    base.mulAssign(float(1).sub(mouthLine.mul(0.55)));

    // facial hair
    const beardZone = beardNode(T, p).mul(float(1).sub(lipM));
    const moTop = float(6.80).sub(ax.mul(0.35));
    const moZone = smoothstep(0.34, 0.26, ax).mul(smoothstep(moTop.add(0.015), moTop.sub(0.015), y))
      .mul(smoothstep(top.add(L.mouth[1]).sub(0.005), top.add(L.mouth[1]).add(0.02), y)).mul(front).mul(float(1).sub(lipM));
    const hairGrain = near ? mx_noise_float(q.mul(vec3(70, 22, 70))).mul(0.5).add(0.5) : float(0.6);
    const facial = mix(beardZone, moZone, u.moOnly).mul(u.beard).mul(hairGrain.mul(0.45).add(0.6));
    const hairC = hairRootNode(THREE).div(0.62);
    base.mulAssign(mix(vec3(1), vec3(0.78, 0.8, 0.86), beardZone.mul(u.stubble).mul(0.85)));
    base.assign(mix(base, hairC, clamp(facial, 0, 1)));

    // brows
    const bt0 = ax.sub(u.bGap).div(0.44);
    const t = clamp(bt0, 0, 1);
    const yc = float(7.47).add(u.bLift).add(u.bArch.mul(sin(pow(t, 1.5).mul(Math.PI)))).sub(t.mul(0.02));
    const th = u.bThick.mul(mix(float(1.15), float(0.4), t));
    const bd = abs(y.sub(yc)).div(th);
    const strokes = near ? mx_noise_float(vec3(ax.mul(22), y.sub(yc).mul(110).add(ax.mul(mix(float(60), float(10), t))), u.shift)) : float(0);
    const browM = smoothstep(0.62, 0.38, bd).mul(smoothstep(-0.03, 0.04, bt0)).mul(smoothstep(1.06, 0.88, bt0))
      .mul(smoothstep(0.95, 1.2, z)).mul(strokes.mul(0.35).add(0.75)).mul(u.bDense);
    base.assign(mix(base, vec3(u.brow), clamp(browM, 0, 1)));

    // lash line
    const ed2 = length(vec3(ax.sub(E[0]), y.sub(E[1]), z.sub(E[2]))).div(ER);
    const upper = smoothstep(E[1] - 0.02, E[1] + 0.015, y);
    const outer = smoothstep(E[0] - 0.05, E[0] + 0.14, ax);
    const lash = smoothstep(mix(float(1.12), float(1.2), outer.mul(upper)), float(1.04), ed2).mul(mix(float(0.45), float(1), upper));
    base.assign(mix(base, vec3(0.03, 0.022, 0.02), clamp(lash, 0, 1).mul(0.95)));

    // the scalp: the hair's root colour, as the shells' inner faces have it
    const root = hairRootNode(THREE).mul(scalpN.mul(0.15).add(1));
    base.assign(mix(base, root, scalp.mul(u.scalp)));
    return base;
  });

  const m = new SkinMaterial({ roughness: 0.55, metalness: 0 });
  m.colorNode = ColorFn();
  const tz = exp(abs(p.x).div(0.16).pow(2).negate()).mul(smoothstep(6.8, 7.0, y)).mul(smoothstep(8.1, 7.9, y)).mul(front);
  m.roughnessNode = float(0.6).sub(tz.mul(0.12)).add(scalp.mul(0.25));
  m.name = `skin-${tier}`;
  made.set(key, m);
  return m;
}
