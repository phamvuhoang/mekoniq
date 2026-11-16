from pathlib import Path
from collections import Counter
import base64, datetime, hashlib, json

D = Path(__file__).resolve().parent
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
E = Path(json.loads((P / 'paths.json').read_text())['root'])
F = E / 'semantic-study'
SOURCE = '981e234b1a0da8c72d220445daaf780b3bf65ae4'

def sha(b):
    return hashlib.sha256(b).hexdigest()

def desc(p):
    b = p.read_bytes()
    return {'path': str(p), 'bytes': len(b), 'sha256': sha(b)}

def read(p):
    return json.loads(p.read_text())

study = read(F / 'semantic-study.json')
inputs = read(F / 'study-input.json')
receipt = read(P / 'checks/semantic-study.receipt.json')
process = read(E / 'semantic-study-process/process.json')
tests = read(E / 'semantic-study-tests.json')
completion = read(F / 'recording-complete.json')
assert receipt['exitCode'] == 0 and receipt['signal'] is None
assert receipt['logSha256'] == desc(P / 'checks/semantic-study.log')['sha256']
for boundary in ['before', 'after']:
    assert receipt[boundary]['commit'] == SOURCE and receipt[boundary]['status'] == ''
assert process['exitCode'] == 0 and process['exitSignal'] is None
assert process['reason'] is None and process['spawnError'] is None and process['writeError'] is None
assert tests['success'] and tests['numPassedTests'] == 1
assert tests['numFailedTests'] == tests['numPendingTests'] == tests['numTodoTests'] == 0
assert study['status'] == completion['status'] == 'complete'
assert study['accepted'] is completion['accepted'] is False
assert completion['sourceCommit'] == SOURCE and study['reasonCodes'] == []
assert study['equivalence'] == inputs['equivalence']
assert study['invariantPolicy'] == inputs['invariantPolicy']
assert study['percentiles'] is None
assert Counter(x['status'] for x in study['invariants']) == {'pass': 12, 'not_run': 6}
assert len(study['runs']) == len(inputs['runs']) == 3

runs = []
for actual, embedded, tick in zip(study['runs'], inputs['runs'], [2900, 2961, 3451]):
    engine = actual['engine']
    directory = F / engine
    assert actual['reportRef'] == embedded['report']['ref']
    assert actual['artifactRefs'] == [a['ref'] for a in embedded['artifacts']]
    assert embedded['commonProjection'] == inputs['equivalence']['commonProjection']
    verified = []
    for a in [embedded['report'], *embedded['artifacts']]:
        ref = a['ref']
        rel = Path(ref['path'])
        assert not rel.is_absolute() and '..' not in rel.parts
        b = base64.b64decode(a['content'], validate=True) if a.get('encoding') == 'base64' else a['content'].encode()
        assert len(b) == ref['bytes'] and sha(b) == ref['sha256'], ref
        path = directory / ('run' if rel.parts[0] == 'evidence' else 'compiled') / rel
        if rel.as_posix() == 'report.json':
            path = directory / rel
        assert path.read_bytes() == b, path
        verified.append(desc(path))
    report = read(directory / 'report.json')
    assert report['manifest']['sourceCommit'] == SOURCE
    assert report['manifest']['runId'] == actual['runId']
    assert report['outcome']['status'] == 'completed' and report['outcome']['served'] == '1'
    assert report['outcome']['tick'] == actual['lastTick'] == tick
    assert actual['firstTick'] == 0 and actual['replay'] == {'runId': actual['runId'], 'tick': tick}
    assert report['manifest']['calibration']['status'] == 'not_calibrated'
    runs.append({'engine': engine, 'runId': actual['runId'], 'outcome': report['outcome'],
                 'sceneDigest': actual['sceneDigest'], 'modelDigest': actual['modelDigest'],
                 'verifiedFiles': verified})

files = [F / 'study-input.json', F / 'semantic-study.json', F / 'recording.json',
         F / 'recording-complete.json', E / 'semantic-study-tests.json',
         P / 'checks/semantic-study.receipt.json', P / 'checks/semantic-study.log',
         E / 'semantic-study-process/process.json', E / 'semantic-study-process/stdout.log',
         E / 'semantic-study-process/stderr.log']
audit = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'scope': 'Read-only independent audit of settled actual X01 inputs, own receipts, raw result, embedded and on-disk bytes; no engine rerun or qualification override.',
         'files': list(map(desc, files)), 'runs': runs,
         'invariants': study['invariants'], 'differences': study['differences'],
         'unsupportedDimensions': study['unsupportedDimensions'], 'limitations': study['limitations'],
         'accepted': False, 'percentiles': None,
         'verifiedReferenceCount': sum(len(x['verifiedFiles']) for x in runs),
         'verifiedReferenceBytes': sum(f['bytes'] for x in runs for f in x['verifiedFiles'])}
out = D / 'root-final-981-d4-semantic-study-audit.json'
out.write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({'audit': desc(out), 'verifiedReferences': audit['verifiedReferenceCount'],
                  'verifiedBytes': audit['verifiedReferenceBytes'],
                  'runs': [{k: x[k] for k in ['engine', 'runId', 'outcome']} for x in runs]}))
