// Dev-only synthetic venue. No production tenant, endpoint, credentials or test support imports.
import type {DurableStore} from '../../sync/src/store';
import type {JsonObject,Scope} from '../../contracts/src/index';
import type {LabProject} from './types';
export async function initializeFixture(store:DurableStore,scope:Scope,project:LabProject,publicJwk:JsonObject){
 const seed=(kind:string,id:string,state:JsonObject)=>store.seed(scope,kind,id,state);
 const features=Object.fromEntries(['catalog','sessions','pos.order','orders','kitchen','fulfillment','fleet','robot.delivery'].map(k=>[k,{status:'enabled',revision:1}]));
 await seed('device','lab-coordinator',{deviceEpoch:'lab-epoch-1',status:'active',publicJwk});
 await seed('configuration','applied',{revision:1,features,readiness:{robot:true}});
 const menu={version:1,currency:'VND',items:[{id:'lab-meal',name:'Simulated meal',stationId:'kitchen',unitMinor:'50000',available:true}]};
 await seed('catalog','current',menu);await seed('catalog-version','1',menu);
 await seed('station','kitchen',{id:'kitchen',name:'Simulation kitchen'});
 const bindings:JsonObject={};
 for(const p of project.world.points){
  bindings[p.id]={waypointId:p.id,mapId:'lab-world',mapRevision:String(project.world.revision),frame:'map',x:p.kind==='table'?p.x-0.8:p.x,y:p.y,yaw:0};
  if(p.kind==='table')await seed('table',p.id,{id:p.id,name:p.name,activeSessionId:null});
 }
 await seed('robot','sim-1',{id:'sim-1',driver:'simulator',validation:'simulated',capabilities:['delivery'],trays:project.design.trays,maxLoadMinor:String(Math.round(project.design.payloadKg*1000)),battery:100,minBattery:20,availability:'idle',goalState:'idle',controlEpoch:1,ownerDeviceId:'lab-coordinator',mapId:'lab-world',mapRevision:String(project.world.revision),parkingPoint:'parking',offlineExecution:true,bindings,safetyState:'clear'});
}
