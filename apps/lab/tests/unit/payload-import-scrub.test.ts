// Synthetic public folder for the browser trust/update boundaries, never native engine evidence.
import {readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {report as baseReport,project,D} from '../support/navigation-report';
import {hashJson,sha256Hex} from '../../src/twin/hash';
import {importNavigationEvidence} from '../../src/reports/navigation2d';
import {navigationHtml,reportPanel} from '../../src/ui/report-panel';
import {openReplayV2} from '../../src/reports/replay';
import {payloadPreset} from '../../src/twin/payload';
import type {RunReport,PhysicsReportBlock} from '../../src/scenarios/controls';
const json=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
function fixture(){
 const bytes=(path:string)=>new Uint8Array(readFileSync(new URL(`../../fixtures/engineering/serve-payload-v1/${path}`,import.meta.url))),scene=JSON.parse(new TextDecoder().decode(bytes('navigation-scene.json')));
 const stop={id:'serve-mobile-stop-v1',revision:1,path:'mobile-stop-policy.json',sha256:D('4')},controller={id:'serve-mobile-controller-v1',revision:1,path:'mobile-controller-policy.json',sha256:D('5')};
 Object.assign(scene.engine,{stopPolicyRef:stop,controllerPolicyRef:controller});const {sceneDigest:_s,...without}=scene;void _s;scene.sceneDigest=hashJson(without);
 const r=baseReport(),n=r.navigation2d!;n.engine={id:'mujoco_3d',engineVersion:'3.17.0',timestepMs:2,substeps:10,pythonVersion:'3.11.15',platform:'darwin-arm64',lockDigest:D('6'),loadProfileRef:scene.engine.loadProfileRef,physicsProfileRef:scene.engine.physicsProfileRef,stopPolicyRef:stop,controllerPolicyRef:controller};
 n.sceneDigest=scene.sceneDigest;n.sceneRef={path:'bundle/navigation-scene.json',sha256:sha256Hex(json(scene)),bytes:json(scene).length};n.modelDigests=scene.robots.map((x:{model:{modelDigest:string}})=>x.model.modelDigest);n.policyRef={id:scene.policy.id,revision:scene.policy.revision,hash:scene.policy.hash};n.seed.engineSeedAlgorithm='mujoco-identity-seed-v1';delete n.seed.engineRng;
 r.manifest.backends=[{id:'mujoco_3d',version:'3.17.0',model:'mujoco',dynamics:true}];r.manifest.calibration={status:'not_calibrated',revision:null,hash:null};r.manifest.models=[{id:'mujoco_3d',revision:'3.17.0',hash:scene.sceneDigest,provenance:'simulated_plant'},...n.modelDigests.map(hash=>({id:'navigation-model:amr-1',revision:'1',hash,provenance:'projected'}))];r.manifest.profiles=[{...n.policyRef,provenance:'assumed'}];
 r.outcome.tick=520;r.outcome.simTimeNs='10400000000';n.clock.tickHorizon=520;r.metrics.navigation={sensorPublications:{expected:105,recorded:105,complete:true}};
 const load=JSON.parse(new TextDecoder().decode(bytes('cup-center.json'))),q={payloadKind:'free',propId:'cup-1',supportId:'amr-1/tray-1',sceneDigest:scene.sceneDigest,loadProfileSha256:scene.engine.loadProfileRef.sha256,geometry:load.props[0].geometry,positionM:[2,1.5,.55],quaternionXyzw:[0,0,0,1]};
 r.telemetry={lossy:true,coalesced:true,rateHz:10,source:'fixture',samples:[{schemaVersion:2,runId:r.manifest.runId,entityId:'payload:cup-1',providerId:'mujoco_3d',bootId:'boot',seq:'1',simTimeNs:'0',observedAt:null,receivedMonotonicNs:'0',frameId:'map',origin:'physics_sim',quality:'valid',reasonCodes:[],commanded:null,observed:q,estimated:null,causationId:null}],sampleCounts:{'payload:cup-1':1},dropped:0,gaps:[]};
 const metrics=Object.fromEntries(['loadDisplacementM','maxTiltRad','tiltExceededDurationS','wheelPositionResidualM','wheelYawResidualRad','contactPeakN','contactImpulseNs','stopDistanceM'].map(k=>[k,{available:false,value:null,unit:'m',reason:'PHYSICS_COVERAGE_INCOMPLETE'}])) as PhysicsReportBlock['metrics'];
 r.physicsEvidence={manifest:{schemaVersion:1,documentType:'physics-evidence',identity:{runId:r.manifest.runId,bootId:'boot',sceneDigest:scene.sceneDigest,loadProfileDigest:scene.engine.loadProfileRef.sha256,physicsProfileDigest:scene.engine.physicsProfileRef.sha256},streams:[],coverage:{firstTick:0,lastTick:520,complete:false},gaps:[],terminalReason:null,metricsPolicyDigest:stop.sha256,assumptions:[{kind:'assumed',documentId:'fixture',revision:'1',locator:'test',contentSha256:D('a')}]},manifestSha256:D('0'),complete:false,issues:['PHYSICS_COVERAGE_INCOMPLETE'],metrics} as PhysicsReportBlock;
 r.physicsEvidence.manifestSha256=sha256Hex(json(r.physicsEvidence.manifest));
 const data=new Map<string,Uint8Array>([['bundle/navigation-scene.json',json(scene)],['bundle/cup-center.json',bytes('cup-center.json')],['bundle/physical-model-amr-1.json',bytes('physical-model-amr-1.json')],['project.json',json(project)]]);
 return {r,files:(report=r)=>[...data,['report.json',json(report)] as [string,Uint8Array]].map(([path,b])=>{const f=new File([b as BlobPart],path);Object.defineProperty(f,'webkitRelativePath',{value:`fixture/${path}`});return f;})};
}
test('valid admitted mobile folder imports and downgrades metrics',async()=>{const f=fixture(),x=await importNavigationEvidence(f.files());expect(x.payloadBundle?.loadSha256).toBe(f.r.navigation2d!.engine.id==='mujoco_3d'?f.r.navigation2d!.engine.loadProfileRef.sha256:null);expect(x.report.physicsEvidence?.metrics.contactPeakN.available).toBe(false);});
for(const field of ['load','physics','stop','controller','load-ref-id','load-ref-revision','load-ref-path','policy','model','manifest-engine','manifest-policy','report-engine'] as const)test(`mobile import binds ${field} to the admitted scene even when report/physics agree`,async()=>{
 const f=fixture(),r=structuredClone(f.r),n=r.navigation2d!,p=r.physicsEvidence!;if(n.engine.id!=='mujoco_3d')throw new Error('fixture');
 if(field==='load'){n.engine.loadProfileRef.sha256=D('f');p.manifest.identity.loadProfileDigest=D('f');}
 if(field==='physics'){n.engine.physicsProfileRef.sha256=D('f');p.manifest.identity.physicsProfileDigest=D('f');}
 if(field==='stop'){n.engine.stopPolicyRef.sha256=D('f');p.manifest.metricsPolicyDigest=D('f');}
 if(field==='controller')n.engine.controllerPolicyRef.sha256=D('f');
 if(field==='load-ref-id')n.engine.loadProfileRef.id='other-load';if(field==='load-ref-revision')n.engine.loadProfileRef.revision=2;if(field==='load-ref-path')n.engine.loadProfileRef.path='other-load.json';
 if(field==='policy'){n.policyRef.hash=D('f');r.manifest.profiles![0]!.hash=D('f');}if(field==='model'){n.modelDigests=[D('f')];r.manifest.models![1]!.hash=D('f');}
 if(field==='manifest-engine')r.manifest.backends[0]!.version='other-engine';if(field==='manifest-policy')r.manifest.profiles![0]!.hash=D('f');
 if(field==='report-engine'){n.engine={id:'webots_3d',engineVersion:'R2025a',executableSha256:D('e'),basicTimeStepMs:20,pythonVersion:'3.11.15',platform:'darwin-arm64',lockDigest:D('6')};n.seed.engineSeedAlgorithm='webots-worldinfo-seed-v1';}
 p.manifestSha256=sha256Hex(json(p.manifest));const error=await importNavigationEvidence(f.files(r)).then(()=>null,(e:Error)=>e.message);expect(error).toBe('PAYLOAD_REPORT_IDENTITY_MISMATCH');
});
test('actual scrub update hides terminal navigation aggregates and restores them without replacing focused range',async()=>{
 vi.stubGlobal('innerWidth',1440);const {TwinWorkspace}=await import('../../src/ui/workspace'),{r}=fixture(),replay={rp:openReplayV2(r),tick:520,playing:false};
 const region={id:'twin-navigation-evidence',innerHTML:navigationHtml(r)},range={id:'twin-replay-cursor',value:'520'};vi.stubGlobal('document',{querySelector:()=>null,getElementById:(id:string)=>id===region.id?region:id===range.id?range:null,activeElement:range});
 const w=new TwinWorkspace(()=>{},{paired:true} as never);Object.assign(w,{report:r,replay,runPreset:payloadPreset(),tick:()=>{}});
 expect(region.innerHTML).toContain('105/105');
 range.value='0';w.input('twin-replay-cursor','0');expect(region.innerHTML).not.toContain('105/105');expect(region.innerHTML).not.toContain('navigation-assertions');expect(region.innerHTML).toContain('final cursor');expect(document.activeElement).toBe(range);
 range.value='520';w.input('twin-replay-cursor','520');expect(region.innerHTML).toContain('105/105');expect(region.innerHTML).toContain('navigation-assertions');expect(document.activeElement).toBe(range);expect(reportPanel(r,{replay,full:r,previous:null,selected:null,business:0})).toContain('id="twin-navigation-evidence"');w.leave();
});
