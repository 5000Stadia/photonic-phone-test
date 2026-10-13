// Who wears what, and what a wearer carries (R5): the people layer's side of the outfit packages (garments/outfit.js).
//
// outfitFor(rec) is a PLACEHOLDER until M3's sampler (the wardrobe by setting, class and era, answering pattern-buffer's attire request): women and girls from 1.5 years whose
// hash puts them in the gentry, about 1 in 5, wear the gentlewoman; everyone else keeps the base layer only (no outfit). It is a hash of the person's id (never a random stream, so
// the same person is dressed the same whatever the order), kept apart from the tier rank (which scales how far away someone is drawn near), so the gentry is not also the
// people always seen close. Delete this function when the sampler lands; nothing else here assumes it.
import { GENTLEWOMAN, cutFor, look, keepOutFor } from "./garments/outfit.js";
import { skirtSpecAt } from "./garments/tables.js";
import { skirtFootprint } from "./garments/skirt.js";
import { uniform } from "../traits/stream.js";

export const GENTRY_SHARE = 0.2;

/** PLACEHOLDER (until M3's sampler): the outfit a person wears, or null for the base layer only. */
export function outfitFor(id, values) {
  if (values.sex !== "female" || !(typeof values.age === "number" && values.age >= GENTLEWOMAN.ages.from)) return null;
  return uniform(0, id, "gentry") < GENTRY_SHARE ? GENTLEWOMAN : null;
}

/** What a dressed person carries: { outfit, cut, spec (their skirt's numbers from the tables), look (their colours, from a hash), footprint (the radius their skirt asks of the floor), keepout
 *  (their arms' keep-out for their walk), wear (what is shown: the state a story changes, read each frame, never rebaked) }. `J`: their rig's rest joints (the walker's). */
export function dressingFor(id, outfit, params, J) {
  const cut = cutFor(params.age, outfit), spec = skirtSpecAt(params, cut.skirt);
  return { outfit, cut, spec, look: look(uniform(0, id, "silk"), outfit), footprint: skirtFootprint(spec), keepout: keepOutFor(spec, J, params.height), wear: { bodice: true, skirt: true } };
}

/** The bits of what is worn, as draw.js's class key reads them: bit 0 the bodice, bit 1 the skirt. */
export function wearMask(d) { return (d.wear.bodice ? 1 : 0) | (d.wear.skirt ? 2 : 0); }
