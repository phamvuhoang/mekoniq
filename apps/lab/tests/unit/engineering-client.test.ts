import {afterEach,describe,expect,test,vi} from 'vitest';
// i18n reads the locale while it is imported, so the stub has to exist before any import runs
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {engineeringRefFor,httpTwinRuntime,requestForPreset,requestFromLocked,TwinRuntimeError,type LockedInput} from '../../src/scenarios/controls';
import {presetById,type TwinPreset} from '../../src/scenarios/catalog';
import {hashJson} from '../../src/twin/hash';
import {makeEngineeringProject,makeEngineeringReceipt} from '../support/engineering';

afterEach(()=>{vi.unstubAllGlobals();vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});});
const engineeringPreset=():TwinPreset=>{
  const project=makeEngineeringProject(),receipt=makeEngineeringReceipt(project);
  return {...presetById('delivery')!,backendSetId:'engineering-rigid-v1',mode:'simulation',engineering:{project,receipt}};
};
const code=(f:()=>unknown)=>{try {f();} catch (e) {return (e as TwinRuntimeError).code;}return 'NO_THROW';};

describe('requests',()=>{
  test('an engineering preset sends the ref of its compiled receipt and no project',()=>{
    const preset=engineeringPreset(),receipt=preset.engineering!.receipt as {bundleDigest:string;projectDigest:string};
    const request=requestForPreset(preset);
    expect(request.engineeringRef).toEqual({bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest});
    expect('project' in request).toBe(false);
  });
  test('legacy presets keep their exact old shape',()=>{
    const request=requestForPreset(presetById('delivery')!);
    expect(Object.keys(request).sort()).toEqual(['access','backendSetId','mode','project','scenarioId','scenarioRevision','seed']);
    expect(request.engineeringRef).toBeUndefined();
  });
  test('a missing, blocked or stale receipt blocks before any request is built',()=>{
    const project=makeEngineeringProject();
    expect(code(()=>engineeringRefFor(project,null))).toBe('ENGINEERING_NOT_COMPILED');
    const blocked={projectDigest:hashJson(project),profile:project.requestedProfile,problems:[{code:'PARAMETER_MISSING',path:'/x',blocking:true,detail:''}],state:'blocked' as const,bundleDigest:null,assemblyDigest:null,sceneDigest:null,runnable:false as const};
    expect(code(()=>engineeringRefFor(project,blocked))).toBe('ENGINEERING_COMPILE_BLOCKED');
    const receipt=makeEngineeringReceipt(project),edited=structuredClone(project);edited.assembly.instances[0]!.pose.xyzM[0]+=0.1;
    expect(code(()=>engineeringRefFor(edited,receipt))).toBe('ENGINEERING_RECEIPT_STALE');
    const preset=engineeringPreset();preset.engineering!.project.revision+=1;
    expect(code(()=>requestForPreset(preset))).toBe('ENGINEERING_RECEIPT_STALE');
  });
  test('reset is built from the locked input, never from the current preset',()=>{
    const preset=engineeringPreset(),locked:LockedInput={...requestForPreset(preset),sourceCommit:'abc',engineering:{ref:{bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)},project:preset.engineering!.project,runtimeProjection:{project:preset.project,assets:[]}}} as LockedInput;
    const reset=requestFromLocked(locked);
    expect(reset.engineeringRef).toEqual({bundleDigest:'a'.repeat(64),projectDigest:'b'.repeat(64)});
    expect(reset.seed).toBe(preset.seed);
    expect((reset as unknown as Record<string,unknown>).sourceCommit).toBeUndefined();
    const legacy=requestFromLocked({...requestForPreset(presetById('delivery')!),sourceCommit:'abc'});
    expect(legacy.project).toBeDefined();expect(legacy.engineeringRef).toBeUndefined();
  });
});

describe('http client',()=>{
  const calls:{url:string;method:string;body:unknown}[]=[];
  const fetcher=(responses:Record<string,unknown>)=>vi.fn(async(url:string,init?:RequestInit)=>{
    calls.push({url,method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):undefined});
    const path=url.replace('/lab/v2','').split('?')[0]!;
    return new Response(JSON.stringify(responses[path]??{error:'NOT_FOUND'}),{status:responses[path]?200:404});
  });
  test('compile, engineering readiness and create travel on the existing session and CSRF',async()=>{
    calls.length=0;
    const project=makeEngineeringProject(),receipt=makeEngineeringReceipt(project);
    vi.stubGlobal('fetch',fetcher({'/sessions':{csrfToken:'csrf-1'},'/engineering/compile':receipt,'/readiness':{checkedAt:'',expiresAt:'',scenarioId:'FD01',backendSetId:'engineering-rigid-v1',checks:[],canStart:false},'/runs':{run:{id:'r1'}}}));
    const runtime=httpTwinRuntime();
    await runtime.pair('token');
    expect(await runtime.compileEngineering!(project)).toEqual(receipt);
    const ref={bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest};
    await runtime.readiness!('FD01','engineering-rigid-v1',undefined,ref);
    await runtime.create(requestForPreset(engineeringPreset()),{sourceCommit:'c',schemaHash:'h'});
    expect(calls.map(c=>[c.method,c.url])).toEqual([['POST','/lab/v2/sessions'],['POST','/lab/v2/engineering/compile'],['POST','/lab/v2/readiness'],['POST','/lab/v2/runs']]);
    expect(calls[1]!.body).toEqual({project});
    expect(calls[2]!.body).toEqual({scenarioId:'FD01',backendSetId:'engineering-rigid-v1',engineeringRef:ref});
    expect((calls[3]!.body as {engineeringRef:unknown}).engineeringRef).toEqual(ref);
    expect('project' in (calls[3]!.body as object)).toBe(false);
  });
  test('legacy readiness and create requests are unchanged',async()=>{
    calls.length=0;
    vi.stubGlobal('fetch',fetcher({'/sessions':{csrfToken:'c'},'/readiness':{canStart:true},'/runs':{run:{id:'r'}}}));
    const runtime=httpTwinRuntime(),p=presetById('delivery')!;
    await runtime.pair('t');
    await runtime.readiness!(p.scenarioId,p.backendSetId);
    await runtime.readiness!(p.scenarioId,p.backendSetId,p.project);
    expect(calls[1]!.url).toBe(`/lab/v2/readiness?scenarioId=${p.scenarioId}&backendSetId=${p.backendSetId}`);
    expect(calls[2]!.body).toEqual({scenarioId:p.scenarioId,backendSetId:p.backendSetId,project:p.project});
  });
});

describe('bundle reads',()=>{
  test('the scene comes from the bundle\'s own scene.json and is verified against its name',async()=>{
    const {loadCompiledScene,loadBom}=await import('../../src/scenarios/engineering');
    const {sha256Hex}=await import('../../src/twin/hash');
    const scene=new TextEncoder().encode(JSON.stringify({schemaVersion:1,links:[]})),bom=new TextEncoder().encode(JSON.stringify({lines:[],missingPriceLineIds:[],total:null,incompleteTotal:false}));
    const manifest={schemaVersion:1,projectDigest:'a'.repeat(64),assemblyDigest:'b'.repeat(64),sceneDigest:sha256Hex(scene),profile:'engineering-rigid-v1',compilerVersion:'t',files:[{path:'scene.json',sha256:sha256Hex(scene),sizeBytes:scene.length},{path:'bom.json',sha256:sha256Hex(bom),sizeBytes:bom.length}]};
    const blobs=new Map([[sha256Hex(scene),scene],[sha256Hex(bom),bom]]);
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      if(url.includes('/manifest'))return new Response(JSON.stringify(manifest));
      const bytes=blobs.get(decodeURIComponent(url.split('/').pop()!));return bytes?new Response(bytes):new Response('{"error":"X"}',{status:403});
    }));
    const runtime=httpTwinRuntime();
    expect((await loadCompiledScene(runtime,'d'.repeat(64))).schemaVersion).toBe(1);
    expect((await loadBom(runtime,'d'.repeat(64))).lines).toEqual([]);
    blobs.set(sha256Hex(scene),new TextEncoder().encode('tampered'));
    await expect(loadCompiledScene(runtime,'d'.repeat(64))).rejects.toMatchObject({code:'ENGINEERING_BLOB_CORRUPT'});
    await expect(loadCompiledScene({} as never,'d'.repeat(64))).rejects.toMatchObject({code:'ENGINEERING_CAPABILITY_REQUIRED'});
  });
});
