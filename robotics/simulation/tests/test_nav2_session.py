"""Simulated Nav2 bridge (SIM-01/04/09): the worker speaks an allowlisted JSON-lines protocol, keeps a durable command->goal table and maps Nav2
goal status through the agent's Nav2Navigation port. Everything here runs on a FAKE action client: it proves the protocol and the terminal-state
mapping, never Gazebo/Nav2 physics (evidence label `protocol`)."""
import io
import json
import uuid
from pathlib import Path

import pytest

from bridge import protocol
from bridge.launch_plan import launch_argv, nav2_params_file, nav2_params_overlay, plan_launch
from bridge.nav2_session import Nav2Session, serve
from compiler.compile_world import compile_world
from mekoniq_agent.nav2_adapter import Nav2Config, Nav2Navigation
from tests.support.fake_action_client import FakeActionClient
from tests.support.fixtures import localization_fixture

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "digital-twin"
TARGET = {"waypointId": "table-1", "mapId": "lab-world", "mapRevision": "1", "frame": "map", "x": 6.1, "y": 2.3, "yaw": -0.3}


class FakePorts:
    """Injected in place of ROS launch + rclpy: one FakeActionClient per robot namespace, launch/close counted, nothing spawned."""
    evidence = "protocol"

    def __init__(self, robots, localization=None, **client_kw):
        loc = localization_fixture(map_id="lab-world", map_revision="1", **(localization or {}))  # the compiled map identity, not the agent's map-a
        self.clients = {ns: FakeActionClient(localization=loc, **client_kw) for ns in robots}
        self.launched = self.closed = 0
        self.paused = []
        self.health_reasons = []       # what a real port learns from the process, /clock and every Nav2 lifecycle
        self.clock = 123_000_000

    def health(self):
        return {"alive": not self.health_reasons, "reasons": list(self.health_reasons)}

    def clock_ns(self):
        return self.clock

    def launch(self):
        self.launched += 1

    def navigation_for(self, namespace):
        return Nav2Navigation(self.clients[namespace], Nav2Config(namespace=namespace, map_id="lab-world", map_revision="1"))

    def pause(self, paused):
        self.paused.append(paused)
        return True

    def close(self):
        self.closed += 1


def session(tmp_path, robots=("robot_amr_1",), **client_kw):
    ports = FakePorts(robots, **client_kw)
    return Nav2Session(ports, run_id="run-1", robots=list(robots), state_dir=tmp_path), ports


def execute_args(command_id="cmd-1", robot="robot_amr_1", **over):
    return {"commandId": command_id, "robotId": robot, "target": {**TARGET, **over.pop("target", {})}, "expiresAt": "2026-11-05T00:01:00Z", **over}


# ---- durable identity and single physical send ----------------------------------------------------------------------------------
def test_execute_accepts_once_and_a_repeated_command_id_never_sends_a_second_goal(tmp_path):
    s, ports = session(tmp_path)
    first = s.execute(execute_args())
    assert first["status"] == "accepted" and first["nativeGoalId"] == str(uuid.uuid5(protocol.GOAL_NAMESPACE, "run-1/robot_amr_1/cmd-1"))
    again = s.execute(execute_args())
    assert again == first and len(ports.clients["robot_amr_1"].sent) == 1
    # a restarted worker over the same state directory still answers by command id without resending
    s2, ports2 = session(tmp_path)
    ports2.clients["robot_amr_1"].goals = ports.clients["robot_amr_1"].goals  # the action server outlives the worker
    assert s2.query({"commandId": "cmd-1", "robotId": "robot_amr_1"})["status"] == "executing"
    assert len(ports2.clients["robot_amr_1"].sent) == 0


@pytest.mark.parametrize("terminal,error_code,expected,reason", [
    ("SUCCEEDED", 0, "completed", None), ("SUCCEEDED", 9, "failed", "NAV2_ERROR_CODE"), ("SUCCEEDED", None, "unknown", "RESULT_UNAVAILABLE"),
    ("CANCELED", 0, "cancelled", None), ("ABORTED", 0, "failed", "NAV2_ABORTED")])
def test_only_an_accepted_succeeded_goal_with_error_code_zero_completes(tmp_path, terminal, error_code, expected, reason):
    s, ports = session(tmp_path)
    s.execute(execute_args())
    ports.clients["robot_amr_1"].settle(s.query({"commandId": "cmd-1", "robotId": "robot_amr_1"})["nativeGoalId"], terminal, error_code)
    q = s.query({"commandId": "cmd-1", "robotId": "robot_amr_1"})
    assert q["status"] == expected and q["evidence"]["reason"] == reason and q["evidence"]["nav2Status"] == terminal


def test_accepted_only_and_forgotten_goals_never_complete(tmp_path):
    s, ports = session(tmp_path)
    s.execute(execute_args())
    assert s.query({"commandId": "cmd-1", "robotId": "robot_amr_1"})["status"] == "executing"
    ports.clients["robot_amr_1"].forget()
    q = s.query({"commandId": "cmd-1", "robotId": "robot_amr_1"})
    assert q["status"] == "unknown" and q["evidence"]["reason"] == "NOT_LISTED"
    assert s.query({"commandId": "never-sent", "robotId": "robot_amr_1"}) == {"commandId": "never-sent", "status": "unknown", "evidence": {"reason": "NOT_JOURNALED"}}


def test_stale_map_and_poor_localization_are_rejected_before_any_send(tmp_path):
    s, ports = session(tmp_path)
    stale = s.execute(execute_args(target={"mapRevision": "0"}))
    assert stale["status"] == "rejected" and stale["reason"] == "MAP_MISMATCH"
    s2, ports2 = session(tmp_path / "b", localization={"var_x": 0.5})
    poor = s2.execute(execute_args())
    assert poor["status"] == "rejected" and poor["reason"] == "COVARIANCE_TOO_LARGE"
    assert len(ports.clients["robot_amr_1"].sent) == 0 and len(ports2.clients["robot_amr_1"].sent) == 0
    assert s.execute(execute_args("cmd-2", robot="robot_nope"))["reason"] == "ROBOT_UNKNOWN"


def test_no_reply_is_unknown_and_is_never_resent(tmp_path):
    s, ports = session(tmp_path)
    ports.clients["robot_amr_1"].unreachable = True
    lost = s.execute(execute_args())
    assert lost["status"] == "unknown" and lost["reason"] == "NO_ACK"
    assert s.execute(execute_args())["status"] == "unknown"          # same id: the recorded answer, no second start()
    assert s.query({"commandId": "cmd-1", "robotId": "robot_amr_1"})["status"] == "unknown"
    ports.clients["robot_amr_1"].unreachable = False
    assert s.execute(execute_args())["status"] == "unknown"          # the link is back: still the recorded answer, no physical send
    assert len(ports.clients["robot_amr_1"].sent) == 0                # the fake raises before recording a send; nothing is ever sent twice


def test_cancel_and_stop_are_requests_not_outcomes(tmp_path):
    s, ports = session(tmp_path)
    s.execute(execute_args())
    assert s.cancel({"commandId": "cmd-1", "robotId": "robot_amr_1"}) == {"commandId": "cmd-1", "acknowledged": True, "unknown": False}
    assert s.query({"commandId": "cmd-1", "robotId": "robot_amr_1"})["status"] == "executing"  # CANCELING is still active
    assert s.stop({"robotId": "robot_amr_1", "reason": "operator"}) == {"robotId": "robot_amr_1", "acknowledged": True, "physicalStopConfirmed": False}


def test_capability_is_honest_about_step_and_evidence(tmp_path):
    s, ports = session(tmp_path)
    cap = s.capability()
    assert cap["backendId"] == "gazebo_nav2" and cap["step"] is False and cap["available"] is True and cap["evidence"] == "protocol"
    assert cap["robots"] == ["robot_amr_1"] and cap["bootId"]
    # a port that cannot see a live process, /clock or a ready Nav2 lifecycle never answers available/sil: the orchestrator must refuse, not attempt
    ports.health_reasons = ["WORKER_PROCESS_DOWN", "NAV2_NOT_READY:robot_amr_1:LOCALIZATION_UNAVAILABLE"]
    down = s.capability()
    assert down["available"] is False and down["evidence"] == "none" and down["reasons"] == ports.health_reasons
    with pytest.raises(protocol.ProtocolError) as e:
        s.step({"targetTimeNs": "1000"})
    assert e.value.code == "STEP_UNSUPPORTED"
    assert s.pause({"paused": True}) == {"acknowledged": True, "paused": True} and ports.paused == [True]


class Crash(BaseException):
    """Escapes `except Exception`: the worker dies mid-send (power loss, SIGKILL)."""


def test_execute_journals_the_goal_before_the_send_so_a_crash_mid_send_never_resends(tmp_path):
    s, ports = session(tmp_path)
    client = ports.clients["robot_amr_1"]

    def crash(goal_id, pose):
        raise Crash()
    client.send_goal = crash
    with pytest.raises(Crash):
        s.execute(execute_args("cmd-x"))
    table = json.loads((tmp_path / "nav2-commands.json").read_text())
    assert table["cmd-x"]["status"] == "sending" and "answer" not in table["cmd-x"] and table["cmd-x"]["goalUuid"]
    # a restarted worker finds the row: the goal may exist on Nav2, so the answer is unknown and no second goal is ever sent
    restarted, ports2 = session(tmp_path)
    assert restarted.execute(execute_args("cmd-x")) == {"commandId": "cmd-x", "status": "unknown", "reason": "SEND_INTERRUPTED", "nativeGoalId": table["cmd-x"]["goalUuid"]}
    assert ports2.clients["robot_amr_1"].sent == []
    q = restarted.query({"commandId": "cmd-x", "robotId": "robot_amr_1"})
    assert q["status"] == "unknown" and q["evidence"]["reason"] == "SEND_INTERRUPTED" and q["nativeGoalId"] == table["cmd-x"]["goalUuid"]
    # a completed send is journaled as answered
    s2, _ = session(tmp_path / "b")
    s2.execute(execute_args("cmd-ok"))
    assert json.loads((tmp_path / "b" / "nav2-commands.json").read_text())["cmd-ok"]["status"] == "answered"


def test_barrier_answers_each_participant_with_the_worker_clocks_and_refuses_unknown_robots(tmp_path):
    s, ports = session(tmp_path, robots=("robot_a", "robot_b"))
    r = s.barrier(protocol.validate_args("barrier", {"barrierId": "transfer-1", "participants": ["robot_a", "robot_b"]}))
    assert r["barrierId"] == "transfer-1" and [a["participant"] for a in r["acks"]] == ["robot_a", "robot_b"]
    assert all(a["simTimeNs"] == "123000000" and a["clockNs"].isdigit() for a in r["acks"])
    ports.clock = None
    assert s.barrier({"barrierId": "t2", "participants": ["robot_a"]})["acks"][0]["simTimeNs"] is None   # no /clock: an ack without sim time, never a made-up one
    with pytest.raises(protocol.ProtocolError) as e:
        s.barrier({"barrierId": "t3", "participants": ["robot_zz"]})
    assert e.value.code == "ROBOT_UNKNOWN"
    with pytest.raises(protocol.ProtocolError):
        protocol.validate_args("barrier", {"barrierId": "t4", "participants": "robot_a"})


# ---- protocol allowlist ----------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("line,code", [
    ('{"id":"1","op":"launch","args":{}}', "OP_NOT_ALLOWED"),
    ('{"id":"1","op":"execute","args":{"commandId":"c","robotId":"r","target":{},"expiresAt":"x","topic":"/cmd_vel"}}', "ARGS_UNKNOWN_FIELD"),
    ('{"id":"1","op":"execute","args":{"commandId":"c","robotId":"r","target":{"waypointId":"t","mapId":"m","mapRevision":"1","frame":"map","x":1,"y":2},"expiresAt":"x","shell":"rm -rf"}}', "ARGS_UNKNOWN_FIELD"),
    ('{"id":"1","op":"execute","args":{"commandId":"c","robotId":"r","target":{"waypointId":"t","mapId":"m","mapRevision":"1","frame":"map","x":"1","y":2},"expiresAt":"x"}}', "ARGS_INVALID"),
    ('{"id":"1","op":"execute","args":{"commandId":"../c","robotId":"r","target":{"waypointId":"t","mapId":"m","mapRevision":"1","frame":"map","x":1,"y":2},"expiresAt":"x"}}', "ARGS_INVALID"),
    ('{"id":"1","op":"query"}', "REQUEST_SHAPE"), ('{"id":"1","op":"query","args":{},"extra":1}', "REQUEST_SHAPE"),
    ('{"id":"1","id":"2","op":"query","args":{}}', "INVALID_JSON"), ('not json', "INVALID_JSON"), ('{"id":"1","op":"query","args":{"commandId":NaN}}', "INVALID_JSON")])
def test_protocol_rejects_anything_outside_the_allowlist(line, code):
    with pytest.raises(protocol.ProtocolError) as e:
        protocol.parse_request(line)
    assert e.value.code == code


def test_serve_answers_each_request_by_id_and_reports_errors_without_exiting(tmp_path):
    s, ports = session(tmp_path)
    stdin = io.StringIO("\n".join([
        json.dumps({"id": "a", "op": "capability", "args": {}}),
        json.dumps({"id": "b", "op": "execute", "args": execute_args()}),
        json.dumps({"id": "c", "op": "nope", "args": {}}),
        json.dumps({"id": "d", "op": "query", "args": {"commandId": "cmd-1", "robotId": "robot_amr_1"}}),
        json.dumps({"id": "e", "op": "close", "args": {}})]) + "\n")
    stdout = io.StringIO()
    serve(stdin, stdout, s)
    replies = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert [r["id"] for r in replies] == ["a", "b", "c", "d", "e"]
    assert replies[1]["ok"] and replies[1]["result"]["status"] == "accepted"
    assert replies[2] == {"id": "c", "ok": False, "error": {"code": "OP_NOT_ALLOWED", "detail": "nope"}}
    assert replies[3]["result"]["status"] == "executing" and replies[4]["result"] == {"closed": True}
    assert ports.closed == 1


# ---- launch plan from a compiled bundle (pure: the ROS launch file consumes this) --------------------------------------------------
def test_launch_plan_reads_the_compiled_bundle_and_builds_a_fixed_argv(tmp_path):
    fx = json.loads((FIXTURES / "restaurant-v2.json").read_text())
    assets = [json.loads((FIXTURES / f).read_text()) for f in fx["assetFiles"]]
    compile_world(fx["project"], assets, tmp_path / "bundle")
    plan = plan_launch(tmp_path / "bundle", ["robot_amr_1"])
    assert plan["world"] == str(tmp_path / "bundle" / "world.sdf") and plan["map"] == str(tmp_path / "bundle" / "map.yaml")
    assert plan["mapId"] == "lab-world" and plan["mapRevision"] == "1"
    r = plan["robots"][0]
    assert r["namespace"] == "robot_amr_1" and r["urdf"].endswith("robot-amr-1.urdf") and r["spawn"] == {"x": 1.5, "y": 1.0, "yaw": 0.0}
    assert r["params"]["robot_radius"] > 0.4 and r["params"]["footprint"].startswith("[[") and r["params"]["use_sim_time"] == "true"
    argv = launch_argv(tmp_path / "bundle", ["robot_amr_1"])
    assert argv[:4] == ["ros2", "launch", "mekoniq_simulation", "lab_world.launch.py"] and f"bundle:={tmp_path / 'bundle'}" in argv and "robots:=robot_amr_1" in argv and "headless:=true" in argv
    with pytest.raises(protocol.ProtocolError) as e:
        plan_launch(tmp_path / "bundle", ["robot_nope"])
    assert e.value.code == "ROBOT_UNKNOWN"
    with pytest.raises(protocol.ProtocolError) as e:
        launch_argv(tmp_path / "bundle", ["Robot;rm"])
    assert e.value.code == "NAMESPACE_INVALID"
    with pytest.raises(protocol.ProtocolError) as e:
        plan_launch(tmp_path / "nope", ["robot_amr_1"])
    assert e.value.code == "BUNDLE_MISSING"
    launch = Path(__file__).resolve().parents[1] / "launch" / "lab_world.launch.py"
    compile(launch.read_text(encoding="utf-8"), str(launch), "exec")  # ROS launch modules are not importable here; syntax only
    assert "plan_launch" in launch.read_text() and "headless-rendering" in launch.read_text()


def test_the_compiled_nav2_overlay_becomes_a_full_params_file_the_launch_passes_to_nav2(tmp_path):
    import yaml
    fx = json.loads((FIXTURES / "restaurant-v2.json").read_text())
    out = compile_world(fx["project"], [json.loads((FIXTURES / f).read_text()) for f in fx["assetFiles"]], tmp_path / "bundle")
    plan = plan_launch(tmp_path / "bundle", [r["namespace"] for r in out["robots"]])
    robot = plan["robots"][0]
    defaults = tmp_path / "nav2_params.yaml"
    defaults.write_text("amcl:\n  ros__parameters:\n    set_initial_pose: false\n    initial_pose: {x: 9.0, y: 9.0, z: 0.0, yaw: 1.0}\nlocal_costmap:\n  local_costmap:\n    ros__parameters:\n      robot_radius: 0.375\n"
                        "global_costmap:\n  global_costmap:\n    ros__parameters:\n      robot_radius: 0.375\nvelocity_smoother:\n  ros__parameters:\n    max_velocity: [0.9, 0.0, 1.0]\n")
    path = nav2_params_file(tmp_path / "bundle", robot, defaults)
    merged = yaml.safe_load(Path(path).read_text())
    p = robot["params"]
    assert merged["amcl"]["ros__parameters"]["set_initial_pose"] is True
    assert merged["amcl"]["ros__parameters"]["initial_pose"] == {"x": p["initial_pose_x"], "y": p["initial_pose_y"], "z": 0.0, "yaw": p["initial_pose_yaw"]}
    for cm in ("local_costmap", "global_costmap"):
        assert merged[cm][cm]["ros__parameters"]["robot_radius"] == p["robot_radius"] and merged[cm][cm]["ros__parameters"]["footprint"] == p["footprint"]
    assert merged["velocity_smoother"]["ros__parameters"]["max_velocity"] == [p["max_linear_mps"], 0.0, 1.0]
    assert Path(path).name == f"nav2-{robot['entityId']}.params.yaml"
    # a defaults document without those nodes still gets every overlay key (no silent drop)
    bare = nav2_params_overlay({}, p)
    assert bare["amcl"]["ros__parameters"]["initial_pose"]["x"] == p["initial_pose_x"] and bare["velocity_smoother"]["ros__parameters"]["max_velocity"][0] == p["max_linear_mps"]


def test_main_collects_static_world_telemetry_without_scenario_argument(tmp_path, monkeypatch):
    import bridge.nav2_session as worker
    from bridge.scene_loop import SceneLoop
    robot = {'namespace': 'robot_amr_1', 'entityId': 'amr-1', 'footprint': {'min': [-.3, -.3], 'max': [.3, .3]}}
    (tmp_path / 'compiler-manifest.json').write_text(json.dumps({'robots': [robot]}))
    ports = FakePorts(['robot_amr_1'])
    ports.poses = lambda: {}
    ports.contacts = lambda: {}
    monkeypatch.setattr(worker, 'RosPorts', lambda *a: ports)
    events = []
    monkeypatch.setattr(worker, '_emit', lambda stdout, lock, kind, payload: events.append((kind, payload)))
    # Run the real collection step deterministically at the thread boundary; no ROS or Gazebo on this host.
    monkeypatch.setattr(SceneLoop, 'run', lambda self, stop: self.step())
    class InlineThread:
        def __init__(self, target, args, **kwargs):
            self.target, self.args = target, args
        def start(self):
            self.target(*self.args)
        def join(self, timeout=None):
            pass
    monkeypatch.setattr(worker.threading, 'Thread', InlineThread)
    monkeypatch.setattr(worker.sys, 'stdin', io.StringIO(''))
    monkeypatch.setattr(worker.sys, 'stdout', io.StringIO())
    worker.main(['--bundle', str(tmp_path), '--run-id', 'static', '--robots', 'robot_amr_1', '--state-dir', str(tmp_path / 'state')])
    assert any(kind == 'telemetry' for kind, _ in events)
    assert any(kind == 'contact-sensor' for kind, _ in events)


def test_health_and_collection_share_one_scene_node_during_startup(tmp_path, monkeypatch):
    import threading
    import time
    import bridge.nav2_session as worker
    fx = json.loads((FIXTURES / 'restaurant-v2.json').read_text())
    compile_world(fx['project'], [json.loads((FIXTURES / f).read_text()) for f in fx['assetFiles']], tmp_path / 'bundle')
    ports = worker.RosPorts(tmp_path / 'bundle', ['robot_amr_1'])
    constructed = []
    class Scene:
        def __init__(self, plan, models):
            constructed.append(self)
            time.sleep(.02)  # rclpy node creation yields while health and collection both request it
    monkeypatch.setattr(worker, '_SceneNode', Scene)
    nodes = []
    threads = [threading.Thread(target=lambda: nodes.append(ports._node())) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(constructed) == 1
    assert nodes[0] is nodes[1]

def test_correlated_barrier_requires_new_sensor_samples_and_rejects_rotating_robot(tmp_path):
    """Fresh actual snapshots are generated after request, not cached telemetry ACKs."""
    import math
    import time
    from types import SimpleNamespace
    from bridge.telemetry import TelemetryStream
    s, ports = session(tmp_path)
    n = [0]
    rotating = [False]
    def poses():
        n[0] += 1
        yaw = n[0]*.2 if rotating[0] else 0
        return {'robot_amr_1':{'sequence':n[0],'simTimeNs':n[0]*20_000_000,'receivedMonotonicNs':time.monotonic_ns(),
                'value':{'position':{'x':1.,'y':2.,'z':0.},'orientation':{'x':0.,'y':0.,'z':math.sin(yaw/2),'w':math.cos(yaw/2)}}}}
    ports.poses=poses
    ports.localization=lambda:{'robot_amr_1':{'value':{'valid':True,'positionM':[1.,2.,0.]},'receivedMonotonicNs':time.monotonic_ns(),'simTimeNs':n[0]*20_000_000}}
    stream=TelemetryStream('run-1','gazebo_nav2',s.boot_id)
    s.scene_loop=SimpleNamespace(streams={'amr-1':stream},by_entity_inverse=lambda:{'robot_amr_1':'amr-1'},emit=lambda *a:None)
    args={'barrierId':'run-1:load','participants':['robot_amr_1'],'nonce':'nonce-1','bootId':s.boot_id,'afterSeq':'0','state':'stationary'}
    proof=s.barrier(args)['acks'][0]
    assert proof['nonce']=='nonce-1' and int(proof['seq'])>0
    rotating[0]=True
    with pytest.raises(protocol.ProtocolError,match='BARRIER_STATE_UNPROVEN'):
        s.barrier({**args,'nonce':'nonce-2','afterSeq':proof['seq']})
