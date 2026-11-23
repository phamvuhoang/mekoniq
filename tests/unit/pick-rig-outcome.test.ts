import {expect,test} from 'vitest';
import {rigReportFacts} from '../../packages/lab-runtime/src/v2/perception/pick-rig';
import type {RigReport} from '../../packages/lab-runtime/src/v2/perception/pick-rig-evidence';
import type {ArmPlantState} from '../../packages/cell-adapters/src/mock-arm';
function fixture(){
 const transfer={commandId:'pick-1',payloadHash:'h',controlEpoch:1,transferId:'cup-1:pick'};
 const report={manifest:{clock:{businessEpochMs:0,tickMs:20}},outcome:{tick:15,status:'needs_attention',served:'0'},coffee:{armTrace:{stop:{reason:'CUP_DROPPED'}},cellEffects:[{payload:{...transfer,cupId:'cup-1',programRef:{id:'cup-pick'}}}]},businessEvents:[{type:'CupTransferObserved',kind:'cup',id:'cup-1',at:new Date(200).toISOString(),state:{pendingTransfer:{...transfer,lastResult:'completed'}}}]} as unknown as RigReport;
 const arm={programs:[{...transfer,program:'cup-pick',state:'completed',accepted:{accepted:true,unknown:false},evidence:{objectPresent:true,liftPoseReached:true,cupId:'cup-1'}},{commandId:'place-1',program:'cup-place',state:'unknown',evidence:{stopReason:'CUP_DROPPED'}}]} as unknown as ArmPlantState;
 return {report,arm};
}
test('a completed first pick remains lifted when a different place command drops the cup later',()=>{
 const {report,arm}=fixture();expect(rigReportFacts(report,arm)).toMatchObject({fixedOutcome:'lifted',endpointTick:10});
});
test('served counts and a global stop never replace the first pick receipt or observations',()=>{
 const {report,arm}=fixture();report.outcome.served='1';arm.programs[0]!.evidence={source:'mujoco_arm'};expect(rigReportFacts(report,arm).fixedOutcome).toBe('unknown');
 report.businessEvents=[];expect(()=>rigReportFacts(report,arm)).toThrow('RIG_PICK_RECEIPT_MISSING');
});
test('only a known empty grip is a miss; missing observation is unknown',()=>{
 const {report,arm}=fixture();arm.programs[0]!.evidence={source:'mujoco_arm',objectPresent:false};expect(rigReportFacts(report,arm).fixedOutcome).toBe('grip_not_established');
 arm.programs[0]!.evidence={source:'mujoco_arm',liftPoseReached:false};expect(rigReportFacts(report,arm).fixedOutcome).toBe('unknown');
});
test.each(['command','receipt','accepted'])('a mismatched %s cannot become a successful first pick',what=>{
 const {report,arm}=fixture();if(what==='command')arm.programs[0]!.payloadHash='other';if(what==='receipt')(report.businessEvents[0]!.state.pendingTransfer as Record<string,unknown>).payloadHash='other';if(what==='accepted')arm.programs[0]!.accepted.accepted=false;
 expect(()=>rigReportFacts(report,arm)).toThrow(/RIG_PICK_(COMMAND|RECEIPT)_MISMATCH/);
});
