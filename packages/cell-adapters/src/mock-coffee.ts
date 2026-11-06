// mock_process coffee cell: machine warm-up/brew cycle, ice dispenser (jam), milk pump/level, cup sensor, settling and cumulative measurement on the
// virtual tick. Quantities are integer µl/mg inside, canonical m3/kg decimal strings at the boundary. Deterministic; no fluid/thermal model; rates illustrative.
import {convertPow10,decimal,format} from '../../domain/src/shared/exact-decimal';
import type {JsonObject} from '../../contracts/src/index';
import type {CellAdapter,CellAcceptance,CellCommand,CellExecutionState,CellManifest,CellMeasurement,CellReport,DeviceStatus} from './contract';
export const MOCK_COFFEE={id:'mock_coffee',version:'1',model:'mock_process',dynamics:false} as const;
/** Illustrative, not vendor data: 30 ml in 25 s, ice 120 g in 3 s, milk 80 ml in 4 s, 1 ml / 1 g sensor resolution. Tick = 20 ms. */
export const MOCK_COFFEE_PARAMS={warmupTicks:150,brewUl:30000,brewUlPerTick:24,iceMgPerTick:800,milkUlPerTick:400,settleTicks:25,heartbeatTicks:250,resolutionUl:1000,resolutionMg:1000,milkStockUl:2000000,provenance:'illustrative'} as const;
export type CoffeeFault='ice-jam'|'milk-empty'|'dose-low'|'measure-unknown'|'measure-missing'|'measure-outlier'|'milk-expired'|'milk-warm'|'milk-unknown'|'cup-removed'|'coffee-reboot'|'drop-ack'|'duplicate-completion'|'machine-not-ready';
interface Device {id:string;role:'machine'|'milk'|'ice'|'cup_sensor';status:DeviceStatus['status'];level:'ok'|'empty'|null;levelUl:number|null;jammed:boolean;warmup:number;bootId:string;seq:number;lastReport:number;reasonCodes:string[];
 milkBatch?:{batchId:string;openedAtMs:number;temperatureK:string|null;coldChainIntact:boolean}}
interface Cup {cupId:string;cupType:string;at:'nozzle'|'removed'|'taken';liquidUl:number;iceMg:number}
interface Cmd {commandId:string;deviceId:string;capability:string;payloadHash:string;controlEpoch:number;recipeRevision:number|null;resource:'brew'|'ice'|'milk'|'water';targetUnits:number;doneUnits:number;settle:number;state:'running'|'settling'|'completed'|'failed'|'unknown';accepted:CellAcceptance;cupId:string|null}
export interface CoffeePlantState {cellId:string;tick:number;devices:Device[];cups:Cup[];commands:Cmd[];modifiers:CoffeeFault[];log:{tick:number;event:string;commandId?:string}[]}
const ROLES:[string,Device['role']][]=[['','machine'],[':milk','milk'],[':ice','ice'],[':cup','cup_sensor']];
export class MockCoffeePlant {
 private listeners=new Set<(r:CellReport)=>void>();
 constructor(readonly state:CoffeePlantState,private nowMs:()=>number,private newBootId:()=>string){}
 static initial(cellId:string,bootId='boot-0'):CoffeePlantState {
  return {cellId,tick:0,cups:[],commands:[],modifiers:[],log:[],devices:ROLES.map(([suffix,role])=>({id:cellId+suffix,role,status:role==='machine'?'warming':'ready',level:role==='milk'||role==='ice'?'ok':null,levelUl:role==='milk'?MOCK_COFFEE_PARAMS.milkStockUl:null,jammed:false,warmup:0,bootId:`${bootId}:${role}`,seq:0,lastReport:-1000000,reasonCodes:[]}))};
 }
 get deviceIds(){return this.state.devices.map(d=>d.id);}
 on(listener:(r:CellReport)=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 private device(id:string){return this.state.devices.find(d=>d.id===id)??null;}
 private role(r:Device['role']){return this.state.devices.find(d=>d.role===r)!;}
 private emit(d:Device,extra:Partial<CellReport>){d.seq++;d.lastReport=this.state.tick;const r:CellReport={deviceId:d.id,bootId:d.bootId,seq:String(d.seq),observedAt:new Date(this.nowMs()).toISOString(),...extra};for(const l of this.listeners)l(r);}
 private batch(d:Device){return d.milkBatch??=( {batchId:`${d.id}:batch-1`,openedAtMs:this.nowMs(),temperatureK:'275.15',coldChainIntact:true} );}
 private status(d:Device){
  const b=d.role==='milk'?this.batch(d):null;
  this.emit(d,{status:{status:d.status,...d.level?{level:d.level}:{},reasonCodes:[...d.reasonCodes],...b?{milkBatch:{batchId:b.batchId,openedAt:new Date(b.openedAtMs).toISOString(),coldChainIntact:b.coldChainIntact,
   temperature:b.temperatureK?{amount:b.temperatureK,unit:'K',provenance:'modelled',observedAt:new Date(this.nowMs()).toISOString()}:null}}:{}}});
 }
 private observe(c:Cmd,result:'accepted'|'completed'|'failed'|'rejected'|'outcome_unknown',reasonCodes:string[]=[],measurement?:CellMeasurement){
  const d=this.device(c.deviceId)!;
  this.emit(d,{observation:{schemaVersion:2,commandId:c.commandId,deviceId:d.id,controlEpoch:c.controlEpoch,payloadHash:c.payloadHash,bootId:d.bootId,seq:String(d.seq+1),result,observedAt:new Date(this.nowMs()).toISOString(),reasonCodes,recipeRevision:c.recipeRevision},...measurement?{measurement}:{}});
 }
 /** Cup dispenser: put a tagged cup under the nozzle (the mock's identity tag is the cup id). */
 placeCup(cupId:string,cupType:string){
  if(!this.state.cups.some(c=>c.cupId===cupId))this.state.cups.push({cupId,cupType,at:'nozzle',liquidUl:0,iceMg:0});
  const s=this.role('cup_sensor');this.emit(s,{cup:{cupId,cupType,present:true}});
 }
 /** Explicit operator correction before any dispense: fresh sensor evidence, never a restart of a command or a partial drink. */
 restoreCup(cupId:string,cupType:string){
  const cup=this.cup(cupId);
  if(!cup||cup.cupType!==cupType||cup.at!=='removed'||cup.liquidUl!==0||cup.iceMg!==0||this.state.commands.some(c=>c.cupId===cupId))throw new Error('CUP_RESTORE_UNSAFE');
  cup.at='nozzle';this.reportCup();
 }
 /** Cup sensor re-read (e.g. after the machine finished warming): reports what is under the nozzle now. */
 reportCup(){const c=this.state.cups.find(x=>x.at==='nozzle');this.emit(this.role('cup_sensor'),{cup:c?{cupId:c.cupId,cupType:c.cupType,present:true}:{cupId:null,cupType:null,present:false}});}
 cupAtNozzle(cupId:string){return this.state.cups.find(c=>c.cupId===cupId&&c.at==='nozzle')??null;}
 /** The arm took the cup off the nozzle; the cup sensor sees it leave. */
 takeCup(cupId:string){const c=this.cupAtNozzle(cupId);if(!c)return false;c.at='taken';return true;}
 cup(cupId:string){return this.state.cups.find(c=>c.cupId===cupId)??null;}
 measurement(c:Cmd):CellMeasurement {
  const unknown=this.state.modifiers.includes('measure-unknown'),mass=c.resource==='ice',res=mass?MOCK_COFFEE_PARAMS.resolutionMg:MOCK_COFFEE_PARAMS.resolutionUl;
  const units=BigInt(Math.floor(c.doneUnits/res)*res)*(this.state.modifiers.includes('measure-outlier')?100n:1n);
  return {amount:format(convertPow10({units,scale:0},mass?-6:-9,mass?6:9)),unit:mass?'kg':'m3',provenance:unknown?'unknown':'modelled'};
 }
 execute(command:CellCommand):CellAcceptance {
  const old=this.state.commands.find(c=>c.commandId===command.commandId);if(old)return old.accepted; // same id: first answer, never a second action
  const d=this.device(command.deviceId),p=command.payload as JsonObject;
  const reject=(reason:string):CellAcceptance=>({accepted:false,unknown:false,reason});
  if(!d)return reject('DEVICE_UNKNOWN');
  if(command.capability!=='brew'&&command.capability!=='dispense')return reject('CAPABILITY_UNSUPPORTED');
  const resource=command.capability==='brew'?'brew':String(p.resource) as Cmd['resource'],cup=this.state.cups.find(c=>c.at==='nozzle');
  if(d.status!=='ready'||d.jammed)return reject('DEVICE_NOT_READY');
  if(!cup)return reject('CUP_ABSENT');
  const text=String(p.amount??''),targetUnits=resource==='brew'?MOCK_COFFEE_PARAMS.brewUl:Number(convertPow10(decimal(text,(text.split('.')[1]??'').length),resource==='ice'?6:9,0,'floor').units);
  const low=this.state.modifiers.includes('dose-low');
  const c:Cmd={commandId:command.commandId,deviceId:d.id,capability:command.capability,payloadHash:command.payloadHash,controlEpoch:command.controlEpoch,recipeRevision:command.recipeRevision??null,resource,targetUnits:low?Math.floor(targetUnits*0.6):targetUnits,doneUnits:0,settle:0,state:'running',accepted:{accepted:true,unknown:false},cupId:cup.cupId};
  this.state.commands.push(c);this.state.log.push({tick:this.state.tick,event:'accepted',commandId:c.commandId});
  if(!this.state.modifiers.includes('drop-ack'))this.observe(c,'accepted');
  return c.accepted;
 }
 cancel(commandId:string){const c=this.state.commands.find(x=>x.commandId===commandId);if(!c)return {acknowledged:false,unknown:true};if(c.state==='running'){c.state='failed';this.observe(c,'failed',['CANCELLED'],this.measurement(c));}return {acknowledged:true,unknown:false};}
 reconcile(commandId:string):CellExecutionState {
  const c=this.state.commands.find(x=>x.commandId===commandId);
  if(!c)return {status:'not_found',evidence:{}};
  return {status:c.state==='settling'?'running':c.state,evidence:{doneUnits:c.doneUnits,source:MOCK_COFFEE.id}};
 }
 fault(f:CoffeeFault){
  const s=this.state;s.log.push({tick:s.tick,event:`fault:${f}`});
  if(f==='ice-jam'){const d=this.role('ice');d.jammed=true;}
  else if(f==='milk-empty'){const d=this.role('milk');d.levelUl=0;d.level='empty';this.status(d);}
  else if(f==='milk-warm'||f==='milk-expired'||f==='milk-unknown'){
   const d=this.role('milk'),b=this.batch(d);
   if(f==='milk-warm'){b.temperatureK='285.15';b.coldChainIntact=false;}
   else if(f==='milk-expired'){b.batchId+=`:expired-${s.tick}`;b.openedAtMs=this.nowMs()-4*3600000-1;}
   else b.temperatureK=null;
   this.status(d);
  }
  else if(f==='machine-not-ready'){const d=this.role('machine');d.status='warming';d.warmup=0;this.status(d);}
  else if(f==='cup-removed'){const c=s.cups.find(x=>x.at==='nozzle');if(c){c.at='removed';this.emit(this.role('cup_sensor'),{cup:{cupId:null,cupType:null,present:false}});}}
  else if(f==='coffee-reboot'){
   // the cell lost its process state: running commands are unknown under a new boot; nothing restarts by itself
   for(const d of s.devices){d.bootId=this.newBootId();d.seq=0;}
   for(const c of s.commands.filter(x=>x.state==='running'||x.state==='settling')){c.state='unknown';this.observe(c,'outcome_unknown',['OBSERVER_REBOOT']);}
   // Reboot does not open a new milk batch or clear a cold-chain fault; publish the same evidence under the new observer boot.
   for(const d of s.devices)this.status(d);
  }else s.modifiers.push(f);
 }
 advance(){
  const s=this.state,P=MOCK_COFFEE_PARAMS;s.tick++;
  const machine=this.role('machine');
  if(machine.status==='warming'&&++machine.warmup>=P.warmupTicks){machine.status='ready';this.status(machine);}
  for(const c of s.commands){
   if(c.state==='running'){
    const d=this.device(c.deviceId)!,cup=this.cup(c.cupId!),rate=c.resource==='brew'?P.brewUlPerTick:c.resource==='ice'?P.iceMgPerTick:P.milkUlPerTick;
    if(!cup||cup.at!=='nozzle'){c.state='failed';this.observe(c,'failed',['CUP_REMOVED'],this.measurement(c));continue;}
    if(d.jammed&&c.doneUnits>=c.targetUnits/3){c.state='failed';d.status='fault';d.reasonCodes=['ICE_JAMMED'];this.observe(c,'failed',['ICE_JAMMED'],this.measurement(c));this.status(d);continue;}
    let step=Math.min(rate,c.targetUnits-c.doneUnits);
    if(c.resource==='milk'){step=Math.min(step,d.levelUl??0);d.levelUl=(d.levelUl??0)-step;}
    c.doneUnits+=step;if(c.resource==='ice')cup.iceMg+=step;else cup.liquidUl+=step;
    if(c.resource==='milk'&&d.levelUl===0&&c.doneUnits<c.targetUnits){c.state='failed';d.level='empty';this.observe(c,'failed',['MILK_EMPTY'],this.measurement(c));this.status(d);continue;}
    if(c.doneUnits>=c.targetUnits){c.state='settling';c.settle=0;}
   }else if(c.state==='settling'&&++c.settle>=P.settleTicks){
    c.state='completed';s.log.push({tick:s.tick,event:'completed',commandId:c.commandId});
    const m=s.modifiers.includes('measure-missing')?undefined:this.measurement(c);
    this.observe(c,'completed',[],m);
    if(s.modifiers.includes('duplicate-completion'))this.observe(c,'completed',[],m);
   }
  }
  for(const d of s.devices)if(s.tick-d.lastReport>=P.heartbeatTicks)this.status(d);
 }
}
export class MockCoffeeAdapter implements CellAdapter {
 constructor(private plant:MockCoffeePlant,private runId:string){}
 async describe():Promise<CellManifest>{return {cellId:this.plant.state.cellId,deviceIds:this.plant.deviceIds.filter(id=>!id.endsWith(':cup')),adapter:MOCK_COFFEE.id,version:MOCK_COFFEE.version,model:MOCK_COFFEE.model,validation:'simulated',capabilities:['brew','dispense','query_outcome']};}
 async execute(command:CellCommand){if(command.runId!==this.runId)return {accepted:false,unknown:false,reason:'RUN_MISMATCH'};return this.plant.execute(command);}
 async cancel(commandId:string){return this.plant.cancel(commandId);}
 observe(listener:(r:CellReport)=>void){return this.plant.on(listener);}
 async reconcile(commandId:string){return this.plant.reconcile(commandId);}
}
