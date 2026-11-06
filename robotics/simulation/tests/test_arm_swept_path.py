"""ARM03 geometric swept-path checker (plan 02 task 6; consumed by plan 03 A05): self-collision, arm-vs-scene/fixture/robot and the held cup
along the whole trajectory with a conservative subdivision bound, phase-scoped allowed contacts, and a report that names engine, model,
geometry, pairs and intervals. Golden FK/sweep vectors come from the TypeScript model (tests/fixtures/digital-twin/arm-fk-golden.json)."""
import json
import math
from pathlib import Path

import pytest

from collision.arm_swept_path import (PUMA560_SI, CheckerUnavailable, check_swept_path, forward_kinematics, geometry_revision)

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "digital-twin"
GOLDEN = json.loads((FIXTURES / "arm-fk-golden.json").read_text())
ASSET = {"id": "arm-puma-reference", "revision": 1, "contentHash": "f" * 64}
WORLD = {"id": "coffee-cell-world", "revision": 3, "hash": "0" * 64}
SIMPLE = {**PUMA560_SI, "revision": "synthetic-one-metre-arm", "toolM": [0, 0, 0],
          "links": [{"alpha": 0, "a": 1 if i == 1 else 0, "d": 0, "thetaOffset": 0} for i in range(6)], "limits": [{"min": -math.pi, "max": math.pi, "maxVelocity": 2}] * 6}


def q(angle):
    return [angle, 0, 0, 0, 0, 0]


def trace(*joints):
    return [{"tick": i, "q": list(j)} for i, j in enumerate(joints)]


def test_forward_kinematics_matches_the_typescript_model_to_1e_9():
    assert PUMA560_SI["links"] == GOLDEN["model"]["links"] and PUMA560_SI["revision"] == GOLDEN["model"]["revision"]
    for case in GOLDEN["fk"]:
        fk = forward_kinematics(PUMA560_SI, case["q"])
        for got, want in zip(fk["frames"], case["frames"]):
            assert math.dist(got, want) < 1e-9
        assert math.dist(fk["tcp"], case["tcp"]) < 1e-9
        assert all(abs(a - b) < 1e-9 for a, b in zip(fk["tcpQuaternion"], case["tcpQ"])) or all(abs(a + b) < 1e-9 for a, b in zip(fk["tcpQuaternion"], case["tcpQ"]))


def test_sweep_matches_the_typescript_checker_on_the_golden_case():
    g = GOLDEN["sweep"]
    report = check_swept_path(ASSET, WORLD, trace([0.5, -0.4, 1.0, 0, 0.8, 0], [-0.5, -0.4, 1.0, 0, 0.8, 0]), [{"cupId": "cup-1", "fromTick": 0, "toTick": 1}],
                              world=[{"id": "pin", "kind": "sphere", "center": [0.0, 0.45, 0.1], "radiusM": 0.01}], model=PUMA560_SI, geometry=GOLDEN["geometry"])
    assert report["ok"] == g["ok"] and report["engine"] == "capsule-sweep-py-v1" and report["toleranceM"] == g["toleranceM"]
    if not g["ok"]:
        assert report["colliding"][0]["pair"] == g["pair"] and abs(report["colliding"][0]["fraction"] - g["fraction"]) < 0.05


def test_thin_obstacle_between_clear_endpoints_is_detected_with_the_pair_and_interval():
    world = [{"id": "fixture-pin", "kind": "sphere", "center": [0.955336489, -0.295520207, 0], "radiusM": 0.003}]
    clear = check_swept_path(ASSET, WORLD, trace(q(-1.2), q(-1.2)), [], world=world, model=SIMPLE)
    assert clear["ok"] is True and clear["coverage"]["intervals"] == 1
    report = check_swept_path(ASSET, WORLD, trace(q(-1.2), q(1.2)), [], world=world, model=SIMPLE)
    assert report["ok"] is False
    hit = report["colliding"][0]
    assert "fixture-pin" in hit["pair"] and 0 < hit["fraction"] < 1 and hit["interval"] == {"fromTick": 0, "toTick": 1}
    assert report["method"] == {"kind": "adaptive-subdivision", "bound": "reach * sum(|dq|) per interval, conservative", "toleranceM": 0.0005, "maxDepth": 24}
    assert report["modelRevision"] == "synthetic-one-metre-arm" and report["assetRef"] == ASSET and report["worldRevision"] == WORLD


def test_held_cup_hits_a_table_the_flange_clears_and_only_while_attached():
    cup_stop = [{"id": "table-edge", "kind": "box", "min": [0.99, -0.005, 0.075], "max": [1.01, 0.005, 0.085]}]
    no_cup = check_swept_path(ASSET, WORLD, trace(q(0), q(0)), [], world=cup_stop, model=SIMPLE)
    assert no_cup["ok"] is True
    with_cup = check_swept_path(ASSET, WORLD, trace(q(0), q(0)), [{"cupId": "cup-1", "fromTick": 0, "toTick": 0}], world=cup_stop, model=SIMPLE)
    assert with_cup["ok"] is False and with_cup["colliding"][0]["pair"] == ["held-cup", "table-edge"]
    later = check_swept_path(ASSET, WORLD, trace(q(0), q(0), q(0)), [{"cupId": "cup-1", "fromTick": 2, "toTick": 2}], world=cup_stop, model=SIMPLE)
    assert [i["ok"] for i in later["intervals"]] == [True, False] and later["attachments"] == [{"cupId": "cup-1", "fromTick": 2, "toTick": 2}]


def test_self_collision_between_non_adjacent_links_is_reported():
    folded = {**SIMPLE, "links": [{**l, "a": 0.4 if 1 <= i <= 3 else 0} for i, l in enumerate(SIMPLE["links"])]}
    pose = [0, 0, math.pi, 0, 0, 0]
    report = check_swept_path(ASSET, WORLD, trace(pose, pose), [], world=[], model=folded)
    assert report["ok"] is False and report["colliding"][0]["pair"] == ["link-2", "link-4"]


def test_allowed_contacts_are_phase_scoped_and_declared_in_the_report():
    receiver = [{"id": "receiver-edge", "kind": "sphere", "center": [1, 0, 0.035], "radiusM": 0.002}]
    blocked = check_swept_path(ASSET, WORLD, trace(q(0), q(0)), [], world=receiver, model=SIMPLE)
    assert blocked["ok"] is False and blocked["colliding"][0]["pair"] == ["gripper", "receiver-edge"]
    window = {"pair": ["gripper", "receiver-edge"], "phase": "release", "fromTick": 0, "toTick": 1, "revision": WORLD["revision"]}  # covers the interval 0->1 only
    allowed = check_swept_path(ASSET, WORLD, trace(q(0), q(0)), [], world=receiver, model=SIMPLE, allowed_contacts=[window])
    assert allowed["ok"] is True and allowed["allowedContacts"] == [window] and allowed["coverage"]["allowedContactsApplied"] == 1
    outside = check_swept_path(ASSET, WORLD, trace(q(0), q(0), q(0)), [], world=receiver, model=SIMPLE, allowed_contacts=[window])
    assert outside["ok"] is False and outside["colliding"][0]["interval"] == {"fromTick": 1, "toTick": 2} and outside["coverage"]["allowedContactsApplied"] == 1


@pytest.mark.parametrize("window,code", [
    ({"pair": ["link-2", "receiver-edge"], "phase": "release", "fromTick": 0, "toTick": 1, "revision": 3}, "ALLOWED_CONTACT_PAIR"),        # only the gripper or the held cup may touch
    ({"pair": ["gripper", "receiver-edge"], "phase": "idle", "fromTick": 0, "toTick": 1, "revision": 3}, "ALLOWED_CONTACT_PHASE"),         # grasp/release only
    ({"pair": ["gripper", "receiver-edge"], "phase": "release", "fromTick": 0, "toTick": 1, "revision": 2}, "ALLOWED_CONTACT_REVISION"),   # declared for another world revision
    ({"pair": ["gripper", "receiver-edge"], "phase": "release", "fromTick": 2, "toTick": 1, "revision": 3}, "ALLOWED_CONTACT_SPAN"),
    ({"pair": ["gripper"], "phase": "release", "fromTick": 0, "toTick": 1, "revision": 3}, "ALLOWED_CONTACT_PAIR")])
def test_allowed_contact_windows_are_validated_never_silently_whitelisted(window, code):
    receiver = [{"id": "receiver-edge", "kind": "sphere", "center": [1, 0, 0.035], "radiusM": 0.002}]
    with pytest.raises(ValueError, match=code):
        check_swept_path(ASSET, WORLD, trace(q(0), q(0)), [], world=receiver, model=SIMPLE, allowed_contacts=[window])


def test_uncertain_sweeps_never_pass_and_missing_inputs_make_the_checker_unavailable():
    far = check_swept_path(ASSET, WORLD, trace(q(-1), q(1)), [], world=[{"id": "far", "kind": "sphere", "center": [5, 5, 5], "radiusM": 0.1}], model=SIMPLE)
    assert far["ok"] is True and far["coverage"]["evaluations"] > 0 and far["geometryRevision"] == geometry_revision(GOLDEN["geometry"], far["world"])
    with pytest.raises(CheckerUnavailable, match="MODEL_MISSING"):
        check_swept_path(ASSET, WORLD, trace(q(0), q(1)), [], world=[], model=None)
    with pytest.raises(CheckerUnavailable, match="TRACE_INCOMPLETE"):
        check_swept_path(ASSET, WORLD, [{"tick": 0, "q": q(0)}, {"tick": 2, "q": q(1)}], [], world=[], model=SIMPLE)
    with pytest.raises(CheckerUnavailable, match="TRACE_INCOMPLETE"):
        check_swept_path(ASSET, WORLD, [], [], world=[], model=SIMPLE)
    with pytest.raises(ValueError, match="COLLISION_WORLD_INVALID"):
        check_swept_path(ASSET, WORLD, trace(q(0), q(1)), [], world=[{"id": "bad", "kind": "sphere", "center": [float("nan"), 0, 0], "radiusM": 1}], model=SIMPLE)
    with pytest.raises(ValueError, match="JOINT_COUNT"):
        check_swept_path(ASSET, WORLD, trace([0, 0, 0], [0, 0, 1]), [], world=[], model=SIMPLE)
