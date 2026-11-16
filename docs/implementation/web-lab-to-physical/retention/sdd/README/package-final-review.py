"""Package the final exact net review boundary after handoff; never execute suites or modify repos."""
import argparse,hashlib,json,os,re,subprocess
from pathlib import Path
D=Path(__file__).resolve().parent;S=D.parents[2];L=S.parent/'lab'
def git(repo,*args):return subprocess.check_output(['git','-C',str(repo),*args])
def tree(repo,ref):
 out={}
 for row in git(repo,'ls-tree','-r','-z','--full-tree',ref).split(b'\0'):
  if not row:continue
  left,path=row.split(b'\t',1);mode,kind,oid=left.decode().split();out[path.decode()]={'mode':mode,'type':kind,'object':oid}
 return out

def file_meta(path):
 h=hashlib.sha256();size=0
 with path.open('rb') as f:
  for b in iter(lambda:f.read(2**20),b''):h.update(b);size+=len(b)
 return {'bytes':size,'sha256':h.hexdigest()}

def current_blob(repo,path,row,algorithm):
 p=repo/path
 if row['type']!='blob':return {**row,'workingCopy':'gitlink metadata only; assess dependency separately'}
 if row['mode']=='120000':
  data=os.fsencode(os.readlink(p));g=hashlib.new(algorithm,b'blob '+str(len(data)).encode()+b'\0'+data);assert g.hexdigest()==row['object'];return {**row,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'symlink':os.fsdecode(data)}
 assert p.is_file() and not p.is_symlink(),path
 size=p.stat().st_size;g=hashlib.new(algorithm,b'blob '+str(size).encode()+b'\0');h=hashlib.sha256();n=0
 with p.open('rb') as f:
  for b in iter(lambda:f.read(2**20),b''):g.update(b);h.update(b);n+=len(b)
 assert n==size and p.stat().st_size==size and g.hexdigest()==row['object'],path
 return {**row,'bytes':n,'sha256':h.hexdigest()}

def category(path):
 if path.startswith(('docs/implementation/evidence/','docs/implementation/web-lab-to-physical/retention/','docs/gtm/')):return 'evidence_or_retained_documents'
 if path.startswith('docs/'):return 'documentation'
 if path.startswith(('tests/','artifacts/tests/')):return 'tests_or_fixtures'
 return 'implementation_or_build_input'

ap=argparse.ArgumentParser();ap.add_argument('--source-head',required=True);ap.add_argument('--lab-head',required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
assert all(re.fullmatch('[0-9a-f]{40}',v) for v in [args.source_head,args.lab_head]);out=args.out.resolve();assert out.is_relative_to(D) and not out.exists();out.mkdir(parents=True)
result={'purpose':'Complete final net feature/evidence boundary. Categories do not exclude files or approve their behavior. No suites or original database engine opens.','repos':[]}
for repo,base,head in [(S,'11d25b47a18adafb88ac21adc249499109996bc5',args.source_head),(L,'a7449541e118d01f65af0ad1466e0c963a173f3c',args.lab_head)]:
 assert git(repo,'rev-parse','HEAD').decode().strip()==head and not git(repo,'status','--porcelain','--untracked-files=all')
 assert git(repo,'branch','--show-current').decode().strip()=='codex/web-lab-to-physical'
 subprocess.run(['git','-C',str(repo),'merge-base','--is-ancestor',base,head],check=True)
 merge=git(repo,'merge-base',base,head).decode().strip();assert merge==base
 before,after=tree(repo,base),tree(repo,head);algorithm=git(repo,'rev-parse','--show-object-format').decode().strip()
 names=[p.decode() for p in git(repo,'diff','--no-ext-diff','--no-textconv','--no-color','--name-only','-z','--no-renames',base,head).split(b'\0') if p]
 records=[]
 for name in names:
  records.append({'path':name,'category':category(name),'before':before.get(name),'after':current_blob(repo,name,after[name],algorithm) if name in after else None})
 patch=out/(repo.name+'.diff');argv=['git','-C',str(repo),'diff','--no-ext-diff','--no-textconv','--no-color','--binary','--no-renames',base,head]
 with patch.open('xb') as f:subprocess.run(argv,stdout=f,check=True)
 log=out/(repo.name+'-commits.txt');log.write_bytes(git(repo,'log','--no-color','--format=fuller',base+'..'+head))
 stat=out/(repo.name+'-stat.txt');stat.write_bytes(git(repo,'diff','--no-ext-diff','--no-textconv','--no-color','--no-renames','--stat',base,head))
 assert git(repo,'rev-parse','HEAD').decode().strip()==head and not git(repo,'status','--porcelain','--untracked-files=all')
 result['repos'].append({'repo':str(repo),'frozenUpstream':base,'head':head,'tree':git(repo,'rev-parse',head+'^{tree}').decode().strip(),'mergeBase':merge,'frozenIsAncestor':True,'patch':{'path':str(patch),**file_meta(patch),'argv':argv},'commits':{'path':str(log),**file_meta(log)},'stat':{'path':str(stat),**file_meta(stat)},'files':records})
(out/'package-index.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'index':str(out/'package-index.json'),'repos':[{'repo':r['repo'],'head':r['head'],'paths':len(r['files']),'patch':r['patch']} for r in result['repos']]}))
