"""Read-only controller byte/receipt audit; no product code, suites, native or SQLite execution."""
from pathlib import Path
import hashlib, json, subprocess

S=Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source')
L=S.parent/'lab';D=Path(__file__).parent;E=D/'evidence-L04'
BASE='7b5b3a17e501f125efac18749ad5b8123940ce7c';LABBASE='58d082a9d57ea9216fa123ebb5d676ae1421b550'
HEAD='3edb4320d7146343a4b9df977c65d846472c473b';LAB='e8ed78b98399947a26e525b8f9902e3463aef36a'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def git(p,*args):return subprocess.check_output(['git','-C',str(p),*args],text=True).strip()
def check(p,row):
 b=p.read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256'],str(p)
for repo,head in [(S,HEAD),(L,LAB)]:
 assert git(repo,'rev-parse','HEAD')==head and not git(repo,'status','--porcelain')
j=read(E/'identities-final-v2.json');assert j['sourceCommit']==HEAD and j['labCommit']==LAB
X=Path(j['export']);m=read(X/'manifest.json');pin=read(L/'config/source-runtime.lock.json');cache=L/'.runtime'/m['artifactSha256']
assert m==read(cache/'manifest.json') and m['dirty'] is False and pin['dirty'] is False
assert m['sourceCommit']==pin['sourceCommit']==HEAD
assert sha((X/'runtime.mjs').read_bytes())==sha((cache/'runtime.mjs').read_bytes())==m['artifactSha256']==pin['artifactSha256']==j['artifactSha256']
assert sha((X/'manifest.json').read_bytes())==j['manifestSha256'] and sha((cache/'manifest.json').read_bytes())==j['cacheManifestSha256']
assert sha((L/'config/source-runtime.lock.json').read_bytes())==j['labPinSha256']
closures={}
for name,c in [('native',m['nativeTools']),('portable',m['portableSimulationTools']['closure'])]:
 assert sha(json.dumps(c['files'],separators=(',',':'),ensure_ascii=False).encode())==c['digest']
 assert len({f['path'] for f in c['files']})==len(c['files'])
 for f in c['files']:check(S/f['path'],f)
 closures[name]={'files':len(c['files']),'bytes':sum(f['bytes'] for f in c['files']),'digest':c['digest']}
assert closures['native']['files']==225 and closures['portable']['files']==237
assert pin['portableToolsDigest']==closures['portable']['digest']==j['portableToolsDigest']
h=hashlib.sha256()
for name in sorted(m['schemas']):
 b=(S/'packages/contracts/schemas'/name).read_bytes();assert b==(X/'schemas'/name).read_bytes()==(cache/'schemas'/name).read_bytes();h.update((name+'\n').encode());h.update(b)
assert h.hexdigest()==m['schemaHash']==pin['schemaHash']==j['schemaHash']
nativepaths={f['path'] for f in m['nativeTools']['files']}
for root in ['integrations/arm-controller/scripts','integrations/arm-controller/packaging']:
 for p in (S/root).rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts:assert p.relative_to(S).as_posix() in nativepaths
receipts={}
for p in sorted(E.glob('*.receipt.json')):
 r=read(p);log=p.with_name(p.name.replace('.receipt.json','.log'));b=log.read_bytes();assert len(b)==r['outputBytes'] and sha(b)==r['outputSha256'],p.name
 assert type(r['exit']) is int and isinstance(r['argv'],list) and r['argv'],p.name
 receipts[p.name.removesuffix('.receipt.json')]={'exit':r['exit'],'argv':r['argv'],'sourceCommit':r['sourceCommit'],'receiptSha256':sha(p.read_bytes()),'logSha256':sha(b)}
for name in ['combined-ts-final','combined-python-final-02','guard-python-final','contracts-final','typecheck-final','changed-lint-final','guard-clean-export','guard-lab-import','guard-lab-sync','guard-lab-check-source','guard-lab-typecheck','guard-lab-staged-check','identity-final-v2']:
 assert receipts[name]['exit']==0,name
changed=git(S,'diff','--name-only',BASE,HEAD).splitlines();assert set(changed)==set(j['finalChangedSourceFiles']) and len(changed)==13
attribution={}
for path in changed:
 b=(S/path).read_bytes();assert sha(b)==j['finalChangedSourceFiles'][path]
 if path.endswith(('scripts/smoke_driver.py','tests/test_actual_trace.py')):name='guard-python-final'
 elif path.startswith('docs/'):name='guard-final-bytes'
 elif path.startswith('integrations/arm-controller/scripts/') or path.endswith('tests/test_smoke_launch.py'):name='combined-python-final-02'
 else:name='combined-ts-final'
 r=read(E/(name+'.receipt.json'));assert r['exit']==0 and r['changedBytes'].get(path)==sha(b),(path,name)
 attribution[path]={'receipt':name,'sha256':sha(b),'limit':'Checked-tree byte attribution only; semantic coverage is the named test scope. Documentation has byte check/self-review, not execution.'}
preserved=[]
for name in ['root-L03-evidence-file-index.json','root-L03-r1-evidence-file-index.json','root-L02-evidence-file-index.json','root-L02-r1-evidence-file-index.json']:
 idx=read(D/name)
 for row in idx['files']:check(Path(idx['root'])/row['path'],row)
 preserved.append({'index':name,'files':len(idx['files'])})
idx=read(D/'root-L04-intermediate-evidence-index.json')
for row in idx['files']:check(E/row['path'],row)
assert (D/'root-L04-intermediate-identities.json').read_bytes()==(E/'identities-final.json').read_bytes()
oldartifacts=[]
for ident in [read(D/'evidence-L03/fix1/identities-final.json'),read(E/'identities-final.json')]:
 x=Path(ident['export']);old=read(x/'manifest.json');c=L/'.runtime'/old['artifactSha256']
 assert old==read(c/'manifest.json') and sha((x/'runtime.mjs').read_bytes())==sha((c/'runtime.mjs').read_bytes())==old['artifactSha256']
 assert sha((x/'manifest.json').read_bytes())==ident['manifestSha256'] and sha((c/'manifest.json').read_bytes())==ident['cacheManifestSha256']
 oldschema=hashlib.sha256()
 for name in sorted(old['schemas']):
  b=(x/'schemas'/name).read_bytes();assert b==(c/'schemas'/name).read_bytes();oldschema.update((name+'\n').encode());oldschema.update(b)
 assert oldschema.hexdigest()==old['schemaHash']
 for row in old['nativeTools']['files']:
  b=subprocess.check_output(['git','-C',str(S),'show',old['sourceCommit']+':'+row['path']]);assert sha(b)==row['sha256'] and len(b)==row['bytes']
 oldartifacts.append({'source':old['sourceCommit'],'export':str(x),'runtimeArtifactSha256':old['artifactSha256']})
assert sha((D/'task-L03-report.md').read_bytes())==read(D/'root-L03-r1-handoff.json')['report']['sha256']
cases=[]
for mode in ['terminal','gui']:
 p=E/'native-not-run-final'/mode/'smoke-sim.json';r=read(p)
 assert receipts['guard-'+mode+'-preflight']['exit']==2 and r['subjectSourceCommit']==HEAD
 assert r['accepted'] is False and r['result']=='not_run' and r['status']=='blocked_external'
 assert r['actualJointTrace'] is None and r['nativeTimingQualification']=='not_run'
 assert r['runtimeInventory']['installation']['resolved'] is False
 for name,digest in j['preflights'][mode].items():assert sha((p.parent/name).read_bytes())==digest
 assert not list(p.parent.glob('*trace*')) and not (p.parent/'linuxcnc.log').exists()
 cases.append({'mode':mode,'sha256':sha(p.read_bytes()),'result':'not_run','exit':2})
report=(D/'task-L04-report.md').read_bytes()
files=[{'path':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(E.rglob('*')) if p.is_file()]
(D/'root-L04-evidence-file-index.json').write_text(json.dumps({'root':str(E),'files':files,'limit':'Byte preservation index, not semantic/native attestation.'},indent=2)+'\n')
result={'sourceBase':BASE,'labBase':LABBASE,'source':HEAD,'lab':LAB,'sourceTree':git(S,'rev-parse','HEAD^{tree}'),'labTree':git(L,'rev-parse','HEAD^{tree}'),'clean':True,'export':str(X),'runtimeArtifactSha256':m['artifactSha256'],'schemaHash':m['schemaHash'],'schemas':len(m['schemas']),'closures':closures,'report':{'bytes':len(report),'sha256':sha(report)},'checks':receipts,'finalByteAttribution':attribution,'preserved':preserved,'intermediateEvidenceFiles':len(idx['files']),'oldArtifacts':oldartifacts,'cases':cases,'evidenceFiles':len(files),'limits':['No suites, native services or SQLite access executed by this audit. Local byte/receipt consistency only, not effective Git graph or host authentication.','Earlier combined TS/Python and later guard Python cover separate trees; counts overlap. Test doubles and real RTB numeric subset do not qualify native ALG04 or motion.','Installed package/source provenance, native terminal/GUI, controller timing/Cartesian residual and hardware gates remain incomplete.']}
(D/'root-L04-handoff.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'clean':True,'closures':closures,'schemas':len(m['schemas']),'report':result['report'],'receipts':len(receipts),'changedFiles':len(changed),'preserved':preserved,'intermediateEvidenceFiles':len(idx['files']),'newEvidenceFiles':len(files),'cases':cases}))
