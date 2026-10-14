// The attire sampler (R5, "Clothes as objects"; pattern-buffer's WORN-OBJECTS-V1): what a person of that rank, age and sex in 1660 London wears, minus what they already have.
//
// pattern-buffer asks for the `attire` aspect whenever a person's clothes are not yet resolved, with `existing`: what is already worn_by them, as (id, kind or null, names). We answer the COMPLEMENT, as items
// { kind, value (the garment's name), aspects: { colour, material, condition, pattern } }, and pattern-buffer mints each as an entity worn_by the person. So a person the story gave only a hat is
// still dressed, and a red cloak is kept as it is. Pure and light (no geometry), so pattern-buffer's mirror (src/traits/pb.js) can run it: the same garments in the browser and in the world.
//
//   rank      the person's own words ("a lady", "a washerwoman"), else the seed's (the same hash outfitFor and outfitFromWords read). Gentle or working.
//   kit       the outfit package of the rank and the body (kinds.js PACKAGE_KINDS): the gentlewoman's bodice and roll skirt; the working woman's waistcoat, plain skirt, apron, neckerchief and stockings; the
//             gentleman's doublet, petticoat breeches, falling band and stockings; the working man's doublet, closed breeches, band and stockings. A child still in skirts (a boy under 6, a girl under 13 in the
//             gentlewoman's) wears a plain skirt. Under 1.5 years: the shift only (the long gown is not built). Everyone has a shift.
//   existing  what they already wear takes its slot (kinds.js SLOTS) and is left alone; the kit's other garments fill the rest, from the package of what is worn if it fixes one (a man in a bodice
//             is given a skirt), so the set can be drawn. A kind we have no template for (a cloak, a hat) or no kind we know takes no slot: it is reported as not drawn, and the rest is dressed.
//   colour    from the words ("in a red dress": the torso and legs, "a black doublet": the torso); else the package's own palette by the seed's hash, the same silk the crowd's rule would pick.
//   deterministic by the person's id and seed (integer hashes, never a shared stream).
import { uniform } from "../traits/stream.js";
import { tokens, rankOf, colourRequests } from "./words.js";
import { KINDS, KIND_RE, FUTURE, PACKAGE_KINDS, SILKS, HOSE, GENTRY_SHARE, WORKING_SHARE, NOUN_KIND } from "./garments/kinds.js";

const TORSO_WORDS = new Set(["doublet", "bodice", "jerkin", "waistcoat", "stays"]);
const POOR = new Set(["poor", "ragged", "beggar", "urchin", "destitute", "threadbare", "shabby"]);
const FINE = new Set(["rich", "wealthy", "fine", "fashionable", "elegant", "new", "prosperous", "affluent"]);

/** An `existing` entry as { id, kind, name } : pattern-buffer's tuple (id, kind or null, sorted names), or an object { id, kind, name | names }. A kind we know is kept; one we do not, or none, is read off the name
 *  ("a red cloak" is a cloak) when a garment noun is in it. */
function normExisting(e, i) {
  const [id, kind0, names] = Array.isArray(e) ? e : [e?.id, e?.kind, e?.names ?? e?.name];
  const name = Array.isArray(names) ? names.join(", ") : String(names ?? "");
  let kind = typeof kind0 === "string" && kind0 ? kind0 : null, inferred = false;
  if (!kind) { const noun = tokens(name).reverse().find((t) => NOUN_KIND[t]); if (noun) { kind = NOUN_KIND[noun]; inferred = true; } }
  return { id: id ?? `existing${i}`, kind, name, inferred };
}

/** The attire of a person, with its report. `person`: { id, seed?, values: { sex, age }, words? }; `setting`: the world's or place's setting (1660 London is the one we know); `existing`: what they wear already.
 *  Returns { items, rank, rankFrom, rankWords, package, have: [{ id, kind, name, slot }], notDrawn: [{ id, kind, name, reason }], notes }. */
export function attireReport(person, setting = null, existing = []) {
  const id = String(person?.id ?? ""), seed = person?.seed ?? 0, values = person?.values ?? { sex: person?.sex, age: person?.age };
  const words = person?.words ?? person?.said ?? "", toks = tokens(words), notes = [], notDrawn = [], have = [];
  const age = typeof values.age === "number" ? values.age : 30, male = values.sex === "male";
  if (values.sex !== "male" && values.sex !== "female") notes.push(`sex "${values.sex}": dressed by the cut for a woman`);
  if (setting && !/1660|london|restoration|stuart|carolean/i.test(String(setting))) notes.push(`setting "${setting}": the sampler knows 1660 London, and dresses them as it would there`);
  // rank
  const rk = rankOf(words);
  let rank = rk.rank, rankFrom = "words";
  if (!rank) { rank = uniform(seed, id, "gentry") < GENTRY_SHARE / (GENTRY_SHARE + WORKING_SHARE) ? "gentle" : "working"; rankFrom = "seed"; }
  // what is already worn
  const occupied = new Set(), kinds = new Set();
  (existing ?? []).map(normExisting).forEach((e) => {
    if (e.kind && KINDS[e.kind]) { have.push({ ...e, slot: KINDS[e.kind].slot }); occupied.add(KINDS[e.kind].slot); kinds.add(e.kind); }
    else notDrawn.push({ id: e.id, kind: e.kind, name: e.name, reason: e.kind && FUTURE.has(e.kind) ? `no ${e.kind} template is built yet: it stays as it is, and is not drawn`
      : e.kind && !KIND_RE.test(e.kind) ? "not a kind name: not drawn" : `unknown kind${e.kind ? ` "${e.kind}"` : ""}: not drawn` });
  });
  // the package: from what is worn if that fixes one, else from the rank, the sex and the age (a boy in skirts takes the girl's package of his rank)
  const worn = have.find((h) => h.slot === "torso") ?? have.find((h) => h.slot === "legs");
  const byRank = (female) => Object.keys(PACKAGE_KINDS).find((p) => PACKAGE_KINDS[p].female === female && PACKAGE_KINDS[p].gentle === (rank === "gentle"));
  let pkg = worn ? KINDS[worn.kind].packages[0] : byRank(!male || age < PACKAGE_KINDS.gentleman.from);
  if (pkg && age < PACKAGE_KINDS[pkg].from) pkg = byRank(true);          // (a doublet on a child not yet breeched: the rest is a child's in skirts; the doublet is drawn as the nearest, worn.js)
  const items = [];
  if (age < 1.5) { pkg = null; notes.push("under 1.5 years: the shift only (the long gown is not built)"); }
  const P = pkg && PACKAGE_KINDS[pkg], child = P && age < P.adultAt;
  // colours: the words, for the torso and the legs
  const reqs = colourRequests(toks).filter((r) => r.part !== "undyed"), pick = (part) => reqs.find((r) => r.part === part) ?? reqs.find((r) => r.part === "all") ?? null;
  for (const r of colourRequests(toks).filter((r) => r.part === "undyed")) notes.push(`${r.word}: ${r.garment} is undyed linen`);
  if (male && toks.some((t) => ["dress", "gown", "skirt", "petticoat", "bodice", "stays", "apron"].includes(t)) && pkg && !worn) notes.push("a woman's garment said of a man: dressed as a man, as his body is");
  if (!male && toks.some((t) => ["doublet", "breeches"].includes(t)) && pkg && !worn) notes.push("a man's garment said of a woman: dressed as a woman, as her body is");
  const silk = pkg && SILKS[pkg] ? SILKS[pkg][Math.min(SILKS[pkg].length - 1, Math.floor(uniform(seed, id, "silk") * SILKS[pkg].length))] : null;       // (the crowd's hash, the person's seed 0: the same silk as outfitFor's look)
  const hose = pkg && HOSE[pkg] ? HOSE[pkg][Math.min(HOSE[pkg].length - 1, Math.floor(uniform(seed, id, "hose") * HOSE[pkg].length))] : null;
  const poor = toks.some((t) => POOR.has(t)), fine = toks.some((t) => FINE.has(t));
  const condition = (kind) => {
    const u = uniform(seed, id, "condition:" + kind);
    if (poor) return u < 0.5 ? "ragged" : "patched";
    if (rank === "gentle") return fine || u < 0.55 ? "new" : u < 0.93 ? "good" : "worn";
    return u < 0.25 ? "good" : u < 0.65 ? "worn" : u < 0.95 ? "patched" : "ragged";
  };
  const pattern = (kind) => {
    const u = uniform(seed, id, "pattern:" + kind), k = KINDS[kind];
    if (rank === "gentle" && k.slot === "torso") return u < 0.25 ? "embroidered" : "plain";
    if (rank === "working" && k.slot === "legs") return u < 0.15 ? "striped" : "plain";
    return "plain";
  };
  const make = (kind) => {
    const k = KINDS[kind], linen = ["shift", "apron", "neckerchief", "falling_band"].includes(kind);
    let colour, material;
    if (linen) { colour = "white"; material = kind === "falling_band" && rank === "gentle" && uniform(seed, id, "lace") < 0.5 ? "lace" : "linen"; }
    else if (kind === "stockings") { colour = hose ?? "cream"; material = rank === "gentle" ? "silk" : "wool"; }
    else {
      const part = k.slot === "torso" ? "upper" : "lower", [c, m] = silk ? silk[part] : ["grey", "wool"], r = pick(part);
      colour = r ? r.colour : c; material = m;
    }
    const cond = condition(kind), lead = cond === "new" || cond === "good" ? "" : cond + " ", what = material === "linen" && linen ? "linen" : `${colour} ${material}`;
    items.push({ kind, value: `${lead}${what} ${k.noun}`, aspects: { colour, material, condition: cond, pattern: pattern(kind) } });
  };
  if (!kinds.has("shift")) make("shift");
  if (P) {
    const legs = child && pkg === "gentlewoman" ? "plain_skirt" : P.legs;
    for (const [slot, kind] of [["torso", P.torso], ["legs", legs], ["neck", P.neck], ["over", P.over], ["hose", P.hose]]) {
      if (!kind || occupied.has(slot)) continue;
      if (slot === "over" && !(occupied.has("legs") || items.some((i) => KINDS[i.kind].slot === "legs"))) continue;
      make(kind);
    }
  }
  return { items, rank, rankFrom, rankWords: rk.words, package: pkg, have: have.map(({ id, kind, name, slot }) => ({ id, kind, name, slot })), notDrawn, notes };
}

/** The attire complement as pattern-buffer's items: [{ kind, value, aspects: { colour, material, condition, pattern } }]. `person`: { id, seed?, values: { sex, age }, words? }; `setting`: 1660 London (or null: the
 *  world's default); `existing`: what they already wear, pattern-buffer's tuples (id, kind or null, names) or { id, kind, name } objects. The garments they already have are left out, and the rest of the kit is filled in. */
export function attireFor(person, setting = null, existing = []) { return attireReport(person, setting, existing).items; }
