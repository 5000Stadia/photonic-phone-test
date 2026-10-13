// The plaza, shared: the live demo's "300 in a plaza" scene and the phone benchmark's real-people variants build it the same way, so a
// number from the phone is the demo's own cost. 300 people in a 30 m square, each walking to hashed spots in turn; about one woman
// or girl in five wears the gentlewoman (src/people/outfits.js) unless `outfits: false` takes every outfit off.
import { makePeople } from "./people/index.js";
import { uniform } from "./traits/stream.js";

export const PLAZA_MIXED = ["", "a man", "a woman", "a stout bearded man", "a tall thin woman", "an old man", "a girl", "a broad-shouldered man"];
export const PLAZA_VIEW = [[0, 1.6, 11], [0, 1.2, 0]];       // eye, look-at: the plaza's camera, fixed in the benchmark
export const PLAZA_THRESHOLDS = { near: 4, mid: 14 };

/** The demo's stage: grey sky, a hemisphere and a key light, a 200 m floor. */
export function makeStage(THREE) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x6b6e72);
  scene.add(new THREE.HemisphereLight(0xdde6f0, 0x4a4440, 1.2));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(10, 20, 12); scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardNodeMaterial({ color: 0x7a7c80, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  return scene;
}

/** The plaza's people: { people, tick(t, dt, camera) -> counts (also sends whoever arrived on to another spot), bumps() }.
 *  `outfits` as makePeople's (omitted: the placeholder rule; false: nobody dressed). `n`: how many (300). */
export function makePlaza(THREE, { basis, outfits, n = 300 } = {}) {
  const people = makePeople(THREE, { basis, thresholds: PLAZA_THRESHOLDS, ...(outfits !== undefined ? { outfits } : {}) });
  const trips = new Map();
  let bumps = 0;
  const elsewhere = (id) => { const k = (trips.get(id) ?? 0) + 1; trips.set(id, k); return [(uniform(1, id, "x" + k) - 0.5) * 30, 0, (uniform(1, id, "z" + k) - 0.5) * 30]; };
  for (let i = 0; i < n; i++) {
    const id = "w" + i;
    people.add({ id, recipe: PLAZA_MIXED[i % PLAZA_MIXED.length], at: { pos: [(uniform(2, id, "x") - 0.5) * 30, 0, (uniform(2, id, "z") - 0.5) * 30], room: "hall" } }).goTo({ pos: elsewhere(id) });
  }
  return {
    people,
    tick(t, dt, camera) {
      const c = people.tick(t, dt, camera);
      for (const e of people.events()) {
        if (e.type === "bumped") bumps += 0.5;
        if (e.type === "arrived") people.get(e.id).goTo({ pos: elsewhere(e.id) });
      }
      return c;
    },
    bumps: () => Math.round(bumps),
  };
}
