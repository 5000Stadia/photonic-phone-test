// Words to outfit (R5, "Done when: the lineup"): what a person's own words say about how they are dressed, as one of the four built outfits and its colours.
// "a girl of 8 in a red dress" is a girl who is dressed (rank not said: the seed's) in red. Small, deterministic, model-free: the same words, person and id give the same dress.
//
//   rank      words that place a person among the gentry or working folk ("lady", "gentleman", "a rich merchant" / "servant", "washerwoman", "apprentice"), and weaker hints from garments (an apron is working
//             dress, a gown a gentlewoman's). Said rank wins; with none, the seed (the placeholder rule's own hash of the id) decides.
//   garment   dress, gown, apron, doublet, breeches, skirt ... say which part a colour is for ("a red dress", "a black doublet"); a colour with no garment is the whole outfit's. The outfit follows the body's sex
//             (a man "in a dress" is dressed as a man: it is reported), and the body's age: the built outfits begin at 1.5 years for girls and 6 for boys (breeching), so younger children get none.
//   colour    the nearest the outfit's own palette (garments/outfit.js, each colour held 22 colour units off every skin tone) can make. A colour the palette has no near neighbour for (black on a
//             working woman, brown anywhere) is not dropped: the nearest is used and the substitution is returned for a page to say.
//
// outfitFor (outfits.js) stays the crowd's placeholder (a hash of the id, until M3's sampler). This is what the lineup page uses, and what a person's own words will use when the sampler reads them.
import { GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN, look } from "./garments/outfit.js";
import { deltaE } from "./garments/colour.js";
import { uniform } from "../traits/stream.js";
import { tokens, rankOf, impliedSex, colourRequests } from "./words.js";
import { MATCH, NEAREST, garmentsOf } from "./garments/worn.js";
export { rankOf, impliedSex, MATCH, NEAREST };
export { attireFor, attireReport } from "./attire.js";
import { GENTRY_SHARE, WORKING_SHARE } from "./outfits.js";

const PALETTES = (o) => o.palette.silks;
const OUTFIT_OF = { female: { gentle: GENTLEWOMAN, working: WORKWOMAN }, male: { gentle: GENTLEMAN, working: WORKMAN } };



function pickSilk(outfit, requests) {
  // the palette's silks: [{ id, bodice, skirt }]; a request for the upper part reads the bodice, the lower the skirt, the whole both
  const silks = PALETTES(outfit), best = {};
  const cost = (s, r) => r.part === "upper" ? deltaE(s.bodice, r.hex) : r.part === "lower" ? deltaE(s.skirt, r.hex) : (deltaE(s.bodice, r.hex) + deltaE(s.skirt, r.hex)) / 2;
  const nearest = (r) => silks.map((s) => ({ s, d: cost(s, r) })).sort((a, b) => a.d - b.d)[0];
  for (const r of requests) best[r.part] = { r, ...nearest(r) };
  return best;
}

/** Words to outfit. `words`: the person's description ("a girl of 8 in a red dress"); `values`: their resolved traits (sex, age); `id`: their key (the seed's hash, as outfitFor's).
 *  Returns { outfit | null, look | null, garments (the same as a list of garments, pattern-buffer's worn objects: what `person.wear(list)` takes), rank, rankFrom: "words" | "seed", rankWords, colours, notes, none }:
 *    outfit   one of GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN, or null: only the base layer (never unclothed), `none` saying why ("not yet: boys in skirts before breeching")
 *    look     the colours, as garments/outfit.js look() makes them ({ id, bodice, sleeve, skirt, shift, stockings }), the asked-for laid over the seed's
 *    colours  one for each colour said: { word, asked, part, got, gotHex, delta, status: "matched" | "nearest" | "outside" } so a substitution is reported, never silent
 *    notes    other things the words said that the dress does not follow (a man's "dress", an apron's colour) */
export function outfitFromWords(words, values, id) {
  const res = { outfit: null, look: null, garments: null, rank: null, rankFrom: null, rankWords: [], colours: [], notes: [], none: null };
  const female = values.sex === "female", male = values.sex === "male";
  if (!female && !male) { res.none = "no outfit is built for this body"; return res; }
  const toks = tokens(words), rk = rankOf(words);
  res.rank = rk.rank; res.rankWords = rk.words;
  if (rk.rank) res.rankFrom = "words";
  else { res.rank = uniform(0, id, "gentry") < GENTRY_SHARE / (GENTRY_SHARE + WORKING_SHARE) ? "gentle" : "working"; res.rankFrom = "seed"; }
  const outfit = OUTFIT_OF[female ? "female" : "male"][res.rank];
  const age = values.age;
  if (age < 1.5) { res.none = "not yet: a baby's long white gown is not built"; return res; }
  if (age < outfit.ages.from) { res.none = "not yet: boys in skirts before breeching"; return res; }
  res.outfit = outfit;
  res.look = look(uniform(0, id, "silk"), outfit, uniform(0, id, "hose"));
  // a garment said that the body's sex does not wear
  for (const t of toks) {
    if (male && (t === "dress" || t === "gown" || t === "skirt" || t === "petticoat" || t === "bodice" || t === "stays" || t === "apron")) res.notes.push(`"${t}" on a man: dressed as a man, as his body is`);
    if (female && (t === "doublet" || t === "breeches")) res.notes.push(`"${t}" on a woman: dressed as a woman, as her body is`);
  }
  const requests = colourRequests(toks);
  for (const r of requests.filter((r) => r.part === "undyed")) res.notes.push(`${r.word}: ${r.garment} is undyed linen`);
  const live = requests.filter((r) => r.part !== "undyed");
  if (!live.length) { res.garments = garmentsOf(outfit, res.look, id, age); return res; }
  // the whole outfit's colour first, then a part's colour over it
  const whole = live.filter((r) => r.part === "all").slice(0, 1), upper = live.filter((r) => r.part === "upper").slice(0, 1), lower = live.filter((r) => r.part === "lower").slice(0, 1);
  const asked = [...whole, ...upper, ...lower], best = pickSilk(outfit, asked);
  const ids = {};
  const status = (d) => d <= MATCH ? "matched" : d <= NEAREST ? "nearest" : "outside";
  for (const part of ["all", "upper", "lower"]) {
    const b = best[part]; if (!b) continue;
    if (part !== "lower") { res.look.bodice = b.s.bodice; res.look.sleeve = b.s.bodice; ids.upper = b.s.id; }
    if (part !== "upper") { res.look.skirt = b.s.skirt; ids.lower = b.s.id; }
    res.colours.push({ word: b.r.word, asked: b.r.hex, part, got: b.s.id, gotHex: part === "lower" ? b.s.skirt : b.s.bodice, gotSkirtHex: b.s.skirt, delta: Math.round(b.d), status: status(b.d) });
  }
  res.look.id = ids.upper && ids.lower && ids.upper !== ids.lower ? `${ids.upper} over ${ids.lower}` : ids.upper ?? ids.lower ?? res.look.id;
  res.garments = garmentsOf(outfit, res.look, id, age);
  // colour words beyond the first of a part have nowhere to go
  for (const r of live) if (!asked.includes(r)) res.notes.push(`"${r.word}": only one colour a part is dressed`);
  return res;
}

/** A population rule (makePeople's `outfits`) from a table of words: `wordsOf(id)` gives a person's description, or null for the seed's alone. Answers { outfit, look } or null for the base layer only. */
export function wordsRule(wordsOf) {
  return (id, values) => { const c = outfitFromWords(wordsOf(id) ?? "", values, id); return c.outfit ? { outfit: c.outfit, look: c.look } : null; };
}
