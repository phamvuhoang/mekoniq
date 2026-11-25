import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {benchTarget} from '../../packages/lab-runtime/src/v2/control/bench-signals';
import {sealDriveDocument,type DriveTrace} from '../../packages/lab-runtime/src/v2/control/drive-io';
// @ts-expect-error plain ESM script without types
import {artifactDispositionsFromGroups,collectR4ArtifactDispositions} from '../../scripts/r4-readback.mjs';
// @ts-expect-error plain ESM script without types
import {qualifyR4Structure,SUITES_R4} from '../../scripts/sim-extension-r4.mjs';
import {loadCalibrationSelftestBase,writeCalibrationSelftest} from '../../scripts/r4-calibration-selftest';
import {verifyCalibrationSelftest} from '../../scripts/r4-calibration-evidence';

const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const toolClosures={portable:'e'.repeat(64),native:'a'.repeat(64)};
const workerRoot=resolve('robotics/simulation-mujoco');
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const entry='calibration-selftest.json';
const path='inputs/calibration/'+entry;
const expected={sourceCommit,toolClosures};
const arm='armatureKgM2[2]',damping='jointDynamics.damping';

test('an absent optional CAL input is not_run and a reference without payload fails',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'no-calibration-'));
 try{
  const result=await collectR4ArtifactDispositions(dir,{identity:{before:expected}});
  expect(result.artifactDispositions.CAL01).toEqual({status:'not_run',issues:['CALIBRATION_SELFTEST_MISSING']});
  const supplied=await collectR4ArtifactDispositions(dir,{identity:{before:expected},inputs:{calibrationSelftest:{file:path,sha256:'f'.repeat(64)}}});
  expect(supplied.artifactDispositions.CAL01).toEqual({status:'failed',issues:['CALIBRATION_SELFTEST_CORRUPT']});
 }finally{await rm(dir,{force:true,recursive:true});}
});

test.each([true,false])('an unreferenced calibration directory fails with entry present = %s',async includeEntry=>{
 const dir=await mkdtemp(join(tmpdir(),'unreferenced-calibration-'));
 try{
  await mkdir(join(dir,'inputs/calibration'),{recursive:true});
  if(includeEntry)await writeFile(join(dir,path),'{}');
  const result=await collectR4ArtifactDispositions(dir,{identity:{before:expected},inputs:{}});
  for(const id of ['CAL01','CAL02','CAL03','CAL04','CAL05','CAL06']){
   expect(result.artifactDispositions[id]).toEqual({status:'failed',issues:['CALIBRATION_SELFTEST_CORRUPT']});
  }
 }finally{await rm(dir,{force:true,recursive:true});}
});

test('a valid artifact alone cannot close CAL cases without green Source and Lab suite results',()=>{
 const suites=SUITES_R4.filter((s:{id:string})=>['cal-unit','cal-engine','web-cal-ui','e2e-calibration'].includes(s.id)).map((s:{id:string;repo:string;kind:string})=>({...s,exitCode:0,result:{file:'result.json',sha256:'f'.repeat(64),summary:{passed:1,failed:0,skipped:0,total:1}}}));
 const qualify=(subset:typeof suites)=>qualifyR4Structure({suites:subset,lab:true,sourceCommit,artifactDispositions:artifactDispositionsFromGroups({calibrationSelftest:[]})});
 expect(qualify(suites.filter((s:{id:string})=>s.id!=='cal-engine')).cases.CAL03.status).toBe('not_run');
 expect(qualify(suites.filter((s:{id:string})=>s.id!=='e2e-calibration')).cases.CAL06.status).toBe('not_run');
 expect(qualify(suites).gates['G-CAL1'].status).toBe('tested');
});

test('the recorder refuses an existing destination even in a dirty checkout',async()=>{
 const out=await mkdtemp(join(tmpdir(),'calibration-no-overwrite-'));
 try{
  await writeFile(join(out,'marker'),'original bytes');
  const r=spawnSync(process.execPath,['scripts/record-calibration-selftest.mjs','--out',out],{encoding:'utf8',timeout:10_000});
  expect(r.status).toBe(2);
  expect(r.stderr).toContain('OUT_EXISTS');
  expect(await readFile(join(out,'marker'),'utf8')).toBe('original bytes');
 }finally{await rm(out,{force:true,recursive:true});}
});

describe('calibration evidence',()=>{
 let dir:string,entryBytes:Buffer;
 beforeAll(async()=>{
  dir=await mkdtemp(join(tmpdir(),'calibration-reader-'));
  dir=join(dir,'inputs/calibration');
  await mkdir(join(dir,'..'));
  const base=await loadCalibrationSelftestBase(workerRoot);
  const identity={...expected,dirty:false as const,node:process.version,runtime:{engine:'mujoco_arm' as const,engineVersion:'3.17.0',lockDigest:sha(await readFile(join(workerRoot,'requirements.lock'))),pythonVersion:'3.11.9',platform:'darwin',arch:'arm64'}};
  // A separable analytical trace fixture exercises readback without launching MuJoCo in the guard suite.
  const bench=async(input:{axisId:string;signal:Parameters<typeof benchTarget>[0];physicsOverride?:Record<string,number>}):Promise<DriveTrace>=>{
   const axisId=input.axisId as DriveTrace['axisId'],delay=1,substeps=10,anchor=4,start=base.plant.start[axisId]!;
   const samples=Array.from({length:5010},(_,i)=>{
    const target=benchTarget(input.signal,start,Math.max(0,Math.floor((i-delay)/substeps)-anchor));
    const scale=0.3+0.35*(input.physicsOverride?.[damping]??1)+(axisId==='xarm-1/J3'?2.5*(input.physicsOverride?.[arm]??0.1):0);
    const actual=start+(target-start)*scale;
    return {target,actual,feedback:actual,torqueNm:0,saturated:false};
   });
   return {axisId,dtS:0.002,samples};
  };
  await writeCalibrationSelftest(dir,base,bench,identity,async()=>identity);
  entryBytes=await readFile(join(dir,entry));
 },30_000);
 afterAll(async()=>{if(dir)await rm(join(dir,'../..'),{force:true,recursive:true});});

 const verify=(digest?:string)=>verifyCalibrationSelftest(dir,expected,digest);
 const mutateFile=async(file:string,mutate:(bytes:Buffer)=>unknown,check:()=>Promise<void>)=>{
  const name=join(dir,file),original=await readFile(name),value=mutate(original),changed=typeof value==='string'?value:JSON.stringify(value)+'\n';
  const doc=JSON.parse(entryBytes.toString());
  const artifact=doc.files.find((x:{file:string})=>x.file===file);
  expect(artifact).toBeDefined();
  Object.assign(artifact,{bytes:Buffer.byteLength(changed),sha256:sha(changed)});
  try{await writeFile(name,changed);await writeFile(join(dir,entry),JSON.stringify(doc));await check();}
  finally{await writeFile(name,original);await writeFile(join(dir,entry),entryBytes);}
 };
 const mutateEntry=async(update:(doc:Record<string,unknown>)=>void,check:()=>Promise<void>)=>{
  const doc=JSON.parse(entryBytes.toString());update(doc);
  try{await writeFile(join(dir,entry),JSON.stringify(doc));await check();}
  finally{await writeFile(join(dir,entry),entryBytes);}
 };

 test('the intact trace fixture verifies through the standalone reader and R4 input adapter',async()=>{
  expect(await verify(sha(entryBytes))).toEqual([]);
  const out=await collectR4ArtifactDispositions(join(dir,'../..'),{identity:{before:expected},inputs:{calibrationSelftest:{file:path,sha256:sha(entryBytes)}}});
  for(const id of ['CAL01','CAL02','CAL03','CAL04','CAL05','CAL06'])expect(out.artifactDispositions[id]).toEqual({status:'tested',issues:[]});
 });

 test('an incorrect manifest hash, foreign Source or changed runtime closure cannot qualify',async()=>{
  expect(await verify('0'.repeat(64))).toContain('CALIBRATION_SELFTEST_CORRUPT');
  expect(await verifyCalibrationSelftest(dir,{...expected,sourceCommit:'b'.repeat(40)})).toContain('CALIBRATION_SELFTEST_TUPLE_MISMATCH');
  expect(await verifyCalibrationSelftest(dir,{...expected,toolClosures:{...toolClosures,portable:'b'.repeat(64)}})).toContain('CALIBRATION_SELFTEST_TUPLE_MISMATCH');
 });

 test.each([
  ['changed hidden value',(doc:Record<string,unknown>)=>{doc.hidden={...doc.hidden as object,[arm]:0.14};}],
  ['widened tolerance',(doc:Record<string,unknown>)=>{doc.relativeTolerance=0.1;}]
 ])('refuses a rehashed predeclaration with a %s',async(_name,change)=>{
  await mutateFile('protocol.json',bytes=>{const doc=JSON.parse(bytes.toString());change(doc);return doc;},async()=>{
   expect(await verify()).toContain('CALIBRATION_SELFTEST_PROTOCOL');
  });
 });

 test.each([
  ['wrong split',(doc:Record<string,unknown>)=>{(doc.trials as {split:string}[])[0]!.split='validation';}],
  ['foreign configuration',(doc:Record<string,unknown>)=>{doc.configDigest='a'.repeat(64);}],
  ['measured claim',(doc:Record<string,unknown>)=>{doc.sourceKind='measured';}]
 ])('refuses a rehashed sidecar with a %s',async(_name,change)=>{
  await mutateFile('sidecar.json',bytes=>{const doc=JSON.parse(bytes.toString());change(doc);return doc;},async()=>{
   expect(await verify()).toContain('CALIBRATION_SELFTEST_SIDECAR');
  });
 });

 test('refuses a rehashed dataset that differs from the imported CSVs',async()=>{
  await mutateFile('dataset.json',bytes=>({...JSON.parse(bytes.toString()),configDigest:'a'.repeat(64)}),async()=>{
   expect(await verify()).toContain('CALIBRATION_SELFTEST_DATASET');
  });
 });

 test('refuses valid CSV with a changed position even when its bytes are rehashed',async()=>{
  await mutateFile('tune-j3-step1.csv',bytes=>{
   const lines=bytes.toString().split('\n');lines[1]=lines[1]!.replace(/,[^,]+$/,',0.125');return lines.join('\n');
  },async()=>{expect(await verify()).toContain('CALIBRATION_SELFTEST_RAW_CSV:tune-j3-step1');});
 });

 test.each([
  ['accepted claim',(doc:Record<string,unknown>)=>{doc.accepted=true;},'CALIBRATION_SELFTEST_RECORD'],
  ['produced revision',(doc:Record<string,unknown>)=>{doc.produced=[{document:'drive_model',id:'calibrated',revision:2,digest:'a'.repeat(64)}];},'CALIBRATION_SELFTEST_RECORD'],
  ['out-of-tolerance fit',(doc:Record<string,unknown>)=>{(doc.fitted as {value:number}[])[0]!.value=0.16;},'CALIBRATION_SELFTEST_FIT_RECOVERY'],
  ['invented objective',(doc:Record<string,unknown>)=>{(doc.convergence as {objectiveFinal:number}).objectiveFinal=0;},'CALIBRATION_SELFTEST_FIT_REPLAY']
 ])('refuses a resealed calibration record with a %s',async(_name,change,issue)=>{
  await mutateFile('calibration-record.json',bytes=>{const doc=JSON.parse(bytes.toString());change(doc);return sealDriveDocument(doc);},async()=>{
   expect(await verify()).toContain(issue);
  });
 });

 test('refuses a reordered solver call even when the replacement trace is rehashed',async()=>{
  const next=JSON.parse(await readFile(join(dir,'fit-001.json'),'utf8'));
  await mutateFile('fit-000.json',()=>next,async()=>{
   expect(await verify()).toContain('CALIBRATION_SELFTEST_BENCH_INPUT:fit-000.json');
  });
 });

 test('refuses a missing final validation call after the artifact roster is resealed',async()=>{
  const manifest=JSON.parse(entryBytes.toString()),file='fit-'+String(manifest.fitRuns-1).padStart(3,'0')+'.json';
  const location=join(dir,file),original=await readFile(location);
  try{
   await rm(location);
   await mutateEntry(doc=>{
    doc.fitRuns=manifest.fitRuns-1;
    doc.files=(doc.files as {file:string}[]).filter(ref=>ref.file!==file);
   },async()=>{expect(await verify()).toContain('CALIBRATION_SELFTEST_FIT_TRACE_COUNT');});
  }finally{await writeFile(location,original);}
 });

 test('refuses a rehashed but fabricated successful held-out assessment',async()=>{
  await mutateFile('held-out-assessment.json',bytes=>({...JSON.parse(bytes.toString()),residuals:{}}),async()=>{
   expect(await verify()).toContain('CALIBRATION_SELFTEST_ASSESSMENT');
  });
 });

 test('refuses a manifest with a calibrated claim or traversal reference',async()=>{
  await mutateEntry(doc=>{doc.calibrated=true;},async()=>{
   expect(await verify()).toContain('CALIBRATION_SELFTEST_MANIFEST');
  });
  await mutateEntry(doc=>{(doc.files as {file:string}[])[0]!.file='../protocol.json';},async()=>{
   expect(await verify()).toContain('CALIBRATION_SELFTEST_FILE_ROSTER');
  });
 });

 test('refuses a symlink to byte-identical bench data',async()=>{
  const file=join(dir,'tune-j3-step1.csv'),original=await readFile(file),outside=join(dir,'../../outside.csv');
  try{
   await writeFile(outside,original);
   await rm(file);await symlink(outside,file);
   expect(await verify()).toContain('CALIBRATION_SELFTEST_CORRUPT:tune-j3-step1.csv');
  }finally{await rm(file);await writeFile(file,original);await rm(outside);}
 });
});
