import { cycleAt, needsWalkBake, advanceBakedPhase, canRebakeAtPhase, childCycles, closestCycle } from "./walk-cache.js";
import { desiredSpeed } from './pace-walk.js';
import { walkSample } from './walk-sample.js';
// The population's drawing (R4, R5; design/r4-plan.md, r5-plan.md): instanced draws, one per tier AND per outfit class, all reading one shared walk
// texture, so no tier can disagree about anyone's step. Two topologies: the reduced mesh (1.5k vertices) for far and mid, the full
// drawn body with its base layer and eyes (about 16k) for near.
//   far   the template body plus each person's coefficients on a 16-direction morph basis, at unit height, then an exact height
//         scale (C2c, R2's crowd probe; fitted by tools/people/far-fit.mjs on bodies after the rig's repose)
//   mid   each person's exact reduced rest shape, read from a texture of slots (C3t)
//   near  each person's exact full rest shape, from its own slot texture, since its vertex count differs
// Colour is per vertex (`paint`, from bodies.js): skin vertices take the person's own skin colour, cloth vertices (the base layer, as
// a flag on the reduced mesh and as its own vertices on the full body) take the garment tint, and eyes carry their own colour.
// The far tier's morph basis is fitted on the walking stance, so the three tiers stand alike; the bodies skin on the rig's 21 bones.
// Each frame, population.tick() sorts the seen into tiers; update() sorts each tier's people into CLASSES and writes each class's people into its agent texture
// (position, heading, phase, slots, tint, skin, and for a dressed class the garments' colours) and sets its count. People get a walk slot the first time they're seen:
// their own walker baked into 64 frames (src/people/walk.js), at most `bakeBudgetMs` of baking a frame.
//
// CLASSES (R5, design/r5-plan.md "The wardrobe"): a class is an outfit and which of its garments are worn: "base" (the base layer only: everyone with no outfit) or
// "gentlewoman:3" (outfit id : bit 0 the bodice, bit 1 the skirt; the gentleman's: bit 0 the doublet with its band and shirt, bit 1 his breeches, both in the baked shell, no skirt rings). One instanced draw per (tier, class), each person in the one they belong to this frame, so what she wears is
// state read every frame (wearMask in outfits.js): taking the bodice off moves her to another class's draw, with no rebake and no pop between tiers. A class is a vertex layout
// (garments/reduced.js outfitLayout: the body, then the bodice, then the skirt's rings) with its own index buffer (the triangles of what is worn; at mid and far with the
// body under the bodice cut out), built the first time someone is in it. The dressed classes of a tier share ONE material, so one program: what differs between outfits is data, not code (a vertex's part
// of the class mesh in skirtRC.w, one garment store a kind whose slot is as large as the largest outfit's bodice, the mesh's first row in the agent texture read per object), so a new outfit adds no program.
//   - the bodice is baked once on the CPU into a slot of its own beside the body's (near: from the full body through the binding; mid: from the exact reduced body; far: from
//     the reduced body the coefficients give, the same binding), so body and clothes cannot disagree;
//   - the skirt is not baked: it follows the pose (garments/skirt-tsl.js), its rings computed on the GPU from the person's bones in the walk texture, their spec from a row;
//   - near: the base layer's neck is cut by a per-vertex number in the body's slot (texel w), which the fragment shader discards on (layers: layer.js).
//   - her skirt's footprint is in the population's stepping-aside radius (rec.half), not here.

import { peopleQuality } from "./quality.js";
import { applySurface } from "./surface.js";
import { surfaceData } from "./surface-data.js";
import { makeContactShadow } from "./contact-shadow.js";
import { makeHairDraw } from "./hair-draw.js";
import { hairRegion } from "./hair.js";
import { Fn, If, texture, textureLoad, uniform, ivec2, int, float, vec2, vec3, vec4, attribute, instanceIndex, vertexIndex, positionLocal, normalLocal, cos, sin, varying, cross, mix, step, select } from "three/tsl";
import * as TSL from "three/tsl";
import { TEMPLATE, NEAR, B, morphBasis } from "./bodies.js";
import { bakePacedCycle, PACE_FRAMES } from "./walk.js";
import { half, bitsOf, packHalf } from "./half.js";
import { wearMask } from "./outfits.js";
import { UVN } from "../spikes/makehuman/index.js";
import { outfitLayout, bakeNear, bakeReduced, farReducedPositions } from "./garments/reduced.js";
import { OUTFITS } from "./garments/outfit.js";
import { makeSkirtGPU, writeSpecRow, SPEC_TEXELS } from "./garments/skirt-tsl.js";

const F = PACE_FRAMES, KT = 16, WALK_W = 2048, REST_W = 2048;
const TEXELS = 5, TEXELS_DRESSED = 8;      // plus a final hair RGB/enabled texel; the original four agent texels: [x, z, heading, phase], [walk slot, exact slot (far: hair slot), y, scale], tint, skin; a dressed one three more: [bodice rgb, spec row], [skirt rgb, bodice slot], [stockings rgb]
const MID_SKIRT = { rings: 16, around: 32 };    // mid's skirt: 32 columns (24 left up to 2.5 cm between it and near's 40 in a stride; 32 is within 1 cm: tools/people/switch-check.mjs)
const FAR_SKIRT = { rings: 16, around: 24 };    // the far class's skirt: 24 columns, no bridging (16 columns left 3.1 to 3.6% of a dressed person's pixels differing from mid's at 4 to 10 m, over check.mjs's 3%: the hem and the silhouette)
const LATER_AFTER_UPDATES = 4;               // compile()'s deferred classes start compiling this many frames in
const BAND_SHADE = 0.62;                   // kind 7's colour: the skirt's, this much of it (the working man's knee band)
const DRESSED_FAR_CAP = 512;                // dressed people drawn at far at most (each takes a skirt's rings in the passes' textures; a class of two tubes, the gentleman's and the workman's, half as many: the same textures). 256 until the working dress: with four in five dressed, a plaza of 300 has about 340 blocks

export function makeDraw(THREE, { capacity = 1024, exactCapacity = 160, nearCapacity = 16, bakeBudgetMs = 4, quality, overflow = "demote" } = {}) {
  const setOverflow = (value) => {
    if (value !== "demote" && value !== "main") throw new Error("people: overflow must be demote or main");
    overflow = value;
  };
  setOverflow(overflow);
  quality = peopleQuality(quality);
  // nobody is ever drawn unclothed: both topologies must carry the base layer's cloth flag
  for (const [name, t] of [["reduced", TEMPLATE], ["near", NEAR]]) if (!t.cloth.some((c) => c)) throw new Error(`people: the ${name} body has no base layer; refusing to draw an unclothed person`);
  const V = TEMPLATE.V;                                       // far and mid share the reduced mesh; near has its own count (NEAR.V)
  const group = new THREE.Group(); group.name = "people";
  const contact = makeContactShadow(THREE, capacity); group.add(contact.mesh);
  let surfaces = new WeakMap();
  let disposed = false;
  const slotStores = new Set(), pendingCompiles = new Set(), activeBuilds = new Set();
  let disposal;
  const trackBuild = (result) => {
    const pending = Promise.resolve(result).finally(() => activeBuilds.delete(pending));
    activeBuilds.add(pending);
    return pending;
  };
  const half16 = (src) => { const o = new Uint16Array(src.length); for (let i = 0; i < src.length; i++) o[i] = THREE.DataUtils.toHalfFloat(src[i]); return o; };

  // ---- shared walk texture: fixed child levels / retained adult cycles, F+1 frames x 2B quaternion/offset rows ----
  // Both slot textures start small and double when full (holo-emitter's trial: 26.6 MB for six people when they were
  // allocated at capacity), keeping every slot where it was; the shaders' texture nodes are pointed at the new one.
  const perRow = Math.floor(WALK_W / (F + 1)), walkW = perRow * (F + 1), rowsFor = (n) => Math.ceil(n / perRow) * 2 * B;
  let walkCap = Math.min(capacity, perRow), walkH = rowsFor(walkCap);
  let walkData = new Uint16Array(walkW * walkH * 4);
  const bakeRows = new Float32Array((F + 1) * 2 * B * 4), bakeBits = bitsOf(bakeRows);
  const walkTexture = (data, h) => { const t = new THREE.DataTexture(data, walkW, h, THREE.RGBAFormat, THREE.HalfFloatType);   // half floats: filterable on every WebGL2
    t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
  let walkTex = walkTexture(walkData, walkH);
  const walkHU = uniform(walkH), walkNodes = [];
  const walkNode = () => { const n = texture(walkTex); walkNodes.push(n); return n; };
  function growWalk() {
    if (walkCap >= capacity * 8) return false;
    walkCap = Math.min(capacity * 8, walkCap * 2); const h = rowsFor(walkCap), d = new Uint16Array(walkW * h * 4);
    d.set(walkData); walkData = d; walkH = h; walkHU.value = h;
    const old = walkTex; walkTex = walkTexture(walkData, h); walkTex.needsUpdate = true; for (const n of walkNodes) n.value = walkTex; old.dispose();
    return true;
  }
  let walkDirty = false, nextWalk = 0;
  const freeWalk = [];

  // ---- far: the morph basis (deltas of each body parameter, one spread) ----
  const dW = 2048, dH = Math.ceil(V * KT / dW), dd = new Float32Array(dW * dH * 4);
  // positions in xyz; normals' deltas packed beside them in a second texture, so shading follows the shape too
  const nd = new Float32Array(dW * dH * 4);
  morphBasis().forEach((d, t) => { for (let v = 0; v < V; v++) for (let a = 0; a < 3; a++) dd[(t * V + v) * 4 + a] = d[v * 3 + a]; });
  morphBasis("normal").forEach((d, t) => { for (let v = 0; v < V; v++) for (let a = 0; a < 3; a++) nd[(t * V + v) * 4 + a] = d[v * 3 + a]; });
  const normalDeltaTex = new THREE.DataTexture(half16(nd), dW, dH, THREE.RGBAFormat, THREE.HalfFloatType); normalDeltaTex.needsUpdate = true;
  const deltaTex = new THREE.DataTexture(half16(dd), dW, dH, THREE.RGBAFormat, THREE.HalfFloatType); deltaTex.needsUpdate = true;

  // ---- slots of vertices x 2 texels (position, normal): the exact bodies of mid and near, and the baked bodices ----
  // Each store starts small and doubles when full (as the walk texture does), keeping every slot where it was. The w of a position texel is a number the shader reads (the base layer's
  // neck cut, near); a store's slot fills from { position, normal, cut? }.
  function restStore(Vs, capMax, first) {
    const rows = (n) => Math.ceil(n * Vs * 2 / REST_W), tex = (data) => new THREE.DataTexture(data, REST_W, data.length / 4 / REST_W, THREE.RGBAFormat, THREE.HalfFloatType);
    const st = { V: Vs, cap: Math.min(capMax, first), capMax, nodes: [], slots: new Map(), free: [], next: 0, dirty: false };       // slots: id -> slot, least recently drawn first (a drawn id is moved to the end)
    st.data = new Uint16Array(REST_W * rows(st.cap) * 4); st.tex = tex(st.data);
    st.grow = () => {
      st.cap = Math.min(capMax, st.cap * 2); const d = new Uint16Array(REST_W * rows(st.cap) * 4);
      d.set(st.data); st.data = d;
      const old = st.tex; st.tex = tex(d); st.tex.needsUpdate = true; for (const n of st.nodes) n.value = st.tex; old.dispose();
    };
    const write = (s, b) => {
      const d = st.data, pu = bitsOf(b.position), nu = bitsOf(b.normal), cu = b.cut ? bitsOf(b.cut) : null;
      for (let v = 0, o = s * Vs * 8, n = pu.length / 3; v < n; v++, o += 8) {
        const i = v * 3;
        d[o] = half(pu[i]); d[o + 1] = half(pu[i + 1]); d[o + 2] = half(pu[i + 2]); d[o + 3] = cu ? half(cu[v]) : 0;
        d[o + 4] = half(nu[i]); d[o + 5] = half(nu[i + 1]); d[o + 6] = half(nu[i + 2]);
      }
      st.dirty = true;
    };
    // the slot of a person's exact shape, filled from body() when they have none (or `again`); least recently drawn is evicted when full
    st.slot = (rec, body, again = false) => {
      let s = st.slots.get(rec.id);
      if (s === undefined) {
        if (st.free.length) s = st.free.pop();
        else if (st.next < capMax) { if (st.next >= st.cap) st.grow(); s = st.next++; }
        else { const old = st.slots.keys().next().value; s = st.slots.get(old); st.slots.delete(old); }
        write(s, body());
      } else { if (again) write(s, body()); st.slots.delete(rec.id); }
      st.slots.set(rec.id, s);
      return s;
    };
    st.release = (rec) => { if (st.slots.has(rec.id)) { st.free.push(st.slots.get(rec.id)); st.slots.delete(rec.id); } };
    slotStores.add(st);
    return st;
  }
  // mid and near are drawn together in a frame at most as many as there are: nobody drawn this frame is evicted
  const stores = { mid: restStore(V, Math.max(1, exactCapacity - nearCapacity), 16), near: restStore(NEAR.V, nearCapacity, 2) };
  // Capacity is shared by all outfit classes. Keep visible residents first,
  // then admit new people. Touch residents before any class allocates so LRU
  // cannot evict a slot another draw still references in this frame.
  function fitTier(list, store, excess) {
    if (overflow === "main") return list; // Diagnostic A/B: main admits per class, without shared-slot protection.
    const selected = [], fresh = [];
    for (const rec of list) (store.slots.has(rec.id) ? selected : fresh).push(rec);
    const keep = selected.splice(store.capMax); excess.push(...keep);
    for (const rec of fresh) (selected.length < store.capMax ? selected : excess).push(rec);
    for (const rec of selected) if (store.slots.has(rec.id)) {
      const slot = store.slots.get(rec.id); store.slots.delete(rec.id); store.slots.set(rec.id, slot);
    }
    return selected;
  }
  // the baked bodices (a slot each, of the class's bodice vertices): the near one from the full body, the reduced one (mid and far) from the reduced body; the second also says what each was baked from
  const layouts = {}, gstores = {}, garmentFrom = new Map(), bakes = { garment: 0, body: 0 };
  const layoutOf = (kind, outfit) => (layouts[kind + "|" + outfit.id] ??= (() => {
    const L = outfitLayout(outfit, kind, kind === "far" ? FAR_SKIRT : kind === "reduced" ? MID_SKIRT : {});
    if (L.bodyV !== (kind === "near" ? NEAR.V : V)) throw new Error(`people: ${outfit.id}'s ${kind} class mesh starts with ${L.bodyV} body vertices, not the tier's ${kind === "near" ? NEAR.V : V}`);     // (the shared programs take the body's end from the tier)
    return L;
  })());
  // ONE garment store a kind (near, reduced), shared by every outfit: a slot is as many vertices as the largest outfit's bodice (the stride), so the shader reads a person's bodice at slot x stride whatever they wear,
  // and a tier's dressed classes can share one program. The stride is the largest of the known outfits' (OUTFITS); another outfit with a larger bodice is refused.
  const strides = {};
  const strideOf = (kind) => strides[kind] ??= Math.max(...Object.values(OUTFITS).map((o) => layoutOf(kind, o).bodiceV));
  const garmentStore = (kind, outfit) => {
    kind = kind === "near" ? "near" : "reduced";
    const st = (gstores[kind] ??= restStore(strideOf(kind), kind === "near" ? nearCapacity : capacity, 4));
    if (outfit && layoutOf(kind, outfit).bodiceV > st.V) throw new Error(`people: outfit ${outfit.id}'s bodice has ${layoutOf(kind, outfit).bodiceV} vertices at ${kind}, over the garment store's slot of ${st.V} (add it to OUTFITS in garments/outfit.js)`);
    return st;
  };

  // ---- the draws: an entry a (tier, class) ----
  const tiers = { far: { cap: capacity }, mid: { cap: stores.mid.capMax }, near: { cap: nearCapacity } };
  const entries = new Map();
  const hair = makeHairDraw(THREE, { group, restStore, tiers, walkNode, walkHU, perRow, walkW, F, B, REST_W, quality });
  const baseGeometry = {};
  const classKeys = new Map();         // outfit id -> its keys by wear mask (a string made once, not a person a frame)
  const classKey = (rec) => {
    const d = rec.dressing; if (!d) return "base";
    let ks = classKeys.get(d.outfit.id); if (!ks) classKeys.set(d.outfit.id, ks = []);
    const m = wearMask(d); return ks[m] ??= `${d.outfit.id}:${m}`;
  };
  const sharedAttrs = new Map();
  function geometryFor(tier, kind, outfit, mask) {
    const g = new THREE.BufferGeometry(), T = tier === "near" ? NEAR : TEMPLATE;
    const attrs = outfit ? sharedAttrs.get(tier + "|" + outfit.id) ?? (() => {
      const L = layoutOf(kind, outfit), body = tier === "far" ? TEMPLATE : null, n = L.V * 3, a = {};
      a.position = new Float32Array(n); a.normal = new Float32Array(n);
      if (body) { a.position.set(body.position); a.normal.set(body.normal); }         // near and mid read their rest shapes from slots: zeros stand in
      a.skinIndex = L.skinIndex; a.skinWeight = L.skinWeight; a.paint = L.paint;
      // the skirt's ring, column and tube, and which part of the class mesh the vertex is in (0 the body, 1 the bodice, 2 the skirt): what the shader branches on, so it needs no outfit's vertex counts
      a.skirtRC = new Float32Array(L.V * 4);
      for (let v = 0; v < L.V; v++) { a.skirtRC.set(L.skirtRC.subarray(3 * v, 3 * v + 3), 4 * v); a.skirtRC[4 * v + 3] = v < L.bodyV ? 0 : v < L.bodyV + L.bodiceV ? 1 : 2; }
      const o = Object.fromEntries(Object.entries(a).map(([k, arr]) => [k, new THREE.BufferAttribute(arr, k === "skinIndex" || k === "skinWeight" || k === "paint" || k === "skirtRC" ? 4 : 3)]));
      sharedAttrs.set(tier + "|" + outfit.id, o); return o;
    })() : (baseGeometry[tier] ??= (() => {
      const o = {};
      // near has no template shape (each person's rest shape is read from the store): zeros stand in for the attributes three needs
      for (const k of ["position", "normal"]) o[k] = new THREE.BufferAttribute(T[k] ?? new Float32Array(T.V * 3), 3);
      o.skinIndex = new THREE.BufferAttribute(T.skinIndex, 4); o.skinWeight = new THREE.BufferAttribute(T.skinWeight, 4); o.paint = new THREE.BufferAttribute(T.paint, 4);
      return o;
    })());
    for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
    if (tier === "far") {
      const region = new Float32Array(g.attributes.position.count);
      region.set(hairRegion(TEMPLATE.position));
      // Reuse paint's otherwise-unused skin RGB channel; no ninth vertex buffer on WebGPU.
      const paint = g.attributes.paint.array.slice();
      for (let v=0;v<TEMPLATE.V;v++) if (paint[4*v+3]===0) paint[4*v]=region[v];
      g.setAttribute("paint", new THREE.BufferAttribute(paint,4));
    }
    g.setIndex(new THREE.BufferAttribute(outfit ? layoutOf(kind, outfit).indexFor(mask) : T.index, 1));
    return g;
  }

  // THE DRESSED TIERS: everyone dressed in a tier, in whatever outfit and whatever of it they wear, shares one agent texture (their classes lay their people one after another, a class's first row a
  // uniform of its material) and one skirt system (the spec rows, the render-to-texture passes: a block each for a skirt, two for the breeches, packed from block 0). So the passes are made, compiled and run once a tier, not once a class:
  // taking the bodice off, or another outfit, costs no new pass. The tier's room (rows, and blocks) is what a class of its own had before: the tier's capacity (the far tier's DRESSED_FAR_CAP), spent by whoever is first.
  const dressedTiers = {};
  function dressedTier(tier, around) {
    let s = dressedTiers[tier];
    if (!s) {
      const cap = Math.max(1, tier === "far" ? Math.min(capacity, DRESSED_FAR_CAP) : tiers[tier].cap), texels = TEXELS_DRESSED + (tier === "far" ? 4 : 0), data = new Float32Array(texels * cap * 4);
      s = dressedTiers[tier] = { tier, cap, texels, data, tex: new THREE.DataTexture(data, texels, cap, THREE.RGBAFormat, THREE.FloatType), around, skirt: null, rows: 0, blocks: 0 };
    } else if (s.around !== around) throw new Error(`people: the ${tier} tier's outfits disagree on the skirt's columns (${s.around}, ${around})`);
    return s;
  }
  const skirtOf = (s) => s.skirt ??= (() => {
    const k = makeSkirtGPU({ THREE, tsl: TSL, around: s.around, blocks: s.cap, agent: { tex: s.tex }, bridge: s.tier === "far" ? 0 : undefined,
      walk: { makeNode: () => walkNode(), hU: walkHU, perRow, F, W: walkW, B } });
    // the passes run on every render of the scene, not once per animation-loop tick (three's FRAME type): an app or a page may render more than once a tick and the skirts must follow
    for (const pass of k.passes) {
      pass.updateBeforeType = TSL.NodeUpdateType.RENDER;
      // RTTNode.setup sets its quad up (fragment, context) whenever a draw that samples the pass is built, and QuadMesh.render gives it its vertex node as it renders; the quad's cache key follows all three, so what compile()
      // built for the quad would not be found at the first frame. Set the quad up once, here, as rendering finds it, and have setup leave it alone (three r186's private names; if they are not there, the pass is
      // set up and built at the first render as it always was).
      const quad = pass._quadMesh, textureSetup = Object.getPrototypeOf(Object.getPrototypeOf(pass)).setup;
      if (!quad || typeof quad.render !== "function" || typeof textureSetup !== "function") continue;
      let vertexNode = null; quad.render({ render: (q) => { vertexNode = q.material.vertexNode; } });          // (the stub is what QuadMesh.render renders with)
      if (!vertexNode) continue;
      const m = quad.material; m.contextNode = TSL.context({}); m.fragmentNode = pass.node; m.vertexNode = vertexNode; m.name = "RTT"; m.needsUpdate = true;
      pass.setup = function (builder) { return textureSetup.call(this, builder); };
      pass.quadReady = true;
    }
    return k;
  })();

  const dressedMaterials = {};
  const entryFor = (tier, rec) => { const d = rec.dressing; return entryOf(tier, d?.outfit ?? null, d ? wearMask(d) : 0); };
  function entryOf(tier, outfit, mask) {
    const key = tier + "|" + (outfit ? `${outfit.id}:${mask}` : "base");
    let e = entries.get(key);
    if (e) return e;
    // the far tier's 16 coefficients ride in the agent texture, four texels after the person's others, not as instanced vertex buffers: WebGPU allows 8 vertex buffers a pipeline (iPhone Safari and
    // Chromium alike) and the far class's attributes with four coefficient buffers were 9 (10 dressed)
    const kind = tier === "near" ? "near" : tier === "far" ? "far" : "reduced", coefBase = outfit ? TEXELS_DRESSED : TEXELS, texels = coefBase + (tier === "far" ? 4 : 0);
    // a dressed class takes its rows of its tier's one dressed agent texture (dressedTier), a plain one has a texture of its own
    const shared = outfit ? dressedTier(tier, layoutOf(kind, outfit).around) : null;
    const cap = shared ? shared.cap : tiers[tier].cap, data = shared ? shared.data : new Float32Array(texels * cap * 4), tex = shared ? shared.tex : new THREE.DataTexture(data, texels, cap, THREE.RGBAFormat, THREE.FloatType);
    const g = geometryFor(tier, kind, outfit, mask);
    e = { key, tier, cap, data, tex, texels, coefBase, outfit, mask, kind, count: 0, shared, ready: true };
    // the dressed classes of a tier share one material, so one program (and one build of its nodes): what differs between them is data (the agent texture's rows, the garment store's slots, the mesh's first row)
    e.material = outfit ? (dressedMaterials[tier] ??= material(e)) : material(e);
    e.skirt = outfit && layoutOf(kind, outfit).skirtV > 0 && (mask & 2) ? shared.skirt : null;
    if (outfit) garmentStore(kind, outfit);
    const mesh = new THREE.Mesh(g, e.material.m); mesh.count = 0; mesh.frustumCulled = false; mesh.name = `people-${tier}-${outfit ? outfit.id + ":" + mask : "base"}`;
    // Far people use contact blobs on both qualities (plaza mid ends at 14 m).
    mesh.castShadow = tier !== "far"; mesh.receiveShadow = true;
    group.add(mesh); e.mesh = mesh;
    if(tier === "far") hair.attachFar(e);
    entries.set(key, e);
    return e;
  }

  function material(e) {
    // (a dressed class's material is the tier's: it reads nothing of this class but the tier's own agent texture, so e stands for them all)
    const { tex: agentTex, tier, outfit } = e, shape = tier === "far" ? "morph" : "exact", store = shape === "exact" ? stores[tier] : null;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: tier === "near" ? THREE.DoubleSide : THREE.FrontSide });   // near: the base layer's hems show their inside; the garments are shells
    if (outfit) m.side = THREE.DoubleSide;
    // a dressed class's first row in its tier's agent texture: the mesh's own (write() sets userData.rowBase), read as the object is rendered, so the classes can share this material
    const rowBase = outfit ? uniform(0, "int").onObjectUpdate(function ({ object }) { this.value = object.userData.rowBase ?? 0; }) : null;
    const i = rowBase ? int(instanceIndex).add(rowBase) : int(instanceIndex), si = attribute("skinIndex", "uvec4"), sw = attribute("skinWeight", "vec4");
    const paint = attribute("paint", "vec4");        // rgb + kind: 0 the person's skin, 1 the base layer's tint, 2 its own colour (eyes), and for a dressed class 3 the bodice, 4 the skirt, 5 the shift (its own colour), 6 the stockings, 7 the skirt's colour darkened (a knee band)
    const bodyEnd = tier === "near" ? NEAR.V : V;          // the class meshes' body is the tier's own mesh (outfitLayout checks it)
    const col = (k) => textureLoad(agentTex, ivec2(k, i)).rgb;
    if (!outfit) m.colorNode = varying(mix(mix(col(3), col(2), step(0.5, paint.w)), paint.rgb, step(1.5, paint.w)));
    else {
      const k = paint.w, own = step(1.5, k).mul(float(1).sub(step(2.5, k))).add(step(4.5, k).mul(float(1).sub(step(5.5, k))));      // (kind 7, the garment's band: the skirt's colour a shade darker, below)
      let c = mix(col(3), col(2), step(0.5, k).mul(float(1).sub(step(1.5, k))));                       // skin, or the tint (kind 1)
      c = mix(c, col(4), step(2.5, k).mul(float(1).sub(step(3.5, k))));                                 // the bodice
      c = mix(c, col(5), step(3.5, k).mul(float(1).sub(step(4.5, k))));                                 // the skirt
      c = mix(c, col(6), step(5.5, k).mul(float(1).sub(step(6.5, k))));                                 // the stockings
      c = mix(c, col(5).mul(BAND_SHADE), step(6.5, k));                                                 // the knee band: the skirt's (breeches') colour a shade darker
      m.colorNode = varying(mix(c, paint.rgb, own));
    }
    if (tier === "far") {
      const hc = textureLoad(agentTex, ivec2(outfit ? 7 : 4, i));
      m.colorNode = mix(m.colorNode, varying(hc.rgb), varying(paint.r.mul(float(1).sub(step(0.5,paint.w))).mul(hc.w)));
    }
    const surfacePoint = TSL.varyingProperty("vec3", `surfacePoint_${tier}_${outfit ? 'dressed' : 'base'}`);
    const upperSurface = outfit ? textureLoad(agentTex, ivec2(2, i)).w : float(0);
    const lowerSurface = outfit ? textureLoad(agentTex, ivec2(6, i)).w : float(0);
    const fabric = varying(select(paint.w.equal(3), upperSurface, select(paint.w.equal(4).or(paint.w.equal(7)), lowerSurface, float(0))));
    applySurface(THREE, m, { tier, quality, point: surfacePoint, kind: paint.w, fabric });
    const walk = walkNode();
    const gstore = outfit ? garmentStore(e.kind) : null;
    const skirt = outfit ? skirtOf(e.shared) : null;           // every dressed class's program has the skirt's branch; the classes without the skirt worn have no skirt vertices in their index
    // the layer's neck cut, near: the body slot's w at the layer's vertices; the fragment is discarded where it is above the shift's edge
    if (outfit && tier === "near") {
      const gi = int(textureLoad(agentTex, ivec2(1, i)).y).mul(store.V).add(int(vertexIndex)).mul(2), cutLoad = textureLoad(store.tex, ivec2(gi.mod(REST_W), gi.div(REST_W)));
      store.nodes.push(cutLoad);
      m.maskNode = varying(select(int(vertexIndex).lessThan(bodyEnd), cutLoad.w, float(0))).lessThanEqual(0);
    }
    m.positionNode = Fn(() => {
      const a0 = textureLoad(agentTex, ivec2(0, i)).toVar(), a1 = textureLoad(agentTex, ivec2(1, i)).toVar();
      const x0 = vec3(0).toVar(), n0 = vec3(0).toVar(), vi = int(vertexIndex);
      const p = vec3(0).toVar(), n = vec3(0).toVar();
      const bodyPath = () => {
        if (shape === "exact") {
          const gi = int(a1.y).mul(store.V).add(vi).mul(2).toVar();
          const rp = textureLoad(store.tex, ivec2(gi.mod(REST_W), gi.div(REST_W))), rn = textureLoad(store.tex, ivec2(gi.add(1).mod(REST_W), gi.add(1).div(REST_W)));
          store.nodes.push(rp, rn);
          x0.assign(rp.xyz); n0.assign(rn.xyz);
        } else {
          x0.assign(positionLocal); n0.assign(normalLocal);
          const coefs = [0, 1, 2, 3].map((k) => textureLoad(agentTex, ivec2(e.coefBase + k, i)).toVar());
          for (let t = 0; t < KT; t++) {
            const gi = vi.add(t * V), c = coefs[t >> 2][["x", "y", "z", "w"][t & 3]];
            x0.addAssign(textureLoad(deltaTex, ivec2(gi.mod(dW), gi.div(dW))).xyz.mul(c));
            n0.addAssign(textureLoad(normalDeltaTex, ivec2(gi.mod(dW), gi.div(dW))).xyz.mul(c));
          }
          n0.assign(n0.normalize());
          x0.assign(x0.mul(a1.w));                                       // height, as an exact scale
        }
      };
      const bodicePath = () => {
        const gi = int(textureLoad(agentTex, ivec2(5, i)).w).mul(gstore.V).add(vi.sub(bodyEnd)).mul(2).toVar();
        const rp = textureLoad(gstore.tex, ivec2(gi.mod(REST_W), gi.div(REST_W))), rn = textureLoad(gstore.tex, ivec2(gi.add(1).mod(REST_W), gi.add(1).div(REST_W)));
        gstore.nodes.push(rp, rn);
        x0.assign(rp.xyz); n0.assign(rn.xyz);
      };
      const slot = a1.x;
      const skin = () => {
        for (const c of ["x", "y", "z", "w"]) {
          const b = float(si[c]), w = sw[c];
          const pose = walkSample(TSL,walk,slot,a0.w,b,{perRow,F,W:walkW,H:walkHU,B});
          p.addAssign(pose.point(x0).mul(w));
          n.addAssign(pose.rotate(n0).mul(w));
        }
      };
      if (!outfit) { bodyPath(); skin(); }
      else {
        // (the body and the bodice are skinned by the same bones: the skin is built once, after the shape is chosen)
        const rc = attribute("skirtRC", "vec4");          // ring, column, tube, and the vertex's part: 0 the body, 1 the bodice, 2 the skirt
        If(rc.w.lessThan(1.5), () => { If(rc.w.lessThan(0.5), () => { bodyPath(); }).Else(() => { bodicePath(); }); skin(); })
          .Else(() => {
            const s = skirt.vertex({ instance: i, ring: int(rc.x), col: int(rc.y), tube: int(rc.z) });
            p.assign(s.position); n.assign(s.normal);
          });
      }
      // Person-local coordinates: texture detail moves with the person, never the stage.
      surfacePoint.assign(p.div(textureLoad(agentTex, ivec2(3, i)).w.max(0.1)));
      const ch = cos(a0.z), sh = sin(a0.z);
      normalLocal.assign(vec3(n.x.mul(ch).add(n.z.mul(sh)), n.y, n.z.mul(ch).sub(n.x.mul(sh))).normalize());
      return vec3(p.x.mul(ch).add(p.z.mul(sh)).add(a0.x), p.y.add(a1.z), p.z.mul(ch).sub(p.x.mul(sh)).add(a0.y));
    })();
    return { m };
  }

  // A walk slot: the person's walker baked once. Returns false if over this frame's budget (drawn from next frame on).
  let budgetLeft = 0, startLater = null, updates = 0;
  const bakedCycles = new WeakMap();
  let batchDue = false, nextBatch = 0;
  const walkCounts = { firstBakes: 0, rebakes: 0, uploadFrames: 0, levelSwitches: 0, slots: 0 };
  function allocateWalk(n) {
    // Reuse whole consecutive blocks; child levels must remain adjacent.
    const i = freeWalk.findIndex(block => block.count >= n);
    if (i >= 0) {
      const block = freeWalk[i], slot = block.slot;
      block.slot += n; block.count -= n;
      if (!block.count) freeWalk.splice(i, 1);
      walkCounts.slots += n; return slot;
    }
    while (nextWalk + n > walkCap) if (!growWalk()) return -1;
    const slot = nextWalk; nextWalk += n; walkCounts.slots += n; return slot;
  }
  function storeCycle(w, cycle, slot) {
    bakePacedCycle(w, F, cycle.blend, bakeRows);
    const bx=(slot%perRow)*(F+1),by=Math.floor(slot/perRow)*2*B;
    for(let r=0;r<2*B;r++)packHalf(walkData,((by+r)*walkW+bx)*4,bakeBits,r*(F+1)*4,(F+1)*4);
    walkDirty = true;
  }
  function activate(rec, state, cycle, slot) {
    state.blend = cycle.blend; state.speed = cycle.speed; state.stride = cycle.stride;
    rec.walkSlot = slot; walkCounts.levelSwitches++;
  }
  function walkSlot(rec) {
    const w = rec.walker;
    if (!w) return false;
    const previous = bakedCycles.get(rec);
    if (previous) {
      const moved = (rec.walkDistance ?? 0) !== previous.distance;
      if (!moved) return true;
      advanceBakedPhase(rec, previous);
      if (previous.levels) {
        if (needsWalkBake(w, previous) && (!w.bank || canRebakeAtPhase(w, previous.phase))) {
          const i = closestCycle(w, previous.levels);
          if (rec.walkSlot !== previous.base + i) activate(rec, previous, previous.levels[i], previous.base + i);
        }
      } else {
        // A queued adult keeps its old cycle/cadence until the batch is uploaded
        // and support exchanges. Only one queued cycle per person is retained.
        if (previous.pending && (!w.bank || canRebakeAtPhase(w, previous.phase))) {
          const old = rec.walkSlot;
          activate(rec, previous, previous.pending, previous.spare);
          previous.spare = old; previous.pending = null;
        }
        if (!batchDue || !moved || previous.pending) return true;
        const targetSpeed = w.bank && rec.doing ? Math.max(w.minSpeed, Math.min(w.maxSpeed,
          desiredSpeed(w, 0, rec.doing?.opts?.urgency) * (rec.doing?.opts?.pace ?? 1))) : w.v;
        if (needsWalkBake({v:targetSpeed}, previous)) {
          if (previous.spare === undefined || previous.spare < 0) previous.spare = allocateWalk(1);
          if (previous.spare >= 0) {
            previous.pending = cycleAt({...w, v:targetSpeed});
            storeCycle(w, previous.pending, previous.spare); walkCounts.rebakes++;
          }
        }
      }
      return true;
    }
    if (budgetLeft <= 0) return false;
    const t = performance.now(), levels = childCycles(w), n = levels?.length ?? 1;
    const base = allocateWalk(n);
    if (base < 0) return false;
    const cycle = levels ? levels[closestCycle(w, levels)] : cycleAt(w);
    for (let i = 0; i < n; i++) storeCycle(w, levels ? levels[i] : cycle, base + i);
    const state = {...cycle, levels, base, count:n, phase:rec.phase, distance:rec.walkDistance ?? 0};
    rec.walkSlot = base + (levels ? closestCycle(w, levels) : 0);
    bakedCycles.set(rec, state); rec.walkPhase = state.phase;
    walkCounts.firstBakes++; hair.prepareFar(rec);
    budgetLeft -= performance.now() - t;
    return true;
  }

  // Babies use white linen even without an outfit. Explicitly undressed older demo
  // people retain the placeholder tint; dressed people use their outfit's shift.
  const tint = (rec) => { if (rec.values.age < 1.5) return rgb(rec, "shift", "#f3f0e8"); if (!rec.tint) { const c = new THREE.Color().setHSL(rec.rank * 7 % 1, 0.35, 0.45); rec.tint = [c.r, c.g, c.b]; } return rec.tint; };
  const skin = (rec) => { if (!rec.skin) { const c = new THREE.Color(rec.bodyParams.skin); rec.skin = [c.r, c.g, c.b]; } return rec.skin; };
  const rgb = (rec, name, hex) => { const k = "_c" + name; if (!rec[k]) { const c = new THREE.Color(hex); rec[k] = [c.r, c.g, c.b]; } return rec[k]; };       // name: shift, bodice or skirt: fields of the record (population.js Person)

  // the near body's slot, filled with the base layer's neck cut when she is dressed (layer.js layerCut: s a layer vertex, 0 for the rest)
  const nearBody = (rec) => () => {
    const b = rec.buildNear(), d = rec.dressing;
    if (d) { const baked = bakeNear(b, rec.bodyParams, d.outfit); rec.nearGarment = baked; b.cut = new Float32Array(b.V); b.cut.set(baked.layerCut, UVN); }
    rec._hairBody = b;
    return b;
  };
  // her skirt's row: the numbers the passes read (fork B's writeSpecRow), kept with her
  const specRow = (rec) => (rec.specRow ??= (() => { const specs = rec.dressing.specs, r = new Float32Array(specs.length * SPEC_TEXELS * 4); specs.forEach((sp, t) => writeSpecRow(r, t, sp, rec.far.J, 0, t)); return r; })());

  // Writes one class's people; returns how many. A person new to the near tier needs their full body built (about 4 ms): when this
  // frame's budget is spent they are drawn as mid for now (`demoted`), and near from the next frame.
  function write(e, list, demoted) {
    const name = e.tier, store = stores[name], outfit = e.outfit, texels = e.texels, sh = e.shared, tubes = outfit?.loose.tubes ?? 1;
    const rowBase = sh ? sh.rows : 0, D = e.data;           // a dressed class's people follow the tier's others in the one agent texture
    let n = 0;
    if (sh) e.mesh.userData.rowBase = rowBase;
    for (const rec of list) {
      if (sh ? (sh.rows >= sh.cap || (e.skirt && sh.blocks + tubes > sh.cap)) : n >= e.cap) { if (overflow === "main") break; demoted.push(rec); continue; }
      if (!walkSlot(rec)) continue;
      let ex = 0, gslot = 0;
      if (name === "near") {
        if (!store.slots.has(rec.id) && budgetLeft <= 0) { demoted.push(rec); continue; }
        const t = performance.now(); ex = store.slot(rec, nearBody(rec));
        if (outfit) { const g = garmentStore("near", outfit); gslot = g.slot(rec, () => { rec.nearGarment ??= bakeNear(rec.buildNear(), rec.bodyParams, outfit); return rec.nearGarment.bodice; }); }
        budgetLeft -= performance.now() - t;
      } else if (name === "mid") {
        ex = store.slot(rec, () => rec.body);
        if (outfit) { const g = garmentStore("reduced", outfit), exact = garmentFrom.get(rec.id) === "exact"; gslot = g.slot(rec, () => { bakes.garment++; garmentFrom.set(rec.id, "exact"); return bakeReduced(rec.body.position, rec.bodyParams, outfit, rec.body.joints.J).bodice; }, !exact && g.slots.has(rec.id)); }
      } else if (outfit) {        // far: the bodice from the reduced body the person's coefficients give (the exact one if mid has baked it already)
        const g = garmentStore("reduced", outfit);
        gslot = g.slot(rec, () => { bakes.garment++; garmentFrom.set(rec.id, "far"); return bakeReduced(farReducedPositions(rec.far.coef, rec.far.scale), rec.bodyParams, outfit, rec.far.J).bodice; });
      }
      const o = (rowBase + n) * texels * 4, pos = rec.pos;
      D[o] = pos[0]; D[o + 1] = pos[2]; D[o + 2] = rec.heading; D[o + 3] = rec.walkPhase ?? rec.phase;
      D[o + 4] = rec.walkSlot; D[o + 5] = name === "far" ? rec.farHairSlot : ex; D[o + 6] = pos[1];
      const c = outfit ? rgb(rec, "shift", rec.dressing.look.shift) : tint(rec), k = skin(rec);
      D[o + 8] = c[0]; D[o + 9] = c[1]; D[o + 10] = c[2]; D[o + 12] = k[0]; D[o + 13] = k[1]; D[o + 14] = k[2];
      D[o + 15] = rec.height;
      if (outfit) {
        let surface = surfaces.get(rec.dressing);
        if (!surface) { surface = surfaceData(rec.dressing, rec.attire); surfaces.set(rec.dressing, surface); }
        D[o + 11] = surface[0]; D[o + 27] = surface[1];
        const bo = rgb(rec, "bodice", rec.dressing.look.bodice), sk = rgb(rec, "skirt", rec.dressing.look.skirt);
        D[o + 16] = bo[0]; D[o + 17] = bo[1]; D[o + 18] = bo[2]; D[o + 19] = sh.blocks;          // the person's first block of the tier's passes
        D[o + 20] = sk[0]; D[o + 21] = sk[1]; D[o + 22] = sk[2]; D[o + 23] = gslot;
        if (rec.dressing.look.stockings) { const off = rec.dressing.wear.hose === false, st = off ? rgb(rec, "bare", rec.dressing.look.shift) : rgb(rec, "stockings", rec.dressing.look.stockings);          /* no stockings worn: the legs are the base layer's, its linen */ D[o + 24] = st[0]; D[o + 25] = st[1]; D[o + 26] = st[2]; }
        if (e.skirt) {
          const sd = e.skirt.specData, row = specRow(rec), at = sh.blocks * SPEC_TEXELS * 4;
          sd.set(row, at);
          for (let t = 0; t < tubes; t++) sd[at + (t * SPEC_TEXELS + 33) * 4 + 2] = rowBase + n;          // (each block's leg is in the row; which person is theirs is this frame's)
          sh.blocks += tubes;
        }
        sh.rows++;
      }
      if (name === "far") {
        const far = rec.far, base = o + 4 * e.coefBase;
        D[o + 7] = far.scale;
        for (let q = 0; q < KT; q++) D[base + q] = far.coef[q];
      }
      const ho = o + (outfit ? 7 : 4)*4;
      D[ho]=rec.hair.colour[0];D[ho+1]=rec.hair.colour[1];D[ho+2]=rec.hair.colour[2];D[ho+3]=rec.hair.style ? 1 : 0;
      if(name !== "far") { budgetLeft -= hair.add(name,rec,rec._hairBody); rec._hairBody = null; }
      contact.add(rec);
      n++;
    }
    return n;
  }
  const finish = (e, n) => {
    e.mesh.count = n; e.count = n;
    if (!e.shared) e.tex.needsUpdate = true;
  };

  return {
    group,
    // Benchmark compatibility only; default demotes overflow instead of hiding people.
    setOverflow,
    dispose() {
      if (disposed) return disposal;
      disposed = true;
      group.removeFromParent();
      startLater = null;
      for (const cancel of pendingCompiles) cancel();
      pendingCompiles.clear();
      // A renderer's compileAsync cannot be aborted. Keep its inputs alive until
      // already-started work settles, then dispose once (including late GPU work).
      const free = () => {
        hair.dispose();
        // Class materials/geometries and dressed agent textures are shared.
        const resources = new Set([walkTex, deltaTex, normalDeltaTex]);
        for (const e of entries.values()) resources.add(e.tex);
        for (const sh of Object.values(dressedTiers)) {
          resources.add(sh.tex);
          sh.skirt?.dispose();
          sh.data = null; sh.skirt = null;
        }
        for (const st of slotStores) {
          resources.add(st.tex);
          st.slots.clear(); st.free.length = st.nodes.length = 0;
          st.data = st.tex = null;
        }
        slotStores.clear();
        group.traverse(object => {
          if (object.geometry) resources.add(object.geometry);
          for (const m of Array.isArray(object.material) ? object.material : [object.material]) if (m) resources.add(m);
          // InstancedMesh owns an instance buffer in addition to its geometry.
          if (object.isInstancedMesh) object.dispose();
        });
        for (const resource of resources) resource.dispose();
        group.removeFromParent(); group.clear();
        entries.clear(); classKeys.clear(); sharedAttrs.clear(); garmentFrom.clear();
        for (const cache of [layouts, gstores, baseGeometry, dressedMaterials, dressedTiers]) for (const key of Object.keys(cache)) delete cache[key];
        surfaces = new WeakMap();
        walkNodes.length = freeWalk.length = 0;
        walkData = walkTex = null;
      };
      if (activeBuilds.size) disposal = Promise.allSettled([...activeBuilds]).then(free);
      else free();
      return disposal;
    },
    /** `now` is monotonic seconds (defaults to the wall clock); it gates adult upload batches.
     * Draw this frame's tiers (population.tick's result). Returns the counts drawn per tier, `classes`: how many (tier, class) draws are in use, and `passes`: the skirts' render-to-texture passes (one a stage for every dressed person of a class, never one a person). */
    update(sorted, now = performance.now() / 1000) {
      budgetLeft = bakeBudgetMs;
      batchDue = now + 1e-9 >= nextBatch;
      if (batchDue) nextBatch = now + .5;
      hair.begin(); contact.begin();
      if (startLater && ++updates >= LATER_AFTER_UPDATES) { const go = startLater; startLater = null; go(); }
      const demoted = [], farOverflow = [], counts = { near: 0, mid: 0, far: 0, classes: 0, passes: 0 };
      for (const sh of Object.values(dressedTiers)) { sh.rows = 0; sh.blocks = 0; }
      // near first (a person new to it may be demoted to mid this frame), then mid, then far; each class one draw
      const run = (tier, list) => {
        const byClass = new Map(); for (const rec of list) { const k = classKey(rec); let l = byClass.get(k); if (!l) byClass.set(k, l = []); l.push(rec); }
        const used = new Set();
        for (const [, l] of byClass) {
          const e = entryFor(tier, l[0]);
          if (!e.ready) { for (const rec of l) demoted.push(rec); continue; }          // not compiled yet (compile() defers the near dressed classes): drawn as mid, as when the near body's budget is spent
          used.add(e); const n = write(e, l, tier === "near" ? demoted : tier === "mid" ? farOverflow : []); finish(e, n); counts[tier] += n;
        }
        return used;
      };
      const t0 = performance.now(), usedNear = run("near", fitTier(sorted.near, stores.near, demoted)), t1 = performance.now();
      const usedMid = run("mid", fitTier(demoted.length ? demoted.concat(sorted.mid) : sorted.mid, stores.mid, farOverflow)), t2 = performance.now(), usedFar = run("far", farOverflow.length ? farOverflow.concat(sorted.far) : sorted.far), t3 = performance.now();
      counts.bakes = { ...bakes }; counts.ms = { near: t1 - t0, mid: t2 - t1, far: t3 - t2 };
      for (const e of entries.values()) if (e.count !== 0 && !usedNear.has(e) && !usedMid.has(e) && !usedFar.has(e)) finish(e, 0);          // a class nobody is in any more is emptied once, not uploaded every frame
      for (const e of entries.values()) if (e.count > 0) counts.classes++;
      for (const sh of Object.values(dressedTiers)) {
        if (sh.rows > 0) sh.tex.needsUpdate = true;
        if (sh.skirt) {
          sh.skirt.count.value = sh.blocks; if (sh.blocks > 0) sh.skirt.specTexture.needsUpdate = true;
          for (const pass of sh.skirt.passes) pass.autoUpdate = sh.blocks > 0;          // (no skirts drawn, no passes run)
          if (sh.blocks > 0) counts.passes += sh.skirt.passes.length;
        }
      }
      if (walkDirty) { walkTex.needsUpdate = true; walkDirty = false; walkCounts.uploadFrames++; }
      counts.walk = { ...walkCounts, textureBytes: walkData.byteLength };
      for (const st of [...Object.values(stores), ...Object.values(gstores)]) if (st.dirty) { st.tex.needsUpdate = true; st.dirty = false; }
      contact.end();
      counts.contactDraws = contact.mesh.count ? 1 : 0;
      counts.hairDraws = hair.end();
      counts.classes += counts.hairDraws;
      return counts;
    },
    /** Make the draws for every tier of the base class and of each outfit worn in full, before anyone is in them, so a renderer can compile their pipelines ahead (compileAsync) instead of at the first frame someone is drawn. */
    warm(outfitList = []) {
      for (const tier of ["near", "mid", "far"]) { entryOf(tier, null, 0); for (const o of outfitList) entryOf(tier, o, 3); }
      hair.warm();
      return entries.size + hair.entries.length + 1;
    },
    /** Compile everything warm() made on a renderer: each class's draw and each tier's skirt passes (which a scene's compileAsync does not reach: they render into targets, and would build at the first frame), in chains that overlap each other's waits. Settles when all have. Add `group` to the scene first; `scene` is the one it is rendered in (its lights). */
    compile(renderer, scene, camera, { serial = typeof self !== "undefined" && typeof self.scheduler?.yield === "function", chains = serial ? Infinity : 3, defer = false } = {}) {
      // In chains, each its objects one after the other (compileAsync of a scene is one chain, and waits on each pipeline before building the next one's code): while one waits on the driver another builds code.
      // three yields to the page between the stages of building a draw's code with scheduler.yield() (a moment) where there is one, and else with requestAnimationFrame (a frame, 17 ms, which is a phone's
      // Safari: nine stages of waiting a draw, a second and a half for fifteen of them in one chain), so there every object is a chain of its own and their waits are the same frames.
      hair.warm();
      const passes = [], meshes = [contact, ...hair.entries], later = { passes: [], meshes: [] };
      for (const e of entries.values()) (defer && e.tier === "near" && e.outfit ? later.meshes : meshes).push(e);
      for (const sh of Object.values(dressedTiers)) {
        const list = defer && sh.tier === "near" ? later.passes : passes;
        for (const pass of sh.skirt?.passes ?? []) if (pass.quadReady) list.push({ pass, depth: pass === sh.skirt.passes[0] && sh.skirt.passes.length > 1 ? 2 : 1 });         // (pass 1 renders from inside pass 2's render, when there is one)
      }
      // A pass renders from inside the scene's render (RTTNode.updateBefore), so three gives it the render context of its call depth (RenderContexts.get): compile it as that, or its code and pipeline would be
      // built again at the first frame (r186's private names again; if they are not there, the pass builds at the first render).
      const compilePass = ({ pass, depth }) => {
        if (disposed) return;
        const rc = renderer._renderContexts, get = rc?.get;
        if (typeof get !== "function") return null;
        const prev = renderer.getRenderTarget(); renderer.setRenderTarget(pass.renderTarget); rc.get = (t, m) => get.call(rc, t, m, depth);
        try { return trackBuild(renderer.compileAsync(pass._quadMesh, pass._quadMesh.camera)); } finally { rc.get = get; renderer.setRenderTarget(prev); }
      };
      const chain = (items, one) => items.reduce((p, x) => p.then(() => one(x)), Promise.resolve());
      // (a draw that is not ready is not visible, or the first render would build it; compileAsync only takes what is visible, so it is for the moment of the call)
      const compileDraw = (e) => { if (disposed) return; const v = e.mesh.visible; e.mesh.visible = true; try { return trackBuild(renderer.compileAsync(e.mesh, camera, scene)); } finally { e.mesh.visible = v; } };
      const jobs = (ps, ms) => [...ps.map((x) => () => compilePass(x)), ...ms.map((e) => () => compileDraw(e))];
      const run = (items, n) => { const lanes = Array.from({ length: Math.min(n, items.length) }, () => []); items.forEach((it, i) => lanes[i % lanes.length].push(it)); return Promise.all(lanes.map((lane) => chain(lane, (f) => f()))); };
      // The near tier's dressed classes (a gentlewoman or gentleman within 4 m: a few at a time, and only some seconds in, as people come into the tier as they are baked) are compiled after this settles, in one chain,
      // and until they have, whoever would be in them is drawn as mid, which the tiers agree with to under 2 cm.
      for (const e of later.meshes) { e.ready = false; e.mesh.visible = false; }
      for (const sh of Object.values(dressedTiers)) for (const pass of sh.skirt?.passes ?? []) if (pass.quadReady) pass.textureNeedsUpdate = false;          // (a pass runs when there are skirts for it, not once at the first render)
      // Draws that share a material share a program, its nodes built once: of each material one draw is compiled with the passes (the lanes), and the rest, which find the build waiting, when it has settled. Built together
      // they would each build it, since three keeps a build only once it has finished.
      const seen = new Set(), firsts = [], others = [];
      for (const e of meshes) (seen.has(e.material) ? others : firsts).push(e), seen.add(e.material);
      // The builds of code are JavaScript on the page's one thread, and three runs those of compileAsync side by side, each yielding to the others, so all finish together at the end and the GPU's compiling of every
      // pipeline starts then. Taken in turn (first come, first built) each build finishes in its time and its pipeline compiles while the next builds. Where the yields are the frames of a phone's Safari (`serial` false
      // by default there) the waits are what the lanes overlap, and the builds stay side by side. (r186's getForRenderAsync; if it is not there, the builds stay side by side.)
      let unlock = () => {};
      if (serial && typeof renderer._nodes?.getForRenderAsync === "function") {
        const nodes = renderer._nodes, own = Object.prototype.hasOwnProperty.call(nodes, "getForRenderAsync"), build = nodes.getForRenderAsync;
        let tail = Promise.resolve();
        const queued = function (renderObject) { const p = tail.then(() => disposed ? undefined : build.call(this, renderObject)); tail = p.then(() => {}, () => {}); return p; };
        nodes.getForRenderAsync = queued;
        unlock = () => { if (nodes.getForRenderAsync === queued) { if (own) nodes.getForRenderAsync = build; else delete nodes.getForRenderAsync; } };
      }
      // (each material's other draws follow its first as it settles, not when every first has)
      const followers = new Map(); for (const e of others) { if (!followers.has(e.material)) followers.set(e.material, []); followers.get(e.material).push(e); }
      const withFollowers = (e) => () => Promise.resolve(compileDraw(e)).then(() => Promise.all((followers.get(e.material) ?? []).map(compileDraw)));
      const cancel = () => { unlock(); allReady?.(); };
      pendingCompiles.add(cancel);
      const rest = hair.ready.then(() => run([...passes.map((x) => () => compilePass(x)), ...firsts.map(withFollowers)], chains)).finally(() => { unlock(); if (!later.meshes.length) pendingCompiles.delete(cancel); });
      let allReady = null;
      const deferred = new Promise((res) => { allReady = res; });
      if (later.meshes.length) {
        const ready = () => { pendingCompiles.delete(cancel); if (disposed) { allReady(); return; } for (const e of later.meshes) { e.ready = true; e.mesh.visible = true; } allReady(); };
        // (they start a few frames in, not while the page is loading: loading is for what the first sight needs)
        startLater = () => run(jobs(later.passes, later.meshes), 1).then(ready, ready);
      } else allReady();
      rest.deferred = deferred;          // settles when the deferred classes are compiled and in use (a test that needs every draw as it will be waits on it after a few updates)
      return rest;
    },
    /** Free a removed person's slots. */
    release(rec) {
      if (rec.walkSlot !== undefined) { const state = bakedCycles.get(rec);
        freeWalk.push({slot:state.base, count:state.count}); walkCounts.slots -= state.count;
        if (state.spare !== undefined && state.spare >= 0) {
          // Adult base may be the inactive slot after a swap.
          freeWalk.at(-1).slot = rec.walkSlot;
          freeWalk.push({slot:state.spare, count:1}); walkCounts.slots--;
        } rec.walkSlot = undefined; rec.walkPhase = undefined; bakedCycles.delete(rec); }
      for (const st of [...Object.values(stores), ...Object.values(gstores)]) st.release(rec);
      hair.release(rec);
      garmentFrom.delete(rec.id); rec.nearGarment = undefined; rec.specRow = undefined;
    },
    // walk texture, the far basis (two half-float textures), the rest slots of both topologies and the baked bodices (half floats), the skirts' spec rows, their render-to-texture passes (RGBA32F, a texel per person, ring and column) and the agent textures
    bytes: () => contact.mesh.instanceMatrix.array.byteLength + hair.bytes() + walkData.byteLength + dd.length + [...Object.values(stores), ...Object.values(gstores)].reduce((n, st) => n + st.data.byteLength, 0)
      + [...entries.values()].reduce((n, e) => n + (e.shared ? 0 : e.data.byteLength), 0)
      + Object.values(dressedTiers).reduce((n, sh) => n + sh.data.byteLength + (sh.skirt ? sh.skirt.specData.byteLength + sh.skirt.RW * sh.skirt.RH * 16 * sh.skirt.passes.length : 0), 0),
  };
}
