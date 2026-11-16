from pathlib import Path
import json, hashlib, datetime, collections, xml.etree.ElementTree as ET

D=Path(__file__).resolve().parent
P=D/'evidence-final-recording/981e234-lab-d4c3032'
E=Path('/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/mekoniq-final-981-d4c3032-d1bu5pia/mock-regression')
m=json.loads((E/'manifest.json').read_text())
def sha(b): return hashlib.sha256(b).hexdigest()
def info(p):
    b=p.read_bytes()
    return {'path':str(p),'bytes':len(b),'sha256':sha(b)}
def checked(rel,digest,role):
    p=E/rel
    assert p.is_file() and not p.is_symlink(),rel
    x=info(p)
    assert x['sha256']==digest,rel
    return {'role':role,**x}

assert m['schema']=='lab-v2-regression/1' and m['suite']=='physical-robot-lab'
assert m['revisions']=={'source':'981e234b1a0da8c72d220445daaf780b3bf65ae4','sourceDirty':False,'lab':'d4c30329b5abe104a94e1ea050f7e4bee7fa0ec6','labDirty':False}
i=m['identity']
assert i['start']==i['end'] and len(i['checkpoints'])==36
for row in i['checkpoints']: assert row['identity']==i['start']
for name in ['source','lab']:
    assert i['start'][name]['commit']==m['revisions'][name] and i['start'][name]['dirtyCodePaths']==[]
verified=[];derived=[];skips=[]
assert len(m['commands'])==18 and len(m['runs'])==20 and len(m['artifacts'])==77
for cmd in m['commands']:
    assert cmd['exitCode']==0
    verified.append(checked(cmd['log'],cmd['logSha256'],'command-log:'+cmd['id']))
for row in m['runs']:
    assert row['exitCode']==0
    verified.append(checked(row['file'],row['sha256'],'run:'+row['id']))
    p=E/row['file'];kind=row['kind']
    if kind=='vitest':
        x=json.loads(p.read_text())
        tests=[a for result in x['testResults'] for a in result['assertionResults']]
        counts=collections.Counter(a['status'] for a in tests)
        assert set(counts)<=set(['passed','failed','pending','todo','skipped']),row['id']
        got={'passed':counts['passed'],'failed':counts['failed'],'skipped':sum(counts[k] for k in ['pending','todo','skipped']),'total':len(tests)}
        assert got==row['summary'] and x['success'] is True,row['id']
        for a in tests:
            if a['status'] in ['pending','todo','skipped']:
                skips.append({'run':row['id'],'name':a['fullName'],'rawStatus':a['status']})
    elif kind=='junit':
        x=ET.parse(p).getroot();tests=list(x.iter('testcase'))
        got={'tests':len(tests),'failures':sum(a.find('failure') is not None for a in tests),'errors':sum(a.find('error') is not None for a in tests),'skipped':sum(a.find('skipped') is not None for a in tests)}
        assert got==row['summary'],row['id']
        for a in tests:
            sk=a.find('skipped')
            if sk is not None:
                skips.append({'run':row['id'],'name':a.get('classname','')+'::'+a.get('name',''),'rawStatus':'skipped','reason':sk.get('message')})
    elif kind=='playwright':
        x=json.loads(p.read_text());tests=[]
        def walk(suites):
            for suite in suites:
                for sp in suite.get('specs',[]):
                    for t in sp.get('tests',[]): tests.append((sp,t))
                walk(suite.get('suites',[]))
        walk(x['suites']);counts=collections.Counter(t['status'] for _,t in tests)
        assert set(counts)<=set(['expected','unexpected','skipped','flaky']),row['id']
        got={k:counts[k] for k in ['expected','unexpected','skipped','flaky']}
        assert got==row['summary']=={k:x['stats'][k] for k in got} and x['errors']==[],row['id']
        for sp,t in tests:
            if t['status']=='skipped':
                skips.append({'run':row['id'],'name':sp['file']+': '+sp['title'],'rawStatus':t['status'],'annotations':t.get('annotations',[])})
    elif kind=='measurement':
        x=json.loads(p.read_text())
        got={'durationMs':x['durationMs'],'minimumDurationMet':x['minimumDurationMet'],
             'profiles':[{'id':v['id'],'p95Ms':v['frameIntervals']['p95Ms'],'paintP95Ms':v['workspacePaint']['p95Ms'],'meetsTarget':v['meetsTarget']} for v in x['results']]}
        assert got==row['summary'] and got['durationMs']==60000 and got['minimumDurationMet'] is True
        assert len(x['results'])==2 and all(v['valid'] and not v['errors'] and not v['pageErrors'] for v in x['results'])
    else: raise AssertionError(kind)
    derived.append({'id':row['id'],'kind':kind,'file':row['file'],'derived':got,'scope':'synthetic renderer harness, not actual shared-cell production performance' if kind=='measurement' else 'actual recorded complete selected scope; no overlap aggregation'})
for row in m['artifacts']:
    verified.append(checked(row['file'],row['sha256'],'artifact:'+row['commandId']))
assert len(verified)==115 and len(skips)==50 and m['notRun']==[]
rp=P/'checks/mock-regression.receipt.json';r=json.loads(rp.read_text())
assert r['exitCode']==0 and r['signal'] is None
assert sha((P/'checks/mock-regression.log').read_bytes())==r['logSha256']
assert r['before']['status']==r['after']['status']=='' and r['before']['commit']==r['after']['commit']==m['revisions']['source']
result={'schema':'root-read-only-mock-audit/1','auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manifest':info(E/'manifest.json'),
        'ownReceipt':{'file':info(rp),**{k:r[k] for k in ['argv','cwd','startedAt','finishedAt','exitCode','signal','logSha256']}},
        'identity':i['start'],'identityPolicy':i['observation'],'identityCheckpointsVerified':36,'commands':18,'runs':20,'artifacts':77,
        'verifiedRecords':verified,'derivedResults':derived,'notRunTestOccurrences':skips,
        'limits':['50 individual skipped occurrences remain not_run despite empty manifest.notRun.',
                  'Selected suites overlap; counts are not a unique test total or full service-dependent CI.',
                  'Synthetic renderer scheduling/paint does not replace actual production-cell draw, rate, pause or worker observations.',
                  'Local software evidence grants no native/physical/calibration or human acceptance.'],
        'priorRootAttempt':'root-final-981-d4-mock-audit-attempt1.json preserves initial parser-key mistake; unchanged producer inputs, no rerun or outcome editing.'}
out=D/'root-final-981-d4-mock-audit.json'
out.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'verified':True,'audit':info(out),'manifest':info(E/'manifest.json'),'hashedRecords':len(verified),'derivedResults':len(derived),'individualSkippedOccurrences':len(skips)}))
