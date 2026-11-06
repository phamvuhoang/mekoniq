// Coffee domain (CORE-09): recipes, CoffeeJob, cell devices/resources and cup ownership, registered once in the production registry (no parallel Beverage.* registry).
// Commands are station-scoped (authorizeVenueCommand) and versioned by the whole-venue read set the processor rechecks at commit.
import {hashPayload} from '../../../contracts/src/canonical';
import type {CommandEnvelope,DomainEvent,JsonObject,Snapshot} from '../../../contracts/src/index';
import type {ModuleRegistry} from '../modules';
import {all,changed,created,done,fail,find,handle,note,record,requireState,stableId,text} from '../restaurant-context';
import {readyEvents} from '../kitchen/ticket';
import {parseRecipe,recipeKey,withinTolerance,STEP_DEVICE,type CoffeeRecipe} from './recipe';
import {decideCoffeeJob,FINAL_JOB,type CoffeeJob,type JobCommand,type JobFacts,type Measured} from './job';
import {acquire,release,device,cellDevice,requireObserver,interlock,sequenced,reserveStock,consumeStep,leaseIds,FRESH_MS} from './resources';
import {applyTransfer,ARM_PROGRAMS,ownerOf,type Cup,type Party} from './transfer';
import {dispose} from './recovery';
import {checkCupCapacity,checkMilkPolicy,observeMilkBatch,implausibleMeasurement,simulatedEvidenceAllowed} from './policies';
export const beveragePermissions:Record<string,string>={
 'Coffee.RegisterRecipe':'beverage.configure','Coffee.ReserveJob':'beverage.write','Coffee.StartJob':'beverage.write','Coffee.StartStep':'beverage.write',
 'Coffee.ConfirmQuality':'beverage.write','Coffee.StepTimeout':'beverage.write','Cup.RequestTransfer':'beverage.write','Coffee.CancelJob':'beverage.write','Coffee.RecordCleaning':'beverage.write',
 // feedback comes only from the observer bound to the device; a person attesting a transfer instead needs beverage.override (see requiredPermissions)
 'Coffee.ObserveCup':'cell.observe','Coffee.ObserveDevice':'cell.observe','Cup.ConfirmTransfer':'cell.observe',
 'Coffee.Reconcile':'beverage.reconcile',
};
const COMMAND_TTL_MS=30000,PROV=['measured','modelled','vendor_spec','assumed','illustrative','unknown'];
/** Device fault codes that become typed attention reasons (the partial measurement stays booked); anything else is a plain STEP_FAILED. */
const FAULT_REASONS:Record<string,string>={ICE_JAMMED:'ICE_JAM',ICE_JAM:'ICE_JAM',MILK_EMPTY:'MILK_EMPTY',BREW_TIMEOUT:'BREW_TIMEOUT'};
const faultReason=(codes:unknown)=>Array.isArray(codes)?codes.map(String).map(code=>FAULT_REASONS[code]).find(Boolean)??null:null;
const jobOf=(s:Snapshot[],c:CommandEnvelope)=>{const j=requireState(s,'coffee-job',text(c.payload.jobId));if(j.state.stationId!==c.payload.stationId)fail('STATION_FORBIDDEN');return j;};
const asJob=(j:Snapshot)=>j.state as unknown as CoffeeJob;
const decided=(j:Snapshot,cmd:JobCommand,facts?:JobFacts)=>{const d=decideCoffeeJob(asJob(j),cmd,facts);if(d.rejectionCode)return fail(d.rejectionCode);return d;};
const jobEvent=(type:string,j:Snapshot,next:CoffeeJob)=>changed(type,j,next as unknown as JsonObject);
const recipeOf=(s:Snapshot[],job:CoffeeJob)=>requireState(s,'coffee-recipe',job.recipeKey).state as unknown as CoffeeRecipe;
const measurement=(v:unknown):Measured|null=>{
 if(v===undefined||v===null)return null;const m=record(v as JsonObject);
 if(!/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(String(m.amount))||!['kg','m3','K','s'].includes(String(m.unit))||!PROV.includes(String(m.provenance)))return fail('INVALID_MEASUREMENT');
 return {amount:String(m.amount),unit:String(m.unit),provenance:String(m.provenance)};
};
const party=(v:unknown):Party=>{const p=record(v as JsonObject),kind=String(p.kind);if(!['arm','robot','cell','human','customer'].includes(kind))fail('INVALID_PARTY');return {kind:kind as Party['kind'],id:text(p.id),...p.slot!==undefined?{slot:Number(p.slot)}:{}};};
/** Device command as an outbox effect. The cell bridge binds it to its run/session and transport; the domain never sends raw device I/O. */
function cellEffect(c:CommandEnvelope,d:Snapshot,capability:string,payload:JsonObject,extra:JsonObject,programRef:JsonObject|null=null){
 const commandId=stableId('cell-cmd',c),payloadHash=hashPayload(payload);
 return {commandId,payloadHash,controlEpoch:Number(d.state.controlEpoch),effect:{id:stableId('cell-effect',c),type:'cell.execute',payload:{commandId,deviceId:d.ref.id,controlEpoch:Number(d.state.controlEpoch),expiresAt:new Date(Date.parse(c.recordedAt)+COMMAND_TTL_MS).toISOString(),recipeRevision:null,programRef,capability,payloadHash,payload,stationId:String(c.payload.stationId),...extra}}};
}
export function registerBeverage(registry:ModuleRegistry):void {
 // Coffee.RegisterRecipe {recipe}: an immutable revision keyed id@revision; the content hash is verified, a revision is never rewritten.
 handle(registry,'Coffee.RegisterRecipe',(c,s)=>{
  const r=parseRecipe(c.payload.recipe),key=recipeKey(r.id,r.revision),old=find(s,'coffee-recipe',key);
  if(old)return old.state.hash===r.hash?done([],{recipeKey:key,duplicate:true}):fail('RECIPE_REVISION_EXISTS');
  return done([created('CoffeeRecipeRegistered','coffee-recipe',key,{...r as unknown as JsonObject,registeredBy:c.actorRef,registeredAt:c.recordedAt})],{recipeKey:key});
 });
 // Coffee.ReserveJob {stationId,jobId,lineId,cellId,recipe:{id,revision,hash},cupId}: binds an order line at this station to a frozen recipe revision and a cup,
 // and holds machine/nozzle and stock atomically (all or nothing).
 handle(registry,'Coffee.ReserveJob',(c,s)=>{
  const jobId=text(c.payload.jobId),stationId=text(c.payload.stationId),cellId=text(c.payload.cellId),cupId=text(c.payload.cupId),ref=record(c.payload.recipe);
  if(find(s,'coffee-job',jobId))return fail('JOB_EXISTS');
  const key=recipeKey(text(ref.id),Number(ref.revision)),rs=find(s,'coffee-recipe',key)??fail('RECIPE_NOT_FOUND'),recipe=rs.state as unknown as CoffeeRecipe;
  if(recipe.hash!==ref.hash)return fail('RECIPE_HASH_MISMATCH');
  checkCupCapacity(recipe);
  const ticket=requireState(s,'kitchen-ticket',text(c.payload.lineId));
  if(ticket.state.stationId!==stationId)return fail('STATION_FORBIDDEN');
  if(ticket.state.itemId!==recipe.outputType)return fail('RECIPE_ITEM_MISMATCH');
  if(!['queued','preparing','partially_ready'].includes(String(ticket.state.status)))return fail('TICKET_STATE_CONFLICT');
  // Quality-confirmed jobs already contribute to ticket.prepared; only unfinished preparation holds extra capacity.
  const open=all(s,'coffee-job').filter(j=>j.state.lineId===ticket.ref.id&&!FINAL_JOB.includes(asJob(j).status)&&!j.state.qualityConfirmedBy).length;
  if(BigInt(open)+BigInt(String(ticket.state.prepared))>=BigInt(String(ticket.state.quantity)))return fail('JOB_EXCEEDS_ORDER');
  if(find(s,'cup',cupId))return fail('CUP_IN_USE');
  const machine=cellDevice(s,cellId,'machine');if(machine.state.stationId!==stationId)return fail('STATION_FORBIDDEN');
  const leases=[leaseIds.machine(cellId),leaseIds.nozzle(cellId)],leased=acquire(c,s,leases,jobId),reservations=reserveStock(s,recipe,jobId);
  const steps=recipe.steps.map(st=>({id:st.id,kind:st.kind,status:'pending',deviceId:cellDevice(s,cellId,STEP_DEVICE[st.kind]??'machine').ref.id,commandId:null,payloadHash:null,controlEpoch:null,target:st.target as unknown as JsonObject,measured:null,consumed:[],observedBy:null}));
  const job={jobId,lineId:ticket.ref.id,stationId,cellId,recipeKey:key,recipeId:recipe.id,recipeRevision:recipe.revision,recipeHash:recipe.hash,cupId,cupType:recipe.cupType,status:'reserved',steps,reservations,leases,attentionReason:null,disposition:null,reservedBy:c.actorRef,reservedAt:c.recordedAt};
  const cup={cupId,cupType:recipe.cupType,jobId,recipeKey:key,ownerKind:'cell',ownerId:cellId,slot:null,epoch:1,pendingTransfer:null,movements:[],disposition:null,present:null};
  return done([created('CoffeeJobReserved','coffee-job',jobId,job as unknown as JsonObject),created('CupBound','cup',cupId,cup),...leased],{jobId,recipeKey:key,cupId});
 });
 // Coffee.ObserveCup {stationId,jobId,deviceId,bootId,seq,observedAt,cupId,cupType,present}: presence + identity from the bound cup sensor; verifies only with
 // the machine interlocks satisfied. A cup lost mid-dispense halts the job.
 handle(registry,'Coffee.ObserveCup',(c,s)=>{
  const j=jobOf(s,c),job=asJob(j),d=device(s,text(c.payload.deviceId));
  if(d.state.role!=='cup_sensor'||d.state.cellId!==job.cellId)return fail('DEVICE_UNKNOWN');
  requireObserver(c,d);const seq=sequenced(c,d),present=c.payload.present===true;
  if(present){
   if(c.payload.cupId!==job.cupId)return fail('CUP_MISMATCH');
   if(c.payload.cupType!==job.cupType)return fail('CUP_TYPE_MISMATCH');
   if(job.status==='reserved')interlock(c,cellDevice(s,job.cellId,'machine'));
  }
  const next=decided(j,{type:'Coffee.ObserveCup',payload:{present}}).job!,cup=requireState(s,'cup',job.cupId);
  const event=next.status==='cup_verified'?'CoffeeCupVerified':next.status==='needs_attention'?'CoffeeJobNeedsAttention':present?'CoffeeCupObserved':'CoffeeCupVerificationRevoked';
  return done([jobEvent(event,j,next),changed('CellDeviceObserved',d,seq),changed('CupPresenceObserved',cup,{present,presenceObservedBy:c.actorRef,presenceObservedAt:seq.observedAt})],{jobId:job.jobId,status:next.status});
 });
 handle(registry,'Coffee.StartJob',(c,s)=>{
  const j=jobOf(s,c),next=decided(j,{type:'Coffee.StartJob',payload:c.payload}).job!;
  interlock(c,cellDevice(s,next.cellId,'machine'));
  return done([jobEvent('CoffeeJobStarted',j,{...next,startedBy:c.actorRef,startedAt:c.recordedAt})],{jobId:next.jobId});
 });
 // Coffee.StartStep {stationId,jobId,stepId}: the next recipe step only, its device interlocked, as one typed device command (brew / dispense), never raw pump I/O.
 handle(registry,'Coffee.StartStep',(c,s)=>{
  const j=jobOf(s,c),job=asJob(j),step=job.steps.find(x=>x.id===c.payload.stepId);
  decided(j,{type:'Coffee.StartStep',payload:c.payload},{commandId:'probe',payloadHash:'probe',controlEpoch:1});
  const d=device(s,step!.deviceId);interlock(c,d);
  const recipe=recipeOf(s,job);checkCupCapacity(recipe,job);
  if(step!.kind==='add_milk')checkMilkPolicy(c,d,recipe,simulatedEvidenceAllowed(s,d));
  const target=step!.target as {amount:string;unit:string}|null,resource={add_ice:'ice',add_milk:'milk',add_water:'water'}[step!.kind];
  const [capability,payload]=step!.kind==='brew'?['brew',{recipeId:job.recipeId,cupId:job.cupId}]:resource&&target?['dispense',{resource,amount:target.amount,unit:target.unit}]:fail('STEP_UNSUPPORTED');
  const cmd=cellEffect(c,d,capability as string,payload as JsonObject,{jobId:job.jobId,stepId:step!.id,cupId:job.cupId});
  (cmd.effect.payload as JsonObject).recipeRevision=job.recipeRevision;
  const next=decided(j,{type:'Coffee.StartStep',payload:c.payload},{...cmd,startedAt:c.recordedAt}).job!;
  return done([jobEvent('CoffeeStepStarted',j,next)],{jobId:job.jobId,stepId:step!.id,commandId:cmd.commandId,effects:[cmd.effect as unknown as JsonObject]});
 });
 // Coffee.ObserveDevice {stationId,deviceId,bootId,seq,observedAt,status?,observation?,measurement?}: bound device feedback. Status updates the interlock state;
 // an observation must echo its command (id, epoch, payload hash). A terminal step result books its irreversible consumption once.
 handle(registry,'Coffee.ObserveDevice',(c,s)=>{
  const d=device(s,text(c.payload.deviceId));
  if(d.state.stationId!==c.payload.stationId)return fail('STATION_FORBIDDEN');
  requireObserver(c,d);const seq=sequenced(c,d),events:DomainEvent[]=[],deviceChange:JsonObject={...seq};
  if(c.payload.status!==undefined){
   const st=record(c.payload.status);
   if(!['ready','warming','fault','offline'].includes(String(st.status)))return fail('INVALID_OBSERVATION');
   Object.assign(deviceChange,{status:st.status!,reasonCodes:Array.isArray(st.reasonCodes)?st.reasonCodes.map(String).slice(0,20):[],...st.level!==undefined?{level:String(st.level)}:{}});
   if(st.milkBatch!==undefined)deviceChange.milkBatch=observeMilkBatch(c,d,st.milkBatch);
  }
  let value:JsonObject={deviceId:d.ref.id};
  if(c.payload.observation!==undefined){
   const o=record(c.payload.observation),commandId=text(o.commandId),result=String(o.result);
   if(o.deviceId!==d.ref.id)return fail('OBSERVATION_IDENTITY_MISMATCH');
   if(o.controlEpoch!==d.state.controlEpoch)return fail('STALE_CONTROL_EPOCH');
   const js=all(s,'coffee-job').find(x=>(asJob(x).steps).some(st=>st.commandId===commandId));
   if(js){
    const job=asJob(js),step=job.steps.find(st=>st.commandId===commandId)!;
    // the observation must come from the step's own device, under the epoch the command was issued with, for the same payload
    if(o.payloadHash!==step.payloadHash||step.deviceId!==d.ref.id||o.controlEpoch!==step.controlEpoch)return fail('OBSERVATION_IDENTITY_MISMATCH');
    // a plant that states the recipe revision it executed must name the job's frozen revision (older providers omit it)
    if(o.recipeRevision!==undefined&&o.recipeRevision!==null&&o.recipeRevision!==job.recipeRevision)return fail('RECIPE_REVISION_MISMATCH');
    const measured=measurement(c.payload.measurement),outlier=implausibleMeasurement(recipeOf(s,job),step.id,measured),fault=faultReason(o.reasonCodes);
    const dec=decided(js,{type:'Coffee.ObserveDevice',payload:{}},{stepId:step.id,result,measured,observedBy:c.actorRef,...outlier?{reason:'MEASUREMENT_IMPLAUSIBLE'}:fault&&(result==='failed'||result==='rejected')?{reason:fault}:{}});
    if(!dec.duplicate){
     const next=dec.job!,after=next.steps.find(st=>st.id===step.id)!;
     if(after.status==='completed'||after.status==='failed'&&measured){
      // failed: only what was measured left the shelf; the rest stays reserved for reconciliation
      const recipe=recipeOf(s,next),measuredUnit=(after.target as {unit?:string}|null)?.unit;
      const booking=after.status==='failed'?{...next,reservations:next.reservations.filter(r=>recipe.resources.find(x=>x.resourceId===r.resourceId)?.requiredAmount?.unit===measuredUnit)}:next;
      const r=consumeStep(c,s,recipe,booking,step.id,measured);events.push(...r.events);after.consumed=[...after.consumed,...r.consumed];
     }
     events.push(jobEvent(next.status==='needs_attention'&&job.status!=='needs_attention'?'CoffeeJobNeedsAttention':after.status==='completed'?'CoffeeStepCompleted':'CoffeeStepObserved',js,next));
     value={...value,jobId:job.jobId,stepId:step.id,status:next.status};
    }
   }else{
    const cs=all(s,'cup').find(x=>(x.state.pendingTransfer as JsonObject|null)?.commandId===commandId)??fail('COMMAND_UNKNOWN'),cup=cs.state as unknown as Cup,pending=cup.pendingTransfer!;
    const j=requireState(s,'coffee-job',cup.jobId);
    if(d.ref.id!==cellDevice(s,asJob(j).cellId,'arm').ref.id||o.payloadHash!==pending.payloadHash||o.controlEpoch!==pending.controlEpoch)return fail('OBSERVATION_IDENTITY_MISMATCH');
    if(['failed','rejected','outcome_unknown'].includes(result)){
     const next=decided(j,{type:'Cup.TransferLost',payload:{}},{reason:result==='outcome_unknown'?'TRANSFER_UNKNOWN':'TRANSFER_FAILED'}).job!;
     events.push(jobEvent('CoffeeJobNeedsAttention',j,next));
    }
    // arm 'completed' means the choreography ended on the controller; ownership still waits for Cup.ConfirmTransfer evidence
    events.push(changed('CupTransferObserved',cs,{pendingTransfer:{...pending,lastResult:result,lastObservedBy:c.actorRef} as unknown as JsonObject}));
    value={...value,cupId:cup.cupId,transferId:pending.transferId};
   }
  }
  return done([changed('CellDeviceObserved',d,deviceChange),...events],value);
 });
 // Coffee.ConfirmQuality {stationId,jobId}: automatic quality only on measured quantities in tolerance; publishes kitchen readiness once through the
 // Kitchen.Ready helper in the same decision. W07 still books packaging; measured step ingredients are excluded from its deduction.
 handle(registry,'Coffee.ConfirmQuality',(c,s)=>{
  const j=jobOf(s,c),next=decided(j,{type:'Coffee.ConfirmQuality',payload:c.payload}).job!;
  const recipe=recipeOf(s,next);checkCupCapacity(recipe,next);
  if(next.steps.some(st=>st.kind==='add_milk')){const milk=cellDevice(s,next.cellId,'milk');checkMilkPolicy(c,milk,recipe,simulatedEvidenceAllowed(s,milk));}
  for(const st of next.steps){
   const target=st.target as {amount:string;tolerance:string;unit:'kg'|'m3'|'K'|'s';provenance:string}|null;if(!target)continue;
   if(!st.measured)return fail('MEASUREMENT_MISSING');
   const simulation=simulatedEvidenceAllowed(s,device(s,st.deviceId));
   if(st.measured.provenance!=='measured'&&!(simulation&&st.measured.provenance==='modelled'))return fail('MEASUREMENT_UNVERIFIED');
   if(st.measured.unit!==target.unit)return fail('MEASUREMENT_UNIT_MISMATCH');
   if(!withinTolerance(st.measured.amount,target))return fail('QUALITY_OUT_OF_TOLERANCE');
  }
  const ticket=requireState(s,'kitchen-ticket',next.lineId);
  if(ticket.state.stationId!==next.stationId)return fail('STATION_FORBIDDEN');
  const ready=readyEvents(c,s,ticket,'1',true,{source:`coffee-ready:${next.jobId}`,jobId:next.jobId,excludeIngredientIds:[...new Set(next.reservations.map(r=>r.ingredientId))]});
  return done([jobEvent('CoffeeQualityConfirmed',j,{...next,qualityConfirmedBy:c.actorRef,qualityConfirmedAt:c.recordedAt}),...ready.events],{jobId:next.jobId,lineId:next.lineId});
 });
 // Cup.RequestTransfer {stationId,transferId,cupId,jobId,to:{kind:'arm',id}|{kind:'robot',id,slot}}: the current owner hands over through an approved arm program.
 // The tray leg needs that robot waiting at this station's load stop for this order line.
 handle(registry,'Cup.RequestTransfer',(c,s)=>{
  const j=jobOf(s,c),job=asJob(j),transferId=text(c.payload.transferId),to=party(c.payload.to);
  if(c.payload.cupId!==job.cupId)return fail('CUP_MISMATCH');
  const cs=requireState(s,'cup',job.cupId),cup=cs.state as unknown as Cup;
  if(cup.pendingTransfer)return fail('TRANSFER_PENDING');
  if(cup.movements.some(m=>m.transferId===transferId))return fail('TRANSFER_EXISTS');
  const next=decided(j,{type:'Cup.RequestTransfer',payload:{toKind:to.kind}}).job!,arm=cellDevice(s,job.cellId,'arm');
  let leases:string[],program;
  if(to.kind==='arm'){
   if(to.id!==arm.ref.id)return fail('ARM_UNKNOWN');
   if(cup.ownerKind!=='cell')return fail('CUP_OWNER_MISMATCH');
   leases=[leaseIds.arm(job.cellId)];program=ARM_PROGRAMS['cup-pick']!;
  }else if(to.kind==='robot'){
   if(cup.ownerKind!=='arm'||cup.ownerId!==arm.ref.id)return fail('CUP_OWNER_MISMATCH');
   const robot=find(s,'robot',to.id)??fail('DESTINATION_NOT_READY'),mission=typeof robot.state.missionId==='string'?find(s,'mission',robot.state.missionId):undefined;
   if(!arm.state.observerId||!robot.state.observerId||arm.state.observerId===robot.state.observerId)return fail('TRANSFER_OBSERVERS_NOT_INDEPENDENT');
   const stop=((mission?.state.stops??[]) as JsonObject[]).find(x=>x.id===mission?.state.currentStopId);
   const forLine=((stop?.allocationIds??[]) as string[]).some(id=>{const allocation=find(s,'allocation',id);return allocation?.state.lineId===job.lineId&&(!allocation.state.coffeeJobIds||(allocation.state.coffeeJobIds as string[]).includes(job.jobId));});
   if(!stop||stop.action!=='load'||stop.targetId!==job.stationId||stop.status!=='awaiting_action'||!forLine)return fail('DESTINATION_NOT_READY');
   if(!Number.isSafeInteger(to.slot)||to.slot!<1||to.slot!>Number(robot.state.trays??1))return fail('INVALID_SLOT');
   leases=[leaseIds.handoff(job.stationId)];program=ARM_PROGRAMS['cup-place']!;
  }else return fail('INVALID_PARTY');
  interlock(c,arm);
  const leased=acquire(c,s,leases,job.jobId),cmd=cellEffect(c,arm,'start_job',{jobId:job.jobId},{jobId:job.jobId,cupId:cup.cupId,transferId,to:to as unknown as JsonObject},program);
  const pending={transferId,from:ownerOf(cup),to,epoch:cup.epoch,commandId:cmd.commandId,payloadHash:cmd.payloadHash,controlEpoch:cmd.controlEpoch,requestedAt:c.recordedAt};
  return done([jobEvent('CoffeeTransferRequested',j,{...next,leases:[...new Set([...next.leases,...leases])]}),changed('CupTransferRequested',cs,{pendingTransfer:pending as unknown as JsonObject}),...leased],
   {jobId:job.jobId,cupId:cup.cupId,transferId,commandId:cmd.commandId,effects:[cmd.effect as unknown as JsonObject]});
 });
 // Cup.ConfirmTransfer {stationId,transferId,cupId,provenance:'sensor'|'human',reason?,evidence}: receiving-side evidence for the pending transfer, from the bound arm
 // observer (fresh, same command), or a person with beverage.override and a reason (recorded as human, never as a sensor).
 handle(registry,'Cup.ConfirmTransfer',(c,s)=>{
  const cs=requireState(s,'cup',text(c.payload.cupId)),cup=cs.state as unknown as Cup,j=jobOf(s,{...c,payload:{...c.payload,jobId:cup.jobId}}),job=asJob(j),transferId=text(c.payload.transferId);
  if(cup.movements.some(m=>m.transferId===transferId))return done([],{cupId:cup.cupId,transferId,duplicate:true});
  const pending=cup.pendingTransfer;
  if(!pending||pending.transferId!==transferId)return fail('TRANSFER_NOT_PENDING');
  const human=c.payload.provenance==='human',evidence=record(c.payload.evidence),reason=human?note(c.payload.reason,'REASON_REQUIRED'):undefined;
  const fresh=(e:JsonObject)=>!Number.isNaN(Date.parse(String(e.observedAt)))&&Date.parse(c.recordedAt)-Date.parse(String(e.observedAt))<=FRESH_MS;
  if(!human&&pending.to.kind==='robot'){
   if(cellDevice(s,job.cellId,'arm').state.observerId===find(s,'robot',pending.to.id)?.state.observerId)return fail('TRANSFER_OBSERVERS_NOT_INDEPENDENT');
   // tray leg: the giver's release (arm observer, same command) AND the receiver's presence + dock (observer bound to that robot, same transfer); each half alone is only recorded
   const side=c.payload.side;
   if(side==='giver'){
    requireObserver(c,cellDevice(s,job.cellId,'arm'));
    if(evidence.commandId!==pending.commandId)return fail('EVIDENCE_MISMATCH');
    if(!fresh(evidence))return fail('EVIDENCE_STALE');
    if(evidence.released!==true)return fail('RELEASE_EVIDENCE_REQUIRED');
   }else if(side==='receiver'){
    const robot=find(s,'robot',pending.to.id);
    if(!robot||robot.state.observerId!==c.actorRef)return fail('OBSERVER_NOT_BOUND');
    if(evidence.transferId!==transferId)return fail('EVIDENCE_MISMATCH');
    if(!fresh(evidence))return fail('EVIDENCE_STALE');
    if(evidence.receiverPresent!==true||evidence.dockInTolerance!==true)return fail('RECEIVER_EVIDENCE_REQUIRED');
   }else return fail('TRANSFER_SIDE_REQUIRED');
   if(pending[side]&&fresh(pending[side] as unknown as JsonObject))return done([],{cupId:cup.cupId,transferId,duplicate:true});
   const half={...evidence,observedBy:c.actorRef,observedAt:String(evidence.observedAt)},next={...pending,[side]:half},other=side==='giver'?next.receiver:next.giver;
   if(!other||!fresh(other as unknown as JsonObject))return done([changed('CupTransferEvidenceRecorded',cs,{pendingTransfer:next as unknown as JsonObject})],{cupId:cup.cupId,transferId,side,committed:false});
   const giver=next.giver!,receiver=next.receiver!;
   const moved=applyTransfer({...cup,pendingTransfer:next},{transferId,cupId:cup.cupId,provenance:'sensor',observedBy:c.actorRef,at:c.recordedAt,
    evidence:{released:true,receiverPresent:true,dockInTolerance:true,receiverId:pending.to.id,giver:giver as unknown as JsonObject,receiver:receiver as unknown as JsonObject}}).cup;
   const freed=[leaseIds.arm(job.cellId)];
   return done([changed('CupTransferConfirmed',cs,moved as unknown as JsonObject),jobEvent('CoffeeCupMoved',j,{...job,leases:job.leases.filter(l=>!freed.includes(l)),lastTransferId:transferId}),...release(c,s,freed,job.jobId)],
    {cupId:cup.cupId,transferId,jobId:job.jobId,owner:moved.ownerId,committed:true});
  }
  if(!human){
   if(c.payload.provenance!=='sensor')return fail('INVALID_PROVENANCE');
   requireObserver(c,cellDevice(s,job.cellId,'arm'));
   if(evidence.commandId!==pending.commandId)return fail('EVIDENCE_MISMATCH');
   if(!fresh(evidence))return fail('EVIDENCE_STALE');
  }
  const moved=applyTransfer(cup,{transferId,cupId:cup.cupId,provenance:human?'human':'sensor',observedBy:c.actorRef,at:c.recordedAt,...reason?{reason}:{},evidence}).cup;
  const freed=pending.to.kind==='arm'?[leaseIds.machine(job.cellId),leaseIds.nozzle(job.cellId)]:[leaseIds.arm(job.cellId)];
  return done([changed('CupTransferConfirmed',cs,moved as unknown as JsonObject),jobEvent('CoffeeCupMoved',j,{...job,leases:job.leases.filter(l=>!freed.includes(l)),lastTransferId:transferId}),...release(c,s,freed,job.jobId)],
   {cupId:cup.cupId,transferId,jobId:job.jobId,owner:moved.ownerId});
 });
 // Coffee.StepTimeout {stationId,jobId,stepId}: the step's recipe timeoutMs has elapsed on the command clock without a terminal device result.
 handle(registry,'Coffee.StepTimeout',(c,s)=>{
  const j=jobOf(s,c),job=asJob(j),recipe=recipeOf(s,job),rs=recipe.steps.find(x=>x.id===c.payload.stepId);
  const next=decided(j,{type:'Coffee.StepTimeout',payload:c.payload},{stepId:String(c.payload.stepId),nowMs:Date.parse(c.recordedAt),timeoutMs:rs?.timeoutMs??Infinity,timeoutPolicy:recipe.recovery.onTimeout}).job!;
  return done([jobEvent('CoffeeJobNeedsAttention',j,{...next,timedOutAt:c.recordedAt,timedOutBy:c.actorRef})],{jobId:job.jobId,stepId:String(c.payload.stepId),status:next.status});
 });
 handle(registry,'Coffee.CancelJob',(c,s)=>{
  const j=jobOf(s,c),reason=note(c.payload.reason,'REASON_REQUIRED'),next=decided(j,{type:'Coffee.CancelJob',payload:c.payload}).job!;
  const extra=next.status==='cancelled'?dispose(c,s,next,reason):[];
  return done([jobEvent(next.status==='cancelled'?'CoffeeJobCancelled':next.status==='returning'?'CoffeeJobReturning':'CoffeeJobNeedsAttention',j,{...next,cancelReason:reason,cancelledBy:c.actorRef}),...extra],{jobId:next.jobId,status:next.status});
 });
 // Coffee.Reconcile {stationId,jobId,disposition,reason,cupLocation?}: a person resolves an uncertain job. Nothing is resent; the cup keeps its last known owner
 // unless the person states where it is.
 handle(registry,'Coffee.Reconcile',(c,s)=>{
  const j=jobOf(s,c),reason=note(c.payload.reason,'REASON_REQUIRED'),disposition=String(c.payload.disposition);
  if(!['discard','reusable','returned'].includes(disposition))return fail('INVALID_DISPOSITION');
  const next=decided(j,{type:'Coffee.Reconcile',payload:c.payload},{disposition}).job!;
  const extra=dispose(c,s,next,reason,{human:true,...c.payload.cupLocation!==undefined?{cupLocation:party(c.payload.cupLocation)}:{}});
  return done([jobEvent('CoffeeJobQuarantined',j,{...next,reconciledBy:c.actorRef,reconciledAt:c.recordedAt,reconcileReason:reason,provenance:'human'}),...extra],{jobId:next.jobId});
 });
 // Coffee.RecordCleaning {stationId,deviceId,reason}: audited readiness; refused while a step runs on that device.
 handle(registry,'Coffee.RecordCleaning',(c,s)=>{
  const d=device(s,text(c.payload.deviceId)),reason=note(c.payload.reason,'REASON_REQUIRED');
  if(d.state.stationId!==c.payload.stationId)return fail('STATION_FORBIDDEN');
  if(all(s,'coffee-job').some(j=>asJob(j).steps.some(st=>st.deviceId===d.ref.id&&(st.status==='running'||st.status==='unknown'))))return fail('DEVICE_IN_USE');
  const cleaning=(d.state.cleaning??{}) as JsonObject,interval=Number(cleaning.intervalMs??4*3600000);
  return done([changed('CellCleaningRecorded',d,{cleaning:{...cleaning,status:'ok',intervalMs:interval,lastCleanedAt:c.recordedAt,dueAt:new Date(Date.parse(c.recordedAt)+interval).toISOString(),cleanedBy:c.actorRef,reason}})],{deviceId:d.ref.id});
 });
}
/**
 * Mission.ConfirmStop hook. Load: every coffee job of the loaded lines needs its cup confirmed on THIS robot (no pending transfer) -> loaded.
 * Handoff: the cup goes to the customer and the job is delivered (served is counted by the mission's own fulfillment events, not here).
 */
export function coffeeStopEvents(c:CommandEnvelope,s:Snapshot[],robotId:string,action:string,targetId:string,allocations:Snapshot[]):DomainEvent[] {
 const events:DomainEvent[]=[],selected=new Set<string>();
 for(const allocation of allocations){
  const jobs=all(s,'coffee-job').filter(j=>j.state.lineId===allocation.state.lineId);if(!jobs.length)continue;
  const ids=allocation.state.coffeeJobIds as string[]|undefined;
  const live=jobs.filter(j=>!FINAL_JOB.includes(asJob(j).status)&&(!ids||ids.includes(j.ref.id)));
  if(action==='load'&&!live.length)return fail('CUP_TRANSFER_REQUIRED');
  if(['load','handoff'].includes(action)&&BigInt(live.length)!==BigInt(String(allocation.state.quantity)))return fail('COFFEE_ALLOCATION_UNBOUND');
  for(const j of live)selected.add(j.ref.id);
 }
 for(const j of all(s,'coffee-job').filter(x=>selected.has(x.ref.id))){
  const job=asJob(j),cs=find(s,'cup',job.cupId),cup=cs?.state as unknown as Cup|undefined;
  if(action==='load'){
   if(!cup||cup.ownerKind!=='robot'||cup.ownerId!==robotId||cup.pendingTransfer)return fail('CUP_TRANSFER_REQUIRED');
   const next=decided(j,{type:'Mission.Load',payload:{}}).job!;
   events.push(jobEvent('CoffeeJobLoaded',j,{...next,leases:next.leases.filter(l=>l!==leaseIds.handoff(job.stationId))}),...release(c,s,[leaseIds.handoff(job.stationId)],job.jobId));
  }else if(action==='handoff'){
   if(job.status!=='loaded'||!cup||!cs||cup.ownerKind!=='robot'||cup.ownerId!==robotId||cup.pendingTransfer)return fail('CUP_HANDOFF_NOT_READY');
   const next=decided(j,{type:'Mission.Handoff',payload:{}}).job!,to:Party={kind:'customer',id:targetId};
   events.push(jobEvent('CoffeeJobDelivered',j,{...next,deliveredAt:c.recordedAt}),changed('CupHandedOff',cs,{ownerKind:'customer',ownerId:targetId,slot:null,epoch:cup.epoch+1,
    movements:[...cup.movements,{transferId:stableId('handoff',c,job.jobId),from:ownerOf(cup),to,provenance:'human',observedBy:c.actorRef,at:c.recordedAt}] as unknown as JsonObject[]}));
  }
 }
 return events;
}

/** A manual delivery confirmation attests the waiter's pickup and customer handoff in the same transaction as served quantity. */
export function coffeeManualHandoffEvents(c:CommandEnvelope,s:Snapshot[],allocation:Snapshot):DomainEvent[] {
 const jobs=all(s,'coffee-job').filter(j=>j.state.lineId===allocation.state.lineId);
 if(!jobs.length)return [];
 const count=BigInt(String(allocation.state.quantity));
 const bound=allocation.state.coffeeJobIds as string[]|undefined;
 const others=new Set(all(s,'allocation').filter(a=>a.ref.id!==allocation.ref.id&&['reserved','loaded','served'].includes(String(a.state.status))).flatMap(a=>(a.state.coffeeJobIds??[]) as string[]));
 const ready=jobs.filter(j=>{
  const job=asJob(j),cup=find(s,'cup',job.cupId)?.state as unknown as Cup|undefined;
  return (!bound||bound.includes(j.ref.id))&&!others.has(j.ref.id)&&job.status==='ready_for_pickup'&&cup?.ownerKind==='cell'&&cup.ownerId===job.cellId&&cup.present===true&&!cup.pendingTransfer;
 }).sort((a,b)=>a.ref.id.localeCompare(b.ref.id));
 if(BigInt(ready.length)<count)return fail('COFFEE_HANDOFF_NOT_READY');
 const session=requireState(s,'session',String(allocation.state.sessionId)),to:Party={kind:'customer',id:text(session.state.tableId)},human:Party={kind:'human',id:c.actorRef};
 return ready.slice(0,Number(count)).flatMap(j=>{
  const job=asJob(j),cs=requireState(s,'cup',job.cupId),cup=cs.state as unknown as Cup,next=decided(j,{type:'Fulfillment.HandOff',payload:{}}).job!;
  const evidence={allocationId:allocation.ref.id,confirmation:'Fulfillment.HandOff'},common={provenance:'human',observedBy:c.actorRef,at:c.recordedAt,evidence};
  return [jobEvent('CoffeeJobDelivered',j,{...next,leases:[],deliveredAt:c.recordedAt,deliveredBy:c.actorRef,deliveryAllocationId:allocation.ref.id}),
   changed('CupHandedOff',cs,{ownerKind:to.kind,ownerId:to.id,slot:null,epoch:cup.epoch+2,present:false,
    movements:[...cup.movements,{...common,transferId:stableId('manual-pickup',c,job.jobId),from:ownerOf(cup),to:human},{...common,transferId:stableId('manual-handoff',c,job.jobId),from:human,to}] as unknown as JsonObject[]}),
   ...release(c,s,job.leases,job.jobId)];
 });
}
