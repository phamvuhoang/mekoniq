// N02 (D57): a paced `step` only delays each tick to its wall-clock due time; it never changes what a run computes.
import {afterEach,expect,test} from 'vitest';
import {paceDelay,type WallClock} from '../../packages/lab-runtime/src/v2/pace';
import {createScenarioRun,type ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {readCheckpoint} from '../../packages/lab-runtime/src/v2/checkpoint';
import {outcomeDigest} from '../../packages/lab-runtime/src/v2/report';
import {amrAsset,cleanupRuns,coffeeProject,COFFEE_BACKENDS,manifestFor,runDirectory} from '../support/lab-v2';
afterEach(cleanupRuns);
const GOLDEN='9cfda98a693941cde4e0ecbfe028d48471877c6f8440295fc26e7e5061a1a2a2'; // tests/unit/bv01-mock-golden.test.ts
/** Fake wall: time moves only by sleep; every call is counted. */
function fakeWall(){const w={t:0,nows:0,sleeps:[] as number[]};const wall:WallClock={now:()=>{w.nows++;return w.t;},sleep:async ms=>{w.sleeps.push(ms);w.t+=ms;}};return {w,wall};}
const openBv01=async(wall:WallClock,directory?:string)=>createScenarioRun({...manifestFor('BV01',{seed:42,project:coffeeProject()}),backendSetId:'mock-default'},{directory:directory??await runDirectory(),assets:[amrAsset],enabledBackends:COFFEE_BACKENDS,scenarios:scenarioRegistry,wall});
let n=0;
const act=async(run:ScenarioRun,kind:string,payload:Record<string,unknown>={})=>{const v=await run.snapshot();return run.action({actionId:`p-${++n}`,expectedRevision:v.run.runRevision,kind,payload});};
const FINAL=['completed','needs_attention','cancelled'];

test('paceDelay: tick due at anchor + ticks·tickMs/factor; re-anchors on no anchor, a factor change or more than 250 ms late',()=>{
 const first=paceDelay(null,100,1,5000);
 expect(first).toEqual({anchor:{wallMs:5000,tick:100,factor:1},delayMs:0});
 expect(paceDelay(first.anchor,110,1,5100)).toEqual({anchor:first.anchor,delayMs:100});
 expect(paceDelay(first.anchor,110,1,5190)).toEqual({anchor:first.anchor,delayMs:10});
 expect(paceDelay(first.anchor,110,1,5460)).toEqual({anchor:{wallMs:5460,tick:110,factor:1},delayMs:0});
 expect(paceDelay(first.anchor,110,4,5100)).toEqual({anchor:{wallMs:5100,tick:110,factor:4},delayMs:0});
 const four=paceDelay(null,100,4,5000).anchor;
 expect(paceDelay(four,110,4,5000)).toEqual({anchor:four,delayMs:50});
});

test('mock BV01 driven only by paced steps ends with the golden outcome digest and the final tick of 500-tick steps',async()=>{
 const plain=fakeWall(),paced=fakeWall();
 const a=await openBv01(plain.wall);await a.start();let va=await a.snapshot();
 while(!FINAL.includes(va.run.status))va=await act(a,'step',{ticks:500});
 const ra=await a.report();await a.close();
 // without pace neither the wall clock nor a sleep is ever touched
 expect(plain.w.nows+plain.w.sleeps.length).toBe(0);expect(outcomeDigest(ra)).toBe(GOLDEN);
 const b=await openBv01(paced.wall);await b.start();let vb=await b.snapshot();
 // 10 paced steps of 50 ticks per 500-tick step of the golden: same tick sequence, so the same final tick
 while(!FINAL.includes(vb.run.status))for(let i=0;i<10;i++)vb=await act(b,'step',{ticks:50,pace:{factor:4}});
 const rb=await b.report();await b.close();
 expect(rb.outcome.tick).toBe(ra.outcome.tick);expect(outcomeDigest(rb)).toBe(GOLDEN);
 // one sleep per tick but the first (the anchor), each one slot of 5 ms at 4x
 expect(paced.w.sleeps.length).toBe(rb.outcome.tick-1);expect(new Set(paced.w.sleeps)).toEqual(new Set([5]));
},120000);

test('an invalid paced step is INVALID_ACTION and neither advances the run nor stores a receipt',async()=>{
 const {w,wall}=fakeWall(),run=await openBv01(wall);await run.start();
 const v=await run.snapshot();
 for(const payload of [{ticks:51,pace:{factor:1}},{ticks:20,pace:{factor:2}},{ticks:20,pace:{}},{ticks:20,pace:{factor:1,extra:1}}])
  await expect(run.action({actionId:'bad',expectedRevision:v.run.runRevision,kind:'step',payload})).rejects.toThrow('INVALID_ACTION');
 const after=await run.snapshot();expect(after.tick).toBe(v.tick);expect(after.run.runRevision).toBe(v.run.runRevision);
 // the refused action id is still free
 expect((await run.action({actionId:'bad',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:50,pace:{factor:1}}})).tick).toBe(v.tick+50);
 expect(w.sleeps.length).toBe(49);await run.close();
});

test('the anchor lives in memory only: cleared by pause, resume, cancel, a step without pace and a reopen; never checkpointed',async()=>{
 const {w,wall}=fakeWall(),dir=await runDirectory();let run=await openBv01(wall,dir);await run.start();
 const sleepsOf=async(f:()=>Promise<unknown>)=>{const k=w.sleeps.length;await f();return w.sleeps.length-k;};
 const paced=()=>act(run,'step',{ticks:20,pace:{factor:1}});
 expect(await sleepsOf(paced)).toBe(19); // a new anchor: its first tick starts at once
 expect(await sleepsOf(paced)).toBe(20); // continuing: every tick waits for its slot
 await act(run,'pause');await act(run,'resume');expect(await sleepsOf(paced)).toBe(19);
 await act(run,'step',{ticks:5});expect(await sleepsOf(paced)).toBe(19);
 const cp=JSON.stringify(await readCheckpoint(dir));expect(cp).not.toMatch(/wallMs|"anchor"|"pace"/);
 await run.close();run=await openBv01(wall,dir);expect(await sleepsOf(paced)).toBe(19);
 await act(run,'cancel');expect(await sleepsOf(paced)).toBe(19);
 await run.close();
});
