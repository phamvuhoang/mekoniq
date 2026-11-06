"""Simulation worker: serves the stdio protocol for one run's compiled world. Goals go through the agent's Nav2Navigation port (the same terminal
semantics as the onboard executor: only accepted + SUCCEEDED + error_code 0 completes); the command -> goal table is durable on disk and written
BEFORE a send, so a restarted worker answers by command id and never resends. The scene loop (scene_loop.py) scripts the world and reports
telemetry/contacts/separation as events on the same stdout. ROS/launch live only behind `RosPorts`; tests inject fake ports (evidence `protocol`)."""
import argparse
import hashlib
import json
import math
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from . import protocol
from .launch_plan import launch_argv, plan_launch
from .protocol import ProtocolError

VERSION = "1"
KIDNAP_M = 2.0  # localization-lost: the robot model is moved this far without its odometry knowing (AMCL loses the pose; goals are refused)


def _agent_path():
    """mekoniq_agent is an editable install in the dev venv and a sibling source tree inside the colcon workspace / Docker image."""
    try:
        import mekoniq_agent  # noqa: F401
    except ImportError:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "agent"))


def partition_env(run_id, env=None):
    """Per-run ROS domain (1..100) and Gazebo partition derived from the run id, unless the caller already pinned them: two runs on one host never share a graph."""
    out = dict(os.environ if env is None else env)
    digest = int(hashlib.sha256(run_id.encode()).hexdigest()[:8], 16)
    out.setdefault("ROS_DOMAIN_ID", str(1 + digest % 100))
    out.setdefault("GZ_PARTITION", f"lab-{run_id}")
    return out


class _SceneNode:
    """One rclpy node spun on its own thread: /clock, ground-truth model poses and contact sensors (bridged by lab_world.launch.py), actor cmd_vel."""

    def __init__(self, plan, models):
        import rclpy
        from geometry_msgs.msg import Twist, PoseWithCovarianceStamped
        from ros_gz_interfaces.msg import Contacts
        from rosgraph_msgs.msg import Clock
        from tf2_msgs.msg import TFMessage
        if not rclpy.ok():
            rclpy.init(args=[])
        self.node = rclpy.create_node("lab_scene_ports")
        self.clock = None
        self.pose = {}
        self.contact = {}
        self.localization = {}
        self.node.create_subscription(Clock, "/clock", self._on_clock, 10)
        for m in models:
            self.node.create_subscription(TFMessage, f"/model/{m}/pose", lambda msg, m=m: self._on_pose(m, msg), 10)
        for ns in plan["robots"]:
            self.node.create_subscription(Contacts, f"/model/{ns['namespace']}/contacts", lambda msg, ns=ns["namespace"]: self._on_contacts(ns, msg), 10)
            self.node.create_subscription(PoseWithCovarianceStamped, f"/{ns['namespace']}/amcl_pose", lambda msg, ns=ns["namespace"]: self._on_localization(ns, msg), 10)
        self.twist = {m: self.node.create_publisher(Twist, f"/model/{m}/cmd_vel", 10) for m in plan["actors"]}
        self._Twist = Twist
        self.executor = rclpy.executors.SingleThreadedExecutor()
        self.executor.add_node(self.node)
        self.thread = threading.Thread(target=self.executor.spin, name="lab-scene-spin", daemon=True)
        self.thread.start()

    def _on_clock(self, msg):
        self.clock = int(msg.clock.sec) * 1_000_000_000 + int(msg.clock.nanosec)

    def _on_pose(self, model, msg):
        if not msg.transforms:
            return
        t = msg.transforms[0].transform
        value = {"position": {"x": t.translation.x, "y": t.translation.y, "z": t.translation.z},
                            "orientation": {"x": t.rotation.x, "y": t.rotation.y, "z": t.rotation.z, "w": t.rotation.w}}
        stamp = getattr(getattr(msg.transforms[0], "header", None), "stamp", None)
        self._record(self.pose, model, value, int(stamp.sec)*1_000_000_000+int(stamp.nanosec) if stamp else None)

    def _on_localization(self, ns, msg):
        p, covariance = msg.pose.pose.position, list(msg.pose.covariance)
        finite = all(math.isfinite(x) for x in covariance) and all(math.isfinite(x) for x in (p.x,p.y,p.z))
        valid = finite and len(covariance) == 36 and all(0 <= covariance[i] <= .05**2 for i in (0,7))
        self._record(self.localization, ns, {"positionM": [p.x,p.y,p.z], "valid": valid}, int(msg.header.stamp.sec)*1_000_000_000+int(msg.header.stamp.nanosec))

    def _on_contacts(self, ns, msg):
        value = {"contact": [{"collision1": {"name": c.collision1.name}, "collision2": {"name": c.collision2.name},
                                         "position": [{"x": p.x, "y": p.y, "z": p.z} for p in c.positions], "normal": [{"x": n.x, "y": n.y, "z": n.z} for n in c.normals],
                                         "depth": list(c.depths)} for c in msg.contacts]}
        self._record(self.contact, ns, value)

    def _record(self, cache, key, value, sim_time_ns=None):
        # Immutable receipt envelope: a later /clock tick cannot renew the sensor sample.
        cache[key] = {"value": value, "simTimeNs": self.clock if sim_time_ns is None else sim_time_ns, "receivedMonotonicNs": time.monotonic_ns(),
                      "sequence": cache.get(key, {}).get("sequence", 0) + 1}

    def set_velocity(self, model, vx, vy):
        pub = self.twist.get(model)
        if pub is None:
            return False
        t = self._Twist()
        t.linear.x, t.linear.y = float(vx), float(vy)
        pub.publish(t)
        return True

    def close(self):
        try:
            self.executor.shutdown(timeout_sec=1.0)
            self.node.destroy_node()
        except Exception:
            pass


class RosPorts:
    """Real ports: `ros2 launch` of the compiled world (own process group), one rclpy action client per robot namespace, one scene node. Linux + Jazzy only."""
    evidence = "sil"

    def __init__(self, bundle_dir, robots, log_path=None):
        self.plan, self.robots = plan_launch(bundle_dir, robots), list(robots)
        self.bundle, self.log_path = Path(bundle_dir), log_path
        self._proc = self._log = self._scene = None
        self._scene_lock = threading.Lock()
        self._clients = {}

    def launch(self):
        if self._proc is not None:
            return
        self._log = open(self.log_path, "w") if self.log_path else subprocess.DEVNULL
        self._proc = subprocess.Popen(launch_argv(self.bundle, self.robots), stdout=self._log, stderr=subprocess.STDOUT, start_new_session=True, shell=False)

    def navigation_for(self, namespace):
        _agent_path()
        from mekoniq_agent.nav2_adapter import Nav2Config, Nav2Navigation
        from mekoniq_agent.nav2_rclpy import RclpyActionClient
        if namespace not in self._clients:
            config = Nav2Config(namespace=namespace, map_id=self.plan["mapId"], map_revision=self.plan["mapRevision"])
            self._clients[namespace] = Nav2Navigation(RclpyActionClient(config), config)
        return self._clients[namespace]

    def _node(self):
        with self._scene_lock:
            if self._scene is None:
                self._scene = _SceneNode(self.plan, [r["namespace"] for r in self.plan["robots"]] + list(self.plan["actors"]) + list(self.plan["blockers"]) + list(self.plan["cups"]))
            return self._scene

    # ---- what the worker learns ----
    def health(self):
        """Process, world clock and every Nav2 lifecycle; any reason makes the backend unavailable (never `sil` evidence on a dead stack)."""
        reasons = []
        if self._proc is None or self._proc.poll() is not None:
            reasons.append("WORKER_PROCESS_DOWN")
        if self.clock_ns() is None:
            reasons.append("CLOCK_MISSING")
        for ns in self.robots:
            try:
                r = self.navigation_for(ns).not_ready_reason()
            except Exception as e:  # noqa: BLE001 - an unreachable lifecycle is a reason, not a crash
                r = type(e).__name__
            if r:
                reasons.append(f"NAV2_NOT_READY:{ns}:{r}")
        return {"alive": not reasons, "reasons": reasons}

    def clock_ns(self):
        try:
            return self._node().clock
        except Exception:
            return None

    def poses(self):
        return dict(self._node().pose)

    def localization(self):
        return dict(self._node().localization)

    def contacts(self):
        node = self._node()
        return {ns: node.contact.get(ns) for ns in self.robots}

    # ---- what the worker tells Gazebo ----
    def set_velocity(self, model, vx, vy):
        return self._node().set_velocity(model, vx, vy)

    def set_pose(self, model, x, y, z, yaw=0.0):
        req = f'name: "{model}", position {{x: {float(x)}, y: {float(y)}, z: {float(z)}}}, orientation {{z: {math.sin(yaw / 2)}, w: {math.cos(yaw / 2)}}}'
        done = subprocess.run(["gz", "service", "-s", "/world/lab/set_pose", "--reqtype", "gz.msgs.Pose", "--reptype", "gz.msgs.Boolean", "--timeout", "3000", "--req", req],
                              capture_output=True, text=True, timeout=10, shell=False)
        return done.returncode == 0 and "true" in done.stdout

    def inject_fault(self, fault, namespace):
        if fault["faultId"] == "localization-lost":
            raw = self.poses().get(namespace)
            if raw is None:
                return False
            p = raw["value"]["position"]
            return self.set_pose(namespace, p["x"] + KIDNAP_M, p["y"] + KIDNAP_M, p["z"])  # kidnapped: odometry and AMCL disagree from here on
        return False

    def pause(self, paused):
        """Gazebo world control: pause/unpause the physics clock. Acknowledged only when the service replied; no step/seek is offered."""
        req = "pause: true" if paused else "pause: false"
        done = subprocess.run(["gz", "service", "-s", "/world/lab/control", "--reqtype", "gz.msgs.WorldControl", "--reptype", "gz.msgs.Boolean", "--timeout", "3000", "--req", req],
                              capture_output=True, text=True, timeout=10, shell=False)
        return done.returncode == 0 and "true" in done.stdout

    def close(self):
        for client in self._clients.values():
            try:
                client.client.close()
            except Exception:
                pass
        if self._scene is not None:
            self._scene.close()
        if self._proc is not None and self._proc.poll() is None:
            os.killpg(self._proc.pid, signal.SIGINT)  # only the process group this worker started
            try:
                self._proc.wait(60)
            except subprocess.TimeoutExpired:
                os.killpg(self._proc.pid, signal.SIGKILL)
        if self._log not in (None, subprocess.DEVNULL):
            self._log.close()


class Nav2Session:
    def __init__(self, ports, run_id, robots, state_dir):
        self.ports, self.run_id, self.robots = ports, run_id, list(robots)
        self.boot_id = f"worker-{uuid.uuid4()}"
        self._nav = {}
        self._state_file = Path(state_dir) / "nav2-commands.json"
        self._table = json.loads(self._state_file.read_text()) if self._state_file.is_file() else {}
        ports.launch()

    # ---- durable command table ----
    def _save(self):
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._table, sort_keys=True))
        os.replace(tmp, self._state_file)

    def _navigation(self, robot_id):
        if robot_id not in self.robots:
            raise ProtocolError("ROBOT_UNKNOWN", robot_id)
        if robot_id not in self._nav:
            self._nav[robot_id] = self.ports.navigation_for(robot_id)
        return self._nav[robot_id]

    @staticmethod
    def _interrupted(row):
        return {"commandId": None, "status": "unknown", "reason": "SEND_INTERRUPTED", "nativeGoalId": row["goalUuid"]}

    # ---- operations (names == protocol ops) ----
    def capability(self, args=None):
        health = self.ports.health()
        alive = bool(health.get("alive")) and not health.get("reasons")
        return {"backendId": "gazebo_nav2", "version": VERSION, "available": alive, "step": False, "reasons": list(health.get("reasons") or []),
                "evidence": self.ports.evidence if alive else "none", "bootId": self.boot_id, "runId": self.run_id, "robots": list(self.robots), "beverage": self.scene_loop.tray_readiness() if getattr(self,"scene_loop",None) else {"available": False,"reasonCodes":["TRAY_OBSERVER_UNCONFIGURED"]}}

    def execute(self, args):
        protocol.validate_args("execute", args)
        command_id, robot_id = args["commandId"], args["robotId"]
        row = self._table.get(command_id)
        if row is not None:
            if "answer" in row:
                return dict(row["answer"])  # same id: the first answer, never a second goal
            return dict(self._interrupted(row), commandId=command_id)  # journaled, send interrupted: the goal may exist on Nav2
        if robot_id not in self.robots:
            return {"commandId": command_id, "status": "rejected", "reason": "ROBOT_UNKNOWN"}
        _agent_path()
        from mekoniq_agent.executor import NativeRejected
        goal = str(uuid.uuid5(protocol.GOAL_NAMESPACE, f"{self.run_id}/{robot_id}/{command_id}"))
        nav = self._navigation(robot_id)
        self._table[command_id] = {"robotId": robot_id, "goalUuid": goal, "status": "sending"}
        self._save()  # journal first: a crash from here on is answered as unknown, never by a second goal
        try:
            nav.start(goal, dict(args["target"]), args.get("speedLimitMps"))
        except NativeRejected as e:
            answer = {"commandId": command_id, "status": "rejected", "reason": e.reason}
        except Exception:  # no reply: the goal may or may not exist on the action server
            answer = {"commandId": command_id, "status": "unknown", "reason": "NO_ACK", "nativeGoalId": goal}
        else:
            answer = {"commandId": command_id, "status": "accepted", "nativeGoalId": goal}
        self._table[command_id] = {"robotId": robot_id, "goalUuid": goal, "status": "answered", "answer": answer}
        self._save()
        return dict(answer)

    def query(self, args):
        protocol.validate_args("query", args)
        command_id = args["commandId"]
        row = self._table.get(command_id)
        if row is None:
            return {"commandId": command_id, "status": "unknown", "evidence": {"reason": "NOT_JOURNALED"}}
        if "answer" not in row:
            return {"commandId": command_id, "status": "unknown", "nativeGoalId": row["goalUuid"], "evidence": {"reason": "SEND_INTERRUPTED", "nav2Status": None, "errorCode": None}}
        if row["answer"]["status"] == "rejected":
            return {"commandId": command_id, "status": "failed", "nativeGoalId": row["goalUuid"], "evidence": {"reason": row["answer"]["reason"], "nav2Status": None, "errorCode": None}}
        try:
            result = self._navigation(row["robotId"]).query(row["goalUuid"])
        except Exception:
            return {"commandId": command_id, "status": "unknown", "nativeGoalId": row["goalUuid"], "evidence": {"reason": "NATIVE_UNREACHABLE", "nav2Status": None, "errorCode": None}}
        ev = result.evidence
        return {"commandId": command_id, "status": protocol.terminal_state(result.status), "nativeGoalId": row["goalUuid"],
                "evidence": {"reason": ev.get("reason"), "nav2Status": ev.get("nav2Status"), "errorCode": ev.get("errorCode"), "native": result.status}}

    def cancel(self, args):
        protocol.validate_args("cancel", args)
        row = self._table.get(args["commandId"])
        if row is None or "answer" not in row or row["answer"]["status"] == "rejected":
            return {"commandId": args["commandId"], "acknowledged": False, "unknown": row is None or "answer" not in row}
        try:
            ok = bool(self._navigation(row["robotId"]).cancel(row["goalUuid"]))
        except Exception:
            ok = False
        return {"commandId": args["commandId"], "acknowledged": ok, "unknown": False}

    def stop(self, args):
        protocol.validate_args("stop", args)
        try:
            ok = bool(self._navigation(args["robotId"]).request_stop())
        except ProtocolError:
            raise
        except Exception:
            ok = False
        return {"robotId": args["robotId"], "acknowledged": ok, "physicalStopConfirmed": False}

    def pause(self, args):
        protocol.validate_args("pause", args)
        ok = bool(self.ports.pause(args["paused"]))
        return {"acknowledged": ok, "paused": args["paused"] if ok else None}

    def step(self, args):
        raise ProtocolError("STEP_UNSUPPORTED", "gazebo_nav2 runs on its own /clock; no deterministic step/seek is offered")

    def barrier(self, args):
        """Clock mapping at a transfer moment: each participant acks with the world clock (sim) and this worker's monotonic clock. Never a made-up sim time."""
        protocol.validate_args("barrier", args)
        for ns in args["participants"]:
            if ns not in self.robots:
                raise ProtocolError("ROBOT_UNKNOWN", ns)
        if args.get("nonce") is not None:
            if args.get("bootId") != self.boot_id or args.get("state") != "stationary" or len(args["participants"]) != 1 or args.get("afterSeq") is None:
                raise ProtocolError("BARRIER_PROOF_MISMATCH")
            ns = args["participants"][0]
            began = time.monotonic_ns()
            previous = None
            from .telemetry import pose_from_gz
            while time.monotonic_ns() - began < 500_000_000:
                receipt = (self.ports.poses() or {}).get(ns)
                loc = (self.ports.localization() or {}).get(ns)
                if receipt and loc and loc["value"].get("valid") is True and receipt.get("receivedMonotonicNs", 0) > began and loc.get("receivedMonotonicNs", 0) > began:
                    pose = pose_from_gz(receipt["value"])
                    dt = (receipt["simTimeNs"] - previous[2]) / 1e9 if previous else 0
                    angular = abs(math.atan2(math.sin(pose["yawRad"]-previous[1]["yawRad"]),math.cos(pose["yawRad"]-previous[1]["yawRad"]))) if previous else math.inf
                    if previous and receipt["sequence"] != previous[0] and 0 < dt <= .5 and math.hypot(pose["xM"]-previous[1]["xM"],pose["yM"]-previous[1]["yM"])/dt <= .02 and angular/dt <= .02:
                        stream = self.scene_loop.streams[self.scene_loop.by_entity_inverse()[ns]]
                        sample = stream.sample(self.scene_loop.by_entity_inverse()[ns], "map", receipt["simTimeNs"], pose)
                        self.scene_loop.emit("telemetry", sample)
                        if int(sample["seq"]) <= int(args["afterSeq"]):
                            raise ProtocolError("BARRIER_SEQUENCE_MISMATCH")
                        return {"barrierId":args["barrierId"], "acks":[{"participant":ns,"nonce":args["nonce"],"bootId":self.boot_id,"seq":sample["seq"],"state":"stationary","simTimeNs":str(receipt["simTimeNs"]),"clockNs":str(time.monotonic_ns())}]}
                    previous = (receipt["sequence"], pose, receipt["simTimeNs"])
                time.sleep(0.01)
            raise ProtocolError("BARRIER_STATE_UNPROVEN")
        sim = self.ports.clock_ns()
        clock = str(time.monotonic_ns())
        return {"barrierId": args["barrierId"], "acks": [{"participant": ns, "simTimeNs": None if sim is None else str(int(sim)), "clockNs": clock} for ns in args["participants"]]}

    def bind_transfer(self, args):
        protocol.validate_args("bind_transfer", args)
        if not getattr(self, "scene_loop", None):
            raise ProtocolError("TRAY_OBSERVER_UNCONFIGURED")
        try:
            return self.scene_loop.bind_transfer(args)
        except ValueError as e:
            raise ProtocolError(str(e)) from e

    def cup_pose(self, args):
        protocol.validate_args("cup_pose", args)
        if args["runId"] != self.run_id or not getattr(self, "scene_loop", None) or not self.scene_loop.tray_observer:
            raise ProtocolError("TRAY_OBSERVER_UNCONFIGURED")
        observer = self.scene_loop.tray_observer
        if args["worldRevision"] != observer.world_revision:
            raise ProtocolError("TRAY_PIN_MISMATCH")
        fixture = next((c for c in observer.config["cups"] if c["fixtureId"] == args["fixtureId"]), None)
        if not fixture:
            raise ProtocolError("CUP_FIXTURE_UNKNOWN")
        # Plant effect only. A set_pose ACK never fabricates a receiver sensor sample.
        return {"applied": bool(self.ports.set_pose(fixture["gazeboModel"], args["xM"], args["yM"], args["zM"])), "fidelity": "modeled"}

    def native_blocker(self, args):
        protocol.validate_args("native_blocker", args)
        b = next((b for b in self.scene_loop.blockers.blockers if b["id"] == "native_fault"), None)
        if not b:
            raise ProtocolError("NATIVE_BLOCKER_UNCONFIGURED")
        x,y = (b["x"]+b["width"]/2,b["y"]+b["height"]/2) if args["enabled"] else (-5.,-5.)
        if not self.ports.set_pose("blocker_native_fault",x,y,b["heightM"]/2):
            raise ProtocolError("NATIVE_BLOCKER_EFFECT_UNKNOWN")
        self.scene_loop.emit("fault", {"faultId":"blocker", "enabled":args["enabled"],"source":"server-native-fixture"})
        return {"applied":True}

    def close(self, args=None):
        self.ports.close()
        return {"closed": True}


def serve(stdin, stdout, session, lock=None):
    """One request per line until `close` (or EOF). A protocol error answers the request and keeps serving; the worker never exits mid-run.
    `lock` serialises replies with the scene loop's events on the same stdout."""
    lock = lock or threading.Lock()
    for line in stdin:
        if not line.strip():
            continue
        request_id = op = None
        try:
            request = protocol.parse_strict(line)
            request_id = protocol.request_id_of(request)
            request_id, op, args = protocol.check_request(request)
            result = getattr(session, op)(args)
            out = protocol.response(request_id, result)
        except ProtocolError as e:
            out, op = protocol.error(request_id, e.code, e.detail), None
        except Exception as e:  # noqa: BLE001 - reported, never fatal for the serve loop
            out, op = protocol.error(request_id, "RUNTIME_FAILURE", type(e).__name__), None
        with lock:
            stdout.write(out)
            stdout.flush()
        if op == "close":
            return


def main(argv=None):
    parser = argparse.ArgumentParser(description="MEKONIQ simulation worker (gazebo_nav2). Serves the Lab worker protocol on stdio.")
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--robots", required=True, help="comma-separated compiled robot namespaces")
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--scenario", default=None, help="scenario fixture (actors, blockers, faults) the scene loop scripts; omitted = static world")
    parser.add_argument("--log", default=None)
    a = parser.parse_args(argv)
    os.environ.update(partition_env(a.run_id))
    robots = [r for r in a.robots.split(",") if r]
    ports = RosPorts(a.bundle, robots, a.log)
    session = Nav2Session(ports, a.run_id, robots, a.state_dir)
    lock, stop = threading.Lock(), threading.Event()
    from actors.scenario import load_scenario
    from .scene_loop import SceneLoop
    manifest = {r["namespace"]: r for r in json.loads((Path(a.bundle) / "compiler-manifest.json").read_text())["robots"]}
    scenario = load_scenario(a.scenario) if a.scenario else {"seed": 0, "actors": [], "blockers": [], "faults": []}
    scene_file = Path(a.bundle) / "scene-index.json"
    scene_index = json.loads(scene_file.read_text()) if scene_file.is_file() else {}
    manifest_hash = json.loads((Path(a.bundle) / "compiler-manifest.json").read_text()).get("manifestHash")
    if scene_index.get("beverage") and not manifest_hash:
        raise ProtocolError("BEVERAGE_WORLD_PIN_MISSING")
    loop = SceneLoop(ports, scenario, [manifest[ns] for ns in robots], run_id=a.run_id, boot_id=session.boot_id,
                     emit=lambda kind, payload: _emit(sys.stdout, lock, kind, payload), beverage=scene_index.get("beverage"), world_revision=manifest_hash)
    session.scene_loop = loop
    thread = threading.Thread(target=loop.run, args=(stop,), name="lab-scene-loop", daemon=True)
    thread.start()
    try:
        serve(sys.stdin, sys.stdout, session, lock)
    finally:
        stop.set()
        thread.join(timeout=1.0)
        ports.close()


def _emit(stdout, lock, kind, payload):
    with lock:
        stdout.write(protocol.event(kind, payload))
        stdout.flush()


if __name__ == "__main__":
    main()
