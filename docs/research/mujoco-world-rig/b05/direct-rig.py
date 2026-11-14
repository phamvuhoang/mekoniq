import sys,json,gzip,hashlib,os,math
from pathlib import Path
import numpy as np
import mujoco
ROOT=Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source')
sys.path.insert(0,str(ROOT/'robotics/simulation-mujoco'))
from mujoco_worker.drive import torque_limits
DIR=Path('/tmp/mekoniq-b05-probe')
xml=(DIR/'rotated-world.xml').read_text(); wp=json.loads((DIR/'waypoints.json').read_text()); phys=json.loads((ROOT/'robotics/simulation-mujoco/fixtures/serve-payload-v1/drive-contact-profile.json').read_text())
m=mujoco.MjModel.from_xml_string(xml);d=mujoco.MjData(m)
qa=m.jnt_qposadr[[m.joint('J'+str(i)).id for i in range(1,7)]];va=m.jnt_dofadr[[m.joint('J'+str(i)).id for i in range(1,7)]]
aa=[m.actuator('J'+str(i)+'_act').id for i in range(1,7)];ga=m.actuator('grip_act').id
acts=[m.actuator('M_DRIVE_'+str(i)).id for i in range(2)];wv=m.jnt_dofadr[[m.joint('M_WHEEL_'+str(i)).id for i in range(2)]]
cb=m.body('PROP_1').id;cg=m.geom('PROP_1').id;cqa=m.jnt_qposadr[m.body_jntadr[cb]];cva=m.jnt_dofadr[m.body_jntadr[cb]]
base=m.body('M_BODY_2').id # verify actual mapping below from geom0 parent
base=m.geom_bodyid[m.geom('M_GEOM_0').id];bqa=m.jnt_qposadr[m.body_jntadr[base]];bva=m.jnt_dofadr[m.body_jntadr[base]]
tray=m.geom_bodyid[m.geom('M_GEOM_5').id]
q=np.array(wp['home']);d.qpos[qa]=q;d.ctrl[aa]=q;mujoco.mj_forward(m,d)
tick=-1;steps=0;active=False;grip=0;v=0;last=None;maxjump=0;gripped=False;received=0;unexpected=[];stage='prime'
offset=[float(sys.argv[1]),float(sys.argv[2])] if len(sys.argv)>2 else [0,0]
runname='trial-'+str(sys.argv[3] if len(sys.argv)>3 else 'probe2')
f=gzip.open(DIR/(runname+'.ndjson.gz'),'wt')
def vec(v):return np.array(v).tolist()
def sample_contacts():
 force=np.zeros(6);out=[]
 for i,c in enumerate(d.contact[:d.ncon]):
  if c.exclude:continue
  mujoco.mj_contactForce(m,d,i,force)
  a,b=map(int,c.geom);a=m.geom(a).name or m.body(m.geom_bodyid[a]).name;b=m.geom(b).name or m.body(m.geom_bodyid[b]).name
  out.append({'a':a,'b':b,'distanceM':float(c.dist),'pointMapM':vec(c.pos),'forceContact':vec(force),'frame':vec(c.frame)})
 return out

def step(placement=False):
 global tick,steps,last,maxjump,received
 d.ctrl[aa]=q;d.ctrl[ga]=grip;d.ctrl[acts]=v/.09
 subs=[]
 for k in range(10):
  for act,vel in zip(acts,d.qvel[wv]):m.actuator_forcerange[act]=torque_limits(float(vel),v/.09,phys)
  before=[int(w.number) for w in d.warning]
  mujoco.mj_step(m,d);steps+=1
  if before!=[int(w.number) for w in d.warning] or not np.isfinite(d.qpos).all() or not np.isfinite(d.qvel).all():raise RuntimeError('PLANT_UNSTABLE')
  cs=sample_contacts();subs.append(cs)
  for c in cs:
   if (c['a'].startswith('M_') and (c['b'].startswith('ARM_') or c['b']=='PALM')) or (c['b'].startswith('M_') and (c['a'].startswith('ARM_') or c['a']=='PALM')):unexpected.append({'tick':tick+1,'stage':stage,**c})
 mujoco.mj_forward(m,d);tick+=1
 pose=vec(d.qpos[cqa:cqa+7]) if active else None
 if last is not None and pose:maxjump=max(maxjump,float(np.linalg.norm(np.array(pose[:3])-last)))
 if pose:last=np.array(pose[:3])
 rel=None;rv=None
 if active:
  rel=d.xmat[tray].reshape(3,3).T@(d.xpos[cb]-d.xpos[tray]);sv=np.zeros(6);cv=np.zeros(6)
  mujoco.mj_objectVelocity(m,d,mujoco.mjtObj.mjOBJ_BODY,tray,sv,0);mujoco.mj_objectVelocity(m,d,mujoco.mjtObj.mjOBJ_BODY,cb,cv,0)
  rv=cv[3:]-(sv[3:]+np.cross(sv[:3],d.xpos[cb]-d.xpos[tray]))
 r={'tick':tick,'engineTimeS':float(d.time),'physicsSubsteps':steps,'stage':stage,'activePropIds':['cup-1'] if active else [],'placement':placement,'cupPoseWxyz':pose,'cupVelocity':vec(d.qvel[cva:cva+6]) if active else None,'armQ':vec(d.qpos[qa]),'armV':vec(d.qvel[va]),'amrPoseWxyz':vec(d.qpos[bqa:bqa+7]),'amrVelocity':vec(d.qvel[bva:bva+6]),'cupInTrayM':vec(rel) if rel is not None else None,'relativeSpeedMps':float(np.linalg.norm(rv)) if rv is not None else None,'substepContacts':subs}
 f.write(json.dumps(r,separators=(',',':'))+'\n');return r

def hold(n):
 r=None
 for _ in range(n):r=step()
 return r

def move(name,n=150):
 global q,stage
 stage='move-'+name;start=q.copy();target=np.array(wp[name])
 for i in range(1,n+1):
  t=i/n;q=start+(target-start)*(10*t**3-15*t**4+6*t**5);step()
 return hold(25)
summary={'accepted':False,'engineVersion':mujoco.__version__,'workerCount':1,'modelCount':1,'workerPid':os.getpid(),'scope':'direct physical rig, no source business custody','offsetM':offset,'xmlSha256':hashlib.sha256(xml.encode()).hexdigest(),'primingSubsteps':10}
try:
 step();stage='dock';hold(90)
 dockRows=[step() for _ in range(10)]
 summary['dockWindowTicks']=sum(float(np.linalg.norm(r['amrVelocity'][:2]))<=.01 and abs(r['amrVelocity'][5])<=.02 and float(np.linalg.norm(np.array(r['amrPoseWxyz'][:2])-np.array([.35,.48591366218667575])))<=.01 for r in dockRows)
 startbase=d.qpos[bqa:bqa+3].copy()
 active=True;d.qpos[cqa:cqa+7]=[.49+offset[0],offset[1],.151,1,0,0,0];d.qvel[cva:cva+6]=0;m.geom_contype[cg]=1;m.geom_conaffinity[cg]=3;m.body_contype[cb]=1;m.body_conaffinity[cb]=3
 stage='source-placement';step(True);hold(50)
 move('pickApproach');move('pick')
 stage='grip'
 for i in range(22):grip=min(.85,.04*(i+1));step()
 r=hold(100);cs=sample_contacts();pads={c['a'] if c['b']=='PROP_1' else c['b'] for c in cs if 'PROP_1' in (c['a'],c['b'])};summary['bilateralGrip']=all(n in pads for n in ['PAD_1','PAD_2'])
 summary['pickCupM']=vec(d.xpos[cb]);move('lift');summary['liftCupM']=vec(d.xpos[cb]);summary['lifted']=d.xpos[cb][2]>.25
 move('high');move('horizontalApproach');r=move('place');summary['preReleaseCupM']=vec(d.xpos[cb])
 stage='release'
 for i in range(22):grip=max(0,.85-.04*(i+1));step()
 longest=0;consecutive=0
 for i in range(150):
  r=step();cs=sample_contacts();supported=any(set((c['a'],c['b']))=={'PROP_1','M_GEOM_5'} for c in cs)
  both=all(any(set((c['a'],c['b']))=={'PROP_1',p} for c in cs) for p in ['PAD_1','PAD_2'])
  inside=abs(r['cupInTrayM'][0])<.155 and abs(r['cupInTrayM'][1])<.185
  valid=supported and not both and inside and r['relativeSpeedMps']<=.01
  consecutive=consecutive+1 if valid else 0;longest=max(longest,consecutive)
 summary['receiverWindowTicks']=longest;summary['releasedCupM']=vec(d.xpos[cb]);summary['releaseRelativeSpeedMps']=r['relativeSpeedMps']
 move('horizontalApproach');move('high');move('home');summary['withdrawnCupM']=vec(d.xpos[cb])
 stage='transport';transportStart=d.qpos[bqa:bqa+3].copy()
 for i in range(700):
  v=min(.15,(i+1)*.002);r=step()
  if np.linalg.norm(d.qpos[bqa:bqa+2]-transportStart[:2])>=1:break
 v=0;stage='stop';r=hold(100)
 summary['transportDistanceM']=float(np.linalg.norm(d.qpos[bqa:bqa+2]-transportStart[:2]));summary['finalCupInTrayM']=r['cupInTrayM'];summary['dockDriftM']=float(np.linalg.norm(transportStart[:2]-startbase[:2]))
 summary['unexpectedContactCount']=len(unexpected);summary['unexpectedContactsFirst']=unexpected[:5];summary['maxTickCupTranslationM']=maxjump;summary['logicalSteps']=tick;summary['totalSubsteps']=steps
 summary['passed']=summary['bilateralGrip'] and summary['lifted'] and longest>=25 and summary['transportDistanceM']>=1 and summary['dockWindowTicks']==10 and maxjump<=.02 and not unexpected and .04<r['cupInTrayM'][2]<.08 and abs(r['cupInTrayM'][0])<.155 and abs(r['cupInTrayM'][1])<.185
except Exception as e:summary['error']=repr(e);summary['passed']=False
finally:f.close();(DIR/(runname+'-summary.json')).write_text(json.dumps(summary,indent=2,default=lambda x:x.item()));print(json.dumps(summary,indent=2,default=lambda x:x.item()))
