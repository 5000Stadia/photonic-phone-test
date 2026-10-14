import { peopleQuality } from "./people/quality.js";
// The lineup (R5, "Done when: the lineup"): thirty people from age 0 to 90, of every build, each dressed for 1660 from their own words ("a girl of 8 in a red dress" is a girl in a red dress).
// Everyone is drawn at the near tier (they are close); drag to look around, pinch or scroll to zoom. Standing, or walking in place. The cast and its words are cast.js; the words become a dress in
// src/people/dress-words.js, and a colour the outfit's palette lacks is said under the caption, never silently swapped. ?gl=1 forces WebGL2.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makePeople } from "./people/index.js";
import { GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN } from "./people/garments/outfit.js";
import { makeStage } from "./plaza.js";
import { loadBasis } from "./gait.js";
import { castOf } from "./cast.js";
const BASIS_URL = "./gait-basis.json";

const STAND = 0.30;                         // the gait phase at which the feet are nearest together: where a standing person is held (the walker has no stance of its own yet)
const ROW = 10, DX = 1.4, DZ = 3.4;
const VIEW = [[0, 11.9, 11.2], [0, 0.5, -3.4]];
const cast = castOf();
const by = new Map(cast.map((c) => [c.id, c]));
const q = new URLSearchParams(location.search);
const quality = peopleQuality(q.get("q"));

const hud = document.getElementById("hud");
document.getElementById("about").textContent = "Thirty people, from a baby to ninety, each dressed from their own words (1660 London). Each caption is what the person was made from; under it the outfit, and any colour the outfit could not make. Drag to look around.";
const errors = [];
addEventListener("error", (e) => errors.push(String(e.message)));
addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
const origError = console.error; console.error = (...a) => { errors.push(a.map(String).join(" ")); origError(...a); };

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: q.get("gl") === "1" });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? "WebGPU" : "WebGL2";
const scene = makeStage(THREE, { quality, renderer });
const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 1.2; controls.maxDistance = 40;
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
// a phone held upright sees less across, so the camera stands further back along the same line of sight
const back = Math.max(1.28, 2.3 / camera.aspect);
function view([eye, look]) { camera.position.set(...eye.map((v, i) => look[i] + (v - look[i]) * back)); controls.target.set(...look); controls.update(); }
view(VIEW);

const basis = loadBasis(await (await fetch(new URL(BASIS_URL, import.meta.url))).json());
// everyone close: the near tier from any distance the page can be orbited to
const people = makePeople(THREE, { basis, quality, thresholds: { near: 200, mid: 400 }, nearCapacity: 32, outfits: (id) => { const d = by.get(id)?.dress; return d?.outfit ? { outfit: d.outfit, look: d.look } : null; } });
scene.add(people.group);
people.warm([GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN]);
const place = (i) => [((i % ROW) - (ROW - 1) / 2) * DX, 0, -Math.floor(i / ROW) * DZ];
const handles = cast.map((c, i) => people.add({ id: c.id, seed: c.seed, recipe: c.said, at: { pos: place(i), room: "hall" }, state: { heading: 0, phase: STAND } }));
scene.remove(people.group);
await renderer.compileAsync(scene, camera); scene.add(people.group);
await people.compile(renderer, scene, camera, { defer: false });

// the captions
const tags = document.getElementById("tags"), list = document.getElementById("list");
const outfitName = (c) => c.dress.outfit ? `${c.dress.outfit.id} · ${c.dress.look.id}` : `base layer only (${c.dress.none})`;
const asks = (c) => c.dress.colours.filter((k) => k.status !== "matched");
const els = cast.map((c, i) => {
  const e = document.createElement("div"); e.className = "tag";
  const sub = c.dress.outfit ? `${c.dress.outfit.id} · ${c.dress.look.id}` : c.dress.none.replace(/^not yet: /, "not yet: ");
  e.innerHTML = `<span class="n">${i + 1}</span><b></b><span class="sub"></span>`;
  e.querySelector("b").textContent = c.caption;
  e.querySelector(".sub").textContent = sub;
  for (const k of asks(c)) { const s = document.createElement("span"); s.className = "sub warn"; s.textContent = `${k.word.split(" ")[0]}: ${k.status === "outside" ? "not in the palette; " : ""}nearest is ${k.got}`; e.append(s); }
  if (c.worst) { const s = document.createElement("span"); s.className = "sub"; s.textContent = `worst seed: ${c.worst}`; e.append(s); }
  tags.append(e); return e;
});
{
  const rows = cast.map((c, i) => {
    const v = c.values, d = c.dress, h = Math.round(c.derived["body.height"]);
    const note = [...asks(c).map((k) => `${k.word.split(" ")[0]} asked, ${k.status === "outside" ? "not in the palette: " : ""}nearest ${k.got} (distance ${k.delta})`), ...d.notes, ...(c.worst ? [`worst seed of the sweep: ${c.worst}`] : [])];
    const rank = d.outfit ? `${d.rank} (${d.rankFrom === "words" ? "said: " + d.rankWords.join(", ") : "the seed's"})` : "";
    return `<tr><td>${i + 1}</td><td></td><td>${v.sex}, ${v.age.toFixed(1)} y, ${h} cm, build ${(v["body.adiposity"] ?? 0).toFixed(2)}</td><td>${d.outfit ? d.outfit.id + " · " + d.look.id : "base layer only"}</td><td>${rank || d.none}</td><td class="${note.length ? "warn" : ""}">${note.join("; ")}</td></tr>`;
  });
  list.innerHTML = `<table><thead><tr><th>#</th><th>words</th><th>who</th><th>dress</th><th>rank</th><th>said / substituted</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  list.querySelectorAll("tbody tr").forEach((tr, i) => { tr.children[1].textContent = cast[i].caption || ""; });
}

// the buttons
const nav = document.getElementById("nav");
const mk = (text, on) => { const b = document.createElement("button"); b.textContent = text; b.addEventListener("click", on); nav.append(b); return b; };
const home = document.createElement("a"); home.href = "./"; home.textContent = "← lab"; nav.prepend(home);
let walking = false, settling = false;
const bStand = mk("Standing", () => setWalking(false)), bWalk = mk("Walking in place", () => setWalking(true));
const bCap = mk("Captions", () => { tags.classList.toggle("off"); bCap.classList.toggle("on"); }); bCap.classList.add("on");
if (camera.aspect < 1) { tags.classList.add("off"); bCap.classList.remove("on"); }          // a phone held upright: thirty captions will not fit across; Details lists them, and Captions shows them to read up close
const bList = mk("Details", () => { list.classList.toggle("on"); bList.classList.toggle("on"); });
mk("Front", () => view(VIEW));
mk("Close", () => view([[0, 1.5, 4.2], [0, 0.9, -0.6]]));
function setWalking(on) {
  walking = on; settling = !on;
  bWalk.classList.toggle("on", on); bStand.classList.toggle("on", !on);
  if (on) cast.forEach((c, i) => { if (c.values.age >= 0.9) { const p = place(i); handles[i].goTo({ pos: [p[0], 0, p[2] + 60] }, { inPlace: true }); } });
}
bStand.classList.add("on");

// a person who is walking in place stops when their feet next pass the standing phase; babies are not walked
function settle() {
  let any = false;
  cast.forEach((c, i) => {
    const s = handles[i].state(); if (!s.doing) return;
    any = true;
    const ph = s.phase; let d = ph - STAND; d -= Math.floor(d);        // how far past the standing phase, in cycles
    if (d < 0.03) { handles[i].goTo({ pos: s.at.pos }, {}); }          // arrives where they stand: the feet stay at this phase
  });
  if (!any) settling = false;
}

const v3 = new THREE.Vector3();
function tagsAt() {
  const w = innerWidth, h = innerHeight;
  cast.forEach((c, i) => {
    const p = place(i); v3.set(p[0], 0, p[2]).project(camera);
    const e = els[i];
    if (v3.z > 1 || v3.z < -1) { e.style.display = "none"; return; }
    e.style.display = ""; e.style.transform = `translate(${((v3.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v3.y) / 2 * h + 4).toFixed(1)}px)`;
  });
}

let last = performance.now(), t = 0, frames = 0, since = last, fps = 0, counts = {};
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
  controls.update();
  counts = people.tick(t, dt, camera); people.events();
  if (settling) settle();
  renderer.render(scene, camera);
  tagsAt();
  frames++;
  if (now - since > 500) { fps = frames * 1000 / (now - since); frames = 0; since = now; hud.textContent = `${backend} · ${cast.length} people · ${fps.toFixed(0)} fps · near ${counts.near} · mid ${counts.mid} · far ${counts.far}`; }
}
renderer.setAnimationLoop(frame);
window.lineup = { backend, errors, cast, people, setWalking, view, counts: () => counts, ready: true };
