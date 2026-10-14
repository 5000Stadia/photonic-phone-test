// Float32 to half float, the draw's slot fills (walk texture rows, rest shapes): the very bits of three's DataUtils.toHalfFloat (truncating, same
// tables) for values within half range, which every position, normal and bone transform here is, but reading the float's bits from a view of the
// array itself, with no per-value store, clamp or call. tools/people/first-sight.js checks it against three's over a million values.
const BASE = new Uint16Array(512), SHIFT = new Uint8Array(512);
for (let i = 0; i < 256; i++) {
  const e = i - 127;
  if (e < -27) { BASE[i] = 0; BASE[i | 256] = 0x8000; SHIFT[i] = 24; SHIFT[i | 256] = 24; }
  else if (e < -14) { BASE[i] = 0x0400 >> (-e - 14); BASE[i | 256] = (0x0400 >> (-e - 14)) | 0x8000; SHIFT[i] = -e - 1; SHIFT[i | 256] = -e - 1; }
  else if (e <= 15) { BASE[i] = (e + 15) << 10; BASE[i | 256] = ((e + 15) << 10) | 0x8000; SHIFT[i] = 13; SHIFT[i | 256] = 13; }
  else if (e < 128) { BASE[i] = 0x7c00; BASE[i | 256] = 0xfc00; SHIFT[i] = 24; SHIFT[i | 256] = 24; }
  else { BASE[i] = 0x7c00; BASE[i | 256] = 0xfc00; SHIFT[i] = 13; SHIFT[i | 256] = 13; }
}
/** The half float bits of a float32 given as its raw bits. */
export const half = (u) => { const e = (u >>> 23) & 0x1ff; return BASE[e] + ((u & 0x007fffff) >> SHIFT[e]); };
/** A Uint32Array over a Float32Array's own memory, to read its values' bits. */
export const bitsOf = (f) => new Uint32Array(f.buffer, f.byteOffset, f.length);
/** dst[di ..] = the half floats of the n values from index si of `bits` (bitsOf a Float32Array). */
export function packHalf(dst, di, bits, si, n) {
  for (let i = 0; i < n; i++) dst[di + i] = half(bits[si + i]);
}
