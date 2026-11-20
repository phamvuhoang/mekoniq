"""The virtual drive on the real engine: the legacy path keeps its bytes, an ideal drive reproduces it bit for bit, the actuators come from the profile, the brake is a model, the
torque envelope is respected, a pid axis converges, and the session refuses what the contract says. Digests are those the V01 spike recorded (arm64, mujoco 3.17.0)."""
import ast
import copy
import hashlib
import json
import platform
import shutil
import sys
import time
from pathlib import Path

import mujoco
import numpy as np
import pytest
import rfc8785

import probe_drive as P
from scene_fixture import BLOBS, cell_scene, load
from mujoco_worker.drive import wheel_targets
from mujoco_worker.engine import MujocoEngine
from mujoco_worker.mobile_engine import MobileEngine
from mujoco_worker.protocol import PROTOCOL, load_validators
from mujoco_worker.session import WorkerSession, scene_digest_of, world_plant_digest
from mujoco_worker.world_engine import WorldEngine

ROOT = Path(__file__).resolve().parents[1]
DRIVE = ROOT / "fixtures" / "drive-v1"
SCHEMAS = ROOT.parents[1] / "packages" / "contracts" / "schemas"
ARM64_ONLY = pytest.mark.skipif(platform.machine() != "arm64", reason="digests are bit-exact on the architecture of the spike only")
LEGACY_DIGESTS = {"mobile": "23ea8d07f95edf4265389a2bd3933737d788c429c849c685e003d4cf676cf2d9", "arm": "5927ce0f26c3d2af369e4edb9af45eddcba581b6d8fcfda835fb4bc793f3e76a",
                  "world": "3683bae2b968dfcac4c97c2cf10f04d6b4e0e957ef8a3f88d6ced442f04555d1"}


def doc(name):
    return json.loads((DRIVE / name).read_text())


def seal(d):
    d["digest"] = hashlib.sha256(rfc8785.dumps({k: v for k, v in d.items() if k != "digest"})).hexdigest()
    return d


def docs(kind, variant="ideal"):
    return doc(f"{kind}-drive-{variant}-v1.json"), doc(f"{'serve' if kind == 'serve' else 'xarm6'}-control-v1.json")


# hashJson({mobile: the AMR's physicalModelDigest, arm: the sha256 the scene records for the arm component}) of the coffee-delivery scenes: the TS test (drive-experiments.test.ts) asserts the same literal
WORLD_PLANT = "9da95c2a2a5cdc6d8761ca786917d740a85bc19091bdd9d254613549c514fa7b"


def world_docs(arm_prefix="xarm-1", variant="ideal", plant=WORLD_PLANT):
    """One combined drive model and profile for the nine axes of a world (the real combined fixtures are V05's), bound to `plant`."""
    am, ac = docs("xarm6", variant)
    sm, sc = docs("serve", variant)
    def rename(axes):
        return [{**a, "axisId": a["axisId"].replace("xarm-1/", arm_prefix + "/")} for a in axes]
    model = seal({**am, "id": "world-drive-test-v1", "axes": rename(am["axes"]) + sm["axes"]})
    control = seal({**ac, "id": "world-control-test-v1", "plantModelDigest": plant, "driveModelDigests": [model["digest"]], "axes": rename(ac["axes"]) + sc["axes"], "controllers": ac["controllers"] + sc["controllers"]})
    return model, control


def cmd(axis_id, seq, mode, target, **over):
    return {"axisId": axis_id, "seq": seq, "mode": mode, "target": float(target), "enable": True, "quickStop": False, "faultReset": False, **over}


def grip_ctrl(e, opening):
    lo, hi = e.grip_range
    return lo + (hi - lo) * (1.0 - opening / e.opening_max_m)


def wheel_commands(e, rid, v, w, seq, **over):
    left, right = wheel_targets(v, w, e.radius, e.separation)
    return [cmd(f"{rid}/wheel-left", seq, "csv", left, **over), cmd(f"{rid}/wheel-right", seq, "csv", right, **over)]


def arm_commands(arm, q, opening, grip_range, opening_max, seq, **over):
    lo, hi = grip_range
    return [*(cmd(f"{arm}/J{i + 1}", seq, "csp", t, **over) for i, t in enumerate(q)), cmd(f"{arm}/gripper", seq, "csp", lo + (hi - lo) * (1.0 - opening / opening_max), **over)]


def arm_engine(drive=None):
    return MujocoEngine(cell_scene(("cup-1", "cup-2"), engine_seed=7), load("component.json"), load("physics.json"), str(BLOBS), drive=drive)


def arm_step(e, k, **over):
    q, opening, placements = P.arm_cmd(k)
    return e.step(None, None, placements, arm_commands("xarm-1", q, opening, e.grip_range, e.opening_max_m, k + 1, **over))


# ---- the legacy path and the ideal drive -----------------------------------------------------------------------------------------------------------------
@ARM64_ONLY
def test_the_legacy_path_gives_the_three_recorded_digests():
    for name, n, run in (("mobile", 300, P.legacy_mobile), ("arm", 300, P.legacy_arm), ("world", 500, P.legacy_world)):
        qp, qv, _ = run(n)
        assert P.digest(qp, qv) == LEGACY_DIGESTS[name], name


def test_an_ideal_drive_is_bit_identical_to_the_legacy_mobile_path():
    qp0, qv0, _ = P.legacy_mobile(300)
    e = MobileEngine(*P.mobile_inputs(), drive=docs("serve"))
    qp, qv, _ = P.trace(e, 300, lambda k: e.step(0, 0, wheel_commands(e, "amr-1", *P.mobile_cmd(k), k + 1)))
    assert np.array_equal(qp, qp0) and np.array_equal(qv, qv0)
    e.close()


def test_an_ideal_drive_is_bit_identical_to_the_legacy_arm_path():
    qp0, qv0, _ = P.legacy_arm(300)
    e = arm_engine(docs("xarm6"))
    qp, qv, _ = P.trace(e, 300, lambda k: arm_step(e, k))
    assert np.array_equal(qp, qp0) and np.array_equal(qv, qv0)
    e.close()


def test_an_ideal_drive_is_bit_identical_to_the_legacy_world_path():
    qp0, qv0, _ = P.legacy_world(500)
    e = WorldEngine(*P.world_inputs(), drive=world_docs())
    def step(k):
        q, opening, placements, v, w = P.world_cmd(k)
        e.step(None, None, placements, 0, 0, None, arm_commands("xarm-1", q, opening, e.arm.grip_range, e.opening_max_m, k + 1) + wheel_commands(e.mobile, "amr-1", v, w, k + 1))
    qp, qv, _ = P.trace(e, 500, step)
    assert np.array_equal(qp, qp0) and np.array_equal(qv, qv0)
    e.close()


# ---- the actuators come from the profile -------------------------------------------------------------------------------------------------------------------
def test_actuator_gains_are_read_back_from_the_compiled_model_for_every_kind():
    am, ac = docs("xarm6")
    ac = copy.deepcopy(ac)
    ac["axes"][0]["loop"].update(kp=1234.0, kd=56.0)                       # position, gains different from the physics.json ones
    ac["axes"][1]["loop"].update(ki=3000.0, integralLimit=2.0)             # pid with an integral
    ac["axes"][2]["loop"].update(slewLimit=0.5)                            # pid with a slew
    e = arm_engine((am, ac))
    m = e.model
    a0, a1, a2 = e.arm_act[:3]
    assert (m.actuator_gaintype[a0], m.actuator_biastype[a0]) == (0, 1) and m.actuator_gainprm[a0][0] == 1234.0 and m.actuator_biasprm[a0][1] == -1234.0 and m.actuator_biasprm[a0][2] == -56.0
    assert m.actuator_gaintype[a1] == 5 and m.actuator_gainprm[a1][0] == 3000.0 and m.actuator_biasprm[a1][1] == -6000.0 and m.actuator_dynprm[a1][0] == pytest.approx(2.0 / 3000.0)
    assert m.actuator_gaintype[a2] == 5 and m.actuator_dynprm[a2][1] == 0.5 and m.actuator_actnum[a2] >= 1
    assert [int(m.actuator_group[a]) for a in e.arm_act + [e.grip_act]] == [1, 2, 3, 4, 5, 6, 7]
    e.close()
    sm, sc = docs("serve")
    sc = copy.deepcopy(sc)
    sc["axes"][0]["loop"]["kp"] = 3.0
    sc["axes"][1]["loop"].update(ki=4.0, integralLimit=2.0)
    e = MobileEngine(*P.mobile_inputs(), drive=(sm, sc))
    w0, w1 = e.acts
    assert m is not e.model and e.model.actuator_gainprm[w0][0] == 3.0 and e.model.actuator_biasprm[w0][2] == -3.0
    assert e.model.actuator_gaintype[w1] == 5 and e.model.actuator_biasprm[w1][1] == -4.0 and e.model.actuator_biasprm[w1][2] == -2.0 and e.model.actuator_gainprm[w1][0] == 0.0
    e.close()


def test_a_pid_axis_converges_on_a_step_with_the_integral_limit_honoured():
    am, ac = docs("xarm6")
    ac = copy.deepcopy(ac)
    ac["axes"][1]["loop"].update(ki=3000.0, integralLimit=2.0)
    e = arm_engine((am, ac))
    q0 = P.HOME
    for k in range(200):  # a ramp of 0.5 rad/s, as a trajectory follower would send: a raw 0.2 rad step in one tick is 10 rad/s and an OVERSPEED trip
        q = [h + (min(0.2, 0.01 * max(0, k - 50)) if i == 1 else 0.0) for i, h in enumerate(q0)]
        r = e.step(None, None, [], arm_commands("xarm-1", q, P.OPEN, e.grip_range, e.opening_max_m, k + 1))
        assert r["unstable"] is None
    assert abs(e.data.qpos[e.arm_qpos[1]] - (q0[1] + 0.2)) < 1e-3
    e.close()


def test_a_wheel_with_ki_is_a_proportional_integral_velocity_loop_that_converges():
    sm, sc = docs("serve")
    sc = copy.deepcopy(sc)
    for a in sc["axes"]:
        a["loop"].update(ki=4.0, integralLimit=2.0)
    e = MobileEngine(*P.mobile_inputs(), drive=(sm, sc))
    for k in range(500):
        e.step(0, 0, wheel_commands(e, "amr-1", 0.0 if k < 20 else 0.2, 0.0, k + 1))
    target = 0.2 / e.radius
    assert abs(e.data.qvel[e.wv[0]] - target) < 0.03 * target
    e.close()


# ---- the brake is a model ------------------------------------------------------------------------------------------------------------------------------
def arm_hold_drift(edit=None, ticks=500):
    am, ac = docs("xarm6", "nominal")  # boots disabled: the arm is held by the brake alone from the first substep
    am = copy.deepcopy(am)
    if edit:
        edit(am)
    e = arm_engine((am, ac))
    q0 = e.data.qpos[e.arm_qpos].copy()
    for k in range(ticks):
        e.step(None, None, [], arm_commands("xarm-1", P.HOME, P.OPEN, e.grip_range, e.opening_max_m, k + 1, enable=False))
    drift = np.abs(e.data.qpos[e.arm_qpos] - q0).max()
    e.close()
    return drift


def test_a_braked_arm_holds_its_pose_with_the_drive_off_and_the_same_arm_coasting_falls():
    braked = arm_hold_drift()
    def coast(m):
        for a in m["axes"]:
            a["onDisable"], a["brakeTorqueNm"] = "coast", None
    coasting = arm_hold_drift(coast)
    assert braked < 0.01 and coasting > 0.3


def test_the_joint_friction_of_a_braked_axis_goes_back_when_it_is_enabled_again():
    am, ac = docs("xarm6", "nominal")
    e = arm_engine((am, ac))
    base = e.model.dof_frictionloss[e.arm_qvel].copy()
    solimp = e.model.dof_solimp[e.arm_qvel].copy()
    e.step(None, None, [], arm_commands("xarm-1", P.HOME, P.OPEN, e.grip_range, e.opening_max_m, 1, enable=False))
    assert (e.model.dof_frictionloss[e.arm_qvel] >= base).all() and (e.model.dof_frictionloss[e.arm_qvel] > base).any()
    for k in range(2, 8):
        e.step(None, None, [], arm_commands("xarm-1", P.HOME, P.OPEN, e.grip_range, e.opening_max_m, k))
    assert [s["state"] for s in e.drive.g.end_tick()] == ["enabled"] * 7
    assert np.array_equal(e.model.dof_frictionloss[e.arm_qvel], base) and np.array_equal(e.model.dof_solimp[e.arm_qvel], solimp)
    e.close()


# ---- torque envelope, telemetry ------------------------------------------------------------------------------------------------------------------------
def drive_wheels(variant, ticks=60):
    e = MobileEngine(*P.mobile_inputs(), drive=docs("serve", variant))
    peak, saturated = 0.0, 0
    for k in range(ticks):
        r = e.step(0, 0, [cmd("amr-1/wheel-left", k + 1, "csv", 10.0), cmd("amr-1/wheel-right", k + 1, "csv", 10.0)])
        for s in r["drives"]:
            peak, saturated = max(peak, abs(s["torqueNm"])), saturated + s["saturatedSubsteps"]
    e.close()
    return peak, saturated


def test_wheel_torque_never_exceeds_the_motoring_envelope_times_the_scale():
    nominal_peak, nominal_sat = drive_wheels("nominal")
    limited_peak, limited_sat = drive_wheels("torque-limited")
    assert nominal_peak > 5.0 and limited_peak <= 0.1 * 6.0 + 1e-9   # the envelope at rest is the 6 N m of the physics profile
    assert limited_sat > nominal_sat > 0                              # the limit binds sooner


def test_a_snapshot_reports_drive_telemetry_in_model_order_with_the_measured_and_the_true_state():
    e = MobileEngine(*P.mobile_inputs(), drive=docs("serve", "nominal"))
    for k in range(6):
        r = e.step(0, 0, [cmd("amr-1/wheel-left", k + 1, "csv", 1.0), cmd("amr-1/wheel-right", k + 1, "csv", 1.0)])
    d = r["drives"]
    assert [s["axisId"] for s in d] == ["amr-1/wheel-left", "amr-1/wheel-right"] and [s["tick"] for s in d] == [5, 5]
    assert d[0]["state"] == "enabled" and d[0]["commandSeq"] == 6 and d[0]["positionRad"] is not None and d[0]["actualVelocityRadS"] > 0.5
    q = 2 * np.pi / 4096
    assert d[0]["positionRad"] == pytest.approx(round(d[0]["positionRad"] / q) * q, abs=1e-12)  # an encoder count
    e.close()


# ---- structure -------------------------------------------------------------------------------------------------------------------------------------------
def test_no_path_of_the_drive_layer_writes_qpos_or_qvel_and_the_pure_model_does_not_import_the_engine():
    for name in ("drive_model.py", "drive_binding.py"):
        tree = ast.parse((ROOT / "mujoco_worker" / name).read_text())
        for node in ast.walk(tree):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AugAssign, ast.AnnAssign)) else []
            for t in targets:
                names = {n.attr for n in ast.walk(t) if isinstance(n, ast.Attribute)}
                assert not names & {"qpos", "qvel", "qacc", "xfrc_applied", "mocap_pos"}, (name, ast.unparse(t))
    pure = ast.parse((ROOT / "mujoco_worker" / "drive_model.py").read_text())
    imported = {n.names[0].name for n in ast.walk(pure) if isinstance(n, ast.Import)} | {n.module for n in ast.walk(pure) if isinstance(n, ast.ImportFrom)}
    assert "mujoco" not in imported and "time" not in imported


# ---- the session: wire rules, refusals, pause --------------------------------------------------------------------------------------------------------
def request(op, payload=None, tick=0, rid=None):
    return {"protocol": PROTOCOL, "requestId": rid or f"{op}-{tick}", "runId": "mobile-1", "expectedTick": tick, "op": op, "payload": payload or {}}


def mobile_session(tmp_path, variant="nominal", drive=True):
    shutil.copytree(ROOT / "fixtures" / "serve-payload-v1", tmp_path, dirs_exist_ok=True)
    scene = json.loads((tmp_path / "navigation-scene.json").read_text())
    if drive:
        for name, key in ((f"serve-drive-{variant}-v1.json", "driveModelRef"), ("serve-control-v1.json", "controlProfileRef")):
            raw = (DRIVE / name).read_bytes()
            (tmp_path / name).write_bytes(raw)
            d = json.loads(raw)
            scene["engine"][key] = {"id": d["id"], "revision": 1, "path": name, "sha256": hashlib.sha256(raw).hexdigest()}
            scene["files"].append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
        scene["files"].sort(key=lambda f: f["path"])
        scene["sceneDigest"] = scene_digest_of(scene)
        (tmp_path / "navigation-scene.json").write_text(json.dumps(scene))
    return WorkerSession(run_id="mobile-1", bundle_root=tmp_path, lock_digest="b" * 64)


def step_request(tick, commands=None, **over):
    p = {"targetTick": tick + 1, "velocities": [], "actorUpdates": [], **({"driveCommands": commands} if commands is not None else {}), **over}
    return request("step", p, tick)


def wheels(seq, v=0.0, **over):
    return [cmd("amr-1/wheel-left", seq, "csv", v, **over), cmd("amr-1/wheel-right", seq, "csv", v, **over)]


def test_a_drive_run_creates_primes_steps_and_answers_in_the_wire_schema(tmp_path):
    s = mobile_session(tmp_path)
    created = s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert created["ok"], created
    assert [d["state"] for d in created["result"]["drives"]] == ["disabled", "disabled"]   # a nominal drive primes disabled
    assert s.handle(request("start"))["ok"]
    _, validator = load_validators(SCHEMAS)
    for k in range(5):
        r = s.handle(step_request(k, wheels(k + 1, 0.5)))
        assert r["ok"], r
        validator.validate(r)
    assert [d["state"] for d in r["result"]["drives"]] == ["enabled", "enabled"] and r["result"]["drives"][0]["commandSeq"] == 5
    s.end()


def test_refusals_leave_the_tick_and_the_engine_unchanged(tmp_path):
    s = mobile_session(tmp_path)
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]
    assert s.handle(step_request(0, wheels(5, 0.5)))["ok"]
    t, time_before = s.tick, s.engine.data.time
    cases = [(step_request(1), "DRIVE_COMMAND_REQUIRED"), (step_request(1, wheels(2, 0.5)), "DRIVE_COMMAND_SEQ_INVALID"), (step_request(1, wheels(6, 99.0)), "DRIVE_TARGET_OUT_OF_RANGE"),
             (step_request(1, [{**c, "mode": "csp"} for c in wheels(6)]), "DRIVE_MODE_MISMATCH"), (step_request(1, wheels(6)[:1]), "DRIVE_COMMAND_REQUIRED"),
             (step_request(1, [*wheels(6), cmd("amr-1/ghost", 6, "csv", 0)]), "DRIVE_AXIS_UNKNOWN")]
    for i, (req, code) in enumerate(cases):
        req["requestId"] = f"refused-{i}"
        r = s.handle(req)
        assert not r["ok"] and r["error"]["code"] == code, (code, r)
        assert s.tick == t and s.engine.data.time == time_before
    velocities = step_request(1, wheels(6), velocities=[{"robotId": "amr-1", "vMps": 0, "omegaRadps": 0}])
    velocities["requestId"] = "velocities"
    assert s.handle(velocities)["error"]["code"] == "INVALID_REQUEST"
    assert s.handle(step_request(1, wheels(6)))["ok"]  # the run was never harmed
    s.end()


def test_driveCommands_without_a_drive_model_are_refused(tmp_path):
    s = mobile_session(tmp_path, drive=False)
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]
    r = s.handle(step_request(0, wheels(1), velocities=[{"robotId": "amr-1", "vMps": 0, "omegaRadps": 0}]))
    assert not r["ok"] and r["error"]["code"] == "INVALID_REQUEST"
    s.end()


def test_a_scene_with_one_ref_only_is_refused_at_create(tmp_path):
    s = mobile_session(tmp_path)
    scene = json.loads((tmp_path / "navigation-scene.json").read_text())
    del scene["engine"]["controlProfileRef"]
    scene["sceneDigest"] = scene_digest_of(scene)
    (tmp_path / "navigation-scene.json").write_text(json.dumps(scene))
    r = s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert not r["ok"] and r["error"]["code"] == "DRIVE_PROFILE_PAIR_REQUIRED"


def test_pause_and_resume_after_ten_wall_seconds_produce_no_command_timeout(tmp_path, monkeypatch):
    s = mobile_session(tmp_path)
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]
    for k in range(6):
        assert s.handle(step_request(k, wheels(k + 1, 0.5)))["ok"]
    assert s.handle(request("pause", tick=6))["ok"]
    now = time.time()
    for name in ("time", "monotonic", "perf_counter"):
        real = getattr(time, name)
        monkeypatch.setattr(time, name, lambda real=real: real() + 10.0)  # ten wall seconds pass while paused
    assert s.handle(request("resume", tick=6))["ok"]
    r = s.handle(step_request(6, wheels(7, 0.5)))
    assert r["ok"] and [d["fault"] for d in r["result"]["drives"]] == [None, None] and time.time() >= now + 10
    s.end()


def test_a_command_stream_that_goes_quiet_trips_the_watchdog_by_ticks_through_the_session(tmp_path):
    s = mobile_session(tmp_path)
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]
    for k in range(5):
        r = s.handle(step_request(k, wheels(k + 1, 0.5)))
    for k in range(5, 10):
        r = s.handle(step_request(k, wheels(5, 0.5)))
        assert [d["fault"] for d in r["result"]["drives"]] == [None if k < 9 else "COMMAND_TIMEOUT"] * 2, k
    assert r["result"]["drives"][0]["velocityRadS"] is not None
    s.end()


def test_describe_reports_the_host_architecture(tmp_path):
    s = mobile_session(tmp_path, drive=False)
    r = s.handle(request("describe"))
    assert r["result"]["hostArch"] in ("arm64", "x86_64")
    _, validator = load_validators(SCHEMAS)
    validator.validate(r)


def test_a_world_session_runs_on_one_combined_drive_model(tmp_path):
    world = ROOT / "fixtures" / "coffee-delivery-world-v1"
    for p in world.iterdir():
        if p.is_file():
            shutil.copy(p, tmp_path / p.name)
    shutil.copytree(BLOBS, tmp_path / "blobs")
    scene = json.loads((tmp_path / "lab-world-scene.json").read_text())
    model, control = world_docs("arm-1")
    refs = {}
    for name, d, key in (("world-drive-test-v1.json", model, "driveModelRef"), ("world-control-test-v1.json", control, "controlProfileRef")):
        raw = (json.dumps(d, indent=2) + "\n").encode()
        (tmp_path / name).write_bytes(raw)
        refs[key] = {"id": d["id"], "revision": 1, "path": name, "sha256": hashlib.sha256(raw).hexdigest()}
        scene["files"].append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
    scene["engine"] = refs
    scene["sceneDigest"] = scene_digest_of(scene)
    (tmp_path / "lab-world-scene.json").write_text(json.dumps(scene))
    s = WorkerSession(run_id="world-test", bundle_root=tmp_path, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"])
    def req(op, payload, tick=0, rid=None):
        return {"protocol": PROTOCOL, "requestId": rid or f"{op}-{tick}", "runId": "world-test", "expectedTick": tick, "op": op, "payload": payload}
    created = s.handle(req("create", {"sceneRef": "lab-world-scene.json", "seed": 7}))
    assert created["ok"], created
    assert len(created["result"]["drives"]) == 9 and {d["state"] for d in created["result"]["drives"]} == {"enabled"}   # the ideal drive boots enabled
    assert s.handle(req("start", {}))["ok"]
    home = scene["armCell"]["arm"]["homeRad"]
    arm = arm_commands("arm-1", home, 0.0889, s.engine.arm.grip_range, s.engine.opening_max_m, 1)
    wheelcmds = [cmd("amr-1/wheel-left", 1, "csv", 0.0), cmd("amr-1/wheel-right", 1, "csv", 0.0)]
    r = s.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": [], "driveCommands": arm + wheelcmds, "worldControl": {"version": 1, "program": None, "attachmentProxyPropId": None, "movementInterlocked": False, "stopLatched": False}} if scene.get("controlContextVersion") == 1 else {"targetTick": 1, "velocities": [], "actorUpdates": [], "driveCommands": arm + wheelcmds}))
    assert r["ok"], r
    assert len(r["result"]["drives"]) == 9
    s.end()


def rebind(tmp_path, name, edit):
    """Rewrites one drive document of a mobile bundle (re-sealing its digest, the file hash in the scene and the scene digest)."""
    scene = json.loads((tmp_path / "navigation-scene.json").read_text())
    d = seal(edit(json.loads((tmp_path / name).read_text())))
    raw = (json.dumps(d, indent=2) + "\n").encode()
    (tmp_path / name).write_bytes(raw)
    for ref in scene["files"]:
        if ref["path"] == name:
            ref["sha256"], ref["bytes"] = hashlib.sha256(raw).hexdigest(), len(raw)
    for key in ("driveModelRef", "controlProfileRef"):
        if scene["engine"][key]["path"] == name:
            scene["engine"][key]["sha256"] = hashlib.sha256(raw).hexdigest()
    scene["sceneDigest"] = scene_digest_of(scene)
    (tmp_path / "navigation-scene.json").write_text(json.dumps(scene))


@pytest.mark.parametrize("name,edit,code", [
    ("serve-control-v1.json", lambda d: {**d, "plantModelDigest": "c" * 64}, "DRIVE_DOCUMENT_INVALID"),                 # bound to another plant
    ("serve-control-v1.json", lambda d: {**d, "driveModelDigests": ["d" * 64]}, "DRIVE_DOCUMENT_INVALID"),              # not declared for this drive model
    ("serve-drive-nominal-v1.json", lambda d: {**d, "axes": d["axes"][:1]}, "DRIVE_DOCUMENT_INVALID"),                  # one wheel only: the axes of the two documents differ
    ("serve-drive-nominal-v1.json", lambda d: {**d, "axes": [{**d["axes"][0], "axisId": "amr-1/wheel-left"}, {**d["axes"][1], "axisId": "amr-1/ghost"}]}, "DRIVE_DOCUMENT_INVALID"),
])
def test_drive_documents_that_do_not_fit_the_scene_are_refused_at_create(tmp_path, name, edit, code):
    s = mobile_session(tmp_path)
    if name.startswith("serve-drive"):  # the control profile is declared for the digest of the original model: re-declare it so that only the axes differ
        rebind(tmp_path, name, edit)
        model = json.loads((tmp_path / name).read_text())
        rebind(tmp_path, "serve-control-v1.json", lambda c: {**c, "driveModelDigests": [model["digest"]], "axes": [a for a in c["axes"] if a["axisId"] in [x["axisId"] for x in model["axes"]]] if len(model["axes"]) == 1 else [{**c["axes"][0]}, {**c["axes"][1], "axisId": "amr-1/ghost"}]})
    else:
        rebind(tmp_path, name, edit)
    r = s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))
    assert not r["ok"] and r["error"]["code"] == code, r
    assert s.engine is None


# ---- review of V05 (2026-11-19) ------------------------------------------------------------------------------------------------------------------------------
def world_bundle(tmp_path, plant=WORLD_PLANT):
    world = ROOT / "fixtures" / "coffee-delivery-world-v1"
    for p in world.iterdir():
        if p.is_file():
            shutil.copy(p, tmp_path / p.name)
    shutil.copytree(BLOBS, tmp_path / "blobs")
    scene = json.loads((tmp_path / "lab-world-scene.json").read_text())
    model, control = world_docs("arm-1", plant=plant)
    refs = {}
    for name, d, key in (("world-drive-test-v1.json", model, "driveModelRef"), ("world-control-test-v1.json", control, "controlProfileRef")):
        raw = (json.dumps(d, indent=2) + "\n").encode()
        (tmp_path / name).write_bytes(raw)
        refs[key] = {"id": d["id"], "revision": 1, "path": name, "sha256": hashlib.sha256(raw).hexdigest()}
        scene["files"].append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
    scene["engine"] = refs
    scene["sceneDigest"] = scene_digest_of(scene)
    (tmp_path / "lab-world-scene.json").write_text(json.dumps(scene))
    return scene


def test_the_world_plant_digest_is_the_one_the_lab_computes_and_a_profile_for_another_plant_is_refused_at_create(tmp_path):
    ok, other = tmp_path / "ok", tmp_path / "other"
    ok.mkdir(), other.mkdir()
    scene = world_bundle(ok)
    assert world_plant_digest(scene) == WORLD_PLANT
    assert world_plant_digest(scene) == hashlib.sha256(rfc8785.dumps({"mobile": scene["navigation"]["robots"][0]["model"]["physicalModelDigest"], "arm": scene["models"]["armComponent"]["sha256"]})).hexdigest()
    scene = world_bundle(other, plant="b" * 64)
    s = WorkerSession(run_id="w", bundle_root=other, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"])
    r = s.handle({"protocol": PROTOCOL, "requestId": "c", "runId": "w", "expectedTick": 0, "op": "create", "payload": {"sceneRef": "lab-world-scene.json", "seed": 7}})
    assert not r["ok"] and r["error"]["code"] == "DRIVE_DOCUMENT_INVALID" and s.engine is None, r


def world_drive_session(tmp_path):
    scene = world_bundle(tmp_path)
    s = WorkerSession(run_id="w", bundle_root=tmp_path, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"])

    def req(op, payload, tick=0, rid=None):
        return {"protocol": PROTOCOL, "requestId": rid or f"{op}-{tick}", "runId": "w", "expectedTick": tick, "op": op, "payload": payload}
    assert s.handle(req("create", {"sceneRef": "lab-world-scene.json", "seed": 7}))["ok"]
    assert s.handle(req("start", {}))["ok"]
    ctl = {"worldControl": {"version": 1, "program": None, "attachmentProxyPropId": None, "movementInterlocked": False, "stopLatched": False}} if scene.get("controlContextVersion") == 1 else {}
    home = scene["armCell"]["arm"]["homeRad"]
    arm = arm_commands("arm-1", home, 0.0889, s.engine.arm.grip_range, s.engine.opening_max_m, 1)
    return s, req, arm, ctl, scene


def test_a_world_step_that_lacks_the_gripper_command_is_refused_with_a_code_and_the_session_lives(tmp_path):
    s, req, arm, ctl, _ = world_drive_session(tmp_path)
    wh = [cmd("amr-1/wheel-left", 1, "csv", 0.0), cmd("amr-1/wheel-right", 1, "csv", 0.0)]
    r = s.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": [], "driveCommands": arm[:-1] + wh, **ctl}, rid="nogrip"))
    assert not r["ok"] and r["error"]["code"] == "DRIVE_COMMAND_REQUIRED", r
    assert s.state != "failed" and s.tick == 0
    assert s.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": [], "driveCommands": arm + wh, **ctl}, rid="ok"))["ok"]
    s.end()


def test_a_refused_drive_tick_spends_no_one_shot_disturbance_state(tmp_path):
    s, req, arm, ctl, _ = world_drive_session(tmp_path)
    wh = [cmd("amr-1/wheel-left", 1, "csv", 0.0), cmd("amr-1/wheel-right", 1, "csv", 0.0)]
    bad = [{**c, "target": 1e9} for c in arm + wh]
    r = s.handle(req("step", {"targetTick": 1, "velocities": [], "actorUpdates": [], "driveCommands": bad, "worldPerturbations": [{"presetId": "world-dock-drift-v1", "revision": 1, "targetId": "amr-1", "targetTick": 1, "eventId": "e"}], **ctl}, rid="bad"))
    assert not r["ok"] and r["error"]["code"] == "DRIVE_TARGET_OUT_OF_RANGE", r
    assert s.world_disturbance_consumed is False
    s.end()


def test_wheel_commands_beyond_the_admitted_navigation_limits_are_refused_on_the_drive_path_too(tmp_path):
    s = mobile_session(tmp_path)
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]
    kin = s.scene["robots"][0]["model"]["kinematics"]
    fast = 1.05 * kin["maxLinearMps"] / s.engine.radius                 # both wheels: v = 1.05 x the admitted limit, inside the plant's own wheel range
    assert fast < float(s.engine.physical["drive"]["actuatorMaxSpeedRadps"]["value"])
    r = s.handle(step_request(0, wheels(1, fast)))
    assert not r["ok"] and r["error"]["code"] == "VELOCITY_TARGET_OUT_OF_RANGE", r
    assert s.tick == 0
    again = step_request(0, wheels(1, 0.5 * kin["maxLinearMps"] / s.engine.radius))
    again["requestId"] = "slower"
    assert s.handle(again)["ok"]
    s.end()
