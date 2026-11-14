import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {payloadPreset,selectPayloadExperiment,payloadGeometry,payloadState} from '../../src/twin/payload';
import {physicsAt} from '../../src/reports/physics';
import {sceneEntities} from '../../src/twin/scene';
import {posesOf} from '../../src/viewer/twin3d';
import {placeBody} from '../../src/twin/pose3d';
import {validReportShape} from '../../src/reports/report-shape';
import {openReplayV2} from '../../src/reports/replay';
import {report} from '../support/navigation-report';
import type {Held} from '../../src/twin/store';
import type {RunView} from '../../src/scenarios/controls';
import physical from '../../fixtures/engineering/serve-payload-v1/physical-model-amr-1.json';
const D='a'.repeat(64);
const sample=(tick=10):Held=>({schemaVersion:2,runId:'11111111-1111-4111-8111-111111111111',entityId:'payload:cup-1',providerId:'mujoco_3d',bootId:'boot',seq:String(tick),simTimeNs:String(tick*20000000),observedAt:null,receivedMonotonicNs:'0',frameId:'map',origin:'physics_sim',quality:'valid',reasonCodes:[],commanded:null,estimated:null,causationId:null,receivedAtMs:tick*20,epochResetAtMs:null,observed:{payloadKind:'free',propId:'cup-1',supportId:'amr-1/tray-1',loadProfileSha256:D,sceneDigest:D,geometry:{kind:'cylinder',radiusM:.04,heightM:.1},positionM:[2,3,.7],quaternionXyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]}});
test('center preset at 1× and closed selection creates a fresh project/receipt identity',()=>{
 const p=payloadPreset();expect(p.id).toBe('mujoco-payload');expect(p.speed).toBe(1);expect(p.engineering!.project.mujocoExperimentId).toBe('payload-center-v1');
 const next=selectPayloadExperiment(p,'payload-empty-v1');expect(next.engineering!.receipt).toBeNull();expect(next.engineering!.project).not.toEqual(p.engineering!.project);expect(p.engineering!.project.mujocoExperimentId).toBe('payload-center-v1');expect(()=>selectPayloadExperiment(p,'arbitrary')).toThrow();
});
test('canonical links compose in base coordinates and map conversion occurs once, rotated tray included',()=>{
 const geometry=payloadGeometry(physical as never),tray=geometry.find(g=>g.linkId==='tray-1/plate')!;expect(tray).toBeTruthy();
 expect(tray.positionM[0]).toBeCloseTo(-.1-.3*Math.sin(.12),12);expect(tray.positionM[2]).toBeCloseTo(.12+.3*Math.cos(.12),12);const placed=placeBody([2,3,.09],[0,0,Math.SQRT1_2,Math.SQRT1_2],0);expect(placed.position).toEqual([2,.09,-3]);
});
test('a free cup uses its own measured map pose and admitted dimensions without coffee custody',()=>{
 const s=sample(),p=payloadPreset(),view={entities:[],coffee:null} as unknown as RunView;
 const f={preset:p,view,report:null,samples:{[s.entityId]:s},payloadBundle:{scene:{sceneDigest:D},physical:physical,loadSha256:D,load:{props:[{propId:'cup-1',geometry:{kind:'cylinder',radiusM:.04,heightM:.1},attachment:{kind:'free',supportId:'amr-1/tray-1'}}]}} as never,nowMs:200};const e=sceneEntities(f).find(e=>e.id===s.entityId)!;
 expect(e.kind).toBe('payload');expect(e.plant?.positionM).toEqual([2,3,.7]);expect(e.payload?.geometry).toEqual({kind:'cylinder',radiusM:.04,heightM:.1});expect(posesOf(f).cups![s.entityId]?.positionM).toEqual([2,3,.7]);
 expect(sceneEntities({...f,samples:{}}).some(e=>e.kind==='payload')).toBe(false);
});
test('payload schema/provenance refuses malformed geometry, quaternion and foreign provider',()=>{
 expect(payloadState(sample())).toBeTruthy();for(const patch of [{geometry:{kind:'cylinder',radiusM:-1,heightM:.1}},{quaternionXyzw:[0,0,0,0]},{sceneDigest:'bad'}]){const s=sample();Object.assign(s.observed!,patch);expect(payloadState(s)).toBeNull();expect(validReportShape({...report(),telemetry:{lossy:true,coalesced:true,rateHz:10,source:'test',samples:[s],sampleCounts:{},dropped:0,gaps:[]}})).toBe(false);}
 expect(payloadState({...sample(),providerId:'foreign'})).toBeNull();
});
test('old reports have unavailable physics; final values do not leak into earlier cursor or gaps',()=>{
 expect(physicsAt(report(),20)).toBeNull();
 const metrics=Object.fromEntries(['loadDisplacementM','maxTiltRad','tiltExceededDurationS','wheelPositionResidualM','wheelYawResidualRad','contactPeakN','contactImpulseNs','stopDistanceM'].map(k=>[k,{available:true,value:9,unit:'m',samples:10}]));
 const r={...report(),physicsEvidence:{manifest:{coverage:{firstTick:0,lastTick:400,complete:true}},metrics,complete:true,issues:[]}} as never;
 expect(physicsAt(r,20)!.metrics.loadDisplacementM).toMatchObject({available:false,value:null,reason:'NOT_RECORDED_AT_CURSOR'});expect(physicsAt(r,400)!.metrics.loadDisplacementM).toMatchObject({available:true,value:9});
 const projected=openReplayV2(r).project({entities:[],run:{status:'completed'},workload:[]} as never,20);expect(projected.report.physicsEvidence!.metrics.contactPeakN.available).toBe(false);
});
test('backward replay hides unborn payloads and recorded gaps hide poses',()=>{
 const r=report({telemetry:{lossy:true,coalesced:true,rateHz:10,source:'test',samples:[sample(10)],sampleCounts:{'payload:cup-1':1},dropped:0,gaps:[{reason:'missing',fromTick:11,toTick:20}]}}),rp=openReplayV2(r),base={entities:[],run:{status:'completed'},workload:[]} as never;
 expect(Object.keys(rp.project(base,0).samples)).toHaveLength(0);expect(Object.keys(rp.project(base,10).samples)).toContain('payload:cup-1');expect(Object.keys(rp.project(base,15).samples)).toHaveLength(0);
});

test('an out-of-order compile cannot admit or replace a newer experiment draft',async()=>{
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});
 const {TwinWorkspace}=await import('../../src/ui/workspace'),{hashJson}=await import('../../src/twin/hash');
 const p=payloadPreset(),next=selectPayloadExperiment(p,'payload-empty-v1');let finishOld!:(v:unknown)=>void;
 const ready=vi.fn(async(..._args:unknown[])=>({scenarioId:'MJ-FD01',backendSetId:p.backendSetId,canStart:true,checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),checks:[]}));
 const receipt=(project:unknown,bundle:string)=>({state:'compiled',projectDigest:hashJson(project),bundleDigest:bundle,problems:[]});
 const rt={paired:true,readiness:ready,compileEngineering:vi.fn((project:unknown)=>project===p.engineering!.project?new Promise(r=>{finishOld=r;}):Promise.resolve(receipt(project,'b'.repeat(64))))};
 const w=new TwinWorkspace(()=>{},rt as never),h=w as unknown as {preset:typeof p;health:unknown;checkReadiness(value:typeof p):Promise<void>};
 h.health={features:{readiness:true},capabilities:['sim3d_payload_experiments_v1']};h.preset=p;const old=h.checkReadiness(p);h.preset=next;await h.checkReadiness(next);finishOld(receipt(p.engineering!.project,'a'.repeat(64)));await old;
 expect(h.preset.engineering!.project.mujocoExperimentId).toBe('payload-empty-v1');expect(h.preset.engineering!.receipt?.bundleDigest).toBe('b'.repeat(64));expect(ready).toHaveBeenCalledTimes(1);expect(ready.mock.calls[0]?.[3]).toEqual({bundleDigest:'b'.repeat(64),projectDigest:hashJson(next.engineering!.project)});w.leave();
});

test('paused payload cancellation journals cancel before advancing the same clock to the first observed stop',async()=>{
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});const {TwinWorkspace}=await import('../../src/ui/workspace');
 const w=new TwinWorkspace(()=>{},{paired:true} as never),h=w as unknown as {view:{run:{status:string}};runPreset:unknown;act:(kind:string,p?:unknown)=>Promise<void>;cancelPayload():Promise<void>};
 h.runPreset=payloadPreset();h.view={run:{status:'paused'}};const actions:string[]=[];h.act=async kind=>{actions.push(kind);h.view.run.status=kind==='step'?'cancelled':'running';};await h.cancelPayload();expect(actions).toEqual(['cancel','resume','step']);w.leave();
});

test('payload stop observation cannot act on a replacement run or a view-only writer',async()=>{
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});const {TwinWorkspace}=await import('../../src/ui/workspace');
 for(const readOnly of [false,true]){const w=new TwinWorkspace(()=>{},{paired:true} as never),h=w as unknown as {gen:number;view:{run:{id:string;status:string};controlAccess?:string};runPreset:unknown;act:(kind:string)=>Promise<void>;cancelPayload():Promise<void>};h.runPreset=payloadPreset();h.view={run:{id:'old',status:'paused'},...readOnly?{controlAccess:'view_reconcile'}:{}};const actions:string[]=[];
 h.act=async kind=>{actions.push(kind);h.gen++;h.view={run:{id:'replacement',status:'running'}};};await h.cancelPayload();expect(actions).toEqual(readOnly?[]:['cancel']);w.leave();}
});
test('payload stop observation exits on attention or unknown and never declares cancellation locally',async()=>{
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});const {TwinWorkspace}=await import('../../src/ui/workspace');
 const w=new TwinWorkspace(()=>{},{paired:true} as never),h=w as unknown as {view:{run:{id:string;status:string}};runPreset:unknown;act:(kind:string)=>Promise<void>;cancelPayload():Promise<void>};h.runPreset=payloadPreset();h.view={run:{id:'old',status:'paused'}};const actions:string[]=[];
 h.act=async kind=>{actions.push(kind);h.view.run.status=kind==='resume'?'needs_attention':'running';};await h.cancelPayload();expect(actions).toEqual(['cancel','resume']);expect(h.view.run.status).toBe('needs_attention');
 h.view={run:{id:'old',status:'running'}};h.act=async kind=>{if(kind==='step')throw new Error('WORKER_UNKNOWN');};await expect(h.cancelPayload()).rejects.toThrow('WORKER_UNKNOWN');expect(h.view.run.status).toBe('running');w.leave();
});

test('an explicit second pause interrupts payload stop observation without another resume',async()=>{
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});const {TwinWorkspace}=await import('../../src/ui/workspace');
 const w=new TwinWorkspace(()=>{},{paired:true} as never),h=w as unknown as {view:{run:{id:string;status:string}};runPreset:unknown;payloadStopPause:boolean;payloadCancelPaused:boolean;act:(kind:string)=>Promise<void>;cancelPayload():Promise<void>};h.runPreset=payloadPreset();h.view={run:{id:'old',status:'paused'}};const actions:string[]=[];
 h.act=async kind=>{actions.push(kind);h.view.run.status='running';if(kind==='step')w.click('twin-pause');};await h.cancelPayload();expect(actions).toEqual(['cancel','resume','step','pause']);expect(h.payloadCancelPaused).toBe(true);expect(h.view.run.status).toBe('running');w.leave();
});
test('mobile readiness and experiment controls name MuJoCo explicitly',async()=>{
 const {nextAction}=await import('../../src/ui/operations-panel');expect(nextAction({preset:payloadPreset(),paired:true,ready:true,busy:false,playing:false,view:null}).title).toContain('MuJoCo');
});

test('bundle admission validates document digests and refuses a substituted load shape even after rehashing',async()=>{
 const {readPayloadBundle}=await import('../../src/twin/payload'),{hashJson,sha256Hex}=await import('../../src/twin/hash'),{readFile}=await import('node:fs/promises');
 const scene=JSON.parse(await readFile(new URL('../../fixtures/engineering/serve-payload-v1/navigation-scene.json',import.meta.url),'utf8'));
 const read=async(path:string)=>new Uint8Array(await readFile(new URL(`../../fixtures/engineering/serve-payload-v1/${path}`,import.meta.url)));
 expect((await readPayloadBundle(read,scene)).physical.modelDigest).toBe(physical.modelDigest);
 const load=JSON.parse(new TextDecoder().decode(await read('cup-center.json')));load.props[0].geometry.radiusM=.2;const {digest:_d,...without}=load;void _d;load.digest=hashJson(without);const bytes=new TextEncoder().encode(JSON.stringify(load));
 scene.engine.loadProfileRef.sha256=sha256Hex(bytes);scene.files=scene.files.map((f:{path:string})=>f.path==='cup-center.json'?{...f,sha256:sha256Hex(bytes),bytes:bytes.length}:f);const {sceneDigest:_s,...sceneWithout}=scene;void _s;scene.sceneDigest=hashJson(sceneWithout);
 await expect(readPayloadBundle(async(path)=>path==='cup-center.json'?bytes:read(path),scene)).rejects.toThrow('PAYLOAD_LOAD_UNADMITTED');
});

test('imported mobile reports cannot advertise calibrated hardware dynamics',()=>{
 const r=report();r.manifest.backends=[{id:'mujoco_3d',version:'3.17.0',model:'mujoco',dynamics:true}];r.manifest.calibration={status:'calibrated',revision:null,hash:null};expect(validReportShape(r)).toBe(false);
});
test('a rotated tray and a relative-load fixture cross map/Three coordinates once',async()=>{
 const {composePose}=await import('../../src/twin/frames');const rotated=structuredClone(physical);for(const j of rotated.joints){j.origin.xyzM=[0,0,0];j.origin.quaternionXyzw=[0,0,0,1];if(j.child==='tray-1/plate'){j.origin.xyzM=[1,0,.4];j.origin.quaternionXyzw=[0,0,Math.SQRT1_2,Math.SQRT1_2];}}
 const tray=payloadGeometry(rotated as never).find(s=>s.linkId==='tray-1/plate')!,local=composePose({position:tray.positionM,quaternionXyzw:tray.quaternionXyzw},{position:[0,.1,.06],quaternionXyzw:[0,0,0,1]}),map=composePose({position:[2,3,.1],quaternionXyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]},local),placed=placeBody(map.position,map.quaternionXyzw,0);
 expect(map.position[0]).toBeCloseTo(2);expect(map.position[1]).toBeCloseTo(3.9);expect(map.position[2]).toBeCloseTo(.56);expect(placed.position[0]).toBeCloseTo(2);expect(placed.position[1]).toBeCloseTo(.56);expect(placed.position[2]).toBeCloseTo(-3.9);
});

test('payload create starts the admitted run at tick0 without an automatic five-second step',async()=>{
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('document',{querySelector:()=>null,getElementById:()=>null,activeElement:null});const {TwinWorkspace}=await import('../../src/ui/workspace'),{hashJson}=await import('../../src/twin/hash');
 const p=payloadPreset();p.engineering!.receipt={state:'compiled',projectDigest:hashJson(p.engineering!.project),bundleDigest:'a'.repeat(64)} as never;
 const r=report(),v={run:{id:r.manifest.runId,status:'ready',runRevision:0,telemetryCursor:null},tick:0,simTimeNs:'0',entities:[],coffee:null} as never;
 const w=new TwinWorkspace(()=>{},{paired:true,create:async()=>v,report:async()=>r} as never),h=w as unknown as {health:unknown;preset:typeof p;openStreams:()=>void;clock:()=>unknown;act:(kind:string)=>Promise<void>;create(preset:typeof p):Promise<void>};const actions:string[]=[];
 Object.assign(h,{health:{sourceCommit:r.manifest.sourceCommit,schemaHash:'hash'},preset:p,openStreams:()=>{},clock:()=>({step:true}),act:async(kind:string)=>{actions.push(kind);}});await h.create(p);expect(actions).toEqual(['start']);w.leave();
});

test('payload replay can select an exact terminal tick between the old five-tick slider steps',async()=>{
 const {transportBar}=await import('../../src/ui/transport');const html=transportBar({mode:'replay',playing:false,canPlay:false,canStep:false,canPause:false,paused:false,canCancel:false,speeds:[],speed:1,simTimeS:1.68,tick:84,replay:{fromTick:0,toTick:84,tick:84,playing:false,marks:[],step:1}} as never);expect(html).toMatch(/id="twin-replay-cursor"[^>]*step="1"/);
});
