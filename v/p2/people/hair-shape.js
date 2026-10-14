// Linear .mhclo-style maps, packed on toddler, child and adult bodies.
import { gz } from '../../spikes/makehuman/load.js';
import { RED } from './shape.js';
export const HAIR = JSON.parse(new TextDecoder().decode(await gz(new URL('./data/hair.json.gz', import.meta.url))));
for (const s of Object.values(HAIR.styles)) {
  for (const k of ['uv','rt','hl','sp']) s[k] = Float32Array.from(s[k]);
  s.nearIndex=Uint16Array.from(s.nearIndex); s.index = Uint16Array.from(s.index); s.far.index = Uint16Array.from(s.far.index);
  for (const c of s.cuts) {
    for (const k of ['normal','tangent']) c[k] = Float32Array.from(c[k]);
    for (const kind of ['mid']) for (const k of ['ids','w','off']) c[kind][k] = (k==='ids'?Uint16Array:Float32Array).from(c[kind][k]);
  }
}
export const hairCut = age => age < 5 ? 0 : age < 13 ? 1 : 2;
export function fitHair(style, tier, body, params) {
  const s=HAIR.styles[style], cut=s.cuts[hairCut(params.age)], b=cut.mid;
  // Compose with the body's own reduction at near bake: the two bindings cannot drift apart.
  if (tier==='near') body=RED.reduce(body).position;
  const vertices=tier==='far'?s.far.vertices:null, n=vertices?.length ?? b.ids.length/3;
  const position=new Float32Array(n*3), normal=new Float32Array(n*3);
  for(let v=0;v<n;v++) {
    const q=vertices?vertices[v]:v;
    for(let a=0;a<3;a++) {
      let x=b.off[3*q+a]*params.height;
      for(let k=0;k<3;k++)x+=b.w[3*q+k]*body[3*b.ids[3*q+k]+a];
      position[3*v+a]=x; normal[3*v+a]=cut.normal[3*q+a];
    }
  }
  return {position,normal};
}
