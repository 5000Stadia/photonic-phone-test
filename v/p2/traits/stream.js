// Independent seeded streams, one per trait (engine principle 2): a draw is a hash of (seed, person key, trait id,
// draw index), never a position in a shared random sequence, so adding a trait never changes anyone's existing ones,
// and order of building never matters. Integer hashing only (Math.imul and bit operations are exact everywhere).

function mix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function hashString(str, seed) {
  let a = 0x9e3779b9 ^ seed, b = 0x85ebca6b ^ Math.imul(seed, 0x27d4eb2f);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return [mix32(a ^ (b >>> 7)), mix32(b ^ (a >>> 11))];
}

// A 32-bit seed for a name (a world and an entity), when no seed was given.
export function seedOf(name) {
  return hashString(String(name), 0x5eed)[0];
}

// A uniform in the open interval (0, 1) with 53 bits, identical on every engine.
export function uniform(seed, key, trait, draw = 0) {
  const s = (seed >>> 0) ^ Math.imul(draw + 1, 0x9e3779b1);
  const [hi, lo] = hashString(`${key}\u0000${trait}`, s);
  return ((hi >>> 5) * 67108864 + (lo >>> 6) + 0.5) / 9007199254740992;
}
