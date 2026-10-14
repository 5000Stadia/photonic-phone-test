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
import { GENTRY_SHARE, WORKING_SHARE } from "./outfits.js";

// rank words: a stem or whole word, and how strongly it places someone. Occupations are 1660 London's: a merchant is gentle (the Exchange), a shopkeeper or a waterman is not.
const GENTLE = { gentleman: 3, gentlewoman: 3, gentlefolk: 3, lady: 3, lord: 3, noble: 3, nobleman: 3, noblewoman: 3, courtier: 3, squire: 3, esquire: 3, knight: 3, baron: 3, baroness: 3, duke: 3, duchess: 3, earl: 3, countess: 3,
  madam: 2, merchant: 1, alderman: 2, physician: 2, doctor: 1, lawyer: 1, judge: 2, banker: 1, gentry: 3, genteel: 3, rich: 2, wealthy: 2, prosperous: 2, affluent: 2, fashionable: 2, elegant: 2, refined: 2, fine: 1, "well-to-do": 2, mistress: 1 };
const WORKING = { servant: 3, maid: 3, maidservant: 3, manservant: 3, labourer: 3, laborer: 3, apprentice: 3, washerwoman: 3, laundress: 3, fishwife: 3, milkmaid: 3, dairymaid: 3, scullion: 3, drudge: 3, charwoman: 3, ploughman: 3, peasant: 3,
  worker: 2, workman: 3, workwoman: 3, working: 2, porter: 2, carter: 2, waterman: 2, boatman: 2, fisherman: 2, sailor: 2, farmer: 2, shepherd: 2, baker: 2, butcher: 2, blacksmith: 2, smith: 2, weaver: 2, cobbler: 2, tailor: 1,
  carpenter: 2, mason: 2, miller: 2, shopkeeper: 2, tradesman: 2, tradeswoman: 2, cook: 2, beggar: 3, urchin: 3, poor: 2, ragged: 2, humble: 2, common: 1, peasantry: 3, villager: 2, hawker: 2 };
// weaker hints from what is said to be worn
const GARMENT_HINT = { apron: ["working", 1], gown: ["gentle", 1], jerkin: ["working", 1], smock: ["working", 1] };
// the sex a rank noun implies (the lexicon does not know these words, so on its own a "washerwoman" is of whichever sex her seed gives); a page that wants the person to fit their words asks for it
const SEX_OF = { gentleman: "male", nobleman: "male", lord: "male", squire: "male", esquire: "male", knight: "male", baron: "male", duke: "male", earl: "male", manservant: "male", sir: "male",
  gentlewoman: "female", lady: "female", noblewoman: "female", baroness: "female", duchess: "female", countess: "female", madam: "female", maid: "female", maidservant: "female", washerwoman: "female", laundress: "female", fishwife: "female",
  milkmaid: "female", dairymaid: "female", charwoman: "female", workwoman: "female", tradeswoman: "female", mistress: "female", woman: "female", girl: "female", lass: "female", man: "male", boy: "male", lad: "male", workman: "male", fisherman: "male", boatman: "male", waterman: "male", ploughman: "male" };

const UPPER = new Set(["doublet", "bodice", "jerkin", "waistcoat", "coat", "jacket", "stays", "smock"]);
const LOWER = new Set(["skirt", "petticoat", "breeches", "petticoats", "slops", "hose"]);
const WHOLE = new Set(["dress", "gown", "suit", "outfit", "clothes", "clothing", "livery", "habit"]);
const UNDYED = new Set(["apron", "shirt", "shift", "collar", "band", "neckerchief", "linen", "coif", "cap", "hat", "stockings"]);       // linen and what the outfits do not colour
const NOT_CLOTHES = new Set(["hair", "haired", "eyes", "eyed", "beard", "bearded", "skin", "faced", "face", "complexion", "lips", "brows", "moustache", "mustache", "cheeked", "cheeks", "bearing"]);

// what a colour word is, as a colour on cloth (a dull, period reading, not a screen primary); the period dyes are the 1660 names
const COLOURS = {
  red: "#a8342c", scarlet: "#b52a25", crimson: "#8e1f33", claret: "#6b1f2f", madder: "#a8453a", rose: "#c05a6a", pink: "#c8788a",
  blue: "#2f4f94", navy: "#1f2f55", woad: "#3b5778", azure: "#3a6fae", "sky-blue": "#6a9ac4",
  green: "#2f6a3f", emerald: "#1f6b4a", olive: "#5e6a30", "bottle-green": "#2b4a38",
  yellow: "#c4a030", gold: "#c09a30", weld: "#b69a3a", ochre: "#b88a30", mustard: "#b4952f",
  purple: "#5e2a62", plum: "#5e2a62", violet: "#5a3a8a", lilac: "#8a70a8", murrey: "#7a2e3e",
  black: "#17171c", grey: "#6a6c72", gray: "#6a6c72", slate: "#45536a", charcoal: "#33353a",
  white: "#f0eee6", cream: "#ece4cc", ivory: "#ece4cc",
  brown: "#6b4a30", russet: "#80461b", tawny: "#a0703a", tan: "#a08060", drab: "#7b7563", orange: "#c4642a", buff: "#c8a878",
};

const tokens = (text) => String(text ?? "").toLowerCase().replace(/[^a-z\- ]+/g, " ").replace(/\b(\w+)-(haired|faced|eyed|bearded|cheeked)\b/g, "$1 $2").split(/\s+/).filter(Boolean);
const PALETTES = (o) => o.palette.silks;
const OUTFIT_OF = { female: { gentle: GENTLEWOMAN, working: WORKWOMAN }, male: { gentle: GENTLEMAN, working: WORKMAN } };

/** The sex a word in `words` implies, "male" or "female", or null: "washerwoman" is female, "apprentice" says nothing. For a page that wants its people to fit their words (the lexicon, which does not know these nouns, gives them a seed's sex). */
export function impliedSex(words) {
  for (const t of tokens(words)) if (SEX_OF[t]) return SEX_OF[t];
  return null;
}

/** What the words say about rank: { rank: "gentle" | "working" | null, words: [the words that said it], score }. A tie, or nothing said, is null. */
export function rankOf(words) {
  let g = 0, w = 0; const said = [];
  for (const t of tokens(words)) {
    if (GENTLE[t]) { g += GENTLE[t]; said.push(t); }
    else if (WORKING[t]) { w += WORKING[t]; said.push(t); }
    else if (GARMENT_HINT[t]) { const [r, n] = GARMENT_HINT[t]; if (r === "gentle") g += n; else w += n; said.push(t); }
  }
  return { rank: g === w ? null : g > w ? "gentle" : "working", words: said, score: g - w };
}

// the colour requests in the words: [{ word, part: "all" | "upper" | "lower" | "undyed", hex, garment }]
function colourRequests(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    if (t === "bottle" && toks[i + 1] === "green") { t = "bottle-green"; toks.splice(i, 2, t); }
    if (!COLOURS[t]) continue;
    // the garment this colour is for: the next word or two ("a red dress", "a bright red wool dress"), not hair or eyes
    let part = "all", garment = null;
    for (let j = i + 1; j <= i + 3 && j < toks.length; j++) {
      const n = toks[j];
      if (NOT_CLOTHES.has(n)) { part = null; break; }
      if (UNDYED.has(n)) { part = "undyed"; garment = n; break; }
      if (UPPER.has(n)) { part = "upper"; garment = n; break; }
      if (LOWER.has(n)) { part = "lower"; garment = n; break; }
      if (WHOLE.has(n)) { part = "all"; garment = n; break; }
    }
    if (part === null) continue;
    out.push({ word: garment ? `${t} ${garment}` : t, colour: t, part, hex: COLOURS[t], garment });
  }
  return out;
}

// how near a palette colour has to be to count as the colour said, in CIE76 units (deltaE, colour.js): under MATCH it is what was asked for, under NEAREST it is a near neighbour (a crimson for red), over it
// the palette has nothing like it and the page says so
export const MATCH = 12, NEAREST = 38;

function pickSilk(outfit, requests) {
  // the palette's silks: [{ id, bodice, skirt }]; a request for the upper part reads the bodice, the lower the skirt, the whole both
  const silks = PALETTES(outfit), best = {};
  const cost = (s, r) => r.part === "upper" ? deltaE(s.bodice, r.hex) : r.part === "lower" ? deltaE(s.skirt, r.hex) : (deltaE(s.bodice, r.hex) + deltaE(s.skirt, r.hex)) / 2;
  const nearest = (r) => silks.map((s) => ({ s, d: cost(s, r) })).sort((a, b) => a.d - b.d)[0];
  for (const r of requests) best[r.part] = { r, ...nearest(r) };
  return best;
}

/** Words to outfit. `words`: the person's description ("a girl of 8 in a red dress"); `values`: their resolved traits (sex, age); `id`: their key (the seed's hash, as outfitFor's).
 *  Returns { outfit | null, look | null, rank, rankFrom: "words" | "seed", rankWords, colours, notes, none }:
 *    outfit   one of GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN, or null: only the base layer (never unclothed), `none` saying why ("not yet: boys in skirts before breeching")
 *    look     the colours, as garments/outfit.js look() makes them ({ id, bodice, sleeve, skirt, shift, stockings }), the asked-for laid over the seed's
 *    colours  one for each colour said: { word, asked, part, got, gotHex, delta, status: "matched" | "nearest" | "outside" } so a substitution is reported, never silent
 *    notes    other things the words said that the dress does not follow (a man's "dress", an apron's colour) */
export function outfitFromWords(words, values, id) {
  const res = { outfit: null, look: null, rank: null, rankFrom: null, rankWords: [], colours: [], notes: [], none: null };
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
  if (!live.length) return res;
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
  // colour words beyond the first of a part have nowhere to go
  for (const r of live) if (!asked.includes(r)) res.notes.push(`"${r.word}": only one colour a part is dressed`);
  return res;
}

/** A population rule (makePeople's `outfits`) from a table of words: `wordsOf(id)` gives a person's description, or null for the seed's alone. Answers { outfit, look } or null for the base layer only. */
export function wordsRule(wordsOf) {
  return (id, values) => { const c = outfitFromWords(wordsOf(id) ?? "", values, id); return c.outfit ? { outfit: c.outfit, look: c.look } : null; };
}
