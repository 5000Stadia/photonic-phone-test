// Photonic as pattern-buffer's resolver for people (R3; RESOLVE-REQUEST-V1, RESOLVE-UNMARKED-V1). Pure JS with no
// node APIs: the host runs it in a node child process (tools/traits/serve.mjs, through the Python route in
// adapters/patternbuffer/), and holo-emitter's page imports the same module as a mirror and offline fallback, so both
// give the same words and recipe bit for bit (holo-emitter, m1b5732).
//
// answer(request) takes a ResolveRequest as JSON ({ world_id, entity, aspect, kind, inherited: [[holder, attribute,
// value], ...], declared: [...], as_of, frame, policy }) and returns { items: [{ value, detail }] }, the reply
// pattern-buffer's resolve schema expects.
//
// One person, every aspect: pattern-buffer writes rows only for the aspect asked. So every aspect is answered from
// the same person: the `appearance` recipe if the world already holds one (rebuilt exactly), else the person resolved
// from the seed and the canon said about them. Hosts resolve `appearance` first when a person is promoted, so later
// canon can't move a person already drawn.

import { resolve } from "./resolve.js";
import { describe } from "./describe.js";
import { seedOf } from "./stream.js";
import { ASPECT } from "./aspects.js";
import { VERSION } from "./version.js";

// Canon attributes read as words about the person (stated by the story or construct).
const SAID_ATTRIBUTES = new Set(["description", "looks", "appearance_words", "sex", "gender", "age", ...Object.keys(ASPECT).filter(a => a !== "appearance" && a !== "wears")]);

function saidFrom(request) {
  const parts = [];
  let age = null, sex = null, setting = null, recipe = null;
  // inherited: standing facts of the person and their containers; current (RESOLVE-REQUEST-V1.1): the person's own
  // STATE facts at the placeholder's time, such as age and the story's current description
  const facts = [...(request.inherited || []), ...(request.current || []).map(([attribute, value]) => [request.entity, attribute, value])];
  let born = null;
  for (const [holder, attribute, value] of facts) {
    if (attribute === "setting" || attribute === "era") { setting ??= String(value); continue; }
    if (holder !== request.entity) continue;
    if (attribute === "appearance" && value && typeof value === "object") { recipe = value; continue; }
    if (attribute === "age" && typeof value === "number") { age = value; continue; }
    if (attribute === "born" && typeof value === "number") { born = value; continue; }
    if ((attribute === "sex" || attribute === "gender") && typeof value === "string") { sex = value.toLowerCase(); continue; }
    if (SAID_ATTRIBUTES.has(attribute) && typeof value === "string") parts.push(attribute === "description" || attribute === "looks" ? value : `${value} ${attribute === "build" || attribute === "height" ? "" : attribute}`.trim());
  }
  for (const d of request.declared || []) if (typeof d === "string") parts.push(d);
  if (sex === "male" || sex === "man") parts.unshift("man"); else if (sex === "female" || sex === "woman") parts.unshift("woman");
  // a timeless birth date ages people across time skips by itself (world time in years)
  if (age === null && born !== null && typeof request.as_of === "number") age = request.as_of - born;
  return { said: parts.join(", "), setting, recipe, age };
}

// Resolve the person a request is about. Returns resolve()'s result plus the recipe to store.
// Age is not part of who someone is: the recipe keeps the words without it, plus the age at its as_of, so a rebuild at
// a later time ages the person (identity traits are stored about the age-conditioned prior, so they carry over).
const withAge = (said, age) => (age === null || age === undefined ? said : [said, `${Math.max(0, Math.floor(age))} years old`].filter(Boolean).join(", "));

export function personFor(request) {
  const { said, setting, recipe, age } = saidFrom(request);
  if (recipe) {
    // Rebuild exactly, at the age the story says now, else the stored age moved on by the time since.
    const elapsed = typeof request.as_of === "number" && typeof recipe.as_of === "number" ? request.as_of - recipe.as_of : 0;
    const ageNow = age ?? (typeof recipe.age === "number" ? recipe.age + elapsed : null);
    const r = resolve({ id: recipe.id, seed: recipe.seed, kind: recipe.kind, setting: recipe.setting, said: withAge(recipe.said, ageNow), override: recipe.override });
    return { ...r, stale: recipe.generator !== VERSION, recipe };
  }
  const seed = seedOf(`${request.world_id}\u0000${request.entity}`);
  const r = resolve({ id: request.entity, seed, kind: "human", setting, said: withAge(said, age), override: false });
  if (r.ok) Object.assign(r.recipe, { said, age: r.values.age, as_of: request.as_of ?? null });
  return r;
}

export function answer(request) {
  const aspect = request.aspect;
  if (!ASPECT[aspect]) return { items: [], refused: `Photonic does not answer the aspect "${aspect}"` };
  const r = personFor(request);
  if (!r.ok) return { items: [], refused: r.refused.map(x => x.reason).join("; ") };
  if (aspect === "appearance") return { items: [{ value: r.recipe, detail: `${VERSION}${r.gaps.length ? `; not yet expressible: ${r.gaps.join(", ")}` : ""}` }] };
  const words = describe(r, { features: 12 }).aspects.filter(a => a.aspect === aspect || a.aspect.startsWith(aspect + ".")).map(a => a.words);
  return { items: [{ value: words.length ? words.join(", ") : "unremarkable", detail: VERSION }] };
}
