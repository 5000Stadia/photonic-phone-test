// CMU motions are loaded only on the first sit request. Walking-only worlds
// never fetch, parse, retarget or bake a sitting capture.
import {BONES} from '../body.js';
import {mm,mv,sub,turn,rot} from '../bvh.js';
import {writePose} from './walk.js';
import {makeSitRetarget} from './sit-mocap.js';
export const SIT_FRAMES = 64;
export const SIT_SEGMENTS = ['sitDown','seated','standUp'];
let pending;
const read = async url => typeof process !== 'undefined' && process.versions?.node
  ? (await import('node:fs/promises')).readFile(url,'utf8')
  : fetch(url).then(r=>{if(!r.ok)throw Error(`sit: ${r.status} ${url}`);return r.text();});
export function loadSitting() {
  return pending ??= (async()=>{
    const {readASF,readAMC,sampleAcclaim}=await import('../asf-amc.js');
    const meta=JSON.parse(await read(new URL('../design/research/sit-captures.json',import.meta.url)));
    return Promise.all(meta.clips.map(async spec=>{
      const base=new URL('../vendor/sit/cmu/',import.meta.url);
      const [asf,amc]=await Promise.all([read(new URL(spec.subject+'.asf',base)),read(new URL(spec.id+'.amc',base))]);
      const C=readAMC(amc,readASF(asf)),mid=(spec.rest[0]+spec.rest[1])/2,R=sampleAcclaim(C,mid)[0].W;
      const yaw=rot('Y',-Math.atan2(R[2],R[8])*180/Math.PI);
      // Shared capture sampling: never parse/interpolate AMC per body.
      const samples=Object.fromEntries(SIT_SEGMENTS.map(segment=>[segment,Array.from({length:SIT_FRAMES+1},(_,i)=>{
        const frame=sitFrame(spec,segment,i/SIT_FRAMES);return {frame,source:sampleAcclaim(C,frame)};
      })]));
      return {spec,C,yaw,samples};
    }));
  })().catch(e=>{pending=null;throw e;});
}
export function sitFrame(spec,segment,phase) {
  const [a,b]=spec.segments[segment];
  // Traverse captured seated shifts and return through the same samples. Cosine
  // timing eases the two reversals; no synthetic oscillation is added to a bone.
  const t=segment==='seated' ? (1-Math.cos(phase*Math.PI*2))/2 : phase;
  return a+(b-a)*t;
}
export const sitDuration = (spec,segment) => (spec.segments[segment][1]-spec.segments[segment][0])/120*(segment==='seated'?2:1);
const cache=new Map();
export function makeSitting(bank,J,tip,height,seatHeight,clipId) {
  // Hip joint above the surface, rather than burying the hip joint in the board.
  const cushion=.09*height;
  const target=seatHeight+cushion;
  const clip=clipId ? bank.find(c=>c.spec.id===clipId) : bank.reduce((best,c)=>
    Math.abs(fittingSeatHeight(bank,J,tip,height,c.spec.id)-seatHeight)<Math.abs(fittingSeatHeight(bank,J,tip,height,best.spec.id)-seatHeight)?c:best);
  if(!clip)throw Error('sit: unknown capture');
  const key=JSON.stringify([clip.spec.id,J,tip,seatHeight,height]);
  if(cache.has(key))return cache.get(key);
  const {spec,C,yaw,samples}=clip,rig=makeSitRetarget(C,{J,tip},{origin:spec.originM,floor:spec.floorM});
  const delta=target-spec.seat.pelvisProxyM*rig.scale;
  const report={clip:spec.id,pelvisAdjustmentM:delta,maxHipDeg:0,maxKneeDeg:0,maxKneeJointDeg:0,maxReachErrorM:0};
  const raw=(frame,source)=>{const p=rig.pose(frame,source);return {P:p.P.map(v=>mv(yaw,v)),W:p.W.map(w=>mm(yaw,w))};};
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
    return p;
  }
  const motion={spec,report,J,pose,samples,durations:Object.fromEntries(SIT_SEGMENTS.map(s=>[s,sitDuration(spec,s)]))};
  // Reject substantial pose changes, rather than stretching the captured action
  // to an unsuitable seat. Sample the source lattice before starting a trip.
  const started=performance.now();
  for(const segment of SIT_SEGMENTS)for(let f=0;f<=SIT_FRAMES;f+=8) {
    const sample=samples[segment][f];pose(sample.frame,sample.source);
  }
  motion.fitMs=performance.now()-started;
  motion.fits=Math.max(report.maxHipDeg,report.maxKneeDeg,report.maxKneeJointDeg)<=24 && report.maxReachErrorM<=.0025;
  cache.set(key,motion);if(cache.size>64)cache.delete(cache.keys().next().value);
  return motion;
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
