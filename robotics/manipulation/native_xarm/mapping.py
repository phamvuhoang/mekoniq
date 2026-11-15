"""Capture/validate actual expanded URDF. Expected projection is static data, never a generated native observation."""
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
from .policy import ROOT,load_profile

def validate_urdf(xml,mode):
    if mode not in ('X1','X2') or len(xml)>4_000_000 or any(t in xml.upper() for t in ['<!DOCTYPE','<!ENTITY','<![CDATA[']):raise ValueError('XARM_XML_INVALID')
    try:robot=ET.fromstring(xml)
    except ET.ParseError:raise ValueError('XARM_XML_INVALID') from None
    if robot.tag!='robot':raise ValueError('XARM_XML_INVALID')
    target=json.loads((ROOT/'profiles/xarm6-native-mapping.json').read_text())
    def one(node,key):
        children=node.findall(key)
        if len(children)!=1:raise ValueError('XARM_MAPPING_INVALID:'+key)
        return children[0]
    def numbers(raw):
        if not isinstance(raw,str):raise ValueError('XARM_MAPPING_NUMERIC')
        tokens=raw.split()
        if not tokens or any(not re.fullmatch(r'[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?',t) for t in tokens):raise ValueError('XARM_MAPPING_NUMERIC')
        values=[float(t) for t in tokens]
        if not all(math.isfinite(v) for v in values):raise ValueError('XARM_MAPPING_NUMERIC')
        return values
    def near(raw,expected):
        values=numbers(raw)
        if len(values)!=len(expected) or any(not math.isfinite(a) or abs(a-b)>1e-9 for a,b in zip(values,expected)):raise ValueError('XARM_MAPPING_MISMATCH')
    joints=robot.findall('joint');names=[j.get('name') for j in joints];children=[one(j,'child').get('link') for j in joints]
    if len(set(names))!=len(names) or len(set(children))!=len(children):raise ValueError('XARM_MAPPING_DUPLICATE')
    if len(joints)!=len(target['joints']) or any(n.tag not in ('link','joint','material','ros2_control','transmission','gazebo') for n in robot):raise ValueError('XARM_MODEL_GRAPH_INVALID')
    for expected in target['joints']:
        matches=[j for j in joints if j.get('name')==expected['name']]
        if len(matches)!=1:raise ValueError('XARM_MAPPING_MISMATCH')
        joint=matches[0]
        if joint.get('type')!=expected['type'] or one(joint,'parent').get('link')!=expected['parent'] or one(joint,'child').get('link')!=expected['child']:raise ValueError('XARM_MAPPING_MISMATCH')
        mimics=joint.findall('mimic')
        if 'mimic' in expected:
            if len(mimics)!=1 or mimics[0].get('joint')!=expected['mimic']['joint'] or set(mimics[0].attrib)-{'joint','multiplier','offset'} or len(mimics[0]):raise ValueError('XARM_MIMIC_INVALID')
            near(mimics[0].get('multiplier','1'),[expected['mimic']['multiplier']]);near(mimics[0].get('offset','0'),[expected['mimic']['offset']])
        elif mimics:raise ValueError('XARM_MIMIC_INVALID')
        origin=one(joint,'origin');near(origin.get('xyz'),expected['xyz']);near(origin.get('rpy'),expected['rpy'])
        if 'axis' in expected:
            near(one(joint,'axis').get('xyz'),expected['axis']);limit=one(joint,'limit')
            for key,value in expected['limits'].items():near(limit.get(key),[value])
    links=robot.findall('link')
    if len({l.get('name') for l in links})!=len(links):raise ValueError('XARM_MAPPING_DUPLICATE')
    expected_links={n for j in target['joints'] for n in (j['parent'],j['child'])}
    if {l.get('name') for l in links}!=expected_links or any(one(j,k).get('link') not in expected_links for j in joints for k in ('parent','child')):raise ValueError('XARM_MODEL_GRAPH_INVALID')
    visited=set()
    def visit(name):
        if name in visited:raise ValueError('XARM_MODEL_GRAPH_INVALID')
        visited.add(name)
        for j in joints:
            if one(j,'parent').get('link')==name:visit(one(j,'child').get('link'))
    visit(target['nativeAttachment']['root'])
    if len(visited)!=len(links):raise ValueError('XARM_MODEL_GRAPH_INVALID')
    for link in links:
        if not any(v['link']==link.get('name') for v in target['visualMeshes']) and link.findall('visual'):raise ValueError('XARM_VISUAL_INVALID')
    for expected in target['visualMeshes']:
        link=next(l for l in links if l.get('name')==expected['link']);visual=one(link,'visual');geometry=one(visual,'geometry');mesh=one(geometry,'mesh')
        uri=expected['uri'].replace('package://xarm_description','file://'+load_profile()['descriptionShare']) if mode=='X2' else expected['uri']
        if len(geometry)!=1 or len(mesh) or set(mesh.attrib)-{'filename','scale'} or mesh.get('filename')!=uri:raise ValueError('XARM_G2_1305_MAPPING_MISMATCH')
        origins=visual.findall('origin')
        if len(origins)>1:raise ValueError('XARM_VISUAL_INVALID')
        near(origins[0].get('xyz','0 0 0') if origins else '0 0 0',expected['xyz']);near(origins[0].get('rpy','0 0 0') if origins else '0 0 0',expected['rpy']);near(mesh.get('scale','1 1 1'),expected['scale'])
    for expected in target['nominalInertials']:
        link=next(l for l in links if l.get('name')==expected['link']);inertial=one(link,'inertial');origin=one(inertial,'origin')
        near(origin.get('xyz'),expected['comM']);near(origin.get('rpy'),[0,0,0]);near(one(inertial,'mass').get('value'),[expected['massKg']]);tensor=one(inertial,'inertia')
        for key,value in zip(['ixx','ixy','ixz','iyy','iyz','izz'],expected['inertiaKgM2']):near(tensor.get(key),[value])
    extension_xml=json.loads((ROOT/'profiles/xarm6-sim-extensions.json').read_text())['xml'].replace('{hardwarePlugin}',load_profile()['modes'][mode]['plugin'])
    expected_extensions=ET.fromstring(extension_xml)
    actual=[n for n in robot if n.tag in ('ros2_control','transmission','gazebo')]
    if mode=='X2':
        controls=[n for n in actual if n.tag=='gazebo' and any(c.tag=='plugin' and c.get('name')=='gz_ros2_control::GazeboSimROS2ControlPlugin' for c in n)]
        if len(controls)!=1:raise ValueError('XARM_GAZEBO_CONTROL_INVALID')
        parameter=one(one(controls[0],'plugin'),'parameters').text or ''
        if not re.fullmatch(r'/tmp/launch_params_[A-Za-z0-9_]{1,80}',parameter.strip()):raise ValueError('XARM_CONTROL_PARAMETERS_INVALID')
        expected_extensions.append(ET.fromstring('<gazebo><plugin filename="gz_ros2_control-system" name="gz_ros2_control::GazeboSimROS2ControlPlugin"><parameters>'+parameter.strip()+'</parameters></plugin></gazebo>'))
    def semantic(n):
        text=(n.text or '').strip()
        if n.tag in ('param','mechanicalReduction','multiplier','offset','sensitiveness','maxEffort'):
            values=numbers(text)
            if len(values)!=1:raise ValueError('XARM_MAPPING_NUMERIC')
            text=round(values[0],9)
        return json.dumps([n.tag,sorted(n.attrib.items()),text,sorted(semantic(c) for c in n)])
    if sorted(map(semantic,actual))!=sorted(map(semantic,expected_extensions)):raise ValueError('XARM_CONTROL_DECLARATION_MISMATCH')
    tags={'plugin','ros2_control','gazebo','transmission'}
    if sorted(n.tag for n in robot.iter() if n.tag in tags)!=sorted(n.tag for a in actual for n in a.iter() if n.tag in tags):raise ValueError('XARM_PLUGIN_PLACEMENT_INVALID')
    return {'schemaVersion':1,'mode':mode,'scope':target['scope'],'profileId':load_profile()['id'],'urdfSha256':hashlib.sha256(xml.encode()).hexdigest()}

def produce_mapping(xml,mode,directory,subject=None,evidence_kind="protocol_double",controller=None):
    subject=subject or {}
    report=validate_urdf(xml,mode)
    report.update(producer="native_xarm.robot_description.v1",sourceCommit=subject.get("sourceCommit"),subjectProfileId=subject.get("profileId"),environmentProfile=subject.get("environmentProfile"),sourceModelSha256=json.loads((ROOT/"profiles/xarm6-native-mapping.json").read_text())["sourceModelSha256"],vendorCommit=load_profile()["vendorCommit"],evidenceKind=evidence_kind,syntheticSimModelSelector=load_profile()["syntheticSimModelSelector"])
    if controller is not None:report["controller"]=controller
    with (directory/'expanded.urdf').open('x') as f:f.write(xml)
    with (directory/'mapping.json').open('x') as f:json.dump(report,f,indent=2)
    return report
