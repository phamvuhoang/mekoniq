// Coffee scenario support for the mock runner: server-owned illustrative recipes (same bytes as lab/fixtures/recipes/*.json) and the coffee cell driver.
// Volumes/masses/times are illustrative (provenance 'illustrative'), canonical SI (m3, kg); nothing here is a hardware-ready value.
import {join} from 'node:path';
import {hashJson} from '../hash';
import {createCupLedger,type CupLedger,type PendingTransferIdentity,type TransferObservation,type CorrelatedTransferEvidence} from '../beverage/cup-ledger';
import type {JsonObject} from '../../../../contracts/src/index';
import {recipeHash,type CoffeeRecipe} from '../../../../domain/src/beverage/recipe';
import type {CommandResult} from '../../../../contracts/src/index';
import {MockCoffeePlant,type CoffeePlantState,type CoffeeFault} from '../../../../cell-adapters/src/mock-coffee';
import {MockArmPlant,type ArmPlantState,type ArmFault} from '../../../../cell-adapters/src/mock-arm';
import {createMockCoffeePorts,type CoffeePlantPorts} from '../beverage/coffee-ports';
import {dispatchCellEffects,cellReportPayload} from '../../../../cell-adapters/src/dispatch';
import type {CellReport} from '../../../../cell-adapters/src/contract';
import {PUMA560_SI,MOCK_KINEMATIC} from '../models/arm-kinematics';
import type {ArmSceneSnapshot} from '../models/arm-scene';
import type {SourceSession} from '../session';
import type {Attention,CoffeeReport,CoffeeView} from '../report';
const q=(amount:string,tolerance:string,unit:'kg'|'m3')=>({amount,tolerance,unit,provenance:'illustrative'});
const withHash=(r:Omit<CoffeeRecipe,'hash'>):CoffeeRecipe=>({...r,hash:recipeHash(r as unknown as JsonObject)} as CoffeeRecipe);
const base={schemaVersion:2 as const,revision:2,cupType:'cup-paper-illustrative',recovery:{onTimeout:'hold_and_reconcile',autoRetry:false as const}};
const cupPolicy={revision:1,provenance:'illustrative' as const,capacityM3:'0.0003',headspaceM3:'0.00002',iceVolumeM3PerKg:'0.0011'};
const milkPolicy={revision:1,provenance:'illustrative' as const,maxOpenMs:14400000,minTemperatureK:'273.15',maxTemperatureK:'278.15',temperatureMaxAgeMs:10000};
const measurementPolicy={revision:1,provenance:'illustrative' as const,maxTargetMultiplier:'2'};
/** 30 ml shot (3e-5 m3 +/- 3e-6) from 18 g beans; no ice or milk step exists. */
export const ESPRESSO:CoffeeRecipe=withHash({...base,id:'espresso',outputType:'espresso',policies:{cup:cupPolicy,measurement:measurementPolicy},
 steps:[{id:'brew',kind:'brew',target:q('0.00003','0.000003','m3'),requires:['machine'],timeoutMs:40000}],
 resources:[{resourceId:'coffee-beans',kind:'coffee_beans',requiredAmount:q('0.018','0.001','kg')},{resourceId:'cup-paper',kind:'cup',requiredAmount:null},{resourceId:'machine',kind:'machine',requiredAmount:null}]});
/** Shot, then 120 g ice, then 80 ml milk: this recipe's own order. */
export const ICED_MILK_COFFEE:CoffeeRecipe=withHash({...base,id:'iced-milk-coffee',outputType:'iced-milk-coffee',policies:{cup:cupPolicy,milk:milkPolicy,measurement:measurementPolicy},
 steps:[{id:'brew',kind:'brew',target:q('0.00003','0.000003','m3'),requires:['machine'],timeoutMs:40000},{id:'add_ice',kind:'add_ice',target:q('0.12','0.01','kg'),requires:['ice'],timeoutMs:15000},{id:'add_milk',kind:'add_milk',target:q('0.00008','0.000008','m3'),requires:['milk'],timeoutMs:15000}],
 resources:[{resourceId:'coffee-beans',kind:'coffee_beans',requiredAmount:q('0.018','0.001','kg')},{resourceId:'ice',kind:'ice',requiredAmount:q('0.12','0.01','kg')},{resourceId:'milk',kind:'milk',requiredAmount:q('0.00008','0.000008','m3')},{resourceId:'cup-paper',kind:'cup',requiredAmount:null},{resourceId:'machine',kind:'machine',requiredAmount:null}]});
export const COFFEE_RECIPES:readonly CoffeeRecipe[]=[ESPRESSO,ICED_MILK_COFFEE];

// ---- Coffee cell driver: scripted barista/guest inputs, cell outbox dispatch, mock plants and their observations, all through the run's source session ----
/** Illustrative dock tolerance for the tray receiver (metres). */
export const DOCK_TOLERANCE_M=0.05;
/** Mock-only wait policy, fixed in the run manifest. Timeouts hold custody/resources for human disposition; they never retry a physical effect. */
export const COFFEE_POLICY={revision:1,interlockTimeoutTicks:1500,pickupTimeoutTicks:6000,provenance:'illustrative'} as const;
export const COFFEE_FAULTS:readonly string[]=['ice-jam','milk-empty','dose-low','measure-unknown','measure-missing','measure-outlier','milk-expired','milk-warm','milk-unknown','cup-removed','coffee-reboot','drop-ack','duplicate-completion','machine-not-ready'];
export const ARM_FAULTS:readonly string[]=['arm-reboot','arm-drop','arm-following-error','arm-stop','arm-estop','arm-reset','arm-collision'];
/** Interlock codes that clear by themselves once the device reports ready again. */
export const TRANSIENT_INTERLOCK:readonly string[]=['MACHINE_NOT_READY','DEVICE_NOT_READY','INTERLOCK_STALE'];
export interface CoffeeWork {actor:string;tableId:string;recipeId:string;atTick:number;jobId:string;cupId:string;status:'planned'|'ordered'|'reserved'|'done'|'held';lineId?:string;
 /** Transient interlock code the next step is waiting on (machine warming, device not ready, stale status); retried, never latched. */
 waiting?:string;waitingSinceTick?:number;pickupSinceTick?:number;missionId?:string;cupReportTick?:number;allocated?:boolean;allocationId?:string}
export interface CoffeeState {stationId:string;cellId:string;armId:string;registered:boolean;sessions:Record<string,string>;workload:CoffeeWork[];plant:CoffeePlantState;arm:ArmPlantState;trays:Record<string,string>}
export interface CoffeeContext {
 source:SourceSession;runId:string;directory?:string;nowMs():number;tick():number;
 armScene?():ArmSceneSnapshot;
 submit(type:string,payload:JsonObject,observer?:string):Promise<CommandResult>;
 must(type:string,payload:JsonObject):Promise<CommandResult>;
 /** Robot of this run docked at the pickup point (pose within tolerance, not moving), as the tray receiver. */
 receiver():{robotId:string;slot:number}|null;
 /** Pose of the run's robot relative to the pickup point, from the AMR plant (receiver-side evidence). */
 dock():{robotId:string;errorM:number;moving:boolean;localizationValid:boolean;bootId:string};
 confirmLoad(missionId:string,stopId:string,robotId:string):Promise<void>;
 createMission(allocationId:string):Promise<string|null>;
 attention(a:Omit<Attention,'tick'>):void;
 rejected(r:{eventId:string;commandId:string;type:string;code:string}):void;
 suspend?():void;
}
const recipeById=(id:string)=>COFFEE_RECIPES.find(r=>r.id===id)??(()=>{throw new Error('RECIPE_UNKNOWN');})();
export function initialCoffee(orders:readonly {actor:string;table:number;recipe:string;atTick:readonly [number,number]}[],roles:{stationId:string;cellId:string;armId:string},tables:string[],draw:(actor:string,range:readonly [number,number])=>number):CoffeeState {
 for(const o of orders)recipeById(o.recipe);
 return {...roles,registered:false,sessions:{},trays:{},plant:MockCoffeePlant.initial(roles.cellId),arm:MockArmPlant.initial(roles.armId),
  workload:orders.map((o,i)=>({actor:o.actor,tableId:tables[o.table]!,recipeId:o.recipe,atTick:draw(o.actor,o.atTick),jobId:`coffee-job-${i+1}`,cupId:`cup-${i+1}`,status:'planned'}))};
}
export class CoffeeDriver {
 readonly plant:MockCoffeePlant;readonly arm:MockArmPlant|null;readonly ports:CoffeePlantPorts;private ledger?:CupLedger;
 recoveryHeld=false;private recoveryReasons=new Set<string>();
 constructor(readonly st:CoffeeState,private ctx:CoffeeContext,newBootId:()=>string,ports?:CoffeePlantPorts){
  this.ports=ports??createMockCoffeePorts(st,ctx,newBootId);
  this.plant=this.ports.coffeePlant??new MockCoffeePlant(this.ports.snapshot().coffee,ctx.nowMs,newBootId);
  this.arm=this.ports.snapshot().arm===null?null:this.ports.mockArm??null;
  st.plant=this.plant.state;
  if(this.ports.snapshot().arm===null){
   if(!ctx.directory||!this.ports.bindLedger)throw new Error('NATIVE_CUP_JOURNAL_REQUIRED');
   this.ledger=createCupLedger({path:join(ctx.directory,'cup-ledger.sqlite'),runId:ctx.runId,nowMonotonicNs:()=>process.hrtime.bigint(),freshnessNs:500000000n,dockToleranceM:DOCK_TOLERANCE_M,
    domain:cupId=>this.domainCup(cupId),confirm:(e,p)=>this.confirmPhysical(e,p),
    dock:()=>{const d=ctx.dock();return {robotId:d.robotId,slot:ctx.receiver()?.slot??1,bootId:d.bootId,stationary:!d.moving,localizationValid:d.localizationValid,errorM:d.errorM,receivedMonotonicNs:String(process.hrtime.bigint())};}});
   this.ports.bindLedger(this.ledger);
  }
 }
 private async domainCup(cupId:string){
  const cup=(await this.ctx.source.read('cup',cupId)).state,p=cup.pendingTransfer as JsonObject|null;
  const parent=cup.ownerKind==='cell'?`cell:${String(cup.ownerId)}/nozzle`:cup.ownerKind==='arm'?`arm:${String(cup.ownerId)}/tcp`:cup.ownerKind==='robot'?`robot:${String(cup.ownerId)}/tray:${String(cup.slot)}`:cup.ownerKind==='customer'?`table:${String(cup.ownerId)}`:null;
  return {parent,pending:p?{runId:this.ctx.runId,cupId,transferId:String(p.transferId),commandId:String(p.commandId),payloadHash:String(p.payloadHash),controlEpoch:Number(p.controlEpoch),deviceId:this.st.armId,to:p.to as unknown as PendingTransferIdentity['to']}:null};
 }
 private async confirmPhysical(value:TransferObservation|CorrelatedTransferEvidence,p:PendingTransferIdentity){
  const paired='giver' in value,observations=paired?[value.giver,value.receiver]:[value];
  for(const observation of observations){
   const side=paired?(observation.phase==='release'?'giver':'receiver'):undefined;
   const current=(await this.ctx.source.read('cup',p.cupId)).state.pendingTransfer as JsonObject|null;
   if(!current)return;
   const prior=side?current[side] as JsonObject|undefined:undefined;
   if(prior?.bootId===observation.bootId&&prior?.seq===observation.seq)continue;
   const payload:JsonObject={stationId:this.st.stationId,transferId:p.transferId,cupId:p.cupId,provenance:'sensor',...side?{side}:{},evidence:{commandId:p.commandId,transferId:p.transferId,bootId:observation.bootId,seq:observation.seq,observedAt:new Date(this.ctx.nowMs()).toISOString(),producer:observation.producer,fidelity:observation.fidelity,
    ...paired?side==='giver'?{released:true}:{receiverPresent:true,dockInTolerance:true,poseErrorM:value.dock.errorM}:{gripperClosed:observation.grip!.closed,objectPresent:observation.grip!.objectPresent,liftPoseReached:observation.liftPoseReached===true}}};
   const result=await this.ctx.source.submit('Cup.ConfirmTransfer',payload,`cup-proof:${hashJson({id:observation.observationId,side:side??'grasp'})}`,observation.deviceId);
   if(result.status!=='accepted')throw new Error(`TRANSFER_REJECTED:${String(result.code)}`);
  }
  const domain=await this.domainCup(p.cupId);if(!domain.pending&&domain.parent)await this.ports.custodyResolved?.(p.cupId,domain.parent);
 }
 private expectedRecovery(error:unknown){return error instanceof Error&&/^(CUP_RECONCILE_REQUIRED:|INVALID_TRANSFER_EVIDENCE:|INVALID_TRANSFER_OBSERVATION:|TRANSFER_EVIDENCE_INCOMPLETE:|TRANSFER_REJECTED:|TRANSFER_REPORT_IDENTITY_MISMATCH$|OBSERVATION_ID_CONFLICT$|CUP_EPOCH_REPLAY$|CUP_SEQUENCE_REORDERED$|CUP_SEQUENCE_TIME_REORDERED$)/.test(error.message);}
 private recoveryAttention(reason:string,commandId?:string){
  this.recoveryHeld=true;this.ctx.suspend?.();
  if(!this.recoveryReasons.has(reason)){this.recoveryReasons.add(reason);this.ctx.attention({reason,...commandId?{commandId}:{}});}
 }
 private async recoverPlants(){
  for(const recover of [()=>this.ports.recover(),()=>this.ledger?.recover()]){
   try{await recover();}catch(error){if(!this.expectedRecovery(error))throw error;this.recoveryAttention((error as Error).message);}
  }
  await this.drain();
 }
 async initialize(){if(this.ledger)await this.recoverPlants();}
 static recipes(orders:readonly {recipe:string}[]){return [...new Set(orders.map(o=>o.recipe))].map(id=>({id}));}
 ownsMission(missionId:string){return this.st.workload.some(w=>w.missionId===missionId);}
 ownsLoad(missionId:string,targetId:string){return targetId===this.st.stationId&&this.ownsMission(missionId);}
 ownsJob(jobId:string){return this.st.workload.some(w=>w.jobId===jobId);}
 done(){return this.st.workload.every(w=>w.status==='done');}
 private job(w:CoffeeWork){return this.ctx.source.read('coffee-job',w.jobId).then(s=>s.state);}
 async scripted(){
  if(this.recoveryHeld)return;
  const st=this.st,ctx=this.ctx,tick=ctx.tick(),station=st.stationId;
  if(!st.registered){for(const r of CoffeeDriver.recipes(st.workload.map(w=>({recipe:w.recipeId}))))await ctx.must('Coffee.RegisterRecipe',{recipe:recipeById(r.id) as unknown as JsonObject});st.registered=true;}
  for(const w of st.workload){
   if(w.status==='planned'&&w.atTick<=tick){
    let sessionId=st.sessions[w.tableId];
    if(!sessionId){
     const table=await ctx.source.read('table',w.tableId);sessionId=typeof table.state.activeSessionId==='string'?table.state.activeSessionId:`coffee-session-${w.tableId}`;
     if(!table.state.activeSessionId)await ctx.must('Session.Open',{sessionId,tableId:w.tableId});st.sessions[w.tableId]=sessionId;
    }
    const placed=await ctx.must('Order.Place',{sessionId,tableId:w.tableId,menuVersion:1,items:[{itemId:w.recipeId,quantity:'1'}]});
    w.lineId=(placed.value.lineIds as string[])[0]!;w.status='ordered';
   }
   if(w.status==='ordered'){
    const recipe=recipeById(w.recipeId),r=await ctx.submit('Coffee.ReserveJob',{stationId:station,jobId:w.jobId,lineId:w.lineId!,cellId:st.cellId,recipe:{id:recipe.id,revision:recipe.revision,hash:recipe.hash},cupId:w.cupId});
    if(r.status==='accepted'){w.status='reserved';this.plant.placeCup(w.cupId,recipe.cupType);w.cupReportTick=tick;}
    else if(!['RESOURCE_HELD','INSUFFICIENT_STOCK'].includes(String(r.code))){w.status='held';ctx.attention({reason:'COFFEE_RESERVE_REJECTED',subjectId:w.jobId,commandId:String(r.code)});}
    continue;
   }
   if(w.status!=='reserved')continue;
   const job=await this.job(w),status=String(job.status),steps=job.steps as JsonObject[];
   if(w.waitingSinceTick!==undefined&&tick-w.waitingSinceTick>=COFFEE_POLICY.interlockTimeoutTicks){await this.hold(w,'INTERLOCK_TIMEOUT');continue;}
   if(status==='ready_for_pickup'||status==='transferring'){
    w.pickupSinceTick??=tick;
    if(tick-w.pickupSinceTick>=COFFEE_POLICY.pickupTimeoutTicks){
     if(this.ledger){const p=(await this.domainCup(w.cupId)).pending;if(p){const phase=p.to.kind==='arm'?'grasp':'release';const observed=this.ledger.observations().some(o=>o.commandId===p.commandId&&o.transferId===p.transferId&&o.payloadHash===p.payloadHash&&o.controlEpoch===p.controlEpoch&&o.quality==='valid'&&o.phase===phase&&(phase!=='grasp'||o.liftPoseReached===true));if(!observed)ctx.attention({reason:phase==='grasp'?'GRIP_EVIDENCE_MISSING':'RELEASE_EVIDENCE_MISSING',subjectId:w.jobId});}}
     await this.hold(w,'PICKUP_TIMEOUT');continue;
    }
   }
   if(status==='reserved'){if(tick-(w.cupReportTick??0)>=25){this.plant.reportCup();w.cupReportTick=tick;}continue;}
   if(status==='cup_verified'){
    const r=await ctx.submit('Coffee.StartJob',{stationId:station,jobId:w.jobId});
    if(r.status==='accepted'){delete w.waiting;delete w.waitingSinceTick;}
    else if(TRANSIENT_INTERLOCK.includes(String(r.code))){w.waiting=String(r.code);w.waitingSinceTick??=tick;}
   }
   const late=steps.find(s=>s.status==='running'&&typeof s.startedAt==='string'&&ctx.nowMs()-Date.parse(s.startedAt)>=(recipeById(w.recipeId).steps.find(x=>x.id===s.id)?.timeoutMs??Infinity));
   if(late){await ctx.submit('Coffee.StepTimeout',{stationId:station,jobId:w.jobId,stepId:String(late.id)});continue;}
   if((status==='started'||status==='dispensing')&&!steps.some(s=>s.status==='running'||s.status==='unknown')){
    const next=steps.find(s=>s.status==='pending');
    // a transient interlock (warming, not ready, stale status) waits visibly and is retried; any other refusal (empty, fault, cleaning due) holds the job
    if(next){const r=await ctx.submit('Coffee.StartStep',{stationId:station,jobId:w.jobId,stepId:String(next.id)});
     if(r.status==='accepted'){delete w.waiting;delete w.waitingSinceTick;}
     else if(TRANSIENT_INTERLOCK.includes(String(r.code))){w.waiting=String(r.code);w.waitingSinceTick??=tick;if(tick-w.waitingSinceTick>=COFFEE_POLICY.interlockTimeoutTicks)await this.hold(w,'INTERLOCK_TIMEOUT');}
     else{delete w.waiting;w.status='held';ctx.attention({reason:'COFFEE_STEP_BLOCKED',subjectId:w.jobId,commandId:String(r.code)});}}
   }
   else if(status==='verifying'){const q=await ctx.submit('Coffee.ConfirmQuality',{stationId:station,jobId:w.jobId});if(q.status!=='accepted'){w.status='held';ctx.attention({reason:'QUALITY_REJECTED',subjectId:w.jobId,commandId:String(q.code)});}}
   else if(status==='ready_for_pickup'){
    if(!w.allocationId){const line=await ctx.source.read('fulfillment',w.lineId!),a=await ctx.must('Fulfillment.Allocate',{lineId:w.lineId!,quantity:'1',expectedVersion:line.version,method:'robot'});w.allocationId=String(a.value.allocationId);}
    if(!w.missionId){const missionId=await ctx.createMission(w.allocationId);if(!missionId)continue;w.missionId=missionId;w.allocated=true;}
    const machine=this.st.plant.devices.find(d=>d.role==='machine'),cup=this.st.plant.cups.find(c=>c.cupId===w.cupId);
    if(machine?.status!=='ready'||!cup||cup.at!=='nozzle'||steps.some(s=>s.status!=='completed')){await this.hold(w,machine?.status==='fault'?'MACHINE_FAULT':machine?.status!=='ready'?'MACHINE_NOT_READY':!cup||cup.at!=='nozzle'?'CUP_ABSENT':'BREW_NOT_COMPLETE');continue;}
    await ctx.submit('Cup.RequestTransfer',{stationId:station,transferId:`${w.jobId}:pick`,cupId:w.cupId,jobId:w.jobId,to:{kind:'arm',id:st.armId}});
   }
   else if(status==='transferring'){
    const cup=(await ctx.source.read('cup',w.cupId)).state,m=(await ctx.source.read('mission',w.missionId!)).state,stop=(m.stops as JsonObject[]).find(s=>s.id===m.currentStopId);
    const atLoad=stop?.action==='load'&&stop.status==='awaiting_action'&&typeof m.robotId==='string';
    if(!atLoad||cup.pendingTransfer)continue;
    if(cup.ownerKind==='arm'&&ctx.receiver())await ctx.submit('Cup.RequestTransfer',{stationId:station,transferId:`${w.jobId}:place`,cupId:w.cupId,jobId:w.jobId,to:{kind:'robot',id:String(m.robotId),slot:1}});
    else if(cup.ownerKind==='robot'&&cup.ownerId===m.robotId)await ctx.confirmLoad(w.missionId!,String(stop!.id),String(m.robotId));
   }
   else if(status==='delivered'){await this.ports.custodyResolved?.(w.cupId,`table:${w.tableId}`);w.status='done';}
  }
 }
 private async hold(w:CoffeeWork,reason:string){
  w.status='held';w.waiting=reason;this.ctx.attention({reason,subjectId:w.jobId});
  // Domain cancellation retains poured/unknown cups and irreversible consumption for explicit reconciliation.
  const r=await this.ctx.submit('Coffee.CancelJob',{stationId:this.st.stationId,jobId:w.jobId,reason});
  if(r.status!=='accepted')this.ctx.attention({reason:'COFFEE_CANCEL_REJECTED',subjectId:w.jobId,commandId:String(r.code)});
 }
 async dispatch(){if(this.recoveryHeld)return;if((await this.ctx.source.effects()).some(e=>e.type==='cell.execute'&&!['confirmed','failed'].includes(String(e.status))))await dispatchCellEffects(this.ctx.source.store,this.ctx.source.scope,this.ports.adapters,this.ctx.nowMs(),this.ctx.runId);}
 async advance(){if(this.ctx.armScene)this.ports.setArmScene?.(this.ctx.armScene());await this.ports.advance();}
 async drain(){
  const st=this.st,ctx=this.ctx;
  const reports=[...this.ports.drain()];
  while(reports.length){
   const r=reports.shift()!,id=`${r.deviceId}#${r.bootId}#${r.seq}`;
   if(r.cup){
    const w=r.cup.present?st.workload.find(x=>x.cupId===r.cup!.cupId):st.workload.find(x=>x.status==='reserved'&&st.plant.cups.some(c=>c.cupId===x.cupId&&c.at==='removed'));
    if(!w)continue;
    const res=await ctx.submit('Coffee.ObserveCup',{stationId:st.stationId,jobId:w.jobId,deviceId:r.deviceId,bootId:r.bootId,seq:r.seq,observedAt:r.observedAt,cupId:r.cup.cupId??w.cupId,cupType:r.cup.cupType??recipeById(w.recipeId).cupType,present:r.cup.present},r.deviceId);
    if(res.status!=='accepted'){
     ctx.rejected({eventId:id,commandId:'',type:'cup',code:String(res.code)});
     if(TRANSIENT_INTERLOCK.includes(String(res.code))){w.waiting=String(res.code);w.waitingSinceTick??=ctx.tick();}
    }else{delete w.waiting;delete w.waitingSinceTick;}
    continue;
   }
   const transferObservation=r.evidence?.transferObservation as TransferObservation|undefined;
   const replay=transferObservation&&this.ledger?.observations().some(o=>o.observationId===transferObservation.observationId);
   if(!(this.ledger&&(r.observation?.result==='accepted'||transferObservation?.phase==='receive'||replay))){
   const res=await ctx.submit('Coffee.ObserveDevice',cellReportPayload(r,st.stationId),r.deviceId);
   if(res.status!=='accepted')ctx.rejected({eventId:id,commandId:r.observation?.commandId??'',type:r.observation?.result??'status',code:String(res.code)});
   }
   if(this.ledger&&r.observation)for(const reason of r.observation.reasonCodes)if(['RECOVERY_UNKNOWN','COMPLETION_PROOF_RECOVERY_REQUIRED','COMPLETION_PROOF_MISSING'].includes(reason))this.recoveryAttention(reason,r.observation.commandId);
   if(this.ledger&&r.evidence?.transferObservation){
    const observation=r.evidence.transferObservation as TransferObservation;
    try{
     if(['deviceId','bootId','seq'].some(k=>r[k as 'deviceId'|'bootId'|'seq']!==observation[k as 'deviceId'|'bootId'|'seq'])||r.observation&&['deviceId','bootId','seq','commandId','payloadHash','controlEpoch'].some(k=>r.observation![k as keyof NonNullable<CellReport['observation']>]!==observation[k as keyof TransferObservation]))throw new Error('TRANSFER_REPORT_IDENTITY_MISMATCH');
     await this.ledger.ingest(observation);
     await this.ports.acknowledgeCompletion?.(observation.commandId,observation.observationId);
    }catch(e){if(!this.expectedRecovery(e))throw e;const reason=(e as Error).message;this.recoveryAttention(reason.includes('DOCK_OUT_OF_TOLERANCE')?'DOCK_OUT_OF_TOLERANCE':reason);for(const w of st.workload)if(w.cupId===observation.cupId)w.status='held';}
   }
   if(!this.ledger&&r.evidence&&r.observation?.result==='completed'){
    for(const w of st.workload){
     const cup=(await ctx.source.read('cup',w.cupId).catch(()=>null))?.state,pending=cup?.pendingTransfer as JsonObject|null|undefined;
     if(pending?.commandId!==r.observation.commandId)continue;
     const tray=(pending.to as JsonObject).kind==='robot',transferId=String(pending.transferId);
     const c=await ctx.submit('Cup.ConfirmTransfer',{stationId:st.stationId,transferId,cupId:w.cupId,provenance:'sensor',...tray?{side:'giver'}:{},evidence:{commandId:r.observation.commandId,bootId:r.bootId,seq:r.seq,observedAt:r.observedAt,...r.evidence} as JsonObject},r.deviceId);
     if(c.status!=='accepted'){w.status='held';ctx.attention({reason:'TRANSFER_REJECTED',subjectId:w.jobId,commandId:String(c.code)});continue;}
     if(tray){
      // receiver side from the AMR plant: is the cup on its tray, and is it stopped within the dock tolerance at the pickup point?
      const k=ctx.dock();
      if(k.moving||!Number.isFinite(k.errorM)||k.errorM<0||k.errorM>DOCK_TOLERANCE_M){w.status='held';ctx.attention({reason:'DOCK_OUT_OF_TOLERANCE',subjectId:w.jobId});continue;}
      if(!k.localizationValid){w.status='held';ctx.attention({reason:'LOCALIZATION_LOST',subjectId:w.jobId});continue;}
      const rc=await ctx.submit('Cup.ConfirmTransfer',{stationId:st.stationId,transferId,cupId:w.cupId,provenance:'sensor',side:'receiver',
       evidence:{transferId,bootId:k.bootId,seq:String(ctx.tick()),observedAt:new Date(ctx.nowMs()).toISOString(),receiverPresent:st.trays[k.robotId]===w.cupId,dockInTolerance:!k.moving&&k.errorM<=DOCK_TOLERANCE_M,poseErrorM:k.errorM,source:'mock_amr'}},k.robotId);
      if(rc.status!=='accepted'){w.status='held';ctx.attention({reason:'TRANSFER_REJECTED',subjectId:w.jobId,commandId:String(rc.code)});}
     }
    }
   }
  }
  for(const w of st.workload)if(w.status==='reserved'){const j=await this.job(w);if(j.status==='needs_attention'){w.status='held';ctx.attention({reason:String(j.attentionReason),subjectId:w.jobId});}}
 }
 /** Run cancel: cancel each open coffee mission (cargo gets a return stop) and job; the domain decides cancelled, returning or held. Never resends. */
 async cancel(){
  const st=this.st,ctx=this.ctx,open=['reserved','cup_verified','started','dispensing','verifying','ready_for_pickup','transferring','loaded'];
  for(const w of st.workload){
   if(w.missionId){const m=await ctx.source.read('mission',w.missionId);if(!['completed','cancelled','failed','cancelling'].includes(String(m.state.status))){const r=await ctx.submit('Mission.Cancel',{missionId:w.missionId,expectedVersion:m.version});if(r.status!=='accepted')ctx.attention({reason:'CANCEL_REJECTED',subjectId:w.missionId,commandId:String(r.code)});}}
   const j=await ctx.source.read('coffee-job',w.jobId).catch(()=>null);
   if(j?.version&&open.includes(String(j.state.status))){const r=await ctx.submit('Coffee.CancelJob',{stationId:st.stationId,jobId:w.jobId,reason:'Lab run cancelled'});if(r.status!=='accepted')ctx.attention({reason:'COFFEE_CANCEL_REJECTED',subjectId:w.jobId,commandId:String(r.code)});}
   if(w.status==='planned'||w.status==='ordered')w.status='held';
  }
 }
 async fault(faultId:string){if(ARM_FAULTS.includes(faultId))this.arm?.fault(faultId as ArmFault);else this.plant.fault(faultId as CoffeeFault);await this.drain();}
 private canRestoreCup(w:CoffeeWork,job:JsonObject){const cup=this.st.plant.cups.find(c=>c.cupId===w.cupId);return job.status==='reserved'&&(job.steps as JsonObject[]).every(s=>s.status==='pending')&&cup?.at==='removed'&&cup.liquidUl===0&&cup.iceMg===0&&!this.st.plant.commands.some(c=>c.cupId===w.cupId);}
 async canRestoreJob(jobId:string){const w=this.st.workload.find(w=>w.jobId===jobId);return !!w&&this.canRestoreCup(w,await this.job(w));}
 async restoreCup(jobId:string){
  const w=this.st.workload.find(w=>w.jobId===jobId);if(!w||!this.canRestoreCup(w,await this.job(w)))throw new Error('INVALID_STATE:CUP_RESTORE_UNSAFE');
  this.plant.restoreCup(w.cupId,recipeById(w.recipeId).cupType);await this.drain();
 }
 /** Crash recovery: device commands in flight are unknown under a new boot; nothing is resent. */
 async recover(){
  await this.recoverPlants();
 }
 /** Human reconciliation of one job: audit the device answer by command id, then Coffee.Reconcile. Never resends. */
 async reconcile(jobId:string){
  const w=this.st.workload.find(x=>x.jobId===jobId)!,job=await this.job(w),cup=(await this.ctx.source.read('cup',w.cupId)).state;
  const step=(job.steps as JsonObject[]).find(s=>s.status==='running'||s.status==='unknown'),pending=cup.pendingTransfer as JsonObject|null;
  const commandId=step?String(step.commandId):pending?String(pending.commandId):null;
  const nativeState=commandId?(step?this.plant.reconcile(commandId):await this.ports.adapters[1]!.reconcile(commandId)).status:'idle';
  const r=await this.ctx.submit('Coffee.Reconcile',{stationId:this.st.stationId,jobId,disposition:'discard',reason:'Lab reconcile action (human provenance)',provenance:'human'});
  if(r.status!=='accepted')this.ctx.attention({reason:'RECONCILE_REJECTED',subjectId:jobId,commandId:String(r.code)});
  return {subjectId:jobId,commandId,nativeState};
 }
 async view():Promise<CoffeeView>{
  const jobs=[],cups=[];
  for(const w of this.st.workload){
   // a job/cup the source has not created yet (order placed, reservation pending) is absent, not a row of "undefined"
   const j=await this.ctx.source.read('coffee-job',w.jobId).catch(()=>null);if(!j?.version)continue;
   const cup=await this.ctx.source.read('cup',w.cupId),c=cup.state;if(!cup.version)continue;
   jobs.push({jobId:w.jobId,status:String(j.state.status),recipeId:String(j.state.recipeId),cupId:w.cupId,attentionReason:(j.state.attentionReason??null) as string|null,waitingReason:w.waiting??null,canRestoreCup:this.canRestoreCup(w,j.state)});
   cups.push({cupId:w.cupId,ownerKind:String(c.ownerKind),ownerId:String(c.ownerId)});
  }
  return {jobs,cups};
 }
 async close(){try{await this.ports.close();}finally{this.ledger?.close();this.ledger=undefined;}}
 async report():Promise<CoffeeReport>{
  const jobs:JsonObject[]=[],cups:CoffeeReport['cups']=[];
  for(const w of this.st.workload){const j=await this.ctx.source.read('coffee-job',w.jobId).catch(()=>null),cup=await this.ctx.source.read('cup',w.cupId);if(!j?.version||!cup.version)continue;jobs.push(j.state);cups.push(cup.state as unknown as CoffeeReport['cups'][number]);}
  return {jobs,cups,cellEffects:(await this.ctx.source.effects()).filter(e=>e.type==='cell.execute').map(e=>({id:String(e.id),type:String(e.type),status:String(e.status),attempts:Number(e.attempts),payload:e.payload as JsonObject})),
   armTrace:{tag:MOCK_KINEMATIC,interpolation:'linear_joint_illustrative',modelRevision:PUMA560_SI.revision,limitsOk:this.arm?this.st.arm.limitsOk:false,samples:this.arm?structuredClone(this.st.arm.trace):[],collision:this.arm?structuredClone(this.st.arm.collision??null):null,stop:this.arm?structuredClone(this.st.arm.stop??null):null},plantLog:structuredClone(this.st.plant.log) as unknown as JsonObject[]};
 }
}
