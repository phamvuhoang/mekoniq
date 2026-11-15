"""Controller fix1 byte/receipt audit only; no suite or native execution."""
from pathlib import Path
import hashlib,json,subprocess
S=Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source');L=S.parent/'lab';D=S/'.superpowers/sdd/03-r3-linux-readiness';E=D/'evidence-L03/fix1'
BASE='2a7ec9c89935649835fc08eee4ebe81fc6190cf0';HEAD='7b5b3a17e501f125efac18749ad5b8123940ce7c';LAB='58d082a9d57ea9216fa123ebb5d676ae1421b550'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def git(p,*args):return subprocess.check_output(['git','-C',str(p),*args],text=True).strip()
def check(p,row):
 b=p.read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256'],str(p)
for p,head in [(S,HEAD),(L,LAB)]:assert git(p,'rev-parse','HEAD')==head and not git(p,'status','--porcelain')
j=read(E/'identities-final.json');X=Path(j['export']);m=read(X/'manifest.json');pin=read(L/'config/source-runtime.lock.json');cache=L/'.runtime'/m['artifactSha256']
assert m==read(cache/'manifest.json') and m['dirty'] is False and pin['dirty'] is False
assert j['sourceCommit']==m['sourceCommit']==pin['sourceCommit']==HEAD and j['labCommit']==LAB
assert sha((X/'runtime.mjs').read_bytes())==sha((cache/'runtime.mjs').read_bytes())==m['artifactSha256']==pin['artifactSha256']==j['runtimeArtifactSha256']
assert sha((X/'manifest.json').read_bytes())==j['manifestSha256'] and sha((cache/'manifest.json').read_bytes())==j['cacheManifestSha256']
assert sha((L/'config/source-runtime.lock.json').read_bytes())==j['labPinSha256']
closures={}
for name,c in [('native',m['nativeTools']),('portable',m['portableSimulationTools']['closure'])]:
 assert sha(json.dumps(c['files'],separators=(',',':'),ensure_ascii=False).encode())==c['digest']
 assert len(set(f['path'] for f in c['files']))==len(c['files'])
 for f in c['files']:check(S/f['path'],f)
 closures[name]={'files':len(c['files']),'bytes':sum(f['bytes'] for f in c['files']),'digest':c['digest']}
assert pin['portableToolsDigest']==closures['portable']['digest']==j['portableToolsDigest']
h=hashlib.sha256()
for name in sorted(m['schemas']):
 b=(S/'packages/contracts/schemas'/name).read_bytes();assert b==(X/'schemas'/name).read_bytes()==(cache/'schemas'/name).read_bytes();h.update((name+'\n').encode());h.update(b)
assert h.hexdigest()==m['schemaHash']==pin['schemaHash']==j['schemaHash']
receipts={}
for name in ['final-ts','final-python','final-contracts','final-typecheck','final-lint','selfreview-ts','selfreview-python','selfreview-typecheck','selfreview-lint','selfreview-diff-check','export-final','lab-import-final','lab-sync-final','lab-typecheck-final','lab-check-source-final','lab-diff-check-final','preservation-final']:
 r=read(E/(name+'.receipt.json'));assert r['exitCode']==0 and r['signal'] is None and r['error'] is None,name
 if name not in ['lab-import-final','lab-sync-final']:assert r['before']==r['after'],name
 receipts[name]={'exitCode':0,'argv':r['argv'],'receiptSha256':sha((E/(name+'.receipt.json')).read_bytes()),'logSha256':sha((E/(name+'.log')).read_bytes())}
changed=git(S,'diff','--name-only',BASE,HEAD).splitlines();attribution={}
for path in changed:
 if path in ['packages/lab-runtime/src/v2/sil/xarm-mapping.ts','tests/integration/xarm-native-contract.test.ts']:name='selfreview-ts'
 elif path in ['robotics/manipulation/native_xarm/mapping.py','robotics/manipulation/tests/test_native_xarm.py']:name='selfreview-python'
 elif path=='robotics/manipulation/native_xarm/worker.py':name='final-python'
 else:name='final-ts'
 r=read(E/(name+'.receipt.json'));assert sha((S/path).read_bytes())==r['after']['changedFiles'][path],(name,path)
 attribution[path]={'receipt':name,'sha256':sha((S/path).read_bytes()),'limit':'Matches checked-tree bytes; semantic coverage is the named test scope, not an assertion every file was executed.'}
assert len(changed)==22 and set(changed)==set(j['checkedFiles'])
old=read(D/'root-L03-handoff.json');report=(D/'task-L03-report.md').read_bytes();prefix=(E/'pre-fix1-report.md').read_bytes()
assert len(prefix)==31609 and report[:31609]==prefix and sha(prefix)==old['report']['sha256']
preserved=[]
for name in ['root-L03-evidence-file-index.json','root-L02-evidence-file-index.json','root-L02-r1-evidence-file-index.json']:
 index=read(D/name)
 for row in index['files']:check(Path(index['root'])/row['path'],row)
 preserved.append({'index':name,'files':len(index['files'])})
old_artifacts=[]
for ids_path in [D/'evidence-L03/identities.json',E/'identities.json']:
 ids=read(ids_path);x=Path(ids['export']);c=L/'.runtime'/ids['runtimeArtifactSha256']
 assert sha((x/'manifest.json').read_bytes())==ids['manifestSha256'] and sha((c/'manifest.json').read_bytes())==ids['cacheManifestSha256']
 assert sha((x/'runtime.mjs').read_bytes())==sha((c/'runtime.mjs').read_bytes())==ids['runtimeArtifactSha256']
 for case,data in ids['cases'].items():
  path=ids_path.parent/'native-not-run'/case/'run-manifest.json';assert sha(path.read_bytes())==data['manifestSha256']
  record=read(path)
  for f in record['artifacts']:assert sha((path.parent/f['path']).read_bytes())==f['sha256']
 old_artifacts.append({'sourceCommit':ids['sourceCommit'],'export':str(x),'runtimeArtifactSha256':ids['runtimeArtifactSha256'],'cases':len(ids['cases'])})
for path in ['robotics/manipulation/vendor.lock.json','robotics/simulation-mujoco/fixtures/xarm6-g2-v1/component.json','robotics/simulation-mujoco/fixtures/xarm6-g2-v1/vendor-manifest.json','robotics/simulation/profiles/engineering-amd64.lock.json','robotics/simulation/profiles/engineering-arm64.lock.json']:
 assert (S/path).read_bytes()==subprocess.check_output(['git','-C',str(S),'show',BASE+':'+path])
vendor=read(S/'robotics/manipulation/native-vendor.lock.json')
for f in vendor['files']:
 b=(S/'robotics/manipulation/vendor-source'/f['path']).read_bytes();assert sha(b)==f['contentSha256'] and hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==f['gitBlobSha']
cases=[]
for mode in ['X1','X2']:
 case=mode+'-engineering-arm64-nominal';path=E/'native-not-run-final'/case/'run-manifest.json';r=read(path);q=read(E/('public-'+mode+'-final.receipt.json'))
 assert q['exitCode']==2 and q['signal'] is None and q['error'] is None and q['before']==q['after'] and q['before']['head']==HEAD and not q['before']['status']
 assert r['sourceCommit']==HEAD and r['dirty'] is False and r['accepted'] is False and r['dynamics']=='not_calibrated'
 assert r['motion']['status']=='not_run' and r['motion']['result']=='blocked_external' and r['contact']['status']=='not_run' and r['contact']['trialsExecuted']==0
 state=read(path.parent/'source-lifecycle.json');assert state['phase']=='preflight_refused' and state['startup']=='preflight_refused' and state['command']=='not_attempted' and not state['shutdownErrors']
 for absent in ['launch.log','native-started.json','raw-bag']:assert not (path.parent/absent).exists()
 for f in r['artifacts']:assert sha((path.parent/f['path']).read_bytes())==f['sha256']
 assert sha(path.read_bytes())==j['cases'][case]['manifestSha256'];cases.append({'case':case,'manifestSha256':sha(path.read_bytes()),'exitCode':2,'motion':r['motion']['status']})
files=[{'path':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}for p in sorted(E.rglob('*')) if p.is_file()]
(D/'root-L03-r1-evidence-file-index.json').write_text(json.dumps({'root':str(E),'files':files,'limit':'Byte preservation index only.'},indent=2)+'\n')
result={'source':HEAD,'lab':LAB,'sourceTree':git(S,'rev-parse','HEAD^{tree}'),'labTree':git(L,'rev-parse','HEAD^{tree}'),'clean':True,'fixBase':{'source':BASE,'lab':'020b818b6ce0b813c22b8826945a917fe4017816'},'export':str(X),'runtimeArtifactSha256':m['artifactSha256'],'schemaHash':m['schemaHash'],'schemas':len(m['schemas']),'closures':closures,'report':{'bytes':len(report),'sha256':sha(report),'prefixBytes':len(prefix),'prefixSha256':sha(prefix)},'checks':receipts,'finalByteAttribution':attribution,'preserved':preserved,'oldArtifacts':old_artifacts,'vendorSnapshotsChecked':len(vendor['files']),'cases':cases,'newEvidenceFiles':len(files),'limits':['No suites/native/SQLite executed; read-only local byte/receipt consistency, not effective Git graph/native authenticity.','123TS/37Python precede numeric refinement; final15TS/12selectedPython cover later changes,26Python deselected not passes. Counts overlap.','R1-05 remains incomplete native qualification; prepared-code scoped review still pending.','External parameter YAML contents, installed/native behavior, contact and full CI remain unqualified.']}
(D/'root-L03-r1-handoff.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'headsClean':True,'closures':closures,'schemas':len(m['schemas']),'report':result['report'],'checkedChangedFiles':len(attribution),'preserved':preserved,'oldArtifactSets':len(old_artifacts),'newEvidenceFiles':len(files),'cases':len(cases)}))
