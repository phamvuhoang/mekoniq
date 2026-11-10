import { expect, test } from 'vitest';
import { poseTraceDifference } from '../../packages/lab-runtime/src/v2/navigation2d/batch';

// a trace is x,y,yaw per robot per tick, flattened
test('review R1 #7: yaw +pi and -pi are the same heading, so a robot driving along -x does not fail REPEATABLE on a 1e-12 rad jitter', () => {
  const a = [1, 0, Math.PI - 1e-12], b = [1, 0, -Math.PI + 1e-12];
  expect(poseTraceDifference(a, b)).toBeLessThan(1e-9);
});
test('review R1 #7: a real difference in x, y or yaw is still the worst difference', () => {
  expect(poseTraceDifference([0, 0, 0], [0.002, 0, 0])).toBeCloseTo(0.002, 12);
  expect(poseTraceDifference([0, 0, 0], [0, 0, 0.3])).toBeCloseTo(0.3, 12);
  expect(poseTraceDifference([0, 0, 3], [0, 0, -3])).toBeCloseTo(2 * Math.PI - 6, 12);
});

import { enginePids } from '../../packages/lab-runtime/src/v2/navigation2d/batch';
test("review R1 #9: only the Webots engine whose world is in this run's directory counts, so another open Webots (or a path with spaces) cannot fail the engine-kill rig", () => {
  const ps = [
    '  101 /Applications/Webots.app/Contents/MacOS/webots --batch --port=1 /tmp/my dir/run-a/run/worker/world.wbt',
    '  202 /Applications/Webots.app/Contents/MacOS/webots',                         // someone\'s own Webots GUI
    '  303 /Applications/Webots.app/Contents/MacOS/webots --batch --port=2 /tmp/other/run/worker/world.wbt',
    '  404 /bin/sh -c echo /Applications/Webots.app/Contents/MacOS/webots /tmp/my dir/run-a/run/world.wbt',
  ].join('\n');
  expect(enginePids(ps, '/tmp/my dir/run-a/run')).toEqual([101]);
  expect(enginePids('', '/x')).toEqual([]);
  // the install itself under a path with spaces
  expect(enginePids('  505 /Users/me/My Apps/Webots.app/Contents/MacOS/webots --batch /tmp/r/run/w/world.wbt', '/tmp/r/run')).toEqual([505]);
});
