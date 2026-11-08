import json
import math
from types import SimpleNamespace as NS

import numpy as np
import pytest

from irsim_worker.scene import write_scene
from irsim_worker.snapshot import SnapshotError, beam, lidar_scan, wrap_pi


def test_special_ranges_become_null_with_an_explicit_beam_state():
    assert beam(2.5, 0.05, 10) == (2.5, "hit")
    assert beam(np.float32("inf"), 0.05, 10) == (None, "no_return")
    assert beam(np.float32("-inf"), 0.05, 10) == (None, "below_min")
    assert beam(np.float32("nan"), 0.05, 10) == (None, "invalid")
    with pytest.raises(SnapshotError) as e:
        beam(12.0, 0.05, 10)  # a finite value the engine itself says is out of range: reject the sample
    assert e.value.code == "SENSOR_INCONSISTENT"


def test_a_scan_is_json_safe_and_keeps_the_engine_angles():
    scan = NS(ranges=np.array([np.inf, 2.8, -np.inf, np.nan], dtype=np.float32), range_min=0.05, range_max=10.0, angle_min=-0.5, angle_increment=0.25, header=NS(frame_id="r/laser"))
    out = lidar_scan(scan, "lidar-2d", 3)
    assert out["rangesM"][0] is None and out["states"] == ["no_return", "hit", "below_min", "invalid"] and out["simTimeNs"] == "60000000"
    assert (out["angleMinRad"], out["angleIncrementRad"]) == (-0.5, 0.25)
    json.dumps(out, allow_nan=False)


def test_wrap_pi_is_canonical():
    assert wrap_pi(math.pi) == pytest.approx(math.pi) and wrap_pi(-math.pi) == pytest.approx(math.pi)
    assert wrap_pi(3 * math.pi / 2) == pytest.approx(-math.pi / 2) and wrap_pi(0.3) == pytest.approx(0.3)


def test_sen01_a_wall_at_known_coordinates_is_seen_through_the_lidar_offset_and_yaw(tmp_path, serve):
    """LiDAR 0.22 m ahead of the axle (drive frame), robot yawed 90 deg at (6, 6) in the 20 x 12 m world: the beam along the robot's +x ray hits the upper wall's inner face."""
    import irsim
    from irsim_worker.scene import engine_name
    from irsim_worker.snapshot import build_snapshot
    scene = json.loads(json.dumps(serve))
    scene["robots"][0]["initialPoseMap"] = [6.0, 6.0, math.pi / 2]
    scene["world"]["obstacles"] = []  # nothing but the four boundary walls
    write_scene(scene, tmp_path)
    env = irsim.make(str(tmp_path / "irsim/world.yaml"), display=False, seed=1)
    try:
        names = {"amr-1": engine_name("amr-1")}
        snap = build_snapshot(env, run_id="r", boot_id="b", tick=0, seq=1, scene_digest="d" * 64, names=names, sensor_ids={"amr-1": ["lidar-2d"]}, solid_ids={})
        scan = snap["robots"][0]["scans"][0]
        i = min(range(len(scan["rangesM"])), key=lambda k: abs(scan["angleMinRad"] + k * scan["angleIncrementRad"]))  # the beam at angle 0 of the sensor
        origin_y = 6.0 + 0.22  # sensor offset 0.22 m along the robot's heading (+y after the 90 deg yaw)
        theta = scan["angleMinRad"] + i * scan["angleIncrementRad"]  # the beam's own angle in the sensor frame: it is not exactly 0
        # a ray at angle theta from the heading (+y) meets the wall y = H - 0.1 after d / cos(theta); computed here from the scene geometry, not from the engine
        assert scan["rangesM"][i] == pytest.approx(((12.0 - 0.1) - origin_y) / math.cos(theta), abs=1e-5)
        assert scan["states"][i] == "hit"
        assert snap["robots"][0]["poseDriveMap"] == pytest.approx([6.0, 6.0, math.pi / 2])
        json.dumps(snap, allow_nan=False)
    finally:
        env.end()
