import {describe,expect,it} from 'vitest';
import {createServer as netServer,type AddressInfo} from 'node:net';
import {request} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error plain ESM launcher without type declarations
import {staticServer,closeServer} from '../../scripts/offline-start.mjs';

describe('offline launcher stop',()=>{
 it('closes the UI server even while a proxied request is still waiting on the runtime',async()=>{
  // a runtime that accepts the connection and never answers: the proxied request stays in flight, so a plain server.close() would wait forever
  const upstream=netServer(()=>{});await new Promise<void>(ok=>upstream.listen(0,'127.0.0.1',ok));
  const server=staticServer(mkdtempSync(join(tmpdir(),'offline-stop-')),(upstream.address() as AddressInfo).port);
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
  const inflight=request({host:'127.0.0.1',port:(server.address() as AddressInfo).port,path:'/lab/v2/health'});inflight.on('error',()=>{});inflight.end();
  await new Promise(ok=>setTimeout(ok,100));
  await expect(Promise.race([closeServer(server).then(()=>'closed'),new Promise(ok=>setTimeout(()=>ok('still open after 2 s'),2000))])).resolves.toBe('closed');
  upstream.close();
 });
});
