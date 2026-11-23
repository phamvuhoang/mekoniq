import {expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

test('production UI serves the built bytes and pin, proxies runtime traffic, binds evidence, and closes its owned server',async()=>{
 const work=await mkdtemp(join(tmpdir(),'lab-production-test-')),root=join(work,'ui'),evidence=join(work,'evidence');
 const runtime=createServer((_,res)=>res.end('runtime-response'));await new Promise<void>(r=>runtime.listen(0,'127.0.0.1',r));
 let ui:{url:string;close:()=>Promise<void>}|undefined;
 try{
  await mkdir(join(root,'config'),{recursive:true});
  await writeFile(join(root,'config/source-runtime.lock.json'),JSON.stringify({sourceCommit:'a'.repeat(40),artifactSha256:'b'.repeat(64),schemaHash:'c'.repeat(64)}));
  await writeFile(join(root,'index.html'),'<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
  await writeFile(join(root,'main.js'),'document.querySelector("#app").textContent="production fixture";');
  // @ts-expect-error JavaScript CLI boundary
  const {startProductionUi,verifyProductionUi}=await import('../../scripts/production-ui.mjs');
  ui=await startProductionUi({root,runtimeRoot:root,uiPort:0,runtimePort:(runtime.address() as {port:number}).port,evidenceDir:evidence});
  const html=await (await fetch(ui!.url)).text();expect(html).not.toContain('/@vite/client');expect(html).toMatch(/\/assets\/[^" ]+\.js/);
  expect(await (await fetch(new URL('/lab/v2/health',ui!.url))).text()).toBe('runtime-response');
  const binding=await verifyProductionUi({url:ui!.url,evidenceDir:evidence});
  await expect(verifyProductionUi({url:`http://127.0.0.1:${(runtime.address() as {port:number}).port}/`,evidenceDir:evidence})).rejects.toThrow('PRODUCTION_SERVED_MISMATCH');
  const bytes=await readFile(join(evidence,'production-ui.json'));expect(binding).toBe(createHash('sha256').update(bytes).digest('hex'));
  const receipt=JSON.parse(bytes.toString());expect(receipt.files.some((f:{path:string})=>f.path.endsWith('.js'))).toBe(true);expect(receipt.sourceCommit).toBe('a'.repeat(40));
  const asset=receipt.files.find((f:{path:string})=>f.path.endsWith('.js'));
  await writeFile(join(evidence,'production-ui',asset.path),'changed');
  await expect(verifyProductionUi({url:ui!.url,evidenceDir:evidence})).rejects.toThrow('PRODUCTION_FILE_MISMATCH');
  await ui!.close();await expect(fetch(ui!.url,{signal:AbortSignal.timeout(1000)})).rejects.toThrow();ui=undefined;
 }finally{await ui?.close();await new Promise<void>(r=>runtime.close(()=>r()));await rm(work,{recursive:true,force:true});}
},60000);

test('production UI refuses a runtime pin different from the UI pin before serving',async()=>{
 const work=await mkdtemp(join(tmpdir(),'lab-production-pin-'));
 try{
  for(const name of ['ui','runtime']){await mkdir(join(work,name,'config'),{recursive:true});await writeFile(join(work,name,'config/source-runtime.lock.json'),JSON.stringify({sourceCommit:name}));}
  // @ts-expect-error JavaScript CLI boundary
  const {startProductionUi}=await import('../../scripts/production-ui.mjs');
  await expect(startProductionUi({root:join(work,'ui'),runtimeRoot:join(work,'runtime'),uiPort:0,runtimePort:4176,evidenceDir:join(work,'evidence')})).rejects.toThrow('PRODUCTION_RUNTIME_PIN_MISMATCH');
 }finally{await rm(work,{recursive:true,force:true});}
});
