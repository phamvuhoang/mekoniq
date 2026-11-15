"""L04 scoped fix1 local byte/receipt audit. No suites, native or database execution."""
from pathlib import Path
import hashlib,json,subprocess
S=Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source');L=S.parent/'lab';D=Path(__file__).parent;E=D/'evidence-L04/fix1'
BASE='3edb4320d7146343a4b9df977c65d846472c473b';LABBASE='e8ed78b98399947a26e525b8f9902e3463aef36a'
HEAD='7d8bededd7b0ca57984d6f0d000eaa74ddea839d';LAB='2ccfbddb86282a9547368302f6121c7ee09acb71'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def git(p,*args):return subprocess.check_output(['git','-C',str(p),*args],text=True).strip()
def check(p,row):
 b=p.read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256'],str(p)
for repo,head in [(S,HEAD),(L,LAB)]:assert git(repo,'rev-parse','HEAD')==head and not git(repo,'status','--porcelain')
j=read(E/'identities.json');assert j['sourceCommit']==HEAD and j['labCommit']==LAB
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
old=read(D/'root-L04-handoff.json');assert closures['portable']==old['closures']['portable'] and m['schemaHash']==old['schemaHash']
oldnative=read(Path(old['export'])/'manifest.json')['nativeTools'];assert [f['path'] for f in oldnative['files']]==[f['path'] for f in m['nativeTools']['files']]
receipts={}
for p in sorted(E.glob('*.receipt.json')):
 r=read(p);b=p.with_name(p.name.replace('.receipt.json','.log')).read_bytes();assert len(b)==r['outputBytes'] and sha(b)==r['outputSha256']
 assert type(r['exit']) is int and r['argv'];name=p.name.removesuffix('.receipt.json')
 assert r['exit']==(1 if name=='red-staging' else 0),(name,r['exit'])
 receipts[name]={'exit':r['exit'],'argv':r['argv'],'sourceCommit':r['sourceCommit'],'receiptSha256':sha(p.read_bytes()),'logSha256':sha(b)}
assert {'green-staging','clean-export','lab-check-source','lab-typecheck','identity','post-report','report-append'}<=set(receipts)
changed=git(S,'diff','--name-only',BASE,HEAD).splitlines();assert len(changed)==3
green=read(E/'green-staging.receipt.json');attribution={}
for path in changed:
 b=(S/path).read_bytes();assert green['changedBytes'][path]==sha(b)
 assert b==subprocess.check_output(['git','-C',str(S),'show',HEAD+':'+path])
 attribution[path]={'receipt':'green-staging','sha256':sha(b),'limit':'Checked-tree byte identity; Python behavior covered by named suite, documentation not executed.'}
report=(D/'task-L04-report.md').read_bytes();prefix=(E/'pre-fix1-report.md').read_bytes();assert report[:32387]==prefix and len(prefix)==32387 and sha(prefix)==old['report']['sha256']
preserved=[]
for name in ['root-L04-evidence-file-index.json','root-L03-evidence-file-index.json','root-L03-r1-evidence-file-index.json','root-L02-evidence-file-index.json','root-L02-r1-evidence-file-index.json']:
 idx=read(D/name)
 for row in idx['files']:check(Path(idx['root'])/row['path'],row)
 preserved.append({'index':name,'files':len(idx['files'])})
oldartifacts=[]
for idpath in [D/'evidence-L04/identities-final.json',D/'evidence-L04/identities-final-v2.json',D/'evidence-L03/fix1/identities-final.json']:
 ident=read(idpath);x=Path(ident['export']);om=read(x/'manifest.json');c=L/'.runtime'/om['artifactSha256']
 assert om==read(c/'manifest.json') and sha((x/'manifest.json').read_bytes())==ident['manifestSha256'] and sha((c/'manifest.json').read_bytes())==ident['cacheManifestSha256']
 assert sha((x/'runtime.mjs').read_bytes())==sha((c/'runtime.mjs').read_bytes())==om['artifactSha256']
 sh=hashlib.sha256()
 for name in sorted(om['schemas']):
  b=(x/'schemas'/name).read_bytes();assert b==(c/'schemas'/name).read_bytes();sh.update((name+'\n').encode());sh.update(b)
 assert sh.hexdigest()==om['schemaHash']
 oldartifacts.append({'source':om['sourceCommit'],'export':str(x),'runtimeArtifactSha256':om['artifactSha256']})
assert sha((D/'task-L03-report.md').read_bytes())==read(D/'root-L03-r1-handoff.json')['report']['sha256']
files=[{'path':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(E.rglob('*')) if p.is_file()]
(D/'root-L04-r1-evidence-file-index.json').write_text(json.dumps({'root':str(E),'files':files,'limit':'Byte preservation only.'},indent=2)+'\n')
result={'source':HEAD,'lab':LAB,'sourceTree':git(S,'rev-parse','HEAD^{tree}'),'labTree':git(L,'rev-parse','HEAD^{tree}'),'clean':True,'fixBase':{'source':BASE,'lab':LABBASE},'export':str(X),'runtimeArtifactSha256':m['artifactSha256'],'schemaHash':m['schemaHash'],'schemas':len(m['schemas']),'closures':closures,'report':{'bytes':len(report),'sha256':sha(report),'prefixBytes':len(prefix),'prefixSha256':sha(prefix)},'checks':receipts,'finalByteAttribution':attribution,'preserved':preserved,'oldArtifacts':oldartifacts,'newEvidenceFiles':len(files),'limits':['Read-only local byte/receipt audit, no suites/native/SQLite; not effective Git graph or host authentication.','34 Python tests plus3 subtests cover fix1; prior138TS/71Python retain original bytes/identities. No new native preflight or native qualification.','L04-R2 remains deferred; native qualification, fullCI and earlier historical lint issue remain incomplete.']}
(D/'root-L04-r1-handoff.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'clean':True,'closures':closures,'schemas':len(m['schemas']),'report':result['report'],'receipts':len(receipts),'changedFiles':len(changed),'preserved':preserved,'oldArtifacts':len(oldartifacts),'newEvidenceFiles':len(files)}))
