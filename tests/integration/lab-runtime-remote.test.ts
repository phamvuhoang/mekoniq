import {afterAll,afterEach,beforeAll,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {startLabGateway,type LabGateway,type GatewayOptions} from '../../packages/lab-runtime/src/gateway';
import {restaurant} from '../support/lab-v2';
// N01 (D53–D55): a web-hosted Lab reaches a local or container runtime with a bearer session; the defaults stay exactly as before.
const loopback='http://127.0.0.1:4175',remote='https://lab.example',hash='a'.repeat(64),key='k'.repeat(40);
const gateways:LabGateway[]=[],dirs:string[]=[],aborts:AbortController[]=[];
afterEach(async()=>{for(const a of aborts.splice(0))a.abort();for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{force:true,recursive:true});});
async function setup(options:Partial<GatewayOptions>={}){const directory=await mkdtemp(join(tmpdir(),'lab-remote-'));dirs.push(directory);const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:hash,v2:{enabledBackends:['mock_amr']},...options});gateways.push(g);return g;}
const refused=async(options:Partial<GatewayOptions>,code:string)=>{const directory=await mkdtemp(join(tmpdir(),'lab-remote-'));dirs.push(directory);await expect(startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:hash,...options})).rejects.toThrow(new RegExp(`^${code}$`));};
interface Res {status:number;headers:Record<string,string|string[]|undefined>;body:Record<string,unknown>;text:string}
/** node:http so Host and Origin are exactly what the test sets. */
function call(url:string,{method='GET',headers={},body}:{method?:string;headers?:Record<string,string>;body?:unknown}={}):Promise<Res>{
 return new Promise((resolve,reject)=>{const r=request(url,{method,headers:{...body!==undefined?{'Content-Type':'application/json'}:{},...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let parsed:Record<string,unknown>={};try{parsed=JSON.parse(text);}catch{/* empty */}resolve({status:res.statusCode!,headers:res.headers,body:parsed,text});});});r.on('error',reject);r.end(body===undefined?undefined:JSON.stringify(body));});
}
const pairWith=(g:LabGateway,token:string,origin=remote)=>call(g.url+'/lab/v2/sessions',{method:'POST',headers:{Origin:origin},body:{token}});
async function bearer(g:LabGateway,origin=remote){const r=await pairWith(g,g.issuePairingToken(),origin);expect(r.status).toBe(201);return r.body as {csrfToken:string;sessionToken:string;principal:unknown};}
const runBody={project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-amr',access:'simulated',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:hash}};
const readiness='/lab/v2/readiness?scenarioId=FD01&backendSetId=mock-amr';

test('defaults are unchanged: foreign origin and host refused, loopback origin keeps credentials, health adds only bearer and bind',async()=>{
 const g=await setup();
 expect(await call(g.url+'/lab/v2/health',{headers:{Origin:remote}})).toMatchObject({status:403,body:{error:'ORIGIN_FORBIDDEN'}});
 const port=new URL(g.url).port;
 expect(await call(g.url+'/lab/v2/health',{headers:{Host:'evil.example:4176'}})).toMatchObject({status:403,body:{error:'HOST_FORBIDDEN'}});
 expect((await call(g.url+'/lab/v2/health',{headers:{Host:`localhost:${port}`}})).status).toBe(403);
 const local=await call(g.url+'/lab/v2/health',{headers:{Origin:loopback}});
 expect(local.status).toBe(200);expect(local.headers).toMatchObject({'access-control-allow-origin':loopback,'access-control-allow-credentials':'true',vary:'Origin'});
 expect(local.body).toMatchObject({features:{polling:true,sse:true,readiness:true,bearer:true},deployment:{bind:'loopback'}});
 const pre=await call(g.url+'/lab/v2/sessions',{method:'OPTIONS',headers:{Origin:loopback,'Access-Control-Request-Method':'POST'}});
 expect(pre.status).toBe(204);expect(pre.headers['access-control-allow-credentials']).toBe('true');expect(pre.headers['access-control-allow-private-network']).toBeUndefined();
 // the cookie session keeps working and still needs its CSRF token
 const s=await pairWith(g,g.issuePairingToken(),loopback);expect(s.status).toBe(201);expect(s.headers['set-cookie']![0]).toMatch(/^mekoniq_lab_session_v2=/);
 expect(s.body.sessionToken).toBe(/^mekoniq_lab_session_v2=([^;]+)/.exec(s.headers['set-cookie']![0]!)![1]);
 const cookie=s.headers['set-cookie']![0]!.split(';')[0]!;
 expect(await call(g.url+'/lab/v2/runs',{method:'POST',headers:{Origin:loopback,Cookie:cookie},body:runBody})).toMatchObject({status:403,body:{error:'CSRF_INVALID'}});
 expect((await call(g.url+'/lab/v2/runs',{method:'POST',headers:{Origin:loopback,Cookie:cookie,'X-CSRF-Token':s.body.csrfToken as string},body:runBody})).status).toBe(201);
});

test('a configured origin gets an exact-match CORS answer without credentials; lookalikes and the legacy v1 routes are refused',async()=>{
 const g=await setup({allowOrigins:[remote]});
 const pre=await call(g.url+'/lab/v2/sessions',{method:'OPTIONS',headers:{Origin:remote,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
 expect(pre.status).toBe(204);expect(pre.headers['access-control-allow-origin']).toBe(remote);expect(pre.headers.vary).toBe('Origin');
 expect(String(pre.headers['access-control-allow-headers']).split(', ')).toEqual(['Content-Type','X-CSRF-Token','Authorization','Last-Event-ID']);
 expect(pre.headers['access-control-max-age']).toBe('600');
 expect(pre.headers['access-control-allow-credentials']).toBeUndefined();expect(pre.headers['access-control-allow-private-network']).toBeUndefined();
 const health=await call(g.url+'/lab/v2/health',{headers:{Origin:remote}});
 expect(health.status).toBe(200);expect(health.headers['access-control-allow-origin']).toBe(remote);expect(health.headers.vary).toBe('Origin');expect(health.headers['access-control-allow-credentials']).toBeUndefined();
 for(const origin of ['https://lab.example.evil.test','http://lab.example','https://lab.example:8443','https://evil.lab.example','https://lab.exampl','null'])for(const method of ['GET','OPTIONS']){
  const r=await call(g.url+'/lab/v2/health',{method,headers:{Origin:origin}});expect(r.status,origin).toBe(403);expect(r.headers['access-control-allow-origin']).toBeUndefined();
 }
 // v1 stays same-origin only (D53): a configured origin never reaches it, not even its health or preflight
 for(const method of ['GET','OPTIONS']){const r=await call(g.url+'/lab/v1/health',{method,headers:{Origin:remote}});expect(r).toMatchObject({status:403,body:{error:'ORIGIN_FORBIDDEN'}});expect(r.headers['access-control-allow-origin']).toBeUndefined();}
 expect((await call(g.url+'/lab/v1/health',{headers:{Origin:loopback}})).status).toBe(200);
});

test('a bearer session reads and writes without a cookie or CSRF token; the cookie path still needs CSRF; the stream accepts the bearer',async()=>{
 const g=await setup({allowOrigins:[remote]});
 const s=await bearer(g);
 expect(s.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(s.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(s.principal).toMatchObject({kind:'local_pairing'});
 const auth={Origin:remote,Authorization:`Bearer ${s.sessionToken}`};
 const ready=await call(g.url+readiness,{headers:auth});expect(ready.status).toBe(200);expect(ready.headers['access-control-allow-origin']).toBe(remote);
 const created=await call(g.url+'/lab/v2/runs',{method:'POST',headers:auth,body:runBody});
 expect(created.body.error).not.toBe('CSRF_INVALID');expect(created.status).toBe(201);
 const runId=(created.body as {run:{id:string}}).run.id;
 const ctl=new AbortController();aborts.push(ctl);
 const stream=await fetch(`${g.url}/lab/v2/runs/${runId}/events`,{headers:auth,signal:ctl.signal});
 expect(stream.status).toBe(200);expect(stream.headers.get('content-type')).toMatch(/text\/event-stream/);ctl.abort();
 // the same write with the cookie and no CSRF header is refused as before
 const c=await call(g.url+'/lab/v2/sessions',{method:'POST',headers:{Origin:loopback},body:{token:g.issuePairingToken()}});
 expect(await call(g.url+'/lab/v2/runs',{method:'POST',headers:{Origin:loopback,Cookie:c.headers['set-cookie']![0]!.split(';')[0]!},body:runBody})).toMatchObject({status:403,body:{error:'CSRF_INVALID'}});
});

test('a wrong, expired or query-string token is SESSION_REQUIRED; an invalid bearer wins over a valid cookie',async()=>{
 let now=1_000_000;const g=await setup({allowOrigins:[remote],nowMs:()=>now});
 const s=await bearer(g),cookie=await call(g.url+'/lab/v2/sessions',{method:'POST',headers:{Origin:loopback},body:{token:g.issuePairingToken()}});
 const cookieHeader=cookie.headers['set-cookie']![0]!.split(';')[0]!;
 for(const authorization of ['Bearer wrong',`Bearer ${s.sessionToken}x`,`bearer ${s.sessionToken}`,`Basic ${s.sessionToken}`,'Bearer ',s.sessionToken,`Bearer ${s.csrfToken}`])
  expect(await call(g.url+readiness,{headers:{Origin:remote,Authorization:authorization}}),authorization).toMatchObject({status:401,body:{error:'SESSION_REQUIRED'}});
 // the cookie alone works; with a bad bearer beside it, only the bearer counts
 expect((await call(g.url+readiness,{headers:{Origin:loopback,Cookie:cookieHeader}})).status).toBe(200);
 expect(await call(g.url+readiness,{headers:{Origin:loopback,Cookie:cookieHeader,Authorization:'Bearer wrong'}})).toMatchObject({status:401,body:{error:'SESSION_REQUIRED'}});
 // never from a URL
 for(const q of [`&access_token=${s.sessionToken}`,`&token=${s.sessionToken}`,`&sessionToken=${s.sessionToken}`])expect((await call(g.url+readiness+q,{headers:{Origin:remote}})).status).toBe(401);
 expect((await call(`${g.url}/lab/v2/runs/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/events?access_token=${s.sessionToken}`,{headers:{Origin:remote}})).status).toBe(400);
 expect((await call(g.url+readiness,{headers:{Origin:remote,Authorization:`Bearer ${s.sessionToken}`}})).status).toBe(200);
 now+=3600000;
 expect(await call(g.url+readiness,{headers:{Origin:remote,Authorization:`Bearer ${s.sessionToken}`}})).toMatchObject({status:401,body:{error:'SESSION_REQUIRED'}});
});

test('the access key pairs repeatedly; 5 failures in 60 s close /sessions runtime-wide with Retry-After, even for the right key',async()=>{
 let now=5_000_000;const g=await setup({allowOrigins:[remote],accessKey:key,nowMs:()=>now});
 const a=await pairWith(g,key),b=await pairWith(g,key);
 expect([a.status,b.status]).toEqual([201,201]);expect(a.body.sessionToken).not.toBe(b.body.sessionToken);
 expect((await call(g.url+readiness,{headers:{Origin:remote,Authorization:`Bearer ${b.body.sessionToken}`}})).status).toBe(200);
 // a valid attempt between failures does not reset the count
 for(let i=0;i<5;i++){expect(await pairWith(g,key.slice(1)+'x')).toMatchObject({status:401,body:{error:'PAIRING_INVALID'}});now+=1000;if(i===2)expect((await pairWith(g,key)).status).toBe(201);}
 const limited=await pairWith(g,'wrong');
 expect(limited).toMatchObject({status:429,body:{error:'PAIRING_RATE_LIMITED'}});expect(limited.headers['retry-after']).toBe('55');
 expect(limited.headers['access-control-allow-origin']).toBe(remote);
 expect((await pairWith(g,key)).status).toBe(429);expect((await pairWith(g,g.issuePairingToken())).status).toBe(429);
 expect((await call(g.url+'/lab/v2/sessions',{method:'POST',headers:{Origin:loopback},body:{token:key}})).status).toBe(429);
 // the limit gate does not count its own refusals: once the first failure leaves the 60 s window, one attempt is admitted
 now+=54_999;expect((await pairWith(g,key)).headers['retry-after']).toBe('1');
 now+=1;expect((await pairWith(g,key)).status).toBe(201);
 expect((await pairWith(g,'wrong')).status).toBe(401);expect((await pairWith(g,key)).status).toBe(429);
 // nothing secret leaks into logs-by-response or health
 const health=await call(g.url+'/lab/v2/health');expect(health.text).not.toContain(key);expect(health.text).not.toContain('lab.example');
});

test('start refuses a public bind without a key, a short key and any origin that is not exactly scheme://host[:port]',async()=>{
 for(const bind of ['0.0.0.0','::','','localhost','192.168.1.10','::ffff:127.0.0.1','127.0.0.1 '])await refused({bind},'ACCESS_KEY_REQUIRED');
 for(const accessKey of ['short','','k'.repeat(31)])await refused({accessKey},'ACCESS_KEY_TOO_SHORT');
 await refused({bind:'0.0.0.0',accessKey:'short'},'ACCESS_KEY_TOO_SHORT');
 for(const origin of ['*','https://lab.example/','https://lab.example/path','https://lab.example?x=1','https://lab.example#x','https://u:p@lab.example','ftp://lab.example','lab.example','https://*.example','null','https://lab.example ',''])await refused({allowOrigins:[origin]},'INVALID_ALLOW_ORIGIN');
 const g=await setup({bind:'0.0.0.0',accessKey:key});
 expect((await call(g.url+'/lab/v2/health')).body).toMatchObject({features:{bearer:true},deployment:{bind:'public'}});
 const l=await setup({bind:'127.0.0.1',accessKey:key});expect((await call(l.url+'/lab/v2/health')).body).toMatchObject({deployment:{bind:'loopback'}});
});

test('a configured public host is accepted case-insensitively and exactly; others stay HOST_FORBIDDEN',async()=>{
 const g=await setup({publicHosts:['Lab-Runtime.example']});
 for(const host of ['lab-runtime.example','LAB-RUNTIME.EXAMPLE'])expect((await call(g.url+'/lab/v2/health',{headers:{Host:host}})).status,host).toBe(200);
 for(const host of ['evil.example','lab-runtime.example.evil','x.lab-runtime.example','lab-runtime.example:8080'])expect(await call(g.url+'/lab/v2/health',{headers:{Host:host}}),host).toMatchObject({status:403,body:{error:'HOST_FORBIDDEN'}});
});

// The CLI: the key comes only from MEKONIQ_LAB_ACCESS_KEY and is never printed, nor is the pairing code when it is set.
let cliDir='';
beforeAll(async()=>{
 cliDir=await mkdtemp(join(tmpdir(),'lab-remote-cli-'));
 const localRequire=createRequire(join(process.cwd(),'apps/tablet-web/package.json')),viteRequire=createRequire(localRequire.resolve('vite/package.json'));
 const {build}=await import(pathToFileURL(viteRequire.resolve('esbuild')).href) as {build:(o:Record<string,unknown>)=>Promise<unknown>};
 await build({entryPoints:[join(process.cwd(),'packages/lab-runtime/src/cli.ts')],outfile:join(cliDir,'runtime.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'bundle',logLevel:'silent',banner:{js:"import {createRequire as __labCreateRequire} from 'node:module';const require=__labCreateRequire(import.meta.url);"},define:{__LAB_SOURCE_DIRTY__:'false',__LAB_NATIVE_TOOLS__:'{}',__LAB_SOURCE_COMMIT__:'"test-commit"',__LAB_SCHEMA_HASH__:JSON.stringify(hash)}});
},60000);
afterAll(async()=>{if(cliDir)await rm(cliDir,{recursive:true,force:true});});
function cli(args:string[],env:Record<string,string>,node:string[]=[]){
 const base={...process.env};delete base.MEKONIQ_LAB_ACCESS_KEY;delete base.PORT;
 const child=spawn(process.execPath,[...node,join(cliDir,'runtime.mjs'),'--data-dir',join(cliDir,'runs'),...args],{cwd:cliDir,env:{...base,...env},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
 const exited=new Promise<number|null>(r=>child.once('close',code=>r(code)));// 'close': stdio drained too
 const started=new Promise<string>((resolve,reject)=>{const t=setInterval(()=>{if(out.includes('Source:')){clearInterval(t);resolve(out);}},20);void exited.then(code=>{clearInterval(t);reject(new Error(`EXIT_${code}:${err}`));});});
 return {child,started,exited,output:()=>out+err};
}
const freePort=async()=>{const {createServer}=await import('node:net');const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p;};
test('CLI: PORT and the key come from the environment, neither the key nor a pairing code is printed; bad flags refuse to start',async()=>{
 const port=await freePort(),run=cli(['--allow-origin',remote],{PORT:String(port),MEKONIQ_LAB_ACCESS_KEY:key});
 try{
  const out=await run.started;
  expect(out).toContain(`Gateway: http://127.0.0.1:${port}`);expect(out).not.toMatch(/Pairing token/);expect(run.output()).not.toContain(key);
  expect((await call(`http://127.0.0.1:${port}/lab/v2/sessions`,{method:'POST',headers:{Origin:remote},body:{token:key}})).status).toBe(201);
 }finally{run.child.kill('SIGTERM');await run.exited;}
 // without the key the pairing line is printed exactly as before
 const plain=cli(['--port',String(await freePort())],{});
 try{expect(await plain.started).toMatch(/Pairing token \(expires in 5 minutes; one use\): [A-Za-z0-9_-]{43}\n/);}finally{plain.child.kill('SIGTERM');await plain.exited;}
 for(const [args,env,code] of [[['--allow-origin','https://lab.example/'],{},'INVALID_ALLOW_ORIGIN'],[['--allow-origin','https://lab.example/path'],{},'INVALID_ALLOW_ORIGIN'],[['--allow-origin','*'],{},'INVALID_ALLOW_ORIGIN'],[['--bind','0.0.0.0'],{},'ACCESS_KEY_REQUIRED'],[['--bind','0.0.0.0'],{MEKONIQ_LAB_ACCESS_KEY:''},'ACCESS_KEY_TOO_SHORT'],[['--bind'],{},'BIND_REQUIRED'],[['--access-key',key],{},'UNKNOWN_ARGUMENT']] as const){
  const r=cli(['--port',String(await freePort()),...args],{...env});void r.started.catch(()=>{});
  expect(await r.exited,args.join(' ')).not.toBe(0);expect(r.output()).toContain(code);expect(r.output()).not.toContain(key);
 }
},60000);

// Fix round 1 (D55): the limiter exists only with a key; with a key there is exactly one credential.
test('without an access key pairing behaves as before: no limiter, six wrong codes then the right one pairs on v2 and v1',async()=>{
 const g=await setup();
 for(let i=0;i<6;i++)expect(await pairWith(g,'wrong',loopback)).toMatchObject({status:401,body:{error:'PAIRING_INVALID'}});
 const ok=await pairWith(g,g.issuePairingToken(),loopback);expect(ok.status).toBe(201);expect(ok.headers['retry-after']).toBeUndefined();
 for(let i=0;i<6;i++)expect((await call(g.url+'/lab/v1/sessions',{method:'POST',headers:{Origin:loopback},body:{token:'wrong'}})).status).toBe(401);
 expect((await call(g.url+'/lab/v1/sessions',{method:'POST',headers:{Origin:loopback},body:{token:g.issuePairingToken()}})).status).toBe(201);
});
test('with an access key no pairing code exists: a code-shaped token fails and counts, v1 sessions are refused and count nothing, v1 refuses the key',async()=>{
 const g=await setup({accessKey:key});
 expect(g.pairingToken).toBe('');expect(g.issuePairingToken()).toBe('');
 expect(await pairWith(g,'p'.repeat(43),loopback)).toMatchObject({status:401,body:{error:'PAIRING_INVALID'}});
 for(const token of [key,'',g.pairingToken])expect(await call(g.url+'/lab/v1/sessions',{method:'POST',headers:{Origin:loopback},body:{token}})).toMatchObject({status:403,body:{error:'V1_PAIRING_DISABLED'}});
 for(let i=0;i<4;i++)expect((await pairWith(g,'wrong',loopback)).status).toBe(401);// failures 2..5: v1 refusals were not counted
 expect(await pairWith(g,key,loopback)).toMatchObject({status:429,body:{error:'PAIRING_RATE_LIMITED'}});
});
test('bind ::1 is loopback and starts without a key',async()=>{
 const g=await setup({bind:'::1'});expect(g.url).toMatch(/^http:\/\/\[::1\]:\d+$/);
 expect((await call(g.url+'/lab/v2/health')).body).toMatchObject({deployment:{bind:'loopback'}});
});
test('origin matching is exact: an upper-case request Origin is refused',async()=>{
 const g=await setup({allowOrigins:[remote]});
 for(const origin of ['HTTPS://LAB.EXAMPLE','https://LAB.example','Https://lab.example','HTTP://127.0.0.1:4175'])expect(await call(g.url+'/lab/v2/health',{headers:{Origin:origin}}),origin).toMatchObject({status:403,body:{error:'ORIGIN_FORBIDDEN'}});
});
test('CLI: PORT is read only when --port is absent; the access key is removed from the environment before anything can inherit it',async()=>{
 const flag=await freePort(),a=cli(['--port',String(flag)],{PORT:'not-a-port'});
 try{expect(await a.started).toContain(`Gateway: http://127.0.0.1:${flag}`);}finally{a.child.kill('SIGTERM');await a.exited;}
 const env=await freePort(),b=cli([],{PORT:String(env)});
 try{expect(await b.started).toContain(`Gateway: http://127.0.0.1:${env}`);}finally{b.child.kill('SIGTERM');await b.exited;}
 for(const [args,e] of [[[],{PORT:'not-a-port'}],[['--port','0'],{PORT:String(env)}]] as [string[],Record<string,string>][]){const r=cli(args,e);void r.started.catch(()=>{});expect(await r.exited).not.toBe(0);expect(r.output()).toContain('INVALID_PORT');}
 // a preload reports, at exit, whether the variable is still visible to the process (and so to any child it spawns)
 const probe=join(cliDir,'env-probe.mjs');await (await import('node:fs/promises')).writeFile(probe,"import {writeSync} from 'node:fs';process.on('exit',()=>writeSync(2,'KEY_IN_ENV:'+('MEKONIQ_LAB_ACCESS_KEY' in process.env)+'\\n'));");
 const k=cli(['--port',String(await freePort())],{MEKONIQ_LAB_ACCESS_KEY:key},['--import',pathToFileURL(probe).href]);
 try{await k.started;}finally{k.child.kill('SIGTERM');await k.exited;}
 expect(k.output()).toContain('KEY_IN_ENV:false');expect(k.output()).not.toContain(key);
 const n=cli(['--port',String(await freePort())],{},['--import',pathToFileURL(probe).href]);
 try{await n.started;}finally{n.child.kill('SIGTERM');await n.exited;}
 expect(n.output()).toContain('KEY_IN_ENV:false');
},60000);
