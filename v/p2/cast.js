// The lineup's thirty people (R5, "Done when: the lineup"): each is a few words, and everything else follows from them, the person (src/traits) and the dress (src/people/dress-words.js).
// No three.js here, so node checks the cast too (test/lineup.test.mjs).
import { resolve } from "./traits/resolve.js";
import { outfitFromWords, impliedSex } from "./people/dress-words.js";

// Row one the young (0 to 17), row two grown people, row three the old and the five worst seeds of the garment sweep (design/r5-plan.md: small children sitting; the sweep's
// worst by the share it takes of any bar, tools/people/garment-sweep.mjs on the 400 held-out people). A worst seed is a person of the sweep (its id and seed, from no words), dressed as
// the sweep dressed them: `dress` is the words the dress is chosen from. The people layer cannot sit them yet (sit() is M4); here they stand and walk.
export const CAST = [
  // the young
  { words: "a baby of 6 months" },
  { words: "a girl of 2 in a blue dress" },
  { words: "a boy of 3" },
  { words: "a girl of 5, a servant's child, in a green dress" },
  { words: "a boy of 7 in a grey doublet" },
  { words: "a girl of 8 in a red dress" },
  { words: "a stout boy of 10 in black" },
  { words: "a boy of 12, an apprentice" },
  { words: "a tall girl of 14, a lady's daughter, in a purple gown" },
  { words: "a thin lad of 16, a ploughman" },
  // grown people
  { words: "a young woman of 22, a maid, in a blue gown" },
  { words: "a tall thin gentleman in a black doublet and grey breeches" },
  { words: "a stout gentleman in black" },
  { words: "a lady of 30 in a purple gown" },
  { words: "a short plump woman of 35 in an apron" },
  { words: "a stout man, a rich merchant, in green" },
  { words: "a broad-shouldered man, a labourer, in a green doublet" },
  { words: "a gentlewoman of 45 in black" },
  { words: "a servant of 28 in brown" },
  { words: "a tall woman of 40 in a yellow gown" },
  // the old
  { words: "an old washerwoman of 72 in an apron" },
  { words: "an old gentleman of 85 in grey" },
  { words: "a man of 90, a labourer, in drab" },
  { words: "a stout woman of 55, a cook, in madder" },
  { words: "a thin old lady of 68 in a grey gown" },
  // the worst of the sweep
  { id: "far-fit:1243", seed: 9852317, words: "", dress: "a gentlewoman", worst: "sit leg 4.1 mm" },
  { id: "far-fit:1222", seed: 9686018, words: "", dress: "a gentlewoman", worst: "sit layer 3.1 mm" },
  { id: "far-fit:1540", seed: 12204260, words: "", dress: "a gentlewoman", worst: "walk layer 2.6 mm" },
  { id: "far-fit:1393", seed: 11040167, words: "", dress: "a gentlewoman", worst: "sit layer 2.3 mm" },
  { id: "far-fit:1327", seed: 10517513, words: "", dress: "a gentlewoman", worst: "sit leg 2.1 mm" },
];

/** The cast, resolved: [{ id, seed, said, values, derived, dress: outfitFromWords' answer, caption, worst }]. A person's words do not always say their sex to the lexicon ("washerwoman", "maid"
 *  are not words it knows), so the seed is the first, counting up from the person's place, that gives a person of the sex the words imply; the seed is part of the person and stays with them. */
export function castOf(cast = CAST) {
  return cast.map((c, i) => {
    const id = c.id ?? `L${i + 1}`, want = impliedSex(c.words);
    let seed = c.seed ?? 1000 + 17 * i, res;
    for (let k = 0; k < 400; k++, seed++) {
      res = resolve({ id, seed, said: c.words });
      if (c.seed != null) break;
      if (res.ok && (!want || res.values.sex === want)) break;
    }
    if (!res.ok) throw new Error(`"${c.words}": ${JSON.stringify(res.refused)}`);
    const dress = outfitFromWords(c.dress ?? c.words, res.values, id);
    return { id, seed, said: c.words, values: res.values, derived: res.derived, dress, caption: c.words || describe(res), worst: c.worst ?? null };
  });
}

// the caption of a person from no words: who they turned out to be
function describe(res) {
  const v = res.values, age = Math.floor(v.age), h = Math.round(res.derived["body.height"]);
  return `a ${v.sex === "male" ? (age < 18 ? "boy" : "man") : (age < 18 ? "girl" : "woman")} of ${age}, ${h} cm`;
}
