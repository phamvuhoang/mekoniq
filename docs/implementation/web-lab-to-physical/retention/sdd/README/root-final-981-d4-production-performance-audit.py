from pathlib import Path, PurePosixPath
import collections
import gzip
import hashlib
import json
import math
import stat
import subprocess
import zipfile
from datetime import datetime, timezone

S = Path('/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source')
D = S / '.superpowers/sdd/README'
P = D / 'evidence-final-recording/981e234-lab-d4c3032'
E = Path('/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mekoniq-final-981-d4c3032-d1bu5pia')
R = E / 'production-performance'
I = Path('/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mekoniq-981-isolated-producer-tfpc3cp6')
SOURCE = '981e234b1a0da8c72d220445daaf780b3bf65ae4'
LAB = 'd4c30329b5abe104a94e1ea050f7e4bee7fa0ec6'
BUILD = '2c1e9f307b7727c074eb160ff396251af295a520fc7884237fd752903975212e'

def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_text())
def descriptor(p):
    assert p.is_file() and not p.is_symlink(), str(p)
    b = p.read_bytes()
    return {'path': str(p), 'bytes': len(b), 'sha256': sha(b)}
def verify(row, path=None):
    got = descriptor(Path(path or row['path']))
    assert got['bytes'] == row['bytes'] and got['sha256'] == row['sha256'], str(got)
    return got
def summary(values):
    a = sorted(values)
    return {'samples': len(a), 'p50': a[math.ceil(len(a)*.5)-1] if a else None,
            'p95': a[math.ceil(len(a)*.95)-1] if a else None, 'max': a[-1] if a else None}

a = read(R / 'actual-cell-production.json')
c = a['capture']
s = read(P / 'production-performance-summary.json')
files = [verify(row) for row in s['files']]
assert {Path(x['path']).name for x in files} == {x.name for x in R.iterdir()}
receipt_path = P / 'checks/production-performance.receipt.json'
receipt = read(receipt_path)
assert receipt['exitCode'] == 0 and receipt['signal'] is None
assert receipt['before']['commit'] == receipt['after']['commit'] == SOURCE
assert receipt['before']['status'] == receipt['after']['status'] == ''
assert sha((P / 'checks/production-performance.log').read_bytes()) == receipt['logSha256']
assert '--diagnostic' not in receipt['argv']
assert a['requestedDurationMs'] == 185000 and a['warmupMs'] == 5000
assert a['sourceCommit'] == SOURCE and a['selectedRate'] == 1 and a['accepted'] is False

build = read(R / 'build-identity.json')
assert build == a['buildIdentity']
assert build['labHead'] == LAB and build['sourceHead'] == build['sourceCommit'] == SOURCE
assert build['labStatus'] == build['sourceStatus'] == '' and build['buildSha256'] == BUILD
assert sha(json.dumps(build['files'], separators=(',', ':'), ensure_ascii=False).encode()) == BUILD
build_files = [verify(row, I / 'lab/dist' / row['path']) for row in build['files']]
assert len(build_files) == 200
assert sha((I / 'lab/scripts/performance-runtime-observer.mjs').read_bytes()) == a['observerSha256']
git = {}
for name, head in [('source', SOURCE), ('lab', LAB)]:
    cwd = I / name
    got = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd, text=True).strip()
    state = subprocess.check_output(['git', 'status', '--porcelain'], cwd=cwd, text=True)
    assert got == head and state == ''
    git[name] = {'head': got, 'status': state}

render = c['renderEvents']
pose = [v for n,v in enumerate(render) if n == 0 or v['worldTick'] != render[n-1]['worldTick']]
steps = [x for x in a['actions'] if x['kind'] == 'step' and c['clock']['startEpochMs'] <= x['observedAtEpochMs'] <= c['clock']['endEpochMs']]
metrics = {
    'displayRAFIntervals': summary(x['interval'] for x in c['samples']),
    'drawingRAFIntervals': summary(x['interval'] for x in c['samples'] if x['drawn']),
    'actualRenderIntervals': summary(v['atMs']-render[n-1]['atMs'] for n,v in enumerate(render) if n),
    'actualRenderDuration': summary(x['durationMs'] for x in render),
    'worldPoseUpdateIntervals': summary(v['atMs']-pose[n-1]['atMs'] for n,v in enumerate(pose) if n),
    'workerIPC': summary(x['elapsedMs'] for x in a['workerRaw']),
    'sourceStepHTTP': summary(x['responseMs'] for x in steps),
}
for k,v in metrics.items(): assert v == a[k], k
assert a['simSeconds'] == (c['endTick']-c['startTick'])*.02
assert a['achievedRate'] == a['simSeconds']/(c['elapsedMs']/1000)
assert a['wallMs'] == c['elapsedMs']
assert a['errors'] == []
pause = a['pause']
pause_click_wall = pause['clickEpochMs']-a['clock']['nodeTimeOriginEpochMs']
last_receipt = max(0, *(x['receivedAt']-pause_click_wall for x in a['actions'] if x['kind']=='step'))
assert last_receipt == pause['toLastCommittedMs']
assert all(pause[k]['tick']==4520 and pause[k]['run']['status']=='paused' and str(pause[k]['served'])=='1' for k in ['finalView','stableView','afterExportView'])
targets = {'durationMet': c['elapsedMs']>=180000 and c['activeCellMs']>=180000,
           'displayMet': metrics['actualRenderIntervals']['p95']<=33,
           'workerMet': metrics['workerIPC']['p95']<=15, 'pauseMet': last_receipt<=500}
assert targets == a['targets'] == s['targets']

http = read(R / 'http-observations.json')
assert http['actions'] == a['actions'] and http['responses'] == a['responses'] and http['errors'] == []
assert http['exports'] == a['completeExport']['publications'] and len(http['exports']) == 1
pub = http['exports'][0]
assert pub['runId'] == a['runId'] and pub['status'] == 201
releases = [r for r in http['responses'] if r['method']=='DELETE' and r.get('runId')==a['runId'] and r.get('exportId')==pub['exportId']]
assert len(releases)==1 and releases[0]['status']==200 and releases[0]['outcome']=='completed' and releases[0]['responseEnd']>=0
assert all(r['outcome']=='completed' and r['classification']=='observed' for r in http['responses'])

export = a['completeExport']
verify(export)
zip_members = []
with zipfile.ZipFile(export['path']) as z:
    names = z.namelist()
    assert len(names)==len(set(names))
    for info in z.infolist():
        path = PurePosixPath(info.filename)
        assert not path.is_absolute() and '..' not in path.parts and '\\' not in info.filename
        assert not stat.S_ISLNK(info.external_attr>>16)
        b = z.read(info)
        zip_members.append({'path': info.filename,'bytes':len(b),'sha256':sha(b)})
    manifest = json.loads(z.read('manifest.json'))
    assert manifest == pub['manifest'] and manifest['runId'] == a['runId']
    members = {x['path']: x for x in zip_members}
    assert len(manifest['assets'])==49 and len(zip_members)==50
    for asset in manifest['assets']:
        stored = members[asset['path']]
        assert stored['bytes']==asset['bytes'] and stored['sha256']==asset['sha256']
        raw = z.read(asset['path'])
        decoded = gzip.decompress(raw) if asset['encoding']=='gzip' else raw
        assert len(decoded)==asset['decodedBytes'] and sha(decoded)==asset['decodedSha256']
    assert manifest['horizon']['tick']==4515 and manifest['horizon']['tick']<=pause['lastCommittedTick']
    assert manifest['coverage']['prefixCovered'] is True and manifest['coverage']['streamFinalized'] is False
    assert manifest['provenance']['accepted'] is False and manifest['provenance']['calibration']=='not_calibrated'

observer_summary = read(R / 'observer-summary.json')
observer_kinds = collections.Counter()
observer_count = 0
observer_last = None
with (R / 'runtime-observer.ndjson').open() as f:
    for line in f:
        if not line.strip(): continue
        row = json.loads(line)
        assert not row.get('observerError')
        observer_count += 1
        observer_kinds[row.get('kind')] += 1
        observer_last = row
assert observer_last == observer_summary and observer_count == observer_summary['records']+1
assert observer_summary['overflow'] is False and observer_summary['observerFailure'] is None
assert read(R / 'cleanup.json') == {'completed': True, 'errors': []}
public = read(P / 'web-readback.json')
assert public['captureClock']==[] and public['browser']==[]
assert public['capture']['valid'] is False and public['capture']['meetsTargets'] is False
assert public['capture']['issues']==['CAPTURE_ACTIVE_DRAWING_DURATION']
assert public['capture']['metrics']['renderIntervalP95Ms']==metrics['actualRenderIntervals']['p95']
assert public['capture']['metrics']['workerP95Ms']==metrics['workerIPC']['p95']
prefix = (D / 'task-final-recording-report.md').read_bytes()[:139117]
assert sha(prefix)=='92f2bd2eba4e06d81fde7413b5d9b912ed13bc856a5364807bc6019d36c6cb2b'

audit = {'at':datetime.now(timezone.utc).isoformat(),'scope':'Independent read-only byte/metric/ZIP audit of settled producer outputs; no engine/browser rerun, no physical/native qualification, no private operational state opened.',
         'producer':{'source':SOURCE,'lab':LAB,'build':BUILD,'runId':a['runId'],'gitNow':git},
         'receipt':{k:receipt[k] for k in ['argv','cwd','startedAt','finishedAt','exitCode','signal','logSha256']},
         'files':files,'buildFilesVerified':len(build_files),'metrics':metrics,
         'capture':{k:a[k] for k in ['selectedRate','requestedDurationMs','warmupMs','wallMs','simSeconds','achievedRate','accepted','targets']},
         'pause':{k:v for k,v in pause.items() if k not in ['finalView','stableView','afterExportView']},
         'http':{'actions':len(http['actions']),'responses':len(http['responses']),'errors':http['errors'],'publicationId':pub['exportId'],'release':releases[0]},
         'zip':{'members':zip_members,'horizon':manifest['horizon'],'coverage':manifest['coverage'],'provenance':manifest['provenance']},
         'observer':{'summary':observer_summary,'lineCount':observer_count,'kindCounts':dict(observer_kinds)},
         'publicReadback':public,'publicReadbackFile':descriptor(P/'web-readback.json'),
         'cleanup':read(R/'cleanup.json'),'originalReportPrefix':{'bytes':len(prefix),'sha256':sha(prefix)},
         'readScopeNote':'A preliminary full JSON print was truncated and is not claimed as complete manual reading. Scalar/shape inspections plus these programmatic assertions cover the identified fields; bounded exploratory printers failed without changing producer inputs.'}
out = D / 'root-final-981-d4-production-performance-audit.json'
out.write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps({'result':'verified','audit':descriptor(out),'producerFiles':len(files),'buildFiles':len(build_files),'zipMembers':len(zip_members),'targets':targets,'publicCaptureValid':public['capture']['valid'],'achievedRate':a['achievedRate']}))
