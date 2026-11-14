import subprocess,json,os,sys
from pathlib import Path
root=Path('/tmp/mekoniq-b05-probe');p=json.loads((root/'candidate-01-policy.json').read_text());results=[]
for i,(x,y) in enumerate(p['offsetsM'],1):
 r=subprocess.run([sys.executable,str(root/'rig.py'),str(x),str(y),str(i)],capture_output=True,text=True,timeout=120)
 (root/f'trial-{i}.log').write_text(r.stdout+r.stderr)
 if r.returncode:raise RuntimeError(r.stderr)
 summary=json.loads((root/f'trial-{i}-summary.json').read_text());results.append(summary)
 print(i,summary['passed'],summary.get('receiverWindowTicks'),summary.get('unexpectedContactCount'),flush=True)
(root/'ten-trials.json').write_text(json.dumps({'accepted':False,'passedCount':sum(r['passed'] for r in results),'total':len(results),'results':results},indent=2))
