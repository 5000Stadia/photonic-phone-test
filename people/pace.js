// Comfortable overground norms, m/s. References and modelling choices:
// design/research/walking-pace.md. Sex uses the walk API's -1 female / +1 male.
import {rng} from '../body.js';
const adultMeans=[[1.358,1.341],[1.433,1.337],[1.434,1.390],[1.433,1.313],[1.339,1.241],[1.262,1.132],[.968,.943]];
const adultSD=[[.153,.175],[.094,.127],[.164,.158],[.229,.151],[.205,.213],[.196,.211],[.20,.24]];
export function paceNorm(age,sex=0) {
 const mix=(a,b)=>sex>0?a:sex<0?b:(a+b)/2;
 if(age<5)return {mean:age<4?mix(1.20,1.26):1.20,sd:age<4?mix(.15,.17):mix(.17,.18)};
 if(age<20){const i=age<7?0:age<9?1:age<11?2:age<14?3:4;return {mean:[1.11,1.19,1.25,1.34,1.28][i],sd:[.12,.16,.17,.14,.15][i]};}
 const i=Math.max(0,Math.min(6,Math.floor(age/10)-2));return {mean:mix(...adultMeans[i]),sd:mix(...adultSD[i])};
}
export function preferredPace(age,sex,seed) {
 const {mean,sd}=paceNorm(age,sex),r=rng((seed^0x4f1bbcdc)>>>0);
 // Rejection at ±2 SD preserves the centre, rather than piling up at the tails.
 let z;do{z=Math.sqrt(-2*Math.log(Math.max(1e-12,r())))*Math.cos(2*Math.PI*r());}while(Math.abs(z)>2);
 return mean+sd*z;
}
export function childPhases(seed){const r=rng((seed^0x728a91)>>>0);return [r()*Math.PI*2,r()*Math.PI*2];}
export function childVariation(age,seed,time,phases) {
 if(age<4||age>=15)return 0;
 const [a,b]=phases??childPhases(seed);
 // Smooth, zero-centred bursts/dawdling. Amplitude is an animation choice,
 // not the between-person SD or a clinical within-person speed estimate.
 return (.16-.008*(age-4))*(.65*Math.sin(time*.57+a)+.35*Math.sin(time*1.13+b));
}
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
