// Spring chains for the near tier's loose clothes and long hair clumps (design/r5-plan.md, "Wiggle bones").
// Near tier only: mid and far keep the stateless shader sway. A chain is a root pinned to a body bone plus N
// joints; each joint is pulled toward where the animation puts it (stiffness), damped, pulled down (gravity),
// kept at its rest length from its parent, pushed out of leg/body capsules, and held above floor/seat height.
// The method is that of the `wiggle` npm package (MIT, Xavier (Jack)): a damped spring per bone. This is our
// own code, stepped on the caller's dt (never a wall clock) with fixed substeps, so results depend only on the
// sequence of dts. Plain arrays and typed arrays, no three.js: runs in node and the browser. Units: metres, s, y up.

export const SUBSTEP = 1 / 120, MAX_SUBSTEPS = 10, MARGIN = 0.005, G = 9.81;

// spec: [{ points:[[x,y,z],...] (rest pose, root first), stiffness (1/s^2, spring to target), damping (1/s),
//          gravity (scale of 9.81, default 1), drag (0..1: share of the root's motion given to the joints directly,
//          the "velocity" variant, default 0) }]
export function makeChains(spec) {
  return spec.map(c => {
    const n = c.points.length, pos = new Float64Array(3 * n);
    c.points.forEach((p, i) => pos.set(p, 3 * i));
    const rest = new Float64Array(n);
    for (let i = 1; i < n; i++) rest[i] = Math.hypot(pos[3*i] - pos[3*i-3], pos[3*i+1] - pos[3*i-2], pos[3*i+2] - pos[3*i-1]);
    return { n, rest, pos, prev: pos.slice(), tPrev: pos.slice(), acc: 0,
      stiffness: c.stiffness ?? 150, damping: c.damping ?? 6, gravity: c.gravity ?? 1, drag: c.drag ?? 0 };
  });
}

// Snap to the targets with zero velocity (tier switch, teleport). targets[k] is a flat [x,y,z,...] for chain k.
export function reset(chains, targets) {
  chains.forEach((c, k) => { c.pos.set(targets[k]); c.prev.set(targets[k]); c.tPrev.set(targets[k]); c.acc = 0; });
}

// colliders: { capsules:[{a:[x,y,z], b:[x,y,z], r}], floor, seat } (a bare capsule array also works). floor and seat
// are heights joints may not go below (the seat only passed while seated); the larger one wins.
export function step(chains, dt, targets, colliders) {
  const caps = Array.isArray(colliders) ? colliders : colliders?.capsules ?? [];
  const lo = Math.max(colliders?.floor ?? -Infinity, colliders?.seat ?? -Infinity);
  chains.forEach((c, k) => {
    const T = targets[k], A = c.tPrev, acc0 = c.acc, n = c.n, p = c.pos, q = c.prev, h = SUBSTEP;
    let m = Math.floor((acc0 + dt) / h + 1e-9), over = m > MAX_SUBSTEPS;
    if (over) m = MAX_SUBSTEPS;
    c.acc = over ? 0 : Math.max(0, acc0 + dt - m * h);
    const df = Math.exp(-c.damping * h), kh = c.stiffness * h * h, gh = -G * c.gravity * h * h;
    for (let s = 1; s <= m; s++) {
      const f = dt > 0 ? Math.min(1, Math.max(0, over ? s / m : (s * h - acc0) / dt)) : 1;  // target time within this call
      const rx = A[0] + (T[0] - A[0]) * f - p[0], ry = A[1] + (T[1] - A[1]) * f - p[1], rz = A[2] + (T[2] - A[2]) * f - p[2];
      for (let i = 0; i < 3 * n; i += 3) {
        if (i === 0) { q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; p[0] += rx; p[1] += ry; p[2] += rz; continue; }
        for (let a = 0; a < 3; a++) {
          const t = A[i + a] + (T[i + a] - A[i + a]) * f, x = p[i + a];
          const d = (x - q[i + a]) * df + kh * (t - x) + (a === 1 ? gh : 0) + c.drag * (a === 0 ? rx : a === 1 ? ry : rz);
          q[i + a] = x; p[i + a] = x + d;
        }
      }
      for (let pass = 0; pass < 2; pass++) constrain(c, caps, lo);   // lengths, then collision: never inside a leg
    }
    A.set(T);
  });
}

function constrain(c, caps, lo) {
  const { n, pos: p, rest } = c;
  for (let i = 3; i < 3 * n; i += 3) {
    const dx = p[i] - p[i-3], dy = p[i+1] - p[i-2], dz = p[i+2] - p[i-1], s = rest[i / 3] / (Math.hypot(dx, dy, dz) || 1e-9);
    p[i] = p[i-3] + dx * s; p[i+1] = p[i-2] + dy * s; p[i+2] = p[i-1] + dz * s;
    collide(p, i, caps, lo);
  }
}

function collide(p, i, caps, lo) {
  for (const { a, b, r } of caps) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], apx = p[i] - a[0], apy = p[i+1] - a[1], apz = p[i+2] - a[2];
    const t = Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / ((abx * abx + aby * aby + abz * abz) || 1)));
    const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
    let dx = p[i] - cx, dy = p[i+1] - cy, dz = p[i+2] - cz, d = Math.hypot(dx, dy, dz);
    if (d >= r + MARGIN) continue;
    if (d < 1e-9) { dx = 1; dy = dz = 0; d = 1; }
    const s = (r + MARGIN) / d;
    p[i] = cx + dx * s; p[i+1] = cy + dy * s; p[i+2] = cz + dz * s;
  }
  if (p[i+1] < lo + MARGIN) p[i+1] = lo + MARGIN;
}

// Plain arrays, so the state round-trips through JSON (the lifecycle rule). restore() needs the same chain layout.
export function snapshot(chains) {
  return chains.map(c => ({ pos: Array.from(c.pos), prev: Array.from(c.prev), tPrev: Array.from(c.tPrev), acc: c.acc }));
}
export function restore(chains, snap) {
  chains.forEach((c, k) => { c.pos.set(snap[k].pos); c.prev.set(snap[k].prev); c.tPrev.set(snap[k].tPrev); c.acc = snap[k].acc; });
}
