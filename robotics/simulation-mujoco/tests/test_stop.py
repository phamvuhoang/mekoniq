"""R5 / E12: the worker side of the emergency stop (contracts 4). Pure DriveGroup cases, no engine: the stop acts on the drive's state machine only, before the command channel and before the tick's commands."""
import pytest

from mujoco_worker.protocol import WorkerError
from test_drive_model import Rig

L, R = "amr-1/wheel-left", "amr-1/wheel-right"


def stop(entry="s1", axes=(L, R)):
    return {"entryId": entry, "function": "emergency", "axes": list(axes)}


def cruising(edit=None):
    r = Rig(edit=edit)
    r.enable_all()
    r.tick(target=8.0)
    r.tick(target=8.0)
    return r


def stopped_tick(r, injections, **kw):
    r.g.stage_stops(injections)
    tick = r.g.tick
    r.g.begin_tick(r.commands(**kw))
    r.run_substeps()
    return tick, r.g.take_stop_receipts()


def test_emergency_stop_wins_over_a_motion_command_in_the_same_tick():
    r = cruising()
    n = len(r.log)
    tick, receipts = stopped_tick(r, [stop()], target=8.0)
    assert r.states() == ["fault", "fault"] and r.faults() == ["EXTERNAL_TRIP", "EXTERNAL_TRIP"]
    assert all(not any(out["active"]) for out in r.log[n:])           # no substep of the tick drives either axis
    assert max(abs(c) for out in r.log[n:] for c in out["ctrl"]) == 0.0
    assert receipts == [{"entryId": "s1", "function": "emergency", "appliedBy": "worker", "appliedTick": tick}]


def test_the_stop_acts_on_the_named_axes_only():
    r = cruising()
    stopped_tick(r, [stop(axes=[L])], target=8.0)
    assert r.states() == ["fault", "enabled"]


def test_a_coast_model_lets_the_axis_go_and_a_brake_model_brakes():
    def coast(m):
        for a in m["axes"]:
            a["onDisable"], a["brakeTorqueNm"] = "coast", None
    def brake(m):
        for a in m["axes"]:
            a["onDisable"], a["brakeTorqueNm"] = "brake", 6.0
    for edit, expected in ((coast, False), (brake, True)):
        r = cruising(edit)
        n = len(r.log)
        stopped_tick(r, [stop()], target=8.0)
        assert all(out["braked"] == [expected, expected] for out in r.log[n:])


def test_a_fault_reset_edge_of_the_stop_tick_does_not_clear_the_stop_and_a_later_edge_does():
    r = cruising()
    stopped_tick(r, [stop()], target=8.0, faultReset=True)           # the edge arrives with the stop
    assert r.states() == ["fault", "fault"]
    r.tick(target=0.0, faultReset=True)                              # held at 1: no new edge
    assert r.states() == ["fault", "fault"]
    r.tick(target=0.0, faultReset=False)
    r.tick(target=0.0, faultReset=True)                              # a rising edge after the stop is over
    assert "fault" not in r.states() and r.faults() == [None, None]


def test_an_axis_that_is_already_latched_keeps_its_own_fault():
    r = cruising()
    r.g.trip(L, "OVERSPEED")
    stopped_tick(r, [stop()], target=0.0)
    assert r.faults() == ["OVERSPEED", "EXTERNAL_TRIP"]


@pytest.mark.parametrize("injections,code", [
    ([stop(axes=["amr-1/nope"])], "STOP_AXIS_UNKNOWN"),
    ([stop(axes=[L, L])], "STOP_INJECTION_INVALID"),
    ([stop(axes=[])], "STOP_INJECTION_INVALID"),
    ([{**stop(), "function": "protective"}], "STOP_INJECTION_INVALID"),
    ([stop("a"), stop("a")], "STOP_INJECTION_INVALID"),
    ([stop(f"s{i}") for i in range(5)], "STOP_INJECTION_INVALID"),
    ("emergency", "STOP_INJECTION_INVALID"),
])
def test_a_refused_stop_changes_nothing(injections, code):
    r = cruising()
    before = r.snapshot()
    with pytest.raises(WorkerError) as e:
        r.g.stage_stops(injections)
    assert e.value.code == code and r.snapshot() == before and r.g.staged_stops is None


def test_a_tick_without_a_stop_is_the_same_as_before():
    a, b = cruising(), cruising()
    b.g.stage_stops([])
    for r in (a, b):
        r.tick(target=8.0)
    assert a.snapshot() == b.snapshot() and b.g.take_stop_receipts() == []
