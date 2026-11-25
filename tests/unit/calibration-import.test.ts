import {spawnSync} from 'node:child_process';
import {copyFile,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,test} from 'vitest';
import {assessCalibration} from '../../packages/lab-runtime/src/engineering/calibration';
import {CALIBRATION_LOG_LIMITS,benchBindingDigest,importCalibrationLog,parseCalibrationCsv,sidecarMatchesDataset,type CalibrationSidecar} from '../../packages/lab-runtime/src/engineering/calibration-import';

const FIXTURE=join(__dirname,'../fixtures/calibration');
const fixtureText=(file:string)=>readFile(join(FIXTURE,file),'utf8');
const sidecar=async():Promise<CalibrationSidecar>=>JSON.parse(await fixtureText('sidecar.json'));
const read=(files:Record<string,string>)=>async(file:string)=>{const t=files[file];if(t===undefined)throw Error('ENOENT');return t;};
const fromFixture=async()=>{const s=await sidecar();return {s,files:Object.fromEntries(await Promise.all(s.trials.map(async t=>[t.file,await fixtureText(t.file)])))};};

describe('parseCalibrationCsv',()=>{
 test('a log whose clock does not strictly increase is refused, not reordered',()=>{
  const csv='time_ns,command,position\n0,0,0\n2000000,1,0.001\n2000000,1,0.002\n';
  expect(parseCalibrationCsv(csv,['command','position'])).toEqual({ok:false,issues:['TIME_NOT_MONOTONIC']});
  expect(parseCalibrationCsv('time_ns,command\n2,0\n1,0\n',['command'])).toEqual({ok:false,issues:['TIME_NOT_MONOTONIC']});
 });
 test('a declared channel that is missing from the file is named',()=>{
  expect(parseCalibrationCsv('time_ns,command\n0,0\n',['command','position'])).toEqual({ok:false,issues:['CHANNEL_MISSING:position']});
 });
 test('a column nobody declared is refused: its unit would be unknown',()=>{
  expect(parseCalibrationCsv('time_ns,command,extra\n0,0,1\n',['command'])).toEqual({ok:false,issues:['CHANNEL_UNDECLARED:extra']});
 });
 test('empty, NaN and infinite cells are VALUE_INVALID; a clock that is not an integer is too',()=>{
  for(const cell of ['','NaN','inf','-Infinity','1e999','abc'])expect(parseCalibrationCsv(`time_ns,command\n0,${cell}\n`,['command']),cell).toEqual({ok:false,issues:['VALUE_INVALID']});
  expect(parseCalibrationCsv('time_ns,command\n0.5,1\n',['command'])).toEqual({ok:false,issues:['VALUE_INVALID']});
  expect(parseCalibrationCsv('time_ns,command\n0,1,2\n',['command'])).toEqual({ok:false,issues:['VALUE_INVALID']});
 });
 test('the first column must be time_ns, and a file with no rows is refused',()=>{
  expect(parseCalibrationCsv('t,command\n0,1\n',['command'])).toEqual({ok:false,issues:['HEADER_INVALID']});
  expect(parseCalibrationCsv('time_ns,command\n',['command'])).toEqual({ok:false,issues:['LOG_EMPTY']});
 });
 test('the row cap is the dataset schema\'s, and the byte cap is 16 MiB',()=>{
  const rows=(n:number)=>'time_ns,c\n'+Array.from({length:n},(_,i)=>`${i},0\n`).join('');
  expect(parseCalibrationCsv(rows(CALIBRATION_LOG_LIMITS.rows),['c']).ok).toBe(true);
  expect(parseCalibrationCsv(rows(200_001),['c'])).toEqual({ok:false,issues:['LOG_TOO_LARGE']});
  expect(parseCalibrationCsv(rows(CALIBRATION_LOG_LIMITS.rows+1),['c'])).toEqual({ok:false,issues:['LOG_TOO_LARGE']});
  expect(parseCalibrationCsv('time_ns,c\n0,'+'1'.repeat(CALIBRATION_LOG_LIMITS.bytes)+'\n',['c'])).toEqual({ok:false,issues:['LOG_TOO_LARGE']});
 });
 test('values are read as written: no reordering, no interpolation, CRLF tolerated',()=>{
  expect(parseCalibrationCsv('time_ns,command,position\r\n0,0,0.5\r\n2000000,1,1e-3\r\n',['command','position'])).toEqual({ok:true,timesNs:[0,2000000],channels:{command:[0,1],position:[0.5,0.001]}});
 });
});

describe('importCalibrationLog',()=>{
 test('the labelled synthetic fixture becomes a dataset the existing schema accepts, and assessCalibration still refuses to call it measured',async()=>{
  const {s,files}=await fromFixture(),r=await importCalibrationLog(s,read(files));
  expect(r.ok,JSON.stringify(r)).toBe(true);if(!r.ok)return;
  expect(r.dataset).toMatchObject({sourceKind:'synthetic',configDigest:s.configDigest,clockMapping:{domain:s.clockDomain,offsetNs:s.clockOffsetNs}});
  expect(r.dataset.trials.map(t=>[t.trialId,t.split])).toEqual(s.trials.map(t=>[t.trialId,t.split]));
  expect(r.dataset.rawDigest).toMatch(/^[0-9a-f]{64}$/);
  const result=assessCalibration(r.dataset,{configDigest:s.configDigest,clockDomain:s.clockDomain,units:s.units,trials:r.dataset.trials.map(t=>({trialId:t.trialId,timesNs:t.timesNs,channels:t.channels}))});
  expect(result.reasons).toEqual(['MEASURED_DATA_REQUIRED']);
 });
 test('the raw digest is a function of the raw bytes: one changed cell changes it',async()=>{
  const {s,files}=await fromFixture(),a=await importCalibrationLog(s,read(files));
  const f=s.trials[0]!.file,b=await importCalibrationLog(s,read({...files,[f]:files[f]!.replace(/\n(\d+),/,'\n$1,'+'0')}));
  expect(a.ok&&b.ok&&a.dataset.rawDigest!==b.dataset.rawDigest).toBe(true);
 });
 test('R02: the identity of the data covers the bench each file was recorded under: another signal or axis is another raw digest, and a sidecar agrees with its dataset only trial for trial',async()=>{
  const {s,files}=await fromFixture(),a=await importCalibrationLog(s,read(files));
  const sig=await importCalibrationLog({...s,trials:s.trials.map((t,i)=>i===0?{...t,signal:{...(t.signal as {kind:'step';amplitude:number;atTick:number}),amplitude:0.0123}}:t)},read(files));
  const axis=await importCalibrationLog({...s,trials:s.trials.map((t,i)=>i===0?{...t,axisId:'xarm-1/J2'}:t)},read(files));
  expect(a.ok&&sig.ok&&axis.ok).toBe(true);if(!(a.ok&&sig.ok&&axis.ok))return;
  expect(new Set([a.dataset.rawDigest,sig.dataset.rawDigest,axis.dataset.rawDigest]).size).toBe(3);
  expect(sidecarMatchesDataset(s,a.dataset)).toBe(true);expect(sidecarMatchesDataset({...s,trials:[...s.trials].reverse()},a.dataset)).toBe(false);expect(sidecarMatchesDataset({...s,configDigest:'0'.repeat(64)},a.dataset)).toBe(false);
  expect(benchBindingDigest(s)).not.toBe(benchBindingDigest(sig.sidecar));
 });
 test('a file path that leaves the log directory is rejected before anything is read',async()=>{
  const {s,files}=await fromFixture();
  for(const bad of ['../x.csv','/etc/passwd','a/../../b.csv','C:\\x.csv','a\\b.csv','','x\0.csv']){
   const r=await importCalibrationLog({...s,trials:[{...s.trials[0]!,file:bad}]},async()=>{throw Error('READ_CALLED');});
   expect(r,bad).toEqual({ok:false,issues:['LOG_PATH_REJECTED']});
  }
  void files;
 });
 test('measured data needs an attestation, and a generated file can never be called measured',async()=>{
  const {s,files}=await fromFixture(),measured={...s,sourceKind:'measured' as const};
  const noAttest={...measured};delete noAttest.generator;
  expect(await importCalibrationLog(noAttest,read(files))).toEqual({ok:false,issues:['ATTESTATION_REQUIRED']});
  const attestation={operator:'op',instrument:'enc-1',recordedAt:'2026-11-22T00:00:00Z'};
  expect(await importCalibrationLog({...measured,attestation},read(files))).toEqual({ok:false,issues:['GENERATED_DATA_NOT_MEASURED']});
  const clean={...noAttest,attestation},ok=await importCalibrationLog(clean,read(files));
  expect(ok.ok&&ok.dataset.sourceKind).toBe('measured');
  expect(await importCalibrationLog({...clean,attestation:{...attestation,operator:''}},read(files))).toEqual({ok:false,issues:['ATTESTATION_REQUIRED']});
 });
 test('a channel with no unit and a policy channel with no uncertainty are named; nothing is converted',async()=>{
  const {s,files}=await fromFixture(),units={...s.units};delete units.position;
  expect(await importCalibrationLog({...s,units},read(files))).toEqual({ok:false,issues:['UNIT_MISSING:position']});
  const uncertainty={...s.uncertainty};delete uncertainty.position;
  expect(await importCalibrationLog({...s,uncertainty},read(files))).toEqual({ok:false,issues:['UNCERTAINTY_MISSING:position']});
 });
 test('a trial id used twice (across or inside a split) is CALIBRATION_SPLIT_LEAKAGE',async()=>{
  const {s,files}=await fromFixture(),t=s.trials;
  const dup=[t[0]!,{...t[1]!,trialId:t[0]!.trialId,split:'validation' as const}];
  expect(await importCalibrationLog({...s,trials:dup},read(files))).toEqual({ok:false,issues:['CALIBRATION_SPLIT_LEAKAGE']});
 });
 test('a bad file is named with its file, the others still reported; an unreadable file is LOG_UNREADABLE',async()=>{
  const {s,files}=await fromFixture(),first=s.trials[0]!.file,second=s.trials[1]!.file,third=s.trials[2]!.file;
  const r=await importCalibrationLog(s,read({...files,[first]:'time_ns,command,position\n0,0,0\n0,1,1\n',[second]:'time_ns,command\n0,0\n'}));
  expect(r).toEqual({ok:false,issues:[`${first}:TIME_NOT_MONOTONIC`,`${second}:CHANNEL_MISSING:position`]});
  const {[third]:_gone,...rest}=files;void _gone;
  expect(await importCalibrationLog(s,read(rest))).toEqual({ok:false,issues:[`${third}:LOG_UNREADABLE`]});
 });
 test('a sidecar that is not an object of the declared shape is refused with a code, not a throw',async()=>{
  for(const bad of [null,'x',[],{},{sourceKind:'measured'}])expect((await importCalibrationLog(bad,async()=>'')).ok).toBe(false);
  const {s}=await fromFixture();
  expect(await importCalibrationLog({...s,trials:[]},async()=>'')).toEqual({ok:false,issues:['SIDECAR_INVALID']});
  expect((await importCalibrationLog({...s,sourceKind:'simulated'},async()=>'')).ok).toBe(false);
 });
});

describe('scripts/import-calibration-log.mjs',()=>{
 const script=join(__dirname,'../../scripts/import-calibration-log.mjs'),run=(...a:string[])=>spawnSync(process.execPath,[script,...a],{encoding:'utf8'});
 test('exit 0 writes the dataset once; 1 names the bad file; 2 for a missing sidecar, an existing output or bad usage',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cal-import-'));
  try{
   const sc=join(FIXTURE,'sidecar.json'),out=join(dir,'ds.json');
   expect(run('--sidecar',sc,'--out',out).status).toBe(0);
   expect(JSON.parse(await readFile(out,'utf8'))).toMatchObject({schemaVersion:1,sourceKind:'synthetic'});
   expect(run('--sidecar',sc,'--out',out)).toMatchObject({status:2,stderr:expect.stringContaining('OUT_EXISTS')});
   expect(run('--sidecar',join(dir,'none.json'),'--out',join(dir,'x.json')).status).toBe(2);expect(run().status).toBe(2);
   const s=await sidecar();await writeFile(join(dir,'sidecar.json'),JSON.stringify(s));
   for(const t of s.trials)await copyFile(join(FIXTURE,t.file),join(dir,t.file));
   await writeFile(join(dir,s.trials[1]!.file),'time_ns,command,position\n0,0,0\n0,1,1\n');
   expect(run('--sidecar',join(dir,'sidecar.json'),'--out',join(dir,'y.json'))).toMatchObject({status:1,stderr:`${s.trials[1]!.file}:TIME_NOT_MONOTONIC\n`});
  }finally{await rm(dir,{recursive:true,force:true});}
 },60_000);
});
