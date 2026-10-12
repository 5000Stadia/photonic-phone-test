// Spike "appearance" (M1, R2): the rest frame. Every person on the MakeHuman base shares one topology, so a vertex's
// position on the unbaked base mesh (decimetres, the base's own frame) is a coordinate that means the same place on
// everyone: "the left cheek apex", "the brow ridge". The skin, brow, lash, lip and hair masks are all written in it.
// It is read once from spikes/makehuman's packed data (the same file, so the browser cache serves it) and shared by
// every person as one BufferAttribute: zero bytes per person.
const DATA = new URL("../makehuman/data/", import.meta.url);
const H = await (await fetch(new URL("body.json", DATA))).json();
const gz = await (await fetch(new URL("body.bin.gz", DATA))).body.pipeThrough(new DecompressionStream("gzip"));
const buf = await new Response(gz).arrayBuffer();

export const BODY = Math.min(H.eyes.l[0], H.eyes.r[0]);          // drawn body vertices come first
export const REST = new Float32Array(buf, 0, BODY * 3);           // rest positions of the body, decimetres
export const INDEX = new Uint16Array(buf, H.vertices * 12, H.triangles * 3);
const ALL = new Float32Array(buf, 0, H.vertices * 3);

// Landmarks on the base mesh, decimetres, left side (+x); masks mirror with |x|. Read off base.obj's wireframe and
// joint cubes (scratch analysis, not shipped): the eye helper's centre and radius are computed here from the data.
function sphereOf([start, n]) {
  const c = [0, 0, 0];
  for (let i = start; i < start + n; i++) for (let k = 0; k < 3; k++) c[k] += ALL[3 * i + k] / n;
  let r = 0;
  for (let i = start; i < start + n; i++) r += Math.hypot(ALL[3 * i] - c[0], ALL[3 * i + 1] - c[1], ALL[3 * i + 2] - c[2]) / n;
  return { c, r };
}
const eye = sphereOf(H.eyes.l);
export const L = {
  eye: eye.c, eyeR: eye.r,              // (0.308, 7.284, 1.245), r 0.150
  mouth: [0, 6.613, 1.6], mouthHalf: 0.25,
  noseTip: [0, 6.91, 1.68],
  crown: 8.49, chin: 6.15,
  ear: [0.8, 7.25, 0.5],
  headC: [0, 7.55, 0.55],
};

// The scalp: body triangles that any hair form may cover (a superset; each form trims it by its own hairline).
// Everything on the head above the face and ears' lower edge, and the nape.
export const SCALP = (() => {
  const keep = [];
  for (let t = 0; t < INDEX.length; t += 3) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const i = INDEX[t + k], x = REST[3 * i], y = REST[3 * i + 1], z = REST[3 * i + 2];
      if (!(y > 6.45 && (y > 7.6 || z < 0.95 || Math.abs(x) > 0.6))) { ok = false; break; }
      if (y < 7.0 && z > 0.6) { ok = false; break; }      // not the jaw or neck front
    }
    if (ok) keep.push(INDEX[t], INDEX[t + 1], INDEX[t + 2]);
  }
  return new Uint16Array(keep);
})();
