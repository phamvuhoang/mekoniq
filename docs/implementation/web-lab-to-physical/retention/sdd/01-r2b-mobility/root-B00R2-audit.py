import pathlib, json, subprocess, hashlib

root = pathlib.Path(__file__).resolve().parents[3]
lab = root.parent / 'lab'
out = pathlib.Path(__file__).resolve().parent
evidence = out / 'evidence-B00R2'
result = {}

def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])

def tree(repo, ref):
    rows = {}
    for row in git(repo, 'ls-tree', '-rz', '--full-tree', ref).split(b'\0'):
        if row:
            meta, path = row.split(b'\t', 1)
            mode, kind, oid = meta.decode().split()
            rows[path.decode()] = {'mode': mode, 'kind': kind, 'object': oid}
    return rows

def file_identity(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest.hexdigest()}

for name, repo in [('source', root), ('lab', lab)]:
    inv = json.loads((evidence / f'{name}-inventory-after.json').read_text())
    refs = {'prior': inv['priorUpstream'], 'frozen': inv['frozenUpstream'], 'featureBase': inv['featureBase'], 'result': inv['resultHead']}
    trees = {key: tree(repo, ref) for key, ref in refs.items()}
    delta = {p for p in trees['prior'].keys() | trees['frozen'].keys() if trees['prior'].get(p) != trees['frozen'].get(p)}
    assert delta == {row['path'] for row in inv['changes']}
    for row in inv['changes']:
        for key, rows in trees.items():
            assert row[key] == rows.get(row['path']), (name, row['path'], key)
    features = {p for p in trees['prior'].keys() | trees['featureBase'].keys() if trees['prior'].get(p) != trees['featureBase'].get(p)}
    assert features - delta == {row['path'] for row in inv['featureOnlyPaths']}
    for row in inv['featureOnlyPaths']:
        assert row['base'] == trees['featureBase'].get(row['path'])
        assert row['result'] == trees['result'].get(row['path'])
    remaining = (trees['featureBase'].keys() | trees['result'].keys()) - delta - features
    assert all(trees['featureBase'].get(p) == trees['result'].get(p) for p in remaining)
    assert git(repo, 'rev-parse', 'HEAD').decode().strip() == refs['result']
    assert not git(repo, 'status', '--porcelain')
    assert not git(repo, 'ls-files', '-u')
    record = {'head': refs['result'], 'allInventoryRowsChecked': len(inv['changes']), 'allFeatureOnlyRowsChecked': len(inv['featureOnlyPaths']), 'inventoryMatchesGitObjects': True, 'clean': True, 'unaccountedPaths': [], 'frozenMismatches': [row['path'] for row in inv['changes'] if row['frozen'] != row['result']], 'overlaps': sorted(delta & features), 'featureOnlyChanged': [row['path'] for row in inv['featureOnlyPaths'] if row['base'] != row['result']]}
    def package(label, paths):
        path = out / f'root-B00R2-{label}.diff'
        args = ['diff', '--no-renames', '--full-index', '-U10', refs['featureBase'], refs['result'], '--', *paths]
        data = git(repo, *args)
        path.write_bytes(f'# {name} original task BASE {refs["featureBase"]} HEAD {refs["result"]}\n# Explicit paths; generated image/HTML bytes bound in full inventory.\n\n'.encode() + data)
        return {'argv': ['git', *args], **file_identity(path)}
    if name == 'source':
        platform = [row['path'] for row in inv['changes'] if not row['path'].startswith(('docs/', 'artifacts/'))]
        guide = [row['path'] for row in inv['changes'] if row['path'].startswith('artifacts/') and not row['path'].endswith(('.png', '.html'))]
        docs = [row['path'] for row in inv['changes'] if row['path'].startswith('docs/') and '/evidence/' not in row['path']]
        record['packages'] = [package('platform', platform), package('guide-editable-and-manifests', guide), package('docs', docs)]
        assert not git(repo, 'diff', refs['featureBase'], refs['result'], '--', 'packages', 'robotics', 'apps', 'integrations')
        record['runtimeTreeUnchanged'] = True
    else:
        record['packages'] = [package('lab-own-changes', record['featureOnlyChanged'])]
    record['fullStandardReviewPackage'] = file_identity(repo / '.superpowers/sdd/01-r2b-mobility' / f'review-{refs["featureBase"][:7]}..{refs["result"][:7]}.diff')
    record['fullNoRenameBinaryPatch'] = file_identity(evidence / f'{name}-original-base.diff')
    result[name] = record

export = pathlib.Path((evidence / 'export-target.txt').read_text().strip())
manifest = json.loads((export / 'manifest.json').read_text())
lock = json.loads((lab / 'config/source-runtime.lock.json').read_text())
old_lock = json.loads(git(lab, 'show', '538ba452c81005010a479f337aab0edbad6e5159:config/source-runtime.lock.json'))
new = (lab / '.runtime' / lock['artifactSha256'] / 'runtime.mjs').read_bytes()
old = (lab / '.runtime' / old_lock['artifactSha256'] / 'runtime.mjs').read_bytes()
lines = [line.decode() for line in new.splitlines() if manifest['sourceCommit'].encode() in line]
assert len(lines) == 3 and new.count(manifest['sourceCommit'].encode()) == 3
assert 'approvedCommit = ' in lines[0] and 'sourceCommit: ' in lines[1] and 'Source: ${' in lines[2]
assert new.replace(manifest['sourceCommit'].encode(), old_lock['sourceCommit'].encode()) == old
assert new == (export / 'runtime.mjs').read_bytes()
assert hashlib.sha256(new).hexdigest() == manifest['artifactSha256'] == lock['artifactSha256']
assert manifest['sourceCommit'] == result['source']['head'] == lock['sourceCommit']
assert manifest['dirty'] is False
result['runtime'] = {'currentArtifactSha256': manifest['artifactSha256'], 'previousArtifactSha256': old_lock['artifactSha256'], 'onlySourceIdentityReplacement': True, 'replacementCount': 3, 'sites': ['approvedCommit', 'startLabGateway sourceCommit', 'CLI Source display'], 'exportAndLabPinMatch': True, 'dirty': False}
result['auditCorrection'] = 'Initial inline root audit incorrectly expected one embedded source identity occurrence; actual three documented identity sites are the only byte differences. That audit failed before writing a handoff; this script is the successful retained audit, not a product fix.'
result['limitations'] = ['Git tree/blob provenance, not semantic review of inherited tick records', 'No new native/browser/cloud/container run', 'Inherited log whitespace retained; see summaries', 'Generated HTML/images exact frozen blobs; editable guide/manifests explicit review packages']
(out / 'root-B00R2-handoff.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({name: {k: v for k, v in data.items() if k not in ['packages']} for name, data in result.items() if name in ['source', 'lab', 'runtime']}, indent=2))
