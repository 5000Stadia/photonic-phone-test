// Spike "mhhair" (R5, the hairstyle lineup): the material for MakeHuman's painted hair shells. Built on the vendored MIT hair shader
// (spikes/hair/vendor/hair-shader.js), fed each style's atlas (tools/mh/hair-pack.py: R coverage, G painted tone, B strand detail),
// as two passes over one geometry, so every pixel is shaded once:
//   core  the vendored opaque core: alpha test on the RAW coverage (>= CORE_CUT). Opaque, writes depth, so a tile GPU can reject what is behind it.
//   rim   the vendored alpha-to-coverage pass, only where coverage is below CORE_CUT (it fades 0 -> 1 up to the cut, where the core takes over),
//         so the soft edge, the strays and the tips are the only feedback fragments.
// Under both, over the vendored colour (replaced here, as spikes/hair/shade.js does):
//   colour    the person's hair colour x the atlas's painted tone (partly: the baked shine is softened) x strand detail x a root darkening
//             along the shell's root-to-tip (a per-vertex distance from the scalp), greying by the grey fraction
//   highlight the vendored anisotropic GGX lobe along the strand (the tangent attribute: the UV's V direction, root to tip; the atlas's strands run along V) plus a second
//             lobe tinted by the hair, shifted toward the tip and broader (Kajiya-Kay in Scheuermann's form), and a back-lit rim
// Renderer: MSAA (alpha-to-coverage needs it), tone mapping in the materials (see lab/hairstyles/hairstyles.js).
import { createHairMaterials } from "../hair/vendor/hair-shader.js";

export const CORE_CUT = 0.62;
const GREY = [0.62, 0.6, 0.56];

export function hairMaterials(THREE, renderer, atlas, { strand = "v", toneK = 0.7, detailK = 0.4, rough = 0.5, aniso = 0.3, spec = 0.35, lobe2 = 0.2, debug = "" } = {}) {
  const T = THREE.TSL;
  const mk = (mode) => createHairMaterials(THREE, null, { renderer, atlas, mode, color: "#ffffff", roughness: rough, roughnessFloor: rough,
    innerThreshold: CORE_CUT, anisotropy: aniso, materialName: "mhhair" });
  const rim = mk("a2c").outer, core = mk("blend").inner;
  const lobe2U = T.uniform(lobe2), tip = T.uniform(new THREE.Color("#5a3d26")), grey = T.uniform(0), rootDark = T.uniform(0.5), toneU = T.uniform(toneK), detailU = T.uniform(detailK);
  const rt = T.attribute("rt", "float");

  const colour = () => {
    if (debug) { const t = T.texture(atlas); return T.vec4(debug === "rt" ? T.vec3(rt) : debug === "uv" ? T.vec3(T.uv(), 0) : T.vec3(t.r, t.g, t.b), 1); }
    const t = T.texture(atlas), tone = t.g.mul(2), det = t.b.sub(0.5).mul(2);
    const g = T.clamp(grey.mul(t.b.mul(0.8).add(0.6)), 0, 1);
    const pig = T.mix(tip, T.vec3(...GREY), g);
    const root = T.mix(rootDark, T.float(1), T.smoothstep(0, 0.45, rt));
    return T.vec4(pig.mul(T.mix(T.float(1), tone, toneU)).mul(det.mul(detailU).add(1)).mul(root), 1);
  };

  const { normalView, positionViewDirection: V, dot, normalize, pow, sqrt, max, smoothstep } = T;
  const Ts = T.tangentView;                                   // the strand direction, supplied per vertex (index.js)
  const kk = (t, Hh, power) => { const th = dot(t, Hh); return pow(sqrt(max(th.mul(th).oneMinus(), 0)), power).mul(smoothstep(-1, 0, th)); };
  class HairLighting extends THREE.PhysicalLightingModel {
    constructor() { super(false, false, false, true, false, false); }
    direct(input, builder) {
      const { lightDirection: Lv, lightColor, reflectedLight } = input;
      const N = normalView, shadeK = T.smoothstep(0, 0.3, rt).mul(0.4).add(0.6);        // a little self-shadow at the roots
      const lit = lightColor.mul(shadeK);
      // diffuse + the vendored anisotropic GGX lobe, into a scratch accumulator so the lobe can be tinted and kept off grazing angles
      // (a long strip seen edge-on, lit from behind, otherwise turns silver through Fresnel)
      const tmp = { directDiffuse: T.vec3(0).toVar(), directSpecular: T.vec3(0).toVar() };
      super.direct({ ...input, lightColor: lit, reflectedLight: tmp }, builder);
      const grazeK = smoothstep(0.12, 0.6, dot(N, V).abs());
      reflectedLight.directDiffuse.addAssign(tmp.directDiffuse);
      reflectedLight.directSpecular.addAssign(tmp.directSpecular.mul(grazeK).mul(T.mix(T.vec3(1), tip.sqrt(), 0.6)));
      const t = T.texture(atlas), seed = t.b, Hh = normalize(Lv.add(V)), wrapL = dot(N, Lv).add(0.5).div(1.5).clamp();
      const T2 = normalize(Ts.add(N.mul(seed.sub(0.5).mul(0.2).add(0.2))));              // shifted toward the tip, per strand
      const tint = tip.sqrt();
      reflectedLight.directSpecular.addAssign(lit.mul(kk(T2, Hh, 40)).mul(wrapL).mul(tint).mul(lobe2U));
      const rimK = smoothstep(0.55, 0.05, dot(N, V).abs()).mul(smoothstep(0.1, 0.8, rt));
      reflectedLight.directDiffuse.addAssign(lightColor.mul(pow(max(dot(V, Lv.negate()), 0), 8)).mul(rimK).mul(tint).mul(0.6));
    }
  }
  const cov = () => T.texture(atlas).r;
  rim.opacityNode = T.select(cov().lessThan(CORE_CUT), T.smoothstep(0.03, CORE_CUT, cov()), T.float(0));
  for (const [m, name] of [[rim, "rim"], [core, "core"]]) {
    m.colorNode = colour();
    m.anisotropy = aniso; m.specularIntensity = spec; m.anisotropyRotation = 0;
    m.setupLightingModel = () => new HairLighting();
    m.name = `mhhair-${name}`; m.needsUpdate = true;
  }
  // live dials (material properties and uniforms: no recompile)
  const tune = (o) => {
    for (const m of [core, rim]) {
      if (o.aniso != null) m.anisotropy = o.aniso;
      if (o.spec != null) m.specularIntensity = o.spec;
      if (o.rough != null) { m.roughness = o.rough; const u = m.userData.hairUniforms; if (u && u.uHairRoughFlr) u.uHairRoughFlr.value = o.rough; }
    }
    if (o.lobe2 != null) lobe2U.value = o.lobe2;
    if (o.toneK != null) toneU.value = o.toneK;
    if (o.detailK != null) detailU.value = o.detailK;
    if (o.rootDark != null) rootDark.value = o.rootDark;
  };
  return { core, rim, tune, set(hexTip, greyFrac) { tip.value.set(hexTip); grey.value = greyFrac; } };
}
