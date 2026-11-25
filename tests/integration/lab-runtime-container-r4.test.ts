/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from the wire, checked by the assertions below */
// CLD01 for R4.1 (plan V05): the shared-world cell with a virtual drive (drive-nominal-v1) completes and serves 2 inside the Lab runtime image, driven only through the public HTTP API.
// CLD01 for R4.2 (plan V07b): a wheel bench `step` (2 rad/s, the starting profile the image serves in health `benchCatalog`) completes with tuning metrics, frees the engine slot (a second bench starts at once) and serves its trace, in the same container and with the same checks.
// Skipped (never failed or passed) where `docker info` fails or LAB_CONTAINER_IMAGE is not set; an image built from another commit than HEAD is refused with IMAGE_STALE. Later R4 batches add cases here.
// Run: LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:r4 pnpm test:integration -- tests/integration/lab-runtime-container-r4.test.ts   (build: deploy/lab-runtime/build.sh mekoniq-lab-runtime:r4 --platform linux/arm64)
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {machine,tmpdir,type} from 'node:os';
import {join} from 'node:path';
import {assertR4Image,assertR4Runtime} from '../support/r4-container-identity';
import {afterAll,describe,expect,test} from 'vitest';
import {sourceCommit as repoSourceCommit} from '../../scripts/repo-identity.mjs';

const image=process.env.LAB_CONTAINER_IMAGE??'',LABEL='mekoniq-lab-container-test',ORIGIN='http://127.0.0.1:4175';
const docker=(args:string[],env?:Record<string,string>)=>{const r=spawnSync('docker',args,{encoding:'utf8',env:{...process.env,...env},timeout:120_000,killSignal:'SIGKILL'});return {exitCode:r.status,ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const dockerUp=!!image&&(()=>{try{execFileSync('docker',['info'],{stdio:'ignore',timeout:15_000,killSignal:'SIGKILL'});return true;}catch{return false;}})();
const head=repoSourceCommit('.');
const freePort=()=>new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const runId=randomUUID(),names:string[]=[];
afterAll(()=>{for(const n of names)docker(['rm','-f',n]);});

describe.skipIf(!dockerUp||!image)('lab runtime container, R4.1, R4.2 and R4.4',()=>{
 test('CLD01: MJ-CELL-BV01 on drive-nominal-v1 completes and serves 2, a scheduled drive fault reports its receipts, the three-cup tray serves 3, and a wheel bench step completes and frees the slot, inside the image; read-only root, empty diff, not root, ports on 127.0.0.1 only',async()=>{
  const inspected=docker(['image','inspect',image]);
  if(!inspected.ok)throw new Error(`IMAGE_MISSING: ${image} does not exist locally; build it with deploy/lab-runtime/build.sh ${image}`);
  const [info]=JSON.parse(inspected.out);
  const host={os:type(),machine:machine(),daemonPlatform:docker(['version','--format','{{.Server.Os}}/{{.Server.Arch}}']).out};
  assertR4Image(host,info,head);
  const imageId=info.Id;
  expect(imageId).toMatch(/^sha256:[0-9a-f]{64}$/);
  let port=await freePort();while([1880,1884,4175,4176].includes(port))port=await freePort();
  const key=randomBytes(20).toString('hex'),name=`mekoniq-lab-r4-${runId.slice(0,8)}`;names.push(name);
  const exportDir=await mkdtemp(join(tmpdir(),'r4-cld01-export-'));
  try{
   execFileSync(process.execPath,['scripts/export-lab-runtime.mjs',exportDir],{stdio:['ignore','ignore','inherit'],timeout:120_000});
   const manifest=JSON.parse(await readFile(join(exportDir,'manifest.json'),'utf8'));
   expect(manifest).toMatchObject({sourceCommit:head,dirty:false});
   // the key only through the environment of the docker client (`-e NAME` copies it), never on a command line, never printed
   const started=docker(['run','-d','--name',name,'--label',`${LABEL}=${runId}`,'--read-only','--tmpfs','/tmp','-p',`127.0.0.1:${port}:${port}`,'-e',`PORT=${port}`,'-e','MEKONIQ_LAB_ACCESS_KEY','-e',`LAB_PUBLIC_HOST=127.0.0.1:${port}`,'-e',`LAB_ALLOW_ORIGIN=${ORIGIN}`,'-e','LAB_DATA_DIR=/tmp/runs',imageId],{MEKONIQ_LAB_ACCESS_KEY:key});
   if(!started.ok)throw new Error(`CONTAINER_START_FAILED: ${started.err.replaceAll(key,'<key>')}`);
   const published=docker(['port',name]).out;expect(published.split('\n').every(l=>l.includes('127.0.0.1:'))).toBe(true);   // never 0.0.0.0
   const base=`http://127.0.0.1:${port}/lab/v2`,api=async(path:string,init:{method?:string;token?:string;body?:unknown}={})=>{
    const r=await fetch(base+path,{method:init.method??'GET',headers:{Origin:ORIGIN,...init.body!==undefined?{'Content-Type':'application/json'}:{},...init.token?{Authorization:`Bearer ${init.token}`}:{}},...init.body!==undefined?{body:JSON.stringify(init.body)}:{}});
    return {status:r.status,body:await r.json() as Record<string,any>};
   };
   let health:Record<string,any>|undefined;
   for(const deadline=Date.now()+120_000;!health&&Date.now()<deadline;){
    try{const r=await api('/health');if(r.status===200)health=r.body;}catch{/* not listening yet */}
    if(!health){if(docker(['inspect','--format','{{.State.Running}}',name]).out!=='true')throw new Error(`CONTAINER_EXITED: ${docker(['logs','--tail','20',name]).out.replaceAll(key,'<key>')}`);await sleep(500);}
   }
   if(!health)throw new Error('HEALTH_TIMEOUT');
   const bundle=docker(['exec',name,'sha256sum','/app/runtime.mjs']);expect(bundle.ok).toBe(true);
   assertR4Runtime(manifest,health,bundle.out.split(/\s+/)[0]!);
   console.log('CLD01 identity',JSON.stringify({host,image,imageId,platform:info.Os+'/'+info.Architecture,sourceCommit:head,schemaHash:manifest.schemaHash,artifactSha256:manifest.artifactSha256}));
   expect(health.backends.filter((b:{installed:boolean})=>b.installed).map((b:{id:string})=>b.id).sort()).toEqual(['mock_amr','mock_arm','mock_coffee','mujoco_3d','mujoco_arm']);
   const paired=await api('/sessions',{method:'POST',body:{token:key}});expect(paired.status).toBe(201);
   const token=paired.body.sessionToken as string;
   const project=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json','utf8'));
   // an id outside the registry is refused before a run exists; a drive on the arm-only scenario is refused too
   const bad=await api('/runs',{method:'POST',token,body:{project,scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',driveExperimentId:'drive-nominal-v9',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}}});
   expect(bad.status).toBeGreaterThanOrEqual(400);expect(bad.status).toBeLessThan(500);
   const created=await api('/runs',{method:'POST',token,body:{project,scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',driveExperimentId:'drive-nominal-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}}});
   expect(created.status,JSON.stringify(created.body).slice(0,400)).toBe(201);
   const url=`/runs/${created.body.run.id}`;let rev=created.body.run.runRevision as number,n=0;
   const act=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${url}/actions`,{method:'POST',token,body:{actionId:`a-${++n}`,expectedRevision:rev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);rev=r.body.run.runRevision;return r.body;};
   let view=await act('start',{});const t0=Date.now();
   while(['running','created','paused'].includes(view.run.status)){if(view.tick>14000)throw new Error(`STEP_LIMIT at ${view.tick}`);view=await act('step',{ticks:100});}
   const wallMs=Date.now()-t0;
   console.log('MJ-CELL-BV01 drive container',JSON.stringify({image,platform:info.Os+'/'+info.Architecture,finalTick:view.tick,wallMs,msPerTick:+(wallMs/view.tick).toFixed(3),status:view.run.status}));
   const cellReport=await api(`${url}/report`,{token});expect(cellReport.status).toBe(200);const report=cellReport.body;
   if(view.run.status!=='completed')console.log('NOT COMPLETED',JSON.stringify({outcome:report.outcome,attention:report.attention,drive:report.driveEvidence?.events}).slice(0,3000),docker(['logs','--tail','20',name]).out.replaceAll(key,'<key>'));
   expect(view.run.status).toBe('completed');
   expect(report.outcome).toMatchObject({status:'completed',served:'2'});
   expect(report.manifest.drive).toMatchObject({testLevel:'controller_in_the_loop',experimentId:'drive-nominal-v1'});
   expect(report.driveEvidence).toMatchObject({testLevel:'controller_in_the_loop',complete:true,issues:[]});expect(report.driveEvidence.axes).toHaveLength(9);
   expect(report.driveEvidence.axes.every((a:{faults:unknown[]})=>a.faults.length===0)).toBe(true);
   // a finished cell run keeps the host's one MuJoCo slot until it is closed (a world run holds it to close): archive it, as the Lab does, before the bench
   const archived=await api(`${url}/archive`,{method:'POST',token,body:{}});expect(archived.status,JSON.stringify(archived.body)).toBe(200);
   // R4 V09 (plan V08/V09): the image advertises the drive fault catalog, refuses what the catalog refuses, and a scheduled drive fault runs to a report that carries the injection's receipts
   expect(health.faultCatalog.map((f:{id:string}) => f.id).sort()).toEqual(['command-delay','command-loss','drive-trip','encoder-dropout','grip-weak','lidar-noise','motor-weak']);   // drive-reset is campaign-only: never offered
   const schedule=(entries:unknown[])=>({driveFaultSchedule:entries,backendSetId:'engineering-mujoco-cell-v1',scenarioId:'MJ-CELL-BV01',driveExperimentId:'drive-nominal-v1'});
   const dropout={id:'drop-1',faultId:'encoder-dropout',targetId:'amr-1/wheel-left',trigger:{kind:'elapsed_sim_ms',value:1000},durationMs:300,params:{}};
   const overlap=await api('/projects/validate',{method:'POST',token,body:schedule([dropout,{...dropout,id:'drop-2',trigger:{kind:'elapsed_sim_ms',value:1100}}])});
   expect(overlap.status).toBe(422);expect(overlap.body).toMatchObject({error:'INVALID_FAULT_SCHEDULE',reasonCodes:['FAULT_OVERLAP']});
   expect((await api('/projects/validate',{method:'POST',token,body:schedule([{...dropout,faultId:'drive-reset',durationMs:20}])})).body.reasonCodes).toEqual(['FAULT_CAMPAIGN_ONLY']);
   expect((await api('/projects/validate',{method:'POST',token,body:schedule([dropout])})).status).toBe(200);
   const faulted=await api('/runs',{method:'POST',token,body:{project,scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[dropout],runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}}});
   expect(faulted.status,JSON.stringify(faulted.body).slice(0,400)).toBe(201);
   const fUrl=`/runs/${faulted.body.run.id}`;let fRev=faulted.body.run.runRevision as number,fn=0;
   const fAct=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${fUrl}/actions`,{method:'POST',token,body:{actionId:`f-${++fn}`,expectedRevision:fRev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);fRev=r.body.run.runRevision;return r.body;};
   let fv=await fAct('start',{});while(fv.tick<150)fv=await fAct('step',{ticks:50});
   const faultReport=(await api(`${fUrl}/report`,{token})).body;
   expect(faultReport.manifest.driveFaultSchedule.entries).toHaveLength(1);
   expect(faultReport.faultReport,JSON.stringify(faultReport.driveEvidence?.issues)).toBeDefined();
   expect(faultReport.faultReport).toMatchObject({documentType:'fault-report',accepted:false,entries:[{faultId:'encoder-dropout',targetId:'amr-1/wheel-left',verdict:'detected_in_time',injection:{appliedTick:51,endedTick:66},detection:{by:'drive',code:'FEEDBACK_LOSS'}}]});
   expect(faultReport.faultReport.invariants.filter((i:{result:string})=>i.result==='violated')).toEqual([]);
   const faultArchived=await api(`${fUrl}/archive`,{method:'POST',token,body:{}});expect(faultArchived.status,JSON.stringify(faultArchived.body)).toBe(200);
   // R4 V10: the three-cup tray (tray-nominal-v1, seed 42) compiles through the image's engineering API and runs on its real MuJoCo worker: it serves 3 after the confirmation, no cup slides past the warning threshold in any
   // window, and the report carries the tray evidence the Lab compares. A tray project is the payload project with a registered experiment id: the catalog the image ships already holds its components.
   // R5 adds the registered stop variants (tray-stop-*) to the same list; R4's five are checked here, R5's in r5-container.test.ts
   expect(health.trayExperiments.map((e:{id:string})=>e.id).filter((id:string)=>!id.startsWith('tray-stop-')).sort()).toEqual(['tray-accel-high-v1','tray-low-friction-v1','tray-nominal-v1','tray-person-crossing-v1','tray-torque-limited-v1']);
   const trayProject={...JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/serve-tray-v1/serve-3d-project.json','utf8')),requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:'tray-nominal-v1'};
   const trayCompiled=await api('/engineering/compile',{method:'POST',token,body:{project:trayProject}});
   expect(trayCompiled.status,JSON.stringify(trayCompiled.body).slice(0,400)).toBe(200);expect(trayCompiled.body.state,JSON.stringify(trayCompiled.body.problems)).toBe('compiled');
   // a payload run of MJ-FD01 may not carry a tray variant, and MJ-TRAY01 may not run without one
   const trayBody={engineeringRef:{bundleDigest:trayCompiled.body.bundleDigest,projectDigest:trayCompiled.body.projectDigest},scenarioRevision:1,seed:42,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}};
   const trayCreated=await api('/runs',{method:'POST',token,body:{...trayBody,scenarioId:'MJ-TRAY01'}});
   expect(trayCreated.status,JSON.stringify(trayCreated.body).slice(0,400)).toBe(201);
   const tUrl=`/runs/${trayCreated.body.run.id}`;let tRev=trayCreated.body.run.runRevision as number,tn=0;
   const tAct=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${tUrl}/actions`,{method:'POST',token,body:{actionId:`t-${++tn}`,expectedRevision:tRev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);tRev=r.body.run.runRevision;return r.body;};
   let tv=await tAct('start',{});const tw0=Date.now();
   while(['running','awaiting_confirmation','created','paused'].includes(tv.run.status)){if(tv.tick>30000)throw new Error(`TRAY_STEP_LIMIT at ${tv.tick}`);tv=await tAct('step',{ticks:250});}
   const trayWallMs=Date.now()-tw0;
   console.log('MJ-TRAY01 tray-nominal-v1 container',JSON.stringify({image,platform:info.Os+'/'+info.Architecture,finalTick:tv.tick,wallMs:trayWallMs,msPerTick:+(trayWallMs/tv.tick).toFixed(3),status:tv.run.status}));
   const trayReport=(await api(`${tUrl}/report`,{token})).body;
   expect(trayReport.outcome,JSON.stringify(trayReport.attention)).toMatchObject({status:'completed',served:'3'});
   expect(trayReport.trayEvidence).toMatchObject({documentType:'tray-evidence',accepted:false,experimentId:'tray-nominal-v1',comparedWith:null,accelerationLimitMps2:0.5,serviceTimeS:{available:true}});
   expect(trayReport.trayEvidence.maxLoadSlipM.value).toBeLessThan(0.005);
   const trayArchived=await api(`${tUrl}/archive`,{method:'POST',token,body:{}});expect(trayArchived.status,JSON.stringify(trayArchived.body)).toBe(200);
   // R4.2: a wheel bench step from the starting profile health serves; the run ends itself at tick 500, the engine slot is free for a second bench right after, and the trace reads back
   expect(Object.keys(health.benchCatalog)).toEqual(['MJ-BENCH-WHEEL','MJ-BENCH-ARM']);
   const benchBody=(signal:unknown)=>({scenarioId:'MJ-BENCH-WHEEL',scenarioRevision:1,seed:3,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-bench-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash},
    bench:{schemaVersion:1,scenarioId:'MJ-BENCH-WHEEL',axis:'wheels',signal,driveExperimentId:'drive-nominal-v1',controlProfile:health.benchCatalog['MJ-BENCH-WHEEL'].startingProfile}});
   const b1=await api('/runs',{method:'POST',token,body:benchBody({kind:'step',amplitude:2,atTick:10})});expect(b1.status,JSON.stringify(b1.body).slice(0,400)).toBe(201);
   const bUrl=`/runs/${b1.body.run.id}`;let bRev=b1.body.run.runRevision as number,bn=0;
   const bAct=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${bUrl}/actions`,{method:'POST',token,body:{actionId:`b-${++bn}`,expectedRevision:bRev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);bRev=r.body.run.runRevision;return r.body;};
   let bv=await bAct('start',{});const b0=Date.now();
   while(['running','created','paused'].includes(bv.run.status)){if(bv.tick>500)throw new Error(`BENCH_STEP_LIMIT at ${bv.tick}`);bv=await bAct('step',{ticks:100});}
   const benchWallMs=Date.now()-b0;
   console.log('MJ-BENCH-WHEEL step container',JSON.stringify({image,platform:info.Os+'/'+info.Architecture,finalTick:bv.tick,wallMs:benchWallMs,msPerTick:+(benchWallMs/bv.tick).toFixed(3),status:bv.run.status}));
   expect(bv.run.status).toBe('completed');expect(bv.tick).toBe(500);
   const benchReport=await api(`${bUrl}/report`,{token});expect(benchReport.status).toBe(200);const bReport=benchReport.body;
   expect(bReport.outcome.status).toBe('completed');
   expect(bReport.tuning).toMatchObject({status:'completed',axisIds:['amr-1/wheel-left','amr-1/wheel-right']});expect(bReport.tuning.suggestions).toHaveLength(8);
   for(const key of ['rmsError','peakTorqueNm','saturationRatio']){
    const metric=bReport.tuning.metrics[key];expect(metric).toMatchObject({available:true,basis:'actual'});
    expect(Number.isFinite(metric.value)).toBe(true);expect(metric.samples).toBeGreaterThan(0);
   }
   expect(bReport.bench.traceIssues).toEqual([]);
   const bTrace=await api(`${bUrl}/trace`,{token});expect(bTrace.status).toBe(200);expect(bTrace.body.issues).toEqual([]);expect(bTrace.body.traces.length).toBeGreaterThan(0);expect(bTrace.body.traces[0].samples.length).toBeGreaterThan(0);
   // slot free: the first bench is still open (the gateway keeps a run until its session ends), a second is created and started at once
   const b2=await api('/runs',{method:'POST',token,body:benchBody({kind:'hold',ticks:50})});expect(b2.status,JSON.stringify(b2.body).slice(0,400)).toBe(201);
   const b2s=await api(`/runs/${b2.body.run.id}/actions`,{method:'POST',token,body:{actionId:'b2-start',expectedRevision:b2.body.run.runRevision,kind:'start',payload:{}}});expect(b2s.status,JSON.stringify(b2s.body).slice(0,300)).toBe(200);
   expect(b2.body.run.id).not.toBe(b1.body.run.id);expect(b2s.body.run.status).toBe('running');
   const next=await api(`/runs/${b2.body.run.id}/actions`,{method:'POST',token,body:{actionId:'b2-step',expectedRevision:b2s.body.run.runRevision,kind:'step',payload:{ticks:1}}});
   expect(next.status).toBe(200);expect(next.body.run.status).toBe('running');expect(next.body.tick).toBeGreaterThan(b2s.body.tick);
   // nothing written outside /tmp (read-only root + empty diff; OrbStack alone adds its CA certificate under /usr/local/share/ca-certificates at container start), not root
   expect(docker(['diff',name]).out.split('\n').filter(l=>l&&!/^[CA] \/usr(\/local(\/share(\/ca-certificates(\/orbstack-root\.crt)?)?)?)?$/.test(l))).toEqual([]);
   expect(Number(docker(['exec',name,'id','-u']).out)).toBeGreaterThan(0);
   const stopped=docker(['stop','-t','20',name]);expect(stopped.ok).toBe(true);expect(docker(['inspect','--format','{{.State.Running}} {{.State.ExitCode}}',name]).out).toBe('false 0');
  }finally{docker(['rm','-f',name]);await rm(exportDir,{recursive:true,force:true});}
  expect(docker(['ps','-a','-q','--filter',`label=${LABEL}=${runId}`]).out).toBe('');
 },1_800_000);
 test('CLD01 (R4.4): MJ-CELL-BV01 at belief_estimated with the nominal perception profile and the recovery policy completes and serves 2 inside the image, its report carries the perception evidence, and a belief mode on the arm-only scenario is refused',async()=>{
  const inspected=docker(['image','inspect',image]);
  if(!inspected.ok)throw new Error(`IMAGE_MISSING: ${image} does not exist locally; build it with deploy/lab-runtime/build.sh ${image}`);
  const [info]=JSON.parse(inspected.out);
  const host={os:type(),machine:machine(),daemonPlatform:docker(['version','--format','{{.Server.Os}}/{{.Server.Arch}}']).out};
  assertR4Image(host,info,head);
  const imageId=info.Id;
  expect(imageId).toMatch(/^sha256:[0-9a-f]{64}$/);
  let port=await freePort();while([1880,1884,4175,4176].includes(port))port=await freePort();
  const key=randomBytes(20).toString('hex'),name=`mekoniq-lab-r4-${runId.slice(0,8)}`;names.push(name);
  const exportDir=await mkdtemp(join(tmpdir(),'r4-cld01-export-'));
  try{
   execFileSync(process.execPath,['scripts/export-lab-runtime.mjs',exportDir],{stdio:['ignore','ignore','inherit'],timeout:120_000});
   const manifest=JSON.parse(await readFile(join(exportDir,'manifest.json'),'utf8'));
   expect(manifest).toMatchObject({sourceCommit:head,dirty:false});
   // the key only through the environment of the docker client (`-e NAME` copies it), never on a command line, never printed
   const started=docker(['run','-d','--name',name,'--label',`${LABEL}=${runId}`,'--read-only','--tmpfs','/tmp','-p',`127.0.0.1:${port}:${port}`,'-e',`PORT=${port}`,'-e','MEKONIQ_LAB_ACCESS_KEY','-e',`LAB_PUBLIC_HOST=127.0.0.1:${port}`,'-e',`LAB_ALLOW_ORIGIN=${ORIGIN}`,'-e','LAB_DATA_DIR=/tmp/runs',imageId],{MEKONIQ_LAB_ACCESS_KEY:key});
   if(!started.ok)throw new Error(`CONTAINER_START_FAILED: ${started.err.replaceAll(key,'<key>')}`);
   const published=docker(['port',name]).out;expect(published.split('\n').every(l=>l.includes('127.0.0.1:'))).toBe(true);   // never 0.0.0.0
   const base=`http://127.0.0.1:${port}/lab/v2`,api=async(path:string,init:{method?:string;token?:string;body?:unknown}={})=>{
    const r=await fetch(base+path,{method:init.method??'GET',headers:{Origin:ORIGIN,...init.body!==undefined?{'Content-Type':'application/json'}:{},...init.token?{Authorization:`Bearer ${init.token}`}:{}},...init.body!==undefined?{body:JSON.stringify(init.body)}:{}});
    return {status:r.status,body:await r.json() as Record<string,any>};
   };
   let health:Record<string,any>|undefined;
   for(const deadline=Date.now()+120_000;!health&&Date.now()<deadline;){
    try{const r=await api('/health');if(r.status===200)health=r.body;}catch{/* not listening yet */}
    if(!health){if(docker(['inspect','--format','{{.State.Running}}',name]).out!=='true')throw new Error(`CONTAINER_EXITED: ${docker(['logs','--tail','20',name]).out.replaceAll(key,'<key>')}`);await sleep(500);}
   }
   if(!health)throw new Error('HEALTH_TIMEOUT');
   const bundle=docker(['exec',name,'sha256sum','/app/runtime.mjs']);expect(bundle.ok).toBe(true);
   assertR4Runtime(manifest,health,bundle.out.split(/\s+/)[0]!);
   console.log('CLD01 identity',JSON.stringify({host,image,imageId,platform:info.Os+'/'+info.Architecture,sourceCommit:head,schemaHash:manifest.schemaHash,artifactSha256:manifest.artifactSha256}));
   expect(health.backends.filter((b:{installed:boolean})=>b.installed).map((b:{id:string})=>b.id).sort()).toEqual(['mock_amr','mock_arm','mock_coffee','mujoco_3d','mujoco_arm']);
   const paired=await api('/sessions',{method:'POST',body:{token:key}});expect(paired.status).toBe(201);
   const token=paired.body.sessionToken as string;
   const project=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json','utf8'));
   const identity={sourceCommit:health.sourceCommit,schemaHash:health.schemaHash};
   expect(health.capabilities).toContain('sim3d_belief_grasp_v1');expect(health.graspModes.map((m:{id:string})=>m.id)).toEqual(['fixed_program','belief_ground_truth','belief_estimated']);
   const bad=await api('/runs',{method:'POST',token,body:{project,scenarioId:'MJ-BV01',backendSetId:'engineering-mujoco-arm-v1',scenarioRevision:1,seed:42,mode:'simulation',access:'simulated',graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',runtimeIdentity:identity}});
   expect(bad.status).toBe(422);
   const created=await api('/runs',{method:'POST',token,body:{project,scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1',runtimeIdentity:identity}});
   expect(created.status,JSON.stringify(created.body).slice(0,400)).toBe(201);
   const url=`/runs/${created.body.run.id}`;let rev=created.body.run.runRevision as number,n=0;
   const act=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${url}/actions`,{method:'POST',token,body:{actionId:`a-${++n}`,expectedRevision:rev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);rev=r.body.run.runRevision;return r.body;};
   let view=await act('start',{});
   while(['running','created','paused'].includes(view.run.status)){if(view.tick>14000)throw new Error(`STEP_LIMIT at ${view.tick}`);view=await act('step',{ticks:100});}
   const rep=await api(`${url}/report`,{token});expect(rep.status).toBe(200);
   expect(view.run.status).toBe('completed');expect(rep.body.outcome).toMatchObject({status:'completed',served:'2'});
   expect(rep.body.manifest.perception).toMatchObject({graspMode:'belief_estimated',profile:{id:'perception-nominal-v1'},recoveryPolicy:{id:'pick-recovery-v1'}});
   expect(rep.body.perceptionEvidence).toMatchObject({schemaVersion:1,issues:[]});
   // no recovery is expected on this nominal run: the registered cup nudge (R4-D33) cannot provoke one in this cell (V13 ledger, REC06 blocked)
   expect(rep.body.perceptionEvidence.attempts.map((a:{outcome:string})=>a.outcome)).toEqual(['lifted','lifted']);expect(rep.body.perceptionEvidence.recovery).toEqual([]);
   const archived=await api(`${url}/archive`,{method:'POST',token,body:{}});expect(archived.status,JSON.stringify(archived.body)).toBe(200);
   expect(docker(['stop','-t','20',name]).ok).toBe(true);
  }finally{docker(['rm','-f',name]);await rm(exportDir,{recursive:true,force:true});}
  expect(docker(['ps','-a','-q','--filter',`label=${LABEL}=${runId}`]).out).toBe('');
 },1_800_000);
});
