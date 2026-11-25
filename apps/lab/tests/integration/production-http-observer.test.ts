import {afterEach,beforeEach,expect,test} from 'vitest';
import type {EventEmitter} from 'node:events';
import {createServer,type Server} from 'node:http';
import {chromium,type Browser,type Page} from '@playwright/test';
import {observeProductionHTTP} from '../../scripts/production-http-observer';
let server:Server,browser:Browser,page:Page,url:string,observer:ReturnType<typeof observeProductionHTTP>;
const data=()=>({responses:[] as Record<string,unknown>[],actions:[] as Record<string,unknown>[],exports:[] as Record<string,unknown>[],errors:[] as string[]});
const bounded=async(p:Promise<unknown>)=>{let timer:NodeJS.Timeout;try{return await Promise.race([p.then(()=> 'settled'),new Promise(r=>{timer=setTimeout(()=>r('pending'),700);})]);}finally{clearTimeout(timer!);}};
beforeEach(async()=>{
 server=createServer((req,res)=>{
  if(req.url?.includes('unfinished')||req.url?.includes('abort')){res.writeHead(200,{'Content-Type':'application/json','Content-Length':'100000'});res.flushHeaders();res.write('{"started":true,');return;}
  if(req.url?.startsWith('/lab/v2/')){
   const path=new URL(req.url,'http://fixture'),action=path.pathname.endsWith('/actions'),publication=path.pathname.endsWith('/replay');
   const body=action?{run:{id:path.searchParams.has('wrong-run')?'other':'run-1',runRevision:1,status:'paused'},tick:7}:publication?{exportId:'export-1',manifest:{documentType:'web-replay-package',runId:'run-1',horizon:{tick:7,tickMs:20}}}:{ok:true};
   res.writeHead(path.searchParams.has('error')?500:publication?201:200,{'Content-Type':'application/json'});res.end(path.searchParams.has('invalid')?'{}':JSON.stringify(body));return;
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><p>Owned HTTP observer boundary</p>');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});page=await browser.newPage();await page.goto(url);
});
afterEach(async()=>{observer?.dispose();await browser?.close();server?.closeAllConnections();if(server)await new Promise<void>(r=>server.close(()=>r()));});
test('abort after headers settles before target closure and keeps the actual failure',async()=>{
 const rows=data();observer=observeProductionHTTP(page,rows,{timeoutMs:300,drainTimeoutMs:300});
 const failed=page.waitForEvent('requestfailed');
 await page.evaluate(async()=>{const c=new AbortController(),r=await fetch('/lab/v2/runs/run-1/world-display?abort',{signal:c.signal});c.abort();await r.text().catch(()=>{});});await failed;
 expect(await bounded(observer.finish())).toBe('settled');expect(page.isClosed()).toBe(false);
 expect(rows.responses).toEqual([expect.objectContaining({path:'/lab/v2/runs/run-1/world-display',method:'GET',outcome:'failed',failure:'net::ERR_ABORTED',classification:'optional-read-cancellation'})]);expect(rows.errors).toEqual([]);
});
test('unfinished body hits a finite failure boundary without inventing a response end',async()=>{
 const rows=data();observer=observeProductionHTTP(page,rows,{timeoutMs:200,drainTimeoutMs:200});
 await page.evaluate(async()=>{await fetch('/lab/v2/unfinished');});
 expect(await bounded(observer.finish())).toBe('settled');expect(rows.responses).toEqual([expect.objectContaining({outcome:'timed_out',responseEnd:-1})]);expect(rows.errors.length).toBe(1);expect(page.isClosed()).toBe(false);
});

test('successful control, action and publication keep exact request/body/timing correlation',async()=>{
 const rows=data(),events=['request','response','requestfinished','requestfailed','close','crash'] as const,before=events.map(e=>(page as unknown as EventEmitter).listenerCount(e));observer=observeProductionHTTP(page,rows);
 await page.evaluate(async()=>{await fetch('/lab/v2/control').then(r=>r.json());await fetch('/lab/v2/runs/run-1/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actionId:'pause-1',kind:'pause',payload:{}})}).then(r=>r.json());await fetch('/lab/v2/runs/run-1/replay',{method:'POST'}).then(r=>r.json());});
 await observer.finish();expect(rows.errors).toEqual([]);expect(rows.responses).toHaveLength(3);expect(rows.responses.every(r=>r.outcome==='completed')).toBe(true);
 expect(rows.actions).toHaveLength(1);const a=rows.actions[0]!;expect(a).toMatchObject({actionId:'pause-1',kind:'pause',runId:'run-1',tick:7,revision:1,status:'paused',payload:{}});
 const r=rows.responses.find(r=>r.actionId==='pause-1')!;expect(r).toMatchObject({status:200,runId:'run-1',tick:7,requestStartEpochMs:a.requestStartEpochMs,responseEndEpochMs:a.responseEndEpochMs});expect(Number(a.requestStartEpochMs)).toBeLessThanOrEqual(Number(a.responseEndEpochMs));expect(Number(a.responseEndEpochMs)).toBeLessThanOrEqual(Number(a.observedAtEpochMs)+2);
 expect(rows.exports).toEqual([expect.objectContaining({runId:'run-1',status:201,exportId:'export-1',manifest:{documentType:'web-replay-package',runId:'run-1',horizon:{tick:7,tickMs:20}}})]);
 expect(events.map(e=>(page as unknown as EventEmitter).listenerCount(e))).toEqual(before);await page.evaluate(()=>fetch('/lab/v2/after-boundary'));expect(rows.responses).toHaveLength(3);
});
test.each(['actions?error','actions?invalid','actions?wrong-run','replay?error','replay?invalid'])('required %s cannot become a successful observation',async path=>{
 const rows=data();observer=observeProductionHTTP(page,rows);
 await page.evaluate(async path=>{await fetch('/lab/v2/runs/run-1/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actionId:'pause-1',kind:'pause'})}).then(r=>r.text());},path);
 await observer.finish();expect(rows.errors).toHaveLength(1);expect(rows.actions).toEqual([]);expect(rows.exports).toEqual([]);expect(rows.responses[0]).toMatchObject({outcome:'invalid',classification:'required-observation-failure'});
});
test('failed mutation after headers is required even when its HTTP status was 200',async()=>{
 const rows=data();observer=observeProductionHTTP(page,rows);const failed=page.waitForEvent('requestfailed');
 await page.evaluate(async()=>{const c=new AbortController(),r=await fetch('/lab/v2/runs/run-1/actions?abort',{method:'POST',signal:c.signal});c.abort();await r.text().catch(()=>{});});await failed;await observer.finish();
 expect(rows.responses[0]).toMatchObject({status:200,method:'POST',outcome:'failed',classification:'required-observation-failure',failure:'net::ERR_ABORTED'});expect(rows.errors).toHaveLength(1);expect(rows.actions).toEqual([]);
});
test('target closure settles an admitted unfinished request and removes listeners',async()=>{
 const rows=data(),before=(page as unknown as EventEmitter).listenerCount('request');observer=observeProductionHTTP(page,rows);
 await page.evaluate(async()=>{await fetch('/lab/v2/unfinished');});await page.close();expect(await bounded(observer.finish())).toBe('settled');
 expect(rows.responses).toHaveLength(1);expect(rows.responses[0]!.outcome).not.toBe('completed');expect(rows.errors).toHaveLength(1);expect((page as unknown as EventEmitter).listenerCount('request')).toBe(before);
});
