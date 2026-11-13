"""One MuJoCo arm cell run: lifecycle new -> created -> running <-> paused -> stopped, failed on any protocol or engine fault. The session owns plant state only; the caller
owns the clock and every command. Exactly one engine step (substeps x timestep of the scene) per accepted step request, no free-running loop.

Clock (as the Webots worker): `create` runs one priming step (arm at home, gripper open, no cup placed) and calls the result tick 0, so engine time = (tick + 1) x 20 ms for
the whole run (checked against the count of substeps asked for, see CLOCK_TOLERANCE_S); simTimeNs in every snapshot is the source clock, tick x 20 ms.

Refusals that leave the tick and the engine untouched: JOINT_TARGET_SHAPE, JOINT_TARGET_OUT_OF_RANGE (no tolerance), GRIPPER_TARGET_OUT_OF_RANGE ([0, openingMaxM]),
PROP_UNKNOWN, PROP_HELD (placing or parking a cup both pads touch), PROP_PLACEMENT_OCCUPIED (the upright cylinder of the placed cup overlaps a cup in the scene).
"""
import hashlib
import json
import math
import platform
import re
import uuid
from pathlib import Path

import rfc8785

from . import snapshot
from .protocol import OPS, PROTOCOL, Receipts, WorkerError

SCENE_FILE, COMPONENT_FILE, PHYSICS_FILE, BLOB_DIR = "arm-cell-scene.json", "component.json", "physics.json", "blobs"
# The clock check compares the engine's time with the substeps the worker has asked for x the timestep (the same double MuJoCo adds). MuJoCo adds the timestep once
# per substep, rounding each sum by at most half an ulp: over the longest run (maxTicks 180,000 + the priming tick = 1,800,010 substeps, t <= 3600.02 s, ulp(t) =
# 2^-41 s) that is at most 1,800,010 x 2^-42 = 4.1e-7 s. 1e-5 s is 24 times that bound, and 1/200 of one lost or extra substep (2e-3 s), which therefore always trips it.
CLOCK_TOLERANCE_S = 1e-5


def confined(root: Path, rel: str, directory=False) -> Path:
    """A file (or directory) inside the bundle root: relative, no `..`, no URL, no symlink on the way, and it exists."""
    if not isinstance(rel, str) or not rel or rel.startswith(("/", "\\")) or "://" in rel or re.match(r"^[A-Za-z]:", rel) or ".." in Path(rel).parts:
        raise WorkerError("SCENE_PATH_REJECTED", f"{rel!r} is not a relative path inside the bundle")
    real_root = root.resolve()
    target = real_root / rel
    for part in [target, *target.parents]:
        if part == real_root:
            break
        if part.is_symlink():
            raise WorkerError("SCENE_PATH_REJECTED", f"{rel!r} passes through a symbolic link")
    if real_root not in target.resolve().parents or not (target.is_dir() if directory else target.is_file()):
        raise WorkerError("SCENE_PATH_REJECTED", f"{rel!r} is not a {'directory' if directory else 'file'} in the bundle")
    return target


def scene_digest_of(scene):
    return hashlib.sha256(rfc8785.dumps({k: v for k, v in scene.items() if k != "sceneDigest"})).hexdigest()


def engine_seed(seed):
    """A run seed (uint32) as the scene's engineSeed (int32 range): the low 31 bits."""
    return seed & 0x7FFFFFFF


def overlaps(p, a, q, b):
    """Two upright cylinders (centre p, q; dims a, b = (radius, height)) intersect."""
    return math.hypot(p[0] - q[0], p[1] - q[1]) < a[0] + b[0] and abs(p[2] - q[2]) < (a[1] + b[1]) / 2


class WorkerSession:
    def __init__(self, *, run_id, bundle_root, lock_digest, expected_scene_digest=None, engine_factory=None, host_info=None):
        self.run_id, self.bundle_root, self.lock_digest, self.expected_scene_digest = run_id, Path(bundle_root), lock_digest, expected_scene_digest
        self._factory, self._host = engine_factory, host_info
        self.boot_id = str(uuid.uuid4())
        self.state, self.tick, self.seq, self.substeps = "new", 0, 0, 0  # substeps: how many the engine has been asked for (the clock check's reference)
        self.engine = self.scene = self.snapshot = None
        self.receipts = Receipts()
        self.cups, self.present = {}, {}  # propId -> (radius, height); cups in the scene -> position after the last step

    # ---- plumbing (as the Webots worker) ----
    def _reply(self, request, ok, **body):
        return {"protocol": PROTOCOL, "requestId": request["requestId"], "runId": self.run_id, "bootId": self.boot_id, "tick": self.tick, "ok": ok, **body}

    def handle(self, request):
        """Schema-valid request dict -> response dict. Fatal faults end the run (state failed)."""
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

    def _dispatch(self, request):
        op, payload = request["op"], request["payload"]
        if op not in OPS:
            raise WorkerError("UNSUPPORTED_OP", op, fatal=True)
        if op == "describe":
            if self._host is None:
                from .engine import engine_version

                self._host = engine_version
            version = self._host()
            return {"packageVersion": version, "pythonVersion": platform.python_version(), "lockDigest": self.lock_digest, "ops": list(OPS), "engineVersion": version}
        if self.state in ("stopped", "failed") and op not in ("getState", "stop"):
            raise WorkerError("INVALID_STATE", f"{op} on a {self.state} run")
        if request["expectedTick"] != self.tick:
            raise WorkerError("TICK_MISMATCH", f"expectedTick {request['expectedTick']} but the run is at tick {self.tick}")
        return getattr(self, "_op_" + op.lower())(payload)

    # ---- operations ----
    def _op_create(self, p):
        if self.state != "new":
            raise WorkerError("INVALID_STATE", f"create on a {self.state} run")
        arms = p.get("arms") or []
        if len(arms) != 1 or p["sceneRef"] != SCENE_FILE or arms[0]["sceneRef"] != SCENE_FILE:
            raise WorkerError("INVALID_REQUEST", f"an arm cell run names {SCENE_FILE} as sceneRef and as arms[0].sceneRef")
        scene = json.loads(confined(self.bundle_root, SCENE_FILE).read_text())
        if scene.get("schemaVersion") != 1 or scene.get("engine", {}).get("id") != "mujoco_3d" or not isinstance(scene.get("arm"), dict):
            raise WorkerError("SCENE_UNSUPPORTED", "not a mujoco_3d arm cell scene")
        digest = scene_digest_of(scene)
        if digest != scene.get("sceneDigest") or (self.expected_scene_digest and digest != self.expected_scene_digest):
            raise WorkerError("SCENE_DIGEST_MISMATCH", "the scene does not hash to the digest it declares or the process was bound to")
        if scene["arm"]["armId"] != arms[0]["armId"]:
            raise WorkerError("INVALID_REQUEST", f"arms[0] names {arms[0]['armId']!r} but the scene's arm is {scene['arm']['armId']!r}")
        if engine_seed(p["seed"]) != scene["engineSeed"]:
            raise WorkerError("SEED_MISMATCH", f"seed {p['seed']} reduces to {engine_seed(p['seed'])}, the scene was built for {scene['engineSeed']}")
        component = json.loads(confined(self.bundle_root, COMPONENT_FILE).read_text())
        physics = json.loads(confined(self.bundle_root, PHYSICS_FILE).read_text())
        blobs = confined(self.bundle_root, BLOB_DIR, directory=True)
        if self._factory is None:
            from .engine import MujocoEngine

            self._factory = MujocoEngine
        from .compile import CompileError

        try:
            self.engine = self._factory(scene, component, physics, str(blobs))
        except CompileError as e:
            raise WorkerError(e.code, e.detail or e.code)
        self.scene = scene
        self.cups = {c["propId"]: (c["radiusM"], c["heightM"]) for c in scene["props"]}
        self.state = "created"
        return self._advance(list(scene["arm"]["homeRad"]), self.engine.opening_max_m, [], tick=0)  # the priming step: home, gripper open

    def _advance(self, targets, opening, placements, tick):
        engine = self.scene["engine"]
        reading = self.engine.step(targets, opening, placements)
        self.substeps += engine["substeps"]
        snapshot.check_stable(reading, self.engine.arm_limits)  # first: MuJoCo resets its clock when it finds a bad state
        expected = self.substeps * (engine["timestepMs"] / 1000)
        if abs(reading["time"] - expected) > CLOCK_TOLERANCE_S:
            raise WorkerError("CLOCK_DRIFT", f"engine time {reading['time']} at tick {tick} is not {self.substeps} substeps x {engine['timestepMs']} ms = {expected}", fatal=True)
        self.seq += 1
        self.snapshot = snapshot.build(run_id=self.run_id, boot_id=self.boot_id, seq=self.seq, tick=tick, scene=self.scene, reading=reading, limits=self.engine.arm_limits)
        self.present = {pid: tuple(r["position"]) for pid, r in reading["props"].items()}
        return self.snapshot

    def _check_step(self, p):
        """(targets, opening or None, placements) of a valid arm cell step; refuses before anything reaches the engine."""
        if p["velocities"] or p["actorUpdates"]:
            raise WorkerError("INVALID_REQUEST", "an arm cell run takes jointTargets, gripperTargets and propPlacements, not velocities or actor updates")
        arm_id, limits = self.scene["arm"]["armId"], self.engine.arm_limits
        targets = p.get("jointTargets") or []
        if len(targets) != 1 or targets[0]["armId"] != arm_id:
            raise WorkerError("JOINT_TARGET_SHAPE", f"every tick needs one explicit target for {arm_id!r}; got {[t['armId'] for t in targets]}")
        q = targets[0]["positionsRad"]
        if len(q) != len(limits):
            raise WorkerError("JOINT_TARGET_SHAPE", f"{len(q)} positions for {len(limits)} joints")
        for i, (v, (lo, hi)) in enumerate(zip(q, limits)):
            if not lo <= v <= hi:
                raise WorkerError("JOINT_TARGET_OUT_OF_RANGE", f"joint {i + 1}: {v} is outside [{lo}, {hi}]")
        opening = None  # no gripperTargets: the gripper keeps the opening it was last given
        for g in p.get("gripperTargets") or []:
            if g["armId"] != arm_id:
                raise WorkerError("JOINT_TARGET_SHAPE", f"gripperTargets names {g['armId']!r}, the arm is {arm_id!r}")
            if not 0 <= g["openingM"] <= self.engine.opening_max_m:
                raise WorkerError("GRIPPER_TARGET_OUT_OF_RANGE", f"openingM {g['openingM']} is outside [0, {self.engine.opening_max_m}]")
            opening = g["openingM"]
        held, present, placements = set(self.snapshot["arms"][0]["gripper"]["heldPropIds"]), dict(self.present), []
        for pl in p.get("propPlacements") or []:
            pid, pose = pl["propId"], pl["pose"]
            if pid not in self.cups:
                raise WorkerError("PROP_UNKNOWN", f"{pid!r} is not a cup of this scene")
            if pid in held:
                raise WorkerError("PROP_HELD", f"{pid} is held by the gripper")
            present.pop(pid, None)
            if pose is not None:
                if not any(pose["quaternionXyzw"]):
                    raise WorkerError("INVALID_REQUEST", f"{pid}: a zero quaternion is not an orientation")
                for other, at in present.items():
                    if overlaps(pose["position"], self.cups[pid], at, self.cups[other]):
                        raise WorkerError("PROP_PLACEMENT_OCCUPIED", f"{pid} at {pose['position']} intersects {other}")
                present[pid] = tuple(pose["position"])
            placements.append((pid, pose))
        return list(q), opening, placements

    def _op_step(self, p):
        single = p.get("singleStep", False)
        if self.state == "paused" and single:
            pass  # one explicit tick while paused; the run stays paused
        elif self.state != "running" or single:
            raise WorkerError("INVALID_STATE", f"step{' (singleStep)' if single else ''} on a {self.state} run")
        if p["targetTick"] != self.tick + 1:
            raise WorkerError("TICK_MISMATCH", f"targetTick {p['targetTick']} must be {self.tick + 1}")
        snap = self._advance(*self._check_step(p), tick=self.tick + 1)
        self.tick += 1
        return snap

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
