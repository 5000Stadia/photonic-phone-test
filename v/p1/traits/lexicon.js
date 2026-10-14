// Descriptors (R3; design/r3-plan.md "From the story's words to a person"): a closed vocabulary from words to
// constraints. A constraint scopes one trait:
//   { trait, q: [lo, hi] }  a band of the person's prior, in quantiles ("big" = at or above the 85th percentile)
//   { trait, v: [lo, hi] }  a band of values in the trait's own units (hair length in cm, an amount, an age)
//   { trait, in: [...] }    allowed categories
// Each constraint carries `word`, the phrase that set it, so a refusal can name both sides of a contradiction.
// Intensifiers map to fixed quantile bands, so "very" means the same thing for every trait.

export const INTENSITY = {
  slightly: [0.6, 0.85], somewhat: [0.6, 0.85], "a bit": [0.6, 0.85],
  "": [0.85, 1], quite: [0.75, 1], fairly: [0.75, 1], rather: [0.75, 1],
  very: [0.97, 1], really: [0.97, 1], "extremely": [0.995, 1], enormously: [0.995, 1], hugely: [0.995, 1],
};
export const AVERAGE = [0.3, 0.7];

const high = (band) => band;
const low = (band) => [1 - band[1], 1 - band[0]];
const softer = (band) => [Math.max(0.5, band[0] - 0.25), 1];

// Hair colour as regions of the two pigments (eumelanin, pheomelanin), values 0–1.
export const HAIR_COLOUR = {
  black: { "hair.eumelanin": [0.85, 1] },
  "dark brown": { "hair.eumelanin": [0.65, 0.85] },
  brown: { "hair.eumelanin": [0.4, 0.8], "hair.pheomelanin": [0, 0.55] },
  brunette: { "hair.eumelanin": [0.4, 0.85] },
  "light brown": { "hair.eumelanin": [0.3, 0.45], "hair.pheomelanin": [0, 0.5] },
  "dark blonde": { "hair.eumelanin": [0.2, 0.32], "hair.pheomelanin": [0, 0.5] },
  blonde: { "hair.eumelanin": [0, 0.25], "hair.pheomelanin": [0, 0.5] },
  blond: { "hair.eumelanin": [0, 0.25], "hair.pheomelanin": [0, 0.5] },
  fair: { "hair.eumelanin": [0, 0.3], "hair.pheomelanin": [0, 0.5] },
  "platinum blonde": { "hair.eumelanin": [0, 0.08], "hair.pheomelanin": [0, 0.2] },
  "strawberry blonde": { "hair.eumelanin": [0, 0.2], "hair.pheomelanin": [0.5, 0.7] },
  red: { "hair.eumelanin": [0, 0.3], "hair.pheomelanin": [0.7, 1] },
  ginger: { "hair.eumelanin": [0, 0.3], "hair.pheomelanin": [0.7, 1] },
  auburn: { "hair.eumelanin": [0.3, 0.55], "hair.pheomelanin": [0.55, 1] },
};
// Hair length in cm, by the word for where it ends.
export const HAIR_LENGTH = {
  bald: [0, 0], shaven: [0, 0.5], cropped: [0.5, 3], "close-cropped": [0.5, 3], short: [1, 12],
  "collar-length": [12, 25], "shoulder-length": [25, 40], long: [40, 80], "very long": [80, 150], "waist-length": [70, 100],
};
export const HAIR_TEXTURE = { straight: [0, 0.12], wavy: [0.25, 0.45], curly: [0.5, 0.75], coily: [0.8, 1], kinky: [0.8, 1] };

// Body words. Build reads as adiposity and muscularity together.
export const BODY = {
  fat: { "body.adiposity": { v: [0.65, 1] } }, stout: { "body.adiposity": { v: [0.55, 0.85] } }, plump: { "body.adiposity": { v: [0.5, 0.75] } },
  portly: { "body.adiposity": { v: [0.55, 0.85] } }, corpulent: { "body.adiposity": { v: [0.75, 1] } },
  thin: { "body.adiposity": { v: [0, 0.18] } }, skinny: { "body.adiposity": { v: [0, 0.12] } }, slim: { "body.adiposity": { v: [0.08, 0.28] } },
  slender: { "body.adiposity": { v: [0.08, 0.28] } }, gaunt: { "body.adiposity": { v: [0, 0.08] } }, lean: { "body.adiposity": { v: [0.05, 0.22] } },
  muscular: { "body.muscularity": { v: [0.65, 1] } }, brawny: { "body.muscularity": { v: [0.7, 1] } }, burly: { "body.muscularity": { v: [0.6, 1] }, "body.adiposity": { v: [0.4, 0.8] } },
  wiry: { "body.muscularity": { v: [0.4, 0.7] }, "body.adiposity": { v: [0, 0.15] } }, frail: { "body.muscularity": { v: [0, 0.18] }, "body.adiposity": { v: [0, 0.25] } },
  tall: { "body.stature": { q: [0.85, 1] } }, short: { "body.stature": { q: [0, 0.15] } }, giant: { "body.stature": { q: [0.999, 1] } },
  petite: { "body.stature": { q: [0, 0.2] }, "body.adiposity": { v: [0.05, 0.35] } },
  "broad-shouldered": { "body.shoulderWidth": { q: [0.85, 1] } }, "narrow-shouldered": { "body.shoulderWidth": { q: [0, 0.15] } },
  hunchbacked: { "body.spine.kyphosis": { v: [0.6, 1] } }, stooped: { "posture.stoop": { v: [0.5, 1] } },
};
// Words for kind of person: sex and age together. Ages in years.
export const PERSON = {
  man: { sex: ["male"], age: [18, 100] }, woman: { sex: ["female"], age: [18, 100] }, lady: { sex: ["female"], age: [18, 100] },
  gentleman: { sex: ["male"], age: [18, 100] }, boy: { sex: ["male"], age: [0, 17.999] }, girl: { sex: ["female"], age: [0, 17.999] },
  lad: { sex: ["male"], age: [10, 25] }, lass: { sex: ["female"], age: [10, 25] }, child: { age: [2, 12] }, baby: { age: [0, 1.5] },
  infant: { age: [0, 1.5] }, toddler: { age: [1, 3] }, youth: { age: [13, 20] }, teenager: { age: [13, 19] },
  person: {}, figure: {}, stranger: {},
  barmaid: { sex: ["female"], age: [15, 45] }, // a trade word: sex and age only for now; trades shape wardrobe in M3
};
export const AGE_WORD = {
  old: [60, 100], elderly: [65, 100], aged: [70, 100], ancient: [85, 100], "middle-aged": [40, 60], young: [16, 30], youthful: [16, 30],
};

// Face phrases: each names traits with a direction; the intensifier's band applies to the first trait and a softer
// band to the rest, so "a very big nose" is mostly long and projecting and somewhat wide.
export const FACE = {
  "big nose": [["nose.length", high], ["nose.tipProjection", high], ["nose.width", high, softer]],
  "large nose": [["nose.length", high], ["nose.tipProjection", high], ["nose.width", high, softer]],
  "small nose": [["nose.length", low], ["nose.width", low, softer]],
  "long nose": [["nose.length", high]], "short nose": [["nose.length", low]],
  "broad nose": [["nose.width", high]], "wide nose": [["nose.width", high]], "narrow nose": [["nose.width", low]],
  "hooked nose": [["nose.dorsum", high]], "hawk nose": [["nose.dorsum", high], ["nose.length", high, softer]], "roman nose": [["nose.dorsum", high]],
  "snub nose": [["nose.tipRotation", high], ["nose.length", low, softer]], "upturned nose": [["nose.tipRotation", high]],
  "button nose": [["nose.length", low], ["nose.tipShape", high, softer]], "bulbous nose": [["nose.tipShape", high]],
  "big ears": [["ears.size", high]], "large ears": [["ears.size", high]], "small ears": [["ears.size", low]],
  "jug ears": [["ears.protrusion", high]], "sticking-out ears": [["ears.protrusion", high]],
  "strong jaw": [["jaw.width", high], ["jaw.angle", high, softer]], "square jaw": [["jaw.angle", high], ["jaw.width", high, softer]],
  "weak chin": [["chin.prominence", low]], "receding chin": [["chin.prominence", low]], "jutting chin": [["chin.prominence", high]],
  "full lips": [["mouth.upperLip", high], ["mouth.lowerLip", high]], "thin lips": [["mouth.upperLip", low], ["mouth.lowerLip", low]],
  "wide mouth": [["mouth.width", high]], "small mouth": [["mouth.width", low]],
  "high cheekbones": [["cheeks.bones", high]], "hollow cheeks": [["cheeks.fullness", low]], "round face": [["face.fat", high], ["head.length", low, softer]],
  "close-set eyes": [["eyes.spacing", low]], "wide-set eyes": [["eyes.spacing", high]], "big eyes": [["eyes.size", high]], "large eyes": [["eyes.size", high]],
  "small eyes": [["eyes.size", low]], "deep-set eyes": [["eyes.depth", low]], "hooded eyes": [["eyes.lidFold.crease", high]],
  "heavy brow": [["forehead.browRidge", high]], "high forehead": [["forehead.height", high]], "low forehead": [["forehead.height", low]],
  "long face": [["head.length", high]], "long neck": [["body.neckLength", high]], "short neck": [["body.neckLength", low]],
  "bushy eyebrows": [["brows.thickness", high]], "thick eyebrows": [["brows.thickness", high]], "thin eyebrows": [["brows.thickness", low]],
};
// Adjective forms ("big-nosed", "long-necked") map onto the face phrases.
const ED = { nosed: "nose", eared: "ears", jawed: "jaw", lipped: "lips", eyed: "eyes", necked: "neck", chinned: "chin", browed: "brow" };

export const IRIS = { blue: [0, 0.15], grey: [0.1, 0.25], gray: [0.1, 0.25], green: [0.25, 0.45], hazel: [0.4, 0.6], brown: [0.6, 0.9], "dark brown": [0.85, 1], dark: [0.75, 1] };
export const SKIN = {
  pale: [0, 0.12], "very pale": [0, 0.06], fair: [0, 0.15], light: [0.05, 0.22], olive: [0.25, 0.45], tanned: null,
  brown: [0.45, 0.7], "dark-skinned": [0.6, 1], dark: [0.6, 1], black: [0.75, 1], ruddy: null, freckled: null,
};
const SKIN_EXTRA = { ruddy: [["skin.redness", { v: [0.6, 1] }]], freckled: [["skin.freckles", { v: [0.45, 1] }]], tanned: [["skin.tan", { v: [0.4, 1] }]] };

// Facial hair and other grooming words, as categorical constraints.
const BEARD = {
  bearded: ["full", "long full", "goatee", "van dyke", "chinstrap", "mutton chops"], "full beard": ["full", "long full"], "long beard": ["long full"], beard: ["full", "long full", "goatee", "van dyke", "chinstrap", "mutton chops"],
  "clean-shaven": ["clean"], moustache: ["moustache"], mustache: ["moustache"], moustached: ["moustache"],
  goatee: ["goatee"], chinstrap: ["chinstrap"], stubble: ["stubble"], stubbled: ["stubble"], "mutton chops": ["mutton chops"], "van dyke": ["van dyke"],
};

// Wardrobe words. Garments are objects worn by the person (pattern-buffer's E3) and are realised by the rough 1660
// wardrobe (R5) and M3's kits; the resolver records them so the words survive.
export const GARMENTS = ["dress", "gown", "coat", "cloak", "hat", "periwig", "wig", "breeches", "apron", "cap", "bonnet", "shawl", "doublet", "jerkin", "shirt", "skirt", "petticoat", "boots", "shoes", "hood", "robe", "uniform", "livery", "smock", "waistcoat", "scarf", "gloves"];
export const COLOURS = ["red", "scarlet", "crimson", "blue", "navy", "green", "yellow", "black", "white", "grey", "gray", "brown", "purple", "violet", "pink", "orange", "gold", "golden", "silver", "cream", "tawny", "russet", "plain", "drab"];

// Head nouns: an adjective is read in the domain of the noun it describes ("red dress", "red hair"). Adjectives with
// no noun after them are read about the person ("tall", "pale", "blonde", "old").
const HEAD = {
  hair: "hair", haired: "hair", locks: "hair", tresses: "hair",
  eyes: "eyes", eyed: "eyes", skin: "skin", skinned: "skin", complexion: "skin",
  beard: "beard", bearded: "beard",
  nose: "nose", nosed: "nose", ears: "ears", eared: "ears", jaw: "jaw", jawed: "jaw", jawline: "jaw", chin: "chin", chinned: "chin",
  lips: "lips", lipped: "lips", mouth: "mouth", mouthed: "mouth", cheekbones: "cheekbones", cheeks: "cheeks", cheeked: "cheeks",
  forehead: "forehead", brow: "brow", browed: "brow", eyebrows: "eyebrows", brows: "eyebrows", neck: "neck", necked: "neck",
  face: "face", faced: "face", features: "features", shoulders: "shouldered", shouldered: "shouldered",
};
const HAIR_ONLY = new Set(["blonde", "blond", "auburn", "ginger", "brunette", "platinum blonde", "strawberry blonde", "dark blonde"]);
const GLUE = new Set(["a", "an", "the", "with", "and", "in", "of", "who", "has", "had", "wearing", "dressed", "her", "his", "their", "is", "was", "looking", "years", "year", "aged", "old-looking", "build", "built", "but", "very-"]);
const INT_WORDS = Object.keys(INTENSITY).filter(Boolean).sort((a, b) => b.split(" ").length - a.split(" ").length);

function tokenize(text) {
  return text.toLowerCase().replace(/[.,;:!?()"]/g, " , ")
    .replace(/\b(\d+)-year-old\b/g, "$1 years")
    .replace(/\b([a-z]+)-(haired|eyed|skinned|nosed|eared|jawed|chinned|lipped|mouthed|cheeked|browed|necked|faced)\b/g, "$1 $2")
    .replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

// Read one adjective (with its intensifier band) about a head noun. Returns a list of [trait, constraint] or null.
function readAdjective(adj, band, intensified, head) {
  const face = (phrase) => FACE[phrase] && FACE[phrase].map(([t, dir, soft]) => [t, { q: soft ? soft(dir(band)) : dir(band) }]);
  switch (head) {
    case "hair":
      if (HAIR_COLOUR[adj]) return Object.entries(HAIR_COLOUR[adj]).map(([t, v]) => [t, { v }]);
      if (HAIR_LENGTH[adj] && !(adj === "long" && band[0] >= 0.97)) return [["hair.length", { v: HAIR_LENGTH[adj] }]];
      if (adj === "long") return [["hair.length", { v: HAIR_LENGTH["very long"] }]];
      if (HAIR_TEXTURE[adj]) return [["hair.texture", { v: HAIR_TEXTURE[adj] }]];
      if (adj === "grey" || adj === "gray" || adj === "white" || adj === "silver" || adj === "greying") return [["age", { v: adj === "greying" ? [35, 60] : [55, 100] }]];
      if (adj === "thick") return [["hair.density", { v: [0.75, 1] }]];
      if (adj === "thin" || adj === "thinning") return [["hair.density", { v: [0, 0.4] }]];
      if (adj === "wild" || adj === "bushy" || adj === "unkempt") return [["hair.wild", { v: [0.6, 1] }]];
      return null;
    case "eyes":
      if (IRIS[adj]) return [["iris.melanin", { v: IRIS[adj] }]];
      return face(`${adj} eyes`);
    case "skin":
      if (SKIN_EXTRA[adj]) return SKIN_EXTRA[adj].map(([t, c]) => [t, c]);
      if (SKIN[adj]) return [["skin.melanin", { v: SKIN[adj] }]];
      return null;
    case "beard":
      if (adj === "long") return [["beard.style", { in: ["long full"] }]];
      if (adj === "full" || adj === "thick" || adj === "bushy") return [["beard.style", { in: ["full", "long full"] }]];
      if (adj === "short" || adj === "trimmed" || adj === "neat") return [["beard.style", { in: ["full", "goatee", "van dyke", "chinstrap"] }]];
      if (HAIR_COLOUR[adj]) return Object.entries(HAIR_COLOUR[adj]).map(([t, v]) => [t, { v }]); // v0: beard follows hair
      if (adj === "grey" || adj === "gray" || adj === "white") return [["age", { v: [50, 100] }]];
      return null;
    case "shouldered": return BODY[`${adj}-shouldered`] ? Object.entries(BODY[`${adj}-shouldered`]).map(([t, c]) => [t, c.q ? { q: c.q[0] >= 0.5 ? band : low(band) } : c]) : null;
    case "brow": return face(`${adj} brow`);
    case "features": case "face":
      // Masculine–feminine words are absolute, not relative to sex: a "feminine face" on a man is feminine.
      if (["feminine", "delicate", "soft", "pretty"].includes(adj)) return [["face.MF", { v: band[0] >= 0.97 ? [1.5, 3] : [0.5, 3] }]];
      if (["masculine", "rugged", "mannish", "craggy"].includes(adj)) return [["face.MF", { v: band[0] >= 0.97 ? [-3, -1.5] : [-3, -0.5] }]];
      return face(`${adj} ${head === "features" ? "features" : "face"}`);
    case "lips": return face(`${adj} lips`);
    case "eyebrows": return face(`${adj} eyebrows`);
    default: return face(`${adj} ${head}`);
  }
}

// Read an adjective said about the whole person ("tall", "pale", "blonde", "old", "bearded").
function readPersonAdjective(adj, band, intensified) {
  if (AGE_WORD[adj]) return [["age", { v: AGE_WORD[adj] }]];
  if (BODY[adj]) return Object.entries(BODY[adj]).map(([t, c]) => [t, c.q && intensified ? { q: c.q[0] >= 0.5 ? band : low(band) } : c]);
  if (HAIR_ONLY.has(adj)) return readAdjective(adj, band, intensified, "hair");
  if (SKIN_EXTRA[adj] || ["pale", "very pale", "dark-skinned", "olive", "swarthy"].includes(adj)) return readAdjective(adj === "swarthy" ? "olive" : adj, band, intensified, "skin");
  if (BEARD[adj]) return [["beard.style", { in: BEARD[adj] }]];
  if (adj === "bald" || adj === "balding") return [["hair.loss.pattern", { in: adj === "bald" ? ["Norwood 7", "total"] : ["Norwood 3", "Norwood 4", "Norwood 5"] }]];
  return null;
}

// Parse a description into constraints. Returns { constraints, garments, gaps }. `gaps` lists words with no
// descriptor: they go to the recipe's `other` field (the M6 build trigger) and are reported, never silently dropped.
export function parse(text) {
  const toks = tokenize(text);
  const constraints = [], garments = [], gaps = [];
  let i = 0;
  // pending adjectives: { words: [...], band, intensified, text }
  let pending = [];
  const flushAsPerson = () => {
    for (const a of pending) {
      const got = readPersonAdjective(a.adj, a.band, a.intensified);
      if (got) got.forEach(([t, c]) => constraints.push({ trait: t, ...c, word: a.text }));
      else gaps.push(a.text);
    }
    pending = [];
  };
  while (i < toks.length) {
    const t = toks[i];
    // a height: "six feet tall", "5 foot 4", "180 cm"
    const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    const num = (w) => (w !== undefined && /^\d+(\.\d+)?$/.test(w)) ? Number(w) : NUM[w];
    if (num(t) !== undefined && ["feet", "foot", "ft"].includes(toks[i + 1])) {
      let cm = num(t) * 30.48, j = i + 2, w = `${t} ${toks[i + 1]}`;
      if (num(toks[j]) !== undefined) { cm += num(toks[j]) * 2.54; w += ` ${toks[j]}`; j++; if (["inches", "inch", "in"].includes(toks[j])) j++; }
      if (toks[j] === "tall") j++;
      flushAsPerson(); constraints.push({ trait: "body.height", v: [cm - 1.5, cm + 1.5], word: w }); i = j; continue;
    }
    if (num(t) !== undefined && ["cm", "centimetres", "centimeters"].includes(toks[i + 1])) {
      const cm = num(t); flushAsPerson(); constraints.push({ trait: "body.height", v: [cm - 1, cm + 1], word: `${t} cm` }); i += toks[i + 2] === "tall" ? 3 : 2; continue;
    }
    // months: "8 months old", "a baby of 8 months"
    if (num(t) !== undefined && ["months", "month"].includes(toks[i + 1])) {
      const m = num(t); flushAsPerson(); constraints.push({ trait: "age", v: [m / 12, (m + 0.999) / 12], word: `${t} months old` }); i += toks[i + 2] === "old" ? 3 : 2; continue;
    }
    // a number of years
    if (/^\d+$/.test(t) && Number(t) <= 120) { flushAsPerson(); constraints.push({ trait: "age", v: [Number(t), Number(t) + 0.999], word: `${t} years old` }); i += toks[i + 1] === "years" ? 2 : 1; if (toks[i] === "old") i++; continue; }
    // person nouns, two words first ("old man" is adjective + noun)
    if (PERSON[t]) {
      flushAsPerson();
      const d = PERSON[t];
      if (d.sex) constraints.push({ trait: "sex", in: d.sex, word: t });
      if (d.age) constraints.push({ trait: "age", v: d.age, word: t });
      i++; continue;
    }
    // multi-word beard and garment heads
    if (t === "mutton" && toks[i + 1] === "chops") { flushAsPerson(); constraints.push({ trait: "beard.style", in: ["mutton chops"], word: "mutton chops" }); i += 2; continue; }
    if (t === "van" && toks[i + 1] === "dyke") { flushAsPerson(); constraints.push({ trait: "beard.style", in: ["van dyke"], word: "van dyke" }); i += 2; continue; }
    if (t === "clean-shaven") { constraints.push({ trait: "beard.style", in: ["clean"], word: t }); i++; continue; }
    if (BEARD[t] && t !== "beard" && t !== "bearded") { constraints.push({ trait: "beard.style", in: BEARD[t], word: t }); i++; continue; }
    if (GARMENTS.includes(t)) {
      const colours = pending.filter(a => COLOURS.includes(a.adj)).map(a => a.adj);
      const others = pending.filter(a => !COLOURS.includes(a.adj));
      pending = others; flushAsPerson();
      garments.push({ slot: t === "wig" ? "periwig" : t, colour: colours.length ? colours.join(" ") : null, word: [...colours, t].join(" ") });
      i++; continue;
    }
    if (HEAD[t]) {
      const head = HEAD[t];
      if (!pending.length && head === "beard") { constraints.push({ trait: "beard.style", in: BEARD[t] || BEARD.beard, word: t }); i++; continue; }
      for (const a of pending) {
        const got = readAdjective(a.adj, a.band, a.intensified, head);
        if (got) got.forEach(([tr, c]) => constraints.push({ trait: tr, ...c, word: `${a.text} ${t}` }));
        else gaps.push(`${a.text} ${t}`);
      }
      if (head === "beard" && !constraints.some(c => c.trait === "beard.style")) constraints.push({ trait: "beard.style", in: BEARD.beard, word: t });
      pending = []; i++; continue;
    }
    if (t === ",") { flushAsPerson(); i++; continue; } // a comma ends a run of adjectives
    if (GLUE.has(t)) {
      // "with" and "and" end a run of person adjectives only if no head noun follows later in the run
      i++; continue;
    }
    // intensifier + adjective (adjectives may be two words: "dark brown", "platinum blonde")
    let band = INTENSITY[""], intensified = false, text = "";
    for (const w of INT_WORDS) {
      const n = w.split(" ").length;
      if (toks.slice(i, i + n).join(" ") === w) { band = INTENSITY[w]; intensified = true; text = w + " "; i += n; break; }
    }
    if (i >= toks.length) { gaps.push(text.trim()); break; }
    const two = `${toks[i]} ${toks[i + 1] || ""}`;
    const isTwo = HAIR_COLOUR[two] || IRIS[two] || SKIN[two] || HAIR_LENGTH[two];
    const adj = isTwo ? two : toks[i];
    i += isTwo ? 2 : 1;
    pending.push({ adj, band, intensified, text: text + adj });
  }
  flushAsPerson();
  return { constraints, garments, gaps };
}
