// Crowd adaptation of spikes/mhhair/material2.js: the same v2 pigment, strand highlights,
// hairline and transmission, with an opaque core and MSAA rim. Mid builds one highlight lobe.
export const CORE_CUT = 0.62;
const GREY = [0.62, 0.6, 0.56];

export function crowdHairMaterial(THREE, atlas, colourNode, mid = false) {
  const o = {};
  const T = THREE.TSL;
  const P = { toneK: 0.8, detailK: 0.3, rootDark: 0.45, tipLight: 0.1, spec1: 0.08, spec2: 0.10, exp1: 300, exp2: 24, shift1: 0.05, shift2: -0.10, clumpShift: 0.3,
    albedo: 0.55, wrap: 0.45, trans: 0.5, hairline: 0.3, limb: 0.5, rough: 0.5, ...o };
  const U = {};
  for (const k of Object.keys(P)) if (typeof P[k] === "number") U[k] = T.uniform(P[k]).onObjectUpdate(function ({ object }) { this.value = object.userData.hairShading?.[k] ?? P[k]; });
  const tip = colourNode, grey = T.float(0);
  const rt = T.attribute("rt", "float"), hl = T.attribute("hl", "float"), sp = T.attribute("sp", "vec3");
  const stray = sp.x.greaterThan(0.5);
  const tex = T.texture(atlas);                                   // one fetch, shared by every use below

  const { normalView, positionViewDirection: V, dot, normalize, pow, sqrt, max, smoothstep, mix, select, abs } = T;
  const Ts = T.tangentView;                                       // the strand direction, root to tip, supplied per vertex (index.js)

  // coverage: the atlas's, faded at the hairline; the strays have none (they are not part of the opaque core)
  // the limb breaks up: where the surface turns edge-on, the coverage is eroded by the strand detail, so the silhouette is ragged, not a smooth curve
  const ndvL = abs(dot(normalView, V));
  const cov = tex.r.mul(smoothstep(0, U.hairline, hl)).mul(smoothstep(0.0, 0.16, ndvL.add(tex.g.sub(0.5).mul(U.limb).add(tex.b.sub(0.5).mul(0.3))).add(smoothstep(0.2, 0.03, rt).mul(0.4))));   // not at the roots: the crown is seen at a grazing angle and must stay covered
  const coreOpacity = select(stray, T.float(0), cov);
  const rimOpacity = select(stray,
    sp.y.mul(2).sub(1).abs().oneMinus().pow(0.8).mul(sp.z.pow(2).oneMinus().clamp(0, 1)).mul(0.65),   // a thin bell across, thinning to the tip
    select(cov.lessThan(CORE_CUT), smoothstep(0.03, CORE_CUT, cov), T.float(0)));

  const pigment = () => T.mix(tip, T.vec3(...GREY), T.clamp(grey.mul(tex.b.mul(0.8).add(0.6)), 0, 1));
  const colour = () => {
    const tone = tex.g.mul(2), det = tex.b.sub(0.5).mul(2);
    const root = mix(U.rootDark, T.float(1), smoothstep(0, 0.55, rt));
    const tipK = U.tipLight.mul(smoothstep(0.55, 1, rt)).add(1);
    const body = pigment().mul(U.albedo).mul(mix(T.float(1), tone, U.toneK)).mul(det.mul(U.detailK).add(1)).mul(root).mul(tipK);
    return T.vec4(select(stray, T.vec3(0), body), 1);
  };

  class HairLighting extends THREE.PhysicalLightingModel {
    constructor() { super(false, false, false, false, false, false); }
    direct(input /* , builder */) {
      const { lightDirection: Lv, lightColor, reflectedLight } = input;
      const N = normalView, Hh = normalize(Lv.add(V));
      const nl = dot(N, Lv), shadeK = smoothstep(0, 0.3, rt).mul(0.35).add(0.65);          // a little self-shadow toward the roots
      const lit = lightColor.mul(shadeK);
      // diffuse, wrapped
      const wrapL = select(stray, T.float(0.75), nl.add(U.wrap).div(U.wrap.add(1)).clamp());   // a flyaway has no real normal: lit evenly
      reflectedLight.directDiffuse.addAssign(lit.mul(wrapL).mul(T.diffuseColor.rgb).mul(1 / Math.PI));
      // dual-lobe Kajiya-Kay: strand tangent shifted along the normal; the clump decides a further shift (the tone of the atlas, which carries per-lock brightness)
      const cs = tex.g.sub(0.5).mul(U.clumpShift);
      const kk = (shift, power) => {
        const t = normalize(Ts.add(N.mul(shift.add(cs)))), th = dot(t, Hh);
        return pow(sqrt(max(th.mul(th).oneMinus(), 0)), power);   // symmetric in the tangent's sign, so a panel whose flow is written the other way round shows no seam
      };
      const ndv = abs(dot(N, V));
      const inner = select(T.faceDirection.greaterThan(0), T.float(1), T.float(0.12));            // the inside of a panel (seen past a limb) sits in the hair's own shade: no highlight
      // where the normal changes faster than a pixel can show (thin overlapping panels at a limb) a highlight is a glint, not a sheen: fade it
      const steady = T.fwidth(N).length().smoothstep(0.35, 0.08);
      const gate = smoothstep(-0.1, 0.35, nl).mul(select(stray, T.float(0), inner)).mul(steady).mul(smoothstep(0.03, 0.25, rt));   // and none at the very roots (the crown, where panels overlap)
      const tint = tip.sqrt();
      // the light's colour, mostly neutralised for the highlight (a cool fill light would otherwise tint the strands blue); the hair colour tints it instead
      const Ll = dot(lit, T.vec3(0.3, 0.59, 0.11)), litS = mix(T.vec3(Ll), lit, 0.25);
      const s1 = kk(U.shift1, U.exp1).mul(U.spec1).mul(smoothstep(0.25, 0.75, ndv)).mul(mix(tint, T.vec3(1), 0.2));      // narrow, near the hair's own colour, kept off grazing angles (the pinch at the crown)
      const s2 = kk(U.shift2, U.exp2).mul(U.spec2).mul(smoothstep(0.2, 0.6, ndv)).mul(mix(tint, T.vec3(1), 0.1).mul(1.4));       // the broad band, tinted
      reflectedLight.directSpecular.addAssign(litS.mul(gate).mul((mid ? s1 : s1.add(s2))));
      // back light: transmission through thin and grazing parts
      const thin = abs(dot(N, V)).oneMinus().pow(6).add(tex.r.oneMinus().mul(0.9)).clamp(0, 1);
      const back = pow(max(dot(V, Lv.negate()), 0), 5).mul(thin).mul(smoothstep(0.05, 0.4, rt).mul(0.6).add(0.4));
      reflectedLight.directDiffuse.addAssign(lightColor.mul(back).mul(tint.mul(1.6).add(0.05)).mul(U.trans));   // light through the thin edges, in the hair's colour (lifted a little so black hair still glows)
    }
  }
  const mkMat = (name, opacity) => {
    const m = new THREE.MeshPhysicalNodeMaterial();
    m.name = `mhhair2-${name}`; m.color.set("#ffffff"); m.roughness = P.rough; m.metalness = 0; m.specularIntensity = 0.15;
    m.side = THREE.DoubleSide; m.colorNode = colour(); m.opacityNode = opacity;
    m.setupLightingModel = () => new HairLighting();
    m.emissiveNode = select(stray, pigment().mul(U.albedo).mul(1.5).mul(smoothstep(0.55, 1, rt).mul(U.tipLight).add(1)), T.vec3(0));   // a flyaway is lit by its own colour (it has no real normal to light)
    m.polygonOffset = true; m.polygonOffsetFactor = 0; m.polygonOffsetUnits = -2;
    return m;
  };
  const core = mkMat(mid ? "crowd-mid-core" : "crowd-near-core", coreOpacity);
  const rim = mkMat(mid ? "crowd-mid-rim" : "crowd-near-rim", rimOpacity);
  core.alphaTest = CORE_CUT; core.alphaToCoverage = false;
  rim.alphaTest = 0; rim.alphaToCoverage = true;
  for (const m of [core, rim]) { m.transparent = false; m.depthWrite = true; }
  return { core, rim };
}
