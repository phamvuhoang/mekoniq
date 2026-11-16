from pathlib import Path
import argparse,subprocess,hashlib,json
D=Path(__file__).resolve().parent;S=D.parents[2];L=S.parent/'lab'
a=argparse.ArgumentParser();a.add_argument('--lab-head',required=True);q=a.parse_args()
assert len(q.lab_head)==40 and all(c in '0123456789abcdef' for c in q.lab_head)
def git(root,*argv):return subprocess.check_output(['git',*argv],cwd=root)
def sha(b):return hashlib.sha256(b).hexdigest()
rows=[];commits=[]
for root,base,head in [(S,'2bd66e679aba431a84736eb10e04717dc4d32ce7','229efa7f565876f8f9d69634f8fbc24b9196ed3f'),(L,'111ed9a763a5fea24ab3180834c83c1db97417dd',q.lab_head)]:
 assert git(root,'rev-parse','HEAD').decode().strip()==head
 assert not git(root,'status','--porcelain','--untracked-files=all')
 patch=git(root,'-c','core.quotePath=false','diff','--binary','--full-index','--no-ext-diff','--no-textconv','--no-color','-U10',base,head)
 path=D/('review-final-prerequisites-3-'+root.name+'-'+head[:7]+'.diff')
 if path.exists():assert path.read_bytes()==patch
 else:path.write_bytes(patch)
 files=[]
 for name in git(root,'diff','--name-only',base,head).decode().splitlines():
  b=(root/name).read_bytes();assert b==git(root,'show',head+':'+name)
  files.append({'path':name,'bytes':len(b),'sha256':sha(b),'blob':git(root,'rev-parse',head+':'+name).decode().strip()})
 rows.append({'repo':root.name,'base':base,'head':head,'tree':git(root,'rev-parse','HEAD^{tree}').decode().strip(),'diffPath':str(path),'diffBytes':len(patch),'diffSha256':sha(patch),'files':files})
 commits.append(root.name+' '+base+'..'+head+'\n'+git(root,'log','--format=fuller','--stat',base+'..'+head).decode())
meta=D/('root-final-prerequisites-3-git-audit-'+q.lab_head[:7]+'.json');assert not meta.exists();meta.write_text(json.dumps(rows,indent=2)+'\n')
cp=D/('review-final-prerequisites-3-commits-'+q.lab_head[:7]+'.txt');assert not cp.exists();cp.write_text('\n'.join(commits))
for r in rows:print(json.dumps({k:v for k,v in r.items() if k!='files'}|{'files':len(r['files'])}))
print('gitAudit',meta,'commits',cp)
