// BV-01/03/06/07: plant evidence enters the source coffee domain only through bound observations that echo command, device, epoch, payload
// hash and recipe revision. An ACK is not readiness; a completion with a modelled measurement in tolerance is verified once; a replayed
// completion never brews or books twice; device faults become typed attention reasons with the partial quantity kept.
import {afterEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {withinTolerance} from '../../packages/domain/src/beverage/recipe';
import {validateCellObservation} from '../../packages/lab-runtime/src/v2/contracts';
import {cleanupCoffee} from '../support/coffee';
import {createCoffeeSimulationRig,RECIPES} from '../support/coffee-simulation-lab';
afterEach(cleanupCoffee);
const shot=RECIPES.espresso.steps[0]!.target!;

test('brew ACK does not make espresso ready and replay cannot brew twice',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'espresso',recipeRevision:RECIPES.espresso.revision,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'accepted'});
  expect(await rig.readyQuantity()).toBe('0');
  await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:shot.amount,unit:'m3',provenance:'modelled'}});
  expect((await rig.verifyOutput(job.id)).status).toBe('accepted');
  expect((await rig.replayLastObservation()).status).toBe('accepted');
  expect(await rig.readyQuantity()).toBe('1');
  expect(await rig.brewEffectCount()).toBe(1);
  expect(await rig.servedQuantity()).toBe('0');
  expect((await rig.journalTypes()).filter(t=>t==='StockMovementRecorded')).toHaveLength(1);
  expect(await rig.stock('coffee-beans')).toBe('982');
 }finally{await rig.close();}
});

test('tolerance is exact at both boundaries, at the widest scale, never a binary float',()=>{
 const target={amount:'0.00003',tolerance:'0.000003',unit:'m3' as const,provenance:'illustrative'};
 expect(withinTolerance('0.000027',target)).toBe(true);expect(withinTolerance('0.000033',target)).toBe(true);
 expect(withinTolerance('0.000026999999999999',target)).toBe(false);expect(withinTolerance('0.000033000000000001',target)).toBe(false);
 expect(withinTolerance('0.0000300000000000000000',target)).toBe(true);
 const ice={amount:'0.12',tolerance:'0.01',unit:'kg' as const,provenance:'illustrative'};
 expect(withinTolerance('0.11',ice)).toBe(true);expect(withinTolerance('0.109',ice)).toBe(false);expect(withinTolerance('0.13',ice)).toBe(true);expect(withinTolerance('0.1300001',ice)).toBe(false);
});

test('a completion outside tolerance or with an unverified provenance cannot pass automatic quality; the measured value is kept',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:'0.000036',unit:'m3',provenance:'modelled'}});
  expect((await rig.verifyOutput(job.id)).code).toBe('QUALITY_OUT_OF_TOLERANCE');
  expect(await rig.step(job.id,'brew')).toMatchObject({status:'completed',measured:{amount:'0.000036',unit:'m3',provenance:'modelled'}});
  expect(await rig.readyQuantity()).toBe('0');
  const b=await createCoffeeSimulationRig();
  try{
   const j2=await b.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-2'});
   await b.startRecipeStep(j2.id,'brew-1');
   await b.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:shot.amount,unit:'m3',provenance:'unknown'}});
   expect((await b.verifyOutput(j2.id)).code).toBe('MEASUREMENT_UNVERIFIED');
  }finally{await b.close();}
 }finally{await rig.close();}
});

test('device faults become typed attention reasons and the partial quantity is booked, never guessed',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'iced-milk-coffee',recipeRevision:2,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:shot.amount,unit:'m3',provenance:'modelled'}});
  await rig.startRecipeStep(job.id,'add_ice-1');
  await rig.observeDevice({commandId:'add_ice-1',status:'failed',reasonCodes:['ICE_JAMMED'],measuredQuantity:{value:'0.04',unit:'kg',provenance:'modelled'}});
  expect(await rig.job(job.id)).toMatchObject({status:'needs_attention',attentionReason:'ICE_JAM'});
  expect(await rig.step(job.id,'add_ice')).toMatchObject({status:'failed',measured:{amount:'0.04',unit:'kg'}});
  expect(await rig.stock('ice')).toBe('4960');
  expect((await rig.job(job.id)).reservations).toEqual(expect.arrayContaining([expect.objectContaining({ingredientId:'milk',status:'reserved'})]));
  expect((await rig.startRecipeStep(job.id,'add_milk-1')).code).toBe('JOB_STATE_CONFLICT');
  expect(await rig.effectCount('dispense','milk')).toBe(0);
 }finally{await rig.close();}
 for(const [code,reason] of [['MILK_EMPTY','MILK_EMPTY'],['BREW_TIMEOUT','BREW_TIMEOUT'],['UNLISTED','STEP_FAILED']] as const){
  const rig=await createCoffeeSimulationRig();
  try{
   const job=await rig.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-9'});
   await rig.startRecipeStep(job.id,'brew-1');
   await rig.observeDevice({commandId:'brew-1',status:'failed',reasonCodes:[code],measuredQuantity:{value:'0.00001',unit:'m3',provenance:'modelled'}});
   expect(await rig.job(job.id)).toMatchObject({status:'needs_attention',attentionReason:reason});
  }finally{await rig.close();}
 }
});

test('an observation bound to another recipe revision is refused; one without a revision stays compatible',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  expect((await rig.observeDevice({commandId:'brew-1',status:'accepted',recipeRevision:1})).code).toBe('RECIPE_REVISION_MISMATCH');
  expect((await rig.observeDevice({commandId:'brew-1',status:'accepted',recipeRevision:2})).status).toBe('accepted');
  expect((await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:shot.amount,unit:'m3',provenance:'modelled'}})).status).toBe('accepted');
  expect(await rig.step(job.id,'brew')).toMatchObject({status:'completed'});
  const base:JsonObject={schemaVersion:2,commandId:'c',deviceId:'d',controlEpoch:1,payloadHash:'a'.repeat(64),bootId:'b',seq:'1',result:'completed',observedAt:null,reasonCodes:[]};
  expect(validateCellObservation(base).ok).toBe(true);
  expect(validateCellObservation({...base,recipeRevision:2}).ok).toBe(true);
  expect(validateCellObservation({...base,recipeRevision:null}).ok).toBe(true);
  expect(validateCellObservation({...base,recipeRevision:'2'}).ok).toBe(false);
  expect(validateCellObservation({...base,topic:'/x'}).ok).toBe(false);
 }finally{await rig.close();}
});

test('a reboot between accept and completion makes the step unknown and holds the resources; no second brew',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'accepted'});
  expect((await rig.observeDevice({commandId:'brew-1',status:'outcome_unknown',bootId:'boot-2',reasonCodes:['OBSERVER_REBOOT']})).status).toBe('accepted');
  expect(await rig.job(job.id)).toMatchObject({status:'needs_attention',attentionReason:'STEP_UNKNOWN',leases:expect.arrayContaining(['cell-1:machine'])});
  expect(await rig.step(job.id,'brew')).toMatchObject({status:'unknown'});
  expect((await rig.startRecipeStep(job.id,'brew-1')).code).toBe('JOB_STATE_CONFLICT');
  expect(await rig.brewEffectCount()).toBe(1);
  // a late completion from the OLD boot cannot settle the unknown step
  expect((await rig.observeDevice({commandId:'brew-1',status:'completed',bootId:'boot-1',measuredQuantity:{value:shot.amount,unit:'m3',provenance:'modelled'}})).code).toBe('STALE_DEVICE_EVENT');
  expect(await rig.step(job.id,'brew')).toMatchObject({status:'unknown'});
 }finally{await rig.close();}
});
