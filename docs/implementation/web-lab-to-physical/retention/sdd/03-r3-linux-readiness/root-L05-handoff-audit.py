"""L05 local byte/receipt audit; no suite, service, native or database execution."""
from pathlib import Path
import hashlib, json, subprocess
S=Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source'); L=S.parent/'lab'
D=Path(__file__).parent; E=D/'evidence-L05'
HEAD='9fdf4f382c19d6dbbc3cf64c231561ced71e786d'; LAB='b4a9d34f0881b05a76078a5d2b3ce2c189b654a6'
BASE='7d8bededd7b0ca57984d6f0d000eaa74ddea839d'; LABBASE='2ccfbddb86282a9547368302f6121c7ee09acb71'
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
def git(p,*args): return subprocess.check_output(['git','-C',str(p),*args],text=True).strip()
def check(p,row):
 b=p.read_bytes(); assert len(b)==row['bytes'] and sha(b)==row['sha256'],str(p)
def metadata(p): return {'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}
for repo,head in [(S,HEAD),(L,LAB)]: assert git(repo,'rev-parse','HEAD')==head and not git(repo,'status','--porcelain')
j=read(E/'final-identities.json'); assert j['sourceCommit']==HEAD and j['labCommit']==LAB
X=Path(j['exportDir']); m=read(X/'manifest.json'); pin=read(L/'config/source-runtime.lock.json'); C=L/'.runtime'/m['artifactSha256']
assert m==read(C/'manifest.json') and m['dirty'] is False and pin['dirty'] is False and pin==j['pin']
assert m['sourceCommit']==pin['sourceCommit']==HEAD
assert sha((X/'runtime.mjs').read_bytes())==sha((C/'runtime.mjs').read_bytes())==m['artifactSha256']==pin['artifactSha256']
check(X/'manifest.json',j['exportManifest']); check(C/'manifest.json',j['installedManifest'])
old=read(D/'root-L04-r1-handoff.json'); O=Path(old['export']); om=read(O/'manifest.json'); OC=L/'.runtime'/om['artifactSha256']
assert om==read(OC/'manifest.json') and sha((O/'runtime.mjs').read_bytes())==sha((OC/'runtime.mjs').read_bytes())==old['runtimeArtifactSha256']
oi=read(D/'evidence-L04/fix1/identities.json')
assert sha((O/'manifest.json').read_bytes())==oi['manifestSha256'] and sha((OC/'manifest.json').read_bytes())==oi['cacheManifestSha256']
closures={}
for name,c,oc in [('native',m['nativeTools'],om['nativeTools']),('portable',m['portableSimulationTools']['closure'],om['portableSimulationTools']['closure'])]:
 assert sha(json.dumps(c['files'],separators=(',',':'),ensure_ascii=False).encode())==c['digest']
 files={f['path']:f for f in c['files']}; olds={f['path']:f for f in oc['files']}; assert len(files)==len(c['files'])
 assert set(files)-set(olds)=={'packages/contracts/schemas/physical-target-dossier-v1.schema.json'}
 assert set(olds)<=set(files) and all(files[p]==v for p,v in olds.items())
 for f in c['files']: check(S/f['path'],f)
 closures[name]={'files':len(files),'bytes':sum(f['bytes'] for f in c['files']),'digest':c['digest']}
 assert c['digest']==j['closures'][name]['digest']
assert closures['native']['files']==226 and closures['portable']['files']==238
assert pin['portableToolsDigest']==closures['portable']['digest']
for manifest,a,b,current in [(m,X,C,True),(om,O,OC,False)]:
 h=hashlib.sha256()
 for name in sorted(manifest['schemas']):
  raw=(a/'schemas'/name).read_bytes(); assert raw==(b/'schemas'/name).read_bytes()
  if current: assert raw==(S/'packages/contracts/schemas'/name).read_bytes()
  h.update((name+'\n').encode()); h.update(raw)
 assert h.hexdigest()==manifest['schemaHash']
assert m['schemaHash']==pin['schemaHash'] and len(m['schemas'])==58
receipts={}; failures={'red-dossier','red-identity-boundary','red-identity-boundary-02','red-identity-boundary-03','prepare-six'}
for p in sorted(E.glob('*.receipt.json')):
 r=read(p); name=p.name.removesuffix('.receipt.json'); b=p.with_name(name+'.log').read_bytes()
 assert len(b)==r['outputBytes'] and sha(b)==r['outputSha256'] and r['argv']
 assert r['exit']==(1 if name in failures else 0),(name,r['exit'])
 receipts[name]={'exit':r['exit'],'argv':r['argv'],'sourceCommit':r['sourceCommit'],'receiptSha256':sha(p.read_bytes()),'logSha256':sha(b)}
assert len(receipts)==25
attribution={}
for key,repo,base,head in [('source',S,BASE,HEAD),('lab',L,LABBASE,LAB)]:
 paths=git(repo,'diff','--name-only',base,head).splitlines(); assert set(paths)==set(j['files'][key])
 for path in paths:
  check(repo/path,j['files'][key][path]); assert (repo/path).read_bytes()==subprocess.check_output(['git','-C',str(repo),'show',head+':'+path])
  if key=='source':
   candidates=[n for n in ['combined-vitest-02','source-typecheck-01','contracts-check','changed-file-lint','template-review'] if read(E/(n+'.receipt.json'))['changedBytes'].get(path)==sha((repo/path).read_bytes())]
   assert candidates,path; attribution[path]={'sha256':sha((repo/path).read_bytes()),'sameBytesAtChecks':candidates,'limit':'Byte attribution only; each command retains its stated semantic scope.'}
prior=read(E/'prior-evidence-index.json')
for path,row in prior.items(): check(S/path,row)
assert len(prior)==848
for name in ['root-L04-evidence-file-index.json','root-L04-r1-evidence-file-index.json','root-L03-evidence-file-index.json','root-L03-r1-evidence-file-index.json','root-L02-evidence-file-index.json','root-L02-r1-evidence-file-index.json']:
 idx=read(D/name)
 for row in idx['files']: check(Path(idx['root'])/row['path'],row)
check(D/'task-L04-report.md',old['report'])
report=metadata(D/'task-L05-report.md'); assert report=={'bytes':31963,'sha256':'e8c86b1e7cba873e6f92d7551a9ba69a267205b23c14db155ca605b8a5993496'}
files=[{'path':p.relative_to(E).as_posix(),**metadata(p)} for p in sorted(E.rglob('*')) if p.is_file()]
(D/'root-L05-evidence-file-index.json').write_text(json.dumps({'root':str(E),'files':files,'limit':'Byte preservation only.'},indent=2)+'\n')
result={'source':HEAD,'lab':LAB,'sourceTree':git(S,'rev-parse','HEAD^{tree}'),'labTree':git(L,'rev-parse','HEAD^{tree}'),'clean':True,'originalBase':{'source':BASE,'lab':LABBASE},'export':str(X),'runtimeArtifactSha256':m['artifactSha256'],'schemaHash':m['schemaHash'],'schemas':len(m['schemas']),'closures':closures,'report':report,'checks':receipts,'finalByteAttribution':attribution,'priorEvidenceFiles':len(prior),'oldExportPreserved':str(O),'newEvidenceFiles':len(files),'limits':['Read-only local byte/receipt consistency; no suites/native/SQLite; not effective Git graph or host authentication.','67 TS and25 Python tests retain synthetic/portable scope. Changed-file eslint only, full historical lint deferred to B10.','Dossier prepared means reference completeness only; native, physical, calibration, signing, venue and finalCI remain open.']}
(D/'root-L05-handoff.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'clean':True,'closures':closures,'schemas':len(m['schemas']),'report':report,'receipts':len(receipts),'sourceFiles':len(attribution),'priorEvidenceFiles':len(prior),'newEvidenceFiles':len(files)}))
