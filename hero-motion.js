// Hero motion (2026-10-15): ONE person, close, at the near tier with hair and clothes, walking, standing, sitting down, seated, standing up and the
// hand-overs between, to dial the motion in on one body before it is abstracted to every other (Kabe: "stick to one you perfect at high res to dial in
// everything perfect then abstract to all other example options"). The hero is the lineup's L17, "a broad-shouldered man, a labourer, in a green
// doublet": an adult in working dress, whose close breeches and short doublet hide little of the legs and arms.
//   Do: walk, stop, sit, stand up, or the tour of all of them. View: orbit (drag), side, front, three-quarter, back, face, feet; the camera follows him.
//   Time: 1x, 1/2, 1/4, 1/10, pause, step a frame. Capture: the raw captured skeleton over him (pale lines), aligned at the pelvis and scaled to his
//   hip height: compare the angles of the limbs. Hand-overs (stop, start, rise, sit-in) are blended, not captured, so no capture is shown for them.
//   ?view=side|front|...  ?capture=1  ?do=walk|stop|sit|rise|tour  ?keepout=0 (arms as captured, clothes ignored: a diagnostic)  ?gl=1 (WebGL2)
// window.hero: { go(action), view(name), speed(x), advance(seconds), render(), state(), ready } for deterministic stills.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makePeople } from "./people/index.js";
import { WORKMAN, GENTLEMAN, GENTLEWOMAN, WORKWOMAN } from "./people/garments/outfit.js";
import { loadSitting, makeSitting, fittingSeatHeight, sitFrame } from "./people/sitting.js";
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
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.4; controls.maxDistance = 14; controls.enablePan = false;
function size() { const w = stageEl.clientWidth, h = stageEl.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
new ResizeObserver(size).observe(stageEl); size();

// ---- the hero and his chair ----
const cast = castOf(), who = cast.find((c) => c.id === HERO);
const basis = loadBasis(await (await fetch(new URL(BASIS_URL, import.meta.url))).json());
const people = makePeople(THREE, { basis, thresholds: { near: 400, mid: 800 }, nearCapacity: 4, capacity: 8, exactArms: true, easeWalks: true,
  outfits: (id) => (id === HERO && who.dress?.outfit ? { outfit: who.dress.outfit, look: who.dress.look } : null) });
scene.add(people.group);
people.warm([WORKMAN, GENTLEMAN, GENTLEWOMAN, WORKWOMAN]);
const hero = people.add({ id: HERO, seed: who.seed, recipe: who.said, at: { pos: [0, 0, 0], room: "hall" }, state: { heading: 0, phase: 0.3 } });
// ?keepout=0: the arms as captured, with nothing keeping them out of his clothes (a diagnostic, to see what the keep-out does)
if (q.get("keepout") === "0") people.inspect(HERO).rec.dressing.keepout = null;
const sitBank = await loadSitting();
const rec0 = people.inspect(HERO).rec, { J, tip } = rec0.body.joints;
const seatH = fittingSeatHeight(sitBank, J, tip, rec0.height, "113_15");
const fit = makeSitting(sitBank, J, tip, rec0.height, seatH, "113_15"), first = fit.pose(fit.spec.segments.sitDown[0]).P[0];
// the chair faces the walking line from its side (facing +x, away from the side view's camera): he walks up the line, turns to it and sits
const CHAIR = [-1.6, 0], FACING = Math.PI / 2, c = Math.cos(FACING), s = Math.sin(FACING);
const seat = { id: "chair", floor: 0, height: seatH, facing: FACING, width: 0.46, depth: 0.42,
  contact: [CHAIR[0] - (c * first[0] + s * first[2]), CHAIR[1] - (-s * first[0] + c * first[2])] };
{
  const wood = new THREE.MeshStandardMaterial({ color: 0x6f5a44, roughness: 0.95 }), chair = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(seat.width, 0.035, seat.depth), wood); board.position.y = seatH - 0.0175; chair.add(board);
  for (const x of [-1, 1]) for (const z of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, seatH - 0.035, 0.03), wood); leg.position.set(x * (seat.width / 2 - 0.03), (seatH - 0.035) / 2, z * (seat.depth / 2 - 0.03)); chair.add(leg); }
  const back = new THREE.Mesh(new THREE.BoxGeometry(seat.width, 0.45, 0.03), wood); back.position.set(0, seatH + 0.22, -seat.depth / 2 + 0.015); chair.add(back);
  for (const o of chair.children) { o.castShadow = true; o.receiveShadow = true; }
  // the chair's front faces the seat's facing (the board's -z edge is its back)
  chair.rotation.y = FACING; chair.position.set(seat.contact[0], 0, seat.contact[1]);
  scene.add(chair);
}
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
function place(snap) {
  const info = people.inspect(HERO); if (!info) return;
  let [x, z, h] = centre(info), v = VIEWS[view], y = v?.h ?? 0.95;
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
function setView(name) { view = name; for (const [k, b] of Object.entries(viewButtons)) b.classList.toggle("on", k === name); place(true); }
let speed = 1, paused = false, stepOnce = false;
const speedButtons = {};
for (const [label, x] of [["1×", 1], ["½", 0.5], ["¼", 0.25], ["⅒", 0.1]]) speedButtons[label] = mk("time", label, () => { speed = x; paused = false; for (const [k, b] of Object.entries(speedButtons)) b.classList.toggle("on", k === label); bPause.classList.remove("on"); });
const bPause = mk("time", "Pause", () => { paused = !paused; bPause.classList.toggle("on", paused); });
mk("time", "Step", () => { paused = true; bPause.classList.add("on"); stepOnce = true; }, "one frame (1/60 s at 1×)");
const bCap = mk("time", "Capture", () => { showCapture = !showCapture; bCap.classList.toggle("on", showCapture); });
speedButtons["1×"].classList.add("on"); bCap.classList.toggle("on", showCapture);
setView(view);

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
};
