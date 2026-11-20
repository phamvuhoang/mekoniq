"""V08: the worker side of the drive fault catalog (R4-A 7.1, contracts 4). Pure DriveGroup tests (no engine) plus the session wire. Faults act on drive parameters and channels only; no case
writes `qpos`/`qvel` (the AST test in test_drive_engine.py covers drive_faults.py too, see below)."""
import ast
import copy
import json
from pathlib import Path

import pytest

from mujoco_worker.drive_model import DriveGroup
from mujoco_worker.protocol import WorkerError
from test_drive_model import DT, SUB, Rig, doc

ROOT = Path(__file__).resolve().parents[1]
L, R = "amr-1/wheel-left", "amr-1/wheel-right"


def inj(entry, fault, target, phase="start", **params):
    return {"entryId": entry, "faultId": fault, "targetId": target, "params": params, "phase": phase}


def with_faults(rig, faults, **kw):
    rig.g.stage_faults(faults)
    rig.g.begin_tick(rig.commands(**kw))
    snap = rig.run_substeps()
    return snap, rig.g.take_fault_receipts()


def moving_rig(**kw):
    r = Rig(**kw)
    r.enable_all()
    r.tick(target=1.0)
    return r


def test_a_receipt_names_the_tick_it_was_applied_on_and_echoes_what_it_applied():
    r = moving_rig()
    tick = r.g.tick
    _, receipts = with_faults(r, [inj("e1", "motor-weak", R, torqueScale=0.5)], target=1.0)
    assert receipts == [{"entryId": "e1", "faultId": "motor-weak", "targetId": R, "params": {"torqueScale": 0.5}, "phase": "start", "appliedTick": tick}]
    assert r.g.take_fault_receipts() == []   # a receipt is handed over once


def test_encoder_dropout_reports_no_measurement_not_the_last_one_and_trips_after_feedbackLossSubsteps():
    r = moving_rig()   # nominal: feedbackLossSubsteps = 25
    snaps = [with_faults(r, [inj("e", "encoder-dropout", R)], target=1.0)[0]]
    snaps.append(r.tick(target=1.0))
    assert snaps[0][1]["positionRad"] is None and snaps[0][1]["velocityRadS"] is None and snaps[0][1]["fault"] is None
    assert snaps[0][0]["positionRad"] is not None          # the other wheel keeps measuring
    snaps.append(r.tick(target=1.0))                        # 25 substeps: the third tick
    assert snaps[2][1]["fault"] == "FEEDBACK_LOSS" and snaps[2][1]["state"] == "fault"
    assert snaps[2][0]["fault"] is None


def test_a_dropout_that_ends_before_the_loss_threshold_leaves_no_fault_and_measures_again():
    r = moving_rig()
    with_faults(r, [inj("e", "encoder-dropout", R)], target=1.0)
    snap, receipts = with_faults(r, [inj("e", "encoder-dropout", R, "end")], target=1.0)
    assert snap[1]["fault"] is None and snap[1]["positionRad"] is not None
    assert receipts[0]["phase"] == "end"


def test_a_latched_feedback_loss_is_not_cleared_by_the_end_of_the_window():
    r = moving_rig()
    for k in range(3):
        r.g.stage_faults([inj("e", "encoder-dropout", R)] if k == 0 else [])
        r.g.begin_tick(r.commands(target=1.0))
        r.run_substeps()
    snap, _ = with_faults(r, [inj("e", "encoder-dropout", R, "end")], target=1.0)
    assert snap[1]["fault"] == "FEEDBACK_LOSS" and snap[1]["state"] == "fault"


def test_motor_weak_scales_the_force_limit_of_its_axis_only_and_restores_it():
    r = moving_rig()
    base = list(r.g.substep(r.pos, r.vel)["force_scale"])
    r.g.sample(r.pos, r.vel, [0, 0], [False, False])
    with_faults(r, [inj("e", "motor-weak", R, torqueScale=0.5)], target=1.0)
    assert r.log[-1]["force_scale"] == [base[0], base[1] * 0.5]
    with_faults(r, [inj("e", "motor-weak", R, "end", torqueScale=0.5)], target=1.0)
    assert r.log[-1]["force_scale"] == base


def test_drive_trip_latches_external_trip_and_only_a_reset_edge_clears_it():
    r = moving_rig()
    snap, _ = with_faults(r, [inj("t", "drive-trip", R)], target=1.0)
    assert snap[1]["state"] == "fault" and snap[1]["fault"] == "EXTERNAL_TRIP" and snap[0]["fault"] is None
    snap, _ = with_faults(r, [inj("t", "drive-trip", R, "end")], target=1.0)
    assert snap[1]["fault"] == "EXTERNAL_TRIP"               # the end of the window does not clear a latch
    assert r.tick(target=1.0)[1]["fault"] == "EXTERNAL_TRIP"
    assert not any(out["active"][1] for out in r.log[-3 * SUB:])


def test_drive_reset_gives_a_rising_faultReset_edge_without_a_new_command_edge():
    r = moving_rig()
    with_faults(r, [inj("t", "drive-trip", R)], target=1.0)
    snap, _ = with_faults(r, [inj("x", "drive-reset", R)], target=1.0)
    # the latch is gone; the command still asks to be enabled, so the axis starts its enable sequence again in the same tick
    assert snap[1]["fault"] is None and snap[1]["state"] == "ready"
    assert r.g.seq[1] == r.seq           # the command stream carried no reset: the edge is the injected one
    # a reset on an axis that is not faulted changes nothing
    before = r.g.state[0]
    with_faults(r, [inj("y", "drive-reset", L)], target=1.0)
    assert r.g.state[0] in (before, "enabled")


def test_a_reset_cannot_clear_a_feedback_loss_while_the_dropout_goes_on():
    r = moving_rig()
    for k in range(3):
        r.g.stage_faults([inj("e", "encoder-dropout", R)] if k == 0 else [])
        r.g.begin_tick(r.commands(target=1.0))
        r.run_substeps()
    snap, _ = with_faults(r, [inj("x", "drive-reset", R)], target=1.0)
    assert snap[1]["fault"] == "FEEDBACK_LOSS"


def test_command_delay_adds_substeps_between_command_and_applied_target_and_end_takes_them_away():
    plain, slow = moving_rig(), moving_rig()
    with_faults(slow, [inj("d", "command-delay", R, delayMs=40)], target=1.0)
    plain.tick(target=1.0)
    # a step of the command from 1.0 to 3.0: the extra 20 substeps (40 ms) delay the applied target by two ticks
    a = [plain.tick(target=3.0)[1]["targetApplied"] for _ in range(4)]
    b = [slow.tick(target=3.0)[1]["targetApplied"] for _ in range(4)]
    assert a[0] == 3.0 and b[0] == 1.0 and b[1] == 1.0 and b[2] == 3.0
    with_faults(slow, [inj("d", "command-delay", R, "end", delayMs=40)], target=3.0)
    assert len(slow.g.channel[1]) == slow.g.axes[1]["commandDelaySubsteps"] + 1


def test_grip_weak_scales_the_gripper_force_limit_through_the_same_channel():
    r = Rig(model="xarm6-drive-nominal-v1.json", control="xarm6-control-v1.json")
    r.g.begin_tick(r.commands(target=0.0))
    r.run_substeps()
    g = "xarm-1/gripper"
    with_faults(r, [inj("g", "grip-weak", g, torqueScale=0.4)], target=0.0)
    i = r.g.index[g]
    assert r.log[-1]["force_scale"][i] == pytest.approx(r.g.scale[i] * 0.4)
    assert all(s == r.g.scale[k] for k, s in enumerate(r.log[-1]["force_scale"]) if k != i)


@pytest.mark.parametrize("bad,code", [
    (inj("a", "command-loss", R), "FAULT_NOT_WORKER_APPLIED"),         # the runtime applies it
    (inj("a", "lidar-noise", R, sigmaM=0.01, dropoutFraction=0.1), "FAULT_NOT_WORKER_APPLIED"),
    (inj("a", "no-such-fault", R), "FAULT_UNKNOWN"),
    (inj("a", "motor-weak", R, torqueScale=0.1), "FAULT_PARAM_INVALID"),   # below 0.2
    (inj("a", "motor-weak", R, torqueScale=float("nan")), "FAULT_PARAM_INVALID"),
    (inj("a", "motor-weak", R), "FAULT_PARAM_INVALID"),                 # required
    (inj("a", "motor-weak", R, torqueScale=0.5, extra=1), "FAULT_PARAM_INVALID"),
    (inj("a", "command-delay", R, delayMs=25), "FAULT_PARAM_INVALID"),  # not a multiple of 2
    (inj("a", "command-delay", R, delayMs=400), "FAULT_PARAM_INVALID"),
    (inj("a", "encoder-dropout", "amr-1/nope"), "FAULT_TARGET_INVALID"),
    (inj("a", "grip-weak", R, torqueScale=0.5), "FAULT_TARGET_INVALID"),    # not a gripper
    (inj("a", "encoder-dropout", R, "end"), "FAULT_STATE_INVALID"),         # an end without its start
])
def test_a_refused_injection_changes_nothing_and_says_why(bad, code):
    r = moving_rig()
    before = r.snapshot()
    with pytest.raises(WorkerError) as e:
        r.g.stage_faults([inj("ok", "encoder-dropout", L), bad])
    assert e.value.code == code
    assert r.snapshot() == before and r.g.take_fault_receipts() == []
    assert not any(r.g.dropout)                              # the valid first entry was not applied either


def test_a_start_twice_or_an_overlap_on_one_target_is_refused():
    r = moving_rig()
    with_faults(r, [inj("e", "motor-weak", R, torqueScale=0.5)], target=1.0)
    for bad in (inj("e", "motor-weak", R, torqueScale=0.5), inj("f", "motor-weak", R, torqueScale=0.6)):
        with pytest.raises(WorkerError) as e:
            r.g.stage_faults([bad])
        assert e.value.code in ("FAULT_STATE_INVALID", "FAULT_OVERLAP")
    with pytest.raises(WorkerError) as e:
        r.g.stage_faults([inj("e", "motor-weak", R, "end", torqueScale=0.9)])   # an end that echoes other parameters than its start
    assert e.value.code == "FAULT_PARAM_INVALID"


def test_a_run_without_faults_keeps_its_bytes():
    plain, faulted = Rig(), Rig()
    for rig in (plain, faulted):
        rig.enable_all()
    a = [plain.tick(target=0.5) for _ in range(6)]
    faulted.g.stage_faults([])
    b = [faulted.tick(target=0.5) for _ in range(6)]
    assert a == b


def test_no_fault_code_writes_the_true_state():
    for name in ("drive_faults.py",):
        tree = ast.parse((ROOT / "mujoco_worker" / name).read_text())
        for node in ast.walk(tree):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AugAssign, ast.AnnAssign)) else []
            for t in targets:
                assert not {n.attr for n in ast.walk(t) if isinstance(n, ast.Attribute)} & {"qpos", "qvel", "qacc", "xfrc_applied", "mocap_pos"}, ast.unparse(t)


# ---- the session: faults over the wire ------------------------------------------------------------------------------------------------------------------
import hashlib  # noqa: E402

import rfc8785  # noqa: E402

from mujoco_worker.session import WorkerSession  # noqa: E402,F401
from test_drive_engine import SCHEMAS, load_validators, mobile_session, request, step_request, wheels  # noqa: E402


def started(tmp_path, ticks=0):
    s = mobile_session(tmp_path)
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]
    last = None
    for k in range(ticks):
        last = s.handle(step_request(k, wheels(k + 1, 0.5)))
        assert last["ok"], last
    return s, last


def test_a_step_with_an_injection_answers_with_a_receipt_that_carries_the_run_identity_and_the_request_digest(tmp_path):
    s, _ = started(tmp_path, 6)
    payload = {"targetTick": 7, "velocities": [], "actorUpdates": [], "driveCommands": wheels(7, 0.5), "faultInjections": [inj("e", "encoder-dropout", R)]}
    r = s.handle(request("step", payload, 6))
    assert r["ok"], r
    (receipt,) = r["result"]["faultReceipts"]
    assert receipt["entryId"] == "e" and receipt["phase"] == "start" and receipt["appliedTick"] == 7 and receipt["params"] == {}
    assert receipt["runId"] == "mobile-1" and receipt["bootId"] and receipt["sceneDigest"] == s.scene["sceneDigest"]
    assert receipt["requestDigest"] == hashlib.sha256(rfc8785.dumps(payload)).hexdigest()
    assert r["result"]["drives"][1]["positionRad"] is None
    _, validator = load_validators(SCHEMAS)
    validator.validate(r)
    nxt = s.handle(step_request(7, wheels(8, 0.5)))
    assert "faultReceipts" not in nxt["result"]          # a tick without an injection has no receipts: legacy bytes
    s.end()


def test_an_injected_encoder_dropout_trips_feedback_loss_in_the_third_tick_through_the_session(tmp_path):
    s, _ = started(tmp_path, 6)
    faults = [[inj("e", "encoder-dropout", R)], [], []]
    for k in range(3):
        r = s.handle(request("step", {"targetTick": 7 + k, "velocities": [], "actorUpdates": [], "driveCommands": wheels(7 + k, 0.5), "faultInjections": faults[k]}, 6 + k))
        assert r["ok"], r
    assert [d["fault"] for d in r["result"]["drives"]] == [None, "FEEDBACK_LOSS"]
    s.end()


def test_a_refused_injection_leaves_the_tick_the_engine_and_the_staged_faults_unchanged(tmp_path):
    s, _ = started(tmp_path, 6)
    before = (s.engine.data.time, s.engine.drive.g.tick, list(s.engine.drive.g.stale))
    for bad, code in (([inj("e", "motor-weak", R, torqueScale=0.01)], "FAULT_PARAM_INVALID"), ([inj("e", "command-loss", R)], "FAULT_NOT_WORKER_APPLIED")):
        r = s.handle(request("step", {"targetTick": 7, "velocities": [], "actorUpdates": [], "driveCommands": wheels(7, 0.5), "faultInjections": bad}, 6, rid=f"refused-{code}"))
        assert not r["ok"] and r["error"]["code"] == code, r
        assert (s.engine.data.time, s.engine.drive.g.tick, list(s.engine.drive.g.stale)) == before and s.engine.drive.g.staged is None
    ok = s.handle(step_request(6, wheels(7, 0.5)))           # the same tick goes through afterwards
    assert ok["ok"] and ok["tick"] == 7
    s.end()


def test_a_step_refused_for_its_commands_drops_the_staged_injection(tmp_path):
    s, _ = started(tmp_path, 6)
    r = s.handle(request("step", {"targetTick": 7, "velocities": [], "actorUpdates": [], "driveCommands": wheels(7, 0.5)[:1], "faultInjections": [inj("e", "encoder-dropout", R)]}, 6))
    assert not r["ok"] and s.engine.drive.g.staged is None and not any(s.engine.drive.g.dropout) and s.engine.drive.g.fault_open == {}
    s.end()


def test_faultInjections_without_a_drive_model_are_refused(tmp_path):
    s = mobile_session(tmp_path, drive=False)
    assert s.handle(request("create", {"sceneRef": "navigation-scene.json", "seed": 7}))["ok"]
    assert s.handle(request("start"))["ok"]
    rid = s.scene["robots"][0]["robotId"]
    r = s.handle(request("step", {"targetTick": 1, "velocities": [{"robotId": rid, "vMps": 0.0, "omegaRadps": 0.0}], "actorUpdates": [], "faultInjections": [inj("e", "encoder-dropout", R)]}, 0))
    assert not r["ok"] and r["error"]["code"] == "INVALID_REQUEST"
    s.end()


def test_a_weakened_wheel_gets_a_force_limit_of_its_scale_times_the_healthy_one_and_gets_it_back(tmp_path):
    s, _ = started(tmp_path, 8)
    e = s.engine
    ratio = lambda: float(e.model.actuator_forcerange[e.acts[1], 1] / e.model.actuator_forcerange[e.acts[0], 1])
    assert 0.9 < ratio() < 1.1
    for k in range(8, 12):
        r = s.handle(request("step", {"targetTick": k + 1, "velocities": [], "actorUpdates": [], "driveCommands": wheels(k + 1, 0.5), **({"faultInjections": [inj("m", "motor-weak", R, torqueScale=0.2)]} if k == 8 else {})}, k, rid=f"w{k}"))
        assert r["ok"], r
        assert 0.15 < ratio() < 0.25                      # the limit of the weak wheel follows the same envelope, a fifth of it
    r = s.handle(request("step", {"targetTick": 13, "velocities": [], "actorUpdates": [], "driveCommands": wheels(13, 0.5), "faultInjections": [inj("m", "motor-weak", R, "end", torqueScale=0.2)]}, 12, rid="w12"))
    assert r["ok"] and 0.9 < ratio() < 1.1
    s.end()


def test_arm_and_gripper_force_limits_follow_motor_weak_and_grip_weak_and_are_restored():
    from test_drive_engine import arm_engine, arm_step, docs
    e = arm_engine(docs("xarm6", "nominal"))
    try:
        b, g = e.drive, e.drive.g
        row = lambda axis: e.model.actuator_forcerange[int(b.acts[g.index[axis]])].copy()
        base = {a: row(a) for a in ("xarm-1/J2", "xarm-1/gripper", "xarm-1/J3")}
        for k in range(8):
            arm_step(e, k)
        g.stage_faults([inj("m", "motor-weak", "xarm-1/J2", torqueScale=0.5), inj("w", "grip-weak", "xarm-1/gripper", torqueScale=0.25)])
        arm_step(e, 8)
        assert [r["phase"] for r in g.take_fault_receipts()] == ["start", "start"]
        assert row("xarm-1/J2") == pytest.approx(base["xarm-1/J2"] * 0.5) and row("xarm-1/gripper") == pytest.approx(base["xarm-1/gripper"] * 0.25)
        assert (row("xarm-1/J3") == base["xarm-1/J3"]).all()            # another axis keeps its limit
        g.stage_faults([inj("m", "motor-weak", "xarm-1/J2", "end", torqueScale=0.5), inj("w", "grip-weak", "xarm-1/gripper", "end", torqueScale=0.25)])
        arm_step(e, 9)
        assert all((row(a) == r).all() for a, r in base.items())
    finally:
        e.close()


def world_session(tmp_path):
    import shutil
    from mujoco_worker.protocol import PROTOCOL
    from mujoco_worker.session import scene_digest_of
    from scene_fixture import BLOBS
    from test_drive_engine import world_docs
    world = ROOT / "fixtures" / "coffee-delivery-world-v1"
    for p in world.iterdir():
        if p.is_file():
            shutil.copy(p, tmp_path / p.name)
    shutil.copytree(BLOBS, tmp_path / "blobs")
    scene = json.loads((tmp_path / "lab-world-scene.json").read_text())
    model, control = world_docs("arm-1", "nominal")
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
    req = lambda op, payload, tick=0, rid=None: {"protocol": PROTOCOL, "requestId": rid or f"{op}-{tick}", "runId": "world-test", "expectedTick": tick, "op": op, "payload": payload}
    assert s.handle(req("create", {"sceneRef": "lab-world-scene.json", "seed": 7}))["ok"]
    assert s.handle(req("start", {}))["ok"]
    return s, scene, req


def test_a_world_step_carries_injections_and_answers_receipts_in_the_wire_schema(tmp_path):
    from test_drive_engine import arm_commands, cmd
    s, scene, req = world_session(tmp_path)
    home = scene["armCell"]["arm"]["homeRad"]
    _, validator = load_validators(SCHEMAS)
    ctl = {"worldControl": {"version": 1, "program": None, "attachmentProxyPropId": None, "movementInterlocked": False, "stopLatched": False}} if scene.get("controlContextVersion") == 1 else {}
    def step(k, faults=None):
        cmds = arm_commands("arm-1", home, 0.0889, s.engine.arm.grip_range, s.engine.opening_max_m, k + 1) + [cmd("amr-1/wheel-left", k + 1, "csv", 0.0), cmd("amr-1/wheel-right", k + 1, "csv", 0.0)]
        p = {"targetTick": k + 1, "velocities": [], "actorUpdates": [], "driveCommands": cmds, **ctl, **({"faultInjections": faults} if faults else {})}
        r = s.handle(req("step", p, k, rid=f"s{k}-{bool(faults)}"))
        assert r["ok"], r
        validator.validate(r)
        return r["result"]
    for k in range(3):
        step(k)
    faulted = step(3, [inj("g", "grip-weak", "arm-1/gripper", torqueScale=0.5), inj("d", "encoder-dropout", "amr-1/wheel-right")])
    assert [(x["entryId"], x["appliedTick"]) for x in faulted["faultReceipts"]] == [("g", 4), ("d", 4)]
    assert faulted["drives"][-1]["positionRad"] is None and faulted["faultReceipts"][0]["runId"] == "world-test"
    assert "faultReceipts" not in step(4)
    s.end()


def test_a_wheel_that_went_quiet_does_not_make_the_pair_a_refused_body_twist(tmp_path):
    """command-loss repeats one wheel's last seq. The (v, omega) the pair amounts to is then no command anybody gave: the navigation-limit admission applies to fresh pairs only (each wheel's own range still applies)."""
    s, _ = started(tmp_path, 3)
    kin = s.scene["robots"][0]["model"]["kinematics"]
    radius, sep = s.engine.radius, s.engine.separation
    top = float(s.engine.physical["drive"]["actuatorMaxSpeedRadps"]["value"])
    r_target = 0.99 * top
    v, w = (0 + r_target) / 2 * radius, (r_target - 0) * radius / sep
    assert abs(v) > kin["maxLinearMps"] or abs(w) > kin["maxAngularRadps"], "the test needs a pair beyond the navigation limits"
    quiet = [{**c} for c in wheels(3, 0.0)]       # both wheels were last sent seq 3 with target 0.0
    mixed = [quiet[0], {**quiet[1], "seq": 4, "target": r_target}]   # left repeats seq 3, right is fresh at a speed the pair cannot carry
    r = s.handle(request("step", {"targetTick": 4, "velocities": [], "actorUpdates": [], "driveCommands": mixed}, 3, rid="mixed"))
    assert r["ok"], r
    both = s.handle(request("step", {"targetTick": 5, "velocities": [], "actorUpdates": [], "driveCommands": wheels(5, r_target)}, 4, rid="fresh"))
    assert not both["ok"] and both["error"]["code"] == "VELOCITY_TARGET_OUT_OF_RANGE", both   # a fresh pair is still checked
    s.end()
