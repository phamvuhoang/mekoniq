import json,pathlib,hashlib,subprocess,datetime
s=pathlib.Path.cwd(); d=s/'.superpowers/sdd/README'; r=pathlib.Path((d/'final-n1-correction/output-root.txt').read_text().strip()); sha=lambda b:hashlib.sha256(b).hexdigest()
def item(p):
 b=p.read_bytes();return {'path':str(p),'bytes':len(b),'sha256':sha(b)}
receipts=[]
for p in sorted(r.glob('n1-*.json')):
 x=json.loads(p.read_text());log=pathlib.Path(x['log']); v=item(log);assert v['bytes']==x['bytes'] and v['sha256']==x['sha256'];assert x['exit']==(1 if p.stem=='n1-red' else 0);receipts.append({'receipt':item(p),'log':v,'exit':x['exit'],'argv':x['argv']})
green=json.loads((r/'n1-green.json').read_text())
for p,v in green['afterFileHashes'].items():
 b=(s/p).read_bytes();assert len(b)==v['bytes'] and sha(b)==v['sha256'];assert subprocess.check_output(['git','show','HEAD:'+p],cwd=s)==b
old=[(d/'task-final-correction-report.md',57452,'d39e858f16b5b67f5fe2d11ebdc2cbaf3ba61b522633042f9bf467aac6788da3'),(pathlib.Path('/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/r2b-final-correction-u3e2_ph3/artifact-index.json'),726024,'fcde7b16de072f66ec6214664fa213940ecedba4800a2a519051780895eca12a'),(d/'task-final-scoped-review.md',22575,'098a5e95587f55995143cb5e722f44092c3b33d76c232fe40e7fc9d3d65d23f3')]
for p,n,h in old: b=p.read_bytes();assert len(b)==n and sha(b)==h
identity=json.loads((r/'subject-identity.json').read_text());statuses={}
for name,cwd in [('source',s),('lab',s.parent/'lab')]:
 statuses[name]=subprocess.check_output(['git','status','--porcelain'],cwd=cwd,text=True);assert not statuses[name]
ps=subprocess.check_output(['ps','-axo','pid,ppid,stat,command'],text=True);(r/'settlement-processes.txt').write_text(ps)
ports=subprocess.run(['lsof','-nP','-iTCP:4175','-iTCP:4176','-sTCP:LISTEN'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
(r/'settlement-ports.txt').write_text(ports.stdout)
result={'timeUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'receipts':receipts,'committedGreenBytesVerified':green['afterFileHashes'],'priorFrozenFiles':[item(p) for p,n,h in old],'statuses':statuses,'identity':item(r/'subject-identity.json'),'processSnapshot':item(r/'settlement-processes.txt'),'ports':{'exit':ports.returncode,**item(r/'settlement-ports.txt')},'scope':'No production capture/browser/payload/full-chain launched. No new owned long-lived services. Exit receipts settled; snapshot retained for owned-process attribution, not blanket machine quiet claim.'}
(r/'settlement.json').write_text(json.dumps(result,indent=2)+'\n')
files=[item(p) for p in sorted(r.rglob('*')) if p.is_file() and p.name!='artifact-index.json'];(r/'artifact-index.json').write_text(json.dumps({'root':str(r),'files':files,'totalFiles':len(files),'totalBytes':sum(v['bytes'] for v in files)},indent=2)+'\n')
print(json.dumps({'settlement':item(r/'settlement.json'),'inventory':item(r/'artifact-index.json'),'files':len(files),'totalBytes':sum(v['bytes'] for v in files),'ports':ports.stdout,'receiptCount':len(receipts)}))
