// Spike "hair" (M1, R2): the hair's material, one set per tier for every head and beard. Built by the vendored MIT shader
// (vendor/hair-shader.js: the opaque alpha-to-coverage pass, the blended fringe under MSAA, coverage x density, seed
// roughness and the anisotropic GGX lobe along our tangent map), in its instanced mode, so each wearer's swatch rides
// per-instance attributes (gccRootA, gccRootB, gccTip) and one compiled program serves everyone, one person or a crowd.
// On top, and nowhere inside the vendored file:
//   colour   the vendored tone (root-to-tip from atlas G, seed brightness from B) over the melanin swatch (style.js),
//            plus greying strand by strand (a strand is unpigmented when its seed falls under the person's grey
//            fraction, hairLook.x) and the volume's baked shade (cards.js), and a card seen edge-on sits deeper
//   cover    the vendored coverage, thinned where a card turns edge-on (stacked cards don't show their edges as steps)
//            and lifted by the tier (far fewer cards and no fringe pass further off)
//   lobes    the tier's one dial (Kabe's brief: tiers differ only by card density and lobe count):
//              2  near: the vendored GGX lobe (white, its normal tilted per strand so the band breaks into strands)
//                 + a secondary lobe tinted by the hair's own colour, shifted toward the tip and broader (Kajiya-Kay
//                 1989 in Scheuermann's 2004 form, written here), and light through the hair from behind (forward
//                 scattering), the transmission that rims backlit hair
//              1  mid: the vendored GGX lobe alone (three's built-in anisotropy)      "kk1": one Kajiya-Kay lobe instead
//              0  far: wrapped diffuse only
//            and a self-shadow for every lobe: direct light dims with the baked shade
//   motion   the force bend (motion.js), the position node of every pass
//   hairMaterials(THREE, renderer, tier, { lobes, crowd }) -> { outer, blend|null, key }      (made once per key)
import { createHairMaterials } from "./vendor/hair-shader.js";
import { atlasTextures } from "./atlas.js";
import { bend } from "./motion.js";

export const LOBES = { near: 2, mid: 1, far: 0 };
const GREY = [0.62, 0.6, 0.56];          // an unpigmented strand, linear (a little yellow, as white hair is)

function lighting(THREE, lobes, atlas, tangentMap) {
  const T = THREE.TSL;
  const { normalView, tangentView, bitangentView, positionViewDirection, diffuseColor, normalize, dot, sqrt, max, pow, smoothstep, texture, attribute } = T;
  const aniso = lobes === 2 || lobes === 1;
  // per fragment, once (not per light): the strand's direction (the card's bitangent, root to tip, turned by the atlas's
  // direction map), its seed, the lobes' shifted tangents, the tint, and the volume's shade
  const hv = attribute("hair", "vec4"), shade = hv.y, V = positionViewDirection, N = normalView;
  const frag = {};
  const once = () => {
    if (frag.Ts) return frag;
    const dm = texture(tangentMap).rg.mul(2).sub(1);
    frag.Ts = normalize(tangentView.mul(dm.x).add(bitangentView.mul(dm.y))).toVar("hairStrand");
    frag.seed = texture(atlas).b.toVar("hairSeed");
    frag.t1 = normalize(frag.Ts.add(N.mul(frag.seed.sub(0.5).mul(0.3).sub(0.1)))).toVar("hairT1");          // one KK lobe (kk1)
    frag.t2 = normalize(frag.Ts.add(N.mul(frag.seed.sub(0.5).mul(0.2).add(0.2)))).toVar("hairT2");          // TRT: toward the tip
    frag.tint = diffuseColor.rgb.sqrt().toVar("hairTint");
    frag.sheen = attribute("hairLook", "vec4").y;
    frag.rim = smoothstep(0.55, 0.05, dot(N, V).abs()).mul(smoothstep(0.3, 1, hv.x)).mul(shade).toVar("hairRim");
    return frag;
  };
  // a Kajiya-Kay lobe on a (shifted) tangent t: sin(t, h)^p, faded where h runs back along the strand (Scheuermann 2004)
  const kk = (t, Hh, power) => { const th = dot(t, Hh); return pow(sqrt(max(th.mul(th).oneMinus(), 0)), power).mul(smoothstep(-1, 0, th)); };
  return class HairLighting extends THREE.PhysicalLightingModel {
    constructor() { super(false, false, false, aniso, false, false); }
    direct(input, builder) {
      const { lightDirection: Lv, lightColor, reflectedLight } = input;
      const lit = lightColor.mul(shade.mul(0.75).add(0.25));                  // self-shadow inside the volume
      if (lobes === 0) {
        const wrap = dot(N, Lv).add(0.4).div(1.4).clamp();
        reflectedLight.directDiffuse.addAssign(lit.mul(wrap).mul(diffuseColor.rgb).mul(1 / Math.PI));
        return;
      }
      const f = once(), Hh = normalize(Lv.add(V)), wrapL = dot(N, Lv).add(0.5).div(1.5).clamp();
      if (lobes === "kk1") {
        reflectedLight.directDiffuse.addAssign(lit.mul(wrapL).mul(diffuseColor.rgb).mul(1 / Math.PI));
        reflectedLight.directSpecular.addAssign(lit.mul(kk(f.t1, Hh, 60)).mul(wrapL).mul(0.11));
        return;
      }
      super.direct({ ...input, lightColor: lit }, builder);
      if (lobes === 2) {
        // TRT: tinted by the hair (its colour twice through the fibre), shifted toward the tip, broader, per-strand shift
        reflectedLight.directSpecular.addAssign(lit.mul(kk(f.t2, Hh, 48)).mul(wrapL).mul(f.tint).mul(f.sheen.mul(0.4)));
        // TT: light from behind passes through thin hair toward the eye (forward scattering): at the volume's edge and
        // toward the tips only, where the hair is a few strands thick (the bulk of the volume lets little through)
        reflectedLight.directDiffuse.addAssign(lightColor.mul(pow(max(dot(V, Lv.negate()), 0), 8)).mul(f.rim).mul(f.tint).mul(0.7));
      }
    }
  };
}

const made = new Map();
export function hairMaterials(THREE, renderer, tier = "near", { lobes = LOBES[tier], crowd = false } = {}) {
  const key = `${tier}/${lobes}/${crowd ? "crowd" : "one"}`;
  if (made.has(key)) return made.get(key);
  const T = THREE.TSL, { atlas, tangent } = atlasTextures(THREE);
  const { outer, blend } = createHairMaterials(THREE, null, {
    renderer, atlas, tangent: lobes === 0 || lobes === "kk1" ? null : tangent, instanced: true, color: "#ffffff",
    mode: tier === "near" ? "both" : "a2c", anisotropy: 0.85, anisotropyRotation: Math.PI / 2, roughness: 0.3,
    seedVariation: 0.4, roughnessSeedAmp: 0.08, materialName: `hair-${key}`,
  });
  const { attribute, varying, texture, vec3, vec4, mix, smoothstep, float, fract, abs, dot, normalize, cross, positionView, positionViewDirection, normalView, uv } = T;
  const tex = texture(atlas), rootT = tex.g, seed = tex.b;
  const tip = varying(attribute("gccTip", "vec3")), rB = varying(attribute("gccRootB", "vec4")), look = varying(attribute("hairLook", "vec4"));
  const hv = attribute("hair", "vec4");
  // greying: a strand is unpigmented when its seed (mixed with the card's, so an atlas strand isn't grey on every card)
  // falls under the grey fraction; where strands are finer than a pixel, the average instead (no salt-and-pepper noise)
  const perStrand = fract(seed.mul(13.37).add(hv.w.mul(7.31))).lessThan(look.x).select(float(1), float(0));
  const texels = T.length(T.fwidth(uv().mul(1024)));
  const grey = mix(look.x, perStrand, smoothstep(2.5, 1.0, texels));
  const pig = mix(tip, vec3(...GREY), grey), tone = mix(rB.y, float(1), rootT);
  // a card seen edge-on lies deeper in the volume: its own facing (from the screen derivatives, not its rounded normal)
  const face = normalize(cross(positionView.dFdx(), positionView.dFdy())), facing = abs(dot(face, positionViewDirection));
  const deep = mix(float(0.8), float(1), smoothstep(0.05, 0.5, facing)), occ = hv.y.mul(0.65).add(0.35);
  outer.colorNode = vec4(pig.mul(tone).mul(seed.sub(0.5).mul(0.8).add(1)).mul(deep).mul(occ), 1);
  // a card turning edge-on thins out (to 45%), so stacked cards don't show their edges as steps; the silhouette keeps some
  const graze = mix(float(0.45), float(1), smoothstep(0.08, 0.4, facing));
  // fewer cards and no fringe pass further off: the tier lifts coverage (a constant per tier's material)
  outer.opacityNode = outer.opacityNode.mul(graze).mul({ near: 1, mid: 1.35, far: 1.8 }[tier]);
  outer.positionNode = bend(THREE, crowd);
  outer.ior = 1.8;
  const HL = lighting(THREE, lobes, atlas, tangent);
  outer.setupLightingModel = () => new HL();
  if (lobes === 2) {   // the per-strand shift of the vendored GGX lobe: tilt the normal along the strand, by the strand
    const shift = seed.sub(0.5).mul(0.12).sub(0.05);
    outer.normalNode = normalize(normalView.add(T.bitangentView.mul(shift)));
  }
  let fringe = null;
  if (tier === "near" && blend) {
    blend.colorNode = vec4(pig.mul(tone).mul(occ), 1);
    blend.opacityNode = blend.opacityNode.mul(graze);
    blend.positionNode = bend(THREE, crowd);
    const BL = lighting(THREE, 1, atlas, tangent); blend.setupLightingModel = () => new BL();
    fringe = blend;
  }
  for (const m of [outer, fringe]) if (m) { m.name = `hair-${key}-${m === outer ? "outer" : "fringe"}`; m.needsUpdate = true; }
  const out = { outer, blend: fringe, key };
  made.set(key, out);
  return out;
}
