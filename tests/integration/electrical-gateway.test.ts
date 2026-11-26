import {afterEach,expect,test} from 'vitest';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {createEngineeringService,type CompilerPort} from '../../packages/lab-runtime/src/engineering/gateway';
import {engineeringDriveFixtureDir} from '../../packages/lab-runtime/src/engineering/runtime-options';

const roots:string[]=[],gateways:LabGateway[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of roots.splice(0))await rm(d,{recursive:true,force:true});});
const temp=async(p:string)=>{const d=await mkdtemp(join(tmpdir(),p));roots.push(d);return d;};
const sha=(b:string)=>createHash('sha256').update(b).digest('hex');
const FIXTURE='robotics/simulation-mujoco/fixtures/serve-tray-v1/';
/** Writes a scene with the wheel bindings the electrical compile reads; no physics, so the bundle is compiled but not runnable. */
const sceneCompiler:CompilerPort={version:'electrical-test-compiler',async compileResolved(input,outDir){
 const scene=JSON.stringify({projectDigest:input.projectDigest,wheelBindings:[{id:'l',entityId:'amr-1',side:'left',radiusM:0.1,jointId:'wheel-left'},{id:'r',entityId:'amr-1',side:'right',radiusM:0.1,jointId:'wheel-right'}]});
 await writeFile(join(outDir,'scene.json'),scene);return {sceneDigest:sha(scene),files:[{path:'scene.json',sha256:sha(scene)}]};
}};

async function boot(electrical=true,driveFixtureDir:string|null='robotics/simulation-mujoco/fixtures/drive-v1'){
 const directory=await temp('elec-gw-'),catalogRoot=await temp('elec-cat-'),parts=JSON.parse(await readFile(FIXTURE+'serve-3d-components.json','utf8')) as {components:Record<string,unknown>;models:Record<string,unknown>};
 await cp('robotics/catalog',catalogRoot,{recursive:true});
 const index=JSON.parse(await readFile(join(catalogRoot,'catalog.json'),'utf8'));
 for(const [digest,c] of Object.entries(parts.components)){const file=`components/${digest}.json`;await writeFile(join(catalogRoot,file),JSON.stringify(c));if(!index.components.some((e:{digest:string})=>e.digest===digest))index.components.push({file,digest});}
 for(const [digest,m] of Object.entries(parts.models))await writeFile(join(catalogRoot,'models',`${digest}.json`),JSON.stringify(m));
 await writeFile(join(catalogRoot,'catalog.json'),JSON.stringify(index));
 const profiles={'engineering-webots-3d-v1':sceneCompiler,'engineering-mujoco-3d-v1':sceneCompiler};
 const g=await startLabGateway({port:0,directory:join(directory,'runs'),sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{engineering:createEngineeringService({directory:join(directory,'engineering'),catalogRoot,compilers:profiles,electrical,...driveFixtureDir?{driveFixtureDir}:{}})}});
 gateways.push(g);
 const pair=async()=>{const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.issuePairingToken()})});return {cookie:r.headers.get('set-cookie')!.split(';')[0]!,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':String((await r.json()).csrfToken)};};
 const project=JSON.parse(await readFile(FIXTURE+'serve-3d-project.json','utf8')),design=JSON.parse(await readFile('robotics/catalog/electrical/serve-hw-c-v1.json','utf8'));
 const post=(h:Record<string,string>,path:string,body:unknown)=>fetch(g.url+'/lab/v2/engineering/'+path,{method:'POST',headers:h,body:JSON.stringify(body)});
 return {g,pair,project,design,post};
}
const compiled=async(t:Awaited<ReturnType<typeof boot>>,h:Record<string,string>)=>{const r=await (await t.post(h,'compile',{project:t.project})).json();return {bundleDigest:r.bundleDigest as string,projectDigest:r.projectDigest as string,receipt:r};};

test('a design compiles against the project of a compiled bundle, the bundle is readable, and the engineering bundle is untouched',async()=>{
 const t=await boot(),h=await t.pair(),ref=await compiled(t,h);
 expect(ref.receipt.problems?.filter((p:{blocking:boolean})=>p.blocking)).toEqual([]);expect(ref.receipt.state).toBe('compiled');
 const manifestBefore=await (await fetch(t.g.url+`/lab/v2/engineering/bundles/${ref.bundleDigest}/manifest`,{headers:{cookie:h.cookie}})).text();
 const res=await t.post(h,'electrical',{ref:{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest},design:t.design});
 expect(res.status).toBe(200);const receipt=await res.json();
 expect(receipt.state).toBe('compiled');expect(receipt.digest).toMatch(/^[0-9a-f]{64}$/);
 const bundle=await (await fetch(t.g.url+`/lab/v2/engineering/electrical/${receipt.digest}`,{headers:{cookie:h.cookie}})).json();
 expect(bundle.digest).toBe(receipt.digest);expect(bundle.hardwareValidated).toBe(false);expect(bundle.inputs.project.digest).toBe(ref.projectDigest);
 expect(await (await fetch(t.g.url+`/lab/v2/engineering/bundles/${ref.bundleDigest}/manifest`,{headers:{cookie:h.cookie}})).text()).toBe(manifestBefore);
 const again=await (await t.post(h,'electrical',{ref:{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest},design:t.design})).json();
 expect(again.digest).toBe(receipt.digest);
});
test('a blocked option still returns a bundle so the reasons can be read',async()=>{
 const t=await boot(),h=await t.pair(),ref=await compiled(t,h),a=JSON.parse(await readFile('robotics/catalog/electrical/serve-hw-a-v1.json','utf8'));
 const receipt=await (await t.post(h,'electrical',{ref:{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest},design:a})).json();
 expect(receipt.state).toBe('blocked');expect(receipt.problems.some((p:{code:string})=>p.code==='IOA_SIGNAL_UNALLOCATED')).toBe(true);
 expect((await (await fetch(t.g.url+`/lab/v2/engineering/electrical/${receipt.digest}`,{headers:{cookie:h.cookie}})).json()).driveModelDraft).toBeNull();
});
test('another session cannot compile against the bundle nor read the result',async()=>{
 const t=await boot(),owner=await t.pair(),other=await t.pair(),ref=await compiled(t,owner),body={ref:{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest},design:t.design};
 expect((await t.post(other,'electrical',body)).status).toBe(403);
 const receipt=await (await t.post(owner,'electrical',body)).json();
 expect((await fetch(t.g.url+`/lab/v2/engineering/electrical/${receipt.digest}`,{headers:{cookie:other.cookie}})).status).toBe(403);
});
test('refusals: a design that fails its schema is 400, a design for another project is 409, unknown fields are 422, CSRF is enforced',async()=>{
 const t=await boot(),h=await t.pair(),ref=await compiled(t,h),r={bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest};
 const bad=await t.post(h,'electrical',{ref:r,design:{...t.design,stray:1}});expect(bad.status).toBe(400);expect((await bad.json()).error).toBe('INVALID_ELECTRICAL_DESIGN');
 const other=await t.post(h,'electrical',{ref:r,design:{...t.design,project:{...t.design.project,id:'another-project'}}});
 expect(other.status).toBe(409);
 expect((await t.post(h,'electrical',{ref:r,design:t.design,endpoint:'http://x'})).status).toBe(422);
 expect((await t.post({...h,'x-csrf-token':'wrong'},'electrical',{ref:r,design:t.design})).status).toBe(403);
});
test('health advertises electrical_bundle_v1 only when the service offers it',async()=>{
 for(const on of [true,false]){
  const t=await boot(on),health=await (await fetch(t.g.url+'/lab/v2/health')).json();
  expect(health.capabilities.includes('electrical_bundle_v1')).toBe(on);
  if(!on){const h=await t.pair();expect((await t.post(h,'electrical',{ref:{},design:{}})).status).toBe(400);}
 }
});

test('compare: two bundles of one session are compared, another session is refused, one bundle or a stray key is a bad request',async()=>{
 const t=await boot(),h=await t.pair(),other=await t.pair(),ref=await compiled(t,h),r={bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest};
 const digest=async(file:string)=>(await (await t.post(h,'electrical',{ref:r,design:JSON.parse(await readFile(`robotics/catalog/electrical/${file}.json`,'utf8'))})).json()).digest as string;
 const b=await digest('serve-hw-b-v1'),c=await digest('serve-hw-c-v1');
 const ok=await t.post(h,'electrical/compare',{digests:[b,c]});expect(ok.status).toBe(200);
 const cmp=await ok.json();expect(cmp.options).toHaveLength(2);expect(cmp.notComparableReason).toBe('PRICE_MISSING_FOR_DECIDING_PARTS');
 expect((await t.post(other,'electrical/compare',{digests:[b,c]})).status).toBe(403);
 expect((await t.post(h,'electrical/compare',{digests:[b]})).status).toBe(400);
 expect((await t.post(h,'electrical/compare',{digests:[b,b]})).status).toBe(400);
 expect((await t.post(h,'electrical/compare',{digests:[b,c],endpoint:'x'})).status).toBe(422);
});

test('package: a compiled bundle yields a verifiable package, a blocked one is 409, another session is 403',async()=>{
 const t=await boot(),h=await t.pair(),other=await t.pair(),ref=await compiled(t,h),r={bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest};
 const compile=async(file:string)=>(await (await t.post(h,'electrical',{ref:r,design:JSON.parse(await readFile(`robotics/catalog/electrical/${file}.json`,'utf8'))})).json()).digest as string;
 const c=await compile('serve-hw-c-v1'),a=await compile('serve-hw-a-v1');
 const ok=await fetch(t.g.url+`/lab/v2/engineering/electrical/${c}/package`,{headers:{cookie:h.cookie}});expect(ok.status).toBe(200);
 const pkg=await ok.json() as {manifest:{status:string;hardwareValidated:boolean;controlAuthority:boolean};files:{path:string;contentBase64:string}[]};
 expect([pkg.manifest.status,pkg.manifest.hardwareValidated,pkg.manifest.controlAuthority]).toEqual(['draft',false,false]);
 const {verifyHardwareCandidate}=await import('../../packages/lab-runtime/src/engineering/electrical/package');
 const m=new Map(pkg.files.map(f=>[f.path,new Uint8Array(Buffer.from(f.contentBase64,'base64'))]));
 expect(await verifyHardwareCandidate(async p=>m.get(p)??null,async()=>[...m.keys()])).toEqual([]);
 const blocked=await fetch(t.g.url+`/lab/v2/engineering/electrical/${a}/package`,{headers:{cookie:h.cookie}});expect(blocked.status).toBe(409);expect((await blocked.json()).error).toBe('ELECTRICAL_BUNDLE_BLOCKED');
 expect((await fetch(t.g.url+`/lab/v2/engineering/electrical/${c}/package`,{headers:{cookie:other.cookie}})).status).toBe(403);
});

test('a launcher without MuJoCo (Webots, IR-SIM: only the simulation root) still has the base drive model: HW-C gets its drive model draft and its package',async()=>{
 const dir=await engineeringDriveFixtureDir({simulationRoot:'robotics/simulation'});expect(dir).toBeDefined();
 expect(await engineeringDriveFixtureDir({})).toBeUndefined();
 const pkgOf=async(d:string|null)=>{
  const t=await boot(true,d),h=await t.pair(),ref=await compiled(t,h);
  const c=(await (await t.post(h,'electrical',{ref:{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest},design:t.design})).json()).digest as string;
  const doc=await (await fetch(t.g.url+`/lab/v2/engineering/electrical/${c}`,{headers:{cookie:h.cookie}})).json();
  const pkg=await fetch(t.g.url+`/lab/v2/engineering/electrical/${c}/package`,{headers:{cookie:h.cookie}});
  return {draft:doc.driveModelDraft,status:pkg.status,body:await pkg.json(),bundle:doc};
 };
 const withBase=await pkgOf(dir!),without=await pkgOf(null);
 expect(withBase.draft).not.toBeNull();expect(withBase.status).toBe(200);
 expect(without.draft).toBeNull();expect(without.status).toBe(409);expect(without.body.error).toBe('DRIVE_MODEL_DRAFT_MISSING');
 expect(withBase.bundle.digest).toBe((await pkgOf('robotics/simulation-mujoco/fixtures/drive-v1')).bundle.digest);   // the same bundle as the MuJoCo launcher's
});
