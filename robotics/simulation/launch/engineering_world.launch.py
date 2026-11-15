"""Canonical engineering AMR only. Gazebo starts paused; the owned worker controls activation."""
import json
import os
import sys
from pathlib import Path
import yaml
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, OpaqueFunction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from bridge.engineering_launch import plan_engineering_launch


def setup(context):
    bundle=Path(LaunchConfiguration('bundle').perform(context)); plan=plan_engineering_launch(bundle); r=plan['robots'][0]; ns=r['namespace']
    native=bundle/'.native';native.mkdir(exist_ok=True)
    urdf=(bundle/'robots/amr-1.urdf').read_text().replace('__ENGINEERING_CONTROLLER_FILE__',str(bundle/'controllers/amr-1.yaml'))
    (native/'spawn.urdf').write_text(urdf)
    scene=json.loads((bundle/'navigation-scene.json').read_text());model=scene['robots'][0]['model'];kin=model['kinematics']
    nav=Path(get_package_share_directory('mekoniq_navigation'))
    params=yaml.safe_load((nav/'config/nav2_params.yaml').read_text())
    def rewrite(value):
        if isinstance(value,dict):
            for key,v in value.items():
                if key in ('base_frame_id','robot_base_frame','base_frame'): value[key]=r['baseFrame']
                elif key in ('odom_frame_id','odom_frame'): value[key]='odom'
                elif key=='odom_topic':value[key]='odom'
                else:rewrite(v)
        elif isinstance(value,list):
            for v in value:rewrite(v)
    rewrite(params)
    amcl=params['amcl']['ros__parameters'];amcl.update({'set_initial_pose':True,'initial_pose':{**{k:r['spawn'][k] for k in ('x','y','yaw')},'z':0.0}})
    for cm in ('local_costmap','global_costmap'):
        params[cm][cm]['ros__parameters']['footprint']=json.dumps(model['footprint']['verticesM'])
    params['velocity_smoother']['ros__parameters']['max_velocity']=[kin['maxLinearMps'],0.0,kin['maxAngularRadps']]
    param_file=native/'nav2.yaml';param_file.write_text(yaml.safe_dump(params))
    spawn=r['spawn']; gz=Path(get_package_share_directory('ros_gz_sim'))/'launch/gz_sim.launch.py'
    return [IncludeLaunchDescription(PythonLaunchDescriptionSource(str(gz)),launch_arguments={'gz_args':f'-s --headless-rendering {bundle}/world.sdf','on_exit_shutdown':'true'}.items()),
            Node(package='robot_state_publisher',executable='robot_state_publisher',namespace=ns,parameters=[{'robot_description':urdf,'use_sim_time':True}],remappings=[('/tf','tf'),('/tf_static','tf_static')]),
            Node(package='ros_gz_sim',executable='create',arguments=['-world','lab','-file',str(native/'spawn.urdf'),'-name',ns,'-x',str(spawn['x']),'-y',str(spawn['y']),'-z',str(spawn['z']),'-Y',str(spawn['yaw'])]),
            Node(package='controller_manager',executable='spawner',namespace=ns,arguments=['joint_state_broadcaster','diff_drive_controller','--controller-manager',f'/{ns}/controller_manager','--controller-manager-timeout','60','--switch-timeout','60']),
            Node(package='ros_gz_bridge',executable='parameter_bridge',arguments=['/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock',f'/{ns}/scan@sensor_msgs/msg/LaserScan[gz.msgs.LaserScan',f'/model/{ns}/pose@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V',f'/model/{ns}/contacts@ros_gz_interfaces/msg/Contacts[gz.msgs.Contacts']),
            IncludeLaunchDescription(PythonLaunchDescriptionSource(str(nav/'launch/navigation.launch.py')),launch_arguments={'namespace':ns,'use_sim_time':'true','map':plan['map'],'params_file':str(param_file),'autostart':'true'}.items())]


def generate_launch_description():
    return LaunchDescription([DeclareLaunchArgument('bundle'),OpaqueFunction(function=setup)])
