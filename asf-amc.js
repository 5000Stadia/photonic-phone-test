// CMU Acclaim reader: column vectors, metres, degrees, original AMC frame numbers.
// ASF bones describe endpoints, unlike BVH joints. P is the bone head, E its tip.
import {ID,mm,mv,tr,rot} from './bvh.js';
const lines=text=>text.split(/\r?\n/).map(l=>l.replace(/#.*/, '').trim()).filter(Boolean);
const nums=(v,n)=>{const a=v.map(Number);if(a.length!==n||a.some(x=>!Number.isFinite(x)))throw Error('Acclaim: invalid numeric data');return a;};
const rotation=(order,values)=>order.reduce((R,c,i)=>mm(rot(c.toUpperCase().at(-1),values[i]),R),ID);
const axisRotation=(order,xyz)=>rotation([...order],[...order].map(c=>xyz['XYZ'.indexOf(c)]));
export function readASF(text) {
 const sections={};let section;
 for(const line of lines(text)){if(line[0]===':'){section=line.split(/\s/)[0].slice(1);sections[section]=[];}else if(section)sections[section].push(line);}
 const fields=ls=>Object.fromEntries((ls??[]).map(l=>{const [k,...v]=l.split(/\s+/);return [k,v];}));
 const units=fields(sections.units),root=fields(sections.root);
 if(units.angle?.[0]!=='deg')throw Error('ASF: only degrees supported');
 const length=nums(units.length??[],1)[0];if(length<=0)throw Error('ASF: invalid length unit');
 const metres=.0254/length; // ASF length units per inch (CMU: .45).
 if(!root.order||root.order.length!==6||new Set(root.order).size!==6||root.order.some(c=>!['TX','TY','TZ','RX','RY','RZ'].includes(c)))throw Error('ASF: invalid root order');
 const axis=root.axis?.[0];if(!/^(XYZ|XZY|YXZ|YZX|ZXY|ZYX)$/.test(axis))throw Error('ASF: invalid root axis');
 const bones=[{name:'root',parent:-1,offset:[0,0,0],channels:root.order.map(c=>c.toLowerCase()),C:axisRotation(axis,nums(root.orientation??[],3)),position:nums(root.position??[],3).map(v=>v*metres)}];
 let block=null;
 for(const l of sections.bonedata??[]){if(l==='begin'){if(block)throw Error('ASF: nested bone');block=[];}else if(l==='end'){
  const f=fields(block),name=f.name?.[0],axis=f.axis?.[3],channels=f.dof??[];
  if(!name||bones.some(b=>b.name===name)||! /^(XYZ|XZY|YXZ|YZX|ZXY|ZYX)$/.test(axis)||channels.some(c=>!['rx','ry','rz'].includes(c))||new Set(channels).size!==channels.length)throw Error('ASF: invalid bone');
  const len=nums(f.length??[],1)[0];if(len<0)throw Error('ASF: negative length');
  bones.push({name,parent:null,channels,offset:nums(f.direction??[],3).map(v=>v*len*metres),C:axisRotation(axis,nums(f.axis.slice(0,3),3))});block=null;
 }else if(block)block.push(l);}
 if(block||bones.length===1)throw Error('ASF: incomplete bones');
 const byName=Object.fromEntries(bones.map(b=>[b.name,b]));
 for(const l of sections.hierarchy??[]){if(['begin','end'].includes(l))continue;const [p,...children]=l.split(/\s+/);if(!byName[p])throw Error('ASF: unknown parent');for(const c of children){if(!byName[c]||byName[c].parent!==null)throw Error('ASF: invalid hierarchy');byName[c].parent=p;}}
 const ordered=[],visiting=new Set();
 function visit(b){if(ordered.includes(b))return;if(visiting.has(b)||b.parent===null)throw Error('ASF: disconnected/cyclic hierarchy');visiting.add(b);if(b.parent!==-1)visit(byName[b.parent]);ordered.push(b);visiting.delete(b);}
 bones.forEach(visit);const index=Object.fromEntries(ordered.map((b,i)=>[b.name,i]));
 return {metres,index,bones:ordered.map(b=>({...b,parent:b.parent===-1?-1:index[b.parent]}))};
}
export function acclaimFrame(skeleton,row) {
 const out=[];
 for(const b of skeleton.bones){const values=row[b.name]??[],v=[0,0,0],angles=[],order=[];
 b.channels.forEach((c,i)=>{if(c[0]==='t')v['xyz'.indexOf(c[1])]=values[i]*skeleton.metres;else {order.push(c[1]);angles.push(values[i]);}});
 const M=rotation(order,angles),R=b.parent<0?mm(b.C,M):mm(mm(b.C,M),tr(b.C)),pa=out[b.parent],W=pa?mm(pa.W,R):R;
 const P=pa?pa.E.slice():v.map((x,i)=>x+b.position[i]),E=mv(W,b.offset).map((x,i)=>x+P[i]);out.push({P,E,W,R});}
 return out;
}
export function readAMC(text,skeleton,{fps=120}={}) {
 if(!Number.isFinite(fps)||fps<=0)throw Error('AMC: invalid fps');
 const rows=[],numbers=[];let row=null;
 const ls=lines(text);if(!ls.includes(':DEGREES')||!ls.includes(':FULLY-SPECIFIED'))throw Error('AMC: requires fully specified degrees');
 const required=skeleton.bones.filter(b=>b.channels.length);
 function finish(){if(row&&required.some(b=>!Object.hasOwn(row,b.name)))throw Error('AMC: missing channels');}
 for(const l of ls){if(l.startsWith(':')){if(![':DEGREES',':FULLY-SPECIFIED'].includes(l))throw Error('AMC: unsupported directive');continue;}
 if(/^\d+$/.test(l)){finish();const n=Number(l);if(!Number.isSafeInteger(n)||n<1||(numbers.length&&n!==numbers.at(-1)+1))throw Error('AMC: nonconsecutive frames');numbers.push(n);rows.push(row={});}
 else {const [name,...values]=l.split(/\s+/),b=skeleton.bones[skeleton.index[name]];if(!row||!b||!b.channels.length||Object.hasOwn(row,name))throw Error('AMC: unknown/duplicate bone');row[name]=nums(values,b.channels.length);}}
 finish();if(!rows.length)throw Error('AMC: empty motion');
 return {...skeleton,rows,numbers,dt:1/fps,frames:rows.map(r=>acclaimFrame(skeleton,r))};
}

// Sample original AMC frame labels, including fractional autoplay frames.
export function sampleAcclaim(C,frameNumber) {
  if(!Number.isFinite(frameNumber))throw Error('Invalid sit frame');
  const t=Math.max(0,Math.min(C.rows.length-1,frameNumber-C.numbers[0])),i=Math.floor(t),f=t-i;
  let source=C.frames[i];
  if(f&&i+1<C.rows.length){const row={};for(const b of C.bones)if(b.channels.length)row[b.name]=C.rows[i][b.name].map((v,k)=>{let d=C.rows[i+1][b.name][k]-v;if(b.channels[k][0]==='r')d=((d+180)%360+360)%360-180;return v+d*f;});source=acclaimFrame(C,row);}
  return source;
}
