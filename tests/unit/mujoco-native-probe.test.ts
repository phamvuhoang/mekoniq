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
 const {runMujocoProbe,verifyMujocoProbe}=await import('../../scripts/native-sim/mujoco-probe.mjs');
 const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const parent=await mkdtemp(join(tmpdir(),'L01-prepared-')),out=join(parent,'out');
 const r=await runMujocoProbe({handoff:join(parent,'missing'),out,checker:{sourceCommit:'1'.repeat(40),toolSha256:'2'.repeat(64)}});
 expect(r).toMatchObject({qualification:'not_run',accepted:false,DEP_MJ_01:'not_run'});
 expect(r.cases.every((c:{status:string})=>c.status==='not_run')).toBe(true);
 expect((await verifyMujocoProbe(out)).passed).toBe(false);
 await expect(runMujocoProbe({handoff:join(parent,'missing'),out,checker:{sourceCommit:'1'.repeat(40),toolSha256:'2'.repeat(64)}})).rejects.toThrow();
});

test('reader rejects a resealed unit-log-only manifest and artifact substitution',async()=>{
 const {verifyMujocoProbe}=await import('../../scripts/native-sim/mujoco-probe.mjs');
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
 const {readMujocoProbeSupplement}=await import('../../scripts/native-sim/mujoco-probe.mjs');
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
