// Exercise actual worker output. Each mutation is confined to a disposable copy with a fresh inventory.
import {afterAll,beforeAll,expect,test} from 'vitest';
import {cp,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CIL_CASES,runCilCampaign,verifyCilCampaign} from '../../packages/lab-runtime/src/v2/control/cil-campaign';
import {cellArtifacts} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
const ideal='fd01-drive-ideal-v1-s7';
const repeat='repeat-torque-limited-s7-r1',latency='fd01-drive-latency-v1-s7',cell='cell-lost-ack',source=resolve('.');
const commit='0123456789abcdef0123456789abcdef01234567';
let dir:string;
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const save=(p:string,v:unknown)=>writeFile(p,JSON.stringify(v)+'\n');
beforeAll(async()=>{
 dir=await mkdtemp(join(tmpdir(),'cil-durable-'));
 const recorded=process.env.CIL_RECORDED_DIR;
 for(const id of [latency,cell,repeat,ideal]){
  const out=join(dir,id);
  if(!recorded){await runCilCampaign({root:source,out,caseId:id,sourceCommit:commit});continue;}
  await mkdir(out);await cp(join(recorded,'campaign.json'),join(out,'campaign.json'));
  const paths=id===cell?['cell/campaign.json','cell/lost-ack']:id===repeat?['fd01-drive-nominal-v1-s7','fd01-drive-torque-limited-v1-s7',id]:[id];
  for(const path of paths)await cp(join(recorded,path),join(out,path),{recursive:true});
 }
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
 const {readWorldDriveReport,readRetainedWorldDriveReport,buildWorldDriveReport}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-drive-report');
 const copy=await mkdtemp(join(dir,'restart-')),caseDir=join(dir,cell,'cell/lost-ack');
 await cp(join(caseDir,'run'),copy,{recursive:true});
 const checkpoint=await read(join(copy,'run.json')),a=await readRetainedWorldAdmission(copy,checkpoint.world.snapshot.sceneDigest),identity={runId:checkpoint.runId,bootId:checkpoint.world.snapshot.bootId,publicCommittedTick:checkpoint.tick};
 const expected=(await read(join(caseDir,'report.json'))).driveEvidence;
 expect(await readWorldDriveReport(copy,a,identity)).toEqual(expected);
 const {readWorldEvidence}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-evidence');
 const {records}=await readWorldEvidence(join(copy,'world-evidence'),a),rows=structuredClone(records.slice(0,2));
 for(const field of ['jointTargets','gripperTargets','velocities'] as const)for(const duplicate of [false,true]){
  const command=structuredClone(records[1]!.command!);Object.assign(command,{[field]:duplicate?[...command[field]!,...command[field]!]:[]});rows[1]!.command=command;
  const incomplete=buildWorldDriveReport(a,rows,[]);
  expect(incomplete).toMatchObject({complete:false,ticks:1,events:[],issues:['WORLD_DRIVE_SETPOINT_INVALID']});
  expect(incomplete.axes).toHaveLength(9);expect(incomplete.axes.every(x=>!x.trackingRms.available)).toBe(true);
 }
 const manifest=await read(join(copy,'world-evidence/manifest.json'));
 await writeFile(join(copy,'world-evidence',manifest.chunks[0].path),'damaged');
 const damaged=await readWorldDriveReport(copy,a,identity);
 expect(damaged).toMatchObject({complete:false,ticks:0,events:[]});expect(damaged.issues).toContain('WORLD_EVIDENCE_HASH_MISMATCH');
 await rm(join(copy,'mujoco-world/bundle/lab-world-scene.json'));
 expect(await readRetainedWorldDriveReport(copy,{...identity,sceneDigest:checkpoint.world.snapshot.sceneDigest})).toMatchObject({complete:false,axes:[],ticks:0,issues:['WORLD_RETAINED_BUNDLE_UNAVAILABLE']});
});

test.each(['missing-header','loss-attention','foreign-world'] as const)('standalone cell verification binds the registered fault and Source run (%s)',async variant=>{
 const {verifyCellCampaign}=await import('../../packages/lab-runtime/src/v2/simulation3d/cell-campaign');
 const copy=await mkdtemp(join(dir,'cell-binding-'));await cp(join(dir,cell,'cell'),copy,{recursive:true});
 const caseDir=join(copy,'lost-ack');
 if(variant==='missing-header'){
  const path=join(copy,'campaign.json'),header=await read(path);delete header.driveExperimentId;delete header.driveProfileRegistry;delete header.hostArch;await save(path,header);
  const file=join(caseDir,'report.json'),report=await read(file);report.driveEvidence.events=[{tick:0,code:'DRIVE_FAULT'}];await save(file,report);
 }else if(variant==='loss-attention'){
  for(const name of ['run/run.json','report.json']){
   const file=join(caseDir,name),doc=await read(file);for(const a of doc.attention)if(a.reason==='WORLD_UNKNOWN')a.reason='OTHER';await save(file,doc);
  }
 }else{
  const {createHash}=await import('node:crypto'),{gunzipSync,gzipSync}=await import('node:zlib');
  const {hashJson}=await import('../../packages/lab-runtime/src/v2/hash');
  const world=join(caseDir,'run/world-evidence'),manifest=await read(join(world,'manifest.json')),trace=await read(join(caseDir,'trace.json'));
  const steps=trace.requests.filter((r:{op:string})=>r.op==='step');manifest.runId='891c3170-3213-4dfc-b9b1-39995f52606b';
  for(const ref of manifest.chunks){
   const file=join(world,ref.path),rows=gunzipSync(await readFile(file)).toString().trimEnd().split('\n').map(line=>JSON.parse(line));
   for(const row of rows){const snap=row.snapshot;snap.runId=manifest.runId;if(snap.tick)steps[snap.tick-1].responseDigest=hashJson(snap);}
   const b=gzipSync(rows.map(row=>JSON.stringify(row)+'\n').join(''));await writeFile(file,b);ref.bytes=b.length;ref.sha256=createHash('sha256').update(b).digest('hex');
  }
  await save(join(world,'manifest.json'),manifest);await save(join(caseDir,'trace.json'),trace);
 }
 const path=join(caseDir,'case.json'),rec=await read(path);rec.artifacts=await cellArtifacts(caseDir);await save(path,rec);
 const v=await verifyCellCampaign(copy,['lost-ack']);
 expect(v.completedCases).toBe(0);
 expect(v.issues).toEqual(['lost-ack:'+({'missing-header':'CELL_DRIVE_IDENTITY','loss-attention':'CELL_FAULT_CODE','foreign-world':'CELL_WORLD_RUN_BINDING'}[variant])]);
});

test('a relabelled actual baseline cannot count as an independent repeat',async()=>{
 const copy=await mkdtemp(join(dir,'duplicate-'));await cp(join(dir,repeat),copy,{recursive:true});
 const target=join(copy,repeat),rec=await read(join(target,'case.json'));
 await rm(target,{recursive:true});await cp(join(copy,'fd01-drive-torque-limited-v1-s7'),target,{recursive:true});
 rec.artifacts=await cellArtifacts(target);await save(join(target,'case.json'),rec);
 const v=await verifyCilCampaign(copy,repeat);
 expect(v.completedCases).toBe(0);expect(v.issues).toContain(repeat+':CIL_DUPLICATE_EXECUTION');
 expect(v.equivalence.some(e=>e.bitIdentical)).toBe(false);
});
test('ideal and its nested legacy comparison must name separate executions',async()=>{
 const copy=await mkdtemp(join(dir,'duplicate-legacy-'));await cp(join(dir,ideal),copy,{recursive:true});
 const run=join(copy,ideal),baseline=join(run,'baseline'),{runId}=await read(join(run,'run/run.json'));
 for(const path of ['run/run.json','report.json']){
  const file=join(baseline,path),doc=await read(file);doc.manifest.runId=runId;if(path==='run/run.json')doc.runId=runId;await save(file,doc);
 }
 const rec=await read(join(run,'case.json'));rec.artifacts=await cellArtifacts(run);await save(join(run,'case.json'),rec);
 const v=await verifyCilCampaign(copy,ideal);
 expect(v.completedCases).toBe(0);expect(v.issues).toContain(ideal+':CIL_DUPLICATE_EXECUTION');expect(v.equivalence).toEqual([]);
});
