from pathlib import Path
import datetime, hashlib, json, subprocess

D = Path(__file__).resolve().parent
S, L = D.parents[2], D.parents[2].parent / 'lab'
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
PACKAGE = D / 'final-whole-branch-package-907087c-bfde031'
R = S / 'docs/implementation/web-lab-to-physical/retention'
RAW = S / 'docs/implementation/evidence/web-lab-to-physical/final-recording'
HEADS = {'source': '907087c4f2a4d6bc1348f50177c19143d956e9d9', 'lab': 'bfde031f552c4909941beae2df8a51e3af73c23d'}
BASES = {'source': '11d25b47a18adafb88ac21adc249499109996bc5', 'lab': 'a7449541e118d01f65af0ad1466e0c963a173f3c'}
PRODUCERS = {'source': '981e234b1a0da8c72d220445daaf780b3bf65ae4', 'lab': 'd4c30329b5abe104a94e1ea050f7e4bee7fa0ec6'}

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])

def read(path):
    return json.loads(path.read_text())

def desc(path):
    b = path.read_bytes()
    return {'path': str(path), 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}

def bound_file(path, row):
    d = desc(path)
    assert d['bytes'] == row['bytes'] and d['sha256'] == row['sha256'], path
    return d

package = read(PACKAGE / 'package-index.json')
states = []
for repo in [S, L]:
    name = repo.name
    assert git(repo, 'rev-parse', 'HEAD').decode().strip() == HEADS[name]
    assert not git(repo, 'status', '--porcelain', '--untracked-files=all')
    assert git(repo, 'branch', '--show-current').decode().strip() == 'codex/web-lab-to-physical'
    for ref in [BASES[name], PRODUCERS[name]]:
        subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', ref, HEADS[name]], check=True)
    assert git(repo, 'merge-base', BASES[name], HEADS[name]).decode().strip() == BASES[name]
    post = git(repo, 'diff', '--name-only', PRODUCERS[name], HEADS[name]).decode().splitlines()
    assert all(p == 'README.md' or p.startswith('docs/') for p in post)
    states.append({'repository': str(repo), 'head': HEADS[name], 'tree': git(repo, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                   'frozenBase': BASES[name], 'producer': PRODUCERS[name], 'clean': True, 'postProducerPaths': post})
checkpoint = git(S, 'diff', '--name-only', '838ac2c3c85ce335e32869a37ae6c91cb6be4b52', HEADS['source']).decode().splitlines()
assert len(checkpoint) == 63 and all(p.startswith('docs/implementation/web-lab-to-physical/retention/') for p in checkpoint)

link = read(P / 'normal-clone-link-audit-2.json')
assert not link['failures'] and link['counts']['failed'] == 0
for row in link['documents']:
    path = S.parent / row['path']
    assert desc(path)['sha256'] == row['sha256'], path
exact = read(P / 'normal-clone-exact-ref-audit-2.json')
assert len(exact['records']) == 12 and exact['failures'] == []
for row in exact['records']:
    repo = S.parent / row['repository']
    assert row['reachable'] and all(op['exitCode'] == 0 for op in row['operations'])
    subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', row['ref'], HEADS[repo.name]], check=True)
    for op in row['operations']:
        if op['argv'][1:3] == ['cat-file', '-e']:
            git(repo, *op['argv'][1:])

matrix = {r['path']: r['after'] for r in package['repos'][0]['files'] if r['after']}
prior = read(D / 'root-final-public-archive-audit-complete121.json')
prior_archives = {Path(a['archive']['path']).name: a for a in prior['archives']}
inventory = read(RAW / 'index.json')
assert len(inventory['archives']) == len(prior_archives) == 121
archive_rows = []
for row in inventory['archives']:
    archive, index = RAW / row['publishedArchive'], RAW / row['publishedMemberIndex']
    a = prior_archives[archive.name]
    for path, expected in [(archive, a['archive']), (index, a['index'])]:
        actual = matrix[str(path.relative_to(S))]
        assert actual['bytes'] == expected['bytes'] and actual['sha256'] == expected['sha256'], path
    assert row['archiveSha256'] == a['archive']['sha256'] and row['memberIndexSha256'] == a['index']['sha256']
    archive_rows.append({'id': row['id'], 'archiveSha256': row['archiveSha256'], 'memberIndexSha256': row['memberIndexSha256']})

readable = read(R / 'full-readable-copy-map.json')
for row in readable['files']:
    bound_file(S / row['destination'], row)
initial = read(R / 'snapshots/initial-readable/location-map.json')
for row in initial['records']:
    bound_file(R / row['retainedPathFromRetention'], row)
late = read(R / 'late-root-audits/index.json')
for row in late['files']:
    bound_file(R / row['path'], row)
checks = read(R / 'publication-checks/index-2.json')
for row in checks['records']:
    bound_file(R / 'publication-checks' / row['path'], row)
report = R / 'sdd/README/task-final-recording-report.md'
assert report.read_bytes() == (D / 'task-final-recording-report.md').read_bytes()
assert desc(report)['sha256'] == '2ade80f00a46d04f29a8f55d8f3007f0fbfba13695dd8cbe618635c1e0d56984'
assert hashlib.sha256(report.read_bytes()[:150008]).hexdigest() == '78babeca1335cb43410a002b42d8df369ff52754a4853702cea715354f3a97f2'

pin = read(P / 'normal-publication-pin-checks.json')
names = ['normal-clone-links-2', 'normal-clone-exactrefs-2', 'normal-clone-retention-2', *pin['successfulReceipts']]
receipts = []
for name in names:
    rp, lp = P / 'checks' / (name + '.receipt.json'), P / 'checks' / (name + '.log')
    r = read(rp)
    assert r['exitCode'] == 0 and r['signal'] is None and r['logSha256'] == desc(lp)['sha256']
    receipts.append({'name': name, 'receipt': desc(rp), 'log': desc(lp), 'cwd': r['cwd'], 'before': r['before'], 'after': r['after']})
assert pin['pinnedSource'] == PRODUCERS['source']
assert (L / 'config/source-runtime.lock.json').read_bytes() == git(L, 'show', PRODUCERS['lab'] + ':config/source-runtime.lock.json')
assert not git(S, 'status', '--porcelain') and not git(L, 'status', '--porcelain')

audit = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'scope': 'Independent final clean handoff audit before the single whole-branch review. No suite, engine, original database or external service execution.',
         'states': states, 'checkpointPaths': checkpoint, 'packageIndex': desc(PACKAGE / 'package-index.json'),
         'reviewPassIndex': desc(PACKAGE / 'review-pass-index.json'),
         'maintainedDocumentsUnchanged': len(link['documents']), 'linksAtActualObservedHeads': link['counts'],
         'exactRefsStillReachableAtFinalHeads': len(exact['records']),
         'archivesBoundToEarlierCompleteMemberAuditAndCurrentGitBlobs': archive_rows,
         'currentReadableFiles': len(readable['files']), 'initialReadableFiles': len(initial['records']),
         'lateRootAuditFiles': len(late['files']), 'laterPublicationFiles': len(checks['records']),
         'report': desc(report), 'ownSuccessfulPublicationReceipts': receipts,
         'producerSource': PRODUCERS['source'], 'producerLab': PRODUCERS['lab'],
         'pinnedRuntime': pin['installedRuntimeArtifact'],
         'limits': ['Publication heads differ from measured producer/checker identities.',
                    'Recorded web performance, fullR2b/genuine partial failures and extracted acceptance timeout remain unmet.',
                    'Prepared Linux/native/physical/HTTPS/owned-service/image prerequisites remain separately unqualified.',
                    'Byte/hash integrity and successful local publication checks do not establish human acceptance, installed-host trust or remote hosting.']}
out = D / 'root-final-handoff-audit-907087c-bfde031.json'
out.write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({'audit': desc(out), 'maintainedDocuments': len(link['documents']),
                  'exactRefs': len(exact['records']), 'archives': len(archive_rows),
                  'currentReadable': len(readable['files']), 'initialReadable': len(initial['records']),
                  'lateRootAudits': len(late['files']), 'publicationFiles': len(checks['records']), 'receipts': len(receipts)}))
