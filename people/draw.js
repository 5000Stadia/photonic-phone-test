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
// their own walker baked into 32 frames (src/people/walk.js), at most `bakeBudgetMs` of baking a frame.
//
// CLASSES (R5, design/r5-plan.md "The wardrobe"): a class is an outfit and which of its garments are worn: "base" (the base layer only: everyone with no outfit) or
// "gentlewoman:3" (outfit id : bit 0 the bodice, bit 1 the skirt). One instanced draw per (tier, class), each person in the one they belong to this frame, so what she wears is
// state read every frame (wearMask in outfits.js): taking the bodice off moves her to another class's draw, with no rebake and no pop between tiers. A class is a vertex layout
// (garments/reduced.js outfitLayout: the body, then the bodice, then the skirt's rings) with its own index buffer (the triangles of what is worn; at mid and far with the
// body under the bodice cut out), built the first time someone is in it.
//   - the bodice is baked once on the CPU into a slot of its own beside the body's (near: from the full body through the binding; mid: from the exact reduced body; far: from
//     the reduced body the coefficients give, the same binding), so body and clothes cannot disagree;
//   - the skirt is not baked: it follows the pose (garments/skirt-tsl.js), its rings computed on the GPU from the person's bones in the walk texture, their spec from a row;
//   - near: the base layer's neck is cut by a per-vertex number in the body's slot (texel w), which the fragment shader discards on (layers: layer.js).
//   - her skirt's footprint is in the population's stepping-aside radius (rec.half), not here.

import { Fn, If, texture, textureLoad, uniform, ivec2, int, float, vec2, vec3, vec4, attribute, instanceIndex, vertexIndex, positionLocal, normalLocal, cos, sin, varying, cross, mix, step, select } from "three/tsl";
import * as TSL from "three/tsl";
import { TEMPLATE, NEAR, B, morphBasis } from "./bodies.js";
import { bakeOne, TEXELS_PER_PERSON } from "./walk.js";
import { half, bitsOf, packHalf } from "./half.js";
import { wearMask } from "./outfits.js";
import { UVN } from "../spikes/makehuman/index.js";
import { outfitLayout, bakeNear, bakeReduced, farReducedPositions } from "./garments/reduced.js";
import { makeSkirtGPU, writeSpecRow, SPEC_TEXELS } from "./garments/skirt-tsl.js";

const F = 32, KT = 16, WALK_W = 2048, REST_W = 2048;
const TEXELS = 4, TEXELS_DRESSED = 6;      // an instance takes 4 agent texels: [x, z, heading, phase], [walk slot, exact slot, y, scale], tint, skin; a dressed one two more: [bodice rgb, spec row], [skirt rgb, bodice slot]
const MID_SKIRT = { rings: 16, around: 32 };    // mid's skirt: 32 columns (24 left up to 2.5 cm between it and near's 40 in a stride; 32 is within 1 cm: tools/people/switch-check.mjs)
const FAR_SKIRT = { rings: 16, around: 24 };    // the far class's skirt: 24 columns, no bridging (16 columns left 3.1 to 3.6% of a dressed person's pixels differing from mid's at 4 to 10 m, over check.mjs's 3%: the hem and the silhouette)
const DRESSED_FAR_CAP = 256;                // dressed people drawn at far at most (each takes a skirt's rings in the passes' textures)

export function makeDraw(THREE, { capacity = 1024, exactCapacity = 160, nearCapacity = 16, bakeBudgetMs = 4 } = {}) {
  // nobody is ever drawn unclothed: both topologies must carry the base layer's cloth flag
  for (const [name, t] of [["reduced", TEMPLATE], ["near", NEAR]]) if (!t.cloth.some((c) => c)) throw new Error(`people: the ${name} body has no base layer; refusing to draw an unclothed person`);
  const V = TEMPLATE.V;                                       // far and mid share the reduced mesh; near has its own count (NEAR.V)
  const group = new THREE.Group(); group.name = "people";
  const half16 = (src) => { const o = new Uint16Array(src.length); for (let i = 0; i < src.length; i++) o[i] = THREE.DataUtils.toHalfFloat(src[i]); return o; };

  // ---- the shared walk texture: slots of F+1 frames x 2B rows (quaternion row, offset row per bone) ----
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
    if (walkCap >= capacity) return false;
    walkCap = Math.min(capacity, walkCap * 2); const h = rowsFor(walkCap), d = new Uint16Array(walkW * h * 4);
    d.set(walkData); walkData = d; walkH = h; walkHU.value = h;
    const old = walkTex; walkTex = walkTexture(walkData, h); walkTex.needsUpdate = true; for (const n of walkNodes) n.value = walkTex; old.dispose();
    return true;
  }
  let walkDirty = false, nextWalk = 0;
  const freeWalk = [];
  const tmp = new Float32Array(TEXELS_PER_PERSON * 4);

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
    const st = { V: Vs, cap: Math.min(capMax, first), capMax, nodes: [], slots: new Map(), lru: [], free: [], next: 0, dirty: false };
    st.data = new Uint16Array(REST_W * rows(st.cap) * 4); st.tex = tex(st.data);
    st.grow = () => {
      st.cap = Math.min(capMax, st.cap * 2); const d = new Uint16Array(REST_W * rows(st.cap) * 4);
      d.set(st.data); st.data = d;
      const old = st.tex; st.tex = tex(d); st.tex.needsUpdate = true; for (const n of st.nodes) n.value = st.tex; old.dispose();
    };
    const write = (s, b) => {
      const d = st.data, pu = bitsOf(b.position), nu = bitsOf(b.normal), cu = b.cut ? bitsOf(b.cut) : null;
      for (let v = 0, o = s * Vs * 8; v < Vs; v++, o += 8) {
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
        else { const old = st.lru.shift(); s = st.slots.get(old); st.slots.delete(old); }
        write(s, body());
        st.slots.set(rec.id, s);
      } else { if (again) write(s, body()); st.lru.splice(st.lru.indexOf(rec.id), 1); }
      st.lru.push(rec.id);
      return s;
    };
    st.release = (rec) => { if (st.slots.has(rec.id)) { st.free.push(st.slots.get(rec.id)); st.slots.delete(rec.id); st.lru.splice(st.lru.indexOf(rec.id), 1); } };
    return st;
  }
  // mid and near are drawn together in a frame at most as many as there are: nobody drawn this frame is evicted
  const stores = { mid: restStore(V, Math.max(1, exactCapacity - nearCapacity), 16), near: restStore(NEAR.V, nearCapacity, 2) };
  // the baked bodices (a slot each, of the class's bodice vertices): the near one from the full body, the reduced one (mid and far) from the reduced body; the second also says what each was baked from
  const layouts = {}, gstores = {}, garmentFrom = new Map(), bakes = { garment: 0, body: 0 };
  const layoutOf = (kind, outfit) => (layouts[kind + "|" + outfit.id] ??= outfitLayout(outfit, kind, kind === "far" ? FAR_SKIRT : kind === "reduced" ? MID_SKIRT : {}));
  const garmentStore = (kind, outfit) => { kind = kind === "near" ? "near" : "reduced"; return (gstores[kind + "|" + outfit.id] ??= restStore(layoutOf(kind, outfit).bodiceV, kind === "near" ? nearCapacity : capacity, 4)); };

  // ---- the draws: an entry a (tier, class) ----
  const tiers = { far: { cap: capacity }, mid: { cap: stores.mid.capMax }, near: { cap: nearCapacity } };
  const entries = new Map();
  const baseGeometry = {};
  const classKey = (rec) => { const d = rec.dressing; return d ? `${d.outfit.id}:${wearMask(d)}` : "base"; };
  const sharedAttrs = new Map();
  function geometryFor(tier, kind, outfit, mask) {
    const g = new THREE.BufferGeometry(), T = tier === "near" ? NEAR : TEMPLATE;
    const attrs = outfit ? sharedAttrs.get(tier + "|" + outfit.id) ?? (() => {
      const L = layoutOf(kind, outfit), body = tier === "far" ? TEMPLATE : null, n = L.V * 3, a = {};
      a.position = new Float32Array(n); a.normal = new Float32Array(n);
      if (body) { a.position.set(body.position); a.normal.set(body.normal); }         // near and mid read their rest shapes from slots: zeros stand in
      a.skinIndex = L.skinIndex; a.skinWeight = L.skinWeight; a.paint = L.paint; a.skirtRC = L.skirtRC;
      const o = Object.fromEntries(Object.entries(a).map(([k, arr]) => [k, new THREE.BufferAttribute(arr, k === "skinIndex" || k === "skinWeight" || k === "paint" ? 4 : k === "skirtRC" ? 2 : 3)]));
      sharedAttrs.set(tier + "|" + outfit.id, o); return o;
    })() : (baseGeometry[tier] ??= (() => {
      const o = {};
      // near has no template shape (each person's rest shape is read from the store): zeros stand in for the attributes three needs
      for (const k of ["position", "normal"]) o[k] = new THREE.BufferAttribute(T[k] ?? new Float32Array(T.V * 3), 3);
      o.skinIndex = new THREE.BufferAttribute(T.skinIndex, 4); o.skinWeight = new THREE.BufferAttribute(T.skinWeight, 4); o.paint = new THREE.BufferAttribute(T.paint, 4);
      return o;
    })());
    for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
    g.setIndex(new THREE.BufferAttribute(outfit ? layoutOf(kind, outfit).indexFor(mask) : T.index, 1));
    return g;
  }

  function entryFor(tier, rec) {
    const key = tier + "|" + classKey(rec);
    let e = entries.get(key);
    if (e) return e;
    // the far tier's 16 coefficients ride in the agent texture, four texels after the person's others, not as instanced vertex buffers: WebGPU allows 8 vertex buffers a pipeline (iPhone Safari and
    // Chromium alike) and the far class's attributes with four coefficient buffers were 9 (10 dressed)
    const d = rec.dressing, outfit = d?.outfit ?? null, mask = d ? wearMask(d) : 0, kind = tier === "near" ? "near" : tier === "far" ? "far" : "reduced", coefBase = outfit ? TEXELS_DRESSED : TEXELS, texels = coefBase + (tier === "far" ? 4 : 0);
    const cap = outfit && tier === "far" ? Math.min(capacity, DRESSED_FAR_CAP) : tiers[tier].cap, data = new Float32Array(texels * cap * 4), tex = new THREE.DataTexture(data, texels, cap, THREE.RGBAFormat, THREE.FloatType);
    const g = geometryFor(tier, kind, outfit, mask);
    e = { key, tier, cap, data, tex, texels, coefBase, outfit, mask, kind, count: 0 };
    e.material = material(e);
    const mesh = new THREE.Mesh(g, e.material.m); mesh.count = 0; mesh.frustumCulled = false; mesh.name = `people-${tier}-${outfit ? outfit.id + ":" + mask : "base"}`;
    group.add(mesh); e.mesh = mesh;
    entries.set(key, e);
    return e;
  }

  function material(e) {
    const { tex: agentTex, tier, outfit, mask } = e, shape = tier === "far" ? "morph" : "exact", store = shape === "exact" ? stores[tier] : null;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, side: tier === "near" ? THREE.DoubleSide : THREE.FrontSide });   // near: the base layer's hems show their inside; the garments are shells
    if (outfit) m.side = THREE.DoubleSide;
    const i = int(instanceIndex), si = attribute("skinIndex", "uvec4"), sw = attribute("skinWeight", "vec4");
    const paint = attribute("paint", "vec4");        // rgb + kind: 0 the person's skin, 1 the base layer's tint, 2 its own colour (eyes), and for a dressed class 3 the bodice, 4 the skirt, 5 the shift (its own colour)
    const L = outfit ? layoutOf(e.kind, outfit) : null;
    const col = (k) => textureLoad(agentTex, ivec2(k, i)).rgb;
    if (!outfit) m.colorNode = varying(mix(mix(col(3), col(2), step(0.5, paint.w)), paint.rgb, step(1.5, paint.w)));
    else {
      const k = paint.w, own = step(1.5, k).mul(float(1).sub(step(2.5, k))).add(step(4.5, k));
      let c = mix(col(3), col(2), step(0.5, k).mul(float(1).sub(step(1.5, k))));                       // skin, or the tint (kind 1)
      c = mix(c, col(4), step(2.5, k).mul(float(1).sub(step(3.5, k))));                                 // the bodice
      c = mix(c, col(5), step(3.5, k).mul(float(1).sub(step(4.5, k))));                                 // the skirt
      m.colorNode = varying(mix(c, paint.rgb, own));
    }
    const walk = walkNode();
    const gstore = outfit ? garmentStore(e.kind, outfit) : null;
    const skirt = outfit && (mask & 2) ? (e.skirt = makeSkirtGPU({ THREE, tsl: TSL, around: L.around, maxPeople: e.cap, agent: { tex: agentTex, texels: TEXELS_DRESSED }, bridge: tier === "far" ? 0 : undefined,
      walk: { makeNode: () => walkNode(), hU: walkHU, perRow, F, W: walkW, B } })) : null;
    // the passes run on every render of the scene, not once per animation-loop tick (three's FRAME type): an app or a page may render more than once a tick and the skirts must follow
    if (skirt) for (const pass of skirt.passes) pass.updateBeforeType = TSL.NodeUpdateType.RENDER;
    // the layer's neck cut, near: the body slot's w at the layer's vertices; the fragment is discarded where it is above the shift's edge
    if (outfit && tier === "near") {
      const gi = int(textureLoad(agentTex, ivec2(1, i)).y).mul(store.V).add(int(vertexIndex)).mul(2), cutLoad = textureLoad(store.tex, ivec2(gi.mod(REST_W), gi.div(REST_W)));
      store.nodes.push(cutLoad);
      m.maskNode = varying(select(int(vertexIndex).lessThan(L.bodyV), cutLoad.w, float(0))).lessThanEqual(0);
    }
    m.positionNode = Fn(() => {
      const a0 = textureLoad(agentTex, ivec2(0, i)).toVar(), a1 = textureLoad(agentTex, ivec2(1, i)).toVar();
      const x0 = vec3(0).toVar(), n0 = vec3(0).toVar(), vi = int(vertexIndex);
      const p = vec3(0).toVar(), n = vec3(0).toVar();
      const bodyEnd = L ? L.bodyV : 1e9, bodiceEnd = L ? L.bodyV + L.bodiceV : 1e9;
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
      const slot = a1.x, uu = slot.mod(perRow).mul(F + 1).add(a0.w.mul(F)).add(0.5).div(walkW).toVar();
      const row0 = slot.div(perRow).floor().mul(B * 2).toVar();
      const skin = () => {
        for (const c of ["x", "y", "z", "w"]) {
          const b = float(si[c]), w = sw[c];
          const q = walk.sample(vec2(uu, row0.add(b.mul(2)).add(0.5).div(walkHU))).level(0).normalize().toVar();
          const u = walk.sample(vec2(uu, row0.add(b.mul(2)).add(1.5).div(walkHU))).level(0).xyz;
          const tx = cross(q.xyz, x0).mul(2).toVar(), tn = cross(q.xyz, n0).mul(2).toVar();
          p.addAssign(x0.add(tx.mul(q.w)).add(cross(q.xyz, tx)).add(u).mul(w));
          n.addAssign(n0.add(tn.mul(q.w)).add(cross(q.xyz, tn)).mul(w));
        }
      };
      if (!L) { bodyPath(); skin(); }
      else {
        If(vi.lessThan(bodyEnd), () => { bodyPath(); skin(); })
          .ElseIf(vi.lessThan(bodiceEnd), () => { bodicePath(); skin(); })
          .Else(() => {
            if (skirt) {
              const rc = attribute("skirtRC", "vec2"), s = skirt.vertex({ instance: i, ring: int(rc.x), col: int(rc.y) });
              p.assign(s.position); n.assign(s.normal);
            }
          });
      }
      const ch = cos(a0.z), sh = sin(a0.z);
      normalLocal.assign(vec3(n.x.mul(ch).add(n.z.mul(sh)), n.y, n.z.mul(ch).sub(n.x.mul(sh))).normalize());
      return vec3(p.x.mul(ch).add(p.z.mul(sh)).add(a0.x), p.y.add(a1.z), p.z.mul(ch).sub(p.x.mul(sh)).add(a0.y));
    })();
    return { m };
  }

  // A walk slot: the person's walker baked once. Returns false if over this frame's budget (drawn from next frame on).
  let budgetLeft = 0;
  function walkSlot(rec) {
    if (rec.walkSlot !== undefined) return true;
    if (budgetLeft <= 0) return false;
    const t = performance.now();
    if (!freeWalk.length && nextWalk >= walkCap) growWalk();
    const slot = freeWalk.length ? freeWalk.pop() : nextWalk < walkCap ? nextWalk++ : -1;
    if (slot < 0) return false;
    const w = rec.walker;
    if (!w) return false;
    // bake into a one-person block, then into the shared texture as half floats
    bakeOne(w, 0, F, 1, F + 1, bakeRows, tmp);
    const bx = (slot % perRow) * (F + 1), by = Math.floor(slot / perRow) * 2 * B;
    for (let r = 0; r < 2 * B; r++) packHalf(walkData, ((by + r) * walkW + bx) * 4, bakeBits, r * (F + 1) * 4, (F + 1) * 4);
    rec.walkSlot = slot; walkDirty = true;
    budgetLeft -= performance.now() - t;
    return true;
  }

  // the garment's tint, for now a colour from the rank (the base layer's; a dressed person's is the outfit's shift); and the person's own skin, from their traits
  const tint = (rec) => { if (!rec.tint) { const c = new THREE.Color().setHSL(rec.rank * 7 % 1, 0.35, 0.45); rec.tint = [c.r, c.g, c.b]; } return rec.tint; };
  const skin = (rec) => { if (!rec.skin) { const c = new THREE.Color(rec.bodyParams.skin); rec.skin = [c.r, c.g, c.b]; } return rec.skin; };
  const rgb = (rec, name, hex) => { const k = "_c" + name; if (!rec[k]) { const c = new THREE.Color(hex); rec[k] = [c.r, c.g, c.b]; } return rec[k]; };

  // the near body's slot, filled with the base layer's neck cut when she is dressed (layer.js layerCut: s a layer vertex, 0 for the rest)
  const nearBody = (rec) => () => {
    const b = rec.buildNear(), d = rec.dressing;
    if (d) { const baked = bakeNear(b, rec.bodyParams, d.outfit); rec.nearGarment = baked; b.cut = new Float32Array(b.V); b.cut.set(baked.layerCut, UVN); }
    return b;
  };
  // her skirt's row: the numbers the passes read (fork B's writeSpecRow), kept with her
  const specRow = (rec) => (rec.specRow ??= (() => { const r = new Float32Array(SPEC_TEXELS * 4); writeSpecRow(r, 0, rec.dressing.spec, rec.far.J); return r; })());

  // Writes one class's people; returns how many. A person new to the near tier needs their full body built (about 4 ms): when this
  // frame's budget is spent they are drawn as mid for now (`demoted`), and near from the next frame.
  function write(e, list, demoted) {
    const name = e.tier, store = stores[name], outfit = e.outfit, texels = e.texels;
    let n = 0;
    for (const rec of list) {
      if (n >= e.cap) break;
      if (!walkSlot(rec)) continue;
      let ex = 0, gslot = 0;
      if (name === "near") {
        if (!store.slots.has(rec.id) && budgetLeft <= 0) { demoted.push(rec); continue; }
        const t = performance.now(); ex = store.slot(rec, nearBody(rec));
        if (outfit) { const g = garmentStore("near", outfit); gslot = g.slot(rec, () => { rec.nearGarment ??= bakeNear(rec.buildNear(), rec.bodyParams, outfit); return rec.nearGarment.bodice; }); }
        budgetLeft -= performance.now() - t;
      } else if (name === "mid") {
        ex = store.slot(rec, () => rec.body);
        if (outfit) { const g = garmentStore("reduced", outfit), exact = garmentFrom.get(rec.id) === "exact"; gslot = g.slot(rec, () => { bakes.garment++; garmentFrom.set(rec.id, "exact"); return bakeReduced(rec.body.position, rec.bodyParams, outfit).bodice; }, !exact && g.slots.has(rec.id)); }
      } else if (outfit) {        // far: the bodice from the reduced body the person's coefficients give (the exact one if mid has baked it already)
        const g = garmentStore("reduced", outfit);
        gslot = g.slot(rec, () => { bakes.garment++; garmentFrom.set(rec.id, "far"); return bakeReduced(farReducedPositions(rec.far.coef, rec.far.scale), rec.bodyParams, outfit).bodice; });
      }
      const o = n * texels * 4;
      e.data[o] = rec.pos[0]; e.data[o + 1] = rec.pos[2]; e.data[o + 2] = rec.heading; e.data[o + 3] = rec.phase;
      e.data[o + 4] = rec.walkSlot; e.data[o + 5] = ex; e.data[o + 6] = rec.pos[1];
      e.data.set(outfit ? rgb(rec, "shift", rec.dressing.look.shift) : tint(rec), o + 8); e.data.set(skin(rec), o + 12);
      if (outfit) {
        e.data.set(rgb(rec, "bodice", rec.dressing.look.bodice), o + 16); e.data[o + 19] = n;                  // the skirt's row is this instance's (fork B's passes write rows by instance)
        e.data.set(rgb(rec, "skirt", rec.dressing.look.skirt), o + 20); e.data[o + 23] = gslot;
        if (e.skirt) e.skirt.specData.set(specRow(rec), n * SPEC_TEXELS * 4);
      }
      if (name === "far") {
        e.data[o + 7] = rec.far.scale;
        for (let k = 0; k < KT; k++) e.data[o + 4 * e.coefBase + k] = rec.far.coef[k];
      }
      n++;
    }
    return n;
  }
  const finish = (e, n) => {
    e.mesh.count = n; e.count = n; e.tex.needsUpdate = true;
    if (e.skirt) { e.skirt.count.value = n; e.skirt.specTexture.needsUpdate = true; }
  };

  return {
    group,
    /** Draw this frame's tiers (population.tick's result). Returns the counts drawn per tier, `classes`: how many (tier, class) draws are in use, and `passes`: the skirts' render-to-texture passes (one a stage for every dressed person of a class, never one a person). */
    update(sorted) {
      budgetLeft = bakeBudgetMs;
      const demoted = [], counts = { near: 0, mid: 0, far: 0, classes: 0, passes: 0 };
      // near first (a person new to it may be demoted to mid this frame), then mid, then far; each class one draw
      const run = (tier, list) => {
        const byClass = new Map(); for (const rec of list) { const k = classKey(rec); let l = byClass.get(k); if (!l) byClass.set(k, l = []); l.push(rec); }
        const used = new Set();
        for (const [, l] of byClass) { const e = entryFor(tier, l[0]); used.add(e); const n = write(e, l, tier === "near" ? demoted : []); finish(e, n); counts[tier] += n; }
        return used;
      };
      const t0 = performance.now(), usedNear = run("near", sorted.near), t1 = performance.now();
      const usedMid = run("mid", demoted.length ? demoted.concat(sorted.mid) : sorted.mid), t2 = performance.now(), usedFar = run("far", sorted.far), t3 = performance.now();
      counts.bakes = { ...bakes }; counts.ms = { near: t1 - t0, mid: t2 - t1, far: t3 - t2 };
      for (const e of entries.values()) if (e.count !== 0 && !usedNear.has(e) && !usedMid.has(e) && !usedFar.has(e)) finish(e, 0);          // a class nobody is in any more is emptied once, not uploaded every frame
      for (const e of entries.values()) if (e.count > 0) { counts.classes++; if (e.skirt) counts.passes += e.skirt.passes.length; }
      if (walkDirty) { walkTex.needsUpdate = true; walkDirty = false; }
      for (const st of [...Object.values(stores), ...Object.values(gstores)]) if (st.dirty) { st.tex.needsUpdate = true; st.dirty = false; }
      return counts;
    },
    /** Free a removed person's slots. */
    release(rec) {
      if (rec.walkSlot !== undefined) { freeWalk.push(rec.walkSlot); rec.walkSlot = undefined; }
      for (const st of [...Object.values(stores), ...Object.values(gstores)]) st.release(rec);
      garmentFrom.delete(rec.id); rec.nearGarment = undefined; rec.specRow = undefined;
    },
    // walk texture, the far basis (two half-float textures), the rest slots of both topologies and the baked bodices (half floats), the skirts' spec rows, their render-to-texture passes (RGBA32F, a texel per person, ring and column) and the agent textures
    bytes: () => walkData.byteLength + dd.length + [...Object.values(stores), ...Object.values(gstores)].reduce((n, st) => n + st.data.byteLength, 0)
      + [...entries.values()].reduce((n, e) => n + e.data.byteLength + (e.skirt ? e.skirt.specData.byteLength + e.skirt.RW * e.skirt.RH * 16 * e.skirt.passes.length : 0), 0),
  };
}
