// Validate one captured prefix when it arrives. Drawing a frame only reads the admitted copy.
import Ajv from 'ajv';
import componentSchema from '../shared/engineering-schemas/engineering-component.schema.json';
import profileSchema from '../shared/engineering-schemas/perception-profile-v1.schema.json';
import evidenceSchema from '../shared/engineering-schemas/belief-evidence-v1.schema.json';
import type {BeliefObject,BeliefRecord} from '../shared/navigation2d';
import type {PerceptionEvidenceView} from '../reports/perception';
import type {ReplayManifest} from '../reports/replay-package';
import {canonicalJson,hashJson,sha256Hex} from './hash';
import {composePose,type Pose} from './frames';
const ajv=new Ajv({strict:false});
ajv.addSchema(componentSchema,'engineering-component.schema.json');
ajv.addSchema(evidenceSchema,'belief-evidence-v1.schema.json');
const validProfile=ajv.compile(profileSchema),validRecord=ajv.getSchema('belief-evidence-v1.schema.json#/definitions/BeliefRecord')!;
interface CursorPolicy {lastTick:number;maxAgeTicks:number}
interface Loaded extends CursorPolicy {runId:string;objects:Map<string,BeliefRecord[]>}
const admitted=new WeakMap<object,Loaded>();
interface DisplayReport {
 manifest:{runId:string;perception?:{profile?:{id:string;revision:number;digest:string;sha256:string}}};
 outcome:{tick:number};perceptionEvidence?:PerceptionEvidenceView;
 arm?:{worldTrace?:{publicCommittedTick:number;firstTick:number;lastTick:number;samples:number;prefixCovered:boolean;reasonCodes:string[];publication?:{terminal:unknown;gaps:unknown[];writeIntent:boolean;uncommittedTicks:number}}};
}
export function admitBeliefReport(input:unknown,replay?:Readonly<ReplayManifest>):void{
 if(!input||typeof input!=='object')return;
 admitted.delete(input);
 try{
  const r=input as DisplayReport,e=r.perceptionEvidence,p=e?.policy,c=e?.coverage,w=r.arm?.worldTrace,ref=r.manifest?.perception?.profile;
  if(e?.schemaVersion!==1||!Array.isArray(e.issues)||e.issues.length||!Array.isArray(e.beliefs)||p?.ageBasis!=='publishedTick'||!ref||typeof p.profileBytes!=='string'||!validProfile(p.profile))return;
  const h=r.outcome.tick;
  if(typeof r.manifest.runId!=='string'||!r.manifest.runId||!Number.isSafeInteger(h)||h<0||c?.scope!=='belief_evaluations'||c.firstTick!==0||c.lastTick!==h||c.prefixCovered!==true||typeof c.streamFinalized!=='boolean'||c.streamFinalized!==e.complete||
   w?.prefixCovered!==true||w.firstTick!==0||w.publicCommittedTick!==h||w.lastTick!==h||w.samples!==h+1||!Array.isArray(w.reasonCodes)||w.reasonCodes.length)return;
  if(w.publication&&(w.publication.terminal!==null||w.publication.gaps.length||w.publication.writeIntent!==false||w.publication.uncommittedTicks!==0))return;
  if(replay&&(replay.runId!==r.manifest.runId||replay.horizon.tick!==h||!replay.coverage.prefixCovered||replay.coverage.terminal!==null||replay.coverage.gaps.length||replay.coverage.issues.length||
   !replay.streams.some(s=>s.kind==='world'&&s.firstTick===0&&s.lastTick===h&&s.samples===h+1)))return;
  const profile=p.profile,{digest,...definition}=profile;
  if(ref.id!==profile.id||ref.revision!==profile.revision||ref.digest!==digest||hashJson(definition)!==digest||canonicalJson(JSON.parse(p.profileBytes))!==canonicalJson(profile)||
   p.profileSha256!==ref.sha256||sha256Hex(new TextEncoder().encode(p.profileBytes))!==ref.sha256)return;
  const source=profile.biasM.every(n=>n===0)&&profile.sigmaM.every(n=>n===0)&&!profile.latencyTicks&&!profile.dropoutProbability?'ground_truth':'pose_estimator_sim';
  const objects=new Map<string,BeliefRecord[]>();
  for(const row of e.beliefs){
   if(!validRecord(row)||row.tick>h||!row.truthAtObservedTick.every(Number.isFinite))return;
   const rows=objects.get(row.objectId)??[],b=row.belief;
   if(row.tick<=(rows.at(-1)?.tick??-1)||row.tick%profile.updateEveryTicks!==0)return;
   if(b&&(row.dropped||b.objectId!==row.objectId||b.frameId!=='arm-base'||b.observedTick!==row.tick-profile.latencyTicks||b.publishedTick!==row.tick||b.ageTicks!==0||b.source!==source||
    !b.positionM.every(Number.isFinite)||b.sigmaM[0]!==profile.sigmaM[0]||b.sigmaM[1]!==profile.sigmaM[1]||b.sigmaM[2]!==0))return;
   rows.push(structuredClone(row));objects.set(row.objectId,rows);
  }
  admitted.set(input,{runId:r.manifest.runId,lastTick:h,maxAgeTicks:profile.maxAgeTicks,objects});
 }catch{/* Malformed imported metadata has no displayable prefix. */}
}
export type BeliefAt={available:false;reason:string}|{available:true;belief:BeliefObject;truthM:[number,number,number];errorM:number|null};
const unavailable=()=>({available:false,reason:'NO_BELIEF_DATA'} as const);
export function beliefAt(records:readonly BeliefRecord[],tick:number,policy?:CursorPolicy):BeliefAt{
 if(!policy||!Number.isSafeInteger(tick)||tick<0||tick>policy.lastTick)return unavailable();
 for(let i=records.length-1;i>=0;i--){
  const r=records[i]!;if(r.tick>tick)continue;
  const b=r.belief;
  if(b)return b.valid&&b.objectId===r.objectId&&b.publishedTick===r.tick&&b.observedTick<=b.publishedTick&&b.positionM.length===3&&b.positionM.every(Number.isFinite)&&tick-r.tick<=policy.maxAgeTicks?
   {available:true,belief:{...b,ageTicks:tick-r.tick},truthM:r.truthAtObservedTick as [number,number,number],errorM:r.errorM}:unavailable();
  if(!r.dropped||r.reason!=='DROPOUT')return {available:false,reason:r.reason??'NO_BELIEF_DATA'};
 }
 return unavailable();
}
export interface Ghost {objectId:string;beliefMapM:[number,number,number];truthMapM:[number,number,number];errorMm:number|null}
export type Ghosts={status:'none'}|{status:'no_data_at_cursor'}|{status:'data';items:Ghost[]};
const id=[0,0,0,1];
export function ghostsAt(f:{view:{tick:number;run?:{id:string}}|null;report:unknown;beliefReport?:unknown},base:{position:readonly number[];quaternionXyzw:readonly number[]}|undefined):Ghosts{
 const report=(f.beliefReport??f.report) as DisplayReport|null;
 if(!report||!base||!f.view)return {status:'none'};
 const loaded=admitted.get(report),items:Ghost[]=[];
 if(!loaded)return report.perceptionEvidence?.beliefs?.length?{status:'no_data_at_cursor'}:{status:'none'};
 if(!loaded.objects.size)return {status:'none'};
 if(f.view.run&&f.view.run.id!==loaded.runId)return {status:'no_data_at_cursor'};
 const toMap=(v:number[])=>composePose(base as Pose,{position:v,quaternionXyzw:id}).position as [number,number,number];
 for(const [objectId,records] of loaded.objects){
  const b=beliefAt(records,f.view.tick,loaded);
  if(b.available)items.push({objectId,beliefMapM:toMap(b.belief.positionM),truthMapM:toMap(b.truthM),errorMm:b.errorM===null?null:b.errorM*1000});
 }
 return items.length?{status:'data',items}:{status:'no_data_at_cursor'};
}
