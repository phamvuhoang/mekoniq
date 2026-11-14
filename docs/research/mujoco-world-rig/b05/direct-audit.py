import json,gzip,math,hashlib
from pathlib import Path
root=Path('/tmp/mekoniq-b05-probe');policy=json.loads((root/'candidate-01-policy.json').read_text());out=[]
for i in range(1,11):
 rows=[json.loads(x) for x in gzip.open(root/f'trial-{i}.ndjson.gz','rt')];s=json.loads((root/f'trial-{i}-summary.json').read_text())
 assert [r['tick'] for r in rows]==list(range(2503))
 assert all(r['physicsSubsteps']==10*(r['tick']+1) and abs(r['engineTimeS']-.02*(r['tick']+1))<1e-9 and len(r['substepContacts'])==10 for r in rows)
 assert sum(r['placement'] for r in rows)==1 and not rows[0]['activePropIds']
 assert all(r['activePropIds']==['cup-1'] for r in rows if r['tick']>=101)
 dock=[r for r in rows if r['stage']=='dock'][-10:]
 yaw=[]
 for r in dock:
  w,x,y,z=r['amrPoseWxyz'][3:];a=math.atan2(2*(w*z+x*y),1-2*(y*y+z*z));yaw.append(abs(math.atan2(math.sin(a-math.pi/2),math.cos(a-math.pi/2))))
 assert max(yaw)<=.02
 def finite(v):return math.isfinite(v) if isinstance(v,(float,int)) else all(finite(x) for x in v) if isinstance(v,list) else all(finite(x) for x in v.values()) if isinstance(v,dict) else True
 assert all(finite(r) for r in rows)
 out.append({'trial':i,'rows':len(rows),'yawMaxErrorRad':max(yaw),'finite':True,'clock':True,'offsetM':s['offsetM'],'files':{n:{'sha256':hashlib.sha256((root/n).read_bytes()).hexdigest(),'bytes':(root/n).stat().st_size} for n in [f'trial-{i}.ndjson.gz',f'trial-{i}-summary.json']}})
audit={'accepted':False,'scope':'direct native physical rig; no worker ACK or Source custody claim','policySha256':hashlib.sha256((root/'candidate-01-policy.json').read_bytes()).hexdigest(),'passedCount':10,'trials':out}
(root/'campaign-integrity.json').write_text(json.dumps(audit,indent=2));print(json.dumps({'policySha256':audit['policySha256'],'inventorySha256':hashlib.sha256((root/'campaign-integrity.json').read_bytes()).hexdigest(),'trials':10,'totalRows':sum(r['rows'] for r in out)},indent=2))
