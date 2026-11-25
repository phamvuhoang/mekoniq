/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from the wire, checked by the assertions below */
// CLD04 (R5.4): inside the Lab runtime image the three hardware options compile through the public API and their bundle bodies equal what the CLI compiles on the host,
// and a scheduled emergency stop (S1, brake off = coast) runs on the real MuJoCo worker and ends in needs_attention with EMERGENCY_STOP at the tick the schedule names.
// Skipped (never failed or passed) where `docker info` fails or LAB_CONTAINER_IMAGE is not set. Run:
//   LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:r5 pnpm test:integration -- tests/integration/r5-container.test.ts   (build: deploy/lab-runtime/build.sh mekoniq-lab-runtime:r5 --platform linux/arm64)
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,describe,expect,test} from 'vitest';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
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
/** What does not depend on the project the bundle was compiled against: the body a host and a container must agree on. */
const body=(b:any)=>hashJson({allocation:b.allocation,netlist:b.netlist,checks:b.checks,bom:b.bom,driveModelDraft:b.driveModelDraft,state:b.state});

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
  const project={...JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/serve-tray-v1/serve-3d-project.json','utf8')),requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:'tray-stop-coast-v1'};
  const compiled=await api('/engineering/compile',{method:'POST',token,body:{project}});
  expect(compiled.status,JSON.stringify(compiled.body).slice(0,400)).toBe(200);expect(compiled.body.state).toBe('compiled');
  const ref={bundleDigest:compiled.body.bundleDigest,projectDigest:compiled.body.projectDigest};
  const dir=await mkdtemp(join(tmpdir(),'r5-cld04-')),inContainer:Record<string,{state:string;body:string}>={};
  try{
   for(const id of OPTIONS){
    const design=JSON.parse(await readFile(`robotics/catalog/electrical/${id}.json`,'utf8'));
    const receipt=await api('/engineering/electrical',{method:'POST',token,body:{ref,design}});expect(receipt.status,JSON.stringify(receipt.body).slice(0,300)).toBe(200);
    const bundle=await api(`/engineering/electrical/${receipt.body.digest}`,{token});expect(bundle.status).toBe(200);
    inContainer[id]={state:bundle.body.state,body:body(bundle.body)};
    // the host: the same design compiled by the CLI against the same catalog
    // the CLI writes the bundle for a blocked option too and then exits 1
    spawnSync(process.execPath,['scripts/lab-hardware.mjs','compile','--design',`robotics/catalog/electrical/${id}.json`,'--out',join(dir,id)],{stdio:'ignore',timeout:120_000});
    const host=JSON.parse(await readFile(join(dir,id,'electrical-bundle.json'),'utf8'));
    expect(inContainer[id]!.state,id).toBe(host.state);
    expect(inContainer[id]!.body,`${id}: the bundle body must equal the host's`).toBe(body(host));
   }
   expect(OPTIONS.map(o=>inContainer[o]!.state)).toEqual(['blocked','compiled','compiled']);
   // S1 emergency + coast: the worker applies the stop before the command channel and the run needs attention at the scheduled tick
   const entry={id:'s1',function:'emergency',trigger:{kind:'elapsed_sim_ms',value:8220}};
   const created=await api('/runs',{method:'POST',token,body:{engineeringRef:ref,scenarioId:'MJ-TRAY01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash},stopSchedule:[entry]}});
   expect(created.status,JSON.stringify(created.body).slice(0,400)).toBe(201);
   const url=`/runs/${created.body.run.id}`;let rev=created.body.run.runRevision as number,n=0;
   const act=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${url}/actions`,{method:'POST',token,body:{actionId:`s-${++n}`,expectedRevision:rev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);rev=r.body.run.runRevision;return r.body;};
   let view=await act('start',{});
   while(['running','awaiting_confirmation','created','paused'].includes(view.run.status)){if(view.tick>30000)throw new Error(`STEP_LIMIT at ${view.tick}`);view=await act('step',{ticks:250});}
   const report=(await api(`${url}/report`,{token})).body;
   expect(report.outcome.status).toBe('needs_attention');
   expect(report.attention.map((a:{reason:string;tick:number})=>a.reason)).toContain('EMERGENCY_STOP');
   expect(report.attention.find((a:{reason:string})=>a.reason==='EMERGENCY_STOP').tick).toBeGreaterThanOrEqual(411);
   expect(report.manifest.stopSchedule.entries).toEqual([entry]);
   expect(report.outcome.served).toBe('0');
   // nothing written outside /tmp (read-only root + empty diff; OrbStack alone adds its CA certificate at container start), and the process is not root
   expect(docker(['diff',name]).out.split('\n').filter(l=>l&&!/^[CA] \/usr(\/local(\/share(\/ca-certificates(\/orbstack-root\.crt)?)?)?)?$/.test(l))).toEqual([]);
   expect(docker(['exec',name,'id','-u']).out).not.toBe('0');
   const evidence={schemaVersion:1,image,imageId:info.Id,platform:info.Os+'/'+info.Architecture,sourceCommit:head,schemaHash:health.schemaHash,options:inContainer,stop:{entry,function:'emergency',tick:report.attention.find((a:{reason:string})=>a.reason==='EMERGENCY_STOP').tick,status:report.outcome.status,served:report.outcome.served},diffEmpty:true,rootUid:'not 0'};
   console.log('CLD04',JSON.stringify(evidence));
   if(process.env.LAB_CLD04_OUT)await writeFile(process.env.LAB_CLD04_OUT,JSON.stringify(evidence,null,2)+'\n');
  }finally{await rm(dir,{recursive:true,force:true});}
 },1_800_000);
});
