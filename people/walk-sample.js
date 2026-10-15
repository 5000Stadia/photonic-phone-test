// Main's two filtered fetches: normalized quaternion and joint-preserving offset.
export function walkSample(T,texture,slot,phase,bone,{perRow,F,W,H,B}) {
 const x=slot.mod(perRow).mul(F+1).add(phase.mul(F)).add(.5).div(W).toVar();
 const y=slot.div(perRow).floor().mul(B*2).add(T.float(bone).mul(2));
 const q=texture.sample(T.vec2(x,y.add(.5).div(H))).level(0).normalize().toVar();
 const u=texture.sample(T.vec2(x,y.add(1.5).div(H))).level(0).xyz;
 const rotate=v=>{const t=T.cross(q.xyz,v).mul(2).toVar();return v.add(t.mul(q.w)).add(T.cross(q.xyz,t));};
 return {rotate,point:v=>rotate(v).add(u)};
}
