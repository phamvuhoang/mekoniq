"""One compiled world, exact geometry, one native clock; independent from source custody."""
import copy
import json
from pathlib import Path
import numpy as np
import pytest
import mujoco
from scene_fixture import cell_scene,load,BLOBS
from mujoco_worker.compile_world import compile_world
from mujoco_worker.world_engine import WorldEngine
FX=Path(__file__).resolve().parents[1]/'fixtures/serve-payload-v1'
def mobile(name):return json.loads((FX/name).read_text())
def inputs():
 nav=mobile('navigation-scene.json');empty=mobile('empty.json')
 nav['robots'][0]['initialPoseMap']=[.35,.48591366218667575,np.pi/2]
 nav['world']['obstacles']=[];nav['world']['boundaries']=[]
 nav['engine']['loadProfileRef'].update(id='empty',revision=1)
 scene={'schemaVersion':1,'documentType':'lab-world-scene','sceneDigest':'a'*64,'navigation':nav,'armCell':cell_scene(),
        'supportMap':{'replacedStaticSupportId':'tray','mobileSupportId':'amr-1/tray-1'},
        'numericalPolicy':{'id':'coffee-delivery-world-numerics-v1','revision':1,'calibration':'not_calibrated','timestepMs':2,'substeps':10,'primingSubsteps':10,'integrator':'implicitfast','cone':'elliptic','impratio':10,'solver':'Newton','iterations':100,'tolerance':1e-8,'floorSlidingFriction':1.0}}
 return scene,load('component.json'),load('physics.json'),{'amr-1':mobile('physical-model-amr-1.json')},empty,mobile('drive-contact-profile.json'),str(BLOBS)
def test_compiles_one_free_chassis_and_parked_cup_without_weld_or_static_tray():
 args=inputs();xml,names=compile_world(*args);m=mujoco.MjModel.from_xml_string(xml)
 assert 'tray' not in names['arm']['supports'] and 'nozzle-stand' in names['arm']['supports']
 assert len(names['mobile']['props'])==0
 assert m.nq==28 # 12 arm/gripper hinges + free cup7 + free chassis7 + wheels2
 assert all(t!=mujoco.mjtEq.mjEQ_WELD for t in m.eq_type)
 assert m.body_mass[m.body(names['arm']['props']['cup-1']).id]==pytest.approx(.32)
def test_preserves_each_origin_contact_parameters_and_declares_new_global_policy():
 args=inputs();xml,names=compile_world(*args);m=mujoco.MjModel.from_xml_string(xml)
 pad=m.geom(names['arm']['pads'][0]).id;wheel=m.geom(names['mobile']['geoms'][('wheel-left/rim',0)]).id
 assert m.opt.cone==mujoco.mjtCone.mjCONE_ELLIPTIC and m.opt.impratio==10
 assert m.geom_solref[pad].tolist()==pytest.approx([.01,1])
 assert m.geom_solref[wheel].tolist()==pytest.approx([.02,1])
 assert m.geom_solimp[pad][:3].tolist()==pytest.approx([.9,.95,.005])
 assert m.geom_solimp[wheel][:3].tolist()==pytest.approx([.9,.95,.001])
def test_world_rejects_unknown_replaced_support_and_nonempty_mobile_payload():
 args=list(inputs());args[0]['supportMap']['replacedStaticSupportId']='nozzle-stand'
 with pytest.raises(Exception,match='WORLD_SUPPORT_INVALID'):compile_world(*args)
 args=list(inputs());args[4]=mobile('cup-center.json');args[0]['navigation']['engine']['loadProfileRef'].update(id='cup-center')
 with pytest.raises(Exception,match='WORLD_INITIAL_LOAD_NOT_EMPTY'):compile_world(*args)
def test_one_priming_then_ten_native_substeps_per_logical_tick_and_actual_readings():
 e=WorldEngine(*inputs());home=load('programs.json')['programs']['waypoints']['home']
 assert e.total_substeps==0
 r=e.step(home,.0889,[],0,0)
 assert e.total_substeps==10 and r['time']==pytest.approx(.02)
 assert len(r['world']['robots'])==1 and len(r['world']['arms'])==1 and r['world']['props']==[]
 for _ in range(10):r=e.step(home,.0889,[],.1,0)
 assert e.total_substeps==110 and r['time']==pytest.approx(.22)
 assert r['world']['robots'][0]['poseDriveMap'][1]>.48591366218667575
 e.close()
def test_active_cup_placement_keeps_identity_and_reports_real_nozzle_support():
 e=WorldEngine(*inputs());home=load('programs.json')['programs']['waypoints']['home']
 r=e.step(home,.0889,[('cup-1',{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]})],0,0)
 assert 'birthObservations' not in r['world']['worldStep']
 for _ in range(50):r=e.step(home,.0889,[],0,0)
 assert r['world']['props'][0]['propId']=='cup-1'
 assert r['world']['props'][0]['restingOn']=='nozzle-stand'
 assert r['world']['props'][0]['position'][2]==pytest.approx(.15,abs=.001)
 assert len(r['world']['physics']['loads'])==1
 r=e.step(home,.0889,[('cup-1',None)],0,0)
 assert r['world']['props']==[] and r['world']['physics']['loads']==[]
 e.close()
def test_engine_warning_reset_is_terminal_even_if_state_becomes_finite(tmp_path,monkeypatch):
 monkeypatch.chdir(tmp_path);e=WorldEngine(*inputs());e.data.qvel[:]=1e20
 with pytest.raises(Exception,match='PLANT_UNSTABLE'):e.step(load('programs.json')['programs']['waypoints']['home'],.0889,[],0,0)
 e.close()

@pytest.fixture
def session(tmp_path):
 import shutil
 from mujoco_worker.session import WorkerSession
 world=FX.parent/'coffee-delivery-world-v1'
 for p in world.iterdir():
  if p.is_file():shutil.copy(p,tmp_path/p.name)
 shutil.copytree(BLOBS,tmp_path/'blobs')
 scene=json.loads((tmp_path/'lab-world-scene.json').read_text())
 s=WorkerSession(run_id='world-test',bundle_root=tmp_path,lock_digest='b'*64,expected_scene_digest=scene['sceneDigest'])
 yield s
 s.end()

def request(op,payload,tick=0,request_id=None):
 return {'protocol':'mekoniq-sim3d/1','requestId':request_id or f'{op}-{tick}','runId':'world-test','expectedTick':tick,'op':op,'payload':payload}
def start_world(s):
 r=s.handle(request('create',{'sceneRef':'lab-world-scene.json','seed':7}));assert r['ok'],r
 assert s.handle(request('start',{}))['ok']
 return r

def world_step(s,tick=0,placements=None,intents=None):
 p={'targetTick':tick+1,'velocities':[{'robotId':'amr-1','vMps':0,'omegaRadps':0}],'actorUpdates':[],
    'jointTargets':[{'armId':'arm-1','positionsRad':s.scene['armCell']['arm']['homeRad']}],'gripperTargets':[{'armId':'arm-1','openingM':.0889}]}
 if placements is not None:p['propPlacements']=placements
 if intents is not None:p['worldInteractions']=intents
 return request('step',p,tick)

def test_real_world_session_ack_identity_and_exact_clock(session):
 r=start_world(session);assert r['tick']==0 and r['result']['tick']==0
 assert r['result']['sceneDigest']==session.scene['sceneDigest']
 r=session.handle(world_step(session));assert r['ok'],r
 assert r['tick']==1 and r['result']['physics']['tick']==1
 assert session.substeps==20 and session.engine.total_substeps==20

def test_lidar_scan_is_on_the_wire_only_on_publish_ticks(session):
 from scene_fixture import SCHEMAS
 from mujoco_worker.protocol import load_validators
 wire=load_validators(SCHEMAS)[1];r0=start_world(session);k=session.scene['navigation']['robots'][0]['model']['sensors'][0]['publishEveryTicks']
 def check(r,tick):
  assert r['ok'] and r['tick']==tick and not list(wire.iter_errors(r)),r.get('error')
  robot=r['result']['robots'][0]
  if tick%k:assert 'scans' not in robot
  else:assert [(s['tick'],len(s['rangesM']),len(s['states'])) for s in robot['scans']]==[(tick,360,360)]
 check(r0,0)
 for t in range(2*k):
  check(session.handle(world_step(session,t)),t+1)
  if t+1==k-1:check(session.handle(request('getState',{},t+1)),t+1)

def test_world_requires_source_owned_birth_and_removal_intents_before_any_mutation(session):
 start_world(session);placement={'propId':'cup-1','pose':{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]}}
 r=session.handle(world_step(session,placements=[placement]));assert not r['ok'] and r['error']['code']=='WORLD_INTERACTION_INVALID'
 assert session.engine.total_substeps==10 and not session.engine.arm.in_scene
 intent={'eventId':'rig-birth-1','cupId':'cup-1','propId':'cup-1','kind':'birth','targetTick':1}
 for patch in [{'targetTick':2},{'cupId':'wrong'},{'kind':'remove'}]:
  req=world_step(session,placements=[placement],intents=[{**intent,**patch}]);req['requestId']=str(patch)
  r=session.handle(req);assert not r['ok'] and r['error']['code']=='WORLD_INTERACTION_INVALID'
 r=session.handle({**world_step(session,placements=[placement],intents=[intent]),'requestId':'valid-birth'});assert r['ok'],r
 assert session.engine.total_substeps==20
 dup={**intent,'targetTick':2};r=session.handle(world_step(session,1,placements=[placement],intents=[dup]));assert not r['ok'] and r['error']['code']=='WORLD_INTERACTION_INVALID'
 assert session.engine.total_substeps==20

def test_world_refuses_outside_nozzle_placement_without_stepping(session):
 start_world(session);intent={'eventId':'rig-birth-1','cupId':'cup-1','propId':'cup-1','kind':'birth','targetTick':1}
 r=session.handle(world_step(session,placements=[{'propId':'cup-1','pose':{'position':[10,10,.151],'quaternionXyzw':[0,0,0,1]}}],intents=[intent]))
 assert not r['ok'] and r['error']['code']=='WORLD_INTERACTION_INVALID'
 assert session.engine.total_substeps==10


def test_world_rejects_unadmitted_disturbance_before_physics(session):
 start_world(session)
 r=world_step(session);r['payload']['worldPerturbations']=[{'eventId':'fault-1','presetId':'world-dock-drift-v1','revision':1,'targetId':'amr-1','targetTick':1}]
 result=session.handle(r)
 assert not result['ok'] and result['error']['code']=='WORLD_PERTURBATION_NOT_ADMITTED'
 assert session.engine.total_substeps==10 and session.tick==0


def test_registered_force_is_real_dynamics_and_always_cleared():
 e=WorldEngine(*inputs());home=load('programs.json')['programs']['waypoints']['home']
 e.step(home,.0889,[('cup-1',{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]})],0,0)
 r=e.step(home,.0889,[],0,0,{'presetId':'world-cup-fall-v1','targetId':'cup-1'})
 assert r['world']['physics']['loads'][0]['linearVelocityMapMps'][0]>.5
 assert np.count_nonzero(e.data.xfrc_applied)==0 and e.total_substeps==20
 e.close()

def _admit_disturbance(s,preset,target,trigger):
 from mujoco_worker.session import scene_digest_of
 path=s.bundle_root/'lab-world-scene.json';scene=json.loads(path.read_text())
 scene['disturbance']={'presetId':preset,'revision':1,'targetId':target,'trigger':trigger,'cupId':'cup-1'}
 scene['sceneDigest']=scene_digest_of(scene);path.write_text(json.dumps(scene));s.expected_scene_digest=scene['sceneDigest']


def test_admitted_disturbance_requires_bound_target_and_actual_phase_before_mutation(session):
 _admit_disturbance(session,'world-cup-fall-v1','cup-1','transport');start_world(session)
 req=world_step(session);req['payload']['worldPerturbations']=[{'eventId':'fault-1','presetId':'world-cup-fall-v1','revision':1,'targetId':'cup-1','targetTick':1}]
 r=session.handle(req);assert not r['ok'] and r['error']['code']=='WORLD_PERTURBATION_PHASE_INVALID'
 assert session.engine.total_substeps==10 and not session.world_disturbance_consumed
 session.world_disturbance_consumed=True;req['requestId']='duplicate-preset'
 r=session.handle(req);assert not r['ok'] and r['error']['code']=='WORLD_PERTURBATION_NOT_ADMITTED'
 assert session.engine.total_substeps==10


def test_unknown_disturbance_target_is_refused_before_model_creation(session):
 _admit_disturbance(session,'world-cup-fall-v1','unknown','transport')
 r=session.handle(request('create',{'sceneRef':'lab-world-scene.json','seed':7}))
 assert not r['ok'] and r['error']['code']=='WORLD_PERTURBATION_NOT_ADMITTED' and session.engine is None


def test_registered_force_clears_on_native_step_exception(monkeypatch):
 e=WorldEngine(*inputs());home=load('programs.json')['programs']['waypoints']['home']
 e.step(home,.0889,[('cup-1',{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]})],0,0)
 def fail(*_args):raise RuntimeError('injected native boundary')
 monkeypatch.setattr(mujoco,'mj_step',fail)
 with pytest.raises(RuntimeError,match='injected native boundary'):e.step(home,.0889,[],0,0,{'presetId':'world-cup-fall-v1','targetId':'cup-1'})
 assert np.count_nonzero(e.data.xfrc_applied)==0
 e.close()

def test_world_control_context_is_opt_in_and_missing_or_changed_stage_refuses_before_mutation(session):
 start_world(session);req=world_step(session);req['payload']['worldControl']={'version':1,'program':None,'attachmentProxyPropId':None,'movementInterlocked':False,'stopLatched':False}
 r=session.handle(req);assert not r['ok'] and r['error']['code']=='WORLD_CONTROL_INVALID' and session.engine.total_substeps==10


def test_cup_nudge_v1_applies_one_registered_tick_and_reports_the_native_outcome(monkeypatch):
    home = load('programs.json')['programs']['waypoints']['home']
    pushed, control = WorldEngine(*inputs()), WorldEngine(*inputs())
    try:
        for engine in (pushed, control):
            engine.step(home, .0889, [('cup-1', {'position': [.49, 0, .151], 'quaternionXyzw': [0, 0, 0, 1]})], 0, 0)
            for _ in range(50):
                engine.step(home, .0889, [], 0, 0)
        cup = pushed.arm.prop['cup-1']
        body = cup['body']
        stand = pushed.model.geom(pushed.names['arm']['supports']['nozzle-stand']).id

        def check_outcome(world):
            prop = world['props'][0]
            assert prop['propId'] == 'cup-1'
            np.testing.assert_allclose(prop['position'], pushed.data.xpos[body], rtol=0, atol=1e-12)
            touching_stand = any(
                c.exclude == 0 and {c.geom1, c.geom2} == {cup['geom'], stand}
                for c in pushed.data.contact[:pushed.data.ncon]
            )
            speed = np.linalg.norm(pushed.data.qvel[cup['qvel']:cup['qvel'] + 3])
            assert prop['restingOn'] == ('nozzle-stand' if touching_stand and speed < .01 else None)

        check_outcome(pushed.last)
        control_body = control.arm.prop['cup-1']['body']
        np.testing.assert_array_equal(pushed.data.xpos[body], control.data.xpos[control_body])
        control.step(home, .0889, [], 0, 0)

        native_step = mujoco.mj_step
        unloaded = np.zeros_like(pushed.data.xfrc_applied)
        loaded = unloaded.copy()
        loaded[body] = [14.4, 0, 0, 0, 0, 0]
        substeps = 0

        def observe_step(model, data):
            nonlocal substeps
            np.testing.assert_array_equal(data.xfrc_applied, loaded if substeps < 10 else unloaded)
            native_step(model, data)
            substeps += 1

        monkeypatch.setattr(mujoco, 'mj_step', observe_step)
        pulse = {'presetId': 'world-cup-nudge-v1', 'targetId': 'cup-1'}
        row = pushed.step(home, .0889, [], 0, 0, pulse)
        assert substeps == 10
        np.testing.assert_array_equal(pushed.data.xfrc_applied, unloaded)
        assert pushed.data.xpos[body, 0] > control.data.xpos[control_body, 0]
        check_outcome(row['world'])
        for _ in range(100):
            row = pushed.step(home, .0889, [], 0, 0)
        assert substeps == 1010

        check_outcome(row['world'])
    finally:
        pushed.close()
        control.close()


def test_pick_rig_birth_witness_reads_native_pose_before_any_integration():
 args=list(inputs());args[0]['id']='pick-rig-v1'
 e=WorldEngine(*args);home=load('programs.json')['programs']['waypoints']['home']
 try:
  e.step(home,.0889,[],0,0)
  requested=[.5017669098901882,.016172193160984373,.151]
  r=e.step(home,.0889,[('cup-1',{'position':requested,'quaternionXyzw':[0,0,0,1]})],0,0)
  assert 'birthObservations' in r['world']['worldStep']
  birth=r['world']['worldStep']['birthObservations'][0]
  assert birth['method']=='mujoco-freejoint-body-before-step-v1'
  assert birth['physicsSubstepsBefore']==10 and e.total_substeps==20
  assert birth['qposPositionM']==requested and birth['bodyPositionM']==pytest.approx(requested,abs=1e-12)
  assert np.linalg.norm(np.array(r['world']['props'][0]['position'])-requested)>1e-5
  assert 'birthObservations' not in e.step(home,.0889,[],0,0)['world']['worldStep']
 finally:e.close()


def test_pick_rig_birth_witness_does_not_echo_a_placement_that_engine_applied_differently(monkeypatch):
 args=list(inputs());args[0]['id']='pick-rig-v1'
 e=WorldEngine(*args);home=load('programs.json')['programs']['waypoints']['home']
 try:
  e.step(home,.0889,[],0,0)
  put=e.arm._put
  def misplaced(pid,qpos):
   actual=list(qpos);actual[0]+=.002;put(pid,actual)
  monkeypatch.setattr(e.arm,'_put',misplaced)
  r=e.step(home,.0889,[('cup-1',{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]})],0,0)
  assert 'birthObservations' in r['world']['worldStep']
  birth=r['world']['worldStep']['birthObservations'][0]
  assert birth['qposPositionM'][0]==pytest.approx(.492,abs=1e-12)
  assert birth['bodyPositionM'][0]==pytest.approx(.492,abs=1e-12)
 finally:e.close()


def test_pick_rig_session_birth_receipt_binds_native_read_to_source_intent_and_request(session):
 import hashlib
 import rfc8785
 from mujoco_worker.session import scene_digest_of
 from mujoco_worker.protocol import load_validators
 from scene_fixture import SCHEMAS
 path=session.bundle_root/'lab-world-scene.json';scene=json.loads(path.read_text());scene['id']='pick-rig-v1';scene['sceneDigest']=scene_digest_of(scene);path.write_text(json.dumps(scene));session.expected_scene_digest=scene['sceneDigest']
 start_world(session)
 intent={'eventId':'source-birth-1','cupId':'cup-1','propId':'cup-1','kind':'birth','targetTick':1}
 req=world_step(session,placements=[{'propId':'cup-1','pose':{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]}}],intents=[intent]);req['requestId']='world-3'
 r=session.handle(req);assert r['ok'],r
 assert 'birthObservations' in r['result']['worldStep']
 birth=r['result']['worldStep']['birthObservations'][0]
 assert {k:birth[k] for k in ('eventId','cupId','propId','targetTick')}=={k:intent[k] for k in ('eventId','cupId','propId','targetTick')}
 assert birth['runId']==session.run_id and birth['bootId']==session.boot_id and birth['sceneDigest']==scene['sceneDigest']
 assert birth['requestId']=='world-3' and birth['requestDigest']==hashlib.sha256(rfc8785.dumps(req['payload'])).hexdigest()
 assert birth['qposPositionM']==[.49,0,.151] and birth['frame']=='map'
 assert not list(load_validators(SCHEMAS)[1].iter_errors(r))

def test_measured_pulse_wrench_reproduces_fifty_native_substeps_and_clears_on_failure(monkeypatch):
    home=load('programs.json')['programs']['waypoints']['home']
    wrench=np.array([4.025,0.,0.,0.,-.05*4.025,0.])
    engines=[WorldEngine(*inputs()),WorldEngine(*inputs())]
    native_step=mujoco.mj_step
    try:
        for e in engines:
            e.step(home,.0889,[('cup-1',{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]})],0,0)
            for _ in range(50): e.step(home,.0889,[],0,0)
        positions=[]
        for e in engines:
            target=e.arm.prop['cup-1']['body'];trace=[];poses=[]
            ctrl_before=e.data.ctrl[e.arm.grip_act].copy()
            def sample(m,d):
                trace.append(d.xfrc_applied.copy())
                assert np.array_equal(d.ctrl[e.arm.grip_act],ctrl_before)
                native_step(m,d)
            with monkeypatch.context() as patch:
                patch.setattr(mujoco,'mj_step',sample)
                patch.setattr(e.arm,'_put',lambda *args:pytest.fail('unexpected pose write'))
                for idx in range(-1,6):
                    intent={'presetId':'world-cup-nudge-v2','targetId':'cup-1','segmentIndex':idx} if 0<=idx<5 else None
                    row=e.step(home,.0889,[],0,0,intent)
                    assert np.count_nonzero(e.data.xfrc_applied)==0
                    poses.append(row['world']['props'][0]['position'])
            assert len(trace)==70
            for k,actual in enumerate(trace):
                expected=np.zeros_like(actual)
                if 10<=k<60: expected[target]=wrench
                np.testing.assert_array_equal(actual,expected)
            positions.append(poses)
        np.testing.assert_array_equal(*positions)
        assert positions[0][5][0]>positions[0][0][0]+.001
        with monkeypatch.context() as patch:
            def fail(m,d):
                np.testing.assert_array_equal(d.xfrc_applied[target],wrench)
                raise RuntimeError('native failure')
            patch.setattr(mujoco,'mj_step',fail)
            with pytest.raises(RuntimeError,match='native failure'):e.step(home,.0889,[],0,0,{'presetId':'world-cup-nudge-v2','targetId':'cup-1','segmentIndex':0})
        assert np.count_nonzero(e.data.xfrc_applied)==0
    finally:
        for e in engines:e.close()


def _start_measured_pulse(session):
    from mujoco_worker.session import scene_digest_of
    path=session.bundle_root/'lab-world-scene.json';scene=json.loads(path.read_text())
    pulse='world-cup-nudge-v2'
    scene['disturbance']={'presetId':pulse,'revision':2,'targetId':'cup-1','cupId':'cup-1','trigger':'after_belief_commit'}
    scene['sceneDigest']=scene_digest_of(scene);path.write_text(json.dumps(scene));session.expected_scene_digest=scene['sceneDigest']
    start_world(session)
    intent={'eventId':'rig-birth-1','cupId':'cup-1','propId':'cup-1','kind':'birth','targetTick':1}
    assert session.handle(world_step(session,placements=[{'propId':'cup-1','pose':{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]}}],intents=[intent]))['ok']
    for _ in range(12):assert session.handle(world_step(session,session.tick))['ok']
    return pulse

def test_session_measured_pulse_requires_five_adjacent_receipts_before_another_world_step(session):
    import hashlib,rfc8785
    pulse=_start_measured_pulse(session)
    serial=0
    def send(idx,**patch):
        nonlocal serial
        serial+=1;req=world_step(session,session.tick);req['requestId']=f'segment-{serial}'
        if idx is not None:req['payload']['worldPerturbations']=[{'eventId':'pulse','presetId':pulse,'revision':2,'targetId':'cup-1','targetTick':session.tick+1,'segmentIndex':idx,**patch}]
        return session.handle(req),req
    def reject(idx,**patch):
        tick,substeps=session.tick,session.engine.total_substeps
        reply,_=send(idx,**patch);assert not reply['ok'],reply
        assert session.tick==tick and session.engine.total_substeps==substeps
    reject(1);reject(0,forceMapN=[7,0,0]);reject(0,targetId='amr-1')
    for idx in range(5):
        if idx:
            reject(None);reject(idx-1);reject(idx+1);reject(idx,eventId='another')
        before=session.snapshot['props'][0]['position']
        reply,req=send(idx);assert reply['ok'],reply
        s=reply['result'];r=s['worldStep']['disturbances'][0]
        assert r=={**req['payload']['worldPerturbations'][0],'runId':s['runId'],'bootId':s['bootId'],'sceneDigest':s['sceneDigest'],'requestId':req['requestId'],'requestDigest':hashlib.sha256(rfc8785.dumps(req['payload'])).hexdigest(),'frame':'map','forceMapN':[4.025,0,0],'torqueMapNm':[0,-.05*4.025,0],'durationSubsteps':10,'beforePositionM':before,'afterPositionM':s['props'][0]['position']}
    reject(0);reply,_=send(None);assert reply['ok']
    assert 'disturbances' not in reply['result']['worldStep']



def test_measured_pulse_unknown_native_application_ends_session(monkeypatch,session):
    from mujoco_worker.protocol import WorkerError
    pulse=_start_measured_pulse(session);engine=session.engine
    def unknown(*args):
        raise WorkerError('NATIVE_APPLICATION_UNKNOWN','transport lost during application')
    monkeypatch.setattr(engine,'step',unknown)
    req=world_step(session,session.tick)
    req['payload']['worldPerturbations']=[{'eventId':'pulse','presetId':pulse,'revision':2,'targetId':'cup-1','targetTick':session.tick+1,'segmentIndex':0}]
    assert not session.handle(req)['ok']
    assert session.state=='failed' and session.engine is None
    assert not session.handle({**req,'requestId':'different-request'})['ok']
