"""Controller read-only byte/receipt audit; no product/native execution."""
from pathlib import Path
import hashlib
import json
import subprocess

S = Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source')
L = S.parent / 'lab'
D = S / '.superpowers/sdd/03-r3-linux-readiness'
E = D / 'evidence-L03'
X = Path('/tmp/l03-runtime-2a7ec9c-20261115')
SOURCE = '2a7ec9c89935649835fc08eee4ebe81fc6190cf0'
LAB = '020b818b6ce0b813c22b8826945a917fe4017816'
BASE = '00d41e7f25ec1294b9bc8e8c81de3d8e1a869316'
def sha(b): return hashlib.sha256(b).hexdigest()
def git(repo, *args): return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()
def read(p): return json.loads(p.read_text())
def check_file(p, row):
    b = p.read_bytes()
    assert len(b) == row['bytes'] and sha(b) == row['sha256'], str(p)
    return len(b)

for repo, expected in [(S, SOURCE), (L, LAB)]:
    assert git(repo, 'rev-parse', 'HEAD') == expected
    assert not git(repo, 'status', '--porcelain')
m = read(X / 'manifest.json')
pin = read(L / 'config/source-runtime.lock.json')
cache = L / '.runtime' / m['artifactSha256']
assert m == read(cache / 'manifest.json')
assert m['sourceCommit'] == pin['sourceCommit'] == SOURCE
assert m['dirty'] is False and pin['dirty'] is False
assert sha((X / 'runtime.mjs').read_bytes()) == sha((cache / 'runtime.mjs').read_bytes()) == m['artifactSha256'] == pin['artifactSha256']
assert pin['schemaHash'] == m['schemaHash']
assert pin['portableToolsDigest'] == m['portableSimulationTools']['closure']['digest']
closures = {}
for label, c in [('native', m['nativeTools']), ('portable', m['portableSimulationTools']['closure'])]:
    assert sha(json.dumps(c['files'], separators=(',', ':'), ensure_ascii=False).encode()) == c['digest']
    assert len({f['path'] for f in c['files']}) == len(c['files'])
    total = sum(check_file(S / f['path'], f) for f in c['files'])
    closures[label] = {'files': len(c['files']), 'bytes': total, 'digest': c['digest']}
h = hashlib.sha256()
for name in sorted(m['schemas']):
    b = (S / 'packages/contracts/schemas' / name).read_bytes()
    assert b == (X / 'schemas' / name).read_bytes() == (cache / 'schemas' / name).read_bytes()
    h.update((name + '\n').encode()); h.update(b)
assert h.hexdigest() == m['schemaHash']

receipts = []
cover = {}
for name in ['final-ts', 'final-python', 'final-mapping-ts', 'final-worker-python', 'contracts-check', 'final-lint-2', 'final-typecheck-2', 'selfreview-ts', 'selfreview-python', 'selfreview-typecheck', 'selfreview-lint', 'diff-check-2', 'export', 'lab-import', 'lab-sync', 'lab-check-source', 'lab-typecheck']:
    r = read(E / (name + '.receipt.json'))
    assert r['exitCode'] == 0 and r['signal'] is None and r['error'] is None, name
    if name not in ['lab-import', 'lab-sync']:
        assert r['before'] == r['after'], name
    if name.startswith('selfreview-'):
        for path, digest in r['after']['changedFiles'].items():
            b = (S / path).read_bytes()
            if sha(b) != digest:
                assert path == 'packages/lab-runtime/src/v2/sil/xarm-mapping.ts' and sha(b + b'\n') == digest, (name, path)
                cover[path] = 'Only one trailing blank line removed after checks; diff-check-2 passed.'
            else:
                cover[path] = 'Final bytes match recorded tested working tree.'
    receipts.append({'name': name, 'exitCode': r['exitCode'], 'argv': r['argv'], 'logSha256': sha((E / (name + '.log')).read_bytes()), 'receiptSha256': sha((E / (name + '.receipt.json')).read_bytes())})

preserved = []
for index in ['root-L02-evidence-file-index.json', 'root-L02-r1-evidence-file-index.json']:
    j = read(D / index)
    for row in j['files']: check_file(Path(j['root']) / row['path'], row)
    preserved.append({'index': index, 'files': len(j['files'])})
old = read(D / 'root-L02-r1-handoff.json')
check_file(D / 'task-L02-report.md', old['report'])
for rel in ['robotics/manipulation/vendor.lock.json', 'robotics/simulation-mujoco/fixtures/xarm6-g2-v1/component.json', 'robotics/simulation-mujoco/fixtures/xarm6-g2-v1/vendor-manifest.json', 'robotics/simulation/profiles/engineering-amd64.lock.json', 'robotics/simulation/profiles/engineering-arm64.lock.json']:
    assert (S / rel).read_bytes() == subprocess.check_output(['git', '-C', str(S), 'show', BASE + ':' + rel])
vendor = read(S / 'robotics/manipulation/native-vendor.lock.json')
for f in vendor['files']:
    b = (S / 'robotics/manipulation/vendor-source' / f['path']).read_bytes()
    assert sha(b) == f['contentSha256'] and hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest() == f['gitBlobSha']
for f in vendor['descriptionParity']['files']:
    b = (S / 'robotics/catalog/documents' / f['sha256']).read_bytes()
    assert sha(b) == f['sha256'] and hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest() == f['jazzyGitBlobSha']

cases = []
for path in sorted((E / 'native-not-run').glob('*/run-manifest.json')):
    r = read(path); receipt = read(E / ('native-' + path.parent.name + '.receipt.json'))
    assert receipt['exitCode'] == 2 and receipt['signal'] is None and receipt['error'] is None
    assert receipt['before'] == receipt['after'] and receipt['before']['head'] == SOURCE and not receipt['before']['status']
    assert r['sourceCommit'] == SOURCE and r['dirty'] is False and r['accepted'] is False and r['dynamics'] == 'not_calibrated'
    assert r['motion']['status'] == 'not_run' and r['motion']['result'] == 'blocked_external' and 'OS_MISMATCH' in r['motion']['reason']
    assert r['contact']['status'] == 'not_run' and r['contact']['trialsExecuted'] == 0 and r['contact']['trialsRequired'] == 10
    assert not (path.parent / 'launch.log').exists() and not (path.parent / 'raw-bag').exists()
    for f in r['artifacts']: assert sha((path.parent / f['path']).read_bytes()) == f['sha256']
    cases.append({'case': path.parent.name, 'manifestSha256': sha(path.read_bytes()), 'exitCode': 2, 'motion': r['motion']['status'], 'contact': r['contact']['status']})
assert len(cases) == 6
files = [{'path': p.relative_to(E).as_posix(), 'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in sorted(E.rglob('*')) if p.is_file()]
(D / 'root-L03-evidence-file-index.json').write_text(json.dumps({'root': str(E), 'files': files, 'limit': 'Byte-preservation index, not native qualification.'}, indent=2) + '\n')
result = {'sourceBase': BASE, 'labBase': '82b5f92005673c99ba0d1f434ae4c512800fa75e', 'source': SOURCE, 'lab': LAB, 'sourceTree': git(S, 'rev-parse', 'HEAD^{tree}'), 'labTree': git(L, 'rev-parse', 'HEAD^{tree}'), 'clean': True, 'export': str(X), 'runtimeArtifactSha256': m['artifactSha256'], 'schemaHash': m['schemaHash'], 'schemas': len(m['schemas']), 'closures': closures, 'report': {'bytes': (D / 'task-L03-report.md').stat().st_size, 'sha256': sha((D / 'task-L03-report.md').read_bytes())}, 'checks': receipts, 'finalByteAttribution': cover, 'preservedL02': preserved, 'cases': cases, 'evidenceFiles': len(files), 'limits': ['Read-only local byte and receipt consistency; no native execution, host authenticity or effective tool Git graph attestation.', '136TS/92Python are pre-final-URI refinements; focused20/27 then13/28 receipts cover subsequent changes. Counts are overlapping, not additive.', 'Unchanged upstream snapshots and R2a locks preserved; vendor .gitattributes added after behavioral checks; only authored EOF newline changed after selfreview checks.', 'Full repository historical lint remains B10-owned. No full CI or native/hardware qualification.']}
(D / 'root-L03-handoff.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'headsClean': True, 'schemas': result['schemas'], 'closures': closures, 'cases': len(cases), 'evidenceFiles': len(files), 'report': result['report'], 'preservedL02': preserved}))
