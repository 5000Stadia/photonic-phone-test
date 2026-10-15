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
