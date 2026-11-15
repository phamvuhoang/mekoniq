import {describe,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nativeDocumentBinding,validateNativeDocuments} from '../../packages/lab-runtime/src/v2/sil/native-handoff-documents';
import {buildArmCellScene,readXArmFixture} from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import type {NativeHandoffV1} from '../../packages/contracts/generated/native-handoff';
import type {LabProjectV2} from '../../packages/lab-runtime/src/v2/contracts';
const OLD='4f893ac6fb75dff414a3ee42a726defb7935c734',base='robotics/simulation-mujoco/fixtures/xarm6-g2-v1';
async function documents(){
 const refs:Record<string,unknown[]>={},contents=new Map<string,Buffer>();
 const put=async(role:string,path:string,bytes?:Buffer)=>{const b=bytes??await readFile(path);contents.set(path,b);(refs[role]??=[]).push({path,sourcePath:path,sourceCommit:OLD,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});};
 const project=JSON.parse(await readFile(base+'/coffee-cell-project.json','utf8')) as LabProjectV2;
 await put('project',base+'/coffee-cell-project.json');await put('model',base+'/component.json');
 const world=buildArmCellScene(project,readXArmFixture('robotics/simulation-mujoco'),42,{armId:'arm-1',propIds:['cup-1','cup-2']});
 await put('world','derived/r2a-arm-cell-scene.json',Buffer.from(JSON.stringify(world)));
 const fx=JSON.parse(await readFile(base+'/manifest.json','utf8'));
 await put('tool',base+'/manifest.json');await put('tool',base+'/README.md');await put('tool',base+'/NOTICE');await put('tool',base+'/vendor-manifest.json');for(const f of fx.files)if(!['component.json','coffee-cell-project.json','NOTICE','README.md','vendor-manifest.json'].includes(f.path))await put('tool',base+'/'+f.path);
 for(const f of fx.blobs)await put('tool',base+'/blobs/'+f.sha256+'.stl');
 await put('engine','robotics/simulation-mujoco/requirements.lock');
 for(const name of ['lab-project-v2.schema.json','lab-fault-schedule.schema.json','engineering-component.schema.json','arm-cell-scene-v1.schema.json','arm-scene-3d-v1.schema.json']){await put('schema','packages/contracts/schemas/'+name);const r=refs.schema.at(-1) as {sourcePath:string};r.sourcePath=name;}
 const manifest={subject:{sourceCommit:OLD,labCommit:'a6ec316fb3ac2f71afff25e6fa77e931f4439e00',schemaHash:'9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4',portableClosureHash:'3d9c0b5f3e60e89327362c0c59bba8ceca4af55b0f08c44da0fbd23f3070bb1d',runtimeArtifactSha256:'55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270',executionKind:'mujoco_image'},refs,profile:{modelId:'xarm6-g2-v1',installation:{kind:'oci'},documents:{kind:'mujoco_r2a_arm_v1'}},frames:{world:'map',robotBase:'base',tool:'tcp',handedness:'right'}} as unknown as NativeHandoffV1;
 return {manifest,contents,world};
}
describe('historical R2a arm-only static admission',()=>{
 test('admits the old ArmCellScene and frozen mappings without requiring a B05/B06 world',async()=>{
  const f=await documents();f.manifest.profile.documents=nativeDocumentBinding('mujoco_r2a_arm_v1');
  expect(validateNativeDocuments(f.manifest,f.contents)).toEqual([]);
 });
 test.each(['model','world','engine','frame','source'])('rejects a self-consistent replacement %s',async change=>{
  const f=await documents();f.manifest.profile.documents=nativeDocumentBinding('mujoco_r2a_arm_v1');
  if(change==='source')f.manifest.subject.sourceCommit='1'.repeat(40);
  else if(change==='frame')f.manifest.profile.documents.frameMap.robotBase='link1';
  else {const ref=f.manifest.refs[change as 'model'|'world'|'engine'][0];const b=Buffer.from(change==='engine'?'mujoco==4.0.1':JSON.stringify({...JSON.parse(f.contents.get(ref.path)!.toString()),unexpected:true}));f.contents.set(ref.path,b);ref.sha256=createHash('sha256').update(b).digest('hex');ref.bytes=b.length;}
  expect(validateNativeDocuments(f.manifest,f.contents).some(i=>i.severity==='error')).toBe(true);
 });
});

// Real local subprocesses exercise retention; none of these records is native evidence.
describe('bounded probe command retention',()=>{
 test('preserves both streams and an incomplete receipt when a subprocess times out',async()=>{
  const {runProbeCommand}=await import('../../scripts/native-sim/mujoco-probe-process.mjs');
  const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const out=await mkdtemp(join(tmpdir(),'L01-timeout-'));
  const r=await runProbeCommand(process.execPath,['-e','process.stdout.write("partial-out");process.stderr.write("partial-err");setInterval(()=>{},1000)'],{out,timeoutMs:300});
  expect(r).toMatchObject({status:'incomplete',reason:'timeout'});
  expect(await readFile(join(out,'stdout.log'),'utf8')).toBe('partial-out');
  expect(await readFile(join(out,'stderr.log'),'utf8')).toBe('partial-err');
  expect(JSON.parse(await readFile(join(out,'process.json'),'utf8')).status).toBe('incomplete');
 });
 test('retains a failed exit and abort without converting either to pass',async()=>{
  const {runProbeCommand}=await import('../../scripts/native-sim/mujoco-probe-process.mjs');
  const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const failed=await mkdtemp(join(tmpdir(),'L01-failed-'));
  expect(await runProbeCommand(process.execPath,['-e','console.error("failure");process.exit(7)'],{out:failed,timeoutMs:2000})).toMatchObject({status:'failed',exitCode:7});
  const out=await mkdtemp(join(tmpdir(),'L01-abort-')),abort=new AbortController();setTimeout(()=>abort.abort(),300);
  expect(await runProbeCommand(process.execPath,['-e','console.log("started");setInterval(()=>{},1000)'],{out,timeoutMs:2000,signal:abort.signal})).toMatchObject({status:'incomplete',reason:'aborted'});
 });
});
describe('native campaign admission and scope',()=>{
 test('rejects emulated, wrong-image and absent engine artifact evidence',async()=>{
  const {nativeHandoffFixture}=await import('../fixtures/native-handoff');const f=await nativeHandoffFixture();
  const {probePrerequisites}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
  const host={os:{platform:'linux'},architecture:'amd64',provenance:{origin:'linux_native',emulation:'none'}};
  expect(probePrerequisites(f.manifest,f.inventory,host,{})).toContain('ENGINE_ARTIFACT_MISSING');
  f.inventory.provenance.emulation='qemu';expect(probePrerequisites(f.manifest,f.inventory,host,{})).toContain('HOST_PROVENANCE_UNRESOLVED');
  f.inventory.image={...f.inventory.image!,manifestDigest:'sha256:'+'0'.repeat(64)};expect(probePrerequisites(f.manifest,f.inventory,host,{})).toContain('HOST_IMAGE_MISMATCH');
 });
 test('requires all ten M00 seeds, three business seeds, scoped faults and long-run observations',async()=>{
  const {mujocoCases,assessCase}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
  const cases=mujocoCases();expect(cases.filter(c=>c.kind==='m00').map(c=>c.seed)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  expect(cases.filter(c=>c.kind==='business').map(c=>c.seed)).toEqual([7,42,99]);
  expect(cases.filter(c=>c.kind==='bad_state').map(c=>c.scope)).toEqual(['instrumented_historical_worker']);
  expect(cases.filter(c=>c.kind==='worker_loss').map(c=>c.scope)).toEqual(['unchanged_runtime']);
  for(const c of cases)expect(assessCase(c,{unitTests:{passed:100},status:'passed'}).passed).toBe(false);
 });
 test('a worker fault cannot claim full-runtime success or accept a successful post-fault step',async()=>{
  const {mujocoCases,assessCase}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
  const spec=mujocoCases().find(c=>c.kind==='bad_state')!;
  const raw={scope:spec.scope,engineVersion:'3.17.0',injection:{kind:'qvel_nan',atTick:1},before:{tick:0,state:'running'},warningDelta:{BADQVEL:1},response:{ok:false,error:{code:'PLANT_UNSTABLE'}},after:{tick:0,state:'failed'},postFault:{ok:false},elapsedMs:2};
  expect(assessCase(spec,raw).passed).toBe(true);
  expect(assessCase(spec,{...raw,scope:'unchanged_runtime'}).passed).toBe(false);
  expect(assessCase(spec,{...raw,postFault:{ok:true}}).passed).toBe(false);
  expect(assessCase(spec,{...raw,warningDelta:{}}).passed).toBe(false);
 });
});

test('wire evidence detects resend, overlapping requests and a replacement worker',async()=>{
 const {analyseWire}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 const wire=[{event:'spawn',pid:42},{event:'request',pid:42,value:{requestId:'a',op:'step'},atMs:1},{event:'ack',pid:42,value:{requestId:'a',ok:true},atMs:3},{event:'exit',pid:42}];
 expect(analyseWire(wire)).toMatchObject({valid:true,spawned:[42],ipcMs:[2]});
 expect(analyseWire([...wire,{event:'request',pid:42,value:{requestId:'a',op:'step'},atMs:4}]).valid).toBe(false);
 expect(analyseWire([wire[0],wire[1],{event:'request',pid:42,value:{requestId:'b',op:'step'},atMs:2},wire[2]]).valid).toBe(false);
 expect(analyseWire([...wire,{event:'spawn',pid:43}]).valid).toBe(false);
});

test('passive spawn tap forwards exact values and refuses incomplete observation',async()=>{
 const {observeSpawn}=await import('../../scripts/native-sim/mujoco-probe-observer.mjs');
 const {EventEmitter}=await import('node:events');const input=new EventEmitter() as InstanceType<typeof EventEmitter>&{write:(...args:unknown[])=>boolean};
 const output=new EventEmitter(),child=Object.assign(new EventEmitter(),{pid:42,stdin:input,stdout:output}),received:unknown[][]=[],events:unknown[]=[];
 input.write=(...args:unknown[])=>{received.push(args);return false;};const options={cwd:'/tmp/owned/run',env:{SECRET:'must-not-be-recorded'}},argv=['-m','mujoco_worker','--run-id','r'];
 const spawnCalls:unknown[][]=[];const tapped=observeSpawn((...args:unknown[])=>{spawnCalls.push(args);return child;},(e:unknown)=>events.push(e),'/tmp/owned');
 expect(tapped('python',argv,options)).toBe(child);expect(spawnCalls[0]).toEqual(['python',argv,options]);
 const cb=()=>{};expect(child.stdin.write('{"requestId":"x","op":"step"}\n','utf8',cb)).toBe(false);expect(received[0][2]).toBe(cb);
 output.emit('data',Buffer.from('{"requestId":"x",'));output.emit('data',Buffer.from('"ok":true}\n'));child.emit('close',0,null);
 expect(JSON.stringify(events)).not.toContain('must-not-be-recorded');expect(events.map((x:unknown)=>(x as {event:string}).event)).toEqual(['spawn','request','ack','exit']);
 const {analyseWire}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');expect(analyseWire(events).valid).toBe(true);
 expect(analyseWire([...events,{event:'incomplete'}]).valid).toBe(false);
 const untouched=tapped('python',argv,{cwd:'/tmp/someone-else'});expect(untouched).toBe(child);expect(events).toHaveLength(4);
});

test('prepared execution on an unassigned host retains a not_run manifest without touching Docker',async()=>{
 const {runMujocoProbe,verifyMujocoProbe}=await import('../../scripts/native-sim/mujoco-probe-core.mjs');
 const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const parent=await mkdtemp(join(tmpdir(),'L01-prepared-')),out=join(parent,'out');
 const r=await runMujocoProbe({handoff:join(parent,'missing'),out,checker:{sourceCommit:'1'.repeat(40),toolSha256:'2'.repeat(64)}});
 expect(r).toMatchObject({qualification:'not_run',accepted:false,DEP_MJ_01:'not_run'});
 expect(r.cases.every((c:{status:string})=>c.status==='not_run')).toBe(true);
 expect((await verifyMujocoProbe(out)).passed).toBe(false);
 await expect(runMujocoProbe({handoff:join(parent,'missing'),out,checker:{sourceCommit:'1'.repeat(40),toolSha256:'2'.repeat(64)}})).rejects.toThrow();
});

test('reader rejects a resealed unit-log-only manifest and artifact substitution',async()=>{
 const {verifyMujocoProbe}=await import('../../scripts/native-sim/mujoco-probe-core.mjs');
 const {mkdtemp,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {mujocoCases,sha256}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 const root=await mkdtemp(join(tmpdir(),'L01-unit-only-'));await writeFile(join(root,'unit.log'),'100 tests passed');
 const manifest={schemaVersion:1,accepted:false,qualification:'passed',DEP_MJ_01:'passed',cases:mujocoCases().map(c=>({...c,status:'passed'})),artifacts:[{path:'unit.log',bytes:16,sha256:sha256('100 tests passed')}]};
 await writeFile(join(root,'manifest.json'),JSON.stringify(manifest));expect((await verifyMujocoProbe(root)).passed).toBe(false);
 await writeFile(join(root,'unit.log'),'changed');expect((await verifyMujocoProbe(root)).issues).toContain('ARTIFACT_HASH:unit.log');
});

test('the actual Node preload observes imported spawn without changing a child byte stream',async()=>{
 const {mkdtemp,mkdir,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join,resolve}=await import('node:path');
 const {runProbeCommand}=await import('../../scripts/native-sim/mujoco-probe-process.mjs'),{analyseWire}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 const root=await mkdtemp(join(tmpdir(),'L01-preload-'));await mkdir(join(root,'child'));
 const script=`import {spawn} from 'node:child_process';const c=spawn(process.execPath,['-e','process.stdin.on("data",b=>process.stdout.write(b))','--','-m','mujoco_worker','--run-id','protocol-double'],{cwd:${JSON.stringify(join(root,'child'))},stdio:['pipe','pipe','pipe']});c.stdout.on('data',b=>process.stdout.write(b));c.stdin.write('{"requestId":"a","op":"step"}\\n');c.stdin.end();`;
 await writeFile(join(root,'launch.mjs'),script);
 const result=await runProbeCommand(process.execPath,['--import',resolve('scripts/native-sim/mujoco-probe-observer.mjs'),join(root,'launch.mjs')],{out:root,timeoutMs:3000,env:{...process.env,L01_OBSERVER_FILE:join(root,'wire.jsonl'),L01_OWNED_ROOT:root}});
 expect(result.status).toBe('completed');expect(await readFile(join(root,'stdout.log'),'utf8')).toBe('{"requestId":"a","op":"step"}\n');
 const events=(await readFile(join(root,'wire.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));expect(analyseWire(events).valid).toBe(true);
});

test('recorder supplement refuses unverified passed claims',async()=>{
 const {readMujocoProbeSupplement}=await import('../../scripts/native-sim/mujoco-probe-core.mjs');
 const {mkdtemp,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'L01-supplement-'));await writeFile(join(root,'manifest.json'),JSON.stringify({schemaVersion:1,kind:'mujoco-native-probe',qualification:'passed',DEP_MJ_01:'passed',accepted:false,artifacts:[]}));
 await expect(readMujocoProbeSupplement(root)).rejects.toThrow('PROBE_SUPPLEMENT_INVALID');
});

test('reports p50/p95/max from real timing samples without rounding away the tail',async()=>{
 const {timingSummary}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 expect(timingSummary([1,2,3,4,100])).toEqual({samples:5,p50Ms:3,p95Ms:100,maxMs:100});
 expect(()=>timingSummary([])).toThrow();expect(()=>timingSummary([NaN])).toThrow();
});

test('a truncated observer tail cannot establish a completed worker lifecycle',async()=>{
 const {analyseWire}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 expect(analyseWire([{event:'spawn',pid:99},{event:'request',pid:99,value:{requestId:'x',op:'step'},atMs:1},{event:'ack',pid:99,value:{requestId:'x',ok:true},atMs:2}]).valid).toBe(false);
});

test('grasp assertions read raw contact continuity instead of trusting the recipe summary',async()=>{
 const {assessCase,mujocoCases}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 const spec=mujocoCases()[0],row={q:[0,0,0,0,0,0],cmd:[0,0,0,0,0,0],cup:[0.35,0.35,0.15],cupquat:[1,0,0,0],rel:[0,0,0],held:false,L:false,R:false,tray:true,arm:false,cupv:0,cupw:0,label:'dwell:place'};
 const trace=Array.from({length:882},()=>({...row})),raw={scope:spec.scope,engineVersion:'3.17.0',trial:{seed:1,nan:false,heldAllCarry:true,notHeldCarry:0,liftM:0.15,slipM:0,dropTicks:1,placeErrM:0,peakFollowRad:0,settle:Object.fromEntries(['pregrasp','grasp','lift','preplace','place','retreat','home'].map(k=>[k,{ticks:1}])),warnings:{}},trace,tickMs:trace.map(()=>1),maxRssKiB:100};
 expect(assessCase(spec,raw).passed).toBe(false);
});

test('reader binds the complete checker tuple before accepting summaries',async()=>{
 const {verifyMujocoProbe}=await import('../../scripts/native-sim/mujoco-probe-core.mjs');
 const {mkdtemp,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'L01-checker-pin-')),checker={sourceCommit:'1'.repeat(40),toolSha256:'2'.repeat(64)};
 for(const recorded of [undefined,{...checker,sourceCommit:'3'.repeat(40)},{...checker,toolSha256:'4'.repeat(64)}]){
  await writeFile(join(root,'manifest.json'),JSON.stringify({schemaVersion:1,kind:'mujoco-native-probe',accepted:false,dynamics:'not_calibrated',qualification:'passed',DEP_MJ_01:'passed',checker:recorded,artifacts:[]}));
  expect((await verifyMujocoProbe(root,checker)).issues).toContain('CHECKER_PIN');
 }
});
test('execution and reader share exact historical image and measured package admission',async()=>{
 const {imagePrerequisites}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 const digest='sha256:'+'a'.repeat(64),lib='b'.repeat(64),manifest={subject:{image:{manifestDigest:digest}},profile:{forbiddenPackages:['mujoco-core'],requiredPackages:[{name:'mujoco',version:'3.17.0',sha256:lib}]}},engine={version:'3.17.0',packages:[['mujoco','3.17.0']],artifacts:[{path:'/libmujoco.so',digest:'sha256:'+lib}]};
 expect(imagePrerequisites(manifest,engine,digest)).toEqual([]);
 expect(imagePrerequisites({...manifest,subject:{image:{manifestDigest:'sha256:'+'c'.repeat(64)}}},engine,digest)).toContain('HISTORICAL_IMAGE_RESOLUTION_REQUIRED');
 expect(imagePrerequisites(manifest,{...engine,packages:[...engine.packages,['MuJoCo_Core','1']]},digest)).toContain('IMAGE_FORBIDDEN_PACKAGE');
 expect(imagePrerequisites({...manifest,profile:{...manifest.profile,requiredPackages:[...manifest.profile.requiredPackages,{name:'other'}]}},engine,digest)).toContain('UNMEASURED_PACKAGE_LOCK');
});

// These exercise the actual reader's raw-source subvalidator, not full native admission.
test.each(['none','truncated','resend','byte-count','incomplete','checkpoint','injection','requests','writer-final-success','writer-failed','writer-in-flight'])('binds business reader claims to sealed raw sources: %s',async mutation=>{
 const {mkdtemp,mkdir,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {verifyBusinessRaw}=await import('../../scripts/native-sim/mujoco-probe-raw.mjs'),{sha256}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');
 const root=await mkdtemp(join(tmpdir(),'L01-raw-reader-')),put=async(p:string,v:unknown)=>{await mkdir(join(root,p,'..'),{recursive:true});await writeFile(join(root,p),JSON.stringify(v)+'\n');};
 const runId='portable-double',wire=[{event:'spawn',runId,pid:42,atMs:1},{event:'request',runId,pid:42,atMs:2,value:{requestId:'a',op:'step'}},{event:'exit',runId,pid:42,atMs:4,signal:'SIGKILL'}],trace={samples:[]},props={samples:[]};
 const traceBytes=JSON.stringify(trace)+'\n',propsBytes=JSON.stringify(props)+'\n',subject={sourceCommit:'1'.repeat(40),schemaHash:'2'.repeat(64)},report={manifest:{runId,sourceCommit:subject.sourceCommit},schemaHash:subject.schemaHash,arm:{trace:{path:'trace.json',sha256:sha256(traceBytes)},props:{path:'props.json',sha256:sha256(propsBytes)}}};
 const raw={report,wire,trace,props,checkpoint:{runId,coffee:{arm:{programs:[{state:'unknown'}]}}},injection:{kind:'owned_pid_sigkill',pid:42,atMs:3},requests:[{actionId:'x',kind:'step',payload:{},received:true}]};
 await put('report.json',report);await put('run-wire.json',wire);await put('requests.json',mutation==='requests'?[]:raw.requests);await put('injection.json',mutation==='injection'?{...raw.injection,pid:43}:raw.injection);
 const copies=[];for(const [path,value] of Object.entries({'runtime/r/run.json':mutation==='checkpoint'?{runId,coffee:{arm:{programs:[]}}}:raw.checkpoint,'runtime/r/trace.json':trace,'runtime/r/props.json':props,'runtime/r/journal.db':{fixture:true}})){await put(path,value);const b=await readFile(join(root,path));copies.push({path,bytes:b.length,sha256:sha256(b)});}
 await put('runtime-copies.json',{afterRuntimeClose:true,copies});
 if(mutation.startsWith('writer-')){
  // Drive the production writer, retaining its real filesystem writes, before the strict reader.
  const {createActionRecorder}=await import('../../scripts/native-sim/mujoco-probe-actions.mjs');
  raw.requests.length=0;const httpMs:number[]=[];let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
  const response={run:{runRevision:8}},payload={ticks:5};
  const act=createActionRecorder({runId,revision:7,requests:raw.requests,httpMs,save:put,memory:async()=>{},api:async(path,method,body)=>{
   expect(path).toBe('/runs/'+runId+'/actions');expect(method).toBe('POST');
   expect(body).toEqual({actionId:'native-1',expectedRevision:7,kind:'step',payload});
   expect(JSON.parse(await readFile(join(root,'requests.json'),'utf8'))).toEqual([{actionId:'native-1',kind:'step',payload,received:false}]);
   enter();if(mutation==='writer-in-flight')await waiting;
   if(mutation!=='writer-final-success')throw Error('portable HTTP failure');return response;
  }});
  const action=act('step',payload);const settled=action.catch(error=>error);
  if(mutation==='writer-in-flight'){
   await entered;
   expect(JSON.parse(await readFile(join(root,'requests.json'),'utf8'))[0].received).toBe(false);
   expect(raw.requests[0].received).toBe(false);expect(httpMs).toEqual([]);release();
  }
  if(mutation==='writer-final-success'){expect(await settled).toBe(response);expect(httpMs).toHaveLength(1);}
  else{expect(await settled).toEqual(Error('portable HTTP failure'));expect(raw.requests[0].received).toBe(false);expect(httpMs).toEqual([]);}
 }
 const events=mutation==='truncated'?wire.slice(0,-1):mutation==='resend'?[...wire.slice(0,2),{...wire[1],atMs:2.5},wire[2]]:wire;
 const stream=events.map(e=>JSON.stringify(e)+'\n').join('');await writeFile(join(root,'wire.jsonl'),stream);await put('wire.jsonl.seal',{complete:true,totalBytes:Buffer.byteLength(stream)+(mutation==='byte-count'?1:0)});if(mutation==='incomplete')await writeFile(join(root,'wire.jsonl.incomplete'),'overflow\n');
 // Every retained file is newly hashed, so negatives reach raw semantics rather than stale artifact hashes.
 const {probeArtifacts}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');const artifacts=await probeArtifacts(root);expect(artifacts.length).toBeGreaterThan(5);
 const issues=await verifyBusinessRaw(root,{kind:'worker_loss'},raw,subject);
 if(mutation==='none'||mutation.startsWith('writer-'))expect(issues).toEqual([]);else expect(issues.length).toBeGreaterThan(0);
 if(mutation.startsWith('writer-'))expect(JSON.parse(await readFile(join(root,'requests.json'),'utf8'))).toEqual(raw.requests);
 if(['writer-failed','writer-in-flight'].includes(mutation)){const {assessCase}=await import('../../scripts/native-sim/mujoco-probe-evidence.mjs');expect(assessCase({id:'portable',kind:'worker_loss',seed:42,scope:'unchanged_runtime'},{...raw,workerObservation:{maxActive:1}}).issues).toContain('SERIAL_NO_RESEND');}
});

test.each(['none','request','scene','compiled','before','injected','warning','snapshot','dimensions','npz-crc'])('binds bad-state reader to actual request/scene/state bytes: %s',async mutation=>{
 const {mkdtemp,mkdir,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {verifyBadStateRaw}=await import('../../scripts/native-sim/mujoco-probe-raw.mjs'),{stateNpz}=await import('../fixtures/native-probe-state');
 const baseline=JSON.parse(await readFile('scripts/native-sim/r2a-arm-baseline.json','utf8'));
 const root=await mkdtemp(join(tmpdir(),'L01-state-reader-'));await mkdir(join(root,'engine'));
 const put=(p:string,v:unknown)=>writeFile(join(root,'engine',p),JSON.stringify(v)+'\n');
 const injection={kind:'qvel_nan',atTick:1,index:0,joint:'J1'},before={tick:0,state:'running'},after={tick:0,state:'failed'},warnings={BADQPOS:0,BADQVEL:1,BADQACC:0};
 const sizes=baseline.badStateCompiled.stateSizes,state={qpos:Array(sizes.qpos).fill(0),qvel:Array(sizes.qvel).fill(0),qacc:Array(sizes.qacc).fill(0),ctrl:Array(mutation==='dimensions'?1:sizes.ctrl).fill(0)},injected={...state,qvel:[NaN,...state.qvel.slice(1)]};
 for(const [label,value]of Object.entries({before:mutation==='before'?injected:state,injected:mutation==='injected'?state:injected,after:state})){
  const bytes=stateNpz(value);if(mutation==='npz-crc'&&label==='after')bytes[80]^=1;await writeFile(join(root,'engine',label+'-state.npz'),bytes);
 }
 const payload={targetTick:1,velocities:[],actorUpdates:[],jointTargets:[{armId:'arm-1',positionsRad:baseline.world.arm.homeRad}]};
 const requests=['create','start','step','step'].map((op,i)=>({protocol:'mekoniq-sim3d/1',requestId:'probe-'+i,runId:'native-bad-state',expectedTick:0,op,payload:i===0?{sceneRef:'arm-cell-scene.json',seed:42,arms:[{armId:'arm-1',sceneRef:'arm-cell-scene.json'}]}:i<2?{}:payload}));
 if(mutation==='request')requests[2].expectedTick=1;
 const responses=requests.map((r,i)=>({requestId:r.requestId,ok:i<2,...i>=2?{error:{code:'PLANT_UNSTABLE'}}:{}}));
 const raw={injection,before,after,warningDelta:warnings,response:responses[2],postFault:responses[3]};
 await put('requests.json',requests);await put('responses.json',responses);await put('injection.json',injection);
 await put('snapshots.json',{before:{...before,warnings:{BADQPOS:0,BADQVEL:0,BADQACC:0}},after:{...after,tick:mutation==='snapshot'?1:0,warnings:mutation==='warning'?{BADQPOS:0,BADQVEL:0,BADQACC:0}:warnings}});
 await put('arm-cell-scene.json',mutation==='scene'?{...baseline.world,engineSeed:99}:baseline.world);
 for(const name of ['component.json','physics.json'])await writeFile(join(root,'engine',name),await readFile('robotics/simulation-mujoco/fixtures/xarm6-g2-v1/'+name));
 await writeFile(join(root,'engine/compiled.xml'),mutation==='compiled'?'<mujoco/>':await readFile('scripts/native-sim/r2a-arm-compiled.xml'));
 const issues=await verifyBadStateRaw(root,raw,baseline);if(mutation==='none')expect(issues).toEqual([]);else expect(issues.length).toBeGreaterThan(0);
});
