// The worker argv/env is fixed and partitioned per run: no user string, a ROS domain and Gazebo partition derived from the run id so two runs on
// one host never share a graph, and the scenario fixture (actors/blockers/faults) only when the run has one.
import {expect,test} from 'vitest';
import {workerArgv} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {compiledWorld} from '../support/sil-rig';
const RUN='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c';
test('worker argv is fixed, scenario-aware and partitioned per run',()=>{
 const w=compiledWorld('/tmp/bundle'),a=workerArgv(w,RUN,'python3','/tmp/bundle/scenario.json'),b=workerArgv(w,RUN),c=workerArgv(w,'other-run');
 expect(a.args).toEqual(['-m','bridge.nav2_session','--bundle','/tmp/bundle','--run-id',RUN,'--robots','robot_amr_1','--state-dir','/tmp/bundle/.bridge','--scenario','/tmp/bundle/scenario.json']);
 expect(b.args).not.toContain('--scenario');
 const domain=Number(a.env.ROS_DOMAIN_ID);expect(domain).toBeGreaterThanOrEqual(1);expect(domain).toBeLessThanOrEqual(100);
 expect(a.env.GZ_PARTITION).toBe(`lab-${RUN}`);expect(b.env.ROS_DOMAIN_ID).toBe(a.env.ROS_DOMAIN_ID);
 expect(c.env.GZ_PARTITION).toBe('lab-other-run');
 expect(a.command).toBe('python3');expect(a.cwd.endsWith('robotics/simulation')||a.cwd.endsWith('robotics\\simulation')).toBe(true);
});
