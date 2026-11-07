"""Pure admission of an arm trajectory plan against its scene and the vendor model (no ROS, no hardware). A plan that cannot be proven valid is rejected;
the model is the pinned vendor import and never comes from the plan itself."""
import math


def _finite(*values):
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)


def validate_plan(plan, scene_digest, model=None):
    """Returns a sorted list of reason codes; empty means the plan may be staged."""
    if plan.get("sceneDigest") != scene_digest:
        return ["SCENE_STALE"]  # a plan made for another scene is never replayed against this one
    reasons = set()
    if plan.get("interface") == "hardware":
        reasons.add("HARDWARE_INTERFACE_FORBIDDEN")
    names, points = plan.get("jointNames"), plan.get("points")
    if not isinstance(names, list) or not names or not isinstance(points, list) or not points:
        reasons.add("PLAN_INVALID")
        return sorted(reasons | ({"MODEL_UNAVAILABLE"} if model is None else set()))
    if model is None:
        return sorted(reasons | {"MODEL_UNAVAILABLE"})
    if names != model["jointNames"]:
        reasons.add("JOINT_NAMES_MISMATCH")
        return sorted(reasons)
    if plan.get("tcp") != model.get("tcp"):
        reasons.add("TCP_MISMATCH")
    if (plan.get("collision") or {}).get("free") is not True:
        reasons.add("COLLISION_NOT_CLEARED")
    previous = None
    for point in points:
        t, q = point.get("t"), point.get("positions")
        if not _finite(t) or not isinstance(q, list) or len(q) != len(names) or not _finite(*q):
            reasons.add("PLAN_INVALID")
            continue
        for name, value in zip(names, q):
            lim = model["limits"][name]
            if value < lim["lower"] or value > lim["upper"]:
                reasons.add("JOINT_LIMIT_EXCEEDED")
        if previous is not None:
            dt = t - previous["t"]
            if dt <= 0:
                reasons.add("TRAJECTORY_TIME_INVALID")
            else:
                for name, a, b in zip(names, previous["positions"], q):
                    if abs(b - a) / dt > model["limits"][name]["velocity"] + 1e-12:
                        reasons.add("JOINT_VELOCITY_EXCEEDED")
        previous = point
    if _finite(points[-1].get("t", math.nan)) and points[-1]["t"] - points[0]["t"] > model.get("maxDurationS", math.inf):
        reasons.add("TRAJECTORY_TOO_LONG")
    return sorted(reasons)
