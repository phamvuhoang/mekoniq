// BV-04/05/07: cup custody moves only on two-sided evidence with observation identity. A gripper release ACK without the receiving tray
// sensor, a robot that is near but not docked, and a device that reconnects after an unknown dose all keep the last known owner.
import {afterEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {cleanupCoffee,DEVICES,STATION} from '../support/coffee';
import {createCupTransferRig} from '../support/beverage-transfer-lab';
import {createCoffeeSimulationRig} from '../support/coffee-simulation-lab';
afterEach(cleanupCoffee);

test('release ACK without receiving sensor cannot transfer cup ownership',async()=>{
 const rig=await createCupTransferRig({traySensor:false});
 try{
  await rig.pickVerifiedCup();
  expect(await rig.cupOwner()).toBe('arm:arm-1');
  expect(await rig.armReleaseAck()).toMatchObject({released:true,committed:false});
  expect(await rig.cupOwner()).toBe('arm:arm-1');
  await expect(rig.confirmTransfer()).rejects.toThrow('TRANSFER_EVIDENCE_INCOMPLETE');
  expect(await rig.robotLoaded()).toBe(false);
  expect(await rig.cup()).toMatchObject({pendingTransfer:{transferId:'t-place',giver:{released:true}}});
  // the attachment ledger of the plant agrees: the cup is physically off the gripper, but custody is unresolved, not transferred
  expect(rig.session.attachments('cup-1')).toMatchObject({custody:'arm:arm-1',physical:{parent:'robot:amr-1/tray:1',provenance:'modelled'},resolved:false});
 }finally{await rig.close();}
});

test('a robot near the pickup but not docked receives nothing: the arm waits, then fails holding the cup',async()=>{
 const rig=await createCupTransferRig({dock:'near'});
 try{
  await rig.pickVerifiedCup();
  expect(await rig.armReleaseAck()).toMatchObject({released:false,result:'failed',reasonCodes:['RECEIVER_NOT_READY']});
  expect(await rig.cupOwner()).toBe('arm:arm-1');
  expect((await rig.job()).status).toBe('needs_attention');
  expect(rig.session.attachments('cup-1')).toMatchObject({custody:'arm:arm-1',physical:{parent:'arm:arm-1/tcp'},resolved:true});
  rig.state.dock='docked';
  await expect(rig.confirmTransfer()).rejects.toThrow('TRANSFER_EVIDENCE_INCOMPLETE'); // nothing was released: no receiver half can be built
 }finally{await rig.close();}
});

test('docked robot with tray presence completes the transfer once; replays are absorbed',async()=>{
 const rig=await createCupTransferRig();
 try{
  await rig.pickVerifiedCup();
  expect(await rig.armReleaseAck()).toMatchObject({released:true,committed:false});
  expect(await rig.confirmTransfer()).toMatchObject({committed:true,owner:'amr-1'});
  expect(await rig.cupOwner()).toBe('robot:amr-1');expect(await rig.robotLoaded()).toBe(true);
  expect(await rig.confirmTransfer()).toMatchObject({duplicate:true});
  const movements=(await rig.cup()).movements as JsonObject[];
  expect(movements.map(m=>m.transferId)).toEqual(['t-pick','t-place']);
  expect((movements[1]!.evidence as JsonObject).receiver).toMatchObject({receiverPresent:true,dockInTolerance:true,source:'mock_amr',observedBy:'observer:amr-1'});
  expect(rig.session.attachments('cup-1')).toMatchObject({custody:'arm:arm-1'}); // the plant ledger is updated by the domain's answer, not by itself
  rig.session.custodyResolved('cup-1','robot:amr-1/tray:1');
  expect(rig.session.attachments('cup-1')).toMatchObject({custody:'robot:amr-1/tray:1',resolved:true});
 }finally{await rig.close();}
});

test('device reconnect after an unknown dose does not resume or resend: the job waits for a person',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'accepted'});
  await rig.observeDevice({commandId:'brew-1',status:'outcome_unknown',bootId:'boot-2',reasonCodes:['OBSERVER_REBOOT']});
  // the machine comes back ready under its new boot: readiness alone changes nothing
  expect((await rig.deviceStatus(DEVICES.machine,{status:'ready'},'boot-2')).status).toBe('accepted');
  expect(await rig.job(job.id)).toMatchObject({status:'needs_attention',attentionReason:'STEP_UNKNOWN'});
  expect((await rig.startRecipeStep(job.id,'brew-1')).code).toBe('JOB_STATE_CONFLICT');
  expect(await rig.brewEffectCount()).toBe(1);
  const r=await rig.venue.submit('Coffee.Reconcile',{stationId:STATION,jobId:job.id,disposition:'discard',reason:'Brew outcome unknown after reconnect',provenance:'human'},'supervisor');
  expect(r.status).toBe('accepted');expect((await rig.job(job.id)).status).toBe('quarantined');
 }finally{await rig.close();}
});
