"""Read-only commit reachability for maintained publication/reproduction descriptors."""
from pathlib import Path
import subprocess,json,re,sys,hashlib,datetime
from urllib.parse import urlsplit,unquote
workspace=Path(sys.argv[1]).resolve();scope=Path(sys.argv[2]);output=Path(sys.argv[3]);assert not output.exists();spec=json.loads(scope.read_text());rows=[]
for item in spec['refs']:
 repo=workspace/item['repository'];ref=item['ref'];ops=[]
 for args in [['rev-parse','--verify',ref+'^{commit}'],['rev-parse','HEAD'],['merge-base','--is-ancestor',ref,'HEAD']]:
  r=subprocess.run(['git',*args],cwd=repo,text=True,capture_output=True,timeout=60);ops.append({'argv':['git',*args],'cwd':str(repo),'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
 for origin in item.get('origins',[]):
  if not origin.get('url'):continue
  url=urlsplit(origin['url']);parts=[unquote(x) for x in url.path.strip('/').split('/')];path='/'.join(parts[4:]);obj=ref+(':'+path if path else '');argv=['git','cat-file','-e',obj];r=subprocess.run(argv,cwd=repo,text=True,capture_output=True,timeout=60);ops.append({'argv':argv,'cwd':str(repo),'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'url':origin['url']})
  if url.fragment:raise RuntimeError('EXACT_GIT_FRAGMENT_REQUIRES_SUPPORTED_FRAGMENT_AUDIT:'+origin['url'])
 rows.append({**item,'commit':ops[0]['stdout'].strip(),'shippedHead':ops[1]['stdout'].strip(),'reachable':all(o['exitCode']==0 for o in ops),'operations':ops})
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':spec,'scopeSha256':hashlib.sha256(scope.read_bytes()).hexdigest(),'records':rows,'failures':[r for r in rows if not r['reachable']],'remoteAvailability':'Not checked; ordinary local clone graph reachability does not establish remote advertisement or permissions.'};output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'refs':len(rows),'failed':len(result['failures'])}));raise SystemExit(bool(result['failures']))
