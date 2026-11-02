"""Test doubles. FakeNativeNavigation keeps accepted goals OUTSIDE the Executor (a shared object, or a JSON file so a killed process
cannot lose them), like a real Nav2 action server that outlives the agent. It is a fake: it proves ownership logic, not a robot."""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from mekoniq_agent.executor import NativeRejected, NativeResult
from mekoniq_agent.ownership import Profile

NOW_MS = 1793491200000  # 2026-11-01T00:00:00Z, same as the shared vectors


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def profile_fixture(**overrides):
    return Profile(**{"organization_id": "org-a", "venue_id": "venue-a", "robot_id": "robot-1", "executor_id": "agent-1", "control_epoch": 3,
                      "map_id": "map-a", "map_revision": "r1", "frame": "map", **overrides})


def command_fixture(command_id="c-1", control_epoch=3, now_ms=None, ttl_ms=60000, **overrides):
    now = now_ms if now_ms is not None else time.time_ns() // 1_000_000
    command = {"schemaVersion": 1, "commandId": command_id, "operationId": f"op-{command_id}", "organizationId": "org-a", "venueId": "venue-a",
               "robotId": "robot-1", "missionId": "mission-1", "stopId": "stop-1", "missionRevision": 1, "controlEpoch": control_epoch,
               "issuerDeviceId": "device-a", "issuedAt": iso(now), "expiresAt": iso(now + ttl_ms),
               "target": {"waypointId": "table-1", "mapId": "map-a", "mapRevision": "r1", "frame": "map", "x": 2.5, "y": 1.2, "yaw": 0},
               "limits": {"trays": 1, "maxLoadMinor": "5000"}}
    command.update(overrides)
    return command


class FakeNativeNavigation:
    """`store`: optional JSON file path; state is re-read before and written after every call so another process shares it."""
    def __init__(self, store=None, supports_speed_limit=False):
        self.store, self.supports_speed_limit = Path(store) if store else None, supports_speed_limit
        self.state = {"goals": {}, "start_count": 0, "stop_count": 0}
        self.unreachable = self.reject_next = self.drop_ack = False
        self.ack_stop = self.ack_cancel = True
        self.on_start = None  # hook run at the moment of the native call (journal-before-I/O probe)

    def _load(self):
        if self.store and self.store.exists():
            self.state = json.loads(self.store.read_text())

    def _save(self):
        if self.store:
            tmp = self.store.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.state))
            os.replace(tmp, self.store)  # atomic: a SIGKILL never leaves half a file

    @property
    def start_count(self):
        self._load()
        return self.state["start_count"]

    @property
    def stop_count(self):
        self._load()
        return self.state["stop_count"]

    def goals(self):
        self._load()
        return self.state["goals"]

    def start(self, goal_uuid, target, speed_limit_mps=None):
        if self.unreachable:
            raise ConnectionError("partition")
        self._load()
        if self.on_start:
            self.on_start(goal_uuid)
        if self.reject_next:
            self.reject_next = False
            raise NativeRejected("GOAL_REJECTED")
        self.state["start_count"] += 1
        self.state["goals"][goal_uuid] = {"status": "executing", "target": target, "speedLimitMps": speed_limit_mps}
        self._save()
        if self.drop_ack:
            self.drop_ack = False
            raise TimeoutError("ack lost")

    def query(self, goal_uuid):
        if self.unreachable:
            raise ConnectionError("partition")
        self._load()
        goal = self.state["goals"].get(goal_uuid)
        return NativeResult(goal["status"], {"goal": goal_uuid}) if goal else NativeResult("not_found")

    def settle(self, goal_uuid, status):
        """Native side finished/forgot the goal on its own (arrival, abort, cancel completing)."""
        self._load()
        if status == "forget":
            self.state["goals"].pop(goal_uuid, None)
        else:
            self.state["goals"][goal_uuid]["status"] = status
        self._save()

    def cancel(self, goal_uuid):
        if self.unreachable or not self.ack_cancel:
            return False
        self._load()
        if goal_uuid in self.state["goals"] and self.state["goals"][goal_uuid]["status"] in ("accepted", "executing"):
            self.state["goals"][goal_uuid]["status"] = "canceling"
            self._save()
        return True

    def request_stop(self):
        if self.unreachable or not self.ack_stop:
            return False
        self._load()
        self.state["stop_count"] += 1
        for goal in self.state["goals"].values():
            if goal["status"] in ("accepted", "executing"):
                goal["status"] = "canceling"
        self._save()
        return True
