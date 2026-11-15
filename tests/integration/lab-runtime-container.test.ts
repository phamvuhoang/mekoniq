/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from the wire, checked by the assertions below */
// N04 (D59, SX-48, RT05): the Lab runtime image runs headless with the mock backends and the MuJoCo arm; MJ-BV01 completes inside it, driven only through the public HTTP API.
// Not a gate proof for G-MA1/G-MA2 (D50): it shows that the image runs. Skipped (never failed or passed) where `docker info` fails or LAB_CONTAINER_IMAGE is not set.
// Run: LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:dev pnpm test:integration -- tests/integration/lab-runtime-container.test.ts   (build: deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev)
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {afterAll,describe,expect,test} from 'vitest';
// @ts-expect-error shared standalone artifact observer programs
import {CHUNK_PROGRAM,WORKER_PROGRAM} from '../../scripts/web05-observations.mjs';
import {xarmProject} from '../support/mujoco-arm';

const image=process.env.LAB_CONTAINER_IMAGE??'',LABEL='mekoniq-lab-container-test',ORIGIN='http://127.0.0.1:4175';
const docker=(args:string[],env?:Record<string,string>)=>{const r=spawnSync('docker',args,{encoding:'utf8',env:{...process.env,...env},timeout:120_000,killSignal:'SIGKILL'});return {exitCode:r.status,signal:r.signal,ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const dockerUp=!!image&&(()=>{try{execFileSync('docker',['info'],{stdio:'ignore',timeout:15_000,killSignal:'SIGKILL'});return true;}catch{return false;}})();
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const freePort=()=>new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
const logs=(name:string,key:string)=>{const l=docker(['logs','--tail','20',name]);return `${l.out}\n${l.err}`.replaceAll(key,'<key>');};
// MuJoCo writes its warnings (which name the DOF and the time) to MUJOCO_LOG.TXT in the run's working directory: the last 20 lines of each, for a run that did not complete
const mujocoLog=(name:string,key:string)=>{const l=docker(['exec',name,'sh','-c','for f in $(find /tmp/runs -name MUJOCO_LOG.TXT 2>/dev/null); do echo "== $f"; tail -n 20 "$f"; done']);return `${l.out}\n${l.err}`.trim().replaceAll(key,'<key>');};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const runId=randomUUID(),names:string[]=[],volumes:string[]=[];
afterAll(()=>{for(const n of names)docker(['rm','-f',n]);for(const v of volumes)docker(['volume','rm',v]);});

describe.skipIf(!dockerUp||!image)('lab runtime container',()=>{
 test('pairs with the access key and runs MJ-BV01 to completion inside the image',async()=>{
  const inspected=docker(['image','inspect','--format','{{.Id}}',image]);
  if(!inspected.ok)throw new Error(`IMAGE_MISSING: ${image} does not exist locally; build it with deploy/lab-runtime/build.sh ${image}`);
  let port=await freePort();while(port===1880||port===1884)port=await freePort();
  const key=randomBytes(20).toString('hex'),name=`mekoniq-lab-${runId.slice(0,8)}`;names.push(name);
  try{
   // the key only through the environment of the docker client (`-e NAME` copies it), never on a command line, never printed
   const started=docker(['run','-d','--name',name,'--label',`${LABEL}=${runId}`,'--read-only','--tmpfs','/tmp','-p',`127.0.0.1:${port}:${port}`,'-e',`PORT=${port}`,'-e','MEKONIQ_LAB_ACCESS_KEY','-e',`LAB_PUBLIC_HOST=127.0.0.1:${port}`,'-e',`LAB_ALLOW_ORIGIN=${ORIGIN}`,image],{MEKONIQ_LAB_ACCESS_KEY:key});
   if(!started.ok)throw new Error(`CONTAINER_START_FAILED: ${started.err.replaceAll(key,'<key>')}`);
   const base=`http://127.0.0.1:${port}/lab/v2`,api=async(path:string,init:{method?:string;token?:string;body?:unknown}={})=>{
    const r=await fetch(base+path,{method:init.method??'GET',headers:{Origin:ORIGIN,...init.body!==undefined?{'Content-Type':'application/json'}:{},...init.token?{Authorization:`Bearer ${init.token}`}:{}},...init.body!==undefined?{body:JSON.stringify(init.body)}:{}});
    return {status:r.status,body:await r.json() as Record<string,any>};
   };
   type Health={sourceCommit:string;schemaHash:string;backends:{id:string;installed:boolean;reachable:boolean}[];deployment:{bind:string}};
   let health:Health|undefined;
   for(const deadline=Date.now()+120_000;!health&&Date.now()<deadline;){
    try{const r=await api('/health');if(r.status===200)health=r.body as unknown as Health;}catch{/* not listening yet */}
    if(!health){if(docker(['inspect','--format','{{.State.Running}}',name]).out!=='true')throw new Error(`CONTAINER_EXITED: ${logs(name,key)}`);await sleep(500);}
   }
   if(!health)throw new Error(`HEALTH_TIMEOUT: ${logs(name,key)}`);
   if(health.sourceCommit!==head)throw new Error(`IMAGE_STALE: the image was built from ${health.sourceCommit}, the repository HEAD is ${head}; commit, then rebuild with deploy/lab-runtime/build.sh ${image}`);
   const backend=(id:string)=>health!.backends.find(b=>b.id===id);
   expect(backend('mujoco_arm')).toMatchObject({installed:true,reachable:true});
   expect(health.backends.filter(b=>b.installed).map(b=>b.id).sort()).toEqual(['mock_amr','mock_arm','mock_coffee','mujoco_3d','mujoco_arm']);
   for(const id of ['webots_3d','irsim_2d'])expect(backend(id)?.installed??false,id).toBe(false);
   expect(health.deployment.bind).toBe('public');
   // wrong key refused; the key pairs; the run goes through the bearer token only
   expect((await api('/sessions',{method:'POST',body:{token:'x'.repeat(40)}})).status).toBe(401);
   const paired=await api('/sessions',{method:'POST',body:{token:key}});expect(paired.status).toBe(201);
   const token=paired.body.sessionToken as string;
   // the runtime's own asset catalog resolves the project's robot (by content hash), so the arm's collision sweep includes the docked robot (asserted below)
   const created=await api('/runs',{method:'POST',token,body:{project:xarmProject(),scenarioId:'MJ-BV01',scenarioRevision:1,seed:42,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-arm-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}}});
   expect(created.status,JSON.stringify(created.body).slice(0,300)).toBe(201);
   const url=`/runs/${created.body.run.id}`;let rev=created.body.run.runRevision as number,n=0;
   const act=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${url}/actions`,{method:'POST',token,body:{actionId:`a-${++n}`,expectedRevision:rev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);rev=r.body.run.runRevision;return r.body;};
   let view=await act('start',{});const t0=Date.now();
   while(view.run.status==='running'||view.run.status==='created'||view.run.status==='paused'){if(view.tick>6000)throw new Error(`STEP_LIMIT at ${view.tick}`);view=await act('step',{ticks:50});}
   const wallMs=Date.now()-t0;
   console.log('MJ-BV01 container',JSON.stringify({image,platform:docker(['image','inspect','--format','{{.Os}}/{{.Architecture}}',image]).out,finalTick:view.tick,wallMs,msPerTick:+(wallMs/view.tick).toFixed(3),status:view.run.status}));
   const report=(await api(`${url}/report`,{token})).body as Record<string,any>;
   if(view.run.status!=='completed')console.log('MJ-BV01 container NOT COMPLETED',JSON.stringify({tick:view.tick,outcome:report.outcome,attention:report.attention,armStop:report.coffee?.armTrace?.stop,arm:{...report.arm,trace:undefined,props:undefined,collision:undefined},coffee:report.coffee?.cups,logs:logs(name,key)}).slice(0,6000),`\nMUJOCO_LOG.TXT (last 20 lines):\n${mujocoLog(name,key)||'(none)'}`);
   expect(report.outcome).toMatchObject({status:'completed',served:'2'});
   expect(report.coverage).toMatchObject({armSceneCollision:true});
   expect(report.manifest).toMatchObject({scenario:{id:'MJ-BV01'},backendSetId:'engineering-mujoco-arm-v1',calibration:{status:'not_calibrated'}});
   expect(report.arm.armPlant).toMatchObject({engine:'mujoco_3d',calibration:'not_calibrated'});
   // nothing written outside /tmp (read-only root + empty diff; OrbStack alone adds its CA certificate under /usr/local/share/ca-certificates at container start), not root
   expect(docker(['diff',name]).out.split('\n').filter(l=>l&&!/^[CA] \/usr(\/local(\/share(\/ca-certificates(\/orbstack-root\.crt)?)?)?)?$/.test(l))).toEqual([]);
   expect(Number(docker(['exec',name,'id','-u']).out)).toBeGreaterThan(0);
   // SIGTERM ends it promptly and cleanly
   const t1=Date.now(),stopped=docker(['stop','-t','20',name]);expect(stopped.ok).toBe(true);
   const stopMs=Date.now()-t1;console.log('MJ-BV01 container stop',JSON.stringify({stopMs}));
   expect(stopMs,'docker stop must not wait for SIGKILL').toBeLessThan(10_000);
   expect(docker(['inspect','--format','{{.State.Running}} {{.State.ExitCode}}',name]).out).toBe('false 0');
  }finally{docker(['rm','-f',name]);}
  expect(docker(['ps','-a','-q','--filter',`label=${LABEL}=${runId}`]).out).toBe('');
 },1_500_000);
});

// WEB05 actual worker + local Docker named volume. Never counted as native-amd64 or public HTTPS.
describe.skipIf(!dockerUp||!image)('persistent mobile/cell image',()=>{
 test('compiles mobile, excludes a competing container, recovers committed active chunks and replays a finished cell',async()=>{
  const evidenceOut=process.env.LAB_WEB05_EVIDENCE_DIR?resolve(process.env.LAB_WEB05_EVIDENCE_DIR):undefined;if(evidenceOut)await mkdir(evidenceOut,{recursive:false});
  const invocationId=randomUUID(),observations:Record<string,any>[]=[],refs:Record<string,string>={},bodies=new WeakMap<object,string>();let key='',token='';
  const redact=(v:any):any=>Array.isArray(v)?v.map(redact):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/^(token|sessionToken|csrfToken|reclaimToken|proof|authorization|cookie|password|secret|credentials|accessKey)$/i.test(k)?'[redacted]':redact(x)])):typeof v==='string'?[key,token].filter(Boolean).reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),v):v;
  const observe=(o:Record<string,any>)=>{const id='observation-'+observations.length;observations.push({...redact(o),id,sequence:observations.length});return id;};
  const command=(ref:string,args:string[],env?:Record<string,string>)=>{const startedAtEpochMs=Date.now(),r=docker(args,env);refs[ref]=observe({kind:'command',command:'docker',args,startedAtEpochMs,finishedAtEpochMs:Date.now(),exitCode:r.exitCode,signal:r.signal,stdout:r.out,stderr:r.err});return r;};
  const bind=(ref:string,body:object)=>{refs[ref]=bodies.get(body)!;};
  const retain=async()=>{if(!evidenceOut)return;await writeFile(join(evidenceOut,'lifecycle-observations.json'),JSON.stringify({invocationId,observations},null,2));try{await writeFile(join(evidenceOut,'web05.json'),JSON.stringify({version:2,accepted:false,execution:'actual_container',invocationId,sourceCommit:head,incomplete:true,observations:refs},null,2),{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}};
  try{
  const name=`mekoniq-b09-${runId.slice(0,8)}`,contender=name+'-contender',volume=name+'-runs';names.push(name,contender);volumes.push(volume);
  expect(docker(['volume','create','--label',`${LABEL}=${runId}`,volume]).ok).toBe(true);
  const port=await freePort();key=randomBytes(24).toString('hex');
  const inspected=JSON.parse(docker(['image','inspect',image]).out)[0],imageId=inspected.Id;command('image',['image','inspect',imageId]);
  const env={MEKONIQ_LAB_ACCESS_KEY:key},common=['--read-only','--tmpfs','/tmp','-v',`${volume}:/data/runs`,'-e','LAB_DATA_DIR=/data/runs','-e','MEKONIQ_LAB_ACCESS_KEY'];
  expect(docker(['run','-d','--name',name,'--label',`${LABEL}=${runId}`,...common,'-p',`127.0.0.1:${port}:8080`,'-e',`LAB_PUBLIC_HOST=127.0.0.1:${port}`,'-e',`LAB_ALLOW_ORIGIN=${ORIGIN}`,imageId],env).ok).toBe(true);
  command('container',['inspect',name]);
  const api=async(path:string,body?:unknown)=>{const startedAtEpochMs=Date.now();const r=await fetch(`http://127.0.0.1:${port}/lab/v2${path}`,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(60_000),headers:{origin:ORIGIN,'content-type':'application/json',...token?{authorization:`Bearer ${token}`} :{}},...body!==undefined?{body:JSON.stringify(body)}:{}});const response=await r.json() as Record<string,any>;const id=observe({kind:'http',path,method:body===undefined?'GET':'POST',request:body,response,status:r.status,startedAtEpochMs,finishedAtEpochMs:Date.now()});bodies.set(response,id);return {status:r.status,body:response};};
  const healthy=async()=>{for(let n=0;n<120;n++){try{const r=await api('/health');if(r.status===200)return r.body;}catch{/* owned container may still be starting */}await sleep(500);}throw Error('HEALTH_TIMEOUT');};
  const ok=async(path:string,body?:unknown)=>{const r=await api(path,body);expect(r.status,JSON.stringify(r.body).slice(0,700)).toBeLessThan(300);return r.body;};
  const health=await healthy();bind('health',health);expect(health.sourceCommit,'IMAGE_STALE').toBe(head);expect(health.engineeringCompilerProfiles).toEqual(['engineering-mujoco-3d-v1']);token=(await ok('/sessions',{token:key})).sessionToken;
  const runtimeIdentity={sourceCommit:health.sourceCommit,schemaHash:health.schemaHash};
  const project=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/serve-payload-v1/serve-3d-project.json','utf8'));project.requestedProfile='engineering-mujoco-3d-v1';
  const receipt=await ok('/engineering/compile',{project});expect(receipt.state).toBe('compiled');const engineeringRef={bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest};
  const readiness=await ok('/readiness',{scenarioId:'MJ-FD01',backendSetId:'engineering-mujoco-3d-v1',engineeringRef});expect(readiness.canStart).toBe(true);
  const mobile=await ok('/runs',{engineeringRef,scenarioId:'MJ-FD01',backendSetId:'engineering-mujoco-3d-v1',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',runtimeIdentity});
  const action=async(view:Record<string,any>,kind:string,payload:Record<string,unknown>={})=>ok(`/runs/${view.run.id}/actions`,{actionId:randomUUID(),expectedRevision:view.run.runRevision,kind,payload});
  const moved=await action(await action(mobile,'start'),'step',{ticks:100});expect(moved.tick).toBe(100);const mobileReport=await ok(`/runs/${mobile.run.id}/report`);expect(mobileReport.manifest.backends.some((b:{id:string})=>b.id==='mujoco_3d')).toBe(true);expect(mobileReport.physicsEvidence.manifest.identity.runId).toBe(mobile.run.id);await ok(`/runs/${mobile.run.id}/archive`,{});
  const cellProject=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json','utf8'));
  const createCell=()=>ok('/runs',{project:cellProject,scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',runtimeIdentity});
  const finished=await createCell();let view=await action(finished,'start');while(['running','created','paused'].includes(view.run.status)){if(view.tick>30000)throw Error('CELL_STEP_LIMIT');view=await action(view,'step',{ticks:100});}expect(view.run.status).toBe('completed');const finishedReport=await ok(`/runs/${finished.run.id}/report`);bind('finished',finishedReport);await ok(`/runs/${finished.run.id}/archive`,{});
  const active=await createCell(),stepped=await action(await action(active,'start'),'step',{ticks:100});expect(stepped.tick).toBe(100);const before=await ok(`/runs/${active.run.id}/report`);bind('before',before);
  const committedFiles=(id:string,ref:string)=>{const result=command(ref,['exec',name,'node','-e',CHUNK_PROGRAM,id]);expect(result.ok,result.err).toBe(true);return JSON.parse(result.out);};
  const committed=committedFiles(active.run.id,'chunksBefore');expect(Object.keys(committed).length).toBeGreaterThan(0);

  expect(command('contenderStart',['run','-d','--name',contender,'--label',`${LABEL}=${runId}`,...common,imageId],env).ok).toBe(true);expect(command('contenderWait',['wait',contender]).out).toBe('1');const contenderLogs=command('contenderLogs',['logs','--tail','20',contender]);expect(contenderLogs.out+'\n'+contenderLogs.err).toContain('LAB_DATA_DIR_BUSY');
  expect(command('kill',['kill','--signal','KILL',name]).ok).toBe(true);expect(command('restart',['start',name]).ok).toBe(true);const healthAfter=await healthy();bind('healthAfter',healthAfter);token=(await ok('/sessions',{token:key})).sessionToken;
  const reclaimed=await ok(`/runs/${active.run.id}/reclaim`,{proof:active.reclaimToken});bind('reclaim',reclaimed);expect(reclaimed.controlAccess).toBe('view_reconcile');expect(reclaimed.tick).toBe(100);expect(reclaimed.run.status).toBe('needs_attention');const after=await ok(`/runs/${active.run.id}/report`);bind('after',after);expect(after.outcome.tick).toBe(before.outcome.tick);const committedAfter=committedFiles(active.run.id,'chunksAfter');expect(committedAfter).toEqual(committed);const resume=await api(`/runs/${active.run.id}/actions`,{actionId:'resume-refused',expectedRevision:reclaimed.run.runRevision,kind:'resume',payload:{}});bind('resume',resume.body);expect(resume.status).toBe(403);expect(resume.body.error).toBe('RECLAIM_READ_ONLY');
  const workers=command('workers',['exec',name,'node','-e',WORKER_PROGRAM]);expect(workers.out).toBe('0');
  await ok(`/runs/${active.run.id}/archive`,{});await ok(`/runs/${finished.run.id}/reclaim`,{proof:finished.reclaimToken});const replay=await ok(`/runs/${finished.run.id}/replay`,{});bind('replay',replay);expect(replay.manifest.provenance.accepted).toBe(false);expect(replay.manifest.assets.length).toBeGreaterThan(0);
  const downloaded=await fetch(`http://127.0.0.1:${port}/lab/v2/runs/${finished.run.id}/replay/${replay.exportId}/assets/0`,{headers:{authorization:`Bearer ${token}`,origin:ORIGIN}});expect(downloaded.status).toBe(200);expect((await downloaded.arrayBuffer()).byteLength).toBe(replay.manifest.assets[0].bytes);
  if(process.env.LAB_WEB05_EVIDENCE_DIR){
   const out=evidenceOut!;const imageIdentity={id:inspected.Id,sourceCommit:inspected.Config.Labels['org.opencontainers.image.revision'],os:inspected.Os,architecture:inspected.Architecture};
   const records={'health.json':health,'before-crash-report.json':before,'after-crash-report.json':after,'finished-report.json':finishedReport,'committed-before.json':committed,'committed-after.json':committedAfter,'replay-manifest.json':replay.manifest,'image-inspect.json':inspected,'lifecycle-observations.json':{invocationId,observations},'web05.json':{version:2,accepted:false,execution:'actual_container',invocationId,sourceCommit:head,schemaHash:health.schemaHash,image:imageIdentity,activeRunId:active.run.id,finishedRunId:finished.run.id,containerName:name,contenderName:contender,volumeName:volume,observations:refs}};for(const [file,value]of Object.entries(records))await writeFile(join(out,file),JSON.stringify(redact(value),null,2));
   const replayRoot=join(out,'replay');await mkdir(replayRoot);await writeFile(join(replayRoot,'manifest.json'),JSON.stringify(replay.manifest));for(const [index,asset]of replay.manifest.assets.entries()){const response=await fetch(`http://127.0.0.1:${port}/lab/v2/runs/${finished.run.id}/replay/${replay.exportId}/assets/${index}`,{headers:{authorization:`Bearer ${token}`,origin:ORIGIN}});expect(response.status).toBe(200);const bytes=Buffer.from(await response.arrayBuffer());await mkdir(join(replayRoot,asset.path,'..'),{recursive:true});await writeFile(join(replayRoot,asset.path),bytes);}
  }
  const stop=docker(['stop','-t','20',name]);expect(stop.ok).toBe(true);expect(docker(['inspect','--format','{{.State.ExitCode}}',name]).out).toBe('0');
  console.log('B09 WEB05',JSON.stringify({platform:docker(['image','inspect','--format','{{.Os}}/{{.Architecture}}',image]).out,sourceCommit:head,imageId:docker(['image','inspect','--format','{{.Id}}',image]).out,volumeRecovery:true,finishedReplay:true,accepted:false}));
  }finally{await retain();}
 },800_000);
});
