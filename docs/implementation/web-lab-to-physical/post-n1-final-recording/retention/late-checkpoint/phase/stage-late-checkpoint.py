"""Late retention only after ordinary clone checks; no producer/archive mutation.
Preserve the exact first readable map and every existing destination. New full
source/report/ledger/P bytes go to distinct late paths, then current map advances.
"""
from pathlib import Path
import json,hashlib,shutil,datetime,os
b=Path(__file__).resolve().parent;active=b.parents[4];sdd=active/'.superpowers/sdd';paths=json.loads((b/'paths.json').read_text());e=Path(paths['root']);stage=e/'publication-staging';ret=active/'docs/implementation/web-lab-to-physical/post-n1-final-recording/retention';assert (b/'normal-publication-checks-completed.json').is_file();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();current=ret/'current-readable-location-map.json';initial=ret/'snapshots/initial-readable/location-map.json';assert not initial.exists();initial.parent.mkdir(parents=True);shutil.copy2(current,initial);assert sha(current)==sha(initial);mapping=json.loads(current.read_text());rows={r['original']:r for r in mapping['files']};copied=[];late=ret/'late-checkpoint';late.mkdir();indices={}
for name in ['rulings-whole-lines.json','rulings-whole-lines.md','review-index.json']:
 p=ret/name;q=initial.parent/'indices'/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(p)==sha(q);indices[name]={'initialPath':str(q.relative_to(active)),'bytes':q.stat().st_size,'sha256':sha(q)}
selected=set(Path(v) for v in rows)
for root in [sdd,*[sdd/n for n in ['README','01-r2b-mobility','02-r2b-cell-and-web','03-r3-linux-readiness']]]:
 for p in root.iterdir():
  if p.is_file() and not p.is_symlink() and p.name!='.gitignore':selected.add(p)
for p in sorted(selected):
 assert p.is_file() and not p.is_symlink(),p
 if p.stat().st_size>5*1024*1024:continue
 assert p.name not in ['settlement-processes.txt','.runtime-owner.sqlite'],p
 info={'original':str(p),'bytes':p.stat().st_size,'sha256':sha(p)};old=rows.get(str(p))
 if old and (old['bytes'],old['sha256'])==(info['bytes'],info['sha256']):continue
 q=late/'sdd'/p.relative_to(sdd);q.parent.mkdir(parents=True,exist_ok=True);assert not q.exists();shutil.copy2(p,q);assert sha(q)==info['sha256'];row={**info,'destination':str(q.relative_to(active)),'retention':'Exact late complete original source/report/ledger/root metadata after initial publication/clone checks; initial frozen destinations unchanged'};rows[str(p)]=row;copied.append(row)
# Preserve every new/changed phase file after its safe immutable archive snapshot.
phaseMap=json.loads((stage/'archive-receipts/post-n1-phase-metadata-copy-map.json').read_text());oldPhase={r['original']:r for r in phaseMap['files']};phase=[]
for p in sorted(b.rglob('*')):
 assert not p.is_symlink(),p
 if not p.is_file():continue
 assert p.name not in ['settlement-processes.txt','.runtime-owner.sqlite','takeover-owned-state-and-path.json','r1-invocation-boundary.json','host-sleep-observation.log'],p
 h=sha(p);old=oldPhase.get(str(p))
 if old and (old['bytes'],old['sha256'])==(p.stat().st_size,h):continue
 q=late/'phase'/p.relative_to(b);q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(q)==h;phase.append({'original':str(p),'destination':str(q.relative_to(active)),'bytes':p.stat().st_size,'sha256':h,'initialPhaseMember':old,'scope':'Distinct late actual own receipt/log/caller/metadata; earlier failed versions remain in initial safe-phase archive if changed.'})
# Recompute literal ruling index from complete current source Markdown, preserving duplicates.
rulings=[]
for r in sorted(rows.values(),key=lambda r:r['original']):
 p=Path(r['original'])
 if p.suffix.lower()!='.md':continue
 assert sha(p)==r['sha256'],('ORIGINAL_CHANGED_DURING_LATE_SNAPSHOT',p)
 for line,text in enumerate(p.read_text().splitlines(),1):
  if 'Ruling:' in text or 'Sequencing ruling for final evidence:' in text:rulings.append({'source':str(p.relative_to(sdd)),'lineAtSnapshot':line,'text':text,'explicitClauses':text.count('Ruling:')+text.count('Sequencing ruling for final evidence:')})
(ret/'rulings-whole-lines.json').write_text(json.dumps({'scope':'All current whole literal ruling lines across mapped static Markdown, including cap/navigation/recording and intentional duplicates. Exact initial indices and source destinations remain frozen in initial-readable snapshot.','records':rulings,'physicalLines':len(rulings),'explicitClauses':sum(r['explicitClauses'] for r in rulings)},indent=2,ensure_ascii=False)+'\n');text='# Complete current literal ruling lines\n\nInitial index bytes and all full source snapshots remain preserved. Intentional duplicates are retained.\n'
for r in rulings:text+='\n## '+r['source']+':'+str(r['lineAtSnapshot'])+'\n\n```text\n'+r['text']+'\n```\n'
(ret/'rulings-whole-lines.md').write_text(text)
values=sorted(rows.values(),key=lambda r:r['original']);reports=[r for r in values if Path(r['original']).name.startswith('task-') and Path(r['original']).name.endswith('-report.md')];reviews=[r for r in values if Path(r['original']).name.startswith('task-') and '-review' in Path(r['original']).name and Path(r['original']).suffix=='.md'];mapping.update({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':values,'reportCount':len(reports),'reportBytes':sum(r['bytes'] for r in reports),'reviewCount':len(reviews),'reviewBytes':sum(r['bytes'] for r in reviews),'initialCurrentMap':{'path':str(initial.relative_to(active)),'bytes':initial.stat().st_size,'sha256':sha(initial)},'scope':'Final current readable location map. Initial first-publication map and all its exact destinations remain unchanged; later complete report/ledger/root records use distinct late paths. Prior907/121 old-current/initial maps and old190669-byte report remain immutable.','latePhaseIndex':'late-checkpoint/index.json'});current.write_text(json.dumps(mapping,indent=2)+'\n');index={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Late actual publication/normal-clone/root/report retention only, no new raw archives/campaigns/engineering review. Initial raw archives, member indices and maintained prose document hashes unchanged. Later final commit identity is external to avoid self-hash cycle.','initialCurrentMap':mapping['initialCurrentMap'],'initialDerivedIndices':indices,'currentMap':{'path':str(current.relative_to(active)),'bytes':current.stat().st_size,'sha256':sha(current)},'completeStaticUpdates':copied,'phaseUpdates':phase,'rulingLines':len(rulings),'rulingClauses':sum(r['explicitClauses'] for r in rulings)};(late/'index.json').write_text(json.dumps(index,indent=2)+'\n');(b/'late-retention-checkpoint-staged.json').write_text(json.dumps({'path':str(late/'index.json'),'bytes':(late/'index.json').stat().st_size,'sha256':sha(late/'index.json'),'currentMap':index['currentMap'],'initialMap':index['initialCurrentMap'],'scope':'Own helper result is separate external/direct checkpoint metadata; no circular rerun to include itself.'},indent=2)+'\n');print(json.dumps({'staticUpdates':len(copied),'latePhaseFiles':len(phase),'reports':len(reports),'reviews':len(reviews),'rulingLines':len(rulings),'currentMap':str(current),'initialMap':str(initial)}))
