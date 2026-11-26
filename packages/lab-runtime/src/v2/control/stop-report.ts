// R5 stop report (contracts 6): one report per stop request, built from the durable evidence of the run (intents, receipts, physics, drive stream) and never from the schedule that was asked for.
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import driveIoSchema from '../../../../contracts/schemas/drive-io-v1.schema.json';
import stopSchema from '../../../../contracts/schemas/stop-evidence-v1.schema.json';
import {documentDigest,sealDocument,type PhysicsTickRecord,type StopPolicyV1,type StopReportV1} from '../navigation2d/contracts';
import type {SourceRef} from '../../engineering/contracts';
import type {StopIntentV1,StopReceiptV1,StopScheduleEntryV1} from './drive-io';
import {stopMetrics,type Unavailable} from './stop-metrics';

const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});addFormats(ajv);
for(const [k,s] of Object.entries({'engineering-component.schema.json':componentSchema,'drive-io-v1.schema.json':driveIoSchema,'stop-evidence-v1.schema.json':stopSchema}))ajv.addSchema(s,k);
export const validateStopReport=(v:unknown):{ok:boolean;errors:string[]}=>{const f=ajv.getSchema('stop-evidence-v1.schema.json')!;return f(v)?{ok:true,errors:[]}:{ok:false,errors:(f.errors??[]).map(e=>`${e.instancePath} ${e.message}`)};};
export const stopReportDigest=(r:object)=>documentDigest(r,'digest');

export const STOP_LIMITS=[
 'Every number is an observation in an assumed, not calibrated model; none is the stopping distance, stopping time or safety of a robot.',
 'Rolling resistance, caster friction and brake torque decide these numbers and have not been measured; a coast-down test on the real robot is needed before they are used.',
 'A simulated torque cut does not show that the torque-off circuit of a particular drive meets any safety requirement.'] as const;

export interface StopReportInput{runId:string;entry:StopScheduleEntryV1;intents:readonly {tick:number;intents:readonly StopIntentV1[]}[];receipts:readonly StopReceiptV1[];records:readonly PhysicsTickRecord[];policy:StopPolicyV1;
 chainAxes:readonly string[];wheelRadiusM:number;attention:readonly {tick:number;reason:string}[];served:string;status:string;servedAfterStop:boolean;decidingParameters:{id:string;value:number|string|null;source:SourceRef}[]}
const REASON={normal:'NORMAL_STOP',protective:'PROTECTIVE_STOP',emergency:'EMERGENCY_STOP'} as const;
const unavailableAll=(why:Unavailable['unavailable']):StopReportV1['metrics']=>({stopTimeMs:{unavailable:why},stopDistanceM:{unavailable:why},peakDecelerationMps2:{unavailable:why},torqueZeroTick:{unavailable:why},cupMaxSlipMm:{unavailable:why},cupTipped:{unavailable:why},postStopDriftMm:{unavailable:why},wheelSlip:{unavailable:why}});

export function buildStopReport(i:StopReportInput):StopReportV1{
 const fn=i.entry.function,intent=i.intents.flatMap(x=>x.intents).find(x=>x.entryId===i.entry.id)??null,receipt=i.receipts.find(r=>r.entryId===i.entry.id)??null;
 const fired=receipt!==null,applied=receipt?.appliedTick??null;
 const after=applied===null?[]:i.records.filter(r=>r.tick>=applied);
 const hasDrives=i.records.some(r=>r.drives?.length);
 const axisRow=(r:PhysicsTickRecord,a:string)=>r.drives?.find(d=>d.axisId===a);
 const finalRec=[...i.records].reverse().find(r=>r.drives?.length),drives=finalRec?.drives?.map(d=>({axisId:d.axisId,state:d.state,fault:d.fault}))??[];
 const inv=(id:StopReportV1['invariants'][number]['id'],result:StopReportV1['invariants'][number]['result'],detail:string)=>({id,result,detail});
 // A drive invariant passes only on rows of every chain axis on every tick of the policy's observation window (applied tick .. applied tick + observeTicks);
 // a missing tick or axis row is not_evidenced, never a default value. A violation seen anywhere from the applied tick on wins over a gap. (Pass texts unchanged from stop-v1 so recorded reports still rebuild.)
 const windowEnd=applied===null?null:applied+i.policy.observeTicks,byTick=new Map(i.records.map(r=>[r.tick,r]));
 const gap=(has:(d:NonNullable<ReturnType<typeof axisRow>>)=>boolean):string|null=>{
  for(let t=applied!;t<=windowEnd!;t++){const r=byTick.get(t);if(!r)return `no record on tick ${t} (the observation window runs from tick ${applied} to ${windowEnd})`;
   for(const a of i.chainAxes){const d=axisRow(r,a);if(!d||!has(d))return `no row of ${a} on tick ${t} (the observation window runs from tick ${applied} to ${windowEnd})`;}}
  return null;};
 const torqueOf=(d:{torqueNm?:unknown})=>typeof d.torqueNm==='number',stateOf=(d:{state?:unknown})=>typeof d.state==='string';
 const live=(r:PhysicsTickRecord)=>i.chainAxes.find(a=>['enabled','ready'].includes(axisRow(r,a)?.state??''));
 const invariants:StopReportV1['invariants']=[
  !fired?inv('TORQUE_ZERO_AT_EMERGENCY','not_applicable','the stop did not fire'):fn!=='emergency'?inv('TORQUE_ZERO_AT_EMERGENCY','not_applicable','only an emergency stop cuts torque'):!hasDrives?inv('TORQUE_ZERO_AT_EMERGENCY','not_evidenced','the run has no drive stream')
   :(()=>{const bad=after.find(r=>i.chainAxes.some(a=>{const d=axisRow(r,a);return d!==undefined&&torqueOf(d)&&d.torqueNm!==0;}));if(bad)return inv('TORQUE_ZERO_AT_EMERGENCY','violated',`torque is not zero on tick ${bad.tick}`);
     const g=gap(torqueOf);return g?inv('TORQUE_ZERO_AT_EMERGENCY','not_evidenced',g):inv('TORQUE_ZERO_AT_EMERGENCY','pass',`zero torque on every chain axis from tick ${applied} to the end of the evidence (${after.length} ticks)`);})(),
  !fired?inv('NO_MOTION_ACCEPTED_AFTER_STOP','not_applicable','the stop did not fire'):fn==='normal'?inv('NO_MOTION_ACCEPTED_AFTER_STOP','not_applicable','a normal stop keeps the drive enabled'):!hasDrives?inv('NO_MOTION_ACCEPTED_AFTER_STOP','not_evidenced','the run has no drive stream')
   :(()=>{const bad=after.find(r=>live(r));if(bad)return inv('NO_MOTION_ACCEPTED_AFTER_STOP','violated',`an axis is ${axisRow(bad,live(bad)!)!.state} on tick ${bad.tick}`);
     const g=gap(stateOf);return g?inv('NO_MOTION_ACCEPTED_AFTER_STOP','not_evidenced',g):inv('NO_MOTION_ACCEPTED_AFTER_STOP','pass','no axis of the chain was enabled again after the stop');})(),
  !fired?inv('NO_AUTO_RESTART','not_applicable','the stop did not fire'):fn==='normal'?inv('NO_AUTO_RESTART','not_applicable','a normal stop is not latched')
   :(()=>{const att=i.attention.find(a=>a.reason===REASON[fn]);if(!att)return inv('NO_AUTO_RESTART','violated',`the run did not reach needs_attention with ${REASON[fn]}`);
     if(!hasDrives)return inv('NO_AUTO_RESTART','not_evidenced','the run has no drive stream');
     const back=after.find(r=>live(r));if(back)return inv('NO_AUTO_RESTART','violated',`a drive of the chain left its stop by itself on tick ${back.tick}`);
     const g=gap(stateOf);return g?inv('NO_AUTO_RESTART','not_evidenced',g):inv('NO_AUTO_RESTART','pass',`needs_attention with ${REASON[fn]} at tick ${att.tick}; the chain stayed latched to the end`);})(),
  intent===null?inv('RECEIPT_MATCHES_INTENT',fired?'violated':'not_applicable',fired?'a receipt exists without a durable intent':'the stop was never due in this run'):!fired?inv('RECEIPT_MATCHES_INTENT','violated',`intent for tick ${intent.targetTick} has no receipt`)
   :receipt.function===intent.function&&receipt.appliedBy===intent.appliedBy&&receipt.appliedTick===intent.targetTick?inv('RECEIPT_MATCHES_INTENT','pass',`one receipt for tick ${receipt.appliedTick}, applied by the ${receipt.appliedBy}`):inv('RECEIPT_MATCHES_INTENT','violated','the receipt differs from the intent'),
  !fired?inv('NO_FALSE_SERVE','not_applicable','the stop did not fire'):i.servedAfterStop?inv('NO_FALSE_SERVE','violated','the mission was recorded as served after the stop'):inv('NO_FALSE_SERVE','pass',`served ${i.served}, status ${i.status}; nothing was served after the stop`)];
 const metrics=fired?stopMetrics({appliedTick:applied!,function:fn,records:i.records,policy:i.policy,chainAxes:i.chainAxes,wheelRadiusM:i.wheelRadiusM}):unavailableAll('RUN_ENDED');
 return sealDocument({schemaVersion:1,documentType:'stop-report',accepted:false,calibration:'not_calibrated',digest:'',runId:i.runId,function:fn,entryId:i.entry.id,verdict:fired?'fired':'not_fired',appliedTick:applied,receipt,metrics,drives,invariants,
  decidingParameters:i.decidingParameters.map(p=>({...p})),limits:[...STOP_LIMITS]} as StopReportV1,'digest');
}
