/** Quality changes pixels only; distance tiers and the population stay untouched. */
export function peopleQuality(requested, device = globalThis) {
  if (requested === 'phone' || requested === 'pc') return requested;
  return device.matchMedia?.('(pointer: coarse)').matches || (device.innerWidth ?? 0) < 800 ? 'phone' : 'pc';
}
