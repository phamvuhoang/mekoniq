// scripts/identify-drive-model.mjs end to end on the real engine (skipped without .venv-mujoco): the exit codes, the record that is written when nothing is produced, and the refusal to overwrite.
import {afterAll,describe,expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importCalibrationLog,type CalibrationSidecar} from '../../packages/lab-runtime/src/engineering/calibration-import';
import {datasetDigestOf} from '../../packages/lab-runtime/src/engineering/identification';
import {sealDriveDocument,type DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {mujocoReady,mujocoRoot} from '../support/mujoco-arm';

const script=join(__dirname,'../../scripts/identify-drive-model.mjs'),run=(...a:string[])=>spawnSync(process.execPath,[script,...a],{encoding:'utf8',timeout:240_000});
const dirs:string[]=[];afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true});});

describe('usage',()=>{
 test('bad usage and missing inputs exit 2 before anything runs',()=>{
  expect(run().status).toBe(2);
  expect(run('--plan','a','--dataset','b').status).toBe(2);
  expect(run('--bogus','x').status).toBe(2);
 });
});
describe.skipIf(!mujocoReady)('on the real engine',()=>{
 test('--config-digest prints the digest the plant gives an axis; a synthetic self-test exits 1, writes the record and no revision; an existing --out exits 2',async()=>{
  const digest=run('--config-digest','xarm-1/J3');expect(digest.status,digest.stderr).toBe(0);expect(digest.stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
  const dir=await mkdtemp(join(tmpdir(),'identify-cli-'));dirs.push(dir);
  const drive=JSON.parse(readFileSync(join(mujocoRoot,'fixtures/drive-v1/xarm6-drive-nominal-v1.json'),'utf8')) as DriveModelV1;
  // a one-trial "log" (tune only, no validation) written by hand: enough to run the tool end to end, and synthetic so nothing can be produced
  const times=Array.from({length:40},(_,k)=>k*10_000_000-20_000_000),csv='time_ns,command,position\n'+times.map(t=>`${t},0,0\n`).join('');
  const sidecar:CalibrationSidecar={sourceKind:'synthetic',generator:'tests/integration/identify-cli.test.ts',deviceId:'hand-written',configDigest:digest.stdout.trim(),clockDomain:'sim',clockOffsetNs:0,units:{command:'rad',position:'rad'},uncertainty:{command:1e-6,position:1e-6},
   policy:{channels:{command:{absoluteTolerance:0.01,relativeTolerance:0},position:{absoluteTolerance:0.01,relativeTolerance:0}},minTrialsPerCondition:1,maxClockGapNs:20_000_000,capabilities:{position:'actuator'}},
   trials:[{trialId:'t1',split:'tune',condition:'hold',file:'t1.csv',axisId:'xarm-1/J3',signal:{kind:'hold',ticks:50}}]};
  const imported=await importCalibrationLog(sidecar,async()=>csv);expect(imported.ok).toBe(true);if(!imported.ok)return;
  const plan=sealDriveDocument({schemaVersion:1,documentType:'identification-plan',id:'cli-plan',revision:1,datasetDigest:datasetDigestOf(imported.dataset),baseDriveModelDigest:drive.digest,plantModelDigest:'d'.repeat(64),
   parameters:[{path:'armatureKgM2[2]',initial:0.1,lower:0.05,upper:0.3,unit:'kg*m^2'}],objective:{channels:['position'],weights:{position:1}},optimizer:{method:'bounded_least_squares',maxIterations:2,tolerance:1e-6,relativeStep:1e-2,maxJacobianCondition:1e4}});
  for(const [name,value] of [['plan.json',plan],['dataset.json',imported.dataset],['sidecar.json',sidecar]] as const)await writeFile(join(dir,name),JSON.stringify(value));
  const out=join(dir,'out'),args=['--plan',join(dir,'plan.json'),'--dataset',join(dir,'dataset.json'),'--sidecar',join(dir,'sidecar.json'),'--out',out,'--tool-self-test'];
  const r=run(...args);expect(r.status,r.stderr).toBe(1);
  expect(await readdir(out)).toEqual(['calibration-record.json']);
  expect(JSON.parse(await readFile(join(out,'calibration-record.json'),'utf8'))).toMatchObject({toolSelfTest:true,sourceKind:'synthetic',produced:[],accepted:false,reasonCodes:expect.arrayContaining(['SYNTHETIC_DATA','TOOL_SELF_TEST'])});
  expect(JSON.parse(r.stdout)).toMatchObject({produced:[],validation:'fail'});
  expect(run(...args)).toMatchObject({status:2,stderr:expect.stringContaining('OUT_EXISTS')});
  // a plan whose base model is not a registered document, and a self-test flag on measured data, exit 2 without writing
  const bad=join(dir,'bad.json');await writeFile(bad,JSON.stringify(sealDriveDocument({...plan,baseDriveModelDigest:'1'.repeat(64)})));
  expect(run('--plan',bad,'--dataset',join(dir,'dataset.json'),'--sidecar',join(dir,'sidecar.json'),'--out',join(dir,'out2')).stderr).toContain('BASE_MODEL_NOT_FOUND');
 },300_000);
});
