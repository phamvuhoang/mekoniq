"""Static checks on the ROS workspace assets (no ROS needed): well-formed XML, layout/world/map drift, illustrative-vs-measured geometry,
single cmd_vel source, no motor publishing in the agent. They do NOT replace colcon build/test or the Gazebo scenarios."""
import importlib.util
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROBOTICS = Path(__file__).resolve().parents[2]
AGENT_SRC = ROBOTICS / "agent" / "mekoniq_agent"


def flat_yaml(path):
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([a-z_0-9]+):\s*(.*?)\s*(#.*)?$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def test_ros_packages_are_wellformed_and_named():
    for pkg, name in (("description", "mekoniq_description"), ("navigation", "mekoniq_navigation"), ("simulation", "mekoniq_simulation")):
        root = ET.parse(ROBOTICS / pkg / "package.xml").getroot()
        assert root.get("format") == "3" and root.findtext("name") == name and (ROBOTICS / pkg / "CMakeLists.txt").is_file()
    ET.parse(ROBOTICS / "description/urdf/restaurant_robot.urdf.xacro")
    ET.parse(ROBOTICS / "simulation/worlds/restaurant.sdf")


def test_launch_files_compile():
    for f in (ROBOTICS / "navigation/launch/navigation.launch.py", ROBOTICS / "simulation/launch/restaurant_sim.launch.py"):
        compile(f.read_text(encoding="utf-8"), str(f), "exec")


def test_world_and_map_match_the_committed_generator():
    spec = importlib.util.spec_from_file_location("generate_restaurant", ROBOTICS / "simulation/worlds/generate_restaurant.py")
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    for key, (name, data) in gen.outputs().items():
        path = ROBOTICS / ("simulation/worlds" if key == "world" else "navigation/maps") / name
        assert path.read_bytes() == data, f"{path.name} drifted from generate_restaurant.py: re-run it"
    # the corridor is the narrow, only route between kitchen and dining room
    south, north = gen.BOXES["corridor_wall_south"], gen.BOXES["corridor_wall_north"]
    assert (north[1] - north[3] / 2) - (south[1] + south[3] / 2) == pytest.approx(1.0)
    assert set(gen.WAYPOINTS) >= {"kitchen-pickup", "table-1", "table-2", "table-3", "table-4", "dining-handoff"}


def test_sim_geometry_is_illustrative_and_hardware_template_needs_measurements():
    sim, hw = flat_yaml(ROBOTICS / "description/config/geometry_sim.yaml"), flat_yaml(ROBOTICS / "description/config/geometry_hardware.template.yaml")
    assert sim["illustrative"] == "true" and hw["illustrative"] == "false"
    measured = {k for k in hw if k not in ("illustrative",)}
    assert measured == {k for k in sim if k != "illustrative"} | {"measured_by", "measured_on"}
    assert all(hw[k] == "null" for k in measured), "the hardware template must ship with every value unmeasured"
    xacro = ET.parse(ROBOTICS / "description/urdf/restaurant_robot.urdf.xacro").getroot()
    props = {p.get("name"): p.get("value") for p in xacro.iter("{http://www.ros.org/wiki/xacro}property")}
    for key, value in sim.items():  # the xacro defaults are exactly the illustrative sim numbers
        name = re.sub(r"_(m|kg|mps)$", "", key)
        if name in props:
            assert float(props[name]) == pytest.approx(float(value)), key
    assert "ILLUSTRATIVE" in (ROBOTICS / "description/urdf/restaurant_robot.urdf.xacro").read_text(encoding="utf-8")


def test_cmd_vel_has_a_single_source_and_the_agent_never_publishes_motion():
    launch = (ROBOTICS / "navigation/launch/navigation.launch.py").read_text(encoding="utf-8")
    params = (ROBOTICS / "navigation/config/nav2_params.yaml").read_text(encoding="utf-8")
    assert launch.count('("cmd_vel", "cmd_vel_nav")') == 3 and "twist_mux\"" not in launch + params
    assert "cmd_vel_in_topic: cmd_vel_smoothed" in params and "cmd_vel_out_topic: cmd_vel\n" in params
    for f in AGENT_SRC.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        assert "Twist" not in text and "create_publisher(Twist" not in text, f.name  # no motor commands from the platform
    publishers = re.findall(r"create_publisher\((\w+)", (AGENT_SRC / "nav2_rclpy.py").read_text(encoding="utf-8"))
    assert publishers == ["SpeedLimit"]  # the only thing the bridge publishes is Nav2's speed-limit topic


def test_ros_imports_are_lazy():
    for f in AGENT_SRC.glob("*.py"):
        top = [l for l in f.read_text(encoding="utf-8").splitlines() if re.match(r"^(import|from) (rclpy|nav2_msgs|action_msgs|geometry_msgs|lifecycle_msgs)", l)]
        assert not top, f"{f.name} imports ROS at module level: {top}"
