// The people aspects Photonic answers for in pattern-buffer (R3; unified world access, gate gde97f3). Each is one
// declared attribute (`attr:<aspect> · resolvable_for · person`), declared once so `hair` and `hair_colour` never
// fragment. DISPOSITIONAL for the body, STATE for what changes (hair as worn, beard, marks); garments are objects
// worn by the person (pattern-buffer's E3), so `wears` points at objects rather than holding words.
// `describe()` produces the words for each aspect; `appearance` holds the exact recipe so the person rebuilds identically.

export const ASPECTS = [
  { aspect: "appearance", durability: "DISPOSITIONAL", holds: "recipe", note: "seed, generator version, as_of, said: the exact rebuild" },
  { aspect: "height", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "build", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "skin", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "eyes", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "face", durability: "DISPOSITIONAL", holds: "words", note: "masculine–feminine where it runs against sex" },
  { aspect: "nose", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "ears", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "mouth", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "chin", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "jaw", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "cheeks", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "forehead", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "brows", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "head", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "body", durability: "DISPOSITIONAL", holds: "words" },
  { aspect: "hair", durability: "STATE", holds: "words", note: "as worn: length, texture, colour (dye and grey included)" },
  { aspect: "beard", durability: "STATE", holds: "words" },
  { aspect: "marks", durability: "STATE", holds: "words", note: "scars, tattoos, paint, wounds: written with their time", declared: false },
  { aspect: "attire", durability: "STATE", holds: "objects", note: "garment objects worn_by the person (E3, WORN-OBJECTS-V1): the complement of `existing` for their rank, age and sex in 1660 London, as items { kind, value, aspects }" },
  { aspect: "wears", durability: "STATE", holds: "objects", note: "superseded by attire: the garments a person is wearing, from the world's own record", declared: false },
];
// What Photonic declares resolvable now (`attr:<aspect> · resolvable_for · person`). Marks come from the story;
// wears waits for a wardrobe that can answer, so nobody is memoised as wearing nothing.
export const DECLARED = ASPECTS.filter(a => a.declared !== false).map(a => a.aspect);
// The aspects describe() words, which the resolver reads canon attributes against (pb.js): `attire` is answered by the garment sampler (src/people/attire.js, through generators.js), not by words about the body.
export const ASPECT = Object.freeze(Object.fromEntries(ASPECTS.filter(a => a.aspect !== "attire").map(a => [a.aspect, a])));

// The garments' own look aspects (R5, "Clothes as objects"). Garments are entities worn_by a person, minted from our `attire` answer, and pattern-buffer lands a look aspect only on an item whose kind it is declared
// `resolvable_for` (undeclared ones come back counted as `dropped_aspects`). So colour, material, condition and pattern are declared for each garment kind at world creation. The kinds are ours: each matches
// [a-z][a-z0-9_]* and is one canonical string, because pattern-buffer does not alias kinds. Different shapes are different kinds. Hat, coif, hood, periwig and cloak come later and are declared when they are built.
// (Written out here, not imported: src/traits is archived and mirrored on its own. test/garments-objects.test.mjs checks the list against src/people/garments/kinds.js, where the templates are.)
export const GARMENT_KINDS = ["shift", "bodice", "waistcoat_bodice", "roll_skirt", "plain_skirt", "apron", "neckerchief", "doublet", "skirted_doublet", "petticoat_breeches", "closed_breeches", "falling_band", "stockings"];
export const GARMENT_ASPECTS = ["colour", "material", "condition", "pattern"];
/** The opt-in rows for the garments: `attr:<aspect> · resolvable_for · <kind>` for every look aspect and every kind we draw (the person's own aspects are in DECLARED, resolvable_for person). */
export const GARMENT_DECLARATIONS = GARMENT_ASPECTS.flatMap((aspect) => GARMENT_KINDS.map((kind) => ({ entity: `attr:${aspect}`, attribute: "resolvable_for", value: kind, timeless: true })));
