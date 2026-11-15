import {expect,test} from 'vitest';import {spawnSync} from 'node:child_process';
test('R2b CLI lists its closed local suites without probing Docker and requires actual producer inputs',()=>{
 const p=spawnSync(process.execPath,['scripts/record-sim-extension.mjs','--release','r2b','--plan'],{encoding:'utf8',timeout:15000});expect(p.status,p.stderr).toBe(0);expect(p.stdout).toContain('mj-contracts');expect(p.stdout).toContain('cell-runtime');expect(p.stdout).toContain('WEB06 blocked_external');
 const missing=spawnSync(process.execPath,['scripts/record-sim-extension.mjs','--release','r2b','--out','/tmp/unused-b10-output'],{encoding:'utf8',timeout:15000});expect(missing.status).toBe(2);expect(missing.stderr).toContain('MISSING_OPTION:--r2a-record');
});
