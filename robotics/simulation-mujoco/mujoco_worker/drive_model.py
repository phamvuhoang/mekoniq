"""The virtual drive of R4-A §5 as a pure state machine: no mujoco import. It owns the enable/fault state machine, the watchdog, the command channel (delay,
interpolation), the measured-feedback channel (quantisation, delay, velocity window, loss) and the per-axis telemetry. It never computes a torque: the servo loop is the
engine's own actuator (position, velocity or pid), chosen by `actuator_spec` at compile time and driven through the `ctrl` this module hands out every substep.

Per-substep order is the contract's (contracts §3): 1 command channel, 2 state machine (enable, quick stop, watchdog, drive-side checks), 3 `ctrl` and limits (`substep`);
4 the caller's mj_step; 5 feedback channel and trace (`sample`). Everything is counted in simulated substeps/ticks, never in wall time: a pause, 64x pacing or a hidden tab
cannot produce a COMMAND_TIMEOUT. The numbers (overspeed factor, quick-stop rest speed) are `assumed` starting values of the V01 spike.
"""
import math
from collections import deque

from .protocol import DRIVE_REFUSALS, WorkerError  # noqa: F401  (the refusal codes this module raises)

DISABLED, READY, ENABLED, QUICK_STOP, FAULT = "disabled", "ready", "enabled", "quick_stop", "fault"
OVERSPEED_FACTOR = 1.2         # assumed: a trip when the true speed exceeds 1.2x the axis' velocity limit
QUICK_STOP_REST_RADS = 0.005   # assumed: a quick stop ends early once the true speed is below this


def quantize(angle_rad, counts_per_rev):
    """The nearest multiple of one encoder count (2 pi / countsPerRev); None means an exact (unquantised) encoder."""
    if counts_per_rev is None:
        return angle_rad
    step = 2 * math.pi / counts_per_rev
    return round(angle_rad / step) * step


def actuator_spec(axis_model, axis_control):
    """The engine actuator for one axis, by the mapping the V01 spike locked (docs/research/2026-11-virtual-drive-spike.md, section 2).

    csp: `position` (kp, kv = kd) while ki = 0 and there is no slew, else `pid` (kp, kv = kd, ki, imax = integralLimit / ki, slewmax). Its ctrl is the target position.
    csv: `velocity` (kv = kp) while ki = 0. With ki > 0 a proportional-integral velocity loop is exactly a pid actuator with kv = kp, a position gain of ki on the integral of the
    velocity error (the integrated reference p_ref - q) and ki = 0: the drive integrates p_ref itself and clamps |p_ref - q| to integralLimit / ki. ctrl = (p_ref, v_cmd).
    `integralLimit` is a force limit in N m. Refuses what it cannot express instead of ignoring it."""
    mode, loop, accel = axis_model["mode"], axis_control["loop"], axis_control["accelerationLimit"]
    kp, ki, kd, limit, slew = loop["kp"], loop["ki"], loop["kd"], loop["integralLimit"], loop["slewLimit"]
    name = axis_model["axisId"]
    # one rule table per mode, the same as validateControlProfile (shared vectors: tests/data/control-profile-admission-v1.json)
    if not all(isinstance(g, (int, float)) and math.isfinite(g) and g >= 0 for g in (kp, ki, kd)) or any(x is not None and not (isinstance(x, (int, float)) and math.isfinite(x) and x > 0) for x in (limit, slew, accel)):
        raise WorkerError("DRIVE_DOCUMENT_INVALID", f"{name}: a gain is negative or not finite, or a limit is not positive")
    if (ki > 0) != (limit is not None):
        raise WorkerError("DRIVE_DOCUMENT_INVALID", f"{name}: an integralLimit exists exactly when ki > 0")
    if mode == "csp":
        if accel is not None:
            raise WorkerError("DRIVE_DOCUMENT_INVALID", f"{name}: accelerationLimit is implemented for csv axes only")
        if ki == 0 and slew is None:
            return {"kind": "position", "attrs": {"kp": kp, "kv": kd}, "cells": 1, "integrated": False, "referenceLimitRad": None}
        attrs = {"kp": kp, "kv": kd, "ki": ki}
        if ki > 0:
            attrs["imax"] = limit / ki
        if slew is not None:
            attrs["slewmax"] = slew
        return {"kind": "pid", "attrs": attrs, "cells": 2, "integrated": False, "referenceLimitRad": None}
    if kd != 0 or slew is not None:
        raise WorkerError("DRIVE_DOCUMENT_INVALID", f"{name}: a velocity axis takes no kd and no slew")
    if ki == 0:
        return {"kind": "velocity", "attrs": {"kv": kp}, "cells": 1, "integrated": False, "referenceLimitRad": None}
    return {"kind": "pid", "attrs": {"kp": ki, "kv": kp, "ki": 0.0}, "cells": 2, "integrated": True, "referenceLimitRad": limit / ki}


def plan_actuators(model, control):
    """{axisId: {spec, group, index}} for the compilers: one actuator group (1..16) per axis so that each axis switches off on its own; group 0 stays the default of everything else."""
    by_id = {a["axisId"]: a for a in control["axes"]}
    if set(by_id) != {a["axisId"] for a in model["axes"]} or len(by_id) != len(control["axes"]):
        raise WorkerError("DRIVE_DOCUMENT_INVALID", "the control profile and the drive model do not name the same axes")
    return {a["axisId"]: {"spec": actuator_spec(a, by_id[a["axisId"]]), "group": i + 1, "index": i, "effortNm": a["torque"]["limitNm"] if a["torque"]["kind"] == "effort" else None} for i, a in enumerate(model["axes"])}


class DriveGroup:
    def __init__(self, model, control, dt_s, substeps, axis_limits):
        self.axes = model["axes"]
        by_id = {a["axisId"]: a for a in control["axes"]}
        if set(by_id) != {a["axisId"] for a in self.axes}:
            raise WorkerError("DRIVE_DOCUMENT_INVALID", "the control profile and the drive model do not name the same axes")
        self.n, self.dt, self.substeps = len(self.axes), dt_s, substeps
        self.ids = [a["axisId"] for a in self.axes]
        self.index = {axis_id: i for i, axis_id in enumerate(self.ids)}
        self.plan = plan_actuators(model, control)
        self.limits = [axis_limits[i] for i in self.ids]
        self.accel = [by_id[i]["accelerationLimit"] for i in self.ids]
        self.integrated = [self.plan[i]["spec"]["integrated"] for i in self.ids]
        self.ref_limit = [self.plan[i]["spec"]["referenceLimitRad"] for i in self.ids]
        self.has_cell1 = [self.plan[i]["spec"]["cells"] == 2 for i in self.ids]
        self.scale = [a["torque"]["scale"] if a["torque"]["kind"] == "envelope_ref" else 1.0 for a in self.axes]
        self.boot_enabled = [a["enableDelaySubsteps"] == 0 for a in self.axes]  # an ideal drive has no enable sequence: it starts enabled
        self.state = [ENABLED if b else DISABLED for b in self.boot_enabled]
        self.fault = [None] * self.n
        self.seq = [0] * self.n
        self.reset_prev = [False] * self.n
        self.stale = [0] * self.n
        self.enable_sub = [0] * self.n
        self.qs_sub = [0] * self.n
        self.qs_hold = [0.0] * self.n
        self.fe_count = [0] * self.n
        self.dropout = [False] * self.n
        self.loss_count = [0] * self.n
        self.tick = 0
        self.ready = False
        self.traced, self.samples = [], []   # bench only: the traced axes (indices) and this tick's samples of each

    # ---- initial conditions --------------------------------------------------------------------------------------------------------------------------
    def reset(self, true_pos):
        """Initial true positions of every axis (csp axes hold where they are, csv axes at rest). Call once, before the first begin_tick."""
        self.pos = [float(p) for p in true_pos]
        self.vel = [0.0] * self.n
        self.initial_target = [self.pos[i] if a["mode"] == "csp" else 0.0 for i, a in enumerate(self.axes)]
        self.prev_in = list(self.initial_target)   # the last accepted command target (the channel's input)
        self.cmd_in = list(self.initial_target)
        self.accepting = [False] * self.n
        self.channel = [deque([t] * (a["commandDelaySubsteps"] + 1), maxlen=a["commandDelaySubsteps"] + 1) for t, a in zip(self.initial_target, self.axes)]
        self.applied = list(self.initial_target)
        self.ramp = list(self.initial_target)      # the acceleration limiter's own last output (before the delay): the limit must not depend on the channel's delay
        self.pref = list(self.pos)
        self.fb_pos = [deque([quantize(p, a["encoder"]["countsPerRev"])] * (a["feedbackDelaySubsteps"] + 1), maxlen=a["feedbackDelaySubsteps"] + 1) for p, a in zip(self.pos, self.axes)]
        self.fb_hist = [deque([quantize(p, a["encoder"]["countsPerRev"])] * (a["encoder"]["velocityWindowSubsteps"] + 1), maxlen=a["encoder"]["velocityWindowSubsteps"] + 1) for p, a in zip(self.pos, self.axes)]
        self.torque = [0.0] * self.n
        self.saturated = [0] * self.n
        self.following = [None] * self.n
        self.sub = 0
        self.enable_req = [b for b in self.boot_enabled]
        self.quick_req = [False] * self.n
        self.ready = True

    def prime_commands(self):
        """The commands of the priming tick: every axis holds its start and asks to be enabled only when it boots enabled."""
        return [{"axisId": a["axisId"], "seq": 0, "mode": a["mode"], "target": self.initial_target[i], "enable": self.boot_enabled[i], "quickStop": False, "faultReset": False} for i, a in enumerate(self.axes)]

    # ---- one tick ----------------------------------------------------------------------------------------------------------------------------------
    def check(self, commands):
        """Pure: the commands of one tick by axis id, or a WorkerError with a DRIVE_* code. Changes nothing, so a session can refuse a tick before it spends anything (a one-shot disturbance,
        a perturbation) and begin_tick() cannot refuse a set that was checked against the same state."""
        by_id = {}
        for c in commands:
            i = self.index.get(c["axisId"])
            if i is None:
                raise WorkerError("DRIVE_AXIS_UNKNOWN", c["axisId"])
            if c["axisId"] in by_id:
                raise WorkerError("DRIVE_COMMAND_SEQ_INVALID", f"two commands for {c['axisId']}")
            if c["mode"] != self.axes[i]["mode"]:
                raise WorkerError("DRIVE_MODE_MISMATCH", f"{c['axisId']} is {self.axes[i]['mode']}")
            lo, hi = self.limits[i]
            t = c["target"]
            if not isinstance(t, (int, float)) or not math.isfinite(t) or not lo <= t <= hi:
                raise WorkerError("DRIVE_TARGET_OUT_OF_RANGE", f"{c['axisId']}: {t} is outside [{lo}, {hi}]")
            if c["seq"] < self.seq[i]:
                raise WorkerError("DRIVE_COMMAND_SEQ_INVALID", f"{c['axisId']}: seq {c['seq']} after {self.seq[i]}")
            by_id[c["axisId"]] = c
        for axis_id in self.ids:
            if axis_id not in by_id:
                raise WorkerError("DRIVE_COMMAND_REQUIRED", axis_id)
        return by_id

    def begin_tick(self, commands):
        """Admit the whole command set or refuse it (WorkerError with a DRIVE_* code) before any state changes."""
        by_id = self.check(commands)
        for i, a in enumerate(self.axes):
            c = by_id[a["axisId"]]
            fresh = c["seq"] > self.seq[i]
            self.seq[i] = c["seq"]
            edge = c["faultReset"] and not self.reset_prev[i]
            self.reset_prev[i] = c["faultReset"]
            self.enable_req[i], self.quick_req[i] = c["enable"], c["quickStop"]
            self.saturated[i] = 0
            if self.state[i] == FAULT:
                if edge and self._cause_cleared(i, fresh):
                    self.state[i], self.fault[i] = DISABLED, None
                    self.stale[i], self.fe_count[i], self.loss_count[i] = 0, 0, 0
            elif self.state[i] == ENABLED and a["watchdogTicks"] is not None:
                self.stale[i] = 0 if fresh else self.stale[i] + 1
                if self.stale[i] >= a["watchdogTicks"]:
                    self._trip(i, "COMMAND_TIMEOUT")
            else:
                self.stale[i] = 0
            # an axis that is not enabled acknowledges the command (seq above) and drops its target. Its command channel does not keep the target of before: it is brought to
            # neutral (a velocity axis at 0, a position axis where it is), so that enabling it again, after a disable or a fault reset, never replays an old target
            self.accepting[i] = self.state[i] == ENABLED
            if self.accepting[i]:
                self.prev_in[i] = self.cmd_in[i]
                self.cmd_in[i] = c["target"]
            else:
                self._neutral(i)
        self.sub = 0
        self.samples = [[] for _ in self.traced]

    def _neutral(self, i):
        n = self.pos[i] if self.axes[i]["mode"] == "csp" else 0.0
        self.prev_in[i] = self.cmd_in[i] = self.applied[i] = self.ramp[i] = n
        ch = self.channel[i]
        for k in range(len(ch)):
            ch[k] = n

    def _cause_cleared(self, i, fresh):
        cause = self.fault[i]
        if cause == "COMMAND_TIMEOUT":
            return fresh
        if cause == "FEEDBACK_LOSS":
            return not self.dropout[i]
        if cause == "OVERSPEED":
            return abs(self.vel[i]) < self.axes[i]["velocityLimitRadS"]
        return True

    def _trip(self, i, code):
        self.state[i], self.fault[i] = FAULT, code

    def set_feedback_valid(self, axis_id, valid):
        """A hook for fault injection (V08): the encoder of one axis stops (or resumes) delivering."""
        self.dropout[self.index[axis_id]] = not valid

    def trip(self, axis_id, code="EXTERNAL_TRIP"):
        """A hook for fault injection (V08): an outside trip of one axis."""
        self._trip(self.index[axis_id], code)

    # ---- one substep, before the caller's mj_step ----------------------------------------------------------------------------------------------------
    def substep(self, true_pos, true_vel):
        self.sub += 1
        s = self.sub
        ctrl, ctrl1, target, active, braked = [0.0] * self.n, [0.0] * self.n, [0.0] * self.n, [False] * self.n, [False] * self.n
        for i, a in enumerate(self.axes):
            pos, vel = float(true_pos[i]), float(true_vel[i])
            self.pos[i], self.vel[i] = pos, vel
            # 1. the command channel: linear interpolation inside the tick, then the substep delay
            x = self.prev_in[i] + (self.cmd_in[i] - self.prev_in[i]) * s / self.substeps if a["commandInterpolation"] == "linear" else self.cmd_in[i]
            if self.accel[i] is not None:
                limit = self.accel[i] * self.dt
                last = self.ramp[i]
                x = last + max(-limit, min(limit, x - last))
                self.ramp[i] = x
            ch = self.channel[i]
            ch.append(x)
            out = ch[0]
            # 2. the state machine
            st = self.state[i]
            want = self.enable_req[i] and not self.quick_req[i]
            if st == FAULT:
                pass                                   # a fault is latched: only a rising faultReset (begin_tick) leaves it
            elif st == QUICK_STOP:
                self.qs_sub[i] += 1
                if self.qs_sub[i] >= a["quickStopSubsteps"] or abs(vel) < QUICK_STOP_REST_RADS:
                    st = DISABLED
            elif st == ENABLED and self.quick_req[i]:
                st, self.qs_sub[i], self.qs_hold[i] = QUICK_STOP, 0, pos
            elif not want:
                st = DISABLED
            else:
                if st == DISABLED:
                    st, self.enable_sub[i] = READY, 0
                if st == READY:
                    self.enable_sub[i] += 1
                    if self.enable_sub[i] >= a["enableDelaySubsteps"]:
                        st = ENABLED
            self.state[i] = st
            if st == ENABLED:
                if abs(vel) > OVERSPEED_FACTOR * a["velocityLimitRadS"]:
                    self._trip(i, "OVERSPEED")
                elif a["mode"] == "csp" and a["followingError"] is not None:
                    err = out - pos
                    self.fe_count[i] = self.fe_count[i] + 1 if abs(err) > a["followingError"]["limitRad"] else 0
                    if self.fe_count[i] >= a["followingError"]["substeps"]:
                        self._trip(i, "FOLLOWING_ERROR")
                self.following[i] = out - pos if a["mode"] == "csp" and a["followingError"] is not None else None
            st = self.state[i]
            # 3. ctrl and the limits
            on = st in (ENABLED, QUICK_STOP)
            if st == ENABLED:
                self.applied[i] = out
                t = out
            elif st == QUICK_STOP:
                t = self.qs_hold[i] if a["mode"] == "csp" else 0.0
                self.applied[i] = t
            else:
                t = pos if a["mode"] == "csp" else 0.0
            if self.integrated[i]:
                if on:
                    ref = self.pref[i] + t * self.dt
                    cap = self.ref_limit[i]
                    self.pref[i] = max(pos - cap, min(pos + cap, ref))
                else:
                    self.pref[i] = pos
                ctrl[i], ctrl1[i] = self.pref[i], t
            else:
                ctrl[i] = t
            target[i], active[i], braked[i] = t, on, (not on) and a["onDisable"] == "brake"
        return {"ctrl": ctrl, "ctrl1": ctrl1, "target": target, "force_scale": self.scale, "active": active, "braked": braked}

    # ---- after the caller's mj_step ----------------------------------------------------------------------------------------------------------------------
    def sample(self, true_pos, true_vel, torque, saturated):
        """The feedback channel: quantise the true position, delay it, estimate the velocity over the window, count a loss of signal. Also keeps the per-tick telemetry."""
        for i, a in enumerate(self.axes):
            pos, vel = float(true_pos[i]), float(true_vel[i])
            self.pos[i], self.vel[i] = pos, vel
            self.torque[i] = float(torque[i])
            self.saturated[i] += 1 if saturated[i] else 0
            q = quantize(pos, a["encoder"]["countsPerRev"])
            fp = self.fb_pos[i]
            fp.append(q)
            self.fb_hist[i].append(fp[0])
            if self.dropout[i]:
                self.loss_count[i] += 1
                if a["feedbackLossSubsteps"] and self.loss_count[i] >= a["feedbackLossSubsteps"] and self.state[i] != FAULT:
                    self._trip(i, "FEEDBACK_LOSS")
            else:
                self.loss_count[i] = 0
        for k, i in enumerate(self.traced):
            csp, (position, velocity) = self.axes[i]["mode"] == "csp", self._measured(i)
            self.samples[k].append({"target": float(self.applied[i]), "actual": self.pos[i] if csp else self.vel[i], "feedback": position if csp else velocity,
                                    "torqueNm": self.torque[i], "saturated": bool(saturated[i])})

    def _measured(self, i):
        """(position, velocity) as the feedback channel reports them now; (None, None) while the encoder delivers nothing."""
        if self.dropout[i]:
            return None, None
        hist = self.fb_hist[i]
        return hist[-1], (hist[-1] - hist[0]) / (self.axes[i]["encoder"]["velocityWindowSubsteps"] * self.dt)

    def end_tick(self):
        """One DriveAxisSnapshot per axis, in model order. The measured fields come from the feedback channel; actual* are the engine's own state (evidence only)."""
        out = []
        for i, a in enumerate(self.axes):
            position, velocity = self._measured(i)
            out.append({"axisId": a["axisId"], "state": self.state[i], "fault": self.fault[i], "commandSeq": self.seq[i], "positionRad": position, "velocityRadS": velocity,
                        "torqueNm": self.torque[i], "tick": self.tick, "targetApplied": float(self.applied[i]), "actualPositionRad": self.pos[i], "actualVelocityRadS": self.vel[i],
                        "saturatedSubsteps": min(self.saturated[i], 100), "followingErrorRad": self.following[i]})
        self.tick += 1
        return out

    # ---- the bench trace (V06) -----------------------------------------------------------------------------------------------------------------------------
    def start_trace(self, axis_ids):
        """Trace these axes (ids of this group, checked by the caller) from the next begin_tick on: one sample per substep, taken in step 5 of the substep (contracts §3)."""
        self.traced = [self.index[a] for a in axis_ids]

    def trace(self):
        """This tick's DriveTrace of every traced axis, in the order they were asked for: `target` is the target the drive applied (after the command channel), `actual` the true
        position (csp) or velocity (csv), `feedback` the measured one (None while invalid), `torqueNm` and `saturated` the actuator's. The last sample is the end_tick state. Empty
        outside a bench."""
        return [{"axisId": self.ids[i], "dtS": float(self.dt), "samples": s} for i, s in zip(self.traced, self.samples)]
