// W09 campaign on the Webots plant: the batch runner picks the plant from the campaign's fixtures (serve-3d-*), runs WB cases on the real Webots R2025a one world at a
// time, judges repeats by pose within the oracle profile's tolerance (the engine is not bit-reproducible: 1e-12 m was measured), and labels every run webots_3d.
// The loader tests need no engine; the run tests are skipped, with the reason, where Webots is not installed.
import {afterAll,expect,test} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {loadCampaign,runIRSimBatch} from '../../packages/lab-runtime/src/v2/navigation2d/batch';
import {webotsAvailable,webotsProcesses,temp} from '../support/webots-mission';

const dirs:string[]=[];
afterAll(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const campaign=(id:string)=>resolve('robotics/simulation-3d/campaigns',`${id}.json`);
const json=async<T>(p:string)=>JSON.parse(await readFile(p,'utf8')) as T;
const ORACLES=['EVIDENCE_COMPLETE','IDENTITY_BOUND','NO_SERVED_BEFORE_HANDOFF','BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT'];
const entry=(scenarioId:string,fixtureId:string,over:Record<string,unknown>={})=>({scenarioId,scenarioRevision:1,fixtureId,seed:5,repeat:1,policyRef:{id:'x',revision:1,hash:'a'.repeat(64)},expectedAssertions:ORACLES,...over});
async function tempCampaign(runs:unknown[]){
 // a campaign file must sit in a campaigns directory under a source root; a temp root with the real fixtures and schemas is not needed to LOAD one
 const root=await mkdtemp(join(tmpdir(),'webots-campaign-'));dirs.push(root);
 const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'robotics/simulation-3d/campaigns'),{recursive:true});
 const path=join(root,'robotics/simulation-3d/campaigns/t.json');
 await writeFile(path,JSON.stringify({schemaVersion:1,id:'t',title:'t',runs}));
 return {root,path};
}

test('the R1 qualification campaign loads as a webots_3d campaign of at least twenty sequential runs covering every case it names',async()=>{
 const {campaign:c,plant}=await loadCampaign(campaign('r1-qualification'));
 expect(plant).toBe('webots_3d');
 const n=c.runs.reduce((s,r)=>s+r.repeat,0);expect(n).toBeGreaterThanOrEqual(20);
 const by=(id:string,pred:(r:typeof c.runs[number])=>boolean=()=>true)=>c.runs.filter(r=>r.scenarioId===id&&pred(r));
 expect(by('WB-FD01',r=>r.repeat===3).length).toBe(1);expect(by('WB-FD07',r=>r.repeat===3).length).toBe(1);
 expect(by('WB-FD01',r=>r.repeat===1).length).toBe(6);expect(by('WB-FD07',r=>r.repeat===1).length).toBe(6);
 expect(new Set(by('WB-FD01',r=>r.repeat===1).map(r=>r.seed)).size).toBe(6);expect(new Set(by('WB-FD07',r=>r.repeat===1).map(r=>r.seed)).size).toBe(6);
 expect(by('WB-FD01-cancel').length).toBe(1);expect(by('WB-FD01-enginekill').length).toBe(1);
 expect(by('WB-FD01',r=>r.repeat===3)[0]!.expectedAssertions).toContain('REPEATABLE');
});
test('a campaign may not mix plants, nor run an IR-SIM scenario on a 3D fixture or the reverse',async()=>{
 for(const runs of [[entry('WB-FD01','serve-3d-v1'),entry('IR-FD01','serve-demo-v1')],[entry('IR-FD01','serve-3d-v1')],[entry('WB-FD01','serve-demo-v1')]]){
  const {root,path}=await tempCampaign(runs);
  await expect(loadCampaign(path,root)).rejects.toThrow(/CAMPAIGN_INVALID/);
 }
});
test('a Webots campaign needs concurrency 1 (one Webots per host)',async()=>{
 const {root,path}=await tempCampaign([entry('WB-FD01','serve-3d-v1')]);
 const out=await temp('webots-batch-conc-');dirs.push(out);
 await expect(runIRSimBatch({campaignPath:path,outDir:out,concurrency:2,sourceCommit:'t',sourceRoot:root})).rejects.toThrow(/concurrency/);
});

test.skipIf(!webotsAvailable)('smoke campaign on the real Webots: same-seed repeats agree within the profile tolerance, a mid-route cancel is bounded, every run is labelled webots_3d and leaves no process',async()=>{
 const out=await temp('webots-batch-');dirs.push(out);
 const s=await runIRSimBatch({campaignPath:campaign('r1-smoke'),outDir:join(out,'c'),concurrency:1,sourceCommit:'test-commit'});
 const summary=await json<{status:string;complete:boolean;provider:{id:string;kind:string};runs:{id:string;scenarioId:string;result:string;reasons:string[];assertions?:{id:string;result:string}[]}[]}>(s.summaryPath);
 expect(summary.runs.map(r=>`${r.scenarioId}:${r.result}:${r.reasons.join('|')}`)).toEqual(['WB-FD01:pass:','WB-FD01:pass:','WB-FD01-cancel:pass:']);
 expect(summary.provider).toEqual({id:'webots_3d',kind:'webots_engine'});
 expect(summary.status).toBe('completed');expect(summary.complete).toBe(true);
 expect(summary.runs[0]!.assertions!.concat(summary.runs[1]!.assertions!).filter(a=>a.id==='REPEATABLE').map(a=>a.result)).toEqual(['pass','pass']);
 expect(webotsProcesses()).toEqual([]);
},900_000);
