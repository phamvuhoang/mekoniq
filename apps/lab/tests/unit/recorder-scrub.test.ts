import {expect,test} from 'vitest';
// @ts-expect-error plain ESM script
import {scrubEvidence} from '../../scripts/recorder-scrub.mjs';
const context={workspace:'/work/robot',home:'/Users/tester',node:'/opt/node24/bin/node'};
test('log and JSON evidence retain their established scrubbed marker values',()=>{
 const input='/opt/node24/bin/node /work/robot/source /Users/tester/cache /tmp/work/file /private/tmp/run/file /var/folders/xy/file sb_secret_example';
 const want='node <workspace>/source <home>/cache <tmp> <tmp> <tmp> <supabase-key>';
 expect(scrubEvidence(input,context)).toBe(want);
 expect(JSON.parse(scrubEvidence(JSON.stringify({message:input}),context,'vitest'))).toEqual({message:want});
});
test('scrubbing pytest JUnit preserves XML markup, result counts and the skipped ROS reason',()=>{
 const input=`<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="1" tests="2"><testcase classname="" name="robotics.simulation.tests.test_restaurant"><skipped message="collection skipped">('/work/robot/source/robotics/simulation/tests/test_restaurant.py', 25, 'Skipped: SKIPPED: rclpy (ROS 2 Jazzy) is not importable; Gazebo/Nav2 scenarios need Linux with ROS 2 Jazzy + Gazebo Harmonic')</skipped></testcase><testcase classname="simulation" name="model" file='/tmp/model.py'><system-out>/Users/tester/cache /tmp/work/file /private/tmp/run/file /private/var/folders/xy/file sb_secret_example eyJabcdefghijk.abcdefghijk.abcdefghijk /tmp/final</system-out></testcase></testsuite></testsuites>`;
 const stored=scrubEvidence(input,context,'junit');
 const expected=`<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="1" tests="2"><testcase classname="" name="robotics.simulation.tests.test_restaurant"><skipped message="collection skipped">('&lt;workspace&gt;/source/robotics/simulation/tests/test_restaurant.py', 25, 'Skipped: SKIPPED: rclpy (ROS 2 Jazzy) is not importable; Gazebo/Nav2 scenarios need Linux with ROS 2 Jazzy + Gazebo Harmonic')</skipped></testcase><testcase classname="simulation" name="model" file='&lt;tmp&gt;'><system-out>&lt;home&gt;/cache &lt;tmp&gt; &lt;tmp&gt; &lt;tmp&gt; &lt;supabase-key&gt; &lt;jwt&gt; &lt;tmp&gt;</system-out></testcase></testsuite></testsuites>`;
 expect(stored).toBe(expected);
 expect(stored).not.toMatch(/\/work\/robot|\/Users\/tester|\/tmp\/work|\/private\/tmp|\/var\/folders|sb_secret_example|eyJabcdefghijk/);
});
