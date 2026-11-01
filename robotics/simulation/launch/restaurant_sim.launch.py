"""Gazebo Harmonic restaurant + Nav2 for one simulated robot (namespace default robot_1). Simulation only: illustrative world and geometry.
`ros2 launch mekoniq_simulation restaurant_sim.launch.py headless:=true namespace:=robot_1`. Needs Linux with ROS 2 Jazzy + Gazebo Harmonic
(macOS: run it inside a Linux container/VM; there is no native macOS robot runtime)."""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, OpaqueFunction
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue

SPAWN = (1.5, 4.0, 0.0)  # kitchen-pickup, see worlds/generate_restaurant.py


def _bridge(context):
    ns = LaunchConfiguration("namespace").perform(context).strip("/")
    p = f"/{ns}" if ns else ""
    args = ["/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock", f"{p}/cmd_vel@geometry_msgs/msg/Twist]gz.msgs.Twist",
            f"{p}/odom@nav_msgs/msg/Odometry[gz.msgs.Odometry", f"{p}/tf@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V",
            f"{p}/joint_states@sensor_msgs/msg/JointState[gz.msgs.Model", f"{p}/scan@sensor_msgs/msg/LaserScan[gz.msgs.LaserScan",
            "/model/walker/cmd_vel@geometry_msgs/msg/Twist]gz.msgs.Twist",
            # simulation-only ground truth (model pose, child_frame_id = model name) for the scenario tests; the robot stack never reads it
            *[f"/model/{m}/pose@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V" for m in ("robot", "walker", "blocker")]]
    return [Node(package="ros_gz_bridge", executable="parameter_bridge", arguments=args, output="screen")]


def generate_launch_description():
    sim, desc, nav = (get_package_share_directory(p) for p in ("mekoniq_simulation", "mekoniq_description", "mekoniq_navigation"))
    ns, headless = LaunchConfiguration("namespace"), LaunchConfiguration("headless")
    world = os.path.join(sim, "worlds", "restaurant.sdf")
    gz_launch = os.path.join(get_package_share_directory("ros_gz_sim"), "launch", "gz_sim.launch.py")
    robot_description = ParameterValue(Command(["xacro ", os.path.join(desc, "urdf", "restaurant_robot.urdf.xacro"), " namespace:=", ns]), value_type=str)
    return LaunchDescription([
        DeclareLaunchArgument("namespace", default_value="robot_1"),
        DeclareLaunchArgument("headless", default_value="true", description="true: gz sim -s --headless-rendering (no GUI)"),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(gz_launch), condition=IfCondition(headless),
                                 launch_arguments={"gz_args": f"-r -s --headless-rendering {world}", "on_exit_shutdown": "true"}.items()),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(gz_launch), condition=UnlessCondition(headless),
                                 launch_arguments={"gz_args": f"-r {world}", "on_exit_shutdown": "true"}.items()),
        Node(package="robot_state_publisher", executable="robot_state_publisher", namespace=ns, output="screen",
             parameters=[{"robot_description": robot_description, "use_sim_time": True}], remappings=[("/tf", "tf"), ("/tf_static", "tf_static")]),
        Node(package="ros_gz_sim", executable="create", output="screen",
             arguments=["-world", "restaurant", "-topic", PathJoinSubstitution(["/", ns, "robot_description"]), "-name", "robot",
                        "-x", str(SPAWN[0]), "-y", str(SPAWN[1]), "-z", "0.02", "-Y", str(SPAWN[2])]),
        OpaqueFunction(function=_bridge),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(nav, "launch", "navigation.launch.py")),
                                 launch_arguments={"namespace": ns, "use_sim_time": "true",
                                                   "map": os.path.join(nav, "maps", "restaurant_sim.yaml")}.items()),
    ])
