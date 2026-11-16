"""Controller read-only byte audit; does not run a subject or validate semantics."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--handoff', type=Path, required=True)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--lab', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
root = args.handoff.resolve(strict=True)
source = git(args.source, 'rev-parse', 'HEAD')
lab = git(args.lab, 'rev-parse', 'HEAD')
assert not git(args.source, 'status', '--porcelain', '--untracked-files=all'), 'Source is dirty'
assert not git(args.lab, 'status', '--porcelain', '--untracked-files=all'), 'Lab is dirty'
manifest_path = root / 'manifest.json'
assert manifest_path.stat().st_size <= 1024 * 1024, 'Manifest exceeds audit bound'
manifest_hash = digest(manifest_path)
manifest = json.loads(manifest_path.read_text())
assert manifest['checker']['sourceCommit'] == source, 'Checker differs from audited Source'
rows = []
total = 0
for kind, refs in manifest['refs'].items():
    for ref in refs:
        relative = Path(ref['path'])
        assert not relative.is_absolute() and '..' not in relative.parts
        path = root / relative
        assert all(not parent.is_symlink() for parent in [path, *path.parents] if parent != root.parent)
        assert path.is_file() and path.resolve().is_relative_to(root)
        size = path.stat().st_size
        assert size == ref['bytes'] and size <= 64 * 1024 * 1024, ref['path']
        actual = digest(path)
        assert actual == ref['sha256'], ref['path']
        total += size
        rows.append({'kind': kind, 'path': ref['path'], 'bytes': size, 'sha256': actual})
        assert len(rows) <= 768 and total <= 256 * 1024 * 1024, 'Audit bound exceeded'
assert manifest_hash == digest(manifest_path), 'Manifest changed during audit'
assert source == git(args.source, 'rev-parse', 'HEAD') and lab == git(args.lab, 'rev-parse', 'HEAD')
assert not git(args.source, 'status', '--porcelain', '--untracked-files=all')
assert not git(args.lab, 'status', '--porcelain', '--untracked-files=all')
result = {
    'schema': 'controller-native-handoff-byte-audit/1',
    'source': source, 'lab': lab, 'clean': True,
    'handoff': str(root), 'manifestSha256': manifest_hash,
    'subject': manifest['subject'], 'checker': manifest['checker'],
    'allRefsChecked': len(rows), 'payloadBytes': total, 'refs': rows,
    'limits': ['Byte and declared identity audit only; no semantic or closure completeness claim.',
               'No subject execution, host authenticity, image-layer or native readiness proof.',
               'Historical subject and current checker/repository identities remain separate.'],
}
with args.out.open('x') as stream:
    json.dump(result, stream, indent=2)
    stream.write('\n')
print(json.dumps({'refs': len(rows), 'bytes': total, 'manifestSha256': manifest_hash, 'out': str(args.out)}))
