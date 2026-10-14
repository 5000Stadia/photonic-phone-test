// Spike "appearance" (M1, R2): a person's look, from the recipe and seed. Anything the recipe states is kept; the rest
// is drawn deterministically from the seed, with sex, age and skin shaping the odds. This stands in for R3's trait
// matrix: the fields here are what the appearance layer needs a recipe to say.
//   hair: { form, color, grey }   form: bald | cropped | short | tied | loose | coif
//   brows: { color, thick, arch, lift, gap }   eyes: { iris }   lips: { color, full }
//   skin: { color, blush, freckles, mottle, spots }   beard: none | stubble | moustache | beard
export function rng(seed, salt = 0) {
  let a = (seed * 2654435761 + salt * 40503 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (R, table) => {          // table: [[value, weight], ...]
  let s = 0; for (const [, w] of table) s += w;
  let u = R() * s;
  for (const [v, w] of table) if ((u -= w) <= 0) return v;
  return table[table.length - 1][0];
};
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const toHex = (c) => "#" + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const jitter = (R, c, amt) => { const k = 1 + (R() - 0.5) * amt; return c.map(v => v * k); };

// sRGB hair colours (natural ranges), the odds shaped by skin lightness
const HAIR = {
  black: "#1c1714", darkBrown: "#33241a", brown: "#5a3d26", lightBrown: "#8a6440",
  blonde: "#b8915c", fair: "#d6b98a", auburn: "#7a3a1e", red: "#a14a22",
};
const IRIS = { darkBrown: "#3a2414", brown: "#6b4325", hazel: "#7a6a35", green: "#5d7a45", grey: "#7d8a92", blue: "#4f7aa6" };

export function look(r) {
  const R = rng(r.seed, 7), age = r.age, male = r.sex >= 0.5;
  const skin = hex(r.skin), light = 0.2126 * skin[0] + 0.7152 * skin[1] + 0.0722 * skin[2];   // sRGB-ish lightness
  const pale = Math.min(1, Math.max(0, (light - 0.45) / 0.35));                                // 0 dark .. 1 very fair

  // hair colour: dark skins mostly black or dark brown; fair skins spread wider; children lighter than they'll be
  const hairName = r.hairColor ?? pick(R, [
    ["black", 0.25 + 1.2 * (1 - pale)], ["darkBrown", 0.35], ["brown", 0.3 + 0.2 * pale], ["lightBrown", 0.25 * pale],
    ["blonde", 0.22 * pale], ["fair", 0.08 * pale], ["auburn", 0.08 * pale], ["red", 0.06 * pale]]);
  let hc = hex(HAIR[hairName] ?? hairName);
  if (age < 12) hc = lerp(hc, hex("#c9a46a"), 0.35 * pale * (1 - age / 12));
  hc = jitter(R, hc, 0.18);
  const grey = r.grey ?? Math.min(1, Math.max(0, (age - 32 - R() * 14) / 38));

  // hair form: deterministic from seed, sex and age; cropped and short for most men, long or covered for most women
  const form = r.hairForm ?? (age < 2 ? "cropped"
    : male ? pick(R, age > 55 ? [["cropped", 3], ["short", 2], ["bald", 1.5 * (age - 55) / 30], ["coif", 0.7]]
                              : [["cropped", 2], ["short", 3], ["tied", age > 14 ? 0.6 : 0], ["loose", age > 14 ? 0.4 : 0.1], ["coif", 0.4]])
           : pick(R, age < 12 ? [["loose", 2], ["tied", 2], ["short", 0.8]]
                              : [["tied", 3], ["loose", 2], ["coif", age > 40 ? 2.5 : 1.2], ["short", 0.5]]));
  const recede = male && age > 25 ? Math.min(1, (age - 25) / 50) * (0.3 + R() * 0.9) : 0;

  const iris = r.iris ?? toHex(jitter(R, hex(IRIS[pick(R, [["darkBrown", 1.4 * (1 - pale) + 0.4], ["brown", 0.6], ["hazel", 0.3 * pale],
    ["green", 0.25 * pale], ["grey", 0.25 * pale], ["blue", 0.6 * pale]])]), 0.2));

  // brows: the hair's colour, a little darker; grey later than the hair; men's thicker, lower and flatter
  const browGrey = Math.max(0, grey - 0.25) * 0.8;
  const browC = lerp(hc.map(v => v * 0.8), [0.62, 0.6, 0.57], browGrey);
  const brows = {
    color: toHex(browC),
    thick: (male ? 0.055 : 0.042) * (0.8 + R() * 0.45) * (age < 8 ? 0.75 : 1),
    arch: (male ? 0.025 : 0.05) * (0.6 + R() * 0.8),
    lift: (R() - 0.5) * 0.04 - (male ? 0.012 : 0),
    gap: 0.08 + R() * 0.04,
    density: (age < 4 ? 0.35 : 0.75 + R() * 0.25) * (1 - 0.2 * pale * (hairName === "fair" || hairName === "blonde" ? 1 : 0)),
  };

  // lips: from the skin, redder and darker; fuller in the young, thinner with age
  const lipC = lerp(skin.map((v, i) => v * [0.9, 0.66, 0.66][i]), skin.map((v, i) => v * [0.8, 0.64, 0.68][i]), 1 - pale);
  const lips = { color: toHex(jitter(R, lipC, 0.12)), full: (male ? 0.85 : 1.05) * (0.85 + R() * 0.3) * (age > 50 ? 1 - (age - 50) / 120 : 1) };

  const beard = male && age >= 17 ? (r.beard ?? pick(R, [["none", 4], ["stubble", 2.5], ["moustache", 1.2], ["beard", 1.6 + (age > 40 ? 1 : 0)]])) : "none";

  return {
    age, male, pale,
    skin: {
      color: r.skin,
      blush: (age < 12 ? 0.75 : 0.45) * (0.6 + R() * 0.8) * (0.55 + 0.45 * pale),
      freckles: (hairName === "red" || hairName === "auburn" ? 0.9 : pale > 0.6 ? 0.35 : 0) * (R() < 0.55 ? 1 : 0.15) * (age < 3 ? 0 : 1),
      mottle: 0.5 + R() * 0.5 + (age > 60 ? 0.6 : 0),
      spots: age > 55 ? Math.min(1, (age - 55) / 30) * (0.4 + 0.6 * pale) : 0,
      shift: R() * 100,                                    // where on the noise field this person's skin is
    },
    hair: { form, color: toHex(hc), grey, recede, name: hairName, length: 0.85 + R() * 0.4,
      capColor: male ? pick(R, [["#3b3a3f", 1], ["#5a4a38", 1], ["#2e3a4a", 1], ["#6b2a22", 0.5]])
                     : pick(R, [["#ebe6da", 2], ["#ddd5c2", 1], ["#c9c2b4", 0.6], ["#b9b2a0", 0.4]]) },
    brows, eyes: { iris }, lips, beard,
  };
}
export { hex, toHex };
