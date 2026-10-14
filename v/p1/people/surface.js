import * as T from 'three/tsl';

// Derivative bump for procedural heights (no texture, tangent or UV attribute).
export function surfaceNormal(height) {
  const n = T.normalView, px = T.positionView.dFdx(), py = T.positionView.dFdy();
  const a = py.cross(n), b = n.cross(px), det = px.dot(a).mul(T.faceDirection);
  const grad = a.mul(height.dFdx()).add(b.mul(height.dFdy())).mul(det.sign());
  return n.mul(det.abs().max(1e-10)).sub(grad).normalize();
}

export function applySurface(THREE, m, { tier, quality, point, kind, fabric }) {
  const k = T.varying(kind), p = point;
  const skin = k.lessThan(0.5), cloth = k.greaterThan(0.5).and(k.lessThan(1.5)).or(k.greaterThan(2.5));
  const f = fabric.floor(), wear = fabric.fract().mul(10);
  const silk = f.equal(3), wool = f.equal(1).or(f.equal(2));
  const wave = p.x.mul(23).add(p.y.mul(9)).sin().mul(p.z.mul(19).sub(p.y.mul(13)).sin());
  const hem = T.select(k.equal(3), T.float(1).sub(p.y.smoothstep(0.53, 0.61)), T.float(1).sub(p.y.smoothstep(0.06, 0.28)));
  const dye = wave.mul(0.035).add(1).mul(hem.mul(wear).mul(-0.18).add(1));
  // Far retains its original skin and normal; cloth gets only broad colour variation.
  m.colorNode = m.colorNode.mul(T.select(cloth, dye, T.float(1)));
  if (tier === 'far') return;
  const down = T.normalWorld.y.negate().clamp();
  const cavity = down.mul(0.14).add(p.x.abs().smoothstep(0.1, 0.22).mul(T.float(1).sub(p.x.abs().smoothstep(0.24, 0.35))).mul(p.y.smoothstep(0.55, 0.65)).mul(T.float(1).sub(p.y.smoothstep(0.73, 0.8))).mul(0.09));
  m.aoNode = T.select(cloth, cavity.oneMinus(), T.float(1));
  // mix evaluates the normal-dependent cavity outside control flow. select puts
  // normalView's first initialization inside the cloth branch; TSL then reuses
  // that cached variable for skin/eyes, where it was never initialized.
  m.colorNode = m.colorNode.mul(T.mix(T.float(1), cavity.mul(0.4).oneMinus(), cloth));
  m.roughnessNode = T.select(cloth, T.select(silk, T.float(0.32), T.select(wool, T.float(0.94), T.float(0.84))), T.float(0.75));
  const freq = T.select(wool, T.float(700), T.float(1200));
  const uv = T.vec2(p.x.add(p.z.mul(0.7)), p.y).mul(freq);
  // Fade before the weave becomes subpixel, avoiding moire on phone and mid people.
  const visible = T.float(1).sub(T.fwidth(uv).length().smoothstep(0.6, 2.5));
  const weave = uv.x.sin().mul(uv.y.sin()).mul(T.select(silk, T.float(0.000015), T.float(0.00007))).mul(visible);
  m.normalNode = surfaceNormal(T.select(cloth, weave, T.float(0)));
  const detailedSkin = tier === 'near' || quality === 'pc';
  const face = p.y.smoothstep(0.82, 0.9), front = p.z.smoothstep(0, 0.045);
  const cheek = p.x.abs().smoothstep(0.018, 0.035).mul(T.float(1).sub(p.x.abs().smoothstep(0.055, 0.075))).mul(face).mul(front);
  const knuckle = p.y.smoothstep(0.35, 0.43).mul(T.float(1).sub(p.y.smoothstep(0.5, 0.55))).mul(p.x.abs().smoothstep(0.17, 0.23));
  const forehead = p.y.smoothstep(0.94, 0.96).mul(T.float(1).sub(p.y.smoothstep(0.98, 1)));
  const nose = T.float(1).sub(p.x.abs().smoothstep(0.012, 0.026)).mul(p.y.smoothstep(0.88, 0.9)).mul(T.float(1).sub(p.y.smoothstep(0.94, 0.96)));
  if (detailedSkin) m.roughnessNode = T.select(skin, forehead.max(nose).mul(front).mul(-0.2).add(0.66), m.roughnessNode);
  // Keep skin albedo untouched. Warmth belongs to the light response, never emission.
  class SurfaceLighting extends THREE.PhysicalLightingModel {
    constructor() { super(false, false, false, false, false, false); }
    direct(input, builder) {
      super.direct(input, builder);
      const { lightDirection: l, lightColor, reflectedLight } = input;
      const nl = T.normalView.dot(l), rim = T.normalView.dot(T.positionViewDirection).abs().oneMinus().pow(4);
      const fibre = T.select(silk, T.float(0.12), T.select(wool, T.float(0.035), T.float(0.01)));
      reflectedLight.directSpecular.addAssign(lightColor.mul(T.select(cloth, rim.mul(nl.clamp()).mul(fibre), T.float(0))).mul(T.diffuseColor.rgb.sqrt()));
      if (detailedSkin) {
        const wrap = nl.add(0.2).div(1.2).clamp().sub(nl.clamp()).max(0);
        const warmth = T.vec3(1, 0.38, 0.22).mul(cheek.add(knuckle).mul(0.3).add(0.7));
        reflectedLight.directDiffuse.addAssign(lightColor.mul(T.diffuseColor.rgb).mul(warmth).mul(T.select(skin, wrap.mul(0.2 / Math.PI), T.float(0))));
      }
    }
  }
  m.setupLightingModel = () => new SurfaceLighting();
}
