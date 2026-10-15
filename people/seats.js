// The only translation from the host's level indices to Photonic floor ids.
export const seatFloor = (ctx, level) => ctx.floorId?.(level) ?? level;
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function seatPlace(ctx, thing, id, explicit) {
  const source = typeof thing === 'string' ? ctx.seat?.(thing) : thing;
  if (!source || source.id == null || !Array.isArray(source.contact) || source.contact.length !== 2 ||
      !source.contact.every(Number.isFinite) || !Number.isFinite(source.height) || source.height <= 0 ||
      !Number.isFinite(source.facing) || !Number.isInteger(source.floor)) throw Error('sit: invalid seat');
  const seat = {...source, id:String(source.id), contact:source.contact.slice(), places:source.places ?? 1};
  if (!Number.isInteger(seat.places) || seat.places < 1 || (seat.places > 1 && !(seat.width > 0))) throw Error('sit: invalid places/width');
  // The host supplies the complete sits_on facts; command order is not occupancy.
  const sitters = [...new Set((ctx.sitters?.(seat.id) ?? [id]).map(String))].sort(compare);
  const place = explicit ?? ctx.seatPlace?.(id) ?? sitters.indexOf(String(id));
  if (!Number.isInteger(place) || place < 0 || place >= seat.places) throw Error('sit: place outside seat');
  const offset = (place + .5) / seat.places * (seat.width ?? 0) - (seat.width ?? 0)/2;
  const x = seat.contact[0] + Math.cos(seat.facing)*offset, z = seat.contact[1] - Math.sin(seat.facing)*offset;
  return {seat, place, floor:seatFloor(ctx,seat.floor), contact:[x,z]};
}
// A seat's armrests (R6: `arms: [{ side: 'left'|'right', the sitter's own; at: [x, z], the armrest top's centre projected to the floor, like
// contact; height: m above the floor; length: m along the facing }]`, absent meaning none; design/r6-seats.md) in a sitter's own frame: the
// sitter's place at the origin, +z the seat's facing, +x the sitter's left (the people's frames; sitting.js makeSitting `arms`). [left, right],
// each { x, y, z0, z1 } or null: an armrest is the sitter's to use when it is on that side within reach (12 to 45 cm out from the middle of the
// place, 8 to 45 cm above the seat) and alongside the thighs.
export function armsOf(place) {
  const s0 = place.seat, list = Array.isArray(s0.arms) ? s0.arms : [], out = [null, null];
  const c = Math.cos(s0.facing), s = Math.sin(s0.facing);
  for (const arm of list) {
    if (!arm || (arm.side !== 'left' && arm.side !== 'right') || !Array.isArray(arm.at) || arm.at.length !== 2 || !arm.at.every(Number.isFinite) || !Number.isFinite(arm.height) || !(arm.length > 0)) continue;
    const dx = arm.at[0] - place.contact[0], dz = arm.at[1] - place.contact[1], x = c * dx - s * dz, z = s * dx + c * dz, i = arm.side === 'left' ? 0 : 1;
    const out_ = i === 0 ? x : -x, above = arm.height - s0.height;
    if (out_ < 0.12 || out_ > 0.45 || above < 0.08 || above > 0.45 || z + arm.length / 2 < -0.1 || z - arm.length / 2 > 0.45) continue;
    out[i] = { x, y: arm.height, z0: z - arm.length / 2, z1: z + arm.length / 2 };
  }
  return out[0] || out[1] ? out : null;
}
