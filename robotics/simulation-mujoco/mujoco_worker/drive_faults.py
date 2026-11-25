"""The worker's half of the drive fault catalog (R4-A 7.1, contracts 4): admission of `faultInjections` against the same bounds the server validated (fixtures/fault-v1/fault-catalog-v1.json,
generated from the TypeScript catalog) and the effects on a DriveGroup. Pure: no mujoco import.

A fault acts on a drive parameter or channel, never on the plant: a force-limit scale (motor-weak, grip-weak), the encoder channel (encoder-dropout), the command queue (command-delay), the state
machine (drive-trip, drive-reset). Nothing here writes `qpos`/`qvel`. Every injection of a step is checked before any of them is applied, so a refused step leaves the group as it was; the receipt of
what was applied carries the tick, and the session adds the run identity.
"""
import json
import math
from collections import deque
from pathlib import Path

from .protocol import WorkerError

_FAULTS = None
EXTERNAL_TRIP = "EXTERNAL_TRIP"
MAX_INJECTIONS = 32
MAX_STOPS = 4


def catalog():
    global _FAULTS
    if _FAULTS is None:
        _FAULTS = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "fault-v1" / "fault-catalog-v1.json").read_text())["faults"]
    return _FAULTS


def _in_bound(value, bound):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not bound["min"] <= value <= bound["max"]:
        return False
    step = bound.get("multipleOf")
    return step is None or abs(value / step - round(value / step)) < 1e-9


def check(group, injections):
    """Admit a whole list of injections against the catalog and the group's open faults, in order, or raise a WorkerError (FAULT_*). Returns the plan: (injection, spec) pairs."""
    if not isinstance(injections, list) or len(injections) > MAX_INJECTIONS:
        raise WorkerError("FAULT_PARAM_INVALID", "faultInjections is a list of at most 32 entries")
    spec_of, opened, done, plan = catalog(), dict(group.fault_open), set(group.fault_done), []
    for i in injections:
        spec = spec_of.get(i["faultId"])
        if spec is None:
            raise WorkerError("FAULT_UNKNOWN", i["faultId"])
        if spec["appliedBy"] != "worker":
            raise WorkerError("FAULT_NOT_WORKER_APPLIED", i["faultId"])
        axis = i["targetId"]
        if axis not in group.index or axis.endswith("/gripper") != (spec["target"] == "gripper") or spec["target"] == "lidar":
            raise WorkerError("FAULT_TARGET_INVALID", f"{i['faultId']} on {axis}")
        bounds = {k: b for k, b in spec["params"].items() if k != "durationMs"}
        params = i["params"]
        if set(params) - set(bounds) or any(not _in_bound(v, bounds[k]) for k, v in params.items()):
            raise WorkerError("FAULT_PARAM_INVALID", f"{i['faultId']}: {sorted(params)}")
        entry = i["entryId"]
        if i["phase"] == "start":
            if any(k not in params for k, b in bounds.items() if b["required"]):
                raise WorkerError("FAULT_PARAM_INVALID", f"{i['faultId']}: a required parameter is missing")
            if entry in opened or entry in done:
                raise WorkerError("FAULT_STATE_INVALID", f"{entry} already started")
            if any(o["faultId"] == i["faultId"] and o["targetId"] == axis for o in opened.values()):
                raise WorkerError("FAULT_OVERLAP", f"{i['faultId']} is already open on {axis}")
            opened[entry] = i
        else:
            start = opened.pop(entry, None)
            if start is None or (start["faultId"], start["targetId"]) != (i["faultId"], axis):
                raise WorkerError("FAULT_STATE_INVALID", f"{entry} is not open")
            if start["params"] != params:
                raise WorkerError("FAULT_PARAM_INVALID", f"{entry} ends with other parameters than it started with")
            done.add(entry)
        plan.append((i, spec))
    return plan


def apply(group, plan, tick):
    """Apply an admitted plan at the start of the tick that will carry snapshot `tick`; returns one receipt per injection."""
    receipts = []
    for i, _ in plan:
        k, params, start = group.index[i["targetId"]], i["params"], i["phase"] == "start"
        fault = i["faultId"]
        if start:
            group.fault_open[i["entryId"]] = i
        else:
            group.fault_open.pop(i["entryId"])
            group.fault_done.add(i["entryId"])
        if fault == "encoder-dropout":
            group.dropout[k] = start
        elif fault in ("motor-weak", "grip-weak"):
            group.fault_scale[k] = params["torqueScale"] if start else 1.0
        elif fault == "drive-trip":
            if start and group.state[k] != "fault":
                group.trip(i["targetId"], EXTERNAL_TRIP)
        elif fault == "command-delay":
            _set_extra_delay(group, k, round(params["delayMs"] / (group.dt * 1000)) if start else 0)
        elif fault == "drive-reset":
            if start:
                group.forced_reset[k] = True
        receipts.append({"entryId": i["entryId"], "faultId": fault, "targetId": i["targetId"], "params": dict(params), "phase": i["phase"], "appliedTick": tick})
    return receipts


def _set_extra_delay(group, k, extra):
    """The command queue grows by `extra` substeps (the oldest value is held for that long, so the output does not jump) or goes back to the model's own length (the output skips ahead)."""
    ch, base = group.channel[k], group.axes[k]["commandDelaySubsteps"] + 1
    current = len(ch)
    if extra > current - base:
        group.channel[k] = deque([ch[0]] * (extra - (current - base)) + list(ch), maxlen=base + extra)
    elif extra < current - base:
        group.channel[k] = deque(list(ch)[-(base + extra):], maxlen=base + extra)


def check_stops(group, injections):
    """Admit this step's `stopInjections` (R5, contracts 4): at most four, each an emergency stop of known, distinct axes of this group. Returns the list or raises a WorkerError (STOP_*); nothing is changed."""
    if not isinstance(injections, list) or len(injections) > MAX_STOPS:
        raise WorkerError("STOP_INJECTION_INVALID", "stopInjections is a list of at most 4 entries")
    seen = set()
    for i in injections:
        axes = i.get("axes")
        if i.get("function") != "emergency" or not isinstance(i.get("entryId"), str) or i["entryId"] in seen or not isinstance(axes, list) or not axes or len(set(axes)) != len(axes):
            raise WorkerError("STOP_INJECTION_INVALID", f"{i.get('entryId')}: an emergency stop names its axes once each")
        seen.add(i["entryId"])
        for axis in axes:
            if axis not in group.index:
                raise WorkerError("STOP_AXIS_UNKNOWN", f"{i['entryId']}: {axis}")
    return list(injections)


def apply_stop(group, injections, tick):
    """The emergency stop of the virtual safety chain: trip every named axis with EXTERNAL_TRIP at the start of the tick, before the command channel and before this tick's commands are processed, so a
    motion command of the same tick finds the axis in `fault` and is dropped. An axis that is already latched keeps its own fault. Returns one receipt per injection (the session adds the run identity)."""
    receipts = []
    for i in injections:
        for axis in i["axes"]:
            k = group.index[axis]
            if group.state[k] != "fault":
                group.trip(axis, EXTERNAL_TRIP)
            group.stop_hold[k] = True      # a faultReset edge of this very tick cannot undo the stop
        receipts.append({"entryId": i["entryId"], "function": "emergency", "appliedBy": "worker", "appliedTick": tick})
    return receipts
