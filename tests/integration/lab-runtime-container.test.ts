/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from the wire, checked by the assertions below */
// N04 (D59, SX-48, RT05): the Lab runtime image runs headless with the mock backends and the MuJoCo arm; MJ-BV01 completes inside it, driven only through the public HTTP API.
// Not a gate proof for G-MA1/G-MA2 (D50): it shows that the image runs. Skipped (never failed or passed) where `docker info` fails or LAB_CONTAINER_IMAGE is not set.
// Run: LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:dev pnpm test:integration -- tests/integration/lab-runtime-container.test.ts   (build: deploy/lab-runtime/build.sh mekoniq-lab-runtime:dev)
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {afterAll,describe,expect,test} from 'vitest';
import {xarmProject} from '../support/mujoco-arm';

const image=process.env.LAB_CONTAINER_IMAGE??'',LABEL='mekoniq-lab-container-test',ORIGIN='http://127.0.0.1:4175';
const docker=(args:string[],env?:Record<string,string>)=>{const r=spawnSync('docker',args,{encoding:'utf8',env:{...process.env,...env},timeout:120_000});return {ok:r.status===0,out:(r.stdout??'').trim(),err:(r.stderr??'').trim()};};
const dockerUp=(()=>{try{execFileSync('docker',['info'],{stdio:'ignore',timeout:20_000});return true;}catch{return false;}})();
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const freePort=()=>new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>resolve(p));});});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const runId=randomUUID(),names:string[]=[];
afterAll(()=>{for(const n of names)docker(['rm','-f',n]);});

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
    if(!health){if(docker(['inspect','--format','{{.State.Running}}',name]).out!=='true')throw new Error(`CONTAINER_EXITED: ${docker(['logs','--tail','20',name]).err.replaceAll(key,'<key>')}`);await sleep(500);}
   }
   if(!health)throw new Error(`HEALTH_TIMEOUT: ${docker(['logs','--tail','20',name]).err.replaceAll(key,'<key>')}`);
   if(health.sourceCommit!==head)throw new Error(`IMAGE_STALE: the image was built from ${health.sourceCommit}, the repository HEAD is ${head}; commit, then rebuild with deploy/lab-runtime/build.sh ${image}`);
   const backend=(id:string)=>health!.backends.find(b=>b.id===id);
   expect(backend('mujoco_arm')).toMatchObject({installed:true,reachable:true});
   expect(health.backends.filter(b=>b.installed).map(b=>b.id).sort()).toEqual(['mock_amr','mock_arm','mock_coffee','mujoco_arm']);
   for(const id of ['webots_3d','irsim_2d'])expect(backend(id)?.installed??false,id).toBe(false);
   expect(health.deployment.bind).toBe('public');
   // wrong key refused; the key pairs; the run goes through the bearer token only
   expect((await api('/sessions',{method:'POST',body:{token:'x'.repeat(40)}})).status).toBe(401);
   const paired=await api('/sessions',{method:'POST',body:{token:key}});expect(paired.status).toBe(201);
   const token=paired.body.sessionToken as string;
   // the robot asset (service-robot-asset@1) has no public way into a run: the gateway resolves assets only for engineering bundles, so the docked robot is not in ARM03 here
   const created=await api('/runs',{method:'POST',token,body:{project:xarmProject(),scenarioId:'MJ-BV01',scenarioRevision:1,seed:42,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-arm-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}}});
   expect(created.status,JSON.stringify(created.body).slice(0,300)).toBe(201);
   const url=`/runs/${created.body.run.id}`;let rev=created.body.run.runRevision as number,n=0;
   const act=async(kind:string,payload:Record<string,unknown>)=>{const r=await api(`${url}/actions`,{method:'POST',token,body:{actionId:`a-${++n}`,expectedRevision:rev,kind,payload}});expect(r.status,JSON.stringify(r.body).slice(0,300)).toBe(200);rev=r.body.run.runRevision;return r.body;};
   let view=await act('start',{});const t0=Date.now();
   while(view.run.status==='running'||view.run.status==='created'||view.run.status==='paused'){if(view.tick>6000)throw new Error(`STEP_LIMIT at ${view.tick}`);view=await act('step',{ticks:50});}
   const wallMs=Date.now()-t0;
   console.log('MJ-BV01 container',JSON.stringify({image,platform:docker(['image','inspect','--format','{{.Os}}/{{.Architecture}}',image]).out,finalTick:view.tick,wallMs,msPerTick:+(wallMs/view.tick).toFixed(3),status:view.run.status}));
   const report=(await api(`${url}/report`,{token})).body as Record<string,any>;
   if(view.run.status!=='completed')console.log('MJ-BV01 container NOT COMPLETED',JSON.stringify({tick:view.tick,outcome:report.outcome,attention:report.attention,arm:{...report.arm,trace:undefined,props:undefined,collision:undefined},coffee:report.coffee?.cups,logs:docker(['logs','--tail','15',name]).err.replaceAll(key,'<key>')}).slice(0,6000));
   expect(report.outcome).toMatchObject({status:'completed',served:'2'});
   expect(report.manifest).toMatchObject({scenario:{id:'MJ-BV01'},backendSetId:'engineering-mujoco-arm-v1',calibration:{status:'not_calibrated'}});
   expect(report.arm.armPlant).toMatchObject({engine:'mujoco_3d',calibration:'not_calibrated'});
   // nothing written outside /tmp (read-only root + empty diff; OrbStack alone adds its CA certificate under /usr/local/share/ca-certificates at container start), not root
   expect(docker(['diff',name]).out.split('\n').filter(l=>l&&!/^[CA] \/usr(\/local(\/share(\/ca-certificates(\/orbstack-root\.crt)?)?)?)?$/.test(l))).toEqual([]);
   expect(Number(docker(['exec',name,'id','-u']).out)).toBeGreaterThan(0);
   // SIGTERM ends it promptly and cleanly
   const t1=Date.now(),stopped=docker(['stop','-t','20',name]);expect(stopped.ok).toBe(true);
   expect(Date.now()-t1,'docker stop must not wait for SIGKILL').toBeLessThan(10_000);
   expect(docker(['inspect','--format','{{.State.Running}} {{.State.ExitCode}}',name]).out).toBe('false 0');
  }finally{docker(['rm','-f',name]);}
  expect(docker(['ps','-a','-q','--filter',`label=${LABEL}=${runId}`]).out).toBe('');
 },1_500_000);
});
