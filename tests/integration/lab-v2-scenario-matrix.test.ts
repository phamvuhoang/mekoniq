// SIM-10: the scenario matrix binds every verification id (FD01-FD08, BV01-BV08, SYS01-SYS06, the campaign) to requirement refs, fixtures,
// backend support and an oracle; admission answers before any effect and never silently passes a run whose backend is missing.
import {existsSync} from 'node:fs';
import {expect,test} from 'vitest';
import {admitScenario,requiredBackends,scenarioMatrix,validateMatrix,type MatrixRow} from '../../packages/lab-runtime/src/v2/scenario-matrix';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';

test('missing required backend cannot silently produce a passing run',async()=>{
 const admission=await admitScenario('BV01',{mode:'simulation',backendSetId:'coffee-simulation',available:['gazebo_nav2','coffee_io_sim']});
 expect(admission.status).toBe('unavailable');
 expect(admission.reasons).toContain('BACKEND_MISSING:linuxcnc_sim');
 expect(admission.effects).toHaveLength(0);
 expect(await admitScenario('FD07',{mode:'simulation',backendSetId:'simulation-default',available:['gazebo_nav2']})).toMatchObject({status:'admitted',reasons:[],required:['gazebo_nav2']}); // a set may offer more than the row needs
 // one formula for every admission level: a registry scenario needs what ITS definition needs (FD02 the runner: food only; FD02-cups: the cell)
 expect(await admitScenario('FD02',{mode:'simulation',backendSetId:'simulation-default',available:['gazebo_nav2']})).toMatchObject({status:'admitted',required:['gazebo_nav2']});
 expect(await admitScenario('FD02-cups',{mode:'simulation',backendSetId:'simulation-default',available:['gazebo_nav2']})).toMatchObject({status:'unavailable',reasons:['BACKEND_MISSING:linuxcnc_sim','BACKEND_MISSING:coffee_io_sim'],required:['gazebo_nav2','linuxcnc_sim','coffee_io_sim']});
 expect(requiredBackends(scenarioRegistry.get('BV01')!,'simulation')).toEqual(['gazebo_nav2','linuxcnc_sim','coffee_io_sim']);expect(requiredBackends(scenarioRegistry.get('FD07')!,'mock')).toEqual(['mock_amr']);
 // a verification row without a runner scenario (FD08, BV02..BV08, SYS*) is covered by targeted tests; it cannot be admitted as a run
 expect(await admitScenario('FD08',{mode:'simulation',backendSetId:'simulation-default',available:['gazebo_nav2']})).toMatchObject({status:'unsupported',reasons:['NO_RUNNER_SCENARIO']});
 expect(await admitScenario('FD05',{mode:'mock',backendSetId:'mock-amr',available:['mock_amr']})).toMatchObject({status:'admitted',required:['mock_amr']}); // the union of its FD05-* runners
 expect(await admitScenario('FD07',{mode:'mock',backendSetId:'mock-amr',available:['mock_amr']})).toMatchObject({status:'admitted',required:['mock_amr']});
 expect(await admitScenario('BV01',{mode:'mock',backendSetId:'mock-amr',available:['mock_amr']})).toMatchObject({status:'unavailable',reasons:['BACKEND_MISSING:mock_coffee','BACKEND_MISSING:mock_arm']});
 expect(await admitScenario('FD03',{mode:'hardware',backendSetId:'hardware-live',available:['valetudo_native','cell_native']})).toMatchObject({status:'unsupported',reasons:['MODE_UNSUPPORTED:hardware']});
 expect(await admitScenario('NOPE',{mode:'mock',backendSetId:'mock-amr',available:['mock_amr']})).toMatchObject({status:'unsupported',reasons:['SCENARIO_UNKNOWN']});
 expect(await admitScenario('FD01',{mode:'simulation',backendSetId:'mock-amr',available:['mock_amr']})).toMatchObject({status:'unavailable',reasons:['MODE_BACKEND_MISMATCH']});
 expect(await admitScenario('FD01',{mode:'simulation',backendSetId:'nope',available:[]})).toMatchObject({status:'unavailable',reasons:['BACKEND_SET_UNKNOWN']});
});

test('every matrix row has requirement refs, fixtures, tests, backend support and an oracle; physics rows name their measurements',()=>{
 expect(validateMatrix(scenarioMatrix,{exists:existsSync})).toEqual({ok:true,issues:[]});
 const ids=scenarioMatrix.map(r=>r.id);
 for(const id of ['FD01','FD02','FD03','FD04','FD05','FD06','FD07','FD08','BV01','BV02','BV03','BV04','BV05','BV06','BV07','BV08','SYS01','SYS02','SYS03','SYS04','SYS05','SYS06','CAMPAIGN-FD02-FD07-BV01-BV03'])expect(ids).toContain(id);
 // every registry scenario is owned by some row, and every row's runner scenarios exist
 const owned=new Set(scenarioMatrix.flatMap(r=>r.runnerScenarios));
 for(const id of scenarioRegistry.keys())expect(owned.has(id)).toBe(true);
 for(const r of scenarioMatrix){
  expect(r.requirementIds.length).toBeGreaterThan(0);expect(r.fixtures.length).toBeGreaterThan(0);expect(r.tests.length).toBeGreaterThan(0);expect(r.oracle.length).toBeGreaterThan(10);
  if(r.backendSupport.simulation)expect(r.measurements.length).toBeGreaterThan(0);
  for(const t of r.tests)expect(existsSync(t.split('::')[0]!)).toBe(true);
 }
 // mock and SIL share the business invariants; physics expectations exist only where simulation is supported
 const fd03=scenarioMatrix.find(r=>r.id==='FD03')!;
 expect(fd03.invariants).toContain('no-false-arrival');expect(fd03.measurements).toEqual(expect.arrayContaining(['contacts','minSeparationM']));
 expect(scenarioMatrix.find(r=>r.id==='SYS05')!.backendSupport).toEqual({mock:true,simulation:true,hardware:false});
});

test('a duplicate id, a row without tests or a physics row without measurements fails validation',()=>{
 const base:MatrixRow={id:'X01',title:'x',requirementIds:['FD-01'],runnerScenarios:['FD01'],fixtures:['tests/fixtures/digital-twin/restaurant-v2.json'],tests:['tests/integration/lab-v2-mock.test.ts::x'],backendSupport:{mock:true,simulation:true,hardware:false},oracle:'served only after handoff from the journal',measurements:['contacts'],invariants:['served-after-handoff'],cell:false};
 expect(validateMatrix([{...base,runnerScenarios:['BV01']}],{exists:()=>true}).issues).toEqual([{id:'X01',code:'CELL_REQUIRED_BY_RUNNER_SCENARIO'}]);
 expect(validateMatrix([base,{...base,title:'dup'}],{exists:()=>true}).issues).toEqual([{id:'X01',code:'DUPLICATE_ID'}]);
 expect(validateMatrix([{...base,tests:[]}],{exists:()=>true}).issues).toEqual([{id:'X01',code:'NO_TESTS'}]);
 expect(validateMatrix([{...base,measurements:[]}],{exists:()=>true}).issues).toEqual([{id:'X01',code:'ZERO_MEASUREMENTS'}]);
 expect(validateMatrix([{...base,backendSupport:{mock:true,simulation:false,hardware:false},measurements:[]}],{exists:()=>true}).ok).toBe(true);
 expect(validateMatrix([{...base,runnerScenarios:['NOPE']}],{exists:()=>true}).issues).toEqual([{id:'X01',code:'UNKNOWN_RUNNER_SCENARIO:NOPE'}]);
 expect(validateMatrix([base],{exists:()=>false}).issues).toEqual([{id:'X01',code:'TEST_FILE_MISSING:tests/integration/lab-v2-mock.test.ts'}]);
 expect(validateMatrix([{...base,requirementIds:[]}],{exists:()=>true}).issues).toEqual([{id:'X01',code:'NO_REQUIREMENTS'}]);
});
