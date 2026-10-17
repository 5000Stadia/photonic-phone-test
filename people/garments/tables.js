// The skirt's spec from the tables (R5; tools/people/skirt-table.mjs): a person's 81 skirt numbers from their four sliders and their height, a few microseconds, the same at
// every tier (skirt.js says why). One table a cut. Loaded once, with a top-level await like the far pack (bodies.js).
import { loadTable } from "../../spikes/makehuman/table.js";
import { unpackSpec, SPEC_CHANNELS, SKIRTS, skirtSpec } from "./skirt.js";
import { buildNear } from "../shape.js";

// (fetched together: the working dress's four more tables must not lengthen loading by a round trip each)
const NAMES = ["gentlewoman", "girl", "small", "breeches", "workwoman", "workgirl", "worksmall", "closed"], OPTIONAL = new Set(["breeches", "workwoman", "workgirl", "worksmall", "closed"]);
const LOADED = await Promise.all(NAMES.map((n) => loadTable("skirt-table-" + n).catch((e) => { if (OPTIONAL.has(n)) return null; throw e; })));
const TABLES = Object.fromEntries(NAMES.map((n, i) => [n, LOADED[i]]));      // (null until tools/people/skirt-table.mjs --only breeches has written it)
const scratch = new Float64Array(SPEC_CHANNELS);

/** The skirt spec of a person (their body params: sex, age, muscle, build, height) for a skirt cut ("gentlewoman", "girl", "small"), or the tube of one leg (1 left, -1 right) of the divided "breeches". */
// a cut with no table of its own (SKIRTS[cut].exact: the fitted breeches, tried on the hero's page first) is read from the wearer's own body: about 0.2 s, kept per body and cut
const EXACT = new Map();
export function skirtSpecAt(params, cutName = "gentlewoman", leg = 0) {
  if (!TABLES[cutName] && SKIRTS[cutName]?.exact) {
    const key = JSON.stringify([cutName, params.sex, params.age, params.muscle, params.build, params.height]);
    let e = EXACT.get(key); if (!e) { const near = buildNear(params); e = { near, specs: new Map() }; EXACT.set(key, e); if (EXACT.size > 8) EXACT.delete(EXACT.keys().next().value); }
    if (!e.specs.has(leg)) e.specs.set(leg, skirtSpec(e.near, cutName, leg));
    return e.specs.get(leg);
  }
  if (!TABLES[cutName]) throw new Error(`tables: no table for the ${cutName} skirt (run tools/people/skirt-table.mjs)`);
  return unpackSpec(TABLES[cutName].at(params.sex, params.age, params.muscle, params.build, scratch), params.height, cutName, leg);
}
export { TABLES as SKIRT_TABLES };
