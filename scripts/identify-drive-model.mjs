#!/usr/bin/env node
// node scripts/identify-drive-model.mjs --plan FILE --dataset FILE --sidecar FILE --out NEW-DIR [--control FILE] [--tool-self-test]
// node scripts/identify-drive-model.mjs --config-digest AXIS_ID         (prints the configuration digest the current plant gives that axis: what a measured dataset must declare)
// Exit 0: the record passed and a NEW revision was written into --out. 1: the record did not pass (it is still written, with the reason codes; no revision exists). 2: a missing input, bad usage, an existing --out, or no MuJoCo.
// R4-C step 5 (V15). Runs the bench in this process on the pinned MuJoCo; never writes into the fixtures; the base documents are the ones the plan's digest names.
import {mkdir,mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {tsImport} from 'tsx/esm/api';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),missing=code=>{console.error(code);process.exit(2);};
const args=process.argv.slice(2),opt={},flags=new Set();
for(let i=0;i<args.length;i++){const k=args[i];if(k==='--tool-self-test'){flags.add(k);continue;}if(!['--plan','--dataset','--sidecar','--out','--control','--config-digest'].includes(k)||!args[i+1]||args[i+1].startsWith('--')||opt[k])missing('usage: identify-drive-model.mjs --plan F --dataset F --sidecar F --out NEW-DIR [--control F] [--tool-self-test] | --config-digest AXIS_ID');opt[k]=args[++i];}
const workerRoot=resolve(root,'robotics/simulation-mujoco'),python=resolve(root,'.venv-mujoco/bin/python');
if(spawnSync(python,['-c','import mujoco; assert mujoco.__version__ == "3.17.0"'],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000}).status!==0)missing('MUJOCO_PREREQUISITE_MISSING');
const ts=f=>tsImport(f,import.meta.url);
const [{mujocoFromOptions},{benchPlant,createHeadlessBench},{calibrationConfigDigest},ident,{readXArmFixture}]=await Promise.all([ts('../packages/lab-runtime/src/v2/simulation3d/mujoco.ts'),ts('../packages/lab-runtime/src/v2/control/bench-runner.ts'),ts('../packages/lab-runtime/src/engineering/bench-prediction.ts'),ts('../packages/lab-runtime/src/engineering/identification.ts'),ts('../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene.ts')]);
const scenarioOf=axisId=>axisId.startsWith('amr-1/')?{scenarioId:'MJ-BENCH-WHEEL',axis:'wheels'}:{scenarioId:'MJ-BENCH-ARM',axis:axisId.split('/')[1]};
const configOf=async axisId=>{const p=await benchPlant(workerRoot,{...scenarioOf(axisId),driveExperimentId:'drive-nominal-v1'});return calibrationConfigDigest({plantModelDigest:p.plantModelDigest,load:p.load,axisIds:[axisId]});};
if(opt['--config-digest']){console.log(await configOf(opt['--config-digest']));process.exit(0);}
if(!opt['--plan']||!opt['--dataset']||!opt['--sidecar']||!opt['--out'])missing('usage: identify-drive-model.mjs --plan F --dataset F --sidecar F --out NEW-DIR');
const out=resolve(opt['--out']);
if(await stat(out).then(()=>true,()=>false))missing(`OUT_EXISTS: ${opt['--out']}`);
const json=async f=>{try{return JSON.parse(await readFile(resolve(f),'utf8'));}catch{return missing(`INPUT_UNREADABLE: ${f}`);}};
const [plan,dataset,sidecar]=await Promise.all([json(opt['--plan']),json(opt['--dataset']),json(opt['--sidecar'])]);
// the base drive model is the registered document whose digest the plan names; the control profile is the one that ran on the device (default: the registry's profile of that plant)
const driveDir=join(workerRoot,'fixtures/drive-v1');let driveModel;
for(const f of await readdir(driveDir))if(/drive-.*-v\d+\.json$/.test(f)){const d=JSON.parse(await readFile(join(driveDir,f),'utf8'));if(d.documentType==='drive-model'&&d.digest===plan.baseDriveModelDigest)driveModel=d;}
if(!driveModel)missing('BASE_MODEL_NOT_FOUND');
const arm=driveModel.axes.some(a=>a.axisId.startsWith('xarm-1/')),control=await json(opt['--control']??join(driveDir,arm?'xarm6-control-v1.json':'serve-control-v2.json'));
const axisIds=[...new Set(sidecar.trials?.map(t=>t.axisId))];if(axisIds.length!==1)missing('ONE_AXIS_PER_DATASET');
const probe=await mkdtemp(join(tmpdir(),'identify-probe-'));
try{
 const p=await mujocoFromOptions({enabled:true,python,workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:probe,bundleFile:async()=>{throw Error('NO_BUNDLE');}});
 if(!p.arm.runtime)missing(`MUJOCO_PREREQUISITE_MISSING: ${p.arm.capability.reason}`);
 const models={driveModel,control,configDigest:await configOf(axisIds[0]),...arm?{physics:readXArmFixture(workerRoot).physics}:{}};
 let record;
 try{record=await ident.identify(plan,dataset,sidecar,models,createHeadlessBench(p.arm.runtime),{toolSelfTest:flags.has('--tool-self-test')});}
 catch(e){console.error(e.message);process.exit(2);}
 await mkdir(out,{recursive:true});
 if(record.produced.length){await ident.writeCalibratedRevision(record,{driveModel,...arm?{physics:models.physics}:{}},out);}
 else await ident.writeCalibrationRecord(record,join(out,'calibration-record.json'));
 console.log(JSON.stringify({out,produced:record.produced,reasonCodes:record.reasonCodes,validation:record.validation.status,fitted:record.fitted.map(f=>({path:f.path,value:f.value,atBound:f.atBound}))}));
 process.exitCode=record.produced.length?0:1;
}finally{await rm(probe,{recursive:true,force:true});}
