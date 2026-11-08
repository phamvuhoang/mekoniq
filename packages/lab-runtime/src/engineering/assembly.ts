import {composePose,invertPose,qrotate,type Pose as FramePose} from '../v2/frames';
import {sealAsset} from '../v2/assets';
import {hashJson} from '../v2/hash';
import {validateProjectV2} from '../v2/contracts';
import type {AssetRevision,CoffeeRecipe} from '../v2/contracts';
import type {Quote} from './catalog';
import {validateEngineeringCompileInput,validateEngineeringProject} from './contracts';
import type {Bom,BomLine,ComponentRevision,EngineeringCompileInput,EngineeringProject,Joint,Link,ModelDocument,Placement,Pose,Problem,ResolvedAssembly,ResolvedPort,SourceRef} from './contracts';
import {engineeringPose,framePose,inertiaProblems} from './inertia';

export interface ResolveOptions{
 /** Model documents by digest (from loadCatalog().models). A ModelRef whose digest is absent is a blocking MODEL_UNAVAILABLE. */
 models?:Record<string,Record<string,unknown>>;
 /** Valid quotations by component digest (from loadCatalog().quotes). */
 quotes?:Record<string,Quote>;
 /** 1 collects a drive binding per AMR (models.drivesByEntity) and refuses ambiguous sensor models. Implied by requestedProfile 'engineering-irsim-2d-v1'; legacy resolutions are unchanged. */
 driveBindingsVersion?:1;
}
const EPS=1e-9;
const IDENTITY:FramePose={position:[0,0,0],quaternionXyzw:[0,0,0,1]};
const isIdentity=(p:Pose)=>p.xyzM.every(v=>Math.abs(v)<EPS)&&Math.abs(Math.abs(p.quaternionXyzw[3])-1)<EPS;
const at=(...parts:(string|number)[])=>'/'+parts.join('/');
const endpoint=(e:string)=>{const [instance='',port='']=e.split('/');return {instance,port};};
const linkKey=(instance:string,link:string)=>`${instance}/${link}`;

interface ComponentTopology{root:string;poses:Map<string,FramePose>;}
/** Link tree of one component at zero joint position, expressed in the root link frame; null when the tree is malformed. */
function topology(c:ComponentRevision,path:string,add:(code:string,path:string,detail:string)=>void):ComponentTopology|null{
 const ids=new Set(c.links.map(l=>l.id)),parent=new Map<string,Joint>();
 let ok=true;
 for(const j of c.joints){
  if(!ids.has(j.parent)||!ids.has(j.child)){add('COMPONENT_TOPOLOGY_INVALID',at(path,'joints',j.id),`joint refers to a missing link (${j.parent} -> ${j.child})`);ok=false;continue;}
  if(parent.has(j.child)){add('MULTIPLE_PARENT',at(path,'joints',j.id),`link ${j.child} already has a parent joint`);ok=false;continue;}
  parent.set(j.child,j);
 }
 const roots=c.links.filter(l=>!parent.has(l.id));
 if(!roots.length){add('ASSEMBLY_CYCLE',path,'component links form a cycle');return null;}
 if(roots.length>1){add('COMPONENT_TOPOLOGY_INVALID',path,`component has ${roots.length} disconnected link trees`);return null;}
 if(!ok)return null;
 const poses=new Map<string,FramePose>([[roots[0]!.id,IDENTITY]]);
 const settle=(id:string,seen:Set<string>):FramePose|null=>{
  const known=poses.get(id);if(known)return known;
  const j=parent.get(id)!;if(seen.has(id))return null;
  const base=settle(j.parent,new Set(seen).add(id));if(!base)return null;
  const p=composePose(base,framePose(j.origin));poses.set(id,p);return p;
 };
 for(const l of c.links)if(!settle(l.id,new Set())){add('ASSEMBLY_CYCLE',path,'component links form a cycle');return null;}
 return {root:roots[0]!.id,poses};
}

type Aabb={min:number[];max:number[]};
function shapeBounds(geometry:Link['visual'][number]['geometry'],world:FramePose):Aabb|null{
 const R=(v:number[])=>qrotate(world.quaternionXyzw,v),h=[0,0,0];
 if(geometry.kind==='box'){const cols=[R([1,0,0]),R([0,1,0]),R([0,0,1])];for(let k=0;k<3;k++)h[k]=cols.reduce((a,c,i)=>a+Math.abs(c[k]!)*geometry.sizeM[i]!/2,0);}
 else if(geometry.kind==='sphere')h.fill(geometry.radiusM);
 else if(geometry.kind==='cylinder'){const ax=R([0,0,1]);for(let k=0;k<3;k++)h[k]=geometry.radiusM*Math.sqrt(Math.max(0,1-ax[k]!**2))+geometry.lengthM/2*Math.abs(ax[k]!);}
 else return null; // ponytail: mesh bounds need the blob; meshes are not penetration-checked until the compiler loads them
 const p=world.position;
 return {min:[0,1,2].map(k=>p[k]!-h[k]!),max:[0,1,2].map(k=>p[k]!+h[k]!)};
}
// ponytail: world-axis AABBs over-report for rotated shapes; upgrade to oriented-box SAT if false positives appear.
const overlaps=(a:Aabb,b:Aabb)=>[0,1,2].every(k=>Math.min(a.max[k]!,b.max[k]!)-Math.max(a.min[k]!,b.min[k]!)>EPS);

export const sourceKey=(s:SourceRef)=>`${s.documentId}\u0000${s.revision}\u0000${s.locator}\u0000${s.contentSha256}`;
export function uniqueSources(list:SourceRef[]):SourceRef[]{
 const map=new Map(list.map(s=>[sourceKey(s),s]));
 return [...map.entries()].sort(([a],[b])=>a<b?-1:1).map(([,s])=>s);
}
export const linkSources=(l:Link):SourceRef[]=>[l.massKg.source,l.inertialSource,...l.visual.map(s=>s.source),...l.collision.map(s=>s.source)];

export function resolveAssembly(project:EngineeringProject,components:Record<string,ComponentRevision>,options:ResolveOptions={}):{problems:Problem[];resolved:ResolvedAssembly|null}{
 const shape=validateEngineeringProject(project);
 if(!shape.ok)return {problems:shape.problems,resolved:null};
 const problems:Problem[]=[],add=(code:string,path:string,detail:string)=>{problems.push({code,path,blocking:true,detail});};
 const {instances,connections}=project.assembly,byId=new Map(instances.map(i=>[i.id,i]));
 const comp=new Map<string,ComponentRevision>(),topo=new Map<string,ComponentTopology>();
 for(const i of instances){
  const c=components[i.componentDigest];
  if(!c){add('COMPONENT_UNAVAILABLE',at('assembly','instances',i.id),i.componentDigest);continue;}
  comp.set(i.id,c);
  const t=topology(c,at('instances',i.id),add);if(t)topo.set(i.id,t);
  // Every link needs a valid physical description; unknown is reported as missing, never defaulted to zero.
  for(const l of c.links){
   const base=at('instances',i.id,'links',l.id);
   if(l.inertiaKgM2===null){add('PARAMETER_MISSING',base+'/inertiaKgM2','inertia tensor is unavailable');continue;}
   const bad=[...(l.massKg.value>0?[]:['NON_POSITIVE_MASS']),...inertiaProblems(l.inertiaKgM2)];
   if(bad.length)add('INERTIA_INVALID',base,bad.join(', '));
  }
 }
 // ---- connections ----
 const parentOf=new Map<string,string>(),mountPairs=new Set<string>(),usedPorts=new Set<string>(),mounts:{from:ReturnType<typeof endpoint>;to:ReturnType<typeof endpoint>;n:number}[]=[];
 const supply=new Map<string,{capacity:number|null;demand:number}>();
 for(const [n,c] of connections.entries()){
  const path=at('assembly','connections',n),from=endpoint(c.from),to=endpoint(c.to);
  const fp=comp.get(from.instance)?.ports.find(p=>p.id===from.port),tp=comp.get(to.instance)?.ports.find(p=>p.id===to.port);
  if(!fp||!tp){add('DANGLING_CONNECTION',path,`${c.from} -> ${c.to}`);continue;}
  if(fp.kind!==c.kind||tp.kind!==c.kind){add(c.kind==='mount'?'MOUNT_MISMATCH':'DATA_INTERFACE_MISSING',path,`port kinds ${fp.kind}/${tp.kind} do not match connection kind ${c.kind}`);continue;}
  if(c.kind!=='power')for(const e of [c.from,c.to]){if(usedPorts.has(e))add('PORT_REUSED',path,e);usedPorts.add(e);}
  if(c.kind==='mount'){
   if(fp.mate!==tp.mate)add('MOUNT_MISMATCH',path,`${fp.mate} does not mate with ${tp.mate}`);
   if(from.instance===to.instance){add('ASSEMBLY_CYCLE',path,'an instance cannot be mounted to itself');continue;}
   if(parentOf.has(to.instance)){add('MULTIPLE_PARENT',path,`${to.instance} already has parent ${parentOf.get(to.instance)}`);continue;}
   parentOf.set(to.instance,from.instance);mountPairs.add(`${from.instance}\u0000${to.instance}`).add(`${to.instance}\u0000${from.instance}`);mounts.push({from,to,n});
  }else if(c.kind==='power'){
   if(fp.direction==='in'||tp.direction==='out')add('POWER_DIRECTION_INVALID',path,`${c.from} (${fp.direction}) -> ${c.to} (${tp.direction})`);
   if(!fp.voltageRangeV||!tp.voltageRangeV)add('PARAMETER_MISSING',path,'both power ports need a voltage range');
   else if(Math.max(fp.voltageRangeV[0],tp.voltageRangeV[0])>Math.min(fp.voltageRangeV[1],tp.voltageRangeV[1]))add('VOLTAGE_MISMATCH',path,`${fp.voltageRangeV.join('-')} V does not overlap ${tp.voltageRangeV.join('-')} V`);
   if(!fp.continuousCurrentA||!tp.continuousCurrentA)add('PARAMETER_MISSING',path,'both power ports need a continuous current');
   else{const s=supply.get(c.from)??{capacity:fp.continuousCurrentA.value,demand:0};s.demand+=tp.continuousCurrentA.value;supply.set(c.from,s);}
  }else if(!fp.protocol||fp.protocol!==tp.protocol)add('DATA_INTERFACE_MISSING',path,`protocol ${fp.protocol??'none'} vs ${tp.protocol??'none'}`);
 }
 for(const [port,s] of supply)if(s.demand>s.capacity!)add('POWER_BUDGET_EXCEEDED',at('assembly','connections'),`${port}: ${s.demand} A demanded of ${s.capacity} A`);
 // cycles: every instance has at most one parent, so a cycle shows up when walking parents revisits a node
 let cyclic=false;
 for(const start of parentOf.keys()){
  const seen=new Set<string>();
  for(let x:string|undefined=start;x;x=parentOf.get(x)){if(seen.has(x)){cyclic=true;add('ASSEMBLY_CYCLE',at('assembly','instances',x),'mount connections form a cycle');break;}seen.add(x);}
  if(cyclic)break;
 }
 // ---- entities ----
 const entityKinds=new Map(project.runtimeProject.entities.map(e=>[e.id,e.kind]));
 const bindings=new Map(project.entityBindings.map(b=>[b.entityId,b]));
 for(const i of instances)if(!project.entityBindings.some(b=>b.instanceIds.includes(i.id)))add('INSTANCE_UNBOUND',at('assembly','instances',i.id),'no entity owns this instance; bind it or remove it');
 for(const e of project.runtimeProject.entities)if(!bindings.get(e.id)?.instanceIds.length)add('UNBOUND_ENTITY',at('entityBindings',e.id),`entity ${e.id} (${e.kind}) has no instances`);
 for(const b of project.entityBindings){
  if(!entityKinds.has(b.entityId))add('UNBOUND_ENTITY',at('entityBindings',b.entityId),'binding refers to an entity that is not in runtimeProject');
  for(const id of b.instanceIds)if(!byId.has(id))add('UNBOUND_ENTITY',at('entityBindings',b.entityId),`unknown instance ${id}`);
 }
 // ---- placement ----
 const world=new Map<string,FramePose>(),port=(i:string,p:string)=>framePose(comp.get(i)!.ports.find(x=>x.id===p)!.frame);
 if(!cyclic){
  const place=(id:string,seen=new Set<string>()):FramePose|null=>{
   const known=world.get(id);if(known)return known;
   if(seen.has(id))return null;
   const parent=parentOf.get(id),inst=byId.get(id);
   if(!inst||!comp.has(id))return null;
   if(!parent){const w=framePose(inst.pose);world.set(id,w);return w;}
   if(!isIdentity(inst.pose))add('POSE_CONFLICT',at('assembly','instances',id,'pose'),'a mounted instance takes its pose from its mount; leave pose at identity');
   const m=mounts.find(x=>x.to.instance===id)!,base=place(parent,new Set(seen).add(id));
   if(!base)return null;
   const w=composePose(composePose(base,port(m.from.instance,m.from.port)),invertPose(port(id,m.to.port)));
   world.set(id,w);return w;
  };
  for(const i of instances)place(i.id);
 }
 // ---- payload ratings ----
 // Worst case over orientation: the static moment about a rated port is at most g*|sum m_i*(c_i-p)|, so the check holds whatever pose the arm takes.
 if(!cyclic)for(const i of instances){
  const c=comp.get(i.id),w=world.get(i.id);if(!c?.payloadRatings?.length||!w)continue;
  for(const r of c.payloadRatings){
   const root=mounts.find(m=>m.from.instance===i.id&&m.from.port===r.portId);if(!root)continue;
   const beyond=new Set<string>(),queue=[root.to.instance];
   for(let x=queue.shift();x!==undefined;x=queue.shift()){if(beyond.has(x))continue;beyond.add(x);for(const m of mounts)if(m.from.instance===x)queue.push(m.to.instance);}
   const origin=composePose(w,port(i.id,r.portId)).position;let mass=0;const lever:[number,number,number]=[0,0,0];
   for(const d of beyond){
    const dw=world.get(d),dt=topo.get(d),dc=comp.get(d);if(!dw||!dt||!dc)continue;
    for(const l of dc.links){
     const lp=dt.poses.get(l.id);if(!lp)continue;
     const at_=composePose(dw,lp),com=qrotate(at_.quaternionXyzw,l.comM);
     mass+=l.massKg.value;for(let k=0;k<3;k++)lever[k]!+=l.massKg.value*(at_.position[k]!+com[k]!-origin[k]!);
    }
   }
   const moment=9.80665*Math.hypot(...lever),n=(v:number)=>+v.toFixed(6),where=at('assembly','instances',i.id,'payloadRatings',r.portId);
   if(mass>r.maxMassKg.value+EPS)add('PAYLOAD_EXCEEDED',where,`${n(mass)} kg of ${n(r.maxMassKg.value)} kg rated at ${r.portId}`);
   if(moment>r.maxMomentNm.value+EPS)add('PAYLOAD_EXCEEDED',where,`${n(moment)} N*m of ${n(r.maxMomentNm.value)} N*m rated at ${r.portId} (worst-case static moment)`);
  }
 }
 // ---- global links/joints/ports ----
 const links:Link[]=[],joints:Joint[]=[],ports:ResolvedPort[]=[];
 for(const i of instances){
  const c=comp.get(i.id),t=topo.get(i.id);if(!c||!t)continue;
  for(const l of c.links)links.push({...l,id:linkKey(i.id,l.id)});
  for(const j of c.joints)joints.push({...j,id:linkKey(i.id,j.id),parent:linkKey(i.id,j.parent),child:linkKey(i.id,j.child)});
  for(const p of c.ports)ports.push({id:linkKey(i.id,p.id),instanceId:i.id,port:p});
 }
 for(const m of mounts){
  const pt=topo.get(m.from.instance),ct=topo.get(m.to.instance);if(!pt||!ct)continue;
  const fromPort=comp.get(m.from.instance)!.ports.find(p=>p.id===m.from.port)!,toPort=comp.get(m.to.instance)!.ports.find(p=>p.id===m.to.port)!;
  // a port may name the moving link it sits on (the arm's tool link, a wheel rim); without one it is on the component's root link. The child side must be its root link.
  const parentLink=fromPort.link??pt.root,parentPose=pt.poses.get(parentLink);
  if(!parentPose){add('COMPONENT_TOPOLOGY_INVALID',at('assembly','connections',m.n),`${m.from.instance}/${m.from.port} names unknown link ${parentLink}`);continue;}
  if(toPort.link!==undefined&&toPort.link!==ct.root){add('COMPONENT_TOPOLOGY_INVALID',at('assembly','connections',m.n),`${m.to.instance}/${m.to.port} is on ${toPort.link}, but a mounted part attaches by its root link ${ct.root}`);continue;}
  // port frames are in the component root frame, so the joint origin is expressed from the parent link's own frame
  joints.push({id:`mount:${m.from.instance}/${m.from.port}:${m.to.instance}/${m.to.port}`,kind:'fixed',parent:linkKey(m.from.instance,parentLink),child:linkKey(m.to.instance,ct.root),
   origin:engineeringPose(composePose(composePose(invertPose(parentPose),port(m.from.instance,m.from.port)),invertPose(port(m.to.instance,m.to.port)))),axis:[0,0,1]});
 }
 // ---- models ----
 const modelDoc=(ref:{kind:string;id:string;digest:string},path:string):ModelDocument|null=>{
  const m=options.models?.[ref.digest];
  if(!m){add('MODEL_UNAVAILABLE',path,ref.digest);return null;}
  const {schemaVersion:_v,kind:_k,id:_i,...parameters}=m as Record<string,unknown>;void _v;void _k;void _i;
  return {schemaVersion:1,kind:ref.kind as ModelDocument['kind'],id:ref.id,digest:ref.digest,parameters};
 };
 const perEntity=options.driveBindingsVersion===1||project.requestedProfile==='engineering-irsim-2d-v1';
 const models:ResolvedAssembly['models']={drive:null,arm:{},sensor:{},process:{}};
 const drives:Record<string,NonNullable<ResolvedAssembly['models']['drive']>>={};
 const wheelJoints=new Set<string>();
 const docs=new Map<string,ModelDocument[]>();
 for(const i of instances){
  const c=comp.get(i.id);if(!c)continue;
  const list:ModelDocument[]=[];
  for(const [n,ref] of c.models.entries()){const d=modelDoc(ref,at('instances',i.id,'models',n));if(d)list.push(d);}
  docs.set(i.id,list);
 }
 for(const [entityId,kind] of entityKinds){
  const bound=bindings.get(entityId)?.instanceIds??[];
  if(kind==='amr'){
   const holder=bound.find(id=>docs.get(id)?.some(d=>d.parameters.drive));
   const doc=holder?docs.get(holder)!.find(d=>d.parameters.drive)!:null;
   const drive=doc?.parameters.drive as {wheelRadiusM:{value:number};wheelSeparationM:{value:number};leftMountPort:string;rightMountPort:string}|undefined;
   if(!holder||!doc||!drive){if(bound.length)add('WHEEL_GEOMETRY_REQUIRED',at('entityBindings',entityId),'AMR needs a drive model with explicit wheel radius and separation');continue;}
   const wheel=(portId:string)=>{
    const m=mounts.find(x=>x.from.instance===holder&&x.from.port===portId);
    const c=m&&comp.get(m.to.instance),joint=c?.joints.filter(j=>j.kind==='continuous');
    if(!m||!c||joint?.length!==1){add('WHEEL_GEOMETRY_REQUIRED',at('entityBindings',entityId),`mount port ${portId} must carry exactly one continuous wheel joint`);return null;}
    const rim=c.links.find(l=>l.id===joint[0]!.child),cyl=rim?.collision.find(s=>s.geometry.kind==='cylinder')?.geometry;
    if(!cyl||cyl.kind!=='cylinder'){add('WHEEL_GEOMETRY_REQUIRED',at('instances',m.to.instance),'wheel link needs a cylinder collision shape');return null;}
    if(Math.abs(cyl.radiusM-drive.wheelRadiusM.value)>EPS)add('WHEEL_GEOMETRY_MISMATCH',at('instances',m.to.instance),`drive model radius ${drive.wheelRadiusM.value} m, wheel geometry ${cyl.radiusM} m`);
    return linkKey(m.to.instance,joint[0]!.id);
   };
   const left=wheel(drive.leftMountPort),right=wheel(drive.rightMountPort);
   const hw=world.get(holder);
   if(hw&&left&&right){
    const a=composePose(hw,port(holder,drive.leftMountPort)).position,b=composePose(hw,port(holder,drive.rightMountPort)).position,sep=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
    if(Math.abs(sep-drive.wheelSeparationM.value)>EPS)add('WHEEL_GEOMETRY_MISMATCH',at('entityBindings',entityId),`drive model separation ${drive.wheelSeparationM.value} m, mounts are ${sep} m apart`);
   }
   if(left&&right){models.drive=drives[entityId]={entityId,instanceId:holder,model:doc,leftJointId:left,rightJointId:right};wheelJoints.add(left).add(right);}
  }
 }
 if(perEntity){
  const list=Object.values(drives);
  // several AMRs: no singleton, each binding lives under its own entity; one AMR: the singleton is that same binding
  models.driveBindingsVersion=1;models.drivesByEntity=drives;models.drive=list.length===1?list[0]!:null;
 }
 for(const [id,list] of docs)for(const d of list){
  const entityKind=[...bindings.values()].find(b=>b.instanceIds.includes(id));
  if(d.kind==='sensor'){if(perEntity&&models.sensor[id])add('MULTIPLE_SENSOR_MODELS_UNSUPPORTED',at('instances',id,'models'),`instance carries several sensor models (${models.sensor[id]!.id}, ${d.id}); the model is not chosen implicitly`);else models.sensor[id]=d;}
  else if(d.kind==='process')models.process[id]=d;
  else if(!d.parameters.drive&&entityKinds.get(entityKind?.entityId??'')==='arm')models.arm[models.arm[id]?`${id}/${d.id}`:id]=d;
 }
 // every movable joint needs an actuator model (the AMR drive covers its wheels)
 for(const i of instances){
  const c=comp.get(i.id);if(!c)continue;
  const covered=new Set((docs.get(i.id)??[]).filter(d=>d.kind==='actuator').flatMap(d=>(d.parameters.jointIds as string[]|undefined)??[]));
  for(const j of c.joints)if(j.kind!=='fixed'&&!covered.has(j.id)&&!wheelJoints.has(linkKey(i.id,j.id)))add('ACTUATOR_MODEL_REQUIRED',at('instances',i.id,'joints',j.id),'no actuator model covers this joint');
 }
 // ---- initial penetration (mounted neighbours may touch) ----
 if(!cyclic){
  const boxes=new Map<string,Aabb[]>();
  for(const i of instances){
   const c=comp.get(i.id),t=topo.get(i.id),w=world.get(i.id);if(!c||!t||!w)continue;
   const list:Aabb[]=[];
   for(const l of c.links)for(const s of l.collision){const b=shapeBounds(s.geometry,composePose(composePose(w,t.poses.get(l.id)!),framePose(s.pose)));if(b)list.push(b);}
   boxes.set(i.id,list);
  }
  const ids=[...boxes.keys()];
  for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){
   if(mountPairs.has(`${ids[a]}\u0000${ids[b]}`))continue;
   if(boxes.get(ids[a]!)!.some(x=>boxes.get(ids[b]!)!.some(y=>overlaps(x,y))))add('INITIAL_PENETRATION',at('assembly','instances',ids[a]!),`overlaps ${ids[b]} without a mount between them`);
  }
 }
 // ---- BOM ----
 const lines=new Map<string,BomLine>();
 for(const i of instances){
  const c=comp.get(i.id);if(!c)continue;
  const lineId=`${c.id}:${c.revision.replace(/[^A-Za-z0-9_.:/-]/g,'_')}:${i.componentDigest.slice(0,8)}`,line=lines.get(lineId);
  if(line){line.qty+=1;line.instanceIds.push(i.id);continue;}
  const power=c.ports.filter(p=>p.kind==='power'&&p.voltageRangeV),range=(power.find(p=>p.direction==='in')??power[0])?.voltageRangeV??null;
  lines.set(lineId,{lineId,componentId:c.id,componentRevision:c.revision,componentDigest:i.componentDigest,sku:c.identity.sku,candidate:c.identity.status==='candidate',qty:1,
   massKg:c.links.length?c.links.reduce((s,l)=>s+l.massKg.value,0):null,voltageRangeV:range,price:options.quotes?.[i.componentDigest]??null,sources:uniqueSources(c.links.flatMap(l=>[l.massKg.source,l.inertialSource])),instanceIds:[i.id],requiredAccessories:[]});
 }
 const bomLines=[...lines.values()].sort((a,b)=>a.lineId<b.lineId?-1:1);
 const priced=bomLines.filter(l=>l.price),currencies=new Set(priced.map(l=>l.price!.currency));
 const bom:Bom={lines:bomLines,missingPriceLineIds:bomLines.filter(l=>!l.price).map(l=>l.lineId),incompleteTotal:priced.length<bomLines.length||currencies.size>1,
  total:priced.length&&currencies.size===1?{amount:priced.reduce((s,l)=>s+l.price!.amount*l.qty,0),currency:[...currencies][0]!,quotedOn:priced.map(l=>l.price!.quotedOn).sort().at(-1)!}:null};
 // ---- output ----
 if(problems.some(p=>p.blocking))return {problems,resolved:null};
 const sortBy=<T,>(list:T[],key:(x:T)=>string)=>[...list].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
 const body={
  links:sortBy(links,l=>l.id),joints:sortBy(joints,j=>j.id),entityBindings:sortBy(project.entityBindings,b=>b.entityId),ports:sortBy(ports,p=>p.id),models,
  placements:sortBy(instances.map((i):Placement=>({instanceId:i.id,world:engineeringPose(world.get(i.id)!)})),p=>p.instanceId),
  assumptions:uniqueSources(links.flatMap(linkSources).filter(s=>s.kind==='assumed')),bom,
 };
 return {problems,resolved:{assemblyDigest:hashJson(body),...body}};
}

/** World pose of every global link at zero joint position, from instance placements and the resolved joint tree. */
export function linkWorldPoses(resolved:ResolvedAssembly):Map<string,FramePose>{
 const out=new Map<string,FramePose>(),children=new Map<string,Joint[]>(),isChild=new Set(resolved.joints.map(j=>j.child));
 for(const j of resolved.joints)children.set(j.parent,[...(children.get(j.parent)??[]),j]);
 const visit=(id:string,pose:FramePose)=>{out.set(id,pose);for(const j of children.get(id)??[])visit(j.child,composePose(pose,framePose(j.origin)));};
 for(const l of resolved.links)if(!isChild.has(l.id)){
  const placement=resolved.placements.find(p=>l.id.startsWith(p.instanceId+'/'));
  visit(l.id,placement?framePose(placement.world):IDENTITY);
 }
 return out;
}

export class EngineeringInputError extends Error{
 constructor(readonly problems:Problem[]){super(problems.map(p=>`${p.code} ${p.path}`).join('; '));this.name='EngineeringInputError';}
}
const ENTITY_ASSET_KIND:Record<string,AssetRevision['kind']>={amr:'amr',arm:'arm',coffee_machine:'coffee_machine',cup_station:'fixture'};
// ponytail: asset schema allows 64 frames per entity; larger assemblies (arms with many links) need a mesh-backed asset path.
function entityAsset(entityId:string,kind:string,revision:number,instanceIds:string[],resolved:ResolvedAssembly):AssetRevision{
 const poses=linkWorldPoses(resolved),mine=new Set(instanceIds),links=resolved.links.filter(l=>mine.has(l.id.split('/')[0]!));
 const rootInstance=instanceIds.find(id=>!resolved.joints.some(j=>j.id.startsWith('mount:')&&j.child.startsWith(id+'/')))??instanceIds[0]!;
 // the instance's root link is the one no joint of its own component hangs under (the first link in id order is just the first)
 const own=resolved.links.filter(l=>l.id.startsWith(rootInstance+'/')),childOfOwn=new Set(resolved.joints.filter(j=>!j.id.startsWith('mount:')&&j.parent.startsWith(rootInstance+'/')).map(j=>j.child));
 const rootLink=own.find(l=>!childOfOwn.has(l.id))!,toRoot=invertPose(poses.get(rootLink.id)!);
 const frames:AssetRevision['frames']=[{id:'root',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]}],geometry:AssetRevision['geometry']=[];
 for(const l of links)for(const [n,s] of l.collision.entries()){
  const g=s.geometry;if(g.kind==='mesh')continue;
  const frameId=`${l.id.replace(/\//g,':')}:c${n}`,p=composePose(toRoot,composePose(poses.get(l.id)!,framePose(s.pose)));
  frames.push({id:frameId,parentId:'root',translationM:[...p.position],quaternionXyzw:[...p.quaternionXyzw]});
  geometry.push(g.kind==='box'?{kind:'box',frameId,sizeM:g.sizeM}:g.kind==='sphere'?{kind:'sphere',frameId,radiusM:g.radiusM}:{kind:'cylinder',frameId,radiusM:g.radiusM,heightM:g.lengthM});
 }
 if(frames.length>64||geometry.length>200)throw new EngineeringInputError([{code:'ASSET_TOO_LARGE',path:at('entityBindings',entityId),blocking:true,detail:`${frames.length} frames exceed the asset limit of 64`}]);
 const worst=(sources:SourceRef[])=>sources.some(s=>s.kind==='assumed'||s.kind==='derived')?'assumed':sources.every(s=>s.kind==='measured')?'measured':'vendor_spec';
 const reference=(sources:SourceRef[])=>[...new Set(sources.map(s=>s.documentId))].sort().join(', ').slice(0,500);
 const shapeSources=links.flatMap(l=>l.collision.map(s=>s.source)),massSources=links.map(l=>l.massKg.source);
 return sealAsset({schemaVersion:2,id:`${entityId}.engineering`,revision,contentHash:'0'.repeat(64),hashAlgorithm:'sha256-canonical-json-v1',kind:ENTITY_ASSET_KIND[kind]??'fixture',visual:null,collision:null,frames,geometry,
  inertial:{massKg:links.reduce((s,l)=>s+l.massKg.value,0)},
  provenance:[{parameter:'geometry',source:worst(shapeSources),reference:reference(shapeSources)},{parameter:'inertial.massKg',source:worst(massSources),reference:reference(massSources)}]});
}

/**
 * Immutable compile input: the project, its resolved assembly, a source-generated runtime projection (assets regenerated from the assembly,
 * everything else byte-for-byte the project's) and the recipes it references. Throws EngineeringInputError instead of returning a partial input.
 */
export function prepareEngineeringCompileInput(project:EngineeringProject,resolved:ResolvedAssembly,recipes:CoffeeRecipe[]):EngineeringCompileInput{
 const problems:Problem[]=[],add=(code:string,path:string,detail:string)=>problems.push({code,path,blocking:true,detail});
 const shape=validateEngineeringProject(project);
 if(!shape.ok)throw new EngineeringInputError(shape.problems);
 const sortBindings=(b:EngineeringProject['entityBindings'])=>[...b].sort((x,y)=>x.entityId<y.entityId?-1:1);
 if(hashJson(sortBindings(project.entityBindings))!==hashJson(sortBindings(resolved.entityBindings)))add('BINDING_MISMATCH','/entityBindings','resolved assembly was built from different entity bindings');
 const bindings=new Map(project.entityBindings.map(b=>[b.entityId,b]));
 const assets:AssetRevision[]=[],runtime=JSON.parse(JSON.stringify(project.runtimeProject)) as EngineeringProject['runtimeProject'];
 for(const e of runtime.entities){
  const b=bindings.get(e.id);
  if(!b?.instanceIds.length){add('UNBOUND_ENTITY',at('entityBindings',e.id),'no instances');continue;}
  const asset=entityAsset(e.id,e.kind,project.revision,b.instanceIds,resolved);
  assets.push(asset);e.assetRef={id:asset.id,revision:asset.revision,contentHash:asset.contentHash};
  for(const ref of e.recipeRefs??[]){
   const r=recipes.find(x=>x.id===ref.id&&x.revision===ref.revision);
   if(!r)add('RECIPE_MISSING',at('runtimeProject','entities',e.id,'recipeRefs',ref.id),`recipe ${ref.id} r${ref.revision} was not supplied`);
   else if(r.hash!==ref.hash)add('RECIPE_MISMATCH',at('runtimeProject','entities',e.id,'recipeRefs',ref.id),`project pins ${ref.hash}, recipe is ${r.hash}`);
  }
 }
 const projected=validateProjectV2(runtime);
 if(!projected.ok)for(const i of projected.issues)add('PROJECTION_INVALID',i.path,i.message);
 if(problems.length)throw new EngineeringInputError(problems);
 const result:EngineeringCompileInput={schemaVersion:1,project,projectDigest:hashJson(project),resolved,runtimeProjection:{project:runtime,assets:assets.sort((a,b)=>a.id<b.id?-1:1)},recipes:[...recipes].sort((a,b)=>a.id<b.id?-1:1)};
 // the compiler validates this against the same schema; refuse here rather than hand it something it must reject
 const conforms=validateEngineeringCompileInput(result);
 if(!conforms.ok)throw new EngineeringInputError(conforms.problems.map(p=>({...p,code:'INPUT_SCHEMA_INVALID',detail:`${p.code}: ${p.detail}`})));
 return result;
}
