// Beverage plant session (plan 02 task 6): coffee_io_sim process model + the F04 mock arm + the physical cup attachment ledger of one run.
// Custody is the source domain's; this session only reports what the plant did (attachment transforms with model provenance) and builds
// transfer evidence that is complete or refused. Coupling is open_loop_visualization with the mock arm; with the plan 03 LinuxCNC adapter +
// arm session it is closed_loop_controller (controller feedback, geometric checker); grip evidence then comes from the controller's events.
import {convertPow10,format} from '../../../../domain/src/shared/exact-decimal';
import {MockArmAdapter,MockArmPlant,type ArmPlantState} from '../../../../cell-adapters/src/mock-arm';
import {CoffeeIoSimAdapter,COFFEE_IO_SIM} from '../../../../cell-adapters/src/coffee-io-sim';
import type {CellAdapter,CellReport} from '../../../../cell-adapters/src/contract';
import type {MockCoffeePlant,CoffeePlantState} from '../../../../cell-adapters/src/mock-coffee';
import {PUMA560_SI} from '../models/arm-kinematics';
import {DEFAULT_ARM_GEOMETRY} from '../models/arm-collision';
import type {ArmSession} from '../arm/session';
import type {CoffeePlantPorts} from './coffee-ports';
import type {ArmObstacle} from '../models/arm-collision';
import {applyCupObservation,type CupLedger,type CupPhysicalState,type TransferObservation} from './cup-ledger';
/** Illustrative frames: nozzle offset in the cell base, tray slots on the service AMR (lab/fixtures/catalog), density of the mixed drink. */
export const PLANT_FRAMES={nozzleOffsetM:[0,0.1,0.05] as const,traySlotZM:(slot:number)=>0.5+0.31*(slot-1),gripperLengthM:DEFAULT_ARM_GEOMETRY.gripperLengthM,provenance:'illustrative'} as const;
export const LIQUID_MODEL={densityKgPerM3:1030n,cupCapacityM3:'0.0003',provenance:'modelled'} as const;
export interface JointAuthority {joint:string;controller:string}
export function assertSingleJointAuthority(publishers:readonly JointAuthority[]):void{
 const byJoint=new Map<string,Set<string>>();
 for(const p of publishers)(byJoint.get(p.joint)??byJoint.set(p.joint,new Set()).get(p.joint)!).add(p.controller);
 for(const [joint,controllers] of byJoint)if(controllers.size>1)throw new Error(`JOINT_AUTHORITY_CONFLICT:${joint}`);
}
export interface DockState {robotId:string;errorM:number;moving:boolean;localizationValid:boolean;bootId:string}
export interface PlantSessionOptions {runId:string;cellId:string;armId:string;nowMs:()=>number;newBootId?:()=>string;receiver():{robotId:string;slot:number}|null;dock():DockState;traySensor():boolean;coffeeState?:CoffeePlantState;armState?:ArmPlantState;
 /** Plan 03: a controller-backed arm replaces the mock arm plant; its session owns the joint trace, attachments and ARM03 evidence. */
 arm?:{adapter:CellAdapter;session:ArmSession};ledger?:CupLedger;state?:PlantSessionCheckpoint;
 /** Parent translation in the pinned collision world, supplied by the run's frame graph. */
 receiptMonotonicNs?:()=>bigint;
 parentTransform?:(parent:string)=>{translationM:number[];quaternionXyzw:number[]}}
export interface PlantSessionCheckpoint {version:1|2;coffeeState:CoffeePlantState;armState:ArmPlantState|null;custody:Record<string,string>;physical:CupPhysicalState[];trays:Record<string,string>;released:Record<string,string>}
export interface Attachment {cupId:string;custody:string|null;physical:{parent:string|null;transform:{translationM:number[];quaternionXyzw:number[]};provenance:'modelled'};resolved:boolean}
export interface PlantSession {
 readonly coffee:CoffeeIoSimAdapter;readonly plant:MockCoffeePlant;readonly arm:MockArmPlant;readonly adapters:CellAdapter[];
 ports():CoffeePlantPorts;bindLedger(ledger:CupLedger):void;
 advance():void;capability():Record<string,unknown>;
 observeTransfer(observation:TransferObservation):Promise<void>;drainTransfers():Promise<void>;recover():Promise<void>;checkpoint():PlantSessionCheckpoint;cupObstacles():ArmObstacle[];
 transferEvidence(a:{transferId:string;cupId:string;to:{kind:'robot';id:string;slot:number}}):{giver:{released:true};receiver:{transferId:string;receiverPresent:true;dockInTolerance:true;poseErrorM:number;source:'mock_amr'}};
 attachments(cupId:string):Attachment;custodyResolved(cupId:string,owner:string):Promise<void>;
 liquid(cupId:string):Record<string,unknown>;report():Record<string,unknown>;
}
export const DOCK_TOLERANCE_M=0.05;
export function createPlantSession(o:PlantSessionOptions):PlantSession{
 let ledger=o.ledger,stampReceipts=false;
 const receipts=new Map<string,string>((ledger?.observations()??[]).map(o=>[o.observationId,o.receivedMonotonicNs]));
 const newBootId=o.newBootId??(()=>`boot-${Math.random().toString(16).slice(2,10)}`);
 if(o.state&&![1,2].includes(o.state.version))throw new Error('PLANT_CHECKPOINT_VERSION_UNSUPPORTED');
 const coffeeState=o.state?.coffeeState??o.coffeeState,armState=o.state?.armState??o.armState;
 const coffee=new CoffeeIoSimAdapter({cellId:o.cellId,runId:o.runId,nowMs:o.nowMs,newBootId,...coffeeState?{state:coffeeState}:{}}),plant=coffee.plant;
 const physical=new Map<string,string|null>((o.state?.physical??[]).map(c=>[c.cupId,c.parent])),custody=new Map<string,string>(Object.entries(o.state?.custody??{})),trays:Record<string,string>={...o.state?.trays},released:Record<string,string>={...o.state?.released};
 let projection:readonly CupPhysicalState[]=ledger?.snapshot()??o.state?.physical??[];
 for(const c of projection)physical.set(c.cupId,c.parent);
 const nozzle=(cupId:string)=>{physical.set(cupId,`cell:${o.cellId}/nozzle`);if(!custody.has(cupId))custody.set(cupId,`cell:${o.cellId}`);};
 const arm=o.arm?null:new MockArmPlant(armState??MockArmPlant.initial(o.armId),o.nowMs,newBootId,{
  take:()=>{const c=plant.state.cups.find(x=>x.at==='nozzle');if(!c||!plant.takeCup(c.cupId))return null;physical.set(c.cupId,`arm:${o.armId}/tcp`);return c.cupId;},
  put:(cupId,rx)=>{trays[rx.robotId]=cupId;released[cupId]=rx.robotId;physical.set(cupId,`robot:${rx.robotId}/tray:${rx.slot}`);}},o.receiver);
 const controller=o.arm?o.arm.session.capability().armController:'mock_arm',jointAuthority=PUMA560_SI.jointNames.map(joint=>({joint,controller}));
 assertSingleJointAuthority(jointAuthority);
 const adapters:CellAdapter[]=[coffee,o.arm?o.arm.adapter:new MockArmAdapter(arm!,o.runId,o.cellId)];
 const reports:CellReport[]=[];
 const off=adapters.map(a=>a.observe(r=>{
  const report=structuredClone(r),observation=report.evidence?.transferObservation as TransferObservation|undefined;
  if((stampReceipts||o.receiptMonotonicNs)&&observation){
   const persisted=(o.arm?.adapter as (CellAdapter&{completionReceipt?(id:string):string|null})|undefined)?.completionReceipt?.(observation.observationId);
   const receipt=receipts.get(observation.observationId)??persisted??String(o.receiptMonotonicNs?.()??process.hrtime.bigint());
   receipts.set(observation.observationId,receipt);observation.receivedMonotonicNs=receipt;
  }
  reports.push(report);
 }));
 // Observer callbacks enqueue once. Completion flags have no authority to invent a grasp.
 const applyPhysical=(observation:TransferObservation)=>{
  const next=applyCupObservation(projection,observation),cup=next.find(c=>c.cupId===observation.cupId)!;
  projection=next;physical.set(cup.cupId,cup.parent);
  if(cup.status!=='known'){
   const nozzleCup=plant.cup(cup.cupId);if(nozzleCup?.at==='nozzle')plant.takeCup(cup.cupId);
   o.arm?.session.invalidateCupCustody(cup.cupId,o.arm.session.trace().length,cup.status);
   return;
  }
  if(cup.parent?.startsWith('arm:')||cup.parent?.startsWith('robot:')){
   const c=plant.cup(cup.cupId);
   // takeCup is called only for a real nozzle cup; a replay of this observation is idempotent.
   if(!c||c.at==='removed')throw new Error('CUP_RECONCILE_REQUIRED:PLANT_CUP_MISSING');
   if(c.at==='nozzle'&&!plant.takeCup(cup.cupId))throw new Error('CUP_RECONCILE_REQUIRED:TAKE_FAILED');
  }
  if(cup.parent===`arm:${o.armId}/tcp`&&o.arm){
   if(!o.arm.session.attachments().some(a=>a.cupId===cup.cupId&&a.toTick===null))o.arm.session.attach(cup.cupId,Math.max(0,o.arm.session.trace().length-1),{parent:cup.parent});
  }
  const tray=cup.parent?.match(/^robot:(.+)\/tray:([1-9][0-9]*)$/);
  if(tray){
   trays[tray[1]!]=cup.cupId;if(observation.phase==='release')released[cup.cupId]=tray[1]!;
   if(o.arm?.session.attachments().some(a=>a.cupId===cup.cupId&&a.toTick===null))o.arm.session.detach(cup.cupId,Math.max(0,o.arm.session.trace().length-1),{receiverId:tray[1]!,parent:cup.parent!});
  }
 };
 const applyHandoff=(cup:CupPhysicalState)=>{physical.set(cup.cupId,cup.parent);custody.set(cup.cupId,cup.parent!);for(const [robot,id] of Object.entries(trays))if(id===cup.cupId)delete trays[robot];delete released[cup.cupId];projection=[...projection.filter(c=>c.cupId!==cup.cupId),cup];};
 ledger?.bindEffect(applyPhysical);ledger?.bindHandoffEffect(applyHandoff);
 const syncProjection=()=>{if(ledger){projection=ledger.snapshot();for(const c of projection)physical.set(c.cupId,c.parent);}};
 const transformOf=(parent:string|null):{translationM:number[];quaternionXyzw:number[]}=>parent===null?{translationM:[],quaternionXyzw:[]}:o.parentTransform?.(parent)??(parent.endsWith('/nozzle')?{translationM:[...PLANT_FRAMES.nozzleOffsetM],quaternionXyzw:[0,0,0,1]}:parent.endsWith('/tcp')?{translationM:[0,0,PLANT_FRAMES.gripperLengthM],quaternionXyzw:[0,0,0,1]}:{translationM:[0,0,PLANT_FRAMES.traySlotZM(Number(parent.split('/tray:')[1]??1))],quaternionXyzw:[0,0,0,1]});
 const session:PlantSession={
  coffee,plant,get arm(){if(!arm)throw new Error('NATIVE_ARM_HAS_NO_MOCK_SNAPSHOT');return arm;},adapters,
  bindLedger(value){if(ledger&&ledger!==value)throw new Error('CUP_LEDGER_ALREADY_BOUND');ledger=value;for(const o of value.observations())receipts.set(o.observationId,o.receivedMonotonicNs);projection=value.snapshot();value.bindEffect(applyPhysical);value.bindHandoffEffect(applyHandoff);},
  ports(){stampReceipts=true;if(o.arm&&!(o.arm.adapter as CellAdapter&{journalPath?:string}).journalPath)throw new Error('ARM_RUN_JOURNAL_REQUIRED');return {adapters,coffeePlant:plant,...arm?{mockArm:arm}:{},bindLedger:value=>session.bindLedger(value),custodyResolved:(cupId,parent)=>session.custodyResolved(cupId,parent),
   acknowledgeCompletion(commandId,observationId){(o.arm?.adapter as (CellAdapter&{acknowledgeCompletion?(id:string,observationId:string):void})|undefined)?.acknowledgeCompletion?.(commandId,observationId);},
   async advance(){session.advance();},async recover(){if(o.arm&&'recover' in o.arm.adapter)await (o.arm.adapter as CellAdapter&{recover():Promise<void>}).recover();await session.recover();},snapshot:()=>({coffee:plant.state,arm:arm?.state??null}),
   drain:()=>reports.splice(0),transferEvidence(transferId){
    if(!ledger)return null;const observations=[...ledger.observations()].reverse(),giver=observations.find(x=>x.transferId===transferId&&x.phase==='release'),receiver=observations.find(x=>x.transferId===transferId&&x.phase==='receive'),d=o.dock();
    return giver&&receiver?{giver,receiver,dock:{robotId:d.robotId,slot:Number(receiver.parent?.split('/tray:')[1]),bootId:d.bootId,stationary:!d.moving,localizationValid:d.localizationValid,errorM:d.errorM,receivedMonotonicNs:receiver.receivedMonotonicNs}}:null;
   },report:()=>({cupLedger:session.checkpoint().physical,arm:null}),async close(){for(const unsubscribe of off)unsubscribe();if(o.arm&&'close' in o.arm.adapter)await (o.arm.adapter as CellAdapter&{close():Promise<void>}).close();}};},
  async observeTransfer(observation){if(!ledger)throw new Error('CUP_LEDGER_REQUIRED');try{await ledger.ingest(observation);}finally{syncProjection();}},
  async drainTransfers(){for(const report of reports.splice(0)){
   const observation=report.evidence?.transferObservation as TransferObservation|undefined;if(!observation)continue;const envelope=report.observation;
   if(['deviceId','bootId','seq'].some(k=>report[k as 'deviceId'|'bootId'|'seq']!==observation[k as 'deviceId'|'bootId'|'seq'])||envelope&&['deviceId','bootId','seq','commandId','payloadHash','controlEpoch'].some(k=>envelope[k as keyof typeof envelope]!==observation[k as keyof TransferObservation]))throw new Error('TRANSFER_REPORT_IDENTITY_MISMATCH');
   await session.observeTransfer(observation);
  }},
  async recover(){
   if(!ledger)return;
   // The plant checkpoint may precede a finished observation. Restore attachment effects from the durable journal,
   // without replaying domain commands or start_job. takeCup checks the restored plant state before acting.
   for(const c of ledger.snapshot()){
    const observation=ledger.observations().find(x=>x.observationId===c.lastObservationId);
    if(observation)applyPhysical(observation);
   }
   try{await ledger.recover();}finally{syncProjection();}
  },
  checkpoint(){syncProjection();for(const c of plant.state.cups)if(c.at==='nozzle'&&!physical.has(c.cupId))nozzle(c.cupId);return structuredClone({version:arm?1:2,coffeeState:plant.state,armState:arm?.state??null,custody:Object.fromEntries(custody),physical:[...physical].map(([cupId,parent])=>projection.find(c=>c.cupId===cupId)??{cupId,parent,status:parent===null?'unknown':'known',lastObservationId:`initial:${cupId}`}),trays,released});},
  cupObstacles(){
   syncProjection();
   for(const c of plant.state.cups)if(c.at==='nozzle'&&!physical.has(c.cupId))nozzle(c.cupId);
   return [...physical].flatMap(([cupId,parent])=>parent===null||parent.endsWith('/tcp')?[]:[{id:`cup:${cupId}`,kind:'sphere' as const,center:transformOf(parent).translationM as [number,number,number],radiusM:DEFAULT_ARM_GEOMETRY.cupRadiusM}]);
  },
  advance(){for(const c of plant.state.cups)if(c.at==='nozzle'&&!physical.has(c.cupId))nozzle(c.cupId);coffee.advance(1);if(arm)arm.advance();},
  capability(){const a=o.arm?.session.capability();return {coupling:a?.coupling??'open_loop_visualization',closedLoop:a?.closedLoop??false,armController:controller,feedback:a?.feedback??'none',process:COFFEE_IO_SIM,checker:a?{...a.checker,toleranceM:0.0005}:{engine:'capsule-sweep-v1',available:true,toleranceM:0.0005},jointAuthority,frames:PLANT_FRAMES,provenance:a?'controller_sim':'illustrative'};},
  transferEvidence(a){
   if(o.arm)throw new Error('CORRELATED_TRANSFER_EVIDENCE_REQUIRED');
   if(physical.get(a.cupId)!==`robot:${a.to.id}/tray:${a.to.slot}`)throw new Error('TRANSFER_EVIDENCE_INCOMPLETE:WRONG_SLOT');
   if(released[a.cupId]!==a.to.id)throw new Error('TRANSFER_EVIDENCE_INCOMPLETE:RELEASE_MISSING');
   const d=o.dock(),present=o.traySensor()&&trays[a.to.id]===a.cupId,inTolerance=Number.isFinite(d.errorM)&&d.errorM>=0&&!d.moving&&d.localizationValid&&d.errorM<=DOCK_TOLERANCE_M;
   if(d.robotId!==a.to.id||!present)throw new Error('TRANSFER_EVIDENCE_INCOMPLETE:RECEIVER_PRESENCE_MISSING');
   if(!inTolerance)throw new Error('TRANSFER_EVIDENCE_INCOMPLETE:DOCK_OUT_OF_TOLERANCE');
   return {giver:{released:true},receiver:{transferId:a.transferId,receiverPresent:true,dockInTolerance:true,poseErrorM:d.errorM,source:'mock_amr'}};
  },
  attachments(cupId){
   syncProjection();
   for(const c of plant.state.cups)if(c.at==='nozzle'&&!physical.has(c.cupId))nozzle(c.cupId);
   const parent=physical.get(cupId)??null,owner=custody.get(cupId)??null;
   return {cupId,custody:owner,physical:{parent,transform:transformOf(parent),provenance:'modelled'},resolved:owner!==null&&parent!==null&&(parent===owner||parent.startsWith(`${owner}/`))};
  },
  async custodyResolved(cupId,owner){if(owner.startsWith('table:')){if(ledger)await ledger.handoff(cupId,owner);else applyHandoff({cupId,parent:owner,status:'known',lastObservationId:`domain-delivery:${cupId}:${owner}`});}custody.set(cupId,owner);},
  liquid(cupId){
   const c=plant.cup(cupId);if(!c)throw new Error('CUP_UNKNOWN');
   const volume=convertPow10({units:BigInt(c.liquidUl),scale:0},-9,9),ice=convertPow10({units:BigInt(c.iceMg),scale:0},-6,6);
   const massNanoKg=BigInt(c.liquidUl)*LIQUID_MODEL.densityKgPerM3+BigInt(c.iceMg)*1000n;
   const capacityUl=Number(convertPow10({units:BigInt(LIQUID_MODEL.cupCapacityM3.replace('.','')),scale:LIQUID_MODEL.cupCapacityM3.split('.')[1]!.length},9,0,'floor').units);
   return {cupId,volumeM3:format(volume),iceKg:format(ice),massKgEstimate:format(convertPow10({units:massNanoKg,scale:0},-9,9)),fillRatio:c.liquidUl/capacityUl,withinCup:c.liquidUl<=capacityUl,provenance:LIQUID_MODEL.provenance,
    assumptions:[`density ${LIQUID_MODEL.densityKgPerM3} kg/m3 assumed`,`cup capacity ${LIQUID_MODEL.cupCapacityM3} m3 from the illustrative cup policy`,'no fluid or thermal model']};
  },
  report(){const a=o.arm?.session;return {cupLedger:session.checkpoint().physical,coupling:a?a.capability().coupling:'open_loop_visualization',closedLoop:a?a.capability().closedLoop:false,cups:plant.state.cups.map(c=>session.attachments(c.cupId)),armTraceSamples:a?a.report().samples:arm!.state.trace.length,...a?{arm:a.report()}:{},plantLog:structuredClone(plant.state.log)};},
 };
 return session;
}
