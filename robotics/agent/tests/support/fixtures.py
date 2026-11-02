"""Nav2 adapter fixtures. Geometry/limits are illustrative simulation values, not measured robot data."""
from mekoniq_agent.nav2_adapter import Localization

READY_LIFECYCLE = {n: "active" for n in ("map_server", "amcl", "planner_server", "controller_server", "bt_navigator")}


def localization_fixture(**overrides):
    return Localization(**{"frame": "map", "map_id": "map-a", "map_revision": "r1", "lifecycle": dict(READY_LIFECYCLE),
                           "pose": (2.0, 1.0, 0.0), "var_x": 0.01, "var_y": 0.01, "var_yaw": 0.02, **overrides})


def goal_fixture(goal_uuid="6f1a7d8e-0000-4000-8000-000000000001", **overrides):
    """kwargs for `Nav2Navigation.start(**goal_fixture())`."""
    return {"goal_uuid": goal_uuid, "target": {"waypointId": "table-1", "mapId": "map-a", "mapRevision": "r1", "frame": "map",
                                                "x": 2.5, "y": 1.2, "yaw": 0.5}, "speed_limit_mps": None, **overrides}
