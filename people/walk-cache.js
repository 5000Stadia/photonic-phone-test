// Keep a captured cycle until cadence alone would exceed its ±8% band.
// Recentering on each bake provides hysteresis: reversing at an old edge
// does not immediately request the old cycle again. Navigation stays continuous.
export const WALK_CADENCE_BAND = .08;
export function cycleAt(w) {
  const speed = w.v;
  if (!w.bank) return { blend: w.blend ?? 0, speed, stride: w.stride };
  let i = 0;
  while (i < w.bank.length - 2 && speed > w.bank[i + 1].v) i++;
  const a = w.bank[i], b = w.bank[i + 1];
  return cycleAtBlend(w, i + (speed - a.v) / (b.v - a.v));
}
export function cycleAtBlend(w, blend) {
  const i = Math.min(w.bank.length - 2, Math.floor(blend)), t = blend - i;
  const a = w.bank[i], b = w.bank[i + 1];
  return { blend, speed: a.v + (b.v - a.v) * t, stride: a.stride + (b.stride - a.stride) * t };
}
export function canRebakeAtPhase(w, phase) {
  const contact = ((phase + (w.phaseOffset ?? 0)) % .5 + .5) % .5;
  // Between the measured stationary-toe intervals: switch as support changes,
  // never halfway through a planted interval. Cadence covers the short wait.
  return contact > .15625 && contact < .1875;
}

export function needsWalkBake(w, cycle) {
  return Math.abs(w.v / cycle.speed - 1) > WALK_CADENCE_BAND + 1e-12;
}
export function advanceBakedPhase(rec, cycle) {
  const distance = rec.walkDistance ?? 0;
  cycle.phase = (cycle.phase + (distance - cycle.distance) / cycle.stride) % 1;
  cycle.distance = distance;
  rec.walkPhase = cycle.phase;
}


// Fixed levels include the full child urgency envelope. Centres are at most
// 14% apart: neighbouring ±8% bands overlap, giving switching hysteresis.
export function childCycles(w) {
  if (!w.bank || w.age >= 15) return null;
  const amplitude = w.age >= 4 ? .16 - .008 * (w.age - 4) : 0;
  const low = Math.max(w.minSpeed, w.preferred * (1 - amplitude));
  const high = w.briskSpeed;
  const n = Math.max(1, Math.ceil(Math.log(high / low) / Math.log(1.14)));
  return Array.from({length:n}, (_, i) => cycleAt({...w,
    v: low * (high / low) ** ((i + .5) / n)}));
}
export function closestCycle(w, levels) {
  let best = 0;
  for (let i = 1; i < levels.length; i++)
    if (Math.abs(w.v / levels[i].speed - 1) < Math.abs(w.v / levels[best].speed - 1)) best = i;
  return best;
}
