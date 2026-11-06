import {afterEach,expect,test} from 'vitest';
import {mkdtempSync,writeFileSync,statSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
// @ts-expect-error operational ESM script
import {startArmTunnel} from '../../scripts/native-sim/arm-tunnel.mjs';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function setup(mode='listen'){
 const root=mkdtempSync(join(tmpdir(),'arm-tunnel-'));roots.push(root);const knownHosts=join(root,'known_hosts');writeFileSync(knownHosts,'[fixture] ssh-ed25519 publicfixture\n',{mode:0o600});
 const executable=join(root,'ssh-double');writeFileSync(executable,`#!${process.execPath}\nimport('node:net').then(({createServer})=>{const args=process.argv.slice(2);if(${JSON.stringify(mode)}==='exit')process.exit(23);if(${JSON.stringify(mode)}==='silent')return setInterval(()=>{},1000);const path=args[args.indexOf('-L')+1].split(':')[0];createServer(s=>s.end()).listen(path);if(${JSON.stringify(mode)}==='drop')setTimeout(()=>process.exit(24),300);});\n`,{mode:0o700});
 return {root,knownHosts,executable};
}
test('owns a private per-run socket, pins host keys, forwards only bridge and cleans its own resources',async()=>{
 const o=setup();writeFileSync(join(o.root,'unrelated'),'keep');const tunnel=await startArmTunnel({parentDir:o.root,alias:'mekoniq-arm-sim',knownHosts:o.knownHosts,sshExecutable:o.executable,timeoutMs:1000});
 try{
  expect(statSync(tunnel.socketPath).isSocket()).toBe(true);expect(statSync(tunnel.socketPath).mode&0o777).toBe(0o600);expect(statSync(tunnel.directory).mode&0o777).toBe(0o700);
  expect(tunnel.argv).toContain('StrictHostKeyChecking=yes');expect(tunnel.argv).toContain('ForwardAgent=no');expect(tunnel.argv).toContain('ForwardX11=no');expect(tunnel.argv[tunnel.argv.indexOf('-L')+1]).toBe(`${tunnel.socketPath}:/run/mekoniq-arm/bridge.sock`);
  expect(tunnel.status()).toBe('ready');
 }finally{await tunnel.close();}
 expect(existsSync(tunnel.directory)).toBe(false);expect(existsSync(join(o.root,'unrelated'))).toBe(true);expect(tunnel.status()).toBe('closed');
});
test('bounds a silent SSH process and rejects early exit without reporting ready',async()=>{
 for(const mode of ['silent','exit']){const o=setup(mode);await expect(startArmTunnel({parentDir:o.root,alias:'mekoniq-arm-sim',knownHosts:o.knownHosts,sshExecutable:o.executable,timeoutMs:mode==='exit'?2000:100})).rejects.toThrow(mode==='exit'?'ARM_TUNNEL_EXIT':'ARM_TUNNEL_TIMEOUT');}
});
test('refuses arbitrary destinations and missing trust before spawning',async()=>{
 const o=setup();await expect(startArmTunnel({parentDir:o.root,alias:'-oProxyCommand=evil',knownHosts:o.knownHosts,sshExecutable:o.executable})).rejects.toThrow('ARM_TUNNEL_ALIAS_INVALID');
 await expect(startArmTunnel({parentDir:o.root,alias:'arm',knownHosts:join(o.root,'absent'),sshExecutable:o.executable})).rejects.toThrow('ARM_TUNNEL_TRUST_INVALID');
});

test('marks an established tunnel failed when its SSH process exits and never respawns it',async()=>{
 const o=setup('drop');const tunnel=await startArmTunnel({parentDir:o.root,alias:'mekoniq-arm-sim',knownHosts:o.knownHosts,sshExecutable:o.executable,timeoutMs:2000});
 try{await expect.poll(()=>tunnel.status(),{timeout:2000}).toBe('failed');}finally{await tunnel.close();}
 expect(existsSync(tunnel.directory)).toBe(false);
});

test('effective SSH configuration overrides alternate host trust and shared/background transport',async()=>{
 const o=setup();const config=join(o.root,'ssh_config');writeFileSync(config,'Host *\n  KnownHostsCommand /bin/false\n  VerifyHostKeyDNS yes\n  ControlMaster auto\n  ControlPath /tmp/unrelated-master\n  ControlPersist yes\n  ForkAfterAuthentication yes\n');
 const t=await startArmTunnel({parentDir:o.root,alias:'mekoniq-arm-sim',knownHosts:o.knownHosts,sshExecutable:o.executable,timeoutMs:2000});
 try{
  const r=spawnSync('/usr/bin/ssh',['-G','-F',config,...t.argv],{encoding:'utf8'});expect(r.status).toBe(0);
  const settings=new Map(r.stdout.split('\n').map(line=>{const i=line.indexOf(' ');return [line.slice(0,i),line.slice(i+1)];}));
  expect(settings.get('knownhostscommand')).toBeUndefined();expect(settings.get('verifyhostkeydns')).toBe('false');expect(settings.get('controlpath')).toBeUndefined();expect(settings.get('controlmaster')).toBe('false');expect(settings.get('controlpersist')).toBe('no');expect(settings.get('forkafterauthentication')).toBe('no');
 }finally{await t.close();}
});
