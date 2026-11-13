// N05: deploy/lab-runtime/cloud-run.sh prints the Cloud Run commands by default and runs them only with --execute. A fake gcloud first on PATH records its arguments; nothing here
// needs a network or the real gcloud, and the script never receives, prints or passes the access key (it names a Secret Manager secret).
import {spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterAll,beforeAll,expect,test} from 'vitest';

const SCRIPT=resolve('deploy/lab-runtime/cloud-run.sh'),KEY='k3y-'.repeat(12),URL_='https://lab-runtime-abc123-as.a.run.app';
const FLAGS=['--execution-environment=gen2','--max-instances=1','--min-instances=0','--concurrency=20','--timeout=3600','--cpu=1','--memory=2Gi','--allow-unauthenticated'];
const BASE={GCP_PROJECT:'my-project',LAB_ORIGIN:'https://lab.example.com',ACCESS_KEY_SECRET:'lab-access-key',IMAGE:'asia-southeast1-docker.pkg.dev/my-project/lab/runtime:abc1234'};
let dir='',fake='';
beforeAll(()=>{
 dir=mkdtempSync(join(tmpdir(),'cloud-run-'));fake=join(dir,'bin');
 spawnSync('mkdir',[fake]);
 // records one line per call (arguments joined by a tab), and whether the key reached its environment; answers the URL query
 writeFileSync(join(fake,'gcloud'),`#!/bin/sh
printf '%s\\n' "$(IFS='	'; echo "$*")" >> "$FAKE_LOG"
[ -z "\${MEKONIQ_LAB_ACCESS_KEY:-}" ] || echo KEY_IN_ENV >> "$FAKE_LOG.env"
[ "\${FAKE_FAIL:-}" != "$1 $2" ] || exit 1
case "$*" in *"services describe"*) echo "\${FAKE_URL-${URL_}}";; esac
`);
 chmodSync(join(fake,'gcloud'),0o755);
});
afterAll(()=>{rmSync(dir,{recursive:true,force:true});});

let n=0;
function run(args:string[],env:Record<string,string|undefined>={},path=`${fake}:/usr/bin:/bin`){
 const log=join(dir,`log-${n++}`);
 const e:Record<string,string>={PATH:path,HOME:dir,FAKE_LOG:log};
 for(const [k,v] of Object.entries({...BASE,...env}))if(v!==undefined)e[k]=v;
 const r=spawnSync('/bin/bash',[SCRIPT,...args],{env:e as NodeJS.ProcessEnv,encoding:'utf8'});
 const calls=existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(l=>l.split('\t')):[];
 return {status:r.status,out:r.stdout,err:r.stderr,calls,keyInEnv:existsSync(`${log}.env`)};
}

test('without --execute it prints every deploy flag and never calls gcloud, even with a fake first on PATH',()=>{
 const r=run([]);expect(r.status).toBe(0);expect(r.calls).toEqual([]);
 for(const f of FLAGS)expect(r.out).toContain(f);
 expect(r.out).toContain('--set-secrets=MEKONIQ_LAB_ACCESS_KEY=lab-access-key:latest');
 expect(r.out).toContain('--set-env-vars=LAB_ALLOW_ORIGIN=https://lab.example.com,LAB_PUBLIC_HOST=');
 expect(r.out).toContain('--region=asia-southeast1');expect(r.out).toContain('--project=my-project');expect(r.out).toContain(`--image=${BASE.IMAGE}`);
 expect(r.out.indexOf('run deploy')).toBeLessThan(r.out.indexOf('describe'));expect(r.out.indexOf('describe')).toBeLessThan(r.out.indexOf('LAB_PUBLIC_HOST=',r.out.indexOf('describe')));
});

test('a dry run works where gcloud is not installed; --dry-run is the same as no flag',()=>{
 const r=run(['--dry-run'],{},'/usr/bin:/bin');expect(r.status).toBe(0);expect(r.out).toContain('gcloud run deploy');
 expect(run(['--dry-run','--execute']).status).toBe(2);
});

test('--execute without gcloud on PATH stops with GCLOUD_NOT_FOUND',()=>{
 const r=run(['--execute'],{},'/usr/bin:/bin');expect(r.status).toBe(3);expect(r.err).toContain('GCLOUD_NOT_FOUND');
});

test('--execute runs deploy once, then reads the URL, then sets LAB_PUBLIC_HOST to that host',()=>{
 const r=run(['--execute']);expect(r.status).toBe(0);
 expect(r.calls.map(c=>c.slice(0,3).join(' '))).toEqual(['run deploy mekoniq-lab-runtime','run services describe','run services update']);
 const [deploy,describe,update]=r.calls;
 for(const f of [...FLAGS,'--set-secrets=MEKONIQ_LAB_ACCESS_KEY=lab-access-key:latest',`--image=${BASE.IMAGE}`,'--project=my-project','--region=asia-southeast1'])expect(deploy).toContain(f);
 expect(deploy.some(a=>a.startsWith('--set-env-vars=LAB_ALLOW_ORIGIN=https://lab.example.com,LAB_PUBLIC_HOST='))).toBe(true);
 expect(describe).toContain('--format=value(status.url)');expect(describe).toContain('--region=asia-southeast1');
 expect(update).toContain('--update-env-vars=LAB_PUBLIC_HOST=lab-runtime-abc123-as.a.run.app');
 expect(update.some(a=>a.startsWith('--set-env-vars'))).toBe(false); // would wipe LAB_ALLOW_ORIGIN
 // each command is shown before it runs
 expect(r.out.split('\n').filter(l=>l.startsWith('+ gcloud')).length).toBe(3);
});

test('a failing deploy stops the script; a URL that is not https stops it before the update',()=>{
 const a=run(['--execute'],{FAKE_FAIL:'run deploy'});expect(a.status).not.toBe(0);expect(a.calls.length).toBe(1);
 const b=run(['--execute'],{FAKE_URL:'http://x.example.com'});expect(b.status).toBe(1);expect(b.err).toContain('SERVICE_URL_INVALID');expect(b.calls.length).toBe(2);
 const c=run(['--execute'],{FAKE_URL:''});expect(c.status).toBe(1);expect(c.calls.length).toBe(2);
});

test('no access key or secret value appears in output, in the arguments, or in the environment gcloud inherits',()=>{
 for(const args of [[],['--execute']]){
  const r=run(args,{MEKONIQ_LAB_ACCESS_KEY:KEY});
  expect(r.status).toBe(0);expect(r.out+r.err).not.toContain(KEY);expect(JSON.stringify(r.calls)).not.toContain(KEY);expect(r.keyInEnv).toBe(false);
 }
});

test('missing required variables exit 2 and name the variable; the region defaults to asia-southeast1',()=>{
 for(const name of ['GCP_PROJECT','LAB_ORIGIN','ACCESS_KEY_SECRET','IMAGE']){
  for(const v of [undefined,''])for(const args of [[],['--execute']]){
   const r=run(args,{[name]:v});expect(r.status,name).toBe(2);expect(r.err).toContain(name);expect(r.calls).toEqual([]);
  }
 }
 expect(run([],{GCP_REGION:'europe-west1'}).out).toContain('--region=europe-west1');
 expect(run([],{GCP_REGION:'not a region'}).status).toBe(2);
});

test('LAB_ORIGIN must be an exact origin: https, or http only for loopback; no path, wildcard, upper case or bad port',()=>{
 for(const o of ['*','https://*.example.com','https://lab.example.com/path','https://lab.example.com/','http://lab.example.com','lab.example.com','https://LAB.example.com','https://lab.example.com:0','https://lab.example.com:99999','https://lab.example.com,https://b.example.com','https://lab.example.com?x=1','https://user@lab.example.com','ftp://lab.example.com',' https://lab.example.com','https://lab.example.com\n']){
  const r=run([],{LAB_ORIGIN:o});expect(r.status,JSON.stringify(o)).toBe(2);expect(r.err).toContain('LAB_ORIGIN');expect(r.calls).toEqual([]);
 }
 for(const o of ['https://lab.example.com','https://lab.example.com:8443','http://127.0.0.1:4175','http://localhost:4175','http://[::1]:4175']){
  const r=run(['--execute'],{LAB_ORIGIN:o});expect(r.status,o).toBe(0);expect(r.calls[0].some(a=>a.startsWith(`--set-env-vars=LAB_ALLOW_ORIGIN=${o},`)),o).toBe(true);
 }
});

test('values are never evaluated as shell, and option-like or odd values are refused',()=>{
 const marker=join(dir,'pwned');
 for(const [k,v] of [['IMAGE',`x$(touch ${marker})`],['IMAGE',`x;touch ${marker}`],['IMAGE','--help'],['GCP_PROJECT','-x'],['ACCESS_KEY_SECRET','a:latest'],['ACCESS_KEY_SECRET','a b'],['LAB_ORIGIN',`https://$(touch ${marker}).example.com`],['SERVICE','Bad_Name']]){
  const r=run(['--execute'],{[k]:v});expect(r.status,`${k}=${v}`).toBe(2);expect(r.calls).toEqual([]);
 }
 expect(existsSync(marker)).toBe(false);
 expect(run(['--bogus']).status).toBe(2);expect(run(['--execute','extra']).status).toBe(2);
});

test('the script starts strict and has no eval',()=>{
 const s=readFileSync(SCRIPT,'utf8');expect(s).toMatch(/^#!\/usr\/bin\/env bash\n(#.*\n)*set -euo pipefail\n/);expect(s).not.toMatch(/\beval\b/);
});
