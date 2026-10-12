// The population's data layer (R4; design/r4-plan.md): the people store, ranks, tiers, walking, presence, rooms, state,
// events and hit, in pure JS with no three.js, so node tests it. draw.js reads what tick() returns; index.js wires the
// two into makePeople (design/interface.md).
//
// Engine principles (holo-emitter): rank from a hash of the id, compared once against thresholds everywhere; every
// look from a hash, never a random stream in build order; phase advances in seconds.

import { resolve } from "../traits/resolve.js";
import { uniform, seedOf } from "../traits/stream.js";
import { paramsFor, build } from "./bodies.js";
import { makeWalker } from "./walk.js";

export const TIERS = ["near", "mid", "far"];
const DEFAULT_THRESHOLDS = { near: 4, mid: 14 };   // metres for a person of middle rank; R9's phone figures set these

/**
 * @param opts.ctx         walk?: { route(from, to, floor, half) } (half: this body's half-width) returning a route [[x, y, z], ...], null for no way, a Promise of
 *                           either, or a stepper { step(nodes) -> undefined while searching, then the route or null }
 *                         place?: { roomAt(pos, floor) -> roomId, thingAt?(id) -> pos }
 *                         claims?: { hold(id, floor, x, z, half), release(id), bodyAt(floor, x, z, half, except) -> id | null }
 *                           the moving-bodies layer: the population holds each person's spot, and walkers step aside
 *                           for whoever is there (design/interface.md, "People as obstacles")
 * @param opts.basis       the fitted gait basis (spikes/gait/data/gait-basis.json, loaded)
 * @param opts.thresholds  { near, mid } in metres at middle rank
 * @param opts.avoid       false: walkers ignore each other (ghosts; the tests' baseline)
 */
export function makePopulation({ ctx = {}, basis, thresholds = DEFAULT_THRESHOLDS, hysteresis = 0.1, planBudget = 4000, avoid = true } = {}) {
  const people = new Map();            // id -> record
  const rooms = new Map();             // room id -> Set of ids
  let shown = null;                    // null: every room shown
  let queue = [];                      // events since the last events()
  // Time: the population's own clock (the sum of tick dts). People nobody sees are not stepped each frame; they catch
  // up when next looked at, and their arrivals come from a queue of arrival times, so a walk into a hidden room still
  // ends, on time, at a cost per arrival rather than per frame.
  let clock = 0;
  const arrivals = [];                 // a binary heap of { time, id, token }
  const heapPush = (e) => { arrivals.push(e); let i = arrivals.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (arrivals[p].time <= e.time) break; arrivals[i] = arrivals[p]; i = p; } arrivals[i] = e; };
  const heapPop = () => { const top = arrivals[0], last = arrivals.pop(); if (arrivals.length) { let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; const val = (k) => (k === i ? last : arrivals[k]); if (l < arrivals.length && arrivals[l].time < val(m).time) m = l; if (r < arrivals.length && arrivals[r].time < val(m).time) m = r; if (m === i) break; arrivals[i] = arrivals[m]; i = m; } arrivals[i] = last; } return top; };

  const planners = [];                 // routes still being searched: { rec, token, stepper }
  const hold = (rec) => ctx.claims?.hold?.(rec.id, rec.floor, rec.pos[0], rec.pos[2], rec.half);
  const active = (rec) => rec.presence !== "offscene" && (!shown || shown.has(rec.room));

  const roomSet = (room) => { if (!rooms.has(room)) rooms.set(room, new Set()); return rooms.get(room); };
  const roomOf = (pos, floor, given) => given ?? ctx.place?.roomAt?.(pos, floor) ?? "";

  function add(doc) {
    if (!doc || doc.id == null) throw new Error("add(doc): a doc needs an id");
    const id = String(doc.id);
    if (people.has(id)) remove(id);
    const seed = doc.seed ?? seedOf(id);
    const said = doc.recipe?.said ?? doc.recipe ?? "";
    const res = resolve({ id, seed, kind: doc.recipe?.kind ?? "human", setting: doc.recipe?.setting ?? null, said, override: !!doc.recipe?.override });
    if (!res.ok) throw new Error(`add(${id}): ${res.refused.map(r => r.reason).join("; ")}`);
    const st = doc.state ?? {};
    const at = st.at ?? doc.at ?? {};
    const pos = (at.pos ?? [0, 0, 0]).slice();
    const rec = {
      id, doc, seed, res, values: res.values,
      rank: uniform(0, id, "rank"),
      pos, floor: at.floor ?? 0, room: roomOf(pos, at.floor ?? 0, at.room),
      heading: st.heading ?? 0, phase: st.phase ?? uniform(seed, id, "phase0"),
      doing: null, holding: st.holding ?? null, presence: st.presence ?? "at_scene",
      tier: null, seen: false, height: (res.derived["body.height"] ?? 170) / 100, lastClock: clock, goToken: 0,
    };
    rec.half = Math.max(0.18, 0.13 * rec.height);
    // Built on first need, so people never seen or walked cost nothing beyond their resolution.
    let body = null, params = null, walker;
    Object.defineProperties(rec, {
      bodyParams: { get: () => (params ??= paramsFor(res.values, res.derived)) },
      body: { get: () => (body ??= build(rec.bodyParams)) },
      walker: { get: () => (walker !== undefined ? walker : (walker = basis ? makeWalker(rec.body.joints.J, {
        age: res.values.age, sex: res.values.sex === "male" ? 1 : res.values.sex === "female" ? -1 : 0, seed: seedOf(`${seed}:${id}:walk`) }, basis) : null)) },
      speed: { get: () => rec.walker ? rec.walker.v : 1.3 },
      rate: { get: () => rec.walker ? rec.walker.f : 0.9 },
      built: { get: () => body !== null },
    });
    people.set(id, rec);
    roomSet(rec.room).add(id);
    hold(rec);
    if (st.doing?.verb === "goTo") goTo(id, st.doing.target, st.doing.opts);
    return rec;
  }

  function remove(id) {
    const rec = people.get(String(id));
    if (!rec) return false;
    rooms.get(rec.room)?.delete(rec.id);
    people.delete(rec.id);
    ctx.claims?.release?.(rec.id);
    return true;
  }

  function setRoom(rec, room) {
    if (room === rec.room) return;
    rooms.get(rec.room)?.delete(rec.id); rec.room = room; roomSet(room).add(rec.id);
  }

  const posOf = (target) => {
    if (target == null) return null;
    if (Array.isArray(target)) return target;
    if (typeof target === "string") return people.get(target)?.pos ?? ctx.place?.thingAt?.(target) ?? null;
    return target.pos ?? null;
  };

  function catchUp(rec) {
    if (rec.lastClock < clock) { step(rec, clock - rec.lastClock); rec.lastClock = clock; }
  }

  // goTo: the route may come at once, later (a Promise), or in slices (a stepper the tick advances within planBudget
  // nodes a frame). The person stands while it is searched. No way there: goTo is false (or the search ends in null)
  // and a no_way event says so. An empty route means they are already there.
  function goTo(id, target, opts = {}) {
    const rec = people.get(String(id)); if (!rec) return false;
    catchUp(rec);
    const to = posOf(target); if (!to) return false;
    // babies don't walk: carried on a hip or in arms (carry.carrier, a later milestone), so goTo says so instead
    if (rec.values.age < 0.9) { queue.push({ type: "cannot_walk", id: rec.id, reason: "a baby is carried, not walked" }); return false; }
    const r = ctx.walk?.route ? ctx.walk.route(rec.pos, to, rec.floor, rec.half) : [to];   // routes fit this body
    const token = ++rec.goToken;
    rec.doing = { verb: "goTo", target, opts, route: null, leg: 0, token, planning: true };
    if (r && typeof r.then === "function") { r.then(route => { if (rec.doing?.token === token) setRoute(rec, route); }, () => { if (rec.doing?.token === token) setRoute(rec, null); }); return true; }
    if (r && typeof r.step === "function") { planners.push({ rec, token, stepper: r }); return true; }
    return setRoute(rec, r);
  }

  function setRoute(rec, route) {
    const d = rec.doing;
    if (route == null) { rec.doing = null; queue.push({ type: "no_way", id: rec.id, target: d?.target ?? null }); return false; }
    if (!route.length) { rec.doing = null; queue.push({ type: "arrived", id: rec.id, at: { pos: rec.pos.slice(), floor: rec.floor, room: rec.room } }); return true; }
    d.route = route.map(p => p.slice()); d.planning = false; rec.lastClock = clock;
    let len = 0, prev = rec.pos;
    for (const p of d.route) { len += Math.hypot(p[0] - prev[0], p[2] - prev[2]); prev = p; }
    heapPush({ time: clock + len / (rec.speed * (d.opts?.pace ?? 1)), id: rec.id, token: d.token });
    return true;
  }

  function face(id, target) {
    const rec = people.get(String(id)), to = posOf(target);
    if (!rec || !to) return false;
    catchUp(rec);
    rec.heading = Math.atan2(to[0] - rec.pos[0], to[2] - rec.pos[2]);
    return true;
  }

  // Avoiding each other (Kabe, 2026-10-12: "minor bump and avoidance"), only for people stepped frame by frame.
  // Anticipation by sampled velocities and time to collision: Detour's crowd (Recast, zlib) samples candidate velocities;
  // Karamouzas, Skinner and Guy (2014, "Universal power law governing pedestrian interactions") show people react to
  // the time until they'd touch, not the distance. Each walker scores headings turning away from the way (nearest
  // first) at full and slowed pace, plus standing: cost = how far the velocity strays from the wanted one, plus a
  // penalty growing as the soonest contact with a neighbour (the 8 nearest within 3 m, moving at last frame's velocity)
  // nears. Other bodies the world holds (ctx.claims: someone the population doesn't step) block a candidate outright,
  // and a sidestep takes only ground a body that wide can stand on (ctx.walk.stand, holo-emitter's groundAt).
  // Decided every 4th frame per person (staggered by rank), kept in between.
  // Returns { turn, pace } (pace: the share of their own speed), or null to stand this frame.
  const TURNS = [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.35, -1.35];
  const AV = { reach: 3, nearest: 8, horizon: 2.5, margin: 0.06, cell: 2 };
  let frameNo = 0, grid = new Map();
  // a small integer per grid cell: cells wrap every 2 km and floors every 64, which only adds candidates the
  // distance test then drops
  const cellKey = (floor, i, j) => ((floor & 63) << 20) | ((i & 1023) << 10) | (j & 1023);
  const cellOf = (floor, x, z) => cellKey(floor, Math.floor(x / AV.cell), Math.floor(z / AV.cell));
  const near = [], nb = [];
  // the nearest within reach, in a shared array (read it before asking again)
  function neighbours(rec, reach = AV.reach, nearest = AV.nearest) {
    near.length = 0;
    const cx = Math.floor(rec.pos[0] / AV.cell), cz = Math.floor(rec.pos[2] / AV.cell), k = Math.ceil(reach / AV.cell - 1e-9);
    for (let i = cx - k; i <= cx + k; i++) for (let j = cz - k; j <= cz + k; j++) {
      const cell = grid.get(cellKey(rec.floor, i, j)); if (!cell) continue;
      for (const o of cell) {
        if (o === rec) continue;
        const dx = o.pos[0] - rec.pos[0], dz = o.pos[2] - rec.pos[2], d2 = dx * dx + dz * dz;
        if (d2 < reach * reach) near.push({ d2, o });
      }
    }
    if (near.length > nearest) { near.sort((a, b) => a.d2 - b.d2 || (a.o.id < b.o.id ? -1 : 1)); near.length = nearest; }
    nb.length = near.length;
    for (let i = 0; i < near.length; i++) nb[i] = near[i].o;
    return nb;
  }
  // seconds until two discs (radii summed to r) touch, at relative position p = theirs - mine and relative velocity
  // v = mine - theirs; 0 if touching and still closing, Infinity if they never touch
  function ttc(px, pz, vx, vz, r) {
    const c = px * px + pz * pz - r * r, b = px * vx + pz * vz;
    if (c < 0) return b > 0 ? 0 : Infinity;
    const a = vx * vx + vz * vz;
    if (b <= 0 || a < 1e-9) return Infinity;
    const disc = b * b - a * c;
    return disc <= 0 ? Infinity : (b - Math.sqrt(disc)) / a;
  }
  // someone the world holds there whom the population doesn't step (we weigh our own by their velocity instead)
  const blocked = (rec, claims, ox, oz) => { const id = claims(rec.floor, rec.pos[0] + ox, rec.pos[2] + oz, rec.half, rec.id); return id != null && !people.has(id); };
  const standAt = (rec, x, z) => (ctx.walk?.stand ? ctx.walk.stand([x, rec.pos[1], z], rec.floor, rec.half) : rec.pos[1]);
  function choose(rec, dx, dz, v, stepLen) {
    const nb = neighbours(rec);
    const claims = ctx.claims?.bodyAt;
    if (!nb.length && !claims) return { turn: 0, pace: 1 };
    const la = Math.max(0.45, v * 0.45), base = Math.atan2(dx, dz), bs = Math.sin(base), bc = Math.cos(base);
    let best = null;
    const score = (sh, ch, s) => {
      const ux = sh * v * s, uz = ch * v * s;
      let tmin = Infinity;
      for (const o of nb) {
        const t = ttc(o.pos[0] - rec.pos[0], o.pos[2] - rec.pos[2], ux - o.vel[0], uz - o.vel[1], rec.half + o.half + AV.margin);
        if (t < tmin) tmin = t;
      }
      // straying: the distance between this velocity and the wanted one, in shares of their speed (0 to 2)
      const stray = Math.hypot(sh * s - bs, ch * s - bc);
      return stray + (tmin < AV.horizon ? 3 * (AV.horizon - tmin) / AV.horizon : 0);
    };
    // the way ahead clear of everyone for the horizon (most of the time, in most places): straight on, nothing more to weigh
    if (score(bs, bc, 1) === 0 && !(claims && blocked(rec, claims, bs * la, bc * la))) return { turn: 0, pace: 1 };
    for (const s of [1, 0.55]) for (const a of TURNS) {
      const sh = Math.sin(base + a), ch = Math.cos(base + a), cost = score(sh, ch, s);
      if (best && cost >= best.cost) continue;
      const x = rec.pos[0] + sh * la * s, z = rec.pos[2] + ch * la * s;
      if (claims && blocked(rec, claims, sh * la * s, ch * la * s)) continue;
      if (a !== 0) {
        if (standAt(rec, x, z) == null) continue;                             // no ground there for this body
        if (standAt(rec, rec.pos[0] + sh * stepLen * s, rec.pos[2] + ch * stepLen * s) == null) continue;
      }
      best = { turn: a, pace: s, cost };
    }
    const still = score(0, 0, 0);
    if (!best || still < best.cost) return null;
    return best;
  }

  // Bumping: when two bodies overlap anyway (a crowd too dense to avoid everyone, someone stepping out of a door),
  // they are nudged apart, each by half the overlap at up to 1.2 m/s (a walker meeting someone standing takes it all), onto ground they can stand on, and both slow
  // for half a second. A `bumped` event goes out once per contact, as it starts (M4's reactions: "pardon").
  const TURN_RATE = 6;                 // radians a second
  let touching = new Set();
  const STENCIL = [[0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];     // each pair of neighbouring cells once
  function bumps(live, dt) {
    const now = new Set();
    for (const cell of grid.values()) {
      const a0 = cell[0], ci = Math.floor(a0.pos[0] / AV.cell), cj = Math.floor(a0.pos[2] / AV.cell);
      for (const [di, dj] of STENCIL) {
        const other = di === 0 && dj === 0 ? cell : grid.get(cellKey(a0.floor, ci + di, cj + dj));
        if (!other) continue;
        for (let x = 0; x < cell.length; x++) for (let y = other === cell ? x + 1 : 0; y < other.length; y++) contact(cell[x], other[y], dt, now);
      }
    }
    touching = now;
  }
  function contact(a, b, dt, now) {
    if (a.floor !== b.floor) return;
    const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2], r = a.half + b.half;
    if (dx * dx + dz * dz >= (r + 0.08) * (r + 0.08)) return;
    const d = Math.hypot(dx, dz), key = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id, was = touching.has(key);
    if (d >= r + (was ? 0.08 : 0)) return;                                    // a contact lasts until they're clear of it
    now.add(key);
    if (!was) {
      a.bumped = b.bumped = clock + 0.5;
      queue.push({ type: "bumped", id: a.id, by: b.id }, { type: "bumped", id: b.id, by: a.id });
    }
    if (d >= r) return;
    const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
    // someone standing still holds their ground: the walker takes the whole nudge
    const am = !!a.doing, bm = !!b.doing, share = am && bm ? 0.5 : 1, push = Math.min((r - d) * share, 1.2 * dt);
    // meeting head-on, each also gives way to their own right, so the two slip past rather than push in a line
    const headOn = Math.sin(a.heading) * Math.sin(b.heading) + Math.cos(a.heading) * Math.cos(b.heading) < -0.3;
    for (const [o, k] of [[a, -push], [b, push]]) {
      if (!o.doing && (am || bm)) continue;
      o.touching = clock + 0.2;
      const side = headOn && o.doing ? 0.5 * Math.abs(k) : 0;
      const x = o.pos[0] + ux * k - Math.cos(o.heading) * side, z = o.pos[2] + uz * k + Math.sin(o.heading) * side, y = standAt(o, x, z);
      if (y == null) continue;
      o.pos[0] = x; o.pos[1] = y; o.pos[2] = z; hold(o);
    }
  }

  // Walking: along the route at the person's own speed; the phase advances only while walking, at their own cadence.
  function step(rec, dt, live = false) {
    const d = rec.doing;
    if (!d || d.verb !== "goTo" || d.planning) return;
    const pace = d.opts?.pace ?? 1, v = rec.speed * pace;
    let left = v * dt;
    let startLeft = left;
    const last = d.leg === d.route.length - 1;
    const rest = d.leg < d.route.length ? Math.hypot(d.route[d.leg][0] - rec.pos[0], d.route[d.leg][2] - rec.pos[2]) : 0;
    // Progress: if the next waypoint hasn't come 0.3 m closer in 3 s (people standing in the way, a gap too narrow,
    // or a detour that left the route), ask for a new route from where they stand; with no router, squeeze straight
    // through for 2 s rather than dither forever. No stepping aside on the last stretch either: someone may be
    // standing where they're going.
    if (live) {
      const pr = rec.progress ?? (rec.progress = { leg: -1, best: Infinity, since: clock, squeeze: 0 });
      if (pr.leg !== d.leg || rest < pr.best - 0.3) { pr.leg = d.leg; pr.best = rest; pr.since = clock; }
      else if (clock - pr.since > 3) {
        pr.since = clock; pr.best = rest;
        if (ctx.walk?.route) { rec.replan = true; return; } else pr.squeeze = clock + 2;
      }
    }
    const squeezing = live && rec.progress.squeeze > clock;
    // a corner of the route someone else is standing on, while touching them: close enough, on to the next waypoint
    // (the straight line from here is checked for ground, as after a sidestep)
    if (live && rec.touching > clock && d.leg < d.route.length - 1 && rest < rec.half + 0.35) { d.leg++; rec.offRoute = true; }
    if (live && rec.bumped > clock) startLeft = left *= 0.6;                  // a bump: a moment's slowing
    if (!squeezing && live && avoid && d.leg < d.route.length && !(last && rest < 1.2)) {
      const p = d.route[d.leg], dx = p[0] - rec.pos[0], dz = p[2] - rec.pos[2];
      const fresh = rec.aside === undefined || (frameNo + Math.floor(rec.rank * 4)) % 4 === 0;
      const dec = fresh ? choose(rec, dx, dz, v, left) : rec.aside;
      rec.aside = dec;
      if (dec === null) {                                                     // blocked: stand, feet still
        rec.waited = (rec.waited ?? 0) + dt;
        // after 1.5 s, go on regardless for a moment, brushing past (bumps keep it to a brush), as people do
        if (rec.waited > 1.5) { rec.progress.squeeze = clock + 1.2; rec.waited = 0; rec.aside = undefined; }
        return;
      }
      rec.waited = 0;
      left *= dec.pace;
      startLeft = left;
      if (dec.turn !== 0) {                                                   // a sidestep this frame, on standable ground
        const h = Math.atan2(dx, dz) + dec.turn, x = rec.pos[0] + Math.sin(h) * left, z = rec.pos[2] + Math.cos(h) * left;
        const y = standAt(rec, x, z);
        if (y == null) { rec.aside = undefined; return; }                    // the kept decision ran out of floor
        rec.heading = h; rec.pos[0] = x; rec.pos[1] = y; rec.pos[2] = z;
        rec.phase = (rec.phase + rec.rate * pace * dt * (left / (v * dt))) % 1;
        rec.offRoute = true; rec.lastGood = rec.pos.slice();
        hold(rec);
        return;
      }
    }
    // Back from a sidestep, the straight line to the next waypoint isn't the route: check the ground on the way, and
    // stand rather than cut into an edge (the sidestep choice, decided afresh, finds a way that has ground).
    if (live && rec.offRoute && ctx.walk?.stand && d.leg < d.route.length) {
      const p = d.route[d.leg], dx = p[0] - rec.pos[0], dz = p[2] - rec.pos[2], dist = Math.hypot(dx, dz), k = Math.min(left, dist) / (dist || 1);
      const y = standAt(rec, rec.pos[0] + dx * k, rec.pos[2] + dz * k);
      if (y == null) { rec.aside = undefined; rec.waited = (rec.waited ?? 0) + dt; return; }
      rec.lastGood = [rec.pos[0] + dx * k, y, rec.pos[2] + dz * k];
    }
    while (left > 0 && d.leg < d.route.length) {
      const p = d.route[d.leg], dx = p[0] - rec.pos[0], dz = p[2] - rec.pos[2], dist = Math.hypot(dx, dz);
      if (dist > 1e-6) rec.heading = Math.atan2(dx, dz);
      if (dist <= left) { rec.pos[0] = p[0]; rec.pos[1] = p[1] ?? rec.pos[1]; rec.pos[2] = p[2]; left -= dist; d.leg++; rec.offRoute = false; rec.lastGood = rec.pos.slice(); }
      else {
        // height follows the segment (stairs, slopes): a straight line from here to the waypoint's height
        if (p[1] != null) rec.pos[1] += (p[1] - rec.pos[1]) * (left / dist);
        rec.pos[0] += dx / dist * left; rec.pos[2] += dz / dist * left; left = 0;
      }
    }
    // the feet move only while walking: the phase advances for the time actually walked
    rec.phase = (rec.phase + rec.rate * pace * ((startLeft - left) / v)) % 1;
    const room = ctx.place?.roomAt?.(rec.pos, rec.floor);    // without a place to ask, a person stays in their room
    if (room != null) setRoom(rec, room);
    hold(rec);
    if (d.leg >= d.route.length) { rec.doing = null; queue.push({ type: "arrived", id: rec.id, at: { pos: rec.pos.slice(), floor: rec.floor, room: rec.room } }); }
  }

  // Tier by distance, scaled by rank (higher rank comes near from further away), with hysteresis against flicker.
  function tierFor(rec, d) {
    const k = 0.6 + 0.8 * rec.rank, near = thresholds.near * k, mid = thresholds.mid * k;
    const prev = rec.tier, h = 1 + hysteresis, l = 1 - hysteresis;
    if (prev === "near") return d < near * h ? "near" : d < mid ? "mid" : "far";
    if (prev === "mid") return d < near * l ? "near" : d < mid * h ? "mid" : "far";
    if (prev === "far") return d < near * l ? "near" : d < mid * l ? "mid" : "far";
    return d < near ? "near" : d < mid ? "mid" : "far";
  }

  /**
   * Advance everyone who costs anything, and sort the seen into tiers.
   * @param cam { pos: [x, y, z], sees?: (center, radius) -> bool }  (draw.js passes the camera frustum)
   * @returns { near: [rec], mid: [rec], far: [rec], visited } — visited counts the people iterated this frame
   */
  function tick(t, dt, cam) {
    const out = { near: [], mid: [], far: [], visited: 0 };
    clock += dt; frameNo++;
    // routes being searched, within a node budget shared round-robin
    for (let budget = planBudget, k = 0; planners.length && budget > 0 && k < planners.length * 2; k++) {
      const pl = planners.shift(), slice = Math.max(1, Math.floor(budget / (planners.length + 1)));
      budget -= slice;
      if (pl.rec.doing?.token !== pl.token || !people.has(pl.rec.id)) continue;   // superseded or removed
      const r = pl.stepper.step(slice);
      if (r === undefined) planners.push(pl); else setRoute(pl.rec, r);
    }
    // arrivals due for people nobody steps (people being stepped arrive by walking, detours and all)
    while (arrivals.length && arrivals[0].time <= clock + 1e-9) {
      const e = heapPop(), rec = people.get(e.id);
      if (!rec || rec.doing?.token !== e.token) continue;
      if (active(rec)) {                         // being stepped: look again when they should be there by now
        const d = rec.doing; if (!d.route) continue;
        let len = 0, prev = rec.pos;
        for (let k = d.leg; k < d.route.length; k++) { len += Math.hypot(d.route[k][0] - prev[0], d.route[k][2] - prev[2]); prev = d.route[k]; }
        heapPush({ time: clock + Math.max(0.25, len / (rec.speed * (d.opts?.pace ?? 1))), id: rec.id, token: e.token });
        continue;
      }
      catchUp(rec);
      if (rec.doing?.token === e.token && rec.doing.route) { const end = rec.doing.route[rec.doing.route.length - 1]; rec.pos[0] = end[0]; rec.pos[2] = end[2]; rec.doing.leg = rec.doing.route.length; step(rec, 0); }
    }
    const ids = [];
    if (shown) { for (const r of shown) { const s = rooms.get(r); if (s) for (const id of s) ids.push(id); } }
    else for (const s of rooms.values()) for (const id of s) ids.push(id);
    // who is where, for avoiding each other and bumping: everyone stepped this frame, on a 2 m grid
    grid = new Map();
    const live = [];
    for (const id of ids) {
      const rec = people.get(id);
      if (!rec || rec.presence === "offscene") continue;
      rec.vel ??= [0, 0];
      live.push(rec);
      const key = cellOf(rec.floor, rec.pos[0], rec.pos[2]);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(rec);
    }
    for (const id of ids) {
      const rec = people.get(id); if (!rec) continue;
      if (rec.presence === "offscene") continue;
      out.visited++;
      if (rec.lastClock < clock - dt - 1e-9) catchUp(rec);                     // back from hidden: catch up at once
      if (rec.lastClock < clock) {
        const x0 = rec.pos[0], z0 = rec.pos[2], h0 = rec.heading, span = clock - rec.lastClock;
        step(rec, span, true); rec.lastClock = clock;
        rec.vel[0] = (rec.pos[0] - x0) / span; rec.vel[1] = (rec.pos[2] - z0) / span;
        // the body turns at most TURN_RATE: a sidestep's new heading is eased into, never snapped
        let dh = rec.heading - h0; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
        const most = TURN_RATE * span;
        if (Math.abs(dh) > most) rec.heading = h0 + Math.sign(dh) * most;
      }
      if (rec.replan) {
        rec.replan = false;
        // a fresh route starts from ground this body can stand on: if they've strayed off it, back to the last spot that was
        if (rec.lastGood && ctx.walk?.stand && standAt(rec, rec.pos[0], rec.pos[2]) == null) { rec.pos[0] = rec.lastGood[0]; rec.pos[1] = rec.lastGood[1]; rec.pos[2] = rec.lastGood[2]; hold(rec); }
        rec.offRoute = false;
        if (rec.doing) goTo(rec.id, rec.doing.target, rec.doing.opts);
      }
      rec.seen = false;
      if (rec.presence !== "at_scene" || !cam) continue;
      const c = [rec.pos[0], rec.pos[1] + rec.height / 2, rec.pos[2]];
      if (cam.sees && !cam.sees(c, rec.height / 2 + rec.half)) { rec.tier = null; continue; }
      rec.seen = true;
      const d = Math.hypot(c[0] - cam.pos[0], c[1] - cam.pos[1], c[2] - cam.pos[2]);
      rec.tier = tierFor(rec, d);
      out[rec.tier].push(rec);
    }
    if (avoid && dt > 0) bumps(live, dt);
    return out;
  }

  // A capsule per person (feet to crown, radius `half`), the same at every tier. Returns the nearest hit.
  function hit(origin, dir) {
    const dl = Math.hypot(...dir), D = dir.map(v => v / dl);
    let best = null;
    const ids = [];
    if (shown) { for (const r of shown) { const s = rooms.get(r); if (s) for (const id of s) ids.push(id); } }
    else for (const s of rooms.values()) for (const id of s) ids.push(id);
    for (const id of ids) {
      const rec = people.get(id);
      if (!rec || rec.presence !== "at_scene") continue;
      const t = rayCapsule(origin, D, [rec.pos[0], rec.pos[1] + rec.half, rec.pos[2]], [rec.pos[0], rec.pos[1] + rec.height - rec.half, rec.pos[2]], rec.half);
      if (t !== null && (!best || t < best.distance)) best = { id: rec.id, distance: t };
    }
    return best;
  }

  function state(id) {
    const rec = people.get(String(id)); if (!rec) return null;
    catchUp(rec);
    const d = rec.doing;
    return {
      at: { pos: rec.pos.slice(), floor: rec.floor, room: rec.room }, heading: rec.heading, phase: rec.phase,
      doing: d ? { verb: d.verb, target: d.target, opts: d.opts } : null, holding: rec.holding, presence: rec.presence,
    };
  }

  return {
    add, remove, goTo, face, tick, hit, state,
    get: (id) => people.get(String(id)) ?? null,
    where(id) { const rec = people.get(String(id)); if (!rec) return null; catchUp(rec); return { pos: rec.pos.slice(), floor: rec.floor, room: rec.room }; },
    all: () => [...people.values()],
    show(roomIds) { shown = roomIds == null ? null : new Set(roomIds); },
    presence(id, mode) { const rec = people.get(String(id)); if (rec) rec.presence = mode; },
    events() { const e = queue; queue = []; return e; },
    thresholds,
  };
}

// Ray against a vertical capsule (segment a–b, radius r): the distance along the unit ray, or null.
export function rayCapsule(o, d, a, b, r) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], oa = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
  const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-12) {
    const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  // the caps
  let best = null;
  for (const c of [a, b]) {
    const oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]], bb = dot(oc, d), cc = dot(oc, oc) - r * r, hh = bb * bb - cc;
    if (hh >= 0) { const t = -bb - Math.sqrt(hh); if (t >= 0 && (best === null || t < best)) best = t; }
  }
  return best;
}
