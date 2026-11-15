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
