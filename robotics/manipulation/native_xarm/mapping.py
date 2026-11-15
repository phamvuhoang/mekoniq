"""Capture/validate actual expanded URDF. Expected projection is static data, never a generated native observation."""
import hashlib
import json
import math
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
    def near(raw,expected):
        try:values=[float(x) for x in raw.split()]
        except (AttributeError,ValueError):raise ValueError('XARM_MAPPING_NUMERIC') from None
        if len(values)!=len(expected) or any(not math.isfinite(a) or abs(a-b)>1e-9 for a,b in zip(values,expected)):raise ValueError('XARM_MAPPING_MISMATCH')
    joints=robot.findall('joint');names=[j.get('name') for j in joints];children=[one(j,'child').get('link') for j in joints]
    if len(set(names))!=len(names) or len(set(children))!=len(children):raise ValueError('XARM_MAPPING_DUPLICATE')
    for expected in target['joints']:
        matches=[j for j in joints if j.get('name')==expected['name']]
        if len(matches)!=1:raise ValueError('XARM_MAPPING_MISMATCH')
        joint=matches[0]
        if joint.get('type')!=expected['type'] or one(joint,'parent').get('link')!=expected['parent'] or one(joint,'child').get('link')!=expected['child']:raise ValueError('XARM_MAPPING_MISMATCH')
        origin=one(joint,'origin');near(origin.get('xyz'),expected['xyz']);near(origin.get('rpy'),expected['rpy'])
        if 'axis' in expected:
            near(one(joint,'axis').get('xyz'),expected['axis']);limit=one(joint,'limit')
            for key,value in expected['limits'].items():near(limit.get(key),[value])
    links=robot.findall('link')
    if len({l.get('name') for l in links})!=len(links):raise ValueError('XARM_MAPPING_DUPLICATE')
    for expected in target['visualMeshes']:
        matches=[l for l in links if l.get('name')==expected['link']]
        uri=expected['uri'].replace('package://xarm_description','file://'+load_profile()['descriptionShare']) if mode=='X2' else expected['uri']
        if len(matches)!=1 or one(one(one(matches[0],'visual'),'geometry'),'mesh').get('filename')!=uri:raise ValueError('XARM_G2_1305_MAPPING_MISMATCH')
    for expected in target['nominalInertials']:
        link=next(l for l in links if l.get('name')==expected['link']);inertial=one(link,'inertial');origin=one(inertial,'origin')
        near(origin.get('xyz'),expected['comM']);near(origin.get('rpy'),[0,0,0]);near(one(inertial,'mass').get('value'),[expected['massKg']]);tensor=one(inertial,'inertia')
        for key,value in zip(['ixx','ixy','ixz','iyy','iyz','izz'],expected['inertiaKgM2']):near(tensor.get(key),[value])
    controls=robot.findall('ros2_control')
    if not controls:raise ValueError('XARM_PLUGIN_MISSING')
    for control in controls:
        if one(one(control,'hardware'),'plugin').text.strip()!=load_profile()['modes'][mode]['plugin']:raise ValueError('XARM_HARDWARE_PLUGIN_FORBIDDEN')
    return {'schemaVersion':1,'mode':mode,'scope':target['scope'],'profileId':load_profile()['id'],'urdfSha256':hashlib.sha256(xml.encode()).hexdigest()}

def produce_mapping(xml,mode,directory,subject=None,evidence_kind="protocol_double",controller=None):
    subject=subject or {}
    report=validate_urdf(xml,mode)
    report.update(producer="native_xarm.robot_description.v1",sourceCommit=subject.get("sourceCommit"),subjectProfileId=subject.get("profileId"),environmentProfile=subject.get("environmentProfile"),sourceModelSha256=json.loads((ROOT/"profiles/xarm6-native-mapping.json").read_text())["sourceModelSha256"],vendorCommit=load_profile()["vendorCommit"],evidenceKind=evidence_kind,syntheticSimModelSelector=load_profile()["syntheticSimModelSelector"])
    if controller is not None:report["controller"]=controller
    with (directory/'expanded.urdf').open('x') as f:f.write(xml)
    with (directory/'mapping.json').open('x') as f:json.dump(report,f,indent=2)
    return report
