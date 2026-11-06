import {afterEach,beforeEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {applyTransfer,type Cup,type TransferReceipt} from '../../packages/domain/src/beverage/transfer';
import {canonicalOutcome} from '../../packages/lab-runtime/src/v2/report';
import {PUMA560_SI} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {cleanupRuns,executeCoffee} from '../support/lab-v2';
import {cleanupCoffee,coffeeVenue,registerRecipes,verifiedJob,brewAll,resetSeqs,commandResult,dockedRobot,STATION,CELL,ARM,type CoffeeVenue} from '../support/coffee';
beforeEach(resetSeqs);afterEach(cleanupCoffee);afterEach(cleanupRuns);
const sourceCup:Cup={cupId:'cup-1',cupType:'paper',jobId:'coffee-1',recipeKey:'espresso@1',ownerKind:'arm',ownerId:ARM,slot:null,epoch:2,
 pendingTransfer:{transferId:'t-2',from:{kind:'arm',id:ARM},to:{kind:'robot',id:'amr-1',slot:1},epoch:2,commandId:'c-2',requestedAt:'2026-11-05T08:00:00Z'},movements:[],disposition:null};
const receipt:TransferReceipt={transferId:'t-2',cupId:'cup-1',provenance:'sensor',observedBy:'observer:arm-1',at:'2026-11-05T08:00:05Z',evidence:{released:true,receiverPresent:true,dockInTolerance:true}};

test('applyTransfer: the same receipt twice moves the cup once, to one owner',()=>{
 const sameTransferReceiptTwice=[receipt,receipt];
 const reconciled=applyTransfer(sourceCup,sameTransferReceiptTwice);
 expect(reconciled.cup.ownerId).toBe('amr-1');
 expect(reconciled.cup).toMatchObject({ownerKind:'robot',slot:1,epoch:3,pendingTransfer:null});
 expect(reconciled.inventoryMovementCount).toBe(1);
 // a receipt for another transfer, or one under a fenced epoch, never moves it
 expect(()=>applyTransfer(sourceCup,{...receipt,transferId:'t-9'})).toThrow('TRANSFER_NOT_PENDING');
 expect(()=>applyTransfer({...sourceCup,epoch:3},receipt)).toThrow('TRANSFER_FENCED');
 expect(()=>applyTransfer(sourceCup,{...receipt,cupId:'cup-2'})).toThrow('CUP_MISMATCH');
});

async function readyCup(v:CoffeeVenue){
 await registerRecipes(v);await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 await brewAll(v,'coffee-1');expect((await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'})).status).toBe('accepted');
}
const evidence=(v:CoffeeVenue,commandId:string,e:JsonObject)=>({commandId,bootId:'boot-1',seq:'1',observedAt:new Date(v.now()).toISOString(),...e});

test('cell -> arm needs grasp evidence from the bound arm observer; release ACK alone never moves ownership',async()=>{
 const v=await coffeeVenue();
 await registerRecipes(v);await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 // pickup is blocked before quality
 expect((await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}})).code).toBe('JOB_STATE_CONFLICT');
 await brewAll(v,'coffee-1');await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'});
 expect((await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-x',jobId:'coffee-1',to:{kind:'arm',id:ARM}})).code).toBe('CUP_MISMATCH');
 const req=await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}});
 expect(req.status).toBe('accepted');
 const effect=(await v.effects()).find(e=>e.type==='cell.execute'&&(e.payload as JsonObject).deviceId===ARM)!,cmd=effect.payload as JsonObject;
 expect(cmd).toMatchObject({capability:'start_job',payload:{jobId:'coffee-1'},programRef:{id:'cup-pick'}});
 expect((await v.read('coffee-job','coffee-1')).state.status).toBe('transferring');
 expect((await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1b',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}})).code).toBe('TRANSFER_PENDING');
 const confirm=(e:JsonObject,actor=`observer:${ARM}`,ev=evidence(v,String(cmd.commandId),e))=>v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',provenance:'sensor',evidence:ev},actor);
 expect((await confirm({gripperClosed:true,objectPresent:true})).code).toBe('GRASP_EVIDENCE_REQUIRED');
 expect((await confirm({released:true})).code).toBe('GRASP_EVIDENCE_REQUIRED');
 expect((await confirm({gripperClosed:true,objectPresent:true,liftPoseReached:true},`observer:${CELL}`)).code).toBe('OBSERVER_NOT_BOUND');
 const old=evidence(v,String(cmd.commandId),{gripperClosed:true,objectPresent:true,liftPoseReached:true});v.advance(60000);
 expect((await confirm({},`observer:${ARM}`,old)).code).toBe('EVIDENCE_STALE');
 const ok=await confirm({gripperClosed:true,objectPresent:true,liftPoseReached:true});
 expect(ok.status).toBe('accepted');
 const cup=(await v.read('cup','cup-1')).state;
 expect(cup).toMatchObject({ownerKind:'arm',ownerId:ARM,pendingTransfer:null});
 expect((cup.movements as JsonObject[])).toHaveLength(1);
 expect((cup.movements as JsonObject[])[0]).toMatchObject({transferId:'t-1',from:{kind:'cell',id:CELL},to:{kind:'arm',id:ARM},provenance:'sensor',observedBy:`observer:${ARM}`});
 // a replay of the same confirmation is absorbed (one owner, one movement)
 expect((await confirm({gripperClosed:true,objectPresent:true,liftPoseReached:true})).status).toBe('accepted');
 expect(((await v.read('cup','cup-1')).state.movements as JsonObject[])).toHaveLength(1);
 // machine/nozzle leases are free once the cup left the cell; the arm keeps its lease
 const leases=(await v.read('coffee-job','coffee-1')).state.leases as string[];
 expect(leases).toEqual([`${CELL}:arm`]);
 // the tray leg needs a robot waiting at this station's load stop
 expect((await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-2',cupId:'cup-1',jobId:'coffee-1',to:{kind:'robot',id:'amr-1',slot:1}})).code).toBe('DESTINATION_NOT_READY');
 await v.close();
});

test('human override of a transfer needs its own permission and a reason, and is recorded as human provenance',async()=>{
 const v=await coffeeVenue();await readyCup(v);
 await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}});
 const cmd=(await v.effects()).find(e=>(e.payload as JsonObject).deviceId===ARM)!.payload as JsonObject;
 const human={stationId:STATION,transferId:'t-1',cupId:'cup-1',provenance:'human',evidence:evidence(v,String(cmd.commandId),{gripperClosed:true,objectPresent:true,liftPoseReached:true})};
 expect((await v.submit('Cup.ConfirmTransfer',human,'barista')).code).toBe('FORBIDDEN');
 expect((await v.submit('Cup.ConfirmTransfer',human,'supervisor')).code).toBe('REASON_REQUIRED');
 expect((await v.submit('Cup.ConfirmTransfer',{...human,reason:'Arm sensor offline; cup seen in gripper by supervisor'},'supervisor')).status).toBe('accepted');
 expect(((await v.read('cup','cup-1')).state.movements as JsonObject[])[0]).toMatchObject({provenance:'human',observedBy:'supervisor',reason:'Arm sensor offline; cup seen in gripper by supervisor'});
 await v.close();
});

test('arm outcome unknown during transfer holds the cup with its last known owner and the job needs attention',async()=>{
 const v=await coffeeVenue();await readyCup(v);
 await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}});
 const effect=(await v.effects()).find(e=>(e.payload as JsonObject).deviceId===ARM)!;
 expect((await commandResult(v,effect,'outcome_unknown')).status).toBe('accepted');
 expect((await v.read('coffee-job','coffee-1')).state).toMatchObject({status:'needs_attention',attentionReason:'TRANSFER_UNKNOWN'});
 expect((await v.read('cup','cup-1')).state).toMatchObject({ownerKind:'cell',ownerId:CELL,pendingTransfer:{transferId:'t-1'}});
 await v.close();
});

test('BV01 on mock-default: espresso and iced milk coffee run recipe -> verify -> arm -> robot -> table with one cup owner at a time',async()=>{
 const r=await executeCoffee('BV01',{seed:42});
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});
 expect(r.manifest.backends.map(b=>b.id)).toEqual(['mock_amr','mock_coffee','mock_arm']);
 const coffee=r.coffee!,jobs=coffee.jobs;
 expect(jobs.map(j=>[j.recipeId,j.status])).toEqual([['espresso','delivered'],['iced-milk-coffee','delivered']]);
 // recipe steps of the frozen revision, in the recipe's own order; espresso never runs ice or milk
 const commands=(jobId:string)=>coffee.cellEffects.filter(e=>e.payload.jobId===jobId&&e.payload.stepId).map(e=>[e.payload.capability,(e.payload.payload as JsonObject).resource??null,e.attempts]);
 expect(commands(String(jobs[0]!.jobId))).toEqual([['brew',null,1]]);
 expect(commands(String(jobs[1]!.jobId))).toEqual([['brew',null,1],['dispense','ice',1],['dispense','milk',1]]);
 // every cup: cell -> arm -> robot tray -> customer, each move with evidence and its observer
 for(const cup of coffee.cups){
  expect(cup.movements.map(m=>m.to.kind)).toEqual(['arm','robot','customer']);
  // cell -> arm on the arm's grasp evidence; arm -> tray only on the arm's release AND the robot's own presence + dock evidence
  expect(cup.movements.slice(0,2).map(m=>[m.provenance,m.observedBy])).toEqual([['sensor','simulator:arm-1'],['sensor','simulator:amr-1']]);
  expect(cup.movements[1]!.evidence).toMatchObject({receiverId:'amr-1',giver:{released:true,observedBy:'simulator:arm-1'},receiver:{receiverPresent:true,dockInTolerance:true,observedBy:'simulator:amr-1',source:'mock_amr'}});
  expect(cup).toMatchObject({ownerKind:'customer',ownerId:'table-1'});
 }
 const ev=r.businessEvents,at=(type:string,pred:(e:typeof ev[number])=>boolean=()=>true)=>ev.findIndex(e=>e.type===type&&pred(e));
 for(const j of jobs){
  const mine=(e:typeof ev[number])=>e.id===j.jobId||e.state.jobId===j.jobId;
  // verified dose before pickup; served only at the customer handoff, after the cup was loaded
  expect(at('CoffeeQualityConfirmed',mine)).toBeLessThan(at('CoffeeTransferRequested',mine));
  expect(at('CoffeeJobLoaded',mine)).toBeLessThan(at('CoffeeJobDelivered',mine));
 }
 expect(ev.filter(e=>e.type==='CupTransferConfirmed').every(e=>typeof (e.state.movements as JsonObject[]).at(-1)!.transferId==='string')).toBe(true);
 expect(ev.filter(e=>e.type==='CoffeeStepCompleted').every(e=>((e.state.steps as JsonObject[]).find(s=>s.status==='completed')!.observedBy as string).startsWith('simulator:coffee-1'))).toBe(true);
 // arm: F02 FK/limits model, illustrative joint interpolation, no torque or physical grip claim
 expect(coffee.armTrace).toMatchObject({tag:'mock_kinematic',interpolation:'linear_joint_illustrative',modelRevision:PUMA560_SI.revision,limitsOk:true});
 expect(coffee.armTrace.samples.length).toBeGreaterThan(10);
 for(const s of coffee.armTrace.samples)s.q.forEach((q,i)=>{expect(q).toBeGreaterThanOrEqual(PUMA560_SI.limits[i]!.min);expect(q).toBeLessThanOrEqual(PUMA560_SI.limits[i]!.max);});
 expect(r.coverage).toMatchObject({coffeeProcessModel:true,armKinematics:true,armTorque:false,physicalGrip:false,fluidModel:false});
 const again=await executeCoffee('BV01',{seed:42});
 expect(canonicalOutcome(again)).toEqual(canonicalOutcome(r));
},120000);

test('arm transfer results come only from the arm of the job cell',async()=>{
 const v=await coffeeVenue();await readyCup(v);
 await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}});
 const cmd=(await v.effects()).find(e=>(e.payload as JsonObject).deviceId===ARM)!.payload as JsonObject,at=new Date(v.now()).toISOString(),milk=`${CELL}:milk`;
 const r=await v.submit('Coffee.ObserveDevice',{stationId:STATION,deviceId:milk,bootId:'b',seq:'50',observedAt:at,observation:{schemaVersion:2,commandId:cmd.commandId!,deviceId:milk,controlEpoch:1,payloadHash:cmd.payloadHash!,bootId:'b',seq:'50',result:'outcome_unknown',observedAt:at,reasonCodes:[]}},`observer:${milk}`);
 expect(r.code).toBe('OBSERVATION_IDENTITY_MISMATCH');
 expect((await v.read('coffee-job','coffee-1')).state.status).toBe('transferring');
 await v.close();
});

test('tray transfer commits only on giver release AND receiver evidence for the same transfer, exactly once',async()=>{
 const v=await coffeeVenue();await readyCup(v);
 const lineId=String((await v.read('coffee-job','coffee-1')).state.lineId);
 await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}});
 const pick=(await v.effects()).find(e=>(e.payload as JsonObject).deviceId===ARM)!.payload as JsonObject;
 expect((await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',provenance:'sensor',evidence:evidence(v,String(pick.commandId),{gripperClosed:true,objectPresent:true,liftPoseReached:true})},`observer:${ARM}`)).status).toBe('accepted');
 await dockedRobot(v,lineId);
 expect((await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-2',cupId:'cup-1',jobId:'coffee-1',to:{kind:'robot',id:'amr-1',slot:1}})).status).toBe('accepted');
 const place=(await v.effects()).filter(e=>(e.payload as JsonObject).deviceId===ARM).at(-1)!.payload as JsonObject;
 const giver={stationId:STATION,transferId:'t-2',cupId:'cup-1',provenance:'sensor',side:'giver',evidence:evidence(v,String(place.commandId),{released:true})};
 const receiver={stationId:STATION,transferId:'t-2',cupId:'cup-1',provenance:'sensor',side:'receiver',evidence:{transferId:'t-2',bootId:'amr-boot',seq:'7',observedAt:new Date(v.now()).toISOString(),receiverPresent:true,dockInTolerance:true}};
 const owner=async()=>(await v.read('cup','cup-1')).state;
 // the arm cannot speak for the tray, and the giver must show its release
 expect((await v.submit('Cup.ConfirmTransfer',receiver,`observer:${ARM}`)).code).toBe('OBSERVER_NOT_BOUND');
 expect((await v.submit('Cup.ConfirmTransfer',{...giver,evidence:evidence(v,String(place.commandId),{receiverPresent:true,dockInTolerance:true})},`observer:${ARM}`)).code).toBe('RELEASE_EVIDENCE_REQUIRED');
 expect((await v.submit('Cup.ConfirmTransfer',{...receiver,evidence:{...receiver.evidence,dockInTolerance:false}},'observer:amr-1')).code).toBe('RECEIVER_EVIDENCE_REQUIRED');
 // receiver half alone: recorded, not committed
 expect((await v.submit('Cup.ConfirmTransfer',receiver,'observer:amr-1')).status).toBe('accepted');
 expect(await owner()).toMatchObject({ownerKind:'arm',pendingTransfer:{transferId:'t-2',receiver:{observedBy:'observer:amr-1'}}});
 // giver half completes it: one movement to the tray
 expect((await v.submit('Cup.ConfirmTransfer',giver,`observer:${ARM}`)).status).toBe('accepted');
 let cup=await owner();
 expect(cup).toMatchObject({ownerKind:'robot',ownerId:'amr-1',slot:1,pendingTransfer:null});
 expect((cup.movements as JsonObject[])).toHaveLength(2);
 expect((cup.movements as JsonObject[])[1]!.evidence).toMatchObject({giver:{released:true},receiver:{receiverPresent:true,dockInTolerance:true}});
 // replays of either half are absorbed
 expect((await v.submit('Cup.ConfirmTransfer',giver,`observer:${ARM}`)).status).toBe('accepted');
 expect((await v.submit('Cup.ConfirmTransfer',receiver,'observer:amr-1')).status).toBe('accepted');
 cup=await owner();expect((cup.movements as JsonObject[])).toHaveLength(2);
 await v.close();
});

test('tray transfer: giver evidence alone never moves the cup',async()=>{
 const v=await coffeeVenue();await readyCup(v);
 const lineId=String((await v.read('coffee-job','coffee-1')).state.lineId);
 await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',jobId:'coffee-1',to:{kind:'arm',id:ARM}});
 const pick=(await v.effects()).find(e=>(e.payload as JsonObject).deviceId===ARM)!.payload as JsonObject;
 await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:'t-1',cupId:'cup-1',provenance:'sensor',evidence:evidence(v,String(pick.commandId),{gripperClosed:true,objectPresent:true,liftPoseReached:true})},`observer:${ARM}`);
 await dockedRobot(v,lineId);await v.submit('Cup.RequestTransfer',{stationId:STATION,transferId:'t-2',cupId:'cup-1',jobId:'coffee-1',to:{kind:'robot',id:'amr-1',slot:1}});
 const place=(await v.effects()).filter(e=>(e.payload as JsonObject).deviceId===ARM).at(-1)!.payload as JsonObject;
 // even a giver report claiming receiver facts is only the giver half
 expect((await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:'t-2',cupId:'cup-1',provenance:'sensor',side:'giver',evidence:evidence(v,String(place.commandId),{released:true,receiverPresent:true,dockInTolerance:true})},`observer:${ARM}`)).status).toBe('accepted');
 expect((await v.read('cup','cup-1')).state).toMatchObject({ownerKind:'arm',pendingTransfer:{transferId:'t-2',giver:{observedBy:`observer:${ARM}`}}});
 // a stale receiver half does not complete it either
 const old={transferId:'t-2',bootId:'amr-boot',seq:'1',observedAt:new Date(v.now()-60000).toISOString(),receiverPresent:true,dockInTolerance:true};
 expect((await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:'t-2',cupId:'cup-1',provenance:'sensor',side:'receiver',evidence:old},'observer:amr-1')).code).toBe('EVIDENCE_STALE');
 expect((await v.read('cup','cup-1')).state.ownerKind).toBe('arm');
 await v.close();
});
