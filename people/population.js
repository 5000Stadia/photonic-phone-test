import {seatPlace,armsOf} from './seats.js';
import {loadSitting,makeSitting} from './sitting.js';
import {desiredSpeed,setWalkSpeed} from './pace-walk.js';
import {WALK_EASE,walkEaseAt,walkedBy} from './motion.js';
import {loadMoves,movesReady,makeMove,moveShape,movePath,MOVE_DEFS} from './moves.js';
import {PACE_FRAMES} from './walk.js';
import {makeIdleWalker} from './mocap.js';
// The population's data layer (R4; design/r4-plan.md): the people store, ranks, tiers, walking, presence, rooms, state,
// events and hit, in pure JS with no three.js, so node tests it. draw.js reads what tick() returns; index.js wires the
// two into makePeople (design/interface.md).
//
// Engine principles (holo-emitter): rank from a hash of the id, compared once against thresholds everywhere; every
// look from a hash, never a random stream in build order; phase advances in seconds.

import { parse } from "../traits/lexicon.js";
import { hairFor } from "./hair.js";
import { dumpPeople } from "./dump.js";
import { resolve } from "../traits/resolve.js";
import { uniform, seedOf } from "../traits/stream.js";
import { paramsFor, build, buildNear, farBody } from "./bodies.js";
import { makeWalker } from "./walk.js";
import { outfitFor, dressGarments, dressingOfWorn } from "./outfits.js";
import { resolveOutfit, baseOnly } from "./garments/worn.js";
import { look as silkLook } from "./garments/outfit.js";
import { thighCover } from "./garments/skirt.js";
import { KINDS } from "./garments/kinds.js";
const KINDS_SLOT = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.slot]));

// A person's record. A class, not an object with a getter per person: the record is read in every loop of the tick, and records that share one shape (every field made here, in the
// same order, the getters on the prototype) keep those reads fast, where per-person getters gave each record a shape of its own. What is built, it is built on first need, so people
// never seen or walked cost nothing beyond their resolution.
class Person {
  constructor(f, env) {
    this.id = f.id; this.doc = f.doc; this.seed = f.seed; this.res = f.res; this.values = f.res.values; this.rank = f.rank;
    this.pos = f.pos; this.floor = f.floor; this.room = f.room; this.heading = f.heading; this.phase = f.phase;
    this.sitting = null; this.sitMotion = null; this.sitToken = 0; this.afterStand = null;
    this.move = null; this.feet = null; this.moveWish = null;      // a captured move under way (moves.js), where a standing person's feet are, a stop or goTo waiting on a move
    this.doing = null; this.holding = f.holding; this.presence = f.presence; this.tier = null; this.seen = false;
    this.height = f.height; this.lastClock = f.lastClock; this.goToken = 0; this.half = Math.max(0.18, 0.13 * f.height);
    this.reviewBody = 0;         // the review page's body (draw.js makeDraw `review`): 0 as worn, 1 nude, 2 the undergarments; never set in the crowd
    this.env = env; this.gone = false;
    // what the walking keeps (population.js) and the drawing keeps (draw.js), all here so the shape never changes
    this.vel = undefined; this.aside = undefined; this.waited = undefined; this.progress = undefined; this.touching = undefined;
    this.contacts = new Map(); this.recovery = null; this.moveLeft = 0; this.tickX = 0; this.tickZ = 0;
    this.offRoute = undefined; this.lastGood = undefined; this.replan = undefined;
    this.walkDistance = 0; this.walkPhase = undefined; this.walkSlot = undefined; this.tint = undefined; this.skin = undefined; this._cshift = undefined; this._cbodice = undefined; this._cskirt = undefined; this._cstockings = undefined; this._cbare = undefined; this.nearGarment = undefined; this.specRow = undefined;
    this.hair = hairFor(this.values, this.seed, this.res.derived, Object.fromEntries((typeof this.res.recipe.said === "string" ? parse(this.res.recipe.said).constraints : this.res.recipe.said.constraints ?? []).map(c => [c.trait,true])));
    this._hairBody = null;
    this._params = null; this._body = null; this._far = null; this._walker = undefined; this._dressing = undefined; this._attire = null; this._whole = null; this._garments = undefined; this._prefer = null; this._speed = undefined; this._rate = undefined;
  }
  // (doc.body: the review page's body sliders, laid over what the traits give: { sex (the gender slider 0..1), age, build, muscle, height (m), skin })
  get bodyParams() { return (this._params ??= this.doc?.body ? { ...paramsFor(this.res.values, this.res.derived), ...this.doc.body } : paramsFor(this.res.values, this.res.derived)); }
  get body() { return (this._body ??= build(this.bodyParams)); }
  buildNear() { return buildNear(this.bodyParams); }               // the near tier's full body, built when drawn near, not kept
  get far() { return (this._far ??= farBody(this.bodyParams)); }   // the far tier's person and the walker's joints, from the table: no body is built for them
  // what the person wears (outfits.js; a placeholder rule until M3's sampler): null for the base layer only. A wearer's skirt widens the radius they ask of the floor, and their
  // walker keeps the arms out of the skirt (keepout.js), baked into the walk.
  get dressing() { if (this._dressing === undefined) this._dress(); return this._dressing; }
  /** The report of what they wear and what of it is drawn (garments/worn.js resolveWorn): always there, for the base layer only too. An outfit worn whole (the crowd's rule) has its report made when it is asked for. */
  get attire() {
    if (this._dressing === undefined) this._dress();
    return this._attire ??= resolveOutfit(this._dressing.outfit, this._whole, this.id, this.res.values.age);
  }
  // Dress the person: from the garments they were given (wear(list)), else from the rule (a rule answers an outfit, `{ outfit, look }` when it also chooses the colours (dress-words.js), or a list of garments: { garments }).
  // An outfit is a thin wrapper: it is the list of garments it is (garmentsOf), worn whole, and that is all the 300 people added at load need, so nothing more is made for them until the report is asked for.
  _dress() {
    const v = this.res.values, rule = this.env.outfits;
    let garments = this._garments, prefer = this._prefer ?? null, none = null;       // (prefer: what they were wearing before, so taking things off keeps their cut)
    this._attire = null; this._whole = null;
    if (garments === undefined) {
      const o = rule ? rule(this.id, v) : null, arr = Array.isArray(o) ? o : o?.garments;
      if (arr) garments = arr;
      else if (o) {
        const only = o.outfit ?? o, lk = { ...silkLook(uniform(0, this.id, "silk"), only, uniform(0, this.id, "hose")), ...(o.outfit ? o.look : undefined) };
        lk.shift = only.palette.shift; this._whole = lk;
        this._dressing = dressingOfWorn({ outfit: only, look: lk, mask: 3 }, this.bodyParams, this.far.J);
        return this._settle();
      } else none = rule ? "the crowd's rule gives no outfit" : "nobody is dressed";
    }
    if (none) { this._dressing = null; this._attire = baseOnly([], none); }
    else {
      const r = dressGarments(this.id, garments, this.bodyParams, this.far.J, { age: v.age, sex: v.sex }, { prefer });
      this._dressing = r.dressing; this._attire = r.attire;
    }
    this._settle();
  }
  _settle() {          // her skirt's radius is part of her footprint
    this.half = Math.max(0.18, 0.13 * this.height);
    if (this._dressing) this.half = Math.max(this.half, this._dressing.footprint);
  }
  /** The garments they are wearing, [{ id, kind, aspects }], the shift among them: the ones they were given, or the outfit the rule dressed them in as garments. What the old `wear("bodice" | "skirt", false)` took off is not in it. */
  garments() {
    const d = this.dressing, a = this.attire;
    let list = a.garments.map((g) => ({ ...g, aspects: { ...g.aspects } }));
    if (!list.some((g) => g.kind === "shift")) list.unshift({ id: `${this.id}/shift`, kind: "shift", aspects: { colour: d?.look.shift ?? "white", material: "linen" } });
    if (d) list = list.filter((g) => { const k = KINDS_SLOT[g.kind], w = d.wear; return !((k === "torso" || k === "neck") && !w.bodice) && !((k === "legs" || k === "over") && !w.skirt) && !(k === "neck" && w.neck === false) && !(k === "over" && w.apron === false) && !(k === "hose" && w.hose === false); });
    return list;
  }
  /** Give them these garments to wear (replacing what they had). Returns { attire, restyled }: the report, and whether the outfit package changed, so what was baked for the old one (the draw's slots, the walker's keep-out) must be made again. */
  setGarments(list) {
    const was = this._dressing === undefined ? this.dressing : this._dressing, before = was?.outfit?.id ?? null;
    this._prefer = was?.outfit ?? this._prefer ?? null;
    this._garments = (list ?? []).map((g, i) => ({ id: g?.id ?? `${this.id}/garment${i}`, kind: g?.kind ?? null, aspects: { ...(g?.aspects ?? {}) } }));
    this._dressing = undefined; this._cshift = this._cbodice = this._cskirt = this._cstockings = undefined; this._cbare = undefined; this.specRow = undefined;
    void this.dressing;
    const after = this._dressing?.outfit?.id ?? null, restyled = before !== after;
    if (restyled) this._walker = undefined;           // (the same gait, from the same seed: only the arms' keep-out for what is worn is made again)
    return { attire: this._attire, restyled };
  }
  get walker() {
    if (this._walker !== undefined) return this._walker;
    const v = this.res.values, basis = this.env.basis;
    const body = this.doc?.body, age = body?.age ?? v.age, sex = body?.sex !== undefined ? (body.sex > 0.5 ? 1 : body.sex < 0.5 ? -1 : 0) : v.sex === "male" ? 1 : v.sex === "female" ? -1 : 0;
    const w = (this._walker = basis ? makeWalker(this.far.J, { age, sex, seed: seedOf(`${this.seed}:${this.id}:walk`), walk: this.env.walk, samePace: this.env.samePace, exactArms: this.env.exactArms, height: this.height, build: this.bodyParams.build, keepout: this.dressing?.keepout }, basis) : null);
    if(w?.bank&&this.paceState)setWalkSpeed(w,this.paceState.speed);
    return w;
  }
  // Pace-bank speed and cadence change together; the legacy fitted plan is fixed.
  get speed() { return this.walker?.bank ? this.walker.v : (this._speed ??= this.walker ? this.walker.v : 1.3); }
  get rate() { return this.walker?.bank ? this.walker.f : (this._rate ??= this.walker ? this.walker.f : 0.9); }
  get built() { return this._body !== null; }
}

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
 * @param opts.walk        "mocap" (default) or "fitted" for the previous harmonic walker
 * @param opts.samePace    true (the default, Kabe 2026-10-15: the capture's own speed looks best): everyone at their body's Neutral capture speed; false: per-person pace
 * @param opts.avoid       false: walkers ignore each other (ghosts; the tests' baseline)
 * @param opts.outfits     (id, values) -> an outfit (garments/outfit.js) or null for the base layer only; false: nobody is dressed. Default: outfits.js's placeholder rule
 */
export function makePopulation({ ctx = {}, basis, walk = "mocap", thresholds = DEFAULT_THRESHOLDS, hysteresis = 0.1, planBudget = 4000, avoid = true, samePace = true, exactArms = false, easeWalks = false, moves = false, outfits = outfitFor } = {}) {
  const env = { outfits, basis, walk, samePace, exactArms, easeWalks, moves };
  const people = new Map();            // id -> record
  const rooms = new Map();             // room id -> Set of ids
  let shown = null;                    // null: every room shown
  let queue = [];                      // events since the last events()
  // (moves: captured starts, stops and the turn before a sit, moves.js; off by default: the crowd keeps its blended hand-overs, its digests pinned to them)
  if (moves) loadMoves().catch((e) => queue.push({ type: "moves_error", reason: e.message }));
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

  const roomSet = (room) => { if (!rooms.has(room)) rooms.set(room, new Set()); listed = null; return rooms.get(room); };
  // everyone in the rooms shown, in room order then arrival order, as records: rebuilt only when someone joins, leaves or changes room, or the rooms shown change
  let listed = null;
  const listOf = () => {
    if (listed) return listed;
    const out = [], take = (s) => { for (const id of s) { const r = people.get(id); if (r) out.push(r); } };
    if (shown) { for (const r of shown) { const s = rooms.get(r); if (s) take(s); } }
    else for (const s of rooms.values()) take(s);
    return (listed = out);
  };
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
    const height = doc.body?.height ?? (res.derived["body.height"] ?? 170) / 100;
    const rec = new Person({ id, doc, seed, res, rank: uniform(0, id, "rank"), pos, floor: at.floor ?? 0, room: roomOf(pos, at.floor ?? 0, at.room),
      heading: st.heading ?? 0, phase: st.phase ?? uniform(seed, id, "phase0"), holding: st.holding ?? null, presence: st.presence ?? "at_scene", height, lastClock: clock }, env);
    void rec.dressing;           // her skirt's radius is part of her footprint from the start (the stepping aside, the claims)
    people.set(id, rec);
    roomSet(rec.room).add(id);
    hold(rec);
    if (st.doing?.verb === "goTo") goTo(id, st.doing.target, st.doing.opts);
    if(st.paceState) {rec.paceState={...st.paceState};if(rec.walker?.bank)setWalkSpeed(rec.walker,rec.paceState.speed);}
    if (st.sitting) {
      rec.sitting = structuredClone(st.sitting);
      rec.afterStand = st.afterStand ? structuredClone(st.afterStand) : null;
      if (rec.sitting.segment !== 'approach') rec.doing = {verb:'sit'};
      prepareSit(rec).catch(error=>queue.push({type:'sit_error',id:rec.id,reason:error.message}));
    }
    return rec;
  }

  async function prepareSit(rec) {
    const sitting=rec.sitting,bank=await loadSitting();
    if(rec.gone || rec.sitting!==sitting)return false;
    const {J,tip}=rec.body.joints;
    let m=makeSitting(bank,J,tip,rec.height,sitting.seat.height,sitting.clip);
    // the hands: on the seat's armrests when it has them (seats.js armsOf), and, dressed, on the clothes over the thighs, measured on this sit's
    // own seated pose (garments/skirt.js thighCover)
    const d=rec.dressing,arms=armsOf(sitting);let cover=null;
    if(d?.wear?.skirt){
      const p=m.pose((m.spec.rest[0]+m.spec.rest[1])/2),bones={W:new Float64Array(189),P:new Float64Array(63)};
      p.W.forEach((w,b)=>bones.W.set(w,b*9));p.P.forEach((v,b)=>bones.P.set(v,b*3));
      cover=thighCover(d.specs,bones,{seat:sitting.seat.height,seatEdge:p.P[14][2]-.05});
    }
    if(cover||arms)m=makeSitting(bank,J,tip,rec.height,sitting.seat.height,m.spec.id,cover,arms);
    rec.sitMotion=m;
    sitting.clip=m.spec.id;
    return true;
  }
  async function sit(id,thing,opts={}) {
    const rec=people.get(String(id));if(!rec)return false;
    const place=seatPlace(ctx,thing,rec.id,opts.place);
    if(rec.sitting)return false;
    catchUp(rec);
    const token=++rec.sitToken;
    rec.sitting={...place,segment:'approach',time:0,clip:null};
    try {if(!await prepareSit(rec)||rec.sitToken!==token)return false;}
    catch(error){rec.sitting=null;rec.sitMotion=null;throw error;}
    if(!rec.sitMotion.fits) {
      queue.push({type:'sit_unfit',id:rec.id,seat:place.seat.id,report:{...rec.sitMotion.report}});
      rec.sitting=null;rec.sitMotion=null;return false;
    }
    const p=rec.sitMotion.pose(rec.sitMotion.spec.segments.sitDown[0]).P[0];
    const h=place.seat.facing,c=Math.cos(h),s=Math.sin(h);
    const y=ctx.floorAltitude?.(place.floor) ?? rec.pos[1];
    const target={pos:[place.contact[0]+c*p[0]+s*p[2],y,place.contact[1]-s*p[0]+c*p[2]],floor:place.floor};
    const sitting=rec.sitting;
    rec.sitting=null;
    const atSeat=Math.hypot(rec.pos[0]-target.pos[0],rec.pos[2]-target.pos[2])<.05 && rec.floor===target.floor;
    // with captured moves: the walk goes straight in to where the turn (or, arriving already nearly facing the seat's way, the stop) begins, and on a
    // little past it; the move begins on the way and ends on the sit-down's first place (sitPlan)
    const plan=!atSeat && movesOn(rec) && !rec.move ? sitPlan(rec,[target.pos[0],target.pos[2]],h) : null;
    if(plan){sitting.plan=plan;const g=[plan.S[0]+.6*Math.sin(plan.h),target.pos[1],plan.S[1]+.6*Math.cos(plan.h)];
      const ok=goTo(id,{pos:g,floor:place.floor},{pace:opts.pace??1});rec.sitting=sitting;if(!ok){rec.sitting=null;rec.sitMotion=null;return false;}return true;}
    const ok=atSeat ? (rec.doing=null,++rec.goToken,true) : goTo(id,target,{pace:opts.pace??1});
    rec.sitting=sitting;
    if(!ok){rec.sitting=null;rec.sitMotion=null;return false;}
    return true;
  }
  function stand(id) {
    const rec=people.get(String(id));if(!rec?.sitting)return false;
    catchUp(rec);++rec.sitToken;
    if(['approach','turn'].includes(rec.sitting.segment)) {rec.sitting=null;rec.sitMotion=null;rec.doing=null;++rec.goToken;return true;}
    if(rec.sitting.segment==='sitDown'){rec.sitting.standRequested=true;return true;}
    if(rec.sitting.segment!=='standUp'){rec.sitting.segment='standUp';rec.sitting.time=0;}
    return true;
  }
  function stepSit(rec,dt) {
    const s=rec.sitting,m=rec.sitMotion;
    if(!m)return s.segment!=='approach';
    if(s.segment==='approach') {
      if(rec.doing?.verb==='goTo')return false;
      s.segment='turn';s.time=0;s.turnFrom=rec.heading;rec.doing={verb:'sit'};
    }
    s.time+=dt;
    if(s.segment==='turn') {
      let d=s.seat.facing-s.turnFrom;d-=Math.round(d/(2*Math.PI))*2*Math.PI;
      rec.heading=s.turnFrom+d*Math.min(1,s.time/.5);
      if(s.time<.5)return true;
      s.segment='sitDown';s.time-=.5;delete s.turnFrom;
      rec.pos[0]=s.contact[0];rec.pos[2]=s.contact[1];rec.floor=s.floor;setRoom(rec,roomOf(rec.pos,rec.floor));hold(rec);
    }
    while(s.time>=m.durations[s.segment]) {
      s.time-=m.durations[s.segment];
      if(s.segment==='sitDown')s.segment=s.standRequested?'standUp':'seated';
      else if(s.segment==='standUp') {
        const P=m.pose(m.spec.segments.standUp[1]).P,p=P[0],h=s.seat.facing;
        rec.pos[0]+=Math.cos(h)*p[0]+Math.sin(h)*p[2];rec.pos[2]+=-Math.sin(h)*p[0]+Math.cos(h)*p[2];
        // (where the rise left the balls, about the pelvis: a captured start sets off from them, as the draw's idle stands on them)
        if(env.moves)rec.feet=[16,20].map(b=>[P[b][0]-p[0],P[b][2]-p[2]]);
        rec.sitting=null;rec.sitMotion=null;rec.doing=null;hold(rec);
        queue.push({type:'stood',id:rec.id,seat:s.seat.id});
        if(rec.afterStand){const next=rec.afterStand;rec.afterStand=null;rec.lastClock=clock;goTo(rec.id,next.target,next.opts);}
        return true;
      }
    }
    return true;
  }

  function remove(id) {
    const rec = people.get(String(id));
    if (!rec) return false;
    rooms.get(rec.room)?.delete(rec.id);
    people.delete(rec.id); rec.gone = true; listed = null;
    ctx.claims?.release?.(rec.id);
    return true;
  }

  function setRoom(rec, room) {
    if (room === rec.room) return;
    rooms.get(rec.room)?.delete(rec.id); rec.room = room; roomSet(room).add(rec.id); listed = null;
  }

  const posOf = (target) => {
    if (target == null) return null;
    if (Array.isArray(target)) return target;
    if (typeof target === "string") return people.get(target)?.pos ?? ctx.place?.thingAt?.(target) ?? null;
    return target.pos ?? null;
  };

  function updatePace(rec,dt) {
    const w=rec.walker;if(!w?.bank)return;
    const p=rec.paceState??={time:0,speed:w.v,tripTime:1,tripStart:w.v};
    const varying=w.age>=4&&w.age<15;
    if(!varying&&p.tripTime>=.8)return;
    if(varying)p.time=Math.round((p.time+dt)*1e9)/1e9;
    p.tripTime=Math.min(.8,Math.round((p.tripTime+dt)*1e9)/1e9);
    if(rec.doing&&(rec.doing.opts?.pace??1)>0) {
      const target=desiredSpeed(w,p.time,rec.doing.opts?.urgency)*(rec.doing.opts?.pace??1);
      const t=Math.min(1,p.tripTime/.8),ease=t*t*(3-2*t);
      setWalkSpeed(w,p.tripStart+(target-p.tripStart)*ease);p.speed=w.v;
    }
  }
  function catchUp(rec) {
    if(!rec.walker?.bank){if(rec.lastClock<clock){step(rec,clock-rec.lastClock);rec.lastClock=clock;}return;}
    // Variable pace cannot use a constant-speed arrival shortcut. Hidden people
    // use bounded time slices and retain the same seeded personal clock.
    while(rec.lastClock<clock-1e-9) {const dt=Math.min(1/60,clock-rec.lastClock);updatePace(rec,dt);step(rec,dt);rec.lastClock+=dt;}
    rec.lastClock=clock;
  }

  // goTo: the route may come at once, later (a Promise), or in slices (a stepper the tick advances within planBudget
  // nodes a frame). The person stands while it is searched. No way there: goTo is false (or the search ends in null)
  // and a no_way event says so. An empty route means they are already there.
  function goTo(id, target, opts = {}) {
    const rec = people.get(String(id)); if (!rec) return false;
    if(rec.sitting) {rec.afterStand={target,opts};stand(id);if(rec.sitting)return true;rec.afterStand=null;}
    catchUp(rec);
    const to = posOf(target); if (!to) return false;
    // babies don't walk: carried on a hip or in arms (carry.carrier, a later milestone), so goTo says so instead
    if (rec.values.age < 0.9) { queue.push({ type: "cannot_walk", id: rec.id, reason: "a baby is carried, not walked" }); return false; }
    // with captured moves (env.moves): a goTo while a move plays waits for its end; one to where a walker already is, is a stop (on at their pace until the
    // walk meets the stop's capture, then the stop: a person walking cannot stand still on the spot); one from standing begins with the captured start
    const walking = rec.doing?.verb === "goTo" && !rec.doing.planning && !rec.doing.opts?.inPlace;
    if (movesOn(rec)) {
      if (rec.move) { rec.moveWish = { goTo: [target, opts] }; return true; }
      rec.moveWish = null;
      // (a goal just ahead, nearer than a stop can come due and fit: the stop, landing on it as near as its steps allow)
      const dx = to[0] - rec.pos[0], dz = to[2] - rec.pos[2], near = Math.hypot(dx, dz), ahead = dx * Math.sin(rec.heading) + dz * Math.cos(rec.heading);
      const straight = ahead > 0.05 && Math.abs(dx * Math.cos(rec.heading) - dz * Math.sin(rec.heading)) < 0.15;
      if (walking && !opts.inPlace && (near < 0.4 || (near < 1.2 * rec.height / 1.78 && straight))) {
        const h = rec.heading; rec.moveWish = { stop: true, goal: straight ? [to[0], to[2]] : null };
        rec.doing.route = [[rec.pos[0] + 4 * Math.sin(h), rec.pos[1], rec.pos[2] + 4 * Math.cos(h)]]; rec.doing.leg = 0;
        return true;
      }
    }
    const r = ctx.walk?.route ? ctx.walk.route(rec.pos, to, rec.floor, rec.half) : [to];   // routes fit this body
    if(rec.walker?.bank) {const p=rec.paceState??={time:0,speed:rec.speed};p.tripTime=0;p.tripStart=rec.speed;}
    const token = ++rec.goToken, walkT = rec.doing?.verb === "goTo" ? rec.doing.walkT ?? 0 : 0;
    rec.doing = { verb: "goTo", target, opts, route: null, leg: 0, token, planning: true, walkT, start: !walking && !opts.inPlace, started: false };
    if (r && typeof r.then === "function") { r.then(route => { if (rec.doing?.token === token) setRoute(rec, route); }, () => { if (rec.doing?.token === token) setRoute(rec, null); }); return true; }
    if (r && typeof r.step === "function") { planners.push({ rec, token, stepper: r }); return true; }
    return setRoute(rec, r);
  }

  function setRoute(rec, route) {
    const d = rec.doing;
    if (route == null) { rec.sitting=null;rec.sitMotion=null;rec.doing = null; queue.push({ type: "no_way", id: rec.id, target: d?.target ?? null }); return false; }
    if (!route.length) { rec.doing = null; queue.push({ type: "arrived", id: rec.id, at: { pos: rec.pos.slice(), floor: rec.floor, room: rec.room } }); return true; }
    d.route = route.map(p => p.slice()); d.planning = false; rec.lastClock = clock;
    let len = 0, prev = rec.pos;
    for (const p of d.route) { len += Math.hypot(p[0] - prev[0], p[2] - prev[2]); prev = p; }
    heapPush({ time: clock + len / (rec.speed * (rec.walker?.bank ? 1 : (d.opts?.pace ?? 1))), id: rec.id, token: d.token });
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
  const CONTACT_TURNS = [...TURNS, 1.8, -1.8, 2.4, -2.4];
  const AV = { reach: 3, nearest: 8, horizon: 2.5, margin: 0.06, cell: 2 };
  let frameNo = 0;
  // the grid is kept between frames and emptied each one, so a frame allocates nothing for it: `grid` maps a cell to its people, `cells` lists this frame's occupied cells in the order
  // they were first filled (bumps walks them in that order)
  let grid = new Map(); const cells = [];
  // a small integer per grid cell: cells wrap every 2 km and floors every 64, which only adds candidates the
  // distance test then drops
  const cellKey = (floor, i, j) => ((floor & 63) << 20) | ((i & 1023) << 10) | (j & 1023);
  const cellOf = (floor, x, z) => cellKey(floor, Math.floor(x / AV.cell), Math.floor(z / AV.cell));
  // the nearest within reach, in a shared array (read it before asking again)
  const nb = [], nbAll = [], nbAllD2 = [];
  let nbN = 0;
  function neighbours(rec, reach = AV.reach, nearest = AV.nearest) {
    let n = 0;
    const px = rec.pos[0], pz = rec.pos[2], cx = Math.floor(px / AV.cell), cz = Math.floor(pz / AV.cell), k = Math.ceil(reach / AV.cell - 1e-9), r2 = reach * reach, floor = rec.floor;
    for (let i = cx - k; i <= cx + k; i++) {
      // a cell wholly further off than the reach holds nobody within it
      const lo = i * AV.cell - px, hi = lo + AV.cell, gx = lo > 0 ? lo : hi < 0 ? -hi : 0, gx2 = gx * gx;
      if (gx2 >= r2) continue;
      for (let j = cz - k; j <= cz + k; j++) {
        const lz = j * AV.cell - pz, hz = lz + AV.cell, gz = lz > 0 ? lz : hz < 0 ? -hz : 0;
        if (gx2 + gz * gz >= r2) continue;
        const cell = grid.get(cellKey(floor, i, j)); if (cell === undefined) continue;
        for (let c = 0; c < cell.length; c++) {
          const o = cell[c];
          if (o === rec) continue;
          const dx = o.pos[0] - px, dz = o.pos[2] - pz, d2 = dx * dx + dz * dz;
          if (d2 < r2) { nbAll[n] = o; nbAllD2[n] = d2; n++; }
        }
      }
    }
    if (n > nearest) {
      // the `nearest` closest, nearest first, ties by id (a selection: the order is total, so it is the order a full sort gives)
      for (let a = 0; a < nearest; a++) {
        let m = a;
        for (let b = a + 1; b < n; b++) if (nbAllD2[b] < nbAllD2[m] || (nbAllD2[b] === nbAllD2[m] && nbAll[b].id < nbAll[m].id)) m = b;
        if (m !== a) { const o = nbAll[a], d = nbAllD2[a]; nbAll[a] = nbAll[m]; nbAllD2[a] = nbAllD2[m]; nbAll[m] = o; nbAllD2[m] = d; }
      }
      n = nearest;
    }
    nb.length = n; nbN = n;
    for (let i = 0; i < n; i++) { nb[i] = nbAll[i]; }
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
  const STRAIGHT = Object.freeze({ turn: 0, pace: 1 });
  // the soonest contact (seconds) of a velocity (ux, uz) with the neighbours; a candidate velocity costs its straying plus penalty(tmin)
  const collisionX=new Float64Array(8),collisionZ=new Float64Array(8),collisionC=new Float64Array(8),collisionVX=new Float64Array(8),collisionVZ=new Float64Array(8);
  function tminOf(rec, ux, uz) {
    const rx = rec.pos[0], rz = rec.pos[2];
    let tmin = Infinity;
    for (let i = 0; i < nbN; i++) {
      const o = nb[i];
      let t;
      if(rec._walker?.bank){
        const vx=ux-collisionVX[i],vz=uz-collisionVZ[i],c=collisionC[i],b=collisionX[i]*vx+collisionZ[i]*vz;
        if(c<0)t=b>0?0:Infinity;
        else {const a=vx*vx+vz*vz,disc=b*b-a*c;t=b<=0||a<1e-9||disc<=0?Infinity:(b-Math.sqrt(disc))/a;}
      } else t=ttc(o.pos[0]-rx,o.pos[2]-rz,ux-o.vel[0],uz-o.vel[1],rec.half+o.half+AV.margin);
      if(t===0)return 0;
      if (t < tmin) tmin = t;
    }
    return tmin;
  }
  const penalty = (tmin) => (tmin < AV.horizon ? 3 * (AV.horizon - tmin) / AV.horizon : 0);
  const SPEEDS = [1, 0.55];
  // All candidate headings see the same contact geometry. Resolve the map and
  // compute each distance once per decision, rather than once per heading.
  const contactX = [], contactZ = [], contactLimit = [];
  let contactN = 0;
  function prepareClearance(rec) {
    contactN = 0;
    for (const [id, c] of rec.contacts) {
      const o = people.get(id);
      if (!o || o.presence === "offscene" || o.floor !== rec.floor || c.until <= clock) { rec.contacts.delete(id); continue; }
      const x = o.pos[0] - rec.pos[0], z = o.pos[2] - rec.pos[2], d = Math.hypot(x, z);
      contactX[contactN] = x; contactZ[contactN] = z;
      contactLimit[contactN++] = Math.max(0, d - rec.half - o.half - 0.001) * d;
    }
  }
  function candidateClearance(dx, dz) {
    let scale = 1;
    for (let i = 0; i < contactN; i++) {
      const closing = dx * contactX[i] + dz * contactZ[i];
      if (closing > 0) scale = Math.min(scale, contactLimit[i] / closing);
    }
    return scale;
  }
  function choose(rec, dx, dz, v, stepLen) {
    neighbours(rec);
    prepareClearance(rec);
    if(rec._walker?.bank)for(let i=0;i<nbN;i++){
      const o=nb[i],x=o.pos[0]-rec.pos[0],z=o.pos[2]-rec.pos[2],r=rec.half+o.half+AV.margin;
      collisionX[i]=x;collisionZ[i]=z;collisionC[i]=x*x+z*z-r*r;collisionVX[i]=o.vel[0];collisionVZ[i]=o.vel[1];
    }
    const claims = ctx.claims?.bodyAt;
    if (!nbN && !claims && !ctx.walk?.stand) return STRAIGHT;
    const la = Math.max(0.45, v * 0.45), base = Math.atan2(dx, dz), bs = Math.sin(base), bc = Math.cos(base);
    // the way ahead clear of everyone for the horizon (most of the time, in most places): straight on, nothing more to weigh
    // (straying from the wanted velocity is nothing here, so the cost is the penalty alone)
    if (standAt(rec, rec.pos[0] + bs * la, rec.pos[2] + bc * la) != null && candidateClearance( bs * la, bc * la) === 1 && penalty(tminOf(rec, bs * v, bc * v)) === 0 && !(claims && blocked(rec, claims, bs * la, bc * la))) return STRAIGHT;
    let have = false, bestTurn = 0, bestPace = 0, bestCost = 0;
    // A squeeze still respects remembered bodies, but accepts a closer approach to others.
    // Wider turns and a consistent side let a bumped walker escape instead of stopping forever.
    const anticipation = rec.progress?.squeeze > clock ? 0.15 : 1;
    const turns = rec.contacts.size ? CONTACT_TURNS : TURNS;
    for (let si = 0; si < 2; si++) {
      const s = SPEEDS[si];
      for (let ai = 0; ai < turns.length; ai++) {
        const a = turns[ai], sh = Math.sin(base + a), ch = Math.cos(base + a);
        // straying: the distance between this velocity and the wanted one, in shares of their speed (0 to 2). The cost is at least that, so a candidate straying further than the best
        // so far cannot win and its neighbours are not weighed (the square root bounds the true length from below within 1e-12)
        const ex = sh * s - bs, ez = ch * s - bc;
        if (have && Math.sqrt(ex * ex + ez * ez) * (1 - 1e-12) >= bestCost) continue;
        const sideCost = rec.contacts.size && rec.recovery && a * (rec.recovery.x * bc - rec.recovery.z * bs) < 0 ? 0.8 : 0;
        const stray=Math.hypot(ex,ez),baseCost=stray+sideCost+4*(1-candidateClearance(sh*la*s,ch*la*s));
        // Collision penalties are nonnegative: this candidate cannot improve
        // the winner, so do not repeat its neighbour prediction.
        if(have&&baseCost>=bestCost)continue;
        const cost=baseCost+anticipation*penalty(tminOf(rec,sh*v*s,ch*v*s));
        if (have && cost >= bestCost) continue;
        const x = rec.pos[0] + sh * la * s, z = rec.pos[2] + ch * la * s;
        if (claims && blocked(rec, claims, sh * la * s, ch * la * s)) continue;
        if (standAt(rec, x, z) == null) continue;                             // no ground there for this body
        if (standAt(rec, rec.pos[0] + sh * stepLen * s, rec.pos[2] + ch * stepLen * s) == null) continue;
        have = true; bestTurn = a; bestPace = s; bestCost = cost;
      }
    }
    const still = (rec.contacts.size ? 4 : Math.hypot(bs, bc)) + penalty(tminOf(rec, 0, 0));
    if (!have || still < bestCost) return null;
    return { turn: bestTurn, pace: bestPace, cost: bestCost };
  }

  // Contacts share the walking budget: separation is a shuffle, never an extra burst of speed.
  // A seeded right of way commits one walker to a short sidestep. Both remember the pair for
  // four seconds and cannot close through its clearance, even when squeezing or near a goal.
  function clearance(rec, dx, dz) {
    let scale = 1;
    const reach=rec.contacts.size&&rec.walker?.bank?Math.hypot(dx,dz):null;
    for (const [id, c] of rec.contacts) {
      const o = people.get(id);
      if (!o || o.presence === "offscene" || o.floor !== rec.floor || c.until <= clock) { rec.contacts.delete(id); continue; }
      const px = o.pos[0] - rec.pos[0], pz = o.pos[2] - rec.pos[2];
      // A remembered body beyond the whole proposed displacement cannot limit it.
      if(reach!==null&&px*px+pz*pz>(rec.half+o.half+.001+reach)**2)continue;
      const dist=Math.hypot(px,pz);
      const closing = dx * px + dz * pz;
      // The tangent half-plane is conservative and cannot tunnel through the other body.
      if (closing > 0) scale = Math.min(scale, Math.max(0, dist - rec.half - o.half - 0.001) * dist / closing);
    }
    return scale;
  }
  function shuffle(rec, dx, dz) {
    if(rec.sitting && rec.sitting.segment!=='approach')return;
    const len = Math.hypot(dx, dz);
    if (!len) return;
    const k = Math.min(1, rec.moveLeft / len, clearance(rec, dx, dz));
    const x = rec.pos[0] + dx * k, z = rec.pos[2] + dz * k, y = standAt(rec, x, z);
    if (y == null) return;
    rec.pos[0] = x; rec.pos[1] = y; rec.pos[2] = z;
    rec.moveLeft = Math.max(0, rec.moveLeft - len * k);
    rec.offRoute = true;
    hold(rec);
  }
  const TURN_RATE = 6;                 // radians a second
  let touching = new Set();
  const STENCIL = [[0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];     // each pair of neighbouring cells once
  function bumps(dt) {
    const now = new Set();
    // Cell membership was built before walking; keep ongoing contacts even across a cell edge.
    for (const key of touching) {
      const [ai, bi] = JSON.parse(key), a = people.get(ai), b = people.get(bi);
      if (a && b && a.floor === b.floor) {
        if(Math.hypot(a.pos[0]-b.pos[0],a.pos[2]-b.pos[2])<a.half+b.half+.08)now.add(key);
        else if(a.walker?.bank||b.walker?.bank){const ac=a.contacts.get(b.id),bc=b.contacts.get(a.id);if(ac)ac.until=clock+4.05;if(bc)bc.until=clock+4.05;}
      }
    }
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c], a0 = cell[0], ci = Math.floor(a0.pos[0] / AV.cell), cj = Math.floor(a0.pos[2] / AV.cell);
      for (let q = 0; q < STENCIL.length; q++) {
        const di = STENCIL[q][0], dj = STENCIL[q][1];
        const other = di === 0 && dj === 0 ? cell : grid.get(cellKey(a0.floor, ci + di, cj + dj));
        if (!other || other.length === 0) continue;
        for (let x = 0; x < cell.length; x++) for (let y = other === cell ? x + 1 : 0; y < other.length; y++) contact(cell[x], other[y], dt, now);
      }
    }
    touching = now;
  }
  function contact(a, b, dt, now) {
    if (a.floor !== b.floor) return;
    const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2], r = a.half + b.half;
    if (dx * dx + dz * dz >= (r + 0.08) * (r + 0.08)) return;
    const d = Math.hypot(dx, dz), key = JSON.stringify(a.id < b.id ? [a.id, b.id] : [b.id, a.id]), was = touching.has(key)||((a.walker?.bank||b.walker?.bank)&&now.has(key));
    if (d >= r + (was ? 0.08 : 0)) return;                                    // a contact lasts until they're clear of it
    now.add(key);
    if (!was) {
      const first = a.id < b.id ? a : b, second = first === a ? b : a;
      // Someone already standing steps aside for traffic; two walkers use the pair's seeds.
      const winner = a.sitting && a.sitting.segment!=='approach' ? a : b.sitting && b.sitting.segment!=='approach' ? b : !a.doing && b.doing ? b : !b.doing && a.doing ? a : uniform(first.seed, key, String(second.seed)) < 0.5 ? first : second;
      const loser = winner === a ? b : a;
      a.contacts.set(b.id, { until: clock + 4 }); b.contacts.set(a.id, { until: clock + 4 });
      a.aside = b.aside = undefined;                 // choose afresh, not on the staggered fourth frame
      a.waited = b.waited = 0;
      // Step to the side of the winner's route already nearest us; keep that side throughout.
      const wp = winner.doing?.route?.[winner.doing.leg];
      const h = wp ? Math.atan2(wp[0] - winner.pos[0], wp[2] - winner.pos[2]) : winner.heading;
      const sx = Math.cos(h), sz = -Math.sin(h);
      const side = (loser.pos[0] - winner.pos[0]) * sx + (loser.pos[2] - winner.pos[2]) * sz >= 0 ? 1 : -1;
      const awayX = loser.pos[0] - winner.pos[0], awayZ = loser.pos[2] - winner.pos[2], awayLen = Math.hypot(awayX, awayZ) || 1;
      const rx = sx * side + awayX / awayLen, rz = sz * side + awayZ / awayLen, rl = Math.hypot(rx, rz);
      loser.recovery = { until: clock + 0.8, x: rx / rl, z: rz / rl };
      queue.push({ type: "bumped", id: a.id, by: b.id }, { type: "bumped", id: b.id, by: a.id });
    }
    if (d >= r) return;
    const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
    // A standing person holds their ground; otherwise split the overlap. Multiple contacts
    // consume the same remaining budget. Separation deliberately holds the gait phase.
    const am = !!a.doing && (!a.sitting || a.sitting.segment==='approach'), bm = !!b.doing && (!b.sitting || b.sitting.segment==='approach'), share = am && bm ? 0.5 : 1;
    for (const [o, sign] of [[a, -1], [b, 1]]) {
      if (!o.doing && (am || bm)) continue;
      o.touching = clock + 0.2;
      const push = Math.min((r - d + 0.01) * share, o.speed * dt);
      shuffle(o, ux * sign * push, uz * sign * push);
    }
  }

  // Walking: along the route at the person's own speed; the phase advances only while walking, at their own cadence.
  // Render-only distance lets each retained cycle use its own stride without
  // making navigation or persisted phase depend on draw timing/bake budgets.
  // In-place walking accumulates the same virtual distance; separation does not.
  function advanceWalk(rec, cycles) {
    rec.phase = (rec.phase + cycles) % 1;
    rec.walkDistance += cycles * (rec.walker?.stride ?? rec.speed / rec.rate);
  }

  // easeWalks: a captured walk eases in over its first ~half second and out over its last ~half metre: the speed walked goes from a third to
  // all of it and back to a third at the goal, where the stand takes over (draw.js). The cycle plays at the pace actually walked (advanceWalk
  // counts distance), so the feet stay planted through both. A replan keeps its walk's time, so only a real start eases in. Off by default:
  // it changes every trip's timing (about half a second a trip), which the crowd's navigation and its digests are pinned to.
  function walkEase(rec, d, dt) {
    const t = d.walkT ?? 0; d.walkT = t + dt;
    let rest = 0, prev = rec.pos;
    for (let k = d.leg; k < d.route.length && rest < WALK_EASE.out; k++) { rest += Math.hypot(d.route[k][0] - prev[0], d.route[k][2] - prev[2]); prev = d.route[k]; }
    // (the share over this tick: the start's integral exactly, so the draw's hand-over can follow it; the stop's at this tick's distance)
    const start = dt > 0 ? (walkedBy(t + dt) - walkedBy(t)) / dt : walkEaseAt(t);
    return Math.min(start, walkEaseAt(Infinity, rest));
  }

  // ---- captured moves (moves.js; env.moves): a start from standing, a stop at the end of a walk, the turn before a sit ---------------------------------
  // The population keeps where the person is: through a move, their place and facing follow its path (move.traj) from where it began, and the draw plays its
  // poses about that path. A walk meets a move at the phase where its capture walks the same (MOVE_DEFS entryPhase; mirrored, half a cycle on), so a stop
  // can only begin at one of two places a cycle (the feet land where they land): of the coming chances, the one that changes the capture least to end on
  // the goal, its last steps scaled (movePath: the end is linear in the scales) and what is left spread over them; a start picks its first foot and its
  // first steps so that the move after it comes due needing neither (startPlan). The poses are made as the move begins: 6 to 20 ms on a desktop, 15 to 35
  // with the arms' keep-out of a dressed person (out.moveMs).
  // (a move's poses fill whole slots of the draw's walk texture, 65 a slot: a slot to every 2 s gives 37 to 59 poses a second, the GPU blending between)
  const MOVE_K = [0.6, 1.45], MOVE_SLOT = 2;
  let moveMs = 0;                                      // the time this tick spent making moves' poses (tick's out.moveMs: the host's ledger counts it as baking)
  const movesOn = (rec) => !!env.moves && movesReady() && !!rec.walker?.mocap;
  const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  function beginMove(rec, kind, opts, after, t0 = 0) {
    const w = rec.walker, S = moveShape(w, kind, !!opts.mirror), slots = Math.max(1, Math.ceil(S.duration / MOVE_SLOT - 1e-9));
    // into a sit-down: its last steps leave the balls where the sit-down's first pose has them (no slide as one hands to the other)
    if (after === "sit" && rec.sitting && rec.sitMotion) {
      const sm = rec.sitMotion, P = sm.pose(sm.spec.segments.sitDown[0]).P, f = rec.sitting.seat.facing, cf = Math.cos(f), sf = Math.sin(f), c = Math.cos(rec.heading), sn = Math.sin(rec.heading);
      opts = { ...opts, endFeet: [16, 20].map((b) => { const dx = rec.sitting.contact[0] + cf * P[b][0] + sf * P[b][2] - rec.pos[0], dz = rec.sitting.contact[1] - sf * P[b][0] + cf * P[b][2] - rec.pos[2]; return [dx * c - dz * sn, dx * sn + dz * c]; }) };
    }
    // (the arms kept out of their clothes as their walk and idle keep them: keepout.js)
    const from = performance.now(), move = makeMove(w, kind, { ...opts, keepout: rec.dressing?.keepout ?? null, frames: slots * PACE_FRAMES + 1 });
    moveMs += performance.now() - from;
    if (kind === "start") move.end.walk = walkAfterStart(rec, move);
    const fit = { mirror: !!opts.mirror, scaleIn: opts.scaleIn ?? 1, scaleOut: opts.scaleOut ?? opts.scaleIn ?? 1, warp: opts.warp ?? 0, shift: opts.shift ?? null };
    rec.move = { kind, move, slots, t: 0, p0: rec.pos.slice(), h0: rec.heading, after, fit, token: (rec.moveToken = (rec.moveToken ?? 0) + 1) };
    rec.feet = null;
    stepMove(rec, t0);
  }
  // the walk after a start: its pose at the move's last phase, placed so its planted ball is where the move left it (the draw blends the move into it)
  function walkAfterStart(rec, move) {
    const w = rec.walker, side = move.mirror ? 1 : 0, phi = (MOVE_DEFS.start.exitPhase + (move.mirror ? 0.5 : 0)) % 1, b = (side ? 20 : 16) * 3, last = move.frames[move.n - 1];
    const lock = move.stances[side].at(-1), ball = lock && lock.b >= move.n - 3 ? lock.anchor : [last.P[b], last.P[b + 2]];
    const phase = (((phi - (w.phaseOffset ?? 0)) % 1) + 1) % 1;
    w.pose(w, phase);
    const bx = w.Pm[b], bz = w.Pm[b + 2], yaw = move.end.yaw, c = Math.cos(yaw), sn = Math.sin(yaw);
    return { x: ball[0] - (c * bx + sn * bz), z: ball[1] - (-sn * bx + c * bz), yaw, phase };
  }
  // where the walk has its planted ball as a stop or turn begins (the walk's toe lock, mid-stance: mocap.js poseMocap), in the frame of that moment
  function walkAnchor(rec, mirror, phiEntry) {
    const w = rec.walker, side = mirror ? 1 : 0, phiLock = (0.3 + (mirror ? 0.5 : 0)) % 1, ahead = (((phiLock - phiEntry) % 1) + 1) % 1, b = (side ? 20 : 16) * 3;
    w.pose(w, phiLock - (w.phaseOffset ?? 0));
    return [side, w.Pm[b], w.Pm[b + 2] + ahead * w.stride];
  }
  function stepMove(rec, dt) {
    const mv = rec.move, m = mv.move;
    mv.t += dt;
    const t = Math.min(mv.t, m.duration), [x, z, y] = m.traj(t), c = Math.cos(mv.h0), sn = Math.sin(mv.h0);
    rec.pos[0] = mv.p0[0] + c * x + sn * z; rec.pos[2] = mv.p0[2] - sn * x + c * z; rec.heading = mv.h0 + y;
    const room = ctx.place?.roomAt?.(rec.pos, rec.floor); if (room != null) setRoom(rec, room);
    hold(rec);
    if (mv.t < m.duration) return;
    const over = mv.t - m.duration;
    rec.move = null;
    if (mv.kind === "start") {
      // on into the walk: placed where the walk's own pose at the last phase meets the move's (walkAfterStart), on along the route
      const e = m.end.walk;
      rec.pos[0] = mv.p0[0] + c * e.x + sn * e.z; rec.pos[2] = mv.p0[2] - sn * e.x + c * e.z; rec.heading = mv.h0 + e.yaw; rec.phase = e.phase;
      if (rec.doing?.verb === "goTo") rec.doing.started = true;
      if (rec.moveWish?.goTo) { const [g, o] = rec.moveWish.goTo; rec.moveWish = null; goTo(rec.id, g, o); return; }
      if (over > 0) step(rec, over);
      return;
    }
    // standing where it ended, the feet where its last steps left them (in the person's frame there: the idle's, draw.js)
    const e = m.end, ce = Math.cos(e.yaw), se = Math.sin(e.yaw);
    rec.feet = e.feet.map(([fx, fz]) => { const dx = fx - e.x, dz = fz - e.z; return [ce * dx - se * dz, se * dx + ce * dz]; });
    if (mv.after === "sit" && rec.sitting) {
      // into the captured sit-down, in the seat's frame (stepSit's turn, which a move replaces)
      const s = rec.sitting; s.segment = "sitDown"; s.time = over; rec.heading = s.seat.facing;
      rec.pos[0] = s.contact[0]; rec.pos[2] = s.contact[1]; rec.floor = s.floor; setRoom(rec, roomOf(rec.pos, rec.floor)); hold(rec); rec.doing = { verb: "sit" };
      return;
    }
    rec.doing = null;
    queue.push({ type: "arrived", id: rec.id, at: { pos: rec.pos.slice(), floor: rec.floor, room: rec.room } });
    if (rec.moveWish?.goTo) { const [g, o] = rec.moveWish.goTo; rec.moveWish = null; goTo(rec.id, g, o); }
  }
  // what the walk's end asks of a move: a stop on the goal (the route's end), a stop now (rec.moveWish.stop), or the move a sit planned (rec.sitting.plan:
  // a turn or a stop ending on the sit-down's first place, facing the seat's way). { kind, goal: [x, z] | null, mirrors, warp(heading, mirror) }
  function moveGoal(rec, d) {
    const plan = rec.sitting?.segment === "approach" ? rec.sitting.plan : null;
    if (plan) return { kind: plan.kind, goal: plan.T, mirrors: plan.kind === "stop" ? [false, true] : [plan.mirror], warp: (h, mirror) => (wrapPi(plan.facing - h - movePath(rec.walker, plan.kind, { mirror }).yaw) * 180) / Math.PI, after: "sit" };
    const straight = (h, mirror) => (-movePath(rec.walker, "stop", { mirror }).yaw * 180) / Math.PI;
    if (rec.moveWish?.stop) return { kind: "stop", goal: rec.moveWish.goal ?? null, mirrors: [false, true], warp: straight };
    if (d.leg !== d.route.length - 1) return null;
    const p = d.route[d.leg];
    return { kind: "stop", goal: [p[0], p[2]], mirrors: [false, true], warp: straight };
  }
  // whether a move begins within the next `dist` metres of this walk: { kind, at (metres from here), opts, after } or null. Each coming chance (each allowed
  // mirror's next entry phase, and the one a cycle on) is fitted to the goal: the last steps scaled to end level with it (scaleOut, within MOVE_K), what that
  // leaves (aside, or past the scale's limit) spread over the same steps (shift). The chance taken is the one that changes the capture least.
  function moveDue(rec, d, dist) {
    const g = moveGoal(rec, d); if (!g) return null;
    // (not while a walk from standing is still under the draw's blend into it: the move would begin from a walk not yet walking)
    if (d.blendFrom !== undefined && clock - d.blendFrom < 0.5) return null;
    // the way this tick walks: toward the waypoint (a walk from standing faces it only as it sets off)
    const p = d.route[d.leg], h = p ? Math.atan2(p[0] - rec.pos[0], p[2] - rec.pos[2]) : rec.heading;
    const w = rec.walker, phi = (((rec.phase + (w.phaseOffset ?? 0)) % 1) + 1) % 1, fx = Math.sin(h), fz = Math.cos(h);
    const chances = [];
    for (const mirror of g.mirrors) {
      const phiO = (MOVE_DEFS[g.kind].entryPhase + (mirror ? 0.5 : 0)) % 1, ahead = (((phiO - phi) % 1) + 1) % 1, warp = g.warp(h, mirror), P = movePath(w, g.kind, { mirror, warp }), kIn = w.v / P.speed;
      for (const cycles of [ahead, ahead + 1]) {
        const at = cycles * w.stride;
        let kOut = 1, shift = null, cost = 0;
        if (g.goal) {
          // the goal from where this chance begins, in the move's frame (x their left, z ahead); its end there is kIn walk + kOut rest + shift
          const gx = g.goal[0] - rec.pos[0] - at * fx, gz = g.goal[1] - rec.pos[2] - at * fz, Rx = gx * fz - gz * fx, Rz = gx * fx + gz * fz;
          kOut = Math.max(MOVE_K[0], Math.min(MOVE_K[1], (Rz - kIn * P.walk[1]) / (Math.abs(P.rest[1]) > 1e-6 ? P.rest[1] : 1e-6)));
          shift = [Rx - kIn * P.walk[0] - kOut * P.rest[0], Rz - kIn * P.walk[1] - kOut * P.rest[1]];
          // (at most half the way those steps go: a goal too near for the move at all is overshot, not walked back to)
          const len = Math.hypot(shift[0], shift[1]), most = 0.5 * kOut * Math.hypot(P.rest[0], P.rest[1]);
          cost = Math.abs(kOut - 1) * Math.hypot(P.rest[0], P.rest[1]) + len;
          if (len > most) shift = [(shift[0] * most) / len, (shift[1] * most) / len];
        }
        chances.push({ mirror, at, kIn, kOut, warp, shift, cost });
      }
    }
    chances.sort((a, b) => a.at - b.at);
    const first = chances[0];
    if (!first || first.at > dist + 1e-9) return null;
    // a later chance that changes the capture less: walk on to it
    if (g.goal && chances.some((c) => c !== first && c.cost < first.cost - 1e-6)) return null;
    const anchor = walkAnchor(rec, first.mirror, (MOVE_DEFS[g.kind].entryPhase + (first.mirror ? 0.5 : 0)) % 1);
    return { kind: g.kind, at: first.at, after: g.after ?? null, opts: { mirror: first.mirror, scaleIn: first.kIn, scaleOut: first.kOut, warp: first.warp, shift: first.shift, entry: { anchor } } };
  }
  // A start from standing, toward the route's first waypoint (its turn, if they face elsewhere, taken over its first steps). Its walking steps are at the
  // walk's pace (scaleIn); its first steps (scaleOut, from 0.7 to 1.35 of that) and its first foot (mirror) are chosen so that the move after it (a sit's
  // turn, or the stop at the end of a straight route) comes due where it needs no scaling: the walk between them whole cycles from the start's last phase
  // to that move's entry. Null when the route has no room for the start and what follows it (the walk then starts as before, from the draw's blend).
  function startPlan(rec, d) {
    const w = rec.walker, p = d.route[d.leg], h = Math.atan2(p[0] - rec.pos[0], p[2] - rec.pos[2]), warp = (wrapPi(h - rec.heading) * 180) / Math.PI;
    const k = w.v / moveShape(w, "start").speed, c = Math.cos(rec.heading), sn = Math.sin(rec.heading);
    const local = ([x, z]) => { const dx = x - rec.pos[0], dz = z - rec.pos[2]; return [dx * c - dz * sn, dx * sn + dz * c]; };
    // where the next move begins at its own scales, and the phase it begins at: a sit's turn (or stop) at the plan's S; a stop ending on the route's end
    const plan = rec.sitting?.segment === "approach" ? rec.sitting.plan : null, next = [];
    if (plan) next.push({ at: local(plan.S), phase: (MOVE_DEFS[plan.kind].entryPhase + (plan.mirror ? 0.5 : 0)) % 1, rest: Math.hypot(...movePath(w, plan.kind, plan).rest) });
    else if (d.leg === d.route.length - 1) for (const mirror of [false, true]) {
      const P = movePath(w, "stop", { mirror, warp: (-movePath(w, "stop", { mirror }).yaw * 180) / Math.PI }), kIn = w.v / P.speed, L = kIn * P.walk[1] + P.rest[1];
      next.push({ at: local([p[0] - L * Math.sin(h), p[2] - L * Math.cos(h)]), phase: (MOVE_DEFS.stop.entryPhase + (mirror ? 0.5 : 0)) % 1, rest: Math.hypot(...P.rest) });
    }
    let best = null;
    for (const mirror of [false, true]) {
      const P = movePath(w, "start", { mirror, warp }), phiE = (MOVE_DEFS.start.exitPhase + (mirror ? 0.5 : 0)) % 1;
      for (let kOut = 0.7 * k; kOut <= 1.35 * k + 1e-9; kOut += 0.01 * k) {
        const ex = k * P.walk[0] + kOut * P.rest[0], ez = k * P.walk[1] + kOut * P.rest[1];
        if (!next.length) {
          // a route of corners: the start at its own scale, if the route has room for it and a stop
          if (!mirror && Math.abs(kOut - k) < 0.005 * k && routeLeft(rec, d) > Math.hypot(ex, ez) + 0.5 * w.stride + 0.7) best = { mirror: false, kOut: k, cost: 0 };
          continue;
        }
        for (const nb of next) {
          // the walk from the start's end to where the next move begins: ahead of it, and the phase it reaches there that move's entry
          const dx = nb.at[0] - ex, dz = nb.at[1] - ez, dist = Math.hypot(dx, dz);
          if (dx * Math.sin(P.yaw) + dz * Math.cos(P.yaw) < 0.25 * w.stride) continue;
          // (what is left for the next move's own steps to take up: the two scalings shared, each against its steps' length)
          const want = (((nb.phase - phiE) % 1) + 1) % 1, cyc = dist / w.stride - want, err = Math.abs(cyc - Math.round(cyc)) * w.stride;
          const cost = (kOut / k - 1) ** 2 + (err / nb.rest) ** 2;
          if (!best || cost < best.cost) best = { mirror, kOut, cost };
        }
      }
    }
    if (!best) return null;
    // its turn so that it ends facing the waypoint from where it ends (not from where it began: the walk on from it would turn on the spot)
    let wp = warp;
    for (let i = 0; i < 3; i++) {
      const P = movePath(w, "start", { mirror: best.mirror, warp: wp }), ex = k * P.walk[0] + best.kOut * P.rest[0], ez = k * P.walk[1] + best.kOut * P.rest[1];
      const x = rec.pos[0] + c * ex + sn * ez, z = rec.pos[2] - sn * ex + c * ez, h1 = Math.atan2(p[0] - x, p[2] - z);
      wp += (wrapPi(h1 - rec.heading - P.yaw) * 180) / Math.PI;
    }
    return { mirror: best.mirror, scaleIn: k, scaleOut: best.kOut, warp: wp, feet: feetOf(rec) };
  }
  // where a standing person's balls are, in their frame: where the last stop or rise left them, or the idle's own stance (as the draw stands them:
  // draw.js idlerOf, bakeIdle)
  function feetOf(rec) {
    if (rec.feet) return rec.feet;
    return (rec._homeFeet ??= makeIdleWalker(rec.far.J, { age: rec.bodyParams.age ?? rec.values.age, seed: rec.seed, build: rec.bodyParams.build }).homeFeet.map((f) => f.slice()));
  }
  // The approach to a seat with captured moves. The walk comes straight in, and the turn needed at its end (from the heading in to the seat's way) picks the
  // move: from 110 degrees round, the captured about-turn (MOVE_DEFS turn; mirrored to turn the short way, its turn warped to end facing the seat's way:
  // 188 degrees captured, so a turn of 110 is warped by 78; within 30 degrees of an about-face, whichever way is warped least); under that, arriving
  // already nearly facing the seat's way (from behind it, or beside it), the captured stop, warped round the rest. S, where the move must begin (at its
  // natural scales) to end on the sit-down's first place T: the heading in is the line to S, and S turns with it (a fixed point). Null when there is no
  // room to walk into it (the turn on the spot, as before).
  const TURN_FROM = (110 * Math.PI) / 180;
  function sitPlan(rec, T, facing) {
    const w = rec.walker, at = (h, kind, mirror) => {
      const warp = (wrapPi(facing - h - movePath(w, kind, { mirror }).yaw) * 180) / Math.PI, P = movePath(w, kind, { mirror, warp }), kIn = w.v / P.speed;
      const E = [kIn * P.walk[0] + P.rest[0], kIn * P.walk[1] + P.rest[1]], c = Math.cos(h), sn = Math.sin(h);
      return { kind, mirror, T, facing, warp, h, S: [T[0] - (c * E[0] + sn * E[1]), T[1] - (-sn * E[0] + c * E[1])] };
    };
    // the heading in is the line from here to S, and S moves with it: the fixed point, found by halving the step (a few iterations), for a move and foot
    const solve = (kind, mirror) => {
      let h = Math.atan2(T[0] - rec.pos[0], T[1] - rec.pos[2]), plan = at(h, kind, mirror);
      for (let i = 0; i < 16; i++) { const h2 = Math.atan2(plan.S[0] - rec.pos[0], plan.S[1] - rec.pos[2]), d = wrapPi(h2 - h); if (Math.abs(d) < 1e-4) break; h += 0.5 * d; plan = at(h, kind, mirror); }
      return Math.hypot(plan.S[0] - rec.pos[0], plan.S[1] - rec.pos[2]) < 0.8 || Math.abs(wrapPi(Math.atan2(plan.S[0] - rec.pos[0], plan.S[1] - rec.pos[2]) - plan.h)) > 0.05 ? null : plan;
    };
    // the turn the short way round (near an about-face, either way: the one warped least), or under 110 degrees the stop
    const D = wrapPi(facing - Math.atan2(T[0] - rec.pos[0], T[1] - rec.pos[2]));
    const tries = Math.abs(D) < TURN_FROM ? [["stop", false]] : Math.abs(D) > (150 * Math.PI) / 180 ? [["turn", D > 0], ["turn", D <= 0]] : [["turn", D > 0]];
    let best = null;
    for (const [kind, mirror] of tries) { const plan = solve(kind, mirror); if (plan && (!best || Math.abs(plan.warp) < Math.abs(best.warp))) best = plan; }
    return best;
  }
  // how long the route is from here (metres)
  function routeLeft(rec, d) { let len = 0, prev = rec.pos; for (let k = d.leg; k < d.route.length; k++) { len += Math.hypot(d.route[k][0] - prev[0], d.route[k][2] - prev[2]); prev = d.route[k]; } return len; }

  function step(rec, dt, live = false) {
    if (rec.move) { stepMove(rec, dt); return; }
    if(rec.sitting && stepSit(rec,dt))return;
    const d = rec.doing;
    if (live && rec.recovery?.until > clock) {
      const { x, z } = rec.recovery;
      rec.heading = Math.atan2(x, z);
      shuffle(rec, x * rec.moveLeft, z * rec.moveLeft);
      return;
    }
    if (!d || d.verb !== "goTo" || d.planning) return;
    if(rec.walker?.bank&&(d.opts?.pace??1)<=0)return;
    if (d.opts?.inPlace) { advanceWalk(rec, rec.rate * (rec.walker?.bank ? 1 : (d.opts.pace ?? 1)) * dt); return; }       // goTo(target, { inPlace: true }): the stride of a walk and none of its way (a lineup, a gait on show); they stay where they stand, facing as they were
    const moving = movesOn(rec);
    // a walk from standing begins with the captured start, when the way is long enough for it and a stop (else the draw's blend, as before)
    if (moving && d.start && !d.started) { d.started = true; const sp = startPlan(rec, d); if (sp) { beginMove(rec, "start", sp, null, 0); return; } rec.feet = null; d.blendFrom = clock; }
    const pace = rec.walker?.bank ? 1 : Math.min(1, d.opts?.pace ?? 1), v = rec.speed * pace;
    let left = (live ? Math.min(v * dt, rec.moveLeft) : v * dt) * (env.easeWalks && rec.walker?.mocap && !moving ? walkEase(rec, d, dt) : 1);
    // a stop, or the turn before a sit, begins within this tick's walk: walk to where it begins, and it takes the rest of the tick
    const due = moving ? moveDue(rec, d, left) : null, planned = left;
    if (due) left = Math.min(left, due.at);
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
    if ((!squeezing || rec.contacts.size) && live && avoid && d.leg < d.route.length && (!(last && rest < 1.2) || rec.contacts.size)) {
      const p = d.route[d.leg], dx = p[0] - rec.pos[0], dz = p[2] - rec.pos[2];
      // Remembered contacts are still clipped geometrically on every step.
      // Re-score their headings at 7.5 Hz for the faster pace bank; stagger
      // people so the extra contacts at higher speeds do not bunch CPU work.
      const interval=rec.contacts.size?(rec.walker?.bank?8:1):4;
      const fresh=rec.aside===undefined||(frameNo+Math.floor(rec.rank*interval))%interval===0;
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
        const h = Math.atan2(dx, dz) + dec.turn;
        left *= clearance(rec, Math.sin(h) * left, Math.cos(h) * left);
        const x = rec.pos[0] + Math.sin(h) * left, z = rec.pos[2] + Math.cos(h) * left;
        const y = standAt(rec, x, z);
        if (y == null) { rec.aside = undefined; return; }                    // the kept decision ran out of floor
        rec.heading = h; rec.pos[0] = x; rec.pos[1] = y; rec.pos[2] = z;
        advanceWalk(rec, rec.rate * pace * dt * (left / (v * dt)));
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
      const travel = Math.min(left, dist), k = live && dist > 0 ? clearance(rec, dx / dist * travel, dz / dist * travel) : 1;
      if (k < 1) {
        const moved = travel * k;
        if (p[1] != null) rec.pos[1] += (p[1] - rec.pos[1]) * moved / dist;
        rec.pos[0] += dx / dist * moved; rec.pos[2] += dz / dist * moved;
        left -= moved; rec.aside = undefined;
        break;                              // keep the waypoint until we actually reach it
      }
      const fraction = dist > 0 ? Math.min(left, dist) / dist : 0;
      if (live && standAt(rec, rec.pos[0] + dx * fraction, rec.pos[2] + dz * fraction) == null) { rec.aside = undefined; break; }
      if (dist <= left) { rec.pos[0] = p[0]; rec.pos[1] = p[1] ?? rec.pos[1]; rec.pos[2] = p[2]; left -= dist; d.leg++; rec.offRoute = false; rec.lastGood = rec.pos.slice(); }
      else {
        // height follows the segment (stairs, slopes): a straight line from here to the waypoint's height
        if (p[1] != null) rec.pos[1] += (p[1] - rec.pos[1]) * (left / dist);
        rec.pos[0] += dx / dist * left; rec.pos[2] += dz / dist * left; left = 0;
      }
    }
    // the feet move only while walking: the phase advances for the time actually walked
    advanceWalk(rec, rec.rate * pace * ((startLeft - left) / v));
    // (only if the walk got there: someone in the way, or a pace cut, leaves it for the next tick to plan again)
    if (due && startLeft - left >= due.at - 1e-6) { beginMove(rec, due.kind, due.opts, due.after, dt * Math.max(0, 1 - due.at / Math.max(1e-9, planned))); return; }
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
  const centre = [0, 0, 0];             // the person's centre, handed to cam.sees (which copies it)
  function tick(t, dt, cam) {
    const out = { near: [], mid: [], far: [], visited: 0 };
    moveMs = 0;
    clock += dt; frameNo++;
    // routes being searched, within a node budget shared round-robin, and within ctx.budgetMs when the host grants
    // time (holo-emitter's frame ledger: 0 on a starved frame, when nobody searches and those waiting stand on)
    const grant = Number.isFinite(ctx.budgetMs) ? ctx.budgetMs : Infinity, searchFrom = performance.now(), until = grant < Infinity ? searchFrom + grant : Infinity;
    for (let budget = planBudget, k = 0; grant > 0 && planners.length && budget > 0 && k < planners.length * 2 && (until === Infinity || performance.now() < until); k++) {
      const pl = planners.shift(), slice = Math.max(1, Math.floor(budget / (planners.length + 1)));
      budget -= slice;
      if (pl.rec.doing?.token !== pl.token || !people.has(pl.rec.id)) continue;   // superseded or removed
      const r = pl.stepper.step(slice);
      if (r === undefined) planners.push(pl); else setRoute(pl.rec, r);
    }
    out.searchMs = performance.now() - searchFrom;
    // arrivals due for people nobody steps (people being stepped arrive by walking, detours and all)
    while (arrivals.length && arrivals[0].time <= clock + 1e-9) {
      const e = heapPop(), rec = people.get(e.id);
      if (!rec || rec.doing?.token !== e.token) continue;
      if (active(rec)) {                         // being stepped: look again when they should be there by now
        const d = rec.doing; if (!d.route) continue;
        let len = 0, prev = rec.pos;
        for (let k = d.leg; k < d.route.length; k++) { len += Math.hypot(d.route[k][0] - prev[0], d.route[k][2] - prev[2]); prev = d.route[k]; }
        heapPush({ time: clock + Math.max(0.25, len / (rec.speed * (rec.walker?.bank ? 1 : (d.opts?.pace ?? 1)))), id: rec.id, token: e.token });
        continue;
      }
      catchUp(rec);
      if(rec.walker?.bank&&rec.doing?.token===e.token&&rec.doing.route){
        const d=rec.doing;let len=0,prev=rec.pos;
        for(let k=d.leg;k<d.route.length;k++){len+=Math.hypot(d.route[k][0]-prev[0],d.route[k][2]-prev[2]);prev=d.route[k];}
        heapPush({time:clock+Math.max(.25,len/rec.walker.maxSpeed),id:rec.id,token:e.token});
      }
      if (!rec.walker?.bank && rec.doing?.token === e.token && rec.doing.route) { const end = rec.doing.route[rec.doing.route.length - 1]; rec.pos[0] = end[0]; rec.pos[2] = end[2]; rec.doing.leg = rec.doing.route.length; step(rec, 0); }
    }
    const list = listOf();
    // who is where, for avoiding each other and bumping: everyone stepped this frame, on a 2 m grid
    for (let i = 0; i < cells.length; i++) cells[i].length = 0;
    cells.length = 0;
    if (grid.size > 4096) grid = new Map();                                    // cells nobody has stood in for long are let go
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (rec.presence === "offscene") continue;
      rec.vel ??= [0, 0];
      if(rec.lastClock>=clock-dt-1e-9)updatePace(rec,dt);
      rec.moveLeft = rec.speed * dt; rec.tickX = rec.pos[0]; rec.tickZ = rec.pos[2];
      const key = cellOf(rec.floor, rec.pos[0], rec.pos[2]);
      let cell = grid.get(key);
      if (cell === undefined) grid.set(key, cell = []);
      if (cell.length === 0) cells.push(cell);
      cell.push(rec);
    }
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (rec.gone || rec.presence === "offscene") continue;
      out.visited++;
      if (rec.lastClock < clock - dt - 1e-9) catchUp(rec);                     // back from hidden: catch up at once
      if (rec.lastClock < clock) {
        const x0 = rec.pos[0], z0 = rec.pos[2], h0 = rec.heading, span = rec.walker?.bank&&Math.abs(clock-rec.lastClock-dt)<1e-9?dt:clock-rec.lastClock;
        const budget = rec.moveLeft;
        step(rec, span, true); rec.lastClock = clock;
        rec.moveLeft = Math.max(0, budget - Math.hypot(rec.pos[0] - x0, rec.pos[2] - z0));
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
      const c = centre; c[0] = rec.pos[0]; c[1] = rec.pos[1] + rec.height / 2; c[2] = rec.pos[2];
      if (cam.sees && !cam.sees(c, rec.height / 2 + rec.half)) { rec.tier = null; continue; }
      rec.seen = true;
      const d = Math.hypot(c[0] - cam.pos[0], c[1] - cam.pos[1], c[2] - cam.pos[2]);
      rec.tier = tierFor(rec, d);
      out[rec.tier].push(rec);
    }
    if (avoid && dt > 0) {
      bumps(dt);
      for (const rec of list) if (!rec.gone && rec.presence !== "offscene") {
        rec.vel[0] = (rec.pos[0] - rec.tickX) / dt; rec.vel[1] = (rec.pos[2] - rec.tickZ) / dt;
      }
    }
    out.moveMs = moveMs;
    return out;
  }

  // How tall a person stands for a hit: their height, and on a seat their sitting height (the seat's plus about 0.52 of the stature, the
  // sitting-height ratio of adults) eased in through the sit-down and out through the rise, as the captured motion lowers and raises them.
  function topOf(rec) {
    const s = rec.sitting, m = rec.sitMotion;
    if (!s || !m || !(s.segment === "sitDown" || s.segment === "seated" || s.segment === "standUp")) return rec.height;
    const seated = s.seat.height + 0.52 * rec.height, f = Math.min(1, s.time / m.durations[s.segment]), e = f * f * (3 - 2 * f);
    return s.segment === "seated" ? seated : s.segment === "sitDown" ? rec.height + (seated - rec.height) * e : seated + (rec.height - seated) * e;
  }
  // A capsule per person (feet to crown, radius `half`), the same at every tier; a seated person's is their sitting height. Returns the nearest hit.
  function hit(origin, dir) {
    const dl = Math.hypot(...dir), D = dir.map(v => v / dl);
    let best = null;
    const ids = [];
    if (shown) { for (const r of shown) { const s = rooms.get(r); if (s) for (const id of s) ids.push(id); } }
    else for (const s of rooms.values()) for (const id of s) ids.push(id);
    for (const id of ids) {
      const rec = people.get(id);
      if (!rec || rec.presence !== "at_scene") continue;
      const t = rayCapsule(origin, D, [rec.pos[0], rec.pos[1] + rec.half, rec.pos[2]], [rec.pos[0], rec.pos[1] + Math.max(rec.half, topOf(rec) - rec.half), rec.pos[2]], rec.half);
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
      ...(rec.sitting ? {sitting:structuredClone(rec.sitting), ...(rec.afterStand?{afterStand:structuredClone(rec.afterStand)}:{})} : {}),
      ...(rec.paceState ? {paceState:{...rec.paceState}} : {}),
      doing: d ? { verb: d.verb, target: d.target, opts: d.opts } : null, holding: rec.holding, presence: rec.presence,
    };
  }

  return {
    /** With captured moves (env.moves): make a person's moves once, unseen (their retarget, raw poses and paths are kept; the code is warmed), so the first
     * start, stop or turn they make costs no more than the next. A page with one person close calls it as it loads. */
    warmMoves(id) {
      const rec = people.get(String(id)); if (!rec || !movesOn(rec)) return false;
      const w = rec.walker;
      for (const kind of Object.keys(MOVE_DEFS)) for (const mirror of [false, true]) {
        const S = moveShape(w, kind, mirror), slots = Math.max(1, Math.ceil(S.duration / MOVE_SLOT - 1e-9));
        makeMove(w, kind, { mirror, keepout: rec.dressing?.keepout ?? null, frames: slots * PACE_FRAMES + 1 });
      }
      feetOf(rec);
      return true;
    },
    // Diagnostic control: retain the pace bank and navigation, select Neutral's
    // retargeted capture speed for every body (including children).
    setSamePace(value) {
      env.samePace = !!value;
      for (const rec of people.values()) if (rec._walker?.bank) {
        const w = rec._walker; w.samePace = env.samePace;
        setWalkSpeed(w, desiredSpeed(w, rec.paceState?.time ?? 0, rec.doing?.opts?.urgency));
        if (rec.paceState) Object.assign(rec.paceState, {speed:w.v, tripStart:w.v});
      }
    },
    dispose() {
      for (const rec of people.values()) { rec.doing = null; remove(rec.id); }
      rooms.clear(); grid.clear(); cells.length = 0;
      arrivals.length = planners.length = nb.length = nbAll.length = nbAllD2.length = 0;
      listed = shown = null; queue = [];
    },
    add, remove, goTo, face, sit, stand, tick, hit, state,
    dump() {
      for (const rec of people.values()) catchUp(rec);
      return dumpPeople(people.values());
    },
    get: (id) => people.get(String(id)) ?? null,
    where(id) { const rec = people.get(String(id)); if (!rec) return null; catchUp(rec); return { pos: rec.pos.slice(), floor: rec.floor, room: rec.room }; },
    all: () => [...people.values()],
    show(roomIds) { shown = roomIds == null ? null : new Set(roomIds); listed = null; },
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
