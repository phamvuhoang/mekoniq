"""Local L06 fix1 byte/receipt audit; no suites, database engine or native execution."""
from pathlib import Path
import hashlib, json, subprocess

D = Path(__file__).resolve().parent
S = D.parents[2]
L = S.parent / 'lab'
E = D / 'evidence-L06' / 'fix1'
B = D.parent / '02-r2b-cell-and-web'
HEAD = '6e5eee9d7d504b0365422eb0ef7096e74e72e210'
LAB = '283696be56bdaea1d310a1e56182f49792cf3b2c'
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
def meta(p):
    b = p.read_bytes()
    return {'bytes': len(b), 'sha256': sha(b)}
def check(p, row): assert meta(p) == {'bytes': row['bytes'], 'sha256': row['sha256']}, str(p)
def git(repo, *args): return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL)

j = read(E / 'final-byte-attribution.json')
assert [r['head'] for r in j['trees']] == [HEAD, LAB]
assert [r['base'] for r in j['trees']] == ['6bf54aa5cab5bc63bc32c1fae471606d71061a78', 'c41f715bca9c224328879b44e3cbf5a296b59e06']
patches = {}
for row, repo in zip(j['trees'], [S, L]):
    assert git(repo, 'rev-parse', 'HEAD').decode().strip() == row['head']
    assert not git(repo, 'status', '--porcelain', '--untracked-files=all')
    assert git(repo, 'branch', '--show-current').decode().strip() == 'codex/web-lab-to-physical'
    names = git(repo, 'diff', '--name-only', '--no-renames', row['base'], row['head']).decode().splitlines()
    assert names == [f['path'] for f in row['files']]
    for f in row['files']:
        check(repo / f['path'], f)
        assert (repo / f['path']).read_bytes() == git(repo, 'show', row['head'] + ':' + f['path'])
    raw = git(repo, 'diff', '--binary', '--no-renames', row['base'], row['head'])
    assert raw == (E / (repo.name + '-fix-base.patch')).read_bytes() and sha(raw) == row['patchSha256']
    target = D / ('review-L06-r1-' + repo.name + '.diff')
    if target.exists(): assert target.read_bytes() == raw
    else: target.write_bytes(raw)
    patches[repo.name] = {'path': str(target), **meta(target), 'files': len(names)}

X = E / 'export-final'; m = read(X / 'manifest.json')
pin = read(L / 'config/source-runtime.lock.json'); C = L / '.runtime' / m['artifactSha256']
assert m == read(C / 'manifest.json') and m['dirty'] is False and pin['dirty'] is False
assert pin == j['pin'] and m['sourceCommit'] == pin['sourceCommit'] == HEAD
assert sha((X / 'manifest.json').read_bytes()) == j['exportManifestSha256']
assert sha((X / 'runtime.mjs').read_bytes()) == sha((C / 'runtime.mjs').read_bytes()) == pin['artifactSha256'] == j['runtimeSha256']
oldX = B / 'evidence-B10/fix1/export-final2'; old = read(oldX / 'manifest.json')
oldC = L / '.runtime' / old['artifactSha256']
assert old == read(oldC / 'manifest.json') and sha((oldC / 'runtime.mjs').read_bytes()) == old['artifactSha256']
assert old['nativeTools'] == m['nativeTools'] and old['portableSimulationTools'] == m['portableSimulationTools']
previous = read(D / 'evidence-L06/export-final/manifest.json')
previous_cache = L / '.runtime' / previous['artifactSha256']
assert previous == read(previous_cache / 'manifest.json') and sha((previous_cache / 'runtime.mjs').read_bytes()) == previous['artifactSha256']
assert previous['nativeTools'] == m['nativeTools'] and previous['portableSimulationTools'] == m['portableSimulationTools']
closures = {}
for name, c in [('native', m['nativeTools']), ('portable', m['portableSimulationTools']['closure'])]:
    assert len(c['files']) == len({f['path'] for f in c['files']})
    assert sha(json.dumps(c['files'], separators=(',', ':'), ensure_ascii=False).encode()) == c['digest']
    for f in c['files']: check(S / f['path'], f)
    closures[name] = {'files': len(c['files']), 'bytes': sum(f['bytes'] for f in c['files']), 'digest': c['digest']}
h = hashlib.sha256()
for name in sorted(m['schemas']):
    b = (S / 'packages/contracts/schemas' / name).read_bytes()
    assert b == (X / 'schemas' / name).read_bytes() == (C / 'schemas' / name).read_bytes()
    h.update((name + '\n').encode()); h.update(b)
assert h.hexdigest() == pin['schemaHash'] == j['schemaHash'] == m['schemaHash']

receipts = {}
for p in sorted((E / 'checks').glob('*.receipt.json')):
    name = p.name.removesuffix('.receipt.json'); r = read(p)
    assert isinstance(r['exitCode'], int) and sha(p.with_name(name + '.log').read_bytes()) == r['logSha256']
    receipts[name] = {**r, 'receiptSha256': sha(p.read_bytes())}
assert set(receipts) == {p.stem for p in (E / 'checks').glob('*.log')}
index = read(E / 'check-index.json')
assert len(index) == j['checks'] == 14 and len(receipts) == 15
for row in index:
    name = Path(row['receipt']).name.removesuffix('.receipt.json'); r = receipts[name]
    for key in ['receiptSha256', 'exitCode', 'argv', 'cwd', 'logSha256']: assert row[key] == r[key]
    assert row['source'] == r['before']['commit'] and row['stableCommit'] == (r['before']['commit'] == r['after']['commit'])
assert set(receipts) - {Path(r['receipt']).name.removesuffix('.receipt.json') for r in index} == {'final-audit'}
assert read(E / 'checks/final-audit.log')['checker'] == j['checker']
cache = {}
def blob_hash(repo, head, path):
    key = (str(repo), head, path)
    if key not in cache:
        try: cache[key] = sha(git(repo, 'show', head + ':' + path))
        except subprocess.CalledProcessError: cache[key] = None
    return cache[key]
attribution = {}
for row, repo in zip(j['trees'], [S, L]):
    for f in row['files']:
        if f['path'].startswith('docs/'): continue
        matches = []
        for name, r in receipts.items():
            if r['exitCode'] != 0 or Path(r['cwd']).resolve() != repo.resolve(): continue
            for when in ['before', 'after']:
                snap = r[when]; changed = {v['path']: v['sha256'] for v in snap['changed']}
                actual = changed[f['path']] if f['path'] in changed else blob_hash(repo, snap['commit'], f['path'])
                if actual == f['sha256']: matches.append(name); break
        attribution[repo.name + '/' + f['path']] = {'sha256': f['sha256'], 'sameBytesAtChecks': matches}
preserved = []
for parent, name in [(B, 'root-B10-evidence-file-index.json'), (B, 'root-B10-r1-evidence-file-index.json'), (B, 'root-B10-smoke-27d6be9-file-index.json'), (D, 'root-L06-evidence-file-index.json')]:
    v = read(parent / name)
    for f in v['files']: check(Path(v['root']) / f['path'], f)
    preserved.append({'index': str(parent / name), 'files': len(v['files'])})
check(B / 'task-B10-report.md', read(B / 'root-B10-r1-handoff.json')['report'])
assert meta(B / 'task-B10-review-2.md') == {'bytes': 13590, 'sha256': '926f0d5266b3ab39ac020f6fed29510f85748ce5356f52eba56e665db43aed04'}
report = meta(D / 'task-L06-report.md')
assert report['bytes'] > 17523
assert sha((D / 'task-L06-report.md').read_bytes()[:17523]) == 'ed6d841eb0fddf80ba9010d7e59e82c02bcc2d9f9b33f15bbaeea0da94598165'
assert meta(D / 'task-L06-review-1.md') == {'bytes': 18482, 'sha256': '4035e927b721a4633da24f2a950e7e5eb644e4daab47affb68f1038e844c04ff'}
result = {'source': HEAD, 'lab': LAB, 'clean': True, 'trees': j['trees'], 'patches': patches, 'report': report, 'export': str(X), 'runtimeArtifactSha256': m['artifactSha256'], 'schemaHash': m['schemaHash'], 'schemas': len(m['schemas']), 'closures': closures, 'checker': j['checker'], 'checks': receipts, 'finalByteAttribution': attribution, 'preserved': preserved, 'limits': ['Byte/receipt attribution is not semantic code review, host authentication or proof that each command covered every file behavior.', 'Final audit receipt follows its 14-entry index; 15 actual check receipts exist.', 'No suites, native/browser/Docker execution or original SQLite engine opens in this audit.']}
(D / 'root-L06-r1-handoff.json').write_text(json.dumps(result, indent=2) + '\n')
files = [{'path': str(p.relative_to(E)), **meta(p)} for p in sorted(E.rglob('*')) if p.is_file()]
(D / 'root-L06-r1-evidence-file-index.json').write_text(json.dumps({'root': str(E), 'files': files}, indent=2) + '\n')
print(json.dumps({'patches': patches, 'report': report, 'receipts': len(receipts), 'closures': closures, 'newEvidenceFiles': len(files), 'preservedFiles': sum(r['files'] for r in preserved), 'unattributed': [p for p, r in attribution.items() if not r['sameBytesAtChecks']]}))
