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
R = E / 'r1'
SOURCE = '981e234b1a0da8c72d220445daaf780b3bf65ae4'
LAB = 'd4c30329b5abe104a94e1ea050f7e4bee7fa0ec6'
cache = {}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_record(path):
    key = str(path.resolve())
    if key not in cache:
        assert path.is_file() and not path.is_symlink(), str(path)
        data = path.read_bytes()
        cache[key] = {'bytes': len(data), 'sha256': digest(data)}
    return {'path': str(path), **cache[key]}

def checked_file(path, expected):
    row = file_record(path)
    for key in ['bytes', 'sha256']:
        if key in expected:
            assert row[key] == expected[key], (str(path), key)
    return row

def git(path, *args):
    return subprocess.check_output(['git', '-C', str(path), *args], timeout=60).decode().strip()

def counts(path, kind):
    data = path.read_text()
    xml_error = None
    if kind == 'pytest':
        try:
            ET.fromstring(data)
        except ET.ParseError as error:
            xml_error = str(error)
        header = re.search(r'<testsuite\s[^>]*', data).group(0)
        number = lambda key: int(re.search(r'\b' + key + r'="(\d+)"', header).group(1))
        total, failed, skipped = number('tests'), number('failures') + number('errors'), number('skipped')
        assert len(re.findall(r'<testcase\b', data)) == total
        result = {'passed': total - failed - skipped, 'failed': failed, 'skipped': skipped, 'total': total}
    elif kind == 'vitest':
        obj = json.loads(data)
        cases = [case for suite in obj['testResults'] for case in suite['assertionResults']]
        statuses = Counter(case['status'] for case in cases)
        result = {'passed': obj['numPassedTests'], 'failed': obj['numFailedTests'], 'skipped': obj['numPendingTests'], 'total': obj['numTotalTests']}
        assert len(cases) == result['total'] and statuses['passed'] == result['passed'] and statuses['failed'] == result['failed']
        assert result['passed'] + result['failed'] + result['skipped'] == result['total']
    elif kind == 'playwright':
        obj = json.loads(data)
        stats = obj['stats']
        assert not obj['errors'] and stats['flaky'] == 0
        result = {'passed': stats['expected'], 'failed': stats['unexpected'], 'skipped': stats['skipped'], 'total': stats['expected'] + stats['unexpected'] + stats['skipped']}
    else:
        raise AssertionError(kind)
    return {'derivedCounts': result, 'xmlParseError': xml_error, 'counterScope': 'raw header regex and testcase tags; invalid XML remains invalid' if xml_error else 'actual raw assertions/cases'}

q = json.loads((R / 'qualification.json').read_text())
assert q['release'] == 'r1' and q['accepted'] is False and q['acceptedBy'] is None and q['acceptedAt'] is None
assert q['identity']['identityStable'] is True
for boundary in ['before', 'after']:
    assert q['identity'][boundary]['sourceCommit'] == SOURCE and q['identity'][boundary]['dirty'] is False
assert q['lab']['commit'] == LAB and q['lab']['dirty'] is False and q['lab']['pin']['sourceCommit'] == SOURCE
assert len(q['gates']) == 6 and all(g['status'] == 'tested' and g['accepted'] is False for g in q['gates'].values())
assert [x['id'] for x in q['notRun']] == ['ALG04']
assert q['cases']['ALG04']['status'] == 'not_run'

artifact_rows = []
seen = set()
for item in q['artifacts']:
    rel = Path(item['file'])
    assert not rel.is_absolute() and '..' not in rel.parts and item['file'] not in seen
    seen.add(item['file'])
    assert (R / rel).resolve().is_relative_to(R.resolve())
    row = checked_file(R / rel, item)
    artifact_rows.append({'file': item['file'], 'bytes': row['bytes'], 'sha256': row['sha256']})
actual_members = {p.relative_to(R).as_posix() for p in R.rglob('*') if p.is_file()}
assert actual_members == seen | {'qualification.json'}
assert q['irsimRecord']['sha256'] == file_record(E / 'irsim/qualification.json')['sha256']
assert q['mockRegression']['sha256'] == file_record(E / 'mock-regression/manifest.json')['sha256']

primary = [file_record(R / 'qualification.json')]
suite_results = []
for suite in q['suites']:
    assert suite['exitCode'] == 0
    primary.append(checked_file(R / suite['log'], {'sha256': suite['logSha256']}))
    primary.append(checked_file(R / suite['result']['file'], suite['result']))
    derived = counts(R / suite['result']['file'], suite['kind'])
    assert derived['derivedCounts'] == suite['result']['summary'], suite['id']
    suite_results.append({'id': suite['id'], 'kind': suite['kind'], **derived})
assert len(suite_results) == 14
for command in q['commands']:
    assert command['exitCode'] == 0
    primary.append(checked_file(R / command['log'], {'sha256': command['logSha256']}))
assert len(q['commands']) == 3 and q['campaign']['exitCode'] == 0

campaign = json.loads((R / 'campaign/summary.json').read_text())
assert campaign['sourceCommit'] == SOURCE and campaign['status'] == 'completed' and campaign['complete'] is True
assert len(campaign['runs']) == 20 and all(run['result'] == 'pass' and run['evidenceAsExpected'] is True for run in campaign['runs'])
primary.append(checked_file(R / 'campaign/summary.json', q['campaign']['summary']))
assert file_record(R / 'campaign/campaign.json')['sha256'] == campaign['campaignSha256']
algorithm = json.loads((R / q['algorithm']['file']).read_text())
primary.append(checked_file(R / q['algorithm']['file'], q['algorithm']))
assert all(result['verdict'] == 'pass' for result in algorithm['results'])
performance = json.loads((R / q['performance']).read_text())
primary.append(file_record(R / q['performance']))
assert performance['workload']['ticks'] == 1500 and performance['workload']['simSeconds'] == 30
assert performance['workload']['finalStatus'] == 'running' and performance['workload']['outcome']['served'] == '0'

receipts = []
for name, expected in [('record-r1', 0), ('acceptance-r1-external', 1), ('stage-current-legacy-r1', 0), ('acceptance-r1-staged', 0)]:
    path = P / 'checks' / (name + '.receipt.json')
    receipt = json.loads(path.read_text())
    assert receipt['exitCode'] == expected and receipt['signal'] is None
    log = checked_file(P / 'checks' / (name + '.log'), {'sha256': receipt['logSha256']})
    receipts.append({'name': name, 'receipt': file_record(path), 'log': log, **{key: receipt[key] for key in ['argv', 'cwd', 'exitCode', 'signal', 'startedAt', 'finishedAt']}})
guard_results = {}
for kind, expected in [('external', (11, 1)), ('staged', (12, 0))]:
    path = E / ('acceptance-r1-' + kind + '.json')
    obj = json.loads(path.read_text())
    result = counts(path, 'vitest')['derivedCounts']
    assert (result['passed'], result['failed']) == expected and result['skipped'] == 0
    failures = [case for suite in obj['testResults'] for case in suite['assertionResults'] if case['status'] == 'failed']
    if kind == 'external':
        assert len(failures) == 1 and any('linkforge-irsim/irsim/qualification.json is not in the tree' in str(m) for m in failures[0]['failureMessages'])
    guard_results[kind] = {'file': file_record(path), 'counts': result, 'failures': failures}

staging_path = P / 'current-legacy-stage-r1.json'
staging = json.loads(staging_path.read_text())
assert staging['sourceHead'] == SOURCE and staging['labHead'] == LAB and staging['trackedCodeUnchanged'] is True
assert git(Path(staging['source']), 'rev-parse', 'HEAD') == SOURCE
assert git(Path(staging['lab']), 'rev-parse', 'HEAD') == LAB
assert not git(Path(staging['source']), 'diff', 'HEAD', '--name-only')
assert not git(Path(staging['lab']), 'diff', 'HEAD', '--name-only')
copied = []
for entry in staging['copies']:
    source, destination = Path(entry['source']), Path(entry['destination'])
    for item in entry['files']:
        rel = Path(item['path'])
        assert not rel.is_absolute() and '..' not in rel.parts
        checked_file(source / rel, item)
        checked_file(destination / rel, item)
    copied.append({'source': str(source), 'destination': str(destination), 'verifiedPairs': len(entry['files']), 'verifiedBytesPerCopy': sum(item['bytes'] for item in entry['files'])})
assert sum(item['verifiedPairs'] for item in copied) == 4191
mapping_path = P / 'r1-default-output-map.json'
mapping = json.loads(mapping_path.read_text())
for item in mapping['files']:
    for key in ['copy', 'retainedOriginal']:
        path = Path(mapping[key]) / item['path']
        checked_file(path, item)
        assert path.stat().st_mtime_ns == item['mtimeNs']

out = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Independent read-only fresh R1 raw results, complete artifact bytes, actual own exit receipts, explicit original-layout failure and data-only staged readback audit. No campaign, browser, engine, database or suite rerun.',
    'qualification': primary[0], 'identity': q['identity'], 'lab': q['lab'],
    'gates': q['gates'], 'notRun': q['notRun'], 'primaryFiles': primary,
    'artifactReferencesVerified': len(artifact_rows), 'artifactReferenceBytesVerified': sum(row['bytes'] for row in artifact_rows),
    'verifiedReferenceRowsSha256': digest(json.dumps(artifact_rows, sort_keys=True, separators=(',', ':')).encode()),
    'referenceList': 'Exact qualification.artifacts, all original paths/bytes/hashes verified; the qualification hash binds the full list.',
    'suiteResults': suite_results, 'actualRecordedCommandsExit0': len(q['suites']) + len(q['commands']) + 1,
    'algorithmCases': [{'caseId': item['caseId'], 'verdict': item['verdict']} for item in algorithm['results']],
    'campaignCases': [{key: item[key] for key in ['id', 'scenarioId', 'seed', 'repeat', 'result', 'outcome', 'evidenceComplete', 'evidenceAsExpected']} for item in campaign['runs']],
    'campaignEvidenceComplete': campaign['evidenceComplete'],
    'performance': performance, 'receipts': receipts, 'publicGuardResults': guard_results,
    'stagingDescriptor': file_record(staging_path), 'stagedCodeAttribution': {'sourceHead': SOURCE, 'labHead': LAB, 'trackedDiffEmpty': True, 'dataOnlyStaging': True},
    'copiesVerified': copied, 'defaultOutputMap': file_record(mapping_path), 'defaultOutputFilesVerifiedAtBothRetainedLocations': len(mapping['files']),
    'limits': [
        'All six software gates tested remains accepted:false; ALG04 requires an actual LinuxCNC bridge and is not_run.',
        'Original external-layout acceptance is 11pass/1fail. Staged complete unchanged acceptance is12pass/0fail from explicit data-only staged exact code, not a clean producer or arbitrary-layout portability fix.',
        'The inherited pytest hostname redaction leaves XML malformed; actual own exits, raw regex/testcase counts and public consistency are not standard XML validity.',
        'Webots performance is30sim seconds/1500ticks in50tick batches, final running/served0. It is not full-cell web performance, completed mission performance, native Linux, calibration or hardware qualification.',
        'Later stages may legitimately reuse the isolated default-output path; only its two preserved current R1 locations are verified here. Historical active-Lab default deviation remains separately disclosed.',
        'Dependency reuse and point-in-time identities do not establish fresh installation, continuous filesystem observation, host trust or human acceptance.',
    ],
}
target = D / 'root-final-981-d4-r1-audit.json'
assert not target.exists()
target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'audit': file_record(target), 'artifactReferences': len(artifact_rows), 'artifactBytes': out['artifactReferenceBytesVerified'], 'copyPairs': sum(item['verifiedPairs'] for item in copied), 'suiteCounts': [item['derivedCounts'] for item in suite_results], 'publicGuardCounts': {key: value['counts'] for key, value in guard_results.items()}}))
