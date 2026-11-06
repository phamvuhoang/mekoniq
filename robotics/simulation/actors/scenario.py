"""Declarative SIL scenario fixtures (tests/fixtures/digital-twin/scenarios): actors, blockers, zones, a typed fault schedule and assertion ids.
No script, no topic/endpoint/shell string survives validation. The fault catalog mirrors the Lab runtime's SIL_FAULTS (fault-schedule.ts)."""
import json
import math
import re
from pathlib import Path

from .blocker import BlockerSchedule
from .pedestrian import ActorSchedule, Trajectory

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
SCENARIO_IDS = ("FD01", "FD02", "FD03", "FD04", "FD05", "FD06", "FD07", "FD08", "BV01")
SIL_FAULTS = ("blocker-on", "blocker-off", "pedestrian-cross", "sensor-stale", "sensor-drop", "disconnect", "reboot", "localization-lost", "map-changed",
              "duplicate-observation", "reorder-observation")
FORBIDDEN = re.compile(r"endpoint|url|uri|host|address|socket|topic|^ip$|^port$|gcode|halcmd|shell|script|command$|executable|argv|^file$|^path$", re.I)
ACTOR_KINDS = ("pedestrian",)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _forbidden_keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if FORBIDDEN.search(k):
                return k
            found = _forbidden_keys(v)
            if found:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _forbidden_keys(v)
            if found:
                return found
    return None


def load_scenario(path):
    s = json.loads(Path(path).read_text())
    if not isinstance(s, dict) or s.get("schemaVersion") != 1 or not isinstance(s.get("id"), str) or not ID.match(s["id"]) or not isinstance(s.get("revision"), int) or s["revision"] < 1:
        raise ValueError("SCENARIO_SHAPE")
    if s.get("scenarioId") not in SCENARIO_IDS:
        raise ValueError(f"SCENARIO_UNKNOWN: {s.get('scenarioId')}")
    if not isinstance(s.get("projectFixture"), str) or "/" in s["projectFixture"] or not s["projectFixture"].endswith(".json"):
        raise ValueError("PROJECT_FIXTURE_INVALID")
    if not isinstance(s.get("seed"), int) or s["seed"] < 0:
        raise ValueError("SEED_INVALID")
    for a in s.get("actors", []):
        if a.get("kind") not in ACTOR_KINDS:
            raise ValueError(f"ACTOR_KIND_UNKNOWN: {a.get('kind')}")
        if not isinstance(a.get("id"), str) or not ID.match(a["id"]) or not _num(a.get("heightM")) or not _num(a.get("radiusM")):
            raise ValueError(f"ACTOR_INVALID: {a.get('id')}")
        t = a.get("trajectory") or {}
        if not isinstance(t.get("waypoints"), list) or not _num(t.get("speedMps")) or not isinstance(t.get("startTick"), int) or not isinstance(t.get("dwellTicks"), int) or not isinstance(t.get("loop"), bool):
            raise ValueError(f"TRAJECTORY_INVALID: {a['id']}")
    BlockerSchedule(s.get("blockers", []))
    for z in s.get("zones", []):
        if not isinstance(z.get("id"), str) or not ID.match(z["id"]) or not all(_num(z.get(k)) for k in ("x", "y", "width", "height")) or z["width"] <= 0 or z["height"] <= 0:
            raise ValueError(f"ZONE_INVALID: {z.get('id')}")
    for f in s.get("faults", []):
        if not isinstance(f, dict) or not isinstance(f.get("atTick"), int) or f["atTick"] < 0:
            raise ValueError("FAULT_INVALID")
        bad = _forbidden_keys(f)
        if bad:
            raise ValueError(f"FAULT_FIELD_FORBIDDEN: {bad}")
        if f.get("faultId") not in SIL_FAULTS:
            raise ValueError(f"FAULT_UNKNOWN: {f.get('faultId')}")
        if f.get("entityId") is not None and (not isinstance(f["entityId"], str) or not ID.match(f["entityId"])):
            raise ValueError("FAULT_ENTITY_INVALID")
    if not isinstance(s.get("assertions"), list) or not s["assertions"] or not all(isinstance(x, str) for x in s["assertions"]):
        raise ValueError("ASSERTIONS_REQUIRED")
    s.setdefault("actors", [])
    s.setdefault("blockers", [])
    s.setdefault("zones", [])
    s.setdefault("faults", [])
    return s


def actor_schedules(scenario):
    out = []
    for a in scenario["actors"]:
        t = a["trajectory"]
        out.append(ActorSchedule(scenario["seed"], a["id"], Trajectory(tuple(tuple(w) for w in t["waypoints"]), t["speedMps"], t["startTick"], t["dwellTicks"], t["loop"]),
                                 height_m=a["heightM"], radius_m=a["radiusM"]))
    return out


def tick_commands(schedules, blockers, tick):
    """Everything the worker tells Gazebo at one tick: actor velocities (every tick) and blocker placements (on transitions). Pure data."""
    return {"velocities": [s.command_at(tick) for s in schedules], "poses": blockers.pose_commands(tick)}
