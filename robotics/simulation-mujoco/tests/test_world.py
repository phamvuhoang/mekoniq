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
def test_cup_nudge_is_a_registered_push_that_moves_the_cup_but_keeps_it_on_its_support():
 # R4.4 (R4-D33): the push must exceed the grasp tolerance observed in the study (a few mm each side of the open gripper) and must not tip or drop the cup; a no-op or a fall is not a nudge
 e=WorldEngine(*inputs());home=load('programs.json')['programs']['waypoints']['home']
 e.step(home,.0889,[('cup-1',{'position':[.49,0,.151],'quaternionXyzw':[0,0,0,1]})],0,0)
 for _ in range(50):r=e.step(home,.0889,[],0,0)
 before=r['world']['props'][0]['position']
 r=e.step(home,.0889,[],0,0,{'presetId':'world-cup-nudge-v1','targetId':'cup-1'})
 for _ in range(100):r=e.step(home,.0889,[],0,0)
 p=r['world']['props'][0];moved=float(np.hypot(p['position'][0]-before[0],p['position'][1]-before[1]))
 print('NUDGE_MM',round(moved*1000,2),p['restingOn'],p['position'][2]-before[2])
 assert .006<moved<.03 and p['restingOn']=='nozzle-stand' and abs(p['position'][2]-before[2])<.001
 assert np.count_nonzero(e.data.xfrc_applied)==0
 e.close()
