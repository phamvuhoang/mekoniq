import { expect,test } from 'vitest';
import { startCloud } from '../support/cloud-server';
import {createServer,connect,type Socket} from 'node:net';
test('database outage is not advertised as ready',async () => {
  const api=await startCloud({databaseUrl:'postgres://invalid@127.0.0.1:1/test',port:0});
  try {
    expect((await fetch(api.url+'/health/live')).status).toBe(200);
    expect((await fetch(api.url+'/health/ready')).status).toBe(503);
    expect((await fetch(api.url+'/v1/unregistered')).status).toBe(404);
  } finally { await api.close(); }
});
test('readiness probes a healthy database again after its connection path fails',async()=>{
 const sockets=new Set<Socket>();
 const proxy=createServer(client=>{
  const upstream=connect(57422,'127.0.0.1');sockets.add(client);sockets.add(upstream);
  client.pipe(upstream).pipe(client);client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());
 });
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const port=(proxy.address() as {port:number}).port;
 const api=await startCloud({databaseUrl:`postgresql://mekoniq_app:local_test_only@127.0.0.1:${port}/postgres`,port:0});
 let proxyClosed=false;
 try{
  expect((await fetch(api.url+'/health/ready')).status).toBe(200);
  for(const socket of sockets)socket.destroy();
  await new Promise<void>(resolve=>proxy.close(()=>resolve()));proxyClosed=true;
  const readiness=await fetch(api.url+'/health/ready');expect(readiness.status).toBe(503);
  expect(readiness.headers.get('cache-control')).toContain('no-store');
  expect((await fetch(api.url+'/health/live')).status).toBe(200);
 }finally{await api.close();for(const socket of sockets)socket.destroy();if(!proxyClosed)await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
});
