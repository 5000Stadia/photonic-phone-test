import {readASF,readAMC,sampleAcclaim} from '../../spikes/gait/asf-amc.js';
import {makeSitRetarget} from '../../src/people/sit-mocap.js';
import {BONES,joints,MEAN} from '../../spikes/crowd/body.js';
import {mv,rot,sub} from '../../spikes/gait/bvh.js';
const $=id=>document.getElementById(id),canvas=$('view'),ctx=canvas.getContext('2d');
async function fetchText(url){const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);return r.text();}
try {
 const meta=JSON.parse(await fetchText(new URL('../../design/research/sit-captures.json',import.meta.url)));
 const base=new URL('../../vendor/sit/cmu/',import.meta.url);
 const bank=await Promise.all(meta.clips.map(async spec=>{const [asf,amc]=await Promise.all([fetchText(new URL(spec.subject+'.asf',base)),fetchText(new URL(spec.id+'.amc',base))]);const C=readAMC(amc,readASF(asf)),body=joints(MEAN),w=makeSitRetarget(C,body,{origin:spec.originM,floor:spec.floorM}),R=C.frames[spec.rest[0]-C.numbers[0]][0].W;return {spec,C,w,body,yaw:rot('Y',-Math.atan2(R[2],R[8])*180/Math.PI)};}));
 bank.forEach(({spec},i)=>$('clip').add(new Option(spec.id+([' — chair',' — stepstool / fidget',' — high stool'][i]),i)));
 let current=bank[0],frame=0,playing=true,last=0,range;
 function reset(){current=bank[+$('clip').value];range=current.spec.segments[$('segment').value]??current.spec.trim;frame=range[0];$('frame').min=range[0];$('frame').max=range[1];playing=true;$('play').textContent='Pause';}
 $('clip').onchange=reset;$('segment').onchange=reset;
 $('play').onclick=()=>{if(frame>=range[1])frame=range[0];playing=!playing;$('play').textContent=playing?'Pause':'Play';};
 $('frame').oninput=()=>{frame=+$('frame').value;playing=false;$('play').textContent='Play';};reset();
 function draw(now){const dt=Math.min(.1,(now-last)/1000||0);last=now;if(playing){frame=Math.min(range[1],frame+dt*120*+$('speed').value);if(frame===range[1]){playing=false;$('play').textContent='Replay';}}
 const {spec,C,w,body,yaw}=current,p=w.pose(frame),source=sampleAcclaim(C,frame),dpr=devicePixelRatio||1,width=canvas.clientWidth,height=canvas.clientHeight;
 if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
 for(let view=0;view<2;view++){const x0=view*width/2,scale=Math.min(width/2/2.8,height/2.3),project=p=>{const q=mv(yaw,p);return [x0+width/4+q[view===0?0:2]*scale,height-45-q[1]*scale];};
 ctx.save();ctx.beginPath();ctx.rect(x0,0,width/2,height);ctx.clip();ctx.fillStyle='#edf2f6';ctx.font='16px system-ui';ctx.fillText(view?'Side':'Front',x0+15,25);
 const line=(a,b,color,lw=2)=>{ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(...project(a));ctx.lineTo(...project(b));ctx.stroke();};
 const horizontal=(y,half,color)=>{ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x0+width/4-half*scale,height-45-y*scale);ctx.lineTo(x0+width/4+half*scale,height-45-y*scale);ctx.stroke();};
 horizontal(0,2,'#87909a');ctx.setLineDash([5,5]);horizontal(spec.seat.rigPelvisProxyM,.4,'#b7c2cc');ctx.setLineDash([]);
 if($('source').checked){const transform=p=>p.map((v,k)=>(v-(k===1?spec.floorM:spec.originM[k]))*w.scale);for(const b of source)line(transform(b.P),transform(b.E),'#a9d5ed88',3);}
 for(let b=1;b<BONES.length;b++)line(p.P[BONES[b][1]],p.P[b],'#ffbc75',5);
 for(const [name,end] of Object.entries(body.tip)){const b=BONES.findIndex(([n])=>n===name),q=mv(p.W[b],sub(end,body.J[b])).map((v,k)=>v+p.P[b][k]);line(p.P[b],q,'#ffbc75',5);}
 for(const q of p.P){ctx.fillStyle='#ffd7ac';ctx.beginPath();ctx.arc(...project(q),3,0,Math.PI*2);ctx.fill();}
 ctx.restore();}
 $('frame').value=Math.round(frame);$('status').textContent=`${spec.id} · frame ${Math.round(frame)} / ${range[1]} · ${((frame-range[0])/120).toFixed(2)} s · rig pelvis reference ${spec.seat.rigPelvisProxyM.toFixed(3)} m`;
 requestAnimationFrame(draw);
 }requestAnimationFrame(draw);
} catch(e){$('status').textContent='Unable to load sitting study: '+e.message;console.error(e);}
