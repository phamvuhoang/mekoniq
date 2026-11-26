/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from the wire, checked by the assertions below */
// CLD04 (R5.4) and the native x86-64 half of CLD05: inside the Lab runtime image the three hardware options compile through the public API against the same project as the host,
// and their FULL bundle digests equal what the host compiles from the same project and electrical inputs (scripts/r5-readback.mjs recompiles them again from the recorded project).
// A scheduled emergency stop (S1, coast) runs on the real MuJoCo worker; the run needs attention with EMERGENCY_STOP at exactly the tick the schedule names (stopStartTick), and
// the runner only records that attention after the worker's receipt matched that tick.
// Skipped (never failed or passed) where `docker info` fails or LAB_CONTAINER_IMAGE is not set. Run:
//   LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:r5 pnpm test:integration -- tests/integration/r5-container.test.ts   (build: deploy/lab-runtime/build.sh mekoniq-lab-runtime:r5 --platform linux/arm64)
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {copyFile,readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,describe,expect,test} from 'vitest';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {compileDesignFile} from '../../packages/lab-runtime/src/engineering/electrical/offline';
import {stopStartTick} from '../../packages/lab-runtime/src/v2/control/stop-functions';
import {sourceCommit as repoSourceCommit} from '../../scripts/repo-identity.mjs';

const image=process.env.LAB_CONTAINER_IMAGE??'',LABEL='mekoniq-lab-container-test',ORIGIN='http://127.0.0.1:4175';
const docker=(args:string[],env?:Record<string,string>)=>{const r=spawnSync('docker',args,{encoding:'utf8',env:{...process.env,...env},timeout:120_000,killSignal:'SIGKILL'});return {exitCode:r.status,ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const dockerUp=!!image&&(()=>{try{execFileSync('docker',['info'],{stdio:'ignore',timeout:15_000,killSignal:'SIGKILL'});return true;}catch{return false;}})();
const head=repoSourceCommit('.');
const freePort=()=>new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const names:string[]=[],runId=randomUUID();
afterAll(()=>{for(const n of names)docker(['rm','-f',n]);});
const OPTIONS=['serve-hw-a-v1','serve-hw-b-v1','serve-hw-c-v1'] as const;
/** The project both sides compile against: the Serve tray fixture with the MuJoCo profile and the S1 coast experiment (scripts/r5-readback.mjs rebuilds it from these two fields). */
const FIXTURE='robotics/simulation-mujoco/fixtures/serve-tray-v1',OVERRIDES={requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:'tray-stop-coast-v1'};

describe.skipIf(!dockerUp||!image)('lab runtime container, R5.4',()=>{
 test('CLD04: three options compile in the image and equal the host; an emergency stop applies at its tick on the real worker; read-only root, empty diff, not root',async()=>{
  const inspected=docker(['image','inspect',image]);if(!inspected.ok)throw new Error(`IMAGE_MISSING: ${image}`);
  const [info]=JSON.parse(inspected.out);
  expect(info.Config.Labels['org.opencontainers.image.revision']).toBe(head);
  let port=await freePort();while([1880,1884,4175,4176].includes(port))port=await freePort();
  const key=randomBytes(20).toString('hex'),name=`mekoniq-lab-r5-${runId.slice(0,8)}`;names.push(name);
  const started=docker(['run','-d','--name',name,'--label',`${LABEL}=${runId}`,'--read-only','--tmpfs','/tmp','-p',`127.0.0.1:${port}:${port}`,'-e',`PORT=${port}`,'-e','MEKONIQ_LAB_ACCESS_KEY','-e',`LAB_PUBLIC_HOST=127.0.0.1:${port}`,'-e',`LAB_ALLOW_ORIGIN=${ORIGIN}`,'-e','LAB_DATA_DIR=/tmp/runs',info.Id],{MEKONIQ_LAB_ACCESS_KEY:key});
  if(!started.ok)throw new Error(`CONTAINER_START_FAILED: ${started.err.replaceAll(key,'<key>')}`);
  expect(docker(['port',name]).out.split('\n').every(l=>l.includes('127.0.0.1:'))).toBe(true);
  const base=`http://127.0.0.1:${port}/lab/v2`;
  const api=async(path:string,init:{method?:string;token?:string;body?:unknown}={})=>{
   const r=await fetch(base+path,{method:init.method??'GET',headers:{Origin:ORIGIN,...init.body!==undefined?{'Content-Type':'application/json'}:{},...init.token?{Authorization:`Bearer ${init.token}`}:{}},...init.body!==undefined?{body:JSON.stringify(init.body)}:{}});
   return {status:r.status,body:await r.json() as Record<string,any>};
  };
  let health:Record<string,any>|undefined;
  for(const deadline=Date.now()+120_000;!health&&Date.now()<deadline;){
   try{const r=await api('/health');if(r.status===200)health=r.body;}catch{/* not listening yet */}
   if(!health){if(docker(['inspect','--format','{{.State.Running}}',name]).out!=='true')throw new Error(`CONTAINER_EXITED: ${docker(['logs','--tail','20',name]).out.replaceAll(key,'<key>')}`);await sleep(500);}
  }
  if(!health)throw new Error('HEALTH_TIMEOUT');
  expect(health.sourceCommit).toBe(head);expect(health.capabilities).toContain('electrical_bundle_v1');
  const token=(await api('/sessions',{method:'POST',body:{token:key}})).body.sessionToken as string;
  // the electrical designs bind to the Serve tray project; the image compiles it with the MuJoCo profile
  const project={...JSON.parse(await readFile(`${FIXTURE}/serve-3d-project.json`,'utf8')),...OVERRIDES},projectDigest=hashJson(project);
  const compiled=await api('/engineering/compile',{method:'POST',token,body:{project}});
  expect(compiled.status,JSON.stringify(compiled.body).slice(0,400)).toBe(200);expect(compiled.body.state).toBe('compiled');expect(compiled.body.projectDigest).toBe(projectDigest);
  const ref={bundleDigest:compiled.body.bundleDigest,projectDigest:compiled.body.projectDigest};
  // the host compiles the same project (written beside the fixture's components) with the same designs, catalog, policy and drive base
  const dir=await mkdtemp(join(tmpdir(),'r5-cld04-')),inContainer:Record<string,{state:string;digest:string;projectDigest:string;assemblyDigest:string}>={};
  try{
   await writeFile(join(dir,'serve-3d-project.json'),JSON.stringify(project));await copyFile(`${FIXTURE}/serve-3d-components.json`,join(dir,'serve-3d-components.json'));
   for(const id of OPTIONS){
    const design=JSON.parse(await readFile(`robotics/catalog/electrical/${id}.json`,'utf8'));
    const receipt=await api('/engineering/electrical',{method:'POST',token,body:{ref,design}});expect(receipt.status,JSON.stringify(receipt.body).slice(0,300)).toBe(200);
    const bundle=await api(`/engineering/electrical/${receipt.body.digest}`,{token});expect(bundle.status).toBe(200);expect(bundle.body.digest).toBe(receipt.body.digest);
    inContainer[id]={state:bundle.body.state,digest:bundle.body.digest,projectDigest:bundle.body.inputs.project.digest,assemblyDigest:bundle.body.inputs.assemblyDigest};
    const host=(await compileDesignFile({design:`robotics/catalog/electrical/${id}.json`,catalogRoot:'robotics/catalog',root:'.',projectDir:dir})).bundle!;
    expect(inContainer[id]!.state,id).toBe(host.state);expect(inContainer[id]!.projectDigest,id).toBe(projectDigest);
    expect(inContainer[id]!.digest,`${id}: the full bundle digest must equal the host's`).toBe(host.digest);
   }
   expect(OPTIONS.map(o=>inContainer[o]!.state)).toEqual(['blocked','compiled','compiled']);
   // S1 emergency + coast: the worker applies the stop before the command channel and the run needs attention at the scheduled tick
   const entry={id:'s1',function:'emergency' as const,trigger:{kind:'elapsed_sim_ms' as const,value:8220}},scheduledTick=stopStartTick(entry);
   expect(scheduledTick).toBe(412);
   const created=await api('/runs',{method:'POST',token,body:{engineeringRef:ref,scenarioId:'MJ-TRAY01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash},stopSchedule:[entry]}});
   expect(created.status,JSON.stringify(created.body).slice(0,400)).toBe(201);
   const url=`/runs/${created.body.run.id}`;let rev=created.body.run.runRevision as number,n=0;
   const act=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${url}/actions`,{method:'POST',token,body:{actionId:`s-${++n}`,expectedRevision:rev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);rev=r.body.run.runRevision;return r.body;};
   let view=await act('start',{});
   while(['running','awaiting_confirmation','created','paused'].includes(view.run.status)){if(view.tick>30000)throw new Error(`STEP_LIMIT at ${view.tick}`);view=await act('step',{ticks:250});}
   const report=(await api(`${url}/report`,{token})).body;
   expect(report.outcome.status).toBe('needs_attention');
   expect(report.attention.map((a:{reason:string;tick:number})=>a.reason)).toContain('EMERGENCY_STOP');
   // the runner records EMERGENCY_STOP only on the step whose worker receipt matched the intent's tick (stopReceiptsMatch), so this is the receipt's tick
   const stopTick=report.attention.find((a:{reason:string})=>a.reason==='EMERGENCY_STOP').tick;
   expect(stopTick).toBe(scheduledTick);
   expect(report.manifest.stopSchedule.entries).toEqual([entry]);
   expect(report.outcome.served).toBe('0');
   // nothing written outside /tmp (read-only root + empty diff; OrbStack alone adds its CA certificate at container start), and the process is not root
   const diff=docker(['diff',name]).out.split('\n').filter(Boolean),unexpected=diff.filter(l=>!/^[CA] \/usr(\/local(\/share(\/ca-certificates(\/orbstack-root\.crt)?)?)?)?$/.test(l));
   expect(unexpected).toEqual([]);
   const uid=docker(['exec',name,'id','-u']).out;expect(uid).toMatch(/^[0-9]+$/);expect(uid).not.toBe('0');
   const m=report.manifest,stop={entry,function:'emergency',scheduledTick,tick:stopTick,status:report.outcome.status,served:report.outcome.served,outcomeTick:report.outcome.tick,
    attention:report.attention.map((a:{reason:string;tick:number})=>({reason:a.reason,tick:a.tick})),scenario:m.scenario,seed:m.seed,stopScheduleHash:m.stopSchedule.hash,
    drive:{experimentId:m.drive?.experimentId,driveModelDigest:m.drive?.driveModelDigest,controlProfileDigest:m.drive?.controlProfileDigest,hostArch:m.drive?.hostArch}};
   const evidence={schemaVersion:2,image,imageId:info.Id,platform:info.Os+'/'+info.Architecture,host:{platform:process.platform,arch:process.arch},sourceCommit:head,schemaHash:health.schemaHash,
    project:{fixture:FIXTURE,overrides:OVERRIDES,digest:projectDigest},options:inContainer,stop,diff,diffEmpty:unexpected.length===0,uid};
   console.log('CLD04',JSON.stringify(evidence));
   if(process.env.LAB_CLD04_OUT)await writeFile(process.env.LAB_CLD04_OUT,JSON.stringify(evidence,null,2)+'\n');
  }finally{await rm(dir,{recursive:true,force:true});}
 },1_800_000);
});
