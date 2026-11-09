// A step loop that makes no progress is a hang in a 600 s test (seen in a C03 recording: IR04/IR09 past their timeouts). finish() turns it into a fast, named failure.
import {expect,test} from 'vitest';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {finish} from '../support/irsim-mission';

const stuck=()=>{const view={tick:40,run:{status:'running',runRevision:3},attention:[{code:'WAITING_FOR_NOTHING'}]};
 return {snapshot:async()=>view,action:async()=>view} as unknown as ScenarioRun;};
const advancing=()=>{let tick=0;const view=()=>({tick,run:{status:tick>=50?'completed':'running',runRevision:1}});
 return {snapshot:async()=>view(),action:async()=>{tick+=25;return view();}} as unknown as ScenarioRun;};

test('finish throws RUN_STALLED with the snapshot when a step advances neither tick nor status',async()=>{
 await expect(finish(stuck(),25)).rejects.toThrow(/RUN_STALLED at tick 40: running .*WAITING_FOR_NOTHING/);
});
test('finish returns the terminal view once the run leaves running',async()=>{
 expect(await finish(advancing(),25)).toMatchObject({tick:50,run:{status:'completed'}});
});
