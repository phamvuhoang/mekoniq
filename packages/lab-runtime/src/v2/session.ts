// Source bridge for one v2 run: its own SQLite journal, signing key and synthetic venue. Every write goes through processCommand with the
// production registry and authorizeVenueCommand; principals are server-assigned per scenario role, never chosen by a caller.
import type {SemanticBinding} from './backends/gazebo-nav2';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createPrivateKey,createPublicKey,generateKeyPairSync,sign} from 'node:crypto';
import {hashPayload,type CommandEnvelope,type CommandResult,type JsonObject,type Scope} from '../../../contracts/src/index';
import {createProductionRegistry,authorizeVenueCommand,requiredPermissions} from '../../../domain/src/application';
import {openStore,type DurableStore} from '../../../sync/src/store';
import {processCommand} from '../../../sync/src/command-processor';
import type {LabProjectV2} from '../../../contracts/generated/lab-v2';
const DEVICE='lab-coordinator',EPOCH='lab-epoch-1';
/** Least privilege per scripted role. Robot observations are bound to the server-owned simulator observer of that robot. */
const ROLES:Record<string,readonly string[]>={'lab-guest':['Session.Open','Order.Place'],'lab-kitchen':['Kitchen.Ready'],'lab-dispatcher':['Fulfillment.Allocate','Mission.Create','Mission.Cancel'],'lab-staff':['Mission.ConfirmStop'],
 'lab-manager':['Coffee.RegisterRecipe'],'lab-barista':['Coffee.ReserveJob','Coffee.StartJob','Coffee.StartStep','Coffee.ConfirmQuality','Coffee.StepTimeout','Cup.RequestTransfer','Coffee.CancelJob','Coffee.RecordCleaning'],'lab-supervisor':['Coffee.Reconcile','Robot.RequestStop']};
/** Feedback types; each is submitted as the server-owned simulator observer bound to that robot/device. */
const OBSERVATIONS=['Robot.Observe','Coffee.ObserveCup','Coffee.ObserveDevice','Cup.ConfirmTransfer'];
/** Shared-zone traffic: submitted as the executor principal of that robot (`executor:<robotId>`), the only one that may release its own zone. */
const TRAFFIC=['Zone.Reserve','Zone.Release'];
const STATION_ROLES=['lab-kitchen','lab-barista','lab-supervisor'];
const roleOf=(type:string)=>Object.keys(ROLES).find(r=>ROLES[r]!.includes(type));
export interface SourceFixture {epochMs?:number;navigation?:{mapId:string;mapRevision:string;bindings:Record<string,SemanticBinding>};project:LabProjectV2;robots:{id:string;parkingId:string;trays:number}[];stationIds:string[];coffee?:{stationId:string;cellId:string;armId:string;recipes:{id:string}[]};
 /** Scenario-owned robot configuration (admission inputs); defaults: battery 100, ['delivery'], every point taught. */
 fleet?:{battery?:number;capabilities?:readonly string[];unbindTables?:boolean}}
/** Illustrative stock for the coffee cell (whole g/ml base units), and its bound devices: cellId, cellId:milk|ice|cup, armId. */
export const COFFEE_STOCK=[{id:'coffee-beans',name:'Coffee beans (illustrative)',baseUnit:'g',onHand:'2000'},{id:'milk',name:'Milk (illustrative)',baseUnit:'ml',onHand:'5000'},{id:'ice',name:'Ice (illustrative)',baseUnit:'g',onHand:'10000'}];
export const coffeeDevices=(cellId:string,armId:string)=>[[cellId,'machine'],[`${cellId}:milk`,'milk'],[`${cellId}:ice`,'ice'],[`${cellId}:cup`,'cup_sensor'],[armId,'arm']] as const;
export const mealFor=(stationId:string)=>`meal-${stationId}`;
export class SourceSession {
 private readonly registry=createProductionRegistry();
 private constructor(readonly scope:Scope,readonly store:DurableStore,private nowMs:()=>number,private stationIds:string[]){}
 static async open(directory:string,runId:string,nowMs:()=>number,fixture:SourceFixture,fresh:boolean){
  let jwk;
  try{jwk=JSON.parse(await readFile(join(directory,'signing-key.json'),'utf8'));}catch(e){if(!fresh||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;jwk=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});await writeFile(join(directory,'signing-key.json'),JSON.stringify(jwk),{mode:0o600,flag:'wx'});}
  const key=createPrivateKey({key:jwk,format:'jwk'}),publicJwk=createPublicKey(key).export({format:'jwk'}) as JsonObject;
  const store=await openStore({driver:'sqlite',url:join(directory,'journal.db'),nowMs,authority:{ownerDeviceId:DEVICE,deviceEpoch:EPOCH,publicJwk},ackLevel:'venue',producer:{deviceId:DEVICE,deviceEpoch:EPOCH},signerPublicJwk:publicJwk,signer:bytes=>sign('sha256',bytes,{key,dsaEncoding:'ieee-p1363'}).toString('base64url')});
  const s=new SourceSession({organizationId:`lab-${runId}`,venueId:'simulation'},store,nowMs,fixture.stationIds);
  await store.provision(s.scope,1,1);
  if(fresh)await initializeFixtureV2(store,s.scope,fixture,publicJwk);
  return s;
 }
 /** Submit one typed command; rejections come back as results (never thrown) so the runner records them. */
 /** `robotId`: the robot or cell device whose bound simulator observer reports (observation types only). */
 async submit(type:string,payload:JsonObject,operationId:string,robotId?:string):Promise<CommandResult>{
  const observer=OBSERVATIONS.includes(type),traffic=TRAFFIC.includes(type);
  const role=observer&&robotId?`simulator:${robotId}`:traffic&&robotId?`executor:${robotId}`:observer||traffic?undefined:roleOf(type);
  if(!role)throw new Error('COMMAND_NOT_ALLOWED');
  const at=new Date(this.nowMs()).toISOString(),types=observer?OBSERVATIONS:traffic?TRAFFIC:ROLES[role]!;
  const c:CommandEnvelope={schemaVersion:1,...this.scope,type,operationId,actorRef:role,deviceId:DEVICE,deviceEpoch:EPOCH,coordinatorEpoch:1,policyRevision:1,occurredAt:at,recordedAt:at,payload,payloadHash:hashPayload(payload),...(typeof payload.expectedVersion==='number'?{expectedVersion:payload.expectedVersion}:{})};
  const principal={id:role,deviceId:DEVICE,scope:this.scope,permissions:[...new Set(types.flatMap(t=>requiredPermissions(t,{})))],expiresAtMs:this.nowMs()+60000,stationIds:STATION_ROLES.includes(role)||observer?this.stationIds:[]};
  return processCommand(this.store,c,(command,snapshots)=>this.registry.decide(command,snapshots),async command=>authorizeVenueCommand(principal,command,this.nowMs()));
 }
 read(kind:string,id:string){return this.store.readSnapshot({...this.scope,kind,id});}
 receipt(operationId:string,payloadHash:string){return this.store.receipt(this.scope,operationId,payloadHash);}
 effects(){return this.store.effects(this.scope);}
 /** Journal in durable producer order (integer sequences stored as TEXT); entries are never rewritten. */
 async journal(){return (await this.store.journal(this.scope)).sort((a,b)=>{const l=BigInt(a.sequence),r=BigInt(b.sequence);return l<r?-1:l>r?1:0;});}
 close(){return this.store.close();}
}
/** Dev-only synthetic venue generalised from the v1 fixture: every table/kitchen point of the world, one meal per station, every AMR entity. */
export async function initializeFixtureV2(store:DurableStore,scope:Scope,f:SourceFixture,publicJwk:JsonObject){
 const seed=(kind:string,id:string,state:JsonObject)=>store.seed(scope,kind,id,state),w=f.project.world;
 const features=Object.fromEntries(['catalog','sessions','pos.order','orders','kitchen','fulfillment','fleet','robot.delivery',...f.coffee?['inventory','beverage']:[]].map(k=>[k,{status:'enabled',revision:1}]));
 await seed('device',DEVICE,{deviceEpoch:EPOCH,status:'active',publicJwk});
 await seed('configuration','applied',{revision:1,features,readiness:{robot:true},beverage:{allowModelledMeasurements:true}});
 const coffeeItems=f.coffee?f.coffee.recipes.map(r=>({id:r.id,name:`Simulated ${r.id}`,stationId:f.coffee!.stationId,unitMinor:'35000',available:true})):[];
 const menu={version:1,currency:'VND',items:[...f.stationIds.filter(id=>id!==f.coffee?.stationId).map(stationId=>({id:mealFor(stationId),name:`Simulated meal (${stationId})`,stationId,unitMinor:'50000',available:true})),...coffeeItems]};
 await seed('catalog','current',menu);await seed('catalog-version','1',menu);
 const bindings:JsonObject={},fleet=f.fleet??{},navigation=f.navigation;
 const mapId=navigation?.mapId??'lab-world',mapRevision=navigation?.mapRevision??String(w.revision);
 if(navigation)for(const p of w.points){const b=navigation.bindings[p.id];if(!b||b.waypointId!==p.id||b.mapId!==mapId||b.mapRevision!==mapRevision||b.frame!=='map'||![b.x,b.y,b.yaw].every(Number.isFinite))throw new Error(`COMPILED_BINDING_INVALID:${p.id}`);}
 for(const p of w.points){
  if(!(fleet.unbindTables&&p.kind==='table'))bindings[p.id]=navigation?{...navigation.bindings[p.id]!}:{waypointId:p.id,mapId,mapRevision,frame:'map',x:p.x,y:p.y,yaw:0};
  if(p.kind==='table')await seed('table',p.id,{id:p.id,name:p.name,activeSessionId:null});
  if(p.kind==='kitchen'||p.kind==='coffee_pickup'&&f.coffee?.stationId===p.id)await seed('station',p.id,{id:p.id,name:p.name});
 }
 for(const r of f.robots)await seed('robot',r.id,{id:r.id,driver:'simulator',validation:'simulated',capabilities:[...fleet.capabilities??['delivery']],speedControl:true,trays:r.trays,maxLoadMinor:'10000',battery:fleet.battery??100,minBattery:20,availability:'idle',goalState:'idle',controlEpoch:1,ownerDeviceId:DEVICE,mapId,mapRevision,bindingRevision:mapRevision,parkingPoint:r.parkingId,position:r.parkingId,offlineExecution:true,bindings,safetyState:'clear',observerId:`simulator:${r.id}`});
 if(f.coffee){
  const {cellId,armId,stationId}=f.coffee,epoch=new Date(0).toISOString();
  for(const x of COFFEE_STOCK)await seed('stock-item',x.id,{name:x.name,baseUnit:x.baseUnit,conversions:{},negativePolicy:'block',currency:'VND',onHand:x.onHand,valueMinor:'0',movementSeq:0});
  // devices are venue configuration (like robots); their state comes only from bound observations
  for(const [id,role] of coffeeDevices(cellId,armId))await seed('cell-device',id,{cellId,stationId,role,validation:'simulated',status:'offline',level:null,reasonCodes:[],controlEpoch:1,observerId:`simulator:${id}`,bootId:null,seq:'0',observedAt:null,
   cleaning:{status:'ok',intervalMs:8*3600000,dueAt:new Date((f.epochMs??Date.parse('2026-11-01T00:00:00.000Z'))+8*3600000).toISOString(),lastCleanedAt:epoch,cleanedBy:'lab-fixture'}});
 }
}
