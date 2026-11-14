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
