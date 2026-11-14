import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {openPhysicsRecorder,readPhysicsEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/physics-evidence';
import {admission,identity,assumptions,tick} from '../support/physics';
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(extra={}){const directory=await mkdtemp(join(tmpdir(),'physics-evidence-'));dirs.push(directory);return {directory,rec:await openPhysicsRecorder({directory,identity,admission,assumptions,metricsPolicyDigest:'e'.repeat(64),...extra})};}
test('ACK observations are durable before append returns; unpublished WAL is incomplete until flush',async()=>{
 const {directory,rec}=await setup();await rec.append(tick());expect(await readFile(join(directory,'pending.ndjson'),'utf8')).toContain('"tick":0');
 expect((await readPhysicsEvidence(directory,rec.manifest(),{admission})).complete).toBe(false);
 await rec.flush();const read=await readPhysicsEvidence(directory,rec.manifest(),{admission});expect(read.complete).toBe(true);expect(read.records).toHaveLength(1);
 await rec.append(tick(1));await rec.finish(null);expect((await readPhysicsEvidence(directory,rec.manifest(),{admission})).records).toHaveLength(2);
});
test.each(['duplicate','gap','clock','samples','identity','quaternion','roll','missing'])('rejects %s observations and leaves explicit advanced gaps',async mode=>{
 const {directory,rec}=await setup();await rec.append(tick());const t=tick(1);
 if(mode==='duplicate')t.tick=0;if(mode==='gap')t.tick=2;if(mode==='clock')t.simTimeNs='0';if(mode==='samples')t.contacts[0]!.samples=11;if(mode==='identity')t.loads[0]!.propId='other';if(mode==='quaternion')t.base[0]!.poseMap.quaternionXyzw=[0,0,0,2];if(mode==='roll')t.base[0]!.rollRad=1;if(mode==='missing')delete (t as Partial<typeof t>).contacts;
 await expect(rec.append(t)).rejects.toThrow();await rec.finish('PHYSICS_OBSERVATION_INVALID');expect((await readPhysicsEvidence(directory,rec.manifest(),{admission})).complete).toBe(false);
});
test.each(['missing','hash','path','symlink','bomb','shape','order'])('reader fails closed on %s without trusting complete claim',async mode=>{
 const {directory,rec}=await setup();await rec.append(tick());await rec.finish(null);const m=rec.manifest(),r=m.streams[0]!.chunks[0]!,file=join(directory,r.path);
 if(mode==='missing')await rm(file);if(mode==='hash')await writeFile(file,Buffer.alloc(r.bytes));if(mode==='path')r.path='../escape.gz';if(mode==='symlink'){await rm(file);await symlink('/etc/hosts',file);}
 if(['bomb','shape','order'].includes(mode)){const t=tick();if(mode==='shape')delete (t as Partial<typeof t>).contacts;const b=gzipSync(mode==='bomb'?' '.repeat(64*1024*1024+1):JSON.stringify(t)+'\n'+(mode==='order'?JSON.stringify(t)+'\n':''));await writeFile(file,b);r.bytes=b.length;r.sha256=createHash('sha256').update(b).digest('hex');}
 expect((await readPhysicsEvidence(directory,m,{admission})).complete).toBe(false);
});
test('quotas count orphan bytes, refuse increased per-stream caps, and do not recover a crash tail as complete',async()=>{
 await expect(setup({maxBytes:101*1024*1024})).rejects.toThrow();const {directory,rec}=await setup({maxBytes:5000});await writeFile(join(directory,'orphan'),Buffer.alloc(4500));await expect(rec.append(tick())).rejects.toThrow('QUOTA');
 const other=await setup();await other.rec.append(tick());const reopened=await openPhysicsRecorder({directory:other.directory,identity,admission,assumptions,metricsPolicyDigest:'e'.repeat(64)});expect(reopened.manifest().terminalReason).toBeTruthy();await expect(reopened.append(tick(1))).rejects.toThrow();
});
test('a killed writer between chunk publication and manifest rename cannot publish complete evidence',async()=>{
 const {spawn}=await import('node:child_process');const directory=await mkdtemp(join(tmpdir(),'physics-crash-'));dirs.push(directory);
 const code=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const rename=fs.rename;let manifests=0;fs.rename=async(a,b)=>{if(String(b).endsWith('/manifest.json')&&++manifests===2){process.stdout.write('BLOCKED\\n');await new Promise(()=>{});}return rename(a,b);};syncBuiltinESMExports();const {openPhysicsRecorder}=await import('./packages/lab-runtime/src/v2/simulation3d/physics-evidence.ts');const r=await openPhysicsRecorder(${JSON.stringify({directory,identity,admission,assumptions,metricsPolicyDigest:'e'.repeat(64),chunkTicks:1})});await r.append(${JSON.stringify(tick())});`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 let err='';child.stderr.on('data',b=>{err+=String(b);});
 const exit=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('child timeout '+err)),10000);child.stdout.on('data',b=>{if(String(b).includes('BLOCKED')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('child exited '+err));});});child.kill('SIGKILL');await exit;
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));expect((await readPhysicsEvidence(directory,manifest,{admission})).complete).toBe(false);expect(await readFile(join(directory,'write.intent'),'utf8')).toContain('lastTick');
 }finally{child.kill('SIGKILL');await exit;}
},15000);
test('reader binds supplied identity and admitted metrics policy rather than trusting a complete claim',async()=>{
 const {directory,rec}=await setup();await rec.append(tick());await rec.finish(null);
 expect((await readPhysicsEvidence(directory,rec.manifest(),{admission,identity:{...identity,bootId:'other'}})).complete).toBe(false);
 expect((await readPhysicsEvidence(directory,rec.manifest(),{admission,metricsPolicyDigest:'0'.repeat(64)})).complete).toBe(false);
 const m=rec.manifest();m.streams[0]!.chunks=Array(2001).fill(m.streams[0]!.chunks[0]);expect((await readPhysicsEvidence(directory,m,{admission})).complete).toBe(false);
});
test('queued appends preserve one durable tick order for concurrent callers',async()=>{
 const {directory,rec}=await setup();await Promise.all([rec.append(tick()),rec.append(tick(1))]);await rec.flush();expect((await readPhysicsEvidence(directory,rec.manifest(),{admission})).records.map(r=>r.tick)).toEqual([0,1]);
});
