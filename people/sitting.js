// CMU motions are loaded only on the first sit request. Walking-only worlds
// never fetch, parse, retarget or bake a sitting capture.
import {BONES} from '../body.js';
import {mm,mv,sub,turn,rot,tr} from '../bvh.js';
import {writePose} from './walk.js';
import {makeSitRetarget} from './sit-mocap.js';
export const SIT_FRAMES = 64;
// the nearest rotation to a 3x3 (Newton's polar iteration)
function polar(M){let m=M.slice();for(let it=0;it<10;it++){const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=f*g-d*i,C=d*h-e*g,det=a*A+b*B+c*C;
 const inv=[A/det,B/det,C/det,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det];m=m.map((v,k)=>.5*(v+inv[k]));}return m;}
let sampleAcclaim=null;
export const SIT_SEGMENTS = ['sitDown','seated','standUp'];
let pending;
const read = async url => typeof process !== 'undefined' && process.versions?.node
  ? (await import('node:fs/promises')).readFile(url,'utf8')
  : fetch(url).then(r=>{if(!r.ok)throw Error(`sit: ${r.status} ${url}`);return r.text();});
export function loadSitting() {
  return pending ??= (async()=>{
    const acclaim=await import('../asf-amc.js'),{readASF,readAMC,acclaimFrame}=acclaim;sampleAcclaim=acclaim.sampleAcclaim;
    const meta=JSON.parse(await read(new URL('../design/research/sit-captures.json',import.meta.url)));
    return Promise.all(meta.clips.map(async spec=>{
      const base=new URL('../vendor/sit/cmu/',import.meta.url);
      const [asf,amc]=await Promise.all([read(new URL(spec.subject+'.asf',base)),read(new URL(spec.id+'.amc',base))]);
      const C=deflip(readAMC(amc,readASF(asf)),acclaimFrame),mid=(spec.rest[0]+spec.rest[1])/2,R=sampleAcclaim(C,mid)[0].W;
      const yaw=rot('Y',-Math.atan2(R[2],R[8])*180/Math.PI);
      // Shared capture sampling: never parse/interpolate AMC per body.
      const samples=Object.fromEntries(SIT_SEGMENTS.map(segment=>[segment,Array.from({length:SIT_FRAMES+1},(_,i)=>{
        const frame=sitFrame(spec,segment,i/SIT_FRAMES);return {frame,source:sampleAcclaim(C,frame)};
      })]));
      // The take's own gaze: the mean orientation of the lower neck and of the head against the thorax over the sit. 113_15's
      // actor keeps her head turned 47 degrees aside and tilted 40 from sit-down to rise (subject 113's neck chain also zig-zags
      // sideways in its rest pose); 13_05 and 13_01 average within a few degrees of straight. A generic sit faces where the body
      // does, so that constant is taken out of neck and head (M^T R, in the thorax's frame) and their captured movement about it kept.
      const meanRel=name=>{const acc=new Array(9).fill(0);let n=0;
        for(let f=spec.segments.sitDown[0];f<=spec.segments.standUp[1];f+=4){const src=sampleAcclaim(C,f),R=mm(tr(src[C.index.thorax].W),src[C.index[name]].W);for(let k=0;k<9;k++)acc[k]+=R[k];n++;}
        return tr(polar(acc.map(v=>v/n)));};
      const gaze={neck:meanRel('lowerneck'),head:meanRel('head')};
      // What is left of the gaze moves: 113_15's actor still turns her head 20 degrees aside and tilts it 29 for the whole seated stretch
      // (and back for the sit-down and the rise, as the constant above is their mean). Lower neck and head against the thorax, the constant
      // taken out, every fourth frame (30 a second) over the sit and a second either side, for makeSitting to measure on its rig (smoothTurns).
      const from=Math.max(C.numbers[0],spec.segments.sitDown[0]-120),to=Math.min(C.numbers.at(-1),spec.segments.standUp[1]+120),turns={from,step:4,neck:[],head:[]};
      for(let f=from;f<=to;f+=4){const src=sampleAcclaim(C,f),th=tr(src[C.index.thorax].W);turns.neck.push(mm(gaze.neck,mm(th,src[C.index.lowerneck].W)));turns.head.push(mm(gaze.head,mm(th,src[C.index.head].W)));}
      // Where the hands rest: frame by frame over the sit, each palm's place on its thigh (the share along the femur and the direction
      // round it, from up toward the outside) and how still it is (1 resting, 0 moving), closed over short gaps like the feet's.
      // What each hand does, frame by frame over the sit: where the palm is on its own thigh (the share along the femur and the direction round it,
      // from up toward the outside), how near it is to that thigh and how still (together: resting on it, `thigh`), and, for a take recorded on a
      // chair with arms (spec.armrests, 113_15), how much it is on the armrest (`arm`: at the seated palms' height and side, not swinging) and how
      // far forward along it (`fwd`, metres in the seated frame, before the rig's scale). The armrests are the chair's, not the person's: on a seat
      // without them, makeSitting puts those hands on the sitter's own thighs instead.
      const restMid=(spec.rest[0]+spec.rest[1])/2,O=sampleAcclaim(C,restMid)[0].P,seatedOf=p=>{const q=mv(yaw,sub(p,O));return {lat:q[0],h:p[1]-spec.floorM,fwd:q[2]};};
      const palmOf=(src,s)=>{const h=src[C.index[s+'hand']];return h.P.map((v,k)=>(v+h.E[k])/2);},median=a=>{const q=[...a].sort((x,y)=>x-y);return q[q.length>>1];};
      const handSpan={};
      const rest=[0,1].map(side=>{const s=side?'r':'l',out=[];
        let restH=null,restLat=null;
        if(spec.armrests){const hs=[],ls=[];for(let f=spec.rest[0];f<=spec.rest[1];f+=2){const q=seatedOf(palmOf(sampleAcclaim(C,f),s));hs.push(q.h);ls.push(q.lat);}restH=median(hs);restLat=median(ls);}
        for(let f=spec.segments.sitDown[0];f<=spec.segments.standUp[1];f++){
          const a=sampleAcclaim(C,f-2),b=sampleAcclaim(C,f+2),c=sampleAcclaim(C,f),palm=src=>palmOf(src,s);
          const speed=Math.hypot(...sub(palm(b),palm(a)))*30,fe=c[C.index[s+'femur']],ax=sub(fe.E,fe.P),L=Math.hypot(...ax),u=ax.map(v=>v/L),pp=palm(c);
          const t=Math.max(0,Math.min(1,sub(pp,fe.P).reduce((q,v,k)=>q+v*u[k],0)/L)),r=sub(pp,fe.P.map((v,k)=>v+ax[k]*t));
          const up=[0,1,0].map((v,k)=>v-u[1]*u[k]),ul=Math.hypot(...up)||1,uu=up.map(v=>v/ul),out_=[u[1]*uu[2]-u[2]*uu[1],u[2]*uu[0]-u[0]*uu[2],u[0]*uu[1]-u[1]*uu[0]];
          // outward: away from the pelvis's middle (the same rule the rig's side uses below)
          const mid=sub(fe.P,c[0].P),lat=out_[0]*mid[0]+out_[2]*mid[2]<0?-1:1,q=seatedOf(pp);
          // near the thigh: within 13 cm of the femur's axis (her thigh's girth and half a hand), none past 18
          const near=1-Math.max(0,Math.min(1,(Math.hypot(...r)-.13)/.05));
          out.push({f,t,phi:Math.atan2(r.reduce((q,v,k)=>q+v*out_[k],0)*lat,r.reduce((q,v,k)=>q+v*uu[k],0)),still:1-Math.max(0,Math.min(1,(speed-.05)/.1)),near,fwd:q.fwd,
            arm:spec.armrests&&Math.abs(q.h-restH)<.05&&Math.abs(q.lat-restLat)<.06&&speed<.8?1:0});
        }
        // close gaps and drop flickers of a tenth of a second, then ease over a quarter second either way (a raised cosine), so a hand settles onto the thigh and
        // leaves it as gradually as the captured hand slows and starts
        const R=12,S=30,n=out.length,at=(arr,i)=>arr[Math.max(0,Math.min(n-1,i))],m=(arr,op)=>arr.map((_,i)=>{let v=arr[i];for(let j=-R;j<=R;j++)v=op(v,at(arr,i+j));return v;});
        const close=arr=>m(m(m(m(arr,Math.max),Math.min),Math.min),Math.max),k=Array.from({length:2*S+1},(_,j)=>.5+.5*Math.cos(Math.PI*(j-S)/(S+1))),ks=k.reduce((a,b)=>a+b);
        const ease=arr=>arr.map((_,i)=>{let v=0;for(let j=-S;j<=S;j++)v+=k[j+S]*at(arr,i+j);return v/ks;});
        const closed=close(out.map(o=>o.still*o.near)),thigh=ease(closed);
        out.forEach((o,i)=>{o.still=thigh[i];});
        // the place on the thigh, eased the same way (a short stretch of a moving hand would otherwise drag the target round the thigh)
        for(const key of ['t','phi']){const v=out.map(o=>o[key]);out.forEach((o,i)=>{let a=0,w=0;for(let j=-S;j<=S;j++){const q=k[j+S]*at(closed,i+j)+1e-6;a+=q*at(v,i+j);w+=q;}o[key]=a/w;});}
        // on the armrest: closed the same way; the hand reaches it over the 0.35 s before (a raised cosine) and leaves it over the 0.25 s after, and its
        // place along the armrest is the captured one, smoothed over a tenth of a second, held at the first and last of the contact outside it
        const on=close(out.map(o=>o.arm)),from=on.indexOf(1),to=on.lastIndexOf(1);
        handSpan[side]=from<0?null:{from:out[from].f,to:out[to].f};
        const fwd=out.map((o,i)=>{let a=0,w=0;for(let j=-6;j<=6;j++){a+=at(out,Math.max(from,Math.min(to,i+j))).fwd;w++;}return a/w;});
        out.forEach((o,i)=>{
          if(from<0){o.arm=0;o.fwd=0;return;}
          let w=on[i];
          if(!w){let d=Infinity;for(let j=Math.max(0,i-30);j<=Math.min(n-1,i+42);j++)if(on[j]){const e=j>i?(j-i)/42:(i-j)/30;if(e<d)d=e;}w=d<1?.5+.5*Math.cos(Math.PI*d):0;}
          o.arm=w;o.fwd=fwd[Math.max(from,Math.min(to,i))];
        });
        return out;});
      return {spec,C,yaw,samples,gaze,turns,rest,handSpan};
    }));
  })().catch(e=>{pending=null;throw e;});
}
// The solver's half-turn flips: a rotation channel that jumps by a half turn between two frames (8 ms) and back some frames later is a
// solve that went to its mirror solution, not a hand that spun (113_15's left hand turns palm up for frames 221-239, rz -90 to -270 and
// back). Each such jump is undone for the run it starts; a whole-turn wrap is left to the sampler's shortest-way interpolation.
function deflip(C,frameOf) {
  let fixed=0;
  for(const b of C.bones)b.channels.forEach((ch,k)=>{
    if(ch[0]!=='r')return;
    let off=0,prev=null;
    for(const row of C.rows){const v=row[b.name][k];if(prev!==null){let d=v+off-prev;d-=360*Math.round(d/360);if(Math.abs(Math.abs(d)-180)<30){off-=180*Math.sign(d);fixed++;}}
      if(off)row[b.name][k]=v+off;prev=row[b.name][k];}
  });
  if(fixed)C.frames=C.rows.map(r=>frameOf(C,r));
  C.deflipped=fixed;
  return C;
}
// What the runtime plays of a take: sit down to the start of its stable seated window (spec.rest), loop that window, and stand up from its
// end. The study's own segments (spec.segments) keep the settling and the preparation to rise inside "seated", so looping them made a
// sitter lean forward to rise and sit back again every few seconds, and a stand-up began from wherever that loop was.
export const sitRanges=spec=>({sitDown:[spec.segments.sitDown[0],spec.rest[0]],seated:[spec.rest[0],spec.rest[1]],standUp:[spec.rest[1],spec.segments.standUp[1]]});
export function sitFrame(spec,segment,phase) {
  const [a,b]=sitRanges(spec)[segment];
  // Traverse captured seated shifts and return through the same samples. Cosine
  // timing eases the two reversals; no synthetic oscillation is added to a bone.
  const t=segment==='seated' ? (1-Math.cos(phase*Math.PI*2))/2 : phase;
  return a+(b-a)*t;
}
export const sitDuration = (spec,segment) => {const [a,b]=sitRanges(spec)[segment];return (b-a)/120*(segment==='seated'?2:1);};
const cache=new Map();
// `legs`: what the hands rest on, the clothes over the thighs (garments/skirt.js thighCover: the surface's distance from the femur's axis at nine
// shares along the thigh and four directions from straight up to straight out); left out, the bare thigh, a proportion of the height.
// `arms`: the seat's armrests in the sit's own frame (the seat's contact at the origin, +z its facing, +x the sitter's left; population.js
// armsOf): [left, right], each { x, y (the top's height), z0, z1 (its extent along the facing) } or null; left out, a seat without arms.
export function makeSitting(bank,J,tip,height,seatHeight,clipId,legs=null,arms=null) {
  // Hip joint above the surface, rather than burying the hip joint in the board.
  const cushion=.09*height;
  const target=seatHeight+cushion;
  const clip=clipId ? bank.find(c=>c.spec.id===clipId) : bank.reduce((best,c)=>
    Math.abs(fittingSeatHeight(bank,J,tip,height,c.spec.id)-seatHeight)<Math.abs(fittingSeatHeight(bank,J,tip,height,best.spec.id)-seatHeight)?c:best);
  if(!clip)throw Error('sit: unknown capture');
  const key=JSON.stringify([clip.spec.id,J,tip,seatHeight,height,legs&&Array.from(legs,v=>+v.toFixed(4)),arms]);
  if(cache.has(key))return cache.get(key);
  const {spec,C,yaw,samples}=clip,rig=makeSitRetarget(C,{J,tip},{origin:spec.originM,floor:spec.floorM});
  const delta=target-spec.seat.pelvisProxyM*rig.scale;
  const report={clip:spec.id,pelvisAdjustmentM:delta,maxHipDeg:0,maxKneeDeg:0,maxKneeJointDeg:0,maxReachErrorM:0};
  // (the take's constant gaze taken out of neck and head, in the thorax's frame, and then the slow part of their turn and tilt on this
  // rig: loadSitting, smoothTurns)
  const dj4=sub(J[4],J[3]),turns=clip.turns&&smoothTurns(clip.turns,rig.rest);
  const raw=(frame,source=sampleAcclaim(C,frame))=>{const p=rig.pose(frame,source),P=p.P.map(v=>mv(yaw,v)),W=p.W.map(w=>mm(yaw,w));
    if(clip.gaze){const th=mm(yaw,source[C.index.thorax].W),fix=M=>mm(mm(th,M),tr(th));W[3]=mm(fix(clip.gaze.neck),W[3]);W[4]=mm(fix(clip.gaze.head),W[4]);
      if(turns){const x=Math.max(0,Math.min(turns.n-1,(frame-turns.from)/turns.step)),i=Math.min(turns.n-2,Math.floor(x)),u=x-i,ch=W[2];
        for(const b of [3,4]){const c=turns[b],y=c.yaw[i]+(c.yaw[i+1]-c.yaw[i])*u,r=c.roll[i]+(c.roll[i+1]-c.roll[i])*u;W[b]=mm(mm(mm(ch,rot('Y',-y)),tr(ch)),mm(W[b],rot('Z',-r)));}}
      P[4]=mv(W[3],dj4).map((v,k)=>v+P[3][k]);}
    return {P,W};};
  const anchors=[spec.contacts.left,spec.contacts.right].map((runs,side)=>runs.map(([a,b])=>{
    const p=raw((a+b)/2).P[side?20:16];return {a,b,p:[p[0],J[side?20:16][1],p[2]]};
  }));
  const standingPose=raw(spec.segments.sitDown[0]),standing=standingPose.P[0][1],seated=spec.seat.pelvisProxyM*rig.scale;
  const floorDrop=([16,20].reduce((n,b)=>n+standingPose.P[b][1]-J[b][1],0))/2;
  function pose(frame,source) {
    const p=raw(frame,source),root=p.P[0][1];
    const weight=Math.max(0,Math.min(1,(standing-root)/(standing-seated)));
    for(const q of p.P)q[1]+=delta*weight-floorDrop*(1-weight);
    for(let side=0;side<2;side++) {
      const toe=side?20:16,run=anchors[side].find(r=>frame>=r.a&&frame<=r.b);
      let goal;
      if(run)goal=run.p;
      else {
        // Smoothly enter/leave contact over six source frames; retain airborne motion.
        const near=anchors[side].find(r=>frame>=r.a-6&&frame<=r.b+6);
        const t=near?Math.max(0,1-Math.min(Math.abs(frame-near.a),Math.abs(frame-near.b))/6):0;
        goal=p.P[toe].map((v,k)=>v*(1-t)+(near?.p[k]??v)*t);
        goal[1]=Math.max(J[toe][1],goal[1]);
      }
      lockLeg(p,J,side,goal,report);
    }
    restHands(p,frame);
    return p;
  }
  // The hands (Kabe, 2026-10-15: on the chair's arms when it has them; without, "dangling or using the characters own knees or legs as one
  // would naturally do"). Where the take's hand rests on her own thigh, ours rests on ours: at the same share along the thigh and the same
  // side of it, on its surface (the leg's radius there or its clothes, and half a hand). 113_15 was recorded on a chair with arms
  // (loadSitting: spec.armrests): from the sit-down to the rise her palms are on its armrests, sliding along them as she lowers and rises.
  // On a seat with arms ours are on its armrests, as far forward along them as hers were; on one without, they brace on his own thighs
  // from the start of the sit-down (above the knees, as far down as he can reach), slide back to rest mid-thigh as he settles, and brace
  // again as he leans forward to rise, until her hands leave the armrests. Each by two-bone IK from the shoulder with the captured hand's
  // orientation kept, as much as the take's hand is in contact (moving hands keep their captured paths). The trunk, the legs and the timing
  // are the capture's; only the hands follow the seat.
  // (the bare thigh with its stocking, 8 mm, or the clothes' surface: either way half a hand, 16 mm, more to the palm's middle)
  const bare=[.075,.08,.075,.06,.055].map(v=>v*height/1.75+.008);
  const thighR=(t,phi)=>{
    if(!legs){const x=Math.max(0,Math.min(1,t))*4,i=Math.min(3,Math.floor(x)),f=x-i;return bare[i]+(bare[i+1]-bare[i])*f;}
    const x=Math.max(0,Math.min(1,t))*8,i=Math.min(7,Math.floor(x)),f=x-i,y=Math.max(0,Math.min(90,phi*180/Math.PI))/30,j=Math.min(2,Math.floor(y)),g=y-j,at=(a,b)=>legs[a*4+b];
    return (at(i,j)*(1-g)+at(i,j+1)*g)*(1-f)+(at(i+1,j)*(1-g)+at(i+1,j+1)*g)*f;};
  const palmOff=[8,12].map(b=>sub(tip[b===8?'handL':'handR'],J[b]).map(v=>v*.45)),armL=[6,10].map(b=>[Math.hypot(...sub(J[b+1],J[b])),Math.hypot(...sub(J[b+2],J[b+1]))]);
  // without arms: braced above the knees (a share of 0.78 along the thigh, 20 degrees out from its top) in the sit-down and the rise, resting
  // mid-thigh (0.5, 31 degrees) on the seat, the one sliding into the other over the half second before the seated stretch and after it
  const BRACE=[.78,.35],REST=[.5,.55],smooth=x=>{const v=Math.max(0,Math.min(1,x));return v*v*(3-2*v);};
  const braceAt=f=>f<spec.rest[0]?1-smooth((f-spec.rest[0]+60)/60):f>spec.rest[1]?smooth((f-spec.rest[1])/60):0;
  // the rig's seated pelvis, forward along the seat: the take's palm moved along her armrest in her seated frame
  const seatedZ=raw((spec.rest[0]+spec.rest[1])/2).P[0][2];
  function restHands(p,frame) {
    for(let side=0;side<2;side++) {
      const rs=clip.rest[side],i=Math.round(frame)-rs[0].f;if(i<0||i>=rs.length)continue;
      const o=rs[i],span=clip.handSpan?.[side],arm=arms?.[side];
      const hip=side?17:13,a=p.P[hip],b=p.P[hip+1],ax=sub(b,a),L=Math.hypot(...ax),u=ax.map(v=>v/L);
      const up=[0,1,0].map((v,k)=>v-u[1]*u[k]),ul=Math.hypot(...up)||1,uu=up.map(v=>v/ul);
      let out=[u[1]*uu[2]-u[2]*uu[1],u[2]*uu[0]-u[0]*uu[2],u[0]*uu[1]-u[1]*uu[0]];
      // outward is away from the pelvis's middle
      const mid=sub(a,p.P[0]);if(out[0]*mid[0]+out[2]*mid[2]<0)out=out.map(v=>-v);
      const hb=side?12:8,sh=hb-2,W=p.W[hb],off=mv(W,palmOff[side]),fk=p.P[hb];
      const onThigh=(t,phi)=>{const r=thighR(t,phi)+.016,dir=uu.map((v,k)=>v*Math.cos(phi)+out[k]*Math.sin(phi));return a.map((v,k)=>v+ax[k]*t+dir[k]*r);};
      let w=0,target=null,onArm=0;
      if(span) {
        if(arm){
          w=onArm=o.arm;
          if(w>1e-3){
            // as far along the armrest as hers was; where that is out of his reach (his shoulders sit higher and further back than hers),
            // the nearest place toward his shoulder that is in reach, so the hand lands as soon as it can and slides back as he lowers
            const lo=arm.z0+.05,hi=arm.z1-.03,zc=Math.max(lo,Math.min(hi,seatedZ+o.fwd*rig.scale)),S=p.P[sh],reach=.985*(armL[side][0]+armL[side][1]);
            const far=z=>Math.hypot(arm.x-off[0]-S[0],arm.y+.016-off[1]-S[1],z-off[2]-S[2])>reach,zs=Math.max(lo,Math.min(hi,S[2]+off[2]));
            let z=zc;if(far(z)){z=zs;for(let k=1;k<=12;k++){const zz=zc+(zs-zc)*k/12;if(!far(zz)){z=zz;break;}}}
            target=[arm.x,arm.y+.016,z];
          }
        }
        else {
          w=frame<span.from?1:o.arm;
          if(w>1e-3){
            const br=braceAt(frame),phi=REST[1]+(BRACE[1]-REST[1])*br,reach=.97*(armL[side][0]+armL[side][1])+Math.hypot(...palmOff[side]);
            // as far down the thigh as he can reach from the shoulder (upright at the start of the sit-down, his hands are on the front of the thigh)
            let t=REST[0]+(BRACE[0]-REST[0])*br;
            while(t>.3&&Math.hypot(...sub(onThigh(t,phi),p.P[sh]))>reach)t-=.04;
            target=onThigh(t,phi);
          }
        }
      }
      // resting on his own thigh where hers rested on hers
      if(o.still>w){w=o.still;target=onThigh(o.t,o.phi);}
      let wrist=w>1e-3?fk.map((v,k)=>v+(target[k]-off[k]-v)*w):fk;
      // a moving hand that passes over the thigh keeps out of it (and out of the clothes on it): the captured hand went by a bare thigh
      if(legs){const q=sub(wrist.map((v,k)=>v+off[k]),a),t=(q[0]*u[0]+q[1]*u[1]+q[2]*u[2])/L,rad=q.map((v,k)=>v-u[k]*t*L),d=Math.hypot(...rad);
        // (faded in over the thigh's ends and the edges of its top and outside, so a hand coming over them is lifted gradually)
        const phi=Math.atan2(rad[0]*out[0]+rad[1]*out[1]+rad[2]*out[2],rad[0]*uu[0]+rad[1]*uu[1]+rad[2]*uu[2]),ramp=(x,e0,e1)=>{const v=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return v*v*(3-2*v);};
        // (not for a hand on an armrest: it rests there, whatever the clothes' bulk below it)
        const fade=ramp(t,0,.1)*ramp(t,1,.9)*ramp(phi,-Math.PI/6,-Math.PI/18)*ramp(phi,2*Math.PI/3,5*Math.PI/9)*(1-onArm),need=fade>0?(thighR(t,phi)+.016)*fade:0;
        if(d>1e-6&&d<need)wrist=wrist.map((v,k)=>v+rad[k]/d*(need-d));}
      if(wrist!==fk)armTo(p,sh,wrist,armL[side]);
    }
  }
  const motion={spec,report,J,pose,samples,durations:Object.fromEntries(SIT_SEGMENTS.map(s=>[s,sitDuration(spec,s)]))};
  // Reject substantial pose changes, rather than stretching the captured action
  // to an unsuitable seat. Sample the source lattice before starting a trip.
  // (the hands rest on the clothes or the armrests: the legs and the seat are the bare sit's, already sampled)
  const started=performance.now(),bareSit=(legs||arms)&&makeSitting(bank,J,tip,height,seatHeight,clip.spec.id);
  if(bareSit)Object.assign(report,bareSit.report);
  else for(const segment of SIT_SEGMENTS)for(let f=0;f<=SIT_FRAMES;f+=8) {
    const sample=samples[segment][f];pose(sample.frame,sample.source);
  }
  motion.fitMs=performance.now()-started;
  motion.fits=Math.max(report.maxHipDeg,report.maxKneeDeg,report.maxKneeJointDeg)<=24 && report.maxReachErrorM<=.0025;
  cache.set(key,motion);if(cache.size>64)cache.delete(cache.keys().next().value);
  return motion;
}
// The slow turn (about the chest's up) and tilt (about the face's forward) of the neck and of the head against the chest, on a rig: each
// sample's rotation against the chest is R = Ry(turn) Rx(nod) Rz(tilt); turn and tilt are smoothed over about a second either way (two
// passes of a box a half second wide, a triangle) and taken out (Ry(-turn) R Rz(-tilt)), which keeps the capture's nod (looking down to
// the seat, up as the chest leans to rise) and its quicker turns and tilts, and faces the head, on average, where the chest does.
// (113_15 on the hero, seated: turn -19.7 degrees to -2.7, tilt -29.0 to -2.2; 13_05's seated looking about keeps -11..12 of its -12..20.)
const DEG=180/Math.PI;
function smoothTurns(t,rest){
  const n=t.head.length,h=Math.round(60/t.step),at=(a,i)=>a[Math.max(0,Math.min(n-1,i))],out={from:t.from,step:t.step,n},A=tr(rest[2]);
  const box=a=>{const o=new Float64Array(n);let s=0;for(let j=-h;j<=h;j++)s+=at(a,j);for(let i=0;i<n;i++){o[i]=s/(2*h+1);s+=at(a,i+h+1)-at(a,i-h);}return o;};
  // R's forward (R z) and up (R y) are A M (B z) and A M (B y): two columns of B, turned by M then A
  const col=(B,c)=>[B[c],B[3+c],B[6+c]],turnBy=(M,v)=>[M[0]*v[0]+M[1]*v[1]+M[2]*v[2],M[3]*v[0]+M[4]*v[1]+M[5]*v[2],M[6]*v[0]+M[7]*v[1]+M[8]*v[2]];
  for(const [b,list] of [[3,t.neck],[4,t.head]]){const yaw=new Float64Array(n),roll=new Float64Array(n),bz=col(rest[b],2),by=col(rest[b],1);
    list.forEach((M,i)=>{const f=turnBy(A,turnBy(M,bz)),u=turnBy(A,turnBy(M,by)),y=Math.atan2(f[0],f[2]),c=Math.cos(y),s=Math.sin(y);
      // undo the turn, then the nod (Ry(-turn), Rx(-nod)); what is left of up leans by the tilt
      const f2y=f[1],f2z=s*f[0]+c*f[2],u2x=c*u[0]-s*u[2],u2y=u[1],u2z=s*u[0]+c*u[2],p=Math.atan2(-f2y,f2z),u3y=Math.cos(p)*u2y+Math.sin(p)*u2z;
      yaw[i]=y*DEG;roll[i]=Math.atan2(-u2x,u3y)*DEG;});
    out[b]={yaw:box(box(yaw)),roll:box(box(roll))};}
  return out;
}
// Two-bone arm IK from the shoulder (upper arm joint) to a wrist target, the elbow on the side it bent, the hand's world rotation kept.
function armTo(p,up,target,[l1,l2]) {
  const fo=up+1,ha=up+2,h=p.P[up],k=p.P[fo],a=p.P[ha];
  const dv=sub(target,h),distance=Math.hypot(...dv),d=Math.min(l1+l2-1e-6,Math.max(Math.abs(l1-l2)+1e-6,distance)),axis=dv.map(v=>v/(distance||1));
  const along=(l1*l1-l2*l2+d*d)/(2*d),radius=Math.sqrt(Math.max(0,l1*l1-along*along));
  // the elbow goes the way it bent; an arm that came nearly straight has no side of its own, so a little of the elbow's natural way (back and
  // out, from the chest) is always added: it decides only when the captured bend is too small to (else the side flips frame to frame)
  const sg=up===6?1:-1,C=p.W[2],pref=[0,1,2].map(r=>C[r*3]*sg*.5+C[r*3+1]*-.15+C[r*3+2]*-.85);
  const old=sub(k,h).map((v,i)=>v+pref[i]*.04*l1),dot=old.reduce((s,v,i)=>s+v*axis[i],0),bend=old.map((v,i)=>v-dot*axis[i]),length=Math.hypot(...bend)||1;
  const nk=h.map((v,i)=>v+along*axis[i]+radius*bend[i]/length),na=h.map((v,i)=>v+d*axis[i]);
  p.W[up]=mm(turn(sub(k,h),sub(nk,h)),p.W[up]);p.W[fo]=mm(turn(sub(a,k),sub(na,nk)),p.W[fo]);
  p.P[fo]=nk;p.P[ha]=na;
}
function lockLeg(p,J,side,goal,report) {
  const hip=side?17:13,knee=hip+1,ankle=hip+2,toe=hip+3,h=p.P[hip],k=p.P[knee],a=p.P[ankle];
  const target=a.map((v,i)=>v+goal[i]-p.P[toe][i]),l1=Math.hypot(...sub(J[knee],J[hip])),l2=Math.hypot(...sub(J[ankle],J[knee]));
  const dv=sub(target,h),distance=Math.hypot(...dv),d=Math.min(l1+l2-1e-8,Math.max(Math.abs(l1-l2)+1e-8,distance)),axis=dv.map(v=>v/(distance||1));
  const along=(l1*l1-l2*l2+d*d)/(2*d),radius=Math.sqrt(Math.max(0,l1*l1-along*along));
  const old=sub(k,h),dot=old.reduce((s,v,i)=>s+v*axis[i],0),bend=old.map((v,i)=>v-dot*axis[i]),length=Math.hypot(...bend)||1;
  const nk=h.map((v,i)=>v+along*axis[i]+radius*bend[i]/length),na=h.map((v,i)=>v+d*axis[i]);
  const r1=turn(sub(k,h),sub(nk,h)),r2=turn(sub(a,k),sub(na,nk));
  const angle=r=>Math.acos(Math.max(-1,Math.min(1,(r[0]+r[4]+r[8]-1)/2)))*180/Math.PI;
  report.maxHipDeg=Math.max(report.maxHipDeg,angle(r1));report.maxKneeDeg=Math.max(report.maxKneeDeg,angle(r2));
  const bendAngle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)))))*180/Math.PI;
  report.maxKneeJointDeg=Math.max(report.maxKneeJointDeg,Math.abs(bendAngle(sub(k,h),sub(a,k))-bendAngle(sub(nk,h),sub(na,nk))));
  report.maxReachErrorM=Math.max(report.maxReachErrorM,Math.abs(distance-d));
  p.W[hip]=mm(r1,p.W[hip]);p.W[knee]=mm(r2,p.W[knee]);
  p.P[knee]=nk;p.P[ankle]=na;p.P[toe]=p.P[toe].map((v,i)=>v+na[i]-a[i]);
}

// Fill on the draw's existing time budget, one captured sample at a time.
export function sittingBake(motion) {
  if(motion.baked)return {rows:motion.baked,ms:0,step:()=>true};
  const F=SIT_FRAMES,B=BONES.length,rows=SIT_SEGMENTS.map(()=>new Float32Array((F+1)*B*8));
  const w={J:motion.J,bank:true,rotationPose:true,texturePose:true,Wm:new Float64Array(B*9),Pm:new Float64Array(B*3)},tmp=new Float32Array(B*8),previous=new Float32Array(B*4);
  let segment=0,frame=0,ms=0;
  return {rows,get ms(){return ms;},step(deadline=Infinity) {
    if(segment===3)return true;
    const started=performance.now();
    do {
      const sample=motion.samples[SIT_SEGMENTS[segment]][frame],p=motion.pose(sample.frame,sample.source),out=rows[segment];
      p.W.forEach((r,b)=>w.Wm.set(r,b*9));p.P.forEach((v,b)=>w.Pm.set(v,b*3));writePose(w,tmp,0);
      for(let b=0;b<B;b++) {
        const q=(b*2*(F+1)+frame)*4,u=q+(F+1)*4,k=b*8;
        let dot=0;for(let c=0;c<4;c++)dot+=previous[b*4+c]*tmp[k+c];
        const sign=frame&&dot<0?-1:1;
        for(let c=0;c<4;c++){out[q+c]=previous[b*4+c]=sign*tmp[k+c];out[u+c]=tmp[k+4+c];}
      }
      if(++frame>F){segment++;frame=0;}
    } while(segment<3&&performance.now()<deadline);
    ms+=performance.now()-started;if(segment===3)motion.baked=rows;return segment===3;
  }};
}

// Diagnostic seats sized to the actual retargeted capture, not a guessed ratio.
export function fittingSeatHeight(bank,J,tip,height,clipId='113_15') {
  const c=bank.find(c=>c.spec.id===clipId),rig=makeSitRetarget(c.C,{J,tip},{origin:c.spec.originM,floor:c.spec.floorM});
  const p=rig.pose((c.spec.rest[0]+c.spec.rest[1])/2);
  const drop=([16,20].reduce((n,b)=>n+p.P[b][1]-J[b][1],0))/2;
  return p.P[0][1]-drop-.09*height;
}
