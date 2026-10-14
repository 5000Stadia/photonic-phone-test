// Resolution (R3): a description is a set of constraints, not a finished recipe (Kabe, 2026-10-11). What it scopes
// is set within that scope; wherever several values fit, or nothing is said, the seed chooses from the prior.
// Deterministic and model-free: the same description, seed and person key give the same person on any engine.

import { TRAITS, TRAIT } from "./schema.js";
import { priorFor, AGE_BANDS, statureCurve } from "./priors.js";
import { parse } from "./lexicon.js";
import { uniform } from "./stream.js";
import { probit, dcdf } from "./dmath.js";
import { VERSION } from "./version.js";

export const GENERATOR = "photonic.person/0";
const Q85 = 1.0364333894937896; // the standard normal's 85th percentile: "noticeably" beyond the usual

// Traits resolved before the rest, because the others' priors depend on them.
const ENVELOPE = ["kind", "sex", "age"];

// Intersect one trait's constraints. Returns { q, v, in, set, add, words } or { refused }.
// Besides bands and categories, a constraint may `set` an exact value (a count, a colour, a tick, a stated stoop)
// or `add` entries to a list trait (marks, aids, parts); two different `set`s contradict each other.
function intersect(list) {
  let q = [0, 1], v = [-Infinity, Infinity], allowed = null, set, add = null;
  const words = [];
  for (const c of list) {
    words.push(c.word);
    if (c.q) q = [Math.max(q[0], c.q[0]), Math.min(q[1], c.q[1])];
    if (c.v) v = [Math.max(v[0], c.v[0]), Math.min(v[1], c.v[1])];
    if (c.in) allowed = allowed ? allowed.filter(x => c.in.includes(x)) : [...c.in];
    if ("set" in c) {
      if (set !== undefined && JSON.stringify(set) !== JSON.stringify(c.set)) return { refused: words };
      set = c.set;
    }
    if (c.add) add = [...(add || []), ...c.add];
  }
  const empty = q[0] > q[1] || v[0] > v[1] || (allowed && !allowed.length);
  if (empty) return { refused: words };
  if (set !== undefined && typeof set === "number" && !(set >= v[0] && set <= v[1])) return { refused: words };
  if (set !== undefined && allowed && !allowed.includes(set)) return { refused: words };
  return { q, v, in: allowed, set, add, words };
}

// Sample a normal prior inside a quantile band and a value band.
function sampleNormal(prior, scope, u0, override) {
  const { mean, sd } = prior;
  let lo = prior.lo, hi = prior.hi;
  if (override) { lo = -Infinity; hi = Infinity; }
  const vlo = Math.max(lo, scope ? scope.v[0] : -Infinity), vhi = Math.min(hi, scope ? scope.v[1] : Infinity);
  if (vlo > vhi) return { beyond: true };
  if (sd === 0) return { value: Math.min(vhi, Math.max(vlo, mean)) };
  let qlo = scope ? scope.q[0] : 0, qhi = scope ? scope.q[1] : 1;
  qlo = Math.max(qlo, vlo === -Infinity ? 0 : dcdf((vlo - mean) / sd));
  qhi = Math.min(qhi, vhi === Infinity ? 1 : dcdf((vhi - mean) / sd));
  if (qlo >= qhi) {
    // A value band where the prior has (numerically) no mass, such as "very long" hair on a man: the description
    // wins, uniformly inside its band. A quantile band that misses a value band is a contradiction.
    const onlyValues = scope && scope.q[0] === 0 && scope.q[1] === 1;
    if (onlyValues) return { value: vlo + (vhi - vlo) * u0 };
    return { clash: true };
  }
  const u = qlo + (qhi - qlo) * u0;
  const value = mean + sd * probit(Math.min(1 - 1e-15, Math.max(1e-15, u)));
  return { value: Math.min(vhi, Math.max(vlo, value)) };
}

function sampleCat(weights, allowed, u0) {
  let entries = Object.entries(weights).filter(([k]) => !allowed || allowed.includes(k));
  if (allowed && !entries.some(([, w]) => w > 0)) entries = allowed.map(k => [k, 1]); // the description wins over the prior
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = u0 * total;
  for (const [k, w] of entries) { if (x < w) return k; x -= w; }
  return entries[entries.length - 1][0];
}

const MAX_AGE = 120; // the human span; past it only a named person's override (Gandalf, a cursed elder)
function sampleAge(scope, seed, key, override) {
  const top = override ? Infinity : MAX_AGE;
  const [a, b0] = scope ? scope.v : [-Infinity, Infinity], b = Math.min(b0, top);
  if (a > b) return NaN;
  const bands = AGE_BANDS.map(([lo, hi, w]) => {
    const l = Math.max(lo, a), h = Math.min(hi, b);
    return [l, h, h > l ? w * (h - l) / (hi - lo) : 0];
  });
  const total = bands.reduce((s, x) => s + x[2], 0);
  if (total === 0) { // a scope outside the bands (a 100-year-old): uniform inside it
    const l = Math.max(0, a), h = Math.min(Math.max(b, l), a === -Infinity ? MAX_AGE : b);
    return l + (h - l) * uniform(seed, key, "age", 1);
  }
  let x = uniform(seed, key, "age") * total;
  for (const [l, h, w] of bands) {
    if (x < w) return l + (h - l) * uniform(seed, key, "age", 1);
    x -= w;
  }
  const [l, h] = bands[bands.length - 1];
  return l + (h - l) * uniform(seed, key, "age", 1);
}

// Age-driven aspects are derived for a given age, never stored (design/unified-world-access-photonic-r1.md, (c)).
export function derive(values, age) {
  const z = (id) => (typeof values[id] === "number" ? values[id] : 0);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const sex = values.sex;
  const height = statureCurve(sex, age);
  const onset = 34 + 6 * z("hair.greyingAge");
  return {
    "body.height": height.mean + height.sd * z("body.stature"), // cm
    "hair.greying": clamp01((age - onset) / 35),
    "lines.amount": clamp01((age - 25) / 50),
    "posture.stoop": clamp01((age - 62) / 30) * 0.6,
    "skin.texture": clamp01((age - 30) / 60),
    "teeth.colour": clamp01((age - 20) / 80),
    "hair.loss.stage": clamp01((age - 20) / 45) * (values["hair.loss.pattern"] === "Norwood 1" ? 0 : 1),
  };
}

/**
 * Resolve a person.
 * @param {object} req
 *   id        the person key (address-derived for extras, the world's id for named people): part of every draw
 *   seed      integer
 *   kind      "human" in M1
 *   setting   setting id (stored now; setting priors come with M3)
 *   said      a description in words, or { constraints, garments } already parsed (construct's descriptors)
 *   override  true only for named people: lets a scope go past the plausible clamp (Hagrid's height, Rapunzel's hair)
 * @returns { ok, recipe, values, derived, words?, gaps, defaulted } or { ok: false, refused: [{ trait, words, reason }] }
 */
export function resolve(req) {
  const { id = "", seed = 0, kind = "human", setting = null, override = false } = req;
  const said = req.said ?? "";
  const parsed = typeof said === "string" ? parse(said) : { constraints: said.constraints || [], garments: said.garments || [], gaps: said.gaps || [] };

  // Group and intersect constraints per trait; contradictions are refused with a reason.
  const byTrait = new Map();
  for (const c of parsed.constraints) {
    if (!TRAIT[c.trait] && !["age", "sex", "body.height"].includes(c.trait)) return { ok: false, refused: [{ trait: c.trait, words: [c.word], reason: `no trait named ${c.trait}` }] };
    if (!byTrait.has(c.trait)) byTrait.set(c.trait, []);
    byTrait.get(c.trait).push(c);
  }
  const scopes = {}, refused = [];
  for (const [trait, list] of byTrait) {
    const s = intersect(list);
    if (s.refused) refused.push({ trait, words: s.refused, reason: `"${s.refused.join('" and "')}" contradict each other` });
    else scopes[trait] = s;
  }
  if (refused.length) return { ok: false, refused };

  if (kind !== "human") return { ok: false, refused: [{ trait: "kind", words: [kind], reason: `no kind pack for ${kind} yet (kind packs are M6)` }] };

  const key = String(id);
  const values = { kind };
  values.sex = sampleCat({ female: 0.5, male: 0.5, intersex: 0 }, scopes.sex?.in || null, uniform(seed, key, "sex"));
  values.age = sampleAge(scopes.age, seed, key, override);
  if (Number.isNaN(values.age)) return { ok: false, refused: [{ trait: "age", words: scopes.age.words, reason: `"${scopes.age.words.join('", "')}" is past a human lifespan; only a named person may go past it` }] };
  const ctx = { kind, sex: values.sex, age: values.age, setting };
  // Height said in units ("six feet tall") scopes stature, once sex and age fix the growth curve.
  if (scopes["body.height"]) {
    const { mean, sd } = statureCurve(values.sex, values.age), h = scopes["body.height"];
    const z = [(h.v[0] - mean) / sd, (h.v[1] - mean) / sd];
    const prev = scopes["body.stature"];
    const merged = intersect([...(prev ? [{ q: prev.q, v: prev.v, word: prev.words.join(", ") }] : []), { v: z, word: h.words.join(", ") }]);
    if (merged.refused) return { ok: false, refused: [{ trait: "body.stature", words: merged.refused, reason: `"${merged.refused.join('" and "')}" contradict each other` }] };
    scopes["body.stature"] = merged;
    delete scopes["body.height"];
  }

  // Albinism sets skin, hair and iris pigment near zero (schema note on skin.albinism), unless those were said.
  const ALBINO = { "skin.melanin": [0, 0.03], "hair.eumelanin": [0, 0.03], "hair.pheomelanin": [0, 0.08], "iris.melanin": [0, 0.04] };
  const albino = scopes["skin.albinism"]?.set === true || (scopes["skin.albinism"]?.in || []).includes(true)
    || (!scopes["skin.albinism"] && uniform(seed, key, "skin.albinism") < (priorFor(TRAIT["skin.albinism"], ctx)[0].p ?? 0));
  if (albino) for (const [t, v] of Object.entries(ALBINO)) if (!scopes[t]) scopes[t] = { q: [0, 1], v, in: null, words: ["albinism"] };

  const defaulted = [];
  for (const t of TRAITS) {
    if (ENVELOPE.includes(t.id)) continue;
    const [prior, explicit] = priorFor(t, ctx);
    const scope = scopes[t.id];
    // z traits are by definition N(0, 1) about their prior, and state starts at none: only other fallbacks are guesses
    if (!explicit && !scope && !["none", "state"].includes(prior.dist) && !["z", "pct"].includes(t.type)) defaulted.push(t.id);
    const u0 = uniform(seed, key, t.id);
    if (scope && scope.set !== undefined) { values[t.id] = scope.set; continue; }
    if (scope && scope.add) { values[t.id] = scope.add; continue; }
    switch (prior.dist) {
      case "normal": {
        const r = sampleNormal(prior, scope, u0, override);
        if (r.clash) { refused.push({ trait: t.id, words: scope.words, reason: `"${scope.words.join('" and "')}" don't fit together for a ${Math.floor(ctx.age)}-year-old ${ctx.sex}` }); break; }
        if (r.beyond) { refused.push({ trait: t.id, words: scope.words, reason: `"${scope.words.join('", "')}" is beyond what is plausible for ${t.id}; only a named person may go past it` }); break; }
        values[t.id] = r.value;
        break;
      }
      case "cat": values[t.id] = sampleCat(prior.weights, scope?.in || null, u0); break;
      case "tick": values[t.id] = scope?.in ? scope.in[0] : u0 < prior.p; break;
      case "fixed": case "state":
        if (scope?.in) values[t.id] = sampleCat(Object.fromEntries(scope.in.map(k => [k, 1])), null, u0);
        else if (scope && scope.v[0] > -Infinity) values[t.id] = scope.v[0] + (Math.min(scope.v[1], t.type === "amount" ? 1 : scope.v[1]) - scope.v[0]) * u0;
        else values[t.id] = prior.value;
        break;
      case "derived": // age-driven: derived at read time, unless the story states it (then the statement is canon)
        if (scope && scope.v[0] > -Infinity) values[t.id] = scope.v[0] + (Math.min(scope.v[1], t.type === "amount" ? 1 : scope.v[1]) - scope.v[0]) * u0;
        else if (scope) refused.push({ trait: t.id, words: scope.words, reason: `${t.id} is derived from age; say it as a value` });
        break;
      case "none": default:
        if (scope) refused.push({ trait: t.id, words: scope.words, reason: `${t.id} has no sampler yet; set it exactly` });
        break;
    }
  }
  if (refused.length) return { ok: false, refused };

  const recipe = {
    v: 0, generator: VERSION, id: key, seed, kind, setting,
    said: typeof said === "string" ? said : parsed,
    garments: parsed.garments, other: parsed.gaps, override: override || undefined,
  };
  const derived = derive(values, values.age);
  for (const k of Object.keys(derived)) if (k in values) derived[k] = values[k]; // stated beats derived
  return { ok: true, recipe, values, derived, garments: parsed.garments, gaps: parsed.gaps, defaulted };
}

// Where a value sits in its prior, as a quantile (for describe() and for checking fit).
export function quantileOf(traitId, value, ctx) {
  const t = TRAIT[traitId];
  const [prior] = priorFor(t, ctx);
  if (prior.dist !== "normal" || prior.sd === 0) return null;
  return dcdf((value - prior.mean) / prior.sd);
}

// Does a resolved person satisfy a constraint? Used by the tests and by any caller checking a stored person.
export function satisfies(values, c) {
  const x = values[c.trait];
  const eps = 1e-9;
  if (x === undefined) return false;
  if (c.in && !c.in.includes(x)) return false;
  if (c.v && (x < c.v[0] - eps || x > c.v[1] + eps)) return false;
  if (c.q) {
    const q = quantileOf(c.trait, x, { kind: values.kind, sex: values.sex, age: values.age });
    if (q !== null && (q < c.q[0] - 1e-6 || q > c.q[1] + 1e-6)) return false;
  }
  return true;
}

export { Q85 };
