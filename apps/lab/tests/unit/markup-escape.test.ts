// C1: every value that came from a runtime (view, report, health, readiness, receipt, BOM), an imported evidence folder or project, or a saved report,
// is escaped where it enters markup, whatever its TypeScript type says (the browser does not validate it). Real fixtures; every leaf value is replaced
// by a marker that contains markup; a leaf whose marker makes a renderer throw is not printed by it (bisected down to that one leaf and skipped).
import 'fake-indexeddb/auto';
import {expect,test,vi} from 'vitest';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
vi.stubGlobal('innerWidth',600);
vi.stubGlobal('document',{getElementById:()=>null,querySelector:()=>null,activeElement:null});
import type {Bom,BundleReceipt} from '../../src/shared/engineering';
import type {ReadinessSnapshot,RunReport,RunView,TwinHealth,TwinRuntime} from '../../src/scenarios/controls';
import type {LabProjectV2} from '../../src/shared/types';
import {coffeeReplay} from '../support/coffee-replay';
import {controllerReportFixture} from '../support/controller-report';
import {makeEngineeringProject,makeEngineeringReceipt} from '../support/engineering';
const {TwinWorkspace}=await import('../../src/ui/workspace');
const {AssemblyWorkspace}=await import('../../src/ui/assembly-page');
const {presetById}=await import('../../src/scenarios/catalog');
const {openReplayV2}=await import('../../src/reports/replay');
const {captureEvidence}=await import('../../src/reports/evidence');
const {reportPanel,replayBody,armPlantHtml,controllerVerificationHtml}=await import('../../src/ui/report-panel');
const {renderTwin,sceneEntities}=await import('../../src/twin/scene');
const {inspect}=await import('../../src/twin/inspector');
const {engineeringInspection,engineeringPanel}=await import('../../src/ui/engineering-panel');
const {attentionChain,cycleQueue,nextAction}=await import('../../src/ui/operations-panel');
const {collectProblems,problemsPanel,nextStrip}=await import('../../src/ui/problems');
const {LAYERS}=await import('../../src/twin/overlays');
const M=`"'><img src=x onerror=1>`,LIVE=/<img/;// a value cut short (a short commit, a digest prefix) still opens the element
interface Data {view:RunView;report:RunReport;health:TwinHealth;readiness:ReadinessSnapshot;project:LabProjectV2;receipt:BundleReceipt;bom:Bom}
function data():Data{
 const {view,report}=coffeeReplay(),preset=presetById('coffee')!;
 // the attention a held run shows, the report blocks of a MuJoCo arm plant and a controller verification: every renderer gets something to print
 view.attention=[{reason:'CUP_REMOVED',tick:50,subjectId:'coffee-job-1',robotId:'amr-1'}];view.run.status='needs_attention';
 view.coffee!.jobs[0]!.attentionReason='CUP_REMOVED';view.entities[0]!.path=[[2,1],[3,1]];view.entities[0]!.goal={commandId:'c-1',state:'executing'};
 view.workload=[{actor:'amr-1',tableId:'table-1',status:'placed'} as never];
 report.attention=[{reason:'CUP_REMOVED',tick:50,subjectId:'coffee-job-1'}];report.limitations=['limited'];report.faults=[{tick:5,faultId:'cup-removed',entityId:'cup-1'}];
 report.verification=controllerReportFixture(60).verification;
 report.arm={trace:{path:'arm-trace.json',sha256:'a'.repeat(64),samples:2700},tracking:{samples:2700,peakRad:[0.02,0,0,0,0,0],rmsRad:[0.004,0,0,0,0,0]},
  armPlant:{engine:'mujoco_3d',engineVersion:'3.3.7',control:'position_actuator',grip:'contact',dynamics:'nominal',calibration:'not_calibrated'},
  collision:{result:'pass',reasonCodes:['R'],coverage:{allowedContactsApplied:92}},waypoints:{digest:'d'.repeat(64),table:[{waypoint:'pick',q:[0.1,0,0,0,0,0],positionErrorM:0.0001,orientationErrorRad:0.0003,condition:12.5}]},
  allowedContacts:[{a:'gripper',b:'nozzle-stand'}],releaseTimeoutTicks:150,notes:['n']} as never;
 report.coffee!.armTrace.stop={latched:true,reconcileRequired:true,reason:'PLANT_UNSTABLE',detail:'d',events:[]} as never;
 report.coverage={armSceneCollision:true};
 const health:TwinHealth={protocolMajors:[2],sourceCommit:'d'.repeat(40),schemaHash:'a'.repeat(64),scenarioIds:['BV01'],features:{readiness:true},
  backends:['mock_amr','mock_coffee','mock_arm'].map(id=>({id,modes:['mock'],installed:true,compatible:true,reachable:true,commissioned:true,enabled:false,reason:'off'})),backendSets:[{id:'mock-default',mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']}]};
 const readiness:ReadinessSnapshot={checkedAt:'2026-11-13T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',scenarioId:'BV01',backendSetId:'mock-default',checks:[{id:'runner',status:'blocked',reasonCodes:['RUNNER_DOWN'],evidenceRef:null}],canStart:false};
 const eng=makeEngineeringProject(),receipt={...makeEngineeringReceipt(eng),problems:[{code:'P',path:'/x',detail:'d',blocking:true}]} as BundleReceipt;
 const bom:Bom={lines:[{lineId:'l1',componentId:'c1',componentRevision:'1',componentDigest:'e'.repeat(64),sku:null,candidate:true,qty:2,massKg:1.5,voltageRangeV:null,price:{amount:10,currency:'USD',quotedOn:'2026-01-01'},sources:[],instanceIds:[],requiredAccessories:[]}],missingPriceLineIds:[],total:null,incompleteTotal:true};
 return {view,report,health,readiness,project:structuredClone(preset.project),receipt,bom};
}
type Path=(string|number)[];
const leaves=(o:unknown,p:Path=[]):Path[]=>o!==null&&typeof o==='object'?Object.entries(o).flatMap(([k,v])=>leaves(v,[...p,Array.isArray(o)?Number(k):k])):typeof o==='string'||typeof o==='number'||typeof o==='boolean'?[p]:[];
function hostile(d:Data,paths:Path[]):Data{const c=structuredClone(d);for(const p of paths){let o=c as unknown as Record<string|number,unknown>;for(const k of p.slice(0,-1))o=o[k] as Record<string|number,unknown>;o[p.at(-1)!]=M;}return c;}
/** Every panel that takes a view, a report or a runtime answer, as the page renders it. */
function surfaces(d:Data):Record<string,string>{
 const preset={...presetById('coffee')!,project:d.project},out:Record<string,string>={};
 const rt={paired:true,health:async()=>d.health,pair:async()=>{},forget(){},get:async()=>d.view,report:async()=>d.report,create:async()=>d.view,action:async()=>d.view} as unknown as TwinRuntime;
 const w=new TwinWorkspace(()=>{},rt),h=w as unknown as Record<string,unknown>;
 Object.assign(h,{view:d.view,report:d.report,health:d.health,healthChecked:true,readiness:d.readiness,runPreset:preset,preset,previous:d.report,pinExpected:'f'.repeat(40),
  saved:[{...captureEvidence(d.report,d.project),origin:'imported'}],ui:{...h.ui as object,inspectorOpen:true,problemsOpen:true,caveatOpen:true,runtimeOpen:true,pickerOpen:true,displayOpen:true}});
 const vs=h.vs as {layers:Record<string,boolean>;selected:string|null};vs.layers=Object.fromEntries(LAYERS.map(l=>[l,true]));
 const f={preset,view:d.view,report:d.report},ids=sceneEntities(f).map(e=>e.id);
 for(const tab of ['objects','engineering','report','setup'])for(const sel of [null,...ids]){vs.selected=sel;h.ui={...h.ui as object,tab};out[`workspace ${tab} ${sel}`]=w.html();}
 h.replay={rp:openReplayV2(d.report),tick:50,playing:false};for(const sel of [null,...ids]){vs.selected=sel;out[`workspace replay ${sel}`]=w.html();}
 const layers={...vs.layers} as never;
 out.scene=renderTwin(f,{view:'2d',layers,selected:null});
 for(const id of ids)out[`inspector ${id}`]=engineeringInspection(inspect(f,id))+engineeringPanel(inspect(f,id),{hasRun:true,busy:false,fault:'cup-removed',coffee:true});
 const ops={paired:true,ready:true,busy:false,playing:false,view:d.view,preset};
 out.operations=Object.values(attentionChain(ops)).join('')+cycleQueue(ops);
 const p=collectProblems({paired:true,health:d.health,healthChecked:true,checks:[],view:d.view,linkState:'live',preset});
 out.problems=problemsPanel(p,true,attentionChain(ops))+nextStrip(p,nextAction(ops));
 out.report=reportPanel(d.report,{replay:null,previous:d.report,selected:'amr-1',business:1,full:d.report})+armPlantHtml(d.report)+controllerVerificationHtml(d.report,50)+replayBody({rp:openReplayV2(d.report),tick:50,playing:false},'amr-1');
 const a=new AssemblyWorkspace(()=>{},rt);Object.assign(a,{receipt:d.receipt,bom:d.bom,canCompile:true});out.assembly=a.html();
 return out;
}
/** Leaves (in chunks) whose marker reaches markup unescaped, per surface; a chunk that throws is split, a single leaf that throws is not printed. */
function unescaped(d:Data):{surface:string;path:string;near:string}[]{
 const hits:{surface:string;path:string;near:string}[]=[],seen=new Set<string>();
 const run=(paths:Path[]):void=>{
  let s:Record<string,string>;try{s=surfaces(hostile(d,paths));}catch{if(paths.length>1){const m=paths.length>>1;run(paths.slice(0,m));run(paths.slice(m));}return;}
  for(const [surface,html] of Object.entries(s)){const i=html.search(LIVE);if(i<0)continue;
   // which leaf: bisect this chunk on this surface only
   if(paths.length>1){const m=paths.length>>1;run(paths.slice(0,m));run(paths.slice(m));return;}
   const k=`${surface.split(' ')[0]} ${paths[0]!.join('.')}`;if(!seen.has(k)){seen.add(k);hits.push({surface,path:paths[0]!.join('.'),near:html.slice(Math.max(0,i-80),i)});}}
 };
 const all=leaves(d);for(let i=0;i<all.length;i+=40)run(all.slice(i,i+40));
 return hits;
}
test('the fixtures render on every surface as they are (the baseline the markers replace)',()=>{
 const s=surfaces(data());expect(Object.keys(s).length).toBeGreaterThan(10);for(const html of Object.values(s))expect(html).not.toMatch(LIVE);
 expect(s.report).toContain('data-testid="arm-plant"');expect(s.assembly).toContain('data-testid="asm-receipt"');expect(s.problems).toContain('attention-reason');
});
test('no runtime, report, evidence or project value reaches markup unescaped on any surface',()=>{
 const hits=unescaped(data());
 if(hits.length)console.log(hits.map(h=>`${h.surface} <- ${h.path}\n   …${h.near}`).join('\n'));
 expect(hits).toEqual([]);
},120_000);
