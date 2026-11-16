from pathlib import Path
import json,sys,hashlib,datetime,subprocess
source=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]);assert not out.exists();raw=source/'docs/implementation/evidence/web-lab-to-physical/final-recording';ret=source/'docs/implementation/web-lab-to-physical/retention';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();inventory=json.loads((raw/'index.json').read_text());archives=[];forbidden=['.runtime-owner.sqlite','takeover-owned-state-and-path.json','r1-invocation-boundary.json','host-sleep-observation.log']
for r in inventory['archives']:
 archive=raw/r['publishedArchive'];idx=raw/r['publishedMemberIndex'];assert archive.stat().st_size==r['archiveBytes'] and sha(archive)==r['archiveSha256'];assert sha(idx)==r['memberIndexSha256'];j=json.loads(idx.read_text());assert len(j['files'])==j['memberCount']==r['memberCount'];assert sum(x['bytes'] for x in j['files'])==j['memberBytes']==r['memberBytes'];assert all(Path(x['path']).name not in forbidden for x in j['files']);receipt=raw/'archive-receipts'/Path(r['safeExtractionReceipt']).name;assert sha(receipt)==r['safeExtractionReceiptSha256'];check=json.loads(receipt.read_text());assert check['verifiedFiles']==r['memberCount'] and check['verifiedBytes']==r['memberBytes'] and check['archiveSha256']==r['archiveSha256'] and check['memberIndexSha256']==r['memberIndexSha256'];archives.append({'id':r['id'],'archiveSha256':r['archiveSha256'],'memberCount':r['memberCount'],'memberBytes':r['memberBytes'],'safeExtractReceiptSha256':sha(receipt)})
readable=json.loads((ret/'full-readable-copy-map.json').read_text());files=[]
for r in readable['files']:
 p=source/r['destination'];assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256'];files.append({'path':r['destination'],'bytes':r['bytes'],'sha256':r['sha256']})
rulings=json.loads((ret/'rulings-whole-lines.json').read_text())
for r in rulings['records']:assert (ret/'sdd'/r['ledger']).read_text().splitlines()[r['lineAtSnapshot']-1]==r['text']
initial=json.loads((ret/'snapshots/initial-readable/location-map.json').read_text())
for r in initial['records']:
 p=ret/r['retainedPathFromRetention'];assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256']
late=json.loads((ret/'late-root-audits/index.json').read_text())
for r in late['files']:
 p=ret/r['path'];assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256']
privacy=json.loads((raw/'privacy-exclusions.json').read_text());assert len(privacy['exclusions'])==4
for r in privacy['publishedDerivatives']:
 p=raw/r['path'];assert p.stat().st_size==r['bytes'] and sha(p)==r['sha256']

result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':str(source),'publicationHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(),'archiveCount':len(archives),'compressedBytes':sum(r['archiveBytes'] for r in inventory['archives']),'indexedPublicMemberOccurrences':sum(r['memberCount'] for r in archives),'indexedPublicBytes':sum(r['memberBytes'] for r in archives),'archives':archives,'readableFiles':len(files),'readableBytes':sum(r['bytes'] for r in files),'reviewCount':readable['reviewCount'],'reviewBytes':readable['reviewBytes'],'wholeRulingLines':rulings['physicalLines'],'explicitRulingClauses':rulings['explicitClauses'],'privateRawExclusions':4,'initialReadableSnapshotFiles':len(initial['records']),'lateRootAuditFiles':len(late['files']),'scope':'Actual normal-clone archive/index/receipt/readable byte validation. Earlier safe extraction verified every indexed public regular member; unchanged archive/index hashes carry those results. Duplicate member occurrences across records are not unique tests. Four private evidence originals and unselected operational contexts are outside public bytes; original giant patches/envelope have explicit hash/ref descriptors.','status':'verified'};out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['archives','scope']}))
