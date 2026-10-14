// The garment templates, packed (R5; tools/people/garment-pack.mjs writes it): what a runtime needs of the six bodice templates (the full and the reduced cut of each of three
// cuts), so no phone builds one at first sight (a template takes about 0.4 s to cut and bind). Data: spikes/makehuman/data/garments-<outfit>.{json,bin.gz} (gentlewoman: six templates; gentleman: four).
//   header.templates[id]  id "full:adult", "reduced:girl", ...: { cutName, V, templateH, count (full only: the body vertices hidden), grids, arrays: { name: [type, byteOffset, length] } }
//   the blob              each array as written, 4-byte aligned: index u16, part u8, ring u8, edge u8, pos f32, bindIds u16, bindW f32, bindOff f32, bindDist f32, skinIndex u16, skinWeight f32,
//                         region u8 (full only: the hides' region id of each drawn body vertex)
// A packed template is the built one bit for bit, less what only the sweep reads (covers, lm, templateWearer), which it builds on demand the first time they are asked for.
// With the pack the runtime runs none of the template builder (it uses Math.sin and Math.cos, as the walker's gait does; the fitting at runtime is + - * / and sqrt only).
// No pack (a missing file): packed() answers null and the callers build.
import { gz, json } from "../../spikes/makehuman/load.js";
import { CUTS, reducedHides } from "./bodice.js";

const DATA = new URL("../../spikes/makehuman/data/", import.meta.url), NAMES = ["garments-gentlewoman", "garments-gentleman"];
const TYPES = { u8: Uint8Array, u16: Uint16Array, f32: Float32Array };

// one pack a family of outfits (the template ids are unique across them: "full:adult", "full:man"...): the headers and blobs of those that exist
const PACKS = [];
for (const name of NAMES) { try { PACKS.push({ name, header: await json(new URL(name + ".json", DATA)), blob: await gz(new URL(name + ".bin.gz", DATA)) }); } catch { /* no pack: the callers build */ } }
export const PACK = PACKS.find((p) => p.name === "garments-gentlewoman")?.header ?? null;
export const PACK_OF = (name) => PACKS.find((p) => p.name === name)?.header ?? null;

/** The arrays of a packed template as a flat object, or null. */
function arrays(entry, BLOB) {
  const o = {};
  for (const [name, [type, off, len]] of Object.entries(entry.arrays)) { const C = TYPES[type]; o[name] = new C(BLOB.slice(off, off + len * C.BYTES_PER_ELEMENT)); }
  return o;
}

/** The packed template `id` ("full:adult", "reduced:small"...) as a template object (bodice.js bodiceTemplate's, or reduced.js's), or null without a pack. `lazy`: { covers, lm,
 *  templateWearer } are read from `lazy()` (the built template) the first time they are asked for. */
export function packed(id, lazy = null) {
  const pk = PACKS.find((p) => p.header.templates?.[id]), e = pk?.header.templates[id]; if (!e) return null;
  const a = arrays(e, pk.blob), cutName = e.cutName, full = id.startsWith("full:");
  const t = {
    cut: CUTS[cutName], cutName, V: e.V, grids: e.grids, index: a.index, part: a.part, ring: a.ring, edge: a.edge, pos: a.pos, templateH: e.templateH, ref: e.ref, fromPack: true,
    binding: { n: e.V, ids: a.bindIds, w: a.bindW, off: a.bindOff, dist: a.bindDist, smooth: true },
    skin: { skinIndex: a.skinIndex, skinWeight: a.skinWeight },
  };
  if (full) t.hides = { region: a.region, count: e.count, from: 0, reduced(RED) { return reducedHides(a.region, RED); } };
  if (lazy) { let built = null; for (const k of ["covers", "lm", "templateWearer"]) Object.defineProperty(t, k, { get() { return (built ??= lazy())[k]; }, enumerable: false, configurable: true }); }
  return t;
}

/** Serialises templates { id: template } (built ones) into { header, blob } for the pack file (garment-pack.mjs). */
export function serialise(templates) {
  const header = { source: "tools/people/garment-pack.mjs", version: 1, templates: {} }, parts = []; let at = 0;
  const put = (arr, type) => { const pad = (4 - (at % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); at += pad; } const off = at, bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); parts.push(bytes); at += bytes.length; return [type, off, arr.length]; };
  for (const [id, t] of Object.entries(templates)) {
    const e = { cutName: t.cutName, V: t.V, templateH: t.templateH, ref: t.ref, grids: t.grids, arrays: {} };
    e.arrays.index = put(Uint16Array.from(t.index), "u16"); e.arrays.part = put(Uint8Array.from(t.part), "u8"); e.arrays.ring = put(Uint8Array.from(t.ring), "u8"); e.arrays.edge = put(Uint8Array.from(t.edge), "u8");
    e.arrays.pos = put(Float32Array.from(t.pos), "f32");
    e.arrays.bindIds = put(Uint16Array.from(t.binding.ids), "u16"); e.arrays.bindW = put(Float32Array.from(t.binding.w), "f32"); e.arrays.bindOff = put(Float32Array.from(t.binding.off), "f32"); e.arrays.bindDist = put(Float32Array.from(t.binding.dist), "f32");
    e.arrays.skinIndex = put(Uint16Array.from(t.skin.skinIndex), "u16"); e.arrays.skinWeight = put(Float32Array.from(t.skin.skinWeight), "f32");
    if (t.hides) { e.count = t.hides.count; e.arrays.region = put(Uint8Array.from(t.hides.region), "u8"); }
    header.templates[id] = e;
  }
  const blob = new Uint8Array(at); let o = 0; for (const p of parts) { blob.set(p, o); o += p.length; }
  return { header, blob };
}
