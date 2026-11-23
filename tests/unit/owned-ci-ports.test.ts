import {expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';

import {ownedCiCheckout} from '../support/owned-ci';

const id='a'.repeat(64),cli=join(process.cwd(),'scripts/owned-source-ci.mjs');
test.each(['conflict','ipv6-conflict','malformed','missing-container','failure','truncated','timeout','bad-id','duplicate-id','duplicate-container','null-ports','bad-binding','bad-host-port','bad-port-key'])('owned CI refuses %s before workdir, start or stop',mode=>{
 const root=mkdtempSync(join(tmpdir(),'owned-ci-port-test-')),bin=join(root,'bin'),scratch=join(root,'tmp'),calls=join(root,'calls');mkdirSync(bin);mkdirSync(scratch);
 const docker=`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(calls)},'docker '+process.argv.slice(2).join(' ')+'\\n');\nconst mode=${JSON.stringify(mode)},id=${JSON.stringify(id)};\nif(mode==='failure')process.exit(1);\nif(mode==='timeout')await new Promise(r=>setTimeout(r,10000));\nelse if(mode==='truncated')process.stdout.write('x'.repeat(2*1024*1024));\nelse if(process.argv[2]==='ps')console.log(mode==='bad-id'?'not-an-id':mode==='duplicate-id'?id+'\\n'+id:id);\nelse if(mode==='malformed')console.log('{');\nelse if(mode==='missing-container')console.log('[]');\nelse {const row={id,ports:mode==='null-ports'?null:mode==='bad-port-key'?{unknown:null}:{'5432/tcp':mode==='bad-binding'?[{}]:[{HostIp:mode==='ipv6-conflict'?'::':'0.0.0.0',HostPort:mode==='bad-host-port'?'57422bad':'57422'}]}};console.log(JSON.stringify(row));if(mode==='duplicate-container')console.log(JSON.stringify(row));}\n`;
 writeFileSync(join(bin,'docker'),docker,{mode:0o755});writeFileSync(join(bin,'pnpm'),`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(calls)},'pnpm '+process.argv.slice(2).join(' ')+'\\n');process.exit(2);\n`,{mode:0o755});
 try{const r=spawnSync(process.execPath,[cli,'--',process.execPath,'-e','process.exit(0)'],{env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:scratch},encoding:'utf8',timeout:15000});expect(r.error).toBeUndefined();expect(r.status).not.toBe(0);expect(r.stdout+r.stderr).toContain('CI_PORT_INVENTORY');expect(existsSync(calls)?readFileSync(calls,'utf8'):'').not.toContain('pnpm ');expect(readdirSync(scratch)).toEqual([]);}finally{rmSync(root,{recursive:true,force:true});}
},20000);

test('valid nonconflicting structured inventory reaches only the owned start failure boundary',()=>{
 const root=mkdtempSync(join(tmpdir(),'owned-ci-free-test-')),bin=join(root,'bin'),scratch=join(root,'tmp'),calls=join(root,'calls');mkdirSync(bin);mkdirSync(scratch);
 writeFileSync(join(bin,'docker'),`#!${process.execPath}\nconsole.log(process.argv[2]==='ps'?${JSON.stringify(id)}:JSON.stringify({id:${JSON.stringify(id)},ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'12345'}],'8000/tcp':null}}));\n`,{mode:0o755});
 writeFileSync(join(bin,'pnpm'),`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(calls)},process.argv.slice(2).join(' ')+'\\n');process.exit(2);\n`,{mode:0o755});
 try{const r=spawnSync(process.execPath,[ownedCiCheckout(root),'--',process.execPath,'-e','process.exit(0)'],{env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:scratch},encoding:'utf8',timeout:10000});expect(r.error).toBeUndefined();expect(r.status).toBe(2);expect(r.stderr).toContain('OWNED_SUPABASE_NOT_RUN');expect(readFileSync(calls,'utf8')).toContain('supabase start');expect(readFileSync(calls,'utf8')).toContain('supabase stop');expect(readdirSync(scratch).some(n=>n.startsWith('mekoniq-owned-ci-'))).toBe(true);}finally{rmSync(root,{recursive:true,force:true});}
});

test('host bind refusal retains cleanup after a valid empty Docker inventory',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owned-ci-bind-test-')),bin=join(root,'bin'),scratch=join(root,'tmp'),calls=join(root,'calls'),listener=createServer();mkdirSync(bin);mkdirSync(scratch);
 writeFileSync(join(bin,'docker'),'#!/bin/sh\nexit 0\n',{mode:0o755});writeFileSync(join(bin,'pnpm'),`#!/bin/sh\nprintf called > '${calls}'\nexit 2\n`,{mode:0o755});
 const listen=(s:ReturnType<typeof createServer>,port:number)=>new Promise<void>((ok,fail)=>{s.once('error',fail);s.listen(port,'127.0.0.1',ok);});
 const first=createServer();await listen(listener,0);await listen(first,0);
 const portOf=(s:ReturnType<typeof createServer>)=>(s.address() as {port:number}).port;
 const ports=[portOf(first),portOf(listener)];await new Promise<void>(ok=>first.close(()=>ok()));
 try{const r=spawnSync(process.execPath,[ownedCiCheckout(root,ports),'--',process.execPath,'-e','process.exit(0)'],{env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:scratch},encoding:'utf8',timeout:10000});expect(r.error).toBeUndefined();expect(r.status).toBe(1);expect(r.stderr).toContain('EADDRINUSE');expect(existsSync(calls)).toBe(false);expect(readdirSync(scratch)).toEqual([]);
  const earlier=createServer();await listen(earlier,ports[0]!);await new Promise<void>(ok=>earlier.close(()=>ok()));
 }finally{await new Promise<void>(ok=>listener.close(()=>ok()));rmSync(root,{recursive:true,force:true});}
},15000);

test('status JSON is parsed from stdout even when the CLI warns on stderr',()=>{
 const root=mkdtempSync(join(tmpdir(),'owned-ci-status-test-')),bin=join(root,'bin'),scratch=join(root,'tmp'),seen=join(root,'seen');mkdirSync(bin);mkdirSync(scratch);
 writeFileSync(join(bin,'docker'),`#!${process.execPath}\nif(process.argv[4]==='{{.Id}}')console.log(${JSON.stringify(id)});\n`,{mode:0o755});
 writeFileSync(join(bin,'pnpm'),`#!${process.execPath}\nif(process.argv.includes('status')){process.stderr.write('Stopped services: [studio]\\n');console.log(JSON.stringify({DB_URL:'postgres://stub'}));}\n`,{mode:0o755});
 try{const r=spawnSync(process.execPath,[ownedCiCheckout(root),'--',process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(seen)},process.env.DATABASE_ADMIN_URL)`],{env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:scratch},encoding:'utf8',timeout:10000});expect(r.error).toBeUndefined();expect(r.status).toBe(0);expect(readFileSync(seen,'utf8')).toBe('postgres://stub');}finally{rmSync(root,{recursive:true,force:true});}
},15000);
