"""IRSimSnapshotV1 from the engine's message dataclasses. Plain JSON-safe copies only: no numpy, no engine object ever leaves this module."""
import math

TICK_NS = 20_000_000


class SnapshotError(Exception):
    def __init__(self, code, detail):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def wrap_pi(a):
    a = math.fmod(a + math.pi, 2 * math.pi)
    return (a + 2 * math.pi if a <= 0 else a) - math.pi


def beam(value, range_min, range_max):
    """(range or None, state). get_msg(use_inf=True): +inf = no return, -inf = below min, NaN = invalid. A finite value outside [min, max] means the engine contradicted itself."""
    v = float(value)
    if math.isnan(v):
        return None, "invalid"
    if math.isinf(v):
        return None, "no_return" if v > 0 else "below_min"
    if v < range_min - 1e-6 or v > range_max + 1e-6:
        raise SnapshotError("SENSOR_INCONSISTENT", f"finite range {v} outside [{range_min}, {range_max}]")
    return v, "hit"


def lidar_scan(scan, sensor_id, tick):
    ranges, states = [], []
    for value in scan.ranges:
        r, s = beam(value, scan.range_min, scan.range_max)
        ranges.append(r)
        states.append(s)
    return {"sensorId": sensor_id, "frameId": scan.header.frame_id, "tick": tick, "simTimeNs": str(tick * TICK_NS), "angleMinRad": float(scan.angle_min), "angleIncrementRad": float(scan.angle_increment),
            "rangeMinM": float(scan.range_min), "rangeMaxM": float(scan.range_max), "rangesM": ranges, "states": states}


def build_snapshot(env, *, run_id, boot_id, tick, seq, scene_digest, names, sensor_ids, solid_ids):
    """`names` robotId -> engine name; `sensor_ids` robotId -> [sensorId]; `solid_ids` engine object id -> scene id (obstacles and boundaries)."""
    msg = env.get_msg(use_inf=True)
    by_name = {r.name: r for r in env.robot_list}
    states = {r.name: r for r in msg.robots}
    robots = []
    for robot_id in sorted(names):
        name = names[robot_id]
        obj, state = by_name[name], states[name]
        x, y, yaw = (float(v) for v in obj.state[:3, 0])
        velocity = [float(v) for v in obj.velocity[:2, 0]]
        ids = sensor_ids.get(robot_id, [])
        if len(state.sensors) != len(ids):
            raise SnapshotError("SENSOR_INCONSISTENT", f"{name}: engine reports {len(state.sensors)} sensors, scene declares {len(ids)}")
        engine_to_scene = {obj.id: robot_id, **{o.id: solid_ids[o.id] for o in env.obstacle_list if o.id in solid_ids}}
        collisions = sorted({str(engine_to_scene.get(c, f"engine:{c}")) for c in state.collision_ids})
        robots.append({"robotId": robot_id, "poseDriveMap": [x, y, wrap_pi(yaw)], "bodyVelocity": velocity, "scans": [lidar_scan(s, sid, tick) for s, sid in zip(state.sensors, ids)], "collisionIds": collisions})
    for r in robots:
        for v in (*r["poseDriveMap"], *r["bodyVelocity"]):
            if not math.isfinite(v):
                raise SnapshotError("SNAPSHOT_NON_FINITE", f"{r['robotId']} pose or velocity is not finite")
    return {"schemaVersion": 1, "runId": run_id, "bootId": boot_id, "tick": tick, "simTimeNs": str(tick * TICK_NS), "seq": str(seq), "sceneDigest": scene_digest, "robots": robots}
