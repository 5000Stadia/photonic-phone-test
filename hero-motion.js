// Hero motion (2026-10-15): ONE person, close, at the near tier with hair and clothes, walking, standing, sitting down, seated, standing up and the
// hand-overs between, to dial the motion in on one body before it is abstracted to every other (Kabe: "stick to one you perfect at high res to dial in
// everything perfect then abstract to all other example options"). The hero is the lineup's L17, "a broad-shouldered man, a labourer, in a green
// doublet": an adult in working dress, whose close breeches and short doublet hide little of the legs and arms.
//   Do: walk, stop, sit, stand up, or the tour of all of them. View: orbit (drag), side, front, three-quarter, back, face, feet; the camera follows him.
//   Time: 1x, 1/2, 1/4, 1/10, pause, step a frame. Capture: the raw captured skeleton over him (pale lines), aligned at the pelvis and scaled to his
//   hip height: compare the angles of the limbs. Hand-overs (stop, start, rise, sit-in) are blended, not captured, so no capture is shown for them.
//   Body: nude (the default here, to judge the motion and the body itself; Kabe, 2026-10-15), the undergarments (the base layer), or dressed in
//   his working clothes; the sliders change the body (age, sex, height, build, muscle, skin) live. The crowd is always dressed: only this page
//   asks the draw for a nude person (makePeople review). Chair: with arms (his hands on the armrests, as the captured sitter's were) or without
//   (on his own thighs and knees).
//   ?view=side|front|...  ?hold=1 (the camera held still)  ?capture=1  ?do=walk|stop|sit|rise|tour  ?body=nude|under|dressed  ?arms=1  ?keepout=0 (arms as captured, clothes
//   ignored: a diagnostic)  ?gl=1 (WebGL2)
// window.hero: { go(action), view(name), speed(x), advance(seconds), render(), state(), clothes(mode), arms(on), body(params), ready } for stills.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makePeople } from "./people/index.js";
import { WORKMAN, GENTLEMAN, GENTLEWOMAN, WORKWOMAN, setFit } from "./people/garments/outfit.js";
import { loadSitting, makeSitting, fittingSeatHeight, sitFrame } from "./people/sitting.js";
import { skinColour } from "./people/shape.js";
import { CLIPS, IDLE, CAPTURE, IDLE_CAPTURE } from "./people/mocap.js";
import { BONES } from "./people/bodies.js";
import { makeStage } from "./plaza.js";
import { loadBasis } from "./gait.js";
import { mm, mv, rot, ID } from "./bvh.js";
import { sampleAcclaim } from "./asf-amc.js";
import { castOf } from "./cast.js";
const BASIS_URL = "./gait-basis.json";
const HERO = "L17";

const $ = (id) => document.getElementById(id);
const fail = (e) => { const el = $("err"); el.style.display = "block"; el.textContent = String(e?.stack || e?.message || e); console.error(e); };
addEventListener("error", (e) => fail(e.error || e.message));
addEventListener("unhandledrejection", (e) => fail(e.reason));
const q = new URLSearchParams(location.search);

const stageEl = $("stage");
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: q.get("gl") === "1" });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
stageEl.prepend(renderer.domElement);
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? "WebGPU" : "WebGL2";
const scene = makeStage(THREE, { quality: q.get("q") ?? undefined, renderer });
scene.fog = null;
// (this page only: the stage's sun casts its shadows over 44 m on a 512 or 1024 map, 4 to 9 cm a texel, which bands a body seen this close
// with stripes of self-shadow; here its shadows cover 4.8 m round him on a 1024 map, about 5 mm a texel, and follow him: followSun)
const sun = scene.children.find((o) => o.isDirectionalLight), sunOffset = sun.position.clone().sub(sun.target.position);
sun.shadow.mapSize.setScalar(1024); sun.shadow.normalBias = 0.008;
Object.assign(sun.shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 0.5, far: sunOffset.length() + 6 }); sun.shadow.camera.updateProjectionMatrix();
const followSun = (x, z) => { sun.target.position.set(x, 0, z); sun.position.copy(sun.target.position).add(sunOffset); sun.target.updateMatrixWorld(); };
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.4; controls.maxDistance = 14; controls.enablePan = false;
function size() { const w = stageEl.clientWidth, h = stageEl.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
new ResizeObserver(size).observe(stageEl); size();

// ---- the hero and his chair ----
// Cut: the working clothes cut to his body (round 3: garments/outfit.js setFit, the fitted doublet and breeches), or ?fit=0 the crowd's cut, for comparison (a reload: the
// draw builds a class's mesh once)
const fitted = q.get("fit") !== "0";
setFit(fitted);
const cast = castOf(), who = cast.find((c) => c.id === HERO);
const basis = loadBasis(await (await fetch(new URL(BASIS_URL, import.meta.url))).json());
const people = makePeople(THREE, { basis, thresholds: { near: 400, mid: 800 }, nearCapacity: 4, capacity: 8, exactArms: true, easeWalks: true, review: true,
  outfits: (id) => (id === HERO && who.dress?.outfit ? { outfit: who.dress.outfit, look: who.dress.look } : null) });
scene.add(people.group);
people.warm([WORKMAN, GENTLEMAN, GENTLEWOMAN, WORKWOMAN]);
// Body: "nude" (the base layer dropped: makePeople review), "under" (the base layer, in linen rather than the crowd's placeholder tint), "dressed"
let clothes = { nude: "nude", under: "under", undergarments: "under", dressed: "dressed" }[q.get("body")] ?? "nude", bodyOver = null, dressedList = null, hero = null;
const LINEN = new THREE.Color("#e8e2d2").toArray();
function addHero(pos, heading, phase) {
  hero = people.add({ id: HERO, seed: who.seed, recipe: who.said, at: { pos, room: "hall" }, state: { heading, phase }, ...(bodyOver ? { body: bodyOver } : {}) });
  dressedList = hero.worn();           // what the words dress him in, to put back on
  applyClothes();
}
function applyClothes() {
  const rec = people.inspect(HERO).rec;
  if (clothes === "dressed") {
    hero.reviewBody(null); hero.wear(dressedList);
    // ?keepout=0: the arms as captured, with nothing keeping them out of his clothes (a diagnostic, to see what the keep-out does)
    if (q.get("keepout") === "0" && rec.dressing) rec.dressing.keepout = null;
  } else { hero.wear([]); hero.reviewBody(clothes); rec.tint = LINEN; }
}
addHero([0, 0, 0], 0, 0.3);
const sitBank = await loadSitting();
const rec0 = people.inspect(HERO).rec, { J, tip } = rec0.body.joints;
const seatH = fittingSeatHeight(sitBank, J, tip, rec0.height, "113_15");
const fit = makeSitting(sitBank, J, tip, rec0.height, seatH, "113_15"), first = fit.pose(fit.spec.segments.sitDown[0]).P[0];
// the chair faces the walking line from its side (facing +x, away from the side view's camera): he walks up the line, turns to it and sits
const CHAIR = [-1.6, 0], FACING = Math.PI / 2, c = Math.cos(FACING), s = Math.sin(FACING);
const seat = { id: "chair", floor: 0, height: seatH, facing: FACING, width: 0.46, depth: 0.42,
  contact: [CHAIR[0] - (c * first[0] + s * first[2]), CHAIR[1] - (-s * first[0] + c * first[2])] };
// its arms (the seat contract, design/r6-seats.md: side is the sitter's own, at the armrest top's centre projected to the floor, height above the
// floor, length along the facing): 22 cm above the seat, just outside it, from the back to near the front
const ARM_UP = 0.22, ARM_OUT = seat.width / 2 + 0.035, ARM_LEN = 0.4, ARM_Z = -0.01;
const toWorld = (x, z) => [seat.contact[0] + x * c + z * s, seat.contact[1] - x * s + z * c];
const ARMS = [{ side: "left", at: toWorld(ARM_OUT, ARM_Z), height: seatH + ARM_UP, length: ARM_LEN }, { side: "right", at: toWorld(-ARM_OUT, ARM_Z), height: seatH + ARM_UP, length: ARM_LEN }];
let armsOn = q.get("arms") === "1", chair = null;
function buildChair() {
  if (chair) { scene.remove(chair); chair.traverse((o) => o.geometry?.dispose()); }
  const wood = new THREE.MeshStandardMaterial({ color: 0x6f5a44, roughness: 0.95 }), box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood); m.position.set(x, y, z); chair.add(m); };
  chair = new THREE.Group();
  box(seat.width, 0.035, seat.depth, 0, seatH - 0.0175, 0);
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(0.03, seatH - 0.035, 0.03, x * (seat.width / 2 - 0.03), (seatH - 0.035) / 2, z * (seat.depth / 2 - 0.03));
  box(seat.width, 0.45, 0.03, 0, seatH + 0.22, -seat.depth / 2 + 0.015);
  if (armsOn) for (const x of [-1, 1]) {
    // the armrest (its top at seatH + ARM_UP), a post under its front, and its back joined to the chair's back
    box(0.055, 0.03, ARM_LEN, x * ARM_OUT, seatH + ARM_UP - 0.015, ARM_Z);
    box(0.03, ARM_UP, 0.03, x * ARM_OUT, seatH + ARM_UP / 2 - 0.01, ARM_Z + ARM_LEN / 2 - 0.03);
    box(0.03, ARM_UP, 0.03, x * ARM_OUT, seatH + ARM_UP / 2 - 0.01, -seat.depth / 2 + 0.015);
  }
  for (const o of chair.children) { o.castShadow = true; o.receiveShadow = true; }
  // the chair's front faces the seat's facing (the board's -z edge is its back)
  chair.rotation.y = FACING; chair.position.set(seat.contact[0], 0, seat.contact[1]);
  scene.add(chair);
  if (armsOn) seat.arms = ARMS; else delete seat.arms;
}
buildChair();
scene.remove(people.group);
await renderer.compileAsync(scene, camera); scene.add(people.group);
await people.compile(renderer, scene, camera, { defer: false });

// ---- actions ----
const LINE = [[0, 0, -3.5], [0, 0, 3.5]];
let plan = null, planStep = 0, waitUntil = 0, leg = 1;
const say = (html) => { $("note").innerHTML = html; };
const actions = {
  walk() { plan = null; const s = hero.state(); if (s.sitting) hero.stand(); leg = Math.abs(s.at.pos[2] - LINE[1][2]) < Math.abs(s.at.pos[2] - LINE[0][2]) ? 0 : 1; hero.goTo({ pos: LINE[leg] }); say("Walking the line, end to end. Stop to stand where he is."); },
  stop() { plan = null; const s = hero.state(); if (s.sitting) { hero.stand(); say("Standing up."); return; } hero.goTo({ pos: s.at.pos }); say("Standing: the captured idle, the feet planted where the last step left them."); },
  sit() { plan = null; hero.sit(seat).then((ok) => say(ok ? "To the chair: the last steps, a turn, the captured sit-down, then seated." : '<span class="warn">The capture does not fit this seat.</span>')).catch(fail); },
  rise() { plan = null; hero.stand(); say("Standing up: the captured rise, then a short hand-over to standing."); },
  tour() { plan = TOUR; planStep = 0; waitUntil = 0; say("The tour: walk, stop, stand, walk to the chair, sit, sit a while, rise, stand, again."); },
};
const TOUR = [
  () => { hero.goTo({ pos: [0, 0, 2.5] }); return "arrive"; },
  () => 3, // stand 3 s
  () => { hero.goTo({ pos: [0, 0, -1.5] }); return "arrive"; },
  () => { hero.sit(seat).catch(fail); return "seated"; },
  () => 4,
  () => { hero.stand(); return "stood"; },
  () => 2.5,
  () => { hero.goTo({ pos: [0, 0, -3] }); return "arrive"; },
  () => 2,
];
let waitFor = null, sawEvent = new Set();
function runPlan(t) {
  if (!plan) return;
  if (waitFor === "arrive" && !sawEvent.has("arrived")) return;
  if (waitFor === "stood" && !sawEvent.has("stood")) return;
  if (waitFor === "seated") { const s = hero.state().sitting; if (!s || s.segment !== "seated") return; }
  if (typeof waitFor === "number") { if (t < waitUntil) return; }
  sawEvent.clear();
  const r = plan[planStep]();
  planStep = (planStep + 1) % plan.length;
  waitFor = r; if (typeof r === "number") waitUntil = t + r;
}

// ---- views: the camera follows him; fixed views are set from his heading ----
const VIEWS = {
  orbit: null,
  side: { az: Math.PI / 2, el: 0.08, d: 4.1, h: 0.92 },
  front: { az: 0, el: 0.08, d: 4.1, h: 0.92 },
  "¾": { az: Math.PI / 4, el: 0.16, d: 4.3, h: 0.92 },
  back: { az: Math.PI, el: 0.1, d: 4.1, h: 0.92 },
  face: { az: 0.35, el: 0.04, d: 1.0, joint: 4, up: 0.1 },
  hands: { az: 0.6, el: 0.35, d: 1.3, joint: [8, 12] },
  feet: { az: Math.PI / 2 + 0.5, el: 0.12, d: 1.6, joint: [15, 19] },
};
let view = q.get("view") ?? "side";
const target = new THREE.Vector3(), lastTarget = new THREE.Vector3();
function centre(info) {
  // the pelvis in the world: from the drawn pose when there is one
  const r = info.rec, P = info.pose?.P, h = r.heading, ch = Math.cos(h), sh = Math.sin(h);
  const lx = P ? P[0] : 0, lz = P ? P[2] : 0;
  return [r.pos[0] + lx * ch + lz * sh, r.pos[2] + lz * ch - lx * sh, h];
}
let holdCam = q.get("hold") === "1";        // Hold: the camera stays where it is (the motion against a still background)
function place(snap, force = false) {
  const info = people.inspect(HERO); if (!info) return;
  let [x, z, h] = centre(info), v = VIEWS[view], y = v?.h ?? 0.95;
  followSun(x, z);
  if (holdCam && !force) return;
  if (!v) { target.set(x, 0.95, z); if (snap) lastTarget.copy(target); camera.position.add(target.clone().sub(lastTarget)); controls.target.copy(target); lastTarget.copy(target); return; }
  if (v.joint !== undefined && info.pose) {
    // a close view looks at joints of the pose drawn (the head, both hands, both ankles), wherever the motion has them
    const js = [].concat(v.joint), P = info.pose.P, r = info.rec, ch = Math.cos(r.heading), sh = Math.sin(r.heading);
    let lx = 0, ly = 0, lz = 0; for (const j of js) { lx += P[j * 3] / js.length; ly += P[j * 3 + 1] / js.length; lz += P[j * 3 + 2] / js.length; }
    x = r.pos[0] + lx * ch + lz * sh; z = r.pos[2] + lz * ch - lx * sh; y = r.pos[1] + ly + (v.up ?? 0);
  }
  const a = h + v.az, ce = Math.cos(v.el);
  target.set(x, y, z);
  const want = new THREE.Vector3(x + Math.sin(a) * v.d * ce, y + Math.sin(v.el) * v.d, z + Math.cos(a) * v.d * ce);
  if (snap) camera.position.copy(want); else camera.position.lerp(want, 0.18);
  controls.target.copy(target); lastTarget.copy(target);
}

// ---- the raw capture overlay: the captured skeleton, scaled to his hip height, its pelvis on his ----
const overlay = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.95, depthTest: false }));
overlay.renderOrder = 10; overlay.frustumCulled = false; scene.add(overlay);
const rigLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0.9, depthTest: false }));
rigLines.renderOrder = 11; rigLines.frustumCulled = false; scene.add(rigLines);
let showCapture = q.get("capture") === "1";
const bvhJoints = (C, row, yaw) => {
  const world = [], pos = [];
  for (const j of C.joints) {
    let R = ID; const o = j.offset.slice();
    j.channels.forEach((ch, i) => { if (ch.endsWith("rotation")) R = mm(R, rot(ch[0], row[j.at + i])); else o["XYZ".indexOf(ch[0])] += row[j.at + i]; });
    if (j.parent < 0) { world.push(mm(yaw, R)); pos.push(mv(yaw, o)); } else { world.push(mm(world[j.parent], R)); pos.push(mv(world[j.parent], j.offset).map((v, k) => v + pos[j.parent][k])); }
  }
  return { pos: pos.map((p) => p.map((v) => v / 100)), segs: C.joints.map((j, i) => [j.parent, i]).filter(([p]) => p >= 0) };
};
function captureNow(info) {
  const a = info.animation; if (!a) return null;
  const w = info.rec.walker, b1 = w?.bank?.[1] ?? w;
  if (a.kind === "walk" || a.kind === "held") { const clip = CLIPS[1]; return { ...bvhJoints(CAPTURE, clip.channels(a.phase + (b1?.phaseOffset ?? 0)), clip.yaw), scale: b1?.kv ?? 1, label: "100STYLE Neutral walk" }; }
  if (a.kind === "idle") return { ...bvhJoints(IDLE_CAPTURE, IDLE.channels(a.phase), IDLE.yaw), scale: b1?.kv ?? 1, label: "100STYLE Neutral idle" };
  if (a.kind === "sitDown" || a.kind === "seated" || a.kind === "standUp") {
    const motion = info.rec.sitMotion; if (!motion) return null;
    const clip = sitBank.find((b) => b.spec.id === motion.spec.id), frame = sitFrame(motion.spec, a.kind, a.phase), src = sampleAcclaim(clip.C, frame);
    const pos = [], segs = [];
    src.forEach((b, i) => { pos.push(mv(clip.yaw, b.P), mv(clip.yaw, b.E)); segs.push([2 * i, 2 * i + 1]); });
    const scale = motion.J[13] ? (Math.hypot(...[0, 1, 2].map((k) => motion.J[14][k] - motion.J[13][k])) + Math.hypot(...[0, 1, 2].map((k) => motion.J[15][k] - motion.J[14][k]))) / (Math.hypot(...clip.C.bones[clip.C.index.lfemur].offset) + Math.hypot(...clip.C.bones[clip.C.index.ltibia].offset)) : 1;
    return { pos, segs, scale, rootIndex: 0, label: `CMU ${motion.spec.id} ${a.kind}` };
  }
  return null;
}
function drawOverlay(info) {
  const show = showCapture && info?.pose;
  overlay.visible = rigLines.visible = !!show;
  if (!show) return null;
  const r = info.rec, P = info.pose.P, h = r.heading, ch = Math.cos(h), sh = Math.sin(h);
  const toWorld = (x, y, z) => [r.pos[0] + x * ch + z * sh, r.pos[1] + y, r.pos[2] + z * ch - x * sh];
  // his own skeleton, from the drawn pose
  const rv = []; for (let b = 1; b < BONES.length; b++) { const pa = BONES[b][1]; rv.push(...toWorld(P[pa * 3], P[pa * 3 + 1], P[pa * 3 + 2]), ...toWorld(P[b * 3], P[b * 3 + 1], P[b * 3 + 2])); }
  rigLines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(rv, 3)); rigLines.geometry.computeBoundingSphere();
  const cap = captureNow(info);
  if (!cap) { overlay.visible = false; return "hand-over: blended, not captured"; }
  const root = cap.pos[cap.rootIndex ?? 0], v = [];
  const at = (p) => toWorld(P[0] + (p[0] - root[0]) * cap.scale, P[1] + (p[1] - root[1]) * cap.scale, P[2] + (p[2] - root[2]) * cap.scale);
  for (const [a, b] of cap.segs) v.push(...at(cap.pos[a]), ...at(cap.pos[b]));
  overlay.geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); overlay.geometry.computeBoundingSphere();
  return cap.label;
}

// ---- buttons ----
const mk = (row, text, on, title) => { const b = document.createElement("button"); b.textContent = text; if (title) b.title = title; b.addEventListener("click", on); $(row).append(b); return b; };
const moveButtons = { walk: mk("moves", "Walk", () => actions.walk()), stop: mk("moves", "Stop", () => actions.stop()), sit: mk("moves", "Sit", () => actions.sit()), rise: mk("moves", "Stand up", () => actions.rise()), tour: mk("moves", "Tour", () => actions.tour()) };
const viewButtons = {};
for (const name of Object.keys(VIEWS)) viewButtons[name] = mk("views", name[0].toUpperCase() + name.slice(1), () => setView(name));
function setView(name) { view = name; for (const [k, b] of Object.entries(viewButtons)) b.classList.toggle("on", k === name); place(true, true); }
const bHold = mk("views", "Hold", () => { holdCam = !holdCam; bHold.classList.toggle("on", holdCam); }, "keep the camera where it is: the motion against a still background");
bHold.classList.toggle("on", holdCam);
let speed = 1, paused = false, stepOnce = false;
const speedButtons = {};
for (const [label, x] of [["1×", 1], ["½", 0.5], ["¼", 0.25], ["⅒", 0.1]]) speedButtons[label] = mk("time", label, () => { speed = x; paused = false; for (const [k, b] of Object.entries(speedButtons)) b.classList.toggle("on", k === label); bPause.classList.remove("on"); });
const bPause = mk("time", "Pause", () => { paused = !paused; bPause.classList.toggle("on", paused); });
mk("time", "Step", () => { paused = true; bPause.classList.add("on"); stepOnce = true; }, "one frame (1/60 s at 1×)");
const bCap = mk("time", "Capture", () => { showCapture = !showCapture; bCap.classList.toggle("on", showCapture); });
speedButtons["1×"].classList.add("on"); bCap.classList.toggle("on", showCapture);
setView(view);

// ---- body: nude, undergarments or dressed; the sliders ----
const clothesButtons = {};
function setClothes(mode) {
  clothes = mode; applyClothes();
  for (const [k, b] of Object.entries(clothesButtons)) b.classList.toggle("on", k === mode);
  say({ nude: "Nude: the body itself, to judge the motion and the shape (smooth at the groin, as MakeHuman's body is).", under: "Undergarments: the close-fitting base layer everyone wears under their clothes.", dressed: "Dressed: his working clothes over the same body and motion." }[mode]);
}
for (const [mode, label] of [["nude", "Nude"], ["under", "Undergarments"], ["dressed", "Dressed"]]) clothesButtons[mode] = mk("body", label, () => setClothes(mode));
clothesButtons[clothes].classList.add("on");
const bSliders = mk("body", "Sliders", () => { const open = $("sliders").classList.toggle("open"); bSliders.classList.toggle("on", open); });
// The trait axes the body is made from (shape.js paramsFor): the person's age, the gender slider (0 female .. 1 male), height, build (weight),
// muscle and skin. The traits also name proportions (leg length, shoulder and hip width, head size), but no body target reads them yet: the
// body is MakeHuman's macro corners and the height alone, so they have no slider here.
const p0 = rec0.bodyParams, melanin0 = typeof rec0.values["skin.melanin"] === "number" ? rec0.values["skin.melanin"] : 0.25;
const SLIDERS = [
  ["age", "Age", 2, 90, 0.5, p0.age, (v) => `${v.toFixed(v < 10 ? 1 : 0)} y`],
  ["sex", "Sex", 0, 1, 0.01, p0.sex, (v) => (v < 0.35 ? "fem " : v > 0.65 ? "male " : "") + v.toFixed(2)],
  ["height", "Height", 0.8, 2.1, 0.005, p0.height, (v) => `${(v * 100).toFixed(0)} cm`],
  ["build", "Build", 0, 1, 0.01, p0.build, (v) => v.toFixed(2)],
  ["muscle", "Muscle", 0, 1, 0.01, p0.muscle, (v) => v.toFixed(2)],
  ["skin", "Skin", 0, 1, 0.01, melanin0, (v) => v.toFixed(2)],
];
const sliderValues = Object.fromEntries(SLIDERS.map(([k, , , , , v]) => [k, v])), sliderInputs = {};
for (const [k, label, lo, hi, step, v, fmt] of SLIDERS) {
  const l = document.createElement("label"), input = document.createElement("input"), out = document.createElement("output");
  l.textContent = label; l.htmlFor = input.id = "s-" + k;
  Object.assign(input, { type: "range", min: lo, max: hi, step, value: v }); out.textContent = fmt(v);
  input.addEventListener("input", () => { sliderValues[k] = +input.value; out.textContent = fmt(+input.value); rebodySoon(); });
  sliderInputs[k] = { input, out, fmt };
  $("sliders").append(l, input, out);
}
{
  const reset = document.createElement("button"); reset.textContent = "Reset to L17"; reset.style.gridColumn = "1 / -1"; reset.style.justifySelf = "start";
  reset.addEventListener("click", () => { for (const [k, , , , , v] of SLIDERS) { sliderValues[k] = v; sliderInputs[k].input.value = v; sliderInputs[k].out.textContent = sliderInputs[k].fmt(v); } bodyOver = null; rebody(); });
  const note = document.createElement("div"); note.className = "note"; note.textContent = "The traits' proportions (leg length, shoulder and hip width, head size) shape no body yet, so they have no slider.";
  $("sliders").append(reset, note);
}
let rebodyTimer = 0;
function rebodySoon() { clearTimeout(rebodyTimer); rebodyTimer = setTimeout(() => { bodyOver = { age: sliderValues.age, sex: sliderValues.sex, height: sliderValues.height, build: sliderValues.build, muscle: sliderValues.muscle, skin: skinColour(sliderValues.skin) }; rebody(); }, 220); }
// a new body: the same person made again with these sliders, where he stands (in front of the chair if he was on it)
function rebody() {
  const st = hero.state(), r = people.inspect(HERO).rec, sat = !!st.sitting;
  const front = toWorld(0, 0.75), pos = sat ? [front[0], 0, front[1]] : r.pos.slice(), heading = sat ? FACING : r.heading;
  plan = null; people.remove(HERO); addHero(pos, heading, r.walkPhase ?? 0.3);
  const b = people.inspect(HERO).rec.bodyParams;
  say(`A new body: ${b.age.toFixed(0)} years, gender ${b.sex.toFixed(2)}, ${(b.height * 100).toFixed(0)} cm, build ${b.build.toFixed(2)}, muscle ${b.muscle.toFixed(2)}.${sat ? " (He stands in front of the chair.)" : ""}`);
}

// ---- the chair: with arms or without ----
const chairButtons = { arms: mk("chair", "Arms", () => setArms(true)), none: mk("chair", "No arms", () => setArms(false)) };
function setArms(on) {
  armsOn = on; buildChair();
  chairButtons.arms.classList.toggle("on", on); chairButtons.none.classList.toggle("on", !on);
  const seated = !!hero.state().sitting;
  say((on ? "A chair with arms: his hands go to the armrests as he sits, rest on them, and push on them to rise, as the captured sitter's did." : "A chair without arms: his hands brace on his own thighs as he sits and rises, and rest on them seated.") + (seated ? " (From his next sit.)" : ""));
}
chairButtons[armsOn ? "arms" : "none"].classList.add("on");
// ---- the cut: fitted (the default here) or the crowd's (a reload, keeping the rest of the address) ----
for (const [label, on] of [["Fitted cut", true], ["Crowd's cut", false]]) {
  const b = mk("body", label, () => { const u = new URL(location.href); u.searchParams.set("fit", on ? "1" : "0"); if (clothes === "nude") u.searchParams.set("body", "dressed"); location.href = u.href; }, on ? "the working clothes cut to his body" : "the clothes as the crowd wears them now");
  b.classList.toggle("on", on === fitted);
}

// ---- the loop ----
let t = 0, last = performance.now(), frames = 0, since = last, fps = 0, label = "";
function tick(dt) {
  t += dt;
  people.tick(t, dt, camera);
  for (const e of people.events()) if (e.id === HERO) sawEvent.add(e.type);
  runPlan(t);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!paused || stepOnce) { tick((stepOnce ? 1 / 60 : dt) * (stepOnce ? 1 : speed)); stepOnce = false; }
  place(false); controls.update();
  label = drawOverlay(people.inspect(HERO)) ?? "";
  renderer.render(scene, camera);
  frames++;
  if (now - since > 400) {
    fps = frames * 1000 / (now - since); frames = 0; since = now;
    const a = people.inspect(HERO)?.animation, st = hero.state();
    $("hud").textContent = `${a?.kind ?? "…"} ${a ? a.phase.toFixed(2) : ""}${st.sitting ? " · " + st.sitting.segment : ""} · ${speed === 1 ? "" : speed + "× · "}${fps.toFixed(0)} fps · ${backend}${label ? " · " + label : ""}`;
  }
}
renderer.setAnimationLoop(frame);
if (q.get("do")) actions[q.get("do")]?.();
window.hero = {
  ready: true, backend, people, seat,
  go: (name) => actions[name](),
  view: (name) => setView(name),
  speed: (x) => { speed = x; },
  capture: (on) => { showCapture = on; bCap.classList.toggle("on", on); },
  pause: (on = true) => { paused = on; bPause.classList.toggle("on", on); },
  /** advance the scene by `seconds` in 1/60 s steps, without rendering (for stills) */
  advance(seconds) { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) { place(true); controls.update(); tick(1 / 60); } place(true); controls.update(); drawOverlay(people.inspect(HERO)); },
  render() { place(false); controls.update(); drawOverlay(people.inspect(HERO)); renderer.render(scene, camera); },
  state: () => ({ t, ...people.inspect(HERO)?.animation, sitting: hero.state().sitting?.segment ?? null, pos: hero.state().at.pos }),
  clothes: (mode) => setClothes(mode),
  arms: (on) => setArms(on),
  hold: (on = true) => { holdCam = on; bHold.classList.toggle("on", on); },
  /** a body from slider values ({ age, sex, height, build, muscle, skin (melanin 0..1) }, the rest kept) */
  body: (v) => { for (const [k, x] of Object.entries(v)) if (k in sliderValues) { sliderValues[k] = x; sliderInputs[k].input.value = x; sliderInputs[k].out.textContent = sliderInputs[k].fmt(x); } bodyOver = { age: sliderValues.age, sex: sliderValues.sex, height: sliderValues.height, build: sliderValues.build, muscle: sliderValues.muscle, skin: skinColour(sliderValues.skin) }; rebody(); },
};
