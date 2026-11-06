"""Gazebo Harmonic + Nav2 for a COMPILED Lab world (robotics/simulation/compiler): `bundle:=<dir> robots:=robot_a,robot_b headless:=true`.
One world physics clock serves every robot; each robot has its own model name, namespace, topics/TF and Nav2 lifecycle, all spawned from the
bundle's per-robot URDF at its parking binding. Simulation only: illustrative geometry. Needs Linux with ROS 2 Jazzy + Gazebo Harmonic."""
import os
import sys
from pathlib import Path

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, OpaqueFunction
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge.launch_plan import nav2_params_file, plan_launch  # noqa: E402


def _robots(context):
    bundle = LaunchConfiguration("bundle").perform(context)
    robots = [r for r in LaunchConfiguration("robots").perform(context).split(",") if r]
    plan = plan_launch(bundle, robots)
    nav = get_package_share_directory("mekoniq_navigation")
    actions = []
    for r in plan["robots"]:
        ns, spawn = r["namespace"], r["spawn"]
        urdf = Path(r["urdf"]).read_text()
        params_file = nav2_params_file(bundle, r, os.path.join(nav, "config", "nav2_params.yaml"))  # initial pose, footprint/radius, speed from the compiled overlay
        actions += [
            Node(package="robot_state_publisher", executable="robot_state_publisher", namespace=ns, output="screen",
                 parameters=[{"robot_description": urdf, "use_sim_time": True}], remappings=[("/tf", "tf"), ("/tf_static", "tf_static")]),
            Node(package="ros_gz_sim", executable="create", output="screen",
                 arguments=["-world", "lab", "-string", urdf, "-name", ns, "-x", str(spawn["x"]), "-y", str(spawn["y"]), "-z", "0.02", "-Y", str(spawn["yaw"])]),
            Node(package="ros_gz_bridge", executable="parameter_bridge", output="screen", arguments=[
                f"/{ns}/cmd_vel@geometry_msgs/msg/Twist]gz.msgs.Twist", f"/{ns}/odom@nav_msgs/msg/Odometry[gz.msgs.Odometry",
                f"/{ns}/tf@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V", f"/{ns}/joint_states@sensor_msgs/msg/JointState[gz.msgs.Model",
                f"/{ns}/scan@sensor_msgs/msg/LaserScan[gz.msgs.LaserScan",
                # simulation-only evidence: ground-truth model pose and contact sensor; the robot stack never reads them
                f"/model/{ns}/pose@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V", f"/model/{ns}/contacts@ros_gz_interfaces/msg/Contacts[gz.msgs.Contacts"]),
            IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(nav, "launch", "navigation.launch.py")),
                                     launch_arguments={"namespace": ns, "use_sim_time": "true", "map": plan["map"], "params_file": params_file, "autostart": "true"}.items()),
        ]
    for model in plan["actors"] + plan["blockers"]:
        actions.append(Node(package="ros_gz_bridge", executable="parameter_bridge", output="screen", arguments=[
            f"/model/{model}/cmd_vel@geometry_msgs/msg/Twist]gz.msgs.Twist", f"/model/{model}/pose@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V"]))
    for model in plan["cups"]:
        actions.append(Node(package="ros_gz_bridge", executable="parameter_bridge", output="screen", arguments=[f"/model/{model}/pose@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V"]))
    return actions


def generate_launch_description():
    gz_launch = os.path.join(get_package_share_directory("ros_gz_sim"), "launch", "gz_sim.launch.py")
    bundle, headless = LaunchConfiguration("bundle"), LaunchConfiguration("headless")
    return LaunchDescription([
        DeclareLaunchArgument("bundle", description="compiled bundle directory (compiler-manifest.json, world.sdf, map.yaml, robot-<id>.urdf)"),
        DeclareLaunchArgument("robots", description="comma-separated robot namespaces from the bundle manifest"),
        DeclareLaunchArgument("headless", default_value="true"),
        Node(package="ros_gz_bridge", executable="parameter_bridge", output="screen", arguments=["/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock"]),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(gz_launch), condition=IfCondition(headless),
                                 launch_arguments={"gz_args": ["-r -s --headless-rendering ", bundle, "/world.sdf"], "on_exit_shutdown": "true"}.items()),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(gz_launch), condition=UnlessCondition(headless),
                                 launch_arguments={"gz_args": ["-r ", bundle, "/world.sdf"], "on_exit_shutdown": "true"}.items()),
        OpaqueFunction(function=_robots),
    ])
