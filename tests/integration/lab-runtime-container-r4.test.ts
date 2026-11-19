/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from the wire, checked by the assertions below */
// CLD01 for R4.1 (plan V05): the shared-world cell with a virtual drive (drive-nominal-v1) completes and serves 2 inside the Lab runtime image, driven only through the public HTTP API.
// Skipped (never failed or passed) where `docker info` fails or LAB_CONTAINER_IMAGE is not set; an image built from another commit than HEAD is refused with IMAGE_STALE. Later R4 batches add cases here.
// Run: LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:r4 pnpm test:integration -- tests/integration/lab-runtime-container-r4.test.ts   (build: deploy/lab-runtime/build.sh mekoniq-lab-runtime:r4 --platform linux/arm64)
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {afterAll,describe,expect,test} from 'vitest';

const image=process.env.LAB_CONTAINER_IMAGE??'',LABEL='mekoniq-lab-container-test',ORIGIN='http://127.0.0.1:4175';
const docker=(args:string[],env?:Record<string,string>)=>{const r=spawnSync('docker',args,{encoding:'utf8',env:{...process.env,...env},timeout:120_000,killSignal:'SIGKILL'});return {exitCode:r.status,ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const dockerUp=!!image&&(()=>{try{execFileSync('docker',['info'],{stdio:'ignore',timeout:15_000,killSignal:'SIGKILL'});return true;}catch{return false;}})();
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const freePort=()=>new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const runId=randomUUID(),names:string[]=[];
afterAll(()=>{for(const n of names)docker(['rm','-f',n]);});

describe.skipIf(!dockerUp||!image)('lab runtime container, R4.1',()=>{
 test('CLD01: MJ-CELL-BV01 on drive-nominal-v1 completes and serves 2 inside the image; read-only root, empty diff, not root, ports on 127.0.0.1 only',async()=>{
  const inspected=docker(['image','inspect','--format','{{.Id}}',image]);
  if(!inspected.ok)throw new Error(`IMAGE_MISSING: ${image} does not exist locally; build it with deploy/lab-runtime/build.sh ${image}`);
  let port=await freePort();while(port===1880||port===1884)port=await freePort();
  const key=randomBytes(20).toString('hex'),name=`mekoniq-lab-r4-${runId.slice(0,8)}`;names.push(name);
  try{
   // the key only through the environment of the docker client (`-e NAME` copies it), never on a command line, never printed
   const started=docker(['run','-d','--name',name,'--label',`${LABEL}=${runId}`,'--read-only','--tmpfs','/tmp','-p',`127.0.0.1:${port}:${port}`,'-e',`PORT=${port}`,'-e','MEKONIQ_LAB_ACCESS_KEY','-e',`LAB_PUBLIC_HOST=127.0.0.1:${port}`,'-e',`LAB_ALLOW_ORIGIN=${ORIGIN}`,'-e','LAB_DATA_DIR=/tmp/runs',image],{MEKONIQ_LAB_ACCESS_KEY:key});
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
   if(health.sourceCommit!==head)throw new Error(`IMAGE_STALE: the image was built from ${health.sourceCommit}, the repository HEAD is ${head}; commit, then rebuild with deploy/lab-runtime/build.sh ${image}`);
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
   console.log('MJ-CELL-BV01 drive container',JSON.stringify({image,platform:docker(['image','inspect','--format','{{.Os}}/{{.Architecture}}',image]).out,finalTick:view.tick,wallMs,msPerTick:+(wallMs/view.tick).toFixed(3),status:view.run.status}));
   const report=(await api(`${url}/report`,{token})).body as Record<string,any>;
   if(view.run.status!=='completed')console.log('NOT COMPLETED',JSON.stringify({outcome:report.outcome,attention:report.attention,drive:report.driveEvidence?.events}).slice(0,3000),docker(['logs','--tail','20',name]).out.replaceAll(key,'<key>'));
   expect(report.outcome).toMatchObject({status:'completed',served:'2'});
   expect(report.manifest.drive).toMatchObject({testLevel:'controller_in_the_loop',experimentId:'drive-nominal-v1'});
   expect(report.driveEvidence).toMatchObject({testLevel:'controller_in_the_loop',complete:true,issues:[]});expect(report.driveEvidence.axes).toHaveLength(9);
   expect(report.driveEvidence.axes.every((a:{faults:unknown[]})=>a.faults.length===0)).toBe(true);
   // nothing written outside /tmp (read-only root + empty diff; OrbStack alone adds its CA certificate under /usr/local/share/ca-certificates at container start), not root
   expect(docker(['diff',name]).out.split('\n').filter(l=>l&&!/^[CA] \/usr(\/local(\/share(\/ca-certificates(\/orbstack-root\.crt)?)?)?)?$/.test(l))).toEqual([]);
   expect(Number(docker(['exec',name,'id','-u']).out)).toBeGreaterThan(0);
   const stopped=docker(['stop','-t','20',name]);expect(stopped.ok).toBe(true);expect(docker(['inspect','--format','{{.State.Running}} {{.State.ExitCode}}',name]).out).toBe('false 0');
  }finally{docker(['rm','-f',name]);}
  expect(docker(['ps','-a','-q','--filter',`label=${LABEL}=${runId}`]).out).toBe('');
 },1_800_000);
});
