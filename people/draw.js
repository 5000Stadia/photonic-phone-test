// The population's drawing (R4; design/r4-plan.md): three instanced draws, one per tier, all reading one shared walk
// texture, so no tier can disagree about anyone's step.
//   far   the template body plus each person's coefficients on a 16-direction morph basis (C2c, R2's crowd probe)
//   mid   each person's exact rest shape, read from a texture of slots (C3t)
//   near  the same exact shapes in their own draw, the slot R5 fills with the near body, hair and face
// The far tier morphs at the mean height and then scales: the stand-in body is exactly linear in height, so this
// leaves the morph only the other parameters (error against the exact body over 300 people: median 0.24 cm, p95
// 0.9 cm, worst 1.2 cm, against 7.5 cm for a baby when height was a morph direction).
// Each frame, population.tick() sorts the seen into tiers; update() writes each tier's people into its agent texture
// (position, heading, phase, slots, tint) and sets its count. People get a walk slot the first time they're seen:
// their own walker baked into 32 frames (src/people/walk.js), at most `bakeBudgetMs` of baking a frame.

import { Fn, texture, textureLoad, uniform, ivec2, int, float, vec2, vec3, attribute, instanceIndex, vertexIndex, positionLocal, normalLocal, cos, sin, varying, cross } from "three/tsl";
import { TEMPLATE, B, farCoefs, morphBasis } from "./bodies.js";
import { bakeOne, TEXELS_PER_PERSON } from "./walk.js";

const F = 32, KT = 16, WALK_W = 2048, REST_W = 2048;

export function makeDraw(THREE, { capacity = 1024, exactCapacity = 160, nearCapacity = 16, bakeBudgetMs = 4 } = {}) {
  const V = TEMPLATE.position.length / 3;
  const group = new THREE.Group(); group.name = "people";
  const half16 = (src) => { const o = new Uint16Array(src.length); for (let i = 0; i < src.length; i++) o[i] = THREE.DataUtils.toHalfFloat(src[i]); return o; };

  // ---- the shared walk texture: slots of F+1 frames x 2B rows (quaternion row, offset row per bone) ----
  // Both slot textures start small and double when full (holo-emitter's trial: 26.6 MB for six people when they were
  // allocated at capacity), keeping every slot where it was; the shaders' texture nodes are pointed at the new one.
  const perRow = Math.floor(WALK_W / (F + 1)), walkW = perRow * (F + 1), rowsFor = (n) => Math.ceil(n / perRow) * 2 * B;
  let walkCap = Math.min(capacity, perRow), walkH = rowsFor(walkCap);
  let walkData = new Uint16Array(walkW * walkH * 4);
  const bakeRows = new Float32Array((F + 1) * 2 * B * 4);
  const walkTexture = (data, h) => { const t = new THREE.DataTexture(data, walkW, h, THREE.RGBAFormat, THREE.HalfFloatType);   // half floats: filterable on every WebGL2
    t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
  let walkTex = walkTexture(walkData, walkH);
  const walkHU = uniform(walkH), walkNodes = [], restNodes = [];
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

  // ---- mid and near: exact rest shapes in slots of V vertices x 2 texels (position, normal) ----
  const restRows = (n) => Math.ceil(n * V * 2 / REST_W);
  let restCap = Math.min(exactCapacity, 16), restData = new Uint16Array(REST_W * restRows(restCap) * 4);
  const restTexture = (data) => new THREE.DataTexture(data, REST_W, data.length / 4 / REST_W, THREE.RGBAFormat, THREE.HalfFloatType);
  let restTex = restTexture(restData);
  function growRest() {
    restCap = Math.min(exactCapacity, restCap * 2); const d = new Uint16Array(REST_W * restRows(restCap) * 4);
    d.set(restData); restData = d;
    const old = restTex; restTex = restTexture(restData); restTex.needsUpdate = true; for (const n of restNodes) n.value = restTex; old.dispose();
  }
  let restDirty = false;
  const exactSlots = new Map(), exactLRU = [], freeExact = [];      // id -> slot; least recently drawn first
  let nextExact = 0;

  // ---- per-tier agent textures: 3 texels an instance: [x, z, heading, phase], [walk slot, exact slot, y, 0], tint ----
  const tiers = {};
  // mid and near together never need more exact slots than there are, so nobody drawn this frame is evicted
  for (const [name, cap] of [["far", capacity], ["mid", exactCapacity - nearCapacity], ["near", nearCapacity]]) {
    const data = new Float32Array(3 * cap * 4), tex = new THREE.DataTexture(data, 3, cap, THREE.RGBAFormat, THREE.FloatType);
    const g = new THREE.BufferGeometry();
    for (const k of ["position", "normal"]) g.setAttribute(k, new THREE.BufferAttribute(TEMPLATE[k], 3));
    g.setAttribute("skinIndex", new THREE.BufferAttribute(TEMPLATE.skinIndex, 4)); g.setAttribute("skinWeight", new THREE.BufferAttribute(TEMPLATE.skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(TEMPLATE.index, 1));
    let coef = null;
    if (name === "far") { coef = []; for (let c = 0; c < 4; c++) { const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute("coef" + c, at); coef.push(at); } }
    const mesh = new THREE.Mesh(g, material(THREE, tex, name === "far" ? "morph" : "exact"));
    mesh.count = 0; mesh.frustumCulled = false; mesh.name = "people-" + name; group.add(mesh);
    tiers[name] = { cap, data, tex, mesh, coef };
  }

  function material(THREE, agentTex, shape) {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
    const i = int(instanceIndex), si = attribute("skinIndex", "uvec4"), sw = attribute("skinWeight", "vec4");
    m.colorNode = varying(textureLoad(agentTex, ivec2(2, i)).rgb);
    const walkNode = texture(walkTex); walkNodes.push(walkNode);
    m.positionNode = Fn(() => {
      const a0 = textureLoad(agentTex, ivec2(0, i)).toVar(), a1 = textureLoad(agentTex, ivec2(1, i)).toVar();
      let x0, n0;
      if (shape === "exact") {
        const gi = int(a1.y).mul(V).add(int(vertexIndex)).mul(2).toVar();
        const rp = textureLoad(restTex, ivec2(gi.mod(REST_W), gi.div(REST_W))), rn = textureLoad(restTex, ivec2(gi.add(1).mod(REST_W), gi.add(1).div(REST_W)));
        restNodes.push(rp, rn);
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
    const bx = (slot % perRow) * (F + 1), by = Math.floor(slot / perRow) * 2 * B, toH = THREE.DataUtils.toHalfFloat;
    for (let r = 0; r < 2 * B; r++) for (let c = 0; c <= F; c++) for (let k = 0; k < 4; k++)
      walkData[((by + r) * walkW + bx + c) * 4 + k] = toH(bakeRows[(r * (F + 1) + c) * 4 + k]);
    rec.walkSlot = slot; walkDirty = true;
    budgetLeft -= performance.now() - t;
    return true;
  }

  function exactSlot(rec) {
    let s = exactSlots.get(rec.id);
    if (s === undefined) {
      if (freeExact.length) s = freeExact.pop();
      else if (nextExact < exactCapacity) { if (nextExact >= restCap) growRest(); s = nextExact++; }
      else { const old = exactLRU.shift(); s = exactSlots.get(old); exactSlots.delete(old); }
      const b = rec.body, toH = THREE.DataUtils.toHalfFloat;
      for (let v = 0; v < V; v++) {
        const o = ((s * V + v) * 2) * 4;
        for (let a = 0; a < 3; a++) { restData[o + a] = toH(b.position[v * 3 + a]); restData[o + 4 + a] = toH(b.normal[v * 3 + a]); }
      }
      exactSlots.set(rec.id, s); restDirty = true;
    } else exactLRU.splice(exactLRU.indexOf(rec.id), 1);
    exactLRU.push(rec.id);
    return s;
  }

  // tint for the stand-ins: a garment-ish colour from the id (wardrobe comes with R5)
  const tint = (rec) => { if (!rec.tint) { const c = new THREE.Color().setHSL(rec.rank * 7 % 1, 0.35, 0.45); rec.tint = [c.r, c.g, c.b]; } return rec.tint; };

  function write(name, list) {
    const T = tiers[name];
    let n = 0;
    for (const rec of list) {
      if (n >= T.cap) break;
      if (!walkSlot(rec)) continue;
      const o = n * 12, ex = name === "far" ? 0 : exactSlot(rec);
      T.data[o] = rec.pos[0]; T.data[o + 1] = rec.pos[2]; T.data[o + 2] = rec.heading; T.data[o + 3] = rec.phase;
      T.data[o + 4] = rec.walkSlot; T.data[o + 5] = ex; T.data[o + 6] = rec.pos[1];
      T.data.set(tint(rec), o + 8);
      if (T.coef) {
        rec.far ??= farCoefs(rec.bodyParams);
        T.data[o + 7] = rec.far.scale;
        for (let c = 0; c < 4; c++) T.coef[c].array.set(rec.far.coef.slice(c * 4, c * 4 + 4), n * 4);
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
      const counts = { near: write("near", sorted.near), mid: write("mid", sorted.mid), far: write("far", sorted.far) };
      if (walkDirty) { walkTex.needsUpdate = true; walkDirty = false; }
      if (restDirty) { restTex.needsUpdate = true; restDirty = false; }
      return counts;
    },
    /** Free a removed person's slots. */
    release(rec) {
      if (rec.walkSlot !== undefined) { freeWalk.push(rec.walkSlot); rec.walkSlot = undefined; }
      if (exactSlots.has(rec.id)) { freeExact.push(exactSlots.get(rec.id)); exactSlots.delete(rec.id); exactLRU.splice(exactLRU.indexOf(rec.id), 1); }
    },
    bytes: () => walkData.byteLength + dd.length + restData.byteLength,     // the two morph textures are half floats
  };
}
