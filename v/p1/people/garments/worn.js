// What is drawn of what is worn (R5, "Clothes as objects"): a person's garments, { id, kind, aspects }, resolved to one of the built draw classes, with a report that says everything it
// changed or could not draw. kinds.js has the data (the kinds, their slots and layers, what each package draws); this is the rule.
//
//   1. A garment of a kind we do not have (a cloak, a hat, or any name we never made) is NOT DRAWN, and reported. So is a kind that is not a kind name.
//   2. Two garments in one slot cannot both be drawn: the OUTERMOST wins (the higher layer; equal layers, the one listed last, put on last). Two bodices, a skirt over breeches: reported as a conflict.
//   3. The torso and legs garments that remain choose the CLASS: one of the four outfit packages (gentlewoman, workwoman, gentleman, workman), which is what the draws are keyed by (with the wear mask:
//      the torso garment is bit 0, the legs garment bit 1). The package that draws the most of them as they are, torso first, if the body is old enough for it. A garment its package does not draw
//      (a doublet over a roll skirt) is drawn as the package's own kind in its place, with its colour: a FALLBACK, and the report says which.
//   4. The shift is always on: with nothing else worn, the base layer is what is drawn.
//   5. The neckwear, the apron and the stockings are the class's own: what is not worn is not drawn (the report lists it as `unworn`; the mask's bit 2 hides the neckwear, bit 3 the apron, as the torso's and legs' bits
//      hide theirs, and the stockings' paint takes the base layer's colour: a mask the draw reads as data, one program), and a worn one the class cannot
//      draw is reported as not drawn.
//   6. A garment's COLOUR is drawn (its torso, legs and stockings): a colour name or "#rrggbb" is read as the nearest colour of the package's palette, which is kept off every skin tone; what the
//      palette had no near neighbour for is reported (`colours`). Material, condition and pattern are carried and not yet drawn.
import { OUTFITS, look as silkLook, cutFor } from "./outfit.js";
import { lab } from "./colour.js";
import { COLOURS } from "../words.js";
import { uniform } from "../../traits/stream.js";
import { KINDS, KIND_RE, FUTURE, SLOTS, PACKAGE_KINDS, PACKAGE_IDS, SILKS, HOSE } from "./kinds.js";

/** How near a palette colour has to be to count as the colour said, in CIE76 units: under MATCH it is what was asked for, under NEAREST a near neighbour (a crimson for red), over it the palette has nothing like it. */
export const MATCH = 12, NEAREST = 38;

const HEX = /^#[0-9a-f]{6}$/i;
const norm = (s) => String(s).toLowerCase().trim().replace(/\s+/g, "-");
const status = (d) => d <= MATCH ? "matched" : d <= NEAREST ? "nearest" : "outside";

// a package's colours for a part ("upper": the bodice or doublet; "lower": skirt or breeches; "hose"): name -> hex, and the hexes
const palettes = new Map();
function paletteOf(pkgId, part) {
  const key = pkgId + "|" + part;
  let p = palettes.get(key); if (p) return p;
  const o = OUTFITS[pkgId], names = new Map(), hexes = [];
  if (part === "hose") (o.palette.stockings ?? []).forEach((h, i) => { names.set(HOSE[pkgId][i], h.rgb); hexes.push(h.rgb); });
  else o.palette.silks.forEach((s, i) => {
    const hex = part === "upper" ? s.bodice : s.skirt, name = SILKS[pkgId][i][part][0];
    if (!names.has(name)) names.set(name, hex);
    hexes.push(hex);
  });
  const uniq = [...new Set(hexes)];
  palettes.set(key, p = { names, hexes: uniq, exact: new Set(uniq.map((h) => h.toLowerCase())), labs: uniq.map((h) => lab(h)) });
  return p;
}

/** A garment's colour aspect as the nearest colour of a package's palette for a part: { hex, asked, delta, status } or null for a colour we cannot read. */
export function paletteColour(value, pkgId, part) {
  if (typeof value !== "string" || !value.trim()) return null;
  const p = paletteOf(pkgId, part), v = value.trim(), asked = HEX.test(v) ? v.toLowerCase() : p.names.get(norm(v)) ?? COLOURS[norm(v)] ?? null;
  if (!asked) return null;
  if (p.exact.has(asked.toLowerCase())) { const hex = p.hexes.find((h) => h.toLowerCase() === asked.toLowerCase()); return { hex, asked, delta: 0, status: "matched" }; }      // (the usual case: a colour the palette itself gave)
  const L = lab(asked); let best = null;
  p.hexes.forEach((hex, i) => { const q = p.labs[i], d = Math.hypot(q[0] - L[0], q[1] - L[1], q[2] - L[2]); if (!best || d < best.d) best = { hex, d }; });
  return best && { hex: best.hex, asked, delta: Math.round(best.d), status: status(best.d) };
}

const better = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k]; return false; };       // lexicographic
const accepts = (pkgId, g, child) => KINDS[g.kind].packages.includes(pkgId) && !(g.kind === "plain_skirt" && pkgId === "gentlewoman" && !child);

/** Resolve a set of garments for one body. `garments`: [{ id, kind, aspects }] (as pattern-buffer holds them; later in the list = put on later). `body`: { age, sex ("male" | "female" | other) }.
 *  `opts.look` (with `opts.lookFor`, the package it is for): the hash's colours, when the caller has already made them; `opts.id`: the person's id (the hash behind the colours they were not given); `opts.prefer`: an outfit package (garments/outfit.js) to keep when nothing else decides, the one the crowd's rule
 *  dresses them in.
 *  Returns { garments (as stated), outfit (a package or null: nothing is built for this body), cut (the body's cut of it), mask (bit 0 torso, bit 1 legs), look ({ id, bodice, sleeve, skirt, shift, stockings? }),
 *    class: { outfit, cut, mask } (the draw is keyed by outfit and mask; the cut is the person's own and shares the class mesh), drawn: [{ id, kind, as }] (as: the kind it was drawn as, when a fallback put another in its place),
 *    unworn: [kinds the class has that nobody wore: hidden, but the shift, which is always drawn], notDrawn: [{ id, kind, reason }], conflicts: [{ slot, kept, dropped, rule }], fallback: null | { reason, worn, drawn }, colours: [...], shift: true }. */
export function resolveWorn(garments, body = {}, opts = {}) {
  const age = typeof body.age === "number" ? body.age : 30, id = opts.id ?? "";
  const stated = (garments ?? []).map((g, i) => ({ id: g?.id ?? `garment${i}`, kind: g?.kind ?? null, aspects: g?.aspects ?? {}, i }));
  const notDrawn = [], conflicts = [], live = [];
  // 1. kinds we do not have
  for (const g of stated) {
    if (typeof g.kind !== "string" || !KIND_RE.test(g.kind)) notDrawn.push({ id: g.id, kind: g.kind, reason: "not a kind name (a-z, 0-9 and _, starting with a letter)" });
    else if (FUTURE.has(g.kind)) notDrawn.push({ id: g.id, kind: g.kind, reason: `no ${g.kind} template is built yet` });
    else if (!KINDS[g.kind]) notDrawn.push({ id: g.id, kind: g.kind, reason: `unknown kind "${g.kind}": no template` });
    else live.push(g);
  }
  // 2. one garment a slot, the outermost
  const sel = {}, held = {};
  for (const g of live) (held[KINDS[g.kind].slot] ??= []).push(g);
  for (const slot of SLOTS) {
    const here = held[slot];
    if (!here) continue;
    const win = here.length === 1 ? here[0] : here.reduce((a, b) => (KINDS[b.kind].layer > KINDS[a.kind].layer || (KINDS[b.kind].layer === KINDS[a.kind].layer && b.i > a.i)) ? b : a);
    sel[slot] = win;
    if (here.length === 1) continue;
    const lost = here.filter((g) => g !== win);
    conflicts.push({ slot, kept: { id: win.id, kind: win.kind }, dropped: lost.map((g) => ({ id: g.id, kind: g.kind })), rule: "outermost wins: the higher layer, then the one put on last" });
    for (const g of lost) notDrawn.push({ id: g.id, kind: g.kind, reason: `conflict in the ${slot} slot: ${win.kind} is outermost` });
  }
  // 3. the class
  const T = sel.torso ?? null, L = sel.legs ?? null;
  const buildable = opts.only ? [opts.only.id] : PACKAGE_IDS.filter((p) => age >= PACKAGE_KINDS[p].from);          // `only`: the old outfit path's own package, whatever the age (outfits.js dressingFor)
  const female = body.sex === "female" || (typeof body.sex === "number" && body.sex < 0.5), male = body.sex === "male" || (typeof body.sex === "number" && body.sex >= 0.5);
  let best = null;
  for (const p of buildable) {
    const child = age < PACKAGE_KINDS[p].adultAt, a = (g) => (g && accepts(p, g, child) ? 1 : 0), Q = PACKAGE_KINDS[p];
    const extras = (sel.neck?.kind === Q.neck ? 1 : 0) + (sel.over?.kind === Q.over ? 1 : 0) + (sel.hose?.kind === Q.hose ? 1 : 0);          // (an apron alone is a working woman's)
    const score = [a(T) + a(L), a(T), extras, opts.prefer?.id === p ? 1 : 0, (female && PACKAGE_KINDS[p].female) || (male && !PACKAGE_KINDS[p].female) ? 1 : 0];
    if (!best || better(score, best.score)) best = { p, score };
  }
  const res = { garments: stated.map((g) => ({ id: g.id, kind: g.kind, aspects: g.aspects })), outfit: null, cut: null, mask: 0, hose: true, look: null, class: null, drawn: [], unworn: [], notDrawn, conflicts, fallback: null, colours: [], shift: true };
  const shift = sel.under ?? null;
  if (shift) res.drawn.push({ id: shift.id, kind: "shift", as: "shift" }); else res.unworn.push("shift");          // (always drawn: the base layer)
  if (!best) {
    for (const g of [T, L, sel.neck, sel.over, sel.hose]) if (g) notDrawn.push({ id: g.id, kind: g.kind, reason: `no outfit is built for a body of ${age} years: the base layer is drawn` });
    if (T || L) res.fallback = { reason: `no outfit is built for a body of ${age} years`, worn: [T, L].filter(Boolean).map((g) => g.kind), drawn: ["shift"] };
    return res;
  }
  const P = PACKAGE_KINDS[best.p], outfit = OUTFITS[best.p], child = age < P.adultAt, cut = cutFor(age, outfit);
  res.outfit = outfit; res.cut = cut;
  const subs = [];
  const place = (g, own, bit) => {
    if (!g) return;
    res.mask |= bit;
    const as = accepts(best.p, g, child) ? g.kind : own;
    if (as !== g.kind) subs.push({ id: g.id, kind: g.kind, as });
    res.drawn.push({ id: g.id, kind: g.kind, as });
  };
  place(T, P.torso, 1); place(L, P.legs, 2);
  if (subs.length) {
    const ps = PACKAGE_IDS.filter((p) => p !== best.p && [T, L].filter(Boolean).some((g) => accepts(p, g, age < PACKAGE_KINDS[p].adultAt)));
    const young = ps.filter((p) => age < PACKAGE_KINDS[p].from);
    res.fallback = { reason: `no class draws ${[T, L].filter(Boolean).map((g) => g.kind).join(" with ")}${young.length ? `; ${young.join(" and ")} is not built for a body of ${age} years` : ""}: the nearest drawn is the ${best.p} package`,
      worn: [T, L].filter(Boolean).map((g) => g.kind), drawn: [T, L].filter(Boolean).map((g) => subs.find((s) => s.id === g.id)?.as ?? g.kind), outfit: best.p, substituted: subs };
  }
  // 5. neckwear, apron, stockings: the class's own
  for (const [slot, own] of [["neck", P.neck], ["over", P.over], ["hose", P.hose]]) {
    const g = sel[slot];
    // a class draws its neckwear with the torso, its apron with the legs' garment; stockings are the legs' paint, always
    const drawnHere = own && (slot === "neck" ? (res.mask & 1) : slot === "over" ? (res.mask & 2) : true);
    if (g && own && g.kind === own && drawnHere) res.drawn.push({ id: g.id, kind: g.kind, as: own });
    else if (g && own && g.kind !== own) notDrawn.push({ id: g.id, kind: g.kind, reason: `the ${best.p} class draws ${own}, not ${g.kind}` });
    else if (g && own && !drawnHere) notDrawn.push({ id: g.id, kind: g.kind, reason: `${g.kind} is drawn with the ${slot === "neck" ? "torso garment" : "skirt"}, and none is worn` });
    else if (g) notDrawn.push({ id: g.id, kind: g.kind, reason: `the ${best.p} class has no ${g.kind} (${slot === "hose" ? "the long skirt covers them" : "not in this class"})` });
    else if (drawnHere) res.unworn.push(own);
    // what is not worn is not drawn: the class hides it (the mask's bit 2 the neckwear, bit 3 the apron; the stockings' paint takes the base layer's colour)
    if (own && drawnHere && !(g && g.kind === own)) { if (slot === "neck") res.mask |= 4; else if (slot === "over") res.mask |= 8; else res.hose = false; }
  }
  // 6. the colours: the hash's for what was not given, the garments' over them
  const look = opts.look && opts.lookFor === outfit ? { ...opts.look } : silkLook(uniform(0, id, "silk"), outfit, uniform(0, id, "hose"));          // (the hash's colours for what was not given; garmentsOf has made them already)
  const readColour = (g, part, as) => {
    const c = g.aspects?.colour; if (c === undefined || c === null || c === "") return null;
    const r = paletteColour(c, best.p, part);
    res.colours.push(r ? { id: g.id, kind: g.kind, part, asked: c, got: r.hex, delta: r.delta, status: r.status } : { id: g.id, kind: g.kind, part, asked: c, got: null, status: "unreadable" });
    return r ? r.hex : null;
  };
  const upper = T && readColour(T, "upper"), lower = L && readColour(L, "lower"), hose = P.hose && sel.hose && sel.hose.kind === P.hose ? readColour(sel.hose, "hose") : null;
  if (upper) { look.bodice = upper; look.sleeve = upper; }
  if (lower) look.skirt = lower;
  if (hose) look.stockings = hose;
  if ((upper && upper !== look.bodice) || (lower && lower !== look.skirt)) look.id = `${upper ?? look.bodice} over ${lower ?? look.skirt}`;
  look.shift = outfit.palette.shift;
  res.look = look;
  res.class = { outfit: best.p, cut: cut.id, mask: res.mask };
  return res;
}

/** The resolution of an outfit package worn whole, the old path's (outfitFor, the words rule) and the crowd's: what resolveWorn(garmentsOf(outfit, look, id, age), body, { only: outfit, look }) answers for it
 *  (the same dressing, test/garments-objects.test.mjs), without the work of choosing a class, since there is only the one. 300 people are added at load; their garments and what is drawn are made when asked. */
export function resolveOutfit(outfit, lk, id = "", age = 30) {
  const cut = cutFor(age, outfit), look = { ...lk, shift: outfit.palette.shift };
  let garments = null, drawn = null;
  return { get garments() { return garments ??= garmentsOf(outfit, lk, id, age); }, outfit, cut, mask: 3, hose: true, look, class: { outfit: outfit.id, cut: cut.id, mask: 3 },
    get drawn() { return drawn ??= this.garments.map((g) => ({ id: g.id, kind: g.kind, as: g.kind })); }, unworn: [], notDrawn: [], conflicts: [], fallback: null, colours: [], shift: true };
}

/** The report for a person the crowd's rule dresses in nothing: the base layer only, which is the shift, drawn by the base class. */
export function baseOnly(garments, why) {
  const stated = (garments ?? []).map((g, i) => ({ id: g?.id ?? `garment${i}`, kind: g?.kind ?? null, aspects: g?.aspects ?? {} }));
  return { garments: stated, outfit: null, cut: null, mask: 0, look: null, class: null, drawn: stated.filter((g) => g.kind === "shift").map((g) => ({ id: g.id, kind: "shift", as: "shift" })), unworn: stated.some((g) => g.kind === "shift") ? [] : ["shift"],
    notDrawn: stated.filter((g) => g.kind !== "shift").map((g) => ({ id: g.id, kind: g.kind, reason: why })), conflicts: [], fallback: null, colours: [], shift: true, base: why };
}

/** The garments an outfit package is, as pattern-buffer would hold them: the old path's (outfitFor, the words rule) answer, as a garment list. `look`: the colours it was given ({ bodice, skirt, stockings }; the hash's, from `id`, where it has none);
 *  `age`: the wearer's, so a child of the gentlewoman package wears a plain skirt (its cut has no roll). Ids are `${id}/${kind}`. */
export function garmentsOf(outfit, look, id = "", age = 30) {
  const P = PACKAGE_KINDS[outfit.id], lk = look ?? silkLook(uniform(0, id, "silk"), outfit, uniform(0, id, "hose")), out = [];
  const add = (kind, aspects) => out.push({ id: `${id}/${kind}`, kind, aspects });
  add("shift", { colour: lk.shift ?? outfit.palette.shift, material: "linen" });
  add(P.torso, { colour: lk.bodice });
  add(outfit.id === "gentlewoman" && age < P.adultAt ? "plain_skirt" : P.legs, { colour: lk.skirt });
  if (P.neck) add(P.neck, { colour: "white", material: "linen" });
  if (P.over) add(P.over, { colour: "white", material: "linen" });
  if (P.hose) add(P.hose, { colour: lk.stockings ?? "#f1ecde" });
  return out;
}
