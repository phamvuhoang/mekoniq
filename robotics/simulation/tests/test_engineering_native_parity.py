"""Portable compilation and protocol checks only; these never qualify ROS/Gazebo."""
import copy
import json
import xml.etree.ElementTree as ET
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[3]
FIX = ROOT / 'robotics/simulation-3d/fixtures/serve-3d-v1'


def inputs():
    return [json.loads((FIX / p).read_text()) for p in ('serve-3d-project.json', 'navigation-scene.json', 'physical-model-amr-1.json')]


def test_native_mapping_preserves_canonical_physics_and_single_writer(tmp_path):
    from compiler.engineering_native import compile_native
    project, scene, physical = inputs()
    mapping = compile_native(project, scene, physical, tmp_path)
    assert mapping['physicalModelDigest'] == physical['modelDigest']
    assert mapping['navigationSceneDigest'] == scene['sceneDigest']
    root = ET.parse(tmp_path / 'robots/amr-1.urdf').getroot()
    for link in physical['links']:
        actual = root.find(f"link[@name='{link['id']}']")
        assert float(actual.find('inertial/mass').get('value')) == link['massKg']['value']
        inertia = actual.find('inertial/inertia')
        assert [float(inertia.get(k)) for k in ('ixx','ixy','ixz','iyy','iyz','izz')] == link['inertiaKgM2']
        assert len(actual.findall('collision')) == len(link['collision'])
    assert root.find('ros2_control/hardware/plugin').text == 'gz_ros2_control/GazeboSimSystem'
    assert len(root.findall('ros2_control/joint')) == 2
    assert 'DiffDrive' not in (tmp_path / 'robots/amr-1.urdf').read_text()
    assert root.find("gazebo/plugin[@name='gz_ros2_control::GazeboSimROS2ControlPlugin']") is not None
    assert root.find('.//sensor[@type="gpu_lidar"]') is not None
    assert mapping['calibration'] == 'not_calibrated'
    assert compile_native(project, scene, physical, tmp_path / 'again') == mapping


def test_wrong_physical_model_or_legacy_project_is_refused_before_writes(tmp_path):
    from compiler.engineering_native import compile_native
    project, scene, physical = inputs()
    wrong = copy.deepcopy(physical)
    wrong['links'][0]['massKg']['value'] += 1
    for args in [(project, scene, wrong), (project['runtimeProject'], scene, physical)]:
        with pytest.raises(ValueError, match='CANONICAL_INPUT_MISMATCH'):
            compile_native(*args, tmp_path / 'rejected')
    assert not (tmp_path / 'rejected').exists()


def test_clock_reset_and_stale_feedback_fail_closed():
    from bridge.engineering_worker import NativeClockMapping
    clock = NativeClockMapping()
    assert clock.observe(1_000_000_000, 50)['sourceTick'] == 0
    assert clock.observe(1_040_000_000, 100)['sourceTick'] == 2
    with pytest.raises(RuntimeError, match='CLOCK_RESET'):
        clock.observe(1_000_000_000, 110)
    with pytest.raises(RuntimeError, match='CLOCK_FAILED'):
        clock.observe(1_060_000_000, 120)
    clock = NativeClockMapping()
    clock.observe(100, 100)
    with pytest.raises(RuntimeError, match='FEEDBACK_STALE'):
        clock.check_fresh(600_000_101)


def test_native_launch_rejects_missing_plugin_and_foreign_bundle(tmp_path):
    from compiler.engineering_native import compile_native
    from bridge.engineering_launch import plan_engineering_launch
    compile_native(*inputs(), tmp_path)
    plan = plan_engineering_launch(tmp_path)
    assert plan['robots'][0]['namespace'] == 'amr_1'
    assert '/clock' in plan['topics'] and '/amr_1/scan' in plan['topics']
    assert plan['actions'] == ['/amr_1/navigate_to_pose']
    path = tmp_path / 'robots/amr-1.urdf'
    path.write_text(path.read_text().replace('gz_ros2_control/GazeboSimSystem', 'evil/Hardware'))
    with pytest.raises(ValueError, match='BUNDLE_DIGEST_MISMATCH'):
        plan_engineering_launch(tmp_path)


def test_resealed_native_bundle_is_reproduced_not_trusted(tmp_path):
    from compiler.engineering_native import compile_native
    from compiler.manifest import canonical_hash
    from bridge.engineering_launch import plan_engineering_launch
    import hashlib
    compile_native(*inputs(),tmp_path)
    path=tmp_path/'robots/amr-1.urdf';path.write_text(path.read_text().replace('gz_ros2_control/GazeboSimSystem','evil/Hardware'))
    manifest=json.loads((tmp_path/'compiler-manifest.json').read_text())
    for entry in manifest['outputs']:
        if entry['path']=='robots/amr-1.urdf':entry['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    manifest['manifestHash']=canonical_hash({k:v for k,v in manifest.items() if k!='manifestHash'})
    (tmp_path/'compiler-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError,match='NATIVE_MAPPING_MISMATCH'):
        plan_engineering_launch(tmp_path)


def test_bag_replay_reads_message_times_not_claimed_metadata(tmp_path):
    import sqlite3
    from bridge.engineering_bag import inspect_bag
    conn=sqlite3.connect(tmp_path/'test.db3');conn.executescript('create table topics(id integer,name text);create table messages(topic_id integer,timestamp integer);insert into topics values(1,"/clock");insert into messages values(1,1000000000);insert into messages values(1,2000000000);');conn.close()
    (tmp_path/'metadata.yaml').write_text('fake: complete')
    assert inspect_bag(tmp_path)['topics']['/clock']=={'count':2,'firstNs':'1000000000','lastNs':'2000000000','maxGapNs':'1000000000'}


def test_native_protocol_refuses_stale_tf_and_keeps_lost_ack_unknown(tmp_path):
    from bridge.engineering_session import EngineeringNav2Session
    from test_nav2_session import FakePorts,execute_args
    ports=FakePorts(['robot_amr_1']); session=EngineeringNav2Session(ports,'run-1',['robot_amr_1'],tmp_path)
    ports.health_reasons=['TF_MISSING:map:chassis/base']
    assert session.execute(execute_args())['status']=='rejected'
    assert ports.clients['robot_amr_1'].sent==[]
    ports.health_reasons=[];ports.clients['robot_amr_1'].unreachable=True
    assert session.execute(execute_args('lost'))['status']=='unknown'
    ports.clients['robot_amr_1'].unreachable=False
    assert session.execute(execute_args('lost'))['status']=='unknown'
    ports.health_reasons=['SCAN_FEEDBACK_STALE']
    assert session.query({'commandId':'lost','robotId':'robot_amr_1'})['status']=='unknown'


@pytest.mark.parametrize('terminal,code,status',[('ABORTED',208,'failed'),('CANCELED',0,'cancelled')])
def test_native_obstacle_no_path_and_cancel_are_never_completion(tmp_path,terminal,code,status):
    from bridge.engineering_session import EngineeringNav2Session
    from test_nav2_session import FakePorts,execute_args
    ports=FakePorts(['robot_amr_1']); session=EngineeringNav2Session(ports,'run-1',['robot_amr_1'],tmp_path)
    accepted=session.execute(execute_args());ports.clients['robot_amr_1'].settle(accepted['nativeGoalId'],terminal,code)
    assert session.query({'commandId':'cmd-1','robotId':'robot_amr_1'})['status']==status


def test_fault_effects_are_allowlisted_and_owned_by_the_engineering_session(tmp_path):
    from bridge.engineering_session import engineering_fault_poses
    assert len(engineering_fault_poses('obstacle'))==1
    assert len(engineering_fault_poses('no-path'))==4
    for model,pose in engineering_fault_poses('no-path'):
        assert model.startswith('engineering_fault_') and len(pose)==4
    with pytest.raises(ValueError,match='ENGINEERING_CASE_INVALID'):
        engineering_fault_poses('custom-shell')


def test_recovered_bag_is_a_verified_copy_and_original_is_unchanged(tmp_path):
    import sqlite3,hashlib
    from bridge.engineering_bag import retain_recovered_bag,inspect_bag
    raw=tmp_path/'raw';raw.mkdir();file=raw/'run.db3'
    conn=sqlite3.connect(file);conn.executescript('create table topics(id integer,name text);create table messages(id integer,topic_id integer,timestamp integer,data blob);insert into topics values(1,"/clock");insert into messages values(1,1,1000000000,x\'0102\');insert into messages values(2,1,2000000000,x\'0304\');');conn.close()
    before=hashlib.sha256(file.read_bytes()).hexdigest()
    retain_recovered_bag(raw,tmp_path/'copy')
    assert hashlib.sha256(file.read_bytes()).hexdigest()==before
    assert inspect_bag(raw)==inspect_bag(tmp_path/'copy')
    assert json.loads((tmp_path/'copy/retention.json').read_text())[0]['method']=='sqlite-readonly-backup-after-owned-worker-loss'


def test_frozen_native_manifest_matches_current_compiler(tmp_path):
    from compiler.engineering_native import compile_native
    compile_native(*inputs(),tmp_path)
    for name in ('compiler-manifest.json','native-mapping.json'):
        assert (tmp_path/name).read_bytes()==(ROOT/'robotics/simulation/fixtures/engineering-navigation-v1'/name).read_bytes()


@pytest.fixture
def live_engineering_ports(tmp_path, monkeypatch):
    """Actual observer wiring/health; only ROS transport and action server are portable doubles."""
    import sys
    from types import SimpleNamespace as NS
    from bridge import engineering_session as module
    from compiler.engineering_native import compile_native
    from test_nav2_session import FakePorts

    class Buffer:
        def __init__(self): self.edges = set()
        def set_transform(self, msg, authority): self.edges.add((msg.header.frame_id, msg.child_frame_id))
        set_transform_static = set_transform
        def can_transform(self, target, source, at):
            if (target, source) == ('map', 'chassis/base'):
                return {('map', 'odom'), ('odom', 'chassis/base')} <= self.edges
            return (target, source) in self.edges

    class Node:
        def __init__(self): self.callbacks = {}
        def set_parameters(self, _): pass
        def create_subscription(self, kind, topic, callback, qos): self.callbacks[topic] = callback
        def create_publisher(self, *args): return NS(publish=lambda _: None)

    node = Node()
    scene = NS(node=node, executor=NS(add_node=lambda _: None), clock=2_000_000_000)
    monkeypatch.setattr(module, '_SceneNode', lambda *args: scene)
    for name, value in {
        'geometry_msgs.msg': NS(Twist=object, TwistStamped=object),
        'sensor_msgs.msg': NS(LaserScan=object, JointState=object),
        'rclpy.parameter': NS(Parameter=lambda *args, **kw: None),
        'rclpy.qos': NS(qos_profile_sensor_data=object()),
        'rclpy.time': NS(Time=lambda: 0),
        'rclpy': NS(create_node=lambda *args, **kw: Node()),
        'tf2_ros': NS(Buffer=Buffer, TransformListener=lambda buffer, *args, **kw: NS(buffer=buffer)),
    }.items(): monkeypatch.setitem(sys.modules, name, value)
    now = [10_000_000_000]
    monkeypatch.setattr(module.time, 'monotonic_ns', lambda: now[0])
    compile_native(*inputs(), tmp_path/'bundle')
    ports = module.EngineeringRosPorts(tmp_path/'bundle', None, lambda *args: None)
    ports._node()  # Exercise the real wiring that gives TransformListener its observed buffer.
    fake = FakePorts(['amr_1'])
    ports.navigation_for = fake.navigation_for
    ports.launch = fake.launch
    ports.pause = fake.pause
    ports._proc = ports._bag = NS(poll=lambda: None)

    def stamp(ns): return NS(sec=ns//1_000_000_000, nanosec=ns%1_000_000_000)
    def publish_tf(edge, ns=None, static=False):
        msg = NS(header=NS(frame_id=edge[0], stamp=stamp(scene.clock if ns is None else ns)), child_frame_id=edge[1])
        setter = ports._listener.buffer.set_transform_static if static else ports._listener.buffer.set_transform
        setter(msg, 'portable-transport')
    def fresh_streams():
        header = NS(frame_id='lidar/head', stamp=stamp(scene.clock))
        node.callbacks['/amr_1/scan'](NS(header=header, ranges=[1.0]))
        node.callbacks['/amr_1/joint_states'](NS(header=header, name=['wheel-left/axle', 'wheel-right/axle'], position=[0., 0.], velocity=[0., 0.]))
    def advance(ns, provider_ns=None):
        now[0] += ns; scene.clock += ns if provider_ns is None else provider_ns; fresh_streams()
    fresh_streams()
    return NS(ports=ports, fake=fake, scene=scene, now=now, publish=publish_tf, advance=advance)


def ready_tf(h):
    # AMCL deliberately postdates map->odom by its configured transform tolerance (1 s).
    h.publish(('map', 'odom'), h.scene.clock+1_000_000_000)
    h.publish(('odom', 'chassis/base'))
    h.publish(('chassis/base', 'lidar/head'), 0, static=True)
    assert h.ports.health() == {'alive': True, 'reasons': []}


@pytest.mark.parametrize('stopped', [('map', 'odom'), ('odom', 'chassis/base')])
def test_actual_health_expires_each_cached_dynamic_edge_and_latches(live_engineering_ports, stopped):
    h = live_engineering_ports; ready_tf(h)
    # Clock, scans, joints and unrelated wheel TF continue, as does the other dynamic edge.
    h.advance(500_000_001, 100_000_000)  # provider stamps still valid; receipt watchdog alone expires
    h.publish(('chassis/base', 'wheel-left'))
    other = ('odom', 'chassis/base') if stopped == ('map', 'odom') else ('map', 'odom')
    h.publish(other)
    reason = 'TF_FEEDBACK_STALE:'+':'.join(stopped)
    assert reason in h.ports.health()['reasons']
    h.publish(stopped)
    assert reason in h.ports.health()['reasons']  # no automatic recovery after readiness loss


@pytest.mark.parametrize('edge', [('map', 'odom'), ('odom', 'chassis/base')])
def test_actual_health_refuses_old_provider_tf_even_with_new_receipt(live_engineering_ports, edge):
    h = live_engineering_ports; ready_tf(h)
    h.publish(edge, h.scene.clock-500_000_001)
    assert 'TF_FEEDBACK_STALE:'+':'.join(edge) in h.ports.health()['reasons']


def test_actual_health_distinguishes_static_sensor_tf_from_dynamic_chain(live_engineering_ports):
    h = live_engineering_ports; ready_tf(h)
    h.advance(2_000_000_000)
    h.publish(('map', 'odom'), h.scene.clock+1_000_000_000)
    h.publish(('odom', 'chassis/base'))
    assert h.ports.health()['alive']  # zero-stamped fixed sensor TF is valid indefinitely
    h.publish(('map', 'odom'), 0, static=True)
    assert not h.ports.health()['alive']  # a static publisher cannot replace localization


def test_actual_health_requires_missing_tf_and_latches_clock_reset(live_engineering_ports):
    h = live_engineering_ports
    assert any(r.startswith('TF_MISSING') for r in h.ports.health()['reasons'])
    ready_tf(h)
    h.scene.clock -= 1
    assert 'CLOCK_RESET' in h.ports.health()['reasons']


@pytest.mark.parametrize('lost_ack', [False, True])
def test_actual_tf_expiry_refuses_new_goals_and_results_without_resending(live_engineering_ports, tmp_path, lost_ack):
    from bridge.engineering_session import EngineeringNav2Session
    from test_nav2_session import execute_args
    h = live_engineering_ports; ready_tf(h)
    session = EngineeringNav2Session(h.ports, 'run-freshness', ['amr_1'], tmp_path/'commands')
    args = execute_args('lost', robot='amr_1')
    h.fake.clients['amr_1'].unreachable = lost_ack
    answer = session.execute(args)
    assert answer['status'] == ('unknown' if lost_ack else 'accepted')
    if not lost_ack:
        h.fake.clients['amr_1'].settle(answer['nativeGoalId'], 'SUCCEEDED', 0)
    h.fake.clients['amr_1'].unreachable = False
    h.advance(500_000_001)
    assert session.execute(execute_args('new', robot='amr_1'))['status'] == 'rejected'
    assert session.query({'commandId':'lost','robotId':'amr_1'})['status'] == 'unknown'
    assert session.execute(args) == answer
    assert len(h.fake.clients['amr_1'].sent) == (0 if lost_ack else 1)


@pytest.mark.parametrize('edge,future_ns', [(('map','odom'), 1_000_000_001), (('odom','chassis/base'), 500_000_001)])
def test_actual_health_refuses_tf_beyond_bounded_future_tolerance(live_engineering_ports, edge, future_ns):
    h = live_engineering_ports; ready_tf(h)
    h.publish(edge, h.scene.clock+future_ns)
    assert 'TF_FEEDBACK_STALE:'+':'.join(edge) in h.ports.health()['reasons']


def test_actual_health_requires_sensor_on_static_transport(live_engineering_ports):
    h = live_engineering_ports; ready_tf(h)
    h.publish(('chassis/base','lidar/head'))
    assert 'TF_EXPECTED_STATIC:chassis/base:lidar/head' in h.ports.health()['reasons']
