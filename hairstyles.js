// Photonic R5: the hairstyle lineup. Seven people at conversation distance (about 2 m, bust framing): six ready-made MakeHuman hairstyles
// (spikes/mhhair: CC0 and CC BY shells fitted to each person's deformed body at build time) and, as the "today" reference, the hair we grow now
// (spikes/hair). Every person wears the base layer (spikes/appearance refuses to build without it).
// Renderer: WebGPURenderer on WebGL 2, MSAA, tone mapping done in the materials (the phone test's "inline" mode: no off-screen target).
//   ?still=1  no animation loop   ?plain=1  plain skin (both for shooting on a software GL)   ?i=0..6  first person shown   ?view=front|three|side|back|turn   ?frame=bust|head   ?count=N people at once (default by width)   ?dpr=N
//   window.setShot({ i, yaw (degrees), frame, colour, count }) draws that view (turning off), for lab/hairstyles/shoot.mjs
import * as THREE from "three/webgpu";
import { context, renderOutput } from "three/tsl";
import { build as buildPerson } from "./spikes/appearance/index.js";
import { paramTexture, COLS } from "./spikes/appearance/params.js";
import { build as buildToday } from "./spikes/hair/index.js";
import { loadStyles, wear, scalpCheck } from "./spikes/mhhair/index.js";

const Q = new URLSearchParams(location.search), $ = (id) => document.getElementById(id);
const fail = (e) => { const el = $("err"); el.style.display = "block"; el.textContent = String(e && e.message || e); console.error(e); };
addEventListener("error", (e) => fail(e.error || e.message));
addEventListener("unhandledrejection", (e) => fail(e.reason));

// the people: different age, sex and skin, each wearing one style (or today's hair)
const PEOPLE = [
  { id: "bob",   sex: 0, age: 27, height: 1.66, build: 0.45, skin: "#f0d0b8", seed: 21, hairColor: "black", form: "loose" },
  { id: "long",  sex: 0, age: 34, height: 1.68, build: 0.5,  skin: "#d8a888", seed: 22, hairColor: "lightBrown", form: "loose" },
  { id: "crop",  sex: 1, age: 52, height: 1.78, build: 0.6,  skin: "#e0b498", seed: 23, hairColor: "darkBrown", grey: 0.55, form: "cropped" },
  { id: "braid", sex: 0, age: 15, height: 1.61, build: 0.4,  skin: "#c99a74", seed: 24, hairColor: "red", form: "tied" },
  { id: "afro",  sex: 1, age: 31, height: 1.8,  build: 0.5,  skin: "#6b4430", seed: 25, hairColor: "black", form: "short" },
  { id: "updo",  sex: 0, age: 63, height: 1.6,  build: 0.55, skin: "#efd2bd", seed: 26, hairColor: "brown", grey: 0.85, form: "tied" },
  { id: "today", sex: 0, age: 30, height: 1.66, build: 0.5,  skin: "#b07850", seed: 27,
    hair: { style: "long", parting: "centre", fringe: "none", eumelanin: 0.6, pheomelanin: 0.15 } },
];
const COLOURS = [["Blond", "#b8915c", 0], ["Brown", "#5a3d26", 0], ["Black", "#1c1714", 0], ["Red", "#a14a22", 0], ["Grey", "#74695e", 0.9]];
const STRAND = {};   // per style: "u" if the strands run along U in the atlas (none so far)

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
renderer.setPixelRatio(Q.get("dpr") ? +Q.get("dpr") : Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // tone mapping and sRGB in every material
renderer.contextNode = context({ getOutput: (o) => renderOutput(o, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) });
const cv = $("cv"); cv.prepend(renderer.domElement);
await renderer.init();
renderer.setSize(cv.clientWidth, cv.clientHeight);

const scene = new THREE.Scene(); scene.background = new THREE.Color(0x6b6e72);
const key = new THREE.DirectionalLight(0xfff1e0, 2.6); key.position.set(2.5, 4, 3.5);
const fill = new THREE.DirectionalLight(0xc8d8ff, 0.7); fill.position.set(-3, 2, 2);
const rim = new THREE.DirectionalLight(0xffffff, 1.2); rim.position.set(0, 3, -4);
scene.add(key, fill, rim, new THREE.HemisphereLight(0xdde6f0, 0x4a4440, 0.6));
const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 50);

// ---- build everyone
const styles = await loadStyles(THREE, PEOPLE.filter((p) => p.id !== "today").map((p) => p.id));
const people = [], t0 = performance.now(), hairOf = [];
for (const p of PEOPLE) {
  const r = { age: p.age, sex: p.sex, height: p.height, build: p.build, skin: p.skin, seed: p.seed, beard: "none" };
  let person, entry;
  if (p.id === "today") {
    person = buildToday(THREE, renderer, { ...r, hair: p.hair }, "near");
    const st = person.userData.hair.stats;
    entry = { name: "Today's grown hair", sub: `our cards · ${st.triangles.toLocaleString()} tris · ${st.draws} draws`, stats: st };
  } else {
    const s = styles[p.id], m = s.meta;
    person = buildPerson(THREE, { ...r, hairForm: p.form, hairColor: p.hairColor, grey: p.grey }, "near");
    for (const o of [...person.children]) if (o.name === "hair") { person.remove(o); o.geometry.dispose(); }   // appearance's old hair: ours replaces it
    const lk = person.userData.look;
    const hair = wear(THREE, renderer, s, person, r, { tip: lk.hair.color, grey: lk.hair.grey, strand: STRAND[p.id] || "v", tune: { debug: Q.get("dbg") || "", ...Object.fromEntries(["rough", "aniso", "spec", "lobe2", "toneK", "detailK"].filter((k) => Q.get(k)).map((k) => [k, +Q.get(k)])) } });
    hairOf[people.length] = hair;
    entry = { name: m.name, sub: `${m.licence} · ${m.author} · ${m.triangles.toLocaleString()} tris`, stats: hair.stats, hair, r };
  }
  if (Q.get("plain")) person.children[0].material = new THREE.MeshStandardNodeMaterial({ color: p.skin, roughness: 0.6 });   // for shooting on a software GL: the procedural skin takes minutes to link there
  if (!person.getObjectByName("base-layer")) throw new Error("no base layer: refusing to show an unclothed person");
  person.visible = false; scene.add(person);
  people.push({ person, p, ...entry });
}
const buildMs = performance.now() - t0;

// ---- view state
let first = Math.min(PEOPLE.length - 1, Math.max(0, +(Q.get("i") || 0))), w0 = first, yaw = 0, turning = false, frame = Q.get("frame") === "head" ? "head" : "bust";
const YAW = { front: 0, three: 0.75, side: Math.PI / 2, back: Math.PI };
let viewName = Q.get("view") in YAW || Q.get("view") === "turn" ? Q.get("view") : "turn";
const W = () => cv.clientWidth, H = () => cv.clientHeight;
const span = () => frame === "head" ? 0.5 : 0.85;                       // metres of height in view at the person
const countFor = () => Q.get("count") ? Math.max(1, Math.min(PEOPLE.length, +Q.get("count"))) : Math.max(1, Math.min(4, Math.floor((W() / H()) * span() / 0.8)));
let dirty = true;

function layout() {
  const aspect = W() / H(), V = span(), n = countFor(), spanH = aspect * V, sp = spanH / n;
  cam.aspect = aspect; cam.updateProjectionMatrix();
  const D = V / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  let hy = 0, k = 0;
  people.forEach((e, i) => {
    const x = (i - w0 - (n - 1) / 2) * sp, vis = Math.abs(x) < spanH / 2 + 0.2;
    e.person.visible = vis; e.person.position.x = x; e.person.rotation.y = yaw;
    if (vis && Math.abs(x) < spanH / 2) { hy += e.p.height; k++; }
  });
  hy = k ? hy / k : 1.66;
  const lookY = hy - (frame === "head" ? 0.15 : 0.32);
  cam.position.set(0, lookY + 0.04, D); cam.lookAt(0, lookY, 0);
  const lk = people.map((e) => (e.person.visible && Math.abs(e.person.position.x) <= spanH / 2 ? 1 : 0)).join("") + frame + n;
  if (lk !== labelKey) { labelKey = lk; labels(spanH); }
  $("count").textContent = `${Math.round(w0 + (n - 1) / 2) + 1} / ${people.length}`;
}
let labelKey = "";
function labels(spanH) {
  const labels = $("labels"); labels.replaceChildren();
  people.forEach((e, i) => {
    if (!e.person.visible || Math.abs(e.person.position.x) > spanH / 2) return;
    const d = document.createElement("div"); d.className = "lab";
    d.innerHTML = `<b></b><span></span>`; d.firstChild.textContent = e.name; d.lastChild.textContent = e.sub; labels.appendChild(d);
  });
}
function resize() { renderer.setSize(W(), H()); dirty = true; }
addEventListener("resize", resize);

function setFirst(i) { first = Math.max(0, Math.min(PEOPLE.length - 1, i)); dirty = true; }
$("prev").onclick = () => setFirst(first - 1); $("next").onclick = () => setFirst(first + 1);
let sx = null;
cv.addEventListener("pointerdown", (e) => { sx = [e.clientX, e.clientY]; });
cv.addEventListener("pointerup", (e) => { if (!sx) return; const dx = e.clientX - sx[0], dy = e.clientY - sx[1]; sx = null; if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) setFirst(first + (dx < 0 ? 1 : -1)); });
function setView(name) { viewName = name; turning = name === "turn"; if (!turning) yaw = YAW[name]; for (const b of document.querySelectorAll("#views button")) b.setAttribute("aria-pressed", String(b.dataset.v === name)); dirty = true; }
for (const b of document.querySelectorAll("#views button")) b.onclick = () => setView(b.dataset.v);
function setFrame(f) { frame = f; for (const b of document.querySelectorAll("#frames button")) b.setAttribute("aria-pressed", String(b.dataset.f === f)); dirty = true; }
for (const b of document.querySelectorAll("#frames button")) b.onclick = () => setFrame(b.dataset.f);

// hair colour: the style's shell, and the person's brows with it (the same row of appearance's table the person was built into)
function recolour(e, hex, grey) {
  if (!e.hair) return;
  e.hair.set(hex, grey);
  const { tex, data } = paramTexture(THREE), row = e.person.userData.row, c = new THREE.Color(hex), set = (col, v) => data.set(v, (row * 16 + col) * 4);
  set(COLS.hair, [c.r, c.g, c.b, grey]);
  const bw = data[(row * 16 + COLS.brow) * 4 + 3], gv = Math.max(0, grey - 0.3) * 0.5;
  set(COLS.brow, [c.r * 0.75 + 0.5 * gv * 0.74, c.g * 0.75 + 0.5 * gv * 0.71, c.b * 0.75 + 0.5 * gv * 0.66, bw]);
  tex.needsUpdate = true; dirty = true;
}
let picked = null;
function colourAll(name) {
  picked = name;
  const c = COLOURS.find((x) => x[0] === name);
  for (const b of document.querySelectorAll("#colours button")) b.setAttribute("aria-pressed", String(b.dataset.c === name));
  for (const e of people) if (c) recolour(e, c[1], c[2]);
}
for (const [name, hex] of COLOURS) {
  const b = document.createElement("button"); b.dataset.c = name; b.setAttribute("aria-pressed", "false");
  b.innerHTML = `<span class="sw" style="background:${hex}"></span>${name}`; b.onclick = () => colourAll(name); $("colours").appendChild(b);
}

// ---- first frame, and the loop
layout(); setView(viewName);
await renderer.compileAsync(scene, cam);
$("load").remove();
let last = performance.now();
if (!Q.get("still")) renderer.setAnimationLoop(loop);
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (turning) { yaw += dt * 0.55; dirty = true; }
  if (Math.abs(first - w0) > 1e-3) { w0 += (first - w0) * Math.min(1, dt * 9); if (Math.abs(first - w0) < 2e-3) w0 = first; dirty = true; }
  if (!dirty) return;
  layout(); dirty = false; renderer.render(scene, cam);
}

// ---- checks and the shooting hook
function check() {
  return people.filter((e) => e.hair).map((e) => ({ id: e.p.id, tris: e.stats.triangles, ratio: e.stats.ratio, fitMs: e.stats.fitMs, ...scalpCheck(e.person, e.hair, e.p.height) }));
}
window.setShot = async ({ i = first, yaw: deg = 0, frame: f = frame, colour = null, count = null } = {}) => {
  if (count) Q.set("count", String(count));
  renderer.setAnimationLoop(null); turning = false; viewName = "fixed"; yaw = deg * Math.PI / 180; first = w0 = i;
  for (const b of document.querySelectorAll("#views button")) b.setAttribute("aria-pressed", "false");
  if (colour) colourAll(colour);
  frame = f; layout();
  const t = performance.now(); await renderer.renderAsync(scene, cam); renderer.render(scene, cam); dirty = false; window.lastRenderMs = Math.round(performance.now() - t); console.log("render", window.lastRenderMs, "ms");
  return renderer.domElement.toDataURL("image/png");   // read in the same task as the draw: no compositor screenshot (it crashed the GPU process under swiftshader)
};
window.tuneHair = (o) => { for (const e of people) if (e.hair) e.hair.tune(o); };
window.lineup = { buildMs: +buildMs.toFixed(0), backend: renderer.backend.isWebGPUBackend ? "webgpu" : "webgl2", samples: renderer.samples,
  people: people.map((e) => ({ id: e.p.id, name: e.name, sub: e.sub, stats: e.stats })), check };
window.benchReady = true;
