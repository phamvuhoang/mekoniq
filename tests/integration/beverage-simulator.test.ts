// BV-03/05/08: coffee_io_sim is the F04 process model behind the simulation backend id, driven on the run's clock: machine warm-up and brew
// cycle, milk flow/level/settling, ice jam with partial mass, modelled measurements with provenance. The effect dispatcher claims before it
// sends, asks before it reconciles and never resends an unknown dose. Cup liquid is a bounded scalar with model provenance.
import {afterEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {CoffeeIoSimAdapter,COFFEE_IO_SIM,coffeePlantPort} from '../../packages/cell-adapters/src/coffee-io-sim';
import {dispatchCellEffects} from '../../packages/cell-adapters/src/dispatch';
import type {CellReport} from '../../packages/cell-adapters/src/contract';
import {MOCK_COFFEE_PARAMS} from '../../packages/cell-adapters/src/mock-coffee';
import {assertSingleJointAuthority,createPlantSession} from '../../packages/lab-runtime/src/v2/beverage/plant-session';
import {cleanupCoffee,coffeeVenue,registerRecipes,verifiedJob,startStep,CELL,DEVICES,STATION} from '../support/coffee';
afterEach(cleanupCoffee);
const RUN='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c';
const adapter=(o:{runId?:string}={})=>{let t=Date.parse('2026-11-05T08:00:00Z');const a=new CoffeeIoSimAdapter({cellId:CELL,runId:o.runId??RUN,nowMs:()=>t,newBootId:()=>`boot-${Math.random().toString(16).slice(2,8)}`});a.onAdvance(()=>{t+=20;});return a;};
const brew=(commandId:string,quantity='0.00003')=>({commandId,jobId:'job-1',cupId:'cup-1',kind:'brew' as const,recipeId:'espresso',recipeRevision:2,quantity:{value:quantity,unit:'m3' as const},fencingEpoch:1});

test('coffee_io_sim describes a simulated process model and exposes the plant port over the F04 cell contract',async()=>{
 const a=adapter(),port=coffeePlantPort(a);
 expect(COFFEE_IO_SIM).toEqual({id:'coffee_io_sim',version:'1',model:'mock_process',dynamics:false});
 expect(await port.describe()).toMatchObject({id:'coffee_io_sim',validation:'simulated',modelVersion:'mock_process@1',cellId:CELL,capabilities:['brew','dispense','query_outcome']});
 expect((await a.describe()).deviceIds).toEqual([CELL,`${CELL}:milk`,`${CELL}:ice`]);
 expect(await port.reconcile('never')).toEqual({status:'unknown',evidence:[]});
});

test('brew cycle: not before warm-up or without a cup; accepted, then completion with a modelled measurement; reconcile carries hashed evidence',async()=>{
 const a=adapter(),port=coffeePlantPort(a),observations:JsonObject[]=[];port.observe(o=>observations.push(o as unknown as JsonObject));
 expect(await port.execute(brew('c1'))).toEqual({accepted:false,unknown:false,reason:'DEVICE_NOT_READY'});
 a.advance(MOCK_COFFEE_PARAMS.warmupTicks);
 expect(await port.execute(brew('c1'))).toEqual({accepted:false,unknown:false,reason:'CUP_ABSENT'});
 a.plant.placeCup('cup-1','cup-paper-illustrative');
 expect(await port.execute(brew('c1'))).toEqual({accepted:true,unknown:false});
 expect(await port.execute(brew('c1'))).toEqual({accepted:true,unknown:false});       // same id: the first answer, no second cycle
 expect(observations.map(o=>o.result)).toEqual(['accepted']);
 expect(await port.reconcile('c1')).toMatchObject({status:'running'});
 a.advance(Math.ceil(MOCK_COFFEE_PARAMS.brewUl/MOCK_COFFEE_PARAMS.brewUlPerTick)+MOCK_COFFEE_PARAMS.settleTicks);
 const done=observations.find(o=>o.result==='completed')!;
 expect(done).toMatchObject({commandId:'c1',deviceId:CELL,recipeRevision:2,result:'completed'});
 expect(a.measurements.get('c1')).toEqual({amount:'0.000030000',unit:'m3',provenance:'modelled'}); // canonical m3 at scale 9
 const r=await port.reconcile('c1');
 expect(r.status).toBe('completed');expect(r.evidence).toEqual([{id:'coffee_io_sim:c1',sha256:expect.stringMatching(/^[0-9a-f]{64}$/)}]);
 expect(a.plant.state.commands).toHaveLength(1);
});

test('milk flow at the modelled rate lowers the level, settles before completion and adds to the cup; ice jam fails with the partial mass',async()=>{
 const a=adapter(),port=coffeePlantPort(a),observations:JsonObject[]=[];port.observe(o=>observations.push(o as unknown as JsonObject));
 a.advance(MOCK_COFFEE_PARAMS.warmupTicks);a.plant.placeCup('cup-1','cup-paper-illustrative');
 const milk={...brew('m1','0.00008'),kind:'dispense_milk' as const,quantity:{value:'0.00008',unit:'m3' as const}};
 expect(await port.execute(milk)).toEqual({accepted:true,unknown:false});
 const ticks=Math.ceil(80000/MOCK_COFFEE_PARAMS.milkUlPerTick);
 a.advance(ticks);
 expect(observations.filter(o=>o.result==='completed')).toHaveLength(0);          // still settling
 expect(a.plant.state.devices.find(d=>d.role==='milk')!.levelUl).toBe(MOCK_COFFEE_PARAMS.milkStockUl-80000);
 a.advance(MOCK_COFFEE_PARAMS.settleTicks);
 expect(observations.find(o=>o.result==='completed')).toMatchObject({commandId:'m1',deviceId:`${CELL}:milk`});
 expect(a.measurements.get('m1')).toEqual({amount:'0.000080000',unit:'m3',provenance:'modelled'});
 expect(a.plant.cup('cup-1')!.liquidUl).toBe(80000);
 const ice={...brew('i1','0.12'),kind:'dispense_ice' as const,quantity:{value:'0.12',unit:'kg' as const}};
 expect(await port.execute(ice)).toEqual({accepted:true,unknown:false});
 a.advance(10);a.fault('ice-jam');a.advance(200);                                 // the jam happens mid-dispense: a known jam refuses before any action
 expect(await port.execute({...ice,commandId:'i2'})).toEqual({accepted:false,unknown:false,reason:'DEVICE_NOT_READY'});
 const failed=observations.find(o=>o.commandId==='i1'&&o.result==='failed')!;
 expect(failed.reasonCodes).toEqual(['ICE_JAMMED']);expect(a.measurements.get('i1')).toEqual({amount:'0.040000',unit:'kg',provenance:'modelled'});
 expect(await port.reconcile('i1')).toMatchObject({status:'failed'});
 expect(a.plant.cup('cup-1')!.iceMg).toBe(40000);
});

test('the effect dispatcher claims before it sends, asks before it reconciles and never resends an unknown dose',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const a=adapter();a.advance(MOCK_COFFEE_PARAMS.warmupTicks);a.plant.placeCup('cup-1','cup-paper-illustrative');
 const {effect}=await startStep(v,'coffee-1','brew');expect(effect).toBeTruthy();
 a.fault('disconnect');                                                              // the device acts, the reply is lost
 expect(await dispatchCellEffects(v.store,v.scope,[a],v.now(),RUN)).toEqual([{id:String(effect!.id),status:'unknown'}]);
 expect(a.plant.state.commands).toHaveLength(1);expect(a.executeCalls).toBe(1);
 a.clearFault('disconnect');
 expect(await dispatchCellEffects(v.store,v.scope,[a],v.now(),RUN)).toEqual([{id:String(effect!.id),status:'confirmed'}]); // reconcile found it running
 expect(a.executeCalls).toBe(1);expect(a.plant.state.commands).toHaveLength(1);
 expect((await v.effects()).filter(e=>e.type==='cell.execute').map(e=>[e.status,e.attempts])).toEqual([['confirmed',1]]);
 // a report for a device of another run is refused before anything acts
 const other=new CoffeeIoSimAdapter({cellId:CELL,runId:'9f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c',nowMs:()=>v.now(),newBootId:()=>'b'});
 expect(await other.execute({...(effect!.payload as JsonObject),runId:RUN} as never)).toEqual({accepted:false,unknown:false,reason:'RUN_MISMATCH'});
 await v.close();
});

test('cup liquid is a bounded modelled scalar with attachment transforms; the coupling is open-loop and one controller owns each joint',async()=>{
 let t=0;const session=createPlantSession({runId:RUN,cellId:CELL,armId:DEVICES.arm,nowMs:()=>t,receiver:()=>null,dock:()=>({robotId:'amr-1',errorM:3,moving:false,localizationValid:true,bootId:'b'}),traySensor:()=>false});
 expect(session.capability()).toMatchObject({coupling:'open_loop_visualization',closedLoop:false,armController:'mock_arm',checker:{engine:'capsule-sweep-v1'},jointAuthority:expect.arrayContaining([{joint:'J1',controller:'mock_arm'}])});
 expect(()=>assertSingleJointAuthority([{joint:'J1',controller:'mock_arm'},{joint:'J1',controller:'ros2_control'}])).toThrow('JOINT_AUTHORITY_CONFLICT:J1');
 for(let i=0;i<MOCK_COFFEE_PARAMS.warmupTicks;i++){session.advance();t+=20;}
 session.plant.placeCup('cup-1','cup-paper-illustrative');
 const port=coffeePlantPort(session.coffee);
 await port.execute(brew('c1'));
 for(let i=0;i<1300;i++){session.advance();t+=20;}
 expect(session.liquid('cup-1')).toEqual({cupId:'cup-1',volumeM3:'0.000030000',iceKg:'0.000000',massKgEstimate:'0.030900000',fillRatio:0.1,withinCup:true,provenance:'modelled',assumptions:['density 1030 kg/m3 assumed','cup capacity 0.0003 m3 from the illustrative cup policy','no fluid or thermal model']});
 expect(session.attachments('cup-1')).toMatchObject({cupId:'cup-1',custody:'cell:cell-1',physical:{parent:'cell:cell-1/nozzle',transform:{translationM:[0,0.1,0.05],quaternionXyzw:[0,0,0,1]},provenance:'modelled'},resolved:true});
 expect(session.report()).toMatchObject({coupling:'open_loop_visualization',cups:[{cupId:'cup-1'}]});
 const bad:CellReport[]=[];void bad;
});
