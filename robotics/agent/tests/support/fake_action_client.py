"""FakeActionClient stands in for the rclpy NavigateToPose client (and its localization probe). It is a fake: it proves the adapter's
decision logic, never Nav2, Gazebo or a robot. Goals live in the client (shared object), like a Nav2 action server outliving the agent."""
from mekoniq_agent.nav2_adapter import ABORTED, CANCELED, CANCELING, EXECUTING, SUCCEEDED, GoalState
from .fixtures import localization_fixture

_NAMES = {"SUCCEEDED": SUCCEEDED, "CANCELED": CANCELED, "ABORTED": ABORTED}


class FakeActionClient:
    def __init__(self, accepted=True, terminal=None, error_code=0, supports_speed_limit=True, localization=None):
        self.accepted, self.terminal, self.error_code = accepted, terminal, error_code
        self.supports_speed_limit, self._localization = supports_speed_limit, localization or localization_fixture()
        self.goals, self.sent, self.speed_limits, self.cancel_requests, self.cancel_all_count = {}, [], [], [], 0
        self.unreachable = self.localization_error = self.speed_error = False
        self.ack_cancel = True

    def send_goal(self, goal_id, pose):
        if self.unreachable:
            raise ConnectionError("partition")
        self.sent.append((goal_id, pose))
        if not self.accepted:
            return False
        status = _NAMES[self.terminal] if self.terminal else EXECUTING
        self.goals[goal_id] = GoalState(status, self.error_code if self.terminal else None)
        return True

    def goal_state(self, goal_id):
        if self.unreachable:
            raise ConnectionError("partition")
        return self.goals.get(goal_id)

    def cancel_goal(self, goal_id):
        self.cancel_requests.append(goal_id)  # a request only: the goal turns CANCELED when Nav2 says so (settle)
        if not self.ack_cancel:
            return False
        if goal_id in self.goals and self.goals[goal_id].status == EXECUTING:
            self.goals[goal_id] = GoalState(CANCELING)
        return True

    def cancel_all(self):
        self.cancel_all_count += 1
        for goal_id in self.goals:
            self.cancel_goal(goal_id)
        return self.ack_cancel

    def set_speed_limit(self, mps):
        if self.speed_error:
            raise RuntimeError("publisher down")
        self.speed_limits.append(mps)

    def localization(self):
        if self.localization_error:
            raise TimeoutError("probe")
        return self._localization

    # test controls
    def settle(self, goal_id, status, error_code=None):
        self.goals[goal_id] = GoalState(_NAMES.get(status, status), error_code)

    def forget(self, goal_id=None):
        """A restarted Nav2 / expired result: the goal is no longer listed."""
        self.goals.pop(goal_id, None) if goal_id else self.goals.clear()
