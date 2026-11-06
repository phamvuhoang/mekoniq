import {afterEach,expect,test} from 'vitest';
import {validateTwinSampleV2} from '../../packages/lab-runtime/src/v2/contracts';
import {canonicalOutcome,type RunReport} from '../../packages/lab-runtime/src/v2/report';
import {compareRuns,reportKpis} from '../../packages/lab-runtime/src/v2/comparison';
import {act,cleanupRuns,executeCoffee,executeFixture,openCoffee,restaurant,amrRef} from '../support/lab-v2';
afterEach(cleanupRuns);

test('report separates durable business events from lossy coalesced telemetry with per-entity sample counts',async()=>{
 const r=await executeCoffee('BV01',{seed:42});
 expect(r.outcome.status).toBe('completed');
 const seq=r.businessEvents.map(e=>BigInt(e.sequence));expect(seq).toEqual([...seq].sort((a,b)=>a<b?-1:a>b?1:0));
 const t=r.telemetry;
 expect(t).toMatchObject({lossy:true,coalesced:true,rateHz:10,dropped:0,gaps:[]});
 expect(Object.keys(t.sampleCounts).sort()).toEqual(['amr-1','arm-1','coffee-1']);
 expect(t.samples.length).toBe(Object.values(t.sampleCounts).reduce((a,b)=>a+b,0));
 for(const s of t.samples)expect(validateTwinSampleV2(s)).toMatchObject({ok:true});
 // the arm has no encoder in mock: commanded joints only, observed null with a reason (never zeros)
 const arm=t.samples.find(s=>s.entityId==='arm-1')!;expect(arm).toMatchObject({quality:'unknown',observed:null,reasonCodes:['NO_ENCODER_MOCK']});expect((arm.commanded as {jointsRad:number[]}).jointsRad).toHaveLength(6);
 const cell=t.samples.filter(s=>s.entityId==='coffee-1');expect(cell.some(s=>(s.observed as {cupPresent:boolean}).cupPresent)).toBe(true);
 // per-provider order: seq rises within one boot
 const amr=t.samples.filter(s=>s.entityId==='amr-1').map(s=>BigInt(s.seq));expect(amr).toEqual([...amr].sort((a,b)=>a<b?-1:a>b?1:0));
 expect(r.coverage).toMatchObject({eventStream:true});
 // telemetry is not part of the replay digest (receipt clocks differ run to run)
 expect(JSON.stringify(canonicalOutcome(r))).not.toContain('receivedMonotonicNs');
 // exports carry no keys, tokens or local paths
 const text=JSON.stringify(r);for(const bad of ['privateKey','"d":','csrf','signing-key','/tmp/','/var/folders/'])expect(text).not.toContain(bad);
});

test('coffee view and report omit jobs the runtime has not reserved yet instead of reporting the string "undefined"',async()=>{
 const run=await openCoffee('BV01',{seed:42});
 try{
  await run.start();let saw=false;
  for(let i=0;i<40&&!saw;i++){
   const v=await act(run,'step',{ticks:5});
   // job 2 has an order line but no CoffeeJob while job 1 holds the machine
   saw=(v.coffee?.jobs.length??0)===1&&v.workload.length===0;
   for(const j of v.coffee?.jobs??[])expect([j.status,j.recipeId]).not.toContain('undefined');
   for(const c of v.coffee?.cups??[])expect([c.ownerKind,c.ownerId]).not.toContain('undefined');
   const rep=await run.report();
   for(const j of rep.coffee?.jobs??[])expect(j.status).toBeDefined();
   for(const c of rep.coffee?.cups??[])expect(c.ownerKind).toBeDefined();
  }
  expect(saw).toBe(true);
 }finally{await run.close();}
});

test('compareRuns: same scenario/mode/backends with another seed is comparable, KPIs carry unit, definition and population',async()=>{
 const a=await executeFixture('FD01',{seed:42}),b=await executeFixture('FD01',{seed:43});
 const c=compareRuns(a,b);
 expect(c).toMatchObject({comparable:true,reasons:[]});
 expect(c.inputs).toContainEqual({field:'seed',a:42,b:43});
 const served=c.kpis.find(k=>k.id==='served')!;expect(served).toMatchObject({unit:'count',a:1,b:1,delta:0,population:{runs:1}});expect(served.definition).toMatch(/handoff/i);
 const time=c.kpis.find(k=>k.id==='missionTimeS')!;expect(time.unit).toBe('s');expect(time.a).toBeGreaterThan(0);expect(time.percentiles).toBeNull(); // one run is no percentile
 expect(c.kpis.find(k=>k.id==='distanceM')).toMatchObject({unit:'m'});
 expect(c.coverage.find(x=>x.key==='dynamics')).toEqual({key:'dynamics',a:false,b:false});
 expect(c.population).toMatchObject({a:{runs:1,businessEvents:a.businessEvents.length,telemetrySamples:a.telemetry.samples.length}});
});

test('compareRuns refuses to rank mock against hardware, and different scenarios, with explicit reasons',async()=>{
 const mock=await executeFixture('FD01',{seed:42});
 const hardware:RunReport={...structuredClone(mock),manifest:{...structuredClone(mock.manifest),mode:'hardware' as never,access:'shadow' as never,backendSetId:'hardware-shadow',backends:[{id:'valetudo_shadow',version:'1',model:'hardware',dynamics:true}]},coverage:{...mock.coverage,sensorEvidence:true,nativeExecution:true}};
 const c=compareRuns(mock,hardware);
 expect(c.comparable).toBe(false);
 expect(c.reasons).toEqual(expect.arrayContaining(['MODE_DIFFERS','ACCESS_DIFFERS','BACKENDS_DIFFER','FIDELITY_DIFFERS']));
 expect(c.kpis.every(k=>k.delta===null)).toBe(true); // no ranking across evidence scales
 const coffee=await executeCoffee('BV01',{seed:42});
 expect(compareRuns(mock,coffee).reasons).toEqual(expect.arrayContaining(['SCENARIO_DIFFERS','BACKENDS_DIFFER']));
});

test('a KPI without data is unavailable with a reason, never 0',async()=>{
 const unknown=await executeFixture('FD01',{seed:42,project:restaurant({entities:[{id:'amr-1',kind:'amr',assetRef:{...amrRef,contentHash:'0'.repeat(64)}}]})});
 const contacts=reportKpis(unknown).find(k=>k.id==='contacts')!;
 expect(contacts).toMatchObject({available:false,value:null,reason:'GEOMETRY_UNKNOWN'});
 const known=await executeFixture('FD01',{seed:42});
 const c=compareRuns(known,unknown);
 expect(c.comparable).toBe(true); // a layout/asset change is what compare is for
 expect(c.inputs.map(i=>i.field)).toContain('project.hash');
 expect(c.kpis.find(k=>k.id==='contacts')).toMatchObject({a:0,b:null,delta:null,available:false});
});
