// 100STYLE by Ian Mason, Sebastian Starke, Taku Komura, CC BY 4.0.
// See vendor/walk/100style/NOTICE.md. No harmonic fitting or synthetic gait axes.
import {BONES,rng} from '../body.js';
import {readBVH,ID,mm,mv,tr,sub,turn,rot} from '../bvh.js';
const load=async name=>{const url=new URL('../100style/'+name+'.bvh',import.meta.url);return readBVH(typeof process!=='undefined'&&process.versions?.node?await (await import('node:fs/promises')).readFile(url,'utf8'):await (await fetch(url)).text());};
export const CAPTURE=await load('Neutral_FW_trim');
const captures=await Promise.all(['Neutral_slow','Rushed_urgent'].map(load));
const bi=Object.fromEntries(BONES.map(([n],i)=>[n,i]));
const map=C=>['Hips','Chest','Chest4','Neck','Head','LeftCollar','LeftShoulder','LeftElbow','LeftWrist','RightCollar','RightShoulder','RightElbow','RightWrist','LeftHip','LeftKnee','LeftAnkle','LeftToe','RightHip','RightKnee','RightAnkle','RightToe'].map(n=>C.index[n]);
export const MAP=map(CAPTURE);
function captureFunctions(C,range,version) {
const MAP=map(C);
const forward=C.frames.map(f=>mv(tr(f[0].W),sub(f[C.index.LeftAnkle].P,f[0].P))[2]);
const strikes=[];for(let i=1;i<forward.length-1;i++)if(forward[i]>forward[i-1]&&forward[i]>=forward[i+1]&&(!strikes.length||i-strikes.at(-1)>40))strikes.push(i);
if(!range&&strikes.length<2)throw Error('100STYLE needs two heel-strike proxies');
const CYCLE={start:range?.[0]??strikes[0],end:range?.[1]??strikes[1],strikes,version};
const {start,end}=CYCLE,N=end-start;
const delta=sub(C.frames[end][0].P,C.frames[start][0].P),heading=Math.atan2(delta[0],delta[2])*180/Math.PI;
const yaw=rot('Y',-heading),travel=Math.hypot(delta[0],delta[2])/100;
const sourceLeg=(Math.hypot(...C.joints[C.index.LeftKnee].offset)+Math.hypot(...C.joints[C.index.LeftAnkle].offset))/100;
// Unwrap each Euler channel before periodic endpoint detrending. No temporal
// harmonics are fitted: retain the measured frame sequence.
const rows=C.rows.slice(start,end+1).map(r=>r.slice());
for(let c=3;c<rows[0].length;c++)for(let i=1;i<=N;i++){while(rows[i][c]-rows[i-1][c]>180)rows[i][c]-=360;while(rows[i][c]-rows[i-1][c]<-180)rows[i][c]+=360;}
const means=rows[0].map((_,c)=>rows.slice(0,N).reduce((s,r)=>s+r[c],0)/N);
const periodic=rows.slice(0,N).map((row,i)=>row.map((v,c)=>v-(rows[N][c]-rows[0][c])*(i/N-(c>=3?.5:0))));
function channels(phase,closed=true,gain=1) {
 const p=((phase%1)+1)%1,t=p*N,i=Math.floor(t),f=t-i;
 return rows[0].map((_,c)=>{let v=rows[i][c]*(1-f)+rows[i+1][c]*f;
  if(closed) {const a=periodic[i][c],b=periodic[(i+1)%N][c],m=(b-periodic[(i+N-1)%N][c])/2,n=(periodic[(i+2)%N][c]-a)/2;
   v=(2*f**3-3*f*f+1)*a+(f**3-2*f*f+f)*m+(-2*f**3+3*f*f)*b+(f**3-f*f)*n;
  }
  if([C.index.LeftShoulder,C.index.RightShoulder].some(j=>c>=C.joints[j].at&&c<C.joints[j].at+3))v=means[c]+(v-means[c])*gain;
  return v;
 });
}

function sourceUncached(phase,gain,closed=true) {
 const row=channels(phase,closed,gain),world=[];
 for(const j of C.joints){let R=ID;j.channels.forEach((c,i)=>{if(c.endsWith('rotation'))R=mm(R,rot(c[0],row[j.at+i]));});world.push(j.parent<0?mm(yaw,R):mm(world[j.parent],R));}
 const p=((phase%1)+1)%1,root=mv(yaw,sub(row.slice(0,3),rows[0].slice(0,3))).map(v=>v/100);
 // channels() removed linear root travel too; keep only captured residual bob/sway.
 return {world,root,p};
}
// The closed capture hierarchy is shared by every body. Only the two shoulder
// channels vary per person; their descendants reuse the captured local rotations.
// Keep a bounded 32-frame lattice, plus the three contact calibration samples.
const sharedPhases=[...Array.from({length:64},(_,i)=>i/64),.171875,.671875,.4];
const sourceCycle=new Map(sharedPhases.map(p=> {
 const base=sourceUncached(p,1),row=channels(p);
 const local=C.joints.map(j=>{let R=ID;for(let i=0;i<j.channels.length;i++)if(j.channels[i].endsWith('rotation'))R=mm(R,rot(j.channels[i][0],row[j.at+i]));return R;});
 return [((p%1)+1)%1,{...base,row,local}];
}));
function sourceComputed(phase,gain,closed=true) {
 const p=((phase%1)+1)%1,base=closed&&sourceCycle.get(p);
 if(!base)return sourceUncached(phase,gain,closed);
 const world=base.world.slice();
 for(const name of ['LeftShoulder','RightShoulder']) {
  const b=C.index[name],j=C.joints[b];let R=ID;
  for(let i=0;i<3;i++){const c=j.at+i;R=mm(R,rot(j.channels[i][0],means[c]+(base.row[c]-means[c])*gain));}
  world[b]=mm(world[j.parent],R);
  // Shoulder -> elbow -> wrist -> end. No other branch depends on this gain.
  for(let k=b+1;k<C.joints.length&&C.joints[k].parent>=b;k++)world[k]=mm(world[C.joints[k].parent],base.local[k]);
 }
 return {world,root:base.root,p};
}
// Sixteen slight shoulder gains share their capture-space hierarchies. The
// cache is bounded by the gain palette and phase lattice, never person count.
const gainCycles=new Map();
function source(phase,gain,closed=true){
 const p=((phase%1)+1)%1;
 if(!closed||!sourceCycle.has(p))return sourceComputed(phase,gain,closed);
 const key=Math.round((gain-.85)/.02);if(Math.abs(gain-(.85+key*.02))>1e-9)return sourceComputed(phase,gain,closed);
 let cycle=gainCycles.get(key);if(!cycle)gainCycles.set(key,cycle=new Map());
 let value=cycle.get(p);if(!value)cycle.set(p,value=sourceComputed(p,gain,true));return value;
}
function makeMocapWalker(J,who) {
 const leg=(Math.hypot(...sub(J[bi.shinL],J[bi.thighL]))+Math.hypot(...sub(J[bi.footL],J[bi.shinL]))),scale=leg/sourceLeg,r=rng(who.seed);
 // Quantize only the initial phase, so 32-frame baking samples every contact boundary.
 const gain=.85+.02*Math.round(15*r()),phaseOffset=Math.floor(r()*32)/32,stoop=Math.max(0,Math.min(4,(who.age-55)/8)),build=Math.max(0,Math.min(1,who.build??.5));
 const gazeLift=3+2*r();
 const stride=travel*scale,f=1/(N*C.dt*Math.sqrt(scale)),v=stride*f;
 const rest=MAP.map((s,b)=>{const child=BONES.findIndex(([,pa])=>pa===b),sc=C.joints.findIndex(j=>j.parent===s);
  if(child<0||sc<0)return null;
  // Torso/collar and head skin frames share BVH world axes. The neck-to-head
  // joint vector is not the gaze axis (it points backward on the child rig).
  if(b<=5||b===9)return ID;return turn(sub(J[child],J[b]),C.joints[sc].offset);});
 // Terminal skin frames follow their parent's rest alignment (hand/toe/head).
 rest.forEach((q,b)=>{if(!q)rest[b]=rest[BONES[b][1]]??ID;});
 const w={paceBank:who.paceBank??false,captureIndex:who.clipIndex??1,J,hipY:J[0][1],v,f,stride,phaseOffset,gain,stoop,build,gazeLift,scale,rest,mocap:true,version:CYCLE.version,clip:version,keepout:who.keepout??null,_drop:0,drop:0,Wm:new Float64Array(189),Pm:new Float64Array(63)};
 w.postureKey=[stoop,gazeLift,build];w.posture=Array.from({length:21},(_,b)=>{let R=ID;
 if(b>=1&&b<=12&&stoop)R=mm(rot('X',stoop),R);
 if(b===3||b===4)R=mm(rot('X',-gazeLift),R);
 if(b>=6&&b<=8)R=mm(rot('Z',Math.max(0,build-.5)*4),R);
 if(b>=10&&b<=12)R=mm(rot('Z',-Math.max(0,build-.5)*4),R);
 return R;});
 w.bones={W:w.Wm,P:w.Pm}; w.pose=poseMocap; w.raw=rawPose;
 w.Dj=J.map((j,b)=>BONES[b][1]<0?null:sub(j,J[BONES[b][1]]));

 const keepout=w.keepout;w.keepout=null;w._drop=0;poseMocap(w,0);w.keepout=keepout;
 return w;
}
function rawPose(w,p,drop=0,closed=true) {
 const {world,root}=source(p,w.gain,closed),W=w.Wm,P=w.Pm,J=w.J;
 for(let b=0;b<21;b++) {let R=w.rest[b]===ID?world[MAP[b]]:mm(world[MAP[b]],w.rest[b]);
  if(w.postureKey[0]===w.stoop&&w.postureKey[1]===w.gazeLift&&w.postureKey[2]===w.build){if(w.posture[b]!==ID)R=mm(w.posture[b],R);}
  else {
  if(b>=1&&b<=12&&w.stoop)R=mm(rot('X',w.stoop),R);
  // Source world head pitch is ~18 degrees; its rest axes are near vertical.
  // Preserve that captured posture, with only a seeded 3..5 degree gaze lift.
  if(b===3||b===4)R=mm(rot('X',-w.gazeLift),R);
  if(b>=6&&b<=8)R=mm(rot('Z',Math.max(0,w.build-.5)*4),R);
  if(b>=10&&b<=12)R=mm(rot('Z',-Math.max(0,w.build-.5)*4),R);
  }
  W.set(R,b*9);
  const pa=BONES[b][1],q=b*3;
  if(pa<0){for(let i=0;i<3;i++)P[i]=J[0][i]+root[i]*w.scale-(i===1?drop:0);}
  else {
   const d=w.Dj?.[b]??sub(J[b],J[pa]),m=pa*9,o=pa*3;
   P[q]=W[m]*d[0]+W[m+1]*d[1]+W[m+2]*d[2]+P[o];
   P[q+1]=W[m+3]*d[0]+W[m+4]*d[1]+W[m+5]*d[2]+P[o+1];
   P[q+2]=W[m+6]*d[0]+W[m+7]*d[1]+W[m+8]*d[2]+P[o+2];
  }
 }
}
// Root contact cleanup preserves captured foot roll; floor IK below is confined
// to a leg whose retargeted toe would penetrate the floor.
// The BVH toe is stationary from approximately phase .1875 to .65625 on the left,
// .6875 to 1.15625 on the right (measured source trajectories). Lock that pivot,
// NOT the ankle, which naturally travels during heel/toe roll. Exchange support
// smoothly over .15625..1875 and .65625..6875. Anchors never accumulate frame state.
function poseMocap(w,phase) {
 const drop=w.drop,p=((phase+w.phaseOffset)%1+1)%1;
 if(!w.anchors) {
  rawPose(w,.171875);const gap0=w.Pm[16*3+2]-w.Pm[20*3+2];
  rawPose(w,.671875);const gap1=w.Pm[20*3+2]-w.Pm[16*3+2],dx=w.Pm[20*3]-w.Pm[16*3];
  // Contact separation includes this rig's foot length, not just leg length.
  w.contactStride=gap0+gap1;
  w.stride=w.contactStride;w.v=w.stride*w.f;
  rawPose(w,.4);const l=[w.Pm[16*3],w.J[16][1],w.Pm[16*3+2]+w.stride*.4];
  w.anchors=[l,[l[0]+dx,w.J[20][1],l[2]+gap1]];
 }

 rawPose(w,p,drop);
 const correction=(side,cycle=0)=>{const b=side?20:16,a=w.anchors[side];return [a[0]-w.Pm[b*3],a[1]-drop-w.Pm[b*3+1],a[2]+cycle*w.stride-w.Pm[b*3+2]-w.stride*p];};
 const smooth=t=>t*t*(3-2*t),blend=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
 let c;
 if(p<.15625)c=correction(1,-1);
 else if(p<.1875)c=blend(correction(1,-1),correction(0),smooth((p-.15625)/.03125));
 else if(p<.65625)c=correction(0);
 else if(p<.6875)c=blend(correction(0),correction(1),smooth((p-.65625)/.03125));
 else c=correction(1);
 for(let b=0;b<21;b++)for(let i=0;i<3;i++)w.Pm[b*3+i]+=c[i];
 // Retargeted proportions can put the arriving toe below the floor during
 // double support. A local two-bone correction lifts only that leg; do not
 // globally raise the cycle and leave the planted foot floating.
 for(const side of [0,1]) {const toe=side?20:16,dy=w.J[toe][1]-w.Pm[toe*3+1];if(dy>1e-9)liftFoot(w,side,dy);}
 // Extra clearance covers the wrist-twist mesh residual measured in the 44-person sweep.
 if(w.keepout)w.keepout.apply(w.bones,{phase:((phase%1)+1)%1,sway:1,extraClearance:w.paceBank?.04:.012,capturePhase:p,cachedOpening:w.paceBank,captureIndex:w.paceBank?(w.captureIndex??1):3});
}

function liftFoot(w,side,dy) {
 const hip=side?17:13,knee=hip+1,ankle=hip+2,toe=hip+3,P=w.Pm,W=w.Wm;
 const at=b=>Array.from(P.subarray(b*3,b*3+3)),h=at(hip),k=at(knee),a=at(ankle),t=[a[0],a[1]+dy,a[2]],l1=Math.hypot(...sub(k,h)),l2=Math.hypot(...sub(a,k));
 const dvec=sub(t,h),dist=Math.hypot(...dvec),d=Math.min(l1+l2-1e-9,Math.max(Math.abs(l1-l2)+1e-9,dist)),axis=dvec.map(v=>v/dist);
 const along=(l1*l1-l2*l2+d*d)/(2*d),radius=Math.sqrt(Math.max(0,l1*l1-along*along));
 const old=sub(k,h),dot=old.reduce((s,v,i)=>s+v*axis[i],0),bend=old.map((v,i)=>v-dot*axis[i]),length=Math.hypot(...bend)||1;
 const nk=h.map((v,i)=>v+along*axis[i]+radius*bend[i]/length),na=h.map((v,i)=>v+d*axis[i]);
 const r1=turn(sub(k,h),sub(nk,h)),r2=turn(sub(a,k),sub(na,nk));
 W.set(mm(r1,W.subarray(hip*9,hip*9+9)),hip*9);W.set(mm(r2,W.subarray(knee*9,knee*9+9)),knee*9);
 P.set(nk,knee*3);P.set(na,ankle*3);P.set(at(toe).map((v,i)=>v+na[i]-a[i]),toe*3);
}

return {makeMocapWalker,poseMocap,rawPose,channels,CYCLE};
}
const legacy=captureFunctions(CAPTURE,null,'100style-neutral-v1');
export const CYCLE=legacy.CYCLE,channels=legacy.channels;
export const CLIPS=[captureFunctions(captures[0],[0,captures[0].rows.length-1],'neutral-slow'),legacy,captureFunctions(captures[1],[0,captures[1].rows.length-1],'rushed-urgent')];
export const makeMocapWalker=(J,who)=>CLIPS[who.clipIndex??1].makeMocapWalker(J,who);
export const poseMocap=(w,p)=>w.pose(w,p);
export const rawPose=(w,p,drop=0,closed=true)=>w.raw(w,p,drop,closed);
