// Who wears what, and what a wearer carries (R5): the people layer's side of the outfit packages (garments/outfit.js).
//
// outfitFor(rec) is a PLACEHOLDER (it answers an outfit package; population.js turns that into a list of garments, garments/worn.js garmentsOf, and dresses it as any other) until M3's sampler (the wardrobe by setting, class and era, answering pattern-buffer's attire request): women and girls from 1.5 years whose
// hash puts them in the gentry, about 1 in 5, wear the gentlewoman and the next 3 in 5 the workwoman, and men and boys from 6 (a boy is breeched at 6 by default) the gentleman (1 in 5) or the workman (3 in 5); the rest
// keep the base layer only (no outfit). It is a hash of the person's id (never a random stream, so
// the same person is dressed the same whatever the order), kept apart from the tier rank (which scales how far away someone is drawn near), so the gentry is not also the
// people always seen close. Delete this function when the sampler lands; nothing else here assumes it.
import { GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN, cutFor, look, keepOutFor } from "./garments/outfit.js";
import { skirtSpecAt } from "./garments/tables.js";
import { skirtFootprint } from "./garments/skirt.js";
import { uniform } from "../traits/stream.js";
import { resolveWorn, resolveOutfit, garmentsOf, baseOnly } from "./garments/worn.js";
import { GENTRY_SHARE, WORKING_SHARE, PACKAGE_KINDS } from "./garments/kinds.js";

export { GENTRY_SHARE, WORKING_SHARE };

/** PLACEHOLDER (until M3's sampler): the outfit a person wears, or null for the base layer only. One hash of the person's id (the same number the gentry share always read), by sex: the lowest 0.2 of it
 *  are gentlefolk (the gentlewoman, the gentleman), the next 0.6 working folk (the workwoman, the workman), and the top 0.2 keep the base layer only for now. */
export function outfitFor(id, values) {
  if (typeof values.age !== "number") return null;
  const female = values.sex === "female", male = values.sex === "male";
  if (!female && !male) return null;
  const gentle = female ? GENTLEWOMAN : GENTLEMAN, working = female ? WORKWOMAN : WORKMAN;
  if (values.age < gentle.ages.from) return null;
  const u = uniform(0, id, "gentry");
  return u < GENTRY_SHARE ? gentle : u < GENTRY_SHARE + WORKING_SHARE ? working : null;
}

/** What a dressed person carries: { outfit, cut, spec (their skirt's numbers from the tables; specs: one for each tube of the skirt, the gentleman's breeches two), look (their colours), footprint (the radius their skirt asks of the floor), keepout
 *  (their arms' keep-out for their walk), wear (what is shown: the state the old `wear("bodice" | "skirt", on)` changes, read each frame, never rebaked) },
 *  from a resolved set of garments (garments/worn.js resolveWorn or resolveOutfit: all this reads of it is outfit, look and mask). `J`: their rig's rest joints (the walker's). */
/** What is shown of what is worn, per garment, as flags the draw reads each frame (never rebaked): bodice (the torso garment) and skirt (the legs'), and where the package has them neck (the falling band or neckerchief), apron and hose (stockings). */
function wearOf(outfit, res) {
  const P = PACKAGE_KINDS[outfit.id], m = res.mask, w = { bodice: !!(m & 1), skirt: !!(m & 2) };
  if (P.neck) w.neck = !(m & 4);
  if (P.over) w.apron = !(m & 8);
  if (P.hose) w.hose = res.hose !== false;
  return w;
}
export function dressingOfWorn(res, params, J) {
  const outfit = res.outfit, cut = cutFor(params.age, outfit), tubes = outfit.loose.tubes ?? 1, specs = tubes === 2 ? [1, -1].map((leg) => skirtSpecAt(params, cut.skirt, leg)) : [skirtSpecAt(params, cut.skirt)];      // the gentleman's breeches are two tubes, one a leg
  return { outfit, cut, spec: specs[0], specs, look: res.look, footprint: Math.max(...specs.map(skirtFootprint)), keepout: keepOutFor(tubes === 2 ? specs : specs[0], J, params.height, outfit), wear: wearOf(outfit, res) };
}

/** A person's garments as a dressing: { dressing (null for the base layer only: nothing is built for this body), attire (the report, always) }. `body`: { age, sex }; `opts.prefer`: the package the crowd's rule gave them. */
export function dressGarments(id, garments, params, J, body, opts = {}) {
  const res = resolveWorn(garments, body, { id, ...opts });
  return { dressing: res.outfit ? dressingOfWorn(res, params, J) : null, attire: res };
}

/** The old outfit-package path, a thin wrapper: an outfit (and colours, laid over the hash's) is a list of garments (garmentsOf), worn whole (resolveOutfit: what resolving that list gives). `colours`: colours chosen elsewhere (from their words, dress-words.js), laid over the hash's. */
export function dressingFor(id, outfit, params, J, colours) {
  const lk = { ...look(uniform(0, id, "silk"), outfit, uniform(0, id, "hose")), ...colours };
  return dressingOfWorn(resolveOutfit(outfit, lk, id, params.age), params, J);
}

/** The bits of what is worn, as draw.js's class key reads them: bit 0 the bodice (the gentleman's doublet, band and shirt), bit 1 the skirt (his breeches), bit 2 (4) the neckwear off (the falling band, the neckerchief), bit 3 (8) the apron off.
 *  A whole outfit is 3, as it always was. (Neckwear is the bodice's and the apron the skirt's, so they are not asked once those are off; the stockings are the legs' paint and a colour, not a bit.) */
export function wearMask(d) {
  const w = d.wear;
  return (w.bodice ? 1 : 0) | (w.skirt ? 2 : 0) | (w.bodice && w.neck === false ? 4 : 0) | (w.skirt && w.apron === false ? 8 : 0);
}

/** The crowd's placeholder rule as a list of garments (pattern-buffer's worn objects): what outfitFor dresses them in, as garmentsOf lists it; null for the base layer only. */
export function garmentsFor(id, values) { const o = outfitFor(id, values); return o ? garmentsOf(o, undefined, id, values.age) : null; }
