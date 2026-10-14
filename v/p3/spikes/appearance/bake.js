// Spike "appearance" (R5/R9): the near person's skin, baked. The procedural paint (skin.js: noise, brows, freckles, lips,
// beard, scalp) is a pure function of the rest frame and the person's row in the parameter texture, so it never changes
// while she moves; on a phone, drawing it per pixel is most of her cost (R9 third and fourth phone runs: ~12 ms of her
// ~15, with the same skin as a plain material ~3). So the paint is drawn once into UV space, a texture per person, and
// the near tier reads that: the same lighting model, colour and roughness fetched instead of computed.
//
//   await bakeSkin(THREE, renderer, person, { size })   draws the paint into the person's texture; call again after the
//                                                        person's values change (the parameter row, hair, beard...);
//                                                        sets person.userData.skinBake and switches the near tier to it
//   disposeBake(person)                                   frees the texture (call when the person leaves)
//   bakedSkinMaterial(THREE, texture)                     the near material over a baked texture
//
// The texture is RGBA8: colour sRGB-encoded in rgb (8 bits are too few for linear dark skin), roughness in alpha.
// Pass 1 draws the body's triangles in UV space (positions = the uv, rest frame as the `rest` attribute, so skin.js's
// own nodes run unchanged). Pass 2 dilates every island outwards by PAD texels, taking the nearest covered texel, so
// bilinear and mip lookups at a seam read the paint, not the empty background. Pass 2 writes the final texture, which
// has its mip chain generated. Cost: SIZE^2 x 4 B x 4/3 per near person (22.4 MB at 2048), one 16 MB transient.
import { skinNodes, skinClass } from "./skin.js";
import { REST_DRAWN, UVN } from "./rest.js";
import { UV, UV_INDEX } from "../makehuman/index.js";

export const SIZE = 2048;      // the face's texel is 0.47 mm at 2048 (1024: 0.95 mm, as coarse as the brow strokes themselves)
export const PAD = 4;          // texels of dilation around every island

const kits = new WeakMap();
const OPTS = (THREE) => ({ depthBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace });
function kit(THREE) {
  if (kits.has(THREE)) return kits.get(THREE);
  const T = THREE.TSL;
  const { vec4, positionLocal, sRGBTransferOETF, clamp } = T;
  // the body mesh in UV space: position = (u, v, 0), the rest attribute as drawn, the drawn index
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(UVN * 3);
  for (let i = 0; i < UVN; i++) { pos[3 * i] = UV[2 * i]; pos[3 * i + 1] = UV[2 * i + 1]; }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("rest", new THREE.BufferAttribute(REST_DRAWN, 3));
  geo.setIndex(new THREE.BufferAttribute(UV_INDEX, 1));
  const nodes = skinNodes(THREE, "near");
  const paint = new THREE.NodeMaterial();
  paint.vertexNode = vec4(positionLocal.x.mul(2).sub(1), positionLocal.y.mul(2).sub(1), 0, 1);
  paint.fragmentNode = vec4(sRGBTransferOETF(clamp(nodes.color.rgb, 0, 1)), nodes.roughness);
  Object.assign(paint, { side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, name: "skin-bake" });
  const mesh = new THREE.Mesh(geo, paint); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const k = { mesh, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), scratch: new Map() };
  kits.set(THREE, k);
  return k;
}

// per size: the transient target pass 1 draws into, and the dilation pass (a screen-filling quad) reading it
function scratch(THREE, k, size) {
  if (k.scratch.has(size)) return k.scratch.get(size);
  const { Fn, If, vec2, vec4, texture, uv, positionLocal } = THREE.TSL;
  const a = new THREE.RenderTarget(size, size, { ...OPTS(THREE), generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.NodeMaterial()); quad.frustumCulled = false;
  const offs = [];
  for (let dy = -PAD; dy <= PAD; dy++) for (let dx = -PAD; dx <= PAD; dx++) {
    const d = dx * dx + dy * dy;
    if (d > 0 && d <= PAD * PAD + 1) offs.push([dx, dy, d]);
  }
  offs.sort((p, q) => q[2] - p[2]);                                // farthest first, so the nearest covered texel is applied last
  const at = (dx, dy) => texture(a.texture, uv().add(vec2(dx / size, dy / size)));
  const m = quad.material;
  m.vertexNode = vec4(positionLocal.x, positionLocal.y, 0, 1);
  m.fragmentNode = Fn(() => {
    const c = at(0, 0).toVar();
    const out = vec4(c).toVar();
    If(c.a.lessThan(0.1), () => {
      for (const [dx, dy] of offs) { const n = at(dx, dy); out.assign(n.a.greaterThan(0.1).select(n, out)); }
    });
    return out;
  })();
  Object.assign(m, { depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, name: "skin-dilate" });
  const scene = new THREE.Scene(); scene.add(quad);
  const sc = { a, scene };
  k.scratch.set(size, sc);
  return sc;
}
// frees the 16 MB transient (at 2048) that baking keeps between people; the next bake makes it again
export function releaseBakeScratch(THREE) {
  const k = kits.get(THREE); if (!k) return;
  for (const { a, scene } of k.scratch.values()) { a.dispose(); scene.children[0].material.dispose(); }
  k.scratch.clear();
}

// opts.sync (optional): an async function that waits for the GPU; with it, bake.passMs = [paint, dilate+mips] are timed
export async function bakeSkin(THREE, renderer, person, { size = SIZE, sync = null } = {}) {
  const t0 = performance.now(), k = kit(THREE), body = person.children[0];
  const row = person.userData.row;
  if (row == null) throw new Error("bake: the person has no parameter row");
  k.mesh.userData.row = row;                                       // the nodes read the person's values through the drawn object
  const old = person.userData.skinBake, sc = scratch(THREE, k, size), passMs = [0, 0];
  const b = old?.size === size ? old.target
    : new THREE.RenderTarget(size, size, { ...OPTS(THREE), generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  b.texture.anisotropy = 4;
  const was = { rt: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), auto: renderer.autoClear };
  try {
    renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(sc.a); await renderer.renderAsync(k.scene, k.camera);
    if (sync) { await sync(); passMs[0] = performance.now() - t0; }
    renderer.setRenderTarget(b); await renderer.renderAsync(sc.scene, k.camera);
    if (sync) { await sync(); passMs[1] = performance.now() - t0 - passMs[0]; }
  } finally {
    renderer.setRenderTarget(was.rt); renderer.setClearColor(was.color, was.alpha); renderer.autoClear = was.auto;
  }
  const bake = old?.size === size ? old : { target: b, size, material: bakedSkinMaterial(THREE, b.texture) };
  Object.assign(bake, { bytes: Math.round(size * size * 4 * 4 / 3), ms: performance.now() - t0, passMs });
  if (old && old !== bake) disposeBake(person);
  person.userData.skinBake = bake;
  if ((person.userData.tier ?? "near") === "near") body.material = bake.material;
  return bake;
}

export function disposeBake(person) {
  const b = person.userData.skinBake; if (!b) return;
  b.target.dispose(); b.material.dispose(); delete person.userData.skinBake;
}

// the near material over a baked texture: skin.js's lighting model, colour and roughness read from the texture
export function bakedSkinMaterial(THREE, tex) {
  const { texture, uv, sRGBTransferEOTF } = THREE.TSL;
  const s = texture(tex, uv()).toVar();
  const m = new (skinClass(THREE))({ roughness: 0.55, metalness: 0 });
  m.colorNode = sRGBTransferEOTF(s.rgb);
  m.roughnessNode = s.a;
  m.name = "skin-near-baked";
  return m;
}
