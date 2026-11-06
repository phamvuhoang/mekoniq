// coffee_io_sim: the F04 mock process model (MockCoffeePlant) behind the simulation backend id, stepped on the run's clock. Same CellAdapter
// contract as the mock (dispatchCellEffects claims before it sends and asks before it reconciles); the plan's CoffeePlantAdapter port is a
// typed facade over that contract, not a second wire command. Measurements are modelled scalars; a lost reply is unknown, never resent.
import {hashPayload} from '../../contracts/src/canonical';
import type {JsonObject,JsonValue} from '../../contracts/src/index';
import {hashJson} from '../../lab-runtime/src/v2/hash';
import type {CellAdapter,CellAcceptance,CellCommand,CellExecutionState,CellManifest,CellMeasurement,CellObservation,CellReport} from './contract';
import {MockCoffeePlant,type CoffeeFault,type CoffeePlantState} from './mock-coffee';
export const COFFEE_IO_SIM={id:'coffee_io_sim',version:'1',model:'mock_process',dynamics:false} as const;
export interface EvidenceRef {id:string;sha256:string}
export interface PlantCommand {commandId:string;jobId:string;cupId:string;kind:'brew'|'dispense_milk'|'dispense_ice';recipeId?:string;recipeRevision:number;quantity:{value:string;unit:'m3'|'kg'};fencingEpoch:number}
export interface CoffeePlantAdapter {
 describe():Promise<CellManifest&{id:string;validation:'simulated';modelVersion:string}>;
 execute(command:PlantCommand):Promise<{accepted:boolean;unknown:boolean;reason?:string}>;
 reconcile(commandId:string):Promise<{status:'running'|'completed'|'failed'|'unknown';evidence:EvidenceRef[]}>;
 observe(listener:(observation:CellObservation)=>void):()=>void;
}
export type SimFault=CoffeeFault|'disconnect';
export class CoffeeIoSimAdapter implements CellAdapter {
 readonly plant:MockCoffeePlant;readonly measurements=new Map<string,CellMeasurement>();executeCalls=0;
 private faults=new Set<SimFault>();private hooks:(()=>void)[]=[];
 constructor(readonly options:{cellId:string;runId:string;nowMs:()=>number;newBootId:()=>string;state?:CoffeePlantState}){
  this.plant=new MockCoffeePlant(options.state??MockCoffeePlant.initial(options.cellId),options.nowMs,options.newBootId);
  this.plant.on(r=>{if(r.observation&&r.measurement)this.measurements.set(r.observation.commandId,r.measurement);});
 }
 get runId(){return this.options.runId;}
 async describe():Promise<CellManifest>{return {cellId:this.options.cellId,deviceIds:this.plant.deviceIds.filter(id=>!id.endsWith(':cup')),adapter:COFFEE_IO_SIM.id,version:COFFEE_IO_SIM.version,model:COFFEE_IO_SIM.model,validation:'simulated',capabilities:['brew','dispense','query_outcome']};}
 /** The device acts exactly once per command id; a `disconnect` fault loses the reply after the action (unknown to the caller). */
 async execute(command:CellCommand):Promise<CellAcceptance>{
  if(command.runId!==this.options.runId)return {accepted:false,unknown:false,reason:'RUN_MISMATCH'};
  this.executeCalls++;
  const answer=this.plant.execute(command);
  if(this.faults.has('disconnect'))throw new Error('BRIDGE_LOST');
  return answer;
 }
 async cancel(commandId:string){return this.plant.cancel(commandId);}
 observe(listener:(r:CellReport)=>void){return this.plant.on(listener);}
 async reconcile(commandId:string):Promise<CellExecutionState>{return this.plant.reconcile(commandId);}
 /** One 20 ms process tick (the run's clock advances through the hook). */
 advance(ticks=1){for(let i=0;i<ticks;i++){this.plant.advance();for(const h of this.hooks)h();}}
 onAdvance(hook:()=>void){this.hooks.push(hook);}
 fault(f:SimFault){if(f==='disconnect')this.faults.add(f);else this.plant.fault(f);}
 clearFault(f:SimFault){this.faults.delete(f);}
}
const DEVICE_OF:Record<PlantCommand['kind'],string>={brew:'',dispense_milk:':milk',dispense_ice:':ice'};
/** The plan's internal plant port: typed brew/dispense commands and evidence refs, composed onto the cell-adapters contract. */
export function coffeePlantPort(adapter:CoffeeIoSimAdapter):CoffeePlantAdapter{
 return {
  async describe(){const m=await adapter.describe();return {...m,id:COFFEE_IO_SIM.id,validation:'simulated',modelVersion:`${COFFEE_IO_SIM.model}@${COFFEE_IO_SIM.version}`};},
  async execute(c){
   const payload:JsonObject=c.kind==='brew'?{recipeId:c.recipeId??'unknown',cupId:c.cupId}:{resource:c.kind==='dispense_milk'?'milk':'ice',amount:c.quantity.value,unit:c.quantity.unit};
   const command={commandId:c.commandId,runId:adapter.runId,deviceId:`${adapter.options.cellId}${DEVICE_OF[c.kind]}`,controlEpoch:c.fencingEpoch,expiresAt:new Date(adapter.options.nowMs()+30000).toISOString(),recipeRevision:c.recipeRevision,programRef:null,capability:c.kind==='brew'?'brew':'dispense',payloadHash:hashPayload(payload as JsonValue),payload} as CellCommand;
   try{const r=await adapter.execute(command);return {accepted:r.accepted,unknown:r.unknown,...r.reason?{reason:r.reason}:{}};}
   catch(e){return {accepted:false,unknown:true,reason:`NO_ACK:${(e as Error).message}`};}
  },
  async reconcile(commandId){
   const s=await adapter.reconcile(commandId);
   if(s.status==='not_found')return {status:'unknown',evidence:[]};
   const status=s.status==='accepted'||s.status==='running'?'running':s.status==='completed'?'completed':s.status==='failed'?'failed':'unknown';
   const measurement=adapter.measurements.get(commandId)??null;
   return {status,evidence:[{id:`${COFFEE_IO_SIM.id}:${commandId}`,sha256:hashJson({commandId,status,measurement,evidence:s.evidence,model:COFFEE_IO_SIM})}]};
  },
  observe(listener){return adapter.observe(r=>{if(r.observation)listener(r.observation);});},
 };
}
