// The boned bodice of the gentlewoman (R5; design/research/r5-dress-1660.md, V&A 429-1889): a shell on the body. A rigid cone of stays (the bust flattened, a
// straight front running to a long point below the natural waist), an off-the-shoulder neckline, short full sleeves to above the elbow.
//
// Built procedurally, once per cut, as a template on the mean body of that cut (outfit.js MEAN_BODIES), from the body's own measurements (wearer.js):
//   - the torso is rings round the body, each a closed loop whose height runs from the bottom edge (a V to the point in front) to the neckline (low across the
//     chest, up to the shoulder tips); its radius is the cross-section of the body and its base layer there, flattened in front to the upper hull of its profile
//     (the stays' straight busk) and eased out by a centimetre or two;
//   - each sleeve is rings along the upper arm: the arm's own cross-section, puffed full (a cap standing off the shoulder, gathered toward the ribs and the neck).
// The template is bound to the person (bind.js, MakeHuman's .mhclo idea: three vertices, barycentric weights, an offset in the triangle's frame): the torso to the
// base layer over the torso, the sleeves to the arm and the layer's sleeve. The offset is in units of the bound triangle's own mean edge length, so it grows with
// the wearer's measured span between those body vertices (the landmark-span scaling of MakeHuman's .mhclo), and along the smooth normal so a creased body does not
// ripple the cloth. Fitted to any body by that binding, then relax() makes the stays straight again (the cloth does not follow a sagging bust or a belly's fold).
// A girl and a small child take their own cuts (CUTS.girl, CUTS.small), built on a girl's and a toddler's body from their own landmarks, never the adult cut
// scaled down.
//
// It carries the body it hides (MakeHuman's delete_verts: a region id per body vertex, and per reduced-mesh vertex), what it covers (what the sweep measures
// penetration over) and its skin weights (the torso rigid: the body's own weights at the surface it stands off from, smoothed over the rings; the sleeve cap sewn to the
// chest and the sleeve below it on the arm).
import { TriGrid, faceNormals, boundaryEdges, normalsOf } from "./geom.js";
import { wearer as readWearer, torsoTable, landmarks, planeSegments, rayFar, trianglesWhere, BODY_INDEX, LAYER_INDEX, NBODY, NFULL, BI, K } from "./wearer.js";
import { bind, fit, blendSkin, bodyNormals } from "./bind.js";
import { BONES } from "../shape.js";

// All lengths in units of the wearer's height H (the template body's own, so a cut reads the same on a girl's body as on a woman's).
export const CUTS = {
  adult: {
    N: 40, rings: 12, sleeveN: 12, sleeveRings: 6, rightSleeveOut: true,
    ease: 0.0085,            // standoff from the body's surface (the base layer is 0.004 out): thickness of the stays over the shift
    coneEase: 0.004,         // extra standoff low in front, where the cone leaves the body under the bust and over the belly
    flatten: 1,              // how far the front is pressed flat to the upper hull of its profile (0 follows the body)
    sideDrop: 0.030, pointDrop: 0.062, pointPow: 1.25, pointHalf: 1.15, backDrop: 0.034,   // bottom edge below the natural waist: sides, extra at the front point (a V of half-angle pointHalf rad), back
    topFront: 0.060, topSide: 0.000, topBack: 0.038,                           // neckline below the shoulder line: front centre, shoulder tip, back centre
    sleeveTop: -0.026, sleeveEnd: 0.80, sleevePuff: 0.026, capPuff: 1.0, capLift: 0.006, innerCut: 0.7, capSew: 0.11, capArm: 0.25, sleeveEase: 0.009, skinSmooth: 30, // sleeve: starts above the shoulder joint (H), ends at this share of the upper arm; puff radius (H)
  },
};
CUTS.girl = { ...CUTS.adult, flatten: 0.4, pointDrop: 0.034, ease: 0.0095, topFront: 0.055 };
CUTS.small = { ...CUTS.girl, flatten: 0, pointDrop: 0.030, sideDrop: 0.030, backDrop: 0.034, ease: 0.0105, coneEase: 0.002 };
// The gentleman's doublet (R5; r5-dress-1660.md, V&A T.324-1980: 44 cm, very short, six shallow laps, a standing collar, short wide sleeves with the inside seam open): the same generator in
// "doublet" mode. The torso is rings from a hem above the natural waist (hemAbove, H) with laps hanging below it (lapDepth, laps of them) to the base of the neck (topRise above the neck joint),
// following the body's own section there (flatten 0: a doublet is close-fitting, with no cone); its sleeves are short and wide (sleeveEnd, sleevePuff). Four more parts are in the shell, all
// of them linen: the falling band (part 3: rings lying over the doublet's top rings, bib-fronted), the shirt between doublet and breeches (part 4: rings from inside the breeches' waistband
// to inside the doublet's hem, blousing at `puff` in the gap) and the shirt's sleeves (parts 5 and 6 from under the doublet's sleeve to the elbow, 7 and 8 from the elbow to the wrist, billowing).
CUTS.man = {
  ...CUTS.adult, doublet: true, flatten: 0, coneEase: 0, ease: 0.0105, rings: 12,
  hemAbove: 0.030, lapDepth: 0.009, laps: 6, lapPhase: 0.5, topRise: 0.012, tableTop: "neck",
  sleeveTop: -0.024, sleeveEnd: 0.97, sleevePuff: 0.004, sleeveRings: 7, innerCut: 0.3, sleeveEase: 0.010, capLift: 0.017,
  pinRings: 0, pinPut: false, pinSleeve: 3, pinSleeveW: 0.6, pinSide: { rings: [6, 9], sin: 0.85, w: 0.5 }, pinShirt: { rings: 2, w: 0.6 },
  band: { rings: 4, front: 0.062, side: 0.036, back: 0.042, lift: 0.010 },
  shirt: { rings: 5, puff: 0.014, botDown: 0.030, topIn: 0.016, ease: 0.004 },
  shirtSleeve: { rings: 8, upperRings: 4, from: 0.55, to: 0.97, above: 0.10, puff: 0.020, ease: 0.006, upperEase: 0.006, cuff: 0.008 },
};
CUTS.boy = { ...CUTS.man, ease: 0.0095, hemAbove: 0.034, shirt: { ...CUTS.man.shirt, puff: 0.012 } };

// The working dress (R5 working dress; r5-dress-1660.md: the working woman's laced waistcoat with elbow sleeves, and the working man's doublet with its skirts, a jerkin's worth of cloth). Both are the
// doublet's mode again, close-fitting rings from a hem to the neck, so the machinery (the binding, the rigid skin, the band that follows the top rings, the shirt's sleeves in two pieces) is the gentleman's:
//   wwoman, wgirl, wsmall  the laced waistcoat bodice: a hem at the waist (no waist gap, no laps, no stays' point), the neckline scooped (`neckDrop`) below the base of the neck at the front, sleeves close
//                          and nearly to the elbow, the shift's forearm sleeves below them (parts 7, 8: plain, to the wrist) and a linen neckerchief (the band, part 3) lying on the neckline. No shirt between bodice
//                          and skirt (the skirt hangs from the waist: part 4 is empty). The front lacing is painted (reduced.js outfitLayout, outfit.painted.lacing).
//   wman, wboy             the working doublet: a hem below the natural waist (the skirts to the hip, standing off the hips by `flare` so they clear the closed breeches under them, no waist gap),
//                          sleeves nearly to the elbow, the shirt's sleeves plain to the wrist, a plain falling band (small). No shirt between doublet and breeches (the doublet covers the waist).
CUTS.wwoman = {
  ...CUTS.man, rings: 12, pinSide: { rings: [8, 10], sin: 0.85, w: 0.5 }, hemAbove: -0.030, lapDepth: 0, laps: 0, ease: 0.0140, topRise: 0, neckDrop: { front: 0.022, back: 0.006, side: 0 },
  sleeveEnd: 0.96, sleevePuff: 0.002, sleeveRings: 7, innerCut: 0.5, capLift: 0.019, sleeveEase: 0.012, sleeveTop: -0.030,      // (set in plainly: the gentleman's cap with no puff)
  pinShirt: null, shirt: null,
  band: { rings: 4, front: 0.082, side: 0.046, back: 0.050, lift: 0.010 },
  shirtSleeve: { rings: 8, upperRings: 4, from: 0.55, to: 0.95, above: 0.10, puff: 0.012, ease: 0.006, upperEase: 0.006, cuff: 0.004 },
};
CUTS.wgirl = { ...CUTS.wwoman, ease: 0.0145 };
CUTS.wsmall = { ...CUTS.wgirl, ease: 0.0155, hemAbove: -0.028, sleeveEase: 0.015, capLift: 0.024, sleeveTop: -0.036 };
CUTS.wman = {
  ...CUTS.man, rings: 15, pinSide: { rings: [8, 10], sin: 0.85, w: 0.5, also: { rings: [11, 12], w: 0.3 } }, hemAbove: -0.034, lapDepth: 0, laps: 0, flare: 0.045, flareFrom: 0.040, flareDepth: 0.090, hemFront: 0.014, pinHem: { rings: 1, w: 0.5 }, sleevePuff: 0.002, capLift: 0.019, sleeveEase: 0.012, sleeveTop: -0.030, ease: 0.0105, shirt: null, pinShirt: null,
  band: { rings: 4, front: 0.040, side: 0.026, back: 0.030, lift: 0.012 },
  shirtSleeve: { rings: 8, upperRings: 4, from: 0.55, to: 0.97, above: 0.10, puff: 0.008, ease: 0.006, upperEase: 0.006, cuff: 0.004 },
};
CUTS.wboy = { ...CUTS.wman, ease: 0.0095, hemAbove: -0.038 };
// wman-fit, wboy-fit: the working doublet cut close (round 3 of the hero study; tried on the hero's page first, garments/outfit.js setFit). The working doublet stood 3.0 to 3.3 cm off
// his skin at the chest and waist (19 to 21 cm of ease round), its skirts 6 to 7 cm off his hips (flared over breeches that stood 6 to 8 cm off) and its sleeve cap 4 cm; a period
// doublet kept its shape by stiffening and a snug cut, not by volume (V&A O110590, a plain wool doublet with a stiffened lining and pasteboard belly pieces), and its ease is
// read as 4 to 8 cm round the chest (an inference: no surviving measure says it). Here: the torso over the shirt, its front a little flattened (the stiffened belly), the skirts
// just clearing the fitted breeches, the sleeves close with a little room at the cap, and the shirt's sleeves full but gathered at the wrist.
// Seated with the hands on the thighs (round 3's first seated shots) the close cut let the shoulder through at the junction of the torso and the sleeve's cap (4 cm) and the
// shirt's sleeve through the doublet's at the shoulder and the elbow (2 cm): the shirt's sleeve now moves as the arm's skin does to below the elbow (shirtBody), its forearm piece
// reaching only 5% of the upper arm up under the doublet's sleeve (`above`), and the near class leaves out the body within 0.6% of the height outside the torso or a sleeve at
// the template, an arm's under the torso too (fitHide: bodice.js hidesNear), and the shirt's upper sleeves (reduced.js): 7 mm at the most seated, nothing walking. The cap then
// needs little lift (capLift 0.4%, the seated shots' 0.8% stood the shoulder up like a pad), but its top must stay where it is (sleeveTop): set lower, the shoulder came
// through, 5 cm seated.
CUTS["wman-fit"] = { ...CUTS.wman, ease: 0.0015, flatten: 0.35, flare: 0.012, flareFrom: 0.030, flareDepth: 0.080, sleeveEase: 0.0055, capLift: 0.004, sleevePuff: 0, band: { ...CUTS.wman.band, lift: 0.008 },
  shirtSleeve: { ...CUTS.wman.shirtSleeve, puff: 0.007, ease: 0.0035, upperEase: 0.0035, cuff: -0.002, above: 0.05 }, shirtBody: true, fitHide: { outside: 0.006 } };
CUTS["wboy-fit"] = { ...CUTS["wman-fit"], ease: 0.0015, hemAbove: -0.038 };

// The reduced cuts (R5, mid and far tiers; reduced.js): the same generator at lower resolution (24 round, 8 rings, sleeves 12 x 6: 336 vertices; fewer sleeve rings or columns put the sleeve cap 2 to 3 cm off the full one, which the far check measures), cut on the cut's own mean body
// and bound to the reduced mesh. The skin smoothing runs fewer rounds, for the rings are further apart.
// (rightSleeveOut: the right sleeve is the left's mirror, so the same winding faces inward on it; the full cuts have always been so, which the sweep never saw as it reads sleeves by a ray, and
// relax() and the lighting see: the reduced cuts wind it outward. Setting it on the full cuts too is one line, and changes the sweep's numbers for the right sleeve.)
for (const id of ["adult", "girl", "small"]) CUTS[id + "-r"] = { ...CUTS[id], rightSleeveOut: true, refRings: CUTS[id].rings, N: 24, rings: 8, sleeveN: 12, sleeveRings: 6, skinSmooth: 14 };
// (the gentleman's reduced cuts keep the full cut's rings: a doublet is a close fit from the neck to the hem, and a sleeve nearly to the elbow, which fewer rings cut across)
for (const id of ["man", "boy", "wwoman", "wgirl", "wsmall", "wman", "wboy", "wman-fit", "wboy-fit"]) CUTS[id + "-r"] = { ...CUTS[id], N: 24, sleeveN: 12, skinSmooth: 14, relaxIters: 3, ease: CUTS[id].ease + 0.003 };

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// the upper concave envelope of samples (y ascending, r), as a function of y: the stays' straight busk
function upperHull(ys, rs) {
  const h = [];
  for (let i = 0; i < ys.length; i++) {
    while (h.length >= 2) { const a = h[h.length - 2], b = h[h.length - 1], c = i; if ((ys[b] - ys[a]) * (rs[c] - rs[a]) - (rs[b] - rs[a]) * (ys[c] - ys[a]) >= 0) h.pop(); else break; }
    h.push(i);
  }
  return (y) => {
    for (let k = 0; k < h.length - 1; k++) { const a = h[k], b = h[k + 1]; if (y <= ys[b]) return lerp(rs[a], rs[b], (y - ys[a]) / (ys[b] - ys[a] || 1)); }
    return rs[h[h.length - 1]];
  };
}

/** The template's geometry on a wearer w (its torso table `table` and landmarks `lm`): vertices (Float32Array), the triangles, which part each belongs to,
 *  and the boundary rings (the open edges). Positions are on w's body, in its rest stance. */
function generate(w, table, lm, cut) {
  const H = lm.H, N = cut.N, Kr = cut.rings, pos = [], anchor = [], part = [], ring = [], edgeRing = [], tri = [], grids = [{ start: 0, rings: Kr, around: N }];
  const doublet = !!cut.doublet;
  // the doublet's hem (above the natural waist, with laps hanging below it) and its top (the base of the neck)
  const hemAt = (th) => lm.waistY + H * (cut.hemAbove + (cut.hemFront ?? 0) * Math.pow(Math.max(0, Math.cos(th)), 2) - cut.lapDepth * Math.pow(0.5 + 0.5 * Math.cos(cut.laps * th + cut.lapPhase * Math.PI), 2)), topY = lm.neckY + H * (cut.topRise ?? 0);
  // (the working woman's waistcoat and the workman's doublet, same mode: `neckDrop` scoops the neckline below the base of the neck at the front and back; `flare` (from `flareFrom` above the waist, over `flareDepth`) stands the skirts off the hips toward the hem, so
  // a doublet whose hem is below the waist clears the breeches under it)
  const topAt = (th) => { const c = Math.cos(th), f = Math.max(0, c), b = Math.max(0, -c), nd = cut.neckDrop; return nd ? topY - H * (nd.front * f * f + nd.back * b * b + (nd.side ?? 0) * Math.sin(th) ** 2) : topY; };
  const bottom = (th) => { const c = Math.cos(th), b = Math.max(0, -c), a = Math.abs(((th + Math.PI) % (2 * Math.PI)) - Math.PI); return lm.waistY - H * (cut.sideDrop + cut.pointDrop * Math.pow(Math.max(0, 1 - a / cut.pointHalf), cut.pointPow) + (cut.backDrop - cut.sideDrop) * b * b); };
  const top = (th) => { const c = Math.cos(th), s = Math.sin(th), f = Math.max(0, c), b = Math.max(0, -c); return lm.shoulderY - H * (cut.topSide * s * s + cut.topFront * f * f + cut.topBack * b * b); };
  // torso rings
  for (let k = 0; k < Kr; k++) for (let j = 0; j < N; j++) {
    const th = (j / N) * 2 * Math.PI, yb = doublet ? hemAt(th) : bottom(th), yt = doublet ? topAt(th) : top(th), t = k / (Kr - 1), y = lerp(yb, yt, t);
    // radius: the body's cross-section there, flattened to the front's hull
    const dy = table.dy, n = Math.max(2, Math.round((yt - yb) / dy) + 1), ys = new Float64Array(n), rs = new Float64Array(n);
    for (let i = 0; i < n; i++) { ys[i] = yb + (i / (n - 1)) * (yt - yb); rs[i] = table.at(th, ys[i]); }
    const hull = upperHull(ys, rs), front = Math.pow(Math.max(0, Math.cos(th)), 1.5) * cut.flatten;
    const rb = table.at(th, y), r = lerp(rb, Math.max(rb, hull(y)), front);
    const ease = H * (cut.ease + cut.coneEase * (1 - t) * Math.pow(Math.max(0, Math.cos(th)), 2) + (cut.flare ? cut.flare * Math.pow(Math.max(0, Math.min(1, (lm.waistY + H * (cut.flareFrom ?? 0) - y) / (H * cut.flareDepth))), 1.2) : 0));
    const c = table.centre(y);
    pos.push(c[0] + (r + ease) * Math.sin(th), y, c[1] + (r + ease) * Math.cos(th));
    anchor.push(c[0] + rb * Math.sin(th), y, c[1] + rb * Math.cos(th));                  // the surface it stands off from
    part.push(0); ring.push(k); edgeRing.push(k === 0 || k === Kr - 1 ? 1 : 0);
  }
  for (let k = 0; k < Kr - 1; k++) for (let j = 0; j < N; j++) {
    const a = k * N + j, b = k * N + (j + 1) % N, c = (k + 1) * N + (j + 1) % N, d = (k + 1) * N + j;
    tri.push(a, b, c, a, c, d);
  }
  // sleeves: the bodice's and the doublet's (parts 1 and 2), and the doublet's shirt sleeves (parts 5 and 6, below). `sp`: { Ks, s0, s1 (m along the upper arm), puff(t) (m), ease(t) (m), inner (the inner
  // side's share of the puff cut), fan (the top closed) }
  const M = cut.sleeveN;
  const sleeveSet = (parts, sp) => { const Ks = sp.Ks;
  for (const [side, S] of [[1, "L"], [-1, "R"]]) {
    const ju = w.J[BI["upperarm" + S]], jf = w.J[BI["forearm" + S]], axis = norm3([jf[0] - ju[0], jf[1] - ju[1], jf[2] - ju[2]]), upLen = Math.hypot(jf[0] - ju[0], jf[1] - ju[1], jf[2] - ju[2]);
    const e1 = norm3([1 - axis[0] * axis[0], -axis[0] * axis[1], -axis[0] * axis[2]]), e2 = norm3(cross(axis, e1));      // x projected off the axis; e2 about +z
    // a chain (sp.chain: the shirt's sleeve to the wrist) goes on along the forearm past the elbow: the rings there lie across the forearm's own axis
    const jh = w.J[BI["hand" + S]], axis2 = norm3([jh[0] - jf[0], jh[1] - jf[1], jh[2] - jf[2]]), f2e1 = norm3([1 - axis2[0] * axis2[0], -axis2[0] * axis2[1], -axis2[0] * axis2[2]]), f2e2 = norm3(cross(axis2, f2e1));
    const tris = trianglesWhere((v) => w.arm[v] && (side > 0 ? w.pos[3 * v] > 0 : w.pos[3 * v] < 0));
    const base = pos.length / 3, s0 = sp.s0, s1 = sp.s1; let lastMean = null;
    grids.push({ start: base, rings: Ks, around: M });
    for (let k = 0; k < Ks; k++) {
      const s = lerp(s0, s1, k / (Ks - 1)), onForearm = sp.forearm || (sp.chain && s > upLen), ax = onForearm ? axis2 : axis, f1 = onForearm ? f2e1 : e1, f2 = onForearm ? f2e2 : e2, jo = onForearm ? jf : ju, ds = onForearm ? (sp.forearm ? s : s - upLen) : s;
      const o = [jo[0] + ax[0] * ds, jo[1] + ax[1] * ds, jo[2] + ax[2] * ds];
      const seg = planeSegments(w.pos, tris, o, ax, [side * f1[0], side * f1[1], side * f1[2]], f2);
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < seg.length; i += 2) { a0 = Math.min(a0, seg[i]); a1 = Math.max(a1, seg[i]); b0 = Math.min(b0, seg[i + 1]); b1 = Math.max(b1, seg[i + 1]); }
      if (!seg.length) { a0 = a1 = b0 = b1 = 0; }                 // the plane misses the arm (above the shoulder's cap): the axis point, and the radius of the ring below
      const ca = 0.5 * (a0 + a1), cb = 0.5 * (b0 + b1), hits = [];
      for (let m = 0; m < M; m++) { const th = (m / M) * 2 * Math.PI; hits.push(rayFar(seg, ca, cb, Math.cos(th), Math.sin(th))); }
      const good = hits.filter((x) => x > 0), mean = good.length ? good.reduce((x, y) => x + y, 0) / good.length : (lastMean ?? 0.05 * H) * 0.8; lastMean = good.length ? mean : lastMean;
      const t = k / (Ks - 1), puff = sp.puff(t);
      for (let m = 0; m < M; m++) {
        const th = (m / M) * 2 * Math.PI, d1 = Math.cos(th), d2 = Math.sin(th), r = (hits[m] > 0 ? hits[m] : mean) + sp.ease(t) + puff * (1 - sp.inner * Math.max(0, -d1)) + (sp.front ? sp.front(t) * Math.max(0, d2) : 0);       // the side toward the ribs and the neck stays close
        // plane coordinates (ca + r d1, cb + r d2) back to 3D (e1 flipped for the right side so the angle runs the same way round the arm)
        const u1 = ca + r * d1, u2 = cb + r * d2;
        pos.push(o[0] + side * f1[0] * u1 + f2[0] * u2, o[1] + side * f1[1] * u1 + f2[1] * u2, o[2] + side * f1[2] * u1 + f2[2] * u2);
        const r0 = hits[m] > 0 ? hits[m] : mean, v1 = ca + r0 * d1, v2 = cb + r0 * d2;
        anchor.push(o[0] + side * f1[0] * v1 + f2[0] * v2, o[1] + side * f1[1] * v1 + f2[1] * v2, o[2] + side * f1[2] * v1 + f2[2] * v2);
        part.push(side > 0 ? parts[0] : parts[1]); ring.push(k); edgeRing.push(k === 0 || k === Ks - 1 ? 1 : 0);
      }
    }
    for (let k = 0; k < Ks - 1; k++) for (let m = 0; m < M; m++) {
      const a = base + k * M + m, b = base + k * M + (m + 1) % M, c = base + (k + 1) * M + (m + 1) % M, d = base + (k + 1) * M + m;
      if (side < 0 && cut.rightSleeveOut) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d);
    }
    // the sleeve's top is closed by a fan over its first ring (no new vertices): an open top shows the sleeve's inside through the shoulder, which the renderer lights as a dark patch
    // (tools/people/garment-interior.mjs counts them), and on a broad shoulder it is a disc a centimetre or two across. The fan winds as the tube does, so its normal is the tube's outward.
    if (sp.fan) for (let m = 1; m < M - 1; m++) { const a = base, b = base + m, c = base + m + 1; if (side < 0 && cut.rightSleeveOut) tri.push(a, b, c); else tri.push(a, c, b); }
  }
  };
  sleeveSet([1, 2], { Ks: cut.sleeveRings, s0: cut.sleeveTop * H, s1: cut.sleeveEnd * lm.armLen, inner: cut.innerCut, fan: true,
    puff: (t) => H * cut.sleevePuff * (cut.capPuff + (1 - cut.capPuff) * Math.sin(Math.PI * Math.pow(t, 0.8))), ease: (t) => H * (cut.sleeveEase + cut.capLift * (1 - t) * (1 - t)) });
  if (doublet) {
    const sinc = Math.sin, tauN = (j) => (j / N) * 2 * Math.PI;
    // the shell's surface at (th, y): the body's own section there, and the centre of the section
    const surf = (th, y, extra) => { const rb = table.at(th, y), c = table.centre(y), r = rb + extra; return { p: [c[0] + r * sinc(th), y, c[1] + r * Math.cos(th)], a: [c[0] + rb * sinc(th), y, c[1] + rb * Math.cos(th)] }; };
    // the falling band (part 3): rings lying on the doublet's top, from the free edge (ring 0) up to the neck (the last ring), bib-fronted: it drops further at the front than at the sides and back
    const bd = cut.band ?? { rings: 0 }; grids.push({ start: pos.length / 3, rings: bd.rings, around: N });
    for (let k = 0; k < bd.rings; k++) for (let j = 0; j < N; j++) {
      const th = tauN(j), f = Math.max(0, Math.cos(th)), b = Math.max(0, -Math.cos(th)), drop = H * Math.hypot(bd.front * f, bd.side * Math.abs(sinc(th)), bd.back * b), y = topY + 0.006 * H - drop * (1 - k / (bd.rings - 1));
      const q = surf(th, y, H * (cut.ease + bd.lift));
      pos.push(...q.p); anchor.push(...q.a); part.push(3); ring.push(k); edgeRing.push(k === 0 || k === bd.rings - 1 ? 1 : 0);
    }
    for (let k = 0; k < bd.rings - 1; k++) for (let j = 0; j < N; j++) { const base = grids[3].start, a = base + k * N + j, bb = base + k * N + (j + 1) % N, c = base + (k + 1) * N + (j + 1) % N, d = base + (k + 1) * N + j; tri.push(a, bb, c, a, c, d); }
    // the shirt (part 4) between the breeches and the doublet: from inside the breeches' waistband (botDown below the waist) to inside the doublet's hem; it blouses over the gap, at nothing
    // at the waistband and at the hem and `puff` between
    const sh = cut.shirt ?? { rings: 0 }; grids.push({ start: pos.length / 3, rings: sh.rings, around: N });      // (a cut without a shirt band or a falling band has the grid empty: the part numbers stay the same for every cut of the doublet's mode)
    for (let k = 0; k < sh.rings; k++) for (let j = 0; j < N; j++) {
      const th = tauN(j), t = k / (sh.rings - 1), yb = lm.waistY - H * sh.botDown, yt = hemAt(th) + H * sh.topIn, y = lerp(yb, yt, t), u = Math.max(0, (y - lm.waistY) / (yt - lm.waistY));
      const q = surf(th, y, H * (sh.ease + sh.puff * Math.pow(sinc(Math.PI * u), 0.8)));
      pos.push(...q.p); anchor.push(...q.a); part.push(4); ring.push(k); edgeRing.push(k === 0 || k === sh.rings - 1 ? 1 : 0);
    }
    for (let k = 0; k < sh.rings - 1; k++) for (let j = 0; j < N; j++) { const base = grids[4].start, a = base + k * N + j, bb = base + k * N + (j + 1) % N, c = base + (k + 1) * N + (j + 1) % N, d = base + (k + 1) * N + j; tri.push(a, bb, c, a, c, d); }
    // the shirt's sleeves, in two rigid pieces each, as a shirt's sleeve is cut at the elbow and sewn: the upper arm's (parts 5 and 6, from under the doublet's sleeve to the elbow) and the forearm's (parts 7 and 8,
    // from a little above the elbow, inside the doublet's sleeve, to the wrist). Each is rigid on its own bone (bodiceSkin), so it holds its arm at any bend; the forearm's billows from the elbow to the wrist (the
    // puff swelling and drawn in again there) and ends in a cuff, a little flared.
    const ss = cut.shirtSleeve, foreLen = Math.hypot(...[0, 1, 2].map((k) => w.J[BI.handL][k] - w.J[BI.forearmL][k])), wrist = ss.to * foreLen, above = ss.above * lm.armLen;
    sleeveSet([5, 6], { Ks: ss.upperRings, s0: ss.from * lm.armLen, s1: lm.armLen, inner: 0.35, fan: false, puff: () => 0, ease: () => H * ss.upperEase });
    sleeveSet([7, 8], { Ks: ss.rings, s0: -above, s1: wrist, inner: 0.35, fan: false, forearm: true,
      puff: (t) => { const u = Math.max(0, (lerp(-above, wrist, t)) / wrist); return H * ss.puff * Math.pow(Math.sin(Math.PI * 0.92 * u), 0.9); },
      ease: (t) => { const u = Math.max(0, (lerp(-above, wrist, t)) / wrist); return H * (ss.ease + ss.cuff * smooth(0.9, 1, u)); } });
  }
  return { grids, pos: Float32Array.from(pos), anchor: Float32Array.from(anchor), index: Uint16Array.from(tri), part: Uint8Array.from(part), ring: Uint8Array.from(ring), edge: Uint8Array.from(edgeRing) };
}

// The skin weights of a grid of rings (a part), smoothed `iters` times over each vertex and its four neighbours, as dense weight vectors over the bones, then the four
// heaviest kept and renormalised. Rings with different weights turn against each other in a walk, and the cloth between them folds.
function smoothSkin({ start, rings, around }, si, sw, iters = 6) {
  const nb = BONES.length, V = rings * around; let cur = new Float32Array(V * nb), nxt = new Float32Array(V * nb);
  for (let i = 0; i < V; i++) for (let k = 0; k < K; k++) cur[i * nb + si[(start + i) * K + k]] += sw[(start + i) * K + k];
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < rings; k++) for (let j = 0; j < around; j++) {
      const i = k * around + j, a = k * around + (j + 1) % around, c = k * around + (j + around - 1) % around, u = k > 0 ? i - around : i, d = k < rings - 1 ? i + around : i;
      for (let q = 0; q < nb; q++) nxt[i * nb + q] = 0.4 * cur[i * nb + q] + 0.15 * (cur[a * nb + q] + cur[c * nb + q] + cur[u * nb + q] + cur[d * nb + q]);
    }
    [cur, nxt] = [nxt, cur];
  }
  for (let i = 0; i < V; i++) {
    const row = []; for (let q = 0; q < nb; q++) if (cur[i * nb + q] > 1e-4) row.push([q, cur[i * nb + q]]);
    row.sort((p, r) => r[1] - p[1] || p[0] - r[0]); const top = row.slice(0, K); let sum = 0; for (const [, x] of top) sum += x;
    for (let k = 0; k < K; k++) { si[(start + i) * K + k] = top[k] ? top[k][0] : 0; sw[(start + i) * K + k] = top[k] ? top[k][1] / sum : 0; }
  }
}

// Skin weights, the same for every wearer, fixed on the template. The stays are rigid, so the torso takes the body's own weights from the torso alone (the
// nearest torso triangle to the surface point it stands off from, never an arm hanging beside it), smoothed over the rings: chest above the waist, spine through it,
// a little hips where the point reaches the belly. The sleeve cap is sewn to the chest and the sleeve below it follows the arm, the full sleeve gathering between.
// the parts that move with the trunk (the torso, and the doublet's band and shirt), and which arm a sleeve-like part is on (the sleeves, and the doublet's shirt sleeves)
export const TRUNK_PARTS = new Set([0, 3, 4]);
export const SIDE_OF = { 1: 1, 2: -1, 5: 1, 6: -1, 7: 1, 8: -1 };
/** The set of the person's triangles a part is bound to: 0 the trunk, 1 the left arm, 2 the right arm. */
export const SET_OF = (part) => (TRUNK_PARTS.has(part) ? 0 : SIDE_OF[part] > 0 ? 1 : 2);
export function bodiceSkin(g, binding, w, lm, cut) {
  const V = g.pos.length / 3, si = new Uint16Array(V * K), sw = new Float32Array(V * K);
  const torsoTris = (() => { const o = []; for (let t = 0; t < BODY_INDEX.length; t += 3) if (!w.arm[BODY_INDEX[t]] && !w.arm[BODY_INDEX[t + 1]] && !w.arm[BODY_INDEX[t + 2]] && !w.leg[BODY_INDEX[t]] && !w.leg[BODY_INDEX[t + 1]] && !w.leg[BODY_INDEX[t + 2]]) o.push(BODY_INDEX[t], BODY_INDEX[t + 1], BODY_INDEX[t + 2]); return Uint16Array.from(o); })();
  const tp = [], ta = [], tv = [];
  for (let v = 0; v < V; v++) if (TRUNK_PARTS.has(g.part[v]) && g.part[v] !== 3) { tv.push(v); tp.push(g.pos[3 * v], g.pos[3 * v + 1], g.pos[3 * v + 2]); ta.push(g.anchor[3 * v], g.anchor[3 * v + 1], g.anchor[3 * v + 2]); }
  const tb = bind(Float32Array.from(tp), w.pos, torsoTris, Float32Array.from(ta)), tskin = blendSkin(tb, w.skinIndex, w.skinWeight);       // the body's own weights at the surface point it stands off from
  tv.forEach((v, i) => { for (let k = 0; k < K; k++) { si[v * K + k] = tskin.skinIndex[i * K + k]; sw[v * K + k] = tskin.skinWeight[i * K + k]; } });
  smoothSkin(g.grids[0], si, sw, cut.skinSmooth);              // stays are rigid: neighbouring rings turn together, so the cloth never folds between them
  if (cut.doublet && g.grids[4].rings > 0) smoothSkin(g.grids[4], si, sw, cut.skinSmooth);
  if (cut.doublet && g.grids[3].rings > 0) {                                           // the band is rigid with the doublet's top rings under it: the same weights, column for column
    const gb = g.grids[3], gt = g.grids[0];
    for (let k = 0; k < gb.rings; k++) for (let j = 0; j < gb.around; j++) { const a = gb.start + k * gb.around + j, b = gt.start + (gt.rings - gb.rings + k) * gt.around + j; for (let q = 0; q < K; q++) { si[a * K + q] = si[b * K + q]; sw[a * K + q] = sw[b * K + q]; } }
  }
  // the sleeves take the arm's own skin weights through their binding to the arm (and the layer's sleeve over it): the shoulder cap turns with the shoulder as the
  // body there does, and the sleeve follows the upper arm below it. (A fixed blend of chest and arm left the cap behind the arm's swing: the arm came out of the cap.)
  const bs = blendSkin(binding, w.skinIndex, w.skinWeight);
  for (let v = 0; v < V; v++) {
    if (TRUNK_PARTS.has(g.part[v])) continue;
    // the cap is sewn to the bodice (it follows the chest) and the sleeve below it follows the arm; between, the full sleeve gathers. The arm swings inside the cap,
    // which stands off it far enough to hold it (cut.capPuff).
    const S = SIDE_OF[g.part[v]] > 0 ? "L" : "R", ju = w.J[BI["upperarm" + S]], jf = w.J[BI["forearm" + S]], axis = [jf[0] - ju[0], jf[1] - ju[1], jf[2] - ju[2]], al = Math.hypot(...axis);
    const s = ((g.pos[3 * v] - ju[0]) * axis[0] + (g.pos[3 * v + 1] - ju[1]) * axis[1] + (g.pos[3 * v + 2] - ju[2]) * axis[2]) / al, lam = cut.capArm + (1 - cut.capArm) * smooth(0, cut.capSew * lm.H, s);
    // (a close doublet, cut.shirtBody: the shirt's sleeve under it moves as the arm's skin does, as the doublet's sleeve over it does, to a little below the elbow, and rigid on the forearm
    // from there to the wrist: rigid all along, it came out through the close sleeve at the shoulder and the elbow wherever the arm bent, 2 cm seated with the hands on the thighs)
    if (g.part[v] >= 5 && cut.shirtBody) {
      const wb = 1 - smooth(al - 0.01 * lm.H, al + 0.04 * lm.H, s), fore = BI["forearm" + S], acc = new Map();
      for (let k = 0; k < K; k++) { const wt = bs.skinWeight[v * K + k]; if (wt > 0) { const bn = bs.skinIndex[v * K + k]; acc.set(bn, (acc.get(bn) ?? 0) + wb * wt); } }
      if (wb < 1) acc.set(fore, (acc.get(fore) ?? 0) + 1 - wb);
      const top = [...acc].filter(([, x]) => x > 0).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, K); let sum = 0; for (const [, x] of top) sum += x;
      for (let k = 0; k < K; k++) { si[v * K + k] = top[k]?.[0] ?? 0; sw[v * K + k] = top[k] ? top[k][1] / sum : 0; }
      continue;
    }
    if (g.part[v] >= 5) { si[v * K] = BI[(g.part[v] >= 7 ? "forearm" : "upperarm") + S]; sw[v * K] = 1; for (let k = 1; k < K; k++) { si[v * K + k] = 0; sw[v * K + k] = 0; } continue; }          // the shirt's sleeves: rigid, the upper arm's and the forearm's
    const acc = new Map([[BI.chest, 1 - lam]]);
    for (let k = 0; k < K; k++) { const wt = bs.skinWeight[v * K + k]; if (wt > 0) { const bn = bs.skinIndex[v * K + k]; acc.set(bn, (acc.get(bn) ?? 0) + lam * wt); } }
    const top = [...acc].filter(([, x]) => x > 0).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, K);
    let sum = 0; for (const [, x] of top) sum += x;
    top.forEach(([bn, x], k) => { si[v * K + k] = bn; sw[v * K + k] = x / sum; });
  }
  return { skinIndex: si, skinWeight: sw };
}

// Each part binds to the part of the person it dresses: the torso to the torso's base layer alone (never an arm hanging beside it, which would carry the garment away
// from the torso on a body whose arms hang elsewhere), each sleeve to its own arm. The three bindings are one in the vertex order.
function trianglesOf(index, keep) {
  const o = [];
  for (let t = 0; t < index.length; t += 3) if (keep(index[t]) && keep(index[t + 1]) && keep(index[t + 2])) o.push(index[t], index[t + 1], index[t + 2]);
  return Uint16Array.from(o);
}
const join = (a, c) => { const o = new Uint16Array(a.length + c.length); o.set(a); o.set(c, a.length); return o; };
export function bindParts(g, w) {
  const nrm = bodyNormals(w.pos);
  const V = g.pos.length / 3, ids = new Uint16Array(V * 3), wt = new Float32Array(V * 3), off = new Float32Array(V * 3), dist = new Float32Array(V);
  const sets = [
    [0, trianglesOf(LAYER_INDEX, (v) => !w.arm[v] && !w.leg[v])],                               // the torso: the base layer over it (the garment must clear the layer, which stands 1 to 4 cm off the body and differs from person to person)
    [1, join(trianglesOf(BODY_INDEX, (v) => w.arm[v] && w.pos[3 * v] > 0), trianglesOf(LAYER_INDEX, (v) => w.arm[v] && w.pos[3 * v] > 0))],   // the sleeves: the arm, and the layer's short sleeve over it
    [2, join(trianglesOf(BODY_INDEX, (v) => w.arm[v] && w.pos[3 * v] < 0), trianglesOf(LAYER_INDEX, (v) => w.arm[v] && w.pos[3 * v] < 0))],
  ];
  for (const [part, tris] of sets) {
    const sel = []; for (let v = 0; v < V; v++) if (SET_OF(g.part[v]) === part) sel.push(v);
    const pts = new Float32Array(sel.length * 3); sel.forEach((v, i) => pts.set(g.pos.subarray(3 * v, 3 * v + 3), 3 * i));
    const anc = new Float32Array(sel.length * 3); sel.forEach((v, i) => anc.set(g.anchor.subarray(3 * v, 3 * v + 3), 3 * i));
    const bd = bind(pts, w.pos, tris, anc, nrm);
    sel.forEach((v, i) => { ids.set(bd.ids.subarray(3 * i, 3 * i + 3), 3 * v); wt.set(bd.w.subarray(3 * i, 3 * i + 3), 3 * v); off.set(bd.off.subarray(3 * i, 3 * i + 3), 3 * v); dist[v] = bd.dist[i]; });
  }
  return { n: V, ids, w: wt, off, dist };
}

/** Which of a fitted garment's pieces cover each of a person's vertices (a bit per part, 1 torso, 2 and 4 the sleeves): the vertices whose nearest point on a piece
 *  is clear of its open edges by `margin`, within `maxDist`, and inside it or no more than `outside` out of it (the sweep takes a few centimetres, so a poor fit shows;
 *  the garment's own hides take none).
 *
 *  The body a garment hides, as MakeHuman's delete_verts: region[v] for each drawn body vertex v (0 shown, else the part of the garment over it: 1 the
 *  torso, 2 and 3 the sleeves), the vertices lying inside the shell and clear of its open edges by a ring, so no hole opens where it ends. The base
 *  layer is never hidden (nobody is drawn unclothed). `reduced(RED)` gives the same for the 1.5k mesh: a reduced vertex is hidden when the three body
 *  vertices it is bound to all are. */
export function hiddenBody(g, w, H, maxDist = 0.05, margin = 0.011, from = 0, to = NBODY, outside = 0, nparts = 3, armTorso = false) {
  const P = g.pos, region = new Uint8Array(to - from), mask = new Uint16Array(to - from);
  const rim = [], parts = Array.from({ length: nparts }, (_, p) => p).map((p) => {
    const idx = []; for (let t = 0; t < g.index.length; t += 3) if (g.part[g.index[t]] === p) idx.push(g.index[t], g.index[t + 1], g.index[t + 2]);
    const index = Uint16Array.from(idx), open = boundaryEdges(index), r = [];
    for (let e = 0; e < open.length; e++) if (open[e]) { const t = Math.floor(e / 3) * 3, k = e % 3; r.push(index[t + k] * 3, index[t + (k + 1) % 3] * 3); }
    return { grid: new TriGrid(P, index, 0.03), fn: faceNormals(P, index), rim: r };
  });
  const rimDist2 = (rim, x, y, z) => {
    let best = Infinity;
    for (let i = 0; i < rim.length; i += 2) {
      const a = rim[i], b = rim[i + 1], ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2], px = x - P[a], py = y - P[a + 1], pz = z - P[a + 2];
      const t = Math.max(0, Math.min(1, (px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez || 1)));
      const d = (px - ex * t) ** 2 + (py - ey * t) ** 2 + (pz - ez * t) ** 2; if (d < best) best = d;
    }
    return best;
  };
  const m2 = Math.max(margin * (H / 1.62), 0.0015) ** 2;                    // never closer than 1.5 mm to an open edge: a point past the edge has its nearest point on it
  let count = 0;
  for (let v = from; v < to; v++) {
    if (!w.trunk[v]) continue;                                    // the neck and head, the forearm and hand beside the waist, the legs (the skirt's) are not under the bodice
    const x = w.pos[3 * v], y = w.pos[3 * v + 1], z = w.pos[3 * v + 2];
    for (let p = 0; p < nparts; p++) {
      if (w.arm[v] && p === 0 && !armTorso) continue;                        // an upper arm beside the ribs is the arm's, not the torso piece's: it moves away from it in a walk
      const { grid, fn, rim } = parts[p], h = grid.nearest(x, y, z, maxDist * (H / 1.62)); if (!h) continue;
      const t = h.tri * 3, s = (x - h.q[0]) * fn[t] + (y - h.q[1]) * fn[t + 1] + (z - h.q[2]) * fn[t + 2];
      if (s >= outside || rimDist2(rim, h.q[0], h.q[1], h.q[2]) < m2) continue;                  // inside the piece, or no more than `outside` out of it
      mask[v - from] |= 1 << p; if (p < 3 && !region[v - from]) { region[v - from] = p + 1; count++; }
    }
  }
  return { region, mask, count, from, reduced(RED) { return reducedHides(region, RED); } };
}
/** A hides region (a region id per drawn body vertex) as the reduced mesh's: a reduced vertex is hidden when the three body vertices it is bound to all are, a seam or hem copy goes with its original. */
export function reducedHides(region, RED) {
  const out = new Uint8Array(RED.D);
  for (let r = 0; r < RED.R; r++) { const x = region[RED.ids[3 * r]], y = region[RED.ids[3 * r + 1]], z = region[RED.ids[3 * r + 2]]; if (x && y && z) out[r] = x; }
  for (let d = RED.R; d < RED.D; d++) out[d] = out[RED.owner[d]];
  return out;
}

/** Build the bodice template for a cut on a template wearer (`near` = shape.js buildNear of the cut's mean body).
 *  Returns { cut, V, index, part, ring, edge, binding, skin, hides, covers, lm, pos }, everything a fit and a draw need. */
export function bodiceGeometry(near, cutName = "adult") {
  const cut = CUTS[cutName], w = readWearer(near), H = near.height;
  const table = torsoTable(w, w.J[BI.hips][1] - 0.1 * H, cut.tableTop === "neck" ? w.J[BI.neck][1] + (cut.topRise ?? 0) * H + 0.01 * H : w.J[BI.upperarmL][1] + 0.03 * H);
  const lm = landmarks(w, table);
  const g = generate(w, table, lm, cut);
  // outward normals: the winding is checked against the axis, and flipped when it faces in
  const fn = faceNormals(g.pos, g.index);
  let outward = 0, count = 0;
  for (let t = 0; t < g.index.length; t += 3) if (g.part[g.index[t]] === 0) {
    const a = g.index[t] * 3, y = g.pos[a + 1], c = table.centre(y); outward += fn[t] * (g.pos[a] - c[0]) + fn[t + 2] * (g.pos[a + 2] - c[1]); count++;
  }
  if (outward < 0) for (let t = 0; t < g.index.length; t += 3) { const x = g.index[t + 1]; g.index[t + 1] = g.index[t + 2]; g.index[t + 2] = x; }
  return { cut, w, H, table, lm, g };
}
export function bodiceTemplate(near, cutName = "adult") {
  const { cut, w, H, lm, g } = bodiceGeometry(near, cutName);
  const binding = bindParts(g, w);
  const skin = bodiceSkin(g, binding, w, lm, cut);
  const hides = hiddenBody(g, w, H);
  // what a close cut leaves out of the near class's body (garments/reduced.js hiddenUnderFitted; cut.fitHide): as `hides`, but a vertex up to `outside` out of a piece at the template
  // counts as under it, and an arm's vertex under the torso piece too (the shoulder at the junction of the torso and the sleeve's cap, and the front of the armpit: drawn, they came
  // through the close doublet as the arms came forward, 2 to 4 cm seated with the hands on the thighs, and showed in slivers standing)
  const hidesNear = cut.fitHide ? hiddenBody(g, w, H, 0.05, 0.011, 0, NBODY, cut.fitHide.outside * H, 3, true) : null;
  // what the shell covers at the template, clear of its open edges by 35 mm (a vertex nearer a rim is the rim's question: it moves in and out of the edge with the body's build):
  // the sweep measures penetration over these, the body's and the base layer's, in each person's fitted garment (rest and poses)
  const np = cut.doublet ? 9 : 3, covers = { body: hiddenBody(g, w, H, 0.06, 0.035, 0, NBODY, 0, np).mask, layer: hiddenBody(g, w, H, 0.06, 0.035, NBODY, NFULL, 0, np).mask };      // bit p set: part p covers it
  return { cut, cutName, V: g.pos.length / 3, grids: g.grids, index: g.index, part: g.part, ring: g.ring, edge: g.edge, binding, skin, hides, hidesNear, covers, lm, pos: g.pos, templateH: H, templateWearer: w, ref: shoulderRef(w, H) };
}
/** What pinShoulders needs of the template's own body: its height and the two shoulder joints (the upper arms'). */
export const shoulderRef = (w, H) => ({ H, L: Array.from(w.J[BI.upperarmL]), R: Array.from(w.J[BI.upperarmR]), hips: Array.from(w.J[BI.hips]) });

// ---- the torso's pins as a smooth field -------------------------------------------------------------------------------------------------------------------------------
// pinShoulders draws some of the torso's vertices to where the skeleton puts them. The share (0 to 1) is a function of where the vertex is on the cut, not of which ring or column it is, so the
// full cut (12 rings, 40 columns) and the reduced one (8 and 24) sample the same field: when it was a step (the top two rings, the columns beyond half the shoulder's reach) the full shell
// stood up to 3.7 cm off its body-following place from one ring to the next, a cliff the reduced shell's coarser rings and columns could not follow (the far torso's 1.5 to 1.9 cm misses were
// this, at the straps and the armpit). The steps are now ramps a ring or two or a few columns wide: the ring ramp is fully pinned at the top ring, 0.84 at the next, and reaches one of the full cut's rings below (a wider ramp reaches the cloth over the base layer, which pokes through by up to 13 mm: the sweep).
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const PIN_RAMP = { rings: 2, below: 1.5, col0: 0.25, col1: 0.55, sinBelow: 0.15, sinAbove: 0.05 };      // (rings: ramp length and where it starts below the first fully pinned ring; col: |x| / the top ring's reach, from to; sin: round the pinSide's own `sin`)
const FIELDS = new WeakMap();
/** The pin shares of a template's torso vertices: { idx (the torso vertices with any), raise, put, side (Float32Array each, aligned with idx) }, cached on the template. `raise`: the top rings never lower than
 *  the skeleton's (a share of the way); `put`: drawn to the shoulder joint's place (the sides of the same rings); `side`: the doublet's armpit (pinSide: its rings, sin and w, as a share). */
export function pinFieldOf(template) {
  let f = FIELDS.get(template); if (f) return f;
  const g = template.grids[0], N = g.around, R = g.rings, cut = template.cut ?? {}, T = template.pos, ref = cut.refRings ?? R, pr = cut.pinRings ?? 2, top = g.start + (R - 1) * N;
  let rmax = 0; for (let j = 0; j < N; j++) { const x = Math.abs(T[3 * (top + j)]); if (x > rmax) rmax = x; }
  const idx = [], raise = [], put = [], side = [];
  for (let k = 0; k < R; k++) for (let j = 0; j < N; j++) {
    const v = g.start + k * N + j, u = (k / (R - 1)) * (ref - 1) - (ref - pr);      // rings of the full cut above (+) or below (-) its first pinned ring
    const wr = pr > 0 ? smoothstep((u + PIN_RAMP.below) / PIN_RAMP.rings) : 0, a = Math.abs(T[3 * v]) / (rmax || 1);
    const wp = cut.pinPut !== false ? wr * smoothstep((a - PIN_RAMP.col0) / (PIN_RAMP.col1 - PIN_RAMP.col0)) : 0;
    let ws = 0;
    if (cut.pinSide) {
      const ps = cut.pinSide, kk = (k / (R - 1)) * (ref - 1), inside = (r) => kk >= r[0] - 1e-6 && kk <= r[1] + 1e-6;
      const share = inside(ps.rings) ? ps.w : ps.also && inside(ps.also.rings) ? ps.also.w : 0;      // (`also`: more rings at another share)
      if (share > 0) ws = share * smoothstep((Math.abs(Math.sin((j / N) * 2 * Math.PI)) - (ps.sin - PIN_RAMP.sinBelow)) / (PIN_RAMP.sinBelow + PIN_RAMP.sinAbove));
    }
    if (wr > 0 || ws > 0) { idx.push(v); raise.push(wr); put.push(wp); side.push(ws); }
  }
  f = { idx: Uint32Array.from(idx), raise: Float32Array.from(raise), put: Float32Array.from(put), side: Float32Array.from(side) };
  FIELDS.set(template, f);
  return f;
}

/** The shoulder girdle is held to the skeleton, and the neckline is never lower than the skeleton says (R5 polish: the bodice's near-to-mid rim gap).
 *  The binding carries a vertex by the triangle of body surface under it, which is right over a chest or a back but not at the shoulder: the straps of the neckline (the top two
 *  rings, where they run over the shoulder) and the sleeve's cap (its first three rings) stand 3 to 5 cm off the surface or on its far side (the template's binding says -5 to +5 cm
 *  there), so a body's shape and the mesh's resolution move them by centimetres, differently in the full body and in the reduced one. Those vertices are put where the shoulder
 *  joint puts them: the template's offset from its own joint, scaled by the height. And the neckline's top two rings (front, back and sides) are raised to where the skeleton
 *  puts them when the binding left them lower (a sagging chest's sternum), never lowered, so they never go into the body.
 *  `J` the wearer's rest joints (any tier's: the full body's, the reduced body's or the far table's agree to millimetres), `height` the wearer's. Only + - * /. */
export function pinShoulders(pos, template, J, height) {
  const ref = template.ref; if (!ref) return pos;
  const s = height / ref.H, T = template.pos, g = template.grids[0], Ju = J[BI.upperarmL], Jv = J[BI.upperarmR];
  const put = (v, Jp, Jt) => { for (let a = 0; a < 3; a++) pos[3 * v + a] = Jp[a] + (T[3 * v + a] - Jt[a]) * s; };
  const cutc = template.cut ?? {}, F = pinFieldOf(template);
  for (let n = 0; n < F.idx.length; n++) {
    const v = F.idx[n], wr = F.raise[n], ideal = Ju[1] + (T[3 * v + 1] - ref.L[1]) * s;
    if (wr > 0 && pos[3 * v + 1] < ideal) pos[3 * v + 1] += (ideal - pos[3 * v + 1]) * wr;
  }
  for (let n = 0; n < F.idx.length; n++) {
    const v = F.idx[n], wp = F.put[n]; if (!(wp > 0)) continue;
    const x = T[3 * v], Jp = x > 0 ? Ju : Jv, Jt = x > 0 ? ref.L : ref.R;
    for (let a = 0; a < 3; a++) pos[3 * v + a] += (Jp[a] + (T[3 * v + a] - Jt[a]) * s - pos[3 * v + a]) * wp;
  }
  const pw = cutc.pinSleeveW ?? 1;          // (the share of the way to the pin: 1, all of it, for the bodice; the doublet's close sleeve takes part of it, so a broad shoulder is not held to the template's)
  for (const [part, Jp, Jt] of [[1, Ju, ref.L], [2, Jv, ref.R]]) { const q = template.grids[part]; for (let k = 0; k < (cutc.pinSleeve ?? 3); k++) for (let m = 0; m < q.around; m++) { const v = q.start + k * q.around + m; if (pw === 1) put(v, Jp, Jt); else for (let a = 0; a < 3; a++) pos[3 * v + a] += (Jp[a] + (T[3 * v + a] - Jt[a]) * s - pos[3 * v + a]) * pw; } }
  // the doublet's armpit and the band's free edge: where a close fit meets the arm's root the two meshes' bodies differ by a centimetre or two and the cloth follows each, so these vertices are drawn a share
  // (`pinSide.w`) of the way to where the shoulder joint puts them (the same in every tier): the sides of the torso's rings `pinSide.rings` and the band's last ring
  if (cutc.pinSide) {
    for (let n = 0; n < F.idx.length; n++) { const v = F.idx[n], ws = F.side[n]; if (ws > 0) { const Jp = T[3 * v] > 0 ? Ju : Jv, Jt = T[3 * v] > 0 ? ref.L : ref.R; for (let a = 0; a < 3; a++) pos[3 * v + a] += (Jp[a] + (T[3 * v + a] - Jt[a]) * s - pos[3 * v + a]) * ws; } }
  }
  // the shirt's bottom rings, inside the breeches' waistband, are drawn a share of the way to where the hip joint puts them (the same in every tier): they are not seen, and the body's own differences there are
  if (cutc.pinShirt && ref.hips) {
    const gs = template.grids[4], hJ = J[BI.hips], w = cutc.pinShirt.w;
    for (let k = 0; k < cutc.pinShirt.rings; k++) for (let j = 0; j < gs.around; j++) { const v = gs.start + k * gs.around + j; for (let a = 0; a < 3; a++) pos[3 * v + a] += (hJ[a] + (T[3 * v + a] - ref.hips[a]) * s - pos[3 * v + a]) * w; }
  }
  // the doublet's skirts: where they hang below the waist over the hips, the hem's rings follow the hip bones' differences between the full and the reduced body (the buttocks of an elder differ by two centimetres)
  // and the binding carries them, so the hem's first `pinHem.rings` rings are drawn a share (`w`) of the way to where the hip joint puts them (the same in every tier)
  if (cutc.pinHem && ref.hips) {
    const hJ = J[BI.hips], w = cutc.pinHem.w;
    for (let k = 0; k < cutc.pinHem.rings; k++) for (let j = 0; j < g.around; j++) { const v = g.start + k * g.around + j; for (let a = 0; a < 3; a++) pos[3 * v + a] += (hJ[a] + (T[3 * v + a] - ref.hips[a]) * s - pos[3 * v + a]) * w; }
  }
  // the falling band lies on the doublet: each vertex of it is its doublet column's vertex (the ring `rings - bands + k` under it) and the template's offset between the two, so it follows the doublet's fit
  // (the same in every tier) and the doublet's close shell is never through it
  if (template.cut.band) {
    const gb = template.grids[3], g0 = template.grids[0], kb = gb.rings, N = g0.around;
    // the doublet's frame at a vertex of its torso grid: the surface normal (out from the ring's axis), the way up the column and the way round, from its neighbours; the band's offset from it is kept in that
    // frame, in the template and in the fit, so it lies on the doublet's own surface as the body under it turns and slopes (a stooped shoulder, a deep chest)
    const frame = (P, k, j, out) => {
      const at = (kk, jj) => { const v = g0.start + Math.max(0, Math.min(g0.rings - 1, kk)) * N + ((jj % N) + N) % N; return [P[3 * v], P[3 * v + 1], P[3 * v + 2]]; };
      const a = at(k + 1, j), b = at(k - 1, j), c = at(k, j + 1), d = at(k, j - 1), up = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], rd = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let n = [up[1] * rd[2] - up[2] * rd[1], up[2] * rd[0] - up[0] * rd[2], up[0] * rd[1] - up[1] * rd[0]];
      const th = (j / N) * 2 * Math.PI; if (n[0] * Math.sin(th) + n[2] * Math.cos(th) < 0) n = [-n[0], -n[1], -n[2]];
      const nl = Math.hypot(...n) || 1; n = [n[0] / nl, n[1] / nl, n[2] / nl];
      const ul = Math.hypot(...up) || 1, u0 = [up[0] / ul, up[1] / ul, up[2] / ul], du = u0[0] * n[0] + u0[1] * n[1] + u0[2] * n[2];
      let u = [u0[0] - du * n[0], u0[1] - du * n[1], u0[2] - du * n[2]]; const l2 = Math.hypot(...u) || 1; u = [u[0] / l2, u[1] / l2, u[2] / l2];
      out[0] = n; out[1] = u; out[2] = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    };
    const Ft = [null, null, null], Ff = [null, null, null], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    for (let k = 0; k < kb; k++) for (let j = 0; j < gb.around; j++) {
      const v = gb.start + k * gb.around + j, kr = g0.rings - kb + k, r = g0.start + kr * N + j;
      frame(T, kr, j, Ft); frame(pos, kr, j, Ff);
      const d = [(T[3 * v] - T[3 * r]) * s, (T[3 * v + 1] - T[3 * r + 1]) * s, (T[3 * v + 2] - T[3 * r + 2]) * s];          // (the template's offset at the wearer's height: the offset's own scale)
      const c0 = dot(d, Ft[0]) / s, c1 = dot(d, Ft[1]) / s, c2 = dot(d, Ft[2]) / s;
      for (let a = 0; a < 3; a++) pos[3 * v + a] = pos[3 * r + a] + (c0 * Ff[0][a] + c1 * Ff[1][a] + c2 * Ff[2][a]) * s;
    }
  }
  return pos;
}
/** The stays' straight front on a body of any shape: down each column of the torso's rings (the same angle round), the radius from the ring's centre is taken to the
 *  upper hull of its profile against height, as the template was cut (generate()), by the cut's own flattening and the front's weight. It bridges the creases
 *  under a sagging bust and over a belly that the binding carries over from the template's different body, and only ever moves a vertex out. */
function stays(pos, template) {
  const { start, rings, around } = template.grids[0], flat = template.cut.flatten;
  if (!(flat > 0)) return;
  const cx = new Float64Array(rings), cz = new Float64Array(rings), ys = new Float64Array(rings), rs = new Float64Array(rings);
  for (let k = 0; k < rings; k++) { let x = 0, z = 0; for (let j = 0; j < around; j++) { x += pos[3 * (start + k * around + j)]; z += pos[3 * (start + k * around + j) + 2]; } cx[k] = x / around; cz[k] = z / around; }
  for (let j = 0; j < around; j++) {
    const th = (j / around) * 2 * Math.PI, wgt = Math.pow(Math.max(0, Math.cos(th)), 1.5) * flat; if (wgt <= 0) continue;
    for (let k = 0; k < rings; k++) { const v = start + k * around + j; ys[k] = pos[3 * v + 1]; rs[k] = Math.hypot(pos[3 * v] - cx[k], pos[3 * v + 2] - cz[k]); }
    const hull = upperHull(ys, rs);
    for (let k = 0; k < rings; k++) {
      const v = start + k * around + j, r = lerp(rs[k], Math.max(rs[k], hull(ys[k])), wgt);
      if (r > rs[k] + 1e-6) { const s = r / (rs[k] || 1); pos[3 * v] = cx[k] + (pos[3 * v] - cx[k]) * s; pos[3 * v + 2] = cz[k] + (pos[3 * v + 2] - cz[k]) * s; }
    }
  }
}

/** Stiff cloth does not follow a body's creases: the garment's rings (each part is a grid of rings round) are smoothed, outward only, so a hollow in the body (the fold
 *  under a sagging bust, a belly's crease) is bridged and a ridge is kept. Each vertex moves along its own normal to the mean of its four neighbours when that is
 *  further out, never in: the shell stays clear of the body it was bound at. `normal` are the garment's vertex normals (normalsOf). */
export function relax(pos, template, iters = 3, tmp = new Float32Array(pos.length)) {
  stays(pos, template);
  for (let it = 0; it < iters; it++) {
    const normal = normalsOf(pos, template.index);
    tmp.set(pos);
    for (const { start, rings, around } of template.grids) for (let k = 0; k < rings; k++) for (let j = 0; j < around; j++) {
      const v = start + k * around + j, a = start + k * around + (j + 1) % around, c = start + k * around + (j + around - 1) % around, u = k > 0 ? start + (k - 1) * around + j : -1, d = k < rings - 1 ? start + (k + 1) * around + j : -1;
      let n = 2, mx = pos[3 * a] + pos[3 * c], my = pos[3 * a + 1] + pos[3 * c + 1], mz = pos[3 * a + 2] + pos[3 * c + 2];
      if (u >= 0) { mx += pos[3 * u]; my += pos[3 * u + 1]; mz += pos[3 * u + 2]; n++; }
      if (d >= 0) { mx += pos[3 * d]; my += pos[3 * d + 1]; mz += pos[3 * d + 2]; n++; }
      mx /= n; my /= n; mz /= n;
      const out = (mx - pos[3 * v]) * normal[3 * v] + (my - pos[3 * v + 1]) * normal[3 * v + 1] + (mz - pos[3 * v + 2]) * normal[3 * v + 2];
      if (out > 0) { tmp[3 * v] = pos[3 * v] + out * normal[3 * v]; tmp[3 * v + 1] = pos[3 * v + 1] + out * normal[3 * v + 1]; tmp[3 * v + 2] = pos[3 * v + 2] + out * normal[3 * v + 2]; }
    }
    pos.set(tmp);
  }
  return pos;
}
export { fit, normalsOf, bodyNormals };
