from pathlib import Path
from collections import Counter
import datetime, hashlib, json

D = Path(__file__).resolve().parent
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
E = Path(json.loads((P / 'paths.json').read_text())['root'])
OLD = Path(json.loads((P.parent / '981e234/paths.json').read_text())['root'])
F = E / 'r2b'
SOURCE = '981e234b1a0da8c72d220445daaf780b3bf65ae4'
LAB = 'd4c30329b5abe104a94e1ea050f7e4bee7fa0ec6'

def read(p):
    return json.loads(p.read_text())

def desc(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return {'path': str(p), 'bytes': p.stat().st_size, 'sha256': h.hexdigest()}

assert (P / 'dependent-r2b-completed.json').is_file()
q = read(F / 'qualification.json')
assert q['release'] == 'r2b' and q['scope'] == 'full'
assert q['accepted'] is False and q['acceptedBy'] is q['acceptedAt'] is None
assert q['identity']['identityStable'] is True
assert q['identity']['before'] == q['identity']['after']
assert q['identity']['before']['sourceCommit'] == SOURCE and q['identity']['before']['dirty'] is False
assert q['lab']['commit'] == LAB and q['lab']['dirty'] is False
assert q['lab']['pin']['sourceCommit'] == SOURCE

references = []
for ref in q['artifacts']:
    p = F / ref['file']
    assert p.resolve().is_relative_to(F.resolve()) and not p.is_symlink()
    d = desc(p)
    assert d['bytes'] == ref['bytes'] and d['sha256'] == ref['sha256'], ref
    references.append(d)
assert len(references) == 2052

copies = []
for name, original in [('r2a', E / 'r2a-partial'), ('physics', OLD / 'payload-campaign'),
                       ('cell', OLD / 'cell-campaign'), ('web', E / 'web-record')]:
    copied = F / 'inputs' / name
    original_files = {p.relative_to(original).as_posix(): p for p in original.rglob('*') if p.is_file()}
    copied_files = {p.relative_to(copied).as_posix(): p for p in copied.rglob('*') if p.is_file()}
    assert set(original_files) == set(copied_files), name
    for rel, p in original_files.items():
        a, b = desc(p), desc(copied_files[rel])
        assert a['bytes'] == b['bytes'] and a['sha256'] == b['sha256'], (name, rel)
    copies.append({'input': name, 'original': str(original), 'copied': str(copied),
                   'files': len(original_files), 'bytes': sum(p.stat().st_size for p in original_files.values())})
assert (F / 'inputs/semantic-study.json').read_bytes() == (E / 'semantic-study/study-input.json').read_bytes()

suites = []
for s in q['suites']:
    if s['id'] == 'web-container':
        assert s['exitCode'] == 2 and s['reason'] == 'IMAGE_UNBUILT' and s['result'] is None
        assert not s.get('process')
        suites.append(s)
        continue
    process = read(F / s['process'])
    assert process['exitCode'] == s['exitCode'] and process['exitSignal'] is None
    result = read(F / s['result']['file'])
    assert desc(F / s['result']['file'])['sha256'] == s['result']['sha256']
    summary = s['result']['summary']
    assert summary == {'passed': result['numPassedTests'], 'failed': result['numFailedTests'],
                       'skipped': result['numPendingTests'] + result['numTodoTests'], 'total': result['numTotalTests']}
    raw = Counter(a['status'] for f in result['testResults'] for a in f['assertionResults'])
    assert raw.get('passed', 0) == summary['passed'] and raw.get('failed', 0) == summary['failed']
    assert sum(v for k, v in raw.items() if k not in ['passed', 'failed']) == summary['skipped']
    if s['id'] == 'mj-evidence':
        assert process['exitCode'] == 1 and summary == {'passed': 10, 'failed': 0, 'skipped': 4, 'total': 14}
        assert 'OWNED_TEST_SERVICE_REQUIRED' in json.dumps(result)
    else:
        assert process['exitCode'] == 0 and summary['failed'] == summary['skipped'] == 0
    suites.append({'id': s['id'], 'exitCode': s['exitCode'], 'summary': summary, 'rawStatuses': dict(raw),
                   'process': desc(F / s['process']), 'result': desc(F / s['result']['file'])})

receipts = []
for name in ['record-r2b-full', 'readback-r2b-full', 'acceptance-r2b-full']:
    p = P / 'checks' / (name + '.receipt.json')
    r = read(p)
    assert r['exitCode'] == 1 and r['signal'] is None
    assert r['logSha256'] == desc(P / 'checks' / (name + '.log'))['sha256']
    for boundary in ['before', 'after']:
        assert r[boundary]['commit'] == SOURCE and r[boundary]['status'] == ''
    receipts.append({'name': name, 'receipt': desc(p), 'log': desc(P / 'checks' / (name + '.log')),
                     'startedAt': r['startedAt'], 'finishedAt': r['finishedAt'], 'exitCode': r['exitCode']})

assert Counter(c['status'] for c in q['cases'].values()) == {'failed': 12, 'tested': 7, 'not_run': 2}
assert {k for k, v in q['gates'].items() if v['status'] == 'tested'} == {'G-CELL1', 'G-X1'}
assert all(not v['accepted'] for v in q['gates'].values())
acceptance = read(E / 'acceptance-r2b-full.json')
audit = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'scope': 'Independent settled full R2b audit; every declared file, real input copy, raw suite and failed public own receipt retained. No producer rerun, scope reduction or status editing.',
         'qualification': desc(F / 'qualification.json'), 'identity': q['identity'], 'lab': q['lab'],
         'references': references, 'verifiedReferenceCount': len(references),
         'verifiedReferenceBytes': sum(x['bytes'] for x in references), 'inputCopies': copies,
         'semanticInput': desc(F / 'inputs/semantic-study.json'), 'suites': suites, 'receipts': receipts,
         'cases': q['cases'], 'gates': q['gates'], 'artifactDispositions': q['artifactDispositions'],
         'acceptance': {'file': desc(E / 'acceptance-r2b-full.json'),
                        'counters': {k: v for k, v in acceptance.items() if k.startswith('num')},
                        'tests': [{'name': a['fullName'], 'status': a['status'], 'failureMessages': a['failureMessages']}
                                  for f in acceptance['testResults'] for a in f['assertionResults']]}}
out = D / 'root-final-981-d4-r2b-audit.json'
out.write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({'audit': desc(out), 'refs': len(references), 'bytes': audit['verifiedReferenceBytes'],
                  'copies': copies, 'acceptance': audit['acceptance']['counters']}))
