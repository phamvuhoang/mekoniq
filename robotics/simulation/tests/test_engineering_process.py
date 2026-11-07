import copy
import json
import math
from pathlib import Path

import pytest

MODEL = json.loads((Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "engineering" / "process-200ml.json").read_text())


@pytest.fixture
def process_fixture():
    return copy.deepcopy(MODEL)


def fresh(**over):
    state = {"elapsedS": 0.0, "volumeMl": 0.0, "targetMl": 200.0, "cupMassKg": 0.02, "waterMl": 1000.0, "cupPresent": True, "blockedFlow": False}
    state.update(over)
    return state


def run(state, model, seconds, dt=0.5):
    for _ in range(round(seconds / dt)):
        state = step(state, model, dt)
    return state


def step(state, model, dt):
    from bridge.coffee_process import step_process
    return step_process(state, model, dt)


def test_blocked_flow_does_not_create_mass(process_fixture):
    state = {"volumeMl": 0.0, "cupMassKg": 0.02, "waterMl": 1000.0, "cupPresent": True, "blockedFlow": True}
    result = step(state, process_fixture, 1.0)
    assert result["cupMassKg"] == 0.02
    assert result["waterMl"] == 1000.0
    assert result["status"] == "blocked"


def test_200_ml_becomes_0_2_kg_and_mass_is_conserved(process_fixture):
    done = run(fresh(), process_fixture, 15)
    assert done["status"] == "complete"
    assert done["volumeMl"] == pytest.approx(200.0, abs=1e-9)
    assert done["cupMassKg"] - 0.02 == pytest.approx(0.2, abs=1e-12)
    drawn_ml = 1000.0 - done["waterMl"]
    assert drawn_ml == pytest.approx(done["volumeMl"], abs=1e-9)
    assert (done["cupMassKg"] - 0.02) == pytest.approx(drawn_ml * 1e-6 * 1000.0, abs=1e-12)  # no mass appears or disappears


def test_startup_delay_then_nominal_flow(process_fixture):
    s = step(fresh(), process_fixture, 0.5)
    assert s["status"] == "startup" and s["volumeMl"] == 0.0
    s = step(s, process_fixture, 0.5)
    s = step(s, process_fixture, 1.0)
    assert s["status"] == "flowing" and s["volumeMl"] == pytest.approx(20.0)


def test_dt_must_be_finite_and_non_negative_and_zero_changes_nothing(process_fixture):
    for bad in (-1.0, math.nan, math.inf):
        with pytest.raises(ValueError, match="DT_INVALID"):
            step(fresh(), process_fixture, bad)
    before = fresh()
    assert step(before, process_fixture, 0.0)["volumeMl"] == 0.0
    assert step(before, process_fixture, 0.0)["elapsedS"] == 0.0


def test_stockout_stops_at_what_the_reservoir_holds(process_fixture):
    done = run(fresh(waterMl=50.0), process_fixture, 15)
    assert done["status"] == "stockout" and done["volumeMl"] == pytest.approx(50.0) and done["waterMl"] == 0.0


def test_no_cup_pours_nothing(process_fixture):
    s = run(fresh(cupPresent=False), process_fixture, 5)
    assert s["status"] == "no_cup" and s["volumeMl"] == 0.0 and s["waterMl"] == 1000.0


def test_timeout_is_a_failure_not_a_completion(process_fixture):
    slow = copy.deepcopy(process_fixture)
    slow["maxDurationSec"]["value"] = 3.0
    done = run(fresh(), slow, 10)
    assert done["status"] == "timeout" and done["volumeMl"] < 200.0


def test_temperature_is_unavailable_without_a_time_constant(process_fixture):
    assert step(fresh(), process_fixture, 1.0)["temperatureC"] is not None
    no_tau = copy.deepcopy(process_fixture)
    del no_tau["temperature"]["thermalTimeConstantSec"]
    assert step(fresh(), no_tau, 1.0)["temperatureC"] is None
    heated = run(fresh(temperatureC=20.0), process_fixture, 5, 0.5)
    assert 20.0 < heated["temperatureC"] < 90.0
    assert heated["temperatureC"] == pytest.approx(20 + 70 * (1 - math.exp(-5 / 5)), rel=1e-6)


def test_sensor_faults_change_what_is_observed_not_what_is_true(process_fixture):
    from bridge.coffee_process import observe
    s = run(fresh(), process_fixture, 4)
    assert observe(s, None)["volumeMl"] == s["volumeMl"]
    assert observe(s, {"kind": "sensor_bias", "offsetMl": 15.0})["volumeMl"] == pytest.approx(s["volumeMl"] + 15.0)
    stuck = observe(s, {"kind": "sensor_stuck", "valueMl": 3.0})
    assert stuck["volumeMl"] == 3.0 and s["volumeMl"] != 3.0


def test_missing_target_is_an_error_when_flow_would_start(process_fixture):
    state = fresh(elapsedS=2.0)
    del state["targetMl"]
    with pytest.raises(ValueError, match="PROCESS_STATE_INVALID:targetMl"):
        step(state, process_fixture, 1.0)
