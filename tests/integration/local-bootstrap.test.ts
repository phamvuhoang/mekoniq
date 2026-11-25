import {expect,test} from 'vitest';
import {mkdtemp,mkdir,copyFile,symlink,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
// @ts-expect-error ESM owned service config shared with the CI launcher
import {ownedCiConfig} from '../../scripts/owned-ci-config.mjs';
import {supabaseAdmin} from '../../apps/cloud-web/src/server/supabase/admin';
async function writeBootstrapConfig(root:string,projectId:string) {
 const base=await readFile('supabase/config.toml','utf8');
 await writeFile(join(root,'supabase/config.toml'),ownedCiConfig(base,projectId));
}

test('bootstrap fixture targets its owned project and retains local endpoints',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bootstrap-config-')),projectId='mekoniq-ci-0123456789abcdef';
 try {
  await mkdir(join(root,'supabase'));
  await writeBootstrapConfig(root,projectId);
  const actual=await readFile(join(root,'supabase/config.toml'),'utf8');
  expect(actual.match(/^project_id = .*$/gm)).toEqual(['project_id = "'+projectId+'"']);
  expect(actual).toMatch(/\[api\][^[]*port = 57421/);
  expect(actual).toMatch(/\[db\][^[]*port = 57422/);
  await expect(writeBootstrapConfig(root,'mekoniq-w00-w04')).rejects.toThrow('CI_PROJECT_ID');
  expect(await readFile(join(root,'supabase/config.toml'),'utf8')).toBe(actual);
 } finally { await rm(root,{recursive:true,force:true}); }
});

test('local bootstrap writes private exclusive configuration and never prints credentials',async()=>{
 const db=await setupWave02();await mkdir('.lab',{recursive:true});const root=await mkdtemp(resolve('.lab/bootstrap-test-'));
 const scope={organizationId:'bootstrap-'+randomUUID(),venueId:'venue-local'};let userId:string|undefined;
 try{
  await mkdir(join(root,'scripts'));await mkdir(join(root,'apps/cloud-web'),{recursive:true});await mkdir(join(root,'supabase'));
  await writeFile(join(root,'package.json'),JSON.stringify({name:'mekoniq-bootstrap-test',private:true}));await writeFile(join(root,'pnpm-workspace.yaml'),'packages: []\n');
  await copyFile('scripts/bootstrap-local.mjs',join(root,'scripts/bootstrap-local.mjs'));await writeBootstrapConfig(root,db.projectId);await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
  const env={...process.env,BOOTSTRAP_ORGANIZATION_ID:scope.organizationId,BOOTSTRAP_VENUE_ID:scope.venueId,BOOTSTRAP_OWNER_EMAIL:`bootstrap-${randomUUID()}@example.test`};
  const first=spawnSync(process.execPath,[join(root,'scripts/bootstrap-local.mjs')],{cwd:root,env,encoding:'utf8',timeout:20000});expect(first.status,first.stderr.slice(0,2000)).toBe(0);
  const credentials=JSON.parse(await readFile(join(root,'.lab/bootstrap/owner-credentials.json'),'utf8'));expect(credentials.organizationId).toBe(scope.organizationId);expect(first.stdout+first.stderr).not.toContain(credentials.password);
  expect((await stat(join(root,'apps/cloud-web/.env.local'))).mode&0o777).toBe(0o600);expect((await stat(join(root,'.lab/bootstrap/owner-credentials.json'))).mode&0o777).toBe(0o600);
  const [member]=await db.admin`SELECT user_id,role FROM venue_membership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`;userId=member.user_id;expect(member.role).toBe('owner');
  const original=await readFile(join(root,'apps/cloud-web/.env.local'),'utf8');expect(original).toContain('DEVICE_GRANT_PRIVATE_KEY=');expect(original).toContain('127.0.0.1:57421');
  const second=spawnSync(process.execPath,[join(root,'scripts/bootstrap-local.mjs')],{cwd:root,env,encoding:'utf8',timeout:20000});expect(second.status).not.toBe(0);expect(second.stderr).toContain('LOCAL_ENV_ALREADY_EXISTS');expect(await readFile(join(root,'apps/cloud-web/.env.local'),'utf8')).toBe(original);
 }finally{if(userId)await supabaseAdmin().auth.admin.deleteUser(userId);await db.admin`DELETE FROM venue WHERE organization_id=${scope.organizationId} AND id=${scope.venueId}`;await db.close();await rm(root,{recursive:true,force:true});}
});
