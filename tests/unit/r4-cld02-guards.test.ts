import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test} from 'vitest';

let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'r4-cld02-guards-'));});
afterEach(()=>rmSync(dir,{recursive:true,force:true}));

const nativeCases=[
 'test_the_legacy_path_gives_the_three_recorded_digests',
 'test_worker_responses_match_the_pre_fix_wire_bytes[mobile-no-drive]',
 'test_worker_responses_match_the_pre_fix_wire_bytes[mobile-cil]',
 'test_worker_responses_match_the_pre_fix_wire_bytes[arm-no-drive]',
];

function verify(names:string[],extra=''){
 const xml=join(dir,'full.xml');
 writeFileSync(xml,'<testsuites><testsuite>'+names.map(name=>`<testcase name="${name}"/>`).join('')+extra+'</testsuite></testsuites>');
 return spawnSync('python3',['-B','scripts/check-r4-cld02.py','receipt',xml],{encoding:'utf8',env:{...process.env,PYTHONOPTIMIZE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
}
test('an optimized receipt reader accepts all four completed native comparisons',()=>{
 expect(verify(nativeCases).status).toBe(0);
});
test('an optimized receipt reader refuses a skip elsewhere in a suite with all the required comparisons',()=>{
 const r=verify(nativeCases,'<testcase name="other"><skipped/></testcase>');
 expect(r.status).toBe(1);expect(r.stderr).toContain('skipped');
});
test('an optimized receipt reader refuses a suite missing a native comparison',()=>{
 const r=verify(nativeCases.slice(1));
 expect(r.status).toBe(1);expect(r.stderr).toContain(nativeCases[0]);
});

test('refuses an optimized worker interpreter before its archived protocol assertions can be disabled',()=>{
 const r=spawnSync('python3',['-B','scripts/check-r4-cld02.py','guest'],{encoding:'utf8',env:{...process.env,PYTHONOPTIMIZE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
 expect(r.status).toBe(1);expect(r.stderr).toContain('PYTHON_OPTIMIZATION_ENABLED');
});

function dockerHost(host:string,context:string,contextEndpoint=''){
 // The path contains only this context metadata reader. No Docker daemon is contacted.
 writeFileSync(join(dir,'docker'),`#!/bin/sh
[ "$1" = context ] && [ "$2" = inspect ] || exit 88
printf '%s\\n' "$TEST_CONTEXT_ENDPOINT"
`,{mode:0o755});
 return spawnSync('/bin/bash',['scripts/r4-cld02-docker-host.sh'],{encoding:'utf8',env:{NODE_ENV:'test',PATH:dir,DOCKER_HOST:host,DOCKER_CONTEXT:context,TEST_CONTEXT_ENDPOINT:contextEndpoint}});
}
test('conflicting Docker selectors cannot hide a remote context behind a local host',()=>{
 const r=dockerHost('unix:///var/run/docker.sock','remote','ssh://example.invalid');
 expect(r.status).toBe(1);expect(r.stderr).toContain('CONFLICTING_DOCKER_SELECTORS');
});
test.each([
 ['tcp://example.invalid:2375','',''],
 ['','remote','ssh://example.invalid'],
 ['unix://relative.sock','',''],
])('refuses a non-local or non-absolute Docker endpoint (%s, %s)',(host,context,resolved)=>{
 const r=dockerHost(host,context,resolved);
 expect(r.status).toBe(1);expect(r.stderr).toContain('LOCAL_DOCKER_DAEMON_REQUIRED');
});
test.each([
 ['unix:///run/docker.sock','',''],
 ['','local-docker','unix:///run/docker.sock'],
 ['','','unix:///run/docker.sock'],
])('resolves the socket selected by host or context (%s, %s)',(host,context,resolved)=>{
 const r=dockerHost(host,context,resolved);
 expect(r.status).toBe(0);expect(r.stdout.trim()).toBe('unix:///run/docker.sock');
});
