from pathlib import Path
from collections import Counter
import datetime
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

D = Path(__file__).parent
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
E = Path(json.loads((P / 'paths.json').read_text())['root'])
SOURCE = '981e234b1a0da8c72d220445daaf780b3bf65ae4'
LAB = 'd4c30329b5abe104a94e1ea050f7e4bee7fa0ec6'
cache = {}

def file_record(path):
    key = str(path.resolve())
    if key not in cache:
        assert path.is_file() and not path.is_symlink(), str(path)
        data = path.read_bytes()
        cache[key] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    return {'path': str(path), **cache[key]}

def checked(path, expected):
    record = file_record(path)
    assert all(record[k] == expected[k] for k in ['bytes', 'sha256'] if k in expected), str(path)
    return record

def counts(path, kind):
    text = path.read_text()
    xml_error = None
    if kind == 'pytest':
        try:
            ET.fromstring(text)
        except ET.ParseError as error:
            xml_error = str(error)
        header = re.search(r'<testsuite\s[^>]*', text).group(0)
        n = lambda key: int(re.search(r'\b' + key + r'="(\d+)"', header).group(1))
        total, failed, skipped = n('tests'), n('failures') + n('errors'), n('skipped')
        assert len(re.findall(r'<testcase\b', text)) == total
        result = {'passed': total - failed - skipped, 'failed': failed, 'skipped': skipped, 'total': total}
    elif kind == 'vitest':
        obj = json.loads(text)
        cases = [case for suite in obj['testResults'] for case in suite['assertionResults']]
        statuses = Counter(case['status'] for case in cases)
        result = {'passed': obj['numPassedTests'], 'failed': obj['numFailedTests'], 'skipped': obj['numPendingTests'], 'total': obj['numTotalTests']}
        assert len(cases) == result['total'] and statuses['passed'] == result['passed'] and statuses['failed'] == result['failed']
    else:
        assert kind == 'playwright'
        obj = json.loads(text)
        stats = obj['stats']
        assert not obj['errors'] and stats['flaky'] == 0
        result = {'passed': stats['expected'], 'failed': stats['unexpected'], 'skipped': stats['skipped'], 'total': stats['expected'] + stats['unexpected'] + stats['skipped']}
    assert result['passed'] + result['failed'] + result['skipped'] == result['total']
    return {'counts': result, 'xmlParseError': xml_error, 'scope': 'raw header regex plus testcase tags, not valid XML' if xml_error else 'actual raw assertions/cases'}

def receipt(name, expected):
    path = P / 'checks' / (name + '.receipt.json')
    item = json.loads(path.read_text())
    assert item['exitCode'] == expected and item['signal'] is None, name
    log = checked(P / 'checks' / (name + '.log'), {'sha256': item['logSha256']})
    return {'name': name, 'receipt': file_record(path), 'log': log, **{key: item[key] for key in ['argv', 'cwd', 'exitCode', 'signal', 'startedAt', 'finishedAt']}}

out = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'Independent read-only current R11 and genuine partial R2a artifact/result/lineage audit; no test or engine reruns and no candidate edits.', 'records': []}
for directory, release, producer_exit, stages, expected_counts in [
    ('r11', 'r1.1', 0, ('external', 'staged'), ((11, 1), (12, 0))),
    ('r2a-partial', 'r2a', 1, ('external', 'staged'), ((8, 4), (9, 3))),
]:
    root = E / directory
    q = json.loads((root / 'qualification.json').read_text())
    assert q['release'] == release and q['accepted'] is False and q['acceptedBy'] is None and q['acceptedAt'] is None
    assert q['identity']['identityStable'] is True
    assert all(q['identity'][k]['sourceCommit'] == SOURCE and q['identity'][k]['dirty'] is False for k in ['before', 'after'])
    assert q['lab']['commit'] == LAB and q['lab']['dirty'] is False and q['lab']['pin']['sourceCommit'] == SOURCE
    assert q['campaign'] is None and q['algorithm'] is None and q['performance'] is None
    refs = []
    seen = set()
    for item in q['artifacts']:
        rel = Path(item['file'])
        assert not rel.is_absolute() and '..' not in rel.parts and item['file'] not in seen
        seen.add(item['file'])
        refs.append(checked(root / rel, item))
    assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()} == seen | {'qualification.json'}
    upstream = []
    for key, location in [('r1Record', E / 'r1/qualification.json'), ('r11Record', E / 'r11/qualification.json'), ('irsimRecord', E / 'irsim/qualification.json'), ('mockRegression', E / 'mock-regression/manifest.json')]:
        if key not in q:
            continue
        embedded = checked(root / q[key]['file'], q[key])
        original = checked(location, q[key])
        assert embedded['sha256'] == original['sha256']
        upstream.append({'key': key, 'embedded': embedded, 'currentOriginal': original})
    suites = []
    for suite in q['suites']:
        assert suite['exitCode'] == 0
        checked(root / suite['log'], {'sha256': suite['logSha256']})
        checked(root / suite['result']['file'], suite['result'])
        actual = counts(root / suite['result']['file'], suite['kind'])
        assert actual['counts'] == suite['result']['summary']
        suites.append({'id': suite['id'], **actual})
    for command in q['commands']:
        assert command['exitCode'] == 0
        checked(root / command['log'], {'sha256': command['logSha256']})
    assert len(q['commands']) == 1
    if release == 'r1.1':
        assert len(suites) == 9 and len(q['cases']) == 11 and len(q['gates']) == 4 and q['notRun'] == []
        assert all(g['status'] == 'tested' and g['accepted'] is False for g in q['gates'].values())
    else:
        assert not suites and q['image'] is None and len(q['cases']) == 22 and len(q['notRun']) == 21
        assert Counter(g['status'] for g in q['gates'].values()) == {'not_run': 6, 'tested': 1, 'blocked_external': 1}
        assert q['gates']['G-REG3']['status'] == 'tested' and q['gates']['G-CLOUD1']['status'] == 'blocked_external'
        assert all(g['accepted'] is False for g in q['gates'].values())
    producer = receipt('record-' + directory, producer_exit)
    if release == 'r2a':
        assert '--skip-suites' in producer['argv']
        lines = (P / 'checks/record-r2a-partial.log').read_text().splitlines()
        result = next(json.loads(line) for line in reversed(lines) if line.startswith('{"candidateId"'))
        assert len(result['problems']) == 28 and all(problem.startswith('SUITE_MISSING:') for problem in result['problems'])
        missing = result['problems']
    else:
        missing = []
    guards = []
    for stage, expected in zip(stages, expected_counts):
        name = 'acceptance-' + directory + '-' + stage
        path = E / (name + '.json')
        obj = json.loads(path.read_text())
        actual = counts(path, 'vitest')['counts']
        assert (actual['passed'], actual['failed']) == expected and actual['skipped'] == 0
        failures = [{'name': a['fullName'], 'messages': a['failureMessages']} for s in obj['testResults'] for a in s['assertionResults'] if a['status'] == 'failed']
        guards.append({'stage': stage, 'file': file_record(path), 'counts': actual, 'failures': failures, 'ownReceipt': receipt(name, 1 if expected[1] else 0)})
    out['records'].append({'directory': directory, 'qualification': file_record(root / 'qualification.json'), 'identity': q['identity'], 'lab': q['lab'], 'cases': q['cases'], 'gates': q['gates'], 'notRun': q['notRun'], 'artifactsVerified': refs, 'artifactReferenceBytes': sum(row['bytes'] for row in refs), 'upstreamExactCopies': upstream, 'suiteResults': suites, 'producer': producer, 'missingSuiteProblems': missing, 'guards': guards})

stage_path = P / 'current-legacy-stage-r11.json'
stage = json.loads(stage_path.read_text())
copies = []
for entry in stage['copies']:
    for item in entry['files']:
        checked(Path(entry['source']) / item['path'], item)
        checked(Path(entry['destination']) / item['path'], item)
    copies.append({'source': entry['source'], 'destination': entry['destination'], 'verifiedPairs': len(entry['files']), 'bytesPerCopy': sum(item['bytes'] for item in entry['files'])})
assert sum(row['verifiedPairs'] for row in copies) == 4215
for key, expected in [('source', SOURCE), ('lab', LAB)]:
    root = stage[key]
    assert subprocess.check_output(['git', '-C', root, 'rev-parse', 'HEAD'], timeout=60).decode().strip() == expected
    assert not subprocess.check_output(['git', '-C', root, 'diff', 'HEAD', '--name-only'], timeout=60)
out['explicitDataStaging'] = {'descriptor': file_record(stage_path), 'copyPairs': copies, 'currentTrackedCodeUnchanged': True, 'scope': 'Exact code with explicit data-only untracked upstream copies, not a clean producer or portability repair.'}
default_path = P / 'r11-default-output-map.json'
mapping = json.loads(default_path.read_text())
for item in mapping['files']:
    for key in ['copy', 'retainedOriginal']:
        path = Path(mapping[key]) / item['path']
        checked(path, item)
        assert path.stat().st_mtime_ns == item['mtimeNs']
out['preservedDefaultOutput'] = {'map': file_record(default_path), 'verifiedFilesAtBothLocations': len(mapping['files'])}
out['originalGuiChain'] = receipt('gui-lineage-chain', 1)
out['limits'] = [
    'R11 software gates are tested and accepted:false; no native or physical qualification.',
    'R2a is a real skip-suites partial record, producer own1 with28missing suites; both public guards fail. Static Lab identity is not execution of skipped UI suites.',
    'Data staging closes only missing historical fixed-path lineage, never skipped-suite, gate or INT15 evidence requirements.',
    'Original orchestration incorrectly expected partial producer0 and exited1; no candidate rerun/edit follows from correcting that metadata expectation.',
    'Malformed inherited pytest XML is preserved and not claimed as standard XML validity. Point-in-time identity and reused dependencies do not prove fresh installation or host trust.',
]
target = D / 'root-final-981-d4-r11-r2a-audit.json'
assert not target.exists()
target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'audit': file_record(target), 'records': [{'directory': row['directory'], 'artifactReferences': len(row['artifactsVerified']), 'artifactBytes': row['artifactReferenceBytes'], 'suiteCounts': [s['counts'] for s in row['suiteResults']], 'guards': [g['counts'] for g in row['guards']]} for row in out['records']], 'stagedCopyPairs': sum(row['verifiedPairs'] for row in copies)}))
