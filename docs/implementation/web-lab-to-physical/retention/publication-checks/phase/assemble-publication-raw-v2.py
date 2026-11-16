from pathlib import Path
import json,hashlib,shutil,datetime
b=Path(__file__).resolve().parent;active=b.parents[4];e=Path(json.loads((b/'paths.json').read_text())['root']);stage=e/'publication-staging';dest=stage/'source/docs/implementation/evidence/web-lab-to-physical/final-recording';dest.mkdir(parents=True,exist_ok=True);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();records={};copies=[]
for p in sorted((stage/'archive-receipts').glob('*.json')):
 try:j=json.loads(p.read_text())
 except:continue
 if not isinstance(j,dict):continue
 a=j.get('records',[])
 if all(k in j for k in ['id','archive','source','memberIndex','archiveBytes']):a=[j]
 for r in a:
  if not isinstance(r,dict) or not all(k in r for k in ['id','archive','source','memberIndex','archiveBytes']):continue
  if r['id'] in records:assert records[r['id']]['archiveSha256']==r['archiveSha256']
  records[r['id']]=r
for root,label in [(stage/'raw','raw'),(stage/'archive-receipts','archive-receipts'),(stage/'public-readbacks','public-readbacks')]:
 for p in sorted(root.rglob('*')):
  if not p.is_file():continue
  assert not p.is_symlink();q=dest/label/p.relative_to(root);q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(p)==sha(q);copies.append({'path':str(q.relative_to(dest)),'bytes':q.stat().st_size,'sha256':sha(q)})
privacy=json.loads((b/'public-privacy-exclusions-with-private-copy.json').read_text());privacy['publishedDerivatives']=[]
for row in privacy['exclusions']:
 if not row.get('derivative'):continue
 p=b/row['derivative'];q=dest/'privacy-derivatives'/p.name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(q)==row['derivativeSha256'];privacy['publishedDerivatives'].append({'excludedOriginalSha256':row['originalSha256'],'path':str(q.relative_to(dest)),'bytes':q.stat().st_size,'sha256':sha(q),'role':'Distinct marked derivative, not original raw bytes or rebound receipt log'})
(dest/'privacy-exclusions.json').write_text(json.dumps(privacy,indent=2)+'\n')
# Distinct direct images provide readable navigation; source hashes remain unchanged.
images=[]
for folder,names in [('production-performance',['production-active-cell.png','production-paused-during-export.png']),('web-record',['report-replay-fetched-cursor0-390.png']),('offline-vite-diagnostic-cjs',['original-blanket.png','api-path-control.png'])]:
 for name in names:
  p=e/folder/name
  if not p.exists():continue
  q=dest/'images'/folder/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);images.append({'original':str(p),'path':str(q.relative_to(dest)),'bytes':q.stat().st_size,'sha256':sha(q),'meaning':'Actual retained observation only; no new qualification or custody inference'})
for r in records.values():
 p=dest/'raw'/r['archive'];idx=dest/'raw'/r['memberIndex'];assert p.stat().st_size==r['archiveBytes'] and sha(p)==r['archiveSha256'];assert sha(idx)==r['memberIndexSha256'];r['publishedArchive']='raw/'+r['archive'];r['publishedMemberIndex']='raw/'+r['memberIndex'];r['originalPathMeaning']='Original host provenance, not a portable dependency; use this map and safe extraction.'
result={'version':1,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'producer':json.loads((b/'paths.json').read_text()),'scope':'Indexed public regular member bytes only. All raw successes and failures retain actual identities/statuses. Native/hardware/human acceptance remains false. Four explicit private originals are excluded; complete descriptors and marked derivatives are public. Giant reproducible patches/envelope are separately described; no claim that every raw host-context byte is published.','privacyExclusionDescriptor':'privacy-exclusions.json','archiveCount':len(records),'archiveBytes':sum(r['archiveBytes'] for r in records.values()),'archives':list(records.values()),'publishedFilesAtAssembly':copies,'images':images,'readbacks':'public-readbacks/index.json plus final phase receipts in metadata archive/publication checks; a nonzero expected original failure is retained, never promoted.','ordinaryCloneAudit':'Published separately after actual publication commits; remote hosting/permissions are outside local checks.'};(dest/'index.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'archives':len(records),'compressedBytes':result['archiveBytes'],'directImages':len(images),'publishedFiles':len(copies)}))
