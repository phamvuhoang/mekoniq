// Cup transfer rig (plan 02 task 6): the real beverage domain (SQLite, production registry) coupled to the plant session (coffee_io_sim process
// model + F04 mock arm) and a FAKE receiving robot whose tray sensor and dock state the test controls. Transfer evidence carries observation
// identity on both sides; a release ACK alone never moves ownership. Dev-only.
import type {JsonObject} from '../../packages/contracts/src/index';
import {cellReportPayload,dispatchCellEffects} from '../../packages/cell-adapters/src/dispatch';
import type {CellReport} from '../../packages/cell-adapters/src/contract';
import {createPlantSession,type PlantSession} from '../../packages/lab-runtime/src/v2/beverage/plant-session';
import {coffeeVenue,registerRecipes,verifiedJob,brewAll,dockedRobot,resetSeqs,ESPRESSO,STATION,CELL,ARM,type CoffeeVenue} from './coffee';
export type Dock='docked'|'near'|'absent';
export async function createCupTransferRig(o:{dock?:Dock;traySensor?:boolean}={}){
 resetSeqs();
 const v:CoffeeVenue=await coffeeVenue();await registerRecipes(v);
 const state={dock:o.dock??'docked' as Dock,traySensor:o.traySensor??true,bootId:'amr-boot-1',seq:0};
 const runId='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c';
 const session:PlantSession=createPlantSession({runId,cellId:CELL,armId:ARM,nowMs:()=>v.now(),
  receiver:()=>state.dock==='docked'?{robotId:'amr-1',slot:1}:null,
  dock:()=>({robotId:'amr-1',errorM:state.dock==='docked'?0.01:state.dock==='near'?0.2:3,moving:false,localizationValid:true,bootId:state.bootId}),
  traySensor:()=>state.traySensor});
 const reports:CellReport[]=[];for(const a of session.adapters)a.observe(r=>reports.push(r));
 const transfers={pick:'t-pick',place:'t-place'};
 let lineId='',pickCommandId='',placeCommandId='',placeReleased=false;
 const dispatch=()=>dispatchCellEffects(v.store,v.scope,session.adapters,v.now(),runId);
 /** Run the plants until a program reports terminal (or `ticks` elapsed); every device report reaches the domain as a bound observation first. */
 const runUntil=async(done:(r:CellReport)=>boolean,ticks=3000)=>{
  for(let i=0;i<ticks;i++){
   await dispatch();session.advance();
   while(reports.length){
    const r=reports.shift()!;
    if(r.cup)continue;                                                      // cup presence is Coffee.ObserveCup, already confirmed by verifiedJob
    await v.submit('Coffee.ObserveDevice',cellReportPayload(r,STATION),`observer:${r.deviceId}`); // rejections (e.g. stale heartbeat) are the domain's business
    if(done(r))return r;
   }
  }
  throw new Error('PLANT_TIMEOUT');
 };
 const rig={venue:v,session,state,
  async pickVerifiedCup(){
   const job=await verifiedJob(v);lineId=job.lineId;
   await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});await brewAll(v,'coffee-1');
   const q=await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'});if(q.status!=='accepted')throw new Error(`QUALITY:${q.code}`);
   session.plant.placeCup('cup-1',ESPRESSO.cupType);
   const t=await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:transfers.pick,cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}});if(t.status!=='accepted')throw new Error(`PICK:${t.code}`);
   pickCommandId=String(t.value.commandId);
   const r=await runUntil(r=>r.observation?.commandId===pickCommandId&&r.observation.result==='completed');
   const c=await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:transfers.pick,cupId:'cup-1',provenance:'sensor',evidence:{commandId:pickCommandId,bootId:r.bootId,seq:r.seq,observedAt:r.observedAt,...r.evidence} as JsonObject},`observer:${ARM}`);
   if(c.status!=='accepted')throw new Error(`PICK_CONFIRM:${c.code}`);
   session.custodyResolved('cup-1',`arm:${ARM}`);                            // the domain's answer updates the plant ledger, never the other way round
  },
  /** The arm runs the place program: it opens at the place pose when it sees a receiver; only the GIVER half is reported to the domain. */
  async armReleaseAck(){
   await dockedRobot(v,lineId);
   const t=await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:transfers.place,cupId:'cup-1',jobId:'coffee-1',to:{kind:'robot',id:'amr-1',slot:1}});if(t.status!=='accepted')throw new Error(`PLACE:${t.code}`);
   placeCommandId=String(t.value.commandId);
   const r=await runUntil(r=>r.observation?.commandId===placeCommandId&&['completed','failed'].includes(r.observation.result));
   placeReleased=r.evidence?.released===true;
   if(!placeReleased)return {released:false,result:r.observation!.result,reasonCodes:r.observation!.reasonCodes};
   const g=await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:transfers.place,cupId:'cup-1',provenance:'sensor',side:'giver',evidence:{commandId:placeCommandId,bootId:r.bootId,seq:r.seq,observedAt:r.observedAt,...r.evidence} as JsonObject},`observer:${ARM}`);
   if(g.status!=='accepted')throw new Error(`GIVER:${g.code}`);
   return {released:true,committed:g.value.committed===true};
  },
  /** Receiver side: the robot's own tray sensor and dock evidence under its own observer; incomplete evidence never reaches the domain. */
  async confirmTransfer(){
   const evidence=session.transferEvidence({transferId:transfers.place,cupId:'cup-1',to:{kind:'robot',id:'amr-1',slot:1}});
   const rc=await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:transfers.place,cupId:'cup-1',provenance:'sensor',side:'receiver',evidence:{...evidence.receiver,bootId:state.bootId,seq:String(++state.seq),observedAt:new Date(v.now()).toISOString()} as JsonObject},'observer:amr-1');
   if(rc.status!=='accepted')throw new Error(String(rc.code));
   return rc.value;
  },
  async cupOwner(){const c=(await v.read('cup','cup-1')).state;return `${String(c.ownerKind)}:${String(c.ownerId)}`;},
  async robotLoaded(){const c=(await v.read('cup','cup-1')).state;return c.ownerKind==='robot'&&c.ownerId==='amr-1'&&!c.pendingTransfer;},
  async cup(){return (await v.read('cup','cup-1')).state;},
  async job(){return (await v.read('coffee-job','coffee-1')).state;},
  close:()=>v.close()};
 return rig;
}
