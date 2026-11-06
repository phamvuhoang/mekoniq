// Coffee domain fixture: one bar station, one coffee cell, stocked ingredients. Every write goes through processCommand with the production
// registry and authorizeVenueCommand, under a least-privilege principal per role (station-scoped). Test-only; nothing here is registered in routes.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createPublicKey,sign} from 'node:crypto';
import {hashPayload,type CommandEnvelope,type CommandResult,type JsonObject,type Scope} from '../../packages/contracts/src/index';
import {createProductionRegistry,authorizeVenueCommand,type Principal} from '../../packages/domain/src/application';
import {openStore,type DurableStore} from '../../packages/sync/src/store';
import {processCommand} from '../../packages/sync/src/command-processor';
import {ESPRESSO,ICED_MILK_COFFEE} from '../../packages/lab-runtime/src/v2/scenarios/coffee';
export {ESPRESSO,ICED_MILK_COFFEE};
const DEVICE='bar-tablet',EPOCH='e1',T0=Date.parse('2026-11-05T08:00:00Z');
export const CELL='cell-1',STATION='bar',ARM='arm-1',DEVICES={machine:CELL,milk:`${CELL}:milk`,ice:`${CELL}:ice`,cup:`${CELL}:cup`,arm:ARM};
export const ROLES:Record<string,{permissions:string[];stations:string[]}>={
 manager:{permissions:['*'],stations:[]},
 barista:{permissions:['beverage.write','order.write','fulfillment.write'],stations:[STATION]},
 waiter:{permissions:['fulfillment.write'],stations:[STATION]},
 'other-barista':{permissions:['beverage.write'],stations:['kitchen']},
 configurer:{permissions:['beverage.configure'],stations:[]},
 supervisor:{permissions:['beverage.reconcile','beverage.override','beverage.write'],stations:[STATION]},
 ...Object.fromEntries([...Object.values(DEVICES),'amr-1'].map(d=>[`observer:${d}`,{permissions:['cell.observe'],stations:[STATION]}])),
};
const dirs:string[]=[];
export async function cleanupCoffee(){for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});}
export interface CoffeeVenue {scope:Scope;store:DurableStore;now:()=>number;advance(ms:number):void;
 submit(type:string,payload:JsonObject,actor?:string):Promise<CommandResult>;read(kind:string,id:string):Promise<{version:number;state:JsonObject}>;
 effects():Promise<JsonObject[]>;journalTypes():Promise<string[]>;close():Promise<void>}
let op=0;
export async function coffeeVenue(o:{milkMl?:string;stock?:boolean;features?:readonly string[]}={}):Promise<CoffeeVenue>{
 const dir=await mkdtemp(join(tmpdir(),'coffee-'));dirs.push(dir);
 const key=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey,publicJwk=createPublicKey(key).export({format:'jwk'}) as JsonObject;
 let t=T0;const now=()=>t;
 const store=await openStore({driver:'sqlite',url:join(dir,'journal.db'),nowMs:now,authority:{ownerDeviceId:DEVICE,deviceEpoch:EPOCH,publicJwk},ackLevel:'venue',producer:{deviceId:DEVICE,deviceEpoch:EPOCH},signerPublicJwk:publicJwk,signer:b=>sign('sha256',b,{key,dsaEncoding:'ieee-p1363'}).toString('base64url')});
 const scope={organizationId:'org-coffee',venueId:'venue-coffee'};await store.provision(scope,1,1);
 const seed=(kind:string,id:string,state:JsonObject)=>store.seed(scope,kind,id,state);
 await seed('device',DEVICE,{deviceEpoch:EPOCH,status:'active',publicJwk});
 await seed('configuration','applied',{revision:1,features:Object.fromEntries((o.features??['catalog','sessions','pos.order','orders','kitchen','fulfillment','fleet','robot.delivery','inventory','beverage']).map(k=>[k,{status:'enabled',revision:1}])),readiness:{robot:true},beverage:{allowModelledMeasurements:true}});
 const menu={version:1,currency:'VND',items:[{id:'espresso',name:'Espresso',stationId:STATION,unitMinor:'30000',available:true},{id:'iced-milk-coffee',name:'Iced milk coffee',stationId:STATION,unitMinor:'35000',available:true}]};
 await seed('catalog','current',menu);await seed('catalog-version','1',menu);
 await seed('station',STATION,{id:STATION,name:'Bar'});await seed('table','t1',{id:'t1',name:'T1',activeSessionId:null});
 if(o.stock!==false){
  await seed('stock-item','coffee-beans',{name:'Beans',baseUnit:'g',conversions:{},negativePolicy:'block',currency:'VND',onHand:'1000',valueMinor:'500000',movementSeq:0});
  await seed('stock-item','milk',{name:'Milk',baseUnit:'ml',conversions:{},negativePolicy:'block',currency:'VND',onHand:o.milkMl??'2000',valueMinor:'60000',movementSeq:0});
  await seed('stock-item','ice',{name:'Ice',baseUnit:'g',conversions:{},negativePolicy:'block',currency:'VND',onHand:'5000',valueMinor:'5000',movementSeq:0});
 }
 const device=(id:string,role:string,extra:JsonObject={})=>seed('cell-device',id,{cellId:CELL,stationId:STATION,role,validation:'simulated',status:role==='machine'?'warming':'ready',level:role==='milk'||role==='ice'?'ok':null,reasonCodes:[],controlEpoch:1,observerId:`observer:${id}`,bootId:null,seq:'0',observedAt:null,cleaning:{status:'ok',intervalMs:4*3600000,dueAt:new Date(T0+4*3600000).toISOString(),lastCleanedAt:null,cleanedBy:null},...extra});
 await device(DEVICES.machine,'machine');await device(DEVICES.milk,'milk');await device(DEVICES.ice,'ice');await device(DEVICES.cup,'cup_sensor');await device(DEVICES.arm,'arm');
 const registry=createProductionRegistry();
 const submit=async(type:string,payload:JsonObject,actor='barista')=>{
  const at=new Date(t).toISOString(),role=ROLES[actor]!;
  const c:CommandEnvelope={schemaVersion:1,...scope,type,operationId:`op-${++op}`,actorRef:actor,deviceId:DEVICE,deviceEpoch:EPOCH,coordinatorEpoch:1,policyRevision:1,occurredAt:at,recordedAt:at,payload,payloadHash:hashPayload(payload),...(typeof payload.expectedVersion==='number'?{expectedVersion:payload.expectedVersion}:{})};
  const principal:Principal={id:actor,deviceId:DEVICE,scope,permissions:role.permissions,expiresAtMs:t+60000,stationIds:role.stations};
  return processCommand(store,c,(x,s)=>registry.decide(x,s),async x=>authorizeVenueCommand(principal,x,t));
 };
 const read=async(kind:string,id:string)=>{const s=await store.readSnapshot({...scope,kind,id});return {version:s.version,state:s.state};};
 return {scope,store,now,advance:ms=>{t+=ms;},submit,read,effects:()=>store.effects(scope),
  journalTypes:async()=>(await store.journal(scope)).flatMap(e=>(e.payload.events as {type:string}[]).map(x=>x.type)),close:()=>store.close()};
}
let seqs:Record<string,number>={};
/** Observation from a bound device observer: monotonic seq per device under one boot. */
export function deviceStatus(v:CoffeeVenue,deviceId:string,status:JsonObject,bootId='boot-1'){
 seqs[deviceId]=(seqs[deviceId]??0)+1;
 return v.submit('Coffee.ObserveDevice',{stationId:STATION,deviceId,bootId,seq:String(seqs[deviceId]),observedAt:new Date(v.now()).toISOString(),status},`observer:${deviceId}`);
}
export function commandResult(v:CoffeeVenue,effect:JsonObject,result:string,extra:JsonObject={},bootId='boot-1'){
 const cmd=effect.payload as JsonObject,deviceId=String(cmd.deviceId);seqs[deviceId]=(seqs[deviceId]??0)+1;
 return v.submit('Coffee.ObserveDevice',{stationId:STATION,deviceId,bootId,seq:String(seqs[deviceId]),observedAt:new Date(v.now()).toISOString(),
  observation:{schemaVersion:2,commandId:cmd.commandId!,deviceId,controlEpoch:cmd.controlEpoch!,payloadHash:cmd.payloadHash!,bootId,seq:String(seqs[deviceId]),result,observedAt:new Date(v.now()).toISOString(),reasonCodes:[]},...extra},`observer:${deviceId}`);
}
export const resetSeqs=()=>{seqs={};};
/** Guest order for one coffee: returns the order line (= kitchen ticket id at the bar station). */
const sessions=new WeakMap<CoffeeVenue,string>();
export async function orderCoffee(v:CoffeeVenue,itemId:string,quantity='1'){
 // one open seating per venue: the table holds a single active session
 let sessionId=sessions.get(v);
 if(!sessionId){sessionId=`s-${++op}`;sessions.set(v,sessionId);await v.submit('Session.Open',{sessionId,tableId:'t1'},'manager');}
 const placed=await v.submit('Order.Place',{sessionId,tableId:'t1',menuVersion:1,items:[{itemId,quantity}]},'manager');
 if(placed.status!=='accepted')throw new Error(`ORDER_REJECTED:${placed.code}`);
 return (placed.value.lineIds as string[])[0]!;
}
export async function registerRecipes(v:CoffeeVenue){
 for(const r of [ESPRESSO,ICED_MILK_COFFEE]){const x=await v.submit('Coffee.RegisterRecipe',{recipe:r as unknown as JsonObject},'configurer');if(x.status!=='accepted')throw new Error(`RECIPE:${x.code}`);}
}
export const recipeRef=(r:typeof ESPRESSO)=>({id:r.id,revision:r.revision,hash:r.hash});
/** Reserved job with the machine warmed up and the cup observed: ready for Coffee.StartJob. */
export async function verifiedJob(v:CoffeeVenue,recipe=ESPRESSO,jobId='coffee-1',cupId='cup-1',milkEvidence=true){
 const lineId=await orderCoffee(v,recipe.id);
 const reserved=await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId,lineId,cellId:CELL,recipe:recipeRef(recipe),cupId});
 if(reserved.status!=='accepted')throw new Error(`RESERVE:${reserved.code}`);
 for(const d of [DEVICES.machine,DEVICES.milk,DEVICES.ice,DEVICES.arm])await deviceStatus(v,d,{status:'ready',...d===DEVICES.milk&&milkEvidence?{milkBatch:{batchId:'fixture-batch',openedAt:new Date(v.now()).toISOString(),coldChainIntact:true,temperature:{amount:'275.15',unit:'K',provenance:'modelled',observedAt:new Date(v.now()).toISOString()}}}:{}});
 const cup=await observeCup(v,jobId,cupId,recipe.cupType);
 if(cup.status!=='accepted')throw new Error(`CUP:${cup.code}`);
 return {lineId,jobId,cupId};
}
export function observeCup(v:CoffeeVenue,jobId:string,cupId:string,cupType:string,present=true){
 seqs[DEVICES.cup]=(seqs[DEVICES.cup]??0)+1;
 return v.submit('Coffee.ObserveCup',{stationId:STATION,jobId,deviceId:DEVICES.cup,bootId:'boot-1',seq:String(seqs[DEVICES.cup]),observedAt:new Date(v.now()).toISOString(),cupId,cupType,present},`observer:${DEVICES.cup}`);
}
/** Start a recipe step and return its cell.execute effect. */
export async function startStep(v:CoffeeVenue,jobId:string,stepId:string){
 const r=await v.submit('Coffee.StartStep',{stationId:STATION,jobId,stepId});
 if(r.status!=='accepted')return {result:r,effect:undefined};
 const effect=(await v.effects()).find(e=>e.type==='cell.execute'&&(e.payload as JsonObject).commandId===(r.value as JsonObject).commandId)!;
 return {result:r,effect};
}
export const measured=(amount:string,unit:string,provenance='measured')=>({measurement:{amount,unit,provenance}});
/** Complete every step at its target quantity; leaves the job verifying. */
export async function brewAll(v:CoffeeVenue,jobId:string,recipe=ESPRESSO){
 for(const step of recipe.steps){
  const {result,effect}=await startStep(v,jobId,step.id);if(!effect)throw new Error(`STEP:${result.code}`);
  await commandResult(v,effect,'accepted');v.advance(1000);
  const done=await commandResult(v,effect,'completed',measured(step.target!.amount,step.target!.unit));if(done.status!=='accepted')throw new Error(`DONE:${done.code}`);
 }
}
/** A robot already waiting at the bar's load stop for this order line (seeded fleet state; the coffee leg is what is under test). */
export async function dockedRobot(v:CoffeeVenue,lineId:string,allocationId='alloc-1'){
 const seed=(kind:string,id:string,state:JsonObject)=>v.store.seed(v.scope,kind,id,state);
 await seed('robot','amr-1',{id:'amr-1',trays:2,missionId:'m-1',observerId:'observer:amr-1',controlEpoch:1,availability:'busy'});
 await seed('allocation',allocationId,{lineId,quantity:'1',status:'reserved',stationId:STATION,missionId:'m-1',method:'robot'});
 await seed('mission','m-1',{status:'executing',kind:'delivery',robotId:'amr-1',revision:1,commandRevision:1,currentStopId:'load-1',loaded:false,allocationIds:[allocationId],
  stops:[{id:'load-1',action:'load',targetId:STATION,status:'awaiting_action',allocationIds:[allocationId]},{id:'hand-1',action:'handoff',targetId:'t1',status:'pending',allocationIds:[allocationId]}]});
}
