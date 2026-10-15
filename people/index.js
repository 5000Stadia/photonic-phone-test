// makePeople (design/interface.md, agreed with holo-emitter 2026-10-11): one population per world. It owns every
// person's drawing, tiers and per-frame work; a person is a handle of commands and data, never a scene object.
// Built in R4 over population.js (data) and draw.js (three instanced tiers). What waits for later milestones answers
// honestly: use (M4) returns false; perceives() is empty until M4's perception; say() keeps the speech
// contract's timing and events now, and the face that speaks arrives with M5.

import { clearOutfitCaches } from "./garments/outfit.js";
import { clearReducedCaches } from "./garments/reduced.js";
import { clearBindingCaches } from "./garments/bind.js";
import { clearPaletteCaches } from "./garments/worn.js";

import { makePopulation } from "./population.js";
import { makeDraw } from "./draw.js";
import { GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN } from "./garments/outfit.js";

// /1 promises makePeople(THREE, {basis, quality, outfits, ...}); add/get/all/goTo;
// person.wear(garments) and worn(); warm(); compile(renderer, scene, camera, opts);
// tick(t, dt, camera); events(); dump(); dispose().
export const PEOPLE_API = "photonic.people/1";

const WORDS_PER_SECOND = 2.6;   // a default speaking pace when a line has no duration and no clock

export function makePeople(THREE, { ctx = {}, basis, thresholds, planBudget, capacity, exactCapacity, nearCapacity, bakeBudgetMs, outfits, quality, overflow, samePace = true, exactArms = false, easeWalks = false, review = false } = {}) {
  // exactArms: each walker finds its own minimal arm openings over its own clothes (about 12 ms a person, once) instead of the nearest padded bin's
  // easeWalks: walks start and stop over about half a second (population.js), which the stand hand-overs read best with; it changes trip timing
  let pop = makePopulation({ ctx, basis, thresholds, planBudget, samePace, exactArms, easeWalks, ...(outfits !== undefined ? { outfits } : {}) });
  // review: the animation review page only (lab/hero-motion), where a person may be shown nude to judge the motion and the body (draw.js makeDraw)
  let draw = makeDraw(THREE, { capacity, exactCapacity, nearCapacity, bakeBudgetMs, quality, overflow, review });
  const frustum = new THREE.Frustum(), m4 = new THREE.Matrix4(), sphere = new THREE.Sphere(), v = new THREE.Vector3(), w = new THREE.Vector3();
  const speaking = new Map();       // id -> { line, start, end, to }
  let now = 0, extra = [], counts = { near: 0, mid: 0, far: 0, classes: 0, passes: 0 };

  let disposed = false;
  const commands = new Set();
  // Drop the implementations as well as guarding them: retained person handles must
  // not keep records, baked bodies or the draw's CPU arrays alive after disposal.
  function guarded(object) {
    for (const key of Reflect.ownKeys(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (typeof descriptor.value !== "function" && !descriptor.get) continue;
      const command = { fn: descriptor.get ?? descriptor.value };
      commands.add(command);
      const call = (...args) => {
        if (disposed) throw new Error("people: disposed; create a new population before use");
        return command.fn(...args);
      };
      Object.defineProperty(object, key, descriptor.get ? { ...descriptor, get: call } : { ...descriptor, value: call });
    }
    return object;
  }

  function handle(rec) {
    if (!rec) return null;
    const id = rec.id;
    return guarded({
      id, rank: rec.rank,
      get recipe() { return rec.res.recipe; },
      where: () => pop.where(id),
      goTo: (target, opts) => pop.goTo(id, target, opts),
      face: (target) => pop.face(id, target),
      sit: (thing, opts) => pop.sit(id, thing, opts), stand: () => pop.stand(id), use: () => false,          // M4, through works.js
      say(line, { to = null, clock = null, duration = null } = {}) {
        if (speaking.has(id)) extra.push({ type: "said_end", id, line: speaking.get(id).line, interrupted: true });
        const d = duration ?? Math.max(0.6, String(line).split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND);
        speaking.set(id, { line, to, clock, start: now, end: clock ? null : now + d, duration: d });
        extra.push({ type: "said_start", id, line });
        return true;
      },
      perceives: () => ({ seen: [], heard: [] }),                       // M4
      // What they wear (R5, "Clothes as objects"; garments/worn.js). `wear(garments)` gives them these garments, [{ id, kind, aspects: { colour, material, condition, pattern } }] (pattern-buffer's worn objects), in place of what they had,
      // and answers the dressing: { drawn, unworn, notDrawn (a kind we have no template for, or one covered by a more outer one), conflicts (two in one slot: the outermost wins), fallback (the nearest class we can draw,
      // when none draws the set), colours, class, shift }. The shift is always on: wear([]) leaves it. Nobody is drawn unclothed. A change of outfit package makes the draw bake it again; a change of colour or of
      // what is worn within a package is read at the next frame.
      // The old form stays: `wear("bodice" | "skirt", false)` takes the torso's or the legs' garments off (the draw switches to the class without it, the base layer stays), `true` puts them on. It returns false for someone who wears
      // no outfit or no such garment.
      wear(garment, on = true) {
        if (Array.isArray(garment)) { const r = rec.setGarments(garment); if (r.restyled) draw.release(rec); return r.attire; }
        const d = rec.dressing; if (!d || !(garment in d.wear)) return false; d.wear[garment] = !!on; return true;
      },
      worn: () => rec.garments(),             // the garments they wear, [{ id, kind, aspects }], the shift among them
      // the review page only (makePeople review): "nude" (no base layer, no stockings or shoes) or "under" (the base layer only) over whatever
      // they wear (wear([]) to take the garments off), null as worn; false where review is off
      reviewBody(mode) { if (!review) return false; rec.reviewBody = mode === "nude" ? 1 : mode === "under" ? 2 : 0; return true; },
      dressing: () => rec.attire,             // the report of the last wear (or of what the crowd's rule gave them): what is drawn and what is not
      bounds: () => ({ half: rec.half, height: rec.height, reach: 0.42 * rec.height }),
      state: () => pop.state(id),
    });
  }

  const api = guarded({
    group: draw.group,
    setSamePace: (value) => pop.setSamePace(value),
    setOverflow: (value) => draw.setOverflow(value),
    /** Make the draws a renderer will need (the base class, and the placeholder rule's four outfits (gentlewoman, gentleman, workwoman, workman) unless `outfits` is false or a rule of your own, whose outfits `list` names) before anyone is seen, so `renderer.compileAsync(scene, camera)` can compile them
     *  behind a loading screen instead of at the first frame. Returns how many draws there are. Draws made later, for a class not warmed, still come when someone is first in it. */
    warm: (list) => draw.warm(list ?? (outfits === false || outfits !== undefined ? [] : [GENTLEWOMAN, GENTLEMAN, WORKWOMAN, WORKMAN])),
    /** Compile what warm() made on a renderer, concurrently (see draw.js compile), the skirts' render-to-texture passes too, which `renderer.compileAsync(scene, camera)` does not reach. Use it beside that call:
     *  `await Promise.all([renderer.compileAsync(scene, camera), people.compile(renderer, scene, camera)])`, with the group already in the scene. */
    compile: (renderer, scene, camera, opts) => draw.compile(renderer, scene, camera, opts),
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
      counts = draw.update(pop.tick(t, dt, cam), t);
      return counts;
    },
    add: (doc) => handle(pop.add(doc)),
    remove(id) { const rec = pop.get(id); if (rec) draw.release(rec); speaking.delete(String(id)); return pop.remove(id); },
    goTo: (id, target, opts) => pop.goTo(id, target, opts),
    get: (id) => handle(pop.get(id)),
    all: () => pop.all().map(handle),
    /** Deterministic continuity record: one line per id, with rounded spatial and colour values. */
    dump: () => pop.dump(),
    hit(raycaster) { const o = raycaster.ray.origin, d = raycaster.ray.direction; return pop.hit([o.x, o.y, o.z], [d.x, d.y, d.z]); },
    show: (roomIds) => pop.show(roomIds),
    presence: (id, mode) => pop.presence(id, mode),
    events() { const e = [...extra, ...pop.events()]; extra = []; return e; },
    stats: () => ({ ...counts, bytes: draw.bytes() }),
    /** What someone is drawn doing this frame, for diagnostics and the Lab's motion pages: { kind: walk | held | stop | idle | start | rise | sitIn | sitDown | seated | standUp, slot, phase }, or null before they are drawn. */
    animation(id) { const rec = pop.get(id); return rec ? draw.animation(rec) : null; },
    /** Diagnostics for the Lab's motion pages: the person's record, what they are drawn doing, and the pose drawn ({ W, P } in their frame). Not a contract. */
    inspect(id) { const rec = pop.get(id); return rec ? { rec, animation: draw.animation(rec), pose: draw.pose(rec) } : null; },
  });
  let disposal;
  // Normally synchronous; await the result if renderer compilation is in flight.
  api.dispose = () => {
    if (disposed) return disposal;
    disposed = true;
    disposal = draw.dispose();
    pop.dispose();
    clearOutfitCaches();
    clearReducedCaches();
    clearBindingCaches();
    clearPaletteCaches();
    speaking.clear(); extra = [];
    for (const command of commands) command.fn = null;
    commands.clear();
    draw = pop = null;
    return disposal;
  };
  return api;
}
