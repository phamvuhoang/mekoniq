"""Model-only motion checks from the bounded actuator reference. These are NOT native V06/V07 evidence: no physics engine ran."""
import copy
import json
from pathlib import Path

VECTORS = json.loads((Path(__file__).parent / "vectors" / "actuator-vectors.json").read_text())
RADIUS_M = 0.1


def stall_acceleration(mass_kg, requested_nm):
    from bridge.actuator_model import step_actuator
    tau = step_actuator({"speedRadSec": 0.0}, {"effortNm": requested_nm}, copy.deepcopy(VECTORS["model"]), 0.001)["effortNm"]
    return 2 * tau / RADIUS_M / mass_kg  # two driven wheels, no losses beyond the actuator envelope


def test_full_payload_accelerates_slower_when_the_envelope_binds():
    empty, full = stall_acceleration(30.0, 10.0), stall_acceleration(35.0, 10.0)
    assert full < empty
    assert abs(empty / full - 35.0 / 30.0) < 1e-12  # same capped torque, mass ratio only


def test_a_request_inside_the_envelope_is_not_slowed_by_the_model():
    assert stall_acceleration(30.0, 0.5) == 2 * 0.5 / RADIUS_M / 30.0
