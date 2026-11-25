// Model validation (LinkForge shadow) in the Lab: the client uses the existing session/CSRF path and refuses an unknown document; the panel never shows
// not_run/inconclusive as pass, marks a result stale as soon as the design changes, and traces every graph id back to the assembly item it came from.
import {IDBFactory} from 'fake-indexeddb';
import {afterEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});});
import {httpTwinRuntime,TwinRuntimeError,type TwinRuntime} from '../../src/scenarios/controls';
import {validationView,issueTarget} from '../../src/ui/model-validation-panel';
import {AssemblyWorkspace} from '../../src/ui/assembly-page';
import {serveProject} from '../../src/design/assembly';
import type {ModelValidationReportV1} from '../../src/shared/navigation2d';
import type {BundleReceipt,EngineeringProject} from '../../src/shared/engineering';
import {hashJson} from '../../src/twin/hash';

afterEach(()=>{vi.unstubAllGlobals();vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});});
const D=(c:string)=>c.repeat(64);
export function validationReport(over:Partial<ModelValidationReportV1>={}):ModelValidationReportV1{
 return {schemaVersion:1,documentType:'model-validation-report',reportDigest:D('1'),physicalModelDigest:D('2'),assemblyDigest:D('3'),robotId:'amr-1',execution:'ran',result:'pass',mode:'shadow',
  engine:{package:'linkforge-core',packageVersion:'1.6.0',pythonVersion:'3.11.9',lockDigest:D('4'),adapterVersion:'1',policyVersion:'1'},
  checks:[{id:'INERTIA',source:'mekoniq',result:'pass',coverageScope:'all links'},{id:'SRDF',source:'linkforge',result:'not_run',coverageScope:'SEMANTIC_PROFILE_NOT_SUPPLIED'}],
  issues:[{code:'LF_EXPORT_MISMATCH',severity:'warning',path:'/links/chassis%2Fbase/inertial',entityId:'amr-1',linkId:'chassis/base',source:'parity',detail:'6 decimals'},{code:'SENSOR_FRAME',severity:'info',path:'/sensors/0',entityId:'amr-1',jointId:'lidar/mount',source:'mekoniq',detail:'ok'},{code:'X',severity:'error',path:'/',entityId:'amr-1',source:'mekoniq',detail:'entity level'}],
  nameMapRef:null,inputUrdfRef:{path:'robots/amr-1.urdf',sha256:D('5'),bytes:10},referenceUrdfRef:null,referenceSrdfRef:null,assumptions:[{kind:'assumed',documentId:'serve',revision:'1',locator:'x',contentSha256:D('6')} as never],limitations:['not a load test'],...over};
}
const ok=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
const ref={bundleDigest:D('a'),projectDigest:D('b')};

test('client: validate posts {engineeringRef, robotId} with the session CSRF token; read gets one digest; both refuse unknown documents',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];let next:unknown={csrfToken:'csrf-1'};
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,init});return ok(next);}));
 const rt=httpTwinRuntime();await rt.pair('token');
 next={report:validationReport(),cached:false};
 expect((await rt.validateEngineeringModel!(ref,'amr-1')).reportDigest).toBe(D('1'));
 expect(calls[1]!.url).toBe('/lab/v2/engineering/validate');expect(JSON.parse(String(calls[1]!.init.body))).toEqual({engineeringRef:ref,robotId:'amr-1'});
 expect((calls[1]!.init.headers as Record<string,string>)['X-CSRF-Token']).toBe('csrf-1');
 next=validationReport();expect((await rt.readModelValidation!(D('1'))).robotId).toBe('amr-1');
 expect(calls[2]!.url).toBe(`/lab/v2/engineering/validations/${D('1')}`);expect(calls[2]!.init.method).toBe('GET');
 for(const bad of [{report:{...validationReport(),schemaVersion:2}},{report:{...validationReport(),result:'great'}},{report:{...validationReport(),extra:1}},{nope:true}]){
  next=bad;const e=await rt.validateEngineeringModel!(ref,'amr-1').then(()=>null,x=>x as TwinRuntimeError);expect(e?.code).toBe('MODEL_VALIDATION_SCHEMA_UNKNOWN');
 }
 next=validationReport({reportDigest:D('9')});
 expect((await rt.readModelValidation!(D('1')).then(()=>null,x=>x as TwinRuntimeError))?.code).toBe('MODEL_VALIDATION_DIGEST_MISMATCH');
 await expect(rt.readModelValidation!('../etc')).rejects.toThrow('INVALID_REPORT_DIGEST');
});
test('view: pass only for ran+pass; not_run and inconclusive are never pass; stale when the design or receipt changed',()=>{
 const project=serveProject(),digest=hashJson(project),at={ref:{...ref,projectDigest:digest},robotId:'amr-1'};
 expect(validationView({...at,report:validationReport()},{projectDigest:digest,ref:at.ref},project)).toMatchObject({state:'current',tone:'ok',label:'pass'});
 expect(validationView({...at,report:validationReport({execution:'not_run',result:'inconclusive'})},{projectDigest:digest,ref:at.ref},project)).toMatchObject({state:'current',tone:'blocked',label:'not_run'});
 expect(validationView({...at,report:validationReport({result:'inconclusive'})},{projectDigest:digest,ref:at.ref},project).tone).toBe('blocked');
 expect(validationView({...at,report:validationReport({result:'fail'})},{projectDigest:digest,ref:at.ref},project).tone).toBe('fail');
 const edited=structuredClone(project);edited.runtimeProject.world.width+=1;
 expect(validationView({...at,report:validationReport()},{projectDigest:hashJson(edited),ref:at.ref},edited)).toMatchObject({state:'stale'});
 expect(validationView({...at,report:validationReport()},{projectDigest:digest,ref:{...at.ref,bundleDigest:D('c')}},project)).toMatchObject({state:'stale'});
 expect(validationView(null,{projectDigest:digest,ref:null},project)).toMatchObject({state:'none'});
});
test('full graph ids trace back to the assembly item that owns them; anything else falls back to the entity, never to a guess',()=>{
 const project=serveProject(),issues=validationReport().issues;
 expect(issueTarget(issues[0]!,project)).toEqual({kind:'instance',id:'chassis',graphId:'chassis/base'});
 expect(issueTarget(issues[1]!,project)).toEqual({kind:'instance',id:'lidar',graphId:'lidar/mount'});
 expect(issueTarget(issues[2]!,project)).toEqual({kind:'entity',id:'amr-1',graphId:null});
 expect(issueTarget({...issues[0]!,linkId:'ghost/base'},project)).toEqual({kind:'entity',id:'amr-1',graphId:'ghost/base'});
});
test('assembly page: Serve -> compile -> validate is current; editing the world width marks it stale; validation never blocks saving',async()=>{
 vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('document',{getElementById:()=>null});
 let compiled:EngineeringProject|null=null;
 const rt={paired:true,health:async()=>({capabilities:['engineering_bundle_v1']}),
  compileEngineering:async(p:EngineeringProject):Promise<BundleReceipt>=>{compiled=p;return {projectDigest:hashJson(p),profile:p.requestedProfile,problems:[],state:'compiled',bundleDigest:D('a'),assemblyDigest:D('b'),sceneDigest:D('c'),runnable:false};},
  engineeringManifest:async()=>({schemaVersion:1,projectDigest:'',assemblyDigest:'',sceneDigest:D('c'),profile:'',compilerVersion:'',files:[{path:'bom.json',sha256:D('d'),sizeBytes:1},{path:'scene.json',sha256:D('c'),sizeBytes:1}]}),
  engineeringBlob:async(sha:string)=>new TextEncoder().encode(sha===D('d')?'{"lines":[],"incompleteTotal":false}':'{"links":[],"frames":[]}'),
  validateEngineeringModel:vi.fn(async(r:{projectDigest:string})=>{expect(r.projectDigest).toBe(hashJson(compiled));return validationReport();})} as unknown as TwinRuntime;
 const page=new AssemblyWorkspace(()=>{},rt);page.mounted();
 page.click('asm-serve');expect(page.html()).toContain('engineering-irsim-2d-v1');
 page.click('asm-compile');await vi.waitFor(()=>expect(page.html()).toContain('data-testid="asm-receipt" data-state="compiled"'));
 page.click('asm-validate','amr-1');await vi.waitFor(()=>expect(page.html()).toMatch(/data-testid="model-validation" data-state="current"/));
 expect(page.html()).toContain('data-target="chassis"');expect(page.html()).toContain('chassis/base');
 page.change('asm-world-width','21');
 const html=page.html();expect(html).toMatch(/data-testid="model-validation" data-state="stale"/);expect(html).not.toMatch(/data-state="current"/);
 await vi.waitFor(()=>expect(page.html()).toContain('data-state="saved"'));
});
