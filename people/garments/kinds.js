// Garment kinds (R5, "Clothes as objects", design/r5-plan.md; pattern-buffer's WORN-OBJECTS-V1): the light half, data only and no imports, so the attire sampler (attire.js) and
// pattern-buffer's mirror (src/traits/pb.js, src/traits/aspects.js) can read it without the garments' geometry. worn.js turns a set of these into what is drawn.
//
// A garment is a thing in the world: { id, kind, aspects: { colour, material, condition, pattern } }, worn_by a person. Its KIND is ours and is one canonical string: pattern-buffer does not alias
// kinds, so each matches KIND_RE and there is exactly one spelling. A kind is where a template is built; different shapes are different kinds (a skirt over a roll is not a skirt without).
//
// The slots say what a garment covers, and so what it conflicts with: two garments in one slot cannot both be drawn, and the OUTERMOST wins (the higher `layer`; equal layers: the one listed last,
// as it was put on last). Every conflict is reported, never silent (worn.js resolveWorn).
//   under   the shift: always on. Taking everything off leaves it.
//   torso   the bodice or doublet and its sleeves
//   legs    the skirt or breeches (the loose piece, which follows the pose)
//   neck    the falling band or neckerchief (a shell lying on the torso's top rings)
//   over    what is worn over the legs' garment: the apron (painted on the skirt's front)
//   hose    stockings (painted on the legs)
//   (head and outer slots, for the hat, coif, hood, periwig and cloak, are not built: FUTURE.)

export const KIND_RE = /^[a-z][a-z0-9_]*$/;
export const SLOTS = ["under", "torso", "legs", "neck", "over", "hose"];

/** The kinds we draw. `package`: the outfit package (garments/outfit.js) whose class mesh draws it; `noun`: what it is called in a name ("a crimson satin bodice"). */
export const KINDS = {
  shift:              { slot: "under", layer: 0, packages: ["gentlewoman", "workwoman", "gentleman", "workman"], noun: "shift", note: "linen, low-necked: the base layer. Always worn; never taken off" },
  bodice:             { slot: "torso", layer: 1, packages: ["gentlewoman"], noun: "bodice", note: "the gentlewoman's boned cut: rigid cone, flattened bust, short full sleeves (a girl's and a child's cut on their own landmarks)" },
  waistcoat_bodice:   { slot: "torso", layer: 2, packages: ["workwoman"], noun: "waistcoat", note: "the working woman's laced bodice with elbow sleeves (Pepys's waistcoat)" },
  doublet:            { slot: "torso", layer: 3, packages: ["gentleman"], noun: "doublet", note: "the very short gentleman's doublet, six laps, the shirt blousing in the gap" },
  skirted_doublet:    { slot: "torso", layer: 4, packages: ["workman"], noun: "doublet", note: "the working cut: skirts to the hip, no waist gap" },
  roll_skirt:         { slot: "legs", layer: 3, packages: ["gentlewoman"], noun: "skirt", note: "floor-length, over the bum roll (a child's cut has no roll)" },
  plain_skirt:        { slot: "legs", layer: 2, packages: ["workwoman", "gentlewoman"], noun: "skirt", note: "ankle length, no roll. Of the gentlewoman package only on a child's cut" },
  petticoat_breeches: { slot: "legs", layer: 1, packages: ["gentleman"], noun: "petticoat breeches", note: "the full divided breeches to the knee, a ribbon at the band" },
  closed_breeches:    { slot: "legs", layer: 0, packages: ["workman"], noun: "breeches", note: "close breeches to the knee, a tight band" },
  apron:              { slot: "over", layer: 5, packages: ["workwoman"], noun: "apron", note: "linen, painted on the skirt's front; needs the skirt" },
  neckerchief:        { slot: "neck", layer: 1, packages: ["workwoman"], noun: "neckerchief", note: "linen on the neckline, a bib in front" },
  falling_band:       { slot: "neck", layer: 1, packages: ["gentleman", "workman"], noun: "falling band", note: "linen, square over the shoulders" },
  stockings:          { slot: "hose", layer: 0, packages: ["gentleman", "workman", "workwoman"], noun: "stockings", note: "painted on the legs; under a gentlewoman's long skirt they are not seen, so not drawn" },
};
export const KIND_NAMES = Object.keys(KINDS);

/** Kinds that are planned and have no template yet: reported as not drawn, never silently dropped. (Any other unknown kind is reported too.) */
export const FUTURE = new Set(["hat", "coif", "hood", "periwig", "cloak"]);

/** The outfit packages (garments/outfit.js), by id, and what each one's class draws: `torso` and `legs` its two body garments, `with` the others it draws whether or not they are worn
 *  (`neck` with the torso, `over` with the legs), `hose` always. `from`: the age (years) it is built for. */
export const PACKAGE_KINDS = {
  gentlewoman: { torso: "bodice", legs: "roll_skirt", neck: null, over: null, hose: null, from: 1.5, adultAt: 13, female: true, gentle: true },
  workwoman: { torso: "waistcoat_bodice", legs: "plain_skirt", neck: "neckerchief", over: "apron", hose: "stockings", from: 1.5, adultAt: 13, female: true, gentle: false },
  gentleman: { torso: "doublet", legs: "petticoat_breeches", neck: "falling_band", over: null, hose: "stockings", from: 6, adultAt: 13, female: false, gentle: true },
  workman: { torso: "skirted_doublet", legs: "closed_breeches", neck: "falling_band", over: null, hose: "stockings", from: 6, adultAt: 13, female: false, gentle: false },
};
export const PACKAGE_IDS = Object.keys(PACKAGE_KINDS);

// the placeholder rule's shares (outfits.js): the lowest of the id's hash are gentlefolk, the next working folk
export const GENTRY_SHARE = 0.2, WORKING_SHARE = 0.6;

/** What each palette entry of each package is, in words: [colour, material] of its upper garment (bodice or doublet) and of its lower (skirt or breeches). The same order as the package's
 *  palette.silks (garments/outfit.js; test/garments-objects.test.mjs checks the ids), so a colour NAME reads the palette's own colour in that package and the same name always means one hex. */
export const SILKS = {
  gentlewoman: [
    { id: "blue velvet", upper: ["blue", "velvet"], lower: ["blue", "velvet"] },
    { id: "crimson satin", upper: ["crimson", "satin"], lower: ["crimson", "satin"] },
    { id: "emerald", upper: ["emerald", "silk"], lower: ["emerald", "silk"] },
    { id: "gold satin", upper: ["gold", "satin"], lower: ["gold", "satin"] },
    { id: "plum", upper: ["plum", "silk"], lower: ["plum", "silk"] },
    { id: "grey-blue satin", upper: ["grey-blue", "satin"], lower: ["grey-blue", "satin"] },
  ],
  gentleman: [
    { id: "black cloth", upper: ["black", "wool"], lower: ["black", "wool"] },
    { id: "plum", upper: ["plum", "silk"], lower: ["plum", "silk"] },
    { id: "grey wool", upper: ["grey", "wool"], lower: ["grey", "wool"] },
    { id: "bottle green", upper: ["bottle-green", "wool"], lower: ["bottle-green", "wool"] },
    { id: "claret", upper: ["claret", "wool"], lower: ["claret", "wool"] },
    { id: "slate blue", upper: ["slate", "wool"], lower: ["slate", "wool"] },
    { id: "gold-yellow silk", upper: ["gold", "silk"], lower: ["gold", "silk"] },
  ],
  workwoman: [
    { id: "drab wool", upper: ["drab", "wool"], lower: ["drab", "wool"] },
    { id: "grey wool", upper: ["grey", "wool"], lower: ["grey", "wool"] },
    { id: "woad blue", upper: ["woad", "wool"], lower: ["woad", "wool"] },
    { id: "dull green", upper: ["green", "wool"], lower: ["green", "wool"] },
    { id: "madder red", upper: ["madder", "wool"], lower: ["madder", "wool"] },
    { id: "weld yellow", upper: ["weld", "wool"], lower: ["weld", "wool"] },
    { id: "grey over blue", upper: ["grey", "wool"], lower: ["woad", "wool"] },
    { id: "drab over green", upper: ["drab", "wool"], lower: ["green", "wool"] },
  ],
  workman: [
    { id: "drab wool", upper: ["drab", "wool"], lower: ["drab", "wool"] },
    { id: "grey wool", upper: ["grey", "wool"], lower: ["grey", "wool"] },
    { id: "woad blue", upper: ["woad", "wool"], lower: ["woad", "wool"] },
    { id: "dull green", upper: ["green", "wool"], lower: ["green", "wool"] },
    { id: "drab over grey", upper: ["drab", "wool"], lower: ["grey", "wool"] },
    { id: "green over grey", upper: ["green", "wool"], lower: ["grey", "wool"] },
    { id: "grey over drab", upper: ["grey", "wool"], lower: ["drab", "wool"] },
  ],
};
/** The stockings' colours of each package, as its palette.stockings ids (in that order). */
export const HOSE = { gentleman: ["cream", "black", "grey", "blue-grey"], workman: ["cream", "grey", "blue-grey", "drab"], workwoman: ["cream", "grey", "blue-grey", "drab"] };

/** The words a garment's aspects take (pattern-buffer holds them as words; Photonic draws the colour now and carries the rest). */
export const MATERIALS = ["silk", "velvet", "satin", "wool", "linen", "lace", "leather"];
export const CONDITIONS = ["new", "good", "worn", "patched", "ragged"];
export const PATTERNS = ["plain", "striped", "checked", "embroidered"];
export const GARMENT_ASPECTS = ["colour", "material", "condition", "pattern"];

/** The garment nouns in a name, for a garment whose kind is not given ("a red cloak"): the kind it is, or a FUTURE kind, or nothing. Only the nouns that name one kind; "petticoat" and "gown" could be several. */
export const NOUN_KIND = {
  shift: "shift", smock: "shift", chemise: "shift",
  bodice: "bodice", stays: "bodice", waistcoat: "waistcoat_bodice", doublet: "doublet", jerkin: "skirted_doublet",
  apron: "apron", neckerchief: "neckerchief", kerchief: "neckerchief", band: "falling_band", stockings: "stockings", hose: "stockings",
  cloak: "cloak", hat: "hat", cap: "coif", coif: "coif", hood: "hood", periwig: "periwig", wig: "periwig",
};
