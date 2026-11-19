// V05: the CIL campaign's recorder and its independent verifier. One recorded case (the ideal drive, seed 7, with its legacy baseline) is tampered with in several ways; the full
// campaign is verified when a recording is given (CIL_RECORDED_DIR) or, with CIL_RECORD_FULL=1, recorded here first (about an hour).
import {afterAll,beforeAll,expect,test} from 'vitest';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CIL_CASES,runCilCampaign,verifyCilCampaign} from '../../packages/lab-runtime/src/v2/control/cil-campaign';
import {cellArtifacts} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';

const root=resolve('.'),COMMIT='0123456789abcdef0123456789abcdef01234567',CASE='fd01-drive-ideal-v1-s7';
let recorded:string;
beforeAll(async()=>{const out=await mkdtemp(join(tmpdir(),'cil-one-'));recorded=join(out,'c');await runCilCampaign({root,out:recorded,sourceCommit:COMMIT,caseId:CASE});},300_000);
afterAll(async()=>{await rm(join(recorded,'..'),{recursive:true,force:true});});
const copy=async()=>{const d=join(await mkdtemp(join(tmpdir(),'cil-tamper-')),'c');await cp(recorded,d,{recursive:true});return d;};
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8')) as Record<string,any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const write=(p:string,v:unknown)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
/** After a deliberate edit, the case's own inventory is made to agree with the files again, so that only the deeper checks can catch the edit. */
const reseal=async(d:string)=>{const dir=join(d,CASE),rec=await json(join(dir,'case.json'));rec.artifacts=await cellArtifacts(dir);await write(join(dir,'case.json'),rec);};
const issues=async(d:string)=>(await verifyCilCampaign(d,CASE)).issues.join('|');

test('the registered campaign is 26 runs: 15 + 3 repeats + 8 cell cases',()=>{
 expect(CIL_CASES).toHaveLength(26);expect(CIL_CASES.filter(c=>c.kind==='mobile')).toHaveLength(15);expect(CIL_CASES.filter(c=>c.kind==='repeat')).toHaveLength(3);expect(CIL_CASES.filter(c=>c.kind==='cell')).toHaveLength(8);
 expect(new Set(CIL_CASES.map(c=>c.id)).size).toBe(26);
});
test('a recorded case verifies and its drive physics equals the legacy path bit for bit',async()=>{
 const v=await verifyCilCampaign(recorded,CASE);
 expect(v).toMatchObject({expectedRuns:1,completedCases:1,missingArtifacts:[],issues:[]});expect(v.equivalence).toEqual([{id:'ideal-vs-legacy-s7',bitIdentical:true}]);
});
test('verification refuses a missing run, a missing evidence file, an edited file, and a campaign of another identity',async()=>{
 let d=await copy();await rm(join(d,CASE),{recursive:true});expect(await issues(d)).toContain(CASE);
 d=await copy();await rm(join(d,CASE,'run/physics/manifest.json'));expect(await issues(d)).toContain('CIL_ARTIFACT_INVENTORY');
 d=await copy();const r=await json(join(d,CASE,'report.json'));r.outcome.served='2';await write(join(d,CASE,'report.json'),r);expect(await issues(d)).toContain('CIL_ARTIFACT_INVENTORY');
 d=await copy();const c=await json(join(d,'campaign.json'));c.campaign.seeds=[7];await write(join(d,'campaign.json'),c);expect(await issues(d)).toContain('CIL_CAMPAIGN_IDENTITY');
});
test('verification catches an edit the inventory was re-made for: a result that does not match the oracle, a drive section not built from the stream, another seed or experiment, a faultReset',async()=>{
 const dir=(d:string)=>join(d,CASE);
 let d=await copy();let r=await json(join(dir(d),'report.json'));r.outcome.served='0';await write(join(dir(d),'report.json'),r);await reseal(d);expect(await issues(d)).toMatch(/CIL_SERVED|CIL_RUN_IDENTITY/);
 d=await copy();r=await json(join(dir(d),'report.json'));r.driveEvidence.axes[0].trackingRms.value+=0.5;await write(join(dir(d),'report.json'),r);await reseal(d);expect(await issues(d)).toContain('CIL_DRIVE_REPORT_NOT_FROM_STREAM');
 d=await copy();const run=await json(join(dir(d),'run/run.json'));run.manifest.seed=19;await write(join(dir(d),'run/run.json'),run);await reseal(d);expect(await issues(d)).toContain('CIL_RUN_IDENTITY');
 d=await copy();r=await json(join(dir(d),'report.json'));r.manifest.drive.experimentId='drive-nominal-v1';await write(join(dir(d),'report.json'),r);await reseal(d);expect(await issues(d)).toContain('CIL_MANIFEST_DRIVE');
 d=await copy();const t=await json(join(dir(d),'trace.json'));t.steps[10].driveCommands[0].faultReset=true;await write(join(dir(d),'trace.json'),t);await reseal(d);expect(await issues(d)).toContain('CIL_COMMAND_TRACE');
 d=await copy();r=await json(join(dir(d),'report.json'));r.attention=[{reason:'X'}];r.outcome.status='needs_attention';await write(join(dir(d),'report.json'),r);await reseal(d);expect(await issues(d)).toMatch(/CIL_OUTCOME_STATUS|CIL_RUN_IDENTITY|CIL_DRIVE/);
});
test('the baseline of an equivalence case must be a legacy run: a drive baseline is refused',async()=>{
 const d=await copy(),dir=join(d,CASE);
 await cp(join(dir,'bundle'),join(dir,'baseline/bundle'),{recursive:true,force:true});await cp(join(dir,'run'),join(dir,'baseline/run'),{recursive:true,force:true});await reseal(d);
 expect(await issues(d)).toMatch(/CIL_BASELINE_NOT_LEGACY|CIL_ARTIFACT/);
});
test.skipIf(!process.env.CIL_RECORDED_DIR&&process.env.CIL_RECORD_FULL!=='1')('the recorded CIL campaign is complete and never serves falsely',async()=>{
 const dir=process.env.CIL_RECORDED_DIR??join(await mkdtemp(join(tmpdir(),'cil-full-')),'c');
 if(!process.env.CIL_RECORDED_DIR)await runCilCampaign({root,out:dir,sourceCommit:COMMIT});
 const result=await verifyCilCampaign(dir);
 expect(result.issues).toEqual([]);expect(result.expectedRuns).toBe(26);expect(result.completedCases).toBe(26);expect(result.missingArtifacts).toEqual([]);
 expect(result.equivalence.every(e=>e.bitIdentical)).toBe(true);expect(result.equivalence).toHaveLength(4);
 expect(result.faultCases).toHaveLength(5);expect(result.faultCases.every(c=>c.detected&&!c.falseServed)).toBe(true);
},4*60*60*1000);
