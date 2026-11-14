// The navigation evidence of an IR-SIM run report, as the Lab shows it: provider from the evidence itself, complete only when nothing says otherwise,
// old reports "unavailable", unknown schemas unsupported, and imported folders verified chunk by chunk (hash fails closed, a missing chunk is incomplete).
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {navigationEvidenceView,importNavigationEvidence,navigationRows,engineVersionOf,NAVIGATION_PROVIDERS} from '../../src/reports/navigation2d';
import type {NavigationRunEvidenceV1} from '../../src/shared/navigation2d';
import type {RunReport} from '../../src/scenarios/controls';
import {chunks,D,evidence,project,report} from '../support/navigation-report';
import {reportCsv,reportHtml} from '../../src/reports/metrics';
import {navigationHtml} from '../../src/ui/report-panel';

const files=(r:RunReport,drop?:string)=>{
 const all=[...chunks.trajectory,...chunks.control,...chunks.sensors].filter(c=>c.path!==drop).map(c=>new File([c.bytes as BlobPart],c.path));
 return [new File([JSON.stringify(r)],'report.json'),new File([JSON.stringify(project)],'project.json'),...all];
};

test('a complete IR-SIM report: provider irsim_2d from the evidence, complete, assertions kept with their own results',()=>{
 const view=navigationEvidenceView(report());
 expect(view.provider).toBe('irsim_2d');expect(view.supported).toBe(true);expect(view.complete).toBe(true);expect(view.reasons).toEqual([]);
 expect(navigationRows(report()).map(r=>[r.id,r.result])).toEqual([['IR-ARRIVAL','pass'],['REPEATABILITY_CROSS_PLATFORM','not_run']]);
});
test('old or foreign reports: absent evidence is unsupported, an unknown schema is unsupported, neither shows a provider',()=>{
 const old=report();delete (old as {navigation2d?:unknown}).navigation2d;
 expect(navigationEvidenceView(old)).toEqual({supported:false,provider:null,complete:false,reasons:['NAVIGATION_EVIDENCE_ABSENT']});
 for(const bad of [{...evidence(),schemaVersion:2},{...evidence(),documentType:'other'},{...evidence(),engine:{...evidence().engine,id:'mock_amr'}},{...evidence(),extra:true}])
  expect(navigationEvidenceView(report({navigation2d:bad}))).toMatchObject({supported:false,provider:null,complete:false,reasons:['NAVIGATION_EVIDENCE_SCHEMA_UNKNOWN']});
});
test('incomplete evidence is never complete: server verdict, missing end record, recording gaps, sensor publications, a hole in the listing',()=>{
 const cases:[unknown,string][]=[
  [{...evidence(),completeness:{status:'incomplete',reasons:['EVIDENCE_PENDING']}},'EVIDENCE_PENDING'],
  [(()=>{const e=evidence() as Record<string,unknown>;delete e.completeness;return e;})(),'COMPLETENESS_UNKNOWN'],
  [(()=>{const e=evidence() as Record<string,unknown>;delete e.recording;return e;})(),'EVIDENCE_END_UNKNOWN'],
  [{...evidence(),recordingGaps:[{fromTick:100,toTick:100,reason:'STEP_ACK_LOST'}]},'RECORDING_GAP:STEP_ACK_LOST'],
  [{...evidence(),artifacts:{...evidence().artifacts,trajectory:[evidence().artifacts.trajectory[1]!]}},'TRAJECTORY_LISTING_GAP'],
 ];
 for(const [n,reason] of cases){const v=navigationEvidenceView(report({navigation2d:n}));expect(v.complete,reason).toBe(false);expect(v.reasons,reason).toContain(reason);}
 const pubs=navigationEvidenceView(report({metrics:{distanceM:{},collision:{available:false,contacts:null,minSeparationM:null},navigation:{sensorPublications:{expected:81,recorded:40,complete:false}}}}));
 expect(pubs.complete).toBe(false);expect(pubs.reasons).toContain('SENSOR_PUBLICATIONS_INCOMPLETE');
});
test('review C01 F4: every signal must agree; each disagreement is named (runTick, contradictory completeness, end record, gaps, listings, sensors)',()=>{
 const e=evidence,rec=(r:Record<string,unknown>)=>({...e(),recording:{...e().recording,...r}});
 const cases:[unknown,string[],Record<string,unknown>?][]=[
  [rec({runTick:500}),['EVIDENCE_PENDING']],
  [rec({runTick:300}),['EVIDENCE_AHEAD_OF_CHECKPOINT:301-400']],
  [{...e(),completeness:{status:'complete',reasons:['EVIDENCE_TICKS_MISSING']}},['COMPLETENESS_CONTRADICTORY','EVIDENCE_TICKS_MISSING']],
  [rec({terminal:'WORKER_LOST'}),['EVIDENCE_TERMINAL:WORKER_LOST']],
  [rec({lastTick:399,runTick:399}),['EVIDENCE_END_MISMATCH']],
  [rec({lastTick:399}),['EVIDENCE_END_MISMATCH','EVIDENCE_PENDING']],
  [rec({lastTick:399,terminal:'WORKER_LOST',runTick:399}),['EVIDENCE_TERMINAL:WORKER_LOST','EVIDENCE_END_MISMATCH']],
  [rec({gaps:[{fromTick:10,toTick:12,reason:'DISK_FULL'}]}),['RECORDING_GAP:DISK_FULL']],
  [{...e(),artifacts:{...e().artifacts,control:[e().artifacts.control[0]!]}},['CONTROL_LISTING_GAP']],
  [{...e(),artifacts:{...e().artifacts,sensors:[]}},['SENSOR_LISTING_EMPTY']],
  [e(),['SENSOR_PUBLICATIONS_UNKNOWN'],{metrics:{distanceM:{},collision:{available:false,contacts:null,minSeparationM:null}}}],
 ];
 for(const [n,reasons,over] of cases){const v=navigationEvidenceView(report({navigation2d:n,...over}));expect(v.complete,reasons.join()).toBe(false);expect(v.reasons,reasons.join()).toEqual(reasons);}
 // a run still null before start, or a run tick equal to the last durable tick, says nothing against completeness
 for(const runTick of [null,400])expect(navigationEvidenceView(report({navigation2d:rec({runTick})})).complete).toBe(true);
});
test('review C01 F3: an incomplete view never shows or exports a pass; fails stay fails; reasons travel with the CSV row',()=>{
 const n={...evidence(),completeness:{status:'incomplete',reasons:['EVIDENCE_CHUNK_MISSING:trajectory-000002-abcdef01.ndjson.gz']},assertions:[{id:'EVIDENCE_COVERAGE',result:'pass',detail:'all ticks'},{id:'IR-ARRIVAL',result:'pass',detail:'arrived'},{id:'IR-NO-COLLISION',result:'fail',detail:'contact at 120'},{id:'REPEATABILITY_CROSS_PLATFORM',result:'not_run',detail:'no platform qualified'}]};
 const r=report({navigation2d:n});
 expect(navigationRows(r).map(a=>[a.id,a.result])).toEqual([['EVIDENCE_COVERAGE','unverified'],['IR-ARRIVAL','unverified'],['IR-NO-COLLISION','fail'],['REPEATABILITY_CROSS_PLATFORM','not_run']]);
 const csv=reportCsv(r);expect(csv).not.toMatch(/navigation_assertion.*,pass,/);
 expect(csv).toContain('navigation_assertion,,,,irsim_2d,IR-ARRIVAL,arrived,unverified,EVIDENCE_CHUNK_MISSING:trajectory-000002-abcdef01.ndjson.gz,');
 expect(csv).toContain('navigation_assertion,,,,irsim_2d,IR-NO-COLLISION,contact at 120,fail,,');
 const html=reportHtml(r);expect(html).not.toContain('<td>pass</td>');expect(html).toContain('<td>unverified</td>');
 const panel=navigationHtml(r);expect(panel).not.toContain('data-result="pass"');expect(panel).toContain('data-result="unverified"');expect(panel).toContain('not established');
 expect(navigationRows(report()).map(a=>a.result)).toEqual(['pass','not_run']);// a complete view keeps its passes
});
test('import: a folder with every chunk verifies; a missing scan chunk imports as incomplete; a changed chunk or unknown schema is refused',async()=>{
 const ok=await importNavigationEvidence(files(report()));
 expect(ok.origin).toBe('imported');expect(navigationEvidenceView(ok.report).complete).toBe(true);
 const view=navigationEvidenceView((await importNavigationEvidence(files(report(),chunks.sensors[1]!.path))).report);
 expect(view.complete).toBe(false); // imported report with a missing scan chunk
 expect(view.reasons).toContain(`EVIDENCE_CHUNK_MISSING:${chunks.sensors[1]!.path}`);
 const tampered=files(report());tampered[3]=new File([new Uint8Array(chunks.trajectory[1]!.bytes.length)],chunks.trajectory[1]!.path);
 await expect(importNavigationEvidence(tampered)).rejects.toThrow('ARTIFACT_HASH_MISMATCH');
 await expect(importNavigationEvidence(files(report({navigation2d:{...evidence(),schemaVersion:9}})))).rejects.toThrow('NAVIGATION_EVIDENCE_SCHEMA_UNKNOWN');
 const traversal=report();(traversal.navigation2d!.artifacts.sensors[0] as {path:string}).path='../x.ndjson.gz';
 await expect(importNavigationEvidence(files(traversal))).rejects.toThrow(/NAVIGATION_EVIDENCE_SCHEMA_UNKNOWN|ARTIFACT_PATH_INVALID/);
});
test('exports keep each assertion with its own result and say what the evidence is not',()=>{
 const r=report({telemetry:{lossy:true,coalesced:true,rateHz:5,source:'irsim',samples:[],sampleCounts:{},dropped:0,gaps:[]}});
 expect(reportCsv(r)).toContain('navigation_assertion,,,,irsim_2d,REPEATABILITY_CROSS_PLATFORM,no platform qualified,not_run');
 const html=reportHtml(r);expect(html).toContain('Navigation evidence (IR-SIM 2D)');expect(html).toContain('irsim_2d · complete');expect(html).toContain('not Gazebo, native or hardware evidence');
 const old=report();delete (old as {navigation2d?:unknown}).navigation2d;expect(reportHtml({...old,telemetry:r.telemetry} as RunReport)).not.toContain('Navigation evidence');
});
test('review5 #4: the report envelope and its navigation evidence must name the same run; each disagreement is named and no pass survives',()=>{
 type M=RunReport['manifest'];
 const ident={compilerVersion:'1',sceneSchemaHash:D('5'),evidenceFormat:'navigation-evidence-ndjson-gzip-v1',os:'darwin 25',arch:'arm64',node:'v24.22.2'};
 const man=(f:(m:M)=>void)=>{const r=report();f(r.manifest);return r;};
 const cases:[string,RunReport][]=[
  ['runId',man(m=>{m.runId='22222222-2222-4222-8222-222222222222';})],
  ['provider',man(m=>{m.backends=[{id:'mock_amr',version:'1',model:'mock',dynamics:false}];})],
  ['provider',man(m=>{m.backends=[{...m.backends[0]!,version:'9.9.9'}];})],
  ['seed',man(m=>{m.seed=6;})],
  ['tickMs',man(m=>{m.clock={tickMs:50};})],
  ['sceneDigest',man(m=>{m.models=m.models!.map(x=>x.id==='irsim_2d'?{...x,hash:D('9')}:x);})],
  ['sceneDigest',man(m=>{m.models=m.models!.filter(x=>x.id!=='irsim_2d');})],
  ['modelDigests',man(m=>{m.models=m.models!.map(x=>x.id.startsWith('navigation-model:')?{...x,hash:D('9')}:x);})],
  ['modelDigests',man(m=>{m.models=[...m.models!,{id:'navigation-model:amr-2',revision:'1',hash:D('8'),provenance:'projected'}];})],
  ['policy',man(m=>{m.profiles=[{...m.profiles![0]!,hash:D('9')}];})],
  ['policy',man(m=>{m.profiles=[];})],
  ['sourceCommit',report({navigation2d:{...evidence(),identity:{...ident,sourceCommit:'t'.repeat(40)}}})],
  ['businessEpochMs',man(m=>{(m.clock as Record<string,unknown>).businessEpochMs=1;})],
  ['outcomeTick',report({outcome:{status:'completed',served:'1',tick:500,simTimeNs:'10000000000'}})],
  ['outcomeTick',report({outcome:{status:'completed',served:'1',tick:399,simTimeNs:'7980000000'}})],
  ['simTimeNs',report({outcome:{status:'completed',served:'1',tick:400,simTimeNs:'8000000001'}})],
 ];
 // every case is checked (not stopped at the first): the list names each field whose disagreement went unnoticed
 const missed=cases.map(([field,r],i)=>{const v=navigationEvidenceView(r);return !v.complete&&v.reasons.includes(`IDENTITY_MISMATCH:${field}`)&&!navigationRows(r).some(a=>a.result==='pass')?null:`${i}:${field}`;}).filter(Boolean);
 expect(missed).toEqual([]);
 // the agreeing envelope (sourceCommit included) stays complete
 expect(navigationEvidenceView(report({navigation2d:{...evidence(),identity:{...ident,sourceCommit:'s'.repeat(40)}}}))).toMatchObject({complete:true,reasons:[]});
});
test('review6 C: the source world hash leaves the revision out, so the import compares the world revision on its own',async()=>{
 const r=report();r.manifest.world={...r.manifest.world,revision:r.manifest.world.revision+1};// same hash, another revision
 await expect(importNavigationEvidence(files(r))).rejects.toThrow('WORLD_HASH_MISMATCH');
});

// A Webots 3D report: the provider and its R2025a version come from the evidence's own engine block (engineVersion, not version), and the panel names Webots, not IR-SIM.
const webotsReport=()=>{
 const base=report(),e=evidence() as unknown as Record<string,unknown> & {engine:Record<string,unknown>;seed:Record<string,unknown>};
 const doc={...e,engine:{id:'webots_3d',engineVersion:'R2025a',executableSha256:D('e'),basicTimeStepMs:20,pythonVersion:'3.11.15',platform:'darwin-arm64',lockDigest:D('f')},seed:{...e.seed,engineSeedAlgorithm:'webots-worldinfo-seed-v1'}};
 delete (doc.seed as Record<string,unknown>).engineRng;
 const m=base.manifest as unknown as {backends:unknown[];models:{id:string;revision:string}[]};
 m.backends=[{id:'webots_3d',version:'R2025a',model:'webots_diff_drive',dynamics:true}];
 m.models=m.models.map(x=>x.id==='irsim_2d'?{...x,id:'webots_3d',revision:'R2025a'}:x);
 return {...base,navigation2d:doc} as unknown as RunReport;
};
test('a Webots report: provider webots_3d from the evidence, supported, and the panel says Webots with its version, not IR-SIM',()=>{
 const r=webotsReport(),view=navigationEvidenceView(r);
 expect(view.supported,view.reasons.join()).toBe(true);expect(view.provider).toBe('webots_3d');
 const html=navigationHtml(r);
 expect(html).toContain('Webots R2025a');expect(html).not.toContain('IR-SIM');
 expect(html).toMatch(/not_calibrated|assumed/i);
});
test('a Webots report whose manifest names another engine version is a provider mismatch, never shown as the evidence says',()=>{
 const r=webotsReport();(r.manifest as unknown as {backends:{version:string}[]}).backends[0]!.version='R2025b';
 expect(navigationEvidenceView(r).reasons).toContain('IDENTITY_MISMATCH:provider');
});

const mujocoEngine:NavigationRunEvidenceV1['engine']={id:'mujoco_3d',engineVersion:'3.17.0',timestepMs:2,substeps:10,pythonVersion:'3.11.15',platform:'darwin-arm64',lockDigest:D('f'),
 stopPolicyRef:{id:'serve-mobile-stop-v1',revision:1,path:'mobile-stop-policy.json',sha256:D('a')},controllerPolicyRef:{id:'serve-mobile-controller-v1',revision:1,path:'mobile-controller-policy.json',sha256:D('b')},loadProfileRef:{id:'cup-center',revision:1,path:'cup-center.json',sha256:D('c')},physicsProfileRef:{id:'serve-drive-contact-v1',revision:1,path:'drive-contact-profile.json',sha256:D('d')}};
test('engine version follows each explicit source schema branch, including synced MuJoCo',()=>{
 expect(engineVersionOf(report().navigation2d!.engine)).toBe('2.12.0');
 expect(engineVersionOf(webotsReport().navigation2d!.engine)).toBe('R2025a');
 expect(engineVersionOf(mujocoEngine)).toBe('3.17.0');
});
test('synced MuJoCo engine typing does not admit or mislabel a report before mobile UI support',()=>{
 const n=report().navigation2d!;n.engine=mujocoEngine;n.seed.engineSeedAlgorithm='mujoco-identity-seed-v1';delete n.seed.engineRng;
 const r=report({navigation2d:n});
 expect(NAVIGATION_PROVIDERS).toEqual(['irsim_2d','webots_3d']);
 expect(navigationEvidenceView(r)).toEqual({supported:false,provider:null,complete:false,reasons:['NAVIGATION_EVIDENCE_SCHEMA_UNKNOWN']});
 expect(navigationRows(r)).toEqual([]);expect(navigationHtml(r)).not.toMatch(/IR-SIM|Webots/);
});
