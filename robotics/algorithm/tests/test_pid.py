import json
import math

import pytest

from algorithm_checks import handle

PROTO = "mekoniq-algorithm/1"
DT = 0.02
CFG = {"kp": 2.0, "ki": 0.0, "kd": 0.0, "dtS": DT, "derivativeFilterHz": 10.0, "outMin": -100.0, "outMax": 100.0}
PLANT = {"gain": 8.0, "tauS": 0.25, "delaySteps": 0}


def call(**over):
    n = over.pop("n", 200)
    payload = {"config": dict(CFG), "plant": dict(PLANT), "setpoint": [1.0] * n, "disturbance": [0.0] * n, "noise": [0.0] * n}
    payload.update(over)
    return handle(json.dumps({"protocol": PROTO, "op": "pid_response", "payload": payload}))


def test_p_only_matches_linear():
    out = call()
    assert out["ok"], out
    r = out["result"]
    assert r["linear"] is not None
    assert max(abs(a - b) for a, b in zip(r["y"], r["linear"])) <= 1e-9
    assert len(r["y"]) == len(r["u"]) == len(r["integral"]) == 200


def test_pi_matches_linear_and_integral_moves():
    out = call(config={**CFG, "kp": 0.5, "ki": 2.0})
    r = out["result"]
    assert r["linear"] is not None and max(abs(a - b) for a, b in zip(r["y"], r["linear"])) <= 1e-9
    assert r["integral"][-1] != 0.0


def test_linear_is_withheld_when_not_valid():
    assert call(config={**CFG, "kd": 0.01})["result"]["linear"] is None  # derivative term
    assert call(plant={**PLANT, "delaySteps": 2})["result"]["linear"] is None  # delay
    sat = call(config={**CFG, "outMin": -0.5, "outMax": 0.5})["result"]  # touches the limit
    assert sat["linear"] is None and max(abs(v) for v in sat["u"]) <= 0.5


def test_first_sample_uses_the_initial_plant_state():
    r = call()["result"]
    assert r["y"][0] == 0.0 and r["u"][0] == pytest.approx(2.0)


def test_rejects_nonfinite():
    out = call(setpoint=[1.0, None, 1.0] + [1.0] * 197)
    assert out["ok"] is False and out["error"]["code"] == "INPUT_INVALID"
    assert call(config={**CFG, "kp": float("inf")})["error"]["code"] == "INPUT_INVALID"


def test_length_mismatch():
    out = call(disturbance=[0.0] * 3)
    assert out["ok"] is False and out["error"]["code"] == "INPUT_INVALID"


def test_anti_windup_switch_changes_the_integral():
    base = {"config": {**CFG, "kp": 0.5, "ki": 4.0, "outMin": -1.0, "outMax": 1.0}, "setpoint": [10.0] * 100 + [0.0] * 100}
    on = call(**base)["result"]["integral"]
    off = call(**base, antiWindup=False)["result"]["integral"]
    assert max(on) < max(off)
