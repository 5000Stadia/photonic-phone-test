import * as T from "three/tsl";
import { STAGE_LIGHT as rig } from "./stage-light.js";
import { peopleQuality } from "./people/quality.js";
import { surfaceNormal } from "./people/surface.js";
// The plaza, shared: the live demo's "300 in a plaza" scene and the phone benchmark's real-people variants build it the same way, so a
// number from the phone is the demo's own cost. 300 people in a 30 m square, each walking to hashed spots in turn; about one woman
// or girl in five wears the gentlewoman (src/people/outfits.js) unless `outfits: false` takes every outfit off.
import { makePeople } from "./people/index.js";
import { uniform } from "./traits/stream.js";

export const PLAZA_MIXED = ["", "a man", "a woman", "a stout bearded man", "a tall thin woman", "an old man", "a girl", "a broad-shouldered man"];
export const PLAZA_VIEW = [[0, 1.6, 11], [0, 1.2, 0]];       // eye, look-at: the plaza's camera, fixed in the benchmark
export const PLAZA_THRESHOLDS = { near: 4, mid: 14 };

/** Test-stage lighting only. Hosts keep control of their own lights and tone mapping.
 * No scene-sized HDR target: ACES runs in each material on both backends. */
export function makeStage(THREE, { quality, renderer } = {}) {
  quality = peopleQuality(quality);
  const pc = quality === 'pc';
  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.contextNode = T.context({ getOutput: (output, builder) =>
      builder.renderer.getRenderTarget() === null ? T.renderOutput(output, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace) : output });
    renderer.toneMappingExposure = rig.exposure;
  }
  const scene = new THREE.Scene();
  // Linear colours: a broad, neutral fill keeps shaded skin readable without wrap flattening it.
  scene.add(new THREE.HemisphereLight(new THREE.Color().setRGB(...rig.sky), new THREE.Color().setRGB(...rig.ground), rig.ambient));
  const haze = new THREE.Color().setRGB(0.64, 0.66, 0.65);
  scene.fog = new THREE.Fog(haze, 12, 65);
  // Tiny linear sky/ground panorama; three prefilters it for rough specular. No downloads.
  const w = 64, h = 128, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // DataTexture rows run from v=0 (nadir) to v=1 (zenith).
    const up = -Math.cos(Math.PI * (y + 0.5) / h);
    const sky = up >= 0, t = Math.pow(Math.abs(up), 0.55), a = [haze.r, haze.g, haze.b], b = sky ? [0.16, 0.36, 0.68] : [0.23, 0.2, 0.16];
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) data[i+c] = Math.round(255 * (a[c] * (1-t) + b[c] * t));
    data[i+3] = 255;
  }
  const env = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  env.mapping = THREE.EquirectangularReflectionMapping; env.colorSpace = THREE.LinearSRGBColorSpace;
  env.minFilter = env.magFilter = THREE.LinearFilter;
  env.needsUpdate = true; scene.environment = env; scene.environmentIntensity = 0.15;
  scene.background = env;
  // Front three-quarter from both fixed cameras (+Z), high and camera-left.
  const key = new THREE.DirectionalLight(new THREE.Color().setRGB(...rig.key, THREE.SRGBColorSpace), rig.intensity); key.position.set(...rig.position);
  key.castShadow = true; key.shadow.mapSize.setScalar(pc ? 1024 : 512);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 0.5, far: 65 });
  key.shadow.bias = -0.00015; key.shadow.normalBias = 0.025; key.shadow.radius = pc ? 2 : 1;
  scene.add(key, key.target);
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
  // Uneven 30–60 cm courses: warp the boundaries, stagger each course, keep joints ~4 mm.
  const p = T.positionWorld.xz;
  const course = p.y.add(p.y.mul(7).sin().mul(0.018)).div(0.38), row = course.floor();
  const offset = row.mul(127.1).sin().mul(43758.5453).fract();
  const along = p.x.add(p.x.mul(5).add(row).sin().mul(0.035)).div(0.46).add(offset);
  const cell = T.vec2(along, course), id = cell.floor();
  const edge = T.float(0.5).sub(cell.fract().sub(0.5).abs()).mul(T.vec2(0.46, 0.38));
  const distance = edge.x.min(edge.y), aa = T.fwidth(distance).max(0.0005);
  const joint = T.float(1).sub(distance.smoothstep(T.float(0.002).sub(aa), T.float(0.002).add(aa)));
  const shade = id.dot(T.vec2(127.1, 311.7)).sin().mul(43758.5453).fract();
  const dirt = p.x.mul(0.17).add(p.y.mul(0.11)).sin().mul(p.y.mul(0.23).sin()).mul(0.06).add(0.94);
  const grain = p.x.mul(35).sin().mul(p.y.mul(39).sin()).mul(0.008);
  mat.colorNode = T.mix(T.vec3(0.19, 0.185, 0.17).mul(shade.mul(0.16).add(0.92)).mul(dirt).add(grain), T.vec3(0.065, 0.058, 0.048), joint);
  // Shallow relief avoids a bright bevel outlining every stone.
  mat.normalNode = surfaceNormal(joint.oneMinus().mul(0.001).add(grain.mul(0.012)));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  scene.userData.quality = quality;
  return scene;
}

/** The plaza's people: { people, tick(t, dt, camera) -> counts (also sends whoever arrived on to another spot), bumps() }.
 *  `outfits` as makePeople's (omitted: the placeholder rule; false: nobody dressed). `n`: how many (300).
 *  `compile(group, people)`: called with the people's group (and the people, for `people.compile(renderer, scene, camera)`, which compiles the draws concurrently and the skirt passes too) once their draws are made and before the 300 are built, to start compiling their pipelines in the renderer (it adds the group to its scene and
 *  awaits `renderer.compileAsync(scene, camera)`); the pipelines compile while the people are built, and `ready` settles when they have: await it before the first tick and render. */
export function makePlaza(THREE, { basis, outfits, n = 300, compile, bakeBudgetMs, quality } = {}) {
  const people = makePeople(THREE, { basis, quality, thresholds: PLAZA_THRESHOLDS, ...(outfits !== undefined ? { outfits } : {}), ...(bakeBudgetMs !== undefined ? { bakeBudgetMs } : {}) });
  const ready = compile ? (people.warm(), Promise.resolve(compile(people.group, people))) : Promise.resolve();
  const trips = new Map();
  let bumps = 0;
  const elsewhere = (id) => { const k = (trips.get(id) ?? 0) + 1; trips.set(id, k); return [(uniform(1, id, "x" + k) - 0.5) * 30, 0, (uniform(1, id, "z" + k) - 0.5) * 30]; };
  for (let i = 0; i < n; i++) {
    const id = "w" + i;
    people.add({ id, recipe: PLAZA_MIXED[i % PLAZA_MIXED.length], at: { pos: [(uniform(2, id, "x") - 0.5) * 30, 0, (uniform(2, id, "z") - 0.5) * 30], room: "hall" } }).goTo({ pos: elsewhere(id) });
  }
  return {
    people, ready,
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
