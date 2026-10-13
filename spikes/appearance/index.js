// Spike "appearance" (M1, R2): how much of "a real, distinct person" can an appearance layer made in code add to the
// MakeHuman base at small cost? It takes spikes/makehuman's baked, clothed body as it is (by import, unedited) and adds:
//   skin    a TSL material: regional warmth and coolness, mottling, freckles, age spots, wrapped soft lighting (skin.js)
//   face    brows, the lash line, lips and facial hair, painted in the same material from the rest frame (skin.js)
//   eyes    one sphere each with a structured iris, a wet surface and a catchlight (eyes.js)
//   hair    six forms from the seed, sex and age, built from the person's own scalp (hair.js)
// Everything comes from the recipe and the seed (look.js); no texture is loaded or painted. The base layer stays on.
// The person's values go into one row of a shared parameter texture (params.js), so every material is compiled once
// per tier and shared: near (all detail), mid (one noise octave, no freckles), far (no noise). setTier() switches;
// tierFor(distance) is the default switch (near under 3 m, mid under 8 m).
import { build as buildBody } from "../makehuman/index.js";
import { REST_DRAWN, UVN } from "./rest.js";
import { look } from "./look.js";
import { register } from "./params.js";
import { skinMaterial } from "./skin.js";
export { bakeSkin, disposeBake, releaseBakeScratch } from "./bake.js";
import { addEyes, eyeMaterial } from "./eyes.js";
import { addHair, hairTier } from "./hair.js";

let restAttr = null;   // one shared attribute for every person's body
export const tierFor = (d) => d < 3 ? "near" : d < 8 ? "mid" : "far";

export function build(THREE, r, tier = "near") {
  const t0 = performance.now();
  const g = buildBody(THREE, r);
  const t1 = performance.now();
  const lk = look(r);
  const body = g.children[0];
  if (!g.getObjectByName("base-layer")) throw new Error("appearance: no base layer; refusing to draw an unclothed person");
  restAttr ??= new THREE.BufferAttribute(REST_DRAWN, 3);
  if (body.geometry.attributes.position.count !== UVN) throw new Error("appearance: body topology differs from the rest frame");
  body.geometry.setAttribute("rest", restAttr);
  body.material.dispose();
  const trisBefore = count(g);
  addEyes(THREE, g, tier);
  const hair = addHair(THREE, g, lk, tier);
  const row = register(THREE, lk);
  g.traverse(o => { if (o.isMesh) o.userData.row = row; });
  setTier(THREE, g, tier);
  const ms = performance.now() - t0;
  g.userData = { bodyMs: t1 - t0, appearanceMs: ms - (t1 - t0), hairMs: hair.ms, hairTriangles: hair.triangles,
    addedTriangles: count(g) - trisBefore, look: lk, row, tier };
  console.log(`appearance: age ${r.age} ${lk.male ? "m" : "f"} hair ${lk.hair.form}/${lk.hair.name} beard ${lk.beard}: ` +
    `hair ${hair.triangles} tris, look ${g.userData.appearanceMs.toFixed(1)} ms (hair ${hair.ms.toFixed(1)})`);
  return g;
}

// swap a person's skin, eye and hair materials to a tier (shared materials: no compile after the first of each)
export function setTier(THREE, g, tier) {
  const base = g.getObjectByName("base-layer");
  g.children[0].material = tier === "near" && g.userData.skinBake ? g.userData.skinBake.material : skinMaterial(THREE, tier);   // near: the baked paint, once the person has one (bake.js)
  g.traverse(o => { if (o.name === "eye") o.material = eyeMaterial(THREE, tier); });
  hairTier(THREE, g, tier);
  if (base) { base.visible = true; base.renderOrder = -1; }   // occluders first, so early depth skips the skin under clothes (R9 phone run)
  g.userData.tier = tier;
}
function count(g) {
  let n = 0;
  g.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return n;
}
