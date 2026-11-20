"""One MuJoCo arm cell or mobile run: lifecycle new -> created -> running <-> paused -> stopped, failed on any protocol or engine fault. The session owns plant state only; the caller
owns the clock and every command. Exactly one engine step (substeps x timestep of the scene) per accepted step request, no free-running loop.

Clock (as the Webots worker): `create` runs one priming step (arm home/open, or zero mobile velocity) and calls the result tick 0, so engine time = (tick + 1) x 20 ms for
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
from .protocol import BENCH_MAX_AXES, BENCH_MAX_TICKS, OPS, PROTOCOL, Receipts, WorkerError, schema_validator, reject_non_finite

SCENE_FILE, COMPONENT_FILE, PHYSICS_FILE, BLOB_DIR = "arm-cell-scene.json", "component.json", "physics.json", "blobs"
# The clock check compares the engine's time with the substeps the worker has asked for x the timestep (the same double MuJoCo adds). MuJoCo adds the timestep once
# per substep, rounding each sum by at most half an ulp: over the longest run (maxTicks 180,000 + the priming tick = 1,800,010 substeps, t <= 3600.02 s, ulp(t) =
# 2^-41 s) that is at most 1,800,010 x 2^-42 = 4.1e-7 s. 1e-5 s is 24 times that bound, and 1/200 of one lost or extra substep (2e-3 s), which therefore always trips it.
CLOCK_TOLERANCE_S = 1e-5


def confined(root: Path, rel: str, directory=False) -> Path:
    """A file (or directory) inside the bundle root: relative, no `..`, no URL, no symlink on the way, and it exists."""
    if not isinstance(rel, str) or not rel or "\\" in rel or rel.startswith("/") or "://" in rel or re.match(r"^[A-Za-z]:", rel) or ".." in Path(rel).parts:
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


def world_plant_digest(scene):
    """The plant a world's combined control profile belongs to, from the scene itself (the Lab computes the same: worldPlantDigest in drive-experiments.ts)."""
    return hashlib.sha256(rfc8785.dumps({"mobile": scene["navigation"]["robots"][0]["model"]["physicalModelDigest"], "arm": scene["models"]["armComponent"]["sha256"]})).hexdigest()


class WorkerSession:
    def __init__(self, *, run_id, bundle_root, lock_digest, expected_scene_digest=None, engine_factory=None, host_info=None, schema_dir=None, payload_perturbation=None):
        if payload_perturbation not in (None, "payload-cup-forward-impulse-v1"):
            raise WorkerError("PERTURBATION_UNREGISTERED", str(payload_perturbation))
        self.payload_perturbation, self.perturbation_done = payload_perturbation, False
        self.run_id, self.bundle_root, self.lock_digest, self.expected_scene_digest = run_id, Path(bundle_root), lock_digest, expected_scene_digest
        self._factory, self._host = engine_factory, host_info
        self.boot_id = str(uuid.uuid4())
        self.state, self.tick, self.seq, self.substeps = "new", 0, 0, 0  # substeps: how many the engine has been asked for (the clock check's reference)
        self.engine = self.scene = self.snapshot = None
        self.receipts = Receipts()
        self.cups, self.present = {}, {}  # propId -> (radius, height); cups in the scene -> position after the last step
        self.mobile = False
        self.world = False
        self.drive_on = False
        self.bench = None   # payload.bench of a bench run (V06): its drive refs and traced axes
        self.world_events, self.world_born = set(), set()
        self.world_disturbance_consumed=False
        self.schema_dir = Path(schema_dir) if schema_dir else Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schemas"

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
            arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x86_64", "amd64": "x86_64"}.get(platform.machine().lower())
            return {"packageVersion": version, "pythonVersion": platform.python_version(), "lockDigest": self.lock_digest, "ops": list(OPS), "engineVersion": version, **({"hostArch": arch} if arch else {})}
        if self.state in ("stopped", "failed") and op not in ("getState", "stop"):
            raise WorkerError("INVALID_STATE", f"{op} on a {self.state} run")
        if request["expectedTick"] != self.tick:
            raise WorkerError("TICK_MISMATCH", f"expectedTick {request['expectedTick']} but the run is at tick {self.tick}")
        self.current_request_id=request["requestId"]
        return getattr(self, "_op_" + op.lower())(payload)

    # ---- operations ----
    def _op_create(self, p):
        if self.state != "new":
            raise WorkerError("INVALID_STATE", f"create on a {self.state} run")
        bench = p.get("bench")
        if bench is not None:
            if p.get("sceneRef") == "lab-world-scene.json" or self.payload_perturbation:
                raise WorkerError("BENCH_SCENE_UNSUPPORTED", "a bench runs one arm or one AMR alone, unperturbed")
            ids = bench.get("axisIds") or []
            if not 1 <= len(ids) <= BENCH_MAX_AXES or len(set(ids)) != len(ids):
                raise WorkerError("BENCH_AXIS_COUNT", f"a bench traces 1 to {BENCH_MAX_AXES} distinct axes, not {ids}")
        if p.get("sceneRef") == "lab-world-scene.json":
            return self._create_world(p)
        if p.get("sceneRef") == "navigation-scene.json":
            return self._create_mobile(p)
        if self.payload_perturbation:
            raise WorkerError("PERTURBATION_SCOPE_INVALID", "mobile free payload only")
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
        raw = confined(self.bundle_root, COMPONENT_FILE).read_bytes()
        component = json.loads(raw)
        physics = json.loads(confined(self.bundle_root, PHYSICS_FILE).read_text())
        blobs = confined(self.bundle_root, BLOB_DIR, directory=True)
        drive = self._bench_drive(bench, scene["engine"], hashlib.sha256(raw).hexdigest()) if bench else None   # an arm's plant is its component's sha256 (as xarm6-control-v1 is bound)
        if self._factory is None:
            from .engine import MujocoEngine

            self._factory = MujocoEngine
        from .compile import CompileError

        try:
            self.engine = self._factory(scene, component, physics, str(blobs), **({"drive": drive} if drive else {}))
        except CompileError as e:
            raise WorkerError(e.code, e.detail or e.code)
        self.scene = scene
        self.cups = {c["propId"]: (c["radiusM"], c["heightM"]) for c in scene["props"]}
        self.state, self.drive_on, self.bench = "created", drive is not None, bench
        if drive:
            self.engine.drive.g.start_trace(bench["axisIds"])
            return self._advance(None, None, [], tick=0, commands=self.engine.drive.g.prime_commands())  # the priming step: every axis holds where the home keyframe put it
        return self._advance(list(scene["arm"]["homeRad"]), self.engine.opening_max_m, [], tick=0)  # the priming step: home, gripper open

    def _advance(self, targets, opening, placements, tick, commands=None):
        engine = self.scene["engine"]
        reading = self.engine.step(targets, opening, placements) if commands is None else self.engine.step(targets, opening, placements, commands)
        self.substeps += engine["substeps"]
        snapshot.check_stable(reading, self.engine.arm_limits)  # first: MuJoCo resets its clock when it finds a bad state
        expected = self.substeps * (engine["timestepMs"] / 1000)
        if abs(reading["time"] - expected) > CLOCK_TOLERANCE_S:
            raise WorkerError("CLOCK_DRIFT", f"engine time {reading['time']} at tick {tick} is not {self.substeps} substeps x {engine['timestepMs']} ms = {expected}", fatal=True)
        self.seq += 1
        self.snapshot = snapshot.build(run_id=self.run_id, boot_id=self.boot_id, seq=self.seq, tick=tick, scene=self.scene, reading=reading, limits=self.engine.arm_limits)
        self.present = {pid: tuple(r["position"]) for pid, r in reading["props"].items()}
        return self.snapshot

    def _drive_docs(self, refs, read, plant_digest=None):
        """The (drive model, control profile) of a scene whose engine (or a bench payload) names both refs; None when it names neither. `read(ref)` returns the bundle document of a ref (it has already checked
        confinement, the file list and the file hash). Schema, own digest and the binding between the two documents (and to the plant when it is a single robot) are checked here."""
        m_ref, c_ref = refs.get("driveModelRef"), refs.get("controlProfileRef")
        if m_ref is None and c_ref is None:
            return None
        if m_ref is None or c_ref is None:
            raise WorkerError("DRIVE_PROFILE_PAIR_REQUIRED", "a drive model and a control profile come as a pair")
        docs = []
        for ref, schema in ((m_ref, "drive-model-v1.schema.json"), (c_ref, "control-profile-v1.schema.json")):
            obj = read(ref)
            self._validate_document(obj, schema)
            if (obj["id"], obj["revision"]) != (ref["id"], ref["revision"]):
                raise WorkerError("PROFILE_ID_MISMATCH", ref["path"])
            if hashlib.sha256(rfc8785.dumps({k: v for k, v in obj.items() if k != "digest"})).hexdigest() != obj["digest"]:
                raise WorkerError("DIGEST_MISMATCH", ref["path"])
            docs.append(obj)
        model, control = docs
        if model["digest"] not in control["driveModelDigests"]:
            raise WorkerError("DRIVE_DOCUMENT_INVALID", "the control profile is not declared for this drive model")
        if plant_digest is not None and control["plantModelDigest"] != plant_digest:
            raise WorkerError("DRIVE_DOCUMENT_INVALID", "the control profile is not bound to this plant")
        return model, control

    def _bench_drive(self, bench, engine, plant_digest):
        """The (drive model, control profile) of a bench (D1): both refs travel in payload.bench, never also in the scene, and are admitted as a scene's are (bundle-confined, file sha256,
        schema, own digest, driveModelDigests, the bench plant). Every traced axis is an axis of the drive model."""
        if "driveModelRef" in engine or "controlProfileRef" in engine:
            raise WorkerError("BENCH_DRIVE_CONFLICT", "a bench takes its drive documents from payload.bench; this scene names its own")

        def read(ref):
            raw = confined(self.bundle_root, ref["path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != ref["sha256"]:
                raise WorkerError("SCENE_FILE_MISMATCH", ref["path"])
            return json.loads(raw)
        drive = self._drive_docs(bench, read, plant_digest)   # the wire schema requires both refs
        unknown = set(bench["axisIds"]) - {a["axisId"] for a in drive[0]["axes"]}
        if unknown:
            raise WorkerError("BENCH_AXIS_UNKNOWN", f"{sorted(unknown)} are not axes of {drive[0]['id']}")
        return drive

    def _validate_document(self, value, filename):
        reject_non_finite(value)
        errors = list(schema_validator(self.schema_dir, filename).iter_errors(value))
        if errors:
            raise WorkerError("SCENE_SCHEMA_INVALID", f"{filename}: {errors[0].message}")

    def _create_world(self, p):
        from .world_engine import WorldEngine
        from .compile import CompileError
        if p.get("arms") or self.payload_perturbation:
            raise WorkerError("INVALID_REQUEST", "one world create has no separate arm tokens or mobile perturbation")
        scene = json.loads(confined(self.bundle_root, "lab-world-scene.json").read_text())
        self._validate_document(scene, "lab-world-scene-v1.schema.json")
        digest = scene_digest_of(scene)
        if digest != scene["sceneDigest"] or self.expected_scene_digest and digest != self.expected_scene_digest:
            raise WorkerError("SCENE_DIGEST_MISMATCH", "world scene identity mismatch")
        for part in (scene["navigation"], scene["armCell"]):
            if scene_digest_of(part) != part["sceneDigest"]:
                raise WorkerError("SCENE_DIGEST_MISMATCH", "nested world scene identity mismatch")
        if engine_seed(p["seed"]) != scene["armCell"]["engineSeed"]:
            raise WorkerError("SEED_MISMATCH", "world engine seed mismatch")
        files = {}
        for ref in scene["files"]:
            raw = confined(self.bundle_root, ref["path"]).read_bytes()
            if ref["path"] in files or len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref["sha256"]:
                raise WorkerError("SCENE_FILE_MISMATCH", ref["path"])
            files[ref["path"]] = (ref["sha256"], raw)
        def document(ref):
            if ref["path"] not in files or files[ref["path"]][0] != ref["sha256"]:
                raise WorkerError("SCENE_FILE_MISMATCH", ref["path"])
            return json.loads(files[ref["path"]][1])
        docs = {k: document(ref) for k,ref in scene["models"].items()}
        self.world_policy = document(scene["handoffPolicyRef"])
        self.world_programs=document(scene["programsRef"])["programs"]
        self._validate_document(docs["emptyLoad"], "load-profile-v1.schema.json")
        self._validate_document(docs["mobilePhysical"], "robot-physical-model-v1.schema.json")
        self._check_physics_profile(docs["mobilePhysics"]) # component drive policy only; world numerics override explicitly
        nav, arm = scene["navigation"], scene["armCell"]
        rid = nav["robots"][0]["robotId"]
        model = docs["mobilePhysical"]
        actual = hashlib.sha256(rfc8785.dumps({k:v for k,v in model.items() if k != "modelDigest"})).hexdigest()
        bindings = scene["propBindings"]
        ids = [rid, arm["arm"]["armId"], *[b["propId"] for b in bindings]]
        if actual != model["modelDigest"] or actual != nav["robots"][0]["model"]["physicalModelDigest"] or model["robotId"] != rid or len(set(ids)) != len(ids) or len(set(b["cupId"] for b in bindings)) != len(bindings) or set(b["propId"] for b in bindings) != set(c["propId"] for c in arm["props"]):
            raise WorkerError("WORLD_IDENTITY_INVALID", "world model or prop binding mismatch")
        disturbance=scene.get('disturbance')
        if disturbance:
            binding=next((b for b in bindings if b['cupId']==disturbance['cupId']),None)
            valid=binding and ((disturbance['presetId']=='world-dock-drift-v1' and disturbance['targetId']==rid and disturbance['trigger']=='before_release') or (disturbance['presetId']=='world-cup-fall-v1' and disturbance['targetId']==binding['propId'] and disturbance['trigger']=='transport'))
            if not valid:raise WorkerError('WORLD_PERTURBATION_NOT_ADMITTED','admitted target binding')
        drive = self._drive_docs(scene.get("engine") or {}, document, plant_digest=world_plant_digest(scene))   # one combined drive model and profile for all nine axes, bound to this world's plant
        try:
            self.engine = WorldEngine(scene,docs["armComponent"],docs["armPhysics"],{rid:model},docs["emptyLoad"],docs["mobilePhysics"],str(confined(self.bundle_root,"blobs",directory=True)),**({"drive":drive} if drive else {}))
        except CompileError as e:
            raise WorkerError(e.code,e.detail or e.code)
        self.scene,self.world,self.state,self.drive_on = scene,True,"created",drive is not None
        self.cups = {c["propId"]:(c["radiusM"],c["heightM"]) for c in arm["props"]}
        return self._advance_world(arm["arm"]["homeRad"],self.engine.opening_max_m,[],0,0,0,commands=self.engine.drive.g.prime_commands() if drive else None)

    def _check_drive_commands(self, commands, kin):
        """Refuses a drive tick before anything is spent: the commands of every axis (DriveGroup.check, pure) and the (v, omega) the two wheel commands amount to against the admitted
        navigation limits, as VELOCITY_TARGET_OUT_OF_RANGE always was on the velocity path. Returns the wheel commands' (v, omega)."""
        g, mob = self.engine.drive.g, getattr(self.engine, "mobile", self.engine)
        by_id = g.check(commands)
        left, right = by_id[mob.rid + "/wheel-left"]["target"], by_id[mob.rid + "/wheel-right"]["target"]
        v, w = (left + right) / 2 * mob.radius, (right - left) * mob.radius / mob.separation
        if abs(v) > kin["maxLinearMps"] * (1 + 1e-9) or abs(w) > kin["maxAngularRadps"] * (1 + 1e-9):
            raise WorkerError("VELOCITY_TARGET_OUT_OF_RANGE", "wheel commands exceed the admitted navigation limits")
        return v, w

    def _advance_world(self,q,opening,placements,v,w,tick,disturbance=None,commands=None):
        reading = self.engine.step(q,opening,placements,v,w,disturbance) if commands is None else self.engine.step(q,opening,placements,v,w,disturbance,commands)
        self.substeps += 10
        if abs(reading["time"]-self.substeps*.002)>CLOCK_TOLERANCE_S:
            raise WorkerError("CLOCK_DRIFT","world clock mismatch",fatal=True)
        self.seq += 1
        self.snapshot = {**reading["world"],"runId":self.run_id,"bootId":self.boot_id,"seq":str(self.seq),"tick":tick,"simTimeNs":str(tick*20_000_000),"sceneDigest":self.scene["sceneDigest"]}
        self.present = {p["propId"]:tuple(p["position"]) for p in self.snapshot["props"]}
        return self.snapshot

    def _step_world(self,p):
        # Validate every intent and command before the shared engine can mutate.
        intents,placements = p.get("worldInteractions") or [],p.get("propPlacements") or []
        bad = lambda: WorkerError("WORLD_INTERACTION_INVALID","world placements require unique admitted source intents")
        if len(intents)!=len(placements) or p.get("actorUpdates"):
            raise bad()
        seen=set();props=set()
        for i,pl in zip(intents,placements):
            pid=i["propId"]
            if i["eventId"] in seen or i["eventId"] in self.world_events or pid in props or pid!=pl["propId"] or i["targetTick"]!=p["targetTick"] or not any(b["propId"]==pid and b["cupId"]==i["cupId"] for b in self.scene["propBindings"]):raise bad()
            seen.add(i["eventId"]);props.add(pid)
            if i["kind"]=="birth":
                at=pl["pose"];birth=self.world_policy["birth"]
                if at is None or pid in self.world_born or any(abs(at["position"][k]-birth["centerM"][k])>(birth["maxOffsetXYM"]+1e-10 if k<2 else 1e-9) for k in range(3)) or any(abs(a-b)>1e-6 for a,b in zip(at["quaternionXyzw"],[0,0,0,1])):raise bad()
            elif i["kind"]=="remove":
                if pl["pose"] is not None or pid not in self.present:raise bad()
            else:raise bad()
        nav=self.scene["navigation"]
        commands=None
        if self.drive_on:
            if p.get("velocities") or p.get("jointTargets") or p.get("gripperTargets"):raise WorkerError("INVALID_REQUEST","a world with a drive model takes driveCommands, not velocities or arm targets")
            commands=p.get("driveCommands")
            if commands is None:raise WorkerError("DRIVE_COMMAND_REQUIRED","every tick needs one command per drive axis")
            self._check_drive_commands(commands,nav["robots"][0]["model"]["kinematics"])
            rid=nav["robots"][0]["robotId"];wheels=[c["target"] for c in commands if c["axisId"] in (rid+"/wheel-left",rid+"/wheel-right")]
            v,w=(1.0,0.0) if any(x!=0 for x in wheels) else (0.0,0.0)   # only whether the wheels are asked to move matters to the interlock below
        else:
            velocities=p.get("velocities") or []
            if len(velocities)!=1 or velocities[0]["robotId"]!=nav["robots"][0]["robotId"]:raise WorkerError("ROBOT_UNKNOWN","world needs one AMR target")
            v,w=velocities[0]["vMps"],velocities[0]["omegaRadps"];kin=nav["robots"][0]["model"]["kinematics"]
            if not snapshot._finite([v,w]) or abs(v)>kin["maxLinearMps"] or abs(w)>kin["maxAngularRadps"]:raise WorkerError("VELOCITY_TARGET_OUT_OF_RANGE","world target exceeds navigation limits")
        control=p.get('worldControl')
        if self.scene.get('controlContextVersion')==1:
            if not control or control.get('version')!=1:raise WorkerError('WORLD_CONTROL_INVALID','required world context')
            program=control.get('program');proxy=control.get('attachmentProxyPropId')
            if proxy is not None and proxy not in self.present:raise WorkerError('WORLD_CONTROL_INVALID','inactive attachment proxy')
            if program:
                stages=self.world_programs['choreography'].get(program.get('programId'),[]);stage=program.get('stage',-1)
                if not isinstance(stage,int) or stage<0 or stage>=len(stages) or stages[stage]['waypoint']!=program.get('waypoint') or not any(b['cupId']==program.get('cupId') for b in self.scene['propBindings']):raise WorkerError('WORLD_CONTROL_INVALID','unadmitted program/stage/cup')
            if control.get('movementInterlocked')!=bool(program or proxy or control.get('stopLatched')) or control.get('movementInterlocked') and (v!=0 or w!=0):raise WorkerError('WORLD_CONTROL_INVALID','movement interlock')
        elif control is not None:raise WorkerError('WORLD_CONTROL_INVALID','unadmitted control context')
        if self.drive_on:
            # the dock-drift preset is admitted before release with a CLOSED commanded gripper: on a drive world the commanded opening is the gripper axis' command mapped back (closed = hi end of its range)
            g=next(c for c in commands if c["axisId"]==self.scene["armCell"]["arm"]["armId"]+"/gripper");lo,hi=self.engine.arm.grip_range
            q,opening,checked=None,self.engine.opening_max_m*(1-(g["target"]-lo)/(hi-lo)),self._check_placements(p)
        else:q,opening,checked=self._check_step({**p,"velocities":[],"actorUpdates":[]})
        disturbances=p.get('worldPerturbations') or []
        disturbance=disturbances[0] if len(disturbances)==1 else None
        admitted=self.scene.get('disturbance')
        if disturbances:
            if not admitted or len(disturbances)!=1 or self.world_disturbance_consumed or any(disturbance.get(k)!=admitted[k] for k in ('presetId','revision','targetId')) or disturbance.get('targetTick')!=self.tick+1 or not disturbance.get('eventId'):
                raise WorkerError('WORLD_PERTURBATION_NOT_ADMITTED','one admitted one-shot preset')
            target=disturbance['targetId'];arm=self.snapshot['arms'][0]
            if admitted['presetId']=='world-dock-drift-v1':
                valid=target==nav['robots'][0]['robotId'] and admitted['trigger']=='before_release' and any(b['cupId']==admitted['cupId'] and b['propId'] in arm['gripper']['heldPropIds'] for b in self.scene['propBindings']) and opening is not None and opening<=.001
            else:
                prop=next((x for x in self.snapshot['props'] if x['propId']==target),None)
                valid=admitted['trigger']=='transport' and prop and prop['restingOn']==self.scene['supportMap']['mobileSupportId'] and target not in arm['gripper']['heldPropIds'] and abs(self.snapshot['robots'][0]['bodyVelocity'][0])>.01
            if not valid:raise WorkerError('WORLD_PERTURBATION_PHASE_INVALID','actual pre-release or supported transport observation required')
            before=(self.snapshot['physics']['base'][0]['poseMap']['positionM'] if target==nav['robots'][0]['robotId'] else next(x['position'] for x in self.snapshot['props'] if x['propId']==target))
            self.world_disturbance_consumed=True # before the first external force; never retry an uncertain application
        result=self._advance_world(q,opening,checked,v,w,self.tick+1,disturbance,commands)
        if disturbance:
            from .world_engine import WORLD_DISTURBANCES
            target=disturbance['targetId'];preset=WORLD_DISTURBANCES[disturbance['presetId']]
            after=(result['physics']['base'][0]['poseMap']['positionM'] if target==nav['robots'][0]['robotId'] else next(x['position'] for x in result['props'] if x['propId']==target))
            result['worldStep']['disturbances']=[{**disturbance,'runId':self.run_id,'bootId':self.boot_id,'sceneDigest':self.scene['sceneDigest'],'requestId':self.current_request_id,'requestDigest':hashlib.sha256(rfc8785.dumps(p)).hexdigest(),'frame':'map','forceMapN':preset['forceMapN'],'durationSubsteps':10,'beforePositionM':list(before),'afterPositionM':list(after)}]

        self.world_events.update(seen)
        self.world_born.update(i["propId"] for i in intents if i["kind"]=="birth")
        return result

    def _create_mobile(self, p):
        """Schema, confinement and stored byte identities are admitted before model construction."""
        from .compile import CompileError
        scene = json.loads(confined(self.bundle_root, "navigation-scene.json").read_text())
        if len(scene.get("robots", [])) > 1:
            raise WorkerError("WORLD_CAPACITY_EXCEEDED", "one mobile AMR per world")
        self._validate_document(scene, "navigation-scene-v1.schema.json")
        if scene["engine"]["id"] != "mujoco_3d":
            raise WorkerError("SCENE_UNSUPPORTED", "not a MuJoCo navigation scene")
        digest = scene_digest_of(scene)
        if digest != scene["sceneDigest"] or self.expected_scene_digest and digest != self.expected_scene_digest:
            raise WorkerError("SCENE_DIGEST_MISMATCH", "navigation scene identity mismatch")
        rid = scene["robots"][0]["robotId"]
        if p.get("arms"):
            raise WorkerError("INVALID_REQUEST", "mobile-only create does not take arm tokens")
        files = {}
        for ref in scene["files"]:
            if ref["path"] in files:
                raise WorkerError("SCENE_SCHEMA_INVALID", "duplicate file path")
            raw = confined(self.bundle_root, ref["path"]).read_bytes()
            if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref["sha256"]:
                raise WorkerError("SCENE_FILE_MISMATCH", ref["path"])
            files[ref["path"]] = (ref["sha256"], raw)
        def profile(ref, schema=None):
            confined(self.bundle_root, ref["path"])
            if ref["path"] not in files or files[ref["path"]][0] != ref["sha256"]:
                raise WorkerError("SCENE_FILE_MISMATCH", ref["path"])
            obj = json.loads(files[ref["path"]][1])
            if schema:
                self._validate_document(obj, schema)
            if (obj["id"], obj["revision"]) != (ref["id"], ref["revision"]):
                raise WorkerError("PROFILE_ID_MISMATCH", ref["path"])
            actual = hashlib.sha256(rfc8785.dumps({k: v for k, v in obj.items() if k != "digest"})).hexdigest()
            if actual != obj["digest"]:
                raise WorkerError("DIGEST_MISMATCH", ref["path"])
            return obj
        load = profile(scene["engine"]["loadProfileRef"], "load-profile-v1.schema.json")
        if p.get("bench") is not None and load["props"]:
            # the wheel inertia counts the AMR's own tree (mobile_engine.traced_inertia); a free payload is a tree of its own, so its J would be silently low
            raise WorkerError("BENCH_SCENE_UNSUPPORTED", "a wheel bench runs on an empty load only")
        physics = profile(scene["engine"]["physicsProfileRef"])
        self._check_physics_profile(physics)
        if self.payload_perturbation:
            canonical = json.loads((Path(__file__).resolve().parents[1] / "fixtures/serve-payload-v1/cup-center.json").read_text())
            if load["props"] != canonical["props"] or load["supports"] != canonical["supports"]:
                raise WorkerError("PERTURBATION_SCOPE_INVALID", "canonical free center cup required")
        ref = load["modelRef"]
        confined(self.bundle_root, ref["path"])
        if ref["path"] not in files or files[ref["path"]][0] != ref["sha256"]:
            raise WorkerError("SCENE_FILE_MISMATCH", ref["path"])
        model = json.loads(files[ref["path"]][1])
        self._validate_document(model, "robot-physical-model-v1.schema.json")
        actual = hashlib.sha256(rfc8785.dumps({k:v for k,v in model.items() if k != "modelDigest"})).hexdigest()
        if actual != model["modelDigest"] or actual != scene["robots"][0]["model"]["physicalModelDigest"] or model["robotId"] != rid:
            raise WorkerError("MODEL_DIGEST_MISMATCH", "physical model does not match navigation projection")
        from .compile_mobile import resolve_lidar
        try:
            resolve_lidar(scene["robots"][0]["model"], model)
        except CompileError as e:
            raise WorkerError(e.code, e.detail or e.code)
        bench = p.get("bench")
        drive = self._bench_drive(bench, scene["engine"], model["modelDigest"]) if bench else self._drive_docs(scene["engine"], lambda ref: profile(ref), plant_digest=model["modelDigest"])
        factory = self._factory
        if factory is None:
            from .mobile_engine import MobileEngine
            factory = MobileEngine
        try:
            engine = factory(scene, {rid: model}, load, physics, **({"drive": drive} if drive else {}))
        except CompileError as e:
            raise WorkerError(e.code, e.detail or e.code)
        self.engine, self.scene, self.mobile, self.drive_on = engine, scene, True, drive is not None
        self.state, self.bench = "created", bench
        if bench:
            engine.drive.g.start_trace(bench["axisIds"])
        return self._advance_mobile(0, 0, tick=0, commands=engine.drive.g.prime_commands() if drive else None)

    def _check_physics_profile(self, p):
        """Closed v1 measurement profile; unknown numerical assumptions are refused."""
        import jsonschema
        from .compile_mobile import NUMERICS
        number = {"type": "number", "minimum": 0}
        def obj(properties):
            return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}
        # Resolve SourceRef's own refs through the normal registry by validating each
        # source separately; the profile's numerical structure is deliberately closed.
        fields = {"schemaVersion": {"const": 1}, "id": {"type": "string"}, "revision": {"type": "integer", "minimum": 1}, "digest": {"type": "string"}, "calibration": {"const": "not_calibrated"},
                  "tickMs": {"const": 20}, "timestepMs": {"const": 2}, "substeps": {"const": 10}, "integrator": {"const": "implicitfast"},
                  "solver": obj({"iterations": {"type": "integer", "minimum": 1, "maximum": 1000}, "tolerance": {"type": "number", "exclusiveMinimum": 0}}),
                  "velocityGainNmsPerRad": {"type": "number", "exclusiveMinimum": 0}, "brakeTorqueNm": {"type": "number", "exclusiveMinimum": 0},
                  "driveCurve": {"type": "array", "minItems": 2, "maxItems": 32, "items": obj({"speedRadS": number, "torqueNm": number})},
                  "contact": obj({"sliding": number, "torsionalM": number, "rollingM": number}),
                  "sources": obj({k: {"type": "object"} for k in ("velocityGainNmsPerRad", "brakeTorqueNm", "driveCurve", "contact", "solver")}),
                  "requiresB02MeasurementLock": {"const": False}, "numerics": {"const": NUMERICS},
                  "measurementLock": obj({"probeId": {"enum": ["b02a-locked", "b04a-drive-contact-low-v1", "b04a-drive-contact-high-v1"]},
                    "numericalInputSha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"}, "engineVersion": {"const": "3.17.0"}, "status": {"const": "locked_not_calibrated"},
                    "repeatPositionToleranceM": {"const": 1e-6}, "repeatAngleToleranceRad": {"const": 1e-6}})}
        schema = obj(fields)
        errors = list(jsonschema.Draft7Validator(schema).iter_errors(p))
        if errors:
            raise WorkerError("PHYSICS_PROFILE_INVALID", errors[0].message)
        keys = ("tickMs", "timestepMs", "substeps", "integrator", "solver", "velocityGainNmsPerRad", "brakeTorqueNm", "driveCurve", "contact", "numerics")
        fingerprint = hashlib.sha256(rfc8785.dumps({k: p[k] for k in keys})).hexdigest()
        if fingerprint != p["measurementLock"]["numericalInputSha256"]:
            raise WorkerError("PHYSICS_PROFILE_INVALID", "numerical lock fingerprint mismatch")
        registered = json.loads((Path(__file__).resolve().parents[1] / "fixtures/serve-payload-v1/registered-physics.json").read_text())
        digest = hashlib.sha256(rfc8785.dumps({k:v for k,v in p.items() if k != "digest"})).hexdigest()
        if not any(x["digest"] == digest and x["probeId"] == p["measurementLock"]["probeId"] for x in registered.values()):
            raise WorkerError("PHYSICS_PROFILE_INVALID", "unregistered numerical profile")
        for value in p["sources"].values():
            self._validate_document(value, "engineering-component.schema.json#/definitions/SourceRef")
        curve = p["driveCurve"]
        if curve[0]["speedRadS"] != 0 or curve[-1]["torqueNm"] != 0 or any(b["speedRadS"] <= a["speedRadS"] or b["torqueNm"] > a["torqueNm"] for a,b in zip(curve,curve[1:])):
            raise WorkerError("PHYSICS_PROFILE_INVALID", "ordered non-increasing torque curve must start at rest and end at zero torque")

    def _advance_mobile(self, v, w, commands=None, *, tick):
        injected = self.payload_perturbation is not None and tick == 501 and not self.perturbation_done
        if injected:
            self.perturbation_done = True  # never repeat, including if the step fails
            declaration = self.engine.apply_payload_impulse(self.payload_perturbation)
        try:
            reading = self.engine.step(v, w) if commands is None else self.engine.step(v, w, commands)
        finally:
            if injected:
                self.engine.clear_payload_impulse()
        if injected:
            import os
            receipt = {"id": self.payload_perturbation, "runId": self.run_id, "bootId": self.boot_id,
                       "tick": tick, "frameSampleTick": tick - 1, "sceneDigest": self.scene["sceneDigest"],
                       "loadProfileSha256": self.scene["engine"]["loadProfileRef"]["sha256"],
                       **declaration, "afterPoseMap": reading["loads"][0]["poseMap"]}
            with open("payload-perturbation.json", "x") as f:
                json.dump(receipt, f, allow_nan=False); f.flush(); os.fsync(f.fileno())
        self.substeps += self.scene["engine"]["substeps"]
        snapshot.check_mobile_stable(reading)
        expected = self.substeps * self.scene["engine"]["timestepMs"] / 1000
        if abs(reading["time"] - expected) > CLOCK_TOLERANCE_S:
            raise WorkerError("CLOCK_DRIFT", f"engine time {reading['time']} != {expected}", fatal=True)
        self.seq += 1
        self.snapshot = snapshot.build_mobile(run_id=self.run_id, boot_id=self.boot_id, seq=self.seq, tick=tick, scene=self.scene, reading=reading)
        return self.snapshot

    def _check_mobile_step(self, p):
        if self.drive_on:
            if p.get("velocities") or p.get("actorUpdates") or p.get("jointTargets") or p.get("gripperTargets") or p.get("propPlacements"):
                raise WorkerError("INVALID_REQUEST", "a run with a drive model takes driveCommands only: no velocities, actors, arm commands or placements")
            if p.get("driveCommands") is None:
                raise WorkerError("DRIVE_COMMAND_REQUIRED", "every tick needs one command per drive axis")
            self._check_drive_commands(p["driveCommands"], self.scene["robots"][0]["model"]["kinematics"])
            return 0, 0, p["driveCommands"]
        if p.get("actorUpdates") or p.get("jointTargets") or p.get("gripperTargets") or p.get("propPlacements"):
            raise WorkerError("INVALID_REQUEST", "mobile-only world admits velocities, no interaction placements, actors or arm commands")
        targets = p.get("velocities") or []
        rid = self.scene["robots"][0]["robotId"]
        if len(targets) != 1 or targets[0].get("robotId") != rid:
            raise WorkerError("ROBOT_UNKNOWN", "every tick needs one explicit target for the scene AMR")
        v, w = targets[0]["vMps"], targets[0]["omegaRadps"]
        kin = self.scene["robots"][0]["model"]["kinematics"]
        if not snapshot._finite([v,w]) or abs(v) > kin["maxLinearMps"] or abs(w) > kin["maxAngularRadps"]:
            raise WorkerError("VELOCITY_TARGET_OUT_OF_RANGE", "target exceeds admitted navigation limits")
        return v,w,None

    def _check_arm_drive_step(self, p):
        """The commands of an arm tick on a drive (a bench): every axis, nothing else, no cup placed."""
        if p["velocities"] or p["actorUpdates"] or p.get("jointTargets") or p.get("gripperTargets") or p.get("propPlacements"):
            raise WorkerError("INVALID_REQUEST", "an arm on a drive takes driveCommands only: no velocities, actors, joint or gripper targets or placements")
        if p.get("driveCommands") is None:
            raise WorkerError("DRIVE_COMMAND_REQUIRED", "every tick needs one command per drive axis")
        self.engine.drive.g.check(p["driveCommands"])
        return p["driveCommands"]

    def _check_step(self, p):
        if self.payload_perturbation:
            raise WorkerError("PERTURBATION_SCOPE_INVALID", "mobile free payload only")
        """(targets, opening or None, placements) of a valid arm cell step; refuses before anything reaches the engine."""
        if p["velocities"] or p["actorUpdates"]:
            raise WorkerError("INVALID_REQUEST", "an arm cell run takes jointTargets, gripperTargets and propPlacements, not velocities or actor updates")
        arm_id, limits = (self.scene["armCell"] if self.world else self.scene)["arm"]["armId"], self.engine.arm_limits
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
        return list(q), opening, self._check_placements(p)

    def _check_placements(self, p):
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
        return placements

    def _op_step(self, p):
        single = p.get("singleStep", False)
        if self.state == "paused" and single:
            pass  # one explicit tick while paused; the run stays paused
        elif self.state != "running" or single:
            raise WorkerError("INVALID_STATE", f"step{' (singleStep)' if single else ''} on a {self.state} run")
        if p["targetTick"] != self.tick + 1:
            raise WorkerError("TICK_MISMATCH", f"targetTick {p['targetTick']} must be {self.tick + 1}")
        if self.bench and p["targetTick"] > BENCH_MAX_TICKS:
            raise WorkerError("BENCH_TICK_LIMIT", f"a bench ends at tick {BENCH_MAX_TICKS}")
        if p.get("driveCommands") is not None and not self.drive_on:
            raise WorkerError("INVALID_REQUEST", "driveCommands need a scene with a drive model and a control profile")
        if not self.world and (p.get("worldInteractions") or p.get("worldPerturbations") or p.get("worldControl")):
            raise WorkerError("INVALID_REQUEST", "world interactions require a shared world")
        if self.world:
            snap = self._step_world(p)
        elif self.mobile:
            snap = self._advance_mobile(*self._check_mobile_step(p), tick=self.tick + 1)
        elif self.drive_on:
            snap = self._advance(None, None, [], tick=self.tick + 1, commands=self._check_arm_drive_step(p))
        else:
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
