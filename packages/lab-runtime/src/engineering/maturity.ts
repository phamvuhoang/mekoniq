// R4-D48 / contracts §8: how far a model can be trusted is a PURE function of where its parameters came from, per group; there is no field to type a level into. "Qualified" is not a level of a parameter
// (it is the state of a qualification record) and is shown on its own axis. A level is never a safety statement.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {SourceRef} from '../../../contracts/generated/engineering';
import type {CalibrationRecordV1} from './calibration-record';
export type ParameterMaturity='illustrative'|'assumed'|'nominal'|'calibrated';
/** What health lists: per plant provider (`mujoco_arm`, `mujoco_3d`) the maturity of each group. Computed from the plant's fixtures, never typed. */
export type ModelMaturityByPlant=Record<string,Record<MaturityGroup,ParameterMaturity>>;
export const MATURITY_GROUPS=['geometry','inertia','drive','contact','sensing'] as const;
export type MaturityGroup=typeof MATURITY_GROUPS[number];
const RANK:Record<ParameterMaturity,number>={illustrative:0,assumed:1,nominal:2,calibrated:3};

/** A record lifts a derived parameter only if it came from MEASURED data (not the tool self-test), passed on the held-out split, produced a revision, is about the dataset the parameter cites and is still valid for the configuration. */
const lifts=(r:CalibrationRecordV1,source:SourceRef,currentConfigDigest:string)=>r.sourceKind==='measured'&&!r.toolSelfTest&&r.validation.status==='pass'&&r.produced.length>0&&r.datasetDigest===source.contentSha256&&r.configDigest===currentConfigDigest;
const sourceMaturity=(s:SourceRef,records:readonly CalibrationRecordV1[],currentConfigDigest:string):ParameterMaturity=>
 s.kind==='measured'?'calibrated':s.kind==='manufacturer'?'nominal':s.kind==='derived'&&records.some(r=>lifts(r,s,currentConfigDigest))?'calibrated':'assumed';
export function groupMaturity(sources:readonly SourceRef[],records:readonly CalibrationRecordV1[],currentConfigDigest:string):ParameterMaturity{
 if(!sources.length)return 'assumed';
 return sources.map(s=>sourceMaturity(s,records,currentConfigDigest)).reduce((a,b)=>RANK[b]<RANK[a]?b:a);
}
export function modelMaturity(input:{mock:boolean;groups:Record<MaturityGroup,readonly SourceRef[]>;records:readonly CalibrationRecordV1[];currentConfigDigest:string}):Record<MaturityGroup,ParameterMaturity>{
 return Object.fromEntries(MATURITY_GROUPS.map(g=>[g,input.mock?'illustrative':groupMaturity(input.groups[g],input.records,input.currentConfigDigest)])) as Record<MaturityGroup,ParameterMaturity>;
}

// ---- the sources behind the groups of the MuJoCo plants, read from the fixtures the runtime serves -------------------------------------------------------------------
const assumedRef=(documentId:string,locator:string,bytes:Buffer):SourceRef=>({kind:'assumed',documentId,revision:'1',locator,contentSha256:createHash('sha256').update(bytes).digest('hex')});
const refsOf=(node:unknown,out:SourceRef[]=[]):SourceRef[]=>{
 if(Array.isArray(node))node.forEach(n=>refsOf(n,out));
 else if(node&&typeof node==='object'){const o=node as Record<string,unknown>;if(typeof o.kind==='string'&&typeof o.documentId==='string'&&typeof o.contentSha256==='string')out.push(o as unknown as SourceRef);else Object.values(o).forEach(v=>refsOf(v,out));}
 return out;
};
/** The groups of the xArm 6 cell plant (`arm`) or of the AMR plant (`mobile`), from the sources their files declare: the component's own SourceRefs (the manufacturer's URDF) for links, inertia and joint limits; the physics
 * profile for the rotor inertia, joint dynamics, contact and the capsule proxies (assumed unless a revision carries a derived source for the path); the drive model for the drive group; nothing measured for sensing.
 * A file that cannot be read gives an assumed source: an unknown origin is not a better one. */
export async function mujocoPlantSources(workerRoot:string,plant:'arm'|'mobile'):Promise<Record<MaturityGroup,SourceRef[]>>{
 const read=(p:string)=>readFile(join(workerRoot,p)).catch(()=>Buffer.from(''));
 const unknown=(id:string)=>assumedRef(id,'unreadable',Buffer.from(''));
 const json=(b:Buffer)=>{try{return JSON.parse(b.toString()) as Record<string,unknown>;}catch{return null;}};
 const driveFile=plant==='arm'?'fixtures/drive-v1/xarm6-drive-nominal-v1.json':'fixtures/drive-v1/serve-drive-nominal-v1.json',driveBytes=await read(driveFile),drive=json(driveBytes);
 const driveSources=drive?refsOf((drive as {sources?:unknown}).sources):[];
 const out:Record<MaturityGroup,SourceRef[]>={geometry:[],inertia:[],drive:driveSources.length?driveSources:[unknown(driveFile)],contact:[],sensing:[]};
 if(plant==='arm'){
  const compBytes=await read('fixtures/xarm6-g2-v1/component.json'),physBytes=await read('fixtures/xarm6-g2-v1/physics.json'),component=json(compBytes),physics=json(physBytes) as {calibrationSources?:Record<string,SourceRef>}|null;
  const links=(component?.links as Record<string,unknown>[]|undefined)??[];
  for(const l of links){const x=l as {collision?:unknown;visual?:unknown;massKg?:unknown;inertiaKgM2?:unknown;comM?:unknown;inertialSource?:unknown};out.geometry.push(...refsOf([x.collision,x.visual]));out.inertia.push(...refsOf([x.massKg,x.inertiaKgM2,x.comM,x.inertialSource]));}
  out.geometry.push(...refsOf(component?.joints));
  if(!out.geometry.length)out.geometry.push(unknown('xarm6-g2-v1/component.json'));if(!out.inertia.length)out.inertia.push(unknown('xarm6-g2-v1/component.json'));
  // what the engine adds on top of the manufacturer's numbers is assumed: rotor inertia and joint dynamics (a revision may carry a derived source per path), contact, and the capsule proxies of the collision model
  const dynamic=['armatureKgM2[0]','armatureKgM2[1]','armatureKgM2[2]','armatureKgM2[3]','armatureKgM2[4]','armatureKgM2[5]','jointDynamics.damping','jointDynamics.frictionloss'];
  for(const path of dynamic)out.inertia.push(physics?.calibrationSources?.[path]??assumedRef('xarm6-g2-v1/physics.json',path,physBytes));
  out.contact.push(assumedRef('xarm6-g2-v1/physics.json','contact',physBytes));out.geometry.push(assumedRef('xarm6-g2-v1/physics.json','capsuleRadiusM',physBytes));
  out.sensing.push(assumedRef(driveFile,'encoder',driveBytes));
 }else{
  const sceneBytes=await read('fixtures/serve-payload-v1/navigation-scene.json');
  for(const g of ['geometry','inertia','contact','sensing'] as const)out[g].push(assumedRef('serve-payload-v1/navigation-scene.json',g,sceneBytes));
 }
 return out;
}
