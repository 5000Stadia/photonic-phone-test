// Photonic R6: two walks side by side on one stand-in figure, to tell a stiff walk model from a stiff body.
//   A  today's walker: params()/pose()/fk() of spikes/gait/gait.js on its fitted basis (Van Criekinge 2023, CC0).
//   B  a captured walk: 100STYLE Neutral forward walk (CC BY 4.0), a trimmed BVH read by three's BVHLoader.
// Both end up as the same set of joint positions (three's frame: x forward, y up, z to the figure's right), are walked in
// place, scaled to one height, and drawn by the same code with the same radii and colours. The figure never sees angles.
//   ?view=side|front   ?speed=1|0.5   ?t=SECONDS (paused there)   window.walkAt(t) renders a time, for the GIF.
import * as THREE from "three";
import { BVHLoader } from "three/addons/loaders/BVHLoader.js";
import { loadBasis, params, pose, fk } from "./gait.js";

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const fail = (e) => { const el = $("err"); el.style.display = "block"; el.textContent = String(e && e.message || e); console.error(e); };
addEventListener("error", (e) => fail(e.error || e.message));
addEventListener("unhandledrejection", (e) => fail(e.reason));

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// The joints both walkers are reduced to (L/R = the figure's left/right).
const JOINTS = ["pelvis", "waist", "neckBase", "headBase", "crown", "shoMid",
  "hipL", "kneeL", "ankleL", "toeL", "shoL", "elbL", "wriL",
  "hipR", "kneeR", "ankleR", "toeR", "shoR", "elbR", "wriR"];

// ---------- A: today's walker ----------
const basis = loadBasis(await (await fetch("./gait-basis.json")).json());
// the demo's own recipe for an average adult: root "fitted" (the data's pelvis path), no foot planting
// ?pace=same (the default) runs it at the capture's cadence by its speed factor, so pace doesn't colour the comparison;
// ?pace=own leaves it at its own (about 110 steps/min against the capture's 89, a stroll)
const RA = { age: 35, sex: 1, seed: 5, root: "fitted" }, PACE = Q.get("pace") === "own" ? "own" : "same";
let PA = params(RA, basis);
const toThree = (p) => [p[0], p[2], -p[1]];                 // gait: x forward, y left, z up -> three: z is the figure's right
function jointsA(phase) {
  const J = fk(PA, pose(PA, phase), 0), R = J.rot.head, h = PA.body.head;
  const j = {
    pelvis: J.root, waist: J.waist, neckBase: J.chest, headBase: J.neck,
    crown: add3(J.neck, [R[2] * h, R[5] * h, R[8] * h]), shoMid: mid(J.L.sho, J.R.sho),
  };
  for (const s of ["L", "R"]) Object.assign(j, {
    ["hip" + s]: J[s].hip, ["knee" + s]: J[s].knee, ["ankle" + s]: J[s].ankle, ["toe" + s]: J[s].toe,
    ["sho" + s]: J[s].sho, ["elb" + s]: J[s].elb, ["wri" + s]: J[s].wri,
  });
  const o = {};
  for (const k of JOINTS) o[k] = toThree(j[k]);
  return o;
}

// ---------- B: the captured walk ----------
const bvhText = await (await fetch("./100style/Neutral_FW_trim.bvh")).text();
const { skeleton, clip } = new BVHLoader().parse(bvhText);
const bones = Object.fromEntries(skeleton.bones.map((b) => [b.name, b]));
const root = new THREE.Group(); root.add(skeleton.bones[0]);
const mixer = new THREE.AnimationMixer(skeleton.bones[0]);
mixer.clipAction(clip).play();
const FPS = 60, NB = Math.round(clip.duration * FPS);           // frames 0..NB are in the clip; NB equals frame 0 as a pose
if (PACE === "same") {   // bisect the speed factor (Froude) until A's strides a second match the capture's two strides a loop
  const want = 2 / (NB / FPS);
  let lo = 0.05, hi = 2;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (params({ ...RA, speed: m }, basis).f < want) lo = m; else hi = m; }
  PA = params({ ...RA, speed: (lo + hi) / 2 }, basis);
}
const NA = 64, rawA = Array.from({ length: NA }, (_, i) => jointsA(i / NA));
const NAMES = { pelvis: "Hips", waist: "Chest2", neckBase: "Neck", headBase: "Head", crown: "Head_End" };
for (const s of ["Left", "Right"]) {
  const L = s[0];
  Object.assign(NAMES, { ["hip" + L]: s + "Hip", ["knee" + L]: s + "Knee", ["ankle" + L]: s + "Ankle", ["toe" + L]: s + "Toe_End",
    ["sho" + L]: s + "Shoulder", ["elb" + L]: s + "Elbow", ["wri" + L]: s + "Wrist" });
}
// three's BVHLoader names an end site after its parent; find the end sites by their parent if the name differs
for (const [k, n] of Object.entries(NAMES)) if (!bones[n]) {
  const parent = bones[n.replace(/_End$/, "")];
  const kid = parent && parent.children.find((c) => c.isBone);
  if (kid) bones[n] = kid; else throw new Error("BVH joint not found: " + n);
}
const rawB = [];
for (let i = 0; i <= NB; i++) {
  mixer.setTime(i / FPS); root.updateMatrixWorld(true);
  const w = new THREE.Vector3(), j = {};
  for (const k of JOINTS.filter((k) => k !== "shoMid")) { bones[NAMES[k]].getWorldPosition(w); j[k] = [w.x * 0.01, w.y * 0.01, w.z * 0.01]; }   // cm -> m
  j.shoMid = mid(j.shoL, j.shoR);
  rawB.push(j);
}

// ---------- both: in place, facing +x, one height, feet on the floor ----------
// Travel: take off the straight-line advance of the pelvis over the loop (the surge and sway inside a stride stay), and turn each
// frame by the fitted slow heading so the figure faces +x (the pelvis's own twist inside a stride stays). A closed loop's last
// frame is the first pose again, so what is left between them is spread over the clip and the last frame dropped.
// forward = left x up in the x-z plane, for left = hipL - hipR; the angle runs from +x toward +z
const facing = (f) => { const l = sub3(f.hipL, f.hipR); return Math.atan2(l[0], -l[2]); };
function fitLine(ys) {
  const n = ys.length, xs = ys.map((_, i) => i / (n - 1));
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const m = sxy / sxx; return (t) => my + m * (t - mx);
}
function normalise(raw, closed) {
  const N = raw.length, th = raw.map(facing);
  for (let i = 1; i < N; i++) { while (th[i] - th[i - 1] > Math.PI) th[i] -= 2 * Math.PI; while (th[i] - th[i - 1] < -Math.PI) th[i] += 2 * Math.PI; }
  const line = fitLine(th), trav = closed ? sub3(raw[N - 1].pelvis, raw[0].pelvis) : [0, 0, 0];
  const out = raw.map((fr, i) => {
    const t = i / (N - 1), a = line(t), c = Math.cos(a), s = Math.sin(a), off = [trav[0] * t, 0, trav[2] * t], o = {};
    for (const k of JOINTS) { const q = sub3(fr[k], off); o[k] = [q[0] * c + q[2] * s, q[1], -q[0] * s + q[2] * c]; }
    return o;
  });
  if (closed) {
    const gap = JOINTS.map((k) => sub3(out[N - 1][k], out[0][k]));
    out.forEach((f, i) => JOINTS.forEach((k, j) => { f[k] = sub3(f[k], gap[j].map((v) => v * i / (N - 1))); }));
    out.pop();
  }
  const mean = [0, 2].map((d) => out.reduce((s2, f) => s2 + f.pelvis[d], 0) / out.length);   // centre on the mean pelvis x and z
  for (const f of out) for (const k of JOINTS) { f[k][0] -= mean[0]; f[k][2] -= mean[1]; }
  return out;
}
const A = normalise(rawA, false), Bn = normalise(rawB, true);
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const crownH = (F) => F.reduce((s, f) => s + f.crown[1], 0) / F.length;
// floor: the lower toe tip in a frame is the planted foot, so the median of that is the floor
for (const F of [A, Bn]) {
  const fl = med(F.map((f) => Math.min(f.toeL[1], f.toeR[1])));
  for (const f of F) for (const k of JOINTS) f[k][1] -= fl;
}
const HA = crownH(A), HB = crownH(Bn), sB = HA / HB;      // B scaled to A's standing height
for (const f of Bn) for (const k of JOINTS) f[k] = f[k].map((v) => v * sB);
const nB = Bn.length;

// timing: A runs at its own cadence (P.f strides a second); B's loop is its clip length (two strides)
const periodA = 1 / PA.f, periodB = NB / FPS;
const sample = (F, ph) => {
  const x = (((ph % 1) + 1) % 1) * F.length, i = Math.floor(x), t = x - i, a = F[i], b = F[(i + 1) % F.length], o = {};
  for (const k of JOINTS) o[k] = lerp3(a[k], b[k], t);
  return o;
};
const stepsMin = (stridesPerSec) => Math.round(stridesPerSec * 2 * 60);
$("sa").textContent = `${stepsMin(PA.f)} steps/min`;
$("sb").textContent = `${stepsMin(2 / periodB)} steps/min`;

// ---------- the figure: capsules and spheres between joints ----------
const COL = { trunk: 0xe6e2da, L: 0xf0a14e, R: 0x5aa4e6 };
const mats = Object.fromEntries(Object.entries(COL).map(([k, c]) => [k, new THREE.MeshLambertMaterial({ color: c })]));
const cyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1), ball = new THREE.SphereGeometry(1, 16, 12);
const BONE = [   // [from, to, radius, colour]
  ["pelvis", "waist", 0.080, "trunk"], ["waist", "neckBase", 0.085, "trunk"], ["hipL", "hipR", 0.060, "trunk"], ["shoL", "shoR", 0.040, "trunk"],
  ["neckBase", "headBase", 0.036, "trunk"],
  ...["L", "R"].flatMap((s) => [
    ["hip" + s, "knee" + s, 0.058, s], ["knee" + s, "ankle" + s, 0.044, s], ["ankle" + s, "toe" + s, 0.030, s],
    ["sho" + s, "elb" + s, 0.038, s], ["elb" + s, "wri" + s, 0.031, s]]),
];
const BALLS = [   // joint spheres, to round the capsule ends
  ["waist", 0.0825, "trunk"], ["neckBase", 0.05, "trunk"], ["pelvis", 0.0815, "trunk"], ["hipL", 0.06, "trunk"], ["hipR", 0.06, "trunk"],
  ["shoL", 0.042, "L"], ["shoR", 0.042, "R"],
  ...["L", "R"].flatMap((s) => [["knee" + s, 0.050, s], ["ankle" + s, 0.040, s], ["toe" + s, 0.030, s], ["elb" + s, 0.034, s], ["wri" + s, 0.031, s]]),
];
const HEAD_R = 0.095;
function makeFigure(scene) {
  const g = new THREE.Group();
  const bones = BONE.map(([a, b, r, c]) => { const m = new THREE.Mesh(cyl, mats[c]); g.add(m); return { a, b, r, m }; });
  const balls = BALLS.map(([a, r, c]) => { const m = new THREE.Mesh(ball, mats[c]); m.scale.setScalar(r); g.add(m); return { a, m }; });
  const head = new THREE.Mesh(ball, mats.trunk); head.scale.setScalar(HEAD_R); g.add(head);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; g.add(shadow);
  scene.add(g);
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), q = new THREE.Quaternion();
  return {
    g,
    set(j) {
      for (const b of bones) {
        const pa = V3(j[b.a]), pb = V3(j[b.b]); d.subVectors(pb, pa);
        const len = d.length(); b.m.position.addVectors(pa, pb).multiplyScalar(0.5);
        b.m.quaternion.copy(q.setFromUnitVectors(up, d.divideScalar(len || 1))); b.m.scale.set(b.r, len, b.r);
      }
      for (const s of balls) s.m.position.copy(V3(j[s.a]));
      head.position.copy(V3(mid(j.headBase, j.crown)));
    },
  };
}

// ---------- scene ----------
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const stage = $("cv"); stage.prepend(renderer.domElement); await renderer.init();
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x5f6266);
scene.add(new THREE.HemisphereLight(0xdde6f0, 0x4a4440, 1.6));
const key = new THREE.DirectionalLight(0xfff1e0, 2.0); key.position.set(2, 4, 5); scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x8d9094 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const figA = makeFigure(scene), figB = makeFigure(scene);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);

const SPACING = 0.58;          // each figure this far from the centre, along the screen's horizontal
const VIEWS = { side: { az: 0, el: 6 }, front: { az: 42, el: 10 } };
let view = Q.get("view") === "front" ? "front" : "side", speed = Q.get("speed") === "0.5" ? 0.5 : 1, paused = false, T = 0;
function aim() {
  const { az, el } = VIEWS[view], a = az * Math.PI / 180, e = el * Math.PI / 180, D = 12, c = new THREE.Vector3(0, 0.93, 0);
  cam.position.set(D * Math.sin(a) * Math.cos(e), c.y + D * Math.sin(e), D * Math.cos(a) * Math.cos(e));
  cam.lookAt(c);
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
  figA.g.position.copy(right).multiplyScalar(-SPACING); figB.g.position.copy(right).multiplyScalar(SPACING);
}
function size() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  const asp = w / h, vh = Math.max(2.05, 2.1 / asp);        // the view holds both figures across and one tall figure up
  cam.left = -vh * asp / 2; cam.right = vh * asp / 2; cam.top = vh / 2; cam.bottom = -vh / 2;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(); aim(); cam.updateMatrixWorld();
}
function draw() {
  figA.set(sample(A, T / periodA)); figB.set(sample(Bn, T / periodB));
  renderer.render(scene, cam);
}
addEventListener("resize", () => { size(); draw(); });
size();

// ---------- controls ----------
function press(group, attr, val) { for (const b of $(group).children) b.setAttribute("aria-pressed", String(b.dataset[attr] === String(val))); }
$("views").onclick = (e) => { const v = e.target.dataset?.v; if (!v) return; view = v; press("views", "v", v); aim(); cam.updateMatrixWorld(); aim(); draw(); };
$("speeds").onclick = (e) => { const s = e.target.dataset?.s; if (!s) return; speed = +s; press("speeds", "s", s); };
$("pause").onclick = () => { paused = !paused; $("pause").setAttribute("aria-pressed", String(paused)); $("pause").textContent = paused ? "Play" : "Pause"; };
$("paces").onclick = (e) => { const p = e.target.dataset?.p; if (!p || p === PACE) return; const u = new URL(location.href); u.searchParams.set("pace", p); location.href = u.href; };
press("views", "v", view); press("speeds", "s", speed); press("paces", "p", PACE);

let last = performance.now();
const fixed = Q.get("t") !== null ? +Q.get("t") : null;
if (fixed !== null) { T = fixed; paused = true; }
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) T += dt * speed;
  draw();
});
draw();
// for the GIF: render a given time and settle
window.walkAt = async (t) => { paused = true; T = t; aim(); draw(); await renderer.renderAsync(scene, cam); };
window.walkSet = (o) => { if (o.view) { view = o.view; aim(); cam.updateMatrixWorld(); aim(); } };
window.walkInfo = { heightA: HA, heightB: HB, scaleB: sB, periodA, periodB, framesB: nB, stepsA: stepsMin(PA.f), stepsB: stepsMin(2 / periodB), speedA: PA.v };
window.walkFrames = { A, B: Bn };
window.benchReady = true;
