from pathlib import Path
import datetime, gzip, hashlib, json, subprocess, zipfile

D = Path(__file__).resolve().parent
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
paths = json.loads((P / 'paths.json').read_text())
E = Path(paths['root'])
F = E / 'stock-launcher-web-active'
L = Path(paths['lab'])

def read(p):
    return json.loads(p.read_text())

def sha(b):
    return hashlib.sha256(b).hexdigest()

def desc(p):
    b = p.read_bytes()
    return {'path': str(p), 'bytes': len(b), 'sha256': sha(b)}

receipt = read(P / 'checks/stock-launcher-active.receipt.json')
assert receipt['exitCode'] == 0 and receipt['signal'] is None
assert receipt['logSha256'] == desc(P / 'checks/stock-launcher-active.log')['sha256']
invocation, completion, cleanup = [read(F / (n + '.json')) for n in ['invocation', 'completion', 'cleanup']]
identity = invocation['before']
assert identity == completion['before'] == completion['after']
assert identity['sourceCommit'] == paths['producerSource'] and identity['labCommit'] == paths['producerLab']
assert identity['sourceStatus'] == identity['labStatus'] == ''
assert invocation['cwd'] == str(L.resolve())
assert invocation['args'][1:4] == ['--provider', 'mujoco', '--mujoco-mobile']
assert cleanup['launcher']['code'] == 0 and cleanup['launcher']['signal'] is None
assert cleanup['deleted'] is cleanup['otherProcessesStopped'] is False
process = read(F / 'browser-process/process.json')
assert process == completion['runnerResult']
assert process['exitCode'] == 0 and process['exitSignal'] is None
assert process['spawnError'] is process['writeError'] is process['reason'] is None
result = read(F / 'browser-result.json')
assert {k: result['stats'][k] for k in ['expected', 'unexpected', 'skipped', 'flaky']} == {'expected': 1, 'unexpected': 0, 'skipped': 0, 'flaky': 0}
assert result['errors'] == []
spec = result['suites'][0]['specs'][0]
assert spec['ok'] and spec['tests'][0]['results'][0]['status'] == 'passed'
health_http, health = read(F / 'health-http.json'), read(F / 'health-body.json')
assert health_http['status'] == 200 and health_http['bodySha256'] == desc(F / 'health-body.json')['sha256']
assert health['sourceCommit'] == identity['lock']['sourceCommit'] and health['schemaHash'] == identity['lock']['schemaHash']

manifest = read(F / 'live-H7/manifest.json')
run = read(F / 'live-H7-identity.json')
assert run['accepted'] is False and run['tick'] == manifest['horizon']['tick'] == 7
assert run['runId'] == manifest['runId'] and run['manifestSha256'] == desc(F / 'live-H7/manifest.json')['sha256']
assets = []
with zipfile.ZipFile(F / 'live-H7.zip') as z:
    names = [x.filename for x in z.infolist() if not x.is_dir()]
    assert len(names) == len(set(names))
    assert set(names) == {'manifest.json', *(a['path'] for a in manifest['assets'])}
    for name in names:
        assert z.read(name) == (F / 'live-H7' / name).read_bytes(), name
    for asset in manifest['assets']:
        b = z.read(asset['path'])
        decoded = gzip.decompress(b) if asset['encoding'] == 'gzip' else b
        assert len(b) == asset['bytes'] and sha(b) == asset['sha256']
        assert len(decoded) == asset['decodedBytes'] and sha(decoded) == asset['decodedSha256']
        assets.append(asset)

dom = read(F / 'report-replay-fetched-cursor0-390-dom.json')
image = read(F / 'report-replay-fetched-cursor0-390-image.json')
assert image['domSha256'] == desc(F / 'report-replay-fetched-cursor0-390-dom.json')['sha256']
png = desc(F / 'report-replay-fetched-cursor0-390.png')
assert image['sha256'] == png['sha256'] and image['bytes'] == png['bytes']
assert dom['runId'] == image['runId'] == run['runId']
assert dom['testId'] == image['testId'] == spec['id'] and dom['topbarCount'] == 1
assert dom['viewport'] == {'width': 390, 'height': 900}
assert 'WORLD_NOT_RECORDED_IN_REPORT' in dom['html']
checked_code = []
for rel in ['scripts/start-irsim.mjs', 'tests/e2e/mujoco-cell.spec.ts', 'playwright.irsim.config.ts']:
    b = subprocess.check_output(['git', '-C', str(L), 'show', paths['producerLab'] + ':' + rel])
    assert b == (L / rel).read_bytes()
    checked_code.append({'path': rel, 'bytes': len(b), 'sha256': sha(b), 'commit': paths['producerLab']})
for name in ['before-active-stock-settlement', 'after-active-stock-settlement']:
    settlement = read(P / (name + '.json'))
    assert all(r['exitCode'] == 1 and not r['stdout'].strip() for r in settlement['ports'])
    assert all(r['exitCode'] == 0 and not r['status'] for r in settlement['repositories'])

files = [desc(p) for p in sorted(F.rglob('*')) if p.is_file()]
audit = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'scope': 'One authorized unchanged full public stock browser test from the normal clean active layout. Separate from production measurement and former failed isolated callers; no assertion/route changes.',
         'invocation': invocation, 'completion': completion, 'cleanup': cleanup,
         'receipt': desc(P / 'checks/stock-launcher-active.receipt.json'),
         'stats': result['stats'], 'checkedCode': checked_code,
         'files': files, 'run': run, 'zip': desc(F / 'live-H7.zip'),
         'verifiedZipMembers': len(names), 'verifiedAssets': assets,
         'manifestCoverage': manifest['coverage'], 'manifestProvenance': manifest['provenance'],
         'visualObservation': 'Root viewed offline-real-H7-terminal.png and live-EN-1440.png: actual early world with arm and AMR, complete offline replay at tick7/7 and a later paused live view with report panel. These images do not establish custody or served mission completion.',
         'limits': ['No production performance target, installed Linux/native or physical qualification follows.',
                    'Private operational runtime root remains outside public/archive inputs.',
                    'Earlier failed stock/setup callers and the separate diagnostic are preserved.']}
out = D / 'root-final-981-d4-stock-audit.json'
out.write_text(json.dumps(audit, indent=2) + '\n')
print(json.dumps({'audit': desc(out), 'files': len(files), 'bytes': sum(x['bytes'] for x in files),
                  'zipMembers': len(names), 'assets': len(assets), 'run': run, 'stats': result['stats']}))
