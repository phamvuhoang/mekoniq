"""Sim3DSnapshotV1 pieces from an engine reading. Pure: no MuJoCo import, so the session tests run it against an engine double.

A reading is {time, arm:{positions, velocities}, gripper:{positions, velocities, openingM}, props:{propId:{position, quaternionXyzw, speed}} (cups in the scene only),
contacts:[(tag, tag)]}. A contact tag names one side: ("link", linkId) an arm link, ("palm",), ("pad", k), ("prop", propId), ("static", id), ("support", id), ("floor",),
("gripper",) another gripper geom.
"""
import math

from .protocol import WorkerError

TICK_NS = 20_000_000
LIMIT_MARGIN_RAD = 0.05  # a joint this far past its limit means the engine has lost the arm
RESTING_SPEED_MPS = 0.01


def _finite(values):
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)


def check_stable(reading, limits):
    """PLANT_UNSTABLE (fatal) when an arm or gripper joint, or a cup in the scene, is not finite, or an arm joint is past its limit by more than the margin."""
    arm, grip = reading["arm"], reading["gripper"]
    if len(arm["positions"]) != len(limits) or len(arm["velocities"]) != len(limits) or not _finite([*arm["positions"], *arm["velocities"], *grip["positions"], *grip["velocities"], grip["openingM"]]):
        raise WorkerError("PLANT_UNSTABLE", "an arm or gripper joint position or velocity is not finite", fatal=True)
    for i, (q, (lo, hi)) in enumerate(zip(arm["positions"], limits)):
        if q < lo - LIMIT_MARGIN_RAD or q > hi + LIMIT_MARGIN_RAD:
            raise WorkerError("PLANT_UNSTABLE", f"joint {i + 1} is at {q}, outside [{lo}, {hi}] by more than {LIMIT_MARGIN_RAD} rad", fatal=True)
    for pid, p in reading["props"].items():
        if not _finite([*p["position"], *p["quaternionXyzw"], p["speed"]]):
            raise WorkerError("PLANT_UNSTABLE", f"cup {pid} is not finite", fatal=True)


def held_props(contacts):
    """Cups in contact with each of the two finger pads."""
    pads = {}
    for a, b in contacts:
        for x, y in ((a, b), (b, a)):
            if x[0] == "pad" and y[0] == "prop":
                pads.setdefault(y[1], set()).add(x[1])
    return sorted(pid for pid, touched in pads.items() if len(touched) >= 2)


def resting_on(contacts, props):
    """propId -> the support it touches while slower than RESTING_SPEED_MPS, else None."""
    out = {pid: None for pid in props}
    for a, b in contacts:
        for x, y in ((a, b), (b, a)):
            if x[0] == "prop" and y[0] == "support" and x[1] in props and props[x[1]]["speed"] < RESTING_SPEED_MPS:
                out[x[1]] = y[1]
    return out


def collision_ids(contacts, held, allowed):
    """What the arm touched: an arm link, the palm, a pad or a held cup against a static (its id), a support (its id, unless the gripper or a held cup touches an allowed
    support), the floor ("floor"); two arm links ("self", adjacent links are excluded by the model); a cup that is not held against an arm link or the palm (its prop id).
    Never: a pad on a cup, a pad on a pad, a cup on a support or the floor."""
    def side(tag):
        if tag[0] in ("link", "palm"):
            return "arm"
        if tag[0] in ("pad", "gripper"):
            return "gripper"
        if tag[0] == "prop" and tag[1] in held:
            return "held_prop"
        return None

    found = set()
    for a, b in contacts:
        for x, y in ((a, b), (b, a)):
            s = side(x)
            if s is None:
                continue
            kind = y[0]
            if kind == "static":
                found.add(y[1])
            elif kind == "support":
                who = "held_prop" if s == "held_prop" else "gripper" if x[0] in ("palm", "pad", "gripper") else "arm"  # allowedContacts name only gripper and held_prop
                if (who, y[1]) not in allowed:
                    found.add(y[1])
            elif kind == "floor":
                found.add("floor")
            elif kind in ("link", "palm") and s == "arm":
                found.add("self")
            elif kind == "prop" and s == "arm" and y[1] not in held:
                found.add(y[1])
    return sorted(found)


def build(*, run_id, boot_id, seq, tick, scene, reading, limits):
    """The snapshot of one tick; raises PLANT_UNSTABLE first."""
    check_stable(reading, limits)
    contacts = [tuple(map(tuple, c)) for c in reading["contacts"]]
    allowed = {(c["a"], c["b"]) for c in scene["allowedContacts"]}
    held = held_props(contacts)
    resting = resting_on(contacts, reading["props"])
    grip = reading["gripper"]
    arm = {"armId": scene["arm"]["armId"], "positionsRad": [float(q) for q in reading["arm"]["positions"]], "velocitiesRadS": [float(v) for v in reading["arm"]["velocities"]],
           "collisionIds": collision_ids(contacts, set(held), allowed), "gripper": {"openingM": max(0.0, float(grip["openingM"])), "heldPropIds": held}}
    props = [{"propId": pid, "position": [float(v) for v in p["position"]], "quaternionXyzw": [float(v) for v in p["quaternionXyzw"]], "restingOn": resting[pid]}
             for pid, p in sorted(reading["props"].items())]
    return {"schemaVersion": 1, "runId": run_id, "bootId": boot_id, "tick": tick, "simTimeNs": str(tick * TICK_NS), "seq": str(seq), "sceneDigest": scene["sceneDigest"],
            "robots": [], "arms": [arm], "props": props}
