import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportWebReplay,loadRetainedReplay,xarmSupplementalLicensing} from '../../packages/lab-runtime/src/v2/replay/export';
const owned:string[]=[];afterEach(async()=>{for(const p of owned.splice(0))await rm(p,{recursive:true,force:true});});
async function output(){const root=await mkdtemp(join(tmpdir(),'web-replay-test-'));owned.push(root);return join(root,'package');}
const nominal='/tmp/mekoniq-b06-nominal-7-1iGdiu';
test('exports actual retained B06 captured horizon without changing evidence or sampling',async()=>{
 const captured=await loadRetainedReplay(nominal),out=await output(),m=await exportWebReplay(captured,out);
 expect(m.documentType).toBe('web-replay-package');expect(m.horizon.tick).toBe(10850);expect(m.coverage.sampled).toBe(false);expect(m.provenance.accepted).toBe(false);expect(m.coverage.prefixCovered).toBe(true);expect(m.coverage.streamFinalized).toBe(false);
 expect(m.assets.reduce((n,a)=>n+a.bytes,0)).toBeLessThan(25*1024*1024);expect(m.assets.some(a=>a.role==='notice')).toBe(true);expect(m.streams[0]!.samples).toBe(10851);
 expect((await readFile(join(out,'manifest.json'),'utf8'))).not.toContain(nominal);expect(await readdir(out)).not.toContain('signing-key.json');
});
test('exports the retained B04 impulse fall including its exact final tick and terminal coverage',async()=>{
 const m=await exportWebReplay(await loadRetainedReplay('/tmp/mekoniq-b04a-final-681b8ad-20261114-0954/cup-fall'),await output());expect(m.horizon.tick).toBe(520);expect(m.coverage.sampled).toBe(false);expect(m.streams.some(s=>s.kind==='physics'&&s.lastTick===520)).toBe(true);expect(m.coverage.terminal).toBe('LOAD_FELL');expect(m.assets.some(a=>a.path==='observations/payload-perturbation.json')).toBe(true);
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
 const capture=await loadRetainedReplay('/tmp/mekoniq-b04a-final-681b8ad-20261114-0954/cup-fall'),privateFields={token:'PRIVATE_VALUE',apiKey:'PRIVATE_VALUE',sessionToken:'PRIVATE_VALUE',endpoint:'http://127.0.0.1:4176/private',note:'transport http://10.1.1.1:8000/foo'};(capture.report as unknown as Record<string,unknown>).privateFields=privateFields;const out=await output(),m=await exportWebReplay(capture,out),a=m.assets.find(a=>a.role==='report')!,{gunzipSync}=await import('node:zlib'),text=gunzipSync(await readFile(join(out,a.path))).toString();expect(text).not.toContain('PRIVATE_VALUE');expect(text).not.toContain('127.0.0.1');expect(text).not.toContain('10.1.1.1');expect(privateFields.token).toBe('PRIVATE_VALUE');expect(m.provenance.reportTransform).toBe('credential_redaction_v1');
});
test('receipt inventory, run identity, applied horizon and measured force/pose are independently bound',async()=>{
 const {cp}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),root=await output(),original='/tmp/mekoniq-b04a-final-681b8ad-20261114-0954/cup-fall';await cp(original,root,{recursive:true});const receiptPath=join(root,'run/worker/payload-perturbation.json'),casePath=join(root,'case.json'),bytes=await readFile(receiptPath),record=JSON.parse(await readFile(casePath,'utf8')),receipt=JSON.parse(bytes.toString());
 for(const change of [{bootId:'other'},{tick:521},{forceN:[0,0,0]},{forceMapN:[0,0,0]},{afterPoseMap:{positionM:[0,0,0],quaternionXyzw:[0,0,0,1]}}]){const changed=Buffer.from(JSON.stringify({...receipt,...change})),c=structuredClone(record),ref=c.artifacts.find((f:{path:string})=>f.path==='run/worker/payload-perturbation.json');ref.bytes=changed.length;ref.sha256=createHash('sha256').update(changed).digest('hex');await writeFile(receiptPath,changed);await writeFile(casePath,JSON.stringify(c));await expect(loadRetainedReplay(root)).rejects.toThrow(/REPLAY_RECEIPT/);}
 await writeFile(receiptPath,bytes);await writeFile(casePath,JSON.stringify(record));await rm(receiptPath);await expect(loadRetainedReplay(root)).rejects.toThrow();
});
