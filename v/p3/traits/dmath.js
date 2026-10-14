// Deterministic math for everything that decides who a person is (R2 framework, "Determinism across browser engines").
// JavaScript guarantees bit-identical results only for + − × ÷ and Math.sqrt; Math.log/exp/pow/sin may differ in the
// last bit between V8 and JavaScriptCore. These functions use only those operations (and exact scaling by 2), so
// Chromium, Safari and node agree bit for bit.

const LN2_HI = 6.93147180369123816490e-01; // LN2 split so k*LN2_HI is exact for |k| < 2^20
const LN2_LO = 1.90821492927058770002e-10;
const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;

// x = m * 2^k with m in [sqrt(1/2), sqrt(2)); multiplying by 2 or 1/2 is exact for normal doubles.
function split(x) {
  let k = 0;
  while (x >= 1024) { x *= 1 / 1024; k += 10; }
  while (x < 1 / 1024) { x *= 1024; k -= 10; }
  while (x >= SQRT2) { x *= 0.5; k += 1; }
  while (x < SQRT2 / 2) { x *= 2; k -= 1; }
  return [x, k];
}

export function dlog(x) {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  const [m, k] = split(x);
  const s = (m - 1) / (m + 1), s2 = s * s; // |s| < 0.172, so 2·atanh(s) converges fast
  let term = s, sum = 0;
  for (let n = 1; n < 40; n += 2) { sum += term / n; term *= s2; }
  return 2 * sum + k * LN2_HI + k * LN2_LO;
}

export function dexp(x) {
  if (x !== x) return NaN;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  // round half away from zero with exact operations
  const k = x >= 0 ? Math.floor(x / LN2 + 0.5) : -Math.floor(-x / LN2 + 0.5);
  const r = (x - k * LN2_HI) - k * LN2_LO; // |r| <= ln2/2
  let term = 1, sum = 1;
  for (let n = 1; n < 30; n++) { term *= r / n; sum += term; }
  let p = sum, e = k;
  while (e > 0) { const s = Math.min(e, 30); p *= 2 ** s; e -= s; } // powers of two are exact constants
  while (e < 0) { const s = Math.min(-e, 30); p *= 1 / 2 ** s; e += s; }
  return p;
}

// Standard normal quantile (Acklam's rational approximation, relative error < 1.2e-9), with one Halley refinement
// step through dcdf, so the result is accurate to about 1e-15 and identical on every engine.
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

export function probit(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  let x;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * dlog(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  } else if (p <= 1 - 0.02425) {
    const q = p - 0.5, r = q * q;
    x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * dlog(1 - p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  const e = dcdf(x) - p;
  const u = e * 2.5066282746310002 * dexp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

// Standard normal CDF via erfc (W. J. Cody's rational approximations, as in Hart et al.), double accuracy.
export function dcdf(x) {
  return x < 0 ? 0.5 * erfc(-x / Math.SQRT2) : 1 - 0.5 * erfc(x / Math.SQRT2);
}

function erfc(x) { // x >= 0
  if (x < 0.5) return 1 - erfSmall(x);
  if (x < 4) {
    const P = [5.64188496988670089e-1, 8.88314979438837594e0, 6.61191906371416295e1, 2.98635138197400131e2, 8.81952221241769090e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3, 2.15311535474403846e-8];
    const Q = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3, 3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3];
    let num = P[8] * x, den = x;
    for (let i = 0; i < 7; i++) { num = (num + P[i]) * x; den = (den + Q[i]) * x; }
    const r = (num + P[7]) / (den + Q[7]);
    return expMinusSquare(x) * r;
  }
  const P = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
  const Q = [2.56852019228982242e0, 1.87295284992346725e0, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
  const z = 1 / (x * x);
  let num = P[5] * z, den = z;
  for (let i = 0; i < 4; i++) { num = (num + P[i]) * z; den = (den + Q[i]) * z; }
  let r = z * (num + P[4]) / (den + Q[4]);
  r = (0.5641895835477563 - r) / x; // 1/sqrt(pi)
  return expMinusSquare(x) * r;
}

function erfSmall(x) {
  const P = [3.16112374387056560e0, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1];
  const Q = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
  const z = x * x;
  let num = P[4] * z, den = z;
  for (let i = 0; i < 3; i++) { num = (num + P[i]) * z; den = (den + Q[i]) * z; }
  return x * (num + P[3]) / (den + Q[3]);
}

// exp(-x²) split as in Cody's code so large x keeps its accuracy
function expMinusSquare(x) {
  const xs = Math.trunc(x * 16) / 16, d = (x - xs) * (x + xs);
  return dexp(-xs * xs) * dexp(-d);
}
