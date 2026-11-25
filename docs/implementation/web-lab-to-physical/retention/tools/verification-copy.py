"""Create a public-key verification copy of a settled CIL recording, or scan package inputs.

project SOURCE ORIGINAL_MEMBER_INDEX ORIGINAL_ARCHIVE NEW_DIRECTORY
scan PATH [PATH ...]
Requires Node for P-256 validation. SQLite files are treated only as bytes.
"""
import base64
from contextlib import contextmanager
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import stat
import subprocess
import sys
import tarfile
from zipfile import ZipFile

MIB = 1024**2
MAX_FILE = 64*MIB
MAX_INDEX = 12*MIB
MAX_FILES = 20000
MAX_RAW = 2*1024**3
MAX_EXPANDED = 8*1024**3
PUBLIC = ('kty','crv','x','y')
CASE_KEY = re.compile(r'(?:cell/[\w-]+|(?:fd01|repeat)-[\w-]+(?:/baseline)?)/run/signing-key\.json\Z')
SECRET_NAME = re.compile(r'(?:\.env(?:\..+)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx|jks|der)|(?:credentials|private[-_]key|session[-_]token)\.json)\Z',re.I)
GITHUB_PREFIXES = (b'github_pat_', b'ghp_', b'gho_', b'ghu_', b'ghs_', b'ghr_')
SECRET_HINTS = (b'token',b'password',b'credential',b'authorization',b'bearer ',b'pairing',b'cookie',
                b'secret',b'private',b'"kty"',b'"d"',b'api_key',b'apikey',b'accesskey',b'signingkey',
                b'mekoniq_lab',b'access_key',b'access-key',*GITHUB_PREFIXES,b'akia',b'asia',b'eyj')
CREDENTIAL = re.compile(
    rb"""(?:\b(?:authorization\s*[:=]\s*["']?bearer\s+|bearer\s+)(?:[a-z0-9_-]{16,})"""
    rb"""|\b(?:mekoniq_lab(?:_v2)?_session|mekoniq_lab_session_v2)\s*=\s*[a-z0-9_-]+"""
    rb"""|\bpairing\s+(?:code|token)(?:\s*\([^\r\n)]{0,80}\))?\s*[:=]\s*["']?[a-z0-9_-]+"""
    rb"""|\b(?:mekoniq_lab_access_key|lab_test_pairing_token|csrf[-_]?token|reclaim[-_]?token|session[-_]?token|pairing[-_]?(?:code|token)|access[-_]?token|refresh[-_]?token|api[-_]?key|access[-_]?key|private[-_]?key|signing[-_]?key|password|client[-_]?secret|secret[-_]?access[-_]?key|credentials|token|secret)"""
    rb"""["']?\s*[:=]\s*(?:["'][a-z0-9_+/=.-]{3,}["']|[a-z0-9_+/.-]{8,}(?=[\s,;]|$))"""
    rb"""|-----begin [^-\r\n]{0,64}private key-----|\b(?:""" + b'|'.join(GITHUB_PREFIXES) + rb""")[a-z0-9_]{20,}"""
    rb"""|\b(?:akia|asia)[a-z0-9]{16}\b|\beyj[a-z0-9_-]{8,}\.eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}"""
    rb"""|["'](?:d|dp|dq|qi)["']\s*:\s*["'][a-z0-9_+/=-]{16,}["']"""
    rb"""|["']kty["']\s*:\s*["'](?:ec|rsa|oct|okp)["'])""",re.I)


# Freeze source-code classifications to the actual historical diff bytes reviewed.
REVIEWED_PROPERTY_DIFFS = {
    'eb8457e89366eefe9c86c2c0ee339e3b60b19b25b41e49d8b11ecd8384699c74',
    'dc2475355fe2d7fe00719af1f4518bd85dadcae9f9e066d9e644bbc52ad09746',
    '082e4d8b44f4da0e051e4bb99ef10816c1ab7b155ee3d570ec0d7db210009e37',
    'ca97bc0682440d200b6b06417c1a48beb1e17f7ea9d27e2b1ac26742af24458a',
    '793ea42cb3f4842cbdb9387a8500e0b2b569299182e8aba0b3326e1bd066da7b',
}


class Refusal(Exception):
    pass


def require(value, code):
    if not value:
        raise Refusal(code)


def name_ok(name):
    require(isinstance(name,str) and len(name)<=1024 and all(
        p not in ('','.','..') and len(p)<=255 and all(ord(c)>=32 and ord(c)!=127 and c!='\\' for c in p)
        for p in name.split('/')), 'UNSAFE_MEMBER')
    require(len(name.split('/'))<=40,'UNSAFE_DEPTH')
    return name


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(obj):
    return (json.dumps(obj,indent=2,ensure_ascii=False)+'\n').encode()


def strict_json(data):
    def distinct(pairs):
        result=dict(pairs)
        require(len(result)==len(pairs),'DUPLICATE_JSON_FIELD')
        return result
    return json.loads(data,object_pairs_hook=distinct)


def path_safe(path):
    # Darwin's system-owned /tmp and /var aliases are also used by tempfile.
    path=Path(os.path.abspath(path))
    for alias in ('/tmp','/var'):
        if sys.platform=='darwin' and path.is_relative_to(alias):
            path=Path('/private')/path.relative_to('/')
            break
    for parent in (*reversed(path.parents),path):
        require(not parent.is_symlink(),'UNSAFE_SYMLINK')
    return path


@contextmanager
def directory(path):
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            next_fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd)
            fd=next_fd
        yield fd
    finally:
        os.close(fd)


@contextmanager
def regular(path,limit=MAX_FILE):
    with directory(path.parent) as parent:
        fd=os.open(path.name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW,dir_fd=parent)
    with os.fdopen(fd,'rb') as file:
        st=os.fstat(file.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_nlink==1,'UNSAFE_FILE')
        require(st.st_size<=limit,'FILE_LIMIT')
        yield file


def file_bytes(path,limit=MAX_FILE):
    with regular(path,limit) as file:
        data=file.read(limit+1)
        require(len(data)<=limit,'FILE_LIMIT')
        return data


def file_digest(path):
    with regular(path,MAX_RAW) as file:
        digest=hashlib.sha256()
        for block in iter(lambda:file.read(MIB),b''):
            digest.update(block)
        return digest.hexdigest()


def inventory(root):
    files=set()
    directories=set()
    total=0
    def visit(folder,base):
        nonlocal total
        with os.scandir(folder) as entries:
            for entry in entries:
                name=name_ok(base+entry.name)
                require(len(files)+len(directories)<MAX_FILES,'FILE_COUNT_LIMIT')
                st=entry.stat(follow_symlinks=False)
                if stat.S_ISDIR(st.st_mode):
                    directories.add(name)
                    child=os.open(entry.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=folder)
                    try:
                        visit(child,name+'/')
                    finally:
                        os.close(child)
                else:
                    require(stat.S_ISREG(st.st_mode) and st.st_nlink==1,'UNSAFE_MEMBER:'+name)
                    total+=st.st_size
                    require(total<=MAX_RAW,'RECORD_LIMIT')
                    files.add(name)
    with directory(root) as folder:
        visit(folder,'')
    return files,directories


def project_key(data):
    require(len(data)<=8192,'SIGNING_KEY_SIZE')
    try:
        key=strict_json(data)
        require(isinstance(key,dict) and set(key) in (set(PUBLIC),set((*PUBLIC,'d')))
                and key['kty']=='EC' and key['crv']=='P-256','SIGNING_KEY_SHAPE')
        for field in ('x','y',*(['d'] if 'd' in key else [])):
            value=key[field]
            require(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',value),'SIGNING_KEY_ENCODING')
            require(base64.urlsafe_b64encode(base64.urlsafe_b64decode(value+'=')).decode().rstrip('=')==value,'SIGNING_KEY_ENCODING')
        # OpenSSL checks the point and derives the matching public coordinates from the original scalar.
        verify="""const c=require('node:crypto'),k=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
        const point=Buffer.concat([Buffer.from([4]),Buffer.from(k.x,'base64url'),Buffer.from(k.y,'base64url')]);
        c.ECDH.convertKey(point,'prime256v1');if(k.d){const e=c.createECDH('prime256v1');e.setPrivateKey(Buffer.from(k.d,'base64url'));
        if(!e.getPublicKey().equals(point))process.exit(1);}"""
        proc=subprocess.run(['node','-e',verify],input=data,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
        require(proc.returncode==0,'SIGNING_KEY_INVALID')
    except (ValueError,TypeError,KeyError,RecursionError,Refusal) as exc:
        raise Refusal('SIGNING_KEY_INVALID') from exc
    return json_bytes({k:key[k] for k in PUBLIC}),'d' in key


class Scan:
    def __init__(self):
        self.members=0
        self.expanded=0
        self.scanned={}
        self.classifications=set()

    def classify(self,name,reason):
        self.classifications.add((name,self.scanned[name],reason))

    def inspect(self,name,data,level=0):
        self.members+=1
        self.expanded+=len(data)
        require(level<=4 and self.members<=MAX_FILES*3 and self.expanded<=MAX_EXPANDED,'SCAN_LIMIT')
        self.scanned[name]=sha(data)
        base=name.rsplit('/',1)[-1]
        require(not SECRET_NAME.fullmatch(base),'SENSITIVE_FILENAME:'+name)
        if base=='signing-key.json':
            require(CASE_KEY.fullmatch(name),'SENSITIVE_UNEXPECTED_SIGNING_KEY:'+name)
            _,private=project_key(data)
            require(not private,'SENSITIVE_PRIVATE_JWK:'+name)
            return
        if data.startswith(b'\x1f\x8b') or name.endswith('.gz'):
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
                raw=stream.read(MAX_FILE+1)
            require(len(raw)<=MAX_FILE,'INFLATE_LIMIT')
            self.inspect(name.removesuffix('.gz'),raw,level+1)
            return
        if data.startswith(b'PK\x03\x04') or name.lower().endswith(('.zip','.npz')):
            with ZipFile(io.BytesIO(data)) as archive:
                infos=archive.infolist()
                require(len(infos)<=MAX_FILES and sum(i.file_size for i in infos)<=MAX_RAW,'ZIP_LIMIT')
                seen=set()
                for item in infos:
                    member=name_ok(item.filename.rstrip('/'))
                    require(member not in seen and not item.flag_bits&1 and stat.S_IFMT(item.external_attr>>16) in (0,stat.S_IFREG,stat.S_IFDIR),'UNSAFE_ZIP_MEMBER')
                    seen.add(member)
                    require(item.file_size<=MAX_FILE,'ZIP_MEMBER_LIMIT')
                    if not item.is_dir():
                        self.inspect(name+'/'+member,archive.read(item),level+1)
            return
        sqlite=data.startswith(b'SQLite format 3\0')
        if sqlite:
            # SQL rows can span SQLite pages. Open only a read-only scratch copy of the settled bytes.
            with tempfile.TemporaryDirectory() as scratch:
                database=Path(scratch)/'evidence.sqlite'
                database.write_bytes(data)
                db=sqlite3.connect(database.as_uri()+'?mode=ro&immutable=1',uri=True)
                try:
                    db.execute('PRAGMA trusted_schema=OFF')
                    db.execute('PRAGMA query_only=ON')
                    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,MAX_FILE)
                    tables=db.execute('PRAGMA table_list').fetchall()
                    require(len(tables)<=100 and all(t[2] in ('table','view') for t in tables),'SQLITE_TABLE_LIMIT')
                    count=0
                    for schema,table,kind,*_ in tables:
                        if schema!='main' or kind!='table' or table.startswith('sqlite_'):
                            continue
                        require(re.fullmatch(r'[a-zA-Z_][a-zA-Z_0-9]*',table),'UNSAFE_SQLITE_TABLE')
                        for row in db.execute('SELECT * FROM "'+table+'"'):
                            count+=1
                            require(count<=250000,'SQLITE_ROW_LIMIT')
                            for value in row:
                                if isinstance(value,(str,bytes)):
                                    field=value.encode() if isinstance(value,str) else value
                                    self.text(name,field)
                finally:
                    db.close()
        self.text(name,data,sqlite)

    def text(self,name,data,sqlite=False):
        # Decode common embedded JSON escaping even in logs and SQLite text columns.
        if b'\\' in data:
            for _ in range(5):
                plain=data.replace(b'\\\\',b'\\').replace(b'\\"',b'"')
                if b'\\u00' in plain:
                    plain=re.sub(rb'\\u00([0-9a-fA-F]{2})',lambda m:bytes([int(m[1],16)]),plain)
                if plain==data:
                    break
                data=plain
        lower=data.lower()
        if b'"kty"' in lower:
            # Signed device-registration events retain public verification coordinates in their SQLite rows.
            def embedded_public(match):
                try:
                    doc=strict_json(match[0])
                except (ValueError,RecursionError):
                    return match[0]
                if isinstance(doc,dict) and set(doc)==set(PUBLIC) and doc['kty']=='EC' and doc['crv']=='P-256' and all(
                        isinstance(doc[k],str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',doc[k]) for k in ('x','y')):
                    self.classify(name,'public P-256 coordinates in device registration')
                    return b'{}'
                return match[0]
            data=re.sub(rb'\{[^{}]{0,600}"kty"[^{}]{0,600}\}',embedded_public,data)
        if any(marker in lower for marker in SECRET_HINTS):
            for match in CREDENTIAL.finditer(data):
                # A public point may straddle raw SQLite pages. The complete row was checked above.
                if sqlite and re.fullmatch(rb'"kty"\s*:\s*"EC"',match[0]):
                    self.classify(name,'SQLite page fragment of public device registration; complete rows scanned separately')
                    continue
                # Archived source diffs can assign a bearer variable from an environment or session property.
                if self.scanned[name] in REVIEWED_PROPERTY_DIFFS and re.fullmatch(
                    rb'(?:token|sessionToken|reclaimToken|accessKey)\s*[:=]\s*(?:\+\+)?[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+',match[0]):
                    self.classify(name,'source expression reads a property or increments a counter')
                    continue
                if self.scanned[name]=='082e4d8b44f4da0e051e4bb99ef10816c1ab7b155ee3d570ec0d7db210009e37' and match[0].startswith(b'reclaimToken:') and data[match.end():match.end()+2]==b'+i':
                    self.classify(name,'reviewed unit-test diff constructs a synthetic counter in a stubbed fetch response')
                    continue
                raise Refusal('SENSITIVE_CONTENT:'+name)


class LimitedTarInfo(tarfile.TarInfo):
    def _proc_member(self,tar):
        require(0<=self.size<=MAX_FILE,'TAR_MEMBER_LIMIT')
        if self.type not in (tarfile.REGTYPE,tarfile.AREGTYPE,tarfile.DIRTYPE):
            require(self.type in (tarfile.XHDTYPE,tarfile.GNUTYPE_LONGNAME) and self.size<=16384,'UNSAFE_TAR_HEADER')
        return super()._proc_member(tar)


def scan_path(path):
    path=path_safe(path)
    auditor=Scan()
    if path.is_dir():
        files,_=inventory(path)
        for name in sorted(files):
            auditor.inspect(name,file_bytes(path_safe(path/name)))
    elif path.name.endswith(('.tar.gz','.tgz')):
        # tarfile handles metadata internally. Bound the whole inflated stream before parsing headers.
        with regular(path,MAX_RAW) as raw,gzip.GzipFile(fileobj=raw) as zipped,tarfile.open(fileobj=zipped,mode='r|',tarinfo=LimitedTarInfo) as tar:
            seen=set()
            for member in tar:
                name=name_ok(member.name)
                require(name not in seen and len(seen)<MAX_FILES and zipped.tell()<=MAX_RAW,'TAR_LIMIT')
                seen.add(name)
                require(member.isfile() or member.isdir(),'UNSAFE_TAR_MEMBER')
                if member.isfile():
                    require(0<=member.size<=MAX_FILE,'TAR_MEMBER_LIMIT')
                    auditor.inspect(name,tar.extractfile(member).read())
    else:
        auditor.inspect(path.name,file_bytes(path))
    return dict(path=str(path),scannedMembers=auditor.members,scannedBytesIncludingExpanded=auditor.expanded,
                members=[dict(path=name,sha256=digest) for name,digest in sorted(auditor.scanned.items())],
                classifications=[dict(path=name,sha256=digest,reason=reason) for name,digest,reason in sorted(auditor.classifications)])


def project(source,index,archive,out):
    source,index,archive,out=map(path_safe,(source,index,archive,out))
    require(source.is_dir() and not out.is_relative_to(source) and not out.exists(),'UNSAFE_DESTINATION')
    index_data=file_bytes(index,MAX_INDEX)
    record=strict_json(index_data)
    require(Path(record['source']).resolve()==source and Path(record['archive']).name==archive.name and
            record['archiveSha256']==file_digest(archive) and not record['declaredDependencySymlinks'],'ORIGINAL_REFERENCE')
    before={name_ok(f['path']):f for f in record['files']}
    dirs={name_ok(d) for d in record['directories']}
    files,actual_dirs=inventory(source)
    require(len(before)==len(record['files']) and len(dirs)==len(record['directories']) and files==set(before)
            and dirs==actual_dirs and 'verification-copy.json' not in files,'ORIGINAL_INVENTORY')
    require(strict_json(file_bytes(source/'campaign.json',MIB))['campaign']['id'] in ('cil-v1','cil-v2'),'CIL_REQUIRED')
    auditor=Scan()
    members={}
    out.mkdir(mode=0o700)
    try:
        for directory in sorted(dirs):
            (out/directory).mkdir(mode=0o700)
        cases=[]
        sums=[]
        keys=set()
        def put(name,data,reason):
            (out/name).write_bytes(data)
            row=before[name]
            members[name]=dict(path=name,originalBytes=row['bytes'],originalSha256=row['sha256'],
                               projectedBytes=len(data),projectedSha256=sha(data),reason=reason)
        def original(name):
            data=file_bytes(path_safe(source/name))
            require(len(data)==before[name]['bytes'] and sha(data)==before[name]['sha256'],'ORIGINAL_MEMBER_MISMATCH:'+name)
            return data
        for name in sorted(files):
            data=original(name)
            if name.rsplit('/',1)[-1]=='signing-key.json':
                require(CASE_KEY.fullmatch(name),'SENSITIVE_UNEXPECTED_SIGNING_KEY:'+name)
                public,_=project_key(data)
                put(name,public,'public P-256 verification fields only')
                keys.add(name)
            else:
                auditor.inspect(name,data)
                if name.endswith('/case.json'):
                    cases.append(name)
                elif name.rsplit('/',1)[-1]=='SHA256SUMS':
                    sums.append(name)
                else:
                    put(name,data,'unchanged')
        covered=set()
        for name in sorted(cases,key=lambda n:-n.count('/')):
            data=original(name)
            case=strict_json(data)
            parent=name[:-len('case.json')]
            expected={n for n in files if n.startswith(parent) and n!=name}
            found=set()
            for row in case['artifacts']:
                rel=parent+name_ok(row['path'])
                require(rel in expected and rel not in found and rel in members,'CASE_INVENTORY:'+name)
                item=members[rel]
                require(row['bytes']==item['originalBytes'] and row['sha256']==item['originalSha256'],'CASE_INVENTORY:'+name)
                row.update(bytes=item['projectedBytes'],sha256=item['projectedSha256'])
                found.add(rel)
            require(expected==found,'CASE_INVENTORY:'+name)
            covered.update(found)
            put(name,json_bytes(case) if found&keys else data,'rebuild key-dependent case inventory' if found&keys else 'unchanged')
        require(keys and keys<=covered,'SIGNING_KEY_OUTSIDE_CASE_INVENTORY')
        for name in sorted(sums,key=lambda n:-n.count('/')):
            parent=name[:-len('SHA256SUMS')]
            lines=[]
            seen=set()
            for line in original(name).decode().splitlines():
                old,rel=line.split('  ',1)
                path=parent+name_ok(rel)
                require(path in members and path not in seen and old==members[path]['originalSha256'],'CHECKSUM_INVENTORY:'+name)
                seen.add(path)
                lines.append(members[path]['projectedSha256']+'  '+rel+'\n')
            require(seen=={p for p in files if p.startswith(parent) and p!=name},'CHECKSUM_COVERAGE:'+name)
            put(name,''.join(lines).encode(),'rebuild member checksums')
        receipt=dict(version=1,kind='public-key verification copy',accepted=False,
            originalArchive=archive.name,originalArchiveSha256=record['archiveSha256'],
            originalMemberIndex=index.name,originalMemberIndexSha256=sha(index_data),
            sourceRecord=source.name,publicKeyCount=len(keys),
            representation='Journal and execution bytes retained. Private signing fields removed. Case inventories and original checksum lists resealed. Transport member index covers this added provenance file.',
            members=[members[name] for name in sorted(files)])
        (out/'verification-copy.json').write_bytes(json_bytes(receipt))
        return dict(output=str(out),publicKeys=len(keys),mappedMembers=len(files),provenanceSha256=file_digest(out/'verification-copy.json'))
    except BaseException:
        shutil.rmtree(out)
        raise


def main(argv):
    if argv[:1]==['project'] and len(argv)==5:
        return project(*argv[1:])
    if argv[:1]==['scan'] and len(argv)>1:
        return [scan_path(p) for p in argv[1:]]
    raise Refusal('USAGE: project SOURCE ORIGINAL_INDEX ORIGINAL_ARCHIVE NEW_DIR | scan PATH ...')


if __name__=='__main__':
    try:
        print(json.dumps(main(sys.argv[1:]),indent=2))
    except Exception as exc:
        # An input parser may include the offending source bytes in its message.
        print(str(exc) if isinstance(exc,Refusal) else 'MALFORMED_INPUT:'+type(exc).__name__,file=sys.stderr)
        sys.exit(1)
