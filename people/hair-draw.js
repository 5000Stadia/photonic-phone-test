// Core and rim batches per near/mid style. All styles share the tier's materials,
// atlas, agent texture and rest store, and the people's walk texture.
import * as T from 'three/tsl';
import { HAIR_STYLES } from './hair.js';
import { HAIR, fitHair } from './hair-shape.js';
import { crowdHairMaterial } from './hair-material.js';
import { BONES } from './bodies.js';
import { farReducedPositions } from './garments/reduced.js';
const HEAD = BONES.findIndex(b=>b[0]==='head');
export function makeHairDraw(THREE, { group, restStore, tiers, walkNode, walkHU, perRow, walkW, F, B, REST_W }) {
  const states={}, entries=[], entryMap=new Map();
  // One atlas for every style: program sharing cannot depend on a material per style.
  const canvas=document.createElement('canvas'); canvas.width=3072; canvas.height=2048;
  const atlas=new THREE.CanvasTexture(canvas); atlas.colorSpace=THREE.NoColorSpace;
  atlas.flipY=false;
  const ready=Promise.all(HAIR_STYLES.map(async(id,i)=>{
    const texture=await new THREE.TextureLoader().loadAsync(new URL(`../spikes/mhhair/data/${id==='crop'?'':'v2/'}${id}.png`,import.meta.url).href);
    const ctx=canvas.getContext('2d');
    // Original UVs address bottom-up images; place a flipped tile in the shared atlas.
    ctx.save();ctx.translate((i%3)*1024,Math.floor(i/3)*1024+1024);ctx.scale(1,-1);ctx.drawImage(texture.image,0,0,1024,1024);ctx.restore();texture.dispose();
  })).then(()=>{atlas.needsUpdate=true;});
  function state(tier) {
    if(states[tier])return states[tier];
    const cap=tiers[tier].cap, max=Math.max(...Object.values(HAIR.styles).map(s=>s.rt.length));
    const data=new Float32Array(cap*12*6), tex=new THREE.DataTexture(data,18,cap,THREE.RGBAFormat,THREE.FloatType);
    const store=restStore(max,cap,tier==='near'?2:16);
    const row=T.uniform(0,'int').onObjectUpdate(function({object}) {this.value=object.userData.rowBase??0;});
    const i=T.int(T.instanceIndex), colour=T.varying(T.textureLoad(tex,T.ivec2(row.add(2),i)).rgb);
    const mats=crowdHairMaterial({...THREE,TSL:T},atlas,colour,tier==='mid'), m=mats.core;
    const walk=walkNode();
    m.positionNode=T.Fn(()=>{
      const a=T.textureLoad(tex,T.ivec2(row,i)), b=T.textureLoad(tex,T.ivec2(row.add(1),i));
      const gi=T.int(b.y).mul(store.V).add(T.int(T.vertexIndex)).mul(2);
      const p=T.textureLoad(store.tex,T.ivec2(gi.mod(REST_W),gi.div(REST_W))), n=T.textureLoad(store.tex,T.ivec2(gi.add(1).mod(REST_W),gi.add(1).div(REST_W)));
      store.nodes.push(p,n);
      const u=b.x.mod(perRow).mul(F+1).add(a.w.mul(F)).add(.5).div(walkW);
      const r=b.x.div(perRow).floor().mul(B*2).add(HEAD*2);
      const q=walk.sample(T.vec2(u,r.add(.5).div(walkHU))).level(0).normalize(), offset=walk.sample(T.vec2(u,r.add(1.5).div(walkHU))).level(0).xyz;
      const rotate=x=>x.add(T.cross(q.xyz,x).mul(2).mul(q.w)).add(T.cross(q.xyz,T.cross(q.xyz,x).mul(2)));
      const x=rotate(p.xyz).add(offset), nn=rotate(n.xyz), ch=T.cos(a.z),sh=T.sin(a.z);
      const turn=v=>T.vec3(v.x.mul(ch).add(v.z.mul(sh)),v.y,v.z.mul(ch).sub(v.x.mul(sh)));
      T.normalLocal.assign(turn(nn).normalize());
      T.tangentLocal.assign(turn(rotate(T.attribute('tangent','vec4').xyz)).normalize());
      return turn(x).add(T.vec3(a.x,b.z,a.y));
    })();
    mats.rim.positionNode=m.positionNode;
    return states[tier]={cap,data,tex,store,m,mats,rows:0};
  }
  function entry(tier,id) {
    const st=state(tier), key=tier+'|'+id;
    let e=entryMap.get(key);if(e)return e;
    const s=HAIR.styles[id], n=s.rt.length, g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));
    g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(n*3),3));
    g.setIndex(new THREE.BufferAttribute(tier==='near'?s.nearIndex:s.index,1));
    {
      const uv=Float32Array.from(s.uv), tile=HAIR_STYLES.indexOf(id);
      for(let v=0;v<n;v++){uv[2*v]=(Math.min(.9999,Math.max(.0001,uv[2*v]))+tile%3)/3;uv[2*v+1]=(Math.min(.9999,Math.max(.0001,uv[2*v+1]))+Math.floor(tile/3))/2;}
      for(const [name,arr,size] of [['uv',uv,2],['tangent',s.cuts[2].tangent,4],['rt',s.rt,1],['hl',s.hl,1],['sp',s.sp,3]])g.setAttribute(name,new THREE.BufferAttribute(arr,size));
    }
    const mesh=new THREE.Mesh(g,st.m);mesh.count=0;mesh.frustumCulled=false;mesh.name='people-hair-'+key;group.add(mesh);
    mesh.userData.rowBase=HAIR_STYLES.indexOf(id)*3; mesh.userData.hairShading=s.shading;
    const rim=new THREE.Mesh(g,st.mats.rim);rim.count=0;rim.frustumCulled=false;rim.name=mesh.name+'-rim';rim.renderOrder=1;rim.userData=mesh.userData;group.add(rim);
    e={key,tier,id,mesh,rim,material:st.m};entries.push(e,{mesh:rim,material:st.mats.rim});entryMap.set(key,e);return e;
  }
  // Far reads the body's agent rows directly. Each style tests immutable metadata
  // keyed by walkSlot in the vertex shader; nonmatching instances collapse to a point.
  // This trades some cheap rejected vertices for no per-person hair work on the CPU.
  const farStore=restStore(Math.max(...Object.values(HAIR.styles).map(s=>s.far.vertices.length)),tiers.far.cap,16);
  const farMeta=new Float32Array(tiers.far.cap*4);
  const farTex=new THREE.DataTexture(farMeta,1,tiers.far.cap,THREE.RGBAFormat,THREE.FloatType);
  const farEntries=[];
  function attachFar(body) {
    const row=T.uniform(0,'int').onObjectUpdate(function({object}){this.value=object.userData.body.mesh.userData.rowBase??0;});
    const i=T.int(T.instanceIndex).add(row), a=T.textureLoad(body.tex,T.ivec2(0,i)), b=T.textureLoad(body.tex,T.ivec2(1,i));
    const meta=T.textureLoad(farTex,T.ivec2(0,T.int(b.x)));
    const style=T.uniform(0).onObjectUpdate(function({object}){this.value=object.userData.style;});
    const m=new THREE.MeshStandardNodeMaterial({roughness:.85,side:THREE.DoubleSide});
    m.colorNode=T.varying(meta.rgb);
    const walk=walkNode();
    m.positionNode=T.Fn(()=>{
      const p=T.vec3(0).toVar();
      T.If(meta.w.equal(style),()=>{
        const gi=T.int(b.x).mul(farStore.V).add(T.int(T.vertexIndex)).mul(2);
        const rp=T.textureLoad(farStore.tex,T.ivec2(gi.mod(REST_W),gi.div(REST_W))), rn=T.textureLoad(farStore.tex,T.ivec2(gi.add(1).mod(REST_W),gi.add(1).div(REST_W)));
        farStore.nodes.push(rp,rn);
        const u=b.x.mod(perRow).mul(F+1).add(a.w.mul(F)).add(.5).div(walkW), r=b.x.div(perRow).floor().mul(B*2).add(HEAD*2);
        const q=walk.sample(T.vec2(u,r.add(.5).div(walkHU))).level(0).normalize(), offset=walk.sample(T.vec2(u,r.add(1.5).div(walkHU))).level(0).xyz;
        const rotate=x=>x.add(T.cross(q.xyz,x).mul(2).mul(q.w)).add(T.cross(q.xyz,T.cross(q.xyz,x).mul(2)));
        const ch=T.cos(a.z),sh=T.sin(a.z),turn=x=>T.vec3(x.x.mul(ch).add(x.z.mul(sh)),x.y,x.z.mul(ch).sub(x.x.mul(sh)));
        p.assign(turn(rotate(rp.xyz).add(offset)).add(T.vec3(a.x,b.z,a.y)));
        T.normalLocal.assign(turn(rotate(rn.xyz)).normalize());
      });
      return p;
    })();
    for(const [j,id] of HAIR_STYLES.entries()) {
      const s=HAIR.styles[id],g=new THREE.BufferGeometry();
      for(const k of ['position','normal'])g.setAttribute(k,new THREE.BufferAttribute(new Float32Array(s.far.vertices.length*3),3));
      g.setIndex(new THREE.BufferAttribute(s.far.index,1));
      const mesh=new THREE.Mesh(g,m);mesh.count=0;mesh.frustumCulled=false;mesh.name='people-hair-far-'+body.key+'-'+id;
      mesh.userData={body,style:j+1};group.add(mesh);
      const e={mesh,material:m,body};farEntries.push(e);entries.push(e);
    }
  }
  function prepareFar(rec) {
    const slot=rec.walkSlot;
    farMeta.set([...rec.hair.colour,HAIR_STYLES.indexOf(rec.hair.style)+1],slot*4);farTex.needsUpdate=true;
    // Slot identity is the body's persistent walk slot; never an LRU touched each frame.
    if(rec.hair.style) {
      while(farStore.cap<=slot)farStore.grow();
      const fitted=fitHair(rec.hair.style,'far',farReducedPositions(rec.far.coef,rec.far.scale),rec.bodyParams);
      const d=farStore.data;
      for(let v=0;v<fitted.position.length/3;v++)for(let k=0;k<3;k++) {
        d[(slot*farStore.V+v)*8+k]=THREE.DataUtils.toHalfFloat(fitted.position[3*v+k]);
        d[(slot*farStore.V+v)*8+4+k]=THREE.DataUtils.toHalfFloat(fitted.normal[3*v+k]);
      }
      farStore.tex.needsUpdate=true;
    }
  }
  return {
    ready, entries, attachFar, prepareFar,
    warm(){for(const tier of ['near','mid'])for(const id of HAIR_STYLES)entry(tier,id);},
    begin(){for(const s of Object.values(states))s.rows=0;for(const e of entries)e.mesh.count=0;},
    add(tier,rec,nearBody){
      if(!rec.hair.style)return 0;
      const s=state(tier),id=rec.hair.style,e=entry(tier,id);
      if(s.rows>=s.cap)return 0;
      let slot=s.store.slots.get(rec.id), elapsed=0;
      if(slot===undefined){
        const start=performance.now();
        slot=s.store.slot(rec,()=>fitHair(id,tier,tier==='near'?(nearBody??rec.buildNear()).position:rec.body.position,rec.bodyParams));
        elapsed=performance.now()-start;
      }else {s.store.slots.delete(rec.id);s.store.slots.set(rec.id,slot);}
      e.rim.count++;
      const o=(e.mesh.count++*18+e.mesh.userData.rowBase)*4,d=s.data;s.rows++;
      d[o]=rec.pos[0];d[o+1]=rec.pos[2];d[o+2]=rec.heading;d[o+3]=rec.phase;
      d[o+4]=rec.walkSlot;d[o+5]=slot;d[o+6]=rec.pos[1];
      d[o+8]=rec.hair.colour[0];d[o+9]=rec.hair.colour[1];d[o+10]=rec.hair.colour[2];
      return elapsed;
    },
    end(){
      for(const e of farEntries)e.mesh.count=e.body.mesh.count;
      for(const s of Object.values(states)){
        if(s.rows)s.tex.needsUpdate=true;if(s.store.dirty){s.store.tex.needsUpdate=true;s.store.dirty=false;}
      }return entries.filter(e=>e.mesh.count>0).length;
    },
    release(rec){for(const s of Object.values(states))s.store.release(rec);},
    bytes(){return farMeta.byteLength+farStore.data.byteLength+Object.values(states).reduce((n,s)=>n+s.data.byteLength+s.store.data.byteLength,0)+canvas.width*canvas.height*4;},
  };
}
