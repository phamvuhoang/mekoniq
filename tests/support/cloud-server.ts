import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
export async function startCloud({databaseUrl,port=0}: {databaseUrl:string;port?:number}) {
  if (port === 0) {
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0,'127.0.0.1',resolve));
    port = (probe.address() as {port:number}).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
  }
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)], {
    cwd: new URL('../../apps/cloud-web/', import.meta.url),
    env:{...process.env,DATABASE_URL:databaseUrl,NEXT_TELEMETRY_DISABLED:'1'}, stdio:['ignore','pipe','pipe']
  });
  let logs=''; child.stdout.on('data',v => {logs+=v;}); child.stderr.on('data',v => {logs+=v;});
  const close = async () => {
    if (child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      child.once('exit',() => resolve()); child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'),5000); timeout.unref();
    });
  };
  const url = `http://127.0.0.1:${port}`;
  for (let attempt=0;attempt<120;attempt++) {
    try { const r=await fetch(`${url}/health/live`); if(r.ok) return {url,close}; } catch { /* wait for real Next */ }
    if(child.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve,250));
  }
  await close(); throw new Error(`Next.js startup failed: ${logs}`);
}
