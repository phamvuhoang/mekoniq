// Serve-style AMR and restaurant fixtures for the portable 2D pipeline. Every number is an `assumed` input (mass, sizes, LiDAR cadence) and every inertia
// tensor is `derived` from it by the solid box/cylinder formulas: nothing here is a measured or vendor-locked value.
import {createHash} from 'node:crypto';
import {prepareEngineeringCompileInput,resolveAssembly} from '../../packages/lab-runtime/src/engineering/assembly';
import type {ComponentRevision,EngineeringCompileInput,EngineeringProject,Instance,Link,Pose,Scalar,SourceRef} from '../../packages/lab-runtime/src/engineering/contracts';
import {defaultNavigationPolicy,NAVIGATION_SCHEMA_HASH} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {projectNavigationModel} from '../../packages/lab-runtime/src/engineering/navigation-model';
import {WORLD3D_DEFAULT} from '../../packages/lab-runtime/src/engineering/webots-compiler';
import {compileNavigationScene} from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import {projectPhysicalModel} from '../../packages/lab-runtime/src/engineering/physical-model';
import type {NavigationPolicyV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {qrotate} from '../../packages/lab-runtime/src/v2/frames';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {QUARTER_X,component,digested,instance,mount,pose,type Fixture} from './engineering';

export type NavigationFixtureName='serve'|'wide'|'overhang'|'two-robot'|'enclosed-goal'|'offset-axle'|'noisy'|'fleet'|'enclosed-table'|'serve-3d'|'fleet-3d';
const sha=(t:string)=>createHash('sha256').update(t).digest('hex');
const assumed=(locator:string):SourceRef=>({kind:'assumed',documentId:'serve-fixture-assumptions',revision:'1',locator,contentSha256:sha('serve-fixture-assumptions-v1')});
const derived=(formula:string,inputs:unknown):SourceRef=>({kind:'derived',documentId:'serve-fixture-inertia-formulas',revision:'1',locator:formula,contentSha256:hashJson(inputs)});
const scalar=(value:number,unit:string,locator='fixture value'):Scalar=>({value,unit,source:assumed(locator)});

type Shape={pose:Pose;geometry:Link['collision'][number]['geometry']};
type Diag=[number,number,number];
const diagOf=(g:Shape['geometry'],m:number):Diag=>{
 if(g.kind==='box'){const [x,y,z]=g.sizeM;return [m*(y*y+z*z)/12,m*(x*x+z*z)/12,m*(x*x+y*y)/12];}
 if(g.kind==='cylinder'){const r=g.radiusM,h=g.lengthM,t=m*(3*r*r+h*h)/12;return [t,t,m*r*r/2];}
 if(g.kind==='sphere'){const t=2*m*g.radiusM**2/5;return [t,t,t];}
 throw new Error('FIXTURE_SHAPE_UNSUPPORTED');
};
/** I = R diag Rᵀ for the shape's orientation inside the link; values below 1e-15 are numerical dust from the rotation and become exact zeros. */
function tensorOf(shape:Shape,m:number):NonNullable<Link['inertiaKgM2']>{
 const d=diagOf(shape.geometry,m),cols=[[1,0,0],[0,1,0],[0,0,1]].map(e=>qrotate(shape.pose.quaternionXyzw,e));
 const at=(i:number,j:number)=>{const v=[0,1,2].reduce((s,k)=>s+cols[k]![i]!*d[k]!*cols[k]![j]!,0);return Math.abs(v)<1e-15?0:v;};
 return [at(0,0),at(0,1),at(0,2),at(1,1),at(1,2),at(2,2)];
}
function solid(id:string,shape:Shape,massKg:number):Link{
 const shapeSource=assumed(`${id} geometry`),formula=shape.geometry.kind==='box'?'box: m*(b²+c²)/12':'cylinder: m*(3r²+h²)/12, m*r²/2';
 return {id,visual:[{pose:shape.pose,geometry:shape.geometry,source:shapeSource}],collision:[{pose:shape.pose,geometry:shape.geometry,source:shapeSource}],massKg:scalar(massKg,'kg',`${id} mass`),
  comM:[...shape.pose.xyzM],inertiaKgM2:tensorOf(shape,massKg),inertialSource:derived(formula,{id,massKg,geometry:shape.geometry,pose:shape.pose})};
}
const box=(x:number,y:number,z:number,at:Pose=pose()):Shape=>({pose:at,geometry:{kind:'box',sizeM:[x,y,z]}});

const TILT=-0.12; // rad about +y: the supports lean backwards, the trays they carry stay level
const tilt=(a:number):Pose['quaternionXyzw']=>[0,Math.sin(a/2),0,Math.cos(a/2)];
const ROD_LENGTH=0.9,SLOTS=[0.3,0.6,0.88];

interface RobotSpec{chassisWidth:number;trayWidth:number;wheelRadius:number;separation:number}
const SPECS:Record<string,RobotSpec>={serve:{chassisWidth:0.54,trayWidth:0.46,wheelRadius:0.09,separation:0.36},wide:{chassisWidth:0.58,trayWidth:0.46,wheelRadius:0.09,separation:0.36},
 overhang:{chassisWidth:0.54,trayWidth:0.65,wheelRadius:0.09,separation:0.36},second:{chassisWidth:0.58,trayWidth:0.46,wheelRadius:0.1,separation:0.42}};

const driveModel=(s:RobotSpec)=>({schemaVersion:1 as const,kind:'actuator' as const,id:'serve-drive',jointIds:['axle'],transmission:{ratio:scalar(12,'1'),efficiency:scalar(0.85,'1')},commandInterface:'velocity' as const,
 torqueSpeedTable:[{speed:scalar(0,'rad/s'),torque:scalar(2.5,'N*m')},{speed:scalar(20,'rad/s'),torque:scalar(0,'N*m')}],currentLimit:scalar(8,'A'),voltageLimit:scalar(24,'V'),damping:scalar(0.01,'N*m'),friction:scalar(0.02,'N*m'),
 drive:{wheelRadiusM:scalar(s.wheelRadius,'m'),wheelSeparationM:scalar(s.separation,'m'),leftMountPort:'left-axle',rightMountPort:'right-axle'}});
/** Generic 2D LiDAR: range, cadence and beam count are assumptions for the demo, not the datasheet of any part. */
export const serveLidarModel=(noiseStddevM=0,beams=360,rangeMaxM=10)=>({schemaVersion:1 as const,kind:'sensor' as const,id:'lidar-2d',frame:'head',rateHz:scalar(10,'Hz','scan cadence'),range:{min:scalar(0.05,'m','range'),max:scalar(rangeMaxM,'m','range')},fieldOfView:scalar(2*Math.PI,'rad','field of view'),
 noise:{distribution:(noiseStddevM?'gaussian':'none') as 'none'|'gaussian',stddev:scalar(noiseStddevM,'m','noise'),seed:7},latency:scalar(0,'s','latency'),dropoutProbability:scalar(0,'1','dropout'),sensorType:'lidar_2d' as const,
 lidar2d:{beamCount:beams,beamCountSource:assumed(`${beams} beams: demo assumption, not a vendor value`)}});

/** Passive ball casters for the 3D plants: a sphere that touches the floor plane the wheels touch (assumed size and mass). */
const CASTER_RADIUS=0.035,CASTER_MASS=0.15,CASTER_X=0.25;
function components(s:RobotSpec,axleX=0,noise=0,lidarSpec:{beams?:number;rangeMaxM?:number}={},casters=false){
 const drive=driveModel(s),lidar=serveLidarModel(noise,lidarSpec.beams,lidarSpec.rangeMaxM),rodY=s.trayWidth/2+0.02,half=s.separation/2;
 const ident=(family:string)=>({manufacturer:'fixture',family,sku:null,status:'candidate' as const});
 const chassis=component('serve-chassis','chassis',{identity:ident('chassis'),models:[{kind:'actuator',id:drive.id,digest:hashJson(drive)}],links:[solid('base',box(0.6,s.chassisWidth,0.14,pose(0,0,0.05)),14)],ports:[
  mount('left-axle','axle-hub',axleX,half,0),mount('right-axle','axle-hub',axleX,-half,0),
  {...mount('support-left','rod-foot',-0.1,rodY,0.12),frame:pose(-0.1,rodY,0.12,tilt(TILT))},{...mount('support-right','rod-foot',-0.1,-rodY,0.12),frame:pose(-0.1,-rodY,0.12,tilt(TILT))},
  mount('lidar-mount','lidar-foot',0.22,0,0.12),...casters?[mount('caster-front','caster-mount',CASTER_X,0,CASTER_RADIUS-s.wheelRadius),mount('caster-rear','caster-mount',-CASTER_X,0,CASTER_RADIUS-s.wheelRadius)]:[]]});
 const r=s.wheelRadius;
 const wheel=component('serve-wheel','wheel',{identity:ident('wheel'),links:[solid('hub',box(0.04,0.04,0.04),0.2),solid('rim',{pose:pose(0,0,0,QUARTER_X),geometry:{kind:'cylinder',radiusM:r,lengthM:0.04}},1.2)],
  joints:[{id:'axle',kind:'continuous',parent:'hub',child:'rim',origin:pose(),axis:[0,1,0],limits:{velocity:scalar(20,'rad/s'),effort:scalar(6,'N*m')}}],ports:[mount('mount','axle-hub',0,0,0)]});
 const rod=component('serve-support','support',{identity:ident('support'),links:[solid('rod',box(0.03,0.03,ROD_LENGTH,pose(0,0,ROD_LENGTH/2)),0.35)],
  ports:[mount('foot','rod-foot',0,0,0),...SLOTS.map((z,i)=>({...mount(`slot-${i+1}`,'tray-edge',0,-0.02,z),frame:pose(0,-0.02,z,tilt(-TILT))}))]});
 const tray=component('serve-tray','tray',{identity:ident('tray'),links:[solid('plate',box(0.4,s.trayWidth,0.02),0.8)],ports:[mount('edge','tray-edge',0,s.trayWidth/2,0)]});
 const head=component('serve-lidar','lidar',{identity:ident('lidar'),models:[{kind:'sensor',id:lidar.id,digest:hashJson(lidar)}],links:[solid('head',{pose:pose(0,0,0.02),geometry:{kind:'cylinder',radiusM:0.04,lengthM:0.04}},0.19)],ports:[mount('foot','lidar-foot',0,0,0)]});
 const caster=component('serve-caster','caster',{identity:ident('caster'),links:[solid('ball',{pose:pose(0,0,0),geometry:{kind:'sphere',radiusM:CASTER_RADIUS}},CASTER_MASS)],ports:[mount('mount','caster-mount',0,0,0)]});
 return {parts:{chassis,wheel,rod,tray,head,...casters?{caster}:{}},models:{[hashJson(drive)]:drive,[hashJson(lidar)]:lidar}};
}
/** One robot's instances and connections; `prefix` namespaces the instance ids and `at` places the chassis (axle height = wheel radius), `axleX` moves the axle forward of the base origin. */
function robot(s:RobotSpec,prefix:string,x:number,y:number,o:{axleX?:number;yaw?:number;noise?:number;lidar?:{beams?:number;rangeMaxM?:number};casters?:boolean}={}){
 const {parts,models}=components(s,o.axleX,o.noise,o.lidar,o.casters),n=(id:string)=>prefix+id,at=pose(x,y,s.wheelRadius,o.yaw?[0,0,Math.sin(o.yaw/2),Math.cos(o.yaw/2)]:undefined);
 const instances:Instance[]=[instance(n('chassis'),parts.chassis,at),instance(n('wheel-left'),parts.wheel),instance(n('wheel-right'),parts.wheel),instance(n('support-left'),parts.rod),instance(n('support-right'),parts.rod),
  ...[1,2,3].map(i=>instance(n(`tray-${i}`),parts.tray)),instance(n('lidar'),parts.head),...parts.caster?[instance(n('caster-front'),parts.caster),instance(n('caster-rear'),parts.caster)]:[]];
 const m=(from:string,to:string)=>({from:n(from),to:n(to),kind:'mount' as const});
 const connections:EngineeringProject['assembly']['connections']=[m('chassis/left-axle','wheel-left/mount'),m('chassis/right-axle','wheel-right/mount'),m('chassis/support-left','support-left/foot'),m('chassis/support-right','support-right/foot'),
  ...[1,2,3].map(i=>m(`support-left/slot-${i}`,`tray-${i}/edge`)),m('chassis/lidar-mount','lidar/foot'),...parts.caster?[m('chassis/caster-front','caster-front/mount'),m('chassis/caster-rear','caster-rear/mount')]:[]];
 return {instances,connections,components:digested(...Object.values(parts) as ComponentRevision[]),models};
}

// ---- restaurant ----
type Rect={id:string;x:number;y:number;width:number;height:number};
const TABLE_CENTERS=[4,7,10,13,16].flatMap(x=>[[x,3],[x,9]] as const).map(([x,y],i)=>({n:String(i+1).padStart(2,'0'),x,y})); // 2 rows of 5; aisle between y=4.3 and y=7.7
export function restaurantWorld(extra:{obstacles?:Rect[];points?:{id:string;name:string;kind:'dock';x:number;y:number}[];handoffs?:{id:string;name:string;kind:'dock';position:[number,number,number];yawRad:number}[]}={}){
 const tables:Rect[]=TABLE_CENTERS.map(t=>({id:`table-${t.n}`,x:t.x-0.4,y:t.y-0.4,width:0.8,height:0.8}));
 return {id:'restaurant-10-tables',revision:1,width:20,height:12,
  points:[{id:'pass',name:'Kitchen pass',kind:'kitchen' as const,x:0.6,y:6},{id:'bay-1',name:'Parking 1',kind:'parking' as const,x:2,y:1.5},{id:'bay-2',name:'Parking 2',kind:'parking' as const,x:3.5,y:1.5},
   ...TABLE_CENTERS.map(t=>({id:`t-${t.n}`,name:`T${t.n}`,kind:'table' as const,x:t.x,y:t.y})),...extra.points??[]],
  // the table point is the semantic target; the handoff is where the robot stands, 0.9 m from the table centre on the aisle side
  handoffPoints:[{id:'pass.handoff',name:'Kitchen pass handoff',kind:'kitchen' as const,position:[1.9,6,0] as [number,number,number],yawRad:Math.PI},
   ...TABLE_CENTERS.map(t=>({id:`t-${t.n}.handoff`,name:`T${t.n} handoff`,kind:'table' as const,position:[t.x,t.y<6?t.y+0.9:t.y-0.9,0] as [number,number,number],yawRad:t.y<6?-Math.PI/2:Math.PI/2})),...extra.handoffs??[]],
  obstacles:[{id:'kitchen-counter',x:0.2,y:4.5,width:0.8,height:3},...tables,...extra.obstacles??[]]};
}
/** A closed 1.2 x 1.3 m pocket in the lower right: its inside is free space, but no path reaches it. */
const pocket=()=>({obstacles:[{id:'pocket-s',x:16.9,y:0.9,width:1.4,height:0.1},{id:'pocket-n',x:16.9,y:2.2,width:1.4,height:0.1},{id:'pocket-w',x:16.9,y:0.9,width:0.1,height:1.4},{id:'pocket-e',x:18.2,y:0.9,width:0.1,height:1.4}],
 points:[{id:'pocket',name:'Pocket',kind:'dock' as const,x:17.6,y:1.6}],handoffs:[{id:'pocket.handoff',name:'Pocket handoff',kind:'dock' as const,position:[17.6,1.6,0] as [number,number,number],yawRad:0}]});

/** Table T01's handoff (4, 3.9) boxed in by three walls and the table itself (0.4 m slits beside the table): admissible free space that no path reaches (IR03 / IR-FD04). */
const tablePocket=()=>({obstacles:[{id:'pocket-w',x:3.1,y:2.6,width:0.1,height:2.1},{id:'pocket-e',x:4.8,y:2.6,width:0.1,height:2.1},{id:'pocket-n',x:3.1,y:4.6,width:1.8,height:0.1}]});

function project(name:NavigationFixtureName,instances:Instance[],connections:EngineeringProject['assembly']['connections'],entities:{id:string;instanceIds:string[]}[]):EngineeringProject{
 return {documentType:'engineering-project',schemaVersion:1,id:`serve-${name}`,revision:1,requestedProfile:name.endsWith('-3d')?'engineering-webots-3d-v1':'engineering-irsim-2d-v1',
  runtimeProject:{schemaVersion:2,id:'serve-runtime',name:`Serve ${name}`,revision:1,updatedAt:'2026-11-08T00:00:00Z',
   entities:entities.map(e=>({id:e.id,kind:'amr' as const,assetRef:{id:'engineering-amr',revision:1,contentHash:'c'.repeat(64)}})),world:restaurantWorld(name==='enclosed-goal'?pocket():name==='enclosed-table'?tablePocket():{})},
  assembly:{instances,connections},entityBindings:entities.map(e=>({entityId:e.id,instanceIds:e.instanceIds}))};
}
function build(name:NavigationFixtureName):Fixture{
 // fleet (IR-FD07, G-IR2): robot01 is the Serve robot with a 360-beam 10 m LiDAR; robot02 has its own chassis, wheels, axle and a 180-beam 8 m LiDAR
 if(name==='fleet'){
  const a=robot(SPECS.serve!,'r1-',2,1.5),b=robot(SPECS.second!,'r2-',3.5,1.5,{lidar:{beams:180,rangeMaxM:8}});
  return {project:project(name,[...a.instances,...b.instances],[...a.connections,...b.connections],[{id:'robot01',instanceIds:a.instances.map(i=>i.id)},{id:'robot02',instanceIds:b.instances.map(i=>i.id)}]),components:{...a.components,...b.components},models:{...a.models,...b.models}};
 }
 if(name==='fleet-3d'){
  const a=robot(SPECS.serve!,'r1-',2,1.5,{casters:true}),b=robot(SPECS.second!,'r2-',3.5,1.5,{lidar:{beams:180,rangeMaxM:8},casters:true});
  return {project:project(name,[...a.instances,...b.instances],[...a.connections,...b.connections],[{id:'robot01',instanceIds:a.instances.map(i=>i.id)},{id:'robot02',instanceIds:b.instances.map(i=>i.id)}]),components:{...a.components,...b.components},models:{...a.models,...b.models}};
 }
 if(name==='two-robot'){
  const a=robot(SPECS.serve!,'r1-',2,1.5),b=robot(SPECS.second!,'r2-',3.5,1.5);
  return {project:project(name,[...a.instances,...b.instances],[...a.connections,...b.connections],[{id:'amr-1',instanceIds:a.instances.map(i=>i.id)},{id:'amr-2',instanceIds:b.instances.map(i=>i.id)}]),components:{...a.components,...b.components},models:{...a.models,...b.models}};
 }
 // offset-axle: the axle 0.2 m forward of the base origin, the base turned +90 deg, so the drive frame (2, 1.7) is not the base origin (2, 1.5)
 // noisy: the serve robot with gaussian LiDAR noise (stddev 0.01 m, IR08), everything else identical
 const r=name==='offset-axle'?robot(SPECS.serve!,'',2,1.5,{axleX:0.2,yaw:Math.PI/2}):name==='noisy'?robot(SPECS.serve!,'',2,1.5,{noise:0.01}):robot(SPECS[name==='enclosed-goal'||name==='enclosed-table'||name==='serve-3d'?'serve':name]!,'',2,1.5,{casters:name==='serve-3d'});
 return {project:project(name,r.instances,r.connections,[{id:'amr-1',instanceIds:r.instances.map(i=>i.id)}]),components:r.components,models:r.models};
}

/** Resolves through the source resolver (never a hand-built ResolvedAssembly) and returns the compile input, the policy and the raw fixture for catalog writers. */
export function navigationFixture(name:NavigationFixtureName):{input:EngineeringCompileInput;policy:NavigationPolicyV1;fixture:Fixture}{
 const fixture=build(name),{problems,resolved}=resolveAssembly(fixture.project,fixture.components,{models:fixture.models as never});
 if(!resolved)throw new Error(`NAVIGATION_FIXTURE_UNRESOLVED ${name}: ${problems.map(p=>`${p.code} ${p.path}`).join('; ')}`);
 return {input:prepareEngineeringCompileInput(fixture.project,resolved,[]),policy:defaultNavigationPolicy(),fixture};
}
/** NavigationSceneV1 (no worker files yet) of every robot in a fixture, through the real projection and compiler. */
export function navigationScene(name:NavigationFixtureName){
 const {input,policy}=navigationFixture(name);
 return compileNavigationScene(input,input.project.runtimeProject.entities.map(e=>e.id).sort().map(id=>projectNavigationModel(projectPhysicalModel(input,id,NAVIGATION_SCHEMA_HASH),policy,{entitySpeedLimitMps:input.project.runtimeProject.entities.find(x=>x.id===id)?.speedLimitMps})),policy);
}
/** Server-owned fixture projects (scenario-fixtures.ts NAVIGATION_FIXTURES) exported beside the base one; their components all live in serve-components.json. */
export const EXPORTED_PROJECTS={'serve-fleet-project.json':'fleet','serve-enclosed-project.json':'enclosed-table','serve-noisy-project.json':'noisy'} as const;
/** The reviewed JSON files of the base 'serve' fixture (also exported to robotics/navigation-2d/fixtures/serve-demo-v1 by scripts/export-navigation2d-fixtures.ts).
 * serve-components.json is the catalog of every exported project: the base Serve parts plus the fleet's second robot and the noisy LiDAR (keyed by digest, so shared parts appear once). */
export function exportedFixtureFiles():Record<string,unknown>{
 const {fixture,policy}=navigationFixture('serve'),extra=Object.fromEntries(Object.entries(EXPORTED_PROJECTS).map(([file,name])=>[file,navigationFixture(name).fixture]));
 const components=Object.assign({},fixture.components,...Object.values(extra).map(f=>f.components)),models=Object.assign({},fixture.models,...Object.values(extra).map(f=>f.models));
 return {'serve-project.json':fixture.project,...Object.fromEntries(Object.entries(extra).map(([file,f])=>[file,f.project])),'serve-components.json':{schemaVersion:1,components,models},'serve-sensor-model.json':serveLidarModel(),
  'restaurant-10-tables.json':fixture.project.runtimeProject.world,'navigation-policy.json':policy,'navigation-scene.json':navigationScene('serve'),'navigation-scene-two-robot.json':navigationScene('two-robot')};
}

/** Heights and materials a 3D plant needs and the 2D scene does not carry (all assumed; the lidar plane at 0.21 m stays below the 0.75 m table top). */
export const WORLD3D=WORLD3D_DEFAULT; // the server's default, so the fixture file and what the Webots compiler writes cannot drift apart
/** NavigationSceneV1 for the Webots plant: the same compiler with the webots engine and world3d. */
export function navigationScene3d(name:'serve-3d'|'fleet-3d'){
 const {input,policy}=navigationFixture(name);
 return compileNavigationScene(input,input.project.runtimeProject.entities.map(e=>e.id).sort().map(id=>projectNavigationModel(projectPhysicalModel(input,id,NAVIGATION_SCHEMA_HASH),policy,{entitySpeedLimitMps:input.project.runtimeProject.entities.find(x=>x.id===id)?.speedLimitMps})),policy,NAVIGATION_SCHEMA_HASH,{engine:{id:'webots_3d',version:'R2025a',basicTimeStepMs:20},world3d:{...WORLD3D}});
}
/** The reviewed JSON files of the serve-3d-v1 fixture (exported to robotics/simulation-3d/fixtures/serve-3d-v1 by scripts/export-sim3d-fixtures.ts). */
export function exportedFixtureFiles3d():Record<string,unknown>{
 const single=navigationFixture('serve-3d'),fleet=navigationFixture('fleet-3d');
 return {'serve-3d-project.json':single.fixture.project,'serve-3d-fleet-project.json':fleet.fixture.project,
  'serve-3d-components.json':{schemaVersion:1,components:Object.assign({},single.fixture.components,fleet.fixture.components),models:Object.assign({},single.fixture.models,fleet.fixture.models)},
  'world3d.json':WORLD3D,'navigation-scene.json':navigationScene3d('serve-3d'),'navigation-scene-two-robot.json':navigationScene3d('fleet-3d'),
  // the physical models the Python compiler reads beside the scene (the bundle holds them as physical-model/<robotId>.json)
  'physical-model-amr-1.json':projectPhysicalModel(single.input,'amr-1',NAVIGATION_SCHEMA_HASH),
  'physical-model-robot01.json':projectPhysicalModel(fleet.input,'robot01',NAVIGATION_SCHEMA_HASH),'physical-model-robot02.json':projectPhysicalModel(fleet.input,'robot02',NAVIGATION_SCHEMA_HASH)};
}
