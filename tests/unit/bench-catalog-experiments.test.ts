import {expect,test} from 'vitest';
import {loadBenchCatalog} from '../../packages/lab-runtime/src/v2/control/bench-runner';

test('the bench catalog of the real worker root lists the five R4 drive experiments and none of the R5 hardware ones',async()=>{
 const {catalog}=await loadBenchCatalog('robotics/simulation-mujoco',['MJ-BENCH-WHEEL','MJ-BENCH-ARM']) as unknown as {catalog:Record<string,{experiments:Record<string,unknown>}>};
 for(const id of ['MJ-BENCH-WHEEL','MJ-BENCH-ARM'])expect(Object.keys(catalog[id]!.experiments)).toEqual(['drive-ideal-v1','drive-nominal-v1','drive-torque-limited-v1','drive-latency-v1','drive-coarse-encoder-v1']);
});
