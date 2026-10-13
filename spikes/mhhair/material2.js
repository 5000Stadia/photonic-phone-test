// Spike "mhhair", version 2 (R5, hair toward the Baldur's Gate 3 / Hogwarts Legacy bar): the material for MakeHuman's painted hair shells, packed by
// tools/mh/hair-pack2.py (atlas R coverage with lock-shaped tips, G tone x clump brightness x gaps, B fine strand detail; per vertex rt and hl).
// Our own shading (v1 leaned on the vendored hair-shader's cards-oriented materials; this does not use them), two passes over one geometry, every pixel shaded once:
//   core  opaque, alpha test on the coverage >= CORE_CUT. Writes depth, so a tile GPU rejects what is behind it.
//   rim   alpha-to-coverage where the coverage is below CORE_CUT (it ramps 0 -> 1 up to the cut): the soft edge, the lock tips, the hairline fade and the strays
//         are the only feedback fragments.
// Look:
//   colour       hair colour x painted tone (clump brightness and the gaps between locks) x a little strand detail; root to tip: darker at the scalp side
//                (rt), a warmer lighter tip; greying by the grey fraction
//   diffuse      wrapped (hair scatters light past the terminator), so a lock does not go black on its shaded side
//   highlight    dual-lobe Kajiya-Kay (Scheuermann's form) along the strand tangent: a narrow near-white primary shifted one way along the strand, a broad lobe tinted
//                by the hair shifted the other way, both shifted again per clump (the atlas's tone) so the highlight breaks into locks. Kept off grazing angles.
//   back light   cheap transmission: light behind the head glows through the thin edges (low coverage, grazing), tinted by the hair
//   hairline     the coverage is faded by hl (distance from the open edge at the scalp's front), so the shell dissolves onto the forehead and temples instead of ending on a line
//   strays       a few flyaway ribbons (sp attribute: flag, across, along) drawn in the rim pass with their own alpha
// Renderer: MSAA (alpha-to-coverage needs it); tone mapping in the materials (see lab/hairstyles/hairstyles.js).

export const CORE_CUT = 0.62;
const GREY = [0.62, 0.6, 0.56];

export function hairMaterials2(THREE, renderer, atlas, o = {}) {
  const T = THREE.TSL;
  const P = { toneK: 0.8, detailK: 0.3, rootDark: 0.45, tipLight: 0.1, spec1: 0.10, spec2: 0.07, exp1: 200, exp2: 60, shift1: 0.06, shift2: -0.12, clumpShift: 0.12,
    wrap: 0.45, trans: 0.7, hairline: 0.3, limb: 0.9, rough: 0.5, ...o };
  const U = {};
  for (const k of Object.keys(P)) if (typeof P[k] === "number") U[k] = T.uniform(P[k]);
  const tip = T.uniform(new THREE.Color("#5a3d26")), grey = T.uniform(0);
  const rt = T.attribute("rt", "float"), hl = T.attribute("hl", "float"), sp = T.attribute("sp", "vec3");
  const stray = sp.x.greaterThan(0.5);
  const tex = T.texture(atlas);                                   // one fetch, shared by every use below

  const { normalView, positionViewDirection: V, dot, normalize, pow, sqrt, max, smoothstep, mix, select, abs } = T;
  const Ts = T.tangentView;                                       // the strand direction, root to tip, supplied per vertex (index.js)

  // coverage: the atlas's, faded at the hairline; the strays have none (they are not part of the opaque core)
  // the limb breaks up: where the surface turns edge-on, the coverage is eroded by the strand detail, so the silhouette is ragged, not a smooth curve
  const ndvL = abs(dot(normalView, V));
  const cov = tex.r.mul(smoothstep(0, U.hairline, hl)).mul(smoothstep(0.02, 0.3, ndvL.add(tex.b.sub(0.5).mul(U.limb))));
  const coreOpacity = select(stray, T.float(0), cov);
  const rimOpacity = select(stray,
    sp.y.mul(2).sub(1).abs().oneMinus().pow(0.8).mul(sp.z.pow(2).oneMinus().clamp(0, 1)).mul(0.65),   // a thin bell across, thinning to the tip
    select(cov.lessThan(CORE_CUT), smoothstep(0.03, CORE_CUT, cov), T.float(0)));

  const pigment = () => T.mix(tip, T.vec3(...GREY), T.clamp(grey.mul(tex.b.mul(0.8).add(0.6)), 0, 1));
  const colour = () => {
    const tone = tex.g.mul(2), det = tex.b.sub(0.5).mul(2);
    const root = mix(U.rootDark, T.float(1), smoothstep(0, 0.55, rt));
    const tipK = U.tipLight.mul(smoothstep(0.55, 1, rt)).add(1);
    const body = pigment().mul(mix(T.float(1), tone, U.toneK)).mul(det.mul(U.detailK).add(1)).mul(root).mul(tipK);
    const strayCol = pigment().mul(tipK).mul(0.9);
    return T.vec4(select(stray, strayCol, body), 1);
  };

  class HairLighting extends THREE.PhysicalLightingModel {
    constructor() { super(false, false, false, false, false, false); }
    direct(input /* , builder */) {
      const { lightDirection: Lv, lightColor, reflectedLight } = input;
      const N = normalView, Hh = normalize(Lv.add(V));
      const nl = dot(N, Lv), shadeK = smoothstep(0, 0.3, rt).mul(0.35).add(0.65);          // a little self-shadow toward the roots
      const lit = lightColor.mul(shadeK);
      // diffuse, wrapped
      const wrapL = nl.add(U.wrap).div(U.wrap.add(1)).clamp();
      reflectedLight.directDiffuse.addAssign(lit.mul(wrapL).mul(T.diffuseColor.rgb).mul(1 / Math.PI));
      // dual-lobe Kajiya-Kay: strand tangent shifted along the normal; the clump decides a further shift (the tone of the atlas, which carries per-lock brightness)
      const cs = tex.g.sub(0.5).mul(U.clumpShift);
      const kk = (shift, power) => {
        const t = normalize(Ts.add(N.mul(shift.add(cs)))), th = dot(t, Hh);
        return pow(sqrt(max(th.mul(th).oneMinus(), 0)), power).mul(smoothstep(-1, 0, th));
      };
      const graze = smoothstep(0.1, 0.55, abs(dot(N, V)));
      const lobeGate = smoothstep(-0.1, 0.35, nl).mul(graze).mul(select(stray, T.float(0), T.float(1)));
      const tint = tip.sqrt();
      const s1 = kk(U.shift1, U.exp1).mul(U.spec1);
      const s2 = kk(U.shift2, U.exp2).mul(U.spec2).mul(mix(T.vec3(1), tint, 0.85));
      reflectedLight.directSpecular.addAssign(lit.mul(lobeGate).mul(s1.mul(T.vec3(1)).add(s2)));
      // back light: transmission through thin and grazing parts
      const thin = abs(dot(N, V)).oneMinus().pow(2).mul(0.7).add(tex.r.oneMinus().mul(0.9)).clamp(0, 1);
      const back = pow(max(dot(V, Lv.negate()), 0), 5).mul(thin).mul(smoothstep(0.05, 0.4, rt).mul(0.6).add(0.4));
      reflectedLight.directDiffuse.addAssign(lightColor.mul(back).mul(tint).mul(pigment().mul(0.6).add(0.4)).mul(U.trans));
    }
  }
  const mkMat = (name, opacity) => {
    const m = new THREE.MeshPhysicalNodeMaterial();
    m.name = `mhhair2-${name}`; m.color.set("#ffffff"); m.roughness = P.rough; m.metalness = 0; m.specularIntensity = 0.15;
    m.side = THREE.DoubleSide; m.colorNode = colour(); m.opacityNode = opacity;
    m.setupLightingModel = () => new HairLighting();
    m.polygonOffset = true; m.polygonOffsetFactor = 0; m.polygonOffsetUnits = -2;
    return m;
  };
  const core = mkMat("core", coreOpacity), rim = mkMat("rim", rimOpacity);
  core.alphaTest = CORE_CUT; core.transparent = false; core.alphaToCoverage = false; core.depthWrite = true;
  rim.alphaTest = 0; rim.transparent = false; rim.alphaToCoverage = !!(renderer && (renderer.samples | 0) > 0) || true; rim.depthWrite = true;
  const tune = (t) => { for (const k of Object.keys(t)) if (U[k]) U[k].value = t[k]; };
  return { core, rim, tune, set(hex, g) { tip.value.set(hex); grey.value = g; } };
}
