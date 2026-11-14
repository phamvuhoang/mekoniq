import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CoffeeDriver,initialCoffee,type CoffeeContext} from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import {createMockCoffeePorts,type CoffeePlantPorts} from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'b06-custody-mode-'));dirs.push(directory);
 const st=initialCoffee([{actor:'guest',table:0,recipe:'espresso',atTick:[10,10]}],{stationId:'coffee-pickup',cellId:'cell-1',armId:'arm-1'},['table-1'],()=>10);
 const submit=vi.fn(async(_type:string,..._args:unknown[])=>({status:'accepted',value:{}})),read=vi.fn(async(kind:string)=>({state:kind==='cup'?{ownerKind:'cell',ownerId:'cell-1',pendingTransfer:{commandId:'place-1',transferId:'transfer-1',to:{kind:'robot',id:'amr-1',slot:1}}}:{status:'reserved'}}));
 const ctx={directory,runId:'run-1',tick:()=>10,nowMs:()=>0,source:{read,submit},submit,receiver:()=>({robotId:'amr-1',slot:1}),dock:()=>({robotId:'amr-1',errorM:0,moving:false,localizationValid:true,bootId:'boot-1'})} as unknown as CoffeeContext;
 const base=createMockCoffeePorts(st,ctx,()=> 'boot-1');return {st,ctx,base,submit,read};
}
test('explicit correlated custody mode requires ledger binding with real arm snapshot',async()=>{const h=await fixture();expect(()=>new CoffeeDriver(h.st,h.ctx,()=> 'boot',Object.assign(h.base,{custodyEvidence:'correlated'}))).toThrow('NATIVE_CUP_JOURNAL_REQUIRED');});
test('correlated mode binds ledger and cannot synthesize receiver from completed arm command or tray map',async()=>{
 const h=await fixture(),bindLedger=vi.fn(),ports=Object.assign(h.base,{custodyEvidence:'correlated',bindLedger}) as CoffeePlantPorts;h.st.trays['amr-1']='cup-1';
 ports.drain=()=>[{deviceId:'arm-1',bootId:'arm-boot',seq:'10',observedAt:new Date(0).toISOString(),observation:{commandId:'place-1',result:'completed',reasonCodes:[]} as never,evidence:{source:'mujoco_world_arm',released:true}}];
 const driver=new CoffeeDriver(h.st,h.ctx,()=> 'boot',ports);try{expect(bindLedger).toHaveBeenCalledOnce();await driver.drain();expect(h.submit.mock.calls.some(c=>c[0]==='Cup.ConfirmTransfer')).toBe(false);}finally{await driver.close();}
});
test('absent custody mode preserves legacy mock no-ledger behavior',async()=>{const h=await fixture(),driver=new CoffeeDriver(h.st,h.ctx,()=> 'boot',h.base);try{expect(driver.ports.snapshot().arm).toBe(h.st.arm);}finally{await driver.close();}});

test('world receipts require shared engine provenance and distinct arm and tray observers',async()=>{
 const {validateCorrelatedTransferEvidence}=await import('../../packages/lab-runtime/src/v2/beverage/cup-ledger');
 const p={runId:'run-1',cupId:'cup-1',transferId:'transfer-1',commandId:'place-1',payloadHash:'0'.repeat(64),controlEpoch:2,deviceId:'arm-1',to:{kind:'robot' as const,id:'amr-1',slot:1}};
 const common={...p,to:undefined,observationId:'giver-1',deviceId:'arm-1',observerId:'mujoco-world-arm:arm-1',bootId:'world-boot',clockDomain:'world:world-boot',seq:'25',producer:'mujoco_world_arm',fidelity:'modeled',phase:'release',parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false},observedMonotonicNs:'500000000',receivedMonotonicNs:'500000000',quality:'valid',world:{engine:'mujoco_3d',sceneDigest:'1'.repeat(64),tick:25,physicsSubsteps:260}};delete common.to;
 const e={giver:common,receiver:{...common,observationId:'receiver-1',deviceId:'amr-1',observerId:'mujoco-world-tray:amr-1',producer:'mujoco_world_tray',phase:'receive',grip:null},dock:{robotId:'amr-1',slot:1,bootId:'world-boot',stationary:true,localizationValid:true,errorM:0,receivedMonotonicNs:'500000000'}};
 const policy={nowMonotonicNs:'500000000',freshnessNs:'500000000',dockToleranceM:.01};
 expect(validateCorrelatedTransferEvidence(e,p,policy).ok).toBe(true);
 for(const receiver of [{...e.receiver,world:undefined},{...e.receiver,bootId:'other'},{...e.receiver,clockDomain:'other'},{...e.receiver,world:{...e.receiver.world,sceneDigest:'2'.repeat(64)}},{...e.receiver,world:{...e.receiver.world,tick:24}},{...e.receiver,producer:'mock_amr'}])expect(validateCorrelatedTransferEvidence({...e,receiver},p,policy).ok).toBe(false);
 expect(validateCorrelatedTransferEvidence({...e,giver:{...common,receivedMonotonicNs:'0'}},p,{...policy,nowMonotonicNs:'500000001'}).ok).toBe(false);
 // A current independent evaluation at receipt time is fresh, even after the 25-tick hold.
 expect(validateCorrelatedTransferEvidence(e,p,{...policy,nowMonotonicNs:'500000001'}).ok).toBe(true);
 // A pause beyond the unchanged age bound invalidates both, rather than retimestamping them.
 expect(validateCorrelatedTransferEvidence(e,p,{...policy,nowMonotonicNs:'1000000001'}).ok).toBe(false);
});
test('run cancellation holds native motion while retaining the closed gripper command',async()=>{
 const h=await fixture(),holdMotion=vi.fn((reason:string)=>h.base.mockArm!.halt(reason));h.st.arm.holding='cup-1';h.st.arm.gripper='closed';h.st.arm.gripperCommandM=0;
 const driver=new CoffeeDriver(h.st,h.ctx,()=> 'boot',Object.assign(h.base,{holdMotion}));try{await driver.cancel();expect(holdMotion).toHaveBeenCalledWith('CELL_CANCELLED');expect(h.st.arm.gripperCommandM).toBe(0);expect(h.st.arm.holding).toBe('cup-1');expect(h.st.arm.stop?.latched).toBe(true);}finally{await driver.close();}
});
test('world transfer observations do not advance the independent device heartbeat sequence',async()=>{
 const h=await fixture(),pending={transferId:'transfer-1',commandId:'pick-1',payloadHash:'0'.repeat(64),controlEpoch:1,to:{kind:'arm',id:'arm-1'}};
 h.read.mockImplementation(async()=>({state:{ownerKind:'cell',ownerId:'cell-1',pendingTransfer:pending}}) as never);
 const o={observationId:'world:grasp:1',runId:'run-1',cupId:'cup-1',...pending,deviceId:'arm-1',observerId:'mujoco-world-arm:arm-1',bootId:'world-boot',clockDomain:'world:world-boot',seq:'1673',producer:'mujoco_world_arm',fidelity:'modeled',phase:'grasp',parent:'arm:arm-1/tcp',grip:{closed:true,objectPresent:true},liftPoseReached:false,observedMonotonicNs:'33460000000',receivedMonotonicNs:String(process.hrtime.bigint()),quality:'valid',world:{engine:'mujoco_3d',sceneDigest:'1'.repeat(64),tick:1673,physicsSubsteps:16740}};delete (o as Partial<typeof o>).to;
 const reports=[{deviceId:o.deviceId,bootId:o.bootId,seq:o.seq,observedAt:new Date(0).toISOString(),evidence:{source:o.producer,transferObservation:o}}];
 const ports=Object.assign(h.base,{custodyEvidence:'correlated',bindLedger:()=>{},drain:()=>reports.splice(0)}) as CoffeePlantPorts,driver=new CoffeeDriver(h.st,h.ctx,()=> 'boot',ports);
 try{await driver.drain();expect(h.submit.mock.calls.some(c=>c[0]==='Coffee.ObserveDevice')).toBe(false);}finally{await driver.close();}
});
test('world withdrawal completion after journal-confirmed receipt does not revive a closed transfer',async()=>{
 const h=await fixture();h.read.mockImplementation(async()=>({state:{ownerKind:'robot',ownerId:'amr-1',pendingTransfer:null,movements:[{to:{kind:'robot'},evidence:{giver:{commandId:'place-1'}}}]}}) as never);
 const reports=[{deviceId:'arm-1',bootId:'world-boot',seq:'20',observedAt:new Date(0).toISOString(),observation:{commandId:'place-1',result:'completed',reasonCodes:[]} as never,evidence:{source:'mujoco_arm',cupId:'cup-1',released:true}}];
 const ports=Object.assign(h.base,{custodyEvidence:'correlated',bindLedger:()=>{},drain:()=>reports.splice(0)}) as CoffeePlantPorts,driver=new CoffeeDriver(h.st,h.ctx,()=> 'boot',ports);
 try{await driver.drain();expect(h.submit.mock.calls.some(c=>c[0]==='Coffee.ObserveDevice')).toBe(false);expect(h.submit.mock.calls.some(c=>c[0]==='Cup.ConfirmTransfer')).toBe(false);}finally{await driver.close();}
});
test('registered cell disturbances cannot be silently consumed by legacy arm/mobile providers',async()=>{
 const {mujocoArmPorts}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports'),{mujocoMobilePlant}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile');
 const runtime={cellDisturbance:{presetId:'world-cup-fall-v1',cupId:'cup-1'}} as import('../../packages/lab-runtime/src/v2/simulation3d/mujoco').MujocoRuntimeOptions;
 expect(()=>mujocoArmPorts(runtime,{project:{} as never,seed:7})).toThrow('WORLD_PERTURBATION_SCOPE_INVALID');expect(()=>mujocoMobilePlant(runtime)).toThrow('WORLD_PERTURBATION_SCOPE_INVALID');
});
test('a committed world dock violation suspends Source with the measured fault code',async()=>{
 const h=await fixture(),attention=vi.fn();h.ctx.attention=attention;h.ctx.suspend=vi.fn();
 const reports=[{deviceId:'arm-1',bootId:'world-boot',seq:'20',observedAt:new Date(0).toISOString(),observation:{commandId:'place-1',result:'outcome_unknown',reasonCodes:['DOCK_OUT_OF_TOLERANCE']} as never}];
 const driver=new CoffeeDriver(h.st,h.ctx,()=> 'boot',Object.assign(h.base,{custodyEvidence:'correlated',bindLedger:()=>{},drain:()=>reports.splice(0)}) as CoffeePlantPorts);
 try{await driver.drain();expect(attention).toHaveBeenCalledWith(expect.objectContaining({reason:'DOCK_OUT_OF_TOLERANCE'}));expect(h.ctx.suspend).toHaveBeenCalledOnce();}finally{await driver.close();}
});
test('standalone world grasp requires actual world clock/substep provenance and arm-only phase',async()=>{
 const {validateTransferObservation}=await import('../../packages/lab-runtime/src/v2/beverage/cup-ledger');
 const pending={runId:'r',cupId:'cup-1',transferId:'t',commandId:'c',payloadHash:'0'.repeat(64),controlEpoch:1,deviceId:'arm-1',to:{kind:'arm' as const,id:'arm-1'}};
 const observation={...pending,to:undefined,observationId:'o',observerId:'mujoco-world-arm:arm-1',bootId:'b',clockDomain:'world:b',seq:'25',producer:'mujoco_world_arm',fidelity:'modeled',phase:'grasp',parent:'arm:arm-1/tcp',grip:{closed:true,objectPresent:true},liftPoseReached:true,observedMonotonicNs:'500000000',receivedMonotonicNs:'1000000000',quality:'valid',world:{engine:'mujoco_3d',sceneDigest:'1'.repeat(64),tick:25,physicsSubsteps:260}};delete observation.to;
 const policy={nowMonotonicNs:'1000000000',freshnessNs:'500000000',dockToleranceM:.01};expect(validateTransferObservation(observation,pending,policy).ok).toBe(true);
 for(const patch of [{world:undefined},{world:{...observation.world,physicsSubsteps:250}},{clockDomain:'other'},{seq:'24'},{observedMonotonicNs:'480000000'},{producer:'mujoco_world_tray'}])expect(validateTransferObservation({...observation,...patch},pending,policy).ok).toBe(false);
});
