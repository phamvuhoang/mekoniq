import json
import os
import signal
import sqlite3
import subprocess
import sys
import textwrap
import uuid

import pytest
from mekoniq_agent.executor import Executor, SimulatedCrash
from mekoniq_agent.journal import ExecutorError
from .support.executor_fixtures import NOW_MS, FakeNativeNavigation, command_fixture, profile_fixture

PROFILE = profile_fixture()


def make(path, native, **kw):
    kw.setdefault("clock", lambda: NOW_MS)
    return Executor(path, native, PROFILE, **kw)


def at_now(command_id="c-1", **kw):
    return command_fixture(command_id=command_id, now_ms=NOW_MS, **kw)


def test_crash_after_native_accept_does_not_start_second_goal(tmp_path):
    native = FakeNativeNavigation()
    command = command_fixture(command_id="c-1", control_epoch=3)
    first = Executor(tmp_path / "agent.db", native, PROFILE, fault="after_native_accept")
    with pytest.raises(SimulatedCrash):
        first.submit(command)
    recovered = Executor(tmp_path / "agent.db", native, PROFILE)
    recovered.reconcile()
    recovered.submit(command)
    assert native.start_count == 1
    assert recovered.status("c-1") in {"executing", "unknown"}


def test_o10_recovery_reattaches_the_same_native_goal_by_uuid(tmp_path):
    native, command = FakeNativeNavigation(), at_now()
    with pytest.raises(SimulatedCrash):
        make(tmp_path / "a.db", native, fault="after_native_accept").submit(command)
    recovered = make(tmp_path / "a.db", native)
    assert not recovered.ready  # recovery has not asked the native side yet: not advertised, no new goals
    assert recovered.status("c-1") == "unknown" and recovered.state("c-1")["evidence"]["reason"] == "CRASH_BEFORE_RECEIPT"
    assert recovered.submit(at_now("c-2", control_epoch=3))["reason"] == "NOT_READY"
    recovered.reconcile()
    assert recovered.ready and recovered.status("c-1") == "executing"
    state = recovered.state("c-1")
    assert list(native.goals()) == [state["evidence"]["goalUuid"]] and state["completed"] is False
    assert recovered.submit(command) == {"accepted": True, "unknown": False, "nativeGoalId": state["evidence"]["goalUuid"]}
    assert native.start_count == 1


def test_crash_before_native_call_is_never_resent(tmp_path):
    native, command = FakeNativeNavigation(), at_now()
    with pytest.raises(SimulatedCrash):
        make(tmp_path / "a.db", native, fault="before_native_call").submit(command)
    recovered = make(tmp_path / "a.db", native)
    recovered.reconcile()
    # The goal never reached the native side as far as it can tell, but "never arrived" is indistinguishable from "arrived and forgotten".
    assert recovered.status("c-1") == "unknown" and recovered.state("c-1")["evidence"]["reason"] == "NATIVE_NOT_FOUND"
    assert recovered.submit(command)["unknown"] is True
    assert native.start_count == 0


def test_journal_row_and_goal_uuid_are_committed_before_the_native_call(tmp_path):
    seen = []
    def probe(goal_uuid):  # runs inside native.start, with an independent connection to the same file
        row = sqlite3.connect(tmp_path / "a.db").execute("SELECT state,goal_uuid FROM executor_command WHERE command_id='c-1'").fetchone()
        seen.append((row, goal_uuid))
    native = FakeNativeNavigation()
    native.on_start = probe
    make(tmp_path / "a.db", native).submit(at_now())
    assert seen == [(("sending", seen[0][1]), seen[0][1])] and str(uuid.UUID(seen[0][1])) == seen[0][1]


def test_no_ack_is_unknown_and_never_resent(tmp_path):
    native = FakeNativeNavigation()
    native.drop_ack = True
    ex = make(tmp_path / "a.db", native)
    assert ex.submit(at_now())["unknown"] is True and ex.status("c-1") == "unknown"
    assert ex.submit(at_now())["unknown"] is True and native.start_count == 1
    ex.reconcile()  # the goal did arrive: ownership is recovered by UUID, still no second start
    assert ex.status("c-1") == "executing" and native.start_count == 1


def test_idempotency_by_command_id_and_hash(tmp_path):
    native, ex = FakeNativeNavigation(), None
    ex = make(tmp_path / "a.db", native)
    first = ex.submit(at_now())
    assert first["accepted"] and ex.submit(at_now()) == first and native.start_count == 1
    with pytest.raises(ExecutorError, match="IDEMPOTENCY_CONFLICT"):
        ex.submit(at_now(limits={"trays": 1, "maxLoadMinor": "5001"}))
    assert native.start_count == 1


def test_native_rejection_is_terminal_and_explicit(tmp_path):
    native = FakeNativeNavigation()
    native.reject_next = True
    ex = make(tmp_path / "a.db", native)
    assert ex.submit(at_now()) == {"accepted": False, "unknown": False, "reason": "GOAL_REJECTED", "nativeGoalId": ex.state("c-1")["evidence"]["goalUuid"]}
    assert ex.status("c-1") == "terminal" and ex.state("c-1")["completed"] is False
    assert ex.submit(at_now("c-2"))["accepted"]  # a rejected goal does not block the next one


@pytest.mark.parametrize("overrides,epoch,reason", [
    ({}, 2, "STALE_CONTROL_EPOCH"),
    ({}, 5, "CONTROL_EPOCH_OUT_OF_RANGE"),  # forged far-future epoch
    ({"organizationId": "org-b"}, 3, "SCOPE_MISMATCH"),
    ({"venueId": "venue-b"}, 3, "SCOPE_MISMATCH"),
    ({"robotId": "robot-2"}, 3, "ROBOT_MISMATCH"),
    ({"target": {"waypointId": "t", "mapId": "other", "mapRevision": "r1", "frame": "map", "x": 1, "y": 1}}, 3, "MAP_MISMATCH"),
    ({"target": {"waypointId": "t", "mapId": "map-a", "mapRevision": "r2", "frame": "map", "x": 1, "y": 1}}, 3, "MAP_MISMATCH"),
    ({"target": {"waypointId": "t", "mapId": "map-a", "mapRevision": "r1", "frame": "odom", "x": 1, "y": 1}}, 3, "FRAME_MISMATCH"),
    ({"target": {"waypointId": "t", "mapId": "map-a", "mapRevision": "r1", "frame": "map", "x": "1", "y": 1}}, 3, "INVALID_TARGET"),
    ({"schemaVersion": 2}, 3, "INVALID_COMMAND"),
    ({"limits": {"trays": 1, "maxLoadMinor": "5000", "speedLimitMps": 0.3}}, 3, "SPEED_UNSUPPORTED"),
])
def test_refusals_never_reach_the_native_side(tmp_path, overrides, epoch, reason):
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    assert ex.submit(at_now(control_epoch=epoch, **overrides)) == {"accepted": False, "unknown": False, "reason": reason}
    assert native.start_count == 0 and ex.status("c-1") == "unknown"  # nothing journaled for a refused command


def test_expired_stale_and_skewed_commands(tmp_path):
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    assert ex.submit(command_fixture(now_ms=NOW_MS - 120000, ttl_ms=60000))["reason"] == "EXPIRED_COMMAND"   # O11: old command replayed after heal
    assert ex.submit(command_fixture("c-2", now_ms=NOW_MS - 60000, ttl_ms=60000))["reason"] == "EXPIRED_COMMAND"  # expiry instant is exclusive
    assert ex.submit(command_fixture("c-3", now_ms=NOW_MS + 31000))["reason"] == "CLOCK_SKEW"                     # issuer clock ahead
    assert ex.submit(command_fixture("c-4", now_ms=NOW_MS, ttl_ms=301000))["reason"] == "CLOCK_SKEW"              # lifetime beyond the bound
    assert ex.submit(command_fixture("c-5", now_ms=NOW_MS + 29000))["accepted"]                                   # within tolerated skew
    assert native.start_count == 1


def test_speed_limit_is_carried_when_the_backend_can_honour_it(tmp_path):
    native = FakeNativeNavigation(supports_speed_limit=True)
    ex = make(tmp_path / "a.db", native)
    assert ex.submit(at_now(limits={"trays": 1, "maxLoadMinor": "5000", "speedLimitMps": 0.3}))["accepted"]
    assert [g["speedLimitMps"] for g in native.goals().values()] == [0.3]


def test_control_epoch_is_persisted_and_a_refused_command_does_not_move_it(tmp_path):
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    assert ex.submit(at_now(control_epoch=9))["reason"] == "CONTROL_EPOCH_OUT_OF_RANGE"
    assert ex.journal.control_epoch("robot-1") == 3  # one bad value cannot fence out later commands
    assert ex.submit(at_now("c-2", control_epoch=4))["accepted"]
    ex.close()
    again = make(tmp_path / "a.db", native)  # reboot with the old provisioned epoch: the persisted one wins
    again.reconcile()
    assert again.submit(at_now("c-3", control_epoch=3))["reason"] == "STALE_CONTROL_EPOCH"


def test_only_one_executor_per_robot(tmp_path):
    make(tmp_path / "a.db", FakeNativeNavigation()).close()
    with pytest.raises(ExecutorError, match="EXECUTOR_ALREADY_BOUND"):
        Executor(tmp_path / "a.db", FakeNativeNavigation(), profile_fixture(executor_id="agent-2"))


def test_o20_handoff_is_refused_while_a_goal_is_unreconciled(tmp_path):
    native, command = FakeNativeNavigation(), at_now()
    with pytest.raises(SimulatedCrash):
        make(tmp_path / "a.db", native, fault="after_native_accept").submit(command)
    native.unreachable = True  # partition: cannot ask the robot
    ex = make(tmp_path / "a.db", native)
    ex.reconcile()
    assert not ex.ready and ex.status("c-1") == "unknown"
    handoff = at_now("c-2", control_epoch=4)  # new owner, next control epoch
    assert ex.submit(handoff)["reason"] == "NOT_READY"
    native.unreachable = False
    ex.reconcile()
    assert ex.submit(handoff)["reason"] == "PREVIOUS_GOAL_ACTIVE"  # still driving: the new owner must cancel first
    assert ex.journal.control_epoch("robot-1") == 3 and native.start_count == 1
    ex.cancel("c-1")
    native.settle(ex.state("c-1")["evidence"]["goalUuid"], "canceled")
    assert ex.submit(handoff)["accepted"] and ex.journal.control_epoch("robot-1") == 4


def test_unknown_goal_blocks_new_goals_until_the_native_side_resolves_it(tmp_path):
    native = FakeNativeNavigation()
    native.drop_ack = True
    ex = make(tmp_path / "a.db", native)
    ex.submit(at_now())
    native.settle(ex.state("c-1")["evidence"]["goalUuid"], "forget")  # native side lost it: not found, still not safe to assume stopped
    assert ex.submit(at_now("c-2"))["reason"] == "GOAL_UNRECONCILED"
    assert native.start_count == 1


def test_o11_partition_then_heal_does_not_replay_an_expired_command(tmp_path):
    native = FakeNativeNavigation()
    native.unreachable = True
    now = [NOW_MS]
    ex = make(tmp_path / "a.db", native, clock=lambda: now[0])
    old = command_fixture(now_ms=NOW_MS, ttl_ms=60000)
    assert ex.submit(old) == {"accepted": False, "unknown": True, "reason": "NO_ACK", "nativeGoalId": ex.state("c-1")["evidence"]["goalUuid"]}
    native.unreachable, now[0] = False, NOW_MS + 120000  # healed after the command expired
    assert ex.submit(old)["unknown"] is True  # same id: the journal answers, no new start
    ex.reconcile()
    assert native.start_count == 0 and ex.status("c-1") == "unknown"
    assert ex.submit(command_fixture("c-2", now_ms=NOW_MS, ttl_ms=60000))["reason"] == "EXPIRED_COMMAND"


def test_terminal_states_and_completed_only_from_native_success(tmp_path):
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    ex.submit(at_now())
    goal = ex.state("c-1")["evidence"]["goalUuid"]
    assert ex.reconcile()["c-1"]["completed"] is False and ex.status("c-1") == "executing"
    native.settle(goal, "succeeded")
    done = ex.reconcile()
    assert ex.status("c-1") == "terminal" and ex.state("c-1")["completed"] is True and done == {"c-1": ex.state("c-1")}
    assert ex.reconcile() == {}  # terminal rows are not re-queried
    assert ex.submit(at_now("c-2"))["accepted"]
    native.settle(ex.state("c-2")["evidence"]["goalUuid"], "aborted")
    ex.reconcile()
    assert ex.state("c-2")["completed"] is False and ex.state("c-2")["evidence"]["outcome"] == "aborted"


def test_one_goal_at_a_time(tmp_path):
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    ex.submit(at_now())
    assert ex.submit(at_now("c-2"))["reason"] == "PREVIOUS_GOAL_ACTIVE" and native.start_count == 1


def test_request_stop_is_a_request_and_is_retried_until_acknowledged(tmp_path):
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    ex.submit(at_now())
    native.ack_stop = False
    assert ex.request_stop("operator") == {"acknowledged": False, "physicalStopConfirmed": False}
    assert ex.status("c-1") == "unknown" and not ex.ready
    assert ex.submit(at_now("c-2"))["reason"] == "STOP_UNCONFIRMED"
    ex.tick()
    assert ex.journal.stop_pending("robot-1")  # still unacknowledged: STOP intent survives
    ex.close()
    ex = make(tmp_path / "a.db", native)  # even across a restart
    assert not ex.ready and ex.journal.stop_pending("robot-1")
    native.ack_stop = True
    ex.tick()
    assert not ex.journal.stop_pending("robot-1") and ex.ready and ex.status("c-1") == "executing"  # acked, but the goal is only terminal when native says so
    with pytest.raises(ExecutorError, match="STOP_REASON_REQUIRED"):
        ex.request_stop(" ")


def test_cancel_is_scoped_to_one_command_and_retried(tmp_path):
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    ex.submit(at_now())
    native.ack_cancel = False
    assert ex.cancel("c-1") == {"acknowledged": False, "unknown": False} and ex.cancel("nope") == {"acknowledged": False, "unknown": True}
    native.ack_cancel = True
    ex.tick()
    assert ex.state("c-1")["evidence"]["cancelPending"] is False and native.goals()[ex.state("c-1")["evidence"]["goalUuid"]]["status"] == "canceling"
    native.settle(ex.state("c-1")["evidence"]["goalUuid"], "canceled")
    ex.reconcile()
    assert ex.status("c-1") == "terminal" and ex.state("c-1")["evidence"]["outcome"] == "canceled" and native.stop_count == 0


CHILD = textwrap.dedent("""
    import os, sys, time
    sys.path.insert(0, sys.argv[4])
    from mekoniq_agent.executor import Executor
    from tests.support.executor_fixtures import FakeNativeNavigation, command_fixture, profile_fixture, NOW_MS
    native = FakeNativeNavigation(sys.argv[2])
    real_start = native.start
    def start(goal, target, limit=None):
        real_start(goal, target, limit)          # native has accepted and persisted the goal ...
        open(sys.argv[3], "w").write("accepted")  # ... tell the parent, then wait to be killed before the receipt is journaled
        time.sleep(60)
    native.start = start
    Executor(sys.argv[1], native, profile_fixture(), clock=lambda: NOW_MS).submit(command_fixture(now_ms=NOW_MS))
""")


def test_sigkill_after_native_accept_is_recovered_without_a_second_goal(tmp_path):
    marker = tmp_path / "marker"
    agent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    child = subprocess.Popen([sys.executable, "-c", CHILD, str(tmp_path / "a.db"), str(tmp_path / "native.json"), str(marker), agent_dir])
    try:
        for _ in range(300):
            if marker.exists():
                break
            if child.poll() is not None:
                pytest.fail(f"child exited early: {child.returncode}")
            subprocess.run(["sleep", "0.1"])
        else:
            pytest.fail("child never reached native accept")
        os.kill(child.pid, signal.SIGKILL)
        assert child.wait(10) == -signal.SIGKILL
    finally:
        child.kill()
    native = FakeNativeNavigation(tmp_path / "native.json")
    recovered = make(tmp_path / "a.db", native)
    assert recovered.status("c-1") == "unknown" and recovered.state("c-1")["evidence"]["reason"] == "CRASH_BEFORE_RECEIPT"
    recovered.reconcile()
    assert recovered.status("c-1") == "executing"
    assert recovered.submit(command_fixture(now_ms=NOW_MS))["accepted"] is True
    assert native.start_count == 1 and len(native.goals()) == 1


@pytest.mark.parametrize("field,value", [("issuedAt", "2026-13-45T25:61:00Z"), ("expiresAt", "soonZ"), ("issuedAt", "2026-11-01T00:00:00+07:00")])
def test_garbage_date_time_is_invalid_command_not_an_executor_error(tmp_path, field, value):
    from mekoniq_agent import ownership
    native = FakeNativeNavigation()
    ex = make(tmp_path / "a.db", native)
    command = {**at_now(), field: value}
    assert ex.submit(command) == {"accepted": False, "unknown": False, "reason": "INVALID_COMMAND"}  # schema format check (rfc3339-validator)
    assert ownership.time_reason(command, NOW_MS, PROFILE) == "INVALID_COMMAND"  # and the time window maps a bad value itself
    assert native.start_count == 0
