from pathlib import Path
import json,hashlib,shutil,datetime
b=Path(__file__).resolve().parent;e=Path(json.loads((b/'paths.json').read_text())['root']);stage=e/'publication-staging';dest=stage/'source/docs/implementation/web-lab-to-physical/retention/publication-checks';dest.mkdir(parents=True,exist_ok=True);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();frozen=json.loads((stage/'archive-receipts/final-metadata-copy-map.json').read_text());old={r['original']:r['sha256'] for r in frozen['files']};excluded={b/'takeover-owned-state-and-path.json',b/'r1-invocation-boundary.json'};rows=[]
for p in sorted(b.rglob('*')):
 if not p.is_file() or p.is_symlink() or p in excluded:continue
 digest=sha(p)
 if old.get(str(p))==digest:continue
 rel=p.relative_to(b);q=dest/'phase'/rel
 if q.suffix in ['.js','.mjs','.cjs','.ts','.tsx']:q=q.with_name(q.name+'.txt')
 q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(q)==digest;rows.append({'original':str(p),'path':str(q.relative_to(dest)),'bytes':p.stat().st_size,'sha256':digest,'role':'Exact later metadata/check bytes; code snapshots use a mapped .txt extension to avoid treating retained code as authored lint input.'})
number=len(list(dest.glob('index-*.json')))+1;(dest/('index-'+str(number)+'.json')).write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Files newly created or changed after the immutable safe recording-metadata snapshot. Earlier exact files remain in that archive; own archive-self/publication checks follow it and are retained here directly, avoiding recursive archive hashes. No excluded host context copied.','records':rows},indent=2)+'\n');print(json.dumps({'lateFiles':len(rows),'snapshot':number}))
