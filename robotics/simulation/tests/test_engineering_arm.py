import copy

import pytest

# Test-only model: names follow the vendor convention but every number is a labelled assumption, NOT the xArm 6 limits (those come from the pinned vendor import, C01 native).
JOINTS = [f"joint{i}" for i in range(1, 7)]
MODEL = {"jointNames": JOINTS, "limits": {n: {"lower": -3.0, "upper": 3.0, "velocity": 2.0} for n in JOINTS}, "tcp": {"frame": "gripper_tcp", "xyzM": [0, 0, 0.17]}, "maxDurationS": 10.0}
DIGEST = "a" * 64


def plan(**over):
    base = {"sceneDigest": DIGEST, "jointNames": list(JOINTS), "tcp": {"frame": "gripper_tcp", "xyzM": [0, 0, 0.17]}, "collision": {"free": True},
            "points": [{"t": 0.0, "positions": [0.0] * 6}, {"t": 1.0, "positions": [0.5, 0.2, -0.3, 0.0, 0.1, 0.0]}, {"t": 2.0, "positions": [1.0, 0.4, -0.6, 0.0, 0.2, 0.0]}]}
    base.update(over)
    return base


def check(p, digest=DIGEST, model=MODEL):
    from bridge.engineering_arm import validate_plan
    return validate_plan(p, digest, model)


def test_stale_plan_is_rejected():
    from bridge.engineering_arm import validate_plan
    plan_ = {"sceneDigest": "a" * 64, "jointNames": [], "points": []}
    assert "SCENE_STALE" in validate_plan(plan_, "b" * 64)
    assert check(plan(), "b" * 64) == ["SCENE_STALE"]


def test_a_correct_plan_has_no_reasons():
    assert check(plan()) == []


def test_empty_fixture_never_passes():
    assert "PLAN_INVALID" in check({"sceneDigest": DIGEST, "jointNames": [], "points": []})


def test_wrong_joint_names_limits_speed_and_time_are_each_reported():
    assert check(plan(jointNames=list(reversed(JOINTS)))) == ["JOINT_NAMES_MISMATCH"]
    far = plan()
    far["points"][2]["positions"][0] = 3.5
    assert "JOINT_LIMIT_EXCEEDED" in check(far)
    fast = plan()
    fast["points"][1]["positions"][0] = 2.9  # 2.9 rad in 1 s against 2.0 rad/s
    assert "JOINT_VELOCITY_EXCEEDED" in check(fast)
    backwards = plan()
    backwards["points"][2]["t"] = 1.0
    assert "TRAJECTORY_TIME_INVALID" in check(backwards)
    nan = plan()
    nan["points"][1]["positions"][2] = float("nan")
    assert "PLAN_INVALID" in check(nan)
    assert "TRAJECTORY_TOO_LONG" in check(plan(points=[{"t": 0.0, "positions": [0.0] * 6}, {"t": 11.0, "positions": [0.1] * 6}]))


def test_tool_mismatch_unreachable_collision_and_hardware_interface():
    assert "TCP_MISMATCH" in check(plan(tcp={"frame": "gripper_tcp", "xyzM": [0, 0, 0.30]}))
    assert "COLLISION_NOT_CLEARED" in check(plan(collision={"free": False}))
    assert "COLLISION_NOT_CLEARED" in check(plan(collision={}))  # unknown is not clear
    assert "HARDWARE_INTERFACE_FORBIDDEN" in check(plan(interface="hardware"))


def test_without_the_pinned_model_limits_cannot_be_proven():
    from bridge.engineering_arm import validate_plan
    assert validate_plan(plan(), DIGEST) == ["MODEL_UNAVAILABLE"]


def test_vendor_lock_is_an_honest_not_run_record():
    import json
    from pathlib import Path
    lock = json.loads((Path(__file__).resolve().parents[2] / "manipulation" / "vendor.lock.json").read_text())
    assert lock["qualification"] == "not_run" and lock["vendors"][0]["commit"] is None and lock["blockers"]
