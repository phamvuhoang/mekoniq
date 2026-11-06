"""Portable protocol_double; never native or force-sensor evidence."""
import pytest
from support import ROOT
from arm_fixture import RUN_ID, profile
from bridge.sim_gripper import SimGripper, next_grip

def scene(seq="1", **over):
    return {"runId": RUN_ID, "worldRevision": "world-r1", "sceneSeq": seq, "transferId": "transfer-1", "commandId": "cmd-1", "cup": {"id": "cup-1", "present": True, "positionM": [0.4, 0.1, 0.2]}, "receiver": None, "faults": [], **over}

def fixture():
    now = [0]; config={**profile()["simulationScene"],"worldFromArmBaseM":[0,0,0],"cupOffsetTcpM":[0,0,0]}; grip = SimGripper(config, monotonic_ns=lambda: now[0]); grip.bind(RUN_ID, "world-r1", 1)
    return grip, now

def sample(grip, close=True, tcp=None, epoch=1):
    return grip.sample(close_output=close, tcp_m=tcp or [0.4, 0.1, 0.2], actual_joints_rad=[0]*6, command={"commandId": "cmd-1", "deviceId": "arm-1", "payloadHash": "a"*64, "controlEpoch": 1, "programRef":{"id":"cup-place" if grip.scene and grip.scene["receiver"] is not None else "cup-pick"}}, controller_epoch=epoch, boot_id="controller-1")

def test_close_without_cup_never_proves_grasp():
    assert next_grip(close_output=True, cup_in_zone=False, fault=False) == "empty"
    assert next_grip(close_output=True, cup_in_zone=True, fault=True) == "fault"
    assert next_grip(close_output=False, cup_in_zone=True, fault=False) == "open"

def test_output_and_actual_pose_required_and_lift_is_observed():
    grip, _ = fixture(); grip.update(scene())
    assert sample(grip, close=False) is None
    assert sample(grip, tcp=[1, 1, 1]) is None
    first = sample(grip); assert first["phase"] == "grasp" and first["liftPoseReached"] is False
    assert sample(grip) is None
    lift = sample(grip, tcp=[0.4, 0.1, 0.25]); assert lift["liftPoseReached"] is True and lift["producer"] == "linuxcnc_virtual_grip" and lift["fidelity"] == "modeled"

def test_scene_pin_order_freshness_and_epoch_guard():
    grip, now = fixture(); grip.update(scene())
    for bad in [scene(), scene("2", runId="wrong"), scene("2", worldRevision="wrong")]:
        with pytest.raises(ValueError): grip.update(bad)
    now[0] = 500_000_001; assert sample(grip) is None
    grip.update(scene("2")); assert sample(grip, epoch=2) is None
    assert grip.sample(close_output=True, tcp_m=[0.4, 0.1, 0.2], actual_joints_rad=None, command={}, controller_epoch=1, boot_id="b") is None

def test_cup_cannot_be_taken_twice_or_released_to_moved_receiver():
    grip, _ = fixture(); grip.update(scene()); assert sample(grip)["phase"] == "grasp"
    receiver = {"robotId": "amr-1", "slot": 1, "stationary": False, "localizationValid": True, "poseErrorM": 0, "trayPresent": True}
    grip.update(scene("2", receiver=receiver)); lost = sample(grip, close=False)
    assert lost["phase"] == "lost" and lost["parent"] is None
    grip.update(scene("3")); assert sample(grip) is None

def test_release_requires_correct_target_pose_not_just_receiver_boolean():
    grip, _ = fixture(); grip.update(scene()); sample(grip)
    receiver = {"robotId": "amr-1", "slot": 1, "stationary": True, "localizationValid": True, "poseErrorM": 0, "trayPresent": True}
    grip.update(scene("2", receiver=receiver)); assert sample(grip, close=False, tcp=[1, 1, 1])["phase"] == "lost"

def test_release_is_modeled_and_never_manufactures_receiver_observation():
    grip, _ = fixture(); grip.update(scene()); sample(grip)
    receiver = {"robotId": "amr-1", "slot": 1, "stationary": True, "localizationValid": True, "poseErrorM": 0, "trayPresent": True}
    grip.update(scene("2",receiver=receiver))
    release = sample(grip,close=False,tcp=grip.config["trayPositionM"])
    assert release["phase"] == "release" and release["parent"] == "robot:amr-1/tray:1"
    assert release["producer"] != "gazebo_tray" and sample(grip,close=False) is None

@pytest.mark.parametrize('change',[{"robotId":"wrong"},{"slot":2},{"localizationValid":False},{"trayPresent":False},{"poseErrorM":.051}])
def test_wrong_receiver_or_invalid_dock_cannot_prove_release(change):
    grip,_=fixture();grip.update(scene());sample(grip)
    receiver={"robotId":"amr-1","slot":1,"stationary":True,"localizationValid":True,"poseErrorM":0,"trayPresent":True,**change}
    grip.update(scene("2",receiver=receiver));assert sample(grip,close=False,tcp=grip.config["trayPositionM"])["phase"]=="lost"

def test_missing_cup_gripper_fault_and_drop_are_not_held_success():
    for fault in ('missing_cup','gripper_stuck'):
        grip,_=fixture();grip.update(scene(faults=[fault]));assert sample(grip) is None
        assert grip.telemetry()['state'] in ('empty','fault')
    grip,_=fixture();grip.update(scene());sample(grip);grip.update(scene('2',faults=['drop_cup']))
    assert sample(grip)['phase']=='lost'

def test_scene_admission_uses_owner_epoch_and_pinned_run(tmp_path):
    from bridge.arbiter import Arbiter
    from bridge.journal import Journal
    from fake_controller import FakeController
    from arm_fixture import T0, envelope, cell_command
    p=profile();arb=Arbiter(p,Journal(tmp_path/'journal'),FakeController(),now_ms=lambda:T0);arb.start()
    token=arb.acquire('lab_simulation','lab',1,10000,simulation_scene={'runId':RUN_ID,'worldRevision':'world-r1'})
    env=envelope(cell_command('query_outcome',{'targetCommandId':'none'}),token=token['token'],lease=token['leaseId']);env.pop('command');env['simScene']=scene()
    assert arb.update_sim_scene(env)['status']=='accepted'
    assert arb.update_sim_scene(env)['reasonCodes']==['SIM_SCENE_SEQUENCE_REPLAY']
    env['simScene']=scene('2');env['controllerEpoch']=2
    assert 'EPOCH_MISMATCH' in arb.update_sim_scene(env)['reasonCodes']
    env['controllerEpoch']=1;env['owner']['token']='wrong';assert 'OWNER_TOKEN_INVALID' in arb.update_sim_scene(env)['reasonCodes']
    p['mode']='hardware';other=Arbiter(p,Journal(tmp_path/'other'),FakeController(),now_ms=lambda:T0);other.start()
    assert other.acquire('lab_simulation','lab',1,10000,simulation_scene={'runId':RUN_ID,'worldRevision':'world-r1'})['reasonCodes']==['SIM_SCENE_UNSUPPORTED']

@pytest.mark.parametrize('code',['M64 P1','M64 P0 Q1','M64 P0 M65 P0','M064 P0','M66 P0 L3 Q1','M62 P0'])
def test_arbitrary_pin_mcode_or_timeout_forbidden(tmp_path,code):
    import hashlib
    from bridge.arbiter import Arbiter
    from bridge.journal import Journal
    from fake_controller import FakeController
    from arm_fixture import T0
    path=tmp_path/'programs';path.mkdir();data=(code+'\nM2\n').encode();(path/'custom.ngc').write_bytes(data)
    p=profile();p['programs']['custom']={'path':'programs/custom.ngc','sha256':hashlib.sha256(data).hexdigest()}
    arb=Arbiter(p,Journal(tmp_path/'journal'),FakeController(),now_ms=lambda:T0,program_root=tmp_path)
    assert arb._check_program('custom')

def test_only_exact_sim_output0_allowlisted_and_non_sim_denied(tmp_path):
    from bridge.arbiter import Arbiter
    from bridge.journal import Journal
    from fake_controller import FakeController
    from arm_fixture import T0
    p=profile();arb=Arbiter(p,Journal(tmp_path/'journal'),FakeController(),now_ms=lambda:T0)
    assert arb._check_program('cup-pick')==[] and arb._check_program('cup-place')==[]
    p['mode']='hardware';assert arb._check_program('cup-pick')==['PROGRAM_SIM_OUTPUT_NOT_ALLOWED']

def test_program_geometry_derived_from_reference_dh_and_collision_checked():
    import json,math
    from test_model_units import oracle_fk,to_si,quaternion_xyzw,angle_between
    from collision.arm_swept_path import check_swept_path
    fixture=json.loads((ROOT/'configs/sim/puma560/cup-geometry.json').read_text())
    model=to_si(json.loads((ROOT/'models/puma560-reference/modified-dh.json').read_text()))
    trace=[]
    for tick,(name,p) in enumerate(fixture['poses'].items()):
        q=[v*math.pi/180 for v in p['qDeg']];t=oracle_fk(model,q)
        assert [t[i][3] for i in range(3)]==pytest.approx(p['positionM'],abs=1e-9)
        assert [x*.0254 for x in p['xyzInch']]==pytest.approx(p['positionM'],abs=1e-9)
        assert angle_between(quaternion_xyzw(t),p['quaternionXyzw'])<1e-6
        assert all(l['min']<=v<=l['max'] for l,v in zip(model['limits'],q))
        trace.append({'tick':tick,'q':q})
    report=check_swept_path({}, {'id':'reference-cup-fixture','revision':1},trace,[{'cupId':'cup-1','fromTick':1,'toTick':4}],world=[],model=model)
    assert report['ok'],report['colliding']
    assert fixture['qualification']['execution']=='not_run'

def test_service_emits_sampled_grip_before_completion_and_null_output_never_proves_it(tmp_path):
    from bridge.arbiter import Arbiter
    from bridge.journal import Journal
    from bridge.service import BridgeService
    from bridge import protocol
    from fake_controller import FakeController
    from arm_fixture import T0, envelope, cell_command
    p=profile();p['simulationScene']['worldFromArmBaseM']=[0,0,0];p['simulationScene']['cupOffsetTcpM']=[0,0,0];ctl=FakeController();arb=Arbiter(p,Journal(tmp_path/'journal'),ctl,now_ms=lambda:T0);arb.start()
    service=BridgeService(p,arb,ctl,status_hz=0,now_ms=lambda:T0);frames=[];service.broadcast=lambda m,**kw:frames.append(m)
    acquire=envelope(None,p=p);acquire.pop('command');acquire['acquire']={'actor':'lab','leaseMs':10000,'simulationScene':{'runId':RUN_ID,'worldRevision':'world-r1'}}
    token=service.handle(acquire);assert token['capabilities']==['simulation_scene.v1','correlated_barrier.v1']
    env=envelope(None,token=token['token'],lease=token['leaseId'],p=p);env.pop('command');env['simScene']=scene()
    assert service.handle(env)['status']=='accepted'
    ref={'id':'cup-pick','hash':p['programs']['cup-pick']['sha256']}
    for capability,cid,payload in [('stage_program','stage',{'profileId':p['machineId']}),('start_job','cmd-1',{'jobId':'job-1'})]:
        assert service.handle(envelope(cell_command(capability,payload,cid,program=ref),token=token['token'],lease=token['leaseId'],p=p))['status']=='accepted'
    service.poll_once();assert not any(f.get('event')=='virtual_grip' for f in frames)
    state=ctl.state;ctl.state=lambda:{**state(),'tcpInch':[v/.0254 for v in [.4,.1,.2]],'gripperCloseOutput':True}
    service.poll_once();proof=next(f for f in frames if f.get('event')=='virtual_grip')
    assert protocol.validate(proof,service.validators)==[]
    assert proof['evidence']['transferObservation']['phase']=='grasp'
    assert proof['observation']['result']=='accepted' and ctl.interp=='running'
    before=len([f for f in frames if f.get('event')=='virtual_grip']);service.poll_once()
    assert len([f for f in frames if f.get('event')=='virtual_grip'])==before
    ctl.finish('cmd-1');service.poll_once();done=next(f for f in frames if f.get('event')=='command_completed')
    assert done['evidence']['gripperClosed'] is None and 'transferObservation' not in done['evidence']
    assert any(e['kind']=='sim_grip_sample' for e in arb.journal.entries())

def test_scene_timeout_after_grasp_emits_uncertainty_once_and_requires_reconcile():
    grip,now=fixture();grip.update(scene());sample(grip)
    now[0]=500_000_001;unknown=sample(grip)
    assert unknown['quality']=='unknown' and unknown['parent'] is None
    assert sample(grip) is None
    grip.update(scene('2'));assert sample(grip) is None

def test_native_fixture_translation_tray_offset_and_reference_sweep_match_actual_asset():
    import json,math
    from test_model_units import to_si
    from bridge.sim_geometry import cup_center
    from collision.arm_swept_path import check_swept_path
    f=json.loads((ROOT/'configs/sim/puma560/cup-geometry.json').read_text());model=to_si(json.loads((ROOT/'models/puma560-reference/modified-dh.json').read_text()));p=profile()['simulationScene'];candidate=f['nativeCandidate'];dock=candidate['dockPositionM'];base=f['worldFromArmBaseM']
    for pose in f['poses'].values():
        assert cup_center([q*math.pi/180 for q in pose['qDeg']],pose['positionM'],base,p['cupOffsetTcpM'])==pytest.approx(pose['cupCenterWorldM'])
    assert f['poses']['place']['cupCenterWorldM']==pytest.approx([dock[i]+candidate['cupOffsetInRobotM'][i] for i in range(3)])
    assert abs(candidate['cupOffsetInRobotM'][0])+.035 <= .4/2
    world=[]
    for id,pos,size in [('robot:amr-1',[0,0,.2],[.6,.55,.15]),('tray:amr-1',[0,0,.5],[.4,.45,.02])]:
        c=[dock[i]-base[i]+pos[i] for i in range(3)];world.append({'id':id,'kind':'box','min':[c[i]-size[i]/2 for i in range(3)],'max':[c[i]+size[i]/2 for i in range(3)]})
    names=['pick-approach','pick','lift','tray-approach','place','retreat'];trace=[{'tick':i,'q':[q*math.pi/180 for q in f['poses'][name]['qDeg']]} for i,name in enumerate(names)]
    for a,b in zip(trace,trace[1:]):
        allowed=[{'pair':['held-cup','tray:amr-1'],'fromTick':3,'toTick':5,'phase':'release','revision':1}] if a['tick']>=3 else []
        report=check_swept_path({}, {'id':'native-reference','revision':1},[a,b],[{'cupId':'cup-1','fromTick':1,'toTick':4}],world=world,model=model,allowed_contacts=allowed)
        assert report['ok'],report['colliding']

def test_recovery_outcome_names_current_controller_and_original_terminal_command_fence(tmp_path):
    from bridge.arbiter import Arbiter
    from bridge.journal import Journal
    from fake_controller import FakeController
    from arm_fixture import T0,cell_command,envelope,demo_program_ref
    p=profile();ctl=FakeController();arb=Arbiter(p,Journal(tmp_path/'journal'),ctl,now_ms=lambda:T0);arb.start()
    token=arb.acquire('lab_simulation','lab',1,10000)
    for capability,cid,payload in [('stage_program','stage',{'profileId':p['machineId']}),('start_job','run',{'jobId':'job-1'})]:
        assert arb.submit(envelope(cell_command(capability,payload,cid,program=demo_program_ref()),token=token['token'],lease=token['leaseId']))['status']=='accepted'
    ctl.finish('run');arb.poll_completions();before=arb.outcome('run')
    assert before['evidence']['controllerIdentity']=={'bootId':'ctl-boot-1','epoch':1}
    assert before['evidence']['commandIdentity']['commandId']=='run'
    ctl.reboot('ctl-boot-2');arb.observe();after=arb.outcome('run')
    assert after['status']=='completed'
    assert after['evidence']['controllerIdentity']=={'bootId':'ctl-boot-2','epoch':2}
    assert after['evidence']['commandIdentity']==before['evidence']['commandIdentity']

def test_recovery_identity_refreshes_cached_controller_boot_and_unknown_is_not_continuity(monkeypatch):
    import io,threading,time
    from types import SimpleNamespace
    from bridge.linuxcnc_port import LinuxcncPort
    port=LinuxcncPort.__new__(LinuxcncPort);port._lock=threading.RLock();port._boot='cached-old';port._boot_at=time.monotonic()
    monkeypatch.setattr('bridge.linuxcnc_port.subprocess.run',lambda *a,**k:SimpleNamespace(stdout='123\n'))
    monkeypatch.setattr('builtins.open',lambda *a,**k:io.StringIO('123 (milltask) '+' '.join(['0']*19+['456'])))
    assert port.boot_id()=='cached-old'
    assert port.recovery_identity()=='milltask-123-456'
    def missing(*a,**k):raise OSError('controller process absent')
    monkeypatch.setattr('bridge.linuxcnc_port.subprocess.run',missing)
    assert port.recovery_identity() is None
