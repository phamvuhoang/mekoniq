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
