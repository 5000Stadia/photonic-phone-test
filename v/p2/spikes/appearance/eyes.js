// Spike "appearance" (M1, R2): eyes. One sphere per eye with a TSL material: a sclera warming to pink at the corners,
// an iris with radial fibres, a darker limbal ring and a lighter collarette, a pupil, and a wet surface (low roughness
// plus a small catchlight that keeps the eye alive when no light happens to reflect). Gaze is the sphere's +z.
// One material per tier for everyone (the iris colour comes from params.js); mid and far drop the fibre noise.
import { param, COLS } from "./params.js";
const IRIS_HALF = 0.5;     // radians from the gaze axis to the limbus (a real eye: about 0.5)
const PUPIL_HALF = 0.17;

const made = new Map();
export function eyeMaterial(THREE, tier = "near") {
  if (made.has(tier)) return made.get(tier);
  const T = THREE.TSL;
  const { uniform, vec3, float, normalize, positionLocal, acos, atan, smoothstep, mix, mx_noise_float, abs, sin,
    normalView, positionViewDirection, reflect, max, pow, dot } = T;
  const d = normalize(positionLocal);
  const th = acos(d.z.clamp(-1, 1));                    // angle from the gaze axis
  const ph = atan(d.y, d.x);
  const iris = param(THREE, COLS.iris).xyz;
  const seed = param(THREE, COLS.marks).w;

  const r = th.div(IRIS_HALF);                          // 0 centre .. 1 limbus
  const near = tier === "near";
  const fibres = near ? mx_noise_float(vec3(sin(ph).mul(9), T.cos(ph).mul(9), r.mul(3).add(seed))) : float(0);
  const fine = near ? mx_noise_float(vec3(sin(ph).mul(30), T.cos(ph).mul(30), r.mul(6).add(seed.mul(1.3)))) : float(0);
  let ic = vec3(iris).mul(fibres.mul(0.3).add(fine.mul(0.2)).add(1));
  ic = mix(ic, vec3(iris).mul(1.6).add(vec3(0.06, 0.05, 0.02)), smoothstep(0.42, 0.3, r).mul(smoothstep(0.2, 0.3, r)).mul(0.5)); // collarette
  ic = ic.mul(mix(float(1), float(0.35), smoothstep(0.75, 1.0, r)));                                                           // limbal ring
  const pupil = smoothstep(PUPIL_HALF + 0.015, PUPIL_HALF - 0.01, th);
  const sclera = mix(vec3(0.86, 0.83, 0.79), vec3(0.8, 0.6, 0.58), smoothstep(0.9, 1.5, abs(d.x)).mul(0.6).add(smoothstep(0.75, 1.4, th).mul(0.3)));
  const inIris = smoothstep(IRIS_HALF + 0.02, IRIS_HALF - 0.02, th);
  const col = mix(mix(sclera, ic, inIris), vec3(0.01), pupil);

  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0 });
  m.colorNode = col;
  // a catchlight: the view reflected about the eye's normal, near a fixed upper-left "window" direction in view space
  const rv = reflect(positionViewDirection.negate(), normalView);
  const glint = pow(max(dot(rv, normalize(vec3(-0.35, 0.45, 0.82))), 0), 400);
  m.emissiveNode = vec3(1, 0.98, 0.95).mul(glint.mul(1.6));
  m.name = `eye-${tier}`;
  made.set(tier, m);
  return m;
}

export function addEyes(THREE, group, tier = "near") {
  // replace the base spike's white/iris/pupil stack with one shaded sphere per eye, at the same centre and radius
  const balls = group.children.filter(o => o.isMesh && o.geometry.type === "SphereGeometry");
  const whites = balls.filter(o => o.material.name !== "eye" && o.geometry.parameters.widthSegments === 20);
  for (const o of balls) group.remove(o);
  const mat = eyeMaterial(THREE, tier);
  const geo = new THREE.SphereGeometry(1, 24, 16);
  for (const w of whites) {
    const e = new THREE.Mesh(geo, mat);
    e.position.copy(w.position); e.scale.setScalar(w.geometry.parameters.radius);
    e.name = "eye"; group.add(e);
  }
  return whites.length;
}
