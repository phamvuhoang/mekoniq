"""Root byte/receipt audit. No suites, Docker, services or original database engine opens."""
from pathlib import Path
import hashlib,json,subprocess,os
D=Path(__file__).resolve().parent;S=D.parents[2];L=S.parent/'lab';E=D/'evidence-final-recording/fix1';B=D.parent/'02-r2b-cell-and-web';P=D.parent/'03-r3-linux-readiness'
HEAD='bab05a5311a9db3be447519b3b9ac48eb0e4a90d';LAB='1f9b48d6d2767bdcd623f08cfa45ba0f9af33d1d'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def meta(p):
 b=p.read_bytes();return {'bytes':len(b),'sha256':sha(b)}
def check(p,row):assert meta(p)=={'bytes':row['bytes'],'sha256':row['sha256']},str(p)
def git(repo,*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL)
j=read(E/'final-byte-attribution.json');assert [x['head'] for x in j['trees']]==[HEAD,LAB]
assert [x['base'] for x in j['trees']]==['6e5eee9d7d504b0365422eb0ef7096e74e72e210','283696be56bdaea1d310a1e56182f49792cf3b2c']
patches={}
for row,repo in zip(j['trees'],[S,L]):
 assert git(repo,'rev-parse','HEAD').decode().strip()==row['head']
 assert git(repo,'rev-parse','HEAD^{tree}').decode().strip()==row['tree']
 assert not git(repo,'status','--porcelain','--untracked-files=all')
 assert git(repo,'branch','--show-current').decode().strip()=='codex/web-lab-to-physical'
 names=git(repo,'diff','--name-only','--no-renames',row['base'],row['head']).decode().splitlines();assert names==[f['path'] for f in row['files']]
 for f in row['files']:
  check(repo/f['path'],f);assert (repo/f['path']).read_bytes()==git(repo,'show',row['head']+':'+f['path'])
 raw=git(repo,'diff','--binary','--no-renames',row['base'],row['head']);assert raw==(E/(repo.name+'-fix-base.patch')).read_bytes() and sha(raw)==row['patchSha256'] and len(raw)==row['patchBytes']
 target=D/('review-final-prerequisites-1-'+repo.name+'.diff')
 if target.exists():assert target.read_bytes()==raw
 else:target.write_bytes(raw)
 patches[repo.name]={'path':str(target),**meta(target),'files':len(names)}
X=E/'export-final';m=read(X/'manifest.json');pin=read(L/'config/source-runtime.lock.json');C=L/'.runtime'/m['artifactSha256']
assert m==read(C/'manifest.json') and m['dirty'] is False and pin['dirty'] is False
assert pin==j['pin'] and m['sourceCommit']==pin['sourceCommit']==HEAD
assert sha((X/'manifest.json').read_bytes())==j['exportManifestSha256']
assert sha((X/'runtime.mjs').read_bytes())==sha((C/'runtime.mjs').read_bytes())==pin['artifactSha256']==j['runtimeSha256']
external=Path('/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mekoniq-final-fix1-bab05a5-export')
xf={str(p.relative_to(X)):meta(p) for p in X.rglob('*') if p.is_file()};ef={str(p.relative_to(external)):meta(p) for p in external.rglob('*') if p.is_file()};assert xf==ef
for oldX in [B/'evidence-B10/fix1/export-final2',P/'evidence-L06/export-final',P/'evidence-L06/fix1/export-final']:
 old=read(oldX/'manifest.json');oldC=L/'.runtime'/old['artifactSha256'];assert old==read(oldC/'manifest.json') and sha((oldC/'runtime.mjs').read_bytes())==old['artifactSha256'];assert old['nativeTools']==m['nativeTools'] and old['portableSimulationTools']==m['portableSimulationTools']
closures={}
for name,c in [('native',m['nativeTools']),('portable',m['portableSimulationTools']['closure'])]:
 assert len(c['files'])==len({f['path'] for f in c['files']});assert sha(json.dumps(c['files'],separators=(',',':'),ensure_ascii=False).encode())==c['digest']
 for f in c['files']:check(S/f['path'],f)
 closures[name]={'files':len(c['files']),'bytes':sum(f['bytes'] for f in c['files']),'digest':c['digest']}
h=hashlib.sha256()
for name in sorted(m['schemas']):
 b=(S/'packages/contracts/schemas'/name).read_bytes();assert b==(X/'schemas'/name).read_bytes()==(C/'schemas'/name).read_bytes();h.update((name+'\n').encode());h.update(b)
assert h.hexdigest()==pin['schemaHash']==j['schemaHash']==m['schemaHash']
receipts={}
for p in sorted((E/'checks').glob('*.receipt.json')):
 name=p.name.removesuffix('.receipt.json');r=read(p);b=p.with_name(name+'.log').read_bytes();assert isinstance(r['exitCode'],int) and sha(b)==r['logSha256'];receipts[name]={**r,'receiptSha256':sha(p.read_bytes()),'logBytes':len(b)}
assert set(receipts)=={p.stem for p in (E/'checks').glob('*.log')};index=read(E/'check-index.json');assert len(index)==j['checks']==22 and len(receipts)==23
for row in index:
 name=Path(row['receipt']).name.removesuffix('.receipt.json');r=receipts[name]
 for key in ['receiptSha256','exitCode','argv','cwd','logSha256']:assert row[key]==r[key]
 assert row['source']==r['before']['commit'] and row['stableCommit']==(r['before']['commit']==r['after']['commit'])
assert set(receipts)-{Path(r['receipt']).name.removesuffix('.receipt.json') for r in index}=={'final-audit'}
complete=read(E/'check-index-complete.json');assert len(complete)==23 and {r['name'] for r in complete}==set(receipts)
for row in complete:
 for key,value in row.items():
  if key!='name':assert receipts[row['name']][key]==value,(row['name'],key)
assert read(E/'checks/final-audit.log')['checker']==j['checker']
cache={}
def blob(repo,head,path):
 key=(str(repo),head,path)
 if key not in cache:
  try:cache[key]=sha(git(repo,'show',head+':'+path))
  except subprocess.CalledProcessError:cache[key]=None
 return cache[key]
attribution={}
for row,repo in zip(j['trees'],[S,L]):
 for f in row['files']:
  matches=[]
  for name,r in receipts.items():
   if r['exitCode']!=0 or Path(r['cwd']).resolve()!=repo.resolve():continue
   for when in ['before','after']:
    snap=r[when];changed={v['path']:v['sha256'] for v in snap['changed']};actual=changed[f['path']] if f['path'] in changed else blob(repo,snap['commit'],f['path'])
    if actual==f['sha256']:matches.append(name);break
  assert matches,f['path'];attribution[repo.name+'/'+f['path']]={'sha256':f['sha256'],'sameBytesAtChecks':matches}
preserved=[]
for parent,name in [(B,'root-B10-evidence-file-index.json'),(B,'root-B10-r1-evidence-file-index.json'),(B,'root-B10-smoke-27d6be9-file-index.json'),(P,'root-L06-evidence-file-index.json'),(P,'root-L06-r1-evidence-file-index.json'),(E,'initial-evidence-index.json'),(E,'external-original-tuple-index.json')]:
 v=read(parent/name)
 for f in v['files']:check(Path(v['root'])/f['path'],f)
 preserved.append({'index':str(parent/name),'files':len(v['files'])})
check(B/'task-B10-report.md',read(B/'root-B10-r1-handoff.json')['report'])
assert meta(P/'task-L06-report.md')=={'bytes':31598,'sha256':'f0236adbd71ffe0119f02d4f87d1321d9dd5133ee512e0f1dfe47c022ad36325'}
assert meta(P/'task-L06-review-2.md')=={'bytes':17684,'sha256':'40fcd0970d258904247756f0ba9141f0ab9a83b91b0b7f9f9ebb098cea58d7d8'}
report=meta(D/'task-final-recording-report.md');assert report=={'bytes':17250,'sha256':'a88ec210dae676cebc0e03d44638827f146602f4c0ea6874068e27c2d277efe8'}
assert sha((D/'task-final-recording-report.md').read_bytes()[:3778])=='808ad562c50e65353737c5ee71d299f08b281be0a2606fa062c250f5c76782ef'
result={'source':HEAD,'lab':LAB,'clean':True,'trees':j['trees'],'patches':patches,'report':report,'export':str(X),'externalExport':str(external),'exportFiles':len(xf),'runtimeArtifactSha256':m['artifactSha256'],'schemaHash':m['schemaHash'],'schemas':len(m['schemas']),'closures':closures,'checker':j['checker'],'checks':receipts,'finalByteAttribution':attribution,'preserved':preserved,'limits':['Byte/receipt attribution is not semantic coverage, host authentication or proof that each command covered every behavior.','23 actual fix receipts; original 30-second CI timeout is not a proved finally hang.','No suites, Docker, services, native/browser execution or original SQLite engine opens in this root audit.']}
(D/'root-final-prerequisites-1-handoff.json').write_text(json.dumps(result,indent=2)+'\n')
files=[{'path':str(p.relative_to(E)),**meta(p)} for p in sorted(E.rglob('*')) if p.is_file() and not p.is_symlink()];links=[{'path':str(p.relative_to(E)),'target':os.readlink(p)} for p in sorted(E.rglob('*')) if p.is_symlink()]
(D/'root-final-prerequisites-1-evidence-file-index.json').write_text(json.dumps({'root':str(E),'files':files,'symlinks':links},indent=2)+'\n')
print(json.dumps({'patches':patches,'report':report,'receipts':len(receipts),'closures':closures,'exportFiles':len(xf),'newEvidenceFiles':len(files),'symlinks':links,'preservedEntries':sum(x['files'] for x in preserved),'attributedFiles':len(attribution)}))
