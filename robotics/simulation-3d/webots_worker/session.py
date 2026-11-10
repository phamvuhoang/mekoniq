"""One Webots run: lifecycle new -> created -> running <-> paused -> stopped, failed on any protocol or engine fault. The session owns plant state only; the caller (the
source runner) owns the clock, the missions and every velocity. Exactly one engine step per accepted step request, no free-running loop.

Clock: Webots sensors have no data before the first step, so `create` runs one priming step with every wheel at rest and calls the result tick 0. The engine therefore runs
one step (20 ms) ahead of the source clock for the whole run: engine time = (tick + 1) x 20 ms. simTimeNs in every snapshot is the source clock, tick x 20 ms.
"""
import hashlib
import json
import math
import platform
import re
import uuid
from pathlib import Path

import rfc8785

from .compile import CompileError, compile_world
from .protocol import OPS, PROTOCOL, Receipts, WorkerError
from .snapshot import TICK_NS, SnapshotError, base_state, collision_ids, drive_pose, lidar_scan, robot_state, wheel_speeds

TICK_S = 0.02
FIXTURE_FILE = "scenario-fixture.json"
VELOCITY_TOLERANCE = 1e-9
CLOCK_TOLERANCE_S = 1e-9


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


def solid_name(link_id):
    return link_id.replace("/", "_")


def place(poly, x, y, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return [[x + c * px - s * py, y + s * px + c * py] for px, py in poly]


def robot_config(entry, model):
    """What the engine needs to know about one robot: its wheels, the solids that count as its body, its LiDARs."""
    drive = model["drive"]
    child = {j["id"]: j["child"] for j in model["joints"]}
    wheels = {"left": solid_name(child[drive["leftJointId"]]), "right": solid_name(child[drive["rightJointId"]])}
    wheel_set = set(wheels.values())
    casters = {solid_name(l["id"]) for l in model["links"] if any(c["geometry"]["kind"] == "sphere" for c in l["collision"])}
    body = sorted({solid_name(l["id"]) for l in model["links"]} - wheel_set - casters - {solid_name(model["baseFrameId"])} | {entry["robotId"]})
    return {"id": entry["robotId"], "wheelRadiusM": drive["wheelRadiusM"]["value"], "wheelSeparationM": drive["wheelSeparationM"]["value"], "wheelSolids": wheels, "bodySolids": body,
            "lidars": [{"name": s["id"], "beams": s["beamCount"], "fov": s["fieldOfViewRad"], "rangeMin": s["rangeMinM"], "rangeMax": s["rangeMaxM"], "every": s["publishEveryTicks"]} for s in entry["model"]["sensors"]]}


class WorkerSession:
    def __init__(self, *, run_id, bundle_root, lock_digest, expected_scene_digest=None, engine_factory=None, webots_home=None, host_info=None, run_directory=None, python=None):
        self.run_id, self.bundle_root, self.lock_digest, self.expected_scene_digest = run_id, Path(bundle_root), lock_digest, expected_scene_digest
        self.webots_home, self.run_directory, self.python = webots_home, run_directory, python
        self._factory = engine_factory
        self._host = host_info
        self.boot_id = str(uuid.uuid4())
        self.state, self.tick, self.seq = "new", 0, 0
        self.engine = self.scene = self.snapshot = None
        self.config = {}
        self.receipts = Receipts()
        self.limits, self.previous_wheels = {}, {}

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
        self._end_engine()

    def _end_engine(self):
        engine, self.engine = self.engine, None
        if engine is not None:
            try:
                engine.close()
            except Exception:  # cleanup must never mask the original fault
                pass

    def end(self):
        self._end_engine()

    def _host_info(self):
        if self._host is not None:
            return self._host()
        from .engine import host_engine

        return host_engine(self.webots_home)

    def _dispatch(self, request):
        op, payload = request["op"], request["payload"]
        if op not in OPS:
            raise WorkerError("UNSUPPORTED_OP", op, fatal=True)
        if op == "describe":
            version, sha = self._host_info()
            return {"packageVersion": version, "pythonVersion": platform.python_version(), "lockDigest": self.lock_digest, "ops": list(OPS), "engineVersion": version, "executableSha256": sha}
        if self.state in ("stopped", "failed") and op not in ("getState", "stop"):
            raise WorkerError("INVALID_STATE", f"{op} on a {self.state} run")
        if request["expectedTick"] != self.tick:
            raise WorkerError("TICK_MISMATCH", f"expectedTick {request['expectedTick']} but the run is at tick {self.tick}")
        return getattr(self, "_op_" + op.lower())(payload)

    # ---- operations ----
    def _load(self, ref):
        scene = json.loads(confined(self.bundle_root, ref).read_text())
        if scene.get("documentType") != "navigation-scene" or scene.get("engine", {}).get("id") != "webots_3d":
            raise WorkerError("SCENE_UNSUPPORTED", "not a webots_3d navigation scene")
        digest = scene_digest_of(scene)
        if digest != scene.get("sceneDigest") or (self.expected_scene_digest and digest != self.expected_scene_digest):
            raise WorkerError("SCENE_DIGEST_MISMATCH", "the scene does not hash to the digest it declares or the process was bound to")
        if (self.bundle_root / FIXTURE_FILE).exists():
            raise WorkerError("FIXTURE_UNSUPPORTED", f"{FIXTURE_FILE} is in the bundle but this plant has no scripted actors")
        models = {}
        for f in scene["files"]:
            file = confined(self.bundle_root, f["path"])
            if hashlib.sha256(file.read_bytes()).hexdigest() != f["sha256"]:
                raise WorkerError("SCENE_FILE_MISMATCH", f"{f['path']} does not match the scene's digest for it")
            m = re.fullmatch(r"physical-model/([^/]+)\.json", f["path"])
            if m:
                models[m.group(1)] = json.loads(file.read_text())
        missing = [r["robotId"] for r in scene["robots"] if r["robotId"] not in models]
        if missing:
            raise WorkerError("SCENE_FILE_MISMATCH", f"the scene lists no physical model for {missing}")
        return scene, models

    def _op_create(self, p):
        if self.state != "new":
            raise WorkerError("INVALID_STATE", f"create on a {self.state} run")
        scene, models = self._load(p["sceneRef"])
        try:
            world = compile_world(scene, models, p["seed"])
        except CompileError as e:
            raise WorkerError(e.code, e.detail)
        robots = [robot_config(r, models[r["robotId"]]) for r in sorted(scene["robots"], key=lambda r: r["robotId"])]
        self.config = {"robots": robots, "runDirectory": self.run_directory, "python": self.python, "webotsHome": self.webots_home}
        if self._factory is None:
            from .engine import WebotsEngine

            self._factory = lambda w, c: WebotsEngine(w, c)
        self.engine = self._factory(world, self.config)
        self.scene = scene
        self.limits = {r["robotId"]: (r["model"]["kinematics"]["maxLinearMps"], r["model"]["kinematics"]["maxAngularRadps"]) for r in scene["robots"]}
        self.drive = {r["robotId"]: r["model"]["driveFrameInBase"] for r in scene["robots"]}
        self.footprints = {r["robotId"]: r["model"]["footprint"]["verticesM"] for r in scene["robots"]}
        self.obstacles = {o["id"]: o["verticesM"] for o in scene["world"]["obstacles"] + scene["world"]["boundaries"]}
        self.engine.start()
        self.state = "created"
        # the priming step: every wheel at rest, so the sensors have their first measurement before tick 0 is reported
        return self._advance({r["id"]: (0.0, 0.0) for r in robots}, tick=0)

    def _advance(self, wheel_commands, tick):
        reading = self.engine.step(wheel_commands, True)  # the controller wants the latest scan at every tick, as the IR-SIM plant gives it; the recorder keeps the ticks of publishEveryTicks
        if abs(reading["time"] - (tick + 1) * TICK_S) > CLOCK_TOLERANCE_S:
            raise WorkerError("CLOCK_DRIFT", f"engine time {reading['time']} is not (tick {tick} + 1) x {TICK_S}", fatal=True)
        return self._observe(reading, tick)

    def _observe(self, reading, tick):
        self.seq += 1
        bases = {r["id"]: base_state(reading["robots"][r["id"]]["position"], reading["robots"][r["id"]]["orientation"], reading["robots"][r["id"]]["velocity"]) for r in self.config["robots"]}
        drive_yaw = {rid: 2 * math.atan2(d["quaternionXyzw"][2], d["quaternionXyzw"][3]) for rid, d in self.drive.items()}  # planar drive frame: yaw only
        poses = {rid: drive_pose(bases[rid], self.drive[rid]["xyzM"], drive_yaw[rid]) for rid in bases}
        footprints = {rid: place(self.footprints[rid], *poses[rid]) for rid in bases}
        robots = []
        for r in self.config["robots"]:
            rid, got = r["id"], reading["robots"][r["id"]]
            scans = []
            if got["lidar"] is not None:
                for l in r["lidars"]:
                    scans.append(lidar_scan(got["lidar"][l["name"]], sensor_id=l["name"], frame_id="lidar", tick=tick, range_min=l["rangeMin"], range_max=l["rangeMax"], fov=l["fov"]))
            prev = self.previous_wheels.get(rid)
            wheels = [0.0, 0.0] if prev is None else [(a - b) / TICK_S for a, b in zip(got["wheelPositions"], prev)]
            self.previous_wheels[rid] = list(got["wheelPositions"])
            mine = [c for c in reading["contacts"] if c.get("robotId") == rid]
            collisions = collision_ids(mine, set(r["bodySolids"]), self.obstacles, footprints, rid)
            d = self.drive[rid]
            robots.append(robot_state(robot_id=rid, base=bases[rid], drive_xyz=d["xyzM"], drive_yaw=drive_yaw[rid], wheels=wheels, scans=scans, collisions=collisions))
        self.snapshot = {"schemaVersion": 1, "runId": self.run_id, "bootId": self.boot_id, "tick": tick, "simTimeNs": str(tick * TICK_NS), "seq": str(self.seq), "sceneDigest": self.scene["sceneDigest"],
                         "robots": robots}
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
        model = self.engine.readback() if self.engine is not None else None
        return {**self.snapshot, **({"model": model} if model is not None else {})}  # the last stored copy: no step

    def _op_stop(self, p):
        if self.state != "stopped":
            self._end_engine()
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
            raise WorkerError("ACTOR_UNKNOWN", f"this plant has no scripted actors; got {[u['actorId'] for u in p['actorUpdates']]}")
        commanded = {}
        for v in p["velocities"]:
            if v["robotId"] in commanded:
                raise WorkerError("VELOCITY_INCOMPLETE", f"{v['robotId']} appears twice")
            commanded[v["robotId"]] = v
        ids = {r["id"] for r in self.config["robots"]}
        if set(commanded) != ids:
            raise WorkerError("VELOCITY_INCOMPLETE", f"every robot needs an explicit velocity each tick (idle is zero); got {sorted(commanded)}, need {sorted(ids)}")
        wheels = {}
        for r in self.config["robots"]:
            v = commanded[r["id"]]
            max_v, max_w = self.limits[r["id"]]
            if abs(v["vMps"]) > max_v + VELOCITY_TOLERANCE or abs(v["omegaRadps"]) > max_w + VELOCITY_TOLERANCE:
                raise WorkerError("VELOCITY_LIMIT", f"{r['id']}: ({v['vMps']}, {v['omegaRadps']}) exceeds ({max_v}, {max_w})")
            wheels[r["id"]] = wheel_speeds(v["vMps"], v["omegaRadps"], r["wheelRadiusM"], r["wheelSeparationM"])
        snap = self._advance(wheels, tick=self.tick + 1)
        self.tick += 1
        return snap
