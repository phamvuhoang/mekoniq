"""Read-only byte/receipt audit, no suite or database engine opens. Run after final handoff."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess
D=Path(__file__).resolve().parent;S=D.parents[2];L=S.parent/'lab';E=D/'evidence-final-recording/fix2'
HEAD='2bd66e679aba431a84736eb10e04717dc4d32ce7';LAB='111ed9a763a5fea24ab3180834c83c1db97417dd'
BASE='bab05a5311a9db3be447519b3b9ac48eb0e4a90d';LBASE='1f9b48d6d2767bdcd623f08cfa45ba0f9af33d1d'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def meta(p):
 h=hashlib.sha256();n=0
 with p.open('rb') as f:
  for b in iter(lambda:f.read(2**20),b''):h.update(b);n+=len(b)
 return {'bytes':n,'sha256':h.hexdigest()}
def check(p,row):assert meta(p)=={'bytes':row['bytes'],'sha256':row['sha256']},str(p)
def git(repo,*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL)
ap=argparse.ArgumentParser();ap.add_argument('--report-bytes',type=int,required=True);ap.add_argument('--report-sha256',required=True);a=ap.parse_args()
j=read(E/'final-byte-attribution.json');assert [x['head'] for x in j['trees']]==[HEAD,LAB] and [x['base'] for x in j['trees']]==[BASE,LBASE]
patches={}
for row,repo in zip(j['trees'],[S,L]):
 assert git(repo,'rev-parse','HEAD').decode().strip()==row['head'] and git(repo,'rev-parse','HEAD^{tree}').decode().strip()==row['tree']
 assert not git(repo,'status','--porcelain','--untracked-files=all') and git(repo,'branch','--show-current').decode().strip()=='codex/web-lab-to-physical'
 flags=['--no-ext-diff','--no-textconv','--no-color','--no-renames']
 names=git(repo,'diff',*flags,'--name-only',row['base'],row['head']).decode().splitlines();assert names==[f['path'] for f in row['files']]
 for f in row['files']:
  check(repo/f['path'],f);assert (repo/f['path']).read_bytes()==git(repo,'show',row['head']+':'+f['path'])
 raw=git(repo,'diff',*flags,'--binary',row['base'],row['head']);assert raw==(E/(repo.name+'-fix-base.patch')).read_bytes() and sha(raw)==row['patchSha256'] and len(raw)==row['patchBytes']
 target=D/('review-final-prerequisites-2-'+repo.name+'.diff')
 if target.exists():assert target.read_bytes()==raw
 else:target.write_bytes(raw)
 patches[repo.name]={'path':str(target),**meta(target),'files':len(names)}
X=E/'export-final';m=read(X/'manifest.json');pin=read(L/'config/source-runtime.lock.json');C=L/'.runtime'/m['artifactSha256'];external=Path(read(E/'paths.json')['root'])
assert m==read(C/'manifest.json') and m['dirty'] is False and pin['dirty'] is False and pin==j['pin']
assert m['sourceCommit']==pin['sourceCommit']==HEAD and sha((X/'manifest.json').read_bytes())==j['rawManifestSha256']
assert sha((X/'runtime.mjs').read_bytes())==sha((C/'runtime.mjs').read_bytes())==pin['artifactSha256']==j['runtimeArtifactSha256']
xf={str(p.relative_to(X)):meta(p) for p in X.rglob('*') if p.is_file()};ef={str(p.relative_to(external/'export')):meta(p) for p in (external/'export').rglob('*') if p.is_file()};assert xf==ef
old=read(D/'evidence-final-recording/fix1/export-final/manifest.json');closures={}
for name,c,previous in [('native',m['nativeTools'],old['nativeTools']),('portable',m['portableSimulationTools']['closure'],old['portableSimulationTools']['closure'])]:
 assert len(c['files'])==len({f['path'] for f in c['files']}) and sha(json.dumps(c['files'],separators=(',',':'),ensure_ascii=False).encode())==c['digest']
 assert [r['path'] for r in c['files']]==[r['path'] for r in previous['files']]
 changed=[r['path'] for r,p in zip(c['files'],previous['files']) if r!=p];assert changed==['packages/contracts/schemas/native-handoff-v1.schema.json']
 for f in c['files']:check(S/f['path'],f)
 closures[name]={'files':len(c['files']),'bytes':sum(f['bytes'] for f in c['files']),'digest':c['digest'],'changedEntries':changed}
h=hashlib.sha256()
for name in sorted(m['schemas']):
 b=(S/'packages/contracts/schemas'/name).read_bytes();assert b==(X/'schemas'/name).read_bytes()==(C/'schemas'/name).read_bytes();h.update((name+'\n').encode());h.update(b)
assert h.hexdigest()==pin['schemaHash']==j['schemaHash']==m['schemaHash'] and len(m['schemas'])==j['schemaCount']==58
receipts={}
for p in sorted((E/'checks').glob('*.receipt.json')):
 name=p.name.removesuffix('.receipt.json');r=read(p);b=p.with_name(name+'.log').read_bytes();assert isinstance(r['exitCode'],int) and sha(b)==r['logSha256'];receipts[name]={**r,'receiptSha256':sha(p.read_bytes()),'logBytes':len(b)}
assert set(receipts)=={p.stem for p in (E/'checks').glob('*.log')};index=read(E/'check-index.json');assert len(index)==j['checkCountBeforeAuditReceipt']==27 and len(receipts)==28
for row in index:
 name=row['name'].removesuffix('.receipt');assert name in receipts
 for key,value in row.items():
  if key!='name':assert receipts[name][key]==value,(name,key)
assert set(receipts)-{r['name'].removesuffix('.receipt') for r in index}=={'final-audit'}
complete=read(E/'check-index-complete.json');assert len(complete)==28 and {r['name'] for r in complete}==set(receipts)
for row in complete:
 for key,value in row.items():
  if key!='name':assert receipts[row['name']][key]==value,(row['name'],key)
assert read(E/'checks/checker-identity.log')==j['checker']
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
for ref in [*j['preserved'],{'index':str(D/'evidence-final-recording/fix1/external-original-tuple-index.json')}]:
 p=Path(ref['index']);v=read(p)
 for f in v['files']:check(Path(v['root'])/f['path'],f)
 for link in v.get('symlinks',[]):assert os.readlink(Path(v['root'])/link['path'])==link['target']
 preserved.append({'index':str(p),'files':len(v['files'])})
for oldX in [D.parent/'02-r2b-cell-and-web/evidence-B10/fix1/export-final2',D.parent/'03-r3-linux-readiness/evidence-L06/export-final',D.parent/'03-r3-linux-readiness/evidence-L06/fix1/export-final',D/'evidence-final-recording/fix1/export-final']:
 om=read(oldX/'manifest.json');oc=L/'.runtime'/om['artifactSha256'];assert om==read(oc/'manifest.json') and sha((oc/'runtime.mjs').read_bytes())==om['artifactSha256']
 reportSchemas={str(p.relative_to(oldX/'schemas')):meta(p) for p in (oldX/'schemas').rglob('*') if p.is_file()};assert all(meta(oc/'schemas'/n)==v for n,v in reportSchemas.items())
ii=read(external/'puma-input/manifest.json');ex=read(external/'puma-export/manifest.json');assert ii==ex
refs=[{'role':role,**ref} for role,rs in ex['refs'].items() for ref in rs];assert len(refs)==j['pumaRefs']==386 and read(E/'puma-export-ref-index.json')['refs']==refs
for f in refs:
 check(external/'puma-input'/f['path'],f);check(external/'puma-export'/f['path'],f)
for label,c in [('native',m['nativeTools']),('portable',m['portableSimulationTools']['closure'])]:
 for f in c['files']:assert any(('packages/contracts/schemas/'+r['sourcePath'] if r['role']=='schema' else r['sourcePath'])==f['path'] and r['sha256']==f['sha256'] and r['bytes']==f['bytes'] for r in refs),f['path']
assert ex['subject']['sourceCommit']==HEAD and ex['subject']['labCommit']==LAB and ex['subject']['nativeClosureHash']==closures['native']['digest']
q=read(external/'r3-puma-prepared/qualification.json');assert sha((external/'r3-puma-prepared/qualification.json').read_bytes())==j['pumaQualificationSha256'];assert q['accepted'] is False and q['levels']=={'R3.0':'tested','R3.1':'not_run','R3.2':'not_run'}
assert all(v['status']=='not_run' for k,v in q['cases'].items() if k!='DEP-PREP-01')
for name in ['puma-verify-input','puma-export','puma-verify-export']:
 v=read(E/('checks/'+name+'.log'));assert v['prepared'] is True and v['nativeReady'] is False and receipts[name]['exitCode']==0
for name in ['puma-record-r3','puma-readback-r3','puma-acceptance-r3']:assert receipts[name]['exitCode']==0
report=meta(D/'task-final-recording-report.md');assert report=={'bytes':a.report_bytes,'sha256':a.report_sha256}
rb=(D/'task-final-recording-report.md').read_bytes();assert rb.startswith((E/'report-prefix.txt').read_bytes()) and sha(rb[:17250])=='a88ec210dae676cebc0e03d44638827f146602f4c0ea6874068e27c2d277efe8'
retained=[]
for name,count in [('retention-index.json',131),('external-retention-index.json',1222)]:
 v=read(E/name);assert len(v['files'])==count
 for f in v['files']:check(Path(v['root'])/f['path'],f)
 retained.append({'index':name,'files':count,'bytes':sum(f['bytes'] for f in v['files']),**meta(E/name)})
result={'source':HEAD,'lab':LAB,'clean':True,'trees':j['trees'],'patches':patches,'report':report,'export':str(X),'externalExport':str(external/'export'),'exportFiles':len(xf),'runtimeArtifactSha256':m['artifactSha256'],'schemaHash':m['schemaHash'],'schemas':len(m['schemas']),'closures':closures,'checker':j['checker'],'checks':receipts,'finalByteAttribution':attribution,'preserved':preserved,'retained':retained,'puma':{'root':str(external),'refs':len(refs),'qualificationSha256':j['pumaQualificationSha256'],'levels':q['levels']},'limits':['Byte consistency and own-exit receipt attribution, not semantic coverage of every byte by every check or host authenticity.','Public PUMA preparation only; no native motion, physical, full CI or current production performance qualification.','No suites, Docker/services or original SQLite engine opens in this root audit.']}
(D/'root-final-prerequisites-2-handoff.json').write_text(json.dumps(result,indent=2)+'\n')
files=[{'path':str(p.relative_to(E)),**meta(p)} for p in sorted(E.rglob('*')) if p.is_file() and not p.is_symlink()];links=[{'path':str(p.relative_to(E)),'target':os.readlink(p)} for p in sorted(E.rglob('*')) if p.is_symlink()]
(D/'root-final-prerequisites-2-evidence-file-index.json').write_text(json.dumps({'root':str(E),'files':files,'symlinks':links},indent=2)+'\n')
print(json.dumps({'patches':patches,'report':report,'receipts':len(receipts),'closures':closures,'exportFiles':len(xf),'newEvidenceFiles':len(files),'symlinks':links,'preservedEntries':sum(x['files'] for x in preserved),'attributedFiles':len(attribution),'pumaRefs':len(refs)}))
