"""V06b: bench mode of the MuJoCo worker on the real engine. A bench create carries its drive documents in `payload.bench` (D1) and names the 1-2 axes it traces; every snapshot then
carries the 500 Hz trace of those axes and the readback their effective inertia (D4). Two benches: the wheels on the mobile scene path (serve-payload-v1, load `empty`) and one joint
or the gripper on the arm-only scene path (xarm6-g2-v1 at home, no cup placed)."""
import hashlib
import json
import shutil
from pathlib import Path

import mujoco
import numpy as np
import pytest
import rfc8785
from scene_fixture import BLOBS, FX, cell_scene

from mujoco_worker.engine import MujocoEngine
from mujoco_worker.mobile_engine import MobileEngine
from mujoco_worker.protocol import PROTOCOL, WorkerError, load_validators, parse_line
from mujoco_worker.session import WorkerSession, scene_digest_of

ROOT = Path(__file__).resolve().parents[1]
DRIVE, SERVE = ROOT / "fixtures" / "drive-v1", ROOT / "fixtures" / "serve-payload-v1"
SCHEMAS = ROOT.parents[1] / "packages" / "contracts" / "schemas"
WHEELS = ["amr-1/wheel-left", "amr-1/wheel-right"]
ARM_TOKEN = {"armId": "xarm-1", "sceneRef": "arm-cell-scene.json"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def seal(d):
    d["digest"] = hashlib.sha256(rfc8785.dumps({k: v for k, v in d.items() if k != "digest"})).hexdigest()
    return d


def put(root, name, document):
    """Writes a drive document into the bundle (a drive-v1 file name, or a dict written as is) and returns its DriveDocumentRef."""
    raw = (DRIVE / document).read_bytes() if isinstance(document, str) else (json.dumps(document, indent=2) + "\n").encode()
    (root / name).write_bytes(raw)
    d = json.loads(raw)
    return {"id": d["id"], "revision": d["revision"], "path": name, "sha256": sha(raw)}


def wheel_bundle(root):
    shutil.copytree(SERVE, root, dirs_exist_ok=True)
    scene = json.loads((root / "navigation-scene.json").read_text())
    raw = (SERVE / "empty.json").read_bytes()
    empty = json.loads(raw)
    scene["engine"]["loadProfileRef"] = {"id": empty["id"], "revision": empty["revision"], "path": "empty.json", "sha256": sha(raw)}
    scene["sceneDigest"] = scene_digest_of(scene)
    (root / "navigation-scene.json").write_text(json.dumps(scene))
    return scene


def arm_bundle(root):
    scene = cell_scene(("cup-1", "cup-2"), engine_seed=7)   # the scene's cups exist, parked; no placement births one
    (root / "arm-cell-scene.json").write_text(json.dumps(scene))
    for f in ("component.json", "physics.json"):
        shutil.copy(FX / f, root / f)
    shutil.copytree(BLOBS, root / "blobs")
    return scene


KINDS = {"wheel": (wheel_bundle, "serve-drive-nominal-v1.json", "serve-control-v1.json", {"sceneRef": "navigation-scene.json", "seed": 7}),
         "arm": (arm_bundle, "xarm6-drive-nominal-v1.json", "xarm6-control-v1.json", {"sceneRef": "arm-cell-scene.json", "seed": 7, "arms": [ARM_TOKEN]})}


class Bench:
    """One bench session on a fresh bundle; `factory_calls` counts the engines built."""

    def __init__(self, root, kind, axes, model=None, control=None):
        build, m, c, create = KINDS[kind]
        scene = build(root)
        self.bench = {"driveModelRef": put(root, "bench-drive.json", model or m), "controlProfileRef": put(root, "bench-control.json", control or c), "axisIds": list(axes)}
        self.create_payload = {**create, "bench": self.bench}
        self.factory_calls = 0
        engine = MobileEngine if kind == "wheel" else MujocoEngine

        def factory(*a, **kw):
            self.factory_calls += 1
            return engine(*a, **kw)
        self.s = WorkerSession(run_id="bench-1", bundle_root=root, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"], engine_factory=factory)
        self.scene, self.n = scene, 0

    def request(self, op, payload):
        self.n += 1
        return {"protocol": PROTOCOL, "requestId": f"{op}-{self.n}", "runId": "bench-1", "expectedTick": self.s.tick, "op": op, "payload": payload}

    def create(self, **over):
        return self.s.handle(self.request("create", {**self.create_payload, **over}))

    def start(self):
        created = self.create()
        assert created["ok"], created
        assert self.s.handle(self.request("start", {}))["ok"]
        return created

    def commands(self, offsets=None):
        """Every axis holds where it started (a wheel at rest), plus `offsets` {axisId: value}; a fresh seq each tick."""
        g, offsets = self.s.engine.drive.g, offsets or {}
        return [{"axisId": a["axisId"], "seq": self.s.tick + 1, "mode": a["mode"], "target": g.initial_target[i] + offsets.get(a["axisId"], 0.0), "enable": True, "quickStop": False,
                 "faultReset": False} for i, a in enumerate(g.axes)]

    def step(self, offsets=None, *, command_overrides=None):
        commands = self.commands(offsets)
        for c in commands:
            c.update((command_overrides or {}).get(c["axisId"], {}))
        return self.s.handle(self.request("step", {"targetTick": self.s.tick + 1, "velocities": [], "actorUpdates": [], "driveCommands": commands}))

    def readback(self):
        r = self.s.handle(self.request("getState", {}))
        assert r["ok"], r
        return r


def check_trace(snap, axes, modes):
    """driveTrace: one entry per traced axis in the order asked, 10 samples 2 ms apart, the last sample is the end-of-tick state the snapshot reports, the saturated flags add up to
    the tick's saturated substeps."""
    trace, by = snap["driveTrace"], {d["axisId"]: d for d in snap["drives"]}
    assert [t["axisId"] for t in trace] == axes
    for t in trace:
        csp, d, last = modes[t["axisId"]] == "csp", by[t["axisId"]], t["samples"][-1]
        assert t["dtS"] == 0.002 and len(t["samples"]) == 10
        assert last["target"] == d["targetApplied"] and last["torqueNm"] == d["torqueNm"]
        assert last["actual"] == (d["actualPositionRad"] if csp else d["actualVelocityRadS"])
        assert last["feedback"] == (d["positionRad"] if csp else d["velocityRadS"])
        assert sum(s["saturated"] for s in t["samples"]) == d["saturatedSubsteps"]


# ---- the trace ----------------------------------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("kind,axes,stepped,amplitude", [("wheel", WHEELS, WHEELS, 2.0), ("arm", ["xarm-1/J3", "xarm-1/gripper"], ["xarm-1/J3"], 0.1)])
def test_a_bench_snapshot_carries_ten_samples_per_traced_axis_and_tick_and_the_last_equals_the_end_state(tmp_path, monkeypatch, kind, axes, stepped, amplitude):
    b = Bench(tmp_path, kind, axes)
    created = b.start()
    _, validator = load_validators(SCHEMAS)
    validator.validate(created)
    g = b.s.engine.drive.g
    modes = {a["axisId"]: a["mode"] for a in g.axes}
    check_trace(created["result"], axes, modes)                       # the priming tick is traced too
    # an independent record of the true state after every mj_step of the engine: the trace's `actual` must be it, substep by substep
    binding, real_step, truth = b.s.engine.drive, mujoco.mj_step, []
    idx = [g.index[a] for a in axes]

    def spy(m, d, *rest):
        real_step(m, d, *rest)
        truth.append([float(d.qpos[binding.qadr[i]]) if modes[g.ids[i]] == "csp" else float(d.qvel[binding.dof[i]]) for i in idx])
    monkeypatch.setattr(mujoco, "mj_step", spy)
    for k in range(40):
        truth.clear()
        r = b.step({a: amplitude for a in stepped} if k >= 10 else None)
        assert r["ok"], r
        validator.validate(r)
        check_trace(r["result"], axes, modes)
        assert [[s["actual"] for s in t["samples"]] for t in r["result"]["driveTrace"]] == [list(x) for x in zip(*truth)]
        if k == 11:
            assert len({s["actual"] for s in r["result"]["driveTrace"][0]["samples"]}) == 10   # ten different states while it moves, not one state ten times
    assert r["result"]["drives"][g.index[stepped[0]]]["state"] == "enabled"
    b.s.end()


def test_the_feedback_of_a_traced_axis_is_null_while_its_encoder_delivers_nothing(tmp_path):
    b = Bench(tmp_path, "arm", ["xarm-1/J3"])
    b.start()
    for _ in range(5):
        assert b.step()["ok"]
    b.s.engine.drive.g.set_feedback_valid("xarm-1/J3", False)
    r = b.step()
    assert r["ok"], r
    samples = r["result"]["driveTrace"][0]["samples"]
    assert [s["feedback"] for s in samples] == [None] * 10 and all(s["actual"] is not None for s in samples)
    b.s.end()


@pytest.mark.parametrize("ki", [0, 3000.0], ids=["slew-only", "slew-with-integral"])
def test_admitted_j2_slew_hold_seeds_the_nonzero_reference_at_enable_and_reenable(tmp_path, monkeypatch, ki):
    axis = "xarm-1/J2"
    control = json.loads((DRIVE / "xarm6-control-v1.json").read_text())
    c = next(a for a in control["axes"] if a["axisId"] == axis)
    c["loop"].update(ki=ki, integralLimit=2.0 if ki else None, slewLimit=0.5)
    b = Bench(tmp_path, "arm", [axis], control=seal(control))
    b.start()
    binding, real_step = b.s.engine.drive, mujoco.mj_step
    i = binding.g.index[axis]
    qadr, adr, n = binding.qadr[i], binding.actadr[i], binding.actnum[i]
    assert n == (2 if ki else 1)
    home = binding.g.initial_target[i]
    assert abs(home) > 1.0
    activations = []
    was_active = False

    def spy(model, data, *rest):
        nonlocal was_active
        active = binding.active[i]
        if active and not was_active:
            activations.append((float(data.qpos[qadr]), data.act[adr:adr + n].tolist()))
        was_active = active
        real_step(model, data, *rest)

    monkeypatch.setattr(mujoco, "mj_step", spy)

    def hold(position):
        snapshots = []
        for _ in range(25):
            r = b.step({axis: position - home})
            assert r["ok"], r
            snapshots.append(r["result"]["drives"][i])
        q, state = activations[-1]
        assert state == ([q, 0.0] if ki else [q])
        assert all(s["fault"] is None and abs(s["actualPositionRad"] - position) < 0.01 for s in snapshots)
        assert snapshots[-1]["state"] == "enabled"

    try:
        hold(home)
        for _ in range(8):
            assert b.step(command_overrides={axis: {"enable": False}})["result"]["drives"][i]["state"] == "disabled"
        hold(float(binding.d.qpos[qadr]))
        assert len(activations) == 2
    finally:
        b.s.end()


@pytest.mark.parametrize("flag", ["disable", "quick-stop"])
def test_a_wheel_bench_trace_at_stop_matches_the_real_actuator_input(tmp_path, monkeypatch, flag):
    axis = WHEELS[0]
    b = Bench(tmp_path, "wheel", [axis])
    b.start()
    binding, real_step = b.s.engine.drive, mujoco.mj_step
    i = binding.g.index[axis]
    try:
        for _ in range(15):
            moving = b.step({a: 2.0 for a in WHEELS})["result"]["drives"][i]
        assert moving["state"] == "enabled" and moving["targetApplied"] == 2.0 and moving["actualVelocityRadS"] > 0.5
        observed = []

        def spy(model, data, *rest):
            observed.append((binding.active[i], float(data.ctrl[binding.adr0[i]])))
            real_step(model, data, *rest)

        monkeypatch.setattr(mujoco, "mj_step", spy)
        flags = {"enable": False} if flag == "disable" else {"quickStop": True}
        result = b.step({a: 2.0 for a in WHEELS}, command_overrides={a: flags for a in WHEELS})["result"]
        assert observed == [(flag == "quick-stop", 0.0)] * 10
        assert result["drives"][i]["state"] == ("disabled" if flag == "disable" else "quick_stop")
        assert result["drives"][i]["targetApplied"] == observed[-1][1]
        assert [s["target"] for s in result["driveTrace"][0]["samples"]] == [target for _, target in observed]
    finally:
        b.s.end()


def test_a_run_without_bench_has_no_trace_and_no_effective_inertia(tmp_path):
    """A CIL mobile run (drive refs in the scene) and a legacy arm run: the bench fields never appear."""
    root = tmp_path / "cil"
    root.mkdir()
    scene = wheel_bundle(root)
    for name, key in (("serve-drive-nominal-v1.json", "driveModelRef"), ("serve-control-v1.json", "controlProfileRef")):
        ref = put(root, name, name)
        scene["engine"][key] = ref
        scene["files"].append({"path": name, "sha256": ref["sha256"], "bytes": (root / name).stat().st_size})
    scene["sceneDigest"] = scene_digest_of(scene)
    (root / "navigation-scene.json").write_text(json.dumps(scene))
    s = WorkerSession(run_id="bench-1", bundle_root=root, lock_digest="b" * 64)
    req = lambda op, p, rid: {"protocol": PROTOCOL, "requestId": rid, "runId": "bench-1", "expectedTick": s.tick, "op": op, "payload": p}
    assert s.handle(req("create", {"sceneRef": "navigation-scene.json", "seed": 7}, "c"))["ok"] and s.handle(req("start", {}, "s"))["ok"]
    wheels = [{"axisId": a, "seq": 1, "mode": "csv", "target": 1.0, "enable": True, "quickStop": False, "faultReset": False} for a in WHEELS]
    r = s.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": [], "driveCommands": wheels}, "t"))
    assert r["ok"] and "drives" in r["result"] and "driveTrace" not in r["result"]
    assert "effectiveInertiaKgM2" not in s.handle(req("getState", {}, "g"))["result"]["model"]
    s.end()
    root = tmp_path / "legacy"
    root.mkdir()
    arm_bundle(root)
    s = WorkerSession(run_id="bench-1", bundle_root=root, lock_digest="b" * 64)
    created = s.handle(req("create", {"sceneRef": "arm-cell-scene.json", "seed": 7, "arms": [ARM_TOKEN]}, "c"))
    assert created["ok"] and not {"drives", "driveTrace"} & set(created["result"])
    assert set(s.handle(req("getState", {}, "g"))["result"]["model"]) == {"robots", "arm"}
    s.end()


# ---- refusals at create, before any engine ------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("kind,axes,code", [
    ("arm", ["xarm-1/J1", "xarm-1/J2", "xarm-1/J3"], "BENCH_AXIS_COUNT"),
    ("wheel", [*WHEELS, "amr-1/wheel-left"], "BENCH_AXIS_COUNT"),
    ("arm", [], "BENCH_AXIS_COUNT"),
    ("arm", ["xarm-1/J3", "xarm-1/J3"], "BENCH_AXIS_COUNT"),
    ("arm", ["xarm-1/J7"], "BENCH_AXIS_UNKNOWN"),                     # not an axis of the drive model
    ("arm", ["amr-1/wheel-left"], "BENCH_AXIS_UNKNOWN"),              # an axis of another plant
    ("wheel", ["amr-1/caster"], "BENCH_AXIS_UNKNOWN"),
])
def test_a_bench_with_more_than_two_or_unknown_axes_is_refused_before_any_engine_is_built(tmp_path, kind, axes, code):
    b = Bench(tmp_path, kind, axes)
    r = b.create()
    assert not r["ok"] and r["error"]["code"] == code, r
    assert b.factory_calls == 0 and b.s.engine is None and b.s.state == "new"


def test_the_wire_schema_refuses_three_traced_axes_too(tmp_path):
    b = Bench(tmp_path, "arm", ["xarm-1/J1", "xarm-1/J2", "xarm-1/J3"])
    validator, _ = load_validators(SCHEMAS)
    with pytest.raises(WorkerError) as e:
        parse_line(json.dumps(b.request("create", b.create_payload)), validator)
    assert e.value.code == "INVALID_REQUEST"
    ok = b.request("create", {**b.create_payload, "bench": {**b.bench, "axisIds": ["xarm-1/J3"]}})
    assert parse_line(json.dumps(ok), validator) == ok


@pytest.mark.parametrize("kind,axes", [("wheel", WHEELS), ("arm", ["xarm-1/J3"])])
def test_a_bench_takes_its_drive_documents_from_one_source_only(tmp_path, kind, axes):
    b = Bench(tmp_path, kind, axes)
    path = tmp_path / b.create_payload["sceneRef"]
    scene = json.loads(path.read_text())
    scene["engine"]["driveModelRef"], scene["engine"]["controlProfileRef"] = b.bench["driveModelRef"], b.bench["controlProfileRef"]
    scene["sceneDigest"] = scene_digest_of(scene)
    path.write_text(json.dumps(scene))
    b.s.expected_scene_digest = scene["sceneDigest"]
    r = b.create()
    assert not r["ok"] and r["error"]["code"] == "BENCH_DRIVE_CONFLICT", r
    assert b.factory_calls == 0 and b.s.engine is None and b.s.state == "new" and b.s.tick == 0


@pytest.mark.parametrize("unsupported", ["world", "perturbation"])
def test_an_unsupported_bench_is_refused_before_any_engine_is_built(tmp_path, unsupported):
    b = Bench(tmp_path, "wheel", WHEELS)
    if unsupported == "world":
        r = b.create(sceneRef="lab-world-scene.json")
    else:
        b.s.payload_perturbation = "payload-cup-forward-impulse-v1"
        r = b.create()
    assert not r["ok"] and r["error"]["code"] == "BENCH_SCENE_UNSUPPORTED", r
    assert b.factory_calls == 0 and b.s.engine is None and b.s.state == "new" and b.s.tick == 0


@pytest.mark.parametrize("load", ["cup-center.json", "cup-offset.json"])
def test_a_wheel_bench_runs_on_the_empty_load_only(tmp_path, load):
    """V06c ruling 14: the wheel inertia (D4) counts the AMR's own tree; a free payload body is a tree of its own and would be missing from J. A wheel bench on any other load than an
    empty one is refused before any engine is built, never run with a J that is silently low."""
    b = Bench(tmp_path, "wheel", WHEELS)
    scene = json.loads((tmp_path / "navigation-scene.json").read_text())
    raw = (SERVE / load).read_bytes()
    doc = json.loads(raw)
    assert doc["props"]                                                    # the fixture's loads with a cup
    scene["engine"]["loadProfileRef"] = {"id": doc["id"], "revision": doc["revision"], "path": load, "sha256": sha(raw)}
    scene["sceneDigest"] = scene_digest_of(scene)
    (tmp_path / "navigation-scene.json").write_text(json.dumps(scene))
    b.s.expected_scene_digest = scene["sceneDigest"]
    r = b.create()
    assert not r["ok"] and r["error"]["code"] == "BENCH_SCENE_UNSUPPORTED" and b.factory_calls == 0 and b.s.engine is None, r


def other_plant(name):
    return seal({**json.loads((DRIVE / name).read_text()), "plantModelDigest": "c" * 64})


@pytest.mark.parametrize("kind,control", [
    ("wheel", other_plant("serve-control-v1.json")),    # sealed for another plant than the AMR's physical model
    ("arm", other_plant("xarm6-control-v1.json")),      # ... than the arm component's sha256
    ("arm", "serve-control-v1.json"),                    # the AMR's profile on the arm
])
def test_bench_documents_are_bound_to_the_bench_plant(tmp_path, kind, control):
    b = Bench(tmp_path, kind, WHEELS[:1] if kind == "wheel" else ["xarm-1/J3"], control=control)
    r = b.create()
    assert not r["ok"] and r["error"]["code"] == "DRIVE_DOCUMENT_INVALID" and b.factory_calls == 0, r


def tuned(name, **edit):
    """A registry profile whose loop and limits come from a bench run (V07pre: kind tuned_in_simulation), resealed; `edit` changes the tuned source."""
    d = json.loads((DRIVE / name).read_text())
    ref = {"kind": "tuned_in_simulation", "benchRunId": "3f2b1c4d-0000-4000-8000-000000000001", "scenarioId": "MJ-BENCH-WHEEL", "traceSha256": "d" * 64, "sourceCommit": "e" * 40,
           "axisIds": [d["axes"][0]["axisId"]], "driveModelDigest": d["driveModelDigests"][0], **edit}
    return seal({**d, "sources": {**d["sources"], "loop": ref, "limits": ref}})


@pytest.mark.parametrize("kind,name", [("wheel", "serve-control-v1.json"), ("arm", "xarm6-control-v1.json")])
def test_a_profile_tuned_in_simulation_passes_the_worker_schema_check_and_a_malformed_tuned_source_does_not(tmp_path, kind, name):
    axes = WHEELS if kind == "wheel" else ["xarm-1/J3"]
    def fresh(name):
        (tmp_path / name).mkdir()
        return tmp_path / name
    ok = Bench(fresh("ok"), kind, axes, control=tuned(name))
    r = ok.create()
    assert r["ok"], r
    for i, edit in enumerate(({"traceSha256": "D" * 64}, {"sourceCommit": "e" * 39}, {"scenarioId": "MJ-BV01"}, {"locator": "x"}, {"axisIds": []}, {"driveModelDigest": "F" * 64})):
        b = Bench(fresh(str(i)), kind, axes, control=tuned(name, **edit))
        r = b.create()
        assert not r["ok"] and r["error"]["code"] == "SCENE_SCHEMA_INVALID" and b.factory_calls == 0, (edit, r)


@pytest.mark.parametrize("ref,edit,code", [
    ("controlProfileRef", lambda r: {**r, "sha256": "0" * 64}, "SCENE_FILE_MISMATCH"),
    ("driveModelRef", lambda r: {**r, "path": "../bench-drive.json"}, "SCENE_PATH_REJECTED"),
    ("driveModelRef", lambda r: {**r, "path": "missing.json"}, "SCENE_PATH_REJECTED"),
    ("driveModelRef", lambda r: {**r, "revision": 2}, "PROFILE_ID_MISMATCH"),
    ("controlProfileRef", lambda r: {**r, "id": "another-profile"}, "PROFILE_ID_MISMATCH"),   # (id, revision) of both refs, as a scene ref's (session._drive_docs)
])
def test_bench_refs_are_admitted_like_scene_refs(tmp_path, ref, edit, code):
    b = Bench(tmp_path, "arm", ["xarm-1/J3"])
    r = b.create(bench={**b.bench, ref: edit(b.bench[ref])})
    assert not r["ok"] and r["error"]["code"] == code and b.factory_calls == 0, r


# ---- the tick limit --------------------------------------------------------------------------------------------------------------------------------------------
def test_a_bench_refuses_a_step_beyond_tick_500_and_the_run_lives(tmp_path):
    b = Bench(tmp_path, "arm", ["xarm-1/J3"])
    b.start()
    for _ in range(500):
        assert b.step()["ok"]
    t, time = b.s.tick, b.s.engine.data.time
    r = b.step()
    assert not r["ok"] and r["error"]["code"] == "BENCH_TICK_LIMIT", r
    assert (b.s.tick, b.s.engine.data.time, b.s.state) == (t, time, "running") and t == 500
    assert b.readback()["result"]["tick"] == 500
    b.s.end()


# ---- effective inertia (D4) ------------------------------------------------------------------------------------------------------------------------------------
def subtree(m, body):
    return [b for b in range(m.nbody) if any(x == body for x in ancestors(m, b))]


def ancestors(m, b):
    while True:
        yield b
        if b == 0:
            return
        b = m.body_parentid[b]


def hinge_inertia(m, d, joint):
    """The inertia of everything distal to a hinge about its axis with every other joint frozen (the diagonal of the joint-space mass matrix), from body masses, inertias and the
    kinematics alone: sum of a'Ia + m|a x (c - p)|^2 over the subtree, plus the joint's armature."""
    s = mujoco.MjData(m)
    s.qpos[:] = d.qpos
    mujoco.mj_kinematics(m, s)
    a, p = s.xaxis[joint], s.xanchor[joint]
    total = float(m.dof_armature[m.jnt_dofadr[joint]])
    for b in subtree(m, m.jnt_bodyid[joint]):
        r = s.ximat[b].reshape(3, 3)
        inertia = r @ np.diag(m.body_inertia[b]) @ r.T
        total += float(a @ inertia @ a) + float(m.body_mass[b]) * float(np.sum(np.cross(a, s.xipos[b] - p) ** 2))
    return total


def test_the_effective_inertia_of_a_joint_and_the_gripper_is_the_mass_matrix_diagonal_at_the_current_pose(tmp_path):
    b = Bench(tmp_path, "arm", ["xarm-1/J3", "xarm-1/gripper"])
    b.start()
    _, validator = load_validators(SCHEMAS)
    e = b.s.engine
    grip_joint = json.loads((FX / "physics.json").read_text())["gripper"]["driveJoint"]
    authored_joints = {"xarm-1/J3": "J3", "xarm-1/gripper": grip_joint}
    seen = []
    for ticks in (0, 60):
        for k in range(ticks):                                         # J5 moves 0.5 rad (a 0.5 rad/s ramp): the arm distal to J3 changes, so must J3's inertia
            assert b.step({"xarm-1/J5": min(0.5, 0.01 * k)})["ok"]
        r = b.readback()
        validator.validate(r)
        got = r["result"]["model"]["effectiveInertiaKgM2"]
        assert [(x["axisId"], x["basis"], x["provenance"]) for x in got] == [("xarm-1/J3", "mass_matrix_diagonal", "assumed"), ("xarm-1/gripper", "mass_matrix_diagonal", "assumed")]
        for x in got:
            joint = e.model.joint(e.names["jointIds"][authored_joints[x["axisId"]]]).id
            assert x["valueKgM2"] == pytest.approx(hinge_inertia(e.model, e.data, joint), rel=1e-9)
        seen.append(got[0]["valueKgM2"])
    assert abs(seen[1] - seen[0]) > 1e-3
    b.s.end()


def test_the_effective_inertia_of_a_wheel_adds_half_the_mass_of_the_amr_at_the_wheel_radius(tmp_path):
    b = Bench(tmp_path, "wheel", WHEELS)
    b.start()
    r = b.readback()
    load_validators(SCHEMAS)[1].validate(r)
    got = r["result"]["model"]["effectiveInertiaKgM2"]
    e = b.s.engine
    m = e.model
    root = m.body_rootid[e.base]
    mass = sum(float(m.body_mass[x]) for x in range(m.nbody) if m.body_rootid[x] == root)
    drive = json.loads((SERVE / "physical-model-amr-1.json").read_text())["drive"]
    radius = drive["wheelRadiusM"]["value"]
    authored_joints = {"amr-1/wheel-left": drive["leftJointId"], "amr-1/wheel-right": drive["rightJointId"]}
    assert [x["axisId"] for x in got] == WHEELS and {(x["basis"], x["provenance"]) for x in got} == {("wheel_straight_line", "assumed")}
    for x in got:
        joint = m.joint(e.names["joints"][authored_joints[x["axisId"]]]).id
        own = hinge_inertia(m, e.data, joint)
        assert x["valueKgM2"] == pytest.approx(own + mass * radius ** 2 / 2, rel=1e-9)
        assert mass * radius ** 2 / 2 > 10 * own                       # the chassis, not the wheel, is what the wheel drive moves
    b.s.end()


# ---- instability (ruling 6) ---------------------------------------------------------------------------------------------------------------------------------
def test_a_J3_gain_far_above_the_envelope_ceiling_trips_the_drive_and_the_plant_stays_finite(tmp_path):
    """The 92 N m effort limit caps the commanded step before the drive's overspeed protection trips."""
    axis = "xarm-1/J3"
    envelope = json.loads((DRIVE / "tuning-envelope-v1.json").read_text())
    ceiling = next(a for a in envelope["axes"] if a["axisId"] == axis)["kp"]["max"]
    control = json.loads((DRIVE / "xarm6-control-v1.json").read_text())
    next(a for a in control["axes"] if a["axisId"] == axis)["loop"]["kp"] = 100 * ceiling
    b = Bench(tmp_path, "arm", [axis], control=seal(control))
    b.start()
    tripped = None
    for k in range(500):
        r = b.step({axis: 0.1} if k >= 20 else None)          # a 0.1 rad step commanded from tick 21 on
        assert r["ok"], r
        j3 = next(drive for drive in r["result"]["drives"] if drive["axisId"] == axis)
        if tripped is None and j3["fault"]:
            tripped = (r["result"]["tick"], j3["fault"], r["result"]["driveTrace"][0]["samples"])
    assert tripped[:2] == (22, "OVERSPEED")                              # 92 N m at 0.71 kg m^2 passes 1.2 x 3.14 rad/s in the second tick of the step
    assert any(s["saturated"] and abs(abs(s["torqueNm"]) - 92.0) < 1e-9 for s in tripped[2])   # saturated at the effort limit before the trip
    assert b.s.state == "running" and np.isfinite(b.s.engine.data.qpos).all()
    b.s.end()


def test_a_simulated_engine_warning_in_a_bench_ends_the_run_as_plant_unstable(tmp_path):
    """Inject a warning into the engine response to exercise the session's fatal error path."""
    b = Bench(tmp_path, "arm", ["xarm-1/J3"])
    b.start()
    engine = b.s.engine
    real = engine.step
    engine.step = lambda *a: {**real(*a), "unstable": "BADQACC"}
    r = b.step()
    assert not r["ok"] and r["error"]["code"] == "PLANT_UNSTABLE" and b.s.state == "failed" and b.s.engine is None, r
