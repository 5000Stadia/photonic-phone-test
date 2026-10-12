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
  { aspect: "wears", durability: "STATE", holds: "objects", note: "garment objects worn_by the person (E3); declared once the wardrobe (R5, M3) can answer", declared: false },
];
// What Photonic declares resolvable now (`attr:<aspect> · resolvable_for · person`). Marks come from the story;
// wears waits for a wardrobe that can answer, so nobody is memoised as wearing nothing.
export const DECLARED = ASPECTS.filter(a => a.declared !== false).map(a => a.aspect);
export const ASPECT = Object.freeze(Object.fromEntries(ASPECTS.map(a => [a.aspect, a])));
