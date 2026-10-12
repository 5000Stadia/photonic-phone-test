// The crowd probe (M1, R2): what is the cheapest way to draw 300 *different* walking skinned bodies in very few draws, in three.js r186
// (WebGPURenderer on WebGPU and on WebGL 2)? See RESULTS.md. One page, three candidates plus the built-in path, on the stand-in body
// of body.js:
//   ?method=c1   K archetype bodies (?K=12), one instanced draw each, per-instance scale, tint and phase
//   ?method=c2   one instanced draw of the mean body + a morph basis (?k=16 targets); each instance's coefficients in three's own
//                InstancedMesh-style morphTexture (built-in TSL morph), then skinning in our position node from the rig textures
//   ?method=c3   one merged geometry holding n unique rest shapes; person = vertexIndex / vertices-per-body; skinned the same way
//   ?method=c2b  three's built-in path only: a SkinnedMesh marked instanced (as in webgpu_skinning_instancing) with the morphTexture.
//                Morph and skin compose, but every instance shares one skeleton: one pose, one phase, mean-body joints.
//   ?method=c2c  C2 with our own morph in the position node: coefficients as instanced attributes, deltas in an RGBA16F texture
//   ?method=c3t  C3 without the merged buffer: the template mesh instanced, each instance's rest shape read from an RGBA16F texture
// Other switches: ?n=300 people · ?webgl=1 forces WebGL 2 · ?shadows=1 · ?view=close · ?seed=1 · ?dpr=1 · ?gpu=0 (no timestamps)
// ?run=1 measures (2 s warm-up, 5 s timed, then 40 frames drawn one at a time with their GPU timestamps awaited) and sets
// window.__result; ?shot=1 sets window.__shot when the picture is ready.
//
// Skinning (c1, c2, c3): bone world rotations R_b(frame) are the same for every body (identity rest rotations), so they live in one
// small texture; each rig (a body, or an archetype in c1) has u_b(frame) = P_b - R_b j_b in a second texture. A vertex is
// x' = sum_k w_k (R_bk x + u_bk). Both textures are RGBA16F with linear filtering, laid out frames along x with frame 0 repeated at
// the end, so one filtered fetch interpolates between frames: 4 fetches per influence, as three's own bone-matrix skinning.
import * as THREE from "three/webgpu";
import { Fn, texture, textureLoad, ivec2, int, float, vec2, vec3, uniform, instanceIndex, vertexIndex, attribute, positionLocal, normalLocal, cos, sin, varying } from "three/tsl";
import * as Bd from "./body.js";

// Published as a private claude.ai page for Kabe's phone test (2026-10-12): the artifact frame passes no query string, so the
// settings ride in the hash as one token, METHOD-N[-gl] (e.g. #c3t-300, #c3t-1000-gl), and the buttons reload with a new token.
const TOKEN = (location.hash || "").replace(/^#/, "").split("-");
const P = { method: TOKEN[0] || "c3t", n: TOKEN[1] || "300", webgl: TOKEN.includes("gl") ? "1" : "0" };
const Q = { get: (k) => (k in P ? P[k] : null) };
const method = Q.get("method") || "c3t", N = +(Q.get("n") || 300), K = +(Q.get("K") || 12), KT = Math.min(16, +(Q.get("k") || 16));
const seed = +(Q.get("seed") || 1), F = 32, RUN = Q.get("run") === "1", SHOT = Q.get("shot") === "1", SHADOWS = Q.get("shadows") === "1";
const hud = document.getElementById("hud"), say = t => { hud.textContent = t; };
const nav = document.getElementById("nav");
const go = (set) => { const p = { ...P, ...set }; location.hash = [p.method, p.n].concat(p.webgl === "1" ? ["gl"] : []).join("-"); location.reload(); };
for (const [label, set] of [["one draw (c3t)", { method: "c3t" }], ["12 archetypes (c1)", { method: "c1" }], ["morph basis (c2c)", { method: "c2c" }], ["300", { n: "300" }], ["1000", { n: "1000" }], ["3000", { n: "3000" }], [P.webgl === "1" ? "use WebGPU" : "use WebGL2", { webgl: P.webgl === "1" ? "0" : "1" }]]) {
  const b = document.createElement("button"); b.type = "button"; b.textContent = label;
  if ((set.method && set.method === method) || (set.n && +set.n === N)) b.className = "on";
  b.addEventListener("click", () => go(set));
  nav.append(b);
}
// What this browser offers, shown first, so a failure says what is missing (Kabe's iPhone reported "browser can't support it").
const caps = (() => { let gl2 = false; try { gl2 = !!document.createElement("canvas").getContext("webgl2"); } catch (_) {}
  return `WebGPU ${"gpu" in navigator ? "present" : "absent"} · WebGL2 ${gl2 ? "present" : "absent"} · ${navigator.userAgent}`; })();
say("starting…\n" + caps);
let lastErr = ""; try { lastErr = sessionStorage.getItem("webgpuError") || ""; } catch (_) {}
const fail = (m) => { try { if (P.webgl !== "1") sessionStorage.setItem("webgpuError", String(m)); } catch (_) {}
  say("error: " + m + "\n" + caps + (P.webgl === "1" ? "" : "\ntrying WebGL2 in 3 s…"));
  if (P.webgl !== "1") setTimeout(() => go({ webgl: "1" }), 3000); };
window.onerror = (m) => fail(m);
window.addEventListener("unhandledrejection", (e) => fail(e.reason && e.reason.message || String(e.reason)));

const tBuild0 = performance.now();
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: Q.get("webgl") === "1", trackTimestamp: Q.get("gpu") !== "0" && "gpu" in navigator && P.webgl !== "1" });
renderer.setPixelRatio(Q.get("dpr") ? +Q.get("dpr") : Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = SHADOWS;
document.body.prepend(renderer.domElement); await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? "webgpu" : "webgl2";

// ---------- the people: parameters, look, where they walk ----------
const rand = Bd.rng(seed);
let people = Array.from({ length: N }, () => {
  const p = Bd.randomParams(rand), hue = rand(), cad = 0.85 + rand() * 0.2;
  return { p, color: new THREE.Color().setHSL(hue, 0.35 + rand() * 0.3, 0.35 + rand() * 0.25), cad, speed: cad * 1.45 * p[0] * p[1],
           x: 0, z: 0, h: rand() * Math.PI * 2, ph: rand(), arch: 0, scale: [1, 1, 1] };
});
const side = Math.sqrt(N) * 1.7;
for (const a of people) { a.x = (rand() - 0.5) * side; a.z = (rand() - 0.5) * side; }

// C1's archetypes: K bodies; each person takes the nearest (all parameters but height, in spreads) and a scale for height and girth
let archetypes = null;
if (method === "c1") {
  const ar = Bd.rng(seed * 7919 + 1);
  archetypes = Array.from({ length: K }, () => Bd.randomParams(ar));
  const dist = (a, b) => a.reduce((s, v, j) => j === 0 ? s : s + ((v - b[j]) / Bd.PARAMS[j][2]) ** 2, 0);
  for (const a of people) {
    let best = 0; archetypes.forEach((q, k) => { if (dist(a.p, q) < dist(a.p, archetypes[best])) best = k; });
    a.arch = best; const q = archetypes[best], girth = Math.sqrt(((a.p[5] + a.p[6]) / (q[5] + q[6])));
    a.scale = [girth, a.p[0] / q[0], girth];
  }
  people.sort((a, b) => a.arch - b.arch);           // so each archetype's people are a contiguous run: person = offset + instance
}

// ---------- per-person data textures (positions, heading, phase updated each frame by the CPU walker) ----------
const AW = 256, AH = Math.ceil(N / AW);
const agentData = new Float32Array(AW * AH * 4), lookData = new Float32Array(AW * AH * 4);
const agentTex = new THREE.DataTexture(agentData, AW, AH, THREE.RGBAFormat, THREE.FloatType);
const lookTex = new THREE.DataTexture(lookData, AW, AH, THREE.RGBAFormat, THREE.FloatType);   // tint rgb + C1's height scale
const scaleData = new Float32Array(AW * AH * 4), scaleTex = new THREE.DataTexture(scaleData, AW, AH, THREE.RGBAFormat, THREE.FloatType);
people.forEach((a, i) => {
  lookData.set([a.color.r, a.color.g, a.color.b, 1], i * 4); scaleData.set([...a.scale, 0], i * 4);
});
for (const t of [agentTex, lookTex, scaleTex]) t.needsUpdate = true;
const writeAgents = () => { people.forEach((a, i) => { const o = i * 4; agentData[o] = a.x; agentData[o + 1] = a.z; agentData[o + 2] = a.h; agentData[o + 3] = a.ph; }); agentTex.needsUpdate = true; };
writeAgents();

// the walker: straight lines, turning back at the edges; the phase advances with each person's cadence
function walk(dt) {
  const half = side / 2;
  for (const a of people) {
    a.x += Math.sin(a.h) * a.speed * dt; a.z += Math.cos(a.h) * a.speed * dt;
    if (a.x > half || a.x < -half) { a.h = -a.h; a.x = Math.max(-half, Math.min(half, a.x)); }
    if (a.z > half || a.z < -half) { a.h = Math.PI - a.h; a.z = Math.max(-half, Math.min(half, a.z)); }
    a.ph = (a.ph + a.cad * dt) % 1;
  }
}

// ---------- rig textures ----------
const half16 = (src) => { const o = new Uint16Array(src.length); for (let i = 0; i < src.length; i++) o[i] = THREE.DataUtils.toHalfFloat(src[i]); return o; };
const filtTex = (data, w, h) => { const t = new THREE.DataTexture(half16(data), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t; };

// ---------- the bodies per method ----------
const mean = Bd.buildBody(Bd.MEAN), V = mean.position.length / 3;
const bytes = {};                                    // crowd data, by what it is
const geomFrom = (b, copyIndex = true) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position, 3)); g.setAttribute("normal", new THREE.BufferAttribute(b.normal, 3));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(b.skinIndex, 4)); g.setAttribute("skinWeight", new THREE.BufferAttribute(b.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(copyIndex ? b.index.slice() : b.index, 1)); return g;
};
const geomBytes = g => { let s = 0; for (const a of Object.values(g.attributes)) s += a.array.byteLength; if (g.index) s += g.index.array.byteLength;
  for (const list of Object.values(g.morphAttributes)) for (const a of list) s += a.count * 16; return s; };   // morphs: three packs one RGBA32F texel per vertex per target

let rigSets;                                       // the rest joints of each rig
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x6b6e72);
const crowd = new THREE.Group(); scene.add(crowd);

function material(pidNode, rigNode, withScale, rest = null) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
  const rotNode = texture(rotTex), offNode = texture(offTex), si = attribute("skinIndex", "uvec4"), sw = attribute("skinWeight", "vec4");
  const pid = pidNode, ix = pid.mod(int(AW)), iy = pid.div(int(AW));
  m.colorNode = varying(textureLoad(lookTex, ivec2(ix, iy)).rgb);
  m.positionNode = Fn(() => {
    const ag = textureLoad(agentTex, ivec2(ix, iy)).toVar();
    const r = rest ? rest() : { x: positionLocal, n: normalLocal }, x0 = r.x.toVar(), n0 = r.n.toVar();
    const fx = ag.w.mul(F).add(0.5).toVar(), rig = rigNode;
    const offU = float(rig.mod(int(rig_.perRow))).mul(F + 1).add(fx).div(rig_.offW).toVar();
    const offRow = float(rig.div(int(rig_.perRow))).mul(Bd.B).toVar(), rotU = fx.div(rig_.rotW).toVar();
    const p = vec3(0).toVar(), n = vec3(0).toVar();
    for (const c of ["x", "y", "z", "w"]) {
      const b = float(si[c]), w = sw[c];
      const r0 = rotNode.sample(vec2(rotU, b.mul(3).add(0.5).div(rig_.rotH))).level(0).xyz;
      const r1 = rotNode.sample(vec2(rotU, b.mul(3).add(1.5).div(rig_.rotH))).level(0).xyz;
      const r2 = rotNode.sample(vec2(rotU, b.mul(3).add(2.5).div(rig_.rotH))).level(0).xyz;
      const u = offNode.sample(vec2(offU, offRow.add(b).add(0.5).div(rig_.offH))).level(0).xyz;
      p.addAssign(r0.mul(x0.x).add(r1.mul(x0.y)).add(r2.mul(x0.z)).add(u).mul(w));
      n.addAssign(r0.mul(n0.x).add(r1.mul(n0.y)).add(r2.mul(n0.z)).mul(w));
    }
    let ps = p, ns = n;
    if (withScale) { const s = textureLoad(scaleTex, ivec2(ix, iy)).xyz; ps = p.mul(s); ns = n.div(s); }
    const ch = cos(ag.z), sh = sin(ag.z);
    normalLocal.assign(vec3(ns.x.mul(ch).add(ns.z.mul(sh)), ns.y, ns.z.mul(ch).sub(ns.x.mul(sh))).normalize());
    return vec3(ps.x.mul(ch).add(ps.z.mul(sh)).add(ag.x), ps.y, ps.z.mul(ch).sub(ps.x.mul(sh)).add(ag.y));
  })();
  return m;
}

let rig_, rotTex, offTex, drawsExpected, vertsPerPerson = V, update = () => {};
const linearJoints = (dirs, c) => mean.joints.J.map((j, b) => j.map((v, a) => v + dirs.reduce((s, d, t) => s + c[t] * d[b][a], 0)));

if (method === "c1") {
  const bodies = archetypes.map(q => Bd.buildBody(q));
  rigSets = bodies.map(b => b.joints.J);
  rig_ = Bd.bakeRig(rigSets, F); rotTex = filtTex(rig_.rot, rig_.rotW, rig_.rotH); offTex = filtTex(rig_.off, rig_.offW, rig_.offH);
  let offset = 0; bytes.meshes = 0;
  bodies.forEach((b, k) => {
    const count = people.filter(a => a.arch === k).length; if (!count) return;
    const g = geomFrom(b); bytes.meshes += geomBytes(g);
    const mesh = new THREE.Mesh(g, material(int(instanceIndex).add(int(uniform(offset, "int"))), int(uniform(k, "int")), true));
    mesh.count = count; mesh.frustumCulled = false; crowd.add(mesh); offset += count;
  });
  drawsExpected = crowd.children.length;
} else if (method === "c2" || method === "c2b") {
  const g = geomFrom(mean, false), deltas = [], jdirs = [];
  for (let t = 0; t < KT; t++) {
    const q = Bd.MEAN.slice(); q[t] += Bd.PARAMS[t][2]; const b = Bd.buildBody(q), d = new Float32Array(b.position.length);
    for (let i = 0; i < d.length; i++) d[i] = b.position[i] - mean.position[i];
    deltas.push(new THREE.BufferAttribute(d, 3)); jdirs.push(b.joints.J.map((j, bi) => j.map((v, a) => v - mean.joints.J[bi][a])));
  }
  g.morphAttributes.position = deltas; g.morphTargetsRelative = true;
  const coef = people.map(a => Array.from({ length: KT }, (_, t) => (a.p[t] - Bd.MEAN[t]) / Bd.PARAMS[t][2]));
  const mt = new Float32Array((KT + 1) * N); coef.forEach((c, i) => c.forEach((v, t) => { mt[i * (KT + 1) + t + 1] = v; }));
  const morphTexture = new THREE.DataTexture(mt, KT + 1, N, THREE.RedFormat, THREE.FloatType); morphTexture.needsUpdate = true;
  bytes.mesh = geomBytes(g); bytes.morphTexture = mt.byteLength;
  if (method === "c2") {
    rigSets = coef.map(c => linearJoints(jdirs, c));
    rig_ = Bd.bakeRig(rigSets, F); rotTex = filtTex(rig_.rot, rig_.rotW, rig_.rotH); offTex = filtTex(rig_.off, rig_.offW, rig_.offH);
    const mesh = new THREE.Mesh(g, material(int(instanceIndex), int(instanceIndex), false));
    // r186: a Mesh gets morphTargetInfluences from its constructor; with count > 1 the shader reads only morphTexture, the influences
    // uniform array is never built, and its per-object update then throws (null buffer). InstancedMesh has none, so we drop it too.
    mesh.morphTargetInfluences = undefined; mesh.count = N; mesh.morphTexture = morphTexture; mesh.frustumCulled = false; crowd.add(mesh);
  } else {
    // three's own path: SkinnedMesh + morph targets + the instancing hack from examples/webgpu_skinning_instancing.html
    const bones = Bd.BONES.map(() => new THREE.Bone()), J = mean.joints.J;
    Bd.BONES.forEach(([, pa], b) => { const o = pa < 0 ? J[b] : J[b].map((v, a) => v - J[pa][a]); bones[b].position.set(...o); if (pa >= 0) bones[pa].add(bones[b]); });
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardNodeMaterial({ roughness: 0.75 }));
    mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
    mesh.morphTargetInfluences = undefined; mesh.isInstancedMesh = true; mesh.count = N; mesh.morphTexture = morphTexture; mesh.frustumCulled = false;
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(N * 16), 16);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(people.flatMap(a => [a.color.r, a.color.g, a.color.b])), 3);
    crowd.add(mesh);
    const m4 = new THREE.Matrix4(), qy = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3(), e = new THREE.Euler();
    let clock = 0;
    update = (dt) => {   // one shared pose: the gait at one global phase
      clock = (clock + dt * 0.95) % 1;
      for (let b = 0; b < Bd.B; b++) { e.set(...Bd.localEulerAt(b, clock), "YXZ"); bones[b].quaternion.setFromEuler(e); }
      bones[0].position.set(J[0][0], J[0][1] - 0.008 * J[0][1] + 0.022 * J[0][1] * Math.cos(4 * Math.PI * clock), J[0][2]);
      people.forEach((a, i) => { qy.setFromAxisAngle(up, a.h); m4.compose(at.set(a.x, 0, a.z), qy, one); m4.toArray(mesh.instanceMatrix.array, i * 16); });
      mesh.instanceMatrix.needsUpdate = true;
    };
    bytes.instanceMatrix = N * 64; bytes.instanceColor = N * 12;
  }
  drawsExpected = 1;
} else if (method === "c2c") {
  // C2 with our own morph: coefficients as four instanced vec4 attributes (no per-vertex texture read for them), deltas in one
  // RGBA16F texture (8 B per vertex per target, three's own path uses RGBA32F), an unconditional loop
  const g = geomFrom(mean, false), dW = 2048, dH = Math.ceil(V * KT / dW), dd = new Float32Array(dW * dH * 4), jdirs = [];
  for (let t = 0; t < KT; t++) {
    const q = Bd.MEAN.slice(); q[t] += Bd.PARAMS[t][2]; const b = Bd.buildBody(q);
    for (let v = 0; v < V; v++) for (let a = 0; a < 3; a++) dd[(t * V + v) * 4 + a] = b.position[v * 3 + a] - mean.position[v * 3 + a];
    jdirs.push(b.joints.J.map((j, bi) => j.map((x, a) => x - mean.joints.J[bi][a])));
  }
  const deltaTex = new THREE.DataTexture(half16(dd), dW, dH, THREE.RGBAFormat, THREE.HalfFloatType); deltaTex.needsUpdate = true;
  const coef = people.map(a => Array.from({ length: 16 }, (_, t) => t < KT ? (a.p[t] - Bd.MEAN[t]) / Bd.PARAMS[t][2] : 0));
  for (let c = 0; c < 4; c++) g.setAttribute("coef" + c, new THREE.InstancedBufferAttribute(new Float32Array(coef.flatMap(cs => cs.slice(c * 4, c * 4 + 4))), 4));
  rigSets = coef.map(c => linearJoints(jdirs, c.slice(0, KT)));
  rig_ = Bd.bakeRig(rigSets, F); rotTex = filtTex(rig_.rot, rig_.rotW, rig_.rotH); offTex = filtTex(rig_.off, rig_.offW, rig_.offH);
  const rest = () => {
    const x = positionLocal.toVar(), vi = int(vertexIndex);
    for (let t = 0; t < KT; t++) {
      const gi = vi.add(t * V), c = attribute("coef" + (t >> 2), "vec4")[["x", "y", "z", "w"][t & 3]];
      x.addAssign(textureLoad(deltaTex, ivec2(gi.mod(dW), gi.div(dW))).xyz.mul(c));
    }
    return { x, n: normalLocal };
  };
  const mesh = new THREE.Mesh(g, material(int(instanceIndex), int(instanceIndex), false, rest));
  mesh.count = N; mesh.frustumCulled = false; crowd.add(mesh);
  bytes.mesh = geomBytes(g) - N * 64; bytes.coefficients = N * 64; bytes.deltaTexture = dW * dH * 8;
  drawsExpected = 1;
} else if (method === "c3t") {
  // C3's unique rest shapes without C3's waste: the template mesh drawn instanced (one index buffer, one set of skin attributes),
  // each instance's own rest positions and normals read from an RGBA16F texture at instance * V + vertex
  const bodies = people.map(a => Bd.buildBody(a.p)), W = 2048, texels = N * V * 2, H = Math.ceil(texels / W), rd = new Float32Array(W * H * 4);
  bodies.forEach((b, i) => { for (let v = 0; v < V; v++) { const o = ((i * V + v) * 2) * 4;
    rd[o] = b.position[v * 3]; rd[o + 1] = b.position[v * 3 + 1]; rd[o + 2] = b.position[v * 3 + 2];
    rd[o + 4] = b.normal[v * 3]; rd[o + 5] = b.normal[v * 3 + 1]; rd[o + 6] = b.normal[v * 3 + 2]; } });
  const restTex = new THREE.DataTexture(half16(rd), W, H, THREE.RGBAFormat, THREE.HalfFloatType); restTex.needsUpdate = true;
  rigSets = bodies.map(b => b.joints.J);
  rig_ = Bd.bakeRig(rigSets, F); rotTex = filtTex(rig_.rot, rig_.rotW, rig_.rotH); offTex = filtTex(rig_.off, rig_.offW, rig_.offH);
  const rest = () => {
    const gi = int(instanceIndex).mul(V).add(int(vertexIndex)).mul(2).toVar();
    return { x: textureLoad(restTex, ivec2(gi.mod(W), gi.div(W))).xyz, n: textureLoad(restTex, ivec2(gi.add(1).mod(W), gi.add(1).div(W))).xyz };
  };
  const g = geomFrom(mean, false);
  const mesh = new THREE.Mesh(g, material(int(instanceIndex), int(instanceIndex), false, rest));
  mesh.count = N; mesh.frustumCulled = false; crowd.add(mesh);
  bytes.template = geomBytes(g); bytes.restTexture = W * H * 8;
  drawsExpected = 1;
} else if (method === "c3") {
  const bodies = people.map(a => Bd.buildBody(a.p));
  rigSets = bodies.map(b => b.joints.J);
  rig_ = Bd.bakeRig(rigSets, F); rotTex = filtTex(rig_.rot, rig_.rotW, rig_.rotH); offTex = filtTex(rig_.off, rig_.offW, rig_.offH);
  const pos = new Float32Array(N * V * 3), nor = new Float32Array(N * V * 3), si = new Uint16Array(N * V * 4), sw = new Float32Array(N * V * 4);
  const IC = mean.index.length, idx = new Uint32Array(N * IC);
  bodies.forEach((b, i) => {
    pos.set(b.position, i * V * 3); nor.set(b.normal, i * V * 3); si.set(b.skinIndex, i * V * 4); sw.set(b.skinWeight, i * V * 4);
    for (let j = 0; j < IC; j++) idx[i * IC + j] = b.index[j] + i * V;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4)); g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  bytes.mergedMesh = geomBytes(g);
  const mesh = new THREE.Mesh(g, material(int(vertexIndex).div(int(V)), int(vertexIndex).div(int(V)), false));
  mesh.frustumCulled = false; crowd.add(mesh);
  drawsExpected = 1;
}
if (rig_) { bytes.rigShared = rig_.rotW * rig_.rotH * 8; bytes.rigPerBody = rig_.offW * rig_.offH * 8; }
bytes.perPerson = agentData.byteLength + lookData.byteLength + (method === "c1" ? scaleData.byteLength : 0);
const crowdBytes = Object.values(bytes).reduce((s, v) => s + v, 0);
crowd.traverse(o => { if (o.isMesh) o.castShadow = true; });

// ---------- the studio (the bench's light, simplified) ----------
const key = new THREE.DirectionalLight(0xfff1e0, 2.6); key.position.set(side * 0.3, side * 0.6, side * 0.4); key.castShadow = SHADOWS;
if (SHADOWS) { key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -side * 0.75, right: side * 0.75, top: side * 0.75, bottom: -side * 0.75, near: 0.5, far: side * 2 }); }
scene.add(key, new THREE.HemisphereLight(0xdde6f0, 0x4a4440, 1.1));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(side * 1.6, side * 1.6), new THREE.MeshStandardNodeMaterial({ color: 0x7a7c80, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 400);
if (Q.get("view") === "close") { camera.position.set(0, 1.5, 7); camera.lookAt(0, 0.9, 0); }
else { camera.position.set(0, side * 0.5, side * 1.05); camera.lookAt(0, 0, -side * 0.02); }
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
if (Q.get("view") === "close") { people.forEach((a, i) => { if (i < 12) { a.x = (i % 6 - 2.5) * 1.1; a.z = Math.floor(i / 6) * -2.2; a.h = i % 2 ? 0.6 : -0.6; a.speed = 0; } else a.z = Math.min(a.z, 0) - 8; }); }
const buildMs = performance.now() - tBuild0;

// ---------- the loop and its measures ----------
const tFirst = performance.now(); walk(0); update(0); writeAgents(); renderer.render(scene, camera); const firstFrameMs = performance.now() - tFirst;
const draws = renderer.info.render.drawCalls, triangles = renderer.info.render.triangles;
let last = performance.now(), gpuLast = null;
const win = { frame: [], upd: [], rnd: [] }, all = { frame: [], upd: [], rnd: [] };
let phase = RUN ? "warm" : "free", t0 = performance.now(), lastHud = 0;
const mean_ = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length), pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const resolveGpu = () => renderer.resolveTimestampsAsync("render").then(v => { if (v) gpuLast = v; }).catch(() => {});
const mb = b => (b / 1048576).toFixed(2) + " MB";

function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000), frameMs = now - last; last = now;
  const a = performance.now(); walk(dt); update(dt); writeAgents(); const b = performance.now();
  renderer.render(scene, camera); const c = performance.now();
  if (Q.get("gpu") !== "0" && phase !== "gpu") resolveGpu();
  win.frame.push(frameMs); win.upd.push(b - a); win.rnd.push(c - b);
  if (phase === "timed") { all.frame.push(frameMs); all.upd.push(b - a); all.rnd.push(c - b); }
  if (phase === "warm" && now - t0 > 2000) { phase = "timed"; t0 = now; }
  else if (phase === "timed" && now - t0 > 5000) { phase = "gpu"; renderer.setAnimationLoop(null); finish(); }
  if (now - lastHud > 500) {
    lastHud = now;
    say(`${method} · ${backend} · ${N} people · ${vertsPerPerson.toLocaleString()} verts each · ${draws} draw${draws === 1 ? "" : "s"} (${drawsExpected} crowd) · ${Math.round(triangles).toLocaleString()} tris\n` +
        `frame ${mean_(win.frame).toFixed(2)} ms (${(1000 / mean_(win.frame)).toFixed(0)} fps) · cpu walk ${mean_(win.upd).toFixed(2)} ms · render() ${mean_(win.rnd).toFixed(2)} ms · gpu ${gpuLast == null ? "n/a" : gpuLast.toFixed(2) + " ms"}\n` +
        `crowd data ${mb(crowdBytes)} · gpu memory (three's count) ${mb(renderer.info.memory.total || 0)} · built in ${buildMs.toFixed(0)} ms · first frame ${firstFrameMs.toFixed(0)} ms\n` +
        `asked for ${P.webgl === "1" ? "WebGL2" : "WebGPU"}, running ${backend} · ${caps.split(" · ").slice(0, 2).join(" · ")}` + (lastErr && backend !== "webgpu" ? `\nlast WebGPU error: ${lastErr}` : "") + (RUN ? `\nmeasuring: ${phase}` : ""));
    win.frame.length = win.upd.length = win.rnd.length = 0;
  }
  if (SHOT && !window.__shot && now - tFirst > 1500) window.__shot = true;
}
renderer.setAnimationLoop(frame);

async function finish() {
  const gpu = [], cpuIso = [];   // render() CPU ms on frames drawn one at a time (no backlog for the driver to block on)
  if (Q.get("gpu") !== "0") {
    await Promise.race([resolveGpu(), new Promise(r => setTimeout(r, 500))]);
    for (let i = 0; i < 40; i++) {
      walk(1 / 60); update(1 / 60); writeAgents(); const c0 = performance.now(); renderer.render(scene, camera); cpuIso.push(performance.now() - c0);
      const v = await Promise.race([renderer.resolveTimestampsAsync("render"), new Promise(r => setTimeout(() => r(null), 1000))]);
      if (v) gpu.push(v);
    }
  }
  const info = renderer.backend.isWebGPUBackend ? renderer.backend.device?.adapterInfo : null;
  window.__result = {
    method, backend, n: N, k: method.startsWith("c2") ? KT : null, K: method === "c1" ? K : null, verts_per_person: V, draws, crowd_draws: drawsExpected,
    triangles: Math.round(triangles), frames: all.frame.length,
    frame_mean_ms: +mean_(all.frame).toFixed(3), frame_p50_ms: +pct(all.frame, 0.5).toFixed(3), frame_p99_ms: +pct(all.frame, 0.99).toFixed(3),
    cpu_walk_ms: +mean_(all.upd).toFixed(4), cpu_render_ms: +mean_(all.rnd).toFixed(3), cpu_render_isolated_ms: cpuIso.length ? +pct(cpuIso, 0.5).toFixed(3) : null,
    gpu_ms: gpu.length ? +pct(gpu, 0.5).toFixed(3) : null, gpu_samples: gpu.length,
    crowd_bytes: crowdBytes, bytes, three_memory: { ...renderer.info.memory },
    build_ms: Math.round(buildMs), first_frame_ms: Math.round(firstFrameMs), shadows: SHADOWS, adapter: info ? `${info.vendor} ${info.architecture}` : null,
    buffer: [renderer.domElement.width, renderer.domElement.height],
  };
  say(hud.textContent + "\n" + JSON.stringify(window.__result));
}
