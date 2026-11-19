"""Pure Python tests of the virtual drive state machine (no engine): the fixture builds a DriveGroup from the generated drive-v1 fixtures; the helpers below belong to the test."""
import copy
import json
import math
from pathlib import Path

import pytest

from mujoco_worker.drive_model import DriveGroup, actuator_spec, plan_actuators, quantize
from mujoco_worker.protocol import WorkerError

FX = Path(__file__).resolve().parents[1] / "fixtures" / "drive-v1"
DT, SUB = 0.002, 10


def doc(name):
    return json.loads((FX / name).read_text())


class Rig:
    """A DriveGroup plus a trivial plant: a velocity axis moves at the speed the drive hands out while it is active."""

    def __init__(self, model="serve-drive-nominal-v1.json", control="serve-control-v1.json", edit=None):
        m, c = doc(model), doc(control)
        if edit:
            edit(m)
        self.model, self.control = m, c
        limits = {a["axisId"]: (-a["velocityLimitRadS"], a["velocityLimitRadS"]) if a["mode"] == "csv" else (-6.3, 6.3) for a in m["axes"]}
        self.g = DriveGroup(m, c, DT, SUB, limits)
        self.n = len(m["axes"])
        self.pos, self.vel = [0.0] * self.n, [0.0] * self.n
        self.g.reset(self.pos)
        self.seq = 0
        self.log = []

    def commands(self, seq=None, target=0.0, **over):
        seq = self.seq + 1 if seq is None else seq
        self.seq = max(self.seq, seq)
        return [{"axisId": a["axisId"], "seq": seq, "mode": a["mode"], "target": target, "enable": True, "quickStop": False, "faultReset": False, **over} for a in self.model["axes"]]

    def run_substeps(self, torque=0.0):
        for _ in range(SUB):
            out = self.g.substep(self.pos, self.vel)
            self.log.append(out)
            for i in range(self.n):
                self.vel[i] = out["target"][i] if out["active"][i] and self.model["axes"][i]["mode"] == "csv" else 0.0
                self.pos[i] += self.vel[i] * DT
            self.g.sample(self.pos, self.vel, [torque] * self.n, [False] * self.n)
        return self.g.end_tick()

    def tick(self, **kw):
        self.g.begin_tick(self.commands(**kw))
        return self.run_substeps()

    def enable_all(self):
        while self.states()[0] != "enabled":
            self.tick(target=0.0)

    def states(self):
        return list(self.g.state)

    def faults(self):
        return list(self.g.fault)

    def snapshot(self):
        return copy.deepcopy((self.g.state, self.g.fault, self.g.seq, self.g.stale, self.g.cmd_in, self.g.prev_in, self.g.tick, self.g.accepting))


@pytest.fixture
def nominal_group():
    return Rig()


def test_quantize_snaps_to_encoder_counts():
    step = 2 * math.pi / 4096
    assert quantize(0.001, 4096) == pytest.approx(round(0.001 / step) * step, abs=1e-15)
    assert quantize(0.001, None) == 0.001


def test_a_disabled_axis_acknowledges_a_command_and_drops_its_target(nominal_group):
    r = nominal_group
    r.g.begin_tick(r.commands(target=2.0, enable=False))
    snap = r.run_substeps()
    assert [s["state"] for s in snap] == ["disabled", "disabled"]
    assert [s["commandSeq"] for s in snap] == [1, 1]            # acknowledged
    assert [s["targetApplied"] for s in snap] == [0.0, 0.0]     # but never applied
    assert all(not a for out in r.log for a in out["active"])


def test_the_enable_sequence_takes_exactly_enableDelaySubsteps(nominal_group):
    r = nominal_group  # enableDelaySubsteps = 25
    r.g.begin_tick(r.commands(target=0.0))
    seen = []
    for _ in range(SUB * 3):
        out = r.g.substep(r.pos, r.vel)
        seen.append(r.g.state[0])
        r.g.sample(r.pos, r.vel, [0, 0], [False, False])
        if _ == SUB - 1:
            r.g.end_tick()
            r.g.begin_tick(r.commands(target=0.0))
        if _ == 2 * SUB - 1:
            r.g.end_tick()
            r.g.begin_tick(r.commands(target=0.0))
    assert seen.index("enabled") == 24 and seen[:24] == ["ready"] * 24  # the 25th substep after the request


def test_an_ideal_drive_boots_enabled_with_no_sequence():
    r = Rig("serve-drive-ideal-v1.json")
    assert r.states() == ["enabled", "enabled"]
    assert all(c["enable"] for c in r.g.prime_commands())


def test_a_nominal_drive_boots_disabled_and_primes_without_an_enable_request(nominal_group):
    assert nominal_group.states() == ["disabled", "disabled"]
    assert not any(c["enable"] for c in nominal_group.g.prime_commands())


def test_watchdog_trips_after_stale_ticks(nominal_group):          # watchdogTicks = 5
    r = nominal_group
    r.enable_all()
    seq = r.g.seq[0]
    for _ in range(5):
        r.g.begin_tick(r.commands(seq=seq + 1, target=1.0)); r.run_substeps()
    assert r.states() == ["enabled", "enabled"]
    r.g.begin_tick(r.commands(seq=seq + 1, target=1.0)); r.run_substeps()
    assert r.faults() == ["COMMAND_TIMEOUT", "COMMAND_TIMEOUT"]
    assert r.states() == ["fault", "fault"]


def test_watchdog_counts_ticks_not_substeps_or_time(nominal_group):
    r = nominal_group
    r.enable_all()
    for k in range(200):  # a new seq every tick, however many ticks: never stale
        r.tick(target=1.0)
    assert r.states() == ["enabled", "enabled"]


def test_a_held_faultReset_does_not_clear_a_second_fault(nominal_group):
    r = nominal_group
    r.enable_all()
    seq = r.g.seq[0]
    for _ in range(6):
        r.g.begin_tick(r.commands(seq=seq + 1, faultReset=False)); r.run_substeps()
    assert r.states() == ["fault", "fault"]
    r.g.begin_tick(r.commands(faultReset=True)); r.run_substeps()
    assert r.faults() == [None, None] and r.states()[0] in ("disabled", "ready")   # the rising edge, with a new command, clears the first fault
    for _ in range(10):
        r.g.begin_tick(r.commands(faultReset=True)); r.run_substeps()  # reset stays at 1 while the drive re-enables
    assert r.states() == ["enabled", "enabled"]
    seq = r.g.seq[0]
    for _ in range(6):
        r.g.begin_tick(r.commands(seq=seq, faultReset=True)); r.run_substeps()
    assert r.states() == ["fault", "fault"]
    r.g.begin_tick(r.commands(faultReset=True)); r.run_substeps()
    assert r.states() == ["fault", "fault"]             # still held at 1: no new rising edge, the second fault stays


def test_decreasing_seq_is_refused_before_any_mutation(nominal_group):
    r = nominal_group
    r.g.begin_tick(r.commands(seq=4, target=1.0))
    before = r.snapshot()
    with pytest.raises(WorkerError) as e:
        r.g.begin_tick(r.commands(seq=3, target=1.0))
    assert e.value.code == "DRIVE_COMMAND_SEQ_INVALID" and r.snapshot() == before


@pytest.mark.parametrize("mutate,code", [
    (lambda cs: cs.append({**cs[0], "axisId": "amr-1/ghost"}), "DRIVE_AXIS_UNKNOWN"),
    (lambda cs: cs[0].update(mode="csp"), "DRIVE_MODE_MISMATCH"),
    (lambda cs: cs[0].update(target=1e3), "DRIVE_TARGET_OUT_OF_RANGE"),
    (lambda cs: cs[0].update(target=float("nan")), "DRIVE_TARGET_OUT_OF_RANGE"),
    (lambda cs: cs.pop(), "DRIVE_COMMAND_REQUIRED"),
    (lambda cs: cs.append(dict(cs[0])), "DRIVE_COMMAND_SEQ_INVALID"),
])
def test_a_command_set_is_admitted_whole_or_refused_with_its_code(nominal_group, mutate, code):
    r = nominal_group
    cs = r.commands(seq=2, target=1.0)
    mutate(cs)
    before = r.snapshot()
    with pytest.raises(WorkerError) as e:
        r.g.begin_tick(cs)
    assert e.value.code == code and r.snapshot() == before


def edit_delay(n, interp="hold"):
    def f(m):
        for a in m["axes"]:
            a["commandDelaySubsteps"], a["commandInterpolation"] = n, interp
    return f


def targets_of(r, ticks, first_target, edit=None):
    """The `target` the drive applies, per substep, when a constant command is first given at tick 1 of a drive that is already enabled."""
    r.enable_all()
    r.log.clear()
    for k in range(ticks):
        r.tick(target=first_target)
    return [out["target"][0] for out in r.log]


def test_a_command_delay_of_n_substeps_shifts_the_output_by_exactly_n_samples():
    base = targets_of(Rig("serve-drive-ideal-v1.json", edit=edit_delay(0)), 3, 1.0)
    for n in (1, 3, 10):
        shifted = targets_of(Rig("serve-drive-ideal-v1.json", edit=edit_delay(n)), 3, 1.0)
        assert shifted[:n] == [0.0] * n and shifted[n:] == base[:len(base) - n]


def test_linear_interpolation_gives_the_between_sample_a_value_between_two_commands():
    r = Rig("serve-drive-ideal-v1.json", edit=edit_delay(0, "linear"))
    r.tick(target=0.0)
    r.log.clear()
    r.tick(target=1.0)
    out = [o["target"][0] for o in r.log]
    assert out == pytest.approx([k / SUB for k in range(1, SUB + 1)])
    hold = Rig("serve-drive-ideal-v1.json", edit=edit_delay(0, "hold"))
    hold.tick(target=0.0); hold.log.clear(); hold.tick(target=1.0)
    assert [o["target"][0] for o in hold.log] == [1.0] * SUB


def feedback_rig(delay, window, counts=None):
    def f(m):
        for a in m["axes"]:
            a["feedbackDelaySubsteps"], a["encoder"]["velocityWindowSubsteps"], a["encoder"]["countsPerRev"] = delay, window, counts
    return Rig("serve-drive-ideal-v1.json", edit=f)


def feed(r, positions):
    """One position per substep (one tick = 10), returns the (positionRad, velocityRadS) of axis 0 after each tick."""
    out = []
    for k in range(0, len(positions), SUB):
        r.g.begin_tick(r.commands())
        for p in positions[k:k + SUB]:
            r.g.substep([p, p], [0, 0])
            r.g.sample([p, p], [0, 0], [0, 0], [False, False])
        s = r.g.end_tick()[0]
        out.append((s["positionRad"], s["velocityRadS"]))
    return out


def test_the_feedback_is_delayed_by_feedbackDelaySubsteps():
    ramp = [0.001 * (k + 1) for k in range(30)]
    for delay in (0, 1, 4):
        got = feed(feedback_rig(delay, 1), ramp)
        for tick, (pos, _) in enumerate(got):
            assert pos == pytest.approx(ramp[(tick + 1) * SUB - 1 - delay])


def test_the_feedback_velocity_is_the_difference_of_quantised_positions_over_the_window():
    counts = 4096
    ramp = [0.01 * (k + 1) for k in range(30)]
    got = feed(feedback_rig(1, 5, counts), ramp)
    q = [quantize(p, counts) for p in ramp]
    for tick, (pos, vel) in enumerate(got):
        last = (tick + 1) * SUB - 1
        assert pos == q[last - 1]
        assert vel == pytest.approx((q[last - 1] - q[last - 1 - 5]) / (5 * DT), abs=1e-9)


def test_a_feedback_that_stays_invalid_for_feedbackLossSubsteps_latches_FEEDBACK_LOSS(nominal_group):  # feedbackLossSubsteps = 25
    r = nominal_group
    r.enable_all()
    r.g.set_feedback_valid("amr-1/wheel-left", False)
    seen = []
    for _ in range(4):
        r.g.begin_tick(r.commands())
        for _ in range(SUB):
            r.g.substep(r.pos, r.vel)
            r.g.sample(r.pos, r.vel, [0, 0], [False, False])
            seen.append(r.g.fault[0])
        snap = r.g.end_tick()
    assert seen.index("FEEDBACK_LOSS") == 24 and r.g.fault[1] is None
    assert snap[0]["positionRad"] is None and snap[0]["velocityRadS"] is None and snap[0]["fault"] == "FEEDBACK_LOSS"
    assert snap[1]["positionRad"] is not None


def test_overspeed_and_following_error_latch():
    r = Rig("xarm6-drive-nominal-v1.json", "xarm6-control-v1.json")
    n = r.n
    r.g.begin_tick([{"axisId": a["axisId"], "seq": 1, "mode": "csp", "target": 0.0, "enable": True, "quickStop": False, "faultReset": False} for a in r.model["axes"]])
    for _ in range(3 * SUB):
        r.g.substep([0.0] * n, [0.0] * n); r.g.sample([0.0] * n, [0.0] * n, [0] * n, [False] * n)
    assert r.states() == ["enabled"] * n
    r.g.begin_tick([{"axisId": a["axisId"], "seq": 2, "mode": "csp", "target": 2.0, "enable": True, "quickStop": False, "faultReset": False} for a in r.model["axes"]])
    for _ in range(SUB):  # target 2 rad away while the true position stays at 0: 0.5 rad limit for 100 substeps
        r.g.substep([0.0] * n, [0.0] * n); r.g.sample([0.0] * n, [0.0] * n, [0] * n, [False] * n)
    assert r.faults()[0] is None
    for k in range(2, 12):
        r.g.begin_tick([{"axisId": a["axisId"], "seq": k + 1, "mode": "csp", "target": 2.0, "enable": True, "quickStop": False, "faultReset": False} for a in r.model["axes"]])
        for _ in range(SUB):
            r.g.substep([0.0] * n, [0.0] * n); r.g.sample([0.0] * n, [0.0] * n, [0] * n, [False] * n)
    assert set(r.faults()) == {"FOLLOWING_ERROR"}
    r2 = Rig()
    r2.enable_all()
    r2.g.begin_tick(r2.commands())
    r2.g.substep([0, 0], [20 * 1.2 + 1, 0])
    assert r2.faults() == ["OVERSPEED", None]


def test_quick_stop_runs_down_and_disables(nominal_group):
    r = nominal_group
    r.enable_all()
    for _ in range(3):
        r.tick(target=5.0)
    assert r.vel[0] == 5.0
    r.g.begin_tick(r.commands(quickStop=True)); r.run_substeps()
    assert r.states() == ["quick_stop", "quick_stop"] or r.states() == ["disabled", "disabled"]
    r.vel = [0.0, 0.0]
    r.g.begin_tick(r.commands(quickStop=True)); r.run_substeps()
    assert r.states() == ["disabled", "disabled"]


def test_actuator_spec_follows_the_locked_mapping():
    m, c = doc("serve-drive-nominal-v1.json"), doc("serve-control-v1.json")
    wheel_m, wheel_c = m["axes"][0], c["axes"][0]
    assert actuator_spec(wheel_m, wheel_c) == {"kind": "velocity", "attrs": {"kv": 2}, "cells": 1, "integrated": False, "referenceLimitRad": None}
    pi = copy.deepcopy(wheel_c); pi["loop"].update(ki=4.0, integralLimit=2.0)
    assert actuator_spec(wheel_m, pi) == {"kind": "pid", "attrs": {"kp": 4.0, "kv": 2, "ki": 0.0}, "cells": 2, "integrated": True, "referenceLimitRad": 0.5}
    am, ac = doc("xarm6-drive-nominal-v1.json"), doc("xarm6-control-v1.json")
    j2m, j2c = am["axes"][1], ac["axes"][1]
    assert actuator_spec(j2m, j2c) == {"kind": "position", "attrs": {"kp": 6000, "kv": 150}, "cells": 1, "integrated": False, "referenceLimitRad": None}
    with_i = copy.deepcopy(j2c); with_i["loop"].update(ki=3000.0, integralLimit=2.0)
    spec = actuator_spec(j2m, with_i)
    assert spec["kind"] == "pid" and spec["cells"] == 2 and spec["attrs"] == {"kp": 6000, "kv": 150, "ki": 3000.0, "imax": 2.0 / 3000.0}
    with_slew = copy.deepcopy(j2c); with_slew["loop"]["slewLimit"] = 0.5
    assert actuator_spec(j2m, with_slew)["attrs"] == {"kp": 6000, "kv": 150, "ki": 0, "slewmax": 0.5}


def test_actuator_spec_refuses_what_it_cannot_express():
    m, c = doc("serve-drive-nominal-v1.json"), doc("serve-control-v1.json")
    bad_i = copy.deepcopy(c["axes"][0]); bad_i["loop"]["ki"] = 1.0
    bad_kd = copy.deepcopy(c["axes"][0]); bad_kd["loop"]["kd"] = 0.1
    accel = copy.deepcopy(doc("xarm6-control-v1.json")["axes"][0]); accel["accelerationLimit"] = 5.0
    for axis_m, axis_c in ((m["axes"][0], bad_i), (m["axes"][0], bad_kd), (doc("xarm6-drive-nominal-v1.json")["axes"][0], accel)):
        with pytest.raises(WorkerError) as e:
            actuator_spec(axis_m, axis_c)
        assert e.value.code == "DRIVE_DOCUMENT_INVALID"


def test_plan_actuators_gives_each_axis_its_own_group():
    plan = plan_actuators(doc("xarm6-drive-nominal-v1.json"), doc("xarm6-control-v1.json"))
    assert [p["group"] for p in plan.values()] == [1, 2, 3, 4, 5, 6, 7]
    with pytest.raises(WorkerError):
        plan_actuators(doc("serve-drive-nominal-v1.json"), doc("xarm6-control-v1.json"))
