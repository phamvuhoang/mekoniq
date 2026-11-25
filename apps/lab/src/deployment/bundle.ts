import type {LabProject,RestaurantWorld,RobotDesign} from '../shared/types';
import {validateProject} from '../project/schema';
import {catalogProvenance,footprintForDesign} from '../design/catalog';
import {deploymentReadiness,type ReadinessItem} from './readiness';

export interface EvidenceReference {id:string;mode:string;hash:string;sourceCommit:string|null;trust:'unverified';}
export interface ProfileCandidate {
  id:string;revision:number;validation:'simulated';provenance:'illustrative';
  chassis:'service'|'valetudo';footprint:{widthM:number;lengthM:number}|null;
  payloadIntentKg:number;measuredPayloadLimitKg:null;nativeCapabilitiesVerified:false;
}
export interface DeploymentPayload {
  design:RobotDesign;profileCandidate:ProfileCandidate;
  venueLayout:{tables:{id:string;name:string}[];stations:{id:string;name:string;kind:string}[]};
  world:RestaurantWorld;bindingDrafts:never[];evidenceRefs:EvidenceReference[];
}
export interface DeploymentBundle {
  schemaVersion:1;id:string;projectId:string;projectRevision:number;createdAt:string;status:'draft';
  hashes:{design:string;world:string;candidate:string};
  payload:DeploymentPayload;readiness:ReadinessItem[];files:Record<string,string>;
}
const modes=new Set(['preview','business_sim','protocol_sim','gazebo_sil','shadow','hardware_test','replay']);
const allowedPayload=new Set(['design','profileCandidate','venueLayout','world','bindingDrafts','evidenceRefs']);
const forbiddenKeys=new Set(['missions','missionqueue','queue','credentials','password','privatekey','secret','token','accesstoken','refreshtoken','grants','controlepoch','robotip','endpoint','receipts','paymentreceipts']);
const credentialKeys=new Set(['credentials','password','privatekey','secret','token','accesstoken','refreshtoken']);
function guardJson(value:unknown,depth=0,reportContext=false):void {
  if (depth>40) throw new Error('BUNDLE_TOO_DEEP');
  if (typeof value==='number'&&!Number.isFinite(value)) throw new Error('NONFINITE_BUNDLE_INPUT');
  if (value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint') throw new Error('NON_JSON_BUNDLE_INPUT');
  if (!value||typeof value!=='object') return;
  if (Array.isArray(value)) {if (value.length>(reportContext ? 100000 : 1000)) throw new Error('BUNDLE_OBJECT_LIMIT');for (const item of value) guardJson(item,depth+1,reportContext);return;}
  for (const [key,item] of Object.entries(value)) {
    const normalized=key.toLowerCase().replace(/[_-]/g,'');
    if ((reportContext ? credentialKeys : forbiddenKeys).has(normalized)) throw new Error('FORBIDDEN_DEPLOYMENT_FIELD');
    if (key==='validation'&&item!=='simulated'&&item!=='integration_tested') throw new Error('UNTRUSTED_VALIDATION_CLAIM');
    guardJson(item,depth+1,reportContext);
  }
}
/** Canonical JSON keeps hashes independent of object insertion order. Arrays preserve their order. */
export function canonicalJson(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function contentHash(value:unknown):Promise<string> {
  const bytes=new TextEncoder().encode(typeof value==='string' ? value : canonicalJson(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function documents(bundle:Omit<DeploymentBundle,'files'>):Record<string,string> {
  const payload=bundle.payload;
  return {
    'deployment.json':canonicalJson({schemaVersion:bundle.schemaVersion,id:bundle.id,projectId:bundle.projectId,projectRevision:bundle.projectRevision,createdAt:bundle.createdAt,status:'draft',hashes:bundle.hashes,sourceCommit:null,sourceCompatibility:'unverified',catalog:catalogProvenance,readiness:bundle.readiness}),
    'robot-design.json':canonicalJson(payload.design),
    'robot-profile.json':canonicalJson(payload.profileCandidate),
    'venue-layout.json':canonicalJson(payload.venueLayout),
    'world.json':canonicalJson({frame:'world',units:{length:'m',angle:'rad'},...payload.world}),
    'bindings.json':canonicalJson(payload.bindingDrafts),
    'evidence-index.json':canonicalJson(payload.evidenceRefs)
  };
}
async function withChecksums(files:Record<string,string>):Promise<Record<string,string>> {
  const entries=await Promise.all(Object.entries(files).map(async ([name,body])=>[name,await contentHash(body)] as const));
  return {...files,'checksums.json':canonicalJson(Object.fromEntries(entries))};
}
/** Exporting a draft never grants a robot capability or changes source validation. */
export async function buildBundle(project:LabProject,reports:readonly unknown[]=[]):Promise<DeploymentBundle> {
  const checked=validateProject(project);
  guardJson(reports,0,true);
  const evidenceRefs:EvidenceReference[]=[];
  for (const value of reports) {
    if (!value||typeof value!=='object'||Array.isArray(value)) throw new Error('INVALID_REPORT_REFERENCE');
    const report=value as Record<string,unknown>;
    const snapshot=report.snapshot;
    if (snapshot!==undefined&&(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))) throw new Error('INVALID_REPORT_REFERENCE');
    const run=snapshot as Record<string,unknown>|undefined;
    const id=run ? run.id : report.id;
    if (typeof id!=='string'||!id||id.length>200||/[\u0000-\u001f]/.test(id)||typeof report.mode!=='string'||!modes.has(report.mode)) throw new Error('INVALID_REPORT_REFERENCE');
    if (run?.mode!==undefined&&run.mode!==report.mode) throw new Error('REPORT_MODE_MISMATCH');
    if (report.id!==undefined&&report.id!==id) throw new Error('REPORT_ID_MISMATCH');
    if (report.sourceCommit!==undefined&&(typeof report.sourceCommit!=='string'||!report.sourceCommit||report.sourceCommit.length>200||/[\u0000-\u001f]/.test(report.sourceCommit))) throw new Error('INVALID_REPORT_REFERENCE');
    if (run?.sourceCommit!==undefined&&run.sourceCommit!==report.sourceCommit) throw new Error('REPORT_SOURCE_MISMATCH');
    evidenceRefs.push({id,mode:report.mode,hash:await contentHash(value),sourceCommit:typeof report.sourceCommit==='string' ? report.sourceCommit : null,trust:'unverified'});
  }
  const payload:DeploymentPayload={
    design:checked.design,
    profileCandidate:{id:`${checked.design.id}-candidate`,revision:checked.design.revision,validation:'simulated',provenance:'illustrative',chassis:checked.design.chassis,footprint:footprintForDesign(checked.design),payloadIntentKg:checked.design.payloadKg,measuredPayloadLimitKg:null,nativeCapabilitiesVerified:false},
    venueLayout:{tables:checked.world.points.filter(p=>p.kind==='table').map(({id,name})=>({id,name})),stations:checked.world.points.filter(p=>p.kind!=='table').map(({id,name,kind})=>({id,name,kind}))},
    world:checked.world,bindingDrafts:[],evidenceRefs
  };
  guardJson(payload);
  const hashes={design:await contentHash(payload.design),world:await contentHash(payload.world),candidate:await contentHash(payload)};
  const header:Omit<DeploymentBundle,'files'>={schemaVersion:1,id:`${checked.id}-r${checked.revision}`,projectId:checked.id,projectRevision:checked.revision,createdAt:new Date().toISOString(),status:'draft',hashes,payload,readiness:deploymentReadiness(checked,evidenceRefs.length)};
  return {...header,files:await withChecksums(documents(header))};
}
export async function validateBundle(bundle:DeploymentBundle):Promise<{ok:boolean;reasons:string[]}> {
  const reasons:string[]=[];
  try {
    guardJson(bundle);
    if (bundle.schemaVersion!==1||bundle.status!=='draft'||!bundle.payload||Object.keys(bundle.payload).some(key=>!allowedPayload.has(key))) reasons.push('UNSUPPORTED_DEPLOYMENT_FIELDS');
    if (bundle.payload.profileCandidate.validation!=='simulated'||bundle.payload.profileCandidate.nativeCapabilitiesVerified!==false||bundle.payload.profileCandidate.measuredPayloadLimitKg!==null) reasons.push('UNTRUSTED_VALIDATION_CLAIM');
    if (bundle.hashes.design!==await contentHash(bundle.payload.design)||bundle.hashes.world!==await contentHash(bundle.payload.world)||bundle.hashes.candidate!==await contentHash(bundle.payload)) reasons.push('CHECKSUM_MISMATCH');
    const expected=await withChecksums(documents(bundle));
    if (canonicalJson(bundle.files)!==canonicalJson(expected)) reasons.push('FILE_CHECKSUM_MISMATCH');
    if (bundle.readiness.find(item=>item.id==='hardware')?.status!=='blocked_external') reasons.push('HARDWARE_READINESS_UNPROVEN');
  } catch(error) {reasons.push(error instanceof Error ? error.message : 'INVALID_BUNDLE');}
  return {ok:reasons.length===0,reasons:[...new Set(reasons)]};
}
