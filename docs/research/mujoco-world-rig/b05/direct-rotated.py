import sys,json,copy,xml.etree.ElementTree as ET
from pathlib import Path
import numpy as np
import mujoco
ROOT=Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source')
sys.path[:0]=[str(ROOT/'robotics/simulation-mujoco'),str(ROOT/'robotics/simulation-mujoco/tests')]
from mujoco_worker.compile import compile_cell
from mujoco_worker.compile_mobile import compile_mobile
from scene_fixture import cell_scene,load,BLOBS
MF=ROOT/'robotics/simulation-mujoco/fixtures/serve-payload-v1'
def rd(n): return json.loads((MF/n).read_text())
dock=rd('dock-feasibility.json'); nav=rd('navigation-scene.json'); empty=rd('empty.json'); phys=rd('drive-contact-profile.json')
nav['robots'][0]['initialPoseMap']=[.35,.48591366218667575,np.pi/2]
nav['world']['obstacles']=[];nav['world']['boundaries']=[]
nav['engine']['loadProfileRef'].update(id=empty['id'],revision=empty['revision'])
sc=cell_scene(); sc['supports']=[s for s in sc['supports'] if s['id']!='tray']
a,an=compile_cell(sc,load('component.json'),load('physics.json'),str(BLOBS)); b,bn=compile_mobile(nav,{'amr-1':rd('physical-model-amr-1.json')},empty,phys)
a,b=ET.fromstring(a),ET.fromstring(b)
# Explicit new world numerics; original profiles unchanged. Preserve geom defaults per origin.
a.find('option').set('solver','Newton'); a.find('option').set('iterations','100'); a.find('option').set('tolerance','1e-8')
names={x.attrib['name']:'M_'+x.attrib['name'] for x in b.iter() if 'name' in x.attrib};names['FLOOR']='FLOOR'
for x in b.iter():
 for k in ['name','joint','joint1','joint2','body1','body2','geom1','geom2','mesh']:
  if k in x.attrib:x.set(k,names[x.attrib[k]])
for g in b.find('worldbody').iter('geom'):
 for k,v in b.find('default/geom').attrib.items():
  if k not in g.attrib:g.set(k,v)
 if g.attrib.get('group')=='1':g.set('contype','8');g.set('conaffinity','3')
b.find('worldbody').remove(b.find("worldbody/geom[@name='FLOOR']"))
for section in ['worldbody','asset','actuator','contact']:
 a.find(section).extend(list(b.find(section)))
a.remove(a.find('keyframe'))
xml=ET.tostring(a,encoding='unicode');Path('/tmp/mekoniq-b05-probe/rotated-world.xml').write_text(xml)
m=mujoco.MjModel.from_xml_string(xml);d=mujoco.MjData(m)
armj=[m.joint(n).id for n in an['joints']];qa=m.jnt_qposadr[armj]
wp=load('programs.json')['programs']['waypoints'];wp['place']=dock['ik']['jointPositionsRad'];wp['placeApproach']=json.loads(Path('/tmp/mekoniq-b05-probe/sweep.json').read_text())['waypoints']['horizontalApproach']
body_name={names[n]:lid for lid,n in bn['links'].items()}
def contacts():
 out=[]
 for c in d.contact[:d.ncon]:
  g1,g2=map(int,c.geom);b1,b2=m.geom_bodyid[[g1,g2]]
  out.append({'a':m.geom(g1).name or m.body(b1).name,'b':m.geom(g2).name or m.body(b2).name,'bodyA':body_name.get(m.body(b1).name,m.body(b1).name),'bodyB':body_name.get(m.body(b2).name,m.body(b2).name),'distanceM':float(c.dist)})
 return out
result={'engine':mujoco.__version__,'policy':dict(a.find('option').attrib),'modelCount':1,'trayInitiallyEmpty':True,'waypoints':{}}
for name,q in wp.items():
 mujoco.mj_resetData(m,d);d.qpos[qa]=q;mujoco.mj_forward(m,d)
 result['waypoints'][name]={'q':q,'contacts':contacts()}
Path('/tmp/mekoniq-b05-probe/rotated-preflight.json').write_text(json.dumps(result,indent=2))
print(json.dumps({k:[c for c in v['contacts'] if c['a']!='FLOOR'] for k,v in result['waypoints'].items()},indent=2))

mujoco.mj_resetData(m,d);d.qpos[qa]=wp['home'];mujoco.mj_forward(m,d)
obstacles=[]
for name in [names[n] for n in bn['geoms'].values()]+list(an['supports'].values()):
 g=m.geom(name).id;size=m.geom_size[g];rot=d.geom_xmat[g].reshape(3,3);center=d.geom_xpos[g]
 if m.geom_type[g]==mujoco.mjtGeom.mjGEOM_BOX:extent=abs(rot)@size
 elif m.geom_type[g]==mujoco.mjtGeom.mjGEOM_SPHERE:extent=np.full(3,size[0])
 elif m.geom_type[g]==mujoco.mjtGeom.mjGEOM_CYLINDER:extent=np.sqrt(np.maximum(0,1-rot[:,2]**2))*size[0]+abs(rot[:,2])*size[1]
 else:raise ValueError(name)
 obstacles.append({'id':body_name.get(m.body(m.geom_bodyid[g]).name,'nozzle-stand')+'/'+name,'kind':'box','min':(center-extent).tolist(),'max':(center+extent).tolist()})
Path('/tmp/mekoniq-b05-probe/rotated-obstacles.json').write_text(json.dumps(obstacles,indent=2))
