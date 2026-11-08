"""One IR-SIM run: lifecycle created -> running <-> paused -> stopped, failed on any protocol or engine fault. The session owns plant state only; the caller (the source
runner) owns the clock, the missions and every velocity. Exactly one env.step per accepted step request, no free-running loop."""
import hashlib
import json
import math
import platform
import re
import uuid
from importlib import metadata
from pathlib import Path

import rfc8785

from .protocol import OPS, PROTOCOL, Receipts, WorkerError
from .snapshot import TICK_NS, SnapshotError, build_snapshot

TICK_S = 0.02
VELOCITY_TOLERANCE = 1e-9


def confined(root: Path, rel: str) -> Path:
    """A file inside the bundle root: relative, no `..`, no URL, no symlink on the way, and it exists."""
    if not isinstance(rel, str) or not rel or rel.startswith(("/", "\\")) or "://" in rel or re.match(r"^[A-Za-z]:", rel) or ".." in Path(rel).parts:
        raise WorkerError("SCENE_PATH_REJECTED", f"{rel!r} is not a relative path inside the bundle")
    real_root = root.resolve()
    target = real_root / rel
    for part in [target, *target.parents]:
        if part == real_root:
            break
        if part.is_symlink():
            raise WorkerError("SCENE_PATH_REJECTED", f"{rel!r} passes through a symbolic link")
    if real_root not in target.resolve().parents or not target.is_file():
        raise WorkerError("SCENE_PATH_REJECTED", f"{rel!r} is not a file in the bundle")
    return target


def scene_digest_of(scene):
    body = {k: v for k, v in scene.items() if k != "sceneDigest"}
    return hashlib.sha256(rfc8785.dumps(body)).hexdigest()


class WorkerSession:
    def __init__(self, *, run_id, bundle_root, lock_digest, expected_scene_digest=None):
        self.run_id, self.bundle_root, self.lock_digest, self.expected_scene_digest = run_id, Path(bundle_root), lock_digest, expected_scene_digest
        self.boot_id = str(uuid.uuid4())
        self.state, self.tick, self.seq = "new", 0, 0
        self.env = self.scene = self.snapshot = None
        self.receipts = Receipts()
        self.limits = {}

    # ---- plumbing ----
    def _reply(self, request, ok, **body):
        return {"protocol": PROTOCOL, "requestId": request["requestId"], "runId": self.run_id, "bootId": self.boot_id, "tick": self.tick, "ok": ok, **body}

    def handle(self, request):
        """Schema-valid request dict -> response dict. Fatal faults end the run (state failed) and are flagged by state == 'failed'."""
        try:
            if request["runId"] != self.run_id:
                raise WorkerError("INVALID_REQUEST", "runId does not belong to this process", fatal=True)
            cached = self.receipts.lookup(request)
            if cached is not None:
                return cached
            response = self._reply(request, True, result=self._dispatch(request))
        except WorkerError as e:
            if e.fatal:
                self._fail()
            response = self._reply(request, False, error={"code": e.code, "detail": e.detail})
        except SnapshotError as e:
            self._fail()
            response = self._reply(request, False, error={"code": e.code, "detail": e.detail[:1000]})
        except Exception as e:  # an engine or library fault: fail closed, never a guess
            self._fail()
            response = self._reply(request, False, error={"code": "WORKER_FAILED", "detail": f"{type(e).__name__}: {e}"[:1000]})
        if self.state != "failed" or not response["ok"]:
            self.receipts.store(request, response)
        return response

    def _fail(self):
        self.state = "failed"
        self._end_env()

    def _end_env(self):
        env, self.env = self.env, None
        if env is not None:
            try:
                env.end(ending_time=0)
            except Exception:  # cleanup must never mask the original fault
                pass

    def _dispatch(self, request):
        op, payload = request["op"], request["payload"]
        if op not in OPS:
            raise WorkerError("UNSUPPORTED_OP", op, fatal=True)
        if op == "describe":
            return {"packageVersion": metadata.version("ir-sim"), "pythonVersion": platform.python_version(), "lockDigest": self.lock_digest, "ops": list(OPS)}
        if self.state in ("stopped", "failed") and op not in ("getState", "stop"):
            raise WorkerError("INVALID_STATE", f"{op} on a {self.state} run")
        if request["expectedTick"] != self.tick:
            raise WorkerError("TICK_MISMATCH", f"expectedTick {request['expectedTick']} but the run is at tick {self.tick}")
        return getattr(self, "_op_" + op.lower())(payload)

    # ---- operations ----
    def _op_create(self, p):
        if self.state != "new":
            raise WorkerError("INVALID_STATE", f"create on a {self.state} run")
        scene_path = confined(self.bundle_root, p["sceneRef"])
        scene = json.loads(scene_path.read_text())
        if scene.get("documentType") != "navigation-scene" or scene.get("engine", {}).get("id") != "irsim_2d":
            raise WorkerError("SCENE_UNSUPPORTED", "not an irsim_2d navigation scene")
        digest = scene_digest_of(scene)
        if digest != scene.get("sceneDigest") or (self.expected_scene_digest and digest != self.expected_scene_digest):
            raise WorkerError("SCENE_DIGEST_MISMATCH", "the scene does not hash to the digest it declares or the process was bound to")
        paths = {}
        for ref in scene["files"]:
            file = confined(self.bundle_root, ref["path"])
            if hashlib.sha256(file.read_bytes()).hexdigest() != ref["sha256"]:
                raise WorkerError("SCENE_FILE_MISMATCH", f"{ref['path']} does not match the scene's digest for it")
            paths[ref["path"]] = file
        if "irsim/world.yaml" not in paths or "irsim/name-map.json" not in paths:
            raise WorkerError("SCENE_FILE_MISMATCH", "the scene lists no irsim/world.yaml and irsim/name-map.json")
        names = json.loads(paths["irsim/name-map.json"].read_text())
        import irsim  # imported late: describe must work (and fail cleanly) without the engine initialised
        self.env = irsim.make(str(paths["irsim/world.yaml"]), display=False, seed=p["seed"])
        self.scene, self.names, self.sensor_ids = scene, names["robots"], names["sensors"]
        engine_ids = {o.id: sid for o, sid in zip(self.env.obstacle_list, names["solids"])}
        self.solid_ids = engine_ids
        if sorted(r.name for r in self.env.robot_list) != sorted(self.names.values()) or len(self.names) != len(scene["robots"]):
            raise WorkerError("SCENE_ENGINE_MISMATCH", "the engine robots are not the scene robots", fatal=True)
        self.limits = {r["robotId"]: (r["model"]["kinematics"]["maxLinearMps"], r["model"]["kinematics"]["maxAngularRadps"]) for r in scene["robots"]}
        self.state = "created"
        return self._observe()

    def _observe(self):
        self.seq += 1
        self.snapshot = build_snapshot(self.env, run_id=self.run_id, boot_id=self.boot_id, tick=self.tick, seq=self.seq, scene_digest=self.scene["sceneDigest"], names=self.names,
                                       sensor_ids=self.sensor_ids, solid_ids=self.solid_ids)
        return self.snapshot

    def _op_start(self, p):
        if self.state != "created":
            raise WorkerError("INVALID_STATE", f"start on a {self.state} run")
        self.state = "running"  # the clock does not move: only step requests advance it
        return {"state": "running"}

    def _op_pause(self, p):
        if self.state != "running":
            raise WorkerError("INVALID_STATE", f"pause on a {self.state} run")
        self.state = "paused"
        return {"state": "paused"}

    def _op_resume(self, p):
        if self.state != "paused":
            raise WorkerError("INVALID_STATE", f"resume on a {self.state} run")
        self.state = "running"
        return {"state": "running"}

    def _op_getstate(self, p):
        if self.snapshot is None:
            raise WorkerError("INVALID_STATE", "the run has no scene yet")
        return self.snapshot  # the last stored copy: no step, no actor update, no random draw

    def _op_stop(self, p):
        if self.state != "stopped":
            self._end_env()
            self.state = "stopped"
        return {"state": "stopped"}

    def _op_step(self, p):
        single = p.get("singleStep", False)
        if self.state == "paused" and single:
            pass  # one explicit tick while paused; the run stays paused
        elif self.state != "running" or single:
            raise WorkerError("INVALID_STATE", f"step{' (singleStep)' if single else ''} on a {self.state} run")
        if p["targetTick"] != self.tick + 1:
            raise WorkerError("TICK_MISMATCH", f"targetTick {p['targetTick']} must be {self.tick + 1}")
        if p["actorUpdates"]:
            raise WorkerError("ACTOR_UNKNOWN", f"actor {p['actorUpdates'][0]['actorId']} is not in this scene")
        commanded = {}
        for v in p["velocities"]:
            if v["robotId"] in commanded:
                raise WorkerError("VELOCITY_INCOMPLETE", f"{v['robotId']} appears twice")
            commanded[v["robotId"]] = v
        if set(commanded) != set(self.names):
            raise WorkerError("VELOCITY_INCOMPLETE", f"every robot needs an explicit velocity each tick (idle is zero); got {sorted(commanded)}, need {sorted(self.names)}")
        action = {}
        for robot_id, v in commanded.items():
            max_v, max_w = self.limits[robot_id]
            if abs(v["vMps"]) > max_v + VELOCITY_TOLERANCE or abs(v["omegaRadps"]) > max_w + VELOCITY_TOLERANCE:
                raise WorkerError("VELOCITY_LIMIT", f"{robot_id}: ({v['vMps']}, {v['omegaRadps']}) exceeds ({max_v}, {max_w})")
            action[self.names[robot_id]] = [v["vMps"], v["omegaRadps"]]
        self.env.step(action)
        self.tick += 1
        if abs(self.env.time - self.tick * TICK_S) > 1e-9:
            raise WorkerError("CLOCK_DRIFT", f"engine time {self.env.time} is not tick {self.tick} x {TICK_S}", fatal=True)
        return self._observe()
