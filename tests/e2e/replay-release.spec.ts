import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {observeProductionHTTP} from '../../scripts/production-http-observer';
// Public production httpTwinRuntime -> owned real HTTP -> browser terminal events. Synthetic bytes establish lifecycle, not qualification.
for(const mode of ['valid','malformed','incomplete','refused','unfinished'] as const)test(`replay release consumes and validates ${mode} cleanup response`,async({page},testInfo)=>{
 const plain=Buffer.from(JSON.stringify({manifest:{runId:'run-one'},outcome:{tick:7}})),bytes=gzipSync(plain),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
 const manifest={schemaVersion:1,documentType:'web-replay-package',runId:'run-one',horizon:{tick:7,tickMs:20},provenance:{kind:'imported_integrity_only',accepted:false,calibration:'not_calibrated',scope:'display_only_not_requalification',reportTransform:'credential_redaction_v1',rawReportSha256:sha(plain)},coverage:{prefixCovered:false,streamFinalized:false,sampled:false,terminal:null,gaps:[],issues:['NO_STREAM']},assets:[{path:'report.json.gz',sha256:sha(bytes),decodedSha256:sha(plain),bytes:bytes.length,decodedBytes:plain.length,encoding:'gzip',role:'report',mediaType:'application/json'}],streams:[],licensing:[]};
 const deletes:string[]=[],server=createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4175');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.method==='DELETE'){
   deletes.push(req.url!);res.writeHead(mode==='refused'?403:200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   if(mode==='unfinished'){res.flushHeaders();res.write('{"deleted":');return;}
   res.end(mode==='valid'?'{"deleted":true}':mode==='incomplete'?'{}':mode==='refused'?'{"error":"CAPABILITY_DENIED"}':'{');return;
  }
  if(req.url?.endsWith('/assets/0')){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(bytes);return;}
  res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({exportId:'owned-version',manifest}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/lab/v2`,rows={responses:[] as Record<string,unknown>[],actions:[],exports:[],errors:[] as string[]};let observer:ReturnType<typeof observeProductionHTTP>|undefined;
 try{
  await page.goto('/source-runtime.lock.json');observer=observeProductionHTTP(page,rows,{timeoutMs:15000,drainTimeoutMs:1000});
  const result=await page.evaluate(async base=>{
   const module='/src/scenarios/controls.ts',{httpTwinRuntime}=await import(module),rt=httpTwinRuntime({base,kind:'remote'}),exportAbort=new AbortController(),capture=await rt.exportReplay('run-one',exportAbort.signal);
   capture.reader.close();exportAbort.abort();// cleanup must remain possible after the export's own cancellation
   const start=performance.now();let error:string|null=null;try{await capture.release();}catch(e){error=(e as Error).message;}await capture.release();return {error,elapsedMs:performance.now()-start};
  },base);
  await observer.finish();await testInfo.attach('observations',{body:JSON.stringify({result,rows,deletes},null,2),contentType:'application/json'});
  expect(deletes).toEqual(['/lab/v2/runs/run-one/replay/owned-version']);
  if(mode==='valid'){
   expect(result.error).toBeNull();expect(rows.errors).toEqual([]);expect(rows.responses.find(r=>r.method==='DELETE')).toMatchObject({status:200,outcome:'completed',runId:'run-one',exportId:'owned-version'});
  }else{expect(result.error).toBe(mode==='refused'?'REPLAY_DELETE_REFUSED':mode==='unfinished'?'REPLAY_DELETE_TIMEOUT':'INVALID_RUNTIME_RESPONSE');expect(rows.errors.length).toBeGreaterThan(0);expect(rows.responses.find(r=>r.method==='DELETE')!.outcome).not.toBe('completed');}
  if(mode==='unfinished'){expect(result.elapsedMs).toBeLessThan(12000);expect(rows.responses.find(r=>r.method==='DELETE')!.outcome).not.toBe('completed');}
 }finally{observer?.dispose();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
