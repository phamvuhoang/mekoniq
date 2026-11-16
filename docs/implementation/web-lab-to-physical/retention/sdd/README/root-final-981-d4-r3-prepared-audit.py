from pathlib import Path
import datetime
import hashlib
import json
import re

D = Path(__file__).parent
E = Path('/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mekoniq-final-981-d4c3032-d1bu5pia')
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
SOURCE = '981e234b1a0da8c72d220445daaf780b3bf65ae4'
LAB = 'd4c30329b5abe104a94e1ea050f7e4bee7fa0ec6'
NATIVE = '79018e0a2601d8a27d3739751910bb392c86c2857cc39ad5fb451a977de78634'
PORTABLE = '30dc0de3e034b14593ae3629a1f247724392d950578913cacc1dd2e9ca9bc69b'
RUNTIME = '8eb11109765263e0b209ece7649bb511b8f67a0c0a035edba1d78b803d4ceec1'
SCHEMA = '0d4ae124258123d27a21b67a8441dee13d703fd5ab7596ad298bcab9233a31e5'
CHECKER = '2d911a9d0028b12d0b6360b49170d77bbbe95b8ca2feed7cf5771ac3bef07ffe'
L00 = 'd346b48d8c0af721dcfbdd3fcac6153b869d161552df9e85da197d568a28d2f3'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_record(path):
    assert path.is_file() and not path.is_symlink(), str(path)
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': digest(data)}

def receipt(name):
    path = P / 'checks' / (name + '.receipt.json')
    obj = json.loads(path.read_text())
    assert obj['exitCode'] == 0 and obj['signal'] is None, name
    log = P / 'checks' / (name + '.log')
    log_record = file_record(log)
    assert log_record['sha256'] == obj['logSha256'], name
    for boundary in ['before', 'after']:
        assert obj[boundary]['commit'] == SOURCE and obj[boundary]['status'] == '', (name, boundary)
        assert obj[boundary]['changed'] == []
    return {
        'receipt': file_record(path), 'log': log_record,
        'argv': obj['argv'], 'cwd': obj['cwd'],
        'startedAt': obj['startedAt'], 'finishedAt': obj['finishedAt'],
        'exitCode': obj['exitCode'], 'signal': obj['signal'],
        'sourceBoundaryStates': {key: obj[key] for key in ['before', 'after']},
    }, log.read_text()

out = {
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Independent read-only file/hash/recorded-result audit of all six fresh prepared R3 subjects. No engine, controller, SQLite, qualification campaign or test rerun.',
    'limits': [
        'Recorded own exits and sampled boundary identities are verified; no continuous filesystem/process observation is implied.',
        'Public reader consistency is not authorship, signature, installation or native host provenance.',
        'Prepared is not nativeReady, physical readiness, calibration or human acceptance; all native and physical cases remain not_run.',
        'Acceptance is the same 12-case file invoked separately for six supplied subjects; 72 executed occurrences are not 72 unique test definitions.',
    ],
    'profiles': [],
}
for root in sorted(E.glob('r3-*-prepared')):
    path = root / 'qualification.json'
    q = json.loads(path.read_text())
    profile = q['profile']
    assert q['release'] == 'r3' and q['scope'] == 'prepared'
    assert q['accepted'] is False and q['acceptedBy'] is None and q['acceptedAt'] is None
    assert q['dynamics'] == 'not_calibrated' and q['issues'] == []
    assert q['subject']['sourceCommit'] == SOURCE and q['subject']['labCommit'] == LAB
    assert q['subject']['schemaHash'] == SCHEMA
    assert q['subject']['portableClosureHash'] == PORTABLE
    assert q['subject']['runtimeArtifactSha256'] == RUNTIME and q['subject']['image'] is None
    assert q['subject']['nativeClosureHash'] == (NATIVE if profile == 'puma560-linuxcnc-sim' else None)
    assert q['checker'] == {'sourceCommit': SOURCE, 'toolSha256': CHECKER}
    assert q['identity']['identityStable'] is True
    for key in ['before', 'after']:
        assert q['identity'][key] == {'sourceCommit': SOURCE, 'dirty': False, 'toolClosures': {'portable': PORTABLE, 'native': NATIVE}}
    assert q['lab']['commit'] == LAB and q['lab']['dirty'] is False
    assert q['lab']['pin'] == {'sourceCommit': SOURCE, 'artifactSha256': RUNTIME, 'portableToolsDigest': PORTABLE, 'schemaHash': SCHEMA}
    assert q['campaign'] is None and q['performance'] is None
    assert q['requiredCases'] == ['DEP-PREP-01']
    assert q['levels'] == {'R3.0': 'tested', 'R3.1': 'not_run', 'R3.2': 'not_run'}
    for case, result in q['cases'].items():
        assert result['status'] == ('tested' if case == 'DEP-PREP-01' else 'not_run')
    for gate, result in q['gates'].items():
        assert result['status'] == ('tested' if gate == 'G-PREP' else 'not_run') and result['accepted'] is False
    assert q['capabilities']['preparation']['prepared'] is True
    assert q['capabilities']['preparation']['nativeReady'] is False
    assert q['capabilities']['hardware'] == 'not_run' and q['capabilities']['calibration'] == 'not_calibrated'
    refs = []
    seen = set()
    for item in q['artifacts']:
        rel = Path(item['file'])
        assert not rel.is_absolute() and '..' not in rel.parts and rel.as_posix() not in seen
        seen.add(rel.as_posix())
        target = root / rel
        assert target.resolve().is_relative_to(root.resolve())
        actual = file_record(target)
        assert actual['bytes'] == item['bytes'] and actual['sha256'] == item['sha256'], str(target)
        refs.append(actual)
    receipts = []
    for stem in ['prepare-', 'export-handoff-', 'handoff-', 'record-r3-', 'readback-r3-', 'acceptance-r3-']:
        result, log = receipt(stem + profile)
        receipts.append(result)
        if stem in ['export-handoff-', 'handoff-']:
            parsed = json.loads(log)
            assert parsed['subject'] == q['subject']
            assert parsed['prepared'] is True and parsed['nativeReady'] is False
            assert parsed['accepted'] is False and parsed['dynamics'] == 'not_calibrated'
            assert parsed['checker'] == {'sourceCommit': SOURCE, 'toolSha256': L00}
        elif stem == 'readback-r3-':
            parsed = json.loads(log)
            assert parsed['valid'] is True and parsed['accepted'] is False and parsed['issues'] == []
        elif stem == 'acceptance-r3-':
            assert re.search(r'Tests\s+12 passed \(12\)', log), profile
        elif stem == 'prepare-':
            parsed = json.loads(log)
            assert parsed['subject'] == q['subject'] and parsed['accepted'] is False
            assert parsed['execution'] == 'not_run' and parsed['nativeInventory'] == 'absent'
    out['profiles'].append({
        'qualification': file_record(path),
        'recordedFields': {key: value for key, value in q.items() if key != 'artifacts'},
        'artifactReferencesVerified': len(refs),
        'artifactReferenceBytesVerified': sum(item['bytes'] for item in refs),
        'verifiedArtifacts': refs,
        'receipts': receipts,
    })
assert len(out['profiles']) == 6
out['chainReceipt'], _ = receipt('r3-chain')
out['totals'] = {
    'profiles': len(out['profiles']),
    'artifactReferences': sum(p['artifactReferencesVerified'] for p in out['profiles']),
    'artifactReferenceBytes': sum(p['artifactReferenceBytesVerified'] for p in out['profiles']),
    'profileOwnReceipts': sum(len(p['receipts']) for p in out['profiles']),
    'chainOwnReceipts': 1,
    'nativeOrPhysicalCasesTested': 0,
    'acceptedProfiles': 0,
}
target = D / 'root-final-981-d4-r3-prepared-audit.json'
assert not target.exists(), str(target)
target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'audit': file_record(target), 'totals': out['totals']}))
