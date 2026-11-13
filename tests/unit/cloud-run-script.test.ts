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
[ -z "\${FAKE_TRACE:-}" ] || echo "FAKE-RAN $1 $2 $3" >&2
case "$*" in
 *"services describe"*) # a new service: the first describe fails (not found); FAKE_EXISTS=1: always answers
  if [ -z "\${FAKE_EXISTS:-}" ] && [ ! -e "$FAKE_LOG.d" ]; then : > "$FAKE_LOG.d"; exit 1; fi
  echo "\${FAKE_URL-${URL_}}";;
 *"run deploy"*) [ "\${FAKE_FAIL:-}" != deploy ] || exit 1;;
 *"services update"*) [ "\${FAKE_FAIL:-}" != update ] || exit 1;;
esac
`);
 chmodSync(join(fake,'gcloud'),0o755);
});
afterAll(()=>{rmSync(dir,{recursive:true,force:true});});

let n=0;
function run(args:string[],env:Record<string,string|undefined>={},path=`${fake}:/usr/bin:/bin`,merge=false){
 const log=join(dir,`log-${n++}`);
 const e:Record<string,string>={PATH:path,HOME:dir,FAKE_LOG:log};
 for(const [k,v] of Object.entries({...BASE,...env}))if(v!==undefined)e[k]=v;
 const r=merge?spawnSync('/bin/bash',['-c','/bin/bash "$0" "$@" 2>&1',SCRIPT,...args],{env:e as NodeJS.ProcessEnv,encoding:'utf8'}):spawnSync('/bin/bash',[SCRIPT,...args],{env:e as NodeJS.ProcessEnv,encoding:'utf8'});
 const calls=existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(l=>l.split('\t')):[];
 return {status:r.status,out:r.stdout,err:r.stderr,calls,keyInEnv:existsSync(`${log}.env`)};
}

test('without --execute it prints every deploy flag and never calls gcloud, even with a fake first on PATH',()=>{
 const r=run([]);expect(r.status).toBe(0);expect(r.calls).toEqual([]);
 for(const f of FLAGS)expect(r.out).toContain(f);
 expect(r.out).toContain('--set-secrets=MEKONIQ_LAB_ACCESS_KEY=lab-access-key:latest');
 expect(r.out).toContain('--set-env-vars=LAB_ALLOW_ORIGIN=https://lab.example.com,LAB_PUBLIC_HOST=');
 expect(r.out).toContain('--region=asia-southeast1');expect(r.out).toContain('--project=my-project');expect(r.out).toContain(`--image=${BASE.IMAGE}`);
 // both cases are printed and labelled: A, the service exists (re-run: describe, then one deploy that keeps its host); B, a new service (deploy with the placeholder, describe, update)
 const a=r.out.indexOf('# Case A'),b=r.out.indexOf('# Case B');expect(a).toBeGreaterThan(-1);expect(b).toBeGreaterThan(a);
 const A=r.out.slice(a,b),B=r.out.slice(b);
 expect(A.indexOf('services describe')).toBeGreaterThan(-1);expect(A.indexOf('services describe')).toBeLessThan(A.indexOf('run deploy'));expect(A).toContain('LAB_PUBLIC_HOST=HOST_OF_THE_EXISTING_SERVICE_URL');expect(A).not.toContain('services update');
 expect(B.indexOf('run deploy')).toBeLessThan(B.indexOf('services describe'));expect(B.indexOf('services describe')).toBeLessThan(B.indexOf('services update'));expect(B).toContain('LAB_PUBLIC_HOST=pending.invalid');
});

test('a dry run works where gcloud is not installed; --dry-run is the same as no flag',()=>{
 const r=run(['--dry-run'],{},'/usr/bin:/bin');expect(r.status).toBe(0);expect(r.out).toContain('gcloud run deploy');
 expect(run(['--dry-run','--execute']).status).toBe(2);
});

test('--execute without gcloud on PATH stops with GCLOUD_NOT_FOUND',()=>{
 const r=run(['--execute'],{},'/usr/bin:/bin');expect(r.status).toBe(3);expect(r.err).toContain('GCLOUD_NOT_FOUND');
});

test('--execute on a new service: one read that finds nothing, deploy once with the placeholder, read the URL, set LAB_PUBLIC_HOST to that host',()=>{
 const r=run(['--execute']);expect(r.status).toBe(0);
 expect(r.calls.map(c=>c.slice(0,3).join(' '))).toEqual(['run services describe','run deploy mekoniq-lab-runtime','run services describe','run services update']);
 const [probe,deploy,describe,update]=r.calls;
 expect(probe).toContain('--format=value(status.url)');
 for(const f of [...FLAGS,'--set-secrets=MEKONIQ_LAB_ACCESS_KEY=lab-access-key:latest',`--image=${BASE.IMAGE}`,'--project=my-project','--region=asia-southeast1'])expect(deploy).toContain(f);
 expect(deploy).toContain('--set-env-vars=LAB_ALLOW_ORIGIN=https://lab.example.com,LAB_PUBLIC_HOST=pending.invalid');
 expect(describe).toContain('--format=value(status.url)');expect(describe).toContain('--region=asia-southeast1');
 expect(update).toContain('--update-env-vars=LAB_PUBLIC_HOST=lab-runtime-abc123-as.a.run.app');
 expect(update.some(a=>a.startsWith('--set-env-vars'))).toBe(false); // would wipe LAB_ALLOW_ORIGIN
 expect(r.out.split('\n').filter(l=>l.startsWith('+ gcloud')).length).toBe(4);
});

test('--execute on an existing service (a re-run): one read, one deploy that carries the live host, no update, never the placeholder',()=>{
 const r=run(['--execute'],{FAKE_EXISTS:'1'});expect(r.status).toBe(0);
 expect(r.calls.map(c=>c.slice(0,3).join(' '))).toEqual(['run services describe','run deploy mekoniq-lab-runtime']);
 expect(r.calls[1]).toContain('--set-env-vars=LAB_ALLOW_ORIGIN=https://lab.example.com,LAB_PUBLIC_HOST=lab-runtime-abc123-as.a.run.app');
 for(const f of FLAGS)expect(r.calls[1]).toContain(f);
 expect(r.out+r.err).not.toContain('pending.invalid');
 expect(r.out).not.toContain('services update');
});

test('--execute shows each command before it runs (the fake reports to stderr, merged with stdout)',()=>{
 const seq=(env:Record<string,string>)=>run(['--execute'],{FAKE_TRACE:'1',...env},undefined,true).out.split('\n').filter(l=>/^(\+ gcloud|FAKE-RAN)/.test(l)).map(l=>l.replace(/^\+ gcloud (\S+ \S+).*/,'+ $1').replace(/^FAKE-RAN (\S+ \S+).*/,'ran $1'));
 expect(seq({})).toEqual(['+ run services','ran run services','+ run deploy','ran run deploy','+ run services','ran run services','+ run services','ran run services']);
 expect(seq({FAKE_EXISTS:'1'})).toEqual(['+ run services','ran run services','+ run deploy','ran run deploy']);
});

test('a failing deploy stops the script; a URL that is not https stops it, before the deploy for an existing service and before the update for a new one',()=>{
 const a=run(['--execute'],{FAKE_FAIL:'deploy'});expect(a.status).not.toBe(0);expect(a.calls.length).toBe(2);
 const b=run(['--execute'],{FAKE_URL:'http://x.example.com',FAKE_EXISTS:'1'});expect(b.status).toBe(1);expect(b.err).toContain('SERVICE_URL_INVALID');expect(b.calls.length).toBe(1);
 const c=run(['--execute'],{FAKE_URL:'http://x.example.com'}); // first describe fails (new), deploy, then the URL is not https
 expect(c.status).toBe(1);expect(c.err).toContain('SERVICE_URL_INVALID');expect(c.calls.length).toBe(3);
 const d=run(['--execute'],{FAKE_URL:''});expect(d.status).toBe(1);expect(d.calls.length).toBe(3);
});

test('when the update fails the script exits non-zero and prints the exact command to run by hand, with no key anywhere',()=>{
 const r=run(['--execute'],{FAKE_FAIL:'update',MEKONIQ_LAB_ACCESS_KEY:KEY});expect(r.status).toBe(4);
 expect(r.err).toContain('UPDATE_FAILED');
 expect(r.err).toContain('+ gcloud run services update mekoniq-lab-runtime --project=my-project --region=asia-southeast1 --update-env-vars=LAB_PUBLIC_HOST=lab-runtime-abc123-as.a.run.app');
 expect(r.calls.length).toBe(4);expect(r.out+r.err).not.toContain(KEY);expect(JSON.stringify(r.calls)).not.toContain(KEY);expect(r.keyInEnv).toBe(false);
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
  const r=run(['--execute'],{LAB_ORIGIN:o});expect(r.status,o).toBe(0);expect(r.calls.find(c=>c[1]==='deploy')!.some(a=>a.startsWith(`--set-env-vars=LAB_ALLOW_ORIGIN=${o},`)),o).toBe(true);
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

test('--help prints usage and exits 0 without gcloud; --execute=false and similar are refused, never read as a dry run or as --execute; a doubled --execute still deploys once',()=>{
 const h=run(['--help']);expect(h.status).toBe(0);expect(h.out).toContain('--execute');expect(h.calls).toEqual([]);
 for(const a of ['--execute=false','--execute=true','--execute=','-execute','execute']){const r=run([a]);expect(r.status,a).toBe(2);expect(r.err).toContain('UNKNOWN_ARGUMENT');expect(r.calls,a).toEqual([]);}
 const d=run(['--execute','--execute']);expect(d.status).toBe(0);expect(d.calls.filter(c=>c[1]==='deploy').length).toBe(1);
});
