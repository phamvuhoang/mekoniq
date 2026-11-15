// @ts-expect-error explicit digest-verified retained evidence tooling
import {retainedInput} from '../../scripts/retained-inputs.mjs';
import {afterEach,expect,test,vi} from 'vitest';
import * as zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportWebReplay,loadRetainedReplay,xarmSupplementalLicensing} from '../../packages/lab-runtime/src/v2/replay/export';
const compression=vi.hoisted(()=>({started:()=>{}}));
vi.mock('node:zlib',async importOriginal=>{const actual=await importOriginal<typeof import('node:zlib')>();return {...actual,gzipSync:vi.fn(actual.gzipSync),gzip:vi.fn((...args:Parameters<typeof actual.gzip>)=>{compression.started();return actual.gzip(...args);})};});
const owned:string[]=[];afterEach(async()=>{compression.started=()=>{};for(const p of owned.splice(0))await rm(p,{recursive:true,force:true});});
async function output(){const root=await mkdtemp(join(tmpdir(),'web-replay-test-'));owned.push(root);return join(root,'package');}
const nominal=retainedInput('cell-nominal-7'),expectedExport=retainedInput('cell-nominal-export');
test('exports actual retained B06 captured horizon without changing evidence or sampling',async()=>{
 const captured=await loadRetainedReplay(nominal),out=await output(),m=await exportWebReplay(captured,out);
 expect(m.documentType).toBe('web-replay-package');expect(m.horizon.tick).toBe(10850);expect(m.coverage.sampled).toBe(false);expect(m.provenance.accepted).toBe(false);expect(m.coverage.prefixCovered).toBe(true);expect(m.coverage.streamFinalized).toBe(false);
 expect(m.assets.reduce((n,a)=>n+a.bytes,0)).toBeLessThan(25*1024*1024);expect(m.assets.some(a=>a.role==='notice')).toBe(true);expect(m.streams[0]!.samples).toBe(10851);
 expect((await readFile(join(out,'manifest.json'),'utf8'))).not.toContain(nominal);expect(await readdir(out)).not.toContain('signing-key.json');
});
test('exports the retained B04 impulse fall including its exact final tick and terminal coverage',async()=>{
 const m=await exportWebReplay(await loadRetainedReplay(retainedInput('payload-cup-fall')),await output());expect(m.horizon.tick).toBe(520);expect(m.coverage.sampled).toBe(false);expect(m.streams.some(s=>s.kind==='physics'&&s.lastTick===520)).toBe(true);expect(m.coverage.terminal).toBe('LOAD_FELL');expect(m.assets.some(a=>a.path==='observations/payload-perturbation.json')).toBe(true);
});
test('rejects missing and corrupt admitted chunks, existing outputs and symlink input roots',async()=>{
 const capture=await loadRetainedReplay(nominal),out=await output();await exportWebReplay(capture,out);await expect(exportWebReplay(capture,out)).rejects.toThrow(/EXISTS/);
 const root=await output();await symlink(nominal,root);await expect(loadRetainedReplay(root)).rejects.toThrow(/PATH/);
 const broken=structuredClone(capture);broken.world!.records[2]!.snapshot.tick=8;await expect(exportWebReplay(broken,await output())).rejects.toThrow(/ORDER|IDENTITY/);
});
test('same-H exports own unique publications and failed output is retryable',async()=>{
 const capture=await loadRetainedReplay(nominal),a=await output(),b=await output();const [ma,mb]=await Promise.all([exportWebReplay(capture,a),exportWebReplay(capture,b)]);expect(ma).toEqual(mb);expect(await readdir(a)).toEqual(await readdir(b));
 const c=await output(),bad={...capture,report:{...capture.report,outcome:{...capture.report.outcome,tick:10849}}};await expect(exportWebReplay(bad,c)).rejects.toThrow(/HORIZON/);await exportWebReplay(capture,c);
});
test('missing or corrupt native chunks and nested symlinks are refused from isolated copies',async()=>{
 const {cp,mkdir,unlink}=await import('node:fs/promises'),root=await output();await cp(nominal,root,{recursive:true});const m=JSON.parse(await readFile(join(root,'world-evidence/manifest.json'),'utf8')),chunk=join(root,'world-evidence',m.chunks[0].path),original=await readFile(chunk);await writeFile(chunk,'corrupt');await expect(loadRetainedReplay(root)).rejects.toThrow(/CAPTURE|HASH|INVALID/);await rm(chunk);await expect(loadRetainedReplay(root)).rejects.toThrow();await writeFile(chunk,original);const bundle=join(root,'mujoco-world/bundle'),blobs=join(bundle,'blobs');await rm(blobs,{recursive:true});await mkdir(join(root,'outside'));await symlink(join(root,'outside'),blobs);await expect(loadRetainedReplay(root)).rejects.toThrow(/PATH|ENOENT/);await unlink(blobs);
});
test('unknown substituted vendor assets and tampered supplemental NOTICE are refused',async()=>{
 const capture=await loadRetainedReplay(nominal),a=capture.world!.admission,component=a.files.get('arm-component.json')!,changed=Buffer.from(component);changed[0]=32;const unknown=new Map(a.files);unknown.set('arm-component.json',changed);expect(()=>xarmSupplementalLicensing(unknown)).toThrow('REPLAY_VENDOR_COMPONENT_UNKNOWN');const missingMesh=new Map(a.files);missingMesh.delete([...missingMesh.keys()].find(p=>p.endsWith('.stl'))!);expect(()=>xarmSupplementalLicensing(missingMesh)).toThrow('REPLAY_VENDOR_ASSETS_UNKNOWN');(a.files as Map<string,Uint8Array>).set('arm-component.json',changed);await expect(exportWebReplay(capture,await output())).rejects.toThrow(/CLOSURE|MODEL|VENDOR/);(a.files as Map<string,Uint8Array>).set('arm-component.json',component);
 const {default:record}=await import('../../packages/lab-runtime/src/v2/replay/xarm-licensing.json'),notice=record.NOTICE;record.NOTICE=Buffer.from('wrong terms').toString('base64');try{await expect(exportWebReplay(capture,await output())).rejects.toThrow('REPLAY_NOTICE_HASH');}finally{record.NOTICE=notice;}
});
test('public exports redact nested credentials/internal endpoints without changing captured inputs',async()=>{
 const capture=await loadRetainedReplay(retainedInput('payload-cup-fall')),privateFields={token:'PRIVATE_VALUE',apiKey:'PRIVATE_VALUE',sessionToken:'PRIVATE_VALUE',endpoint:'http://127.0.0.1:4176/private',note:'transport http://10.1.1.1:8000/foo'};(capture.report as unknown as Record<string,unknown>).privateFields=privateFields;const out=await output(),m=await exportWebReplay(capture,out),a=m.assets.find(a=>a.role==='report')!,{gunzipSync}=await import('node:zlib'),text=gunzipSync(await readFile(join(out,a.path))).toString();expect(text).not.toContain('PRIVATE_VALUE');expect(text).not.toContain('127.0.0.1');expect(text).not.toContain('10.1.1.1');expect(privateFields.token).toBe('PRIVATE_VALUE');expect(m.provenance.reportTransform).toBe('credential_redaction_v1');
});
test('receipt inventory, run identity, applied horizon and measured force/pose are independently bound',async()=>{
 const {cp}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),root=await output(),original=retainedInput('payload-cup-fall');await cp(original,root,{recursive:true});const receiptPath=join(root,'run/worker/payload-perturbation.json'),casePath=join(root,'case.json'),bytes=await readFile(receiptPath),record=JSON.parse(await readFile(casePath,'utf8')),receipt=JSON.parse(bytes.toString());
 for(const change of [{bootId:'other'},{tick:521},{forceN:[0,0,0]},{forceMapN:[0,0,0]},{afterPoseMap:{positionM:[0,0,0],quaternionXyzw:[0,0,0,1]}}]){const changed=Buffer.from(JSON.stringify({...receipt,...change})),c=structuredClone(record),ref=c.artifacts.find((f:{path:string})=>f.path==='run/worker/payload-perturbation.json');ref.bytes=changed.length;ref.sha256=createHash('sha256').update(changed).digest('hex');await writeFile(receiptPath,changed);await writeFile(casePath,JSON.stringify(c));await expect(loadRetainedReplay(root)).rejects.toThrow(/REPLAY_RECEIPT/);}
 await writeFile(receiptPath,bytes);await writeFile(casePath,JSON.stringify(record));await rm(receiptPath);await expect(loadRetainedReplay(root)).rejects.toThrow();
});

test('detached export uses sequential asynchronous compression and preserves exact stored/decoded gzip identities',async()=>{const capture=await loadRetainedReplay(retainedInput('payload-cup-fall')),out=await output(),sync=zlib.gzipSync;const trap=vi.spyOn(zlib,'gzipSync').mockImplementation(()=>{throw Error('SYNCHRONOUS_EXPORT_COMPRESSION');});let manifest;try{manifest=await exportWebReplay(capture,out);}finally{trap.mockRestore();}for(const a of manifest.assets){const bytes=await readFile(join(out,a.path)),plain=a.encoding==='gzip'?zlib.gunzipSync(bytes):bytes;expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);expect(createHash('sha256').update(plain).digest('hex')).toBe(a.decodedSha256);if(a.encoding==='gzip')expect(bytes).toEqual(sync(plain));}});
test('the same genuine captured world input retains every original encoded and decoded asset hash',async()=>{const capture=await loadRetainedReplay(nominal),expected=JSON.parse(await readFile(join(expectedExport,'manifest.json'),'utf8')),actual=await exportWebReplay(capture,await output());expect(actual.assets).toEqual(expected.assets);expect(actual.streams).toEqual(expected.streams);});

test('abort during asynchronous compression releases the owned publication only after cleanup and allows retry',async()=>{const capture=await loadRetainedReplay(retainedInput('payload-cup-fall')),out=await output(),abort=new AbortController();compression.started=()=>abort.abort();await expect(exportWebReplay(capture,out,{signal:abort.signal})).rejects.toThrow('REPLAY_ABORTED');expect((await readdir(join(out,'..'))).filter(p=>p.startsWith('.replay-'))).toEqual([]);compression.started=()=>{};expect((await exportWebReplay(capture,out)).horizon.tick).toBe(520);});
