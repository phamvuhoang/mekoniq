"""Read-only independent tar/index/source/extraction audit, run after producers settle."""
from pathlib import Path, PurePosixPath
import datetime, hashlib, json, os, stat, sys, tarfile

stage = Path(sys.argv[1]).resolve(strict=True)
out = Path(sys.argv[2])
assert not out.exists(), out

def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def descriptor(path):
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest_file(path)}

def safe_name(name):
    p = PurePosixPath(name)
    assert name and not p.is_absolute() and '..' not in p.parts and str(p) == name, name
    assert '\\' not in name and not any(ord(c) < 32 or ord(c) == 127 for c in name), name
    return name

rows = []
for index in sorted((stage / 'raw').glob('*.members.json')):
    j = json.loads(index.read_text())
    archive = stage / 'raw' / (index.name.removesuffix('.members.json') + '.tar.gz')
    assert archive.stat().st_size == j['archiveBytes']
    assert digest_file(archive) == j['archiveSha256']
    expected = {safe_name(f['path']): f for f in j['files']}
    assert len(expected) == len(j['files']) == j['memberCount']
    assert sum(f['bytes'] for f in expected.values()) == j['memberBytes']
    dirs = set(map(safe_name, j['directories']))
    links = j['declaredDependencySymlinks']
    source = Path(j['source'])
    receipt_path = stage / 'archive-receipts' / (index.name.removesuffix('.members.json') + '.extract.json')
    receipt = json.loads(receipt_path.read_text())
    assert receipt['archiveSha256'] == j['archiveSha256']
    assert receipt['memberIndexSha256'] == digest_file(index)
    assert receipt['verifiedFiles'] == len(expected)
    assert receipt['verifiedBytes'] == j['memberBytes']
    assert receipt['declaredSymlinksNotMaterialized'] == links
    extracted = Path(receipt['destination'])
    for link in links:
        path = source / safe_name(link['path'])
        assert path.is_symlink() and os.readlink(path) == link['target'], path
        assert not (extracted / link['path']).exists() and not (extracted / link['path']).is_symlink()
    seen_files, seen_dirs = set(), set()
    with tarfile.open(archive, 'r|gz') as tf:
        for member in tf:
            name = safe_name(member.name)
            assert member.uid == member.gid == member.mtime == 0, (archive, name)
            if member.isdir():
                assert name in dirs and name not in seen_dirs, (archive, name)
                seen_dirs.add(name)
                assert (extracted / name).is_dir() and not (extracted / name).is_symlink()
                continue
            assert member.isfile() and name in expected and name not in seen_files, (archive, name)
            seen_files.add(name)
            f = expected[name]
            assert member.size == f['bytes'] and member.mode == int(f['sourceMode'], 8)
            h = hashlib.sha256()
            stream = tf.extractfile(member)
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(block)
            assert h.hexdigest() == f['sha256'], (archive, name)
            for origin in [source, extracted]:
                path = origin / name
                assert not path.is_symlink() and path.is_file(), path
                st = path.stat()
                assert st.st_size == f['bytes'] and stat.S_IMODE(st.st_mode) == int(f['sourceMode'], 8), path
                assert digest_file(path) == f['sha256'], path
            assert (source / name).stat().st_mtime_ns == f['sourceMtimeNs'], (source, name)
    assert seen_files == set(expected) and seen_dirs == dirs, archive
    actual_files = {p.relative_to(extracted).as_posix() for p in extracted.rglob('*') if p.is_file()}
    actual_dirs = {p.relative_to(extracted).as_posix() for p in extracted.rglob('*') if p.is_dir()}
    assert actual_files == set(expected) and actual_dirs == dirs, extracted
    assert not any(p.is_symlink() for p in extracted.rglob('*')), extracted
    rows.append({'index': descriptor(index), 'archive': descriptor(archive),
                 'extractionReceipt': descriptor(receipt_path),
                 'source': str(source), 'extracted': str(extracted),
                 'verifiedFiles': len(expected), 'verifiedBytes': j['memberBytes'],
                 'verifiedDirectories': len(dirs), 'declaredDependencySymlinks': links})
    print(json.dumps({'verifiedArchive': archive.name, 'files': len(expected)}), flush=True)

audit = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'scope': 'All indexed public archives in this settled staging snapshot: streaming archive bytes/member integrity, exact safe name/type/neutral metadata, original source bytes/modes/mtimes, extracted bytes/modes/directories, own extraction receipt bindings. No source engine or extraction was executed.',
         'limits': 'Explicitly excluded private originals and descriptor-only symlink dependencies are not archive members. This verifies bytes and extraction, not semantic qualification or remote deployment.',
         'archives': rows,
         'totals': {'archives': len(rows), 'compressedBytes': sum(r['archive']['bytes'] for r in rows),
                    'files': sum(r['verifiedFiles'] for r in rows),
                    'uncompressedBytes': sum(r['verifiedBytes'] for r in rows)}}
out.write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({'audit': descriptor(out), 'totals': audit['totals']}))
