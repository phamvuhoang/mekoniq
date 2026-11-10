import json, math, sys

import pytest

from algorithm_checks import handle

PROTO = "mekoniq-algorithm/1"


def call(op, payload):
    return handle(json.dumps({"protocol": PROTO, "op": op, "payload": payload}))


def error_code(out):
    assert out["ok"] is False, out
    return out["error"]["code"]


# one revolute joint whose frame is 0.3 m above the base; q=0 leaves only that offset
ONE = [{"a": 0.0, "alpha": 0.0, "d": 0.3, "offset": 0.0}]
TWO = [{"a": 0.0, "alpha": 0.0, "d": 0.0, "offset": 0.0}, {"a": 0.4, "alpha": 0.0, "d": 0.0, "offset": 0.0}]


def test_fk_identity_chain():
    out = call("rtb_fk", {"dh": ONE, "q": [[0.0]]})
    assert out["ok"], out
    T = out["result"]["T"][0]
    assert T[2][3] == pytest.approx(0.3, abs=1e-12)
    assert T[0][3] == pytest.approx(0.0, abs=1e-12) and T[1][3] == pytest.approx(0.0, abs=1e-12)
    assert T[0][0] == pytest.approx(1.0) and T[3] == [0.0, 0.0, 0.0, 1.0]
    assert "roboticstoolbox-python" in out["toolVersions"]


def test_rejects_nan_and_oversize():
    # json.dumps writes NaN as the bare token NaN, which the checker must refuse as non-finite
    assert error_code(call("rtb_fk", {"dh": ONE, "q": [[float("nan")]]})) == "INPUT_INVALID"
    big = {"dh": ONE, "q": [[0.0]] * 200_000}
    assert error_code(call("rtb_fk", big)) == "INPUT_TOO_LARGE"


def test_unknown_op():
    assert error_code(call("shell", {})) == "OP_UNKNOWN"


def test_wrong_protocol_and_bad_json():
    assert error_code(handle(json.dumps({"protocol": "x", "op": "rtb_fk", "payload": {}}))) == "PROTOCOL_MISMATCH"
    assert error_code(handle("{not json")) == "INPUT_INVALID"


def test_no_network_import():
    call("rtb_fk", {"dh": ONE, "q": [[0.0]]})
    assert "robot_descriptions" not in sys.modules


def test_jacobian_and_condition_of_a_planar_arm():
    out = call("rtb_jacobian", {"dh": TWO, "q": [[0.3, 0.7]]})
    assert out["ok"], out
    J, cond = out["result"]["J"][0], out["result"]["cond"][0]
    assert len(J) == 6 and len(J[0]) == 2 and math.isfinite(cond) and cond >= 1.0


def test_ik_round_trip_for_a_reachable_pose():
    q = [0.4, 0.9]
    T = call("rtb_fk", {"dh": TWO, "q": [q]})["result"]["T"]
    out = call("rtb_ik", {"dh": TWO, "T": T, "q0": [[0.3, 0.7]], "limits": [[-3.0, 3.0], [-3.0, 3.0]]})
    assert out["ok"], out
    sol = out["result"]["solutions"][0]
    assert sol["ok"] is True
    back = call("rtb_fk", {"dh": TWO, "q": [sol["q"]]})["result"]["T"][0]
    assert back[0][3] == pytest.approx(T[0][0][3], abs=1e-6) and back[1][3] == pytest.approx(T[0][1][3], abs=1e-6)


def test_ik_reports_unreachable_pose_without_inventing_a_solution():
    T = [[[1, 0, 0, 5.0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]]
    out = call("rtb_ik", {"dh": TWO, "T": T, "q0": [[0.1, 0.1]], "limits": [[-3.0, 3.0], [-3.0, 3.0]]})
    assert out["ok"] and out["result"]["solutions"][0]["ok"] is False


def test_ik_refuses_a_start_outside_the_joint_limits():
    T = call("rtb_fk", {"dh": TWO, "q": [[0.4, 0.9]]})["result"]["T"]
    out = call("rtb_ik", {"dh": TWO, "T": T, "q0": [[3.5, 0.0]], "limits": [[-3.0, 3.0], [-3.0, 3.0]]})
    sol = out["result"]["solutions"][0]
    assert sol["ok"] is False and sol["reason"] == "Q0_OUT_OF_LIMITS"
