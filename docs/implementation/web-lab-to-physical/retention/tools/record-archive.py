"""Pack/extract retained data bytes without following dependency symlinks.
Invocations happen only after producer settlement. Index + archive are separate bound files.
No source deletion, SQLite engine opening, product edit or unsafe tar extraction.
"""
from pathlib import Path,PurePosixPath
import hashlib,json,sys,tarfile,gzip,datetime,os
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def safe(name):
 if not name or name.startswith('/') or '\\' in name or any(ord(c)<32 or ord(c)==127 for c in name):raise ValueError('UNSAFE_ARCHIVE_PATH:'+repr(name))
 parts=name.split('/')
 if any(p in ['', '.', '..'] for p in parts):raise ValueError('UNSAFE_ARCHIVE_COMPONENT:'+name)
 return parts

def inventory(root):
 files=[];dirs=[];links=[]
 for p in sorted(root.rglob('*')):
  rel=p.relative_to(root).as_posix();safe(rel)
  if p.is_symlink():links.append({'path':rel,'target':os.readlink(p),'retention':'descriptor only, never followed or materialized; external dependency provenance is not vendored evidence'})
  elif p.is_file():files.append({'path':rel,'bytes':p.stat().st_size,'sha256':sha(p),'sourceMode':oct(p.stat().st_mode & 0o777),'sourceMtimeNs':p.stat().st_mtime_ns})
  elif p.is_dir():dirs.append(rel)
  else:raise ValueError('UNSUPPORTED_SOURCE_NODE:'+str(p))
 return {'files':files,'directories':dirs,'declaredDependencySymlinks':links}

def pack(source,archive,index):
 source=source.resolve(strict=True);assert source.is_dir() and not archive.exists() and not index.exists();before=inventory(source)
 # Deliberately bound a supplied settled record directory, never an ambient checkout.
 assert not (source/'.git').exists(),'CHECKOUT_IS_NOT_A_RECORD'
 archive.parent.mkdir(parents=True,exist_ok=True);index.parent.mkdir(parents=True,exist_ok=True)
 with archive.open('xb') as raw,gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0,compresslevel=6) as zipped,tarfile.open(fileobj=zipped,mode='w|',format=tarfile.PAX_FORMAT) as tar:
  for rel in before['directories']:
   t=tarfile.TarInfo(rel);t.type=tarfile.DIRTYPE;t.mode=0o755;t.mtime=0;tar.addfile(t)
  for row in before['files']:
   t=tarfile.TarInfo(row['path']);t.size=row['bytes'];t.mode=int(row['sourceMode'],8);t.mtime=0
   with (source/row['path']).open('rb') as f:tar.addfile(t,f)
 assert inventory(source)==before,'SOURCE_CHANGED_DURING_ARCHIVE'
 result={'version':1,'packedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':str(source),'archive':str(archive.resolve()),'archiveBytes':archive.stat().st_size,'archiveSha256':sha(archive),'memberCount':len(before['files']),'memberBytes':sum(x['bytes'] for x in before['files']),'policy':'Exact regular-file bytes and executable/mode bits; deterministic neutral owner/time tar metadata; empty directories preserved; dependency symlinks retained only as descriptors, not followed/materialized; no engine opens sources','packagingObserver':json.loads((Path(__file__).resolve().parent/'paths.json').read_text()),'attribution':'Packaging observer is separate from the raw producer/subject/checker identities preserved in the indexed qualification/manifest/campaign members; no reattribution by compression',**before}
 index.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['source','archive','archiveBytes','archiveSha256','memberCount','memberBytes']}))

def extract(archive,index,dest,receipt):
 j=json.loads(index.read_text());assert sha(archive)==j['archiveSha256'] and archive.stat().st_size==j['archiveBytes'];assert not dest.exists() and not receipt.exists();dest.mkdir(parents=True)
 files={r['path']:r for r in j['files']};dirs=set(j['directories']);seen=set();total=0
 assert len(files)==len(j['files']) and len(dirs)==len(j['directories'])
 with tarfile.open(archive,'r:gz') as tar:
  for member in tar:
   name=member.name;safe(name);assert name not in seen,'DUPLICATE_ARCHIVE_MEMBER';seen.add(name);p=dest.joinpath(*safe(name));assert p.resolve().is_relative_to(dest.resolve())
   if member.isdir():assert name in dirs;p.mkdir(parents=True,exist_ok=True)
   else:
    assert member.isfile() and name in files,'UNDECLARED_OR_UNSAFE_MEMBER:'+name
    row=files[name];assert member.size==row['bytes'];p.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256();n=0
    with tar.extractfile(member) as src,p.open('xb') as dst:
     while data:=src.read(1024*1024):h.update(data);dst.write(data);n+=len(data)
    assert n==row['bytes'] and h.hexdigest()==row['sha256'],'EXTRACTED_BYTES_MISMATCH:'+name;p.chmod(int(row['sourceMode'],8));total+=n
 assert seen==set(files)|dirs,'INCOMPLETE_ARCHIVE'
 after=inventory(dest);assert [(r['path'],r['bytes'],r['sha256'],r['sourceMode']) for r in after['files']]==[(r['path'],r['bytes'],r['sha256'],r['sourceMode']) for r in j['files']];assert after['directories']==j['directories'] and not after['declaredDependencySymlinks']
 result={'version':1,'extractedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':j['source'],'archive':str(archive.resolve()),'archiveSha256':j['archiveSha256'],'memberIndex':str(index.resolve()),'memberIndexSha256':sha(index),'destination':str(dest.resolve()),'verifiedFiles':len(files),'verifiedBytes':total,'declaredSymlinksNotMaterialized':j['declaredDependencySymlinks'],'status':'byte_verified_only; public readback receipt is separate'};receipt.parent.mkdir(parents=True,exist_ok=True);receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':
 mode,*args=sys.argv[1:]
 if mode=='pack' and len(args)==3:pack(*map(Path,args))
 elif mode=='extract' and len(args)==4:extract(*map(Path,args))
 else:raise SystemExit('usage: pack SOURCE ARCHIVE INDEX | extract ARCHIVE INDEX NEW_DEST RECEIPT')
