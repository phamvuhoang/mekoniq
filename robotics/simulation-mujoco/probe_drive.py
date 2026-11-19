"""V01 spike probe: a virtual drive on the engine's own actuators. Measurement only: no worker module is changed, no verdict, no campaign.

The worker builds its models through `compile_cell`, `compile_mobile` and `compile_world`; this probe wraps those names for the lifetime of one engine and edits the
MJCF it returns (position/velocity -> pid, delay buffer), so the engine classes under test are the real ones. The "gate" (command channel + enable state machine +
group-bit switch) is a probe-local stand-in for the future `drive_model.py`: it writes `ctrl` before every substep, the only thing V03 will add to the step loops.

Cases (plan 01, V01): 1 ideal model bit-identity + legacy digests; 2 engine `pid` actuator; 3 enable/disable and brake; 4 command delay (queue vs native); 5 repeat + cost.
Run with the pinned Python:  PYTHONDONTWRITEBYTECODE=1 .venv-mujoco/bin/python -I -B robotics/simulation-mujoco/probe_drive.py --out <new dir>
Every number is `assumed` / `not_calibrated`; bit-identity is meaningful only on the architecture recorded in `environment.machine`.
"""
import argparse
import gzip
import hashlib
import json
import math
import platform
import sys
import time
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE / "tests")]  # python -I drops the script directory

import mujoco  # noqa: E402
import numpy as np  # noqa: E402
from scene_fixture import BLOBS, cell_scene, load  # noqa: E402

from mujoco_worker import engine as engine_mod, mobile_engine as mobile_mod, world_engine as world_mod  # noqa: E402
from mujoco_worker.drive import torque_limits, wheel_targets  # noqa: E402
from mujoco_worker.engine import BAD_STATE, MujocoEngine  # noqa: E402
from mujoco_worker.mobile_engine import MobileEngine  # noqa: E402
from mujoco_worker.session import scene_digest_of  # noqa: E402
from mujoco_worker.world_engine import WorldEngine  # noqa: E402

SERVE = HERE / "fixtures" / "serve-payload-v1"
LAYOUT, PHYS, PROGRAMS = load("cell-layout.json"), load("physics.json"), load("programs.json")
HOME, OPEN = PROGRAMS["programs"]["waypoints"]["home"], PHYS["gripper"]["openingMaxM"]
STAND = LAYOUT["nozzleStand"]
ON_STAND = [STAND["centerM"][0], STAND["centerM"][1], STAND["centerM"][2] + STAND["sizeM"][2] / 2 + LAYOUT["cup"]["heightM"] / 2 + 0.001]
UPRIGHT = [0.0, 0.0, 0.0, 1.0]
SUB, DT = 10, 0.002

# ---- starting values of the drive experiments: every one `assumed`, V03 measures and locks them -----------------------------------------------------------
WHEEL_PID = {"kp": 8.0, "kv": 2.0, "ki": 16.0, "imax": 0.25}  # kv = the R2b velocityGainNmsPerRad; kp 4x kv; integral force cap ki*imax = 4 N m (< 6 N m brake cap)


# ---- command programs (deterministic) -----------------------------------------------------------------------------------------------------------------
def mobile_cmd(k):
    k %= 300
    if k < 20 or k >= 250:
        return 0.0, 0.0
    r = min(1.0, (k - 19) / 50)
    return 0.2 * r, (0.4 * r if k >= 120 else 0.0)


def arm_q(k):
    return [h + 0.05 * math.sin(2 * math.pi * k / 150 + i) for i, h in enumerate(HOME)]


def arm_cmd(k):
    placements = [("cup-1", {"position": ON_STAND, "quaternionXyzw": UPRIGHT})] if k == 10 else []
    return arm_q(k), (OPEN if k % 300 < 100 else 0.03), placements


def world_cmd(k):
    k %= 500
    v = 0.1 * min(1.0, (k - 19) / 50) if 20 <= k < 250 else 0.0
    return arm_q(k), OPEN, [], v, (0.2 if 250 <= k < 350 else 0.0)


# ---- engines ------------------------------------------------------------------------------------------------------------------------------------------
@contextmanager
def patched(module, attr, edit):
    orig = getattr(module, attr)
    setattr(module, attr, lambda *a: (lambda r: (edit(r[0]), *r[1:]))(orig(*a)))
    try:
        yield
    finally:
        setattr(module, attr, orig)


def edit_mjcf(spec=None, delay=None):
    """spec: actuator name -> pid attributes (kp, kv, ki, imax, slewmax). delay: actuator name -> {nsample, delay} for the native buffer (position actuators)."""
    spec, delay = spec or {}, delay or {}

    def edit(xml):
        root = ET.fromstring(xml)
        act = root.find("actuator")
        original = list(act)
        pid_index = {i for i, el in enumerate(original) if el.attrib.get("name") in spec}
        for el in original:
            name = el.attrib.get("name")
            if name in spec:
                attrs = {k: el.attrib[k] for k in ("name", "joint", "forcerange") if k in el.attrib}
                if el.tag == "position" and "ctrlrange" in el.attrib:  # on a pid the ctrlrange belongs to cell 0, the reference position; a velocity actuator's range is not carried over
                    attrs["ctrlrange"] = el.attrib["ctrlrange"]
                attrs.update({k: repr(float(v)) for k, v in spec[name].items()})
                new = ET.Element("pid", attrs)
                act.insert(list(act).index(el), new)
                act.remove(el)
            elif name in delay:
                el.set("nsample", str(delay[name]["nsample"]))
                el.set("delay", "0")
        key = root.find("keyframe/key")
        if key is not None and pid_index:  # a pid actuator owns two ctrl cells (reference position, reference velocity): the keyframe's ctrl grows with it
            cells = [float(x) for x in key.attrib["ctrl"].split()]
            grown = []
            for i, c in enumerate(cells):
                grown.append(c)
                if i in pid_index:
                    grown.append(0.0)
            key.set("ctrl", " ".join(repr(c) for c in grown))
        return ET.tostring(root, encoding="unicode") + "\n"

    return edit


def mobile_inputs(load_name="cup-center"):
    read = lambda name: json.loads((SERVE / (name + ".json")).read_text())
    scene, model, profile, physics = read("navigation-scene"), read("physical-model-amr-1"), read(load_name), read("drive-contact-profile")
    for key, doc, name in (("loadProfileRef", profile, load_name), ("physicsProfileRef", physics, "drive-contact-profile")):
        scene["engine"][key].update(id=doc["id"], revision=doc["revision"], path=name + ".json", sha256=hashlib.sha256((SERVE / (name + ".json")).read_bytes()).hexdigest())
    scene["sceneDigest"] = scene_digest_of(scene)
    return scene, {"amr-1": model}, profile, physics


def new_mobile(edit=None):
    args = mobile_inputs()
    if edit is None:
        return MobileEngine(*args)
    with patched(mobile_mod, "compile_mobile", edit):
        return MobileEngine(*args)


def new_arm(edit=None):
    args = (cell_scene(("cup-1", "cup-2"), engine_seed=7), load("component.json"), load("physics.json"), str(BLOBS))
    if edit is None:
        return MujocoEngine(*args)
    with patched(engine_mod, "compile_cell", edit):
        return MujocoEngine(*args)


def world_inputs():
    read = lambda name: json.loads((SERVE / name).read_text())
    nav = read("navigation-scene.json")
    nav["robots"][0]["initialPoseMap"] = [0.35, 0.48591366218667575, math.pi / 2]
    nav["world"]["obstacles"], nav["world"]["boundaries"] = [], []
    nav["engine"]["loadProfileRef"].update(id="empty", revision=1)
    scene = {"schemaVersion": 1, "documentType": "lab-world-scene", "sceneDigest": "a" * 64, "navigation": nav, "armCell": cell_scene(),
             "supportMap": {"replacedStaticSupportId": "tray", "mobileSupportId": "amr-1/tray-1"},
             "numericalPolicy": {"id": "coffee-delivery-world-numerics-v1", "revision": 1, "calibration": "not_calibrated", "timestepMs": 2, "substeps": 10, "primingSubsteps": 10,
                                 "integrator": "implicitfast", "cone": "elliptic", "impratio": 10, "solver": "Newton", "iterations": 100, "tolerance": 1e-8, "floorSlidingFriction": 1.0}}
    return scene, load("component.json"), load("physics.json"), {"amr-1": read("physical-model-amr-1.json")}, read("empty.json"), read("drive-contact-profile.json"), str(BLOBS)


def new_world(edit=None):
    args = world_inputs()
    if edit is None:
        return WorldEngine(*args)
    with patched(world_mod, "compile_world", edit):
        return WorldEngine(*args)


# ---- the gate: probe-local stand-in for drive_model.py ------------------------------------------------------------------------------------------------
class Gate:
    """Per-substep writer of `ctrl`. One command vector per tick (one value per axis), a delay of `delay` substeps (queue), an enable state machine per axis
    (disabled -> ready -> enabled) and a switch-off by actuator group bit (group i+1 for axis i) or by forcerange 0. Kinds: pos/vel = one ctrl cell (an R2b actuator
    or a pid used as a position servo, whose velocity-reference cell stays 0); pidv = pid used as a velocity servo: cell 0 is the integrated reference position,
    cell 1 the commanded velocity."""

    def __init__(s, m, d, acts, kinds, delay=0, enable_delay=0, boot_enabled=True, disable_mode="group", brake=None, brake_soft=None, reset_integral=False):
        s.m, s.d, s.acts, s.kinds, s.n = m, d, list(acts), list(kinds), len(acts)
        s.adr0 = m.actuator_ctrladr[s.acts].astype(int)
        s.pv = np.array([i for i, k in enumerate(kinds) if k == "pidv"], dtype=int)
        s.adr1 = s.adr0[s.pv] + 1
        jid = m.actuator_trnid[s.acts, 0]
        s.qadr, s.dof = m.jnt_qposadr[jid], m.jnt_dofadr[jid]
        s.pref = d.qpos[s.qadr[s.pv]].copy()
        s.initial = d.ctrl[s.adr0].copy()
        s.initial[s.pv] = 0.0
        s.delay, s.enable_delay, s.disable_mode, s.reset_integral = delay, enable_delay, disable_mode, reset_integral
        s.state = np.full(s.n, 2 if boot_enabled else 0)
        s.cnt = np.zeros(s.n, dtype=int)
        s.enable = np.ones(s.n, dtype=bool)
        s.active = s.state == 2
        s.stream, s.sub, s.out = [], 0, s.initial.copy()
        for i, a in enumerate(s.acts):
            m.actuator_group[a] = i + 1
        s.base_disable = int(m.opt.disableactuator)
        s.saved_force = m.actuator_forcerange[s.acts].copy()
        s.base_loss = m.dof_frictionloss[s.dof].copy()
        s.brake = None if brake is None else np.asarray(brake, dtype=float)
        s.brake_soft = brake_soft  # (solimp, solref) of the friction-loss constraint while braking; the base values come back when the axis is enabled
        s.base_solimp, s.base_solref = m.dof_solimp[s.dof].copy(), m.dof_solref[s.dof].copy()
        s.actadr = m.actuator_actadr[s.acts].astype(int)
        s.actnum = m.actuator_actnum[s.acts].astype(int)
        s._switch()

    def begin_tick(s, command):
        s.stream.extend([np.asarray(command, dtype=float)] * SUB)

    def _switch(s):
        m, a = s.m, s.active
        if s.disable_mode == "group":
            m.opt.disableactuator = s.base_disable | sum(1 << (i + 1) for i in range(s.n) if not a[i])
        else:
            for i in range(s.n):
                m.actuator_forcerange[s.acts[i]] = s.saved_force[i] if a[i] else (0.0, 0.0)
        if s.brake is not None:
            m.dof_frictionloss[s.dof] = np.where(a, s.base_loss, np.maximum(s.base_loss, s.brake))
            if s.brake_soft is not None:
                for i in range(s.n):
                    m.dof_solimp[s.dof[i]] = s.base_solimp[i] if a[i] else s.brake_soft[0]
                    m.dof_solref[s.dof[i]] = s.base_solref[i] if a[i] else s.brake_soft[1]
        if s.reset_integral:
            for i in range(s.n):
                if not a[i] and s.actnum[i]:
                    s.d.act[s.actadr[i]:s.actadr[i] + s.actnum[i]] = 0.0

    def apply(s):
        i = s.sub - s.delay
        s.sub += 1
        s.out = s.stream[i] if i >= 0 else s.initial
        st, want = s.state, s.enable
        st[(st == 0) & want] = 1
        rdy = (st == 1) & want
        s.cnt[rdy] += 1
        st[rdy & (s.cnt >= s.enable_delay)] = 2
        st[(~want) & (st > 0)] = 0
        s.cnt[st != 1] = 0
        active = st == 2
        if (active != s.active).any():
            s.active = active
            s._switch()
        d = s.d
        if s.pv.size:
            s.pref = np.where(s.active[s.pv], s.pref + s.out[s.pv] * DT, d.qpos[s.qadr[s.pv]])
            c0 = s.out.copy()
            c0[s.pv] = s.pref
            d.ctrl[s.adr0] = c0
            d.ctrl[s.adr1] = s.out[s.pv]
        else:
            d.ctrl[s.adr0] = s.out


class BareGate:
    """No drive layer: `ctrl` is written once per tick from the tick command, as the legacy loops do. Same stepping functions, so the difference to `Gate` is the gate's own cost."""

    def __init__(s, m, d, acts, kinds, **_):
        s.d, s.adr0, s.out, s.sub = d, m.actuator_ctrladr[list(acts)].astype(int), None, 0

    def begin_tick(s, command):
        s.out = np.asarray(command, dtype=float)

    def apply(s):
        if s.sub % SUB == 0:
            s.d.ctrl[s.adr0] = s.out
        s.sub += 1


def warnings(d):
    return sum(d.warning[w].number for w in BAD_STATE.values())


def gated_mobile_step(e, g, v, w, on_sub=None):
    d, m = e.data, e.model
    targets = np.array(wheel_targets(v, w, e.radius, e.separation))
    g.begin_tick(targets)
    before = warnings(d)
    for _ in range(e.substeps):
        g.apply()
        for act, vel, t in zip(e.acts, d.qvel[e.wv], g.out):
            m.actuator_forcerange[act] = torque_limits(float(vel), float(t), e.physics)
        mujoco.mj_step(m, d)
        if on_sub:
            on_sub(d)
    mujoco.mj_forward(m, d)
    return warnings(d) - before


def arm_axes(e):
    return e.arm_act + [e.grip_act]


def grip_ctrl(e, opening):
    lo, hi = e.model.actuator_ctrlrange[e.model.actuator_ctrladr[e.grip_act]]  # ctrlrange is per ctrl CELL: the engine's own grip_range (indexed by actuator id) is wrong once a pid owns two cells
    return lo + (hi - lo) * (1.0 - opening / e.opening_max_m)


def gated_arm_step(e, g, targets, opening, placements, on_sub=None):
    d = e.data
    g.begin_tick([*targets, grip_ctrl(e, opening)])
    for pid, pose in placements:
        x, y, z, w = pose["quaternionXyzw"]
        q = np.array([w, x, y, z], dtype=float)
        e._put(pid, [*pose["position"], *(q / np.linalg.norm(q))])
        e._set_contacts(pid, True)
        e.in_scene.add(pid)
    for pid in e.prop.keys() - e.in_scene:
        e._put(pid, e.prop[pid]["park"])
    before = warnings(d)
    for _ in range(e.substeps):
        g.apply()
        mujoco.mj_step(e.model, d)
        if on_sub:
            on_sub(d)
    return warnings(d) - before


def gated_world_step(e, g, targets, opening, placements, v_mps, omega, on_sub=None):
    m, d, a, v = e.model, e.data, e.arm, e.mobile
    wt = np.array(wheel_targets(v_mps, omega, v.radius, v.separation))
    g.begin_tick([*targets, grip_ctrl(a, opening), *wt])
    for pid in a.prop.keys() - a.in_scene:
        a._put(pid, a.prop[pid]["park"])
    before = warnings(d)
    for _ in range(SUB):
        g.apply()
        for act, actual, t in zip(v.acts, d.qvel[v.wv], g.out[7:]):
            m.actuator_forcerange[act] = torque_limits(float(actual), float(t), v.physics)
        mujoco.mj_step(m, d)
        if on_sub:
            on_sub(d)
    mujoco.mj_forward(m, d)
    return warnings(d) - before


# ---- runners ------------------------------------------------------------------------------------------------------------------------------------------
def digest(qp, qv):
    h = hashlib.sha256()
    for a, b in zip(qp, qv):
        h.update(np.ascontiguousarray(a).tobytes())
        h.update(np.ascontiguousarray(b).tobytes())
    return h.hexdigest()


def trace(e, n, step):
    qp, qv, ms = [], [], []
    for k in range(n):
        t = time.perf_counter()
        step(k)
        ms.append((time.perf_counter() - t) * 1000)
        qp.append(e.data.qpos.copy())
        qv.append(e.data.qvel.copy())
    return np.array(qp), np.array(qv), np.array(ms)


def legacy_mobile(n, edit=None):
    e = new_mobile(edit)
    r = trace(e, n, lambda k: e.step(*mobile_cmd(k)))
    e.close()
    return r


def legacy_arm(n):
    e = new_arm()
    r = trace(e, n, lambda k: e.step(*arm_cmd(k)))
    e.close()
    return r


def legacy_world(n):
    e = new_world()
    r = trace(e, n, lambda k: e.step(*world_cmd(k)))
    e.close()
    return r


def gated_mobile(n, edit=None, kind="vel", gate=None, **gk):
    e = new_mobile(edit)
    g = (gate or Gate)(e.model, e.data, e.acts, [kind] * 2, **gk)
    r = trace(e, n, lambda k: gated_mobile_step(e, g, *mobile_cmd(k)))
    e.close()
    return r


def gated_arm(n, edit=None, pid=(), **gk):
    e = new_arm(edit)
    g = Gate(e.model, e.data, arm_axes(e), ["pid" if i in pid else "pos" for i in range(7)], **gk)
    r = trace(e, n, lambda k: gated_arm_step(e, g, *arm_cmd(k)))
    e.close()
    return r


def gated_world(n, edit=None, arm_kind="pos", wheel_kind="vel", gate=None, **gk):
    e = new_world(edit)
    g = (gate or Gate)(e.model, e.data, arm_axes(e.arm) + e.mobile.acts, [arm_kind] * 6 + ["pos"] + [wheel_kind] * 2, **gk)
    r = trace(e, n, lambda k: gated_world_step(e, g, *world_cmd(k)))
    e.close()
    return r


def compare(a, b):
    """First tick where qpos or qvel differ, and the largest absolute difference, between two (qpos, qvel, ms) traces."""
    dq, dv = np.abs(a[0] - b[0]), np.abs(a[1] - b[1])
    bad = np.where((dq > 0).any(axis=1) | (dv > 0).any(axis=1))[0]
    return {"bitIdentical": bool(np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1])), "firstDifferingTick": int(bad[0]) if len(bad) else None,
            "maxAbsQpos": float(dq.max()), "maxAbsQvel": float(dv.max())}


def pct(ms):
    return {"p50Ms": round(float(np.percentile(ms, 50)), 4), "p95Ms": round(float(np.percentile(ms, 95)), 4), "meanMs": round(float(np.mean(ms)), 4)}


def step_metrics(y, y0, y1, dt, tol=0.02):
    """Final value, steady error, overshoot (fraction of the step) and settle time (last sample outside tol*|step|) of a response y(t) from y0 to y1."""
    y = np.asarray(y, dtype=float)
    span = y1 - y0
    outside = np.where(np.abs(y - y1) > tol * abs(span))[0]
    overshoot = float(max(0.0, (y.max() - y1) / abs(span))) if span > 0 else float(max(0.0, (y1 - y.min()) / abs(span)))
    return {"final": float(y[-1]), "steadyError": float(y[-1] - y1), "overshootFraction": overshoot,
            "settleS": None if len(outside) and outside[-1] == len(y) - 1 else float((outside[-1] + 1) * dt if len(outside) else 0.0)}


def readback(m, act):
    """The actuator as the compiled MjModel holds it."""
    f = lambda name: getattr(m, name)[act].tolist()
    return {"gainType": int(m.actuator_gaintype[act]), "biasType": int(m.actuator_biastype[act]), "dynType": int(m.actuator_dyntype[act]), "gainprm": f("actuator_gainprm")[:3], "biasprm": f("actuator_biasprm")[:3],
            "dynprm": f("actuator_dynprm")[:3], "ctrlAdr": int(m.actuator_ctrladr[act]), "ctrlNum": int(m.actuator_ctrlnum[act]), "actAdr": int(m.actuator_actadr[act]), "actNum": int(m.actuator_actnum[act]),
            "forcerange": f("actuator_forcerange"), "group": int(m.actuator_group[act]), "delay": float(m.actuator_delay[act]), "history": f("actuator_history")}


# ---- case 1: ideal model, bit identity, legacy digests ------------------------------------------------------------------------------------------------
def case1(out):
    res = {}
    plans = {"mobile": (300, legacy_mobile, lambda n: gated_mobile(n)), "arm": (300, legacy_arm, lambda n: gated_arm(n)), "world": (500, legacy_world, lambda n: gated_world(n))}
    for name, (n, legacy, gated) in plans.items():
        L = [legacy(n) for _ in range(3)]
        G = [gated(n) for _ in range(3)]
        dl = [digest(l[0], l[1]) for l in L]
        res[name] = {"ticks": n, "legacyDigest": dl[0], "legacyRepeatsIdentical": len(set(dl)) == 1, "gatedRepeatsIdentical": len({digest(g[0], g[1]) for g in G}) == 1,
                     "gatedVsLegacy": [compare(l, g) for l, g in zip(L, G)], "finite": bool(np.isfinite(L[0][0]).all() and np.isfinite(L[0][1]).all()), "largestQposSpan": float(np.ptp(L[0][0], axis=0).max()),
                     "digestInput": "sha256 over, per tick after step(): qpos.tobytes() then qvel.tobytes() (float64 native-endian)"}
        print("case1", name, res[name]["legacyDigest"], res[name]["gatedVsLegacy"][0]["bitIdentical"], flush=True)
    return res


# ---- case 2: the engine's pid actuator -----------------------------------------------------------------------------------------------------------------
def wheel_step_run(edit, kind, n=200):
    e = new_mobile(edit)
    g = Gate(e.model, e.data, e.acts, [kind] * 2)
    v = lambda k: (0.0, 0.0) if k < 20 else (0.2, 0.0)
    target = wheel_targets(0.2, 0.0, e.radius, e.separation)
    rows, warn = [], 0
    for k in range(n):
        warn += gated_mobile_step(e, g, *v(k))
        rows.append([*e.data.qvel[e.wv], *(e.data.act[g.actadr[i] + g.actnum[i] - 1] if g.actnum[i] else 0.0 for i in range(2)), *e.data.actuator_force[e.acts]])
    rows = np.array(rows)
    m = step_metrics(rows[19:, 0], 0.0, target[0], 0.02)
    out = {"targetRadS": list(target), "wheelRadS": rows[:, :2].tolist(), "integralState": rows[:, 2:4].tolist(), "torqueNm": rows[:, 4:6].tolist(), "warnings": int(warn), "finite": bool(np.isfinite(rows).all()),
           "metricsLeft": m, "metricsRight": step_metrics(rows[19:, 1], 0.0, target[1], 0.02), "maxAbsIntegral": float(np.abs(rows[:, 2:4]).max()), "readback": readback(e.model, e.acts[0])}
    e.close()
    return out


def arm_step_run(edit, pid, n=250, step_rad=0.2, joint=1, init_slew=False):
    e = new_arm(edit)
    g = Gate(e.model, e.data, arm_axes(e), ["pid" if i in pid else "pos" for i in range(7)])
    dof = e.arm_qvel[joint]
    d = e.data
    if init_slew:  # a slew-limited pid keeps its slewed reference in act[0], which starts at 0 and not at the command
        for i in pid:
            d.act[g.actadr[i]] = d.ctrl[g.adr0[i]]
    mujoco.mj_forward(e.model, d)
    bias = float(d.qfrc_bias[dof])
    q = lambda k: [h + (step_rad if (i == joint and k >= 50) else 0.0) for i, h in enumerate(HOME)]
    rows, warn = [], 0
    for k in range(n):
        warn += gated_arm_step(e, g, q(k), OPEN, [])
        a = g.actadr[joint]
        rows.append([d.qpos[e.arm_qpos[joint]], d.actuator_force[e.arm_act[joint]], d.act[a + g.actnum[joint] - 1] if g.actnum[joint] else 0.0])
    rows = np.array(rows)
    y0, y1 = HOME[joint], HOME[joint] + step_rad
    out = {"gravityBiasNm": bias, "qpos": rows[:, 0].tolist(), "forceNm": rows[:, 1].tolist(), "integralState": rows[:, 2].tolist(), "warnings": int(warn), "finite": bool(np.isfinite(rows).all()),
           "holdErrorBeforeStepRad": float(rows[49, 0] - y0), "step": step_metrics(rows[50:, 0], y0, y1, 0.02), "maxAbsIntegral": float(np.abs(rows[:, 2]).max()), "readback": readback(e.model, e.arm_act[joint])}
    e.close()
    return out


def arm_pid_gains():
    """J2 gains from the R2b position actuator; ki = kp/2 per second; the integral force cap ki*imax = 2x the joint's gravity torque at home, within its effort limit."""
    probe = new_arm()
    mujoco.mj_forward(probe.model, probe.data)
    rb = readback(probe.model, probe.arm_act[1])
    kp, kv = -rb["biasprm"][1], -rb["biasprm"][2]
    bias = abs(float(probe.data.qfrc_bias[probe.arm_qvel[1]]))
    effort = float(probe.model.actuator_forcerange[probe.arm_act[1]][1])
    probe.close()
    ki = 0.5 * kp
    return {"kp": kp, "kv": kv, "ki": ki, "imax": min(2.0 * bias, effort) / ki}


def case2(out):
    res = {}
    legacy_wheel = wheel_step_run(None, "vel")
    pid_wheel = wheel_step_run(edit_mjcf({"DRIVE_0": WHEEL_PID, "DRIVE_1": WHEEL_PID}), "pidv")
    res["wheel"] = {"gains": WHEEL_PID, "legacyVelocityActuator": legacy_wheel, "pidActuator": pid_wheel}
    gains = arm_pid_gains()
    res["arm"] = {"joint": "J2", "gains": gains, "legacyPositionActuator": arm_step_run(None, ()), "pidActuator": arm_step_run(edit_mjcf({"J2_act": gains}), (1,)),
                  "pidWithSlewReferenceAtZero": arm_step_run(edit_mjcf({"J2_act": {**gains, "slewmax": 0.5}}), (1,)),
                  "pidWithSlewReferenceInitialised": arm_step_run(edit_mjcf({"J2_act": {**gains, "slewmax": 0.5}}), (1,), init_slew=True)}
    res["wheel"]["kiSweep"] = {str(ki): {k: v for k, v in wheel_step_run(edit_mjcf({f"DRIVE_{i}": {**WHEEL_PID, "ki": ki, "imax": WHEEL_PID["ki"] * WHEEL_PID["imax"] / ki} for i in range(2)}), "pidv").items()
                                         if k in ("warnings", "finite", "metricsLeft", "maxAbsIntegral")} for ki in (2.0, 4.0, 8.0, 16.0, 64.0, 256.0, 1024.0)}
    res["arm"]["kiSweep"] = {str(f): {k: v for k, v in arm_step_run(edit_mjcf({"J2_act": {**gains, "ki": gains["ki"] * f, "imax": gains["imax"] / f}}), (1,)).items() if k in ("warnings", "finite", "step", "maxAbsIntegral")}
                             for f in (1, 10, 100, 1000)}
    probe = new_arm()
    gk = {}
    for k in range(6):
        rb = readback(probe.model, probe.arm_act[k])
        gk[f"J{k + 1}_act"] = {"kp": -rb["biasprm"][1], "kv": -rb["biasprm"][2], "ki": 0.0}
    probe.close()
    legacy = legacy_arm(300)
    res["onRealCell"] = {"pidKi0AllSixJointsVsPositionActuator": compare(legacy, gated_arm(300, edit_mjcf(gk), pid=tuple(range(6)))),
                         "delayBufferZeroDelayAllSevenActuatorsVsPlain": compare(legacy, gated_arm(300, edit_mjcf(delay={f"J{k + 1}_act": {"nsample": 64} for k in range(6)} | {"grip_act": {"nsample": 64}})))}
    for name in ("wheel", "arm"):
        for k in ("legacyVelocityActuator" if name == "wheel" else "legacyPositionActuator", "pidActuator"):
            r = res[name][k]
            print("case2", name, k, "warn", r["warnings"], "finite", r["finite"], flush=True)
    return res


# ---- case 3: enable/disable and brake ------------------------------------------------------------------------------------------------------------------
# (solimp, solref) of the dof friction-loss constraint while an axis brakes; MuJoCo default is solimp .9/.95/.001, solref .02/1
TIGHT = ([0.99, 0.999, 0.001, 0.5, 2.0], [0.004, 1.0])
TIGHTER = ([0.999, 0.9999, 0.001, 0.5, 2.0], [0.004, 1.0])
def disable_run(mode, reset, pid_edit, n=300, off=100, on=200):
    e = new_arm(pid_edit)
    g = Gate(e.model, e.data, arm_axes(e), ["pos", "pid"] + ["pos"] * 5, disable_mode=mode, reset_integral=reset)
    d, j = e.data, 1
    rows = []
    q = lambda k: [h + (0.1 if i == j else 0.0) for i, h in enumerate(HOME)]
    for k in range(n):
        g.enable[j] = not (off <= k < on)
        gated_arm_step(e, g, q(k), OPEN, [])
        a = g.actadr[j] + g.actnum[j] - 1
        rows.append([d.qpos[e.arm_qpos[j]], d.qvel[e.arm_qvel[j]], d.actuator_force[e.arm_act[j]], d.act[a]])
    r = np.array(rows)
    e.close()
    return {"disabledForceMaxAbsNm": float(np.abs(r[off + 1:on, 2]).max()), "integralAtDisable": float(r[off, 3]), "integralAtReenable": float(r[on - 1, 3]), "integralDriftWhileDisabled": float(r[on - 1, 3] - r[off, 3]),
            "reenableTransientMaxAbsQvel": float(np.abs(r[on:on + 25, 1]).max()), "finalQposError": float(r[-1, 0] - (HOME[j] + 0.1)), "finite": bool(np.isfinite(r).all())}


def hold_run(mode, scale, soft=None, n=550, off=50):
    """All arm axes switched off at tick `off`; `scale` x |gravity bias| of each joint as dry friction ('brake'), or none ('coast'). Returns the drift over the next 500 ticks."""
    e = new_arm()
    d = e.data
    mujoco.mj_forward(e.model, d)
    bias = np.abs(d.qfrc_bias[e.arm_qvel].copy())
    g = Gate(e.model, e.data, arm_axes(e), ["pos"] * 7, brake=None if mode == "coast" else np.array([*(scale * bias), 0.0]), brake_soft=soft)
    q = lambda k: HOME
    qs = []
    for k in range(n):
        g.enable[:6] = not (k >= off)
        gated_arm_step(e, g, q(k), OPEN, [])
        qs.append(d.qpos[e.arm_qpos].copy())
    qs = np.array(qs)
    drift = np.abs(qs[off:] - qs[off - 1]).max(axis=0)
    out = {"mode": mode, "scaleOfGravityBias": scale, "constraintSoftness": soft, "gravityBiasNm": bias.tolist(), "maxDriftRadPerJoint": drift.tolist(), "maxDriftRad": float(drift.max()), "finalSpeedRadS": float(np.abs(d.qvel[e.arm_qvel]).max()), "ticksHeld": n - off}
    e.close()
    return out


def case3(out):
    pid = edit_mjcf({"J2_act": arm_pid_gains()})
    res = {"disable": {"groupBit": disable_run("group", False, pid), "forcerangeZero": disable_run("forcerange", False, pid), "groupBitPlusIntegralReset": disable_run("group", True, pid)},
           "hold": [hold_run("coast", 0.0), hold_run("brake", 1.2), hold_run("brake", 3.0), hold_run("brake", 3.0, TIGHT), hold_run("brake", 3.0, TIGHTER)]}
    print("case3", {k: v["integralDriftWhileDisabled"] for k, v in res["disable"].items()}, [h["maxDriftRad"] for h in res["hold"]], flush=True)
    return res


# ---- case 4: command delay, queue vs the engine's native buffer ----------------------------------------------------------------------------------------
def delay_run(D, native, n=120, joint=1, amp=0.2, init_history=True):
    nsample = 64
    edit = edit_mjcf(delay={f"J{joint + 1}_act": {"nsample": nsample}}) if native else None
    e = new_arm(edit)
    d, m = e.data, e.model
    if native:
        a = e.arm_act[joint]
        m.actuator_delay[a] = D * DT
        if init_history:
            mujoco.mj_initCtrlHistory(m, d, a, None, np.full((nsample, 1), d.ctrl[m.actuator_ctrladr[a]]))
    g = Gate(m, d, arm_axes(e), ["pos"] * 7, delay=0 if native else D)
    qs = []
    q = lambda k: [h + (amp if (i == joint and k >= 20) else 0.0) for i, h in enumerate(HOME)]
    for k in range(n):
        gated_arm_step(e, g, q(k), OPEN, [], on_sub=lambda dd: qs.append(float(dd.qpos[e.arm_qpos[joint]])))
    e.close()
    return np.array(qs)


def case4(out):
    base, still = delay_run(0, False), delay_run(0, False, amp=0.0)
    res = {}
    for D in (1, 10, 50):
        queue, native = delay_run(D, False), delay_run(D, True)
        first = lambda q: int(np.argmax(np.abs(q - still) > 1e-9))  # first substep that differs from the run that never gets the step (step is commanded at substep 200)
        res[str(D)] = {"delaySubsteps": D, "delayMs": D * 2, "firstMotionSubstep": {"noDelay": first(base), "queue": first(queue), "native": first(native)}, "maxAbsQposDiffQueueVsNative": float(np.abs(queue - native).max()),
                       "maxAbsQposDiffQueueVsNoDelay": float(np.abs(queue - base).max()), "nativeRuntimeMutable": True, "nsample": 64}
        print("case4", D, res[str(D)]["firstMotionSubstep"], res[str(D)]["maxAbsQposDiffQueueVsNative"], flush=True)
    raw = delay_run(10, True, init_history=False)  # without mj_initCtrlHistory the buffer holds ctrl 0 until the delay has passed
    res["10-nativeWithoutHistoryInit"] = {"maxAbsQposDiffVsStill": float(np.abs(raw - still).max()), "maxAbsQposDiffVsInitialisedNative": float(np.abs(raw - delay_run(10, True)).max())}
    half = delay_run(1.5, True)  # 3 ms: not a whole substep; the native buffer interpolates, a queue cannot
    res["1.5"] = {"delaySubsteps": 1.5, "nativeOnly": True, "firstMotionSubstep": int(np.argmax(np.abs(half - still) > 1e-9)), "maxAbsQposDiffVsQueue1": float(np.abs(half - delay_run(1, False)).max()),
                  "maxAbsQposDiffVsQueue2": float(np.abs(half - delay_run(2, False)).max())}
    return res


# ---- case 5: repeats and cost --------------------------------------------------------------------------------------------------------------------------
def case5(out, ticks):
    gains = {k: {"kp": 40.0, "kv": 4.0, "ki": 4.0, "imax": 0.5} for k in range(6)}
    arm_pid = edit_mjcf({f"J{k + 1}_act": gains[k] for k in range(6)})
    world_pid = lambda xml: edit_mjcf({**{f"J{k + 1}_act": gains[k] for k in range(6)}, "M_DRIVE_0": WHEEL_PID, "M_DRIVE_1": WHEEL_PID})(xml)
    configs = {
        "mobile-2axes": {"legacy": lambda: legacy_mobile(ticks), "bare": lambda: gated_mobile(ticks, gate=BareGate), "gated": lambda: gated_mobile(ticks), "gatedPid": lambda: gated_mobile(ticks, edit_mjcf({"DRIVE_0": WHEEL_PID, "DRIVE_1": WHEEL_PID}), "pidv")},
        "world-9axes": {"legacy": lambda: legacy_world(ticks), "bare": lambda: gated_world(ticks, gate=BareGate), "gated": lambda: gated_world(ticks), "gatedPid": lambda: gated_world(ticks, world_pid, "pid", "pidv")},
    }
    res = {}
    for name, runs in configs.items():
        times = {k: [] for k in runs}
        digests = {k: [] for k in runs}
        for rnd in range(3):  # interleaved so the host's drift hits every variant alike
            for k, fn in runs.items():
                qp, qv, ms = fn()
                times[k].append(ms)
                digests[k].append(digest(qp, qv))
        res[name] = {"ticksPerRun": ticks, "rounds": 3, "repeatBitIdentical": {k: len(set(v)) == 1 for k, v in digests.items()}, "digests": {k: v[0] for k, v in digests.items()}, **{k: pct(np.concatenate(v)) for k, v in times.items()}}
        # legacy = the engine's full step (readings, contact samples, scans); bare/gated/gatedPid = physics substeps only. The gate's cost is the difference to bare.
        for k in ("gated", "gatedPid"):
            res[name][k + "OverheadVsBareP50Ms"] = round(res[name][k]["p50Ms"] - res[name]["bare"]["p50Ms"], 4)
            res[name][k + "OverheadVsBareP95Ms"] = round(res[name][k]["p95Ms"] - res[name]["bare"]["p95Ms"], 4)
        print("case5", name, {k: res[name][k] for k in runs}, flush=True)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--cases", default="1,2,3,4,5")
    ap.add_argument("--cost-ticks", type=int, default=2000)
    args = ap.parse_args()
    if args.out.exists():
        raise SystemExit("output exists; preserve earlier probe evidence")
    args.out.mkdir(parents=True)
    env = {"machine": platform.machine(), "platform": platform.platform(), "python": platform.python_version(), "mujoco": mujoco.__version__, "numpy": np.__version__,
           "accepted": False, "calibration": "not_calibrated", "note": "bit identity is meaningful only on the architecture recorded here"}
    result = {"environment": env, "assumed": {"wheelPid": WHEEL_PID}}
    for c, fn in (("1", lambda: case1(args.out)), ("2", lambda: case2(args.out)), ("3", lambda: case3(args.out)), ("4", lambda: case4(args.out)), ("5", lambda: case5(args.out, args.cost_ticks))):
        if c in args.cases.split(","):
            t = time.time()
            result["case" + c] = fn()
            print(f"case {c} done in {time.time() - t:.0f}s", flush=True)
    (args.out / "results.json").write_text(json.dumps(result, indent=1, allow_nan=False) + "\n")
    # raw step responses are bulky; keep them gzip so the JSON above stays readable
    with gzip.GzipFile(filename="", fileobj=(args.out / "case2-traces.json.gz").open("wb"), mode="wb", mtime=0) as z:
        z.write(json.dumps(result.get("case2", {}), allow_nan=False).encode())


if __name__ == "__main__":
    main()
