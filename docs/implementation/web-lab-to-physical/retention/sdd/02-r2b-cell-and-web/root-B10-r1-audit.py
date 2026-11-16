"""Independent local fix1 byte/receipt audit; no test, database or host execution."""
from pathlib import Path
import hashlib, json, subprocess

D = Path(__file__).resolve().parent
S = D.parents[2]
L = S.parent / 'lab'
E = D / 'evidence-B10/fix1'
HEAD = 'ac9b44dc1bf01bce2406b6f91ac3e141c043c739'
LAB = '47343f930b712dd6ac64ed7cd874de3c0aca2188'

def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
def meta(p):
    b = p.read_bytes()
    return {'bytes': len(b), 'sha256': sha(b)}
def check(p, row):
    assert meta(p) == {'bytes': row['bytes'], 'sha256': row['sha256']}, str(p)
def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL)

j = read(E / 'final2-byte-attribution.json')
assert [t['head'] for t in j['trees']] == [HEAD, LAB]
patches = {}
for row, repo in zip(j['trees'], [S, L]):
    assert git(repo, 'rev-parse', 'HEAD').decode().strip() == row['head']
    assert not git(repo, 'status', '--porcelain', '--untracked-files=all')
    paths = git(repo, 'diff', '--name-only', '--no-renames', row['base'], row['head']).decode().splitlines()
    assert paths == [f['path'] for f in row['files']]
    for f in row['files']:
        check(repo / f['path'], f)
        assert (repo / f['path']).read_bytes() == git(repo, 'show', row['head'] + ':' + f['path'])
    patch = git(repo, 'diff', '--binary', '--no-renames', row['base'], row['head'])
    assert sha(patch) == row['patchSha256']
    assert patch == (E / (repo.name + '-fix1-final2.patch')).read_bytes()
    target = D / ('review-B10-r1-' + repo.name + '.diff')
    if target.exists(): assert target.read_bytes() == patch
    else: target.write_bytes(patch)
    patches[repo.name] = {'path': str(target), **meta(target), 'files': len(paths)}

X = E / 'export-final2'
m = read(X / 'manifest.json')
pin = read(L / 'config/source-runtime.lock.json')
C = L / '.runtime' / m['artifactSha256']
assert m == read(C / 'manifest.json') and m['dirty'] is False and pin['dirty'] is False
assert pin == j['pin'] and m['sourceCommit'] == pin['sourceCommit'] == HEAD
assert sha((X / 'runtime.mjs').read_bytes()) == sha((C / 'runtime.mjs').read_bytes()) == pin['artifactSha256']
closures = {}
for name, closure in [('native', m['nativeTools']), ('portable', m['portableSimulationTools']['closure'])]:
    assert sha(json.dumps(closure['files'], ensure_ascii=False, separators=(',', ':')).encode()) == closure['digest']
    for f in closure['files']: check(S / f['path'], f)
    closures[name] = {'digest': closure['digest'], 'files': len(closure['files']), 'bytes': sum(f['bytes'] for f in closure['files'])}
assert pin['portableToolsDigest'] == closures['portable']['digest']
h = hashlib.sha256()
for name in sorted(m['schemas']):
    b = (S / 'packages/contracts/schemas' / name).read_bytes()
    assert b == (X / 'schemas' / name).read_bytes() == (C / 'schemas' / name).read_bytes()
    h.update((name + '\n').encode()); h.update(b)
assert h.hexdigest() == m['schemaHash'] == pin['schemaHash']
P = E / 'package-final2'
pkg = read(P / 'r2b-campaign-package.json')
assert pkg['sourceCommit'] == HEAD and pkg['runtimeArtifactSha256'] == pin['artifactSha256']
assert pkg['schemaHash'] == pin['schemaHash'] and pkg['portableToolsDigest'] == pin['portableToolsDigest']
assert sha((P / 'r2b-campaign-package.json').read_bytes()) == j['package']['manifestSha256']
assert sha((P / 'r2b-campaign.mjs').read_bytes()) == pkg['bundleSha256'] == j['package']['bundleSha256']
assert sha((P / 'r2b-engine-inventory.py').read_bytes()) == pkg['engineObserverSha256'] == sha((S / 'scripts/native-sim/r2b-engine-inventory.py').read_bytes())
for f in pkg['inputs'] + pkg['imageFiles']: check(S / f['path'], f)
assert read(E / 'checks/checker-final2.log') == j['checker']
helpers = read(E / 'fix-helper-retention-map.json')
for f in helpers:
    check(Path(f['source']), f); check(S / f['destination'], f)
    if 'originalHistoricalSource' in f: check(Path(f['originalHistoricalSource']), f)
build = read(E / 'checks/clean-build-identity-final2.log')
assert build['labHead'] == LAB and build['sourceHead'] == build['sourceCommit'] == HEAD
assert build['sourceStatus'] == build['labStatus'] == ''
assert build['runtimeArtifact'] == pin['artifactSha256'] and build['schemaHash'] == pin['schemaHash']
assert sha(json.dumps(build['files'], separators=(',', ':'), ensure_ascii=False).encode()) == build['buildSha256']
assert {f['path'] for f in build['files']} == {str(p.relative_to(L / 'dist')) for p in (L / 'dist').rglob('*') if p.is_file()}
for f in build['files']: check(L / 'dist' / f['path'], f)

receipts = {}
for p in sorted((E / 'checks').glob('*.receipt.json')):
    name = p.name.removesuffix('.receipt.json'); r = read(p)
    log = p.with_name(name + '.log')
    assert sha(log.read_bytes()) == r['outputSha256']
    assert isinstance(r['exitCode'], int)
    receipts[name] = {**r, 'receiptSha256': sha(p.read_bytes())}
assert set(receipts) == {p.stem for p in (E / 'checks').glob('*.log')}
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
                snap = r[when]; changed = {v['path']: v['sha256'] for v in snap['changedFiles']}
                digest = changed[f['path']] if f['path'] in changed else blob_hash(repo, snap['head'], f['path'])
                if digest == f['sha256']: matches.append(name); break
        attribution[repo.name + '/' + f['path']] = {'sha256': f['sha256'], 'sameBytesAtChecks': matches}

preserved = []
for name in ['root-B10-evidence-file-index.json', 'root-B10-smoke-27d6be9-file-index.json']:
    index = read(D / name)
    for f in index['files']: check(Path(index['root']) / f['path'], f)
    preserved.append({'index': name, 'files': len(index['files']), **meta(D / name)})
before = (E / 'pre-fix1-report.md').read_bytes()
report = (D / 'task-B10-report.md').read_bytes()
assert len(before) == 21373 and sha(before) == 'b35bd23adb15ade9869c568108eae1585b4e5ac8c286acc58a0e6a55f8843e78'
assert report[:len(before)] == before and len(report) > len(before), 'complete appended fix report required'
result = {'source': HEAD, 'lab': LAB, 'clean': True, 'trees': j['trees'], 'export': str(X), 'runtimeArtifactSha256': m['artifactSha256'], 'schemaHash': m['schemaHash'], 'schemas': len(m['schemas']), 'closures': closures, 'package': j['package'], 'imageFiles': len(pkg['imageFiles']), 'checker': j['checker'], 'browserBuild': {'sha256': build['buildSha256'], 'files': len(build['files']), 'executed': False}, 'retainedHelpers': len(helpers), 'patches': patches, 'report': meta(D / 'task-B10-report.md'), 'checks': receipts, 'finalByteAttribution': attribution, 'preserved': preserved, 'limits': ['Local byte/receipt consistency only, not semantic code review or host/execution authentication.', 'Same file bytes at a check are attribution, not proof that command covered every behavior.', 'Retained i1 preload selector is post-execution attribution, not a replacement contemporaneous receipt.', 'No suite, Docker, browser, native operation or SQLite engine opened by this audit.']}
(D / 'root-B10-r1-handoff.json').write_text(json.dumps(result, indent=2) + '\n')
files = [{'path': str(p.relative_to(E)), **meta(p)} for p in sorted(E.rglob('*')) if p.is_file()]
(D / 'root-B10-r1-evidence-file-index.json').write_text(json.dumps({'root': str(E), 'files': files}, indent=2) + '\n')
print(json.dumps({'patches': patches, 'checks': len(receipts), 'report': result['report'], 'closures': closures, 'fixEvidenceFiles': len(files), 'unattributed': [p for p, r in attribution.items() if not r['sameBytesAtChecks']]}))
