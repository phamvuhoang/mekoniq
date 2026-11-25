import {createServer} from 'node:net';
export async function freePort():Promise<number>{
 const server=createServer();await new Promise<void>((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
 const port=(server.address() as {port:number}).port;await new Promise<void>(ok=>server.close(()=>ok()));return port;
}
