"""Observed ir-sim 2.12.0 behaviour on the research probe world (2 robots, polygon + circle, lidar offset 0.1 m)."""
import math
import pathlib

import irsim
import pytest

WORLD = (pathlib.Path(__file__).parents[3] / 'docs/research/2026-11-08-linkforge-irsim/probe-world.yaml').resolve()
ZERO = {'r1': [0.0, 0.0], 'r2': [0.0, 0.0]}


@pytest.fixture
def env():
    e = irsim.make(str(WORLD), display=False, seed=17)
    yield e
    e.end()


def test_two_robots_step_with_explicit_velocity(env):
    start = [(r.state[0, 0], r.state[1, 0]) for r in env.robot_list]
    for _ in range(10):
        env.step({'r1': [0.2, 0.0], 'r2': [0.1, 0.0]})
    moved = [math.hypot(r.state[0, 0] - s[0], r.state[1, 0] - s[1]) for r, s in zip(env.robot_list, start)]
    assert moved == pytest.approx([0.04, 0.02], abs=1e-6)


def test_scan_uses_inf_for_misses_and_sees_the_wall_through_the_offset(env):
    env.step(ZERO)
    scan = env.get_msg(use_inf=True).robots[0].sensors[0]
    assert scan.header.frame_id == 'r1/laser' and scan.header.stamp == pytest.approx(0.02)
    ranges = list(scan.ranges)
    assert math.isinf(ranges[0]) and math.isinf(ranges[2])  # JSON layer must map +inf -> null/no_return
    assert ranges[1] == pytest.approx(2.8, abs=0.01)  # wall at x=3.9, lidar at x=1+0.1


def test_get_msg_snapshot_is_independent_of_later_steps(env):
    env.step(ZERO)
    before = list(env.get_msg(use_inf=True).robots[0].sensors[0].ranges)
    first = env.get_msg(use_inf=True)
    for _ in range(10):
        env.step({'r1': [0.2, 0.0], 'r2': [0.0, 0.0]})
    assert list(first.robots[0].sensors[0].ranges) == before
