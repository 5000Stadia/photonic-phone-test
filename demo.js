// The live people demo (Kabe, 2026-10-12: demos on GitHub Pages, as holo-emitter has them): makePeople running in real
// time, one scene per check. Drag to look around, pinch or scroll to zoom. Scenes ride in the hash (#meet, #plaza, #words).
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makePeople } from "./people/index.js";
import { makeStage, makePlaza, PLAZA_VIEW } from "./plaza.js";
import { loadBasis } from "./gait.js";
const BASIS_URL = "./gait-basis.json";

const SCENES = {
  meet: { name: "Meeting head-on", about: "Nine people from plain descriptions meet head-on in a lane, and one crosses them. Each sees the others coming and steers round early; they walk again when everyone has passed." },
  plaza: { name: "300 in a plaza", about: "300 people in a 30 m square, each walking to one spot and then another. They steer round each other; when two touch anyway, they're nudged apart and slow for a moment (the bump count is below)." },
  words: { name: "Their own walks", about: "Nine people made from words (a stout bearded man, an old woman, a girl of 8…), each walking their own walk, fitted from real gait data by age, sex and build." },
};
const WORDS = ["a stout bearded man", "a tall thin woman", "an old man", "a girl of 8", "a broad-shouldered man", "a short plump woman", "a boy of 12", "an old woman", "a young man"];
const kind = SCENES[location.hash.slice(1)] ? location.hash.slice(1) : "meet";

const nav = document.getElementById("nav");
for (const [k, s] of Object.entries(SCENES)) {
  const a = document.createElement("a"); a.href = "#" + k; a.textContent = s.name; if (k === kind) a.className = "on";
  a.addEventListener("click", (e) => { e.preventDefault(); location.hash = k; location.reload(); });
  nav.append(a);
}
const home = document.createElement("a"); home.href = "./"; home.textContent = "← lab"; nav.prepend(home);
document.getElementById("about").textContent = SCENES[kind].about + " Drag to look around.";
const hud = document.getElementById("hud");

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
await renderer.init();
const scene = makeStage(THREE);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const basis = loadBasis(await (await fetch(new URL(BASIS_URL, import.meta.url))).json());
let people = null, plaza = null, round = 0, loading = false;

function start() {
  if (people) scene.remove(people.group);
  if (kind !== "plaza") { people = makePeople(THREE, { basis, thresholds: { near: 4, mid: 14 } }); scene.add(people.group); }
  round++;
  if (kind === "meet") WORDS.forEach((w, i) => {
    const id = `m${round}.${i}`;
    if (i === 8) { people.add({ id, recipe: w, at: { pos: [-1.5, 0, -7], room: "hall" } }).goTo({ pos: [1.5, 0, 4] }); return; }
    const dir = i % 2 ? -1 : 1, k = Math.floor(i / 2), lane = ((i * 0.37) % 1 - 0.5) * 1.2;
    people.add({ id, recipe: w, at: { pos: [-dir * (2.5 + k * 1.7), 0, -2 + lane], room: "hall" } }).goTo({ pos: [dir * 12, 0, -2 + lane] });
  });
  if (kind === "words") WORDS.forEach((w, i) => {
    const row = i % 3, k = Math.floor(i / 3), dir = row === 1 ? -1 : 1, z = -row * 1.3;
    people.add({ id: `c${round}.${i}`, recipe: w, at: { pos: [-dir * (3.2 + k * 2.6), 0, z], room: "hall" } }).goTo({ pos: [dir * 14, 0, z] });
  });
  if (kind === "plaza") {                       // shared with the phone benchmark (plaza.js); its pipelines compile before the first frame
    loading = true;
    plaza = makePlaza(THREE, { basis, compile: async (g) => { scene.add(g); await renderer.compileAsync(scene, camera); } }); people = plaza.people;
    plaza.ready.then(() => { loading = false; });
  }
}
const views = { meet: [[0, 4.2, 5.5], [0, 0.4, -2.2]], words: [[0, 1.35, 4.2], [0, 0.85, -1.3]], plaza: PLAZA_VIEW };
// a phone held upright sees less across, so the camera stands further back (along the same line of sight)
const back = kind === "plaza" ? 1 : Math.max(1, 0.8 / camera.aspect);
const [eye, look] = views[kind];
camera.position.set(...eye.map((v, i) => look[i] + (v - look[i]) * back)); controls.target.set(...look); controls.update();
start();

let last = performance.now(), t = 0, frames = 0, since = last, fps = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (loading) { hud.textContent = "preparing 300 people…"; return; }
  t += dt;
  controls.update();
  const c = plaza ? plaza.tick(t, dt, camera) : people.tick(t, dt, camera);
  if (!plaza) people.events();
  if (kind !== "plaza" && people.all().every(p => !p.state().doing)) start();       // everyone through: walk again
  renderer.render(scene, camera);
  frames++;
  if (now - since > 500) { fps = frames * 1000 / (now - since); frames = 0; since = now;
    hud.textContent = `${people.all().length} people · ${fps.toFixed(0)} fps · near ${c.near} · mid ${c.mid} · far ${c.far}` + (kind === "plaza" ? ` · bumps ${plaza.bumps()}` : ""); }
});
