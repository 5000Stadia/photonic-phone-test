// The outfit package (R5, "an outfit is one package", design/r5-plan.md): what a template set declares so the people layer can dress, hide, hair and
// draw it as one thing: the pieces and their kinds, the body regions they hide, the loose piece with its inputs, how hair fits under it, and the ages and
// cuts it is made for. dress() fits it to one wearer.
//
// "gentlewoman", London 1660: the boned bodice (a shell on the body, bound by the .mhclo-style binding) with its short full sleeves, over a floor-length
// skirt on a bum roll (a loose profile that follows the pose). Girls and small children take their own cut, built on a girl's and a toddler's body
// from their own landmarks, never the adult cut scaled down.
import { buildNear } from "../shape.js";
import { layerCut } from "./layer.js";
import { bodiceTemplate, fit as fitBodyBinding, relax, pinShoulders, normalsOf, bodyNormals, CUTS } from "./bodice.js";
import { skirtSpec, skirtFootprint, SKIRT_V, SKIRT_INDEX, RINGS, AROUND } from "./skirt.js";
import { skirtSpecAt } from "./tables.js";
import { packed } from "./pack.js";
import { skirtVolume, legVolumes } from "./skirt.js";
import { armKeepOut } from "../keepout.js";

// the mean body each cut is built on (the template is made once, on this body, and fitted to any other by the binding)
export const MEAN_BODIES = {
  adult: { sex: 0.15, age: 30, build: 0.5, muscle: 0.5, height: 1.62, skin: "#c99a74" },
  girl: { sex: 0.15, age: 8, build: 0.5, muscle: 0.5, height: 1.28, skin: "#c99a74" },
  small: { sex: 0.15, age: 3, build: 0.5, muscle: 0.5, height: 0.96, skin: "#c99a74" },
  man: { sex: 0.85, age: 30, build: 0.5, muscle: 0.5, height: 1.74, skin: "#c99a74" },
  boy: { sex: 0.85, age: 9, build: 0.5, muscle: 0.5, height: 1.35, skin: "#c99a74" },
};
// the cut whose skin weights and topology every cut of an outfit shares (the class mesh's attributes are static): each outfit's first cut
export const BASE_CUT = { adult: "adult", girl: "adult", small: "adult", man: "man", boy: "man" };

export const GENTLEWOMAN = {
  id: "gentlewoman",
  period: "London 1660 (V&A 429-1889 bodice; r5-dress-1660.md, the formal gentlewoman)",
  // who it is made for. Under 1.5 years a child is in a long white gown (not this outfit); from 1.5 it is a small child in skirts.
  ages: { from: 1.5, to: Infinity, note: "all ages from 1.5 years; sex is the wearer's choice (the cut follows the body, not the sex)" },
  cuts: [
    { id: "small", ages: [1.5, 5], bodice: "small", skirt: "small", note: "a child in skirts: a soft bodice cut to the body (no flattened bust, a short point), ankle skirt without a roll" },
    { id: "girl", ages: [5, 13], bodice: "girl", skirt: "girl", note: "a small woman's bodice cut from the girl's own landmarks (a lower point, a half-flattened front), ankle skirt, no roll" },
    { id: "adult", ages: [13, Infinity], bodice: "adult", skirt: "gentlewoman", note: "the stays: rigid cone, flattened bust, long point; floor-length skirt over the bum roll" },
  ],
  pieces: [
    { id: "bodice", kind: "shell", parts: ["torso", "sleeveL", "sleeveR"], bind: "mhclo", skin: "torso on chest, spine and hips as a rigid piece; sleeves on the upper arm blending to the chest at the shoulder", verts: "624 (480 torso as 12 rings of 40, 72 a sleeve), 1,140 triangles (the sleeves' tops closed by a fan), at every cut; read as it stands at 1.5 m the facets do not show, so the near tier takes the same (the rings could go to 18 x 56 if a close still shows them)" },
    { id: "skirt", kind: "loose", profile: "pose-following tube of 16 rings x 40 (640 vertices, 1,200 triangles)", verts: 640 },
  ],
  // the body each piece hides (MakeHuman's delete_verts), per body vertex; the base layer is never hidden
  hides: { piece: "bodice", body: "template.hides.region (torso and upper arms)", baseLayer: "kept (nobody is drawn unclothed)", legs: "far outfit-class template only: the skirt covers the legs to the ankle" },
  loose: {
    piece: "skirt", stateless: true,
    inputs: ["hips, thighL/R, shinL/R, footL/R, toeL/R bones (world rotation and joint position)", "floor height", "seat height (0 for none; unused in walking)", "gait phase", "sway amplitude (0 when not walking)"],
    hem: "held above the floor by the cut's clearance", footprint: "skirtFootprint(spec): the skirt widens its wearer's footprint for stepping aside",
  },
  hair: {
    fit: "over",                          // the hair stays outside the shell: never under the bodice
    neckline: "off the shoulder: hair behind the shoulders falls outside the bodice's back; side ringlets hang to the collarbone, over the shell's edge",
    covered: ["hood", "coif"],            // headwear that switches the hair to its covered family
    hood: "the gentlewoman's black silk hood and a shoulder cape over the bodice is outerwear: it takes the next brief's rigid or shell slot",
    periwig: false,
  },
  // the base layer under this outfit reads as the white linen shift: low-necked, edged just above the bodice's neckline (layer.js). Declared by the outfit; the layer
  // itself is always built, and always drawn (nobody is ever drawn unclothed).
  layer: { reads: "linen shift (smock)", colour: "#f3f0e8", neck: "bodice", margin: 0.006, note: "the collar is cut away above the bodice's neckline plus 6 mm of the wearer's height; above the edge is the bare neck and shoulders of an off-the-shoulder gown" },
  // how a wearer's arms stay out of her clothes: not a fixed pose but a keep-out (keepout.js, Kabe 2026-10-13): probes on her arms are kept out of her skirt's swell (the rings at
  // their design radii, the roll included, skirt.js skirtVolume) by two-bone IK, baked into her walk once (walk.js `keepout`) and run live for offline poses. A hand rides on the
  // swell and rests on a lap. (A fixed abduction offset is still available to a walker, `arms`, and the cuts do not use it.)
  keepout: { volumes: ["skirt"], clearance: 0.008, note: "the skirt's rings at their design radii; the bodice's torso is not asked, her arms hang beside it" },
  // silks in deep or rich colours (V&A: blue velvet, satin; Lely and Wright's ladies: grey-blue, gold-yellow satin; r5-dress-1660.md section 6), bodice and skirt of matching
  // satin; the pale ivory and peach of the first stills read as bare skin and are out: each must stand off every skin tone of the ramp by a colour distance
  // (colour.js deltaE) of at least 22, which test/garments.test.mjs checks. The sleeves are the bodice's silk; the white is the shift (the layer above).
  palette: {
    silks: [
      { id: "blue velvet", bodice: "#27458f", skirt: "#2f55a8" },
      { id: "crimson satin", bodice: "#8e1f33", skirt: "#a3283e" },
      { id: "emerald", bodice: "#1f6b4a", skirt: "#26805a" },
      { id: "gold satin", bodice: "#b9862a", skirt: "#cc9a34" },
      { id: "plum", bodice: "#5e2a62", skirt: "#74397a" },
      { id: "grey-blue satin", bodice: "#53708f", skirt: "#6584a6" },
    ],
    shift: "#f3f0e8",
  },
};

// "gentleman", London 1660: the very short doublet (V&A T.324-1980, 44 cm, six laps, the shirt showing at the waist gap) with its falling band, over petticoat breeches to the knee (V&A O356780)
// and painted stockings. A boy takes it from his breeching (6 by default: the plan's call, unverified for London) to 13; under 6 a boy is in skirts, which is not this outfit.
// The slots are the gentlewoman's: the shell piece is read as "bodice" (here the doublet, its band, its shirt and their sleeves) and the loose piece as "skirt" (the breeches), so one class
// mesh, one bake and one pair of colour texels serve both.
export const GENTLEMAN = {
  id: "gentleman",
  period: "London 1660 (V&A T.324-1980 doublet, O356780 petticoat breeches; r5-dress-1660.md, the gentleman)",
  ages: { from: 6, to: Infinity, note: "men from 13 and breeched boys from 6; a boy under 6 is in skirts (breeching is 4 to 7, 6 by default), which is not this outfit and has none" },
  cuts: [
    { id: "boy", ages: [6, 13], bodice: "boy", skirt: "breeches", note: "a small man's doublet and breeches, cut from the boy's own landmarks (the shirt a little less full)" },
    { id: "man", ages: [13, Infinity], bodice: "man", skirt: "breeches", note: "the very short doublet ending above the natural waist, the shirt blousing in the gap, the falling band; petticoat breeches to the knee" },
  ],
  // a baked shell (the doublet, the band, the shirt and its sleeves: wear bit 0) and a loose piece (the divided petticoat breeches: wear bit 1), which is two tubes of the skirt's ring machinery, one a leg
  // (garments/skirt.js SKIRTS.breeches; garments/reduced.js outfitLayout puts both tubes in the class mesh)
  slots: { shell: "bodice", loose: "skirt", tubes: 2 },
  stuff: { 0: "doublet", 1: "doublet", 2: "doublet", 3: "linen", 4: "linen", 5: "linen", 6: "linen", 7: "linen", 8: "linen" },          // what each part of the shell is made of (the paint of its vertices)
  pieces: [
    { id: "doublet", kind: "shell", parts: ["torso", "sleeveL", "sleeveR"], bind: "mhclo", skin: "torso rigid on the chest, spine and hips; sleeves on the upper arm, the cap sewn to the chest", verts: "close-fitting, from a hem above the waist with six laps to the base of the neck; sleeves nearly to the elbow, fairly close" },
    { id: "band", kind: "shell", parts: ["band"], bind: "mhclo", skin: "rigid with the doublet's top rings (the same weights, column for column)", verts: "4 rings lying on the doublet's top, bib-fronted and square over the shoulders, in linen" },
    { id: "shirt", kind: "shell", parts: ["shirt", "shirtSleeveL", "shirtSleeveR", "shirtForearmL", "shirtForearmR"], bind: "mhclo", skin: "the trunk part rigid like the doublet; each sleeve in two pieces, the upper arm's and the forearm's, rigid on their bone", verts: "the shirt blousing in the narrow gap between breeches and doublet, and sleeves from under the doublet's sleeve to the wrist, billowing from the elbow, in a cuff: white linen (the shift's colour)" },
    { id: "breeches", kind: "loose", profile: "two pose-following tubes of 16 rings, one on each leg, from the waist to a gathered knee band (a ribbon): the skirt's machinery with a path of its own for each leg (SKIRTS.breeches)", verts: "2 x 640 at near, 2 x 512 at mid, 2 x 384 at far" },
    { id: "stockings", kind: "painted", note: "the legs' vertices below the hips take the stockings' colour (paint kind 6), and the feet the shoes' (kind 5): static attributes of the class mesh, a colour a person" },
  ],
  hides: { piece: "doublet", body: "template.hides.region (torso, and upper arms)", baseLayer: "kept (nobody is drawn unclothed)", legs: "kept: the breeches stop at the knee, and the stockings are the legs painted" },
  loose: {
    piece: "breeches", stateless: true, tubes: 2,
    inputs: ["hips, spine, thighL/R, shinL/R bones (world rotation and joint position)", "floor height", "seat height (0 for none)", "gait phase", "sway amplitude"],
    hem: "at the knees, a little below them: the knee band", footprint: "skirtFootprint(spec): the wider tube of the two",
  },
  hair: { fit: "over", neckline: "the falling band lies over the hair at the back; long hair falls over it", covered: ["hat"], hat: "not in this outfit (it needs the hair-under-hat family)", periwig: false },
  // the base layer reads as the shirt: white linen, its collar cut just above the doublet's neck (the band stands over the cut), its arms and legs under the garments; below the knee it is the stockings
  layer: { reads: "linen shirt and drawers under the breeches", colour: "#f3f0e8", neck: "doublet", margin: 0.012 },
  // the painted pieces (garments/reduced.js outfitLayout): stockings on the vertices that are a leg's and shoes on the feet; and the ribbon at the
  // breeches' knee band, in a colour of its own (the 1660 mark: r5-dress-1660.md)
  painted: { stockings: {}, shoes: "#14100e", ribbon: "#a8262f", ribbonRings: 2 },
  keepout: { volumes: ["breeches (two tubes)"], clearance: 0.008, note: "both tubes' rings at their design radii, as the skirt's; the doublet's torso is not asked, his arms hang beside it" },
  // suits in the colours of the sources: black (the Dutch and English fashion colour), grey wool, a bottle green cloth coat, claret and blue (Pepys's coloured suits), a plum, and a gold-yellow silk (Lely's
  // ladies' gold-yellow satin; a man's suit of it was court dress). Russet and tawny browns, the common English cloth colours, are out: every brown within reach of the skin tones of the ramp is within 22
  // colour units of one of them (the V&A's beige doublet is no better), and each colour must stand off every skin tone by 22 (test/gentleman.test.mjs checks). The doublet and breeches are one suit; the shirt and
  // band are the shift's white; the stockings are chosen apart.
  palette: {
    silks: [
      { id: "black cloth", bodice: "#202027", skirt: "#1a1a20" },
      { id: "plum", bodice: "#4f2c58", skirt: "#5c3666" },
      { id: "grey wool", bodice: "#555963", skirt: "#656a75" },
      { id: "bottle green", bodice: "#2b4a38", skirt: "#355b46" },
      { id: "claret", bodice: "#6b1f2f", skirt: "#7d2a3c" },
      { id: "slate blue", bodice: "#38507a", skirt: "#45618f" },
      { id: "gold-yellow silk", bodice: "#b4952f", skirt: "#c2a24a" },
    ],
    stockings: [{ id: "cream", rgb: "#f1ecde" }, { id: "black", rgb: "#1c1c21" }, { id: "grey", rgb: "#8a8c94" }, { id: "blue-grey", rgb: "#4f6c8c" }],
    shift: "#f3f0e8",
  },
};
export const OUTFITS = { gentlewoman: GENTLEWOMAN, gentleman: GENTLEMAN };

/** The colours of one wearer's outfit, from a number in [0, 1) the caller took from a hash (a garment choice is a hash, never a random stream): { id, bodice, sleeve,
 *  skirt, shift } as "#rrggbb". */
export function look(u, outfit = GENTLEWOMAN, u2 = 0) {
  const silks = outfit.palette.silks, s = silks[Math.min(silks.length - 1, Math.floor(u * silks.length))], hose = outfit.palette.stockings;
  const o = { id: s.id, bodice: s.bodice, sleeve: s.bodice, skirt: s.skirt, shift: outfit.palette.shift };
  if (hose) { const h = hose[Math.min(hose.length - 1, Math.floor(u2 * hose.length))]; o.stockings = h.rgb; o.stockingsId = h.id; }
  return o;
}

/** The keep-out of a wearer's arms for this outfit (keepout.js): the skirt's swell and the legs inside it, from the wearer's skirt spec (an array of two, the tubes of the breeches), their rest joints J (the walker's) and their height. */
export function keepOutFor(spec, J, height, outfit = GENTLEWOMAN) {
  if (outfit.loose.tubes === 2) return armKeepOut(J, height, (bones, ctx) => spec.map((sp, i) => skirtVolume(sp, bones, ctx, i)), { clearance: outfit.keepout.clearance });          // the divided breeches: both tubes
  return armKeepOut(J, height, (bones, ctx) => [skirtVolume(spec, bones, ctx), ...legVolumes(spec, bones)]);
}

/** The cut a wearer of this age takes. */
export function cutFor(age, outfit = GENTLEWOMAN) {
  const c = outfit.cuts.find((c) => age >= c.ages[0] && age < c.ages[1]);
  return c ?? (age < outfit.cuts[0].ages[0] ? outfit.cuts[0] : outfit.cuts[outfit.cuts.length - 1]);
}

const templates = new Map();
/** The bodice template of a cut, built from scratch on the cut's mean body (about 0.4 s): what the pack is made of (tools/people/garment-pack.mjs) and its reference. The three cuts share
 *  one set of skin weights, the adult's (the class mesh's attributes are static: reduced.js); their topologies are the same, which is checked. */
const built = new Map();
export function buildTemplate(cutId) {
  if (built.has(cutId)) return built.get(cutId);
  const t = bodiceTemplate(buildNear(MEAN_BODIES[cutId]), cutId);
  built.set(cutId, t);
  if (cutId !== BASE_CUT[cutId]) {
    const a = buildTemplate(BASE_CUT[cutId]);
    if (a.V !== t.V || a.index.some((x, i) => x !== t.index[i]) || a.part.some((x, i) => x !== t.part[i])) throw new Error(`outfit: the ${cutId} bodice's topology is not the ${BASE_CUT[cutId]}'s`);
    t.skin = a.skin;
  }
  return t;
}
/** The bodice template of a cut: from the pack when there is one (spikes/makehuman/data/garments-gentlewoman, pack.js), else built (about 0.4 s). */
export function templateFor(cutId) {
  let t = templates.get(cutId);
  if (!t) { t = packed("full:" + cutId, () => bodiceTemplate(buildNear(MEAN_BODIES[cutId]), cutId)) ?? buildTemplate(cutId); templates.set(cutId, t); }
  return t;
}

/** Fit the gentlewoman to one wearer (shape.js buildNear's result and its params): { cut, bodice: { position, normal, index, skinIndex, skinWeight, hides },
 *  skirt: spec, footprint, layer: { s (the base layer's neck cut, layer.js), colour }, arms, keepout }. The bodice is fitted through the binding (about 0.1 ms); the skirt spec is read from the tables by the wearer's sliders and height. */
export function dress(near, params, outfit = GENTLEWOMAN, { exact = false } = {}) {
  const cut = cutFor(params.age, outfit), tpl = templateFor(cut.bodice);
  const position = pinShoulders(relax(fitBodyBinding(tpl.binding, near.position, undefined, 1, 1, bodyNormals(near.position)), tpl), tpl, near.joints.J, params.height);
  const normal = normalsOf(position, tpl.index);
  const tubes = outfit.loose.tubes === 2, skirts = tubes ? [1, -1].map((leg) => skirtSpecAt(params, cut.skirt, leg)) : [exact ? skirtSpec(near, cut.skirt) : skirtSpecAt(params, cut.skirt)], skirt = skirts[0];      // the table's spec (a few microseconds, the same at every tier); `exact` reads the body (30 ms, the table's reference)      // the table's (a few microseconds, the same at every tier); `exact` reads the body (30 ms, the table's reference)
  const bodice = { template: tpl, position, normal, index: tpl.index, skinIndex: tpl.skin.skinIndex, skinWeight: tpl.skin.skinWeight, hides: tpl.hides, part: tpl.part };
  return { cut, bodice, skirt, skirts, footprint: Math.max(...skirts.map(skirtFootprint)), layer: { s: layerCut(near.position, bodice, params.height, outfit.layer.margin), colour: outfit.layer.colour }, arms: cut.arms ?? null, keepout: keepOutFor(tubes ? skirts : skirt, near.joints.J, params.height, outfit) };
}
export { SKIRT_V, SKIRT_INDEX, RINGS, AROUND, CUTS };
