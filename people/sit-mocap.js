// Raw CMU sit study. No IK, contact locks, pose synthesis, or cycle detrending.
import {BONES} from '../body.js';
import {ID,mm,mv,sub,turn} from '../bvh.js';
import {sampleAcclaim} from '../asf-amc.js';
export const SIT_MAP=['root','lowerback','thorax','lowerneck','head','lclavicle','lhumerus','lradius','lhand','rclavicle','rhumerus','rradius','rhand','lfemur','ltibia','lfoot','ltoes','rfemur','rtibia','rfoot','rtoes'];
export function makeSitRetarget(C,{J,tip},{origin=C.frames[0][0].P,floor=0}={}) {
 const map=SIT_MAP.map(n=>{if(C.index[n]===undefined)throw Error('Missing sit bone '+n);return C.index[n];});
 const sourceLeg=Math.hypot(...C.bones[C.index.lfemur].offset)+Math.hypot(...C.bones[C.index.ltibia].offset);
 const scale=(Math.hypot(...sub(J[14],J[13]))+Math.hypot(...sub(J[15],J[14])))/sourceLeg;
 // Every segment needs its own rest alignment, including head/hand/toe tips.
 // Inheriting a parent's alignment rotates a different rest vector incorrectly.
 const rest=map.map((s,b)=>{
  if(b===0)return ID; // ASF root has no endpoint vector.
  const child=BONES.findIndex(([,pa])=>pa===b),end=child<0?tip[BONES[b][0]]:J[child];
  return turn(sub(end,J[b]),C.bones[s].offset);
 });
 function pose(frameNumber) {
  const source=sampleAcclaim(C,frameNumber);
  const W=[],P=[];
  for(let b=0;b<BONES.length;b++){W[b]=mm(source[map[b]].W,rest[b]);const pa=BONES[b][1];
   P[b]=pa<0?source[0].P.map((v,k)=>(v-(k===1?floor:origin[k]))*scale):mv(W[pa],sub(J[b],J[pa])).map((v,k)=>v+P[pa][k]);}
  return {W,P};
 }
 return {pose,scale,rest,map};
}
