"""Commit only final retained reports/check receipts; no circular self-retention."""
from pathlib import Path
import json,subprocess,hashlib,datetime
b=Path(__file__).resolve().parent;active=b.parents[4];paths=json.loads((b/'paths.json').read_text());first=json.loads((b/'first-publication-heads.json').read_text());checkpoint=json.loads((b/'late-retention-checkpoint-staged.json').read_text());assert (b/'normal-publication-checks-completed.json').is_file();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();ret='docs/implementation/web-lab-to-physical/post-n1-final-recording/retention/';clarification=json.loads((b/'launch-guide-layout-clarification.json').read_text());prose=clarification['path'];allowed={prose,ret+'current-readable-location-map.json',ret+'rulings-whole-lines.json',ret+'rulings-whole-lines.md'};ops=[]
def git(repo,args):
 r=subprocess.run(['git',*args],cwd=repo,text=True,capture_output=True,timeout=1800);ops.append({'cwd':str(repo),'argv':['git',*args],'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr});(b/'final-checkpoint-git-operations.json').write_text(json.dumps(ops,indent=2)+'\n');assert r.returncode==0,r.stderr;return r.stdout.strip()
assert git(active,['rev-parse','HEAD'])==first['firstPublicationHeads']['source']['commit'];assert git(active,['branch','--show-current'])=='codex/web-lab-to-physical'
# First-publication destinations immutable except explicit current indices and the root-requested launch-layout sentence.
for row in first['copies']:
 if row['repository']!='source' or row['path'] in allowed:continue
 p=active/row['path'];assert p.stat().st_size==row['stagedBytes'] and sha(p)==row['stagedSha256'],('FIRST_PUBLICATION_BYTES_CHANGED',row['path'])
files=git(active,['ls-files','--modified','--others','--exclude-standard']).splitlines();assert files
p=active/prose;assert p.stat().st_size==clarification['after']['bytes'] and sha(p)==clarification['after']['sha256'];git(active,['diff','--check','--',prose])
for rel in files:assert rel in allowed or rel.startswith(ret+'late-checkpoint/') or rel.startswith(ret+'snapshots/initial-readable/'),('UNDECLARED_LATE_PATH',rel)
for i in range(0,len(files),100):git(active,['add','--',*files[i:i+100]])
assert set(git(active,['diff','--cached','--name-only']).splitlines())==set(files)
# Historical retained raw text is byte-exact; no whitespace rewrite/check of original reports.
git(active,['commit','-m','docs: retain final post-N1 publication checks'])
heads={}
for name,repo in [('source',active),('lab',Path(paths['lab']))]:
 assert not git(repo,['status','--porcelain','--untracked-files=all']);heads[name]={'commit':git(repo,['rev-parse','HEAD']),'tree':git(repo,['rev-parse','HEAD^{tree}']),'branch':git(repo,['branch','--show-current'])}
assert heads['lab']['commit']==first['firstPublicationHeads']['lab']['commit']
report=active/'.superpowers/sdd/README/task-post-n1-final-recording-report.md';maps={}
for name,p in [('current',active/ret/'current-readable-location-map.json'),('initial',active/ret/'snapshots/initial-readable/location-map.json')]:maps[name]={'path':str(p.relative_to(active)),'bytes':p.stat().st_size,'sha256':sha(p)}
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'DONE_WITH_CONCERNS','heads':heads,'producer':first['producer'],'observedCloneHeads':json.loads((b/'normal-publication-checks-completed.json').read_text())['observedHeads'],'report':{'path':str(report),'bytes':report.stat().st_size,'sha256':sha(report)},'maps':maps,'lateCheckpoint':checkpoint,'finalChangedPaths':files,'checkedFirstPublicationFilesUnchangedExceptExplicitCurrentIndicesAndRootLaunchSentence':True,'launchGuideClarification':clarification,'scope':'Final exact heads are external to their own committed report/checkpoint to avoid a self-hash cycle. No circular rerun, new raw archive, code/test change, main/remote operation, hardware or cleanup.'};(b/'final-handoff.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
