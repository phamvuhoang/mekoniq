"""Portable protocol doubles; never native X1/X2/X3 evidence."""
import copy
import json
import math
from pathlib import Path
import pytest
from native_xarm.policy import load_profile, launch_argv, map_joints, validate_trajectory, assess_contact, prerequisites, verify_vendor
from native_xarm.session import Session

ROOT=Path(__file__).resolve().parents[3]
Q=[0,0,-1,0,0,0]

class Port:
    evidence_kind='protocol_double'
    def __init__(self):self.sends=0;self.answer='accepted';self.outcome='running';self.canceled=True;self.fail=False
    def send(self, points):
        self.sends+=1
        if self.fail:raise TimeoutError('lost')
        return self.answer
    def result(self):return self.outcome
    def cancel(self):return self.canceled

@pytest.fixture
def session(tmp_path):
    p=Port();s=Session(tmp_path/'journal.json',p,'run-1','boot-1',1,now=lambda:100)
    s.observe({'bootId':'boot-1','epoch':1,'seq':1,'clockNs':1000000000,'stampNs':1000000000,'actualRad':Q,'commandedRad':Q,'tcpM':[0,0,.172]},100)
    return s,p

def points():return [{'positions':Q,'timeS':1},{'positions':[.01,0,-1,0,0,0],'timeS':2}]

def test_fixed_simulation_profiles_and_vendor_hashes():
    p=load_profile();assert p['target']['model1300'] is False and p['target']['gripper_version']=='G2'
    for case,plugin in [('X1','uf_robot_hardware/UFRobotFakeSystemHardware'),('X2','gz_ros2_control/GazeboSimSystem')]:
        a=launch_argv(case);assert 'gripper_version:=G2' in a and 'model1300:=false' in a
        assert p['modes'][case]['plugin']==plugin
        assert all('robot_ip' not in x for x in a)
    assert 'gz_type:=gz' in launch_argv('X2')
    with pytest.raises(ValueError):launch_argv('X3')
    assert verify_vendor()==[]
    assert 'NATIVE_MAPPING_NOT_OBSERVED' in prerequisites()
    assert 'INVENTORY_UNRESOLVED' in prerequisites()

def test_joint_order_units_limits_and_fk_inputs():
    assert map_joints(['joint6','joint2','joint1','joint4','joint5','joint3'],[6,2,1,4,5,3])==[1,2,3,4,5,6]
    for names,values in [(['joint1']*6,[0]*6),(['joint1'],[0]),([f'joint{i}' for i in range(1,7)],[0]*5+[math.nan])]:
        with pytest.raises(ValueError):map_joints(names,values)
    validate_trajectory(points(),Q)
    for trajectory in [[],[{'positions':[math.nan]*6,'timeS':1}],[{'positions':[0]*6,'timeS':0}],[{'positions':[0,3,0,0,0,0],'timeS':1}],[{'positions':[2,0,-1,0,0,0],'timeS':.001}]]:
        with pytest.raises(ValueError):validate_trajectory(trajectory,Q)

def test_durable_idempotency_and_restart_refusal(session,tmp_path):
    s,p=session
    assert s.execute('a','hash',points())['accepted']
    assert s.execute('a','hash',points())['accepted'];assert p.sends==1
    assert s.execute('a','other',points())['reason']=='COMMAND_ID_CONFLICT'
    with pytest.raises(RuntimeError,match='RESTART_RECONCILE_REQUIRED'):Session(tmp_path/'journal.json',p,'run-1','boot-1',1)

def test_lost_ack_is_latched_without_resend_or_late_success(session):
    s,p=session;p.fail=True
    assert s.execute('a','h',points())['unknown'];p.fail=False;p.outcome='completed'
    assert s.query('a')['status']=='unknown'
    assert s.execute('a','h',points())['unknown'];assert p.sends==1
    assert s.execute('b','h',points())['unknown'];assert p.sends==1

@pytest.mark.parametrize('change',[{'actualRad':None},{'seq':1},{'epoch':2},{'bootId':'restarted'},{'clockNs':1},{'stampNs':0}])
def test_bad_feedback_latches_unknown(session,change):
    s,p=session;s.execute('a','h',points());p.outcome='completed'
    sample={'bootId':'boot-1','epoch':1,'seq':2,'clockNs':1020000000,'stampNs':1020000000,'actualRad':Q,'commandedRad':Q,'tcpM':[0,0,.172]};sample.update(change)
    s.observe(sample,110)
    assert s.query('a')['status']=='unknown';assert s.execute('b','h',points())['unknown'];assert p.sends==1

def test_result_lost_cancel_timeout_and_stale_feedback(session):
    s,p=session;s.execute('a','h',points());p.outcome='unknown'
    assert s.query('a')['status']=='unknown';p.outcome='completed';assert s.query('a')['status']=='unknown'

def test_cancel_timeout(session):
    s,p=session;s.execute('a','h',points());p.canceled=False
    assert s.cancel('a')['unknown'];p.outcome='completed';assert s.query('a')['status']=='unknown'

def test_fresh_completion_requires_observed_target(session):
    s,p=session;s.execute('a','h',points());p.outcome='completed'
    assert s.query('a')['status']=='unknown'

def test_no_command_when_feedback_expired(session):
    s,p=session;s.now=lambda:601
    assert s.execute('a','h',points())['unknown'];assert p.sends==0

def test_motion_does_not_qualify_contact():
    assert assess_contact({'evidenceKind':'ros2_fake_system','trials':[]})['result']=='not_run'
    assert assess_contact({'evidenceKind':'gazebo_actual','trials':[]})['result']=='not_run'
    trial={'grip':True,'release':True,'supportObserved':True,'receiverObserved':True,'collisionExclusionsSha256':'a'*64}
    assert assess_contact({'evidenceKind':'protocol_double','trials':[trial]*10})['result']=='not_run'
    assert assess_contact({'evidenceKind':'gazebo_actual','trials':[trial]*10})['result']=='not_run' # unresolved native G2 mapping

def test_native_readback_producer_validates_raw_model(tmp_path):
    from native_xarm.mapping import produce_mapping,validate_urdf
    xml=(ROOT/'tests/fixtures/xarm-native-protocol.urdf').read_text()
    report=produce_mapping(xml,'X2',tmp_path)
    assert report['scope']=='arm_motion_kinematics_only'
    for bad in [xml.replace('0.172','0.142'),xml.replace('name="joint1"','name="joint9"'),xml.replace('GazeboSimSystem','UFRobotSystemHardware'),xml.replace('xyz="0 0 1"','xyz="0 0 -1"')]:
        with pytest.raises(ValueError):validate_urdf(bad,'X2')

def test_typed_ros_action_outcomes_and_cancel():
    from types import SimpleNamespace as N
    from native_xarm.ros import RosPort
    class Future:
        def __init__(self,value,done=True):self.value=value;self.ready=done
        def done(self):return self.ready
        def result(self):return self.value
    class Goal:
        def __init__(self):self.trajectory=N(joint_names=[],points=[]);self.goal_time_tolerance=N(sec=0,nanosec=0)
    class Point:
        def __init__(self):self.time_from_start=N(sec=0,nanosec=0)
    handle=N(accepted=True,get_result_async=lambda:Future(N(status=4,result=N(error_code=0))),cancel_goal_async=lambda:Future(N(goals_canceling=[1])))
    seen=[]
    client=N(wait_for_server=lambda timeout_sec:True,send_goal_async=lambda goal:(seen.append(goal) or Future(handle)))
    port=RosPort.__new__(RosPort);port.client=client;port.Goal=Goal;port.Point=Point;port.handle=None;port.result_future=None
    assert port.send(points())=='accepted';assert seen[0].trajectory.joint_names==[f'joint{i}' for i in range(1,7)]
    assert seen[0].trajectory.points[1].positions==points()[1]['positions']
    assert port.result()=='completed';assert port.cancel() is True
    port.result_future=Future(N(status=4,result=N(error_code=-4)));assert port.result()=='failed'
    port.result_future=Future(None,False);assert port.result()=='running'
    port.result_future=Future(N(status=5,result=N(error_code=0)));assert port.result()=='canceled'

def test_worker_public_preflight_does_not_load_ros(tmp_path):
    import subprocess,sys,os
    result=subprocess.run([sys.executable,'-m','native_xarm.worker','--directory',str(tmp_path),'--run-id','x','--mode','X2','--environment-profile','engineering-arm64'],env=os.environ,capture_output=True,text=True,timeout=20)
    assert result.returncode==2
    report=json.loads(result.stdout.strip());assert report['kind']=='refusal';assert 'INVENTORY_UNRESOLVED' in report['reasons']
    assert not (tmp_path/'launch.log').exists()

def test_success_is_actual_and_lost_result_does_not_mask_timeout(session):
    s,p=session;s.execute('a','h',points());p.outcome='completed'
    s.observe({'bootId':'boot-1','epoch':1,'seq':2,'clockNs':1020000000,'stampNs':1020000000,'actualRad':points()[-1]['positions'],'commandedRad':points()[-1]['positions'],'tcpM':[0,0,.172]},110)
    s.now=lambda:110
    assert s.query('a')['status']=='completed'

@pytest.mark.parametrize('mode',['X1','X2'])
def test_prepared_worker_lifecycle_uses_fixed_launch_and_owned_shutdown(tmp_path,monkeypatch,mode):
    import io,sys
    from types import SimpleNamespace as N
    import native_xarm.worker as worker
    import native_xarm.ros as ros
    calls=[];children=[]
    for key in ['ROS_DOMAIN_ID','ROS_LOCALHOST_ONLY','GZ_PARTITION']:monkeypatch.setenv(key,'protocol_test')
    monkeypatch.setattr(worker.signal,'signal',lambda *a:None)
    class Child:
        def __init__(self,argv,**kwargs):calls.append(argv);self.stopped=False;children.append(self)
        def poll(self):return 0 if self.stopped else None
        def send_signal(self,sig):self.stopped=True
        def wait(self,timeout):return 0
    class Ros:
        def __init__(self,mode,boot,emit):self.boot=boot;self.evidence_kind='protocol_double';self.closed=False
        def sample(self):return {'bootId':self.boot,'epoch':1,'seq':1,'clockNs':1000000000,'stampNs':1000000000,'actualRad':Q,'commandedRad':Q,'tcpM':[0,0,.172]}
        def readback(self):
            xml=(ROOT/'tests/fixtures/xarm-native-protocol.urdf').read_text()
            if mode=='X1':
                import re
                xml=re.sub(r'<gazebo><plugin filename="gz_ros2_control-system"[\s\S]*?</gazebo>','',xml)
                xml=xml.replace('gz_ros2_control/GazeboSimSystem','uf_robot_hardware/UFRobotFakeSystemHardware').replace('file://'+load_profile()['descriptionShare'],'package://xarm_description')
            return {'/robot_state_publisher':{'robot_description':{'string':xml}}}
        def close(self):self.closed=True
    monkeypatch.setattr(worker,'preflight',lambda profile:({'reasonCodes':[]},[]))
    monkeypatch.setattr(worker.subprocess,'Popen',Child)
    monkeypatch.setattr(worker.subprocess,'run',lambda argv,**kwargs:N(returncode=0,stdout='1'*40 if argv[:2]==['git','rev-parse'] else ''))
    monkeypatch.setattr(ros,'RosPort',Ros)
    monkeypatch.setattr(sys,'argv',['worker','--directory',str(tmp_path),'--run-id','protocol-case-'+mode,'--mode',mode,'--environment-profile','engineering-arm64'])
    monkeypatch.setattr(sys,'stdin',io.StringIO(''))
    assert worker.main()==0
    assert calls[0]==launch_argv(mode);assert len(children)==2 and all(c.stopped for c in children)
    assert json.loads((tmp_path/'native-shutdown.json').read_text())['blockers']==['BAG_STORAGE_MISSING']
    assert json.loads((tmp_path/'mapping.json').read_text())['evidenceKind']=='protocol_double'
    with pytest.raises(FileExistsError):worker.main()

def test_ros_observer_uses_actual_reference_and_detects_endpoint_restart(monkeypatch):
    from types import SimpleNamespace as N
    import sys
    from native_xarm.ros import RosPort
    monkeypatch.setitem(sys.modules,'rclpy.time',N(Time=lambda **kw:kw))
    p=RosPort.__new__(RosPort);p.mode='X2';p.clock=1000000000;p.clock_receipt=1000000000;p.fatal=None;p.boot_id='boot';p.seq=0;p.controller_identity=None
    publisher=N(endpoint_gid=[1,2]);p.node=N(get_publishers_info_by_topic=lambda topic:[publisher])
    stamp=N(sec=1,nanosec=0);header=N(stamp=stamp)
    q=Q.copy();p.joints=(N(header=header,name=[f'joint{i}' for i in range(1,7)],position=q),1000000000)
    p.controller=(N(header=header,joint_names=[f'joint{i}' for i in range(1,7)],reference=N(positions=[.02,*q[1:]]),feedback=N(positions=q)),1000000000)
    p.tf=N(lookup_transform=lambda *a:N(transform=N(translation=N(x=0,y=0,z=.172))))
    monkeypatch.setattr('native_xarm.ros.time.monotonic_ns',lambda:1000000000)
    s=p.sample();assert s['actualRad']==q and s['commandedRad']!=q
    publisher.endpoint_gid=[3,4]
    with pytest.raises(RuntimeError,match='CONTROLLER_RESTART'):p.sample()

def test_completion_needs_feedback_after_dispatch(session):
    s,p=session;target=[{'positions':Q,'timeS':1}];s.execute('a','h',target);p.outcome='completed'
    assert s.query('a')['status']=='unknown'

def test_retained_bag_is_verified_copy_and_source_remains(tmp_path):
    import sqlite3,hashlib
    from native_xarm.worker import finish_bag
    original=tmp_path/'raw-bag';original.mkdir();path=original/'data.db3'
    con=sqlite3.connect(path);con.executescript('CREATE TABLE topics(id INTEGER,name TEXT);CREATE TABLE messages(id INTEGER,topic_id INTEGER,timestamp INTEGER,data BLOB);INSERT INTO topics VALUES(1,"/joint_states");INSERT INTO messages VALUES(1,1,100,x\'0102\');');con.commit();con.close()
    before=hashlib.sha256(path.read_bytes()).hexdigest();report=finish_bag(tmp_path)
    assert report['blockers']==[] and (tmp_path/'verified-bag/data.db3').exists()
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before
    assert json.loads((tmp_path/'bag-coverage.json').read_text())['topics']['/joint_states']['count']==1

def test_fixed_selector_decodes_exact_1305_br2_and_is_not_a_hardware_identity():
    from native_xarm.policy import decode_sim_selector
    p=load_profile();selector=p['syntheticSimModelSelector']
    assert selector=='XI13050520BB00'
    assert decode_sim_selector(selector)=={'modelNum':1305,'modelType':6,'dateCode':2005,'massType':11,'inertialFile':'xarm6_type6_HT_BR2'}
    assert decode_sim_selector('XI13050120BB00')['massType']==1
    assert decode_sim_selector('XI13000520BB00')['modelNum']==1300
    assert 'robot_sn:='+selector in launch_argv('X1')
    assert 'robot_sn:='+selector in launch_argv('X2')

def test_raw_mapping_rejects_nominal_inertia_substitution():
    from native_xarm.mapping import validate_urdf
    xml=(ROOT/'tests/fixtures/xarm-native-protocol.urdf').read_text()
    import re
    with pytest.raises(ValueError):validate_urdf(re.sub(r'<inertial>[\s\S]*?</inertial>','',xml),'X2')

def test_gazebo_mesh_readback_uses_only_fixed_installed_share():
    from native_xarm.mapping import validate_urdf
    xml=(ROOT/'tests/fixtures/xarm-native-protocol.urdf').read_text()
    # The initial fixture used package://; pinned Gazebo xacro emits file:// instead.
    with pytest.raises(ValueError):validate_urdf(xml.replace('file:///opt/mekoniq/xarm_ws/install/xarm_description/share/xarm_description/','package://xarm_description/'),'X2')

def test_delayed_callback_keeps_original_receipt_age(session):
    s,p=session
    s.observe({'bootId':'boot-1','epoch':1,'seq':2,'clockNs':1020000000,'stampNs':1020000000,'actualRad':Q,'commandedRad':Q,'tcpM':[0,0,.172],'receivedMs':-1000})
    assert s.execute('a','h',points())['unknown'];assert p.sends==0

@pytest.mark.parametrize('case',['scale','visual_origin','missing_tcp','orphan','cycle','gazebo_plugin','empty_control'])
def test_fix1_mapping_closed_semantics(case):
    from native_xarm.mapping import validate_urdf
    import re
    xml=(ROOT/'tests/fixtures/xarm-native-protocol.urdf').read_text()
    bad={'scale':xml.replace('<mesh ','<mesh scale="1000 1000 1000" ',1),'visual_origin':xml.replace('<visual>','<visual><origin xyz="100 0 0" rpy="0 0 0"/>',1),'missing_tcp':xml.replace('<link name="link_tcp"/>',''),'orphan':xml.replace('</robot>','<link name="orphan"/></robot>'),'cycle':xml.replace('</robot>','<joint name="cycle" type="fixed"><parent link="link_tcp"/><child link="link_base"/></joint></robot>'),'gazebo_plugin':xml.replace('</robot>','<gazebo><plugin name="unapproved" filename="libunapproved.so"/></gazebo></robot>'),'empty_control':re.sub(r'<ros2_control[\s\S]*?</ros2_control>','<ros2_control name="xarm6" type="system"><hardware><plugin>gz_ros2_control/GazeboSimSystem</plugin></hardware></ros2_control>',xml)}[case]
    with pytest.raises(ValueError):validate_urdf(bad,'X2')

@pytest.mark.parametrize('mode',['X1','X2'])
def test_fix1_mode_graph_control_and_visual_defaults(mode):
    from native_xarm.mapping import validate_urdf
    import re
    xml=(ROOT/'tests/fixtures/xarm-native-protocol.urdf').read_text()
    if mode=='X1':xml=re.sub(r'<gazebo><plugin filename="gz_ros2_control-system"[\s\S]*?</gazebo>','',xml).replace('gz_ros2_control/GazeboSimSystem','uf_robot_hardware/UFRobotFakeSystemHardware').replace('file://'+load_profile()['descriptionShare'],'package://xarm_description')
    validate_urdf(xml,mode)
    validate_urdf(xml.replace('<visual>','<visual><origin xyz="0 0 0" rpy="0 0 0"/>').replace('<mesh ','<mesh scale="1 1 1" '),mode)
    validate_urdf(xml.replace('xyz="0 0 0"','xyz="+0e0 0.0 -.0"').replace('<offset>0</offset>','<offset>0e+0</offset>'),mode)
    mutations=[('<link name="world"/>',''),('<link name="link_eef"/>',''),('parent link="world"','parent link="missing"'),('parent link="world"','parent link="link_tcp"'),('parent link="link_eef"','parent link="link6"'),('<visual>','<visual><origin rpy="0 0 1"/>'),('<state_interface name="velocity"/>','<state_interface name="effort"/>'),('<joint name="joint1"><command_interface','<joint name="joint6"><command_interface'),('<mimicJoint>left_finger_joint</mimicJoint>','<mimicJoint>joint1</mimicJoint>'),('<mimic joint="drive_joint"','<mimic joint="joint1"'),('</hardware>','<param name="robot_ip">192.0.2.1</param></hardware>'),('<visual>','<visual><plugin name="evil"/>')]
    if mode=='X2':mutations.append(('/tmp/launch_params_protocolfixture','/tmp/../evil'))
    for old,new in mutations:
        bad=xml.replace(old,new,1);assert bad!=xml
        with pytest.raises(ValueError):validate_urdf(bad,mode)

def test_fix1_rejects_non_urdf_numeric_spelling():
    from native_xarm.mapping import validate_urdf
    xml=(ROOT/'tests/fixtures/xarm-native-protocol.urdf').read_text()
    for bad in [xml.replace('<offset>0</offset>','<offset> </offset>'),xml.replace('<offset>0</offset>','<offset/>'),xml.replace('<offset>0</offset>','<offset>0x0</offset>'),xml.replace('<offset>0</offset>','<offset>0_0</offset>'),xml.replace('xyz="0 0 0"','xyz="0_0 0 0"',1)]:
        with pytest.raises(ValueError):validate_urdf(bad,'X2')
