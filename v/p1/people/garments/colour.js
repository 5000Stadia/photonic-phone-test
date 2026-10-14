// Colour for garments (R5): hex to CIE L*a*b* and the distance between two colours, so a garment can be checked against every skin tone it might sit beside.
// sRGB (D65) to Lab; deltaE is CIE76 (the plain Euclidean distance), which reads a little generous for saturated colours, so the bar is set with room over it.
// Only used when an outfit is declared and checked, never per frame.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** "#rrggbb" (or [r, g, b] in 0..255) to [L, a, b]. */
export function lab(hex) {
  const [r, g, b] = (typeof hex === "string" ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : hex).map(lin);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** The CIE76 colour difference between two colours. */
export function deltaE(a, b) { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
