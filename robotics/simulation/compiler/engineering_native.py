"""Explicit Gazebo mapping of L00's canonical AMR documents. No portable scene relabeling.
The original project/scene/model are copied unchanged; native outputs have a separate digest.
Only this audited canonical subject is supported until further mappings get readback tests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import yaml
from .description import render_urdf, dump, g
from .manifest import canonical_hash
from .occupancy import occupancy_pgm, map_identity, map_yaml
from worlds.generate_restaurant import box_sdf

CANONICAL = Path(__file__).resolve().parents[2] / 'simulation-3d/fixtures/serve-3d-v1'
NAMES = ('serve-3d-project.json', 'navigation-scene.json', 'physical-model-amr-1.json')
COMPILER = {'id': 'engineering-gazebo-canonical', 'version': '1'}


def compile_native(project, scene, physical, out_dir):
    for actual, name in zip((project, scene, physical), NAMES):
        if actual != json.loads((CANONICAL / name).read_text()):
            raise ValueError('CANONICAL_INPUT_MISMATCH:' + name)
    robot, ns = scene['robots'][0], 'amr_1'
    drive, sensor = physical['drive'], physical['sensors'][0]
    model, root = robot['model'], physical['baseFrameId']
    k = model['kinematics']
    # Keep link/joint names and every inertial/collider from the physical model.
    urdf = ET.fromstring(render_urdf(physical['robotId'], physical['links'], physical['joints']))
    for link in physical['links']:
        for i, collision in enumerate(urdf.findall(f"link[@name='{link['id']}']/collision")):
            collision.set('name', f"{link['id'].replace('/', '_')}_collision_{i}")
        gz = ET.SubElement(urdf, 'gazebo', reference=link['id'])
        friction = scene['world3d']['casterFriction'] if link['id'].startswith('caster-') else scene['world3d']['floorFriction']
        for tag in ('mu1','mu2'):
            ET.SubElement(gz, tag).text = g(friction)
    for joint in physical['joints']:
        if joint['kind'] == 'fixed':
            ET.SubElement(ET.SubElement(urdf, 'gazebo', reference=joint['id']), 'preserveFixedJoint').text = 'true'
    control = ET.SubElement(urdf, 'ros2_control', name='GazeboSimSystem', type='system')
    ET.SubElement(ET.SubElement(control, 'hardware'), 'plugin').text = 'gz_ros2_control/GazeboSimSystem'
    for joint in (drive['leftJointId'], drive['rightJointId']):
        node = ET.SubElement(control, 'joint', name=joint)
        cmd = ET.SubElement(node, 'command_interface', name='velocity')
        for name, sign in [('min',-1),('max',1)]:
            ET.SubElement(cmd, 'param', name=name).text = g(sign * drive['actuatorMaxSpeedRadps']['value'])
        for name in ('position','velocity'):
            ET.SubElement(node, 'state_interface', name=name)
    plugin = ET.SubElement(ET.SubElement(urdf, 'gazebo'), 'plugin', filename='libgz_ros2_control-system.so', name='gz_ros2_control::GazeboSimROS2ControlPlugin')
    # The trusted launcher substitutes this single path after digest verification.
    ET.SubElement(plugin, 'parameters').text = '__ENGINEERING_CONTROLLER_FILE__'
    ros = ET.SubElement(plugin, 'ros')
    ET.SubElement(ros, 'namespace').text = ns
    ET.SubElement(ros, 'remapping').text = '/tf:=tf'
    ET.SubElement(ros, 'remapping').text = '/tf_static:=tf_static'
    ET.SubElement(ros, 'remapping').text = 'diff_drive_controller/odom:=odom'
    pose = ET.SubElement(ET.SubElement(urdf, 'gazebo'), 'plugin', filename='gz-sim-pose-publisher-system', name='gz::sim::systems::PosePublisher')
    for tag, value in [('publish_model_pose','true'),('publish_link_pose','false'),('use_pose_vector_msg','true'),('update_frequency','50')]:
        ET.SubElement(pose, tag).text = value
    s = sensor['model']
    lidar = ET.SubElement(ET.SubElement(urdf, 'gazebo', reference=sensor['parentLinkId']), 'sensor', name='engineering_lidar', type='gpu_lidar')
    for tag, value in [('topic', f'/{ns}/scan'),('update_rate',g(s['rateHz']['value'])),('always_on','true'),('gz_frame_id',sensor['parentLinkId'])]:
        ET.SubElement(lidar, tag).text = value
    ray = ET.SubElement(lidar, 'lidar')
    horizontal = ET.SubElement(ET.SubElement(ray,'scan'), 'horizontal')
    for tag, value in [('samples',str(s['lidar2d']['beamCount'])),('resolution','1'),('min_angle',g(-s['fieldOfView']['value']/2)),('max_angle',g(s['fieldOfView']['value']/2))]:
        ET.SubElement(horizontal, tag).text = value
    rang = ET.SubElement(ray,'range')
    for tag, value in [('min',g(s['range']['min']['value'])),('max',g(s['range']['max']['value'])),('resolution','0.01')]:
        ET.SubElement(rang,tag).text = value
    contact = ET.SubElement(ET.SubElement(urdf,'gazebo',reference=root),'sensor',name='engineering_contact',type='contact')
    ET.SubElement(contact,'always_on').text='true'
    ET.SubElement(contact,'update_rate').text='50'
    ET.SubElement(contact,'topic').text=f'/model/{ns}/contacts'
    ET.SubElement(ET.SubElement(contact,'contact'),'collision').text=root.replace('/','_')+'_collision_0'
    controllers={'controller_manager': {'ros__parameters': {'update_rate':100,'use_sim_time':True,'diff_drive_controller':{'type':'diff_drive_controller/DiffDriveController'},'joint_state_broadcaster':{'type':'joint_state_broadcaster/JointStateBroadcaster'}}},
                 'diff_drive_controller': {'ros__parameters': {'left_wheel_names':[drive['leftJointId']], 'right_wheel_names':[drive['rightJointId']], 'wheel_radius':drive['wheelRadiusM']['value'],'wheel_separation':drive['wheelSeparationM']['value'],'base_frame_id':root,'odom_frame_id':'odom','tf_frame_prefix_enable':False,'enable_odom_tf':True,'open_loop':False,'publish_rate':50.0,'cmd_vel_timeout':0.5,
                    'linear':{'x':{'has_velocity_limits':True,'max_velocity':k['maxLinearMps'],'min_velocity':-k['maxLinearMps']}},'angular':{'z':{'has_velocity_limits':True,'max_velocity':k['maxAngularRadps'],'min_velocity':-k['maxAngularRadps']}}}}}
    # Wildcard namespace is local to this isolated ROS domain, with exactly one robot.
    controllers={f'/amr_1/{name}':value for name,value in controllers.items()}
    world=scene['world']; rects=[]; boxes=[]
    for boundary in [*world['boundaries'],*world['obstacles']]:
        points=boundary['verticesM']; x=min(v[0] for v in points); y=min(v[1] for v in points); w=max(v[0] for v in points)-x; h=max(v[1] for v in points)-y
        rects.append((x,y,w,h)); height=scene['world3d']['wallHeightM'] if boundary in world['boundaries'] else scene['world3d']['obstacleHeightM']
        boxes.append(box_sdf(boundary['id'],x+w/2,y+h/2,w,h,height))
    # Dormant static case fixtures are outside the navigable world until a server-selected fault moves them.
    for i,(w,h) in enumerate([(0.8,0.8),(0.2,1.6),(0.2,1.6),(1.6,0.2),(1.6,0.2)]):
        boxes.append(box_sdf(f'engineering_fault_{i}',-10-i*2,-10,w,h,1.2))
    plugins=''.join(f'<plugin filename="gz-sim-{name}-system" name="gz::sim::systems::{cls}"/>' for name,cls in [('physics','Physics'),('user-commands','UserCommands'),('scene-broadcaster','SceneBroadcaster'),('contact','Contact')])
    friction=g(scene['world3d']['floorFriction'])
    sdf=f'''<sdf version="1.9"><world name="lab"><physics name="fixed" type="ignored"><max_step_size>0.002</max_step_size><real_time_factor>1</real_time_factor></physics>{plugins}<plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors"><render_engine>ogre2</render_engine></plugin><model name="floor"><static>true</static><link name="floor"><collision name="floor"><geometry><plane><normal>0 0 1</normal><size>{world['widthM']} {world['heightM']}</size></plane></geometry><surface><friction><ode><mu>{friction}</mu><mu2>{friction}</mu2></ode></friction></surface></collision></link></model>{''.join(boxes)}</world></sdf>'''
    map_id='eng-'+project['id']; revision=str(world['revision']); pgm=occupancy_pgm(rects,world['widthM'],world['heightM'])
    _, identity=map_identity(map_id,revision,world['hash'],pgm,world['widthM'],world['heightM'])
    bindings={t['pointId']:{'waypointId':t['pointId'],'mapId':map_id,'mapRevision':revision,'frame':'map',**{k:t[k] for k in ('x','y','yaw')}} for t in robot['targetBindings']}
    footprint=model['footprint']['verticesM']; spawn=dict(zip(('x','y','yaw'),robot['initialPoseMap'])); spawn['z']=drive['wheelRadiusM']['value']
    robot_entry={'entityId':physical['robotId'],'namespace':ns,'spawn':spawn,'footprint':{'min':[min(v[i] for v in footprint) for i in (0,1)],'max':[max(v[i] for v in footprint) for i in (0,1)]},'baseFrame':root,'sensorFrame':sensor['parentLinkId']}
    mapping={'schemaVersion':1,'kind':'engineering-gazebo-canonical-v1','compiler':COMPILER,'projectDigest':physical['inputs']['project']['digest'],'navigationSceneDigest':scene['sceneDigest'],'physicalModelDigest':physical['modelDigest'],'calibration':'not_calibrated','sourceUnits':{'length':'m','angle':'rad'},'profiles':['engineering-amd64','engineering-arm64'],'targetBackendSet':'engineering-rigid-v1','frameMap':{'world':'map','base':root,'odom':'odom','sensor':sensor['parentLinkId']},'jointMap':[drive['leftJointId'],drive['rightJointId']],'assumptions':['mass, inertia, friction and sensor parameters are assumed','ideal velocity actuation; no torque/current/voltage model']}
    files={'world.sdf':sdf.encode(),'robots/amr-1.urdf':ET.tostring(urdf),'controllers/amr-1.yaml':yaml.safe_dump(controllers).encode(),'map.pgm':pgm,'map.yaml':map_yaml().encode(),'map.identity.json':identity,'bindings.json':dump({'frame':'map','mapId':map_id,'mapRevision':revision,'bindings':bindings}),'scene-index.json':dump({'actors':[],'blockers':[]}), 'native-mapping.json':dump(mapping),'engineering-project.json':dump(project),'navigation-scene.json':dump(scene),'physical-model.json':dump(physical),'runtime-project.json':dump(project['runtimeProject'])}
    manifest={'schemaVersion':1,'compiler':COMPILER,'inputHash':canonical_hash([project,scene,physical]),'map':{'mapId':map_id,'mapRevision':revision},'robots':[robot_entry],'outputs':[{'path':p,'sha256':hashlib.sha256(b).hexdigest()} for p,b in sorted(files.items())]}
    manifest['manifestHash']=canonical_hash(manifest); files['compiler-manifest.json']=dump(manifest)
    out=Path(out_dir)
    for name,data in files.items():
        path=out/name; path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    return mapping


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--project',required=True);parser.add_argument('--out',required=True);args=parser.parse_args()
    values=[json.loads(Path(args.project).read_text()),*[json.loads((CANONICAL/n).read_text()) for n in NAMES[1:]]]
    print(json.dumps(compile_native(*values,args.out),sort_keys=True))

if __name__=='__main__':
    main()
