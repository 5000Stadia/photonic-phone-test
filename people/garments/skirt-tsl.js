import { walkSample } from '../walk-sample.js';
// The pose-following skirt on the GPU (R5; garments/skirt.js is its plain-JS reference, which this follows step by step). Stateless in the pose: every frame the skirt of
// every dressed person drawn is a function of their bones (the shared walk texture), the gait phase and their skirt spec. Three stages, batched over everyone (never a pass or a
// draw a person):
//   pass 1  (a render-to-texture quad, one texel per person, ring, column)  the smoothed radius: the design radius with the bend limit, the legs' support floor, and the outward
//           smoothing across the columns (so three raw radii a texel)
//   pass 2  (a second quad over pass 1)  the dent bridging down each column, one Jacobi step from pass 1's radii (skirt.js: ctx.bridge 1, BRIDGE_GAIN)
//   vertex  the vertex's own ring frame (about 300 flops from the bones), its radius from pass 2, c + r u(theta), the floor, the sway; its normal from its four neighbours
// Float render targets: RGBA32F, nearest. It runs on WebGPU and on WebGL2 (EXT_color_buffer_float) alike; no compute.
// Trigonometry: sin and cos for the column's angle (theta = j / around x 2 pi) and the sway, as the reference has it; nothing else.
//
// Per-person spec row (specTexture, FloatType RGBA, SPEC_TEXELS texels, one row a person, written by writeSpecRow), metres at the person's own height:
//   texel k (0..15)  (rs, rf, rb, 0) of ring k: the design half-axes (side, front, back)
//   16 (thigh[0], thigh[4], shin[0], shin[4])   leg radii at the ends of each segment      17 (foot, waistSpine, trainTuck, hemY)       18 (legClear, sway, bend, H)
//   19 waistRest   20 hipsJoint   21 spineJoint   22 toeJoint L   23 toeJoint R   24 tipToe L   25 tipToe R     (vec3 each, rest pose)
//   26 thigh L  27 thigh R  28 shin L  29 shin R  30 foot L  31 foot R                                          (rest joints of the bones the legs' capsules hang from)
//   32 (short, kneeShare, drop, 0)    33 (lateral 0, lateral 1, agent row, leg)      the divided breeches' tube (skirt.js SKIRTS.breeches): short 0 for a skirt, 1 for a tube on one leg, whose path ends at the knee;
//                                     texel 33's (z, w) tag the block: the agent texture's row of the person it belongs to and which tube (leg) it is, so a pass reads its person from its own spec row and
//                                     one system serves every outfit of a tier (a person taking one block or two; the draw's classes lay their people one after another in the one agent texture)
// Per-instance data, read from the agent texture (row = instance): texel 0 [x, z, heading, phase], texel 1 [walk slot, ., y, .], texel 4 [., ., ., the person's first block (spec row)].
// The bones are the walk texture's: per slot, columns F + 1 frames, rows 3 B (affine matrix rows); neighbouring captured poses blend transformed points.
import { BONES } from "../../body.js";

export const RINGS = 16, SPEC_TEXELS = 34;
const BI = Object.fromEntries(BONES.map(([n], i) => [n, i]));
const SEG_AT = [0, 4, 9, 14, 15], R_HIP = 4, R_KNEE = 9, R_ANKLE = 14, R_HEM = 15;
const TAU = 2 * Math.PI;

/** Fill one block's spec row (a Float32Array of SPEC_TEXELS * 4, or a view of one) from a skirt spec (skirt.js skirtSpec / skirtSpecAt / unpackSpec) and the rig's rest joints J. `agentRow`: the agent texture's row of the person
 *  (the passes read it from the block), `leg`: which tube of theirs this is (0, or 1 for the second of the breeches). */
export function writeSpecRow(data, row, spec, J, agentRow = 0, leg = 0) {
  const o = row * SPEC_TEXELS * 4, put = (t, a, b, c, d = 0) => { data[o + 4 * t] = a; data[o + 4 * t + 1] = b; data[o + 4 * t + 2] = c; data[o + 4 * t + 3] = d; };
  for (let k = 0; k < RINGS; k++) put(k, spec.rs[k], spec.rf[k], spec.rb[k]);
  put(16, spec.thigh[0], spec.thigh[4], spec.shin[0], spec.shin[4]);
  put(17, spec.foot, spec.waistSpine, spec.trainTuck, spec.hemY);
  put(18, spec.legClear, spec.sway, spec.bend, spec.H);
  put(19, ...spec.waistRest); put(20, ...spec.hipsJoint); put(21, ...spec.spineJoint); put(22, ...spec.toeJoint[0]); put(23, ...spec.toeJoint[1]); put(24, ...spec.tipToe[0]); put(25, ...spec.tipToe[1]);
  put(26, ...J[BI.thighL]); put(27, ...J[BI.thighR]); put(28, ...J[BI.shinL]); put(29, ...J[BI.shinR]); put(30, ...J[BI.footL]); put(31, ...J[BI.footR]);
  put(32, spec.short ?? 0, spec.kneeShare ?? 0.5, spec.drop ?? 0); put(33, spec.lateral?.[0] ?? 0, spec.lateral?.[1] ?? 0, agentRow, leg);
}

/**
 * @param THREE, tsl   three/webgpu and three/tsl
 * @param around       columns a ring (24 for mid and far, 40 near)
 * @param blocks       the most tubes (skirts, or legs of breeches) drawn at once: a block is a spec row and a block of the passes' targets, a person taking one or two
 * @param agent        { tex }: the tier's dressed agent texture (FloatType RGBA, a row an instance)
 * @param walk         { makeNode(), hU, perRow, F, W, B }: a function returning a node of the walk texture (draw.js keeps it pointed at the texture as it grows), a uniform node
 *                     of its height, people across a row, frames (32), width, bones (21)
 * @param bridge       the bridging gain (skirt.js BRIDGE_GAIN, 0.7), 0 for none (a far profile)
 * @returns { specTexture, writeSpecRow, count (the blocks in use, packed from block 0), swayAmp, vertex({ instance, ring, col, tube }) -> { position, normal }, passes, dispose() }
 *          `vertex` builds nodes and must be called inside a TSL Fn (the positionNode's): the person-local, unrotated position (y includes the floor clamp, not the root's y) and unit normal.
 */
export function makeSkirtGPU({ THREE, tsl, around = 24, blocks = 64, agent, walk, bridge = 0.7 }) {
  const { Fn, If, select, mix, smoothstep, textureLoad, texture, ivec2, vec2, vec3, vec4, float, int, dot, cross, normalize, sqrt, min, max, abs, sign, clamp, sin, cos, uniform, rtt, uv, floor, mod, Loop } = tsl;
  const A = around;
  const rows = blocks, specData = new Float32Array(rows * SPEC_TEXELS * 4);
  const specTexture = new THREE.DataTexture(specData, SPEC_TEXELS, rows, THREE.RGBAFormat, THREE.FloatType);
  specTexture.needsUpdate = true; specTexture.magFilter = specTexture.minFilter = THREE.NearestFilter; specTexture.generateMipmaps = false;
  const count = uniform(0), swayAmp = uniform(1);
  // the passes' render targets: a block of RINGS x A texels a person, PX blocks across a row
  const PX = Math.max(1, Math.min(rows, Math.floor(2048 / A))), RW = PX * A, RH = Math.ceil(rows / PX) * RINGS;
  const texelUV = (person, ring, col) => { const p = float(person), bx = p.mod(PX), by = floor(p.div(PX)); return vec2(bx.mul(A).add(float(col)).add(0.5).div(RW), by.mul(RINGS).add(float(ring)).add(0.5).div(RH)); };
  const pt = (x) => float(x);
  const smooth = (a, b, x) => smoothstep(float(a), float(b), x);
  const lerp = (a, b, t) => a.add(b.sub(a).mul(t));
  const v3 = (n) => vec3(n.x, n.y, n.z);

  // ---- a person's rig at a phase: bones, anchors, the path's segments (everything the ring frames stand on) ----
  function makeRig(instance, srow, leg, phaseOverride) {         // the agent row of the person, the block (spec row) of the tube, and which leg it is (a float node, 0 or 1)
    const row = int(instance).toVar();
    const a0 = textureLoad(agent.tex, ivec2(0, row)), a1 = textureLoad(agent.tex, ivec2(1, row));
    const phase = (phaseOverride ?? a0.w).toVar(), slot = a1.x.toVar();
    srow = int(srow).toVar();
    const S = (t) => textureLoad(specTexture, ivec2(t, srow));
    const wn = walk.makeNode();
    const uu = slot.mod(walk.perRow).mul(walk.F + 1).add(phase.mul(walk.F)).add(0.5).div(walk.W).toVar(), row0 = slot.div(walk.perRow).floor().mul(walk.B * 2).toVar();
    const rotate = (q, v) => { const t = cross(q.xyz, v).mul(2).toVar(); return v.add(t.mul(q.w)).add(cross(q.xyz, t)); };
    const bone = (name, rest) => {
      const pose=walkSample(tsl,wn,slot,phase,BI[name],{perRow:walk.perRow,F:walk.F,W:walk.W,H:walk.hU,B:walk.B});
      return {rotate:pose.rotate,P:pose.point(v3(S(rest))).toVar()};
    };
    const hips = bone("hips", 20), spine = bone("spine", 21), thL = bone("thighL", 26), thR = bone("thighR", 27), shL = bone("shinL", 28), shR = bone("shinR", 29), fL = bone("footL", 30), fR = bone("footR", 31);
    const toeL = bone("toeL", 22), toeR = bone("toeR", 23);
    const s18 = S(18).toVar(), s17 = S(17).toVar(), s16 = S(16).toVar(), H = s18.w, hemY = s17.w, bend = s18.z, swayAmpl = s18.y.mul(swayAmp), clear = s18.x, ws = s17.y, tuck = s17.z;
    // anchors: the waist (part on the pelvis, part on the spine), the hips, knees, ankles (middles of the two legs), the hem
    const w0 = v3(S(19)), J0 = v3(S(20)), Js = v3(S(21));
    const a0v = mix(hips.P.add(hips.rotate(w0.sub(J0))), spine.P.add(spine.rotate(w0.sub(Js))), ws).toVar();
    const a1v = thL.P.add(thR.P).mul(0.5).toVar(), a2v = shL.P.add(shR.P).mul(0.5).toVar(), a3v = fL.P.add(fR.P).mul(0.5).toVar();
    // the path's end: the skirt's anchors are the knees, ankles and floor; a tube of the divided breeches (s32.x, 1) is on one leg (`leg`: 0 the left, 1 the right): its first two anchors are moved from the middle of the
    // pelvis toward its hip joint by the cut's lateral shares, then a share of the way down its thigh, its knee, and a little below the knee along the thigh
    const s32 = S(32), s33 = S(33), shrt = s32.x, legBit = float(leg).toVar(), thO = mix(thL.P, thR.P, legBit).toVar(), kO = mix(shL.P, shR.P, legBit).toVar(), dl = thO.sub(a1v).toVar();
    const td = kO.sub(thO).div(max(sqrt(dot(kO.sub(thO), kO.sub(thO))), 1e-9)).toVar();
    const b0v = a0v.add(dl.mul(s33.x).mul(shrt)).toVar(), b1v = a1v.add(dl.mul(s33.y).mul(shrt)).toVar();
    const b2v = mix(a2v, thO.add(kO.sub(thO).mul(s32.y)), shrt).toVar(), b3v = mix(a3v, kO, shrt).toVar();
    const a4v = mix(vec3(a3v.x, min(a3v.y.sub(H.mul(0.01)), hemY), a3v.z), kO.add(td.mul(s32.z)), shrt).toVar();
    const anc = [b0v, b1v, b2v, b3v, a4v];
    // heading and the pelvis axes
    const pf = hips.rotate(vec3(0, 0, 1)).toVar(), pd = hips.rotate(vec3(0, -1, 0)).toVar();
    const hl = max(sqrt(pf.x.mul(pf.x).add(pf.z.mul(pf.z))), 1e-6), hx = pf.x.div(hl).toVar(), hz = pf.z.div(hl).toVar();
    // the segments of the path
    const segD = [], segL = [], segS = [float(0)];
    for (let i = 0; i < 4; i++) { const d = anc[i + 1].sub(anc[i]), l = max(sqrt(dot(d, d)), 1e-9).toVar(); segD.push(d.div(l).toVar()); segL.push(l); segS.push(segS[i].add(l).toVar()); }
    segD.push(mix(vec3(0, -1, 0), td, shrt));
    // the legs as capsules: a, b, ra, rb
    const tipL = v3(S(24)), tipR = v3(S(25)), jtL = v3(S(22)), jtR = v3(S(23));
    const caps = [
      { a: thL.P, b: shL.P, ra: s16.x, rb: s16.y, leg: true, on: select(shrt.greaterThan(0.5), float(1).sub(legBit), float(1)) }, { a: shL.P, b: fL.P, ra: s16.z, rb: s16.w, leg: true, on: select(shrt.greaterThan(0.5), float(1).sub(legBit), float(1)) },
      { a: thR.P, b: shR.P, ra: s16.x, rb: s16.y, leg: true, on: select(shrt.greaterThan(0.5), legBit, float(1)) }, { a: shR.P, b: fR.P, ra: s16.z, rb: s16.w, leg: true, on: select(shrt.greaterThan(0.5), legBit, float(1)) },
      { a: fL.P, b: toeL.P.add(toeL.rotate(tipL.sub(jtL))), ra: s17.x, rb: s17.x.mul(0.8), leg: false, on: float(1).sub(shrt) }, { a: fR.P, b: toeR.P.add(toeR.rotate(tipR.sub(jtR))), ra: s17.x, rb: s17.x.mul(0.8), leg: false, on: float(1).sub(shrt) },
    ].map((c) => ({ ...c, a: c.a, b: c.b }));
    // how far the knees are bent (the train tucks in as they bend)
    let flex = float(0);
    for (const [th, sh, fo] of [[thL, shL, fL], [thR, shR, fR]]) {
      const x = sh.P.sub(th.P), y = fo.P.sub(sh.P), cs = dot(x, y).div(max(sqrt(dot(x, x)), 1e-6).mul(max(sqrt(dot(y, y)), 1e-6)));
      flex = flex.add(smooth(0.12, 0.7, float(1).sub(cs)).mul(0.5));
    }
    flex = flex.toVar();

    /** the frame of ring k (an int node): { c, n, f } person-local */
    function ring(k) {
      const kf = float(k).toVar();
      const lt4 = kf.lessThan(4), lt9 = kf.lessThan(9), lt14 = kf.lessThan(14);
      const kA = select(lt4, float(0), select(lt9, float(4), select(lt14, float(9), float(14)))), kB = select(lt4, float(4), select(lt9, float(9), select(lt14, float(14), float(15))));
      const t = kf.sub(kA).div(kB.sub(kA)).toVar();
      const pick = (arr) => select(lt4, arr[0], select(lt9, arr[1], select(lt14, arr[2], arr[3])));
      const Aa = pick(anc.slice(0, 4)), Ab = pick(anc.slice(1, 5)), sk = pick(segS.slice(0, 4)).add(t.mul(pick(segL)));
      let c = lerp(Aa, Ab, t).toVar(), nn = vec3(0).toVar();
      for (let i = 0; i < 5; i++) {
        const hi = i < 4 ? segS[i + 1] : segS[4].add(10), ov = min(sk.add(bend), hi).sub(max(sk.sub(bend), segS[i]));
        nn.addAssign(segD[i].mul(max(ov, 0)));
      }
      const g = smooth(R_KNEE, R_ANKLE, kf).mul(float(1).sub(shrt));          // (a tube of the breeches stays across its thigh)
      nn = vec3(nn.x.mul(float(1).sub(g)), lerp(nn.y, float(-1), g), nn.z.mul(float(1).sub(g)));
      const n = nn.div(max(sqrt(dot(nn, nn)), 1e-9)).toVar();
      // the ring's frame: the pelvis's forward carried by the shortest turn of its down axis onto the ring's normal
      const v = cross(pd, n).toVar(), cc = dot(pd, n), kk = float(1).div(float(1).add(cc));
      let f = pf.add(cross(v, pf)).add(cross(v, cross(v, pf)).mul(kk));
      f = f.sub(n.mul(dot(f, n)));
      f = f.div(max(sqrt(dot(f, f)), 1e-9)).toVar();
      // the sway: the hem lags the legs, from the hips down
      const sd = smooth(R_HIP, R_HEM, kf), sa = swayAmpl.mul(sd).mul(sd).toVar(), lat = cross(f, n);
      const s1 = sin(phase.mul(2).add(0.15).mul(TAU)), s2 = sin(phase.add(0.3).mul(TAU));
      c = vec3(c.x.add(sa.mul(s1.mul(hx).mul(0.7).add(s2.mul(lat.x).mul(0.8)))), c.y, c.z.add(sa.mul(s1.mul(hz).mul(0.7).add(s2.mul(lat.z).mul(0.8)))));
      return { c: c.toVar(), n, f };
    }
    return { row, srow, phase, S, ring, caps, flex, clear, tuck, hemY, H, a0, a1, shrt };
  }

  // ---- pass 1: the smoothed radius of (person, ring, column) ----
  const BEND_HOLD = 0.8, chord = 1 / Math.cos(Math.PI / A);
  function radiusNode(rig, k, col /* an int node */) {
    const { S, ring, caps, flex, clear, tuck } = rig;
    const kf = float(k), sp = S(k), rs = sp.x, rf = sp.y, rb = sp.z.mul(float(1).sub(tuck.mul(flex).mul(smooth(R_KNEE - 1, R_KNEE + 1, kf)))), ringR = max(max(rs, rf), sp.z);
    // the rings the bend limit reads: k - 1, k, k + 1
    const rm = ring(max(k.sub(int(1)), int(0))), r0 = ring(k), rp = ring(min(k.add(int(1)), int(RINGS - 1)));
    const pair = (p, q) => { const d = q.n.sub(p.n), turn = sqrt(dot(d, d)), e = q.c.sub(p.c), arc = sqrt(dot(e, e)); return select(turn.greaterThan(1e-6), arc.div(max(turn, 1e-9)), float(1000)); };
    const rhoA = select(k.greaterThan(int(0)), pair(rm, r0), pair(r0, rp)), rhoB = select(k.lessThan(int(RINGS - 1)), pair(r0, rp), pair(rm, r0)), RHO = min(rhoA, rhoB).toVar();
    const dn = rp.n.sub(rm.n), RINd = dn.sub(r0.n.mul(dot(dn, r0.n))), RIN = RINd.div(max(sqrt(dot(RINd, RINd)), 1e-9)).toVar();
    const { c, n, f } = r0, l = cross(f, n).toVar();
    // each capsule's plane quantities, once for the texel
    const pc = caps.map((cp) => {
      const da = dot(cp.a.sub(c), n).toVar(), db = dot(cp.b.sub(c), n).toVar(), rmax = max(cp.ra, cp.rb).add(clear), e = db.sub(da).toVar();
      let wgt = float(1);
      if (cp.leg) { const d = cp.b.sub(cp.a), dl = max(sqrt(dot(d, d)), 1e-9); wgt = smooth(0.3, 0.6, abs(e).div(dl)); }
      const outside = da.greaterThan(rmax).and(db.greaterThan(rmax)).or(da.lessThan(rmax.negate()).and(db.lessThan(rmax.negate())));
      const active = select(outside.or(wgt.lessThanEqual(0)), float(0), float(1)).mul(cp.on).toVar();
      const flat = abs(e).lessThanEqual(1e-9), es = select(flat, float(1), e);
      const ta = rmax.negate().sub(da).div(es), tb = rmax.sub(da).div(es);
      const t0 = select(flat, float(0), max(float(0), min(ta, tb))).toVar(), t1 = select(flat, float(1), min(float(1), max(ta, tb))).toVar();
      const rmid = lerp(cp.ra, cp.rb, t0.add(t1).mul(0.5)).add(clear).toVar();
      const cand = (t) => {
        const dd = da.add(t.mul(e)), r = lerp(cp.ra, cp.rb, t).add(clear), s = sqrt(max(r.mul(r).sub(dd.mul(dd)), 0));
        const w = cp.a.add(cp.b.sub(cp.a).mul(t)).sub(c), wn = dot(w, n), dist = sqrt(max(dot(w, w).sub(wn.mul(wn)), 0)), wt = wgt.mul(float(1).sub(smooth(1.3, 1.8, dist.div(ringR))));
        return { s: s.toVar(), wt: wt.toVar() };
      };
      return { cp, da, e, es, flat, t0, t1, rmid, active, c0: cand(t0), c1: cand(t1), cand };
    });
    const colf = float(col);
    // the support of the legs over the direction at angle th: the best of 3 candidates a capsule, times its weight
    const support = (th) => {
      const sn = sin(th), cs = cos(th), u = l.mul(sn).add(f.mul(cs)).toVar();
      let best = float(0);
      for (const P of pc) {
        const { cp, da, e, es, flat, t0, t1, rmid } = P;
        const pa = dot(cp.a.sub(c), u), q = dot(cp.b.sub(cp.a), u), qq = sqrt(q.mul(q).add(e.mul(e)));
        const sg = select(q.mul(e).equal(0), float(1), sign(q.mul(e)));
        const D = sg.mul(rmid).mul(abs(q)).div(max(qq, 1e-12)), tc = select(flat.or(qq.lessThanEqual(1e-12)), t0, D.sub(da).div(es));
        const tcc = clamp(tc, t0, t1), ct = P.cand(tcc);
        const v0 = pa.add(t0.mul(q)).add(P.c0.s).mul(P.c0.wt), v1 = pa.add(t1.mul(q)).add(P.c1.s).mul(P.c1.wt), v2 = pa.add(tcc.mul(q)).add(ct.s).mul(ct.wt);
        best = max(best, max(max(v0, v1), v2).mul(P.active));
      }
      return best;
    };
    const th0 = colf.div(A).mul(TAU).toVar();
    const raw = (dcol) => {
      const th = th0.add(dcol * TAU / A), sn = sin(th), cs = cos(th);
      const rr = select(cs.greaterThanEqual(0), rf, rb), design0 = float(1).div(sqrt(sn.mul(sn).div(rs.mul(rs)).add(cs.mul(cs).div(rr.mul(rr)))));
      const inward = dot(l.mul(sn).add(f.mul(cs)), RIN);
      return { design: select(inward.greaterThan(0.1), min(design0, float(BEND_HOLD).mul(RHO).div(inward)), design0) };
    };
    // seven half-angle samples of the support (n = -3 .. 3 steps of pi / A from the column's angle; odd ones are the chord's), in a loop of seven (one body to build, not seven); the three the columns' need
    // (the samples -3..-1, -1..1 and 1..3) are kept as running maxima, as the supports are all above 0
    const offs = [-3, -2, -1, 0, 1, 2, 3].map((nn) => (nn * Math.PI) / A), pickOf = (i) => offs.slice(0, -1).reduceRight((acc, o, k) => select(i.equal(k), float(o), acc), float(offs[6]));
    const need = [float(0).toVar(), float(0).toVar(), float(0).toVar()];
    Loop(7, ({ i }) => {
      const sp = support(th0.add(pickOf(i))).mul(select(i.mod(2).equal(1), float(1), float(chord))).toVar();
      need[0].assign(select(i.lessThan(3), max(need[0], sp), need[0]));
      need[1].assign(select(i.greaterThan(1).and(i.lessThan(5)), max(need[1], sp), need[1]));
      need[2].assign(select(i.greaterThan(3), max(need[2], sp), need[2]));
    });
    const R0 = [-1, 0, 1].map((d) => max(raw(d).design, need[d + 1]).toVar());
    return max(R0[1], R0[0].add(R0[2]).mul(0.5));
  }

  // ---- the render-to-texture passes ----
  // the texel (x, y) of a pass's quad -> person, ring, column
  const decode = () => {
    const u = uv(), x = floor(u.x.mul(RW)), y = floor(u.y.mul(RH));
    const bx = floor(x.div(A)), col = int(x.sub(bx.mul(A))), by = floor(y.div(RINGS)), ringI = int(y.sub(by.mul(RINGS))), person = int(by.mul(PX).add(bx));
    return { person, ring: ringI, col };
  };
  // a block's rig: the person and the leg from the block's own spec row
  const rigOfBlock = (block) => { const t = textureLoad(specTexture, ivec2(33, block)); return makeRig(int(t.z), block, t.w); };
  const opts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  const pass1 = rtt(Fn(() => {
    const { person, ring: k, col } = decode(), out = vec4(0).toVar();
    If(person.lessThan(int(count)), () => { const rig = rigOfBlock(person); out.assign(vec4(radiusNode(rig, k, col), 0, 0, 1)); });
    return out;
  })(), RW, RH, opts);
  pass1.name = "skirt pass 1";
  // (no bridging, no second pass: the far profile reads pass 1's radii)
  const pass2 = bridge <= 0 ? pass1 : rtt(Fn(() => {
    const { person, ring: k, col } = decode(), out = vec4(0).toVar();
    If(person.lessThan(int(count)), () => {
      const rig = rigOfBlock(person), S1 = (kk) => pass1.sample(texelUV(person, kk, col)).level(0).x;
      const th = float(col).div(A).mul(TAU), sn = sin(th), cs = cos(th);
      const rk = rig.ring(k), s0 = S1(k);
      const dirOf = (fr) => cross(fr.f, fr.n).mul(sn).add(fr.f.mul(cs));
      const posOf = (fr, r) => fr.c.add(dirOf(fr).mul(r));
      const uK = dirOf(rk), pK = posOf(rk, s0);
      let best = float(0);
      for (let sp = 1; sp <= 3; sp++) {
        const ka = max(k.sub(int(sp)), int(0)), kb = min(k.add(int(sp)), int(RINGS - 1)), fa = rig.ring(ka), fb = rig.ring(kb);
        const d = dot(posOf(fa, S1(ka)).add(posOf(fb, S1(kb))).mul(0.5).sub(pK), uK), ok = k.sub(int(sp)).greaterThanEqual(int(0)).and(k.add(int(sp)).lessThan(int(RINGS)));
        best = max(best, select(ok, d, float(0)));
      }
      out.assign(vec4(s0.add(select(k.greaterThan(int(0)).and(k.lessThan(int(RINGS - 1))), best, float(0)).mul(bridge)), 0, 0, 1));
    });
    return out;
  })(), RW, RH, opts);
  if (bridge > 0) pass2.name = "skirt pass 2";
  const R2 = (person, k, col) => pass2.sample(texelUV(person, k, col)).level(0).x;

  // ---- the vertex stage ----
  function vertex({ instance, ring: k, col, tube = 0 }) {
    const a4 = textureLoad(agent.tex, ivec2(4, int(instance))), person = int(a4.w).add(int(tube));        // the person's first block, then the tube's
    const rig = makeRig(instance, person, float(int(tube))), kInt = int(k), cInt = int(col);
    const A_ = float(A), fr = (kk) => rig.ring(kk);
    const kU = max(kInt.sub(int(1)), int(0)), kD = min(kInt.add(int(1)), int(RINGS - 1));
    const f0 = fr(kInt), fU = fr(kU), fD = fr(kD);
    const dirAt = (frm, cc) => { const th = float(cc).div(A_).mul(TAU); return cross(frm.f, frm.n).mul(sin(th)).add(frm.f.mul(cos(th))); };
    const wrap = (cc) => select(cc.lessThan(int(0)), cc.add(int(A)), select(cc.greaterThanEqual(int(A)), cc.sub(int(A)), cc));
    const hem = rig.hemY;
    const posAt = (frm, kk, cc) => { const p = frm.c.add(dirAt(frm, cc).mul(R2(person, kk, wrap(cc)))); return vec3(p.x, max(p.y, hem), p.z); };
    const p0 = posAt(f0, kInt, cInt).toVar();
    const pj1 = posAt(f0, kInt, cInt.add(int(1))), pj0 = posAt(f0, kInt, cInt.sub(int(1))), pk0 = posAt(fU, kU, cInt), pk1 = posAt(fD, kD, cInt);
    let nrm = cross(pj1.sub(pj0), pk1.sub(pk0));
    nrm = nrm.mul(select(dot(nrm, dirAt(f0, cInt)).lessThan(0), float(-1), float(1)));
    return { position: p0, normal: normalize(nrm) };
  }

  // QuadMesh otherwise borrows three's process-wide geometry. Own a copy so this
  // layer can release its buffers without invalidating another renderer's passes.
  const passes = bridge > 0 ? [pass1, pass2] : [pass1];
  for (const pass of passes) pass._quadMesh.geometry = pass._quadMesh.geometry.clone();
  return { specTexture, writeSpecRow, specData, count, swayAmp, vertex, passes, RW, RH, PX, dispose() { for (const pass of passes) { pass.autoUpdate = false; pass._quadMesh.geometry.dispose(); pass.dispose(); } specTexture.dispose(); } };
}
