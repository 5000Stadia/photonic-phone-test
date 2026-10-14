// What words say about clothes (R5), the light half of dress-words.js: rank, sex and colour words. No imports beyond the tokens' own, so pattern-buffer's mirror (src/traits/pb.js) and the attire
// sampler (attire.js) can read it without pulling in the garments' geometry. dress-words.js re-exports all of it.

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

export const UPPER = new Set(["doublet", "bodice", "jerkin", "waistcoat", "coat", "jacket", "stays", "smock"]);
const LOWER = new Set(["skirt", "petticoat", "breeches", "petticoats", "slops", "hose"]);
const WHOLE = new Set(["dress", "gown", "suit", "outfit", "clothes", "clothing", "livery", "habit"]);
const UNDYED = new Set(["apron", "shirt", "shift", "collar", "band", "neckerchief", "linen", "coif", "cap", "hat", "stockings"]);       // linen and what the outfits do not colour
const NOT_CLOTHES = new Set(["hair", "haired", "eyes", "eyed", "beard", "bearded", "skin", "faced", "face", "complexion", "lips", "brows", "moustache", "mustache", "cheeked", "cheeks", "bearing"]);

// what a colour word is, as a colour on cloth (a dull, period reading, not a screen primary); the period dyes are the 1660 names
export const COLOURS = {
  red: "#a8342c", scarlet: "#b52a25", crimson: "#8e1f33", claret: "#6b1f2f", madder: "#a8453a", rose: "#c05a6a", pink: "#c8788a",
  blue: "#2f4f94", navy: "#1f2f55", woad: "#3b5778", azure: "#3a6fae", "sky-blue": "#6a9ac4",
  green: "#2f6a3f", emerald: "#1f6b4a", olive: "#5e6a30", "bottle-green": "#2b4a38",
  yellow: "#c4a030", gold: "#c09a30", weld: "#b69a3a", ochre: "#b88a30", mustard: "#b4952f",
  purple: "#5e2a62", plum: "#5e2a62", violet: "#5a3a8a", lilac: "#8a70a8", murrey: "#7a2e3e",
  black: "#17171c", grey: "#6a6c72", gray: "#6a6c72", slate: "#45536a", charcoal: "#33353a",
  white: "#f0eee6", cream: "#ece4cc", ivory: "#ece4cc",
  brown: "#6b4a30", russet: "#80461b", tawny: "#a0703a", tan: "#a08060", drab: "#7b7563", orange: "#c4642a", buff: "#c8a878",
};

export const tokens = (text) => String(text ?? "").toLowerCase().replace(/[^a-z\- ]+/g, " ").replace(/\b(\w+)-(haired|faced|eyed|bearded|cheeked)\b/g, "$1 $2").split(/\s+/).filter(Boolean);

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
export function colourRequests(toks) {
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
