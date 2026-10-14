// Spike "hair" (M1, R2): hair motion as one force per person, the same at every tier. Kabe's find, Szenia Zadvornykh's
// "Fuzzy Meshes" (2017, github.com/zadvorsky/three-fuzzy-mesh, MIT; the idea taken, written here in TSL): no simulation,
// each strand vertex turns from its rest direction toward normalize(rest + force * f), so what hangs furthest swings
// most. Changed for hair that lies on a head: the turn is about the strand's pivot, where it leaves the head's support
// (cards.js stores it), not about its root, so hair resting on the scalp stays put and only what hangs free swings; and
// the force comes from a damped pendulum (a few flops per person per frame), so hair overshoots and settles instead of
// only lagging and decaying as the original's force does.
//   CPU  motion() -> state; step(state, x, y, z, yaw, dt) -> state.force [Dx, Dy, Dz, swirl], the person's frame
//        D: the hanging hair's tilt (inertia: -acceleration / g, plus a little air drag); swirl: its lag about the head's
//        vertical axis when the head turns (-yaw acceleration * r / g). Each a spring at about 1.2 Hz, damping 0.2.
//   GPU  bend(THREE, crowd) -> a position node for the hair materials: the force from the per-instance attribute
//        hairForce, the pivot and free length from the vertex attributes; normal and tangent turned with the strand.
//        crowd: also places each instance from hairPlace (x, z, yaw, scale), after the bend (three's instanceMatrix
//        applies before a position node, so the crowd path does its own placing).
// The force is the only thing that changes per frame (16 bytes a person).
const G = 9.81, W0 = 2 * Math.PI * 1.2, ZETA = 0.2, R_SWIRL = 0.18, DRAG = 0.05, MAXTILT = 0.9;

export const motion = () => ({ force: new Float32Array(4), d: [0, 0, 0], dv: [0, 0, 0], s: 0, sv: 0, prev: null });

export function step(st, x, y, z, yaw, dt) {
  if (!(dt > 0)) return st.force;
  const now = { p: [x, y, z], yaw };
  if (!st.prev) { st.prev = { ...now, v: [0, 0, 0], w: 0 }; return st.force; }
  const v = now.p.map((c, k) => (c - st.prev.p[k]) / dt);
  let dyaw = yaw - st.prev.yaw; dyaw -= Math.round(dyaw / (2 * Math.PI)) * 2 * Math.PI;
  const w = dyaw / dt, a = v.map((c, k) => (c - st.prev.v[k]) / dt), alpha = (w - st.prev.w) / dt;
  // targets in the world frame, then into the person's frame (turned by -yaw about y)
  const tw = [-a[0] / G - v[0] * DRAG, -a[1] / G * 0.5, -a[2] / G - v[2] * DRAG], c = Math.cos(yaw), s = Math.sin(yaw);
  const target = [c * tw[0] - s * tw[2], tw[1], s * tw[0] + c * tw[2]], starget = -alpha * R_SWIRL / G;
  // the pendulums, in substeps of at most 1/240 s (semi-implicit Euler)
  const n = Math.ceil(dt * 240), h = dt / n;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { st.dv[k] += (W0 * W0 * (target[k] - st.d[k]) - 2 * ZETA * W0 * st.dv[k]) * h; st.d[k] += st.dv[k] * h; }
    st.sv += (W0 * W0 * (starget - st.s) - 2 * ZETA * W0 * st.sv) * h; st.s += st.sv * h;
  }
  const m = Math.hypot(...st.d); if (m > MAXTILT) st.d = st.d.map(c => c * MAXTILT / m);
  st.s = Math.max(-MAXTILT, Math.min(MAXTILT, st.s));
  st.prev = { ...now, v, w };
  st.force.set([st.d[0], st.d[1], st.d[2], st.s]);
  return st.force;
}

// a unit quaternion turning unit vector a onto unit vector b (as THREE.Quaternion.setFromUnitVectors), and its action
const quat = (T, a, b) => T.normalize(T.vec4(T.cross(a, b), T.dot(a, b).add(1)));
const turn = (T, q, v) => v.add(T.cross(q.xyz, T.cross(q.xyz, v).add(v.mul(q.w))).mul(2));

export function bend(THREE, crowd = false) {
  const T = THREE.TSL, { Fn, attribute, positionLocal, normalLocal, tangentLocal, vec3, normalize, length, dot, min, max, smoothstep, cos, sin } = T;
  return Fn(() => {
    const h = attribute("hair", "vec4"), pv = attribute("pivot", "vec3"), F = attribute("hairForce", "vec4");
    const v = positionLocal.sub(pv), len = length(v), rest = v.div(max(len, 1e-5));
    // the swirl turns the hanging hair about the head's vertical axis: its push is along the tangent round that axis
    const rad = normalize(vec3(pv.x, 0, pv.z.sub(0.05)).add(vec3(1e-4, 0, 0))), tng = vec3(rad.z, 0, rad.x.negate());
    const push0 = F.xyz.add(tng.mul(F.w));
    const push = push0.sub(rad.mul(min(dot(push0, rad), 0).mul(0.8)));     // swing out freely, barely into the body
    const to = normalize(rest.add(push.mul(smoothstep(0, 0.12, h.z))));
    const q = quat(T, rest, to);
    let p = pv.add(to.mul(len)), n = turn(T, q, normalLocal), t = turn(T, q, tangentLocal);
    if (crowd) {   // place the instance: scale, turn about y by yaw, move to (x, z)
      const pl = attribute("hairPlace", "vec4"), c = cos(pl.z), s = sin(pl.z);
      const rot = (u) => vec3(u.x.mul(c).add(u.z.mul(s)), u.y, u.z.mul(c).sub(u.x.mul(s)));
      p = rot(p.mul(pl.w)).add(vec3(pl.x, 0, pl.y)); n = rot(n); t = rot(t);
    }
    normalLocal.assign(n); tangentLocal.assign(t);
    return p;
  })();
}
