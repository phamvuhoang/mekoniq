"""Scripted persons on the MuJoCo mobile plant (V10, actor-proxy-v1).

An actor is a kinematic (mocap) box the runner places every tick through the step's actorUpdates: the LiDAR sees it and a robot contact is reported as an unexpected collision.
Actors come only from the run's scenario-fixture.json, loaded only when the parent bound its sha256 at spawn (--fixture-sha256), as the IR-SIM worker does. The proxy is the same
numbers as fixtures/serve-tray-v1/actor-proxy-v1.json (a test keeps them equal).
"""
import hashlib
import json
import math

from .protocol import WorkerError

FIXTURE_FILE = "scenario-fixture.json"
ACTOR_PROXY_V1 = {"id": "actor-proxy-v1", "shape": "box", "heightM": 1.7}
MAX_ACTORS = 16


def load_actors(root, expected_sha256, taken):
    """The declared actors of the bound fixture; an unbound file is refused (never read), a changed one too. `taken` are the ids of robots and solids."""
    file = root / FIXTURE_FILE
    if expected_sha256 is None:
        if file.exists():
            raise WorkerError("FIXTURE_UNBOUND", f"{FIXTURE_FILE} is in the bundle but this process was not bound to it")
        return []
    raw = file.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise WorkerError("FIXTURE_MISMATCH", f"{FIXTURE_FILE} does not match the digest the runner bound")
    doc = json.loads(raw)
    actors = doc.get("actors") if isinstance(doc, dict) and doc.get("schemaVersion") == 1 else None
    if not isinstance(actors, list) or not 1 <= len(actors) <= MAX_ACTORS:
        raise WorkerError("FIXTURE_INVALID", f"actors must be a list of 1..{MAX_ACTORS}")
    taken = set(taken)
    for a in actors:
        ok = isinstance(a, dict) and set(a) == {"id", "radiusM", "initialPoseMap"} and isinstance(a["id"], str) and 0 < len(a["id"]) <= 64 and a["id"] not in taken
        ok = ok and isinstance(a["radiusM"], (int, float)) and 0 < a["radiusM"] <= 1 and isinstance(a["initialPoseMap"], list) and len(a["initialPoseMap"]) == 3
        if not ok or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in a["initialPoseMap"]):
            raise WorkerError("FIXTURE_INVALID", f"actor {a!r:.200}")
        taken.add(a["id"])
    return actors


def check_updates(declared, updates):
    """Every declared actor exactly once with a finite pose, nothing else; returns [(id, x, y, yaw)]. Raises before the caller has changed anything."""
    updates = updates or []
    ids = [u.get("actorId") for u in updates]
    if sorted(ids, key=str) != sorted(declared, key=str) or len(set(ids)) != len(ids):
        raise WorkerError("ACTOR_UPDATE_MISMATCH", f"a step carries exactly the declared actors {sorted(declared)}, got {ids}")
    out = []
    for u in updates:
        pose = u.get("poseMap")
        if not (isinstance(pose, list) and len(pose) == 3 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in pose)) or abs(pose[0]) > 1000 or abs(pose[1]) > 1000:
            raise WorkerError("ACTOR_UPDATE_MISMATCH", f"actor {u.get('actorId')!r} pose is not three finite numbers")
        out.append((u["actorId"], float(pose[0]), float(pose[1]), float(pose[2])))
    return out
