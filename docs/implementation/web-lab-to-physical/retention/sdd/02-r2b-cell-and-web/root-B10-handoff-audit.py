"""Independent B10 local byte/receipt audit, not suite/native/host authentication."""
from pathlib import Path
import hashlib,json,subprocess,re,collections,os
S=Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source');L=S.parent/'lab';D=Path(__file__).parent;E=D/'evidence-B10'
HEAD='09b06bee0559c31087d478e5a4c4f28e4832a3cd';LAB='d12c04a467ef084a991cfb17ff280d55f0c49dc2'
BASE='9fdf4f382c19d6dbbc3cf64c231561ced71e786d';LABBASE='b4a9d34f0881b05a76078a5d2b3ce2c189b654a6'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def git(p,*args):return subprocess.check_output(['git','-C',str(p),*args])
def check(p,row):
 b=p.read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256'],str(p)
def meta(p):return {'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}
for repo,head in [(S,HEAD),(L,LAB)]:assert git(repo,'rev-parse','HEAD').decode().strip()==head and not git(repo,'status','--porcelain')
j=read(E/'final-byte-attribution.json');repoFiles={};patches={}
for row,repo,base,head,count in zip(j['repositories'],[S,L],[BASE,LABBASE],[HEAD,LAB],[207,8]):
 assert row['repository']==str(repo) and row['base']==base and row['head']==head
 names=git(repo,'diff','--name-only','--no-renames',base,head).decode().splitlines();assert names==[f['path'] for f in row['files']] and len(names)==count
 for f in row['files']:
  check(repo/f['path'],f);assert (repo/f['path']).read_bytes()==git(repo,'show',head+':'+f['path'])
 patch=git(repo,'diff','--no-renames','--binary',base,head,'--');assert patch==(E/row['patch']).read_bytes() and len(patch)==row['patchBytes'] and sha(patch)==row['patchSha256']
 repoFiles[str(repo)]=row['files'];patches[repo.name]={'path':str(E/row['patch']),'bytes':len(patch),'sha256':sha(patch)}
m=read(E/'export-09b06be/manifest.json');X=Path('/tmp/b10-export-09b06be');pin=read(L/'config/source-runtime.lock.json');C=L/'.runtime'/m['artifactSha256']
assert m==read(X/'manifest.json')==read(C/'manifest.json') and m['dirty'] is False and pin['dirty'] is False
assert m['sourceCommit']==pin['sourceCommit']==HEAD and pin==j['labPin']
for p in [E/'export-09b06be/runtime.mjs',X/'runtime.mjs',C/'runtime.mjs']:assert sha(p.read_bytes())==m['artifactSha256']==pin['artifactSha256']
closures={}
for name,c in [('native',m['nativeTools']),('portable',m['portableSimulationTools']['closure'])]:
 assert sha(json.dumps(c['files'],separators=(',',':'),ensure_ascii=False).encode())==c['digest']
 assert len({f['path'] for f in c['files']})==len(c['files'])
 for f in c['files']:check(S/f['path'],f)
 closures[name]={'files':len(c['files']),'bytes':sum(f['bytes'] for f in c['files']),'digest':c['digest']}
assert pin['portableToolsDigest']==closures['portable']['digest']
h=hashlib.sha256()
for name in sorted(m['schemas']):
 b=(S/'packages/contracts/schemas'/name).read_bytes();assert b==(X/'schemas'/name).read_bytes()==(C/'schemas'/name).read_bytes()==(E/'export-09b06be/schemas'/name).read_bytes();h.update((name+'\n').encode());h.update(b)
assert h.hexdigest()==m['schemaHash']==pin['schemaHash'] and len(m['schemas'])==58
pkg=read(E/'package-09b06be/r2b-campaign-package.json');assert pkg['sourceCommit']==HEAD and pkg['runtimeArtifactSha256']==m['artifactSha256'] and pkg['schemaHash']==m['schemaHash'] and pkg['portableToolsDigest']==closures['portable']['digest']
assert sha((E/'package-09b06be/r2b-campaign.mjs').read_bytes())==pkg['bundleSha256']
assert sha((E/'package-09b06be/r2b-engine-inventory.py').read_bytes())==pkg['engineObserverSha256']==sha((S/'scripts/native-sim/r2b-engine-inventory.py').read_bytes())
for f in pkg['inputs']+pkg['imageFiles']:check(S/f['path'],f)
for k,n in [('payloadRegistrySha256','payload-v1.json'),('cellRegistrySha256','mj-cell-bv01-v1.json')]:assert pkg[k]==sha((S/'robotics/simulation-mujoco/campaigns'/n).read_bytes())
ret=read(E/'retention-map.json')
for f in ret['files']:check(Path(f['original']),f);check(Path(f['destination']),f)
assert len(ret['files'])==463 and len(ret['checks'])==76
receipts={}
for row in ret['checks']:
 p=Path(row['receipt']);r=read(p);b=p.with_name(row['id']+'.log').read_bytes()
 assert sha(p.read_bytes())==row['receiptSha256'] and sha(b)==r['outputSha256']==row['outputSha256']
 assert r['exitCode']==row['exitCode'] and isinstance(r['exitCode'],int) and r['command']==row['command'] and r['args']==row['args']
 assert r['before']['head']==row['beforeHead'] and r['after']['head']==row['afterHead']
 receipts[row['id']]={'exitCode':r['exitCode'],'command':r['command'],'args':r['args'],'cwd':r['cwd'],'beforeHead':r['before']['head'],'afterHead':r['after']['head'],'receiptSha256':sha(p.read_bytes()),'outputSha256':sha(b)}
assert set(receipts)=={p.name.removesuffix('.receipt.json') for p in (E/'checks').glob('*.receipt.json')}
assert read(E/'checks/checker-handoff.log')==j['checker'] and j['checker']['sourceCommit']==HEAD
doc=read(S/'docs/implementation/web-lab-to-physical/retention/preparation-copy-map.json');copyRows=[]
for row in doc['files']:
 original=Path(row['original']);dest=S/row['destination'];check(dest,{'bytes':row['destinationBytes'],'sha256':row['destinationSha256']})
 b=original.read_bytes();direct=len(b)==row['originalBytes'] and sha(b)==row['originalSha256']
 prefix=len(b)>=row['originalBytes'] and sha(b[:row['originalBytes']])==row['originalSha256']
 assert direct or prefix,('origin changed beyond append',str(original))
 if row['role'].startswith('exact_'):assert row['originalSha256']==row['destinationSha256'] and row['originalBytes']==row['destinationBytes']
 copyRows.append({'destination':row['destination'],'original':str(original),'role':row['role'],'originCurrentEqual':direct,'originPrefixPreserved':prefix,'bytes':row['destinationBytes'],'sha256':row['destinationSha256']})
assert len(copyRows)==149
links=read(S/'docs/implementation/web-lab-to-physical/retention/preparation-link-audit.json')['links']
for row in links:
 file=S/row['file'];href=row['href'];parts=href.split('#',1);target=(file.parent/parts[0]).resolve() if parts[0] else file
 assert target.exists(),(str(file),href)
 if 'fragmentResolved' in row:
  txt=target.read_text();ids=set(re.findall(r'(?:id|name)=[\"\']([^\"\']+)',txt));seen={}
  for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',txt,re.M):
   slug=re.sub(r'[^\w\-\s]','',heading.lower()).replace(' ','-');n=seen.get(slug,0);seen[slug]=n+1;ids.add(slug+('-'+str(n) if n else ''))
  assert parts[1] in ids,(str(file),href)
assert len(links)==153
preserved=[]
for idxpath in [D/'root-B10-smoke-27d6be9-file-index.json',D.parent/'03-r3-linux-readiness/root-L05-evidence-file-index.json']:
 idx=read(idxpath)
 for f in idx['files']:check(Path(idx['root'])/f['path'],f)
 preserved.append({'index':str(idxpath),'files':len(idx['files'])})
old=read(D.parent/'03-r3-linux-readiness/root-L05-handoff.json');check(D.parent/'03-r3-linux-readiness/task-L05-report.md',old['report'])
oldX=Path(old['export']);oldM=read(oldX/'manifest.json');oldC=L/'.runtime'/oldM['artifactSha256'];assert oldM==read(oldC/'manifest.json') and sha((oldX/'runtime.mjs').read_bytes())==sha((oldC/'runtime.mjs').read_bytes())==old['runtimeArtifactSha256']
attribution={}
for repo,files in repoFiles.items():
 for f in files:
  if f['path'].startswith('docs/'):continue
  found=[]
  for row in ret['checks']:
   if row['exitCode']!=0:continue
   r=read(Path(row['receipt']))
   if Path(r['cwd']).resolve()!=Path(repo):continue
   for when in ['before','after']:
    snap=r[when];changes={v['path']:v['sha256'] for v in snap['changedFiles']}
    same=changes.get(f['path'])==f['sha256']
    if f['path'] not in changes:
     try:same=sha(git(Path(repo),'show',snap['head']+':'+f['path']))==f['sha256']
     except subprocess.CalledProcessError:same=False
    if same:found.append(row['id']);break
  attribution[Path(repo).name+'/'+f['path']]={'sha256':f['sha256'],'sameBytesAtChecks':found,'limit':'Recorded tree-byte attribution only; each command retains its own semantic coverage.'}
report=meta(D/'task-B10-report.md');assert report=={'bytes':21373,'sha256':'b35bd23adb15ade9869c568108eae1585b4e5ac8c286acc58a0e6a55f8843e78'}
evidenceFiles=[{'path':p.relative_to(E).as_posix(),**meta(p)} for p in sorted(E.rglob('*')) if p.is_file()]
(D/'root-B10-evidence-file-index.json').write_text(json.dumps({'root':str(E),'files':evidenceFiles,'limit':'Byte preservation only.'},indent=2)+'\n')
result={'source':HEAD,'lab':LAB,'clean':True,'originalBase':{'source':BASE,'lab':LABBASE},'runtimeArtifactSha256':m['artifactSha256'],'schemaHash':m['schemaHash'],'schemas':len(m['schemas']),'closures':closures,'export':str(X),'package':{'manifest':meta(E/'package-09b06be/r2b-campaign-package.json'),'bundle':meta(E/'package-09b06be/r2b-campaign.mjs'),'inputs':len(pkg['inputs']),'imageFiles':len(pkg['imageFiles'])},'checker':j['checker'],'report':report,'patches':patches,'checks':receipts,'finalByteAttribution':attribution,'documentationCopies':copyRows,'verifiedLocalLinks':len(links),'exactEvidenceCopies':len(ret['files']),'newEvidenceFiles':len(evidenceFiles),'preserved':preserved,'limits':['Local read-only byte/receipt audit; no suites, database engine, native/container execution or host/effective-Git-graph authentication.','First7 checks are log-only, no invented own receipts.173tests precede later fixes; actual27d6 smoke is local Source-only1/8.','FinalCI/browser/WEB05/native/finalrecording/L06 and independent B10 review remain pending.']}
(D/'root-B10-handoff.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'sourceFiles':len(repoFiles[str(S)]),'labFiles':len(repoFiles[str(L)]),'receipts':len(receipts),'exactEvidenceCopies':len(ret['files']),'documentationCopies':len(copyRows),'links':len(links),'closures':closures,'packageInputs':len(pkg['inputs']),'report':report,'newEvidenceFiles':len(evidenceFiles),'unattributedNonDocFiles':[p for p,r in attribution.items() if not r['sameBytesAtChecks']]}))
