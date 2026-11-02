import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import type { ModuleRegistry } from '../modules';
import { all, changed, created, done, fail, find, handle, note, requireState, stableId, text } from '../restaurant-context';
import { buildReceipt, type Receipt } from '../../../../integrations/printing/src/receipt';
import { printerSupport } from '../../../../integrations/printing/src/profile';
const usable=(s:Snapshot[],id?:string)=>all(s,'printer').filter(p=>(id===undefined||p.ref.id===id)&&printerSupport(p.state).ready).sort((a,b)=>a.ref.id.localeCompare(b.ref.id));
type Attempt={resolution?:JsonObject;effectId:string;number:number;reprint:boolean;reprintNumber:number;status:string;by:string;at:string;reason:string|null;code?:string};
const attempt=(effectId:string,number:number,reprintNumber:number,by:string,at:string,reason:string|null):Attempt=>({effectId,number,reprint:reprintNumber>0,reprintNumber,status:'pending',by,at,reason});
const effect=(job:string,a:Attempt,printerId:string,receipt:Receipt)=>({id:a.effectId,type:'printer.send',payload:{jobId:job,effectId:a.effectId,number:a.number,reprint:a.reprint,reprintNumber:a.reprintNumber,printerId,receipt:receipt as unknown as JsonObject}});
/**
 * Print.Request {billId,printerId?}: queues ONE `printer.send` effect for the bill's receipt (or provisional bill while prepared). The sale is never touched:
 * printing is a side effect with its own states (pending -> sent -> unknown | confirmed | failed) kept on the print-job. A second original for the same
 * bill and kind is refused unless nothing was ever sent (all attempts failed); a new copy is Print.ConfirmReprint, which marks the paper.
 * Print.ConfirmReprint {jobId,reason,printerId?}: staff decision to print again (e.g. the first attempt is unknown); a NEW attempt/effect flagged `reprint` with its
 * own audit entry, never an automatic retry. Refused while the previous attempt is still pending.
 * Print.Observe {jobId,effectId,status,code?}: what the device spool recorded for an attempt. It is only valid when the spool runner supplies the outbox's own
 * record of that effect (`spool-effect` snapshot) and the status matches it, so neither a role nor a forged payload can invent an outcome (e.g. a `failed` that
 * would license an unmarked duplicate original).
 * Print.Resolve {jobId,effectId,outcome:'printed'|'not_printed',reason}: a manager's reconciliation of an UNKNOWN attempt after checking the paper. It sends nothing.
 * `printed` closes the attempt as confirmed-by-staff. `not_printed` keeps the attempt unknown (a stalled printer may still print it later, so an unmarked second
 * original is NOT justified) and only unlocks Print.ConfirmReprint, which stays marked. Unresolved unknown attempts cannot be reprinted.
 */
export function registerPrinting(registry:ModuleRegistry):void {
 handle(registry,'Print.Request',(c,s)=>{
  const bill=requireState(s,'bill',text(c.payload.billId));
  if(!['prepared','closed'].includes(String(bill.state.status))) return fail('BILL_STATE_CONFLICT');
  const printer=usable(s,c.payload.printerId===undefined?undefined:text(c.payload.printerId))[0] ?? fail('PRINTER_NOT_READY');
  const receipt=buildReceipt(bill,s);
  if(all(s,'print-job').some(j=>j.state.billId===bill.ref.id&&j.state.kind===receipt.kind&&(j.state.attempts as unknown as Attempt[]).some(x=>x.status!=='failed'))) return fail('ALREADY_PRINTED');
  const jobId=stableId('print',c),a=attempt(jobId,1,0,c.actorRef,c.recordedAt,null);
  return done([created('PrintRequested','print-job',jobId,{billId:bill.ref.id,kind:receipt.kind,printerId:printer.ref.id,receipt:receipt as unknown as JsonObject,attempts:[a] as unknown as JsonObject[],status:'pending',requestedBy:c.actorRef,requestedAt:c.recordedAt})],
   {jobId,status:'pending',effects:[effect(jobId,a,printer.ref.id,receipt)]});
 });
 handle(registry,'Print.ConfirmReprint',(c,s)=>{
  const job=requireState(s,'print-job',text(c.payload.jobId)),reason=note(c.payload.reason,'REASON_REQUIRED');
  const attempts=job.state.attempts as unknown as Attempt[];
  if(job.state.status==='pending') return fail('ATTEMPT_IN_FLIGHT');
  const last=attempts[attempts.length-1]!;
  if(last.status==='unknown'&&!last.resolution) return fail('UNKNOWN_UNRESOLVED');
  const printer=usable(s,typeof c.payload.printerId==='string'?c.payload.printerId:String(job.state.printerId))[0] ?? fail('PRINTER_NOT_READY');
  const a=attempt(stableId('print',c),attempts.length+1,attempts.filter(x=>x.status!=='failed').length,c.actorRef,c.recordedAt,reason);
  return done([changed('PrintReprintRequested',job,{attempts:[...attempts,a] as unknown as JsonObject[],status:'pending',printerId:printer.ref.id})],
   {jobId:job.ref.id,status:'pending',attempt:a.number,effects:[effect(job.ref.id,a,printer.ref.id,job.state.receipt as unknown as Receipt)]});
 });
 handle(registry,'Print.Observe',(c,s)=>{
  const job=requireState(s,'print-job',text(c.payload.jobId)),effectId=text(c.payload.effectId),status=String(c.payload.status);
  if(!['confirmed','unknown','failed'].includes(status)) return fail('INVALID_STATUS');
  const stored=find(s,'spool-effect',effectId) ?? fail('EFFECT_STATE_UNAVAILABLE');
  if(stored.state.status!==status) return fail('EFFECT_STATUS_MISMATCH');
  const attempts=job.state.attempts as unknown as Attempt[],i=attempts.findIndex(x=>x.effectId===effectId);
  if(i<0) return fail('NOT_FOUND');
  if(attempts[i]!.status===status) return done([],{jobId:job.ref.id,status,duplicate:true});
  if(attempts[i]!.status!=='pending') return fail('ATTEMPT_ALREADY_FINAL');
  const next=attempts.map((x,k)=>k===i?{...x,status,observedBy:c.actorRef,observedAt:c.recordedAt,...(typeof c.payload.code==='string'?{code:c.payload.code}:{})}:x);
  return done([changed('PrintAttemptObserved',job,{attempts:next as unknown as JsonObject[],status:i===attempts.length-1?status:job.state.status})],{jobId:job.ref.id,status});
 });
 handle(registry,'Print.Resolve',(c,s)=>{
  const job=requireState(s,'print-job',text(c.payload.jobId)),effectId=text(c.payload.effectId),outcome=c.payload.outcome,reason=note(c.payload.reason,'REASON_REQUIRED');
  if(outcome!=='printed'&&outcome!=='not_printed') return fail('INVALID_OUTCOME');
  const attempts=job.state.attempts as unknown as Attempt[],i=attempts.findIndex(x=>x.effectId===effectId);
  if(i<0) return fail('NOT_FOUND');
  if(attempts[i]!.status!=='unknown') return fail('ATTEMPT_NOT_UNKNOWN');
  if(attempts[i]!.resolution) return fail('ALREADY_RESOLVED');
  const resolution={outcome,by:c.actorRef,at:c.recordedAt,reason},latest=i===attempts.length-1;
  const next=attempts.map((x,k)=>k===i?{...x,resolution,...(outcome==='printed'?{status:'confirmed',source:'staff'}:{})}:x);
  return done([changed('PrintAttemptResolved',job,{attempts:next as unknown as JsonObject[],status:latest?(outcome==='printed'?'confirmed':'not_printed'):job.state.status})],{jobId:job.ref.id,effectId,outcome});
 });
}
