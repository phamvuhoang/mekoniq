from pathlib import Path
import json,subprocess,sys,time,datetime
b=Path(__file__).resolve().parent;deadline=time.monotonic()+3600
while not (b/'normal-publication-clones.json').is_file():
 assert time.monotonic()<deadline,'NORMAL_CLONE_NOT_COMPLETE';time.sleep(2)
clone=json.loads((b/'normal-publication-clones.json').read_text());workspace=Path(clone['workspace']);assert clone['heads']['source']=='838ac2c3c85ce335e32869a37ae6c91cb6be4b52' and clone['heads']['lab']=='affce0caa0d2bcdb9e5b1314ebe262a97916004a';results=[]
def run(name,argv,bound=900):
 r=subprocess.call([sys.executable,str(b/'run.py'),name,'source','perl','-e','alarm '+str(bound)+'; exec @ARGV',*map(str,argv)]);results.append({'id':name,'exitCode':r});return r
run('normal-clone-links-1',[sys.executable,b/'normal-clone-link-audit-reachable.py',workspace,b/'maintained-link-scope.json',b/'normal-clone-link-audit-1.json'])
run('normal-clone-exactrefs-1',[sys.executable,b/'exact-ref-reachability-v2.py',workspace,b/'published-exact-ref-scope.json',b/'normal-clone-exact-ref-audit-1.json'])
run('normal-clone-retention-1',[sys.executable,b/'verify-published-retention-v2.py',workspace/'source',b/'normal-clone-retention-audit-1.json'])
run('normal-clone-pin-1',[sys.executable,b/'check-normal-publication-pin.py'],1800)
(b/'normal-publication-checks-completed.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'workspace':str(workspace),'heads':clone['heads'],'checks':results,'scope':'Actual ordinary clone publication boundaries, not new production measurement or native/hardware qualification.'},indent=2)+'\n');print(json.dumps(results));raise SystemExit(any(r['exitCode'] for r in results))
