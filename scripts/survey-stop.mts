// Survey for the stop-v1 campaign: run MJ-TRAY01 without any stop on the two cruise speeds, read where each run reaches its steady speed, and write
// fixtures/stop-v1/survey.json and campaigns/stop-v1.json from what the engine really did. Nothing is estimated.
//   pnpm exec tsx scripts/survey-stop.mts <scratch dir outside the repository>
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lockDigestOf} from '../packages/lab-runtime/src/engineering/linkforge';
import {setupTray,readTrayRun,trayCatalog,trayRuntime} from '../packages/lab-runtime/src/v2/simulation3d/tray-campaign';
import {cruiseOf,runStopCase,type StopCase} from '../packages/lab-runtime/src/v2/control/stop-campaign';
import {sourceCommit} from './repo-identity.mjs';
import type {FaultScheduleEntry} from '../packages/lab-runtime/src/v2/fault-schedule';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('usage: survey-stop.mts <scratch dir>');
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
await mkdir(out,{recursive:true});
const only=['tray-stop-brake-v1','tray-stop-slow-brake-v1'] as const;
const {service,compiled,workerRoot}=await setupTray({root:ROOT,out},only);
const ctx={service,compiled,runtime:trayRuntime(ROOT,workerRoot,await lockDigestOf(join(workerRoot,'requirements.lock'))),catalog:trayCatalog(),sourceCommit:sourceCommit(ROOT)};
const survey:Record<string,{experimentId:string;cruiseTick:number;speedMps:number;runTicks:number}>={};
for(const id of only){
 const dir=join(out,id);await runStopCase(ctx,dir,{experimentId:id,seed:7});
 const {records}=await readTrayRun(dir),c=cruiseOf(records);if(!c)throw new Error('NO_CRUISE:'+id);
 survey[id]={experimentId:id,cruiseTick:c.tick,speedMps:Math.round(c.speedMps*1000)/1000,runTicks:records.length};
}
await writeFile(join(ROOT,'robotics/simulation-mujoco/fixtures/stop-v1/survey.json'),json({schemaVersion:1,documentType:'stop-survey',note:'cruise ticks and speeds read from real MJ-TRAY01 runs without a stop; the stop of every case fires on the first tick of its cruise',seed:7,runs:survey}));
// the cases: a stop fires on the step that starts at the cruise tick (trigger ms such that ceil(ms/20)+1 = tick)
const at=(tick:number)=>(tick-1)*20;
const entry=(id:string,fn:StopCase['entry']['function'],tick:number):StopCase['entry']=>({id,function:fn,trigger:{kind:'elapsed_sim_ms',value:at(tick)}});
const cases:StopCase[]=[];
const group=(g:StopCase['group'],tag:string,brake:TrayName,coast:TrayName)=>{
 const t=survey[(brake.includes('slow')?'tray-stop-slow-brake-v1':'tray-stop-brake-v1')]!.cruiseTick;
 cases.push({id:`${tag}-normal`,group:g,experimentId:brake,seed:7,entry:entry('s1','normal',t)},{id:`${tag}-protective`,group:g,experimentId:brake,seed:7,entry:entry('s1','protective',t)},
  {id:`${tag}-emergency-coast`,group:g,experimentId:coast,seed:7,entry:entry('s1','emergency',t)},{id:`${tag}-emergency-brake`,group:g,experimentId:brake,seed:7,entry:entry('s1','emergency',t)});
};
type TrayName=StopCase['experimentId'];
group('S1','s1','tray-stop-brake-v1','tray-stop-coast-v1');group('S2','s2','tray-stop-slow-brake-v1','tray-stop-slow-coast-v1');group('S3','s3','tray-stop-low-brake-v1','tray-stop-low-coast-v1');
const t1=survey['tray-stop-brake-v1']!.cruiseTick,loss=(axis:string):FaultScheduleEntry=>({id:`loss-${axis.split('/')[1]}`,faultId:'command-loss',targetId:axis,trigger:{kind:'elapsed_sim_ms',value:at(t1)-40},durationMs:400,params:{}});
cases.push({id:'s4-emergency-brake-command-loss',group:'S4',experimentId:'tray-stop-brake-v1',seed:7,entry:entry('s1','emergency',t1),faults:[loss('amr-1/wheel-left'),loss('amr-1/wheel-right')]});
for(const n of [1,2,3])cases.push({id:`s5-emergency-coast-r${n}`,group:'S5',experimentId:'tray-stop-coast-v1',seed:7,entry:entry('s1','emergency',t1),...n>1?{repeatOf:'s5-emergency-coast-r1'}:{}});
await writeFile(join(ROOT,'robotics/simulation-mujoco/campaigns/stop-v1.json'),json({id:'stop-v1',scenarioId:'MJ-TRAY01',maxTicks:30000,note:'MJ-TRAY01 with three cups under the registered HW-C stop variants; the stop fires at the cruise tick of a survey run (fixtures/stop-v1/survey.json). Every number is assumed and not_calibrated. No threshold on distance or slip.',cases}));
console.log(JSON.stringify({survey,cases:cases.length}));
