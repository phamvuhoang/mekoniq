"""Read-only artifact audit after the correction3 handoff; never executes a suite/engine."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess

D = Path(__file__).resolve().parent
S = D.parents[2]
L = S.parent / 'lab'
E = D / 'evidence-final-recording/fix3'
SOURCE = '229efa7f565876f8f9d69634f8fbc24b9196ed3f'
PREFIX_SHA = 'e9e94faa374c794ffc77c1ad68af563c4be2bedcc3a344b28177035f481ee7f7'

def read(path):
    return json.loads(Path(path).read_text())

def sha(data):
    return hashlib.sha256(data).hexdigest()

def meta(path):
    path = Path(path)
    assert path.is_file() and not path.is_symlink(), str(path)
    h = hashlib.sha256()
    size = 0
    with path.open('rb') as f:
        while block := f.read(1024 * 1024):
            size += len(block)
            h.update(block)
    return {'bytes': size, 'sha256': h.hexdigest()}

def verify(path, row):
    assert meta(path) == {k: row[k] for k in ['bytes', 'sha256']}, str(path)

def git(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo)

parser = argparse.ArgumentParser()
parser.add_argument('--report-bytes', type=int, required=True)
parser.add_argument('--report-sha256', required=True)
parser.add_argument('--lab-head', required=True)
parser.add_argument('--git-audit', type=Path, required=True)
args = parser.parse_args()
LAB = args.lab_head
assert len(LAB) == 40 and all(c in '0123456789abcdef' for c in LAB)
report = D / 'task-final-recording-report.md'
assert meta(report) == {'bytes': args.report_bytes, 'sha256': args.report_sha256}
assert sha(report.read_bytes()[:33938]) == PREFIX_SHA
assert sha(report.read_bytes()[:52888]) == '045883e6e4817032989dd56f3ddb7a52b5c7e7c82df7be4c91f19405a5e3a811'
assert report.read_bytes().startswith((E / 'report-prefix.txt').read_bytes())

trees = read(args.git_audit)
for row, root, head in zip(trees, [S, L], [SOURCE, LAB]):
    assert row['head'] == head == git(root, 'rev-parse', 'HEAD').decode().strip()
    assert row['tree'] == git(root, 'rev-parse', 'HEAD^{tree}').decode().strip()
    assert not git(root, 'status', '--porcelain', '--untracked-files=all')
    assert git(root, 'branch', '--show-current').decode().strip() == 'codex/web-lab-to-physical'
    patch = git(root, '-c', 'core.quotePath=false', 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-color', '-U10', row['base'], head)
    assert patch == Path(row['diffPath']).read_bytes()
    assert len(patch) == row['diffBytes'] and sha(patch) == row['diffSha256']
    assert git(root, 'diff', '--name-only', row['base'], head).decode().splitlines() == [x['path'] for x in row['files']]
    for f in row['files']:
        verify(root / f['path'], f)
        assert (root / f['path']).read_bytes() == git(root, 'show', head + ':' + f['path'])

external = Path(read(E / 'paths.json')['root'])
X = E / 'export-final'
m = read(X / 'manifest.json')
pin = read(L / 'config/source-runtime.lock.json')
C = L / '.runtime' / m['artifactSha256']
assert m == read(C / 'manifest.json') == read(external / 'export/manifest.json')
assert m['sourceCommit'] == pin['sourceCommit'] == SOURCE
assert m['dirty'] is False and pin['dirty'] is False
assert m['artifactSha256'] == pin['artifactSha256'] == sha((X / 'runtime.mjs').read_bytes()) == sha((C / 'runtime.mjs').read_bytes())
assert m['artifactSha256'] == '2b7ab594467fcbcb0a68fc370ee839cedacd9ea977d26859761b341cc77e613c'
assert sha((X / 'manifest.json').read_bytes()) == 'a84105bbd94b63e50c08de4b74bad6b3fdcfede0c9df13cb3854767b47fa5b59'
export_index = read(E / 'export-verification.json')
assert len(export_index['exportFiles']) == 60
for f in export_index['exportFiles']:
    verify(X / f['path'], f)
    verify(external / 'export' / f['path'], f)
assert {str(p.relative_to(X)) for p in X.rglob('*') if p.is_file()} == {f['path'] for f in export_index['exportFiles']}
previous = read(D / 'evidence-final-recording/fix2/export-final/manifest.json')
closures = {}
for label, c, old, count in [('native', m['nativeTools'], previous['nativeTools'], 226), ('portable', m['portableSimulationTools']['closure'], previous['portableSimulationTools']['closure'], 238)]:
    assert c == old
    assert len(c['files']) == count == len({f['path'] for f in c['files']})
    assert sha(json.dumps(c['files'], separators=(',', ':'), ensure_ascii=False).encode()) == c['digest']
    for f in c['files']:
        verify(S / f['path'], f)
    closures[label] = {'digest': c['digest'], 'files': count, 'bytes': sum(f['bytes'] for f in c['files']), 'unchangedFromFixBase': True}
h = hashlib.sha256()
assert len(m['schemas']) == 58 and m['schemas'] == previous['schemas']
for name in sorted(m['schemas']):
    b = (S / 'packages/contracts/schemas' / name).read_bytes()
    assert b == (X / 'schemas' / name).read_bytes() == (C / 'schemas' / name).read_bytes()
    h.update((name + '\n').encode())
    h.update(b)
assert h.hexdigest() == m['schemaHash'] == pin['schemaHash'] == export_index['schemaHash']

receipts = {}
for path in sorted((E / 'checks').glob('*.receipt.json')):
    name = path.name.removesuffix('.receipt.json')
    r = read(path)
    log = path.with_name(name + '.log')
    assert isinstance(r['exitCode'], int) and sha(log.read_bytes()) == r['logSha256']
    receipts[name] = {**r, 'receiptSha256': sha(path.read_bytes()), 'logBytes': log.stat().st_size}
assert {p.stem for p in (E / 'checks').glob('*.log')} == set(receipts)

# Attribute bytes to actual check invocations, not semantic coverage of every byte.
cache, attribution = {}, {}
for row, root in zip(trees, [S, L]):
    for f in row['files']:
        same = []
        for name, r in receipts.items():
            if r['exitCode'] != 0 or Path(r['cwd']).resolve() != root.resolve():
                continue
            for when in ['before', 'after']:
                snap = r[when]
                changed = {x['path']: x['sha256'] for x in snap['changed']}
                if f['path'] in changed:
                    actual = changed[f['path']]
                else:
                    key = (str(root), snap['commit'], f['path'])
                    if key not in cache:
                        present = git(root, 'ls-tree', '-z', snap['commit'], '--', f['path'])
                        cache[key] = sha(git(root, 'show', snap['commit'] + ':' + f['path'])) if present else None
                    actual = cache[key]
                if actual == f['sha256']:
                    same.append(name)
                    break
        assert same, f['path']
        attribution[root.name + '/' + f['path']] = {'sha256': f['sha256'], 'sameBytesAtChecks': same}

preserved = []
for name in ['previous-phase-bookkeeping-index.json', 'previous-phase-external-index.json']:
    path = E / name
    index = read(path)
    for f in index['files']:
        verify(Path(index['root']) / f['path'], f)
    for link in index.get('symlinks', []):
        assert os.readlink(Path(index['root']) / link['path']) == link['target']
    preserved.append({'path': str(path), 'files': len(index['files']), **meta(path)})

result = {'source': SOURCE, 'lab': LAB, 'trees': trees, 'clean': True, 'report': meta(report), 'export': str(X), 'externalExport': str(external / 'export'), 'exportFiles': 60, 'rawManifestSha256': sha((X / 'manifest.json').read_bytes()), 'runtimeArtifactSha256': m['artifactSha256'], 'schemaHash': m['schemaHash'], 'schemas': 58, 'closures': closures, 'checks': receipts, 'finalByteAttribution': attribution, 'preserved': preserved, 'limits': ['Metadata and retained own-exit verification only; no suites, Docker/services or database engine opens.', 'Same bytes at checks is not per-file semantic coverage, native execution or host authenticity.', 'Original full2bd failure and subsequent narrow diagnostic results retain separate scope.']}
(D / 'root-final-prerequisites-3-handoff.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'source': SOURCE, 'lab': LAB, 'report': meta(report), 'receipts': len(receipts), 'filesAttributed': len(attribution), 'closures': closures, 'preservedEntries': sum(x['files'] for x in preserved)}))
