"""Compose arm and mobile MJCF before creating exactly one MjModel.

Arm/mobile legacy compilers remain unchanged. Origin-specific geom parameters are
made explicit before merging, so a global default cannot replace the grip policy.
The new world policy deliberately differs from the mobile numerical lock.
"""
import copy
import xml.etree.ElementTree as ET
from .compile import compile_cell,CompileError
from .compile_mobile import compile_mobile

WORLD_NUMERICS={'id':'coffee-delivery-world-numerics-v1','revision':1,'calibration':'not_calibrated','timestepMs':2,'substeps':10,'primingSubsteps':10,'integrator':'implicitfast','cone':'elliptic','impratio':10,'solver':'Newton','iterations':100,'tolerance':1e-8,'floorSlidingFriction':1.0}

def compile_world(scene,component,arm_physics,physical_models,load_profile,mobile_physics,blob_dir,drive=None):
    if scene['numericalPolicy']!=WORLD_NUMERICS:
        raise CompileError('WORLD_NUMERICS_UNSUPPORTED')
    nav,arm=copy.deepcopy(scene['navigation']),copy.deepcopy(scene['armCell'])
    if len(nav['robots'])!=1 or not 1<=len(arm['props'])<=8:
        raise CompileError('WORLD_CAPACITY_EXCEEDED')
    if load_profile['props']:
        raise CompileError('WORLD_INITIAL_LOAD_NOT_EMPTY')
    mapping=scene['supportMap']
    if mapping['replacedStaticSupportId']!='tray' or sum(s['id']=='tray' for s in arm['supports'])!=1 or not any(s['id']=='nozzle-stand' for s in arm['supports']) or not any(s['supportId']==mapping['mobileSupportId'] for s in load_profile['supports']):
        raise CompileError('WORLD_SUPPORT_INVALID')
    if arm['world3d']['supportFriction']!=WORLD_NUMERICS['floorSlidingFriction']:
        raise CompileError('WORLD_CONTACT_POLICY_INVALID')
    arm['supports']=[s for s in arm['supports'] if s['id']!='tray']
    ax,an=compile_cell(arm,component,arm_physics,blob_dir,drive)
    bx,bn=compile_mobile(nav,physical_models,load_profile,mobile_physics,drive)
    a,b=ET.fromstring(ax),ET.fromstring(bx)
    a.set('model','coffee-delivery-world-v1')
    option=a.find('option')
    for k in ('integrator','cone','impratio','solver','iterations','tolerance'):
        option.set(k,str(WORLD_NUMERICS[k]))
    # Generated mobile symbols are disjoint from generated arm symbols. One floor
    # is intentionally shared; explicit caster/floor pairs retain their values.
    rename={x.attrib['name']:'M_'+x.attrib['name'] for x in b.iter() if 'name' in x.attrib}
    rename['FLOOR']='FLOOR'
    for x in b.iter():
        for k in ('name','joint','joint1','joint2','body1','body2','geom1','geom2','mesh'):
            if k in x.attrib:x.set(k,rename[x.attrib[k]])
    for g in b.find('worldbody').iter('geom'):
        for k,v in b.find('default/geom').attrib.items():
            if k not in g.attrib:g.set(k,v)
        if g.attrib.get('group')=='1':
            # Mobile self-overlaps remain masked; arm/pads/props/floor still contact.
            g.set('contype','8');g.set('conaffinity','3')
    b.find('worldbody').remove(b.find("worldbody/geom[@name='FLOOR']"))
    for section in ('worldbody','asset','actuator','contact'):
        a.find(section).extend(list(b.find(section)))
    # Home is initialized by joint identity after compilation, never by concatenating
    # qpos vectors whose free-joint lengths depend on XML traversal order.
    a.remove(a.find('keyframe'))
    for key in ('links','joints','geoms','props','statics'):
        bn[key]={k:rename[v] for k,v in bn[key].items()}
    for key in ('wheelJoints','actuators'):bn[key]=[rename[v] for v in bn[key]]
    bn['base']=rename[bn['base']]
    bn['tags']={rename[k]:v for k,v in bn['tags'].items()}
    ET.indent(a,space=' ')
    return ET.tostring(a,encoding='unicode')+'\n',{'arm':an,'mobile':bn,'policy':copy.deepcopy(WORLD_NUMERICS)}
