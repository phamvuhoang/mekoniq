// Exercise actual worker output. Each mutation is confined to a disposable copy with a fresh inventory.
import {afterAll,beforeAll,expect,test} from 'vitest';
import {cp,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CIL_CASES,runCilCampaign,verifyCilCampaign} from '../../packages/lab-runtime/src/v2/control/cil-campaign';
import {cellArtifacts} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
const repeat='repeat-torque-limited-s7-r1',latency='fd01-drive-latency-v1-s7',cell='cell-lost-ack',source=resolve('.');
const commit='0123456789abcdef0123456789abcdef01234567';
let dir:string;
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const save=(p:string,v:unknown)=>writeFile(p,JSON.stringify(v)+'\n');
beforeAll(async()=>{
 dir=await mkdtemp(join(tmpdir(),'cil-durable-'));
 for(const id of [latency,cell,repeat])await runCilCampaign({root:source,out:join(dir,id),caseId:id,sourceCommit:commit});
},600_000);
afterAll(async()=>{await rm(dir,{recursive:true,force:true});});
async function edit(id:string,path:string,change:(value:ReturnType<typeof JSON.parse>)=>void){
 const copy=await mkdtemp(join(dir,'copy-'));await cp(join(dir,id),copy,{recursive:true});
 const run=join(copy,id===cell?'cell/lost-ack':id),file=join(run,path),value=await read(file);change(value);await save(file,value);
 const rec=await read(join(run,'case.json'));rec.artifacts=await cellArtifacts(run);await save(join(run,'case.json'),rec);
 return (await verifyCilCampaign(copy,id)).issues.join('|');
}
test('latency cannot report a false completion after its inventory is resealed',async()=>{
 const original=await read(join(dir,latency,latency,'report.json'));
 expect(original.attention.map((a:{reason:string})=>a.reason)).toContain('NO_PROGRESS');
 expect(await edit(latency,'report.json',r=>{r.attention=[];r.outcome.served='1';r.outcome.status='completed';})).toContain('CIL_OUTCOME_NOT_FROM_JOURNAL');
});
test.each(['axis','mode','seq','tick','target'])('commands must match the controller replay including %s',async(field)=>{
 expect(await edit(latency,'trace.json',t=>{const s=t.steps[1];if(field==='tick')s.tick++;else if(field==='axis')s.driveCommands[1]=s.driveCommands[0];else if(field==='mode')s.driveCommands[0].mode='csp';else s.driveCommands[0][field]++;})).toContain('CIL_COMMAND_TRACE');
});
test('three repeats per experiment require an independently verified same-profile same-seed baseline',async()=>{
 const repeats=CIL_CASES.filter(c=>c.kind==='repeat');
 for(const id of new Set(CIL_CASES.map(c=>c.experimentId)))expect(repeats.filter(c=>c.experimentId===id)).toHaveLength(3);
 const root=join(dir,'missing');await mkdir(root);await cp(join(dir,latency,'campaign.json'),join(root,'campaign.json'));
 expect((await verifyCilCampaign(root,repeats[0]!.id)).issues.join('|')).toContain('CIL_DEPENDENCY');
});
test.each(['complete','event','outcome'])('cell %s must come from durable world and Source records',async field=>{
 expect(await edit(cell,'report.json',r=>{if(field==='event')r.driveEvidence.events=[{tick:1,code:'DRIVE_FAULT'}];else if(field==='complete'){r.driveEvidence.complete=true;r.driveEvidence.issues=[];}else{r.outcome.status='cancelled';r.attention=[];}})).toMatch(/CELL_(DRIVE_NOT_FROM_STREAM|OUTCOME_NOT_FROM_JOURNAL)/);
});

test('a selected torque repeat records and independently verifies its same-profile baseline and nominal comparator',async()=>{
 const recording=join(dir,repeat),valid=await verifyCilCampaign(recording,repeat);
 expect(valid).toMatchObject({completedCases:1,issues:[],equivalence:[{id:'repeat-torque-limited-s7',bitIdentical:true}]});
 const copy=await mkdtemp(join(dir,'dependency-'));await cp(recording,copy,{recursive:true});
 const torque=join(copy,'fd01-drive-torque-limited-v1-s7'),report=await read(join(torque,'report.json'));report.outcome.served='2';await save(join(torque,'report.json'),report);
 const rec=await read(join(torque,'case.json'));rec.artifacts=await cellArtifacts(torque);await save(join(torque,'case.json'),rec);
 const rejected=await verifyCilCampaign(copy,repeat);
 expect(rejected.completedCases).toBe(0);expect(rejected.issues.join('|')).toContain('CIL_DEPENDENCY:fd01-drive-torque-limited-v1-s7');
});
test('a fresh disk reader recovers the recorded cell report and exposes a damaged chunk after restart',async()=>{
 const {readRetainedWorldAdmission}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-arm-report');
 const {readWorldDriveReport}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-drive-report');
 const copy=await mkdtemp(join(dir,'restart-')),caseDir=join(dir,cell,'cell/lost-ack');
 await cp(join(caseDir,'run'),copy,{recursive:true});
 const checkpoint=await read(join(copy,'run.json')),a=await readRetainedWorldAdmission(copy,checkpoint.world.snapshot.sceneDigest),identity={runId:checkpoint.runId,bootId:checkpoint.world.snapshot.bootId,publicCommittedTick:checkpoint.tick};
 const expected=(await read(join(caseDir,'report.json'))).driveEvidence;
 expect(await readWorldDriveReport(copy,a,identity)).toEqual(expected);
 const manifest=await read(join(copy,'world-evidence/manifest.json'));
 await writeFile(join(copy,'world-evidence',manifest.chunks[0].path),'damaged');
 const damaged=await readWorldDriveReport(copy,a,identity);
 expect(damaged).toMatchObject({complete:false,ticks:0,events:[]});expect(damaged.issues).toContain('WORLD_EVIDENCE_HASH_MISMATCH');
});
