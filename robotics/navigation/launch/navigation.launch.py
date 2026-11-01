"""Nav2 for one robot: localization (map_server + AMCL) and navigation, explicit node list (no teleop, no docking/route servers).

cmd_vel arbitration: controller_server -> cmd_vel_nav -> velocity_smoother -> cmd_vel_smoothed -> collision_monitor -> cmd_vel. The ONLY
publisher of `cmd_vel` is collision_monitor; there is no twist_mux and the platform never publishes motor commands.
Arguments: namespace (per robot profile, default ""), map (yaml path), params_file, use_sim_time, autostart."""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, GroupAction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node, PushROSNamespace
from launch_ros.descriptions import ParameterFile
from nav2_common.launch import RewrittenYaml

LOCALIZATION = ["map_server", "amcl"]
NAVIGATION = ["controller_server", "smoother_server", "planner_server", "behavior_server", "bt_navigator", "velocity_smoother", "collision_monitor"]


def generate_launch_description():
    share = get_package_share_directory("mekoniq_navigation")
    namespace, use_sim_time, autostart = (LaunchConfiguration(k) for k in ("namespace", "use_sim_time", "autostart"))
    params = ParameterFile(RewrittenYaml(source_file=LaunchConfiguration("params_file"), root_key=namespace,
                                         param_rewrites={"use_sim_time": use_sim_time, "yaml_filename": LaunchConfiguration("map")}, convert_types=True),
                           allow_substs=True)
    tf = [("/tf", "tf"), ("/tf_static", "tf_static")]

    def node(name, pkg, exe=None, remap=()):
        return Node(package=pkg, executable=exe or name, name=name, output="screen", parameters=[params], remappings=tf + list(remap))

    def manager(name, nodes):
        return Node(package="nav2_lifecycle_manager", executable="lifecycle_manager", name=name, output="screen",
                    parameters=[{"use_sim_time": use_sim_time, "autostart": autostart, "node_names": nodes, "bond_timeout": 10.0}])  # default 4 s drops the stack when the host stalls

    nav = {"controller_server": ("nav2_controller", [("cmd_vel", "cmd_vel_nav")]), "smoother_server": ("nav2_smoother", []),
           "planner_server": ("nav2_planner", []), "behavior_server": ("nav2_behaviors", [("cmd_vel", "cmd_vel_nav")]),
           "bt_navigator": ("nav2_bt_navigator", []), "velocity_smoother": ("nav2_velocity_smoother", [("cmd_vel", "cmd_vel_nav")]),
           "collision_monitor": ("nav2_collision_monitor", [])}
    return LaunchDescription([
        DeclareLaunchArgument("namespace", default_value=""),
        DeclareLaunchArgument("map", default_value=os.path.join(share, "maps", "restaurant_sim.yaml")),
        DeclareLaunchArgument("params_file", default_value=os.path.join(share, "config", "nav2_params.yaml")),
        DeclareLaunchArgument("use_sim_time", default_value="false"),
        DeclareLaunchArgument("autostart", default_value="true"),
        GroupAction([PushROSNamespace(namespace),
                     node("map_server", "nav2_map_server"), node("amcl", "nav2_amcl"), manager("lifecycle_manager_localization", LOCALIZATION),
                     *[node(n, pkg, remap=r) for n, (pkg, r) in nav.items()], manager("lifecycle_manager_navigation", NAVIGATION)]),
    ])
