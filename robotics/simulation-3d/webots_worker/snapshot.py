"""Sim3DSnapshotV1 pieces from what the Webots controllers report. Plain JSON-safe numbers only: no Webots object ever leaves the controller processes.

Webots lidar: ray i points at pi - (i + 1/2) * delta (clockwise from the -x axis, measured on the engine against flat walls). LidarScanV1 is counter-clockwise from
angleMinRad, so the array is reversed and angleMinRad = -fov/2 + delta/2.
"""
import math

TICK_NS = 20_000_000
RANGE_TOL = 1e-6
CONTACT_MARGIN_M = 0.03  # a body contact point this close to a solid's outline belongs to that solid


class SnapshotError(Exception):
    def __init__(self, code, detail):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def wrap_pi(a):
    a = math.fmod(a + math.pi, 2 * math.pi)
    return (a + 2 * math.pi if a <= 0 else a) - math.pi


def wheel_speeds(v, w, radius, separation):
    """Body velocity [v, w] -> (left, right) wheel angular speeds for a differential drive."""
    return (v - w * separation / 2) / radius, (v + w * separation / 2) / radius


def beam(value, range_min, range_max):
    """(range or None, state). +inf = no return, -inf or a value under the minimum = below_min, NaN = invalid; a finite value past the maximum means the engine contradicted itself."""
    v = float(value)
    if math.isnan(v):
        return None, "invalid"
    if math.isinf(v):
        return None, "no_return" if v > 0 else "below_min"
    if v < range_min - RANGE_TOL:
        return None, "below_min"
    if v > range_max + RANGE_TOL:
        raise SnapshotError("SENSOR_INCONSISTENT", f"finite range {v} beyond the maximum {range_max}")
    return v, "hit"


def lidar_scan(webots_ranges, *, sensor_id, frame_id, tick, range_min, range_max, fov):
    n = len(webots_ranges)
    delta = fov / n
    ranges, states = [], []
    for value in reversed(webots_ranges):
        r, s = beam(value, range_min, range_max)
        ranges.append(r)
        states.append(s)
    return {"sensorId": sensor_id, "frameId": frame_id, "tick": tick, "simTimeNs": str(tick * TICK_NS), "angleMinRad": -fov / 2 + delta / 2, "angleIncrementRad": delta,
            "rangeMinM": float(range_min), "rangeMaxM": float(range_max), "rangesM": ranges, "states": states}


def base_state(position, orientation, velocity):
    """Position [x y z], row-major rotation (9) and velocity [vx vy vz wx wy wz] of the base link in the map frame. Anything not finite is PLANT_UNSTABLE."""
    values = [*position, *orientation, *velocity]
    if len(position) != 3 or len(orientation) != 9 or len(velocity) != 6 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
        raise SnapshotError("PLANT_UNSTABLE", "the base pose or velocity is not finite")
    r = orientation
    return {"x": position[0], "y": position[1], "z": position[2], "yaw": math.atan2(r[3], r[0]), "pitch": -math.asin(max(-1.0, min(1.0, r[6]))), "roll": math.atan2(r[7], r[8]),
            "vx": velocity[0], "vy": velocity[1], "wz": velocity[5]}


def drive_pose(base, drive_xyz, drive_yaw):
    """[x, y, yaw] of the drive frame in the map (planar: the drive frame sits in the base's horizontal plane)."""
    c, s = math.cos(base["yaw"]), math.sin(base["yaw"])
    return [base["x"] + c * drive_xyz[0] - s * drive_xyz[1], base["y"] + s * drive_xyz[0] + c * drive_xyz[1], wrap_pi(base["yaw"] + drive_yaw)]


def body_velocity(base):
    """[v, w]: speed along the heading and yaw rate."""
    return base["vx"] * math.cos(base["yaw"]) + base["vy"] * math.sin(base["yaw"]), base["wz"]


def _distance_to_polygon(p, poly):
    inside = False
    best = math.inf
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > p[1]) != (y2 > p[1]) and p[0] < (x2 - x1) * (p[1] - y1) / (y2 - y1) + x1:
            inside = not inside
        dx, dy = x2 - x1, y2 - y1
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(p[0] - (x1 + t * dx), p[1] - (y1 + t * dy)))
    return 0.0 if inside else best


def collision_ids(contacts, body_solids, obstacles, robots, self_id, margin=CONTACT_MARGIN_M):
    """Scene ids that the robot's body touches. `contacts` are [{solid, point}] from the supervisor; only points of `body_solids` count: a wheel or caster on the floor is how the
    robot stands, never a collision. Each point is named by the nearest solid outline within `margin` (obstacle id, or another robot's robotId); a point nothing explains is
    `engine:unattributed`, still a contact."""
    candidates = {**obstacles, **{rid: poly for rid, poly in robots.items() if rid != self_id}}
    found = set()
    for c in contacts:
        if c["solid"] not in body_solids:
            continue
        p = (c["point"][0], c["point"][1])
        near = min(((_distance_to_polygon(p, poly), cid) for cid, poly in sorted(candidates.items())), default=(math.inf, None))
        found.add(near[1] if near[0] <= margin else "engine:unattributed")
    return sorted(found)


def robot_state(*, robot_id, base, drive_xyz, drive_yaw, wheels, scans, collisions):
    x, y, yaw = drive_pose(base, drive_xyz, drive_yaw)
    v, w = body_velocity(base)
    return {"robotId": robot_id, "poseDriveMap": [x, y, yaw], "bodyVelocity": [v, w], "scans": scans, "collisionIds": collisions,
            "pose3d": {"z": base["z"], "roll": base["roll"], "pitch": base["pitch"]}, "wheels": {"leftRadS": wheels[0], "rightRadS": wheels[1]}}


def arm_state(*, arm_id, positions, velocities, collisions, lower, upper, margin=0.05):
    """The arm entry of a Sim3DSnapshotV1. A joint angle or speed that is not finite, or a joint more than `margin` rad outside its limits, is PLANT_UNSTABLE: the engine has lost the arm."""
    if len(positions) != len(lower) or len(velocities) != len(lower) or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in [*positions, *velocities]):
        raise SnapshotError("PLANT_UNSTABLE", "a joint position or velocity is not finite")
    for i, (q, lo, hi) in enumerate(zip(positions, lower, upper)):
        if q < lo - margin or q > hi + margin:
            raise SnapshotError("PLANT_UNSTABLE", f"joint {i + 1} is at {q}, outside [{lo}, {hi}] by more than {margin} rad")
    return {"armId": arm_id, "positionsRad": [float(q) for q in positions], "velocitiesRadS": [float(v) for v in velocities], "collisionIds": sorted(collisions)}


def _matrix(q):
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w)
    x, y, z, w = x / n, y / n, z / n, w / n
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)), (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)), (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def arm_collision_ids(contacts, statics, base, margin=CONTACT_MARGIN_M):
    """What the arm touched, from the world-frame contact points of its links. A point is named by the nearest static obstacle (given in the arm base frame, `base` is the arm's
    (position, quaternion) in the world) or by "floor" when it lies within `margin` of it; a point nothing explains (including an arm link against another link) is
    `engine:unattributed`, still a contact. Webots reports the tracked solid of a contact, never the one it touched, so this is the only way to name the other side."""
    (bx, by, bz), q = base
    r = _matrix(q)
    found = set()
    for c in contacts:
        d = [c["point"][0] - bx, c["point"][1] - by, c["point"][2] - bz]
        p = [r[0][i] * d[0] + r[1][i] * d[1] + r[2][i] * d[2] for i in range(3)]  # R^T (p - t): the point in the arm base frame
        best = (max(c["point"][2], 0.0), "floor")
        for o in statics:
            if o["kind"] == "sphere":
                dist = math.dist(p, o["center"]) - o["radiusM"]
            else:
                dist = math.sqrt(sum(max(lo - v, 0.0, v - hi) ** 2 for v, lo, hi in zip(p, o["min"], o["max"])))
            best = min(best, (max(dist, 0.0), o["id"]))
        found.add(best[1] if best[0] <= margin else "engine:unattributed")
    return sorted(found)
