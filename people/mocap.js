// 100STYLE by Ian Mason, Sebastian Starke, Taku Komura, CC BY 4.0.
// See vendor/walk/100style/NOTICE.md. No harmonic fitting or synthetic gait axes.
//
// Retargeting (hero motion study, 2026-10-15; design/research/hero-motion.md):
//  - Rotations are matched against the captured person's own natural standing (the mean of the
//    vendored idle loop), not against the skeleton's T-pose. 100STYLE's standing neck and head sit
//    22 and 19 degrees forward of their T-pose axes, so T-pose matching bowed our rig's head and neck
//    by that much (the old 3..5 degree "gaze lift" only patched it). Thigh and shin keep matching the
//    captured bone directions, so steps and knee angles stay the capture's.
//  - The pelvis height is the capture's (scaled by standing hip height), not a consequence of locking
//    the toe: our rig's foot is a third shorter than the capture skeleton's (ankle to ball 14.6 cm
//    against 21.4), so a toe-locked root dropped the body 4 to 5 cm at every support exchange and the
//    floor IK bent the arriving knee to 35-38 degrees (capture 10-15): the "stomp".
//  - A foot whose captured foot is planted (its sole still in the world) is set on the floor by a
//    vertical-only leg IK; a swinging one is only ever lifted out of it (toe x/z stays locked through
//    the root as before). Where the rig's leg cannot reach what the capture's longer heel lever reached,
//    the pelvis comes down by the shortfall (smoothly), with a knee never straightened more than 10
//    degrees past its captured angle to reach.
//  - The clavicles keep the capture's T-pose-relative rotation (a hanging arm's dropped shoulder; see
//    ABSOLUTE below), and the arms of the crowd keep their padded garment openings.
//  - The standing idle (Neutral_idle) is retargeted the same way with both feet planted (makeIdleWalker).
import {BONES,rng} from '../body.js';
import {readBVH,ID,mm,mv,tr,sub,turn,rot} from '../bvh.js';
const load=async name=>{const url=new URL('../100style/'+name+'.bvh',import.meta.url);return readBVH(typeof process!=='undefined'&&process.versions?.node?await (await import('node:fs/promises')).readFile(url,'utf8'):await (await fetch(url)).text());};
export const loadCapture=load;
export const CAPTURE=await load('Neutral_FW_trim');
const captures=await Promise.all(['Neutral_slow','Rushed_urgent','Neutral_idle'].map(load));
export const IDLE_CAPTURE=captures[2];
const bi=Object.fromEntries(BONES.map(([n],i)=>[n,i]));
const NAMES=['Hips','Chest','Chest4','Neck','Head','LeftCollar','LeftShoulder','LeftElbow','LeftWrist','RightCollar','RightShoulder','RightElbow','RightWrist','LeftHip','LeftKnee','LeftAnkle','LeftToe','RightHip','RightKnee','RightAnkle','RightToe'];
const map=C=>NAMES.map(n=>C.index[n]);
export const MAP=map(CAPTURE);
const D=180/Math.PI;
// The share of a planted leg's reach shortfall the pelvis takes (all of it: a planted foot never floats), the softness of that
// onset, and how far past its captured angle a knee may straighten to reach the floor (10 degrees; it is rarely needed: at the
// push-off of the trailing leg, whose ball the rig's shorter foot lever leaves up to a centimetre short). Swept on the walk-measure
// cast (man, woman, child, elder): planted float at most 0.1 mm, knee within 10 degrees of the capture, pelvis bob 1.9-3.2 cm.
const PELVIS_SHARE=1,SOFT=.004,KNEE_SLACK=10*Math.PI/180;
// Bones matched by captured direction rather than against the standing reference: thighs and shins.
const DIRECTION=new Set([13,14,17,18]);
// Bones taking the capture's world rotation as it is (against its T-pose): the clavicles. Our rig's rest clavicles are MakeHuman's A-pose
// ones (only the arms were turned down to hang), raised for a hanging arm; the capture's standing collar sits about 10 degrees below its
// T-pose, which is the drop a hanging arm's shoulder takes. Against the standing reference they stayed raised and squared the shoulders
// (and pushed the shirt through the doublet's sleeve cap by up to 9 mm in the gentleman's sweep).
const ABSOLUTE=new Set([5,9]);

// ---- the standing reference -------------------------------------------------------------------
// The capture's sole points (cm, 100STYLE's shared skeleton): a heel pivot in the ankle frame, fitted
// as the point that stays lowest and stillest from heel strike to foot flat in the Neutral cycle,
// and the ball and toe tip under the toe joint (its end site is 1.29 cm below and 4.89 ahead).
export const CAPTURE_SOLE=[['Ankle',[0,-11.5,-12]],['Toe',[0,-1.29,0]],['Toe',[0,-1.29,4.89]]];
const floorOf=(C,a,b)=>{let lo=Infinity;for(let f=a;f<=b;f++)for(const n of ['LeftToe_End','RightToe_End'])lo=Math.min(lo,C.frames[f][C.index[n]].P[1]);return lo;};
function polar(M){let m=M.slice();for(let it=0;it<8;it++){const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=f*g-d*i,C=d*h-e*g,det=a*A+b*B+c*C;
 const inv=[A/det,B/det,C/det,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det];m=m.map((v,k)=>.5*(v+inv[k]));}return m;}
export const REFERENCE=(()=>{
 const C=captures[2],a=0,b=C.frames.length-1;let fx=0,fz=0;
 for(let f=a;f<=b;f++){const z=mv(C.frames[f][0].W,[0,0,1]);fx+=z[0];fz+=z[2];}
 const Y=rot('Y',-Math.atan2(fx,fz)*D),floor=floorOf(C,a,b),n=b-a+1;
 const W=C.joints.map((_,j)=>{const s=new Array(9).fill(0);for(let f=a;f<=b;f++){const R=mm(Y,C.frames[f][j].W);for(let k=0;k<9;k++)s[k]+=R[k];}return polar(s.map(v=>v/n));});
 let rootY=0,hipY=0;for(let f=a;f<=b;f++){rootY+=C.frames[f][0].P[1]-floor;hipY+=(C.frames[f][C.index.LeftHip].P[1]+C.frames[f][C.index.RightHip].P[1])/2-floor;}
 return {W,Winv:W.map(tr),rootY:rootY/n/100,hipY:hipY/n/100};
})();
// The rig's sole points, from its rest joints (feet flat): two heel points on the foot bone (the flat
// heel and the rounded back that is lowest when the toes are up), the ball and the toe tip on the toe
// bone. Proportions of the ankle-to-ball run, measured on the MakeHuman near mesh.
function rigSole(J,side) {
 const a=side?19:15,t=a+1,run=Math.hypot(J[t][0]-J[a][0],J[t][2]-J[a][2]),fx=(J[t][0]-J[a][0])/run,fz=(J[t][2]-J[a][2])/run;
 const at=(b,o,s,y)=>[b,[o[0]+fx*s*run,y*run,o[2]+fz*s*run].map((v,i)=>v-J[b][i])];
 return [at(a,J[a],-.36,0),at(a,J[a],-.30,.04),at(t,J[t],0,0),at(t,J[t],.54,0)];
}

export function captureFunctions(C,range,version,{idle=false}={}) {
const MAP=map(C);
const forward=C.frames.map(f=>mv(tr(f[0].W),sub(f[C.index.LeftAnkle].P,f[0].P))[2]);
const strikes=[];for(let i=1;i<forward.length-1;i++)if(forward[i]>forward[i-1]&&forward[i]>=forward[i+1]&&(!strikes.length||i-strikes.at(-1)>40))strikes.push(i);
if(!range&&strikes.length<2)throw Error('100STYLE needs two heel-strike proxies');
const CYCLE={start:range?.[0]??strikes[0],end:range?.[1]??strikes[1],strikes,version};
const {start,end}=CYCLE,N=end-start;
let yaw,travel;
if(idle) {let fx=0,fz=0;for(let f=start;f<=end;f++){const z=mv(C.frames[f][0].W,[0,0,1]);fx+=z[0];fz+=z[2];}yaw=rot('Y',-Math.atan2(fx,fz)*D);travel=0;}
else {const delta=sub(C.frames[end][0].P,C.frames[start][0].P),heading=Math.atan2(delta[0],delta[2])*D;yaw=rot('Y',-heading);travel=Math.hypot(delta[0],delta[2])/100;}
const floor=floorOf(C,start,end);
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
// Leg chains for the capture's own positions (clearance and pelvis height), in metres above its floor.
const LEGS=['Left','Right'].map(s=>['Hip','Knee','Ankle','Toe'].map(n=>C.index[s+n]));
const SOLE=['Left','Right'].map(s=>CAPTURE_SOLE.map(([n,q])=>[C.index[s+n],q]));
function sourceUncached(phase,gain,closed=true) {
 const row=channels(phase,closed,gain),world=[];
 for(const j of C.joints){let R=ID;j.channels.forEach((c,i)=>{if(c.endsWith('rotation'))R=mm(R,rot(c[0],row[j.at+i]));});world.push(j.parent<0?mm(yaw,R):mm(world[j.parent],R));}
 const p=((phase%1)+1)%1,root=mv(yaw,sub(row.slice(0,3),rows[0].slice(0,3))).map(v=>v/100);
 // channels() removed linear root travel too; keep only captured residual bob/sway.
 const rootY=(row[1]-floor)/100,clear=[0,1].map(s=>{
  const pos={};let o=[0,row[1],0];pos[0]=o;
  for(const j of LEGS[s]){const pa=C.joints[j].parent;pos[j]=mv(world[pa],C.joints[j].offset).map((v,k)=>v+pos[pa][k]);}
  let m=Infinity;for(const [j,q] of SOLE[s])m=Math.min(m,mv(world[j],q)[1]+pos[j][1]);
  return Math.max(0,(m-floor)/100);
 });
 return {world,root,p,rootY,clear};
}
// The closed capture hierarchy is shared by every body. Only the two shoulder
// channels vary per person; their descendants reuse the captured local rotations.
// Keep a bounded lattice, plus the three contact calibration samples.
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
 return {world,root:base.root,p,rootY:base.rootY,clear:base.clear};
}
// Contact, from the capture's own feet: a foot is planted while one of its sole points is still in the
// world. Heights from the skeleton are not trusted to a centimetre: its swinging toe skims a centimetre
// below the level its planted toe holds, and its heel pivot dips under it at heel strike. One sample a
// captured frame, interpolated; 1 planted, 0 in the air, smooth between.
const CONTACT=(()=>{
 // World speed of each sole point in the raw frames (m/s), so uneven pace inside a cycle (the slow
 // clip stops and goes) does not read as sliding.
 const soleAt=f=>SOLE.map(side=>side.map(([j,q])=>{const F=C.frames[f][j];return mv(F.W,q).map((v,k)=>(v+F.P[k])/100);}));
 const edge=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
 const raw=[0,1].map(side=>Float64Array.from({length:N},(_,i)=>{const f=start+i,a=soleAt(Math.max(0,f-1))[side],b=soleAt(Math.min(C.frames.length-1,f+1))[side],dt=(Math.min(C.frames.length-1,f+1)-Math.max(0,f-1))*C.dt;
  let m=Infinity;for(let k=0;k<a.length;k++)m=Math.min(m,Math.hypot(b[k][0]-a[k][0],b[k][2]-a[k][2])/dt);
  return 1-edge(.12,.3,m);}));
 // A stance is one plant: close gaps shorter than a twentieth of the cycle (the skeleton's heel pivot is
 // not a perfect pivot and flickers in the heel rocker), then soften the edges.
 const R=Math.max(1,Math.round(N/20)),ring=(a,i)=>a[((i%N)+N)%N],morph=(a,op)=>Float64Array.from(a,(_,i)=>{let m=a[i];for(let j=-R;j<=R;j++)m=op(m,ring(a,i+j));return m;});
 return raw.map(c=>{const closed=morph(morph(c,Math.max),Math.min);return Float64Array.from(closed,(_,i)=>(ring(closed,i-1)+2*closed[i]+ring(closed,i+1))/4);});
})();
const contactAt=(p,side)=>{const t=(((p%1)+1)%1)*N,i=Math.floor(t),f=t-i,c=CONTACT[side];return c[i%N]*(1-f)+c[(i+1)%N]*f;};
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
 // (A draw kept for the seeded stream: it was the 3..5 degree gaze lift, which the standing reference replaces.)
 r();
 // Vertical scale for the pelvis's captured bob and height: standing hip height (the functional leg,
 // ankle and foot included). Thigh and shin sum to the capture's on an adult but our ankle sits 5 cm
 // lower. (Shortening the stride by the same ratio was tried: it eased the heel strike's reach by half a
 // centimetre and slowed everyone 3-4%; the crowd's pace and upload batching are pinned to the stride.)
 const kv=(J[13][1]+J[17][1])/2/REFERENCE.hipY;
 const f=1/(N*C.dt*Math.sqrt(scale)),stride=travel*scale,v=stride*f;
 const rest=MAP.map((s,b)=>{
  if(ABSOLUTE.has(b))return ID;
  if(!DIRECTION.has(b))return REFERENCE.Winv[s];
  const child=BONES.findIndex(([,pa])=>pa===b),sc=C.joints.findIndex(j=>j.parent===s);
  if(child<0||sc<0)return null;
  return turn(sub(J[child],J[b]),C.joints[sc].offset);});
 rest.forEach((q,b)=>{if(!q)rest[b]=rest[BONES[b][1]];});
 const w={paceBank:who.paceBank??false,exactArms:!!who.exactArms,captureIndex:who.clipIndex??1,J,hipY:J[0][1],v,f,stride,phaseOffset,gain,stoop,build,scale,kv,rest,mocap:true,version:CYCLE.version,clip:version,keepout:who.keepout??null,_drop:0,drop:0,floorOffset:0,Wm:new Float64Array(189),Pm:new Float64Array(63)};
 w.postureKey=[stoop,build];w.posture=Array.from({length:21},(_,b)=>{let R=ID;
 if(b>=1&&b<=12&&stoop)R=mm(rot('X',stoop),R);
 if(b>=6&&b<=8)R=mm(rot('Z',Math.max(0,build-.5)*4),R);
 if(b>=10&&b<=12)R=mm(rot('Z',-Math.max(0,build-.5)*4),R);
 return R;});
 w.bones={W:w.Wm,P:w.Pm}; w.pose=poseMocap; w.raw=rawPose; w.contactAt=contactAt;
 w.Dj=J.map((j,b)=>BONES[b][1]<0?null:sub(j,J[BONES[b][1]]));
 w.sole=[rigSole(J,0),rigSole(J,1)];
 w.legs=[13,17].map(h=>[Math.hypot(...sub(J[h+1],J[h])),Math.hypot(...sub(J[h+2],J[h+1]))]);
 // The pelvis offset that sets the flat stance foot on the floor: the mean miss of the left foot over
 // its flat stance (phase .25 to .4), with the pelvis at the capture's scaled height.
 {let s=0;for(let i=0;i<6;i++){rawPose(w,.25+.03*i);s+=lowest(w,0);}w.floorOffset=s/6;}
 const keepout=w.keepout;w.keepout=null;w._drop=0;poseMocap(w,0);w.keepout=keepout;
 return w;
}
function rawPose(w,p,drop=0,closed=true) {
 const {world,root,rootY,clear}=source(p,w.gain,closed),W=w.Wm,P=w.Pm,J=w.J;
 w.clear=clear;
 for(let b=0;b<21;b++) {let R=w.rest[b]===ID?world[MAP[b]]:mm(world[MAP[b]],w.rest[b]);
  if(w.postureKey[0]===w.stoop&&w.postureKey[1]===w.build){if(w.posture[b]!==ID)R=mm(w.posture[b],R);}
  else {
  if(b>=1&&b<=12&&w.stoop)R=mm(rot('X',w.stoop),R);
  if(b>=6&&b<=8)R=mm(rot('Z',Math.max(0,w.build-.5)*4),R);
  if(b>=10&&b<=12)R=mm(rot('Z',-Math.max(0,w.build-.5)*4),R);
  }
  W.set(R,b*9);
 }
 for(let b=0;b<21;b++) {
  const pa=BONES[b][1],q=b*3;
  if(pa<0){P[0]=J[0][0]+root[0]*w.scale;P[1]=J[0][1]+(rootY-REFERENCE.rootY)*w.kv-w.floorOffset-drop;P[2]=J[0][2]+root[2]*w.scale;}
  else {
   const d=w.Dj?.[b]??sub(J[b],J[pa]),m=pa*9,o=pa*3;
   P[q]=W[m]*d[0]+W[m+1]*d[1]+W[m+2]*d[2]+P[o];
   P[q+1]=W[m+3]*d[0]+W[m+4]*d[1]+W[m+5]*d[2]+P[o+1];
   P[q+2]=W[m+6]*d[0]+W[m+7]*d[1]+W[m+8]*d[2]+P[o+2];
  }
 }
}

// Root contact cleanup (x/z): the BVH toe is stationary from approximately phase .1875 to .65625 on
// the left, .6875 to 1.15625 on the right (measured source trajectories). Lock that pivot through the
// root, NOT the ankle, which naturally travels during heel/toe roll. Exchange support smoothly over
// .15625..1875 and .65625..6875. Anchors never accumulate frame state. Heights are not locked here:
// the pelvis follows the capture and each foot is set to the capture's clearance below.
function poseMocap(w,phase) {
 const p=((phase+w.phaseOffset)%1+1)%1;
 if(!w.anchors) {
  rawPose(w,.171875);const gap0=w.Pm[16*3+2]-w.Pm[20*3+2];
  rawPose(w,.671875);const gap1=w.Pm[20*3+2]-w.Pm[16*3+2],dx=w.Pm[20*3]-w.Pm[16*3];
  // Contact separation includes this rig's foot length, not just leg length.
  w.contactStride=gap0+gap1;
  w.stride=w.contactStride;w.v=w.stride*w.f;
  rawPose(w,.4);const l=[w.Pm[16*3],w.J[16][1],w.Pm[16*3+2]+w.stride*.4];
  w.anchors=[l,[l[0]+dx,w.J[20][1],l[2]+gap1]];
 }

 // (a person's own arm openings are found before this pose is made: the search poses the cycle itself)
 if(w.exactArms&&w.keepout&&!w.ownOpening)w.ownOpening=ownOpening(w);
 rawPose(w,p,w.drop);
 const correction=(side,cycle=0)=>{const b=side?20:16,a=w.anchors[side];return [a[0]-w.Pm[b*3],0,a[2]+cycle*w.stride-w.Pm[b*3+2]-w.stride*p];};
 const smooth=t=>t*t*(3-2*t),blend=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
 let c;
 if(p<.15625)c=correction(1,-1);
 else if(p<.1875)c=blend(correction(1,-1),correction(0),smooth((p-.15625)/.03125));
 else if(p<.65625)c=correction(0);
 else if(p<.6875)c=blend(correction(0),correction(1),smooth((p-.65625)/.03125));
 else c=correction(1);
 for(let b=0;b<21;b++){w.Pm[b*3]+=c[0];w.Pm[b*3+2]+=c[2];}
 placeFeet(w,[contactAt(p,0),contactAt(p,1)]);
 if(!w.keepout)return;
 // exactArms: this person's own minimal openings, found once over 32 phases of their own capture (about 12 ms a
 // clip) and interpolated, instead of the nearest garment/body bin's padded ones (the crowd's: no search a person).
 if(w.exactArms){const o=w.ownOpening,t=p*32,i=Math.floor(t)%32,f=t-Math.floor(t),j=(i+1)%32,pad=Math.PI/360;
  w.keepout.apply(w.bones,{phase:((phase%1)+1)%1,sway:1,opening:[0,1].map(s=>o[i][s]*(1-f)+o[j][s]*f+pad)});return;}
 // Extra clearance covers the wrist-twist mesh residual measured in the 44-person sweep.
 w.keepout.apply(w.bones,{phase:((phase%1)+1)%1,sway:1,extraClearance:w.paceBank?.04:.012,capturePhase:p,cachedOpening:w.paceBank,captureIndex:w.paceBank?(w.captureIndex??1):3});
}
function ownOpening(w) {
 const out=[],ko=w.keepout;
 // A person's own volumes and arm, at the keep-out's own 8 mm clearance plus 4 mm: the probes already stand
 // proud of the hand's palm side (they are sized to its width), so the crowd's 12 mm residual is not added.
 for(let i=0;i<32;i++){rawPose(w,i/32,w.drop);ko.apply(w.bones,{phase:i/32,sway:1,extraClearance:.004,step:4});out.push(ko.openings.map(v=>v??0));}
 return out;
}
// Each foot to the floor while the capture's foot is planted, and only ever out of the floor while it
// swings: a vertical move of the ankle (two-bone IK; the foot keeps its captured world rotation, so the
// locked toe keeps its x/z). A planted leg that cannot reach lowers the pelvis by a smooth share of its
// shortfall first.
function placeFeet(w,contact) {
 const P=w.Pm,dy=[0,0],reach=[0,0];let short=0;
 for(const side of [0,1]) {
  const hip=side?17:13,k=hip+1,a=hip+2,[l1,l2]=w.legs[side],h=lowest(w,side),c=contact[side];
  dy[side]=-c*h+(1-c)*Math.max(0,-h);
  // The knee may straighten at most KNEE_SLACK past the captured angle to reach the floor: past that
  // the foot leaves the floor a little early (or lands a little late), never a locked straight leg.
  const ux=P[k*3]-P[hip*3],uy=P[k*3+1]-P[hip*3+1],uz=P[k*3+2]-P[hip*3+2],vx=P[a*3]-P[k*3],vy=P[a*3+1]-P[k*3+1],vz=P[a*3+2]-P[k*3+2];
  const knee=Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy+uz*vz)/(l1*l2)))),bent=Math.max(0,knee-KNEE_SLACK);
  reach[side]=Math.sqrt(l1*l1+l2*l2+2*l1*l2*Math.cos(bent));
  const x=P[a*3]-P[hip*3],y=P[a*3+1]+dy[side]-P[hip*3+1],z=P[a*3+2]-P[hip*3+2];
  short=Math.max(short,c*(Math.hypot(x,y,z)-reach[side]));
 }
 // softplus: zero far from reach, smooth (C-infinity) through the onset
 const drop=PELVIS_SHARE*SOFT*Math.log1p(Math.exp(Math.min(40,short/SOFT)));
 if(drop>1e-7)for(let b=0;b<21;b++)P[b*3+1]-=drop;
 for(const side of [0,1]){const h=lowest(w,side),d=-contact[side]*h+(1-contact[side])*Math.max(0,-h);if(Math.abs(d)>1e-6)liftFoot(w,side,d,reach[side]);}
}

// A foot moved straight up or down, never sideways: a target out of the leg's reach is brought back along that vertical line (where the
// line meets the reach), not toward the hip, which would drag a locked toe (and leave it sliding between baked frames).
function liftFoot(w,side,dy,reach=Infinity) {
 const P=w.Pm,a=(side?19:15)*3,hip=(side?17:13)*3,[l1,l2]=w.legs[side],R=Math.min(reach,l1+l2-1e-9);
 const hx=P[a]-P[hip],hz=P[a+2]-P[hip+2],h2=hx*hx+hz*hz;
 if(h2>=R*R)return;
 const half=Math.sqrt(R*R-h2),y=Math.max(P[hip+1]-half,Math.min(P[hip+1]+half,P[a+1]+dy));
 legTo(w,side,[P[a],y,P[a+2]],reach);
}

return {makeMocapWalker,poseMocap,rawPose,channels,CYCLE,source,lowest,liftFoot,MAP,N,yaw,floor,contactAt};
}
// The lowest of a foot's sole points (world height).
export function lowest(w,side) {
 let m=Infinity;const W=w.Wm,P=w.Pm;
 for(const [b,q] of w.sole[side]){const o=b*9,y=W[o+3]*q[0]+W[o+4]*q[1]+W[o+5]*q[2]+P[b*3+1];if(y<m)m=y;}
 return m;
}
// Two-bone leg IK: the ankle to `target` (clamped to `reach` and the leg's length), the knee on the side
// it bent before, the foot and toe carried with their world rotations unchanged. No allocation: it runs
// for both legs in every baked frame.
const RT=new Float64Array(9),RW=new Float64Array(9);
function turnInto(o,ax,ay,az,bx,by,bz){ // the shortest rotation taking direction a to direction b (Rodrigues), into o
 const la=Math.hypot(ax,ay,az)||1,lb=Math.hypot(bx,by,bz)||1;ax/=la;ay/=la;az/=la;bx/=lb;by/=lb;bz/=lb;
 const c=ax*bx+ay*by+az*bz;
 if(c<-.999999){const t=turn([ax,ay,az],[bx,by,bz]);for(let i=0;i<9;i++)o[i]=t[i];return o;}
 const x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx,k=1/(1+c);
 o[0]=1-(z*z+y*y)*k;o[1]=-z+x*y*k;o[2]=y+x*z*k;o[3]=z+x*y*k;o[4]=1-(z*z+x*x)*k;o[5]=-x+y*z*k;o[6]=-y+x*z*k;o[7]=x+y*z*k;o[8]=1-(y*y+x*x)*k;return o;
}
function leftMul(W,o,R){for(let k=0;k<3;k++){const a=W[o+k],b=W[o+3+k],c=W[o+6+k];W[o+k]=R[0]*a+R[1]*b+R[2]*c;W[o+3+k]=R[3]*a+R[4]*b+R[5]*c;W[o+6+k]=R[6]*a+R[7]*b+R[8]*c;}}
export function legTo(w,side,target,reach=Infinity) {
 const hip=side?17:13,knee=hip+1,ankle=hip+2,toe=hip+3,P=w.Pm,W=w.Wm;
 const hx=P[hip*3],hy=P[hip*3+1],hz=P[hip*3+2],kx=P[knee*3],ky=P[knee*3+1],kz=P[knee*3+2],ax=P[ankle*3],ay=P[ankle*3+1],az=P[ankle*3+2];
 const L=w.legs?.[side],l1=L?L[0]:Math.hypot(kx-hx,ky-hy,kz-hz),l2=L?L[1]:Math.hypot(ax-kx,ay-ky,az-kz);
 const dx=target[0]-hx,dy=target[1]-hy,dz=target[2]-hz,dist=Math.hypot(dx,dy,dz)||1e-9,d=Math.min(l1+l2-1e-9,reach,Math.max(Math.abs(l1-l2)+1e-9,dist));
 const ux=dx/dist,uy=dy/dist,uz=dz/dist,along=(l1*l1-l2*l2+d*d)/(2*d),radius=Math.sqrt(Math.max(0,l1*l1-along*along));
 const ox=kx-hx,oy=ky-hy,oz=kz-hz,dot=ox*ux+oy*uy+oz*uz,bx=ox-dot*ux,by=oy-dot*uy,bz=oz-dot*uz,bl=Math.hypot(bx,by,bz)||1;
 const nkx=hx+along*ux+radius*bx/bl,nky=hy+along*uy+radius*by/bl,nkz=hz+along*uz+radius*bz/bl,nax=hx+d*ux,nay=hy+d*uy,naz=hz+d*uz;
 leftMul(W,hip*9,turnInto(RT,ox,oy,oz,nkx-hx,nky-hy,nkz-hz));
 leftMul(W,knee*9,turnInto(RW,ax-kx,ay-ky,az-kz,nax-nkx,nay-nky,naz-nkz));
 P[knee*3]=nkx;P[knee*3+1]=nky;P[knee*3+2]=nkz;P[ankle*3]=nax;P[ankle*3+1]=nay;P[ankle*3+2]=naz;
 P[toe*3]+=nax-ax;P[toe*3+1]+=nay-ay;P[toe*3+2]+=naz-az;
 return dist-d;
}

const legacy=captureFunctions(CAPTURE,null,'100style-neutral-v2');
export const CYCLE=legacy.CYCLE,channels=legacy.channels;
export const CLIPS=[captureFunctions(captures[0],[0,captures[0].rows.length-1],'neutral-slow'),legacy,captureFunctions(captures[1],[0,captures[1].rows.length-1],'rushed-urgent')];
export const IDLE=captureFunctions(captures[2],[0,captures[2].rows.length-1],'neutral-idle-v1',{idle:true});
export const makeMocapWalker=(J,who)=>CLIPS[who.clipIndex??1].makeMocapWalker(J,who);
export const poseMocap=(w,p)=>w.pose(w,p);
export const rawPose=(w,p,drop=0,closed=true)=>w.raw(w,p,drop,closed);

// ---- standing: the captured idle loop, both feet planted where they are given -------------------
// `feet`: the ball (toe joint) of each foot on the floor, [[x, z], [x, z]] in the person's frame; the
// loop's own first frame places them when none are given. The pelvis keeps the captured sway and
// breathing over them (scaled), the legs reach the planted feet by IK, the feet keep their captured
// (flat) orientation.
export function makeIdleWalker(J,who={}) {
 const w=IDLE.makeMocapWalker(J,{...who,clipIndex:1,paceBank:false});
 w.phaseOffset=0;w.idle=true;w.pose=poseIdle;w.version=IDLE.CYCLE.version;
 IDLE.rawPose(w,0);w.homeFeet=[16,20].map(b=>[w.Pm[b*3],w.Pm[b*3+2]]);w.feet=w.homeFeet.map(f=>f.slice());
 w.duration=IDLE.N*IDLE_CAPTURE.dt;
 return w;
}
// The loop's own pelvis sways over its own feet: carry it with the feet's centre to wherever they are planted.
function idleFrame(w,p) {
 IDLE.rawPose(w,p,0);
 const f=w.feet,h=w.homeFeet,dx=(f[0][0]+f[1][0]-h[0][0]-h[1][0])/2,dz=(f[0][1]+f[1][1]-h[0][1]-h[1][1])/2;
 if(dx||dz)for(let b=0;b<21;b++){w.Pm[b*3]+=dx;w.Pm[b*3+2]+=dz;}
 plantFeet(w,w.feet);
}
function poseIdle(w,phase) {
 const p=((phase%1)+1)%1;
 idleFrame(w,p);
 if(!w.keepout)return;
 // The arms stand still enough that one opening serves the loop: the widest the exact search asks of
 // three frames, found once a body, then applied as given (no search a frame).
 if(!w.opening){const o=[0,0];for(let i=0;i<3;i++){idleFrame(w,i/3);w.keepout.apply(w.bones,{phase:i/3,sway:1,extraClearance:.012,step:4});for(const s of [0,1])o[s]=Math.max(o[s],w.keepout.openings[s]??0);}
  w.opening=o;idleFrame(w,p);}
 w.keepout.apply(w.bones,{phase:p,sway:1,opening:w.opening});
}
// Both feet to the floor at the given balls: a leg that cannot reach lowers the pelvis (smoothly) first.
export function plantFeet(w,feet) {
 const P=w.Pm,W=w.Wm,targets=[0,1].map(side=>{
  const a=side?19:15,t=a+1,h=lowest(w,side),f=feet[side];
  return [P[a*3]+f[0]-P[t*3],P[a*3+1]-h,P[a*3+2]+f[1]-P[t*3+2]];
 });
 let short=0;for(const side of [0,1]){const hip=(side?17:13)*3,[l1,l2]=w.legs[side];short=Math.max(short,Math.hypot(targets[side][0]-P[hip],targets[side][1]-P[hip+1],targets[side][2]-P[hip+2])-(l1+l2-.002));}
 const drop=SOFT*Math.log1p(Math.exp(Math.min(40,short/SOFT)));
 if(drop>1e-7){for(let b=0;b<21;b++)P[b*3+1]-=drop;}
 for(const side of [0,1])legTo(w,side,targets[side]);
}
