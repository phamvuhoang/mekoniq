"""rclpy implementation of the Nav2 `ActionClient` port. ROS imports are lazy: importing this module never needs ROS; constructing the client does.

Runs inside the onboard agent's ROS environment (Ubuntu 24.04 / Jazzy). Goals are sent with the executor's goal UUID as the ROS goal_id and
are read back from the action server's own `_action/status` topic and `_action/get_result` / `_action/cancel_goal` services, so a restarted
agent can ask about a goal it no longer holds a handle for. Unavailable answers raise (unknown outcome) or return None (not listed); nothing is guessed."""
import json
import math
import threading
import uuid
from pathlib import Path

from .nav2_adapter import Localization, Nav2Config, GoalState, Pose


def _wait(future, timeout_s):
    done = threading.Event()
    future.add_done_callback(lambda _f: done.set())
    if not done.wait(timeout_s):
        raise TimeoutError("no reply from the ROS peer")
    return future.result()


class RclpyActionClient:
    supports_speed_limit = True  # nav2 speed_limit topic, consumed by controller_server and velocity_smoother

    def __init__(self, config: Nav2Config, node_name="mekoniq_nav2_bridge", timeout_s=3.0):
        import rclpy
        from action_msgs.msg import GoalStatusArray
        from action_msgs.srv import CancelGoal
        from geometry_msgs.msg import PoseWithCovarianceStamped
        from lifecycle_msgs.srv import GetState
        from nav2_msgs.action import NavigateToPose
        from nav2_msgs.msg import SpeedLimit
        from rcl_interfaces.srv import GetParameters
        from rclpy.action import ActionClient
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

        self.config, self.timeout_s, self._m = config, timeout_s, locals()
        if not rclpy.ok():
            rclpy.init()
        ns = config.namespace.strip("/")
        self.node = rclpy.create_node(node_name, namespace=ns)
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL, reliability=ReliabilityPolicy.RELIABLE)
        action = config.action_name
        self._client = ActionClient(self.node, NavigateToPose, action)
        self._cancel = self.node.create_client(CancelGoal, f"{action}/_action/cancel_goal")
        self._result = self.node.create_client(NavigateToPose.Impl.GetResultService, f"{action}/_action/get_result")
        self._status, self._pose, self._handles, self._status_seen = None, None, {}, threading.Event()
        self.node.create_subscription(GoalStatusArray, f"{action}/_action/status", self._on_status, latched)
        self.node.create_subscription(PoseWithCovarianceStamped, config.node_path("amcl_pose"), lambda m: setattr(self, "_pose", m), latched)
        self._speed = self.node.create_publisher(SpeedLimit, config.node_path("speed_limit"), 1)
        self._exec = SingleThreadedExecutor()
        self._exec.add_node(self.node)
        self._thread = threading.Thread(target=self._exec.spin, daemon=True, name="nav2-bridge-spin")
        self._thread.start()

    def _on_status(self, msg):
        self._status = msg
        self._status_seen.set()

    def close(self):
        self._exec.shutdown()
        self.node.destroy_node()

    @staticmethod
    def _uuid_msg(goal_id):
        from unique_identifier_msgs.msg import UUID
        return UUID(uuid=list(uuid.UUID(goal_id).bytes))

    def _require_server(self):
        if not self._client.wait_for_server(timeout_sec=self.timeout_s):
            raise ConnectionError("navigate_to_pose action server not available")

    def send_goal(self, goal_id, pose: Pose):
        from nav2_msgs.action import NavigateToPose
        self._require_server()
        goal = NavigateToPose.Goal()
        goal.pose.header.frame_id = pose.frame
        goal.pose.pose.position.x, goal.pose.pose.position.y = pose.x, pose.y
        o = goal.pose.pose.orientation
        o.x, o.y, o.z, o.w = pose.qx, pose.qy, pose.qz, pose.qw
        handle = _wait(self._client.send_goal_async(goal, goal_uuid=self._uuid_msg(goal_id)), self.timeout_s)  # TimeoutError = no ACK = unknown
        if handle.accepted:
            self._handles[goal_id] = handle  # bridges the gap before the status topic lists the new goal; never used after a restart
        return bool(handle.accepted)

    def goal_state(self, goal_id):
        self._require_server()
        want, status = uuid.UUID(goal_id).bytes, None
        if goal_id not in self._handles:
            # A fresh client has not been handed the server's latched status yet. If none arrives while the server is up, the server has
            # published no goal at all: treated as empty (a slow discovery therefore yields not_found = unknown, never a guessed outcome).
            self._status_seen.wait(self.timeout_s)
        for item in (self._status.status_list if self._status else []):
            if bytes(item.goal_info.goal_id.uuid) == want:
                status = int(item.status)
        if status is None and goal_id in self._handles:
            status = int(self._handles[goal_id].status) or 1  # accepted by this process a moment ago (the accept reply is the ACK); the status topic lags
        if status is None or status == 0:
            return None  # not listed (never existed, or expired from the server's retention): the adapter reports not_found
        error = None
        if status in (4, 5, 6):  # terminal: the server still holds the result for its retention window
            try:
                req = self._m["NavigateToPose"].Impl.GetResultService.Request()
                req.goal_id = self._uuid_msg(goal_id)
                error = int(_wait(self._result.call_async(req), self.timeout_s).result.error_code)
            except Exception:
                error = None
        return GoalState(status, error)

    def _cancel_request(self, goal_id):
        req = self._m["CancelGoal"].Request()
        req.goal_info.goal_id = self._uuid_msg(goal_id)  # zero uuid + zero stamp = cancel every goal
        if not self._cancel.wait_for_service(timeout_sec=self.timeout_s):
            raise ConnectionError("cancel_goal service not available")
        return int(_wait(self._cancel.call_async(req), self.timeout_s).return_code)

    def cancel_goal(self, goal_id):
        return self._cancel_request(goal_id) == 0  # ERROR_NONE: the request was accepted, NOT that the goal is canceled

    def cancel_all(self):
        code = self._cancel_request(str(uuid.UUID(int=0)))
        idle = not any(int(i.status) in (1, 2, 3) for i in (self._status.status_list if self._status else []))
        return code == 0 or (code == 1 and idle)  # UNKNOWN_GOAL_ID with nothing active: nothing to cancel

    def set_speed_limit(self, mps):
        if self._speed.get_subscription_count() < 1:
            raise RuntimeError("no speed_limit subscriber (controller_server not up)")
        msg = self._m["SpeedLimit"]()
        msg.header.stamp = self.node.get_clock().now().to_msg()
        msg.percentage, msg.speed_limit = False, float(mps)
        self._speed.publish(msg)

    def localization(self):
        c, GetState = self.config, self._m["GetState"]
        lifecycle = {}
        for name in c.required_nodes:
            cli = self.node.create_client(GetState, f"{c.node_path(name)}/get_state")
            try:
                lifecycle[name] = _wait(cli.call_async(GetState.Request()), self.timeout_s).current_state.label if cli.wait_for_service(self.timeout_s) else "unreachable"
            except Exception:
                lifecycle[name] = "unreachable"
            self.node.destroy_client(cli)
        pose, var_x = None, None
        m = self._pose
        if m is not None:
            cov, q = m.pose.covariance, m.pose.pose.orientation
            yaw = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
            pose, var_x, var_y, var_yaw = (m.pose.pose.position.x, m.pose.pose.position.y, yaw), cov[0], cov[7], cov[35]
        else:
            var_y = var_yaw = None
        map_id, revision = self._map_identity()
        return Localization(m.header.frame_id if m else None, map_id, revision, lifecycle, pose, var_x, var_y, var_yaw)

    def _map_identity(self):
        """Identity of the map the map_server loaded: `<map>.identity.json` beside its yaml (id + revision), None when unreadable."""
        try:
            GetParameters = self._m["GetParameters"]
            cli = self.node.create_client(GetParameters, f"{self.config.node_path('map_server')}/get_parameters")
            req = GetParameters.Request()
            req.names = ["yaml_filename"]
            reply = _wait(cli.call_async(req), self.timeout_s) if cli.wait_for_service(self.timeout_s) else None
            self.node.destroy_client(cli)
            ident = json.loads(Path(reply.values[0].string_value).with_suffix(".identity.json").read_text())
            return ident["mapId"], ident["mapRevision"]
        except Exception:
            return None, None
