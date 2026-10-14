// Spike "hair" (M1, R2): the hair rebuild's entry. Kabe, 2026-10-11, on the old hair (spikes/appearance/hair.js): "That
// hair is pretty bad tbh"; on the rebuild: "focus on quality in performance constraints", "Alright take its best and lets
// make it elegent". One pipeline, compiled once per person at build, nothing per frame but the force:
//   constraints or recipe --style.js--> record --rules.js--> layers --grow.js--> guides --cards.js--> one geometry
//   atlas.js (painted once, shared) + vendor/hair-shader.js (MIT) --shade.js--> one material set per tier
//   motion.js: a force per person (CPU, a pendulum) bends what hangs free (GPU)
// Tiers differ only by card density and lobe count (rules.js counts, shade.js lobes). Facial hair is the same pipeline
// on the face. The person is spikes/appearance's (body, skin, eyes; imported, not edited); its old hair is removed, and
// the person's row in appearance's shared table (params.js) gets the hair's colour, greying, scalp and facial values, so
// the scalp under the cards, the brows and the beard's painted fill agree with the hair.
//   build(THREE, renderer, recipe, tier) -> person      recipe.hair: constraints (words or exact values) for resolveHair
//   addHair(THREE, renderer, person, record, tier) -> group      swatch(record) -> per-instance values
//   crowd(THREE, renderer, farTemplateGeometry, swatches, places) -> one instanced mesh for many wearers
//   moveHair(person, dt) -> steps the person's force from their transform (call once a frame for people who move)
import { build as buildPerson } from "../appearance/index.js";
import { paramTexture, COLS } from "../appearance/params.js";
import { resolveHair, colours } from "./style.js";
import { plan } from "./rules.js";
import { head, grow } from "./grow.js";
import { cards } from "./cards.js";
import { hairMaterials } from "./shade.js";
import { motion, step } from "./motion.js";

export { resolveHair, describeHair, fitsWords, STYLES, WORDS } from "./style.js";

// the per-instance swatch in the vendored crowd format, plus Photonic's hairLook (grey fraction)
export function swatch(h) {
  const { tip } = colours(h);
  return {
    gccTip: tip, gccRootA: [0, 0, 0, 0],                                  // mono: the root is the tip darkened by gccRootB.y
    gccRootB: [1, 0.8, 1.45, 0.28 + 0.45 * h.curl * h.curl],               // root strength, root darkening, density, roughness floor
    hairLook: [h.grey, 1 - 0.85 * Math.min(1, Math.max(0, (h.curl - 0.6) / 0.3)), 0, 0],   // grey fraction, sheen
  };
}

// the per-instance values in one interleaved buffer (a pipeline gets 8 vertex buffers on WebGPU; this is one): the
// vendored swatch (gccTip, gccRootA, gccRootB), Photonic's hairLook and, for a crowd, hairPlace (x, z, yaw, scale); the
// force in a buffer of its own, the only thing written per frame. One person is a list of one; a crowd, of hundreds.
export function instanceValues(THREE, geo, swatches, places = null) {
  const S = places ? 19 : 15, n = swatches.length, arr = new Float32Array(n * S);
  swatches.forEach((w, i) => arr.set([...w.gccTip, ...w.gccRootA, ...w.gccRootB, ...w.hairLook, ...(places ? places[i] : [])], i * S));
  const buf = new THREE.InstancedInterleavedBuffer(arr, S), at = (name, size, off) => geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, size, off));
  at("gccTip", 3, 0); at("gccRootA", 4, 3); at("gccRootB", 4, 7); at("hairLook", 4, 11); if (places) at("hairPlace", 4, 15);
  const force = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); force.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("hairForce", force);
  return force;
}
// the crowd path: one far-tier template, instanced for many wearers in one draw (their swatches, places and forces)
export function crowd(THREE, renderer, template, swatches, places) {
  const geo = new THREE.InstancedBufferGeometry();
  for (const k of ["position", "normal", "tangent", "uv", "hair", "pivot"]) geo.setAttribute(k, template.getAttribute(k));
  geo.setIndex(template.index); geo.instanceCount = swatches.length;
  const force = instanceValues(THREE, geo, swatches, places);
  const mesh = new THREE.Mesh(geo, hairMaterials(THREE, renderer, "far", { crowd: true }).outer); mesh.frustumCulled = false;
  mesh.userData.force = force;
  return mesh;
}

const FORM = { crop: "cropped", short: "short", bald: "bald", bob: "loose", long: "loose", tied: "tied", afro: "short" };

export function build(THREE, renderer, r, tier = "near") {
  const h = r.hairRecord ?? resolveHair(r.hair ?? {}, r);
  if (h.refused) throw new Error("hair: " + h.refused);
  // appearance's own look decides its scalp paint by form; tell it ours, then overwrite the hair columns exactly
  const g = buildPerson(THREE, { ...r, hairForm: FORM[h.cut], beard: h.beard > 0 ? "beard" : h.moustache > 0 ? "moustache" : "none" }, tier);
  for (const o of [...g.children]) if (o.name === "hair") { g.remove(o); o.geometry.dispose(); }
  const { tex, data } = paramTexture(THREE), W = tex.image.width, row = g.userData.row;
  const set = (col, v) => data.set(v, (row * W + col) * 4);
  const { tip } = colours(h);
  set(COLS.hair, [...tip, h.grey]);
  set(COLS.scalp, [h.recede, h.cut === "bald" ? 0.55 : 1, h.cut === "bald" ? 1 : 0, h.male && h.age >= 17 ? (h.beard > 0 || h.moustache > 0 ? 0.35 : 0.22) : 0]);
  set(COLS.facial, [h.beard > 0 || h.moustache > 0 ? 1 : 0, h.beard > 0 ? 0 : 1, h.age, 0]);
  const bw = data[(row * W + COLS.brow) * 4 + 3];
  set(COLS.brow, [...tip.map((c, k) => c * 0.75 + [0.74, 0.71, 0.66][k] * Math.max(0, h.grey - 0.3) * 0.5), bw]);
  tex.needsUpdate = true;
  addHair(THREE, renderer, g, h, tier);
  return g;
}

export function addHair(THREE, renderer, person, h, tier = "near") {
  const t0 = performance.now();
  const H = head(person), P = plan(h, tier), t1 = performance.now();
  const guides = grow(H, P, h.seed), t2 = performance.now();
  const geo = cards(THREE, guides, { flat: tier === "far" }), t3 = performance.now();
  const force = instanceValues(THREE, geo, [swatch(h)]);
  const { outer, blend } = hairMaterials(THREE, renderer, tier);
  const group = new THREE.Group(); group.name = "hair-cards";
  const mesh = new THREE.Mesh(geo, outer); mesh.name = "hair-cards"; mesh.frustumCulled = false; group.add(mesh);
  if (blend) { const f = new THREE.Mesh(geo, blend); f.name = "hair-fringe"; f.frustumCulled = false; f.renderOrder = 1; group.add(f); }
  for (const m of group.children) { m.castShadow = false; m.receiveShadow = false; m.userData.row = person.userData.row; }
  person.add(group);
  const stats = { cards: geo.userData.cards, triangles: geo.userData.triangles, draws: group.children.length,
    planMs: +(t1 - t0).toFixed(1), growMs: +(t2 - t1).toFixed(1), cardsMs: +(t3 - t2).toFixed(1), layers: P.layers.map(l => `${l.name}:${l.count}x${l.segs}`) };
  person.userData.hair = { record: h, tier, group, force, motion: motion(), stats };
  return group;
}

// step a person's force from their transform (the head's motion: the person's own until there is a rig)
export function moveHair(person, dt) {
  const hd = person.userData.hair; if (!hd) return;
  const f = step(hd.motion, person.position.x, person.position.y, person.position.z, person.rotation.y, dt);
  hd.force.array.set(f); hd.force.needsUpdate = true;
}
