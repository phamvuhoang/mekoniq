import copy
import json
import math
from pathlib import Path

import pytest

VECTORS = json.loads((Path(__file__).parent / "vectors" / "actuator-vectors.json").read_text())


@pytest.fixture
def actuator_fixture():
    return copy.deepcopy(VECTORS["model"])


def test_requested_torque_is_bounded(actuator_fixture):
    from bridge.actuator_model import step_actuator
    s = step_actuator({"speedRadSec": 0.0}, {"effortNm": 10.0}, actuator_fixture, 0.001)
    assert abs(s["effortNm"]) <= 2.0
    assert s["limited"] is True


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["name"])
def test_shared_reference_vectors(case, actuator_fixture):
    """The same vectors are the contract for the native plugin; this pure model is the reference implementation."""
    from bridge.actuator_model import step_actuator
    model = {**actuator_fixture, **case.get("modelOver", {})}
    out = step_actuator(case["state"], case["command"], model, 0.001)
    assert out["effortNm"] == pytest.approx(case["expect"]["effortNm"], abs=1e-9)
    assert out["limited"] is case["expect"]["limited"]
    assert out["limits"] == case["expect"]["limits"]
    assert out["speedRadSec"] == case["state"]["speedRadSec"]
    assert out["currentA"] >= 0 and math.isfinite(out["currentA"])


def test_current_is_motor_side_and_bounded_by_the_limit(actuator_fixture):
    from bridge.actuator_model import step_actuator
    out = step_actuator({"speedRadSec": 0.0}, {"effortNm": 1.6}, actuator_fixture, 0.001)
    assert out["currentA"] == pytest.approx(1.6 / (0.05 * 10 * 0.8))  # driving: joint torque / (Kt * ratio * efficiency)
    braking = step_actuator({"speedRadSec": 5.0}, {"effortNm": -0.5}, actuator_fixture, 0.001)
    assert braking["currentA"] == pytest.approx(0.5 * 0.8 / (0.05 * 10))  # back-driving: efficiency works the other way


def test_zero_dt_changes_nothing_and_negative_dt_is_refused(actuator_fixture):
    from bridge.actuator_model import step_actuator
    a = step_actuator({"speedRadSec": 1.0}, {"effortNm": 0.5}, actuator_fixture, 0.0)
    b = step_actuator({"speedRadSec": 1.0}, {"effortNm": 0.5}, actuator_fixture, 0.001)
    assert a == b
    with pytest.raises(ValueError, match="DT_INVALID"):
        step_actuator({"speedRadSec": 1.0}, {"effortNm": 0.5}, actuator_fixture, -0.001)


def test_missing_or_invalid_parameters_are_errors_not_zero(actuator_fixture):
    from bridge.actuator_model import step_actuator
    no_kt = copy.deepcopy(actuator_fixture)
    del no_kt["torqueConstantNmPerA"]
    with pytest.raises(ValueError, match="MODEL_PARAMETER_MISSING:torqueConstantNmPerA"):
        step_actuator({"speedRadSec": 0.0}, {"effortNm": 1.0}, no_kt, 0.001)
    with pytest.raises(ValueError, match="COMMAND_INVALID"):
        step_actuator({"speedRadSec": 0.0}, {"effortNm": float("nan")}, actuator_fixture, 0.001)
    with pytest.raises(ValueError, match="STATE_INVALID"):
        step_actuator({}, {"effortNm": 1.0}, actuator_fixture, 0.001)
    flat = copy.deepcopy(actuator_fixture)
    flat["torqueSpeedTable"] = flat["torqueSpeedTable"][:1]
    with pytest.raises(ValueError, match="MODEL_PARAMETER_MISSING:torqueSpeedTable"):
        step_actuator({"speedRadSec": 0.0}, {"effortNm": 1.0}, flat, 0.001)
    with pytest.raises(ValueError, match="SUPPLY_INVALID"):
        step_actuator({"speedRadSec": 0.0}, {"effortNm": 1.0, "supplyV": -1.0}, actuator_fixture, 0.001)
