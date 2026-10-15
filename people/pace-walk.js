import {makeMocapWalker,poseMocap} from './mocap.js';
import {preferredPace,childVariation,childPhases,clamp} from './pace.js';
export const PACE_CLIPS=3;
export function makePacedWalker(J,who) {
 const bank=Array.from({length:PACE_CLIPS},(_,clipIndex)=>makeMocapWalker(J,{...who,clipIndex,paceBank:true}));
 // The smallest rigs otherwise truncate the preschool mean itself. Use only
 // the explicitly allowed timing margin: +8% at age three, fading to zero at
 // five, on the captured fast endpoint. Stride geometry is unchanged.
 const fast=bank.at(-1);fast.timingScale=1+.08*clamp((5-who.age)/2,0,1);fast.f*=fast.timingScale;fast.v=fast.stride*fast.f;
 const w={...bank[1],bank,variationPhases:childPhases(who.seed),age:who.age,seed:who.seed,preferred:preferredPace(who.age,who.sex,who.seed),blend:0,version:'100style-pace-v2'};
 w.Wm=new Float64Array(189);w.Pm=new Float64Array(63);w.bones={W:w.Wm,P:w.Pm};w.pose=posePaced;
 w.minSpeed=bank[0].v;w.maxSpeed=bank.at(-1).v;
 // Children use the captured walk envelope. No running/skipping is inferred.
 w.briskSpeed=who.age<15?w.maxSpeed*.95:w.maxSpeed;
 w.preferred=clamp(w.preferred,w.minSpeed,w.briskSpeed);
 w.samePace=!!who.samePace;
 setWalkSpeed(w,w.samePace?bank[1].v:w.preferred);
 return w;
}
export function desiredSpeed(w,time,urgency=0) {
 if(w.samePace)return w.bank[1].v;
 const base=clamp(w.preferred*(1+childVariation(w.age,w.seed,time,w.variationPhases)),w.minSpeed,w.briskSpeed);
 return base+((w.age<15?w.briskSpeed:w.maxSpeed)-base)*clamp(Number.isFinite(urgency)?urgency:0,0,1);
}
export function setWalkSpeed(w,speed) {
 speed=clamp(speed,w.minSpeed,w.maxSpeed);
 let i=0;while(i<w.bank.length-2&&speed>w.bank[i+1].v)i++;
 const a=w.bank[i],b=w.bank[i+1],t=clamp((speed-a.v)/(b.v-a.v),0,1);
 w.blend=i+t;w.v=speed;w.stride=a.stride+(b.stride-a.stride)*t;
 // Phase-matched captured strides, with the blended period chosen to cover
 // the blended distance at the requested speed; no stretched single clip.
 w.f=w.v/w.stride;
 return w;
}
function posePaced(w,phase) {
 const i=Math.min(w.bank.length-2,Math.floor(w.blend)),t=w.blend-i,a=w.bank[i],b=w.bank[i+1];
 const ka=a.keepout,kb=b.keepout;a.keepout=b.keepout=w.keepout;
 poseMocap(a,phase);poseMocap(b,phase);a.keepout=ka;b.keepout=kb;
 // Blend captured joint poses; the texture bake projects rotations to SO(3).
 for(let k=0;k<189;k++)w.Wm[k]=a.Wm[k]+(b.Wm[k]-a.Wm[k])*t;
 for(let k=0;k<63;k++)w.Pm[k]=a.Pm[k]+(b.Pm[k]-a.Pm[k])*t;
}
