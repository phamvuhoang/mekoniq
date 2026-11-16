from pathlib import Path
from collections import Counter
import datetime
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET

kind = sys.argv[1]
assert kind in ['r2a', 'r2b']
D = Path(__file__).parent
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
E = Path(json.loads((P / 'paths.json').read_text())['root'])
R = E / (kind + '-supplemental-current-gui')
SOURCE = '981e234b1a0da8c72d220445daaf780b3bf65ae4'
LAB = 'd4c30329b5abe104a94e1ea050f7e4bee7fa0ec6'

def file_record(path):
    assert path.is_file() and not path.is_symlink(), str(path)
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

def receipt(name, expected):
    path = P / 'checks' / (name + '.receipt.json')
    row = json.loads(path.read_text())
    assert row['exitCode'] == expected and row['signal'] is None
    assert row['before'] == row['after'] and row['before']['commit'] in [SOURCE, LAB]
    assert row['before']['status'] == '' and row['before']['changed'] == []
    log = file_record(P / 'checks' / (name + '.log'))
    assert log['sha256'] == row['logSha256']
    return {'file': file_record(path), 'log': log, **{k: row[k] for k in ['argv', 'cwd', 'startedAt', 'finishedAt', 'exitCode', 'signal', 'before', 'after']}}

def raw_result(path, format):
    text = path.read_text()
    if format == 'pytest':
        error = None
        try:
            tree = ET.fromstring(text)
        except ET.ParseError as exc:
            error = str(exc)
        header = re.search(r'<testsuite\s[^>]*', text).group(0)
        count = lambda key: int(re.search(r'\b' + key + r'="(\d+)"', header).group(1))
        total, failed, errors, skipped = count('tests'), count('failures'), count('errors'), count('skipped')
        assert len(re.findall(r'<testcase\b', text)) == total
        result = {'passed': total - failed - errors - skipped, 'failed': failed + errors, 'notRun': skipped, 'total': total, 'xmlValid': error is None, 'xmlParseError': error}
        if error is None:
            assert len(list(tree.iter('testcase'))) == total
        return result
    obj = json.loads(text)
    if format == 'vitest':
        cases = [a for suite in obj['testResults'] for a in suite['assertionResults']]
        states = Counter(case['status'] for case in cases)
        assert states['passed'] == obj['numPassedTests'] and states['failed'] == obj['numFailedTests'] and len(cases) == obj['numTotalTests']
        return {'passed': states['passed'], 'failed': states['failed'], 'notRun': len(cases) - states['passed'] - states['failed'], 'total': len(cases), 'rawStatusCounts': dict(states), 'notPassed': [{'name': a['fullName'], 'status': a['status']} for a in cases if a['status'] != 'passed']}
    assert format == 'playwright'
    cases = []
    def walk(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec['tests']:
                    cases.append({'title': spec['title'], 'expectedStatus': test['expectedStatus'], 'status': test['status'], 'resultStatuses': [r['status'] for r in test['results']]})
            walk(suite.get('suites', []))
    walk(obj['suites'])
    stats = obj['stats']
    assert not obj['errors'] and len(cases) == sum(stats[k] for k in ['expected', 'unexpected', 'skipped', 'flaky'])
    return {'passed': stats['expected'], 'failed': stats['unexpected'] + stats['flaky'], 'notRun': stats['skipped'], 'total': len(cases), 'stats': stats, 'actualCases': cases}

table = json.loads((R / 'table.json').read_text())
index = json.loads((R / 'execution-index.json').read_text())
coverage = json.loads((R / 'row-coverage.json').read_text())
assert table['sourceSha256'] == file_record(D.parents[2] / table['source'])['sha256']
ids = [row['id'] for row in table['suites']]
assert ids == [row['id'] for row in index] == coverage['ids'] and len(set(ids)) == len(ids) and coverage['exactlyOnce'] is True
assert len(ids) == (28 if kind == 'r2a' else 10)
rows = []
for definition, row in zip(table['suites'], index):
    if row.get('status') == 'not_run':
        assert row['id'] == ('rt-container' if kind == 'r2a' else 'web-container')
        assert 'Docker' in row['reason']
        rows.append(row)
        continue
    assert row['repo'] == definition['repo'] and row['kind'] == definition['kind']
    assert row['exitCode'] == 0 or kind == 'r2b' and row['id'] == 'mj-evidence' and row['exitCode'] == 1
    assert row['signal'] is None and row['actualResults']
    reports = []
    for filename in row['actualResults']:
        path = Path(filename)
        assert path.resolve().is_relative_to(R.resolve())
        reports.append({'file': file_record(path), 'actual': raw_result(path, row['kind'])})
    if row['exitCode'] == 0:
        assert all(x['actual']['failed'] == 0 for x in reports)
    default = row['defaultPreservation']
    if default:
        assert default['originalPathAbsentBeforeOwner'] is True
        for item in default['files']:
            for location in ['copy', 'retainedOriginal']:
                actual = file_record(Path(default[location]) / item['path'])
                assert actual['bytes'] == item['bytes'] and actual['sha256'] == item['sha256']
    rows.append({'id': row['id'], 'repo': row['repo'], 'kind': row['kind'], 'exitCode': row['exitCode'], 'signal': row['signal'], 'reports': reports, 'ownReceipt': receipt(kind + '-supplement-' + row['id'], row['exitCode']), 'defaultPreservation': default})
out = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'Read-only audit of exact declared supplemental table, actual own receipts/raw test results and both preserved newly owned defaults; no test rerun or qualification status splice.', 'kind': kind, 'primaryFiles': [file_record(R / name) for name in ['table.json', 'execution-index.json', 'row-coverage.json']], 'tableSource': file_record(D.parents[2] / table['source']), 'parentReceipt': receipt(kind + '-supplemental-current-gui', 0), 'rows': rows, 'totals': {'tableRows': len(rows), 'ownZeroRows': sum(row.get('exitCode') == 0 for row in rows), 'ownOneRows': sum(row.get('exitCode') == 1 for row in rows), 'notRunRows': sum(row.get('status') == 'not_run' for row in rows)}, 'limits': ['Supplemental observations never replace the genuine partial R2a record or its failed public guards.', 'Skipped individual cases and unavailable container rows remain not_run; overlapping suites and repeated invocations are not summed as unique test definitions.', 'Existing dependency reuse and sampled clean boundaries do not establish installation, native host, hardware, calibration or human acceptance.', 'Historical active default-output deviation stays disclosed separately; this audit checks only the current helper-owned copies and originals.']}
target = D / ('root-final-981-d4-' + kind + '-supplement-audit.json')
assert not target.exists()
target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'audit': file_record(target), 'totals': out['totals'], 'groups': [{'id': row['id'], 'results': [x['actual'] if row['kind'] != 'playwright' else {k: x['actual'][k] for k in ['passed', 'failed', 'notRun', 'total']} for x in row['reports']]} for row in rows if 'reports' in row]}))
