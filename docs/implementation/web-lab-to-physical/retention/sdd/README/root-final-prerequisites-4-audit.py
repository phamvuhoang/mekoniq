"""Audit a completed correction4 handoff; never run suites, engines, or services."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess

D = Path(__file__).resolve().parent
S = D.parents[2]
L = S.parent / 'lab'
E = D / 'evidence-final-recording/fix4'
BASES = ['229efa7f565876f8f9d69634f8fbc24b9196ed3f', '45794aa8ec7eb8a19214a6e16786455f7c948bb1']

def read(path):
    return json.loads(Path(path).read_text())

def sha(data):
    return hashlib.sha256(data).hexdigest()

def meta(path):
    path = Path(path)
    assert path.is_file() and not path.is_symlink(), str(path)
    h = hashlib.sha256()
    n = 0
    with path.open('rb') as f:
        for b in iter(lambda: f.read(2**20), b''):
            h.update(b)
            n += len(b)
    return {'bytes': n, 'sha256': h.hexdigest()}

def verify(path, row):
    assert meta(path) == {k: row[k] for k in ['bytes', 'sha256']}, str(path)

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])

def changed_rows(old, new):
    a = {f['path']: f for f in old}
    b = {f['path']: f for f in new}
    return {'added': sorted(b.keys() - a.keys()), 'removed': sorted(a.keys() - b.keys()),
            'changed': sorted(k for k in a.keys() & b.keys() if a[k] != b[k])}

ap = argparse.ArgumentParser()
ap.add_argument('--source-head', required=True)
ap.add_argument('--lab-head', required=True)
ap.add_argument('--report-bytes', type=int, required=True)
ap.add_argument('--report-sha256', required=True)
ap.add_argument('--export', type=Path, required=True)
ap.add_argument('--export-copy', type=Path)
ap.add_argument('--out', type=Path, required=True)
args = ap.parse_args()
heads = [args.source_head, args.lab_head]
assert all(re.fullmatch('[0-9a-f]{40}', x) for x in heads)
out = args.out.resolve()
assert out.is_relative_to(D) and not out.exists()
out.mkdir(parents=True)
report = D / 'task-final-recording-report.md'
verify(report, {'bytes': args.report_bytes, 'sha256': args.report_sha256})
assert sha(report.read_bytes()[:82236]) == 'f776790ede1f9ffb854d4206dcdf6e983bb9da168890edf11c48905085cf2575'

repos = []
for repo, base, head in zip([S, L], BASES, heads):
    assert git(repo, 'rev-parse', 'HEAD').decode().strip() == head
    assert not git(repo, 'status', '--porcelain', '--untracked-files=all')
    assert git(repo, 'branch', '--show-current').decode().strip() == 'codex/web-lab-to-physical'
    subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', base, head], check=True)
    names = [x.decode() for x in git(repo, 'diff', '--name-only', '--no-renames', '-z', base, head).split(b'\0') if x]
    files = []
    for name in names:
        listing = git(repo, 'ls-tree', '-z', head, '--', name)
        if not listing:
            files.append({'path': name, 'deleted': True})
            continue
        left, raw_name = listing.rstrip(b'\0').split(b'\t', 1)
        mode, kind, oid = left.decode().split()
        assert raw_name.decode() == name and kind == 'blob' and mode != '120000', name
        raw = git(repo, 'show', head + ':' + name)
        row = {'path': name, 'mode': mode, 'gitBlob': oid, 'bytes': len(raw), 'sha256': sha(raw)}
        verify(repo / name, row)
        files.append(row)
    argv = ['git', '-C', str(repo), '-c', 'core.quotePath=false', 'diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '-U10', base, head]
    patch = out / (repo.name + '.diff')
    with patch.open('xb') as f:
        subprocess.run(argv, stdout=f, check=True)
    companion = out / (repo.name + '-commits-stat.txt')
    companion.write_bytes(git(repo, 'log', '--no-color', '--format=fuller', base + '..' + head) + b'\n' + git(repo, 'diff', '--stat', '--no-renames', base, head))
    repos.append({'repo': str(repo), 'base': base, 'head': head, 'tree': git(repo, 'rev-parse', head + '^{tree}').decode().strip(),
                  'patch': {'path': str(patch), 'argv': argv, **meta(patch)}, 'companion': {'path': str(companion), **meta(companion)}, 'files': files})

X = args.export.resolve()
m = read(X / 'manifest.json')
old = read(D / 'evidence-final-recording/fix3/export-final/manifest.json')
pin = read(L / 'config/source-runtime.lock.json')
C = L / '.runtime' / m['artifactSha256']
assert m == read(C / 'manifest.json')
assert m['sourceCommit'] == pin['sourceCommit'] == heads[0]
assert m['dirty'] is False and pin['dirty'] is False
assert m['artifactSha256'] == pin['artifactSha256'] == meta(X / 'runtime.mjs')['sha256']
export_files = []
for path in sorted(X.rglob('*')):
    assert not path.is_symlink(), str(path)
    if not path.is_file():
        continue
    name = path.relative_to(X).as_posix()
    row = {'path': name, **meta(path)}
    if name == 'manifest.json':
        assert (C / name).read_text() == json.dumps(m, indent=2, ensure_ascii=False) + '\n'
    else:
        verify(C / name, row)
    if args.export_copy:
        verify(args.export_copy / name, row)
    export_files.append(row)
expected_export_paths = {row['path'] for row in export_files}
for root in [C] + ([args.export_copy] if args.export_copy else []):
    assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()} == expected_export_paths
h = hashlib.sha256()
for name in sorted(m['schemas']):
    raw = (S / 'packages/contracts/schemas' / name).read_bytes()
    assert raw == (X / 'schemas' / name).read_bytes()
    h.update((name + '\n').encode())
    h.update(raw)
assert h.hexdigest() == m['schemaHash'] == pin['schemaHash']
closures = {}
for label, current, previous in [('native', m['nativeTools'], old['nativeTools']),
                                  ('portable', m['portableSimulationTools']['closure'], old['portableSimulationTools']['closure'])]:
    rows = current['files']
    assert len(rows) == len({f['path'] for f in rows})
    assert sha(json.dumps(rows, separators=(',', ':'), ensure_ascii=False).encode()) == current['digest']
    for row in rows:
        verify(S / row['path'], row)
    closures[label] = {'digest': current['digest'], 'files': len(rows), 'bytes': sum(f['bytes'] for f in rows),
                       'unchanged': current == previous, 'difference': changed_rows(previous['files'], rows)}

receipts = {}
for path in sorted((E / 'checks').glob('*.receipt.json')):
    name = path.name.removesuffix('.receipt.json')
    r = read(path)
    log = path.with_name(name + '.log')
    assert (isinstance(r['exitCode'], int) or r['signal'] is not None) and meta(log)['sha256'] == r['logSha256']
    receipts[name] = {**r, 'receipt': meta(path), 'logBytes': log.stat().st_size}
assert {p.name.removesuffix('.log') for p in (E / 'checks').glob('*.log')} == set(receipts)
cache, attribution = {}, {}
for record, root in zip(repos, [S, L]):
    for f in record['files']:
        if f.get('deleted'):
            continue
        same = []
        for name, r in receipts.items():
            if r['exitCode'] != 0 or Path(r['cwd']).resolve() != root.resolve():
                continue
            observed = []
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
                observed.append(actual)
            if observed == [f['sha256'], f['sha256']]:
                same.append(name)
        assert same, f['path']
        attribution[root.name + '/' + f['path']] = {'sha256': f['sha256'], 'sameFinalBytesAtBothCheckBoundaries': same}

preserved = []
for filename in ['previous-phase-metadata-index.json', 'previous-phase-external-index.json']:
    path = E / filename
    index = read(path)
    if isinstance(index, list):
        rows = index
        for row in rows:
            assert Path(row['path']).is_absolute()
            verify(row['path'], row)
    else:
        rows = index['files']
        root = Path(index['root'])
        for row in rows:
            verify(root / row['path'], row)
        for row in index.get('symlinks', []):
            assert os.readlink(root / row['path']) == row['target']
    preserved.append({'path': str(path), 'files': len(rows), **meta(path)})

# Read-only independent reconstruction of the full native checker graph and current blobs.
roots = ['scripts', 'packages', 'robotics', 'integrations', 'tests/fixtures', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', '.gitignore']
recorded_graph = read(E / 'checker-graph-comparison.json')
graphs = {}
for label, head in [('old', BASES[0]), ('new', heads[0])]:
    raw = git(S, 'ls-tree', '-r', '-z', '--full-tree', head, '--', *roots).decode().strip()
    rows = []
    for line in raw.split('\0'):
        if not line:
            continue
        left, name = line.split('\t', 1)
        mode, kind, blob = left.split()
        assert kind == 'blob' and mode in ['100644', '100755']
        rows.append({'path': name, 'mode': mode, 'kind': kind, 'blob': blob})
        if label == 'new':
            path = S / name
            assert path.is_file() and not path.is_symlink() and path.resolve() == path
            n = path.stat().st_size
            g = hashlib.sha1(b'blob ' + str(n).encode() + b'\0')
            with path.open('rb') as f:
                for block in iter(lambda: f.read(2**20), b''):
                    g.update(block)
            assert g.hexdigest() == blob, name
    graphs[label] = {'sourceCommit': head, 'toolSha256': sha(raw.encode()), 'files': rows}
    assert graphs[label] == recorded_graph[label]
assert [r['path'] for r in graphs['old']['files']] == [r['path'] for r in graphs['new']['files']]
checker_changed = [a['path'] for a, b in zip(graphs['new']['files'], graphs['old']['files']) if a != b]
assert checker_changed == recorded_graph['changed']
assert read(E / 'checker-identity.json') == {k: graphs['new'][k] for k in ['sourceCommit', 'toolSha256']}
checker = {'old': graphs['old']['toolSha256'], 'new': graphs['new']['toolSha256'], 'files': len(graphs['new']['files']), 'changed': checker_changed, 'currentGitBlobsVerified': True}
for repo, head in zip([S, L], heads):
    assert git(repo, 'rev-parse', 'HEAD').decode().strip() == head
    assert not git(repo, 'status', '--porcelain', '--untracked-files=all')
result = {'source': heads[0], 'lab': heads[1], 'repos': repos, 'report': meta(report), 'reportPrefix82236Verified': True,
          'export': str(X), 'exportCopy': str(args.export_copy) if args.export_copy else None, 'exportFiles': export_files,
          'rawManifestSha256': meta(X / 'manifest.json')['sha256'], 'installedManifest': {**meta(C / 'manifest.json'), 'prescribedSerializationVerified': True, 'objectMatchesExport': True}, 'runtimeArtifactSha256': m['artifactSha256'],
          'schemaHash': m['schemaHash'], 'schemas': len(m['schemas']), 'schemaListUnchanged': m['schemas'] == old['schemas'],
          'closures': closures, 'checker': checker, 'checks': receipts, 'finalByteAttribution': attribution, 'preserved': preserved,
          'limits': ['Read-only metadata/own-exit audit, no suites, services or database engine opens.',
                     'Same bytes at both check boundaries do not prove continuous immutability, semantic coverage of each file, native execution or host authenticity.',
                     'Final correction4 retention indices require separate verification against actual handoff inputs.']}
target = out / 'audit.json'
target.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'audit': str(target), **meta(target), 'source': heads[0], 'lab': heads[1], 'receipts': len(receipts),
                  'gitFiles': len(attribution), 'exportFiles': len(export_files), 'closures': closures,
                  'preservedEntries': sum(x['files'] for x in preserved)}))
