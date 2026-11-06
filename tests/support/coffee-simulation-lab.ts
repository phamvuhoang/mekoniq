// Coffee simulation rig (plan 02 task 5): the production beverage domain over SQLite with the bar principal, plus a thin plant-evidence vocabulary
// (step aliases, device observations with measurements, replay). Nothing here bypasses the F04 commands; the rig only names what a plant reports.
import type {JsonObject} from '../../packages/contracts/src/index';
import {coffeeVenue,registerRecipes,orderCoffee,recipeRef,resetSeqs,ESPRESSO,ICED_MILK_COFFEE,STATION,CELL,DEVICES,type CoffeeVenue} from './coffee';
export const RECIPES={espresso:ESPRESSO,'iced-milk-coffee':ICED_MILK_COFFEE} as const;
export interface Measured {value:string;unit:'m3'|'kg';provenance:'measured'|'modelled'|'unknown'}
export async function createCoffeeSimulationRig(o:{milkMl?:string}={}){
 resetSeqs();
 const v:CoffeeVenue=await coffeeVenue(o);await registerRecipes(v);
 const commands=new Map<string,JsonObject>(),rejections=new Map<string,string>(),last:{payload:JsonObject|null;actor:string}={payload:null,actor:''};
 const seqs:Record<string,number>={};const seq=(deviceId:string)=>String(seqs[deviceId]=(seqs[deviceId]??0)+1);
 const observe=async(deviceId:string,payload:JsonObject,bootId='boot-1')=>{
  const body={stationId:STATION,deviceId,bootId,seq:seq(deviceId),observedAt:new Date(v.now()).toISOString(),...payload};
  last.payload=body;last.actor=`observer:${deviceId}`;
  return v.submit('Coffee.ObserveDevice',body,`observer:${deviceId}`);
 };
 const status=(deviceId:string,st:JsonObject,bootId?:string)=>observe(deviceId,{status:st},bootId);
 const readyDevices=async(milk=true)=>{for(const d of [DEVICES.machine,DEVICES.milk,DEVICES.ice,DEVICES.arm])await status(d,{status:'ready',...d===DEVICES.milk&&milk?{milkBatch:{batchId:'fixture-batch',openedAt:new Date(v.now()).toISOString(),coldChainIntact:true,temperature:{amount:'275.15',unit:'K',provenance:'modelled',observedAt:new Date(v.now()).toISOString()}}}:{}});};
 const observeCup=(jobId:string,cupId:string,cupType:string,present=true)=>v.submit('Coffee.ObserveCup',{stationId:STATION,jobId,deviceId:DEVICES.cup,bootId:'boot-1',seq:seq(DEVICES.cup),observedAt:new Date(v.now()).toISOString(),cupId,cupType,present},`observer:${DEVICES.cup}`);
 const rig={venue:v,
  /** Order one drink, bind the job to the frozen recipe revision and a cup, bring the devices up and verify the cup: ready for StartJob. */
  async reserve(a:{recipeId:keyof typeof RECIPES;recipeRevision:number;cupId:string;jobId?:string;start?:boolean;milkEvidence?:boolean}){
   const recipe=RECIPES[a.recipeId];if(recipe.revision!==a.recipeRevision)throw new Error(`RECIPE_REVISION_MISMATCH:${recipe.revision}`);
   const lineId=await orderCoffee(v,recipe.id),id=a.jobId??`job-${a.cupId}`;
   const r=await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:id,lineId,cellId:CELL,recipe:recipeRef(recipe),cupId:a.cupId});
   if(r.status!=='accepted')throw new Error(`RESERVE:${r.code}`);
   await readyDevices(a.milkEvidence??true);
   const cup=await observeCup(id,a.cupId,recipe.cupType);if(cup.status!=='accepted')throw new Error(`CUP:${cup.code}`);
   if(a.start!==false){const s=await v.submit('Coffee.StartJob',{stationId:STATION,jobId:id});if(s.status!=='accepted')throw new Error(`START:${s.code}`);}
   return {id,lineId,recipe};
  },
  /** Start a recipe step under an alias (e.g. 'brew-1' -> step 'brew'); the issued device command is remembered under the alias. */
  async startRecipeStep(jobId:string,alias:string){
   const stepId=alias.replace(/-\d+$/,''),r=await v.submit('Coffee.StartStep',{stationId:STATION,jobId,stepId});
   if(r.status==='accepted'){const effect=(await v.effects()).find(e=>e.type==='cell.execute'&&(e.payload as JsonObject).commandId===(r.value as JsonObject).commandId)!;commands.set(alias,effect.payload as JsonObject);}
   else rejections.set(alias,String(r.code));
   return r;
  },
  /** Device feedback for a command alias: accepted/completed/failed/outcome_unknown with an optional canonical SI measurement and device reason codes. */
  async observeDevice(a:{commandId:string;status:'accepted'|'completed'|'failed'|'rejected'|'outcome_unknown';measuredQuantity?:Measured;reasonCodes?:string[];bootId?:string;recipeRevision?:number|null}){
   const cmd=commands.get(a.commandId);if(!cmd)throw new Error(`COMMAND_ALIAS_UNKNOWN:${a.commandId}${rejections.has(a.commandId)?` (StartStep rejected: ${rejections.get(a.commandId)})`:''}`);
   const deviceId=String(cmd.deviceId),bootId=a.bootId??'boot-1',s=seq(deviceId);seqs[deviceId]=Number(s)-1;
   return observe(deviceId,{observation:{schemaVersion:2,commandId:cmd.commandId!,deviceId,controlEpoch:cmd.controlEpoch!,payloadHash:cmd.payloadHash!,bootId,seq:s,result:a.status,observedAt:new Date(v.now()).toISOString(),reasonCodes:a.reasonCodes??[],...a.recipeRevision!==undefined?{recipeRevision:a.recipeRevision}:{}},
    ...a.measuredQuantity?{measurement:{amount:a.measuredQuantity.value,unit:a.measuredQuantity.unit,provenance:a.measuredQuantity.provenance}}:{}},bootId);
  },
  deviceStatus:status,
  /** The device repeats its last report under a fresh sequence number (same boot): the domain must absorb it. */
  async replayLastObservation(){if(!last.payload)throw new Error('NOTHING_TO_REPLAY');const deviceId=String(last.payload.deviceId);return v.submit('Coffee.ObserveDevice',{...last.payload,seq:seq(deviceId)},last.actor);},
  verifyOutput:(jobId:string)=>v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId}),
  cancel:(jobId:string,reason='Lab rig cancel')=>v.submit('Coffee.CancelJob',{stationId:STATION,jobId,reason}),
  async readyQuantity(lineId?:string){const id=lineId??await rig.firstLine();return String((await v.read('fulfillment',id)).state.ready);},
  async servedQuantity(lineId?:string){const id=lineId??await rig.firstLine();return String((await v.read('fulfillment',id)).state.served);},
  async firstLine(){return String((await v.store.snapshots(v.scope)).find(s=>s.ref.kind==='coffee-job')!.state.lineId);},
  async brewEffectCount(){return (await v.effects()).filter(e=>e.type==='cell.execute'&&(e.payload as JsonObject).capability==='brew').length;},
  async effectCount(capability:string,resource?:string){return (await v.effects()).filter(e=>e.type==='cell.execute'&&(e.payload as JsonObject).capability===capability&&(resource===undefined||((e.payload as JsonObject).payload as JsonObject).resource===resource)).length;},
  async job(jobId:string){return (await v.read('coffee-job',jobId)).state;},
  async step(jobId:string,stepId:string){return ((await rig.job(jobId)).steps as JsonObject[]).find(s=>s.id===stepId)!;},
  async stock(id:string){return String((await v.read('stock-item',id)).state.onHand);},
  journalTypes:()=>v.journalTypes(),
  close:()=>v.close()};
 return rig;
}
