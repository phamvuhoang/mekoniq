"""protocol_double: independent world cup pose occupancy, never Gazebo execution evidence."""
import copy
import pytest
from bridge.tray_observer import TrayObserver

IDENTITY = {"runId": "run-1", "worldRevision": "world-r1", "cupId": "cup-1", "fixtureId": "cup-fixture", "transferId": "transfer-1", "commandId": "cmd-1", "payloadHash": "a"*64, "controlEpoch": 1, "robotId": "robot_a", "slot": 1}
CONFIG = {"cups": [{"fixtureId": "cup-fixture", "gazeboModel": "cup_fixture", "positionM": [0.4, 0.1, 0.2]}], "trays": [{"robotId": "amr-a", "slot": 1, "offsetM": [0, 0, 0.5], "dockPositionM": [1, 2, 0], "toleranceM": 0.02}]}
def pose(x,y,z=0):return {"position":{"x":x,"y":y,"z":z},"orientation":{"x":0,"y":0,"z":0,"w":1}}
def receipt(value, seq=1, now=0):return {"value":value,"sequence":seq,"simTimeNs":now,"receivedMonotonicNs":now}
def setup():
    now=[0];o=TrayObserver(CONFIG, run_id="run-1",world_revision="world-r1",boot_id="gz-1",robots={"robot_a":"amr-a"},monotonic_ns=lambda:now[0]);o.bind(IDENTITY);return o,now

def test_release_flag_cannot_create_receiver_and_wrong_world_cup_never_proves_receipt():
    o,now=setup();robots={"robot_a":receipt(pose(1,2))};local={"robot_a":receipt({"positionM":[1,2,0],"valid":True})}
    assert o.sample(0,robots,{},local)==[]
    now[0]=20_000_000;robots["robot_a"]=receipt(pose(1,2),2,now[0]);local["robot_a"]=receipt({"positionM":[1,2,0],"valid":True},2,now[0])
    assert o.sample(now[0],robots,{"wrong_cup":receipt(pose(1,2,.5),2,now[0])},local)==[]
    received=o.sample(now[0],robots,{"cup_fixture":receipt(pose(1,2,.5),2,now[0])},local)
    assert len(received)==1 and received[0]["producer"]=="gazebo_tray" and received[0]["observerId"]!="linuxcnc-grip:gz-1"
    assert received[0]["parent"]=="robot:amr-a/tray:1" and received[0]["phase"]=="receive"
    assert o.sample(now[0],robots,{"cup_fixture":receipt(pose(1,2,.5),2,now[0])},local)==[]

@pytest.mark.parametrize('issue',['cup_missing','moving','localization_missing','stale','cup_off_tray'])
def test_no_receipt_when_actual_receiver_conditions_absent(issue):
    o,now=setup();o.sample(0,{"robot_a":receipt(pose(1,2))},{},{})
    now[0]=20_000_000;clock=now[0];r={"robot_a":receipt(pose(1.1 if issue=='moving' else 1,2),2,clock)}
    c={"cup_fixture":receipt(pose(1.1 if issue=='cup_off_tray' else 1,2,.5),2,clock)};l={"robot_a":receipt({"positionM":[1,2,0],"valid":True},2,clock)}
    if issue=='cup_missing':c={}
    if issue=='localization_missing':l={}
    if issue=='stale':now[0]=600_000_000
    assert o.sample(clock,r,c,l)==[]

def test_wrong_receiver_slot_run_epoch_and_unknown_fixture_refused():
    o,_=setup()
    for change in ({"robotId":"wrong"},{"slot":2},{"runId":"wrong"},{"worldRevision":"wrong"},{"fixtureId":"unknown"},{"controlEpoch":0}):
        with pytest.raises(ValueError):o.bind({**IDENTITY,**change})

def test_compiler_pins_pose_driven_cup_geometry_and_subscription_models(tmp_path):
    import json
    from pathlib import Path
    from compiler.compile_world import compile_world
    from bridge.launch_plan import plan_launch
    root=Path(__file__).resolve().parents[3]/'tests/fixtures/digital-twin'
    fx=json.loads((root/'restaurant-v2.json').read_text());assets=[json.loads((root/f).read_text()) for f in fx['assetFiles']]
    config=copy.deepcopy(CONFIG);config['trays'][0]['robotId']='amr-1'
    scenario={'id':'beverage-test','revision':1,'scenarioId':'BV01','actors':[],'blockers':[],'faults':[],'beverage':config}
    result=compile_world(fx['project'],assets,tmp_path,scenario=scenario)
    scene=json.loads((tmp_path/'scene-index.json').read_text());assert scene['beverage']==config
    text=(tmp_path/'world.sdf').read_text();assert 'name="cup_fixture"' in text and 'name="cup_collision"' in text and 'PosePublisher' in text
    plan=plan_launch(tmp_path,[result['robots'][0]['namespace']]);assert plan['cups']==['cup_fixture']

@pytest.mark.parametrize('start,end,expected', [(0.0, 0.1, False), (3.1415, -3.1415, True)])
def test_stationary_requires_bounded_rotation_with_yaw_wrap(start,end,expected):
    import math
    observer,now=setup()
    def rotated(yaw):
        p=pose(1,2);p['orientation']={'x':0,'y':0,'z':math.sin(yaw/2),'w':math.cos(yaw/2)};return p
    observer.sample(0,{'robot_a':receipt(rotated(start))},{},{})
    now[0]=20_000_000
    observations=observer.sample(now[0],{'robot_a':receipt(rotated(end),2,now[0])},{'cup_fixture':receipt(pose(1,2,.5),2,now[0])},{'robot_a':receipt({'positionM':[1,2,0],'valid':True},2,now[0])})
    assert bool(observations) is expected

def test_invalid_orientation_breaks_the_consecutive_stationary_pair():
    observer,now=setup();observer.sample(0,{'robot_a':receipt(pose(1,2))},{},{})
    now[0]=20_000_000;invalid=pose(1,2);invalid['orientation']={'x':0,'y':0,'z':0,'w':0}
    observer.sample(now[0],{'robot_a':receipt(invalid,2,now[0])},{},{})
    now[0]=40_000_000
    assert observer.sample(now[0],{'robot_a':receipt(pose(1,2),3,now[0])},{'cup_fixture':receipt(pose(1,2,.5),3,now[0])},{'robot_a':receipt({'positionM':[1,2,0],'valid':True},3,now[0])})==[]
