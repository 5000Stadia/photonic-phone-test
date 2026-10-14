// Continuity text, independent of rendering and locale. Strings are JSON-quoted
// (including embedded newlines); collections use UTF-16 order, never localeCompare.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const decimal = (n) => {
  const s = n.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
};
const vector = (v) => `[${v.map(decimal).join(",")}]`;
const atom = (v) => typeof v === "string" && /^[a-zA-Z_#][a-zA-Z0-9_#-]*$/.test(v) ? v : value(v);

// Parsed recipes and garment aspects may also contain numeric or object values.
// Canonicalize these too, so insertion order and unrounded floats cannot leak in.
function value(v) {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : decimal(v);
  if (Array.isArray(v)) return `[${v.map(value).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${value(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

function destination(target) {
  if (Array.isArray(target)) return vector(target);
  if (typeof target === "string") return value(target);
  return value({ pos: target?.pos, floor: target?.floor, room: target?.room });
}

/** One line per id, no trailing newline; an empty population is "".
 * id; recipe; seed; room; position (metres); facing (radians); activity
 * [destination=... when walking]; garments; hair style and linear RGB.
 * All fractional numbers have two decimal places; negative zero is normalized.
 */
export function dumpPeople(records) {
  return [...records].sort((a, b) => compare(a.id, b.id)).map(rec => {
    const garments = rec.garments().map(g => `${atom(g.kind)}:${Object.keys(g.aspects).sort().map(k => `${atom(k)}=${atom(g.aspects[k])}`).join(",")}`).sort(compare);
    const activity = rec.doing?.verb === "goTo" ? `walking destination=${destination(rec.doing.target)}`
      : rec.doing?.verb === "sit" ? "sitting" : "standing";
    return `${value(rec.id)}; recipe=${value(rec.res.recipe.said)}; seed=${value(rec.seed)}; room=${value(rec.room)}; position=${vector(rec.pos)}; facing=${decimal(rec.heading)}; ${activity}; garments=[${garments.join("|")}]; hair=${value(rec.hair.style)}:${vector(rec.hair.colour)}`;
  }).join("\n");
}
