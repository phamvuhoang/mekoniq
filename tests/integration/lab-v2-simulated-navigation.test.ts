// SIL navigation (SIM-01/04/09): the simulated Nav2 backend behind the production RobotAdapter contract, driven through the real source domain,
// journal and robot dispatcher. The worker port here is a PROTOCOL DOUBLE (evidence `protocol_double`): it proves identity, admission and the
// terminal-state mapping, never Gazebo/Nav2 physics. The Linux SIL run stays blocked_external on this host.
import {afterEach,expect,test,vi} from 'vitest';
import net from 'node:net';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {JsonObject} from '../../packages/contracts/src/index';
import {dispatchRobotEffects} from '../../packages/robot-adapters/src/dispatch';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {readCompiledWorld} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {cleanupSil,makeSilRig as makeSilContractRig,type NativeResult} from '../support/sil-rig';
afterEach(cleanupSil);

test('SIL uses simulated identity without relaxing production admission',async()=>{
 const rig=await makeSilContractRig({nativeResult:'accepted'});
 try{
  expect((await rig.adapter.describe()).validation).toBe('simulated');
  expect((await rig.adapter.describe()).adapter).toBe('simulator');
  expect(await rig.startDelivery()).toEqual(['accepted']);
  expect(await rig.fulfillmentServed()).toBe('0');
  await expect(rig.observeAsBrowser()).rejects.toThrow('OBSERVER_NOT_BOUND');
  expect(await rig.robotExecuteAttempts()).toBe(1);
  expect(rig.port.executeCalls).toBe(1);
  // the backend reports what it is: a protocol double that cannot step, with its boot identity
  expect(await rig.backend.capability()).toMatchObject({backendId:'gazebo_nav2',available:true,step:false,evidence:'protocol_double'});
  expect((await rig.mission()).status).toBe('executing');
  expect(await rig.journalTypes()).not.toContain('MissionArrived');
 }finally{await rig.close();}
});

test.each<[NativeResult,string[],string,string|null]>([
 ['accepted',[],'executing',null],
 ['completed',['completed'],'executing','MissionArrived'],
 ['canceled',['failed'],'needs_attention',null],
 ['result_missing',['unknown'],'needs_attention',null],
 ['aborted',['failed'],'needs_attention',null],
])('terminal mapping %s: only accepted+SUCCEEDED+error_code 0 arrives',async(native,polled,status,event)=>{
 const rig=await makeSilContractRig({nativeResult:native});
 try{
  await rig.startDelivery();
  expect(await rig.poll()).toEqual(polled);
  expect(await rig.poll()).toEqual([]); // a terminal state is reported once
  expect((await rig.mission()).status).toBe(status);
  const events=await rig.journalTypes();
  if(event)expect(events).toContain(event);else expect(events).not.toContain('MissionArrived');
  expect(await rig.fulfillmentServed()).toBe('0');
  expect(await rig.robotExecuteAttempts()).toBe(1);expect(rig.port.executeCalls).toBe(1);
  const state=await rig.adapter.reconcile(String((await rig.mission()).commandId));
  expect(state.evidence).toMatchObject({simulated:true,backend:'gazebo_nav2',evidence:'protocol_double'});
 }finally{await rig.close();}
});

test('a stale map target is refused locally and poor localization is refused by the bridge: nothing completes, nothing is resent',async()=>{
 const stale=await makeSilContractRig({nativeResult:'accepted'});
 try{
  await stale.source.store.seed(stale.source.scope,'robot','amr-1',{...(await stale.source.read('robot','amr-1')).state,bindings:Object.fromEntries(Object.entries((await stale.source.read('robot','amr-1')).state.bindings as JsonObject).map(([k,v])=>[k,{...(v as JsonObject),mapRevision:'0'}])),bindingRevision:'0',mapRevision:'0'},(await stale.source.read('robot','amr-1')).version);
  // the robot reports map revision 0 while the SIL bundle is revision 1: admission binds to the robot's map, the adapter refuses the stale target
  const observed=await stale.startDelivery();
  expect(observed).toEqual(['rejected']);expect(stale.port.executeCalls).toBe(0);
  expect((await stale.mission()).status).toBe('needs_attention');
 }finally{await stale.close();}
 const poor=await makeSilContractRig({nativeResult:'covariance_high'});
 try{
  expect(await poor.startDelivery()).toEqual(['rejected']);
  expect(poor.port.executeCalls).toBe(1);expect((await poor.mission()).status).toBe('needs_attention');
  expect(await poor.robotExecuteAttempts()).toBe(1);
 }finally{await poor.close();}
});

test('bridge loss at execute is unknown, holds the mission and is never resent by dispatch',async()=>{
 const rig=await makeSilContractRig({nativeResult:'accepted'});
 try{
  rig.port.unreachable=true;
  expect(await rig.startDelivery()).toEqual(['unknown']);
  expect((await rig.mission()).status).toBe('needs_attention');
  rig.port.unreachable=false;
  await dispatchRobotEffects(rig.source.store,rig.source.scope,rig.adapter,Date.now());
  expect(rig.port.executeCalls).toBe(0);
  const effects=(await rig.source.effects()).filter(e=>e.type==='robot.execute');
  expect(effects.map(e=>[e.status,e.attempts])).toEqual([['unknown',1]]);
 }finally{await rig.close();}
});

test('no robot network transport is opened by the simulated adapter',async()=>{
 const spies=[vi.spyOn(net.Socket.prototype,'connect'),vi.spyOn(net,'createConnection'),vi.spyOn(http,'request')];
 const rig=await makeSilContractRig({nativeResult:'completed'});
 try{await rig.startDelivery();await rig.poll();for(const s of spies)expect(s).not.toHaveBeenCalled();}
 finally{for(const s of spies)s.mockRestore();await rig.close();}
});

test('a compiled bundle manifest is read back and its input hash equals the TypeScript canonical hash of the fixture (Python/TS parity)',async()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/digital-twin/restaurant-v2.json','utf8')),assets=fixture.assetFiles.map((f:string)=>JSON.parse(readFileSync(join('tests/fixtures/digital-twin',f),'utf8')));
 const world=await readCompiledWorld('tests/fixtures/digital-twin/bundle');
 expect(world.inputHash).toBe(fixture.expected.inputHash);
 expect(world.inputHash).toBe(hashJson({project:fixture.project,assets}));
 expect(world).toMatchObject({mapId:'lab-world',mapRevision:'1',worldFile:'world.sdf',mapIdentityFile:'map.identity.json',sceneIndexFile:'scene-index.json',robots:[{entityId:'amr-1',namespace:'robot_amr_1'}]});
 expect(world.manifestHash).toMatch(/^[0-9a-f]{64}$/);
 await expect(readCompiledWorld('tests/fixtures/digital-twin')).rejects.toThrow('BUNDLE_MISSING');
});
