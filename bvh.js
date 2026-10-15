// BVH rotations in declared channel order; centimetres converted by the caller.
export const ID = [1,0,0,0,1,0,0,0,1];
export const mm = (a,b) => [
 a[0]*b[0]+a[1]*b[3]+a[2]*b[6],a[0]*b[1]+a[1]*b[4]+a[2]*b[7],a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
 a[3]*b[0]+a[4]*b[3]+a[5]*b[6],a[3]*b[1]+a[4]*b[4]+a[5]*b[7],a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
 a[6]*b[0]+a[7]*b[3]+a[8]*b[6],a[6]*b[1]+a[7]*b[4]+a[8]*b[7],a[6]*b[2]+a[7]*b[5]+a[8]*b[8]];
export const tr = a => [a[0],a[3],a[6],a[1],a[4],a[7],a[2],a[5],a[8]];
export const mv = (a,v) => [0,1,2].map(i=>a[3*i]*v[0]+a[3*i+1]*v[1]+a[3*i+2]*v[2]);
export const sub = (a,b) => a.map((v,i)=>v-b[i]);
export const unit = a => {const n=Math.hypot(...a);return a.map(v=>v/(n||1));};
export function rot(axis,deg) {const c=Math.cos(deg*Math.PI/180),s=Math.sin(deg*Math.PI/180);return axis==='X'?[1,0,0,0,c,-s,0,s,c]:axis==='Y'?[c,0,s,0,1,0,-s,0,c]:[c,-s,0,s,c,0,0,0,1];}
export function turn(a,b) {
 a=unit(a);b=unit(b);const c=a.reduce((s,v,i)=>s+v*b[i],0);
 if(c < -0.999999) {const axis=unit(Math.abs(a[0])<.9?[0,-a[2],a[1]]:[-a[1],a[0],0]);return axis.flatMap((v,i)=>axis.map((u,j)=>2*v*u-(i===j?1:0)));}
 const [x,y,z]=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],k=1/(1+c);
 return [1-(z*z+y*y)*k,-z+x*y*k,y+x*z*k,z+x*y*k,1-(z*z+x*x)*k,-x+y*z*k,-y+x*z*k,x+y*z*k,1-(y*y+x*x)*k];
}
export function readBVH(text) {
 const [header,motion]=text.split(/\bMOTION\b/);if(!motion)throw Error('BVH: missing MOTION');
 const joints=[],stack=[];let current,n=0;
 for(const line of header.split('\n')) {const t=line.trim().split(/\s+/);
  if(['ROOT','JOINT','End'].includes(t[0])) {current={name:t[0]==='End'?current.name+'_End':t[1],parent:stack.at(-1)??-1,offset:[0,0,0],channels:[],at:n};joints.push(current);}
  else if(t[0]==='{')stack.push(joints.length-1);else if(t[0]==='}')stack.pop();
  else if(t[0]==='OFFSET')current.offset=t.slice(1).map(Number);
  else if(t[0]==='CHANNELS'){current.channels=t.slice(2);current.at=n;n+=+t[1];}
 }
 const lines=motion.trim().split('\n'),count=Number(lines[0].split(':')[1]),dt=Number(lines[1].split(':')[1]);
 const rows=lines.slice(2).filter(l=>l.trim()).map(l=>l.trim().split(/\s+/).map(Number));
 if(rows.length!==count||!Number.isFinite(dt)||dt<=0||rows.some(r=>r.length!==n||r.some(v=>!Number.isFinite(v))))throw Error('BVH: invalid motion data');
 const frames=rows.map(row=>{const out=[];for(const j of joints){let R=ID,p=j.offset.slice();j.channels.forEach((c,i)=>{if(c.endsWith('rotation'))R=mm(R,rot(c[0],row[j.at+i]));else if(c.endsWith('position'))p['XYZ'.indexOf(c[0])]+=row[j.at+i];else throw Error('BVH: unknown channel '+c);});const pa=out[j.parent];out.push({R,W:pa?mm(pa.W,R):R,P:pa?mv(pa.W,p).map((v,i)=>v+pa.P[i]):p});}return out;});
 return {joints,rows,frames,dt,index:Object.fromEntries(joints.map((j,i)=>[j.name,i]))};
}
