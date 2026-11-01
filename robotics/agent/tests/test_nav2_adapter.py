import math
import uuid

import pytest
from mekoniq_agent.executor import Executor, NativeRejected
from mekoniq_agent.nav2_adapter import (ABORTED, CANCELED, EXECUTING, SUCCEEDED, GoalState, Localization, Nav2Config, Nav2Navigation,
                                        NavigationResult, quaternion_to_yaw, yaw_to_quaternion)
from .support.executor_fixtures import NOW_MS, command_fixture, profile_fixture
from .support.fake_action_client import FakeActionClient
from .support.fixtures import goal_fixture, localization_fixture

G = goal_fixture()["goal_uuid"]


def started(client=None, **kw):
    adapter = Nav2Navigation(client or FakeActionClient(), **kw)
    adapter.start(**goal_fixture())
    return adapter


# -- the plan's invariant: only an accepted, SUCCEEDED, error_code == 0 goal completes ----------------------------------------------
def test_rejected_or_aborted_nav2_goal_never_completes():
    adapter = Nav2Navigation(FakeActionClient(accepted=True, terminal="ABORTED"))
    adapter.start(**goal_fixture())
    result = adapter.poll()
    assert isinstance(result, NavigationResult) and result.status == "failed"
    assert result.completed is False


def test_rejected_goal_raises_and_never_completes():
    client = FakeActionClient(accepted=False)
    adapter = Nav2Navigation(client)
    with pytest.raises(NativeRejected) as e:
        adapter.start(**goal_fixture())
    assert e.value.reason == "NAV2_GOAL_REJECTED" and len(client.sent) == 1
    assert adapter.poll() == NavigationResult(status="rejected", completed=False, reason="NAV2_GOAL_REJECTED")
    assert adapter.query(G).status == "not_found" and adapter.query(G).completed is False


def test_succeeded_with_zero_error_code_completes():
    adapter = started(FakeActionClient(terminal="SUCCEEDED", error_code=0))
    assert adapter.poll().status == "completed" and adapter.poll().completed is True
    native = adapter.query(G)
    assert native.status == "succeeded" and native.completed and native.evidence["errorCode"] == 0


def test_succeeded_with_nonzero_error_code_fails():
    adapter = started(FakeActionClient(terminal="SUCCEEDED", error_code=9999))
    assert adapter.poll().status == "failed" and adapter.poll().completed is False
    assert adapter.query(G).status == "aborted" and not adapter.query(G).completed


def test_succeeded_without_retrievable_result_is_unknown_not_completed():
    adapter = started(FakeActionClient(terminal="SUCCEEDED", error_code=None))
    assert adapter.poll().status == "unknown" and adapter.poll().completed is False
    assert adapter.query(G).status == "unknown"


@pytest.mark.parametrize("terminal,expected", [("CANCELED", "canceled"), ("ABORTED", "aborted")])
def test_canceled_and_aborted_are_terminal_but_never_complete(terminal, expected):
    adapter = started(FakeActionClient(terminal=terminal, error_code=0))
    assert adapter.query(G).status == expected and adapter.query(G).completed is False


def test_active_goal_is_not_completed_and_unlisted_goal_is_not_found():
    adapter = started()
    assert adapter.poll().status == "active" and adapter.query(G).status == "executing"
    assert adapter.query(str(uuid.uuid4())).status == "not_found"


def test_unknown_goal_status_codes_never_complete():
    client = FakeActionClient()
    adapter = started(client)
    for code in (0, 7, 99):
        client.settle(G, code, 0)
        assert adapter.query(G).status == "unknown" and not adapter.query(G).completed


# -- goal identity / restart --------------------------------------------------------------------------------------------------------
def test_executor_goal_uuid_is_the_ros_goal_id_and_survives_adapter_restart():
    client = FakeActionClient()
    started(client)
    assert client.sent[0][0] == G
    restarted = Nav2Navigation(client)  # a new agent process: no in-memory goal handle
    assert restarted.query(G).status == "executing"
    client.settle(G, "SUCCEEDED", 0)
    assert restarted.query(G).completed
    client.forget(G)  # Nav2 no longer lists it: never guessed
    assert restarted.query(G).status == "not_found"


def test_query_propagates_unreachable_so_the_executor_keeps_the_goal_unreconciled():
    client = FakeActionClient()
    adapter = started(client)
    client.unreachable = True
    with pytest.raises(ConnectionError):
        adapter.query(G)


def test_send_failure_after_dispatch_is_not_a_rejection():
    client = FakeActionClient()
    client.unreachable = True
    with pytest.raises(ConnectionError):  # no ACK: the executor journals unknown, not rejected
        Nav2Navigation(client).start(**goal_fixture())


# -- cancel / stop: request is not confirmation ------------------------------------------------------------------------------------
def test_cancel_request_is_separate_from_cancel_confirmation():
    client = FakeActionClient()
    adapter = started(client)
    assert adapter.cancel(G) is True and client.cancel_requests == [G]
    assert adapter.query(G).status == "canceling" and adapter.query(G).completed is False
    client.settle(G, "CANCELED")
    assert adapter.query(G).status == "canceled"


def test_unacknowledged_cancel_and_stop_return_false():
    client = FakeActionClient()
    adapter = started(client)
    client.ack_cancel = False
    assert adapter.cancel(G) is False and adapter.request_stop() is False
    client.ack_cancel = True
    assert adapter.request_stop() is True and client.cancel_all_count == 2
    assert adapter.query(G).status == "canceling"  # the stop request did not make it terminal


# -- localization readiness gates start -------------------------------------------------------------------------------------------
@pytest.mark.parametrize("override,reason", [
    ({"lifecycle": {**localization_fixture().lifecycle, "amcl": "inactive"}}, "LIFECYCLE_NOT_ACTIVE:amcl"),
    ({"lifecycle": {k: v for k, v in localization_fixture().lifecycle.items() if k != "controller_server"}}, "LIFECYCLE_NOT_ACTIVE:controller_server"),
    ({"pose": None}, "LOCALIZATION_UNAVAILABLE"),
    ({"var_x": math.nan}, "LOCALIZATION_UNAVAILABLE"),
    ({"var_yaw": None}, "LOCALIZATION_UNAVAILABLE"),
    ({"var_x": -0.1}, "LOCALIZATION_UNAVAILABLE"),
    ({"var_x": 0.5}, "COVARIANCE_TOO_LARGE"),
    ({"var_y": 0.5}, "COVARIANCE_TOO_LARGE"),
    ({"var_yaw": 0.5}, "COVARIANCE_TOO_LARGE"),
    ({"map_id": "map-b"}, "MAP_MISMATCH"),
    ({"map_revision": "r2"}, "MAP_MISMATCH"),
    ({"frame": "odom"}, "FRAME_MISMATCH"),
])
def test_localization_not_ready_refuses_start_with_a_reason(override, reason):
    client = FakeActionClient(localization=localization_fixture(**override))
    adapter = Nav2Navigation(client)
    assert adapter.not_ready_reason() == reason
    with pytest.raises(NativeRejected) as e:
        adapter.start(**goal_fixture())
    assert e.value.reason == reason and client.sent == []


def test_localization_probe_failure_refuses_without_sending():
    client = FakeActionClient()
    client.localization_error = True
    with pytest.raises(NativeRejected) as e:
        Nav2Navigation(client).start(**goal_fixture())
    assert e.value.reason == "LOCALIZATION_UNAVAILABLE" and client.sent == []


def test_ready_localization_and_config_bounds():
    assert Nav2Navigation(FakeActionClient(localization=localization_fixture(var_x=-1.5e-13, var_y=0.0))).not_ready_reason() is None  # float noise
    assert Nav2Navigation(FakeActionClient()).not_ready_reason() is None
    tight = Nav2Config(max_position_variance_m2=0.001)
    assert Nav2Navigation(FakeActionClient(), tight).not_ready_reason() == "COVARIANCE_TOO_LARGE"


def test_config_is_bound_to_the_provisioned_profile_and_namespace():
    cfg = Nav2Config.for_profile(profile_fixture(map_id="map-z", map_revision="r9"), namespace="robot_1")
    assert (cfg.map_id, cfg.map_revision, cfg.map_frame) == ("map-z", "r9", "map")
    assert cfg.action_name == "/robot_1/navigate_to_pose" and cfg.node_path("amcl") == "/robot_1/amcl"
    assert (cfg.odom_frame, cfg.base_frame) == ("odom", "base_link")
    flat = Nav2Config()
    assert flat.action_name == "/navigate_to_pose" and flat.node_path("amcl") == "/amcl"


# -- target / SI units / quaternion ------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("yaw", [0.0, 0.5, -0.5, math.pi / 2, -math.pi / 2, 3.0, -3.0])
def test_quaternion_yaw_roundtrip(yaw):
    assert quaternion_to_yaw(*yaw_to_quaternion(yaw)) == pytest.approx(yaw, abs=1e-12)


def test_quaternion_known_values_and_wrapping():
    qx, qy, qz, qw = yaw_to_quaternion(math.pi / 2)
    assert (qx, qy) == (0.0, 0.0) and qz == pytest.approx(math.sqrt(0.5)) and qw == pytest.approx(math.sqrt(0.5))
    assert quaternion_to_yaw(0, 0, 1, 0) == pytest.approx(math.pi)  # 180 degrees about z
    assert quaternion_to_yaw(*yaw_to_quaternion(2 * math.pi + 0.3)) == pytest.approx(0.3)  # wrapped to (-pi, pi]
    assert math.sqrt(sum(c * c for c in yaw_to_quaternion(1.234))) == pytest.approx(1.0)


def test_goal_pose_is_in_the_map_frame_si_units_with_the_yaw_quaternion():
    client = FakeActionClient()
    started(client)
    goal_id, pose = client.sent[0]
    assert goal_id == G and pose.frame == "map" and (pose.x, pose.y) == (2.5, 1.2)
    assert quaternion_to_yaw(pose.qx, pose.qy, pose.qz, pose.qw) == pytest.approx(0.5)


@pytest.mark.parametrize("patch", [{"frame": "odom"}, {"x": math.nan}, {"y": math.inf}, {"yaw": None}, {"yaw": math.nan}, {"x": True}, {"x": "2.5"},
                                   {"mapId": "map-b"}, {"mapRevision": "r2"}])
def test_invalid_or_foreign_targets_are_rejected_before_dispatch(patch):
    client = FakeActionClient()
    goal = goal_fixture()
    goal["target"].update(patch)
    with pytest.raises(NativeRejected):
        Nav2Navigation(client).start(**goal)
    assert client.sent == []


# -- speed limit: carried or refused, never ignored ---------------------------------------------------------------------------------
def test_speed_limit_is_published_in_mps_before_the_goal_and_cleared_when_absent():
    client = FakeActionClient()
    adapter = Nav2Navigation(client)
    assert adapter.supports_speed_limit is True
    adapter.start(**goal_fixture(speed_limit_mps=0.4))
    adapter.start(**goal_fixture(goal_uuid=str(uuid.uuid4()), speed_limit_mps=None))
    assert client.speed_limits == [0.4, 0.0]  # 0.0 = Nav2 "no limit": a stale limit never leaks into the next goal


def test_speed_limit_failure_refuses_without_dispatch_and_unsupported_client_is_declared():
    client = FakeActionClient()
    client.speed_error = True
    with pytest.raises(NativeRejected) as e:
        Nav2Navigation(client).start(**goal_fixture(speed_limit_mps=0.4))
    assert e.value.reason == "SPEED_LIMIT_NOT_APPLIED" and client.sent == []
    assert Nav2Navigation(FakeActionClient(supports_speed_limit=False)).supports_speed_limit is False


@pytest.mark.parametrize("limit", [0, -1, math.nan, math.inf, True])
def test_invalid_speed_limit_is_refused(limit):
    client = FakeActionClient()
    with pytest.raises(NativeRejected):
        Nav2Navigation(client).start(**goal_fixture(speed_limit_mps=limit))
    assert client.sent == []


# -- through the W06-T03 executor ---------------------------------------------------------------------------------------------------
def test_executor_completes_only_on_nav2_success_and_rebinds_after_restart(tmp_path):
    client, profile = FakeActionClient(), profile_fixture()
    command = command_fixture(now_ms=NOW_MS, limits={"trays": 1, "maxLoadMinor": "5000", "speedLimitMps": 0.5})
    command["target"]["yaw"] = 0.5
    first = Executor(tmp_path / "a.db", Nav2Navigation(client), profile, clock=lambda: NOW_MS)
    assert first.submit(command)["accepted"] is True
    goal = first.state("c-1")["evidence"]["goalUuid"]
    assert client.sent[0][0] == goal and client.speed_limits == [0.5]
    first.close()
    second = Executor(tmp_path / "a.db", Nav2Navigation(client), profile, clock=lambda: NOW_MS)  # agent restart, Nav2 untouched
    second.reconcile()
    assert second.status("c-1") == "executing" and second.state("c-1")["completed"] is False
    client.settle(goal, "SUCCEEDED", 0)
    second.reconcile()
    assert second.state("c-1")["completed"] is True and len(client.sent) == 1


def test_executor_keeps_goal_unknown_when_nav2_no_longer_lists_it(tmp_path):
    client = FakeActionClient()
    ex = Executor(tmp_path / "a.db", Nav2Navigation(client), profile_fixture(), clock=lambda: NOW_MS)
    command = command_fixture(now_ms=NOW_MS)
    command["target"]["yaw"] = 0
    ex.submit(command)
    client.forget()
    ex.reconcile()
    assert ex.status("c-1") == "unknown" and ex.state("c-1")["completed"] is False
    second = command_fixture("c-2", now_ms=NOW_MS)
    second["target"]["yaw"] = 0
    assert ex.submit(second)["reason"] == "GOAL_UNRECONCILED" and len(client.sent) == 1  # unlisted != never arrived: nothing is resent


def test_executor_refuses_a_rejected_nav2_goal_with_its_reason(tmp_path):
    client = FakeActionClient(accepted=False)
    ex = Executor(tmp_path / "a.db", Nav2Navigation(client), profile_fixture(), clock=lambda: NOW_MS)
    command = command_fixture(now_ms=NOW_MS)
    command["target"]["yaw"] = 0
    result = ex.submit(command)
    assert result["accepted"] is False and result["reason"] == "NAV2_GOAL_REJECTED"
