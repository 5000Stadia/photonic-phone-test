// Folds and gathers on the working clothes (round 3 of the hero study, 2026-10-16; Kabe: "the clothes still look like colorful trashbags"). No cloth is
// simulated: the shells keep their shape, and the shading draws what makes cloth read as cloth on a ring grid (design/research/hero-motion.md, round 3):
//   - gathers where the cloth is drawn into a band: the breeches' waistband and knee band, the shirt's wrist, the doublet's sleeve set into its armhole;
//   - drape: the seat's fullness hanging in soft folds behind the thigh, the doublet's skirts hanging over the hips;
//   - compression folds where a joint bends: behind the knee and across the front of the hip, as the knee and the hip bend (seated, rising).
// A height field in metres, from each fragment's place on its garment (the ring along it and the direction round it, interpolated from the vertices) and the
// pose (the own leg's knee and hip bend, per vertex from the bones), read by surface.js as a bump: the same derivative bump as the weave, so no texture, tangent
// or UV is needed. `shade` is how deep in a crease the fragment is (0 on a crest, 1 in the crease), for a little occlusion there.
//   A (vec4): breeches  (ring 0 waist .. 15 knee band, cos and sin of the column's angle (0 the front), 100 + tube)
//             doublet   (share along the part 0 .. 1, cos, sin, the template part: 0 torso, 1-2 sleeves, 3 band, 5-8 shirt sleeves)
//             body      (0, 1, 0, -1)
//   B (vec2): the own leg's knee bend and hip bend, 0 straight to 1 at a right angle (breeches only)
export function foldNodes(T, A, B) {
  const k = A.x, c = A.y, s = A.z, part = A.w, th = T.atan(s, c);
  // a pleat round the garment: 1 on a fold's crest, 0 in the crease between two, the crests broad and the creases sharp (cloth gathered into a band)
  // (clamped at 0 before the power: GLSL's pow is undefined below 0, and a cosine can round to just under -1)
  const pleat = (n, phase = 0) => th.mul(n).add(phase).cos().mul(0.5).add(0.5).max(0).pow(0.6);
  const ridge = (x) => x.mul(2 * Math.PI).sin().mul(0.5).add(0.5).max(0).pow(0.6);          // a fold across the garment (a ridge along the ring direction), period 1
  const sm = (a, b, x) => T.smoothstep(a, b, x);
  const back = sm(0.15, 0.8, c.negate()), front = sm(0.15, 0.8, c);
  const knee = B.x, hip = B.y;
  // ---- the breeches (part >= 100): k is the ring
  const gWaist = T.float(1).sub(sm(1.0, 4.5, k)), gKneeBand = sm(10.5, 13.6, k).mul(T.float(1).sub(sm(13.7, 14.1, k)));
  const gSeat = sm(3.5, 6.0, k).mul(T.float(1).sub(sm(8.5, 12, k))).mul(back).mul(T.float(1).sub(hip.mul(0.8)));
  const gBehindKnee = knee.mul(back).mul(sm(10.5, 12.0, k)).mul(T.float(1).sub(sm(13.6, 14.6, k)));
  // the crease at the front of the hip: two or three folds slanting out from the fork, deepest at the front and dying out toward the side (a lap of evenly spaced ridges
  // all the way to the knee read as a ribbed hose, round 3's first seated shots)
  const gHipFront = hip.mul(front).mul(front).mul(sm(2.5, 3.6, k)).mul(T.float(1).sub(sm(5.2, 6.8, k))).mul(th.mul(3).add(1.3).cos().mul(0.35).add(0.65));
  const breeches = pleat(11).mul(gWaist).mul(0.0032)
    .add(pleat(12, 0.7).mul(gKneeBand).mul(0.0030))
    .add(pleat(6, 1.9).mul(gSeat).mul(0.0035))
    .add(ridge(k.mul(0.75)).mul(gBehindKnee).mul(0.0035))
    .add(ridge(k.mul(0.8).add(s.mul(T.select(part.greaterThan(100.5), T.float(-0.35), T.float(0.35)))).add(0.3)).mul(gHipFront).mul(0.0032));          // (the slant mirrored on the right leg's tube)
  // ---- the doublet and the shirt (0 <= part < 99): k is the share along the part
  const isTorso = part.lessThan(0.5), isSleeve = part.greaterThan(0.5).and(part.lessThan(2.5)), isShirtFore = part.greaterThan(6.5).and(part.lessThan(8.5)), isShirtUp = part.greaterThan(4.5).and(part.lessThan(6.5));
  const skirts = T.float(1).sub(sm(0.10, 0.32, k));                                   // the torso's lowest rings: the skirts to the hip, hanging
  const torso = pleat(9, 0.4).mul(skirts).mul(0.0022);
  const sleeve = pleat(6).mul(T.float(1).sub(sm(0.0, 0.40, k))).mul(0.0020);         // the cap's fullness, set into the armhole
  const shirtFore = pleat(8, 0.3).mul(sm(0.62, 0.98, k)).mul(0.0026)                  // gathered into the wrist band
    .add(th.mul(4).add(k.mul(5.0)).sin().mul(0.5).add(0.5).mul(0.0012));              // and a soft twist of fullness down the forearm
  const shirtUp = pleat(5, 1.1).mul(0.0010);
  const bodice = T.select(isTorso, torso, T.select(isSleeve, sleeve, T.select(isShirtFore, shirtFore, T.select(isShirtUp, shirtUp, T.float(0)))));
  const height = T.select(part.greaterThan(99.5), breeches, T.select(part.greaterThan(-0.5), bodice, T.float(0)));
  // the deepest share of a fold, for occlusion: the height against the most the field gives there
  const peak = T.select(part.greaterThan(99.5), T.float(0.0045), T.float(0.0026));
  return { height, shade: T.float(1).sub(height.div(peak).clamp()) };
}
