import {expect,test} from 'vitest';
import {STOP_CASES,stopCaseIssues} from '../../packages/lab-runtime/src/v2/control/stop-campaign';
import {buildStopReport} from '../../packages/lab-runtime/src/v2/control/stop-report';
import {TRAY_EXPERIMENTS} from '../../packages/lab-runtime/src/v2/simulation3d/tray-experiments';
import type {StopScheduleEntryV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {AXES,POLICY,decel,records} from '../support/stop-records';

const SRC={kind:'assumed' as const,documentId:'x',revision:'1',locator:'y',contentSha256:'e'.repeat(64)};
const s4=STOP_CASES.find(c=>c.group==='S4')!,s1n=STOP_CASES.find(c=>c.id==='s1-normal')!,s1e=STOP_CASES.find(c=>c.id==='s1-emergency-brake')!;
/** a run of the case as the campaign reads it back: stop applied on tick 100; command loss (when `loss`) on both wheels from `from` to `to` */
function run(spec:typeof s4,o:{loss?:{from:number;to:number|null;axes?:string[]};torque?:(t:number)=>number;experiment?:string;driveDigest?:string;manifestFaults?:unknown[]}={}){
 const fn=spec.entry.function,entry=spec.entry as StopScheduleEntryV1,recs=records({ticks:700,speed:decel,torque:o.torque??(t=>t<100?3:0),state:t=>t<100||fn==='normal'?'enabled':fn==='protective'?'disabled':'fault'});
 const receipt=(e:string,axis:string,phase:'start'|'end',tick:number)=>({entryId:e,faultId:'command-loss',targetId:axis,params:{},phase,appliedTick:tick});
 if(o.loss)for(const [k,a] of (o.loss.axes??AXES).entries()){const e=`loss-${k}`;(recs[o.loss.from] as {faultReceipts?:unknown[]}).faultReceipts=[...(recs[o.loss.from] as {faultReceipts?:unknown[]}).faultReceipts??[],receipt(e,a,'start',o.loss.from)];
  if(o.loss.to!==null)(recs[o.loss.to] as {faultReceipts?:unknown[]}).faultReceipts=[...(recs[o.loss.to] as {faultReceipts?:unknown[]}).faultReceipts??[],receipt(e,a,'end',o.loss.to)];}
 const report=buildStopReport({runId:'r',entry,intents:[{tick:100,intents:[{entryId:entry.id,function:fn,appliedBy:fn==='emergency'?'worker':'controller',targetTick:100}]}],
  receipts:[{entryId:entry.id,function:fn,appliedBy:fn==='emergency'?'worker':'controller',appliedTick:100,runId:'r',bootId:'b',sceneDigest:'a'.repeat(64),requestDigest:'b'.repeat(64)}],records:recs,policy:POLICY,chainAxes:AXES,wheelRadiusM:0.1,
  attention:fn==='normal'?[]:[{tick:100,reason:fn==='protective'?'PROTECTIVE_STOP':'EMERGENCY_STOP'}],served:'0',status:'needs_attention',servedAfterStop:false,decidingParameters:[{id:'onDisable',value:'brake',source:SRC}]});
 const exp=TRAY_EXPERIMENTS[spec.experimentId];
 return {report,records:recs,chainAxes:AXES,experiment:{id:o.experiment??spec.experimentId,driveExperimentId:exp.driveExperimentId},driveModelDigest:o.driveDigest??'d'.repeat(64),
  manifest:{driveFaultSchedule:(o.manifestFaults??spec.faults)?{entries:(o.manifestFaults??spec.faults) as never}:undefined,drive:{experimentId:exp.driveExperimentId,driveModelDigest:'d'.repeat(64)}}};
}

test('a genuine S4 run: the stop lands inside a command loss on both wheels, every emergency invariant passes',()=>{
 expect(stopCaseIssues(s4,run(s4,{loss:{from:98,to:118}}))).toEqual([]);
 expect(stopCaseIssues(s4,run(s4,{loss:{from:98,to:null}}))).toEqual([]);                    // a loss still open at the end of the run covers the stop
});
test('an S4 run that stops correctly but has no command loss on the stop tick is rejected',()=>{
 expect(stopCaseIssues(s4,run(s4))).toEqual(['STOP_S4_NO_COMMAND_LOSS:amr-1/wheel-left','STOP_S4_NO_COMMAND_LOSS:amr-1/wheel-right']);
 expect(stopCaseIssues(s4,run(s4,{loss:{from:60,to:90}}))).toContain('STOP_S4_NO_COMMAND_LOSS:amr-1/wheel-left');          // over before the stop
 expect(stopCaseIssues(s4,run(s4,{loss:{from:101,to:130}}))).toContain('STOP_S4_NO_COMMAND_LOSS:amr-1/wheel-left');        // starts after the stop
 expect(stopCaseIssues(s4,run(s4,{loss:{from:98,to:100}}))).toContain('STOP_S4_NO_COMMAND_LOSS:amr-1/wheel-left');         // ends on the stop tick
 expect(stopCaseIssues(s4,run(s4,{loss:{from:98,to:118,axes:[AXES[0]!]}}))).toEqual(['STOP_S4_NO_COMMAND_LOSS:amr-1/wheel-right']);
});
test('the manifest must carry exactly the case\'s fault schedule, and a case without faults none',()=>{
 expect(stopCaseIssues(s4,run(s4,{loss:{from:98,to:118},manifestFaults:[]}))).toContain('STOP_FAULTS_NOT_THE_CASES');
 expect(stopCaseIssues(s1e,run(s1e,{manifestFaults:s4.faults!}))).toContain('STOP_FAULTS_NOT_THE_CASES');
});
test('the experiment and drive model that ran must be the case\'s and the bundle\'s',()=>{
 expect(stopCaseIssues(s1e,run(s1e,{experiment:'tray-stop-coast-v1'}))).toContain('STOP_EXPERIMENT_NOT_THE_BUNDLE');
 expect(stopCaseIssues(s1e,run(s1e,{driveDigest:'f'.repeat(64)}))).toContain('STOP_DRIVE_MODEL_NOT_THE_BUNDLE');
});
test('every invariant mandatory for the function must pass; not_evidenced is an issue, not a pass',()=>{
 expect(stopCaseIssues(s1n,run(s1n))).toEqual([]);expect(stopCaseIssues(s1e,run(s1e))).toEqual([]);
 const short=run(s1e);short.report.invariants[0]={...short.report.invariants[0]!,result:'not_evidenced'};
 expect(stopCaseIssues(s1e,short)).toEqual(['STOP_ORACLE:TORQUE_ZERO_AT_EMERGENCY:not_evidenced']);
 expect(stopCaseIssues(s1e,run(s1e,{torque:t=>t===150?1:t<100?3:0}))).toEqual(['STOP_ORACLE:TORQUE_ZERO_AT_EMERGENCY:violated']);
});
