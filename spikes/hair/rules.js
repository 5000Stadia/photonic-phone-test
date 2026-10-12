// Spike "hair" (M1, R2): what each cut does, as layers of guides: where their roots grow, which way they are combed,
// how far they lift and stand off the head, how long they are and where they are cut. The dissection's finding
// (design/research/r2-vibe-human.md §8): "rule-made guides need far more shaping (volume at the crown, lift at the roots,
// a defined part, tucking behind the ears, ends turning) before any renderer can make them look styled". This is that
// shaping, written once for every head: the fields are functions of the rest frame (spikes/appearance/rest.js), the
// same place on everyone, and grow.js realises them on each person's own baked head.
// A layer is one set of guides with its own cards. Inner layers lie close and dark, outer ones lift and catch the light;
// facial hair is the same thing on another region ("face", "lip"), and a tie gathers the scalp's guides to a point
// from which a tail falls or a bun is wound.
//   plan(h, tier) -> { layers: [layer], tie }      h: a record from style.js; tier: near | mid | far (card counts only)
//   layer: { name, region, count, segs, tiles, width, cover, tipTaper, shade, gravity, stiff, density(r), comb(r), lift(r),
//            length(r), standoff(r), slack, hug, free, cutY, ends, curl, wrap }
//   standoff..standoff+slack is the layer's height over the head (the styling shell); hug keeps facial hair on the face
//   below the head too; free lets a tail fall; cover widens cards to close gaps (as a multiple of the roots' spacing);
//   float starts a guide at its height (an afro's shells); twist turns each card about its strand (a tail from any side)      r: a rest-frame point [x, y, z], decimetres
// Directions are rest-frame vectors; the baked person faces the same way, so they carry over unchanged. Pure.
import { L } from "../appearance/rest.js";
import { hairlineJS, earJS, beardJS } from "../appearance/skin.js";

const C = [0, 7.62, 0.57];                                   // the cranium's centre, rest frame (fitted by eye to the base)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
const out = (r) => norm([r[0] - C[0], (r[1] - C[1]) * 1.1, r[2] - C[2]]);
const along = (v, o) => { const d = v[0] * o[0] + v[1] * o[1] + v[2] * o[2]; return [v[0] - o[0] * d, v[1] - o[1] * d, v[2] - o[2] * d]; };   // onto the surface
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const azimuth = (r) => Math.abs(Math.atan2(r[0], r[2] - L.headC[2]));   // 0 forehead .. pi nape

// ---- comb fields: which way a root's hair is combed, before gravity takes it ----
// away from the part on top, down the sides and back, radial from the crown's whorl behind it
function parted(h, R) {
  const xp = { centre: 0, left: 0.3, right: -0.3 }[h.parting] ?? 0, whorl = [0.08, 8.3, 0.02];
  return (r) => {
    const o = out(r), down = along([0, -1, 0], o), top = smooth(7.55, 8.15, r[1]) * smooth(-0.15, 0.35, r[2]);
    let lat;
    if (h.parting === "none") lat = [0, -0.25, -1];                       // swept back over the top
    else { const s = Math.abs(r[0] - xp) < 0.02 ? (R(r) < 0.5 ? -1 : 1) : Math.sign(r[0] - xp); lat = [s, -0.2, -0.25 * (1 - Math.abs(r[0] - xp))]; }
    const behind = smooth(0.35, -0.1, r[2]) * smooth(7.7, 8.2, r[1]);
    const wh = [r[0] - whorl[0], (r[1] - whorl[1]) * 0.3, r[2] - whorl[2]];
    const d = mix(mix(down, along(lat, o), top), along(wh, o), behind * 0.6);
    return norm(along(d, o).map((v, i) => v + down[i] * 0.05));
  };
}
const toward = (p) => (r) => norm(along([p[0] - r[0], p[1] - r[1], p[2] - r[2]], out(r)));    // a tie gathers the hair to p
const radial = (r) => out(r);

// the fringe zone: within a band behind the forehead's hairline, across the front
const fringeZone = (h) => (r) => { const a = azimuth(r), hl = hairlineJS(r[0], r[1], r[2], h.recede); return smooth(0.95, 0.6, a) * smooth(hl + 0.5, hl + 0.25, r[1]) * (r[2] > 0.6 ? 1 : 0); };

// tier: the number of cards a layer gets, scaled from its near count, and the segments along each
const tierScale = { near: 1, mid: 0.3, far: 0.06 };
const segsFor = { near: 1, mid: 0.6, far: 0.3 };

export function plan(h, tier = "near") {
  const k = tierScale[tier], sg = segsFor[tier], cm = (v) => v / 100;
  const hash = (r) => { const s = Math.sin(r[0] * 127.1 + r[1] * 311.7 + r[2] * 74.7 + h.seed * 0.618) * 43758.5453; return s - Math.floor(s); };
  const scalp = (r) => {   // inside the hairline (soft: thinning over its last few millimetres), clear of the ears
    const hl = hairlineJS(r[0], r[1], r[2], h.recede); if (earJS(...r)) return 0;
    const side = h.sideburns > 0 ? smooth(1.45, 1.1, azimuth(r)) * smooth(0.9, 1.25, azimuth(r)) * smooth(7.12 - 0.4 * h.sideburns - 0.05, 7.12 - 0.4 * h.sideburns + 0.05, r[1]) : 0;
    return Math.max(smooth(hl - 0.02, hl + 0.14, r[1]), side);
  };
  const horseshoe = (r) => scalp(r) * smooth(7.92, 7.75, r[1]) * smooth(1.0, 1.3, azimuth(r));
  const curl = h.curl > 0.12 ? { amp: cm(0.5 + 1.1 * Math.min(h.curl, 0.6)) * (h.curl > 0.85 ? 0.4 : 1), wave: cm(h.curl > 0.5 ? 4.5 - 2 * h.curl : 12 - 8 * h.curl) } : null;
  const tile = h.curl > 0.85 ? ["coily"] : h.curl > 0.5 ? ["curly"] : h.curl > 0.2 ? ["wavy"] : null;
  const shrink = 1 - 0.45 * h.curl * h.curl;                // curls take up length
  const comb = parted(h, hash), fz = fringeZone(h), L0 = cm(h.length) * shrink;
  const crown = (r) => smooth(7.45, 8.25, r[1]) * smooth(-0.35, 0.3, r[2]) * 0.7 + smooth(7.7, 8.3, r[1]) * 0.3;   // where volume lifts
  const vol = h.volume, layers = [];
  const add = (o) => layers.push({ gravity: 1, stiff: 0.15, tipTaper: 0.55, shade: 1, ends: null, cutY: null, curl, wrap: null,
    lift: () => 0.25, standoff: () => cm(0.3), density: scalp, comb, segs: 8, ...o,
    count: Math.max(3, Math.round(o.count * k)), segs: Math.max(2, Math.round((o.segs ?? 8) * sg)) });
  const fringe = (len) => {
    if (h.fringe === "none") return;
    const side = h.parting === "right" ? 1 : -1;            // a side fringe sweeps away from the part
    const dir = { blunt: [0, -0.55, 1], airy: [0, -0.6, 1], side: [side * 0.85, -0.4, 0.6] }[h.fringe];
    add({ name: "fringe", count: h.fringe === "airy" ? 34 : 48, segs: 6, width: cm(h.fringe === "airy" ? 1.4 : 2.2), tiles: h.fringe === "airy" ? ["fine"] : tile ?? ["clumped", "straight"],
      density: (r) => scalp(r) * fz(r), comb: (r) => norm(along(dir, out(r))), lift: () => 0.35, gravity: 0.6, stiff: 0.3,
      length: () => Math.max(cm(9), len), standoff: () => cm(0.5 + vol * 0.6), cutY: h.fringe === "side" ? null : 7.47, ends: "under", shade: 1 });
  };
  switch (h.cut) {
    case "crop": case "bald": {
      // patches laid flat along the comb, each longer than the hair (the crop's texture tile has short strands all along it)
      const where = h.cut === "bald" ? horseshoe : scalp;
      add({ name: "cap", count: 230, segs: 3, width: cm(2.2), tiles: tile ? ["coily"] : ["short"], density: where, comb, lift: () => 0.04, gravity: 0, stiff: 1,
        length: () => cm(3.2), standoff: () => cm(0.05 + 0.25 * Math.min(1, h.length / 2)), slack: cm(0.15), shade: 0.9, curl: null, tipTaper: 0.2 });
      break;
    }
    case "short": {
      // a taper: the sides and nape close-cut (patches), the length on top lying at the volume's height, combed by the part
      const len = (r) => cm(h.length) * (0.45 + 0.55 * smooth(7.4, 8.0, r[1])) * shrink;
      add({ name: "sides", count: 200, segs: 3, width: cm(2.2), tiles: tile ? ["coily"] : ["short"], comb, lift: () => 0.05, gravity: 0, stiff: 1,
        length: () => cm(3.5), standoff: () => cm(0.15), slack: cm(0.2), shade: 0.75, curl: null, tipTaper: 0.2 });
      add({ name: "top", count: 190, segs: 6, width: cm(2.2), tiles: tile ?? ["clumped", "straight"], density: (r) => scalp(r) * smooth(7.35, 7.85, r[1]),
        length: (r) => len(r) * 1.1, lift: () => 0.3 + 0.35 * vol, gravity: 0.3, stiff: 0.5, standoff: () => cm(0.35 + 1.1 * vol), slack: cm(0.5), tipTaper: 0.6 });
      if (h.fringe !== "none") fringe(L0 * 0.9);
      break;
    }
    case "bob": case "long": {
      const bob = h.cut === "bob", cutY = bob ? 6.42 : null;
      // long hair is a little shorter at the front (layers that frame the face); a bob is cut level at the jaw
      const len = (r) => bob ? L0 * 1.6 : L0 * (0.78 + 0.22 * smooth(0.6, 2.4, azimuth(r)));
      // an under layer close to the scalp for cover, then a body of cards spread through the volume's depth (not sheets):
      // the volume rises over the crown and lies close at the sides
      add({ name: "under", count: 200, segs: 10, width: cm(3.0), cover: 1.5, tiles: tile ?? ["straight"], length: len, lift: () => 0.2, standoff: () => cm(0.3),
        slack: cm(0.3), shade: 0.6, cutY, ends: bob ? "under" : null });
      add({ name: "body", count: 380, segs: 10, width: cm(1.9), tiles: tile ?? ["clumped", "straight", "clumped"], length: (r) => len(r) * (0.96 + 0.04 * hash(r)),
        lift: (r) => 0.2 + 0.45 * vol * crown(r), standoff: (r) => cm(0.5 + (0.5 + 2.2 * vol * crown(r)) * (0.25 + 0.75 * hash(r))), slack: cm(0.4),
        shade: 0.95, cutY, ends: bob ? "under" : null });
      fringe(cm(bob ? 9 : 14));
      break;
    }
    case "tied": {
      // the scalp's hair drawn tight to the tie; from the tie, a tail falls or a bun is wound
      const tie = h.tie === "bun" ? [0, 7.98, -0.3] : [0, 7.62, -0.4];
      const toTie = toward(tie), dist = (r) => Math.hypot(r[0] - tie[0], r[1] - tie[1], r[2] - tie[2]) / 10;   // dm -> m
      add({ name: "gathered", count: 260, segs: 6, width: cm(2.6), tiles: tile ? ["wavy"] : ["straight", "clumped"], comb: toTie, lift: () => 0.05, gravity: 0, stiff: 1,
        length: (r) => dist(r) * 1.2, standoff: () => cm(0.25), slack: cm(0.15), shade: 0.9, curl: null, toward: tie });
      if (h.tie === "bun") add({ name: "bun", region: "tie", count: 70, segs: 12, width: cm(2.6), tiles: tile ?? ["clumped", "straight"], gravity: 0,
        length: () => cm(26), standoff: () => 0, shade: 0.95, curl: null, wrap: { radius: cm(3.6 + 0.04 * h.length) } });
      else add({ name: "tail", region: "tie", count: 70, segs: 12, width: cm(2.6), tiles: tile ?? ["clumped", "straight", "clumped"], comb: () => [0, -0.85, -0.5],
        lift: () => 0.3, gravity: 1, stiff: 0.05, length: () => cm(h.length) * shrink, standoff: () => cm(0.8), shade: 0.95, tipTaper: 0.75, free: true, twist: true });
      return { layers, tie };
    }
    case "afro": {
      // a rounded volume: shells of patches held at their depth (floating, no strand from the scalp: the coily texture
      // and the shells below hide the roots), the outermost sparse and fuzzy; the depth eases toward the face and nape
      const depth = (r) => cm(h.length) * (0.35 + 0.65 * smooth(0.5, 1.2, azimuth(r) + (r[1] - 7.5))) * (0.45 + 0.55 * smooth(6.7, 7.4, r[1]));
      const tang = (r) => norm(along([Math.sin(hash(r) * 6.3), -0.5, Math.cos(hash(r) * 6.3)], out(r)));
      for (const [name, f, count, sh, w] of [["shell-1", 0.25, 150, 0.45, 4.6], ["shell-2", 0.55, 190, 0.65, 4.4], ["shell-3", 0.82, 230, 0.85, 4.2], ["surface", 1.0, 260, 1, 4.0], ["fuzz", 1.12, 140, 1, 3.0]])
        add({ name, count, segs: 3, width: cm(w), tiles: ["coily"], comb: tang, lift: () => 0, gravity: 0, stiff: 1, float: true,
          length: () => cm(5), standoff: (r) => cm(0.4) + depth(r) * f, slack: cm(0.6), shade: sh, curl: null, tipTaper: 0.25 });
      break;
    }
  }
  // facial hair: the same growth on the face; a beard falls down the jaw and gathers under the chin
  if (h.beard > 0) {
    const bz = (r) => { const b = beardJS(...r); return b > 0.45 && (h.beard > 4 || r[1] > 6.2) ? smooth(0.45, 0.75, b) : 0; };
    const bcomb = (r) => norm(along([-0.35 * r[0], -1, 0.25], out(r)));
    add({ name: "beard", region: "face", count: 260, segs: 4, width: cm(1.1), tiles: ["coarse"], density: bz, comb: bcomb, lift: () => 0.15, gravity: 0.6, stiff: 0.4,
      length: () => cm(Math.min(h.beard, 3)) * 0.8 + cm(1.0), standoff: () => cm(0.1), slack: cm(0.2), hug: true, shade: 0.8, curl: null });
    if (h.beard > 1.5) add({ name: "beard-outer", region: "face", count: 160, segs: 5, width: cm(1.2), tiles: ["coarse"], density: (r) => bz(r) * smooth(7.0, 6.6, r[1]),
      comb: bcomb, lift: () => 0.3, gravity: 0.8, stiff: 0.3, length: () => cm(h.beard), standoff: () => cm(0.25 + h.beard * 0.08), slack: cm(0.3 + h.beard * 0.06), hug: h.beard < 8, shade: 1, curl: null });
  }
  if (h.moustache > 0) {
    const lip = (r) => Math.abs(r[0]) < 0.34 && r[1] > L.mouth[1] + 0.07 && r[1] < 6.86 && r[2] > 1.35 ? smooth(0.34, 0.24, Math.abs(r[0])) : 0;
    add({ name: "moustache", region: "lip", count: 44, segs: 3, width: cm(0.9), tiles: ["coarse"], density: lip, comb: (r) => norm([Math.sign(r[0] || 1) * 0.5, -1, 0.3]),
      lift: () => 0.12, gravity: 0.4, stiff: 0.5, length: () => cm(h.moustache), standoff: () => cm(0.05), slack: cm(0.1), hug: true, shade: 0.85, curl: null });
  }
  return { layers, tie: null };
}
