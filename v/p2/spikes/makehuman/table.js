// The far tier's table (R5): a far person needs only their 16 coefficients on the far basis (at unit height) and their rig joints (at
// unit height, for the walker). Both are smooth functions of the body's four sliders (sex, age, muscle, weight) with height an exact
// scale, so tools/people/far-table.mjs builds them exactly at the nodes of a grid over the sliders and this reads them back by
// multilinear interpolation: a few microseconds a person in place of the bake, place, rig and reduce (2 ms).
//
// The grid respects the sliders' kinks: MakeHuman's weights are products of per-slider shares that are linear between the anchors
// (gender 0..1; age at 1, 10, 25 and 90 years; muscle and weight at 0, 0.5, 1), so inside a cell the unit-height shape is multilinear
// in the sliders up to the height normalisation and the rig's stance, which the extra age nodes below 10 take up.
//   far-table-N.json    { axes: { sex, age, muscle, build }: node values, channels, scale: per channel, pack: the far pack's print }
//   far-table-N.bin.gz  int16, node-major (sex slowest, build fastest), `channels` per node: k coefficients, then the joints x, y, z
// Only + - * / here, so every engine gives the same bits.
import { gz, json } from "./load.js";
const DATA = new URL("./data/", import.meta.url);
export const AXES = ["sex", "age", "muscle", "build"];

/** A fingerprint of a far pack (loadFar's result): the table is only valid for the basis it was built on. */
export function packPrint(far) {
  let s = 0;
  for (let i = 0; i < far.mean.length; i += 5) s += far.mean[i] * (1 + (i % 11));
  for (let i = 0; i < far.basis.length; i += 7) s += far.basis[i] * (1 + (i % 13));
  return s;
}

export async function loadFarTable(name = "far-table-1500", far) {
  const h = await json(new URL(name + ".json", DATA)), i16 = new Int16Array(await gz(new URL(name + ".bin.gz", DATA)));
  if (far && (h.pack !== packPrint(far) || h.k !== far.k)) throw new Error(`${name} is not for this far pack; re-run node tools/people/far-table.mjs`);
  return interpolator(h, i16);
}

/** A table of any packed channels over the four sliders: { header, channels, nodes, at(sex, age, muscle, build, out) } (the same file layout as the far table's,
 *  with whatever grid `axes` says). The skirt's tables (src/people/garments/skirt.js, tools/people/skirt-table.mjs) are read with it, one per cut. */
export async function loadTable(name) {
  const h = await json(new URL(name + ".json", DATA)), i16 = new Int16Array(await gz(new URL(name + ".bin.gz", DATA)));
  return interpolator(h, i16);
}

function interpolator(h, i16) {
  const C = h.channels, nodes = new Float64Array(i16.length);
  for (let i = 0; i < i16.length; i++) nodes[i] = i16[i] * h.scale[i % C];
  const ax = AXES.map((k) => h.axes[k]), stride = new Array(4);
  for (let d = 3, s = C; d >= 0; d--) { stride[d] = s; s *= ax[d].length; }
  const cell = new Int32Array(4), tt = new Float64Array(4);
  return {
    header: h, channels: C, k: h.k, nodes: i16.length / C,
    /** The channels at (sex 0..1, age in years, muscle 0..1, build 0..1) into out: for the far table, k coefficients then the 21 joints' x, y, z (all at unit height). */
    at(sex, age, muscle, build, out = new Float64Array(C)) {
      const x = [sex, age, muscle, build];
      for (let d = 0; d < 4; d++) {
        const a = ax[d], last = a.length - 2;
        let i = 0; while (i < last && x[d] > a[i + 1]) i++;
        const t = (x[d] - a[i]) / (a[i + 1] - a[i]);
        cell[d] = i; tt[d] = t < 0 ? 0 : t > 1 ? 1 : t;
      }
      out.fill(0);
      for (let m = 0; m < 16; m++) {
        let w = 1, o = 0;
        for (let d = 0; d < 4; d++) { const hi = (m >> d) & 1; w *= hi ? tt[d] : 1 - tt[d]; o += (cell[d] + hi) * stride[d]; }
        if (w === 0) continue;
        for (let c = 0; c < C; c++) out[c] += w * nodes[o + c];
      }
      return out;
    },
  };
}
