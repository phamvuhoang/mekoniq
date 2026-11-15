"""Immutable server launch/trajectory policy. Source pins are not installed package pins."""
import hashlib
import json
import math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def load_profile():return json.loads((ROOT/'profiles/xarm6-jazzy-sim.json').read_text())

def launch_argv(mode):
    p=load_profile()
    if mode not in p['modes']:raise ValueError('XARM_MODE_INVALID')
    args=['ros2','launch','xarm_moveit_config',p['modes'][mode]['launch'],'dof:=6','robot_type:=xarm','model1300:=false','gripper_version:=G2','add_gripper:=true','limited:=false','prefix:=','hw_ns:=xarm','no_gui_ctrl:=true','robot_sn:='+p['syntheticSimModelSelector']]
    if mode=='X2':args+=['gz_type:=gz']
    return args

def verify_vendor():
    lock=json.loads((ROOT/'native-vendor.lock.json').read_text());reasons=[]
    for f in lock['files']:
        path=ROOT/'vendor-source'/f['path']
        if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=f['contentSha256']:reasons.append('VENDOR_SOURCE_MISMATCH:'+f['path'])
    return reasons

def prerequisites():
    # Source preparation never manufactures a resolved native environment lock.
    return verify_vendor()+['INVENTORY_UNRESOLVED','PLUGIN_INVENTORY_UNRESOLVED','NATIVE_MAPPING_NOT_OBSERVED']

def map_joints(names,values):
    wanted=[x['native'] for x in load_profile()['jointMap']]
    if len(names)!=len(set(names)) or not set(wanted)<=set(names) or len(names)!=len(values) or not all(isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) for v in values):raise ValueError('JOINT_FEEDBACK_INVALID')
    return [values[names.index(n)] for n in wanted]

def validate_trajectory(points,actual):
    p=load_profile();policy=p['trajectory']
    if not isinstance(points,list) or not 1<=len(points)<=policy['maxPoints'] or len(actual)!=6:raise ValueError('TRAJECTORY_INVALID')
    previous=actual;time=0
    for point in points:
        if set(point)!={'positions','timeS'}:raise ValueError('TRAJECTORY_INVALID')
        q=point['positions'];t=point['timeS']
        if not isinstance(q,list) or len(q)!=6 or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in [*q,t]) or not time<t<=policy['maxDurationS']:raise ValueError('TRAJECTORY_INVALID')
        for i,v in enumerate(q):
            limit=p['jointMap'][i]['limits']
            if not limit['lower']<=v<=limit['upper'] or abs(v-previous[i])/(t-time)>min(policy['maxVelocityRadS'],limit['velocity']):raise ValueError('TRAJECTORY_LIMIT')
        previous=q;time=t

def assess_contact(evidence):
    reasons=[];trials=evidence.get('trials',[])
    if evidence.get('evidenceKind')!='gazebo_actual':reasons.append('CONTACT_NATIVE_REQUIRED')
    if len(trials)!=10 or len({t.get('id') for t in trials})!=10:reasons.append('TEN_DISTINCT_TRIALS_REQUIRED')
    for t in trials:
        if not all(t.get(k) is True for k in ['grip','release','supportObserved','receiverObserved']):reasons.append('CONTACT_OUTCOME_MISSING')
        for k in ['collisionExclusionsSha256','rawObservationsSha256','mappingSha256']:
            value=t.get(k,'')
            if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):reasons.append('CONTACT_PROVENANCE_MISSING')
    # Structural evidence alone cannot clear the unresolved installed G2 plugin and native readback gates.
    reasons.append(load_profile()['contact']['reason'])
    return {'result':'not_run','blockers':sorted(set(reasons)),'accepted':False,'dynamics':'not_calibrated'}


def decode_sim_selector(value):
    """Explain the pinned upstream decoder branch; never a device identity validator."""
    if len(value)!=14 or not value.startswith('XI') or value[11]!='B':raise ValueError('SIM_SELECTOR_INVALID')
    model=int(value[2:6]);date=int(value[8:10]+value[6:8]);mass=11 if date>=2004 else 1
    return {'modelNum':model,'modelType':6,'dateCode':date,'massType':mass,'inertialFile':'xarm6_type6_HT_BR2' if mass==11 else 'xarm6_type6_HT_BR'}
