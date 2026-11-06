"""ARM03 geometric swept-path checker (plan 02 owns it; plan 03 A05 consumes the report). A faithful Python port of the Lab's capsule-sweep
checker: modified-DH forward kinematics, capsule bodies for links/gripper/held cup, exact segment-vs-sphere/box distances, adaptive
subdivision with a conservative movement bound (uncertain intervals never pass), phase-scoped allowed contacts. Illustrative geometry;
a report names engine, model, geometry, world, pairs and intervals so plan 03 can cite it. No dynamics, no forces."""
import hashlib
import math

import rfc8785

ENGINE = "capsule-sweep-py-v1"
INCH, DEG = 0.0254, math.pi / 180
_H = -math.pi / 2
# Illustrative PUMA 560-style table in SI (same numbers and conversions as lab-runtime arm-kinematics.ts; revision = its pinned hash).
PUMA560_SI = {
    "id": "puma560-reference", "revision": "bd57344faecee29df2d50b8e8535de6936b05da3778eadbf46ad0e5d626650f3", "convention": "modified_dh",
    "jointNames": ["J1", "J2", "J3", "J4", "J5", "J6"],
    "links": [{"alpha": a, "a": l * INCH, "d": d * INCH, "thetaOffset": 0} for a, l, d in ((0, 0, 0), (_H, 0, 0), (0, 17, 5.9), (_H, -0.8, 17), (-_H, 0, 0), (_H, 0, 0))],
    "limits": [{"min": lo * DEG, "max": hi * DEG, "maxVelocity": 120 * DEG} for lo, hi in ((-160, 160), (-225, 45), (-45, 225), (-110, 170), (-100, 100), (-266, 266))],
    "toolM": [0, 0, 0],
}
DEFAULT_ARM_GEOMETRY = {"linkRadiusM": 0.025, "gripperRadiusM": 0.02, "gripperLengthM": 0.025, "cupRadiusM": 0.035, "cupHeightM": 0.09, "provenance": "illustrative"}
MAX_DEPTH, MAX_EVALUATIONS = 24, 32768


class CheckerUnavailable(RuntimeError):
    """The checker cannot run (model/trace missing): ARM03 is not_run, never a pass."""


# ---- quaternion [x, y, z, w] ----
def _qmul(a, b):
    return (a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2])


def _qrotate(q, v):
    t = (2 * (q[1] * v[2] - q[2] * v[1]), 2 * (q[2] * v[0] - q[0] * v[2]), 2 * (q[0] * v[1] - q[1] * v[0]))
    return (v[0] + q[3] * t[0] + q[1] * t[2] - q[2] * t[1], v[1] + q[3] * t[1] + q[2] * t[0] - q[0] * t[2], v[2] + q[3] * t[2] + q[0] * t[1] - q[1] * t[0])


def _compose(a, b):
    p = _qrotate(a[1], b[0])
    q = _qmul(a[1], b[1])
    n = math.sqrt(sum(c * c for c in q))
    return ((a[0][0] + p[0], a[0][1] + p[1], a[0][2] + p[2]), tuple(c / n for c in q))


def forward_kinematics(model, q):
    """T_i = Rx(alpha) Tx(a) Rz(theta + offset) Tz(d), accumulated from the base; frames[i] is link_{i+1}, the last is the flange."""
    links = model["links"]
    if not isinstance(q, (list, tuple)) or len(q) != len(links):
        raise ValueError(f"JOINT_COUNT: expected {len(links)}")
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in q):
        raise ValueError("JOINT_NOT_FINITE")
    T, frames = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)), []
    for link, theta in zip(links, q):
        a, al, d = link["a"], link["alpha"], link["d"]
        for step in (((0.0, 0.0, 0.0), (math.sin(al / 2), 0.0, 0.0, math.cos(al / 2))), ((a, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
                     ((0.0, 0.0, 0.0), (0.0, 0.0, math.sin((theta + link["thetaOffset"]) / 2), math.cos((theta + link["thetaOffset"]) / 2))), ((0.0, 0.0, d), (0.0, 0.0, 0.0, 1.0))):
            T = _compose(T, step)
        frames.append(T)
    flange = frames[-1]
    tcp = _compose(flange, (tuple(model.get("toolM", [0, 0, 0])), (0.0, 0.0, 0.0, 1.0)))
    return {"frames": [f[0] for f in frames], "flange": flange[0], "tcp": tcp[0], "tcpQuaternion": tcp[1], "modelRevision": model["revision"]}


# ---- distances ----
def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _at(a, d, t):
    return (a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t)


def _clamp(n):
    return min(1.0, max(0.0, n))


def _norm(v):
    return math.sqrt(_dot(v, v))


def segment_distance(p, q, r, s):
    u, v, w = _sub(q, p), _sub(s, r), _sub(p, r)
    a, b, c, d, e = _dot(u, u), _dot(u, v), _dot(v, v), _dot(u, w), _dot(v, w)
    x = y = 0.0
    if a < 1e-20:
        y = _clamp(e / c) if c > 1e-20 else 0.0
    elif c < 1e-20:
        x = _clamp(-d / a)
    else:
        den = a * c - b * b
        x = _clamp((b * e - c * d) / den) if den > 1e-20 else 0.0
        y = (b * x + e) / c
        if y < 0:
            y, x = 0.0, _clamp(-d / a)
        elif y > 1:
            y, x = 1.0, _clamp((b - d) / a)
    return _norm(_sub(_at(p, u, x), _at(r, v, y)))


def box_distance(a, b, lo, hi):
    d = _sub(b, a)
    breaks = [0.0, 1.0]
    for k in range(3):
        if d[k] != 0:
            for edge in (lo[k], hi[k]):
                t = (edge - a[k]) / d[k]
                if 0 < t < 1:
                    breaks.append(t)
    breaks.sort()

    def distance(t):
        p = _at(a, d, t)
        return math.sqrt(sum(max(lo[k] - p[k], 0.0, p[k] - hi[k]) ** 2 for k in range(3)))
    best = min(distance(t) for t in breaks)
    for i in range(len(breaks) - 1):
        lo_t, hi_t = breaks[i], breaks[i + 1]
        mid = (lo_t + hi_t) / 2
        num = den = 0.0
        for k in range(3):
            p = a[k] + d[k] * mid
            bound = lo[k] if p < lo[k] else hi[k] if p > hi[k] else None
            if bound is not None:
                num += d[k] * (a[k] - bound)
                den += d[k] ** 2
        if den > 0:
            best = min(best, distance(max(lo_t, min(hi_t, -num / den))))
    return best


def _bodies(model, q, geometry, held_cup):
    fk = forward_kinematics(model, q)
    points = [(0.0, 0.0, 0.0)] + list(fk["frames"])
    out = []
    for i in range(1, len(points)):
        if _norm(_sub(points[i], points[i - 1])) > 1e-9:
            out.append({"id": f"link-{i}", "a": points[i - 1], "b": points[i], "radius": geometry["linkRadiusM"], "link": len(out)})
    link = len(out)
    tcp, tq = fk["tcp"], fk["tcpQuaternion"]
    tip = tuple(tcp[k] + v for k, v in enumerate(_qrotate(tq, (0, 0, geometry["gripperLengthM"]))))
    out.append({"id": "gripper", "a": tcp, "b": tip, "radius": geometry["gripperRadiusM"], "link": link})
    if held_cup:
        top = tuple(tcp[k] + v for k, v in enumerate(_qrotate(tq, (0, 0, geometry["gripperLengthM"] + geometry["cupHeightM"]))))
        out.append({"id": "held-cup", "a": tip, "b": top, "radius": geometry["cupRadiusM"], "link": link})
    return out


def _clearance(capsules, world, allowed):
    best, pair = math.inf, None
    for i, c in enumerate(capsules):
        for o in world:
            if (c["id"], o["id"]) in allowed:
                continue
            d = (segment_distance(c["a"], c["b"], o["center"], o["center"]) - o["radiusM"]) if o["kind"] == "sphere" else box_distance(c["a"], c["b"], o["min"], o["max"])
            d -= c["radius"]
            if d < best:
                best, pair = d, [c["id"], o["id"]]
        for b in capsules[i + 1:]:
            if abs(c["link"] - b["link"]) <= 1 or (c["id"], b["id"]) in allowed:
                continue
            d = segment_distance(c["a"], c["b"], b["a"], b["b"]) - c["radius"] - b["radius"]
            if d < best:
                best, pair = d, [c["id"], b["id"]]
    return best, pair


def geometry_revision(geometry, world):
    return hashlib.sha256(rfc8785.dumps({"geometry": geometry, "world": world})).hexdigest()


def _vec(v):
    return isinstance(v, (list, tuple)) and len(v) == 3 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)


def _check_world(world):
    for o in world:
        ok = isinstance(o, dict) and o.get("id") and ((o.get("kind") == "sphere" and _vec(o.get("center")) and isinstance(o.get("radiusM"), (int, float)) and o["radiusM"] > 0)
                                                      or (o.get("kind") == "box" and _vec(o.get("min")) and _vec(o.get("max")) and all(o["min"][k] < o["max"][k] for k in range(3))))
        if not ok:
            raise ValueError("COLLISION_WORLD_INVALID")


def _sweep(model, q0, q1, world, geometry, tolerance_m, held_cup, allowed):
    reach = sum(abs(l["a"]) + abs(l["d"]) for l in model["links"]) + _norm(tuple(model.get("toolM", [0, 0, 0]))) + geometry["gripperLengthM"] + geometry["cupHeightM"]
    total = reach * sum(abs(b - a) for a, b in zip(q0, q1))
    state = {"ok": True, "evaluations": 0, "reason": None, "pair": None, "fraction": None, "clearanceM": None}

    def evaluate(f):
        state["evaluations"] += 1
        return _clearance(_bodies(model, [a + (b - a) * f for a, b in zip(q0, q1)], geometry, held_cup), world, allowed)

    def fail(f, c, reason):
        state.update(ok=False, reason=reason, pair=c[1], fraction=f, clearanceM=c[0])
    for t in (0.0, 1.0):
        c = evaluate(t)
        if c[0] <= 0:
            fail(t, c, "COLLISION")
            return state

    def visit(lo, hi, depth):
        if not state["ok"]:
            return
        mid = (lo + hi) / 2
        c = evaluate(mid)
        bound = total * (hi - lo) / 2
        if c[0] <= 0:
            fail(mid, c, "COLLISION")
            return
        if c[0] > 2 * bound:
            return
        if bound <= tolerance_m or depth >= MAX_DEPTH or state["evaluations"] >= MAX_EVALUATIONS:
            fail(mid, c, "SWEEP_UNCERTAIN")
            return
        visit(lo, mid, depth + 1)
        visit(mid, hi, depth + 1)
    visit(0.0, 1.0, 0)
    return state


ALLOWED_PHASES = ("grasp", "release")
TOUCHING_BODIES = ("gripper", "held-cup")


def _check_allowed_contacts(allowed_contacts, world_revision):
    """A window may only excuse the gripper or the held cup, during a grasp/release phase, declared for THIS world revision, over a sane span."""
    for ac in allowed_contacts:
        pair = ac.get("pair") if isinstance(ac, dict) else None
        if not isinstance(pair, list) or len(pair) != 2 or not any(p in TOUCHING_BODIES for p in pair) or pair[0] == pair[1]:
            raise ValueError(f"ALLOWED_CONTACT_PAIR: {pair}")
        if ac.get("phase") not in ALLOWED_PHASES:
            raise ValueError(f"ALLOWED_CONTACT_PHASE: {ac.get('phase')}")
        if not isinstance(world_revision, dict) or ac.get("revision") != world_revision.get("revision"):
            raise ValueError(f"ALLOWED_CONTACT_REVISION: {ac.get('revision')}")
        if not isinstance(ac.get("fromTick"), int) or not isinstance(ac.get("toTick"), int) or ac["fromTick"] > ac["toTick"]:
            raise ValueError("ALLOWED_CONTACT_SPAN")


def check_swept_path(asset_revision, world_revision, joint_trace, attachments, *, world, model, geometry=None, tolerance_m=0.0005, allowed_contacts=()):
    """-> CollisionReport. joint_trace: [{tick, q}] with consecutive ticks; attachments: [{cupId, fromTick, toTick}] (cup held on the gripper);
    allowed_contacts: [{pair:[a,b], phase, fromTick, toTick, revision}] applied only to intervals inside their tick span."""
    if not model:
        raise CheckerUnavailable("MODEL_MISSING")
    geometry = geometry or DEFAULT_ARM_GEOMETRY
    if not (0 < tolerance_m <= 0.01) or any(not isinstance(v, (int, float)) or v <= 0 for k, v in geometry.items() if k != "provenance"):
        raise ValueError("COLLISION_GEOMETRY_INVALID")
    _check_world(world)
    ticks = [s.get("tick") for s in joint_trace]
    if not joint_trace or any(not isinstance(t, int) for t in ticks) or any(b != a + 1 for a, b in zip(ticks, ticks[1:])):
        raise CheckerUnavailable("TRACE_INCOMPLETE")
    for s in joint_trace:
        forward_kinematics(model, s["q"])
    _check_allowed_contacts(allowed_contacts, world_revision)
    pairs = [(joint_trace[i], joint_trace[i + 1]) for i in range(len(joint_trace) - 1)] or [(joint_trace[0], joint_trace[0])]
    intervals, applied = [], 0
    for a, b in pairs:
        held = any(att["fromTick"] <= a["tick"] <= att["toTick"] or att["fromTick"] <= b["tick"] <= att["toTick"] for att in attachments)
        allowed = set()
        for ac in allowed_contacts:
            if ac["fromTick"] <= a["tick"] and b["tick"] <= ac["toTick"]:
                allowed.add(tuple(ac["pair"]))
                allowed.add(tuple(reversed(ac["pair"])))
                applied += 1
        s = _sweep(model, list(a["q"]), list(b["q"]), world, geometry, tolerance_m, held, allowed)
        intervals.append({"fromTick": a["tick"], "toTick": b["tick"], "heldCup": held, **s})
    colliding = [{"pair": i["pair"], "reason": i["reason"], "fraction": i["fraction"], "clearanceM": i["clearanceM"], "interval": {"fromTick": i["fromTick"], "toTick": i["toTick"]}} for i in intervals if not i["ok"]]
    return {"engine": ENGINE, "ok": not colliding, "modelRevision": model["revision"], "geometryRevision": geometry_revision(geometry, world), "worldRevision": world_revision,
            "assetRef": asset_revision, "toleranceM": tolerance_m, "world": list(world), "attachments": list(attachments), "allowedContacts": list(allowed_contacts),
            "trace": {"samples": len(joint_trace), "fromTick": ticks[0], "toTick": ticks[-1]},
            "method": {"kind": "adaptive-subdivision", "bound": "reach * sum(|dq|) per interval, conservative", "toleranceM": tolerance_m, "maxDepth": MAX_DEPTH},
            "intervals": intervals, "colliding": colliding,
            "coverage": {"intervals": len(intervals), "evaluations": sum(i["evaluations"] for i in intervals), "uncertain": sum(1 for i in intervals if i["reason"] == "SWEEP_UNCERTAIN"), "allowedContactsApplied": applied}}
