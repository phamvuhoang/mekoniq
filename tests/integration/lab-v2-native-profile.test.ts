import {expect,test} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const run=(profile:string)=>spawnSync(process.execPath,['scripts/lab-sil.mjs','doctor','--backend','gazebo_nav2','--environment-profile',profile,'--json'],{encoding:'utf8',timeout:30000});
test('unknown environment profile is refused explicitly',()=>{
 const r=run('not-a-profile');expect(r.status).toBe(2);expect(r.stdout+r.stderr).toContain('PROFILE_UNKNOWN');
});
test('candidate ARM64 native profile reports actual inventory without claiming a Docker digest',()=>{
 const r=run('utm-ubuntu-arm64');expect(r.status).toBe(2);const report=JSON.parse(r.stdout);
 expect(report.image).toBeNull();expect(report.environment.id).toBe('utm-ubuntu-arm64');expect(report.environment.installation).toBe('native_apt');
 expect(report.environment.reasonCodes).toContain('PROFILE_INVENTORY_UNRESOLVED');expect(report.environment.actual.architecture).toBeTruthy();
 expect(report.environment.inventorySha256).toMatch(/^[a-f0-9]{64}$/);expect(report.prerequisitesMet).toBe(false);
});
test('backend rejects an unresolved native profile before contacting a worker and omits image provenance',async()=>{
 const {startGazeboBackend}=await import('../../packages/lab-runtime/src/v2/backends/gazebo-nav2');
 let requested=0;
 const world={bindings:{},inputHash:'a'.repeat(64),manifestHash:'b'.repeat(64),outputDirectory:'/unused',worldFile:'world.sdf',mapIdentityFile:'map.identity.json',sceneIndexFile:'scene-index.json',mapId:'map',mapRevision:'1',robots:[]};
 const backend=await startGazeboBackend(world,'run-native-profile',{environmentProfile:'utm-ubuntu-arm64',port:{request:async()=>{requested++;return {available:true,evidence:'sil'};},close:async()=>{}}});
 try{const c=await backend.capability();expect(c.available).toBe(false);expect(c.reasons).toContain('PROFILE_INVENTORY_UNRESOLVED');expect(c.image).toBeUndefined();expect(requested).toBe(0);}finally{await backend.close();}
});

test('null, incomplete and failed inspector responses cannot authorize a worker',async()=>{
 const {startGazeboBackend}=await import('../../packages/lab-runtime/src/v2/backends/gazebo-nav2');const root=mkdtempSync(join(tmpdir(),'profile-inspector-'));
 const world={bindings:{},inputHash:'a'.repeat(64),manifestHash:'b'.repeat(64),outputDirectory:'/unused',worldFile:'world.sdf',mapIdentityFile:'map.identity.json',sceneIndexFile:'scene-index.json',mapId:'map',mapRevision:'1',robots:[]};
 try{for(const [value,exit] of [[null,0],[{id:'utm-ubuntu-arm64',available:true},0],[{id:'utm-ubuntu-arm64',available:true,reasonCodes:[],actual:{},profileSha256:'a'.repeat(64),inventorySha256:'b'.repeat(64)},7]] as const){
  const python=join(root,'inspector');writeFileSync(python,`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(value))});process.exit(${exit});\n`,{mode:0o700});let requests=0;
  const backend=await startGazeboBackend(world,'invalid-inspector',{environmentProfile:'utm-ubuntu-arm64',python,port:{request:async()=>{requests++;return {available:true,evidence:'sil'};},close:async()=>{}}});
  try{expect((await backend.capability()).reasons).toContain('PROFILE_INVENTORY_UNREADABLE');expect(requests).toBe(0);}finally{await backend.close();}
 }}finally{rmSync(root,{recursive:true,force:true});}
});
test('successful inspector metadata needs complete concrete identities, not truthy placeholders',async()=>{
 const {validNativeProfileReport}=await import('../../scripts/native-sim/profile-report.mjs');
 const actual={platform:'linux',architecture:'arm64',os:{id:'ubuntu',version:'24.04'},packages:{'engine-library':'8.0'},runtime:{rosDistro:'jazzy',amentPrefixes:['/opt/ros/jazzy'],overlayManifests:{},pythonPath:'',libraryPath:'',gazeboPluginPath:'',executables:{ros2:{path:'/opt/ros/jazzy/bin/ros2',sha256:'a'.repeat(64)},gz:{path:'/usr/bin/gz',sha256:'b'.repeat(64)}}}};
 const report={id:'utm-ubuntu-arm64',available:true,reasonCodes:[],installation:'native_apt',image:null,headless:true,profileSha256:'c'.repeat(64),inventorySha256:'d'.repeat(64),actual};
 expect(validNativeProfileReport(report,report.id)).toBe(true);
 for(const patch of [{actual:{}},{profileSha256:'not-a-hash'},{inventorySha256:true},{image:{digest:'wrong-platform'}},{actual:{...actual,runtime:{...actual.runtime,overlayManifests:{'/workspace/install':'invalid'}}}}])expect(validNativeProfileReport({...report,...patch},report.id)).toBe(false);
});
