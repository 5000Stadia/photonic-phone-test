// Spike "hair" (M1, R2): a person's hairstyle, the one record everything else is compiled from, and its one entry point.
// Kabe, 2026-10-11: "Alright take its best and lets make it elegent": a hairstyle is a small recipe, compiled once at
// build to guides, cards, the shared atlas and the vendored shader; nothing happens per frame but the force.
// Kabe, 2026-10-11, on words from the story ("Long haired blonde Woman in a red dress"): "set witting the scoped criteria
// given, if multiple options, random. If no criteria for element, random." (design/r3-plan.md, "From the story's words
// to a person"). So resolveHair takes constraints: an exact value is kept; a descriptor word cuts the dial's prior to its
// scope and the seed samples inside it, following the prior (draws from the prior until one lands in scope, else even
// inside the scope); anything unsaid samples the full prior (sex, age, and skin standing in for ancestry until R3).
// Contradictions are refused with a reason; words outside the vocabulary are kept in `other`, reported, never dropped.
// The record (r3-traits §6.6 names the traits; the dials are the controls Kabe's finds use):
//   style      cropped | short | receding | bald | bob | long | wavy | curly | ponytail | bun | afro
//   cut        crop | short | bald (a horseshoe round the sides and back) | bob | long | tied | afro
//   length     cm of strand on top (bob: to the cut; tied: the tail; afro: the volume's depth)
//   volume 0..1 · curl 0 straight .. 0.33 wavy .. 0.66 curly .. 1 coily · parting centre | left | right | none
//   fringe none | side | blunt | airy · sideburns 0..1 · tie ponytail | bun · recede 0..1 (the M-shaped retreat)
//   eumelanin, pheomelanin 0..1 (black, browns, blond, red, auburn from two numbers) · grey 0..1 of strands unpigmented
//   beard, moustache  cm (0: none) · seed
//   resolveHair(constraints, { sex, age, seed, skin }) -> record | { refused }     e.g. ({ length: "long", colour: "blonde" }, ...)
//   describeHair(record) -> words, in the same vocabulary      colours(record) -> { tip, root, grey } linear RGB
//   rng(seed, salt) -> () => [0, 1)
// Pure: no three.js. Deterministic: every draw comes from rng(seed, salt), one stream per dial.

export function rng(seed, salt = 0) {   // PCG-style integer hash (after Nathan Reed 2021, as holo-emitter's noise.js)
  let s = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77) ^ 0x6a09e667) >>> 0;
  return () => {
    s = (Math.imul(s, 747796405) + 2891336453) >>> 0;
    const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
    return (((w >>> 22) ^ w) >>> 0) / 4294967296;
  };
}

// styles: the cut, the dials' natural ranges, and defaults the prior starts from
export const STYLES = {
  cropped:  { cut: "crop", len: [0.4, 2], vol: [0.1, 0.3], parting: "none" },
  short:    { cut: "short", len: [3, 10], vol: [0.3, 0.6] },
  receding: { cut: "short", len: [2, 5], vol: [0.15, 0.35], recede: [0.6, 1], parting: "none" },
  bald:     { cut: "bald", len: [0.4, 1.2], vol: [0, 0.15], parting: "none" },
  bob:      { cut: "bob", len: [18, 30], vol: [0.25, 0.5] },
  long:     { cut: "long", len: [34, 70], vol: [0.25, 0.5], curl: [0, 0.25] },
  wavy:     { cut: "long", len: [30, 60], vol: [0.45, 0.7], curl: [0.25, 0.5] },
  curly:    { cut: "long", len: [20, 45], vol: [0.6, 0.85], curl: [0.55, 0.85], parting: "none" },
  ponytail: { cut: "tied", tie: "ponytail", len: [26, 60], vol: [0.1, 0.25], parting: "none" },
  bun:      { cut: "tied", tie: "bun", len: [30, 70], vol: [0.1, 0.25] },
  afro:     { cut: "afro", len: [3, 13], vol: [0.8, 1], curl: [0.85, 1], parting: "none" },
};
// descriptors: the closed vocabulary for hair (a word -> scopes on dials); "very" narrows a band (r3-plan §1)
export const WORDS = {
  bald: { style: ["bald"] }, shaved: { style: ["cropped"] }, cropped: { style: ["cropped"] },
  short: { len: [0.4, 12] }, "very short": { len: [0.4, 2.5] }, medium: { len: [14, 32] }, "shoulder-length": { len: [18, 34] },
  long: { len: [32, 90] }, "very long": { len: [55, 90] },
  // a texture word needs hair long enough to show it (a curly-haired man is not bald)
  straight: { curl: [0, 0.12] }, wavy: { curl: [0.25, 0.5], len: [6, 90] }, curly: { curl: [0.55, 0.95], len: [2.5, 90] }, coily: { curl: [0.85, 1], len: [1.5, 90] },
  black: { eu: [0.9, 1], pheo: [0, 0.15] }, dark: { eu: [0.76, 1], pheo: [0, 0.3] }, brown: { eu: [0.5, 0.84], pheo: [0, 0.35] },
  "light brown": { eu: [0.42, 0.6], pheo: [0, 0.35] }, blonde: { eu: [0.06, 0.38], pheo: [0, 0.32] }, platinum: { eu: [0, 0.1], pheo: [0, 0.2] },
  red: { eu: [0.15, 0.48], pheo: [0.72, 1] }, auburn: { eu: [0.5, 0.75], pheo: [0.6, 1] }, "strawberry blonde": { eu: [0.04, 0.25], pheo: [0.45, 0.8] },
  grey: { grey: [0.65, 0.92] }, white: { grey: [0.93, 1] }, "salt and pepper": { grey: [0.3, 0.6] }, greying: { grey: [0.12, 0.35] },
  ponytail: { style: ["ponytail"] }, bun: { style: ["bun"] }, bob: { style: ["bob"] }, afro: { style: ["afro"] }, receding: { style: ["receding"] },
  sleek: { vol: [0, 0.3] }, voluminous: { vol: [0.7, 1] },
  fringe: { fringe: ["side", "blunt", "airy"] }, bangs: { fringe: ["blunt", "airy"] }, "side parting": { parting: ["left", "right"] }, "centre parting": { parting: ["centre"] },
  beard: { beard: [2, 9] }, "long beard": { beard: [10, 18] }, moustache: { moustache: [1, 3] }, "clean-shaven": { beard: [0, 0], moustache: [0, 0] },
};
Object.assign(WORDS, { blond: WORDS.blonde, fair: WORDS.blonde, ginger: WORDS.red, silver: WORDS.grey, gray: WORDS.grey, kinky: WORDS.coily, frizzy: WORDS.coily });

const OPTIONS = { parting: ["centre", "left", "right", "none"], fringe: ["none", "side", "blunt", "airy"], tie: ["ponytail", "bun"] };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const cut = (a, b) => (a && b) ? [Math.max(a[0], b[0]), Math.min(a[1], b[1])] : a ?? b;
const pick = (R, table) => { let s = 0; for (const [, w] of table) s += w; let u = R() * s; for (const [v, w] of table) if ((u -= w) <= 0) return v; return table[table.length - 1][0]; };
// a draw from the prior that lands inside [lo, hi]: up to 48 prior draws, else even inside the scope
const within = (R, draw, sc) => { if (!sc) return draw(); for (let i = 0; i < 48; i++) { const v = draw(); if (v >= sc[0] && v <= sc[1]) return v; } return sc[0] + (sc[1] - sc[0]) * R(); };

export function resolveHair(constraints = {}, { sex = 0, age = 30, seed = 1, skin = "#c99a74" } = {}) {
  const S = (salt) => rng(seed, salt), male = sex >= 0.5;
  const hx = skin.slice(1), lum = [0, 2, 4].reduce((a, i, k) => a + parseInt(hx.slice(i, i + 2), 16) / 255 * [0.2126, 0.7152, 0.0722][k], 0);
  const dark = clamp01((0.62 - lum) / 0.42);                 // 0 very fair .. 1 very dark skin (the ancestry stand-in)
  // exact values pass through; strings are descriptor words, each cutting its dials' scopes
  const sc = {}, exact = {}, other = [], words = [...(constraints.words ?? [])];
  for (const [k, v] of Object.entries(constraints)) {
    if (k === "words") continue;
    if (typeof v === "number") exact[k] = v;
    else if (k === "style" && STYLES[v]) exact.style = v;
    else if (OPTIONS[k]?.includes(v)) exact[k] = v;
    else if (typeof v === "string") words.push(...v.split(/,\s*/));
  }
  for (const wd of words) {
    const d = WORDS[wd.toLowerCase()]; if (!d) { other.push(wd); continue; }
    for (const [dial, s] of Object.entries(d)) {
      const prev = sc[dial], cat = typeof s[0] === "string";
      sc[dial] = cat ? (prev ? prev.filter(x => s.includes(x)) : s) : cut(prev, s);
      if (cat ? !sc[dial].length : sc[dial][0] > sc[dial][1]) return { refused: `"${wd}" contradicts the rest of the hair description (${dial})`, other };
    }
  }
  // style: the prior's weights, kept to styles whose ranges meet every scope
  const meets = (a, b) => { const c = cut(a, b); return c[0] <= c[1]; };
  const fits = (n) => { const st = STYLES[n];
    return (!sc.style || sc.style.includes(n)) && (!sc.len || meets(st.len, sc.len)) && (!sc.curl || meets(st.curl ?? [0, 1], sc.curl))
      && (exact.length == null || (exact.length >= st.len[0] * 0.6 && exact.length <= st.len[1] * 1.4)); };
  const prior = male
    ? { short: 4, cropped: 3, receding: age > 28 ? 1 + age / 40 : 0, bald: age > 45 ? 1.5 : 0, long: 0.5, wavy: 0.2, curly: 0.3 + dark * 0.5, ponytail: 0.4, bun: 0.1, bob: 0.1, afro: 0.3 + dark * 1.5 }
    : { long: 3, wavy: 1, curly: 0.6 + dark, ponytail: 2, bun: 1.5, bob: 1.5, short: age < 12 ? 0.3 : 0.5, cropped: 0.15, afro: 0.2 + dark * 1.4, receding: 0, bald: 0 };
  const allowed = Object.entries(prior).filter(([n, v]) => v > 0 && fits(n));
  const style = exact.style ?? (allowed.length ? pick(S(1), allowed) : null);
  if (!style) return { refused: `no hairstyle fits ${JSON.stringify(constraints)} for a ${male ? "man" : "woman"} of ${age}`, other };
  const st = STYLES[style], u = (R, [a, b]) => a + (b - a) * R();
  // the dials, each from its own stream (a stream is made once: the rejection loop draws on from it)
  const [R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(S);
  const curl = exact.curl ?? within(R2, () => st.curl ? u(R2, st.curl) : R2() < 0.5 * dark ? 0.7 + 0.3 * R2() : R2() < 0.3 ? R2() * 0.48 : R2() * 0.1, cut(st.curl ?? [0, 1], sc.curl));
  const length = exact.length ?? within(R3, () => u(R3, st.len) * (age < 12 && st.cut !== "crop" && st.cut !== "bald" ? 0.75 : 1), cut(st.len, sc.len));
  const volume = exact.volume ?? within(R4, () => clamp01(u(R4, st.vol) + (curl > 0.5 ? 0.15 : 0)), sc.vol);
  const parting = exact.parting ?? (sc.parting ? pick(R5, sc.parting.map(p => [p, 1])) : st.parting ?? pick(R5, [["centre", 2], ["left", 1.5], ["right", 1.5], ["none", male ? 1.5 : 0.5]]));
  const fringe = exact.fringe ?? (sc.fringe ? pick(R6, sc.fringe.map(f => [f, 1])) : ["afro", "bald", "crop", "tied"].includes(st.cut) ? "none"
    : pick(R6, male ? [["none", 6], ["side", 1], ["airy", 0.5]] : st.cut === "bob" ? [["blunt", 2], ["side", 1], ["none", 1]] : [["none", 3], ["side", 1.2], ["blunt", 0.6], ["airy", 0.8]]));
  const eumelanin = exact.eumelanin ?? within(R7, () => (dark > 0.5 ? 0.86 + 0.14 * R7() : clamp01(0.2 + 0.8 * R7() ** (1.4 - 0.8 * dark))) * (age < 10 ? 0.6 + 0.04 * age : 1), sc.eu);
  const pheomelanin = exact.pheomelanin ?? within(R8, () => R8() < 0.1 * (1 - dark) ? 0.72 + 0.28 * R8() : 0.04 + 0.16 * R8(), sc.pheo);
  const onset = 28 + R9() * 18;
  const grey = exact.grey ?? within(R10, () => clamp01((age - onset + (R10() - 0.5) * 8) / 34) ** 1.2 * 0.92, sc.grey);
  const beard = exact.beard ?? within(R11, () => male && age >= 18 ? pick(R11, [[0, 5], [1.2 + R11() * 1.5, 1.2], [3 + R11() * 5, 1.4 + (age > 40 ? 1 : 0)]]) : 0, sc.beard);
  const moustache = exact.moustache ?? within(R12, () => beard > 0 ? Math.min(3, beard * 0.45 + 0.6) : male && age >= 18 && R12() < 0.15 ? 1.5 : 0, sc.moustache);
  const recede = exact.recede ?? (st.recede ? u(R13, st.recede) : male && age > 25 && style !== "bald" ? clamp01((age - 25) / 55) * R13() * 0.6 : 0);
  return { style, cut: st.cut, tie: exact.tie ?? st.tie ?? null, length, volume, curl, parting, fringe, sideburns: exact.sideburns ?? (male ? 0.1 + 0.35 * R14() : 0),
    recede, eumelanin, pheomelanin, grey, beard, moustache, seed, male, age, other };
}
// a recipe's hair: recipe.hair holds constraints (words or exact values); none, and the prior decides everything
export const hairstyle = (r) => resolveHair(r.hair ?? {}, r);

// words out, in the vocabulary words come in with (r3-plan: describe(person)): the band each dial falls in
export function describeHair(h) {
  const inBand = (v, [a, b]) => v >= a && v <= b, out = [];
  const lenW = ["very short", "short", "medium", "long", "very long"].filter(k => inBand(h.length, WORDS[k].len));
  if (h.cut === "bald") out.push("bald"); else if (lenW.length) out.push(lenW[lenW.length > 1 && lenW.includes("long") ? lenW.length - 1 : 0]);
  for (const c of ["black", "dark", "brown", "blonde", "platinum", "red", "auburn", "strawberry blonde"]) if (inBand(h.eumelanin, WORDS[c].eu) && inBand(h.pheomelanin, WORDS[c].pheo)) out.push(c);
  for (const g of ["greying", "salt and pepper", "grey", "white"]) if (inBand(h.grey, WORDS[g].grey)) out.push(g);
  for (const c of ["straight", "wavy", "curly", "coily"]) if (inBand(h.curl, WORDS[c].curl)) out.push(c);
  if (["ponytail", "bun", "bob", "afro", "receding"].includes(h.style)) out.push(h.style);
  if (h.beard > 0) out.push(h.beard >= 10 ? "long beard" : "beard"); else if (h.moustache > 0) out.push("moustache");
  return out;
}
// does a record fit a set of words? (the R3 test: every seed under one description fits it)
export const fitsWords = (h, words) => words.every(wd => { const d = WORDS[wd]; if (!d) return false;
  const v = { len: h.length, curl: h.curl, eu: h.eumelanin, pheo: h.pheomelanin, grey: h.grey, vol: h.volume, beard: h.beard, moustache: h.moustache };
  return Object.entries(d).every(([k, s]) => typeof s[0] === "string" ? s.includes(k === "style" ? h.style : h[k]) : v[k] >= s[0] - 1e-9 && v[k] <= s[1] + 1e-9); });

// ---- colour from the pigment pair, calibrated by eye against photographs and the hairdressers' level scale ----
// Absorption alone (exp(-sigma c), Chiang 2016's coefficients) saturates browns toward orange: real hair is a volume of
// fibres whose multiple scattering and white reflection neutralise the dark end. So the two pigments index two ramps of
// photographed colours: the natural series by eumelanin (level 10 platinum .. level 1 black) and the red series by
// eumelanin at full pheomelanin (strawberry blond .. deep auburn); pheomelanin mixes from one toward the other.
const NATURAL = ["#e9e0cf", "#dcc59a", "#c4a57c", "#a88660", "#8d6b4e", "#6a4e3a", "#4e3a2e", "#3b2c24", "#2b221d", "#141110"];
const REDS = ["#e6b088", "#d68a5a", "#bd5e2e", "#9c4423", "#7d331d", "#5e2819", "#432015", "#2f1a13", "#221410", "#140f0d"];
const lin = (hex) => [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const ramp = (list, t) => { const x = clamp01(t) * (list.length - 1), i = Math.min(list.length - 2, Math.floor(x)), f = x - i, a = lin(list[i]), b = lin(list[i + 1]);
  return a.map((v, k) => Math.exp(Math.log(v) * (1 - f) + Math.log(b[k]) * f)); };   // log-space: even steps in lightness
export function melanin(eu, pheo) {
  const n = ramp(NATURAL, eu), r = ramp(REDS, eu), w = clamp01(pheo) ** 1.4;
  return n.map((v, k) => Math.exp(Math.log(v) * (1 - w) + Math.log(r[k]) * w));
}
// the tip colour, the root colour (deeper: the root sits in the volume's shade) and the unpigmented strand's colour
export function colours(h) {
  const tip = melanin(h.eumelanin, h.pheomelanin);
  return { tip, root: tip.map(v => v * 0.55), grey: lin("#dedad2") };
}
