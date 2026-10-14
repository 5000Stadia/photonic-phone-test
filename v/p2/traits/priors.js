// Priors, version 0 (R3): what is usual for each trait, given kind, sex, age and setting. A description cuts these
// to its scope and the seed samples what is left (Kabe, 2026-10-11). Human only in M1; setting priors (1660 stature,
// pockmarks, teeth) arrive with M3's sampler, so `setting` is read but not yet used.
//
// A prior is one of:
//   { dist: "normal", mean, sd, lo, hi }   sampled through the standard normal quantile, clamped to [lo, hi]
//   { dist: "cat", weights: { value: w } } categorical
//   { dist: "tick", p }                    boolean
//   { dist: "fixed", value }               a kind default (body plan, counts, material)
//   { dist: "state", value }               not drawn: set by the story or the world (a wound, pregnancy, dirt)
//   { dist: "derived" }                    computed from identity and age at read time (greying, lines), never stored
//   { dist: "none" }                       nothing to draw (lists start empty; vectors come from their own engines)

const Z = { dist: "normal", mean: 0, sd: 1, lo: -3, hi: 3 };
const amount = (mean, sd) => ({ dist: "normal", mean, sd, lo: 0, hi: 1 });
const child = (age) => age < 13;
const adult = (age) => age >= 18;

// Age by band for a mixed town crowd (a young population, early modern Europe as the v0 default), years.
export const AGE_BANDS = [[0, 5, 0.14], [5, 13, 0.18], [13, 18, 0.10], [18, 30, 0.22], [30, 45, 0.18], [45, 60, 0.11], [60, 85, 0.07]];

// Stature: mean and SD in cm by sex and age (WHO/CDC growth medians, rounded; adults a modern European-ish v0).
// Stored as a z against this curve; the curve gives centimetres.
const STATURE = [[0, 50, 50], [1, 75, 76], [2, 86, 87], [4, 102, 103], [6, 115, 116], [8, 127, 128], [10, 138, 138], [12, 151, 149], [14, 163, 160], [16, 173, 163], [18, 176, 164], [60, 175, 162], [85, 170, 157]];
export function statureCurve(sex, age) {
  const col = sex === "female" ? 2 : sex === "male" ? 1 : 0;
  let i = 0; while (i < STATURE.length - 2 && age > STATURE[i + 1][0]) i++;
  const [a0, ...r0] = STATURE[i], [a1, ...r1] = STATURE[i + 1];
  const t = Math.max(0, Math.min(1, (age - a0) / (a1 - a0)));
  const pick = (r) => col === 0 ? (r[0] + r[1]) / 2 : r[col - 1];
  const mean = pick(r0) + (pick(r1) - pick(r0)) * t;
  return { mean, sd: mean * 0.04 };
}

// Masculine–feminine as a continuous trait apart from sex (Kabe, 2026-10-11): sex-conditioned with real overlap,
// pulled apart by puberty. Negative is masculine, positive feminine.
function mf(sex, age) {
  const s = sex === "female" ? 1 : sex === "male" ? -1 : 0;
  const puberty = age < 10 ? 0.2 : age < 17 ? 0.2 + 0.8 * (age - 10) / 7 : 1;
  return { dist: "normal", mean: 1.3 * s * puberty, sd: 0.8, lo: -3, hi: 3 };
}

// Hair length in cm: the v0 default (no setting yet). A child's hair is shorter on average.
function hairLength(sex, age) {
  if (age < 2) return { dist: "normal", mean: 4, sd: 3, lo: 0, hi: 20 };
  const scale = child(age) ? 0.7 : 1;
  return sex === "female" ? { dist: "normal", mean: 40 * scale, sd: 18, lo: 1, hi: 150 }
    : { dist: "normal", mean: 10 * scale, sd: 8, lo: 0, hi: 120 };
}

// Explicit human priors. Anything not here falls back by type and lifetime (fallback() below), and `coverage()`
// reports which traits are still on that fallback, so R3's test can say what is merely defaulted.
export function humanPrior(id, ctx) {
  const { sex, age } = ctx;
  switch (id) {
    case "kind": return { dist: "fixed", value: "human" };
    case "sex": return { dist: "cat", weights: { female: 0.5, male: 0.5, intersex: 0 } }; // intersex only when stated
    case "age": return { dist: "age" };
    case "plan": return { dist: "fixed", value: "biped" };
    case "material": return { dist: "fixed", value: "flesh" };
    case "surface.covering": return { dist: "fixed", value: "skin" };
    case "nose.form": case "ears.form": case "teeth.form": return { dist: "fixed", value: "human" };
    case "limb.foot": return { dist: "fixed", value: "plantigrade foot" };
    case "limb.hand": return { dist: "fixed", value: "five-fingered" };
    case "pupil.shape": return { dist: "fixed", value: "round" };
    case "sclera.colour": return { dist: "fixed", value: "white" };
    case "body.stature": return Z;
    case "body.MF": case "face.MF": return mf(sex, age);
    case "body.adiposity": return amount(child(age) ? 0.3 : 0.35, 0.15);
    case "body.muscularity": return amount(adult(age) ? (sex === "male" ? 0.45 : 0.35) : 0.25, 0.15);
    case "body.bust": return sex === "female" && age >= 12 ? amount(0.45 * Math.min(1, (age - 11) / 6), 0.18) : { dist: "fixed", value: 0 };
    case "beard.potential": return sex === "male" ? amount(age < 14 ? 0 : 0.7 * Math.min(1, (age - 13) / 9), 0.2) : amount(0.02, 0.02);
    case "neck.adamsApple": return sex === "male" ? amount(age < 13 ? 0.05 : Math.min(0.6, 0.1 + 0.5 * (age - 12) / 6), 0.15) : amount(0.05, 0.04);
    case "face.caricature": return { dist: "normal", mean: 1, sd: 0.15, lo: 0.5, hi: 2 };
    case "face.asymmetry": return amount(0.15, 0.08);
    case "face.fat": return amount(child(age) ? 0.5 : 0.35, 0.15);
    case "skin.melanin": return amount(0.25, 0.15); // ancestry-conditioned priors come with the ancestry table (M3)
    case "skin.redness": return amount(0.35, 0.12);
    case "skin.freckles": return amount(0.08, 0.1);
    case "skin.translucency": return amount(0.1, 0.05);
    case "skin.texture": return { dist: "derived" };
    case "skin.albinism": return { dist: "tick", p: 0.0001 };
    case "skin.vitiligo": return { dist: "fixed", value: 0 };
    case "hair.eumelanin": return amount(0.55, 0.25);
    case "hair.pheomelanin": return amount(0.3, 0.15);
    case "hair.texture": return amount(0.2, 0.15);
    case "hair.density": return amount(0.7, 0.12);
    case "hair.length": return hairLength(sex, age);
    case "hair.greying": return { dist: "derived" };
    case "hair.hairline": return { dist: "cat", weights: { straight: 0.35, rounded: 0.35, "widow's peak": 0.12, "M-shaped": 0.18 } };
    case "hair.wild": return amount(0.15, 0.12);
    case "iris.melanin": return amount(0.5, 0.3);
    case "ears.lobe": return { dist: "cat", weights: { free: 0.65, attached: 0.35 } };
    case "ears.point": return amount(0.02, 0.02);
    case "handedness": return { dist: "cat", weights: { right: 0.89, left: 0.1, ambidextrous: 0.01 } };
    case "posture.stoop": return { dist: "derived" };
    case "lines.amount": return { dist: "derived" };
    case "cheeks.dimples": return { dist: "tick", p: 0.2 };
    case "chin.cleft": return amount(0.08, 0.12);
    case "teeth.colour": return { dist: "derived" };
    case "teeth.alignment": return amount(0.25, 0.15);
    case "body.hair": return sex === "male" && age >= 16 ? amount(0.35, 0.2) : amount(0.05, 0.04);
    case "brows.shape": return { dist: "cat", weights: { straight: 0.3, "soft arch": 0.4, "high arch": 0.15, angled: 0.15 } };
    // Grooming: the v0 defaults have no setting yet (1660 and rank come with M3 and R5's wardrobe).
    case "hair.style": return age < 2 ? { dist: "fixed", value: "loose" } : sex === "female"
      ? { dist: "cat", weights: { loose: 0.35, bun: 0.25, braids: 0.15, coif: 0.15, bob: 0.1 } }
      : { dist: "cat", weights: { loose: 0.7, queue: 0.15, bob: 0.1, shaved: 0.05 } };
    case "beard.style": return sex === "male" && age >= 18
      ? { dist: "cat", weights: { clean: 0.45, stubble: 0.1, moustache: 0.1, goatee: 0.05, "van dyke": 0.05, chinstrap: 0.02, "mutton chops": 0.03, full: 0.15, "long full": 0.05 } }
      : { dist: "fixed", value: "clean" };
    case "hair.loss.pattern": { // the pattern a person's loss follows; how far along is derived from age
      if (sex === "male") return { dist: "cat", weights: { "Norwood 1": Math.max(0.2, 1 - age / 80), "Norwood 2": 0.15, "Norwood 3": 0.12 * Math.min(1, age / 50), "Norwood 4": 0.08 * Math.min(1, age / 55), "Norwood 5": 0.06 * Math.min(1, age / 60), "Norwood 6": 0.05 * Math.min(1, age / 65), "Norwood 7": 0.04 * Math.min(1, age / 70) } };
      return { dist: "cat", weights: { "Norwood 1": 0.8, "Ludwig I": 0.15 * Math.min(1, age / 50), "Ludwig II": 0.05 * Math.min(1, age / 60) } };
    }
  }
  return null;
}

// Fallback by type and lifetime, for rows without an explicit prior yet.
export function fallback(t) {
  const life = t.life || "";
  if (life.startsWith("S") || life === "W") {
    const vals = t.values || t.levels;
    return { dist: "state", value: t.type === "tick" ? false : vals ? (vals.includes("none") ? "none" : vals[0]) : t.type === "list" ? [] : ["z", "amount", "n", "cm"].includes(t.type) ? 0 : null };
  }
  if (life === "A") return { dist: "derived" };
  switch (t.type) {
    case "z": case "pct": return Z;
    case "amount": return amount(0.1, 0.08);
    case "tick": return { dist: "fixed", value: false };
    case "n": return { dist: "fixed", value: t.default ?? 0 };
    case "cat": case "ord": { // the table lists the usual value first ("walk", "sighted", "none")
      const vals = t.values || t.levels || [];
      return { dist: "fixed", value: vals.includes("none") ? "none" : vals[0] ?? null };
    }
    default: return { dist: "none" };
  }
}

// Returns [prior, explicit]: explicit is false while the trait is still on the fallback.
export function priorFor(t, ctx) {
  const p = ctx.kind === "human" ? humanPrior(t.id, ctx) : null;
  return p ? [p, true] : [fallback(t), false];
}
