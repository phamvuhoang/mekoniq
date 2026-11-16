from pathlib import Path
import hashlib,json,os,subprocess,datetime
base=Path(__file__).resolve().parent;root=Path((base/'output-root.txt').read_text().strip());files=[]
for p in sorted(root.rglob('*')):
 if p==root/'artifact-index.json':continue
 if p.is_symlink():files.append({'path':str(p.relative_to(root)),'kind':'symlink','target':os.readlink(p)})
 elif p.is_file():
  h=hashlib.sha256()
  with p.open('rb') as f:
   while b:=f.read(1024*1024):h.update(b)
  files.append({'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':h.hexdigest()})
(root/'artifact-index.json').write_text(json.dumps({'root':str(root),'createdAt':datetime.datetime.now().isoformat(),'scope':'owned correction artifacts only; original failed and successful records retained; not an acceptance signature','files':files},indent=2)+'\n')
p=root/'artifact-index.json';print(json.dumps({'files':len(files),'bytes':sum(f.get('bytes',0) for f in files),'indexBytes':p.stat().st_size,'indexSha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
