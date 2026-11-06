import {afterEach,beforeEach,expect,test} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import type {JsonObject} from '../../packages/contracts/src/index';
import {recipeHash} from '../../packages/domain/src/beverage/recipe';
import {validateCoffeeRecipe} from '../../packages/lab-runtime/src/v2/contracts';
import {decideCoffeeJob,type CoffeeJob} from '../../packages/domain/src/beverage/job';
import {AdapterRegistry} from '../../packages/robot-adapters/src/registry';
import {dispatchRobotEffects} from '../../packages/robot-adapters/src/dispatch';
import {SimulatorAdapter} from '../../packages/robot-adapters/src/simulator';
import {MockCoffeePlant,MockCoffeeAdapter} from '../../packages/cell-adapters/src/mock-coffee';
import {cleanupCoffee,coffeeVenue,registerRecipes,verifiedJob,orderCoffee,deviceStatus,observeCup,startStep,commandResult,measured,brewAll,resetSeqs,recipeRef,
 ESPRESSO,ICED_MILK_COFFEE,STATION,CELL,DEVICES} from '../support/coffee';
beforeEach(resetSeqs);afterEach(cleanupCoffee);
const job=(over:Partial<CoffeeJob>={}):CoffeeJob=>({jobId:'coffee-1',lineId:'line-1',stationId:STATION,cellId:CELL,recipeKey:'espresso@1',recipeId:'espresso',recipeRevision:1,recipeHash:ESPRESSO.hash,cupId:'cup-1',cupType:ESPRESSO.cupType,
 status:'reserved',steps:[{id:'brew',kind:'brew',status:'pending',deviceId:CELL,commandId:null,payloadHash:null,controlEpoch:null,target:ESPRESSO.steps[0]!.target as unknown as JsonObject,measured:null,consumed:[],observedBy:null}],reservations:[],leases:[],attentionReason:null,disposition:null,...over});

test('decideCoffeeJob: StartJob before the cup is confirmed is refused; the transition table is pure',()=>{
 const after=decideCoffeeJob(job(),{type:'Coffee.StartJob',payload:{jobId:'coffee-1'}});
 expect(after.rejectionCode).toBe('CUP_NOT_CONFIRMED');
 expect(decideCoffeeJob(job({status:'cup_verified'}),{type:'Coffee.StartJob',payload:{jobId:'coffee-1'}})).toMatchObject({job:{status:'started'}});
 expect(decideCoffeeJob(job({status:'verifying'}),{type:'Coffee.StartJob',payload:{jobId:'coffee-1'}}).rejectionCode).toBe('JOB_STATE_CONFLICT');
 expect(decideCoffeeJob(job({status:'delivered'}),{type:'Coffee.CancelJob',payload:{jobId:'coffee-1'}}).rejectionCode).toBe('JOB_FINAL');
});

test('brew only after cup + machine ready, through station-scoped authorization; espresso never runs ice or milk',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 const lineId=await orderCoffee(v,'espresso');
 const reserve={stationId:STATION,jobId:'coffee-1',lineId,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-1'};
 expect((await v.submit('Coffee.ReserveJob',reserve,'other-barista')).code).toBe('FORBIDDEN');
 expect((await v.submit('Coffee.ReserveJob',{...reserve,recipe:{...recipeRef(ESPRESSO),hash:'0'.repeat(64)}})).code).toBe('RECIPE_HASH_MISMATCH');
 expect((await v.submit('Coffee.ReserveJob',reserve)).status).toBe('accepted');
 expect((await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'})).code).toBe('CUP_NOT_CONFIRMED');
 // machine still warming: the cup is seen but the interlock is not satisfied
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType)).code).toBe('MACHINE_NOT_READY');
 expect((await observeCup(v,'coffee-1','cup-9',ESPRESSO.cupType)).code).toBe('CUP_MISMATCH');
 await deviceStatus(v,DEVICES.machine,{status:'ready'});
 expect((await observeCup(v,'coffee-1','cup-1','glass-wrong')).code).toBe('CUP_TYPE_MISMATCH');
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType,false)).status).toBe('accepted');
 // only the bound observer of that sensor may report it
 expect((await v.submit('Coffee.ObserveCup',{stationId:STATION,jobId:'coffee-1',deviceId:DEVICES.cup,bootId:'b',seq:'99',observedAt:new Date(v.now()).toISOString(),cupId:'cup-1',cupType:ESPRESSO.cupType,present:true},`observer:${DEVICES.milk}`)).code).toBe('OBSERVER_NOT_BOUND');
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType)).status).toBe('accepted');
 expect((await v.read('coffee-job','coffee-1')).state.status).toBe('cup_verified');
 expect((await v.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-1',stepId:'brew'})).code).toBe('JOB_STATE_CONFLICT');
 expect((await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'})).status).toBe('accepted');
 expect((await v.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-1',stepId:'add_milk'})).code).toBe('STEP_UNKNOWN');
 const {effect}=await startStep(v,'coffee-1','brew');
 const cmd=effect!.payload as JsonObject;
 expect(cmd).toMatchObject({deviceId:CELL,capability:'brew',controlEpoch:1,recipeRevision:2,payload:{recipeId:'espresso',cupId:'cup-1'}});
 expect(cmd.runId).toBeUndefined(); // the cell bridge binds the run/session; the domain issues only the device command
 expect((await v.read('coffee-job','coffee-1')).state.status).toBe('dispensing');
 // business events carry recipe/job/cup ids and observer identity
 await commandResult(v,effect!,'accepted');const done=await commandResult(v,effect!,'completed',measured('0.000030000','m3'));
 expect(done.status).toBe('accepted');
 const j=(await v.read('coffee-job','coffee-1')).state;
 expect(j).toMatchObject({status:'verifying',recipeId:'espresso',recipeRevision:2,cupId:'cup-1'});
 expect((j.steps as JsonObject[])[0]).toMatchObject({status:'completed',observedBy:`observer:${CELL}`,measured:{amount:'0.000030000',unit:'m3'}});
 expect((await v.effects()).filter(e=>e.type==='cell.execute').map(e=>(e.payload as JsonObject).capability)).toEqual(['brew']);
 await v.close();
});

test('recipe order is enforced; ice jam halts the workflow; empty milk rejects its step',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 await verifiedJob(v,ICED_MILK_COFFEE);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 expect((await v.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-1',stepId:'add_milk'})).code).toBe('STEP_OUT_OF_ORDER');
 const brew=await startStep(v,'coffee-1','brew');
 expect((await v.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-1',stepId:'add_ice'})).code).toBe('STEP_IN_FLIGHT');
 await commandResult(v,brew.effect!,'completed',measured('0.00003','m3'));
 await deviceStatus(v,DEVICES.ice,{status:'fault',reasonCodes:['ICE_JAMMED']});
 expect((await v.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-1',stepId:'add_ice'})).code).toBe('DEVICE_FAULT');
 await deviceStatus(v,DEVICES.ice,{status:'ready'});
 const ice=await startStep(v,'coffee-1','add_ice');
 // jam mid-dispense: the partial quantity is recorded and consumed, the job halts, nothing else may start
 const failed=await commandResult(v,ice.effect!,'failed',measured('0.04','kg'));
 expect(failed.status).toBe('accepted');
 const j=(await v.read('coffee-job','coffee-1')).state;
 expect(j).toMatchObject({status:'needs_attention',attentionReason:'STEP_FAILED'});
 expect((j.steps as JsonObject[])[1]).toMatchObject({status:'failed',measured:{amount:'0.04',unit:'kg'}});
 expect((await v.read('stock-item','ice')).state.onHand).toBe('4960');
 expect((await v.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-1',stepId:'add_milk'})).code).toBe('JOB_STATE_CONFLICT');
 // a second drink: milk sensor says empty -> its step is refused before any action
 const w=await coffeeVenue();await registerRecipes(w);resetSeqs();
 await verifiedJob(w,ICED_MILK_COFFEE,'coffee-2','cup-2');await w.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-2'});
 for(const s of ['brew','add_ice']){const x=await startStep(w,'coffee-2',s);await commandResult(w,x.effect!,'completed',measured(ICED_MILK_COFFEE.steps.find(y=>y.id===s)!.target!.amount,ICED_MILK_COFFEE.steps.find(y=>y.id===s)!.target!.unit));}
 await deviceStatus(w,DEVICES.milk,{status:'ready',level:'empty'});
 expect((await w.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-2',stepId:'add_milk'})).code).toBe('INGREDIENT_EMPTY');
 expect((await w.effects()).filter(e=>e.type==='cell.execute').length).toBe(2);
 await v.close();await w.close();
});

test('reservation is atomic and resources are exclusive',async()=>{
 const v=await coffeeVenue({milkMl:'50'});await registerRecipes(v);
 const line=await orderCoffee(v,'iced-milk-coffee');
 // 80 ml milk needed, 50 on hand (blocking policy): nothing is reserved, not even the beans or the machine
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-1',lineId:line,cellId:CELL,recipe:recipeRef(ICED_MILK_COFFEE),cupId:'cup-1'})).code).toBe('INSUFFICIENT_STOCK');
 const esp=await orderCoffee(v,'espresso');
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-2',lineId:esp,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-2'})).status).toBe('accepted');
 const esp2=await orderCoffee(v,'espresso');
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-3',lineId:esp2,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-3'})).code).toBe('RESOURCE_HELD');
 // a lease past its expiry still blocks: expired ownership never lets another job assume the machine or cup state
 v.advance(24*3600000);
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-3',lineId:esp2,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-3'})).code).toBe('RESOURCE_HELD');
 // one ordered cup is one job: a second job on the same line is refused before any lease
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-4',lineId:esp,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-4'})).code).toBe('JOB_EXCEEDS_ORDER');
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-5',lineId:esp2,cellId:CELL,recipe:recipeRef(ICED_MILK_COFFEE),cupId:'cup-5'})).code).toBe('RECIPE_ITEM_MISMATCH');
 await v.close();
});

test('unknown or out-of-tolerance quantity cannot pass automatic quality; missing measurement needs attention',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const a=await startStep(v,'coffee-1','brew');await commandResult(v,a.effect!,'completed',measured('0.000020','m3'));
 expect((await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'})).code).toBe('QUALITY_OUT_OF_TOLERANCE');
 const b=await coffeeVenue();await registerRecipes(b);resetSeqs();
 await verifiedJob(b);await b.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const x=await startStep(b,'coffee-1','brew');await commandResult(b,x.effect!,'completed',measured('0.00003','m3','unknown'));
 expect((await b.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'})).code).toBe('MEASUREMENT_UNVERIFIED');
 const c=await coffeeVenue();await registerRecipes(c);resetSeqs();
 await verifiedJob(c);await c.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const y=await startStep(c,'coffee-1','brew');await commandResult(c,y.effect!,'completed');
 expect((await c.read('coffee-job','coffee-1')).state).toMatchObject({status:'needs_attention',attentionReason:'MEASUREMENT_MISSING'});
 expect((await c.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'})).code).toBe('JOB_STATE_CONFLICT');
 for(const z of [v,b,c])await z.close();
});

test('duplicate brew completion never consumes twice; quality publishes kitchen-ready exactly once without a second W07 deduction',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 const {lineId}=await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const {effect}=await startStep(v,'coffee-1','brew');
 await commandResult(v,effect!,'completed',measured('0.00003','m3'));
 // the device repeats the completion (new seq, same command): absorbed, no movement
 const again=await commandResult(v,effect!,'completed',measured('0.00003','m3'));
 expect(again.status).toBe('accepted');
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('982');
 const movements=(await v.journalTypes()).filter(t=>t==='StockMovementRecorded');expect(movements).toHaveLength(1);
 // a stale seq from the same boot is refused outright
 const stale=await v.submit('Coffee.ObserveDevice',{stationId:STATION,deviceId:CELL,bootId:'boot-1',seq:'1',observedAt:new Date(v.now()).toISOString(),status:{status:'ready'}},`observer:${CELL}`);
 expect(stale.code).toBe('STALE_DEVICE_EVENT');
 const q=await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'});expect(q.status).toBe('accepted');
 expect((await v.read('coffee-job','coffee-1')).state.status).toBe('ready_for_pickup');
 expect((await v.read('fulfillment',lineId)).state.ready).toBe('1');
 expect((await v.read('kitchen-ticket',lineId)).state.status).toBe('ready');
 expect((await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'})).code).toBe('JOB_STATE_CONFLICT');
 const types=await v.journalTypes();
 expect(types.filter(t=>t==='KitchenPortionsReady')).toHaveLength(1);expect(types.filter(t=>t==='StockMovementRecorded')).toHaveLength(1);
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('982');
 await v.close();
});

test('the native robot adapter registry and dispatcher cannot execute cell commands',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});await brewAll(v,'coffee-1').catch(()=>{});
 const registry=new AdapterRegistry(),plant=new MockCoffeePlant(MockCoffeePlant.initial(CELL),()=>v.now(),()=>'boot-x');
 expect(()=>registry.resolve('mock_coffee')).toThrow('UNSUPPORTED_DRIVER');
 // a CellAdapter is not a RobotAdapter: it has no navigation surface
 const cell=new MockCoffeeAdapter(plant,'run');
 expect('resolveTarget' in cell).toBe(false);expect('requestStop' in cell).toBe(false);
 // the robot dispatcher only drains robot.* rows: a pending cell.execute stays untouched
 const sim=new SimulatorAdapter({id:'sim-1',adapter:'simulator',protocolVersion:'1',firmware:'sim',capabilities:['delivery'],mapId:'m',mapRevision:'1',offlineExecution:true,maxLoadMinor:'1',trays:1,validation:'simulated'});
 const lineId=await orderCoffee(v,'espresso');void lineId;
 const before=(await v.effects()).filter(e=>e.type==='cell.execute').map(e=>[e.id,e.status,e.attempts]);
 expect(await dispatchRobotEffects(v.store,v.scope,sim,v.now())).toEqual([]);
 expect((await v.effects()).filter(e=>e.type==='cell.execute').map(e=>[e.id,e.status,e.attempts])).toEqual(before);
 await v.close();
});

// Lab recipe fixtures are the same recipes as the server-owned ones (separate repos: skipped without lab/, LAB_V2_REQUIRE_LAB_FIXTURES=1 forces).
const LAB_RECIPES=['espresso','iced-milk-coffee'].map(n=>`../lab/fixtures/recipes/${n}.json`);
test.skipIf(process.env.LAB_V2_REQUIRE_LAB_FIXTURES!=='1'&&!LAB_RECIPES.every(f=>existsSync(f)))('lab recipe fixtures equal the server recipes, are schema-valid and carry their content hash',()=>{
 for(const [file,recipe] of [[LAB_RECIPES[0]!,ESPRESSO],[LAB_RECIPES[1]!,ICED_MILK_COFFEE]] as const){
  const fixture=JSON.parse(readFileSync(file,'utf8'));
  expect(fixture).toEqual(recipe);expect(validateCoffeeRecipe(fixture).ok).toBe(true);expect(recipeHash(fixture)).toBe(fixture.hash);
  // illustrative SI values only; no hardware-ready flag anywhere
  expect([...fixture.steps.map((s:{target:{provenance:string}|null})=>s.target),...fixture.resources.map((r:{requiredAmount:{provenance:string}|null})=>r.requiredAmount)].filter(Boolean).every((q:{provenance:string;unit:string})=>q.provenance==='illustrative'&&['kg','m3'].includes(q.unit))).toBe(true);
  expect(JSON.stringify(fixture)).not.toMatch(/hardware|ready/i);
 }
});

test('a device observation counts only for its own step: another bound device or another control epoch cannot complete it',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const {effect}=await startStep(v,'coffee-1','brew'),cmd=effect!.payload as JsonObject,at=new Date(v.now()).toISOString();
 const forged=(deviceId:string,controlEpoch:number,seq:string)=>v.submit('Coffee.ObserveDevice',{stationId:STATION,deviceId,bootId:'boot-x',seq,observedAt:at,
  observation:{schemaVersion:2,commandId:cmd.commandId!,deviceId,controlEpoch,payloadHash:cmd.payloadHash!,bootId:'boot-x',seq,result:'completed',observedAt:at,reasonCodes:[]},...measured('0.00003','m3')},`observer:${deviceId}`);
 // the milk pump's own bound observer reports the brew command done: refused, nothing booked
 expect((await forged(DEVICES.milk,1,'1')).code).toBe('OBSERVATION_IDENTITY_MISMATCH');
 // the machine was re-fenced (epoch 2) after the command was issued under epoch 1: the new epoch cannot settle the old command
 const m=await v.read('cell-device',CELL);await v.store.seed(v.scope,'cell-device',CELL,{...m.state,controlEpoch:2},m.version);
 expect((await forged(CELL,2,'1')).code).toBe('OBSERVATION_IDENTITY_MISMATCH');
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('1000');
 expect(((await v.read('coffee-job','coffee-1')).state.steps as JsonObject[])[0]!.status).toBe('running');
 await v.close();
});

test('a silent device times out its step from the recipe timeout on the command clock: needs attention, no resend',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 await startStep(v,'coffee-1','brew');
 v.advance(39000);
 expect((await v.submit('Coffee.StepTimeout',{stationId:STATION,jobId:'coffee-1',stepId:'brew'})).code).toBe('STEP_NOT_TIMED_OUT');
 expect((await v.submit('Coffee.StepTimeout',{stationId:STATION,jobId:'coffee-1',stepId:'brew'},'other-barista')).code).toBe('FORBIDDEN');
 v.advance(1000);
 expect((await v.submit('Coffee.StepTimeout',{stationId:STATION,jobId:'coffee-1',stepId:'brew'})).status).toBe('accepted');
 const j=(await v.read('coffee-job','coffee-1')).state;
 expect(j).toMatchObject({status:'needs_attention',attentionReason:'STEP_TIMEOUT',leases:[`${CELL}:machine`,`${CELL}:nozzle`]});
 expect((j.steps as JsonObject[])[0]).toMatchObject({status:'unknown',timeoutPolicy:'hold_and_reconcile'});
 expect((await v.effects()).filter(e=>e.type==='cell.execute')).toHaveLength(1);
 await v.close();
});

test('Kitchen.Ready keeps its error precedence: a ticket that is not preparable is refused before its quantity is parsed',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 const {lineId}=await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});await brewAll(v,'coffee-1');await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'});
 const t=await v.read('kitchen-ticket',lineId);expect(t.state.status).toBe('ready');
 expect((await v.submit('Kitchen.Ready',{lineId,stationId:STATION,quantity:'not-a-number',expectedVersion:t.version},'manager')).code).toBe('TICKET_STATE_CONFLICT');
 await v.close();
});

test('the beverage feature gates new coffee work: disabled (or without inventory) refuses new jobs and recipes, existing work is not blocked by the flag',async()=>{
 const base=['catalog','sessions','pos.order','orders','kitchen','fulfillment','fleet','robot.delivery','inventory'];
 const off=await coffeeVenue({features:base});
 expect((await off.submit('Coffee.RegisterRecipe',{recipe:ESPRESSO as unknown as JsonObject},'configurer')).code).toBe('FEATURE_DISABLED');
 const line=await orderCoffee(off,'espresso');
 expect((await off.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-1',lineId:line,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-1'})).code).toBe('FEATURE_DISABLED');
 expect((await off.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'})).code).toBe('FEATURE_DISABLED');
 // finishing existing work is never blocked by the flag itself (the job does not exist here, so the handler answers)
 expect((await off.submit('Coffee.CancelJob',{stationId:STATION,jobId:'coffee-1',reason:'x'})).code).not.toBe('FEATURE_DISABLED');
 await off.close();
 const noStock=await coffeeVenue({features:[...base.filter(f=>f!=='inventory'),'beverage']});
 expect((await noStock.submit('Coffee.RegisterRecipe',{recipe:ESPRESSO as unknown as JsonObject},'configurer')).code).toBe('DEPENDENCY_DISABLED');
 await noStock.close();
});
