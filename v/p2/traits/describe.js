// describe(person): words out in the same vocabulary as words in (design/r3-plan.md, point 6), ranked by what an
// observer notices first: who (age and sex), clothes, hair, height and build, skin, then whatever is far from usual.
// Every phrase is one parse() reads back to constraints this same person satisfies, so a narrator using these words
// never states something the body contradicts.

import { TRAIT } from "./schema.js";
import { HAIR_COLOUR, HAIR_LENGTH, HAIR_TEXTURE, BODY, FACE, IRIS, SKIN } from "./lexicon.js";
import { quantileOf } from "./resolve.js";

const within = (x, [lo, hi]) => x >= lo - 1e-9 && x <= hi + 1e-9;
const width = (b) => b[1] - b[0];

// The single-trait face phrases, by trait and direction ("hooked nose" for nose.dorsum high).
const FACE_WORD = {};
for (const [phrase, parts] of Object.entries(FACE)) {
  if (parts.length !== 1 || parts[0][2]) continue;
  const [trait, dir] = parts[0];
  const side = dir([0.85, 1])[0] >= 0.5 ? "high" : "low";
  FACE_WORD[trait] ??= {};
  FACE_WORD[trait][side] ??= phrase; // the first listed phrase is the plainest
}
const CROWD_RANK = { F: 0, M: 1, N: 2, "-": 3 };

function personWord(sex, age) {
  if (age < 1.5) return "baby";
  if (age < 3) return "toddler";
  if (age < 18) return sex === "male" ? "boy" : sex === "female" ? "girl" : "child";
  const noun = sex === "male" ? "man" : sex === "female" ? "woman" : "person";
  if (age >= 60) return `old ${noun}`;
  if (age >= 40) return `middle-aged ${noun}`;
  if (age < 30) return `young ${noun}`;
  return noun;
}

function hairWords(v, d) {
  if (d["hair.loss.stage"] > 0.85 && /Norwood 7|total/.test(v["hair.loss.pattern"])) return "bald";
  const len = v["hair.length"];
  const bands = Object.entries(HAIR_LENGTH).filter(([w, b]) => !["bald", "shaven", "waist-length", "short", "close-cropped"].includes(w) && within(len, b));
  const lengthWord = bands.length ? bands.sort((a, b) => width(a[1]) - width(b[1]))[0][0] : within(len, HAIR_LENGTH.short) ? "short" : null;
  const tex = Object.entries(HAIR_TEXTURE).find(([w, b]) => w !== "kinky" && w !== "straight" && within(v["hair.texture"], b));
  let colour = null;
  if (d["hair.greying"] >= 0.5 && v.age >= 55) colour = d["hair.greying"] >= 0.9 ? "white" : "grey";
  else {
    const fits = Object.entries(HAIR_COLOUR).filter(([w, b]) => !["blond", "fair", "ginger", "brunette"].includes(w)
      && within(v["hair.eumelanin"], b["hair.eumelanin"] || [0, 1]) && within(v["hair.pheomelanin"], b["hair.pheomelanin"] || [0, 1]));
    const area = ([, b]) => width(b["hair.eumelanin"] || [0, 1]) * width(b["hair.pheomelanin"] || [0, 1]);
    if (fits.length) colour = fits.sort((a, b) => area(a) - area(b))[0][0];
    else if (within(v["hair.eumelanin"], [0.4, 0.85])) colour = "brunette";
  }
  const words = [lengthWord === "very long" ? "very long" : lengthWord, tex && tex[0], colour].filter(Boolean);
  return words.length ? `${words.join(" ")} hair` : null;
}

function buildWords(v) {
  const out = [];
  const a = v["body.adiposity"], m = v["body.muscularity"];
  if (a < 0.18 || a > 0.55) {
    const order = a < 0.18 ? ["gaunt", "skinny", "thin"] : ["corpulent", "fat", "stout", "plump"];
    const w = order.find(w => within(a, BODY[w]["body.adiposity"].v));
    if (w) out.push(w);
  }
  if (m >= 0.65) out.push("muscular");
  return out;
}

const BEARD_WORD = { stubble: "stubble", moustache: "moustache", goatee: "goatee", "van dyke": "van dyke", chinstrap: "chinstrap", "mutton chops": "mutton chops", full: "full beard", "long full": "long beard" };

/**
 * @param res  a resolve() result ({ values, derived, garments })
 * @param opts { features: how many far-from-usual face features to name (default 3) }
 * @returns { aspects: [{ aspect, words }], text }
 */
export function describe(res, opts = {}) {
  const v = res.values, d = res.derived, ctx = { kind: v.kind, sex: v.sex, age: v.age };
  const aspects = [];
  const add = (aspect, words) => words && aspects.push({ aspect, words });

  add("person", personWord(v.sex, v.age));
  for (const g of res.garments || []) add(`wears.${g.slot}`, g.colour ? `${g.colour} ${g.slot}` : g.slot);
  add("hair", hairWords(v, d));
  const qs = quantileOf("body.stature", v["body.stature"], ctx);
  if (qs >= 0.97) add("height", "very tall"); else if (qs >= 0.85) add("height", "tall");
  else if (qs <= 0.03) add("height", "very short"); else if (qs <= 0.15) add("height", "short");
  for (const w of buildWords(v)) add("build", w);
  // Masculine–feminine is named only where it runs against sex (a feminine man, a masculine woman).
  if (v.age >= 13 && v.sex === "male" && v["face.MF"] >= 0.5) add("face", v["face.MF"] >= 1.5 ? "very feminine face" : "feminine face");
  if (v.age >= 13 && v.sex === "female" && v["face.MF"] <= -0.5) add("face", v["face.MF"] <= -1.5 ? "very masculine face" : "masculine face");
  if (v["beard.style"] && v["beard.style"] !== "clean") add("beard", BEARD_WORD[v["beard.style"]]);
  const skin = Object.entries(SKIN).filter(([w, b]) => b && !["very pale", "dark-skinned", "dark", "fair"].includes(w) && within(v["skin.melanin"], b))
    .sort((a, b) => width(a[1]) - width(b[1]))[0];
  if (skin) add("skin", `${skin[0]} skin`);
  const iris = Object.entries(IRIS).filter(([w, b]) => !["gray", "dark"].includes(w) && within(v["iris.melanin"], b)).sort((a, b) => width(a[1]) - width(b[1]))[0];
  if (iris) add("eyes", `${iris[0]} eyes`);

  // Far from usual: face traits beyond the 85th (or under the 15th) percentile of this person's prior.
  const far = [];
  for (const [trait, sides] of Object.entries(FACE_WORD)) {
    if (v[trait] === undefined) continue;
    const q = quantileOf(trait, v[trait], ctx);
    if (q === null) continue;
    const side = q >= 0.85 ? "high" : q <= 0.15 ? "low" : null;
    if (!side || !sides[side]) continue;
    const very = side === "high" ? q >= 0.97 : q <= 0.03;
    far.push({ trait, words: `${very ? "very " : ""}${sides[side]}`, rank: CROWD_RANK[TRAIT[trait].crowd] ?? 3, extremity: Math.abs(q - 0.5) });
  }
  far.sort((a, b) => a.rank - b.rank || b.extremity - a.extremity || (a.trait < b.trait ? -1 : 1));
  for (const f of far.slice(0, opts.features ?? 3)) add(f.trait.split(".")[0], f.words);

  return { aspects, text: aspects.map(a => a.words).join(", ") };
}
