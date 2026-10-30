import {SimulatorAdapter} from '../../../packages/robot-adapters/src/simulator';
import {dispatchRobotEffects,robotEventCommand} from '../../../packages/robot-adapters/src/dispatch';
import type {RobotEvent,RobotManifest} from '../../../packages/robot-adapters/src/contract';
import {processCommand} from '../../../packages/sync/src/command-processor';
import {hashPayload} from '../../../packages/contracts/src/index';
import type {CommandEnvelope,Scope,Snapshot} from '../../../packages/contracts/src/index';
import type {DurableStore} from '../../../packages/sync/src/store';
import type {ModuleRegistry} from '../../../packages/domain/src/modules';
type Sim={adapter:SimulatorAdapter;bootId:string;events:RobotEvent[];lastTick:number;unsubscribe:()=>void};
/** App-local fake executor. Hardware profiles are left to their native executor, never simulated implicitly. */
export function startSimulatedRobotRuntime(options:{store:DurableStore;scope:Scope;registry:ModuleRegistry;nowMs?:()=>number;intervalMs?:number;isActive?:()=>boolean|Promise<boolean>;onError?:(error:Error)=>void}) {
 const {store,scope,registry}=options,now=options.nowMs??Date.now,sims=new Map<string,Sim>();
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,tail:Promise<unknown>=Promise.resolve();
 async function observe(robot:Snapshot,sim:Sim,event:RobotEvent) {
  const snapshots=await store.snapshots(scope),authority=snapshots.find(s=>s.ref.kind==='__scope__')?.state;
  if(!authority||robot.state.ownerDeviceId!==authority.ownerDeviceId)return;
  const payload=robotEventCommand({...event,bootId:sim.bootId});
  const actorRef=`simulator:${robot.ref.id}`,timestamp=new Date(now()).toISOString();
  const command:CommandEnvelope={schemaVersion:1,...scope,operationId:hashPayload({robotId:robot.ref.id,eventId:event.id,bootId:sim.bootId}),type:'Robot.Observe',actorRef,deviceId:String(authority.ownerDeviceId),deviceEpoch:String(authority.deviceEpoch),coordinatorEpoch:Number(authority.coordinatorEpoch),policyRevision:Number(authority.policyRevision),occurredAt:timestamp,recordedAt:timestamp,payload,payloadHash:hashPayload(payload)};
  await processCommand(store,command,(c,s)=>registry.decide(c,s),async c=>c.actorRef===actorRef&&c.deviceId===authority.ownerDeviceId&&c.organizationId===scope.organizationId&&c.venueId===scope.venueId&&robot.state.validation==='simulated');
 }
 async function runStep() {
  if(stopped||options.isActive&&!await options.isActive())return;
  const snapshots=await store.snapshots(scope);
  for(const robot of snapshots.filter(s=>s.ref.kind==='robot'&&s.state.driver==='simulator'&&s.state.validation==='simulated')) {
   let sim=sims.get(robot.ref.id);
   if(!sim) {
    const state=robot.state;
    const manifest:RobotManifest={id:robot.ref.id,adapter:'simulator',protocolVersion:'1',firmware:'app-simulator-1',capabilities:Array.isArray(state.capabilities)?state.capabilities as string[]:[],mapId:String(state.mapId),mapRevision:String(state.mapRevision),offlineExecution:state.offlineExecution===true,maxLoadMinor:String(state.maxLoadMinor),trays:Number(state.trays),validation:'simulated'};
    const adapter=new SimulatorAdapter(manifest,now()),events:RobotEvent[]=[];
    sim={adapter,events,bootId:crypto.randomUUID(),lastTick:now(),unsubscribe:adapter.observe(event=>events.push(event))};sims.set(robot.ref.id,sim);
    // A fresh fake process has no native goal journal. Existing attempts become unknown,
    // preserving mission/cargo ownership instead of executing a second physical goal.
    const effects=await store.effects(scope,'robot.execute');
    for(const effect of effects)if(['confirmed','dispatching','unknown'].includes(String(effect.status))) {
      const command=effect.payload as unknown as import('../../../packages/contracts/src/index').RobotCommand;
      const mission=snapshots.find(s=>s.ref.kind==='mission'&&s.ref.id===command.missionId);
      if(command.robotId===robot.ref.id&&mission?.state.commandId===command.commandId&&['assigned','executing'].includes(String(mission.state.status)))sim.events.push({type:'unknown',id:`recovery:${command.commandId}`,commandId:command.commandId,bootId:sim.bootId,sequence:'1',observedAt:new Date(now()).toISOString(),payload:{robotId:robot.ref.id,missionId:command.missionId,missionRevision:command.missionRevision,controlEpoch:command.controlEpoch,simulated:true}});
    }
   }
   await dispatchRobotEffects(store,scope,sim.adapter,now());
   const current=now();sim.adapter.advance(Math.max(0,current-sim.lastTick));sim.lastTick=current;
   for(const event of sim.events.splice(0))await observe(robot,sim,event);
  }
 }
 function step(){const result=tail.then(runStep);tail=result.catch(()=>{});return result;}
 const interval=options.intervalMs??500;
 async function loop(){try{await step();}catch(error){options.onError?.(error instanceof Error?error:new Error('SIMULATOR_RUNTIME_FAILURE'));}finally{if(!stopped)timer=setTimeout(()=>{void loop();},interval);}}
 if(interval>0)void loop();
 return {step,async close(){stopped=true;if(timer)clearTimeout(timer);await tail;for(const sim of sims.values())sim.unsubscribe();}};
}
