// The population's drawing (R4, R5; design/r4-plan.md, r5-plan.md): three instanced draws, one per tier, all reading one shared walk
// texture, so no tier can disagree about anyone's step. Two topologies: the reduced mesh (1.5k vertices) for far and mid, the full
// drawn body with its base layer and eyes (about 16k) for near.
//   far   the template body plus each person's coefficients on a 16-direction morph basis, at unit height, then an exact height
//         scale (C2c, R2's crowd probe; fitted by tools/people/far-fit.mjs on bodies after the rig's repose)
//   mid   each person's exact reduced rest shape, read from a texture of slots (C3t)
//   near  each person's exact full rest shape, from its own slot texture, since its vertex count differs
// Colour is per vertex (`paint`, from bodies.js): skin vertices take the person's own skin colour, cloth vertices (the base layer, as
// a flag on the reduced mesh and as its own vertices on the full body) take the garment tint, and eyes carry their own colour.
// The far tier's morph basis is fitted on the walking stance, so the three tiers stand alike; the bodies skin on the rig's 21 bones.
// Each frame, population.tick() sorts the seen into tiers; update() writes each tier's people into its agent texture
// (position, heading, phase, slots, tint, skin) and sets its count. People get a walk slot the first time they're seen:
// their own walker baked into 32 frames (src/people/walk.js), at most `bakeBudgetMs` of baking a frame.

import { Fn, texture, textureLoad, uniform, ivec2, int, float, vec2, vec3, attribute, instanceIndex, vertexIndex, positionLocal, normalLocal, cos, sin, varying, cross, mix, step } from "three/tsl";
import { TEMPLATE, NEAR, B, morphBasis } from "./bodies.js";
import { bakeOne, TEXELS_PER_PERSON } from "./walk.js";
import { half, bitsOf, packHalf } from "./half.js";

const F = 32, KT = 16, WALK_W = 2048, REST_W = 2048, TEXELS = 4;      // an instance takes 4 agent texels: [x, z, heading, phase], [walk slot, exact slot, y, scale], tint, skin

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

  // ---- mid and near: exact rest shapes in slots of V vertices x 2 texels (position, normal), one store per topology ----
  // Each store starts small and doubles when full (as the walk texture does), keeping every slot where it was.
  function restStore(Vs, capMax, first) {
    const rows = (n) => Math.ceil(n * Vs * 2 / REST_W), tex = (data) => new THREE.DataTexture(data, REST_W, data.length / 4 / REST_W, THREE.RGBAFormat, THREE.HalfFloatType);
    const st = { V: Vs, cap: Math.min(capMax, first), capMax, nodes: [], slots: new Map(), lru: [], free: [], next: 0, dirty: false };
    st.data = new Uint16Array(REST_W * rows(st.cap) * 4); st.tex = tex(st.data);
    st.grow = () => {
      st.cap = Math.min(capMax, st.cap * 2); const d = new Uint16Array(REST_W * rows(st.cap) * 4);
      d.set(st.data); st.data = d;
      const old = st.tex; st.tex = tex(d); st.tex.needsUpdate = true; for (const n of st.nodes) n.value = st.tex; old.dispose();
    };
    // the slot of a person's exact shape, filled from body() when they have none; least recently drawn is evicted when full
    st.slot = (rec, body) => {
      let s = st.slots.get(rec.id);
      if (s === undefined) {
        if (st.free.length) s = st.free.pop();
        else if (st.next < capMax) { if (st.next >= st.cap) st.grow(); s = st.next++; }
        else { const old = st.lru.shift(); s = st.slots.get(old); st.slots.delete(old); }
        const b = body(), d = st.data, pu = bitsOf(b.position), nu = bitsOf(b.normal);
        for (let v = 0, o = s * Vs * 8; v < Vs; v++, o += 8) {
          const i = v * 3;
          d[o] = half(pu[i]); d[o + 1] = half(pu[i + 1]); d[o + 2] = half(pu[i + 2]);
          d[o + 4] = half(nu[i]); d[o + 5] = half(nu[i + 1]); d[o + 6] = half(nu[i + 2]);
        }
        st.slots.set(rec.id, s); st.dirty = true;
      } else st.lru.splice(st.lru.indexOf(rec.id), 1);
      st.lru.push(rec.id);
      return s;
    };
    st.release = (rec) => { if (st.slots.has(rec.id)) { st.free.push(st.slots.get(rec.id)); st.slots.delete(rec.id); st.lru.splice(st.lru.indexOf(rec.id), 1); } };
    return st;
  }
  // mid and near are drawn together in a frame at most as many as there are: nobody drawn this frame is evicted
  const stores = { mid: restStore(V, Math.max(1, exactCapacity - nearCapacity), 16), near: restStore(NEAR.V, nearCapacity, 2) };

  // ---- per-tier agent textures: TEXELS an instance ----
  const tiers = {};
  for (const [name, cap] of [["far", capacity], ["mid", stores.mid.capMax], ["near", nearCapacity]]) {
    const data = new Float32Array(TEXELS * cap * 4), tex = new THREE.DataTexture(data, TEXELS, cap, THREE.RGBAFormat, THREE.FloatType);
    const T = name === "near" ? NEAR : TEMPLATE, g = new THREE.BufferGeometry();
    // near has no template shape (each person's rest shape is read from the store): zeros stand in for the attributes three needs
    for (const k of ["position", "normal"]) g.setAttribute(k, new THREE.BufferAttribute(T[k] ?? new Float32Array(T.V * 3), 3));
    g.setAttribute("skinIndex", new THREE.BufferAttribute(T.skinIndex, 4)); g.setAttribute("skinWeight", new THREE.BufferAttribute(T.skinWeight, 4));
    g.setAttribute("paint", new THREE.BufferAttribute(T.paint, 4));
    g.setIndex(new THREE.BufferAttribute(T.index, 1));
    let coef = null;
    if (name === "far") { coef = []; for (let c = 0; c < 4; c++) { const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute("coef" + c, at); coef.push(at); } }
    const mesh = new THREE.Mesh(g, material(THREE, tex, name === "far" ? "morph" : "exact", stores[name], name === "near"));
    mesh.count = 0; mesh.frustumCulled = false; mesh.name = "people-" + name; group.add(mesh);
    tiers[name] = { cap, data, tex, mesh, coef };
  }

  function material(THREE, agentTex, shape, store, double) {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, side: double ? THREE.DoubleSide : THREE.FrontSide });   // near: the base layer's hems show their inside
    const i = int(instanceIndex), si = attribute("skinIndex", "uvec4"), sw = attribute("skinWeight", "vec4");
    const paint = attribute("paint", "vec4");        // rgb + kind: 0 the person's skin, 1 the garment's tint, 2 its own colour (eyes)
    m.colorNode = varying(mix(mix(textureLoad(agentTex, ivec2(3, i)).rgb, textureLoad(agentTex, ivec2(2, i)).rgb, step(0.5, paint.w)), paint.rgb, step(1.5, paint.w)));
    const walkNode = texture(walkTex); walkNodes.push(walkNode);
    m.positionNode = Fn(() => {
      const a0 = textureLoad(agentTex, ivec2(0, i)).toVar(), a1 = textureLoad(agentTex, ivec2(1, i)).toVar();
      let x0, n0;
      if (shape === "exact") {
        const gi = int(a1.y).mul(store.V).add(int(vertexIndex)).mul(2).toVar();
        const rp = textureLoad(store.tex, ivec2(gi.mod(REST_W), gi.div(REST_W))), rn = textureLoad(store.tex, ivec2(gi.add(1).mod(REST_W), gi.add(1).div(REST_W)));
        store.nodes.push(rp, rn);
        x0 = rp.xyz.toVar(); n0 = rn.xyz.toVar();
      } else {
        x0 = positionLocal.toVar(); n0 = normalLocal.toVar();
        const vi = int(vertexIndex);
        for (let t = 0; t < KT; t++) {
          const gi = vi.add(t * V), c = attribute("coef" + (t >> 2), "vec4")[["x", "y", "z", "w"][t & 3]];
          x0.addAssign(textureLoad(deltaTex, ivec2(gi.mod(dW), gi.div(dW))).xyz.mul(c));
          n0.addAssign(textureLoad(normalDeltaTex, ivec2(gi.mod(dW), gi.div(dW))).xyz.mul(c));
        }
        n0.assign(n0.normalize());
        x0.assign(x0.mul(a1.w));                                       // height, as an exact scale
      }
      const slot = a1.x, uu = slot.mod(perRow).mul(F + 1).add(a0.w.mul(F)).add(0.5).div(walkW).toVar();
      const row0 = slot.div(perRow).floor().mul(B * 2).toVar();
      const p = vec3(0).toVar(), n = vec3(0).toVar();
      for (const c of ["x", "y", "z", "w"]) {
        const b = float(si[c]), w = sw[c];
        const q = walkNode.sample(vec2(uu, row0.add(b.mul(2)).add(0.5).div(walkHU))).level(0).normalize().toVar();
        const u = walkNode.sample(vec2(uu, row0.add(b.mul(2)).add(1.5).div(walkHU))).level(0).xyz;
        const tx = cross(q.xyz, x0).mul(2).toVar(), tn = cross(q.xyz, n0).mul(2).toVar();
        p.addAssign(x0.add(tx.mul(q.w)).add(cross(q.xyz, tx)).add(u).mul(w));
        n.addAssign(n0.add(tn.mul(q.w)).add(cross(q.xyz, tn)).mul(w));
      }
      const ch = cos(a0.z), sh = sin(a0.z);
      normalLocal.assign(vec3(n.x.mul(ch).add(n.z.mul(sh)), n.y, n.z.mul(ch).sub(n.x.mul(sh))).normalize());
      return vec3(p.x.mul(ch).add(p.z.mul(sh)).add(a0.x), p.y.add(a1.z), p.z.mul(ch).sub(p.x.mul(sh)).add(a0.y));
    })();
    return m;
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

  // the garment's tint, for now a colour from the rank (the wardrobe comes later in R5); and the person's own skin, from their traits
  const tint = (rec) => { if (!rec.tint) { const c = new THREE.Color().setHSL(rec.rank * 7 % 1, 0.35, 0.45); rec.tint = [c.r, c.g, c.b]; } return rec.tint; };
  const skin = (rec) => { if (!rec.skin) { const c = new THREE.Color(rec.bodyParams.skin); rec.skin = [c.r, c.g, c.b]; } return rec.skin; };

  // Writes a tier's people; returns how many. A person new to the near tier needs their full body built (about 4 ms): when this
  // frame's budget is spent they are drawn as mid for now (`demoted`), and near from the next frame.
  function write(name, list, demoted) {
    const T = tiers[name], store = stores[name];
    let n = 0;
    for (const rec of list) {
      if (n >= T.cap) break;
      if (!walkSlot(rec)) continue;
      let ex = 0;
      if (name === "near") {
        if (!store.slots.has(rec.id) && budgetLeft <= 0) { demoted.push(rec); continue; }
        const t = performance.now(); ex = store.slot(rec, () => rec.buildNear()); budgetLeft -= performance.now() - t;
      } else if (name === "mid") ex = store.slot(rec, () => rec.body);
      const o = n * TEXELS * 4;
      T.data[o] = rec.pos[0]; T.data[o + 1] = rec.pos[2]; T.data[o + 2] = rec.heading; T.data[o + 3] = rec.phase;
      T.data[o + 4] = rec.walkSlot; T.data[o + 5] = ex; T.data[o + 6] = rec.pos[1];
      T.data.set(tint(rec), o + 8); T.data.set(skin(rec), o + 12);
      if (T.coef) {
        T.data[o + 7] = rec.far.scale;
        for (let k = 0; k < KT; k++) T.coef[k >> 2].array[n * 4 + (k & 3)] = rec.far.coef[k];
      }
      n++;
    }
    T.mesh.count = n; T.tex.needsUpdate = true;
    if (T.coef) for (const a of T.coef) a.needsUpdate = true;
    return n;
  }

  return {
    group,
    /** Draw this frame's tiers (population.tick's result). Returns the counts drawn per tier. */
    update(sorted) {
      budgetLeft = bakeBudgetMs;
      const demoted = [], near = write("near", sorted.near, demoted);
      const counts = { near, mid: write("mid", demoted.length ? demoted.concat(sorted.mid) : sorted.mid), far: write("far", sorted.far) };
      if (walkDirty) { walkTex.needsUpdate = true; walkDirty = false; }
      for (const st of Object.values(stores)) if (st.dirty) { st.tex.needsUpdate = true; st.dirty = false; }
      return counts;
    },
    /** Free a removed person's slots. */
    release(rec) {
      if (rec.walkSlot !== undefined) { freeWalk.push(rec.walkSlot); rec.walkSlot = undefined; }
      for (const st of Object.values(stores)) st.release(rec);
    },
    // walk texture, the far basis (two half-float textures), the rest slots of both topologies (half floats)
    bytes: () => walkData.byteLength + dd.length + stores.mid.data.byteLength + stores.near.data.byteLength,
  };
}
