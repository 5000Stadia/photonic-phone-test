// Spike "appearance" (M1, R2): every person's appearance values in one small float texture, a row per person, so the
// skin, hair and eye materials are each compiled once and shared by everyone. A mesh says which row is its person through
// a per-object uniform (object.userData.row, read as each object is drawn); an instanced crowd would read the row from
// instanceIndex instead, with no other change. Colours are stored linear.
export const COLS = {
  skin: 0, lip: 1, brow: 2, hair: 3, browShape: 4, marks: 5, scalp: 6, facial: 7, iris: 8, cap: 9,
};
// .w of the colour columns, and the scalar columns:
//   skin.w blush · lip.w lip fullness · brow.w brow thickness · hair.w grey · iris.w unused · cap.w 1 for a man's cap
//   browShape: arch, lift, gap, density · marks: freckles, mottle, spots, shift (noise offset)
//   scalp: recede, scalp paint density, bald (0/1), stubble · facial: beard (0/1), moustache only (0/1), age, form id
const W = 16, ROWS = 1024;
const FORMS = ["bald", "cropped", "short", "tied", "loose", "coif"];

let table = null, next = 0;
export function paramTexture(THREE) {
  if (table) return table;
  const data = new Float32Array(W * ROWS * 4);
  const tex = new THREE.DataTexture(data, W, ROWS, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  table = { tex, data };
  return table;
}

// write a person's look into the next free row; returns the row
export function register(THREE, lk) {
  const { tex, data } = paramTexture(THREE);
  const row = next++ % ROWS;
  const set = (col, v) => data.set(v, (row * W + col) * 4);
  const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  set(COLS.skin, [...lin(lk.skin.color), lk.skin.blush]);
  set(COLS.lip, [...lin(lk.lips.color), lk.lips.full]);
  set(COLS.brow, [...lin(lk.brows.color), lk.brows.thick]);
  set(COLS.hair, [...lin(lk.hair.color), lk.hair.grey]);
  set(COLS.browShape, [lk.brows.arch, lk.brows.lift, lk.brows.gap, lk.brows.density]);
  set(COLS.marks, [lk.skin.freckles, lk.skin.mottle, lk.skin.spots, lk.skin.shift]);
  set(COLS.scalp, [lk.hair.recede, { bald: 0.55, cropped: 0.92 }[lk.hair.form] ?? 1, lk.hair.form === "bald" ? 1 : 0,
    { none: 0, stubble: 1, moustache: 0.35, beard: 0.35 }[lk.beard]]);
  set(COLS.facial, [lk.beard === "moustache" || lk.beard === "beard" ? 1 : 0, lk.beard === "moustache" ? 1 : 0, lk.age, FORMS.indexOf(lk.hair.form)]);
  set(COLS.iris, [...lin(lk.eyes.iris), 0]);
  set(COLS.cap, [...lin(lk.hair.capColor), lk.male ? 1 : 0]);
  tex.needsUpdate = true;
  return row;
}

// node for column col of the drawn object's person (cached per THREE so every material shares one uniform per column)
const cache = new WeakMap();
export function param(THREE, col) {
  const T = THREE.TSL;
  let c = cache.get(THREE);
  if (!c) {
    const { tex } = paramTexture(THREE);
    const row = T.uniform(0).onObjectUpdate(({ object }) => object.userData.row ?? 0);
    c = { tex, row, cols: {} };
    cache.set(THREE, c);
  }
  return c.cols[col] ??= T.textureLoad(c.tex, T.ivec2(T.int(col), T.int(c.row))).toVar();
}
