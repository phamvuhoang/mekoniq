"""TwinSampleV2 telemetry from the simulation worker: one stream per provider boot, monotonic seq, sim time from /clock, origin physics_sim,
explicit quality/reason codes. The gateway stamps receivedMonotonicNs on receipt; this side leaves it at 0."""
import math
import threading


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class TelemetryStream:
    def __init__(self, run_id, provider_id, boot_id):
        self.run_id, self.provider_id, self.boot_id, self.seq = run_id, provider_id, boot_id, 0
        self.lock = threading.Lock()

    def reboot(self, boot_id):
        self.boot_id, self.seq = boot_id, 0

    def sample(self, entity_id, frame_id, sim_time_ns, observed, quality="valid", reason_codes=None, causation_id=None, commanded=None):
        if not isinstance(sim_time_ns, int) or isinstance(sim_time_ns, bool) or sim_time_ns < 0:
            raise ValueError("SIM_TIME_INVALID")
        if observed is None:
            if quality not in ("unknown", "invalid") or not reason_codes:
                raise ValueError("OBSERVED_MISSING")
        elif not isinstance(observed, dict) or not all(_finite(v) for v in observed.values() if not isinstance(v, (str, bool, type(None)))):
            raise ValueError("OBSERVED_NOT_FINITE")
        if quality not in ("valid", "stale", "unknown", "invalid"):
            raise ValueError("QUALITY_INVALID")
        with self.lock:
            self.seq += 1
            seq = self.seq
        return {"schemaVersion": 2, "runId": self.run_id, "entityId": entity_id, "providerId": self.provider_id, "bootId": self.boot_id, "seq": str(seq),
                "simTimeNs": str(sim_time_ns), "observedAt": None, "receivedMonotonicNs": "0", "frameId": frame_id, "origin": "physics_sim",
                "quality": quality, "reasonCodes": list(reason_codes or []), "commanded": commanded, "observed": dict(observed) if observed is not None else None, "estimated": None, "causationId": causation_id}


def pose_from_gz(msg):
    """gz.msgs.Pose (as a dict: position {x,y,z}, orientation {x,y,z,w}) -> planar pose in metres/radians."""
    try:
        p, q = msg["position"], msg["orientation"]
        x, y = p["x"], p["y"]
        qx, qy, qz, qw = q["x"], q["y"], q["z"], q["w"]
    except (KeyError, TypeError):
        raise ValueError("POSE_INVALID")
    if not all(_finite(v) for v in (x, y, qx, qy, qz, qw)):
        raise ValueError("POSE_INVALID")
    return {"xM": float(x), "yM": float(y), "yawRad": math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))}
