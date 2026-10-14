// Presentation only: never modifies resolved traits or their random streams.
import { uniform } from '../traits/stream.js';
export const HAIR_STYLES = ['bob', 'long', 'braid', 'afro', 'updo', 'crop'];
const clamp = x => Math.max(0, Math.min(1, x));
/** Pigment amounts are the resolver's hair-colour traits; RGB here is linear. */
export function hairColour(v, derived = {}) {
  const e = clamp(v['hair.eumelanin'] ?? .55), p = clamp(v['hair.pheomelanin'] ?? .3), g = clamp(derived['hair.greying'] ?? v['hair.greying'] ?? 0);
  const light = (1-e)*(1-e);
  const rgb = [.018 + .52*light + .12*p*(1-e), .009 + .32*light*(1-.65*p), .005 + .12*light*(1-.8*p)];
  return rgb.map((c,i) => c*(1-g)+[.62,.60,.56][i]*g);
}
export function hairFor(values, seed = 0, derived = {}, scopes = {}) {
  const v = values, s = v['hair.style'], length = v['hair.length'] ?? 15, age = v.age ?? 30;
  let style;
  if (length <= .5 || s === 'shaved' || ['total','Norwood 7'].includes(v['hair.loss.pattern']) || v['hair.density'] === 0) style = null;
  else if (scopes['hair.length'] && !scopes['hair.style']) style = length > 12 ? 'long' : 'crop';
  else if (s === 'long') style = 'long';
  else if (s === 'bun' || s === 'coif' || s === 'updo') style = 'updo';
  else if (['braids','braid','queue','pigtail','dreadlocks'].includes(s)) style = 'braid';
  else if (s === 'bob') style = 'bob';
  else if (s === 'afro' || (v['hair.texture'] ?? 0) > .7) style = 'afro';
  else if (s === 'crop' || length < 4 || age < 2) style = 'crop';
  else if (v.sex === 'female' && !scopes['hair.length'] && !scopes['hair.style'] && uniform(seed, '', 'crowd-hair-up') < .75) style = 'updo';
  else style = length > 12 ? 'long' : 'crop';
  return { style, colour: hairColour(v, derived) };
}
/** Conservative scalp paint: above the brow, and round the back, never the face. */
export function hairRegion(position, height = 1) {
  const out = new Float32Array(position.length/3);
  for (let v=0;v<out.length;v++) {
    const y=position[3*v+1]/height, z=position[3*v+2]/height;
    out[v] = y > .965 || (y > .90 && z < -.012) ? 1 : 0;
  }
  return out;
}
