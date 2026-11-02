import {expect,test} from 'vitest';
import {createRestaurantLab} from '../support/restaurant-lab';
import fixture from '../fixtures/restaurant-v1.json';
import {dispatchRobotEffects} from '../../packages/robot-adapters/src/dispatch';
import {SimulatorAdapter} from '../../packages/robot-adapters/src/simulator';
import type {JsonObject,RobotManifest} from '../../packages/contracts/src/index';
const ok=(r:{status:string;code?:string})=>expect(r.code??r.status).toBe('accepted');

test('pending traffic reservations gate real mission dispatch until evidence-backed promotion',async()=>{
 const lab=await createRestaurantLab();try{
  await lab.seed('robot','sim-1',{zoneEnforcement:false});
  await lab.seed('robot','sim-2',{...fixture.robot,id:'sim-2',zoneEnforcement:false} as JsonObject);
  ok(await lab.command('executor','Zone.Reserve',{zoneId:'aisle',robotId:'sim-1',ttlMs:1000}));
  const second=await lab.command('executor','Zone.Reserve',{zoneId:'aisle',robotId:'sim-2'});
  expect(second.value).toMatchObject({status:'pending',reason:'ZONE_SERIALIZED'});
  const commands=await Promise.all(['sim-1','sim-2'].map(robotId=>lab.command('cashier','Mission.Create',{robotId,target:'table-1'},'mission-'+robotId)));
  for(let i=0;i<commands.length;i++)if(commands[i]!.code==='VERSION_CONFLICT')commands[i]=await lab.command('cashier','Mission.Create',{robotId:'sim-'+(i+1),target:'table-1'},'mission-sim-'+(i+1));
  commands.forEach(ok);
  const adapters=['sim-1','sim-2'].map(id=>new SimulatorAdapter({...fixture.robot,id,adapter:'simulator',protocolVersion:'1',firmware:'fixture',zoneEnforcement:false} as RobotManifest,lab.clock.nowMs));
  const counts=[0,0];adapters.forEach((a,i)=>{const execute=a.execute.bind(a);a.execute=async c=>{counts[i]++;return execute(c);};});
  const store=await lab.getStore('coordinator');
  await Promise.all(adapters.map(a=>dispatchRobotEffects(store,lab.scope,a,lab.clock.nowMs)));
  expect(counts).toEqual([1,0]);
  // Unknown holders never lapse into permission, even after their TTL.
  const holder=await lab.state<JsonObject>('robot','sim-1');await lab.seed('robot','sim-1',{...holder,availability:'unknown',goalState:'unknown'});
  await lab.advance(2000);
  const waiting=await lab.command('executor','Zone.Reserve',{zoneId:'aisle',robotId:'sim-2'});expect(waiting.value.status).toBe('pending');
  await dispatchRobotEffects(store,lab.scope,adapters[1]!,lab.clock.nowMs);expect(counts[1]).toBe(0);
  // Restore the clock inside the ORIGINAL replacement's expiry; release requires observed clearance, not elapsed time.

  for(const zoneId of ['aisle','__venue_movement__'])ok(await lab.command('manager','Zone.Release',{reservationId:zoneId+'@sim-1',evidence:'operator verified robot removed from route'}));
  await dispatchRobotEffects(store,lab.scope,adapters[1]!,lab.clock.nowMs);
  await dispatchRobotEffects(store,lab.scope,adapters[1]!,lab.clock.nowMs);expect(counts[1]).toBe(1);
 }finally{await lab.close();}
});

import {hashPayload,type RobotCommand} from '../../packages/contracts/src/index';
import {startNativeValetudoRuntime,type ExecutorBridge} from '../../apps/tablet-android/src/robot-executor-bridge';
import {valetudoProfile} from '../support/valetudo-rig';
import type {ValetudoSample} from '../../packages/robot-adapters/src/valetudo/map';
import type {NativeExecutionState,RobotEvent} from '../../packages/robot-adapters/src/contract';
/** Only physical I/O/native journal is doubled; mission, outbox, transport, adapter and observation router are production code. */
async function nativeRig(){
 const lab=await createRestaurantLab(),profile=valetudoProfile('native','http://native-only.invalid',{robotId:'val-1',validation:'hardware_validated'});
 const bindings=Object.fromEntries(['kitchen','table-1','table-2'].map((id,i)=>[id,{waypointId:id,mapId:profile.mapId,mapRevision:profile.mapRevision,frame:profile.frame,x:10+i,y:12,yaw:0}]));
 await lab.seed('robot','val-1',{...fixture.robot,id:'val-1',driver:'valetudo',validation:'hardware_validated',ownerDeviceId:'coordinator',controlEpoch:1,capabilities:['delivery','guide'],mapId:profile.mapId,mapRevision:profile.mapRevision,bindingRevision:profile.mapRevision,bindings,speedControl:false,zoneEnforcement:false} as JsonObject);
 const samples:ValetudoSample[]=[],calls:string[]=[],journal=new Map<string,{command:RobotCommand;ackAtMs:number;stopAtMs?:number;superseded?:boolean}>();
 const bridge:ExecutorBridge={
  async submit({command}){calls.push('goto:'+command.target.waypointId);for(const row of journal.values())row.superseded=true;journal.set(command.commandId,{command:structuredClone(command),ackAtMs:lab.clock.nowMs});return {accepted:true,unknown:false};},
  async reconcile({commandId}):Promise<NativeExecutionState>{const row=journal.get(commandId);return row?{status:'executing',evidence:{hash:hashPayload(row.command as never),nativeState:row.superseded?'superseded':row.stopAtMs===undefined?'executing':'cancelling',commandId,controlEpoch:row.command.controlEpoch,goal:{x:Number(row.command.target.x)*100,y:Number(row.command.target.y)*100},ackAtMs:row.ackAtMs,...(row.stopAtMs===undefined?{}:{stopAtMs:row.stopAtMs}),samples:samples.filter(s=>s.receivedAtMs>=row.ackAtMs) as never}}:{status:'unknown',evidence:{reason:'NO_GOAL_QUERY'}};},
  async cancel({commandId}){calls.push('stop');const row=journal.get(commandId);if(row)row.stopAtMs=lab.clock.nowMs;return {acknowledged:true,unknown:false};},
  async requestStop(){calls.push('stop');return {acknowledged:true,physicalStopConfirmed:false};},
  async observations({sinceMs}){return {samples:samples.filter(s=>s.receivedAtMs>=sinceMs)};}
 };
 const store=await lab.getStore('coordinator');
 const start=()=>startNativeValetudoRuntime({store,scope:lab.scope,registry:lab.registry,profile,bridge,nowMs:()=>lab.clock.nowMs,intervalMs:0});
 let runtime=start();
 const sample=async(status:string,target:{x:number;y:number},ms=1000)=>{lab.clock.nowMs+=ms;samples.push({receivedAtMs:lab.clock.nowMs,reachable:true,status,mapFingerprint:profile.mapFingerprint,position:target,...(status==='moving'?{goToTarget:target}:{})});await runtime.step();};
 const arrive=async()=>{const row=[...journal.values()].at(-1)!;const target={x:Number(row.command.target.x)*100,y:Number(row.command.target.y)*100};await sample('moving',target);await sample('idle',target);await sample('idle',target,2000);};
 return {lab,store,bridge,profile,calls,journal,samples,start,sample,arrive,get runtime(){return runtime;},async restart(){await runtime.close();runtime=start();},async close(){await runtime.close();await lab.close();}};
}

test('retarget waits after native STOP ACK for stationary evidence, preserving replacement identity',async()=>{
 const rig=await nativeRig(),{lab}=rig;try{
  ok(await lab.command('cashier','Session.Open',{sessionId:'s',tableId:'table-1'}));
  const order=await lab.command('cashier','Order.Place',{sessionId:'s',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'1'}]});ok(order);
  const lineId=(order.value.lineIds as string[])[0]!;
  ok(await lab.command('chef','Kitchen.Ready',{lineId,quantity:'1',stationId:'kitchen',expectedVersion:1}));
  const allocation=await lab.command('cashier','Fulfillment.Allocate',{lineId,quantity:'1',expectedVersion:2,method:'robot'});ok(allocation);
  const created=await lab.command('cashier','Mission.Create',{robotId:'val-1',allocationIds:[allocation.value.allocationId!]});ok(created);
  const missionId=String(created.value.missionId);await rig.runtime.step();await rig.arrive();
  const loaded=await lab.state<JsonObject>('mission',missionId);
  ok(await lab.command('cashier','Mission.ConfirmStop',{missionId,expectedVersion:loaded.version,missionRevision:loaded.revision,stopId:loaded.currentStopId}));
  await rig.runtime.step();rig.calls.splice(0,1); // first kitchen leg is complete; now observe old -> cancel -> replacement
  ok(await lab.command('cashier','Session.Move',{sessionId:'s',toTableId:'table-2',expectedVersion:(await lab.state<JsonObject>('session','s')).version}));
  const replacement=(await rig.store.effects(lab.scope,'robot.execute')).at(-1)!;
  await rig.runtime.step();
  expect(rig.calls).toEqual(['goto:table-1','stop']);
  expect((await rig.store.effects(lab.scope,'robot.execute')).find(e=>e.id===replacement.id)?.status).not.toBe('failed');
  await rig.runtime.step();expect(rig.calls).toEqual(['goto:table-1','stop']);
  await rig.sample('idle',{x:1100,y:1200});await rig.sample('idle',{x:1100,y:1200},2000);await rig.runtime.step();
  expect(rig.calls).toEqual(['goto:table-1','stop','goto:table-2']);
  const sent=rig.journal.get(String(replacement.id))!.command;
  expect(sent).toEqual(replacement.payload);
  await rig.restart();await rig.runtime.step();await rig.arrive();
  const reached=await lab.state<JsonObject>('mission',missionId);
  expect((reached.stops as JsonObject[]).at(-1)?.status).toBe('awaiting_action');
  ok(await lab.command('cashier','Mission.ConfirmStop',{missionId,expectedVersion:reached.version,missionRevision:reached.revision,stopId:reached.currentStopId}));
  ok(await lab.command('cashier','Mission.Create',{robotId:'val-1',target:'kitchen'}));await rig.runtime.step();
  expect(rig.calls).toEqual(['goto:table-1','stop','goto:table-2','goto:kitchen']);
 }finally{await rig.close();}
});

test('WebView restart restores accepted command identity before journal completion without another goto',async()=>{
 const rig=await nativeRig(),{lab}=rig;try{
  const created=await lab.command('cashier','Mission.Create',{robotId:'val-1',target:'table-1'});ok(created);
  const missionId=String(created.value.missionId);await rig.runtime.step();
  expect((await lab.state<JsonObject>('mission',missionId)).status).toBe('executing');
  await rig.restart();const events:RobotEvent[]=[];rig.runtime.adapter.observe(e=>events.push(e));
  await rig.runtime.step();await rig.arrive();
  expect(rig.calls).toEqual(['goto:table-1']);
  expect(events.find(e=>e.type==='completed')?.payload).toMatchObject({missionId,missionRevision:1,controlEpoch:1});
  expect((await lab.state<JsonObject>('mission',missionId)).stops).toMatchObject([{status:'awaiting_action'}]);
 }finally{await rig.close();}
});

test('unmapped concurrent missions receive one venue movement right and completion promotes the waiting original command',async()=>{
 const lab=await createRestaurantLab();try{
  await lab.seed('robot','sim-2',{...fixture.robot,id:'sim-2'} as JsonObject);
  const results=await Promise.all(['sim-1','sim-2'].map(robotId=>lab.command('cashier','Mission.Create',{robotId,target:'table-1'},'unmapped-'+robotId)));
  for(let i=0;i<results.length;i++)if(results[i]!.code==='VERSION_CONFLICT')results[i]=await lab.command('cashier','Mission.Create',{robotId:'sim-'+(i+1),target:'table-1'},'unmapped-sim-'+(i+1));results.forEach(ok);
  const store=await lab.getStore('coordinator'),snapshots=await store.snapshots(lab.scope);
  expect(snapshots.filter(s=>s.ref.kind==='reservation'&&s.state.status==='granted')).toHaveLength(1);
  const winner=String(snapshots.find(s=>s.ref.kind==='reservation'&&s.state.status==='granted')!.state.robotId),loser=winner==='sim-1'?'sim-2':'sim-1';
  const simulators=new Map([winner,loser].map(id=>[id,new SimulatorAdapter({...fixture.robot,id,adapter:'simulator',protocolVersion:'1',firmware:'fixture'} as RobotManifest,lab.clock.nowMs)]));
  const events:RobotEvent[]=[];simulators.get(winner)!.observe(e=>events.push(e));
  const first=await Promise.all([...simulators.values()].map(a=>dispatchRobotEffects(store,lab.scope,a,lab.clock.nowMs)));
  expect(first.map(r=>r.length).sort()).toEqual([0,1]);
  simulators.get(winner)!.advance(1000);
  const {robotEventCommand}=await import('../../packages/robot-adapters/src/dispatch');
  for(const event of events)ok(await lab.command('executor:'+winner,'Robot.Observe',robotEventCommand(event),event.id));
  const mission=(await store.snapshots(lab.scope)).find(s=>s.ref.kind==='mission'&&s.state.robotId===winner)!;
  ok(await lab.command('cashier','Mission.ConfirmStop',{missionId:mission.ref.id,missionRevision:mission.state.revision,stopId:mission.state.currentStopId,expectedVersion:mission.version}));
  expect((await dispatchRobotEffects(store,lab.scope,simulators.get(loser)!,lab.clock.nowMs))).toHaveLength(1);
  expect((await dispatchRobotEffects(store,lab.scope,simulators.get(loser)!,lab.clock.nowMs))).toHaveLength(0);
 }finally{await lab.close();}
});

test('unresolved accepted native effect recovers and completion survives a failed domain commit',async()=>{
 const rig=await nativeRig(),{lab,store}=rig;try{
  const created=await lab.command('cashier','Mission.Create',{robotId:'val-1',target:'table-1'});ok(created);
  const complete=store.completeEffect.bind(store);let crash=true;
  store.completeEffect=async(s,id,status)=>{if(status==='confirmed'&&crash){crash=false;throw new Error('LOST_NATIVE_RECEIPT');}return complete(s,id,status);};
  await rig.runtime.step();expect((await store.effects(lab.scope,'robot.execute'))[0]!.status).toBe('unknown');
  await rig.restart();await rig.runtime.step();
  const commit=store.commit.bind(store);let failCompletion=true;
  store.commit=async request=>{if(request.command.type==='Robot.Observe'&&request.command.payload.type==='completed'&&failCompletion){failCompletion=false;throw new Error('FORWARD_FAILED');}return commit(request);};
  await expect(rig.arrive()).rejects.toThrow('FORWARD_FAILED');
  expect((await lab.state<JsonObject>('mission',String(created.value.missionId))).stops).toMatchObject([{status:'travelling'}]);
  await rig.runtime.step();
  expect((await lab.state<JsonObject>('mission',String(created.value.missionId))).stops).toMatchObject([{status:'awaiting_action'}]);
  expect(rig.calls).toEqual(['goto:table-1']);expect(await lab.count('MissionArrived')).toBe(1);
 }finally{await rig.close();}
});

for(const invalid of ['hash','rejected','epoch','owner'])test('native recovery holds '+invalid+' evidence without replay or completion',async()=>{
 const rig=await nativeRig(),{lab}=rig;try{
  const created=await lab.command('cashier','Mission.Create',{robotId:'val-1',target:'table-1'});ok(created);await rig.runtime.step();
  if(invalid==='hash'||invalid==='rejected'){
   const reconcile=rig.bridge.reconcile.bind(rig.bridge);rig.bridge.reconcile=async input=>{const state=await reconcile(input);return {...state,evidence:{...state.evidence,...(invalid==='hash'?{hash:'wrong'}:{nativeState:'failed'})}};};
  }else{const robot=await lab.state<JsonObject>('robot','val-1');await lab.seed('robot','val-1',{...robot,...(invalid==='epoch'?{controlEpoch:2}:{ownerDeviceId:'other'})});}
  await rig.restart();await rig.runtime.step();await rig.arrive();
  expect(rig.calls).toEqual(['goto:table-1']);expect(await lab.count('MissionArrived')).toBe(0);
  expect((await lab.state<JsonObject>('mission',String(created.value.missionId))).stops).toMatchObject([{status:'travelling'}]);
 }finally{await rig.close();}
});

test('recovered acceptance during cancellation cannot block stationary cancellation evidence',async()=>{
 const rig=await nativeRig(),{lab}=rig;try{
  const created=await lab.command('cashier','Mission.Create',{robotId:'val-1',target:'table-1'});ok(created);
  const missionId=String(created.value.missionId);await rig.runtime.step();
  const mission=await lab.state<JsonObject>('mission',missionId);
  ok(await lab.command('cashier','Mission.Cancel',{missionId,expectedVersion:mission.version}));
  // Cancel is durable, but its STOP has not yet reached native when the WebView reloads.
  await rig.restart();await rig.runtime.step();
  expect(rig.calls).toEqual(['goto:table-1','stop']);
  await rig.sample('idle',{x:1100,y:1200});await rig.sample('idle',{x:1100,y:1200},2000);
  expect(await rig.runtime.adapter.reconcile(String(created.value.commandId))).toMatchObject({status:'cancelled'});
  expect(await lab.state<JsonObject>('mission',missionId)).toMatchObject({status:'cancelled'});
  expect(await lab.state<JsonObject>('robot','val-1')).toMatchObject({availability:'idle',missionId:null});
  expect(await lab.count('MissionCancelled')).toBe(1);
 }finally{await rig.close();}
});
