// CoffeeJob state machine (simulation.md §8 transition table). Pure: one job state + one command (+ facts the handler already checked) -> next job state or a refusal.
// reserved --ObserveCup+interlocks--> cup_verified --StartJob--> started --StartStep--> dispensing --(last step terminal+measurement)--> verifying
// --ConfirmQuality--> ready_for_pickup --RequestTransfer(arm)--> transferring --ConfirmTransfer(tray)+Mission.ConfirmStop(load)--> loaded
// --Mission.ConfirmStop(handoff)--> delivered. dispensing/transferring -> needs_attention (timeout, disconnect, missing measurement, cup lost, arm unknown);
// loaded -> returning (cancel before customer handoff); needs_attention/returning -> quarantined (human reconciliation). Pre-pour cancel -> cancelled.
import type {JsonObject} from '../../../contracts/src/index';
export type JobStatus='reserved'|'cup_verified'|'started'|'dispensing'|'verifying'|'ready_for_pickup'|'transferring'|'loaded'|'delivered'|'needs_attention'|'returning'|'quarantined'|'cancelled';
export type StepStatus='pending'|'running'|'completed'|'failed'|'unknown';
export interface Measured {amount:string;unit:string;provenance:string}
export interface JobStep {id:string;kind:string;status:StepStatus;deviceId:string;commandId:string|null;payloadHash:string|null;controlEpoch:number|null;target:JsonObject|null;measured:Measured|null;consumed:string[];observedBy:string|null;accepted?:boolean;startedAt?:string;timeoutPolicy?:string}
export interface Reservation {ingredientId:string;resourceId:string;stepId:string;baseQuantity:string;status:'reserved'|'consumed'|'released'|'consumption_unknown'}
export interface CoffeeJob {jobId:string;lineId:string;stationId:string;cellId:string;recipeKey:string;recipeId:string;recipeRevision:number;recipeHash:string;cupId:string;cupType:string;
 status:JobStatus;steps:JobStep[];reservations:Reservation[];leases:string[];attentionReason:string|null;disposition:string|null;[k:string]:unknown}
export const FINAL_JOB:readonly JobStatus[]=['delivered','cancelled','quarantined'];
export interface JobCommand {type:string;payload:JsonObject}
/** Facts the module handler verified against other aggregates (devices, cup, measurements) before asking for the transition. */
export interface JobFacts {stepId?:string;commandId?:string;payloadHash?:string;controlEpoch?:number;startedAt?:string;result?:string;measured?:Measured|null;observedBy?:string;reason?:string;disposition?:string;nowMs?:number;timeoutMs?:number;timeoutPolicy?:string}
export interface JobDecision {job?:CoffeeJob;rejectionCode?:string;duplicate?:boolean}
const reject=(rejectionCode:string):JobDecision=>({rejectionCode});
const inFlight=(j:CoffeeJob)=>j.steps.some(s=>s.status==='running'||s.status==='unknown');
const attention=(j:CoffeeJob,reason:string):CoffeeJob=>({...j,status:'needs_attention',attentionReason:j.status==='needs_attention'?j.attentionReason:reason});
export function decideCoffeeJob(current:CoffeeJob,command:JobCommand,facts:JobFacts={}):JobDecision {
 const j:CoffeeJob=structuredClone(current),is=(...s:JobStatus[])=>s.includes(j.status);
 if(FINAL_JOB.includes(j.status))return reject('JOB_FINAL');
 switch(command.type){
  case 'Coffee.ObserveCup':
   // Absence is a physical fact, even before preparation starts. Revoke an unused cup's verification;
   // once preparation has begun, keep the job held for reconciliation rather than silently resume it.
   if(command.payload.present===false)return {job:is('reserved','cup_verified','started')?{...j,status:'reserved'}:attention(j,'CUP_REMOVED')};
   return {job:is('reserved')?{...j,status:'cup_verified'}:j};
  case 'Coffee.StartJob':
   return is('reserved')?reject('CUP_NOT_CONFIRMED'):is('cup_verified')?{job:{...j,status:'started'}}:reject('JOB_STATE_CONFLICT');
  case 'Coffee.StartStep':{
   if(!is('started','dispensing'))return reject('JOB_STATE_CONFLICT');
   const step=j.steps.find(s=>s.id===command.payload.stepId);
   if(!step)return reject('STEP_UNKNOWN');
   if(inFlight(j))return reject('STEP_IN_FLIGHT');
   if(j.steps.find(s=>s.status==='pending')!==step)return reject('STEP_OUT_OF_ORDER');
   Object.assign(step,{status:'running',commandId:facts.commandId!,payloadHash:facts.payloadHash!,controlEpoch:facts.controlEpoch!,startedAt:facts.startedAt!});
   return {job:{...j,status:'dispensing'}};
  }
  case 'Coffee.ObserveDevice':{
   const step=j.steps.find(s=>s.id===facts.stepId);
   const r=facts.result;
   // a repeated terminal result (or a late accepted) for a finished step is absorbed in any later state: it never books or moves anything twice
   if(step&&(step.status==='completed'||step.status==='failed'))return r===step.status||r==='accepted'?{job:current,duplicate:true}:reject('STALE_DEVICE_EVENT');
   if(!step||!is('dispensing','needs_attention'))return reject('JOB_STATE_CONFLICT');
   if(r==='accepted'){step.accepted=true;step.observedBy=facts.observedBy??null;return {job:j};}
   if(r==='outcome_unknown'){step.status='unknown';return {job:attention(j,'STEP_UNKNOWN')};}
   step.measured=facts.measured??null;step.observedBy=facts.observedBy??null;
   if(facts.reason==='MEASUREMENT_IMPLAUSIBLE'){step.status='unknown';return {job:attention(j,facts.reason)};}
   if(r==='failed'||r==='rejected'){step.status='failed';return {job:attention(j,facts.reason??(r==='failed'?'STEP_FAILED':'STEP_REJECTED'))};}
   if(r!=='completed')return reject('INVALID_OBSERVATION');
   step.status='completed';
   if(!step.measured&&step.target)return {job:attention(j,'MEASUREMENT_MISSING')};
   return {job:is('dispensing')&&j.steps.every(s=>s.status==='completed')?{...j,status:'verifying'}:j};
  }
  // a silent device: the recipe step timeout on the command clock turns the step unknown; no resend, no authority moves, a person reconciles
  case 'Coffee.StepTimeout':{
   const step=j.steps.find(s=>s.id===facts.stepId);
   if(!step)return reject('STEP_UNKNOWN');
   if(step.status!=='running'||!step.startedAt)return reject('STEP_NOT_RUNNING');
   if(facts.nowMs!-Date.parse(step.startedAt)<facts.timeoutMs!)return reject('STEP_NOT_TIMED_OUT');
   Object.assign(step,{status:'unknown',timeoutPolicy:facts.timeoutPolicy??null});
   return {job:attention(j,'STEP_TIMEOUT')};
  }
  case 'Coffee.ConfirmQuality':return is('verifying')?{job:{...j,status:'ready_for_pickup'}}:reject('JOB_STATE_CONFLICT');
  case 'Cup.RequestTransfer':return command.payload.toKind==='arm'?(is('ready_for_pickup')?{job:{...j,status:'transferring'}}:reject('JOB_STATE_CONFLICT')):is('transferring')?{job:j}:reject('JOB_STATE_CONFLICT');
  case 'Cup.TransferLost':return is('transferring')?{job:attention(j,facts.reason??'TRANSFER_UNKNOWN')}:reject('JOB_STATE_CONFLICT');
  case 'Mission.Load':return is('transferring')?{job:{...j,status:'loaded'}}:reject('CUP_TRANSFER_REQUIRED');
  case 'Mission.Handoff':return is('loaded')?{job:{...j,status:'delivered'}}:reject('JOB_STATE_CONFLICT');
  case 'Fulfillment.HandOff':return is('ready_for_pickup')?{job:{...j,status:'delivered'}}:reject('COFFEE_HANDOFF_NOT_READY');
  case 'Coffee.CancelJob':
   if(inFlight(j))return {job:attention(j,'CANCEL_DURING_STEP')};
   if(is('transferring'))return {job:attention(j,'CANCEL_DURING_TRANSFER')};
   if(is('loaded'))return {job:{...j,status:'returning'}};
   if(is('needs_attention','returning'))return reject('RECONCILIATION_REQUIRED');
   return {job:{...j,status:'cancelled',disposition:j.steps.some(s=>s.consumed.length||s.status!=='pending')?'discard_pending':'reusable'}};
  case 'Coffee.Reconcile':return is('needs_attention','returning')?{job:{...j,status:'quarantined',disposition:facts.disposition??null}}:reject('JOB_STATE_CONFLICT');
  default:return reject('UNKNOWN_COMMAND');
 }
}
