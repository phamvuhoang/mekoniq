// Dev-only Engineering fixtures: tiny AMR components whose every parameter is explicitly `assumed` (never manufacturer data).
import {createHash} from 'node:crypto';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import type {ComponentRevision,EngineeringProject,Instance,Link,Pose,Port,Scalar,SourceRef,Vec3} from '../../packages/lab-runtime/src/engineering/contracts';

const IDENTITY:Pose['quaternionXyzw']=[0,0,0,1];
export const assumed:SourceRef={kind:'assumed',documentId:'fixture-assumptions',revision:'1',locator:'tests/support/engineering.ts',contentSha256:createHash('sha256').update('fixture-assumptions-v1').digest('hex')};
export const scalar=(value:number,unit:string):Scalar=>({value,unit,source:assumed});
export const pose=(x=0,y=0,z=0,q:Pose['quaternionXyzw']=IDENTITY):Pose=>({xyzM:[x,y,z],quaternionXyzw:q});
const QUARTER_X:Pose['quaternionXyzw']=[Math.SQRT1_2,0,0,Math.SQRT1_2]; // rotates a cylinder's Z axis onto Y (wheel axle)
/** Solid-box inertia at the COM in link axes: [ixx,ixy,ixz,iyy,iyz,izz]. */
export const boxInertia=(m:number,[x,y,z]:Vec3):Link['inertiaKgM2']=>[m*(y*y+z*z)/12,0,0,m*(x*x+z*z)/12,0,m*(x*x+y*y)/12];
export const boxLink=(id:string,size:Vec3,massKg:number,over:Partial<Link>={}):Link=>({id,visual:[{pose:pose(),geometry:{kind:'box',sizeM:size},source:assumed}],collision:[{pose:pose(),geometry:{kind:'box',sizeM:size},source:assumed}],massKg:scalar(massKg,'kg'),comM:[0,0,0],inertiaKgM2:boxInertia(massKg,size),inertialSource:assumed,...over});
const mount=(id:string,mate:string,x:number,y:number,z:number):Port=>({id,kind:'mount',frame:pose(x,y,z),mate,direction:'bidirectional'});
const component=(id:string,family:string,rest:Pick<ComponentRevision,'links'|'ports'>&Partial<ComponentRevision>):ComponentRevision=>({schemaVersion:1,id,revision:'1',identity:{manufacturer:'fixture',family,sku:null,status:'candidate'},joints:[],models:[],documents:[],...rest});

/** AMR drive: wheel radius/separation are explicit and must agree with the wheel geometry and mounts (resolver cross-checks both). */
export const makeDriveModel=(radius=0.1,separation=0.45)=>({schemaVersion:1 as const,kind:'actuator' as const,id:'fixture-drive',jointIds:['axle'],transmission:{ratio:scalar(10,'1'),efficiency:scalar(0.8,'1')},commandInterface:'velocity' as const,
 torqueSpeedTable:[{speed:scalar(0,'rad/s'),torque:scalar(3,'N*m')},{speed:scalar(30,'rad/s'),torque:scalar(0,'N*m')}],currentLimit:scalar(10,'A'),voltageLimit:scalar(24,'V'),damping:scalar(0.01,'N*m'),friction:scalar(0.02,'N*m'),
 drive:{wheelRadiusM:scalar(radius,'m'),wheelSeparationM:scalar(separation,'m'),leftMountPort:'left-axle',rightMountPort:'right-axle'}});
export const driveModel=makeDriveModel();
/** Generic 2D LiDAR model fixture; every number is `assumed`. `frame` names a link of the chassis component. */
export const makeLidarModel=(id='fixture-lidar',beams=360,frame='base')=>({schemaVersion:1 as const,kind:'sensor' as const,id,frame,rateHz:scalar(10,'Hz'),range:{min:scalar(0.05,'m'),max:scalar(10,'m')},fieldOfView:scalar(2*Math.PI,'rad'),
 noise:{distribution:'none' as const,stddev:scalar(0,'m'),seed:7},latency:scalar(0,'s'),dropoutProbability:scalar(0,'1'),sensorType:'lidar_2d' as const,lidar2d:{beamCount:beams,beamCountSource:assumed}});
type Rig={axleX?:number;rightAxle?:[number,number,number];lidars?:string[];lidarFrame?:string};
const chassis=(bayX=-0.1,radius=0.1,separation=0.45,rig:Rig={})=>component('amr-chassis','chassis',{models:[{kind:'actuator',id:'fixture-drive',digest:hashJson(makeDriveModel(radius,separation))},...(rig.lidars??[]).map(id=>({kind:'sensor' as const,id,digest:hashJson(makeLidarModel(id,360,rig.lidarFrame))}))],links:[boxLink('base',[0.5,0.4,0.15],20)],ports:[
 mount('left-axle','axle-hub',rig.axleX??0,separation/2,0),mount('right-axle','axle-hub',...(rig.rightAxle??[rig.axleX??0,-separation/2,0])),mount('battery-bay','battery-tray',bayX,0,0.075),mount('tray-plate','tray',0.05,0,0.2),
 {id:'power-in',kind:'power',frame:pose(-0.2,0,0),mate:'dc-bus',direction:'in',voltageRangeV:[18,30],continuousCurrentA:scalar(40,'A')}]});
const wheel=(r=0.1)=>component('drive-wheel','wheel',{links:[boxLink('hub',[0.04,0.04,0.04],0.2),{id:'rim',visual:[{pose:pose(0,0,0,QUARTER_X),geometry:{kind:'cylinder',radiusM:r,lengthM:0.05},source:assumed}],collision:[{pose:pose(0,0,0,QUARTER_X),geometry:{kind:'cylinder',radiusM:r,lengthM:0.05},source:assumed}],massKg:scalar(1.5,'kg'),comM:[0,0,0],inertiaKgM2:[1.5*(3*r*r+0.0025)/12,0,0,1.5*r*r/2,0,1.5*(3*r*r+0.0025)/12],inertialSource:assumed}],
 joints:[{id:'axle',kind:'continuous',parent:'hub',child:'rim',origin:pose(),axis:[0,1,0],limits:{velocity:scalar(30,'rad/s'),effort:scalar(8,'N*m')}}],ports:[mount('mount','axle-hub',0,0,0)]});
const battery=(id:string,volts:[number,number],inertia=true)=>component(id,'battery',{links:[boxLink('pack',[0.2,0.15,0.1],6,inertia?{}:{inertiaKgM2:null})],ports:[mount('mount','battery-tray',0,0,-0.05),{id:'out',kind:'power',frame:pose(0,0,0.05),mate:'dc-bus',direction:'out',voltageRangeV:volts,continuousCurrentA:scalar(60,'A')}],...(inertia?{}:{identity:{manufacturer:'fixture',family:'battery',sku:null,status:'candidate'}})});
const tray=()=>component('service-tray','tray',{links:[boxLink('plate',[0.4,0.35,0.01],1.2)],ports:[mount('mount','tray',0,0,0)]});
const spacer=()=>component('spacer','spacer',{links:[boxLink('body',[0.1,0.1,0.05],0.3)],ports:[mount('top','spacer',0,0,0.025),mount('bottom','spacer',0,0,-0.025)]});

export type Fixture={project:EngineeringProject;components:Record<string,ComponentRevision>;models:Record<string,unknown>};
const models=(radius=0.1,separation=0.45):Record<string,unknown>=>{const m=makeDriveModel(radius,separation);return {[hashJson(m)]:m};};
const digested=(...cs:ComponentRevision[])=>Object.fromEntries(cs.map(c=>[hashJson(c),c]));
const digestOf=(c:ComponentRevision)=>hashJson(c);
const instance=(id:string,c:ComponentRevision,p:Pose=pose()):Instance=>({id,componentDigest:digestOf(c),pose:p});
const world=()=>({id:'fixture-world',revision:1,width:6,height:4,points:[{id:'t1',name:'T1',kind:'table' as const,x:4,y:2},{id:'park',name:'Park',kind:'parking' as const,x:1,y:1},{id:'pass',name:'Kitchen pass',kind:'kitchen' as const,x:1,y:3}],handoffPoints:[],obstacles:[]});
const runtime=(entityIds=['amr-1'])=>({schemaVersion:2 as const,id:'fixture-runtime',name:'Fixture',revision:1,updatedAt:'2026-11-07T00:00:00Z',entities:entityIds.map(id=>({id,kind:'amr' as const,assetRef:{id:'engineering-amr',revision:1,contentHash:'c'.repeat(64)}})),world:world()});
const project=(instances:Instance[],connections:EngineeringProject['assembly']['connections'],entityInstances=instances.map(i=>i.id)):EngineeringProject=>({documentType:'engineering-project',schemaVersion:1,id:'fixture-amr',revision:1,runtimeProject:runtime(),assembly:{instances,connections},entityBindings:[{entityId:'amr-1',instanceIds:entityInstances}],requestedProfile:'engineering-rigid-v1'});

/** The standard two-wheel AMR; the variants below change exactly one thing. */
type AmrOpts={chassisBayX?:number;batteryVolts?:[number,number];batteryInertia?:boolean;wheelRadius?:number;wheelSeparation?:number}&Rig;
/** One AMR's instances/connections; `prefix` namespaces instance ids ('' keeps the legacy single-robot names), `at` places the chassis in the world. */
function amrParts(opts:AmrOpts,prefix='',at:Pose=pose()){
 const c=chassis(opts.chassisBayX,opts.wheelRadius,opts.wheelSeparation,opts),w=wheel(opts.wheelRadius),b=battery(opts.batteryVolts?.[1]===13?'battery-12v':'battery-24v',opts.batteryVolts??[22,29],opts.batteryInertia),t=tray();
 const n=(id:string)=>prefix+id;
 const instances=[instance(n('chassis'),c,at),instance(n('wheel-left'),w),instance(n('wheel-right'),w),instance(n('battery'),b),instance(n('tray'),t)];
 const connections:EngineeringProject['assembly']['connections']=[
  {from:n('chassis/left-axle'),to:n('wheel-left/mount'),kind:'mount'},{from:n('chassis/right-axle'),to:n('wheel-right/mount'),kind:'mount'},
  {from:n('chassis/battery-bay'),to:n('battery/mount'),kind:'mount'},{from:n('chassis/tray-plate'),to:n('tray/mount'),kind:'mount'},{from:n('battery/out'),to:n('chassis/power-in'),kind:'power'}];
 return {instances,connections,components:digested(c,w,b,t),models:{...models(opts.wheelRadius,opts.wheelSeparation),...Object.fromEntries((opts.lidars??[]).map(id=>{const m=makeLidarModel(id,360,opts.lidarFrame);return [hashJson(m),m];}))}};
}
function amr(opts:AmrOpts={}){
 const p=amrParts(opts);
 return {project:project(p.instances,p.connections),components:p.components,models:p.models};
}
/** Two AMRs with different wheel radius/separation in one assembly (entities amr-1 and amr-2, instance ids r1-*, r2-*). */
function twoAmr(){
 const a=amrParts({wheelRadius:0.075,wheelSeparation:0.36,lidars:['lidar-front']},'r1-',pose(1,1)),b=amrParts({wheelRadius:0.1,wheelSeparation:0.42,axleX:-0.1},'r2-',pose(3,1));
 const instances=[...a.instances,...b.instances];
 return {project:{...project(instances,[...a.connections,...b.connections],[]),requestedProfile:'engineering-irsim-2d-v1' as const,runtimeProject:runtime(['amr-1','amr-2']),
  entityBindings:[{entityId:'amr-1',instanceIds:a.instances.map(i=>i.id)},{entityId:'amr-2',instanceIds:b.instances.map(i=>i.id)}]},
  components:{...a.components,...b.components},models:{...a.models,...b.models}};
}
function cycle(){
 const s=spacer(),instances=['s1','s2','s3'].map(id=>instance(id,s));
 return {project:project(instances,[{from:'s1/top',to:'s2/bottom',kind:'mount'},{from:'s2/top',to:'s3/bottom',kind:'mount'},{from:'s3/top',to:'s1/bottom',kind:'mount'}]),components:digested(s),models:models()};
}
const FIXTURES:Record<string,()=>Fixture>={
 valid:()=>amr(),
 'missing-inertia':()=>amr({batteryInertia:false}),
 cycle,
 'voltage-mismatch':()=>amr({batteryVolts:[11,13]}),
 'wheel-r075':()=>amr({wheelRadius:0.075}),
 // battery bay moved 0.3 m behind the chassis origin: analytic COM shift for the A03 inertia test
 'battery-offset':()=>amr({chassisBayX:-0.3}),
 'two-amr':twoAmr,
 'two-lidars':()=>amr({lidars:['lidar-a','lidar-b']}),
 'lidar-bad-frame':()=>amr({lidars:['lidar-a'],lidarFrame:'no-such-link'}),
 'swapped-axle':()=>amr({wheelSeparation:0.45,rightAxle:[0,0.675,0]}),
 'skew-axle':()=>amr({wheelSeparation:0.45,rightAxle:[0,-(Math.sqrt(0.45**2-0.1**2)-0.225),0.1]}),
};
export function engineeringFixture(name:string):Fixture{
 const build=Object.hasOwn(FIXTURES,name)?FIXTURES[name]:undefined;
 if(!build)throw new Error(`UNKNOWN_ENGINEERING_FIXTURE ${name}`);
 return build();
}

// ---- gateway-level helpers (A04) ----
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {CompilerPort} from '../../packages/lab-runtime/src/engineering/gateway';
/** Writes a loadCatalog()-compatible catalog containing exactly the fixture's components and models. */
export async function writeFixtureCatalog(root:string,f:{components:Record<string,ComponentRevision>;models:Record<string,unknown>}){
 for(const d of ['components','models','documents'])await mkdir(join(root,d),{recursive:true});
 const entries=[];
 for(const [digest,c] of Object.entries(f.components)){const file=`components/${digest}.json`;await writeFile(join(root,file),JSON.stringify(c));entries.push({file,digest});}
 for(const [digest,m] of Object.entries(f.models))await writeFile(join(root,'models',`${digest}.json`),JSON.stringify(m));
 await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,id:'fixture-catalog',components:entries,quotes:[]}));
}
const sha=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
/** Test compiler port: deterministic scene.json from the resolved links; no physics, so the service reports runnable:false. */
export const testCompiler:CompilerPort={version:'test-compiler-1',async compileResolved(input,outDir){
 const scene=JSON.stringify({links:input.resolved.links.map(l=>l.id).sort(),projectDigest:input.projectDigest});
 await writeFile(join(outDir,'scene.json'),scene);
 return {sceneDigest:sha(scene),files:[{path:'scene.json',sha256:sha(scene)}]};
}};
