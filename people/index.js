// makePeople (design/interface.md, agreed with holo-emitter 2026-10-11): one population per world. It owns every
// person's drawing, tiers and per-frame work; a person is a handle of commands and data, never a scene object.
// Built in R4 over population.js (data) and draw.js (three instanced tiers). What waits for later milestones answers
// honestly: sit/stand/use (M4) return false; perceives() is empty until M4's perception; say() keeps the speech
// contract's timing and events now, and the face that speaks arrives with M5.

import { makePopulation } from "./population.js";
import { makeDraw } from "./draw.js";

const WORDS_PER_SECOND = 2.6;   // a default speaking pace when a line has no duration and no clock

export function makePeople(THREE, { ctx = {}, basis, thresholds, planBudget, capacity, exactCapacity, nearCapacity, bakeBudgetMs } = {}) {
  const pop = makePopulation({ ctx, basis, thresholds, planBudget });
  const draw = makeDraw(THREE, { capacity, exactCapacity, nearCapacity, bakeBudgetMs });
  const frustum = new THREE.Frustum(), m4 = new THREE.Matrix4(), sphere = new THREE.Sphere(), v = new THREE.Vector3(), w = new THREE.Vector3();
  const speaking = new Map();       // id -> { line, start, end, to }
  let now = 0, extra = [], counts = { near: 0, mid: 0, far: 0 };

  function handle(rec) {
    if (!rec) return null;
    const id = rec.id;
    return {
      id, rank: rec.rank,
      get recipe() { return rec.res.recipe; },
      where: () => pop.where(id),
      goTo: (target, opts) => pop.goTo(id, target, opts),
      face: (target) => pop.face(id, target),
      sit: () => false, stand: () => false, use: () => false,          // M4, through works.js
      say(line, { to = null, clock = null, duration = null } = {}) {
        if (speaking.has(id)) extra.push({ type: "said_end", id, line: speaking.get(id).line, interrupted: true });
        const d = duration ?? Math.max(0.6, String(line).split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND);
        speaking.set(id, { line, to, clock, start: now, end: clock ? null : now + d, duration: d });
        extra.push({ type: "said_start", id, line });
        return true;
      },
      perceives: () => ({ seen: [], heard: [] }),                       // M4
      bounds: () => ({ half: rec.half, height: rec.height, reach: 0.42 * rec.height }),
      state: () => pop.state(id),
    };
  }

  return {
    group: draw.group,
    tick(t, dt, camera) {
      now = t;
      camera.updateMatrixWorld();
      m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(m4);
      const cam = { pos: camera.getWorldPosition(v).toArray(), sees: (c, r) => frustum.intersectsSphere(sphere.set(w.fromArray(c), r)) };
      for (const [id, s] of speaking) {
        const done = s.clock ? s.clock() >= s.duration : t >= s.end;
        if (done) { speaking.delete(id); extra.push({ type: "said_end", id, line: s.line }); }
      }
      counts = draw.update(pop.tick(t, dt, cam));
      return counts;
    },
    add: (doc) => handle(pop.add(doc)),
    remove(id) { const rec = pop.get(id); if (rec) draw.release(rec); speaking.delete(String(id)); return pop.remove(id); },
    get: (id) => handle(pop.get(id)),
    all: () => pop.all().map(handle),
    hit(raycaster) { const o = raycaster.ray.origin, d = raycaster.ray.direction; return pop.hit([o.x, o.y, o.z], [d.x, d.y, d.z]); },
    show: (roomIds) => pop.show(roomIds),
    presence: (id, mode) => pop.presence(id, mode),
    events() { const e = [...extra, ...pop.events()]; extra = []; return e; },
    stats: () => ({ ...counts, bytes: draw.bytes() }),
  };
}
