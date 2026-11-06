// SIM-08 evidence records (LabEvidenceV2) from one run: a business record evaluated on the journal-backed report in every mode, a physics
// record that is not_run unless a real SIL worker measured it, and an arm-closed-loop record that is not_run while the coupling is
// open-loop. Modelled quantities never pass as measured; every cup movement must trace to a command, journal event or evidence id.
import {armVerificationEvidence} from './verification';
import type {JsonObject} from '../../../../contracts/src/index';
import type {LabEvidenceV2} from '../contracts';
import {hashJson} from '../hash';
import type {RunReport} from '../report';
import {scenarioMatrix,type MatrixRow} from '../scenario-matrix';
import type {SilAssertion,SilRunManifest} from '../sil/campaign';
export type EvidenceSource={kind:'mock'|'native';report:RunReport}|{kind:'sil';manifest:SilRunManifest;assertions:SilAssertion[]};
export interface BuildOptions {schemaHash:string;matrixId:string;source:EvidenceSource}
type Check={passed:boolean;detail:string};
const SIGNER={id:'lab-runtime',trust:'local_unsigned'} as const;
const PHYSICS_SIL=new Set(['SIM.no-contact','SIM.min-separation']);
/** Which mock coverage flag each physics measurement would need; all are false in mock, so the row is not_run with the flag named. */
const COVERAGE_OF:Record<string,string>={contacts:'dynamics',minSeparationM:'dynamics','physical-stop':'physicalStop','sensor-evidence':'sensorEvidence','sampled-trajectory':'nativeExecution','milk-level':'fluidModel','grip':'physicalGrip'};
const types=(r:RunReport)=>r.businessEvents.map(e=>e.type),count=(t:string[],x:string)=>t.filter(y=>y===x).length;
const observedCompleted=(r:RunReport)=>r.businessEvents.filter(e=>e.type==='RobotCommandObserved'&&e.state.status==='completed').length;
const steps=(j:JsonObject)=>Array.isArray(j.steps)?j.steps as JsonObject[]:[];
const traced=(m:{provenance:string;evidence?:JsonObject;transferId:string;observedBy:string})=>!!m.transferId&&!!m.observedBy&&(m.provenance!=='sensor'||typeof m.evidence?.commandId==='string'||typeof (m.evidence?.giver as JsonObject|undefined)?.commandId==='string');
const INVARIANTS:Record<string,(r:RunReport)=>Check>={
 'served-after-handoff':r=>{const t=types(r),loaded=t.indexOf('CargoLoaded'),handed=t.indexOf('DeliveryHandedOff'),served=Number(r.outcome.served);return {passed:served>0&&loaded>=0&&loaded<handed,detail:`served ${r.outcome.served}; CargoLoaded at ${loaded}, DeliveryHandedOff at ${handed}, ${count(t,'DeliveryHandedOff')} handoffs`};},
 'arrival-from-observation':r=>{const a=count(types(r),'MissionArrived'),o=observedCompleted(r);return {passed:a===o,detail:`${a} arrivals from ${o} observed completions`};},
 'no-false-arrival':r=>{const t=types(r),a=count(t,'MissionArrived'),g=count(t,'RobotGoalCompleted');return {passed:a===g&&a<=observedCompleted(r),detail:`${a} arrivals, ${g} completed goals`};},
 'parked-not-charging':r=>{const last=[...r.businessEvents].reverse().find(e=>e.type==='MissionCreated'),stops=Array.isArray(last?.state.stops)?last!.state.stops as JsonObject[]:[];const ok=r.outcome.status==='completed'&&stops.length>0&&stops.every(s=>s.action==='standby'&&!/charg|dock/i.test(String(s.targetId)));return {passed:ok,detail:ok?`last mission: standby at ${stops.map(s=>s.targetId).join(',')}`:`outcome ${r.outcome.status}; last mission stops ${stops.map(s=>s.action).join(',')||'none'}`};},
 'cup-ownership-traceable':r=>{const bad=(r.coffee?.cups??[]).filter(c=>!c.movements.length||c.movements.some(m=>!traced(m))).map(c=>c.cupId);return {passed:!bad.length&&!!r.coffee,detail:bad.length?`untraceable movement on ${bad.join(',')}`:`${(r.coffee?.cups??[]).reduce((n,c)=>n+c.movements.length,0)} movements, each with transfer id, observer and command/evidence`};},
 'recipe-steps-in-order':r=>{const bad=(r.coffee?.jobs??[]).filter(j=>{const s=steps(j),done=s.map(x=>x.status==='completed');return !s.length||done.some((d,i)=>d&&done.slice(0,i).includes(false))||s.some(x=>x.status==='completed'&&!(typeof x.commandId==='string'&&typeof x.observedBy==='string'));}).map(j=>String(j.jobId));return {passed:!bad.length&&!!r.coffee,detail:bad.length?`out of order or untraced steps on ${bad.join(',')}`:'completed steps form a prefix, each with command id and observer'};},
 'no-measured-provenance-from-model':r=>{const bad=(r.coffee?.jobs??[]).filter(j=>steps(j).some(s=>(s.measured as JsonObject|null)?.provenance==='measured')).map(j=>String(j.jobId));return {passed:!bad.length,detail:bad.length?`model output claims measured provenance on ${bad.join(',')}`:'every quantity carries modelled/illustrative provenance'};},
 'espresso-without-ice-or-milk':r=>{const bad=(r.coffee?.jobs??[]).filter(j=>j.recipeId==='espresso'&&steps(j).some(s=>['add_ice','add_milk','dispense_ice','dispense_milk'].includes(String(s.kind)))).map(j=>String(j.jobId));return {passed:!bad.length,detail:bad.length?`espresso job ${bad.join(',')} ran ice or milk`:'espresso jobs ran brew only'};},
};
const result=(checks:readonly {passed:boolean}[],notRun:boolean):LabEvidenceV2['result']=>notRun?'not_run':checks.every(c=>c.passed)?'pass':'fail';
export function buildSimulationEvidence(o:BuildOptions):{records:LabEvidenceV2[];issues:string[]}{
 const row=scenarioMatrix.find(r=>r.id===o.matrixId);
 if(!row)return {records:[],issues:[`MATRIX_ID_UNKNOWN:${o.matrixId}`]};
 const s=o.source,scenarioId=s.kind!=='sil'?s.report.manifest.scenario.id:s.manifest.scenario.id;
 if(row.runnerScenarios.length&&!row.runnerScenarios.includes(scenarioId))return {records:[],issues:[`SCENARIO_NOT_IN_ROW:${scenarioId}`]};
 const base=(m:{runId:string;project:{hash:string};sourceCommit:string;seed:number;mode:'mock'|'simulation';access:'simulated';backends:string[]})=>({schemaVersion:2 as const,requirementIds:row.requirementIds,scenarioId,runId:m.runId,
  inputsManifest:{projectHash:m.project.hash,sourceCommit:m.sourceCommit,schemaHash:o.schemaHash,seed:m.seed,mode:m.mode,access:m.access,backends:m.backends},signer:SIGNER});
 const record=(common:ReturnType<typeof base>,name:string,r:Omit<LabEvidenceV2,keyof ReturnType<typeof base>|'id'>):LabEvidenceV2=>({...common,id:`${row.id}:${common.runId}:${name}`,...r});
 if(s.kind!=='sil'){
  const r=s.report,common=base({...r.manifest,backends:r.manifest.backends.map(b=>b.id)}),artifacts=[{name:'report.json',sha256:hashJson(r as unknown as JsonObject)}];
  const business=row.invariants.map(id=>({id,...(INVARIANTS[id]??(()=>({passed:false,detail:`EVALUATOR_MISSING:${id}`})))(r)}));
  if(s.kind==='native'){const verification=r.verification,records=[record(common,'business',{result:result(business,false),assertions:business,artifacts,actualFidelity:'modeled'}),armVerificationEvidence(r,o.schemaHash)];records.push(record(common,'native-provider-coverage',{result:verification?.result??'not_run',assertions:[{id:'native-provider-coverage',passed:verification?.result==='pass',detail:verification?.blockers.join(',')??'NATIVE_EVIDENCE_MISSING'}],artifacts,actualFidelity:'modeled'}));return {records,issues:[]};}
  const physics=row.measurements.map(id=>{const key=COVERAGE_OF[id]??'sensorEvidence';return {id,passed:false,detail:`UNSUPPORTED_FIDELITY: mock ${r.manifest.backends.map(b=>b.model).join('/')}; coverage.${key}=${String(r.coverage[key]??false)}`};});
  const records=[record(common,'business',{result:result(business,false),assertions:business,artifacts,actualFidelity:'modeled'}),
   record(common,'physics',{result:'not_run',assertions:physics,artifacts,actualFidelity:'modeled'})];
  if(r.coffee)records.push(record(common,'arm-closed-loop',{result:'not_run',assertions:[{id:'closed-loop-controller',passed:false,detail:'coupling open_loop_visualization: mock_arm commanded joints, no controller feedback (armTorque/physicalGrip false)'}],artifacts,actualFidelity:'modeled'}));
  if(r.verification)records.push(armVerificationEvidence(r,o.schemaHash));
  return {records,issues:[]};
 }
 const m=s.manifest,common=base(m),fidelity=m.evidence==='sil'?'physics_sim':'business',artifacts=m.outputs.map(x=>({name:x.path,sha256:x.sha256}));
 const detail=(a:SilAssertion)=>[a.reason,a.detail].filter(Boolean).join(': ')||a.result;
 const business=s.assertions.filter(a=>!PHYSICS_SIL.has(a.id)).map(a=>({id:a.id,passed:a.result==='pass',detail:detail(a)}));
 const physics=s.assertions.filter(a=>PHYSICS_SIL.has(a.id)).map(a=>({id:a.id,passed:a.result==='pass',detail:detail(a)}));
 const physicsNotRun=!physics.length||s.assertions.some(a=>PHYSICS_SIL.has(a.id)&&a.result==='not_run');
 const records=[record(common,'business',{result:result(business,business.some(a=>s.assertions.find(x=>x.id===a.id)?.result==='not_run')),assertions:business,artifacts,actualFidelity:fidelity}),
  record(common,'physics',{result:result(physics,physicsNotRun),assertions:physics,artifacts,actualFidelity:fidelity})];
 if(m.backends.includes('linuxcnc_sim'))records.push(record(common,'arm-closed-loop',{result:'not_run',assertions:[{id:'closed-loop-controller',passed:false,detail:'open_loop_visualization until plan 03 supplies the LinuxCNC controller loop'}],artifacts,actualFidelity:fidelity}));
 return {records,issues:[]};
}
export const matrixRowOf=(id:string):MatrixRow|undefined=>scenarioMatrix.find(r=>r.id===id);
