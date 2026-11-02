"""Nav2 `NavigateToPose` behind the W06-T03 NativeNavigation port. Pure Python: ROS lives in the injected action client (nav2_rclpy.py).

Completed only when the goal was ACCEPTED and its terminal status is SUCCEEDED and result.error_code == 0. Rejected, aborted, canceled,
unknown and "SUCCEEDED but no retrievable error_code" never complete. A cancel/STOP request is not a confirmation: only a later status
read of CANCELED is. The executor's goal UUID is the ROS goal_id, so a restarted agent can ask Nav2 about the same goal; if Nav2 does not
list it the answer is not_found (never guessed). Units: metres, radians, m/s. Frames are explicit (map goal frame; odom/base_link config)."""
import math
from dataclasses import dataclass, field
from typing import Optional, Protocol

from .executor import NativeRejected, NativeResult
from .ownership import Profile

# action_msgs/msg/GoalStatus
UNKNOWN, ACCEPTED, EXECUTING, CANCELING, SUCCEEDED, CANCELED, ABORTED = range(7)
_NAMES = {UNKNOWN: "UNKNOWN", ACCEPTED: "ACCEPTED", EXECUTING: "EXECUTING", CANCELING: "CANCELING", SUCCEEDED: "SUCCEEDED", CANCELED: "CANCELED", ABORTED: "ABORTED"}
NO_SPEED_LIMIT = 0.0  # nav2_msgs/SpeedLimit: a value <= 0 clears the limit


@dataclass(frozen=True)
class GoalState:
    status: int                       # action_msgs GoalStatus code
    error_code: Optional[int] = None  # NavigateToPose result; None = result not retrievable (not terminal, or expired on the server)


@dataclass(frozen=True)
class Pose:
    frame: str
    x: float
    y: float
    qx: float
    qy: float
    qz: float
    qw: float


@dataclass(frozen=True)
class Localization:
    """Snapshot read from the robot: lifecycle labels per node, AMCL pose + diagonal covariance (m^2, rad^2), and the loaded map identity."""
    frame: Optional[str]
    map_id: Optional[str]
    map_revision: Optional[str]
    lifecycle: dict
    pose: Optional[tuple]  # (x, y, yaw)
    var_x: Optional[float]
    var_y: Optional[float]
    var_yaw: Optional[float]


@dataclass(frozen=True)
class NavigationResult:
    status: str  # active|canceling|completed|failed|canceled|rejected|unknown
    completed: bool
    reason: Optional[str] = None
    error_code: Optional[int] = None


@dataclass(frozen=True)
class Nav2Config:
    """Per-robot wiring. Defaults describe the restaurant simulation (illustrative); hardware profiles come from `for_profile`."""
    namespace: str = ""
    map_frame: str = "map"
    odom_frame: str = "odom"
    base_frame: str = "base_link"
    map_id: str = "map-a"
    map_revision: str = "r1"
    required_nodes: tuple = ("map_server", "amcl", "planner_server", "controller_server", "bt_navigator")
    max_position_variance_m2: float = 0.09    # (0.30 m)^2 per axis; simulation-illustrative, calibrated per venue/robot at commissioning
    max_yaw_variance_rad2: float = 0.10      # about (18 degrees)^2

    @classmethod
    def for_profile(cls, profile: Profile, namespace="", **kw):
        return cls(namespace=namespace, map_frame=profile.frame, map_id=profile.map_id, map_revision=profile.map_revision, **kw)

    def node_path(self, name):
        return f"/{self.namespace.strip('/')}/{name}" if self.namespace.strip("/") else f"/{name}"

    @property
    def action_name(self):
        return self.node_path("navigate_to_pose")


class ActionClient(Protocol):
    supports_speed_limit: bool
    def send_goal(self, goal_id: str, pose: Pose) -> bool: ...          # True = accepted. Raises when the outcome is unknown (no reply)
    def goal_state(self, goal_id: str) -> Optional[GoalState]: ...      # None = the action server does not list this goal id
    def cancel_goal(self, goal_id: str) -> bool: ...                    # True = cancel request acknowledged
    def cancel_all(self) -> bool: ...
    def set_speed_limit(self, mps: float) -> None: ...                  # raises if it could not be delivered to a consumer
    def localization(self) -> Localization: ...


def yaw_to_quaternion(yaw):
    """Rotation about +z only (planar robot): (qx, qy, qz, qw)."""
    return (0.0, 0.0, math.sin(yaw / 2), math.cos(yaw / 2))


def quaternion_to_yaw(qx, qy, qz, qw):
    """Yaw in (-pi, pi]."""
    return math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class Nav2Navigation:
    def __init__(self, client: ActionClient, config: Optional[Nav2Config] = None):
        self.client, self.config = client, config or Nav2Config()
        self._rejected, self._last = {}, None

    @property
    def supports_speed_limit(self):
        return bool(self.client.supports_speed_limit)

    def not_ready_reason(self):
        """None when Nav2 + localization are ready to accept a goal in the bound map, else the first failing reason."""
        c, loc = self.config, self.client.localization()
        for node in c.required_nodes:
            if loc.lifecycle.get(node) != "active":
                return f"LIFECYCLE_NOT_ACTIVE:{node}"
        variances = (loc.var_x, loc.var_y, loc.var_yaw)
        if loc.pose is None or not all(_num(v) and v >= -1e-9 for v in variances):  # tiny negatives are float noise in AMCL's covariance
            return "LOCALIZATION_UNAVAILABLE"
        if loc.frame != c.map_frame:
            return "FRAME_MISMATCH"
        if loc.map_id != c.map_id or loc.map_revision != c.map_revision:
            return "MAP_MISMATCH"
        if loc.var_x > c.max_position_variance_m2 or loc.var_y > c.max_position_variance_m2 or loc.var_yaw > c.max_yaw_variance_rad2:
            return "COVARIANCE_TOO_LARGE"

    def _pose(self, target):
        c = self.config
        if target.get("frame") != c.map_frame:
            raise NativeRejected("FRAME_MISMATCH")
        if target.get("mapId") != c.map_id or target.get("mapRevision") != c.map_revision:
            raise NativeRejected("MAP_MISMATCH")
        if not all(_num(target.get(k)) for k in ("x", "y", "yaw")):
            raise NativeRejected("INVALID_TARGET")
        return Pose(c.map_frame, float(target["x"]), float(target["y"]), *yaw_to_quaternion(float(target["yaw"])))

    def start(self, goal_uuid, target, speed_limit_mps=None):
        """Return = Nav2 accepted the goal. NativeRejected = nothing was sent (or Nav2 refused it). Other exceptions = no reply (unknown)."""
        pose = self._pose(target)
        if speed_limit_mps is not None and (not _num(speed_limit_mps) or speed_limit_mps <= 0):
            raise NativeRejected("INVALID_SPEED_LIMIT")
        try:
            reason = self.not_ready_reason()
        except Exception:
            reason = "LOCALIZATION_UNAVAILABLE"
        if reason:
            raise NativeRejected(reason)
        try:  # the limit is global to the controller: always set it (0.0 clears a previous goal's limit) before the goal exists
            self.client.set_speed_limit(NO_SPEED_LIMIT if speed_limit_mps is None else float(speed_limit_mps))
        except Exception:
            raise NativeRejected("SPEED_LIMIT_NOT_APPLIED")
        self._last = goal_uuid
        if not self.client.send_goal(goal_uuid, pose):
            self._rejected[goal_uuid] = "NAV2_GOAL_REJECTED"
            raise NativeRejected("NAV2_GOAL_REJECTED")

    def result(self, goal_uuid) -> NavigationResult:
        return self._read(goal_uuid)[0]

    def _read(self, goal_uuid):
        if goal_uuid in self._rejected:
            return NavigationResult("rejected", False, self._rejected[goal_uuid]), None
        state = self.client.goal_state(goal_uuid)
        return (NavigationResult("unknown", False, "NOT_LISTED") if state is None else self._map(state)), state

    @staticmethod
    def _map(state):
        s = state.status
        if s in (ACCEPTED, EXECUTING):
            return NavigationResult("active", False)
        if s == CANCELING:
            return NavigationResult("canceling", False)
        if s == CANCELED:
            return NavigationResult("canceled", False, error_code=state.error_code)
        if s == ABORTED:
            return NavigationResult("failed", False, "NAV2_ABORTED", state.error_code)
        if s == SUCCEEDED:
            if state.error_code is None:
                return NavigationResult("unknown", False, "RESULT_UNAVAILABLE")
            if state.error_code != 0:
                return NavigationResult("failed", False, "NAV2_ERROR_CODE", state.error_code)
            return NavigationResult("completed", True, error_code=0)
        return NavigationResult("unknown", False, f"STATUS_{s}")

    def poll(self) -> NavigationResult:
        return self.result(self._last) if self._last else NavigationResult("unknown", False, "NO_GOAL")

    # -- NativeNavigation port --------------------------------------------------------------------------------------------------------
    def query(self, goal_uuid) -> NativeResult:
        r, state = self._read(goal_uuid)
        evidence = {"goalUuid": goal_uuid, "action": self.config.action_name, "errorCode": r.error_code, "reason": r.reason}
        if state is not None:
            evidence["nav2Status"] = _NAMES.get(state.status, state.status)
        status = {"active": "executing" if state is None or state.status != ACCEPTED else "accepted", "canceling": "canceling", "completed": "succeeded",
                  "failed": "aborted", "canceled": "canceled"}.get(r.status)
        if status is None:  # rejected/unlisted -> the goal is not on the server; anything else is unknown
            status = "not_found" if r.reason in ("NOT_LISTED", "NAV2_GOAL_REJECTED") else "unknown"
        return NativeResult(status, evidence)

    def cancel(self, goal_uuid) -> bool:
        return bool(self.client.cancel_goal(goal_uuid))

    def request_stop(self) -> bool:
        """Cancel every Nav2 goal. Not a physical stop: motors/E-stop are the robot's safety layer (W06-T05)."""
        return bool(self.client.cancel_all())
