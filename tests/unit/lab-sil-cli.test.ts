// scripts/lab-sil.mjs: doctor | run | verify with a strict argv schema. Exit 2 = prerequisite/usage missing (not_run), 1 = failed, 0 = verified.
// On a host without ROS 2/Gazebo `run` must stop at the doctor gate and write an honest not_run manifest; it never produces a pass.
import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cli=(...args:string[])=>{const r=spawnSync(process.execPath,['scripts/lab-sil.mjs',...args],{encoding:'utf8',timeout:120000});return {code:r.status,out:r.stdout,err:r.stderr};};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

test('doctor reports every prerequisite with a reason, a report digest and the pinned image; exit 0 only when all are met',()=>{
 const r=cli('doctor','--backend','gazebo_nav2','--json');
 const report=JSON.parse(r.out);
 expect(report).toMatchObject({backend:'gazebo_nav2',host:{platform:process.platform},image:{image:'ros:jazzy-ros-base',digest:expect.stringMatching(/^sha256:[0-9a-f]{64}$/)}});
 expect(report.checks.map((c:{id:string})=>c.id)).toEqual(['node24','linux','python3','python-deps','compiler','ros2','gz','image-lock']);
 expect(report.reportSha256).toMatch(/^[0-9a-f]{64}$/);
 for(const c of report.checks)expect(typeof c.ok).toBe('boolean');
 expect(r.code).toBe(report.prerequisitesMet?0:2);
 if(process.platform!=='linux')expect(report.checks.find((c:{id:string})=>c.id==='linux')).toMatchObject({ok:false});
 expect(cli('doctor','--backend','valetudo_native').code).toBe(2);
 expect(cli('doctor').code).toBe(2);
});

test('run stops at the doctor gate on a host without the simulation stack and writes a not_run manifest (never a pass)',async()=>{
 const out=await mkdtemp(join(tmpdir(),'lab-sil-'));
 const r=cli('run','--scenario','FD07','--seed','17','--repeat','3','--out',out);
 const report=JSON.parse(cli('doctor','--backend','gazebo_nav2','--json').out);
 if(!report.prerequisitesMet){
  expect(r.code).toBe(2);
  const manifest=JSON.parse(await readFile(join(out,'run-manifest.json'),'utf8'));
  expect(manifest).toMatchObject({status:'not_run',result:'blocked_external',scenarioId:'FD07',seed:17,repeat:3,backendSetId:'simulation-default'});
  expect(manifest.reasons.length).toBeGreaterThan(0);
  expect(manifest.doctor.reportSha256).toBe(report.reportSha256);
 }
 expect(cli('run','--scenario','NOPE','--seed','1','--out',out).code).toBe(2);
 expect(cli('run','--scenario','FD07','--seed','x','--out',out).code).toBe(2);
 expect(cli('run','--scenario','FD07','--seed','1','--out',out,'--shell','ls').code).toBe(2);
 expect(cli('run','--scenario','BV01','--seed','1','--out',out,'--backend-set','simulation-default').code).toBe(2);
 // a campaign is every scenario or nothing: one blocked scenario (BV01 needs linuxcnc_sim/coffee_io_sim) keeps the whole campaign not_run
 const c=cli('run','--campaign','food-beverage','--seed','23','--repeat','3','--out',join(out,'campaign'));
 expect(c.code).toBe(2);
 const campaign=JSON.parse(await readFile(join(out,'campaign','campaign-manifest.json'),'utf8'));
 expect(campaign).toMatchObject({status:'not_run',result:'blocked_external',campaignId:'food-beverage',expectedRuns:12});
 expect(campaign.scenarios.map((s:{scenarioId:string})=>s.scenarioId)).toEqual(['FD02','FD07','BV01','CAMPAIGN-FD02-FD07-BV01-BV03']);
 expect(campaign.scenarios.find((s:{scenarioId:string})=>s.scenarioId==='FD07')).toMatchObject({seed:23,repeat:3,backendSetId:'simulation-default',requiredBackends:['gazebo_nav2']});
 expect(campaign.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^PREREQUISITE_MISSING:linuxcnc_sim:/)]));
 expect(cli('run','--campaign','nope','--out',out).code).toBe(2);
 expect(cli('run','--campaign','food-beverage','--scenario','FD07','--out',out).code).toBe(2);
});

test('verify: not_run is 2, zero samples or a failed assertion or a bad hash is 1, a complete sil bundle is 0',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lab-sil-verify-'));
 const write=async(dir:string,files:Record<string,string>,manifest:Record<string,unknown>)=>{await mkdir(dir,{recursive:true});for(const [n,c] of Object.entries(files))await writeFile(join(dir,n),c);await writeFile(join(dir,'run-manifest.json'),JSON.stringify({...manifest,outputs:Object.entries(files).map(([path,c])=>({path,sha256:sha(c)}))}));};
 const files=(samples:number,pass=true)=>({'journal.json':'[]','effects.json':'[]','telemetry.json':JSON.stringify({samples:Array.from({length:samples},(_,i)=>({seq:String(i+1)}))}),'contacts.json':JSON.stringify({available:true,contacts:[]}),'assertions.json':JSON.stringify([{id:'FD07.exclusive-zone',result:pass?'pass':'fail'},{id:'SIM.no-contact',result:'pass'}])});
 const base={schemaVersion:1,runId:'r',scenario:{id:'FD07',revision:1},seed:17,evidence:'sil',status:'completed',backends:['gazebo_nav2'],world:{inputHash:'a'.repeat(64)},sourceCommit:'c',backendCapability:{available:true}};
 await write(join(root,'blocked','run-1'),files(0),{...base,status:'not_run',result:'blocked_external',evidence:'none'});
 expect(cli('verify','--input',join(root,'blocked')).code).toBe(2);
 await write(join(root,'double','run-1'),files(0),{...base,evidence:'protocol_double'});
 expect(cli('verify','--input',join(root,'double')).code).toBe(2);
 await write(join(root,'empty','run-1'),files(0),base);
 expect(cli('verify','--input',join(root,'empty')).code).toBe(1);
 await write(join(root,'failed','run-1'),files(5,false),base);
 expect(cli('verify','--input',join(root,'failed')).code).toBe(1);
 await write(join(root,'ok','run-1'),files(5),base);await write(join(root,'ok','run-2'),files(7),{...base,runId:'r2'});
 const ok=cli('verify','--input',join(root,'ok'));
 expect(ok.code).toBe(0);expect(ok.out).toContain('runs=2');
 await writeFile(join(root,'ok','run-2','telemetry.json'),'{"samples":[]}'); // tampered after the manifest
 expect(cli('verify','--input',join(root,'ok')).code).toBe(1);
 expect(cli('verify','--input',join(root,'nope')).code).toBe(2);
 // campaign layout: <scenario>/run-N under a campaign manifest with the exact expected run count and one identity per scenario
 const camp=join(root,'camp'),cm=(expectedRuns:number)=>writeFile(join(camp,'campaign-manifest.json'),JSON.stringify({schemaVersion:1,status:'completed',campaignId:'c',expectedRuns,scenarios:[{scenarioId:'FD07',seed:17,repeat:2,backendSetId:'simulation-default',requiredBackends:['gazebo_nav2']}]}));
 await write(join(camp,'FD07','run-1'),files(5),base);await write(join(camp,'FD07','run-2'),files(6),{...base,runId:'r2'});await cm(2);
 const okc=cli('verify','--input',camp);expect(okc.code).toBe(0);expect(okc.out).toContain('campaign=c runs=2/2');
 await cm(3);expect(cli('verify','--input',camp).code).toBe(1);
 await cm(2);await write(join(camp,'FD07','run-2'),files(6),{...base,runId:'r2',sourceCommit:'other'});expect(cli('verify','--input',camp).code).toBe(1);
 await writeFile(join(camp,'campaign-manifest.json'),JSON.stringify({schemaVersion:1,status:'not_run',campaignId:'c',reasons:['PREREQUISITE_MISSING:linux']}));expect(cli('verify','--input',camp).code).toBe(2);
});

test('verify requires the declared negative-case assessment, safety rows and native provenance',async()=>{
 // Serialized verifier fixtures exercise artifact validation only; these are not native execution evidence.
 const dir=await mkdtemp(join(tmpdir(),'lab-negative-verifier-')),expectation={faultId:'cut',outcome:'needs_attention',attentionReasons:['INJECTED_TUNNEL_LOSS']};
 const rows=['ARM03','SIM.engine-samples','BV01.cup-ledger','SIM.no-contact','BV01.native-verification','BV01.fault-schedule','BV01.fault-observed','BV01.expected-attention','BV01.custody-preserved','BV01.no-replay'].map(id=>({id,result:'pass'}));
 const assessment={expectation,producer:'native',businessOutcome:{status:'needs_attention',served:'0'},businessVerification:'fail',assessment:rows,result:'pass'};
 const write=async(evidence='sil',entries=rows,caseReport:unknown=assessment)=>{const files:Record<string,string>={'telemetry.json':JSON.stringify({samples:[{seq:'1'}]}),'assertions.json':JSON.stringify(entries),'fault-case-assessment.json':JSON.stringify(caseReport)};for(const [path,bytes] of Object.entries(files))await writeFile(join(dir,path),bytes);await writeFile(join(dir,'run-manifest.json'),JSON.stringify({scenario:{id:'BV01'},status:'needs_attention',evidence,nativeFaultExpectation:expectation,outputs:Object.entries(files).map(([path,bytes])=>({path,sha256:sha(bytes)}))}));};
 await write();expect(cli('verify','--input',dir).code).toBe(0);
 await write('protocol_double');expect(cli('verify','--input',dir).code).toBe(2);
 await write('sil',rows.filter(r=>r.id!=='BV01.fault-schedule'));expect(cli('verify','--input',dir).code).toBe(1);
 await write('sil',rows.filter(r=>r.id!=='BV01.no-replay'));expect(cli('verify','--input',dir).code).toBe(1);
 await write('sil',rows,{...assessment,result:'not_run'});expect(cli('verify','--input',dir).code).toBe(2);
 await write('sil',rows,{...assessment,assessment:rows.map(r=>r.id==='BV01.fault-observed'?{...r,result:'fail'}:r)});expect(cli('verify','--input',dir).code).toBe(1);
 const mixed=rows.map(r=>r.id==='SIM.no-contact'?{...r,result:'fail'}:r.id==='SIM.engine-samples'?{...r,result:'not_run'}:r);await write('sil',mixed,{...assessment,assessment:mixed,result:'fail'});expect(cli('verify','--input',dir).code).toBe(1);
 await write('sil',rows,{...assessment,expectation:{...expectation,faultId:'other'}});expect(cli('verify','--input',dir).code).toBe(1);
});
