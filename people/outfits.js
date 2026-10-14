// Who wears what, and what a wearer carries (R5): the people layer's side of the outfit packages (garments/outfit.js).
//
// outfitFor(rec) is a PLACEHOLDER until M3's sampler (the wardrobe by setting, class and era, answering pattern-buffer's attire request): women and girls from 1.5 years whose
// hash puts them in the gentry, about 1 in 5, wear the gentlewoman and the next 3 in 5 the workwoman, and men and boys from 6 (a boy is breeched at 6 by default) the gentleman (1 in 5) or the workman (3 in 5); the rest
// keep the base layer only (no outfit). It is a hash of the person's id (never a random stream, so
// the same person is dressed the same whatever the order), kept apart from the tier rank (which scales how far away someone is drawn near), so the gentry is not also the
// people always seen close. Delete this function when the sampler lands; nothing else here assumes it.
import { GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN, cutFor, look, keepOutFor } from "./garments/outfit.js";
import { skirtSpecAt } from "./garments/tables.js";
import { skirtFootprint } from "./garments/skirt.js";
import { uniform } from "../traits/stream.js";

export const GENTRY_SHARE = 0.2, WORKING_SHARE = 0.6;

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

/** What a dressed person carries: { outfit, cut, spec (their skirt's numbers from the tables; specs: one for each tube of the skirt, the gentleman's breeches two), look (their colours, from a hash), footprint (the radius their skirt asks of the floor), keepout
 *  (their arms' keep-out for their walk), wear (what is shown: the state a story changes, read each frame, never rebaked) }. `colours`: colours chosen elsewhere (from their words, dress-words.js), laid over the hash's. `J`: their rig's rest joints (the walker's). */
export function dressingFor(id, outfit, params, J, colours) {
  const cut = cutFor(params.age, outfit), tubes = outfit.loose.tubes ?? 1, specs = tubes === 2 ? [1, -1].map((leg) => skirtSpecAt(params, cut.skirt, leg)) : [skirtSpecAt(params, cut.skirt)];      // the gentleman's breeches are two tubes, one a leg
  return { outfit, cut, spec: specs[0], specs, look: { ...look(uniform(0, id, "silk"), outfit, uniform(0, id, "hose")), ...colours }, footprint: Math.max(...specs.map(skirtFootprint)), keepout: keepOutFor(tubes === 2 ? specs : specs[0], J, params.height, outfit), wear: { bodice: true, skirt: true } };
}

/** The bits of what is worn, as draw.js's class key reads them: bit 0 the bodice (the gentleman's doublet, band and shirt), bit 1 the skirt (his breeches). */
export function wearMask(d) { return (d.wear.bodice ? 1 : 0) | (d.wear.skirt ? 2 : 0); }
