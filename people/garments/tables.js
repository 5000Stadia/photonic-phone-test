// The skirt's spec from the tables (R5; tools/people/skirt-table.mjs): a person's 81 skirt numbers from their four sliders and their height, a few microseconds, the same at
// every tier (skirt.js says why). One table a cut. Loaded once, with a top-level await like the far pack (bodies.js).
import { loadTable } from "../../spikes/makehuman/table.js";
import { unpackSpec, SPEC_CHANNELS } from "./skirt.js";

const TABLES = { gentlewoman: await loadTable("skirt-table-gentlewoman"), girl: await loadTable("skirt-table-girl"), small: await loadTable("skirt-table-small"), breeches: await loadTable("skirt-table-breeches").catch(() => null) };      // (null until tools/people/skirt-table.mjs --only breeches has written it)
const scratch = new Float64Array(SPEC_CHANNELS);

/** The skirt spec of a person (their body params: sex, age, muscle, build, height) for a skirt cut ("gentlewoman", "girl", "small"), or the tube of one leg (1 left, -1 right) of the divided "breeches". */
export function skirtSpecAt(params, cutName = "gentlewoman", leg = 0) {
  if (!TABLES[cutName]) throw new Error(`tables: no table for the ${cutName} skirt (run tools/people/skirt-table.mjs)`);
  return unpackSpec(TABLES[cutName].at(params.sex, params.age, params.muscle, params.build, scratch), params.height, cutName, leg);
}
export { TABLES as SKIRT_TABLES };
