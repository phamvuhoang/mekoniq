import {expect,test,vi} from 'vitest';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
const {openReplayV2}=await import('../../src/reports/replay');
const {compareRuns,reportKpis}=await import('../../src/reports/compare');
const {reportCsv,reportJson,reportHtml,redact,summarizeReportV2}=await import('../../src/reports/metrics');
import type {RunReport} from '../../src/scenarios/controls';
import type {TwinSample} from '../../src/twin/store';
// Synthetic v2 report in the source runtime's shape: business events (durable, journal sequence) and lossy telemetry kept apart.
const EPOCH=Date.parse('2026-11-01T00:00:00Z');
const at=(tick:number)=>new Date(EPOCH+tick*20).toISOString();
const ev=(sequence:number,tick:number,type:string,kind:string,id:string,state:Record<string,unknown>={})=>({sequence:String(sequence),at:at(tick),type,kind,id,state});
const pose=(tick:number,x:number,boot='boot-a',quality:'valid'|'stale'='valid'):TwinSample=>({schemaVersion:2,runId:'11111111-1111-4111-8111-111111111111',entityId:'amr-1',providerId:'mock_amr',bootId:boot,seq:String(tick),simTimeNs:String(BigInt(tick)*20000000n),observedAt:at(tick),receivedMonotonicNs:'1',frameId:'map',origin:'mock',quality,reasonCodes:quality==='valid'?[]:['POSE_REBUILT_FROM_SOURCE'],
 commanded:{goalCommandId:'cmd-1',goalState:'executing'},observed:{xM:x,yM:1,yawRad:0},estimated:null,causationId:tick<=100?'cmd-1':null});
function report(o:{seed?:number;mode?:string;scenario?:string;contacts?:number|null}={}):RunReport{
 const samples=[pose(0,1),pose(5,1.1),pose(10,1.2),pose(15,1.3),pose(100,3),pose(105,3.1,'boot-b')];
 return {schemaVersion:2,manifest:{runId:'11111111-1111-4111-8111-111111111111',sourceCommit:'d'.repeat(40),mode:o.mode??'mock',access:o.mode==='hardware'?'shadow':'simulated',backendSetId:'mock-amr',backends:[{id:o.mode==='hardware'?'valetudo_shadow':'mock_amr',version:'1',model:'mock_kinematic',dynamics:false}],prng:{algorithm:'xoshiro128**',seeding:'s',version:1},clock:{tickMs:20},seed:o.seed??42,
  scenario:{id:o.scenario??'FD01',revision:1,hash:'s'.repeat(64)},project:{id:'restaurant',revision:1,hash:'p'.repeat(64)},world:{id:'w',revision:1,hash:'w'.repeat(64)},assets:[]},
  outcome:{status:'completed',served:'1',tick:300,simTimeNs:'6000000000'},attention:[],workload:[],entities:[],
  businessEvents:[ev(1,0,'SessionOpened','session','s1'),ev(2,2,'RobotCommandIssued','robot-command','cmd-1',{missionId:'m1',robotId:'amr-1'}),ev(3,3,'RobotCommandObserved','robot-command','cmd-1',{state:'accepted'}),ev(3,3,'MissionExecuting','mission','m1',{commandId:'cmd-1'}),ev(4,90,'MissionArrived','mission','m1',{commandId:'cmd-1'}),ev(5,140,'CargoLoaded','mission','m1',{}),ev(6,200,'MissionCompleted','mission','m1',{}),ev(7,200,'<script>alert(1)</script>','x','<img src=x onerror=alert(1)>',{note:'Khách "A" <b>'})],
  effects:[{id:'e1',type:'robot.execute',status:'confirmed',attempts:1,payload:{commandId:'cmd-1'}}],
  metrics:{maxConcurrentMovers:1,distanceM:{'amr-1':4.2},collision:o.contacts===null?{available:false,reason:'GEOMETRY_UNKNOWN',contacts:null,minSeparationM:null}:{available:true,contacts:o.contacts??0,minSeparationM:null}},
  rejectedObservations:[],reconciliations:[],recoveredOps:[],confirmations:[],faults:[],coverage:{businessSimulation:true,kinematicModel:true,dynamics:false,nativeExecution:o.mode==='hardware',physicalStop:false,sensorEvidence:o.mode==='hardware',eventStream:true},
  limitations:['mock_kinematic: constant-speed motion'],
  telemetry:{lossy:true,coalesced:true,rateHz:10,source:'mock plant',samples,sampleCounts:{'amr-1':samples.length},dropped:0,gaps:[{reason:'RUNTIME_RESTART',fromTick:null,toTick:100}]}} as unknown as RunReport;
}

test('replay is read-only: seek returns recorded events and the pose at the cursor; the report is never mutated',()=>{
 const r=report(),before=JSON.stringify(r),rp=openReplayV2(r);
 expect(rp.range).toEqual({fromTick:0,toTick:300,tickMs:20});
 const f=rp.seek(12);
 expect(f.events.map(e=>e.type)).toEqual(['SessionOpened','RobotCommandIssued','RobotCommandObserved','MissionExecuting']);
 expect(f.entities['amr-1']).toMatchObject({seq:'10'});
 expect(rp.seek(-5).tick).toBe(0);expect(rp.seek(10000).tick).toBe(300);expect(()=>rp.seek(Number.NaN)).toThrow('INVALID_REPLAY_CURSOR');
 expect(JSON.stringify(r)).toBe(before);
 for(const k of ['action','step','send','dispatch','execute'])expect(k in rp).toBe(false);
});

test('pose interpolation only inside the declared max gap and never across an epoch change; gaps are marked',()=>{
 const rp=openReplayV2(report(),{maxGapTicks:10});
 expect(rp.pose('amr-1',7)).toMatchObject({x:expect.closeTo(1.14,9),interpolated:true});
 expect(rp.pose('amr-1',50)).toMatchObject({x:1.3,interpolated:false,gap:true}); // 15 -> 100 exceeds the gap: hold last value, marked
 expect(rp.pose('amr-1',102)).toMatchObject({x:3,interpolated:false,epochChange:true}); // boot-a -> boot-b: no blend
 expect(rp.pose('amr-1',-1)).toBeNull();
 expect(rp.seek(50).gaps).toEqual([{reason:'RUNTIME_RESTART',fromTick:null,toTick:100}]);
});

test('trace links command -> observation -> business transition for a command, mission or robot id',()=>{
 const rp=openReplayV2(report());
 const t=rp.trace('cmd-1');
 expect(t.map(x=>x.layer)).toEqual(expect.arrayContaining(['command','observation','business','telemetry','effect']));
 expect(t.find(x=>x.layer==='command')).toMatchObject({type:'RobotCommandIssued',tick:2});
 expect(t.find(x=>x.layer==='observation')).toMatchObject({type:'RobotCommandObserved',tick:3});
 expect(t.find(x=>x.layer==='effect')).toMatchObject({type:'robot.execute',detail:'confirmed · attempts 1'});
 expect(t.find(x=>x.layer==='telemetry')).toMatchObject({tick:0,entityId:'amr-1'});
 expect(t.map(x=>x.tick)).toEqual([...t.map(x=>x.tick)].sort((a,b)=>a-b));
 expect(rp.trace('amr-1').some(x=>x.type==='RobotCommandIssued')).toBe(true);
});

test('compareRuns: comparable for same scenario/mode/backends; never ranks mock against hardware',()=>{
 const mockReport=report(),hardwareReport=report({mode:'hardware'});
 expect(compareRuns(mockReport,hardwareReport).comparable).toBe(false);
 expect(compareRuns(mockReport,hardwareReport).reasons).toEqual(expect.arrayContaining(['MODE_DIFFERS','BACKENDS_DIFFER','FIDELITY_DIFFERS']));
 expect(compareRuns(mockReport,hardwareReport).kpis.every(k=>k.delta===null)).toBe(true);
 const c=compareRuns(report({seed:42}),report({seed:43}));
 expect(c).toMatchObject({comparable:true,reasons:[]});expect(c.inputs).toContainEqual({field:'seed',a:42,b:43});
 expect(c.kpis.find(k=>k.id==='missionTimeS')).toMatchObject({unit:'s',a:3.96,b:3.96,delta:0,percentiles:null,population:{runs:1}});
 expect(c.kpis.find(k=>k.id==='humanWaitS')).toMatchObject({a:1,unit:'s'});
 expect(compareRuns(report(),report({scenario:'BV01'})).reasons).toContain('SCENARIO_DIFFERS');
 expect(reportKpis(report({contacts:null})).find(k=>k.id==='contacts')).toMatchObject({available:false,value:null,reason:'GEOMETRY_UNKNOWN'});
});

test('v2 summary keeps business evidence and lossy telemetry apart with sample counts',()=>{
 const s=summarizeReportV2(report());
 expect(s).toMatchObject({evidence:'mock',businessEvents:8,telemetry:{lossy:true,samples:6,sampleCounts:{'amr-1':6},dropped:0,gaps:1},served:'1',seed:42});
});

test('exports: JSON and CSV keep ids; HTML is self-contained and escapes every runtime string; secrets and paths are removed',()=>{
 const r=report() as unknown as Record<string,unknown>;
 (r.manifest as Record<string,unknown>).csrfToken='secret-csrf';(r as Record<string,unknown>).directory='/Users/someone/runs/abc';(r as Record<string,unknown>).privateKey={d:'k'};
 const clean=redact(r) as Record<string,unknown>;
 expect(JSON.stringify(clean)).not.toMatch(/secret-csrf|\/Users\/someone|privateKey/);
 const json=reportJson(r as unknown as RunReport);expect(json).not.toMatch(/secret-csrf|\/Users\/someone|privateKey/);expect(JSON.parse(json).businessEvents).toHaveLength(8);
 const csv=reportCsv(r as unknown as RunReport);
 expect(csv.split('\n')[0]).toBe('stream,sequence_or_seq,time,tick,entity_or_kind,id,type,quality,detail,raw_sim_time_ns');
 expect(csv).toContain('business,2,2026-11-01T00:00:00.040Z,2,robot-command,cmd-1,RobotCommandIssued');
 expect(csv).toContain('telemetry,5,');expect(csv).toMatch(/"Khách ""A"" <b>"|note/); // quoted CSV
 const html=reportHtml(r as unknown as RunReport,{compareWith:report({seed:43})});
 expect(html.startsWith('<!doctype html>')).toBe(true);
 expect(html).not.toMatch(/<script|<img|<link|<iframe|href="http|secret-csrf|\/Users\/someone/);
 expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;'); // inert text, not markup
 expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
 for(const s of ['Source manifest','d'.repeat(40),'Seeds','42','43','Sample counts','amr-1','Missing evidence','dynamics','RUNTIME_RESTART','Business events (durable)','Telemetry (lossy, coalesced)'])expect(html).toContain(s);
});

test('CSV neutralises spreadsheet formulas but keeps numbers and ids; redact also removes paths inside longer strings',()=>{
 const r=report() as unknown as {businessEvents:{type:string;id:string}[]};
 r.businessEvents[0]!.type='=HYPERLINK("http://x")';r.businessEvents[1]!.type='+cmd';r.businessEvents[2]!.type='@SUM(A1)';r.businessEvents[3]!.id='-12.5';
 const csv=reportCsv(r as unknown as RunReport);
 expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);expect(csv).toContain(",'+cmd");expect(csv).toContain(",'@SUM(A1)");expect(csv).toContain(',-12.5,');expect(csv).not.toMatch(/,=|,\+cmd|,@SUM/);
 expect(redact({note:'failed to open /Users/someone/runs/abc/journal.db and C:\\Users\\x\\a.txt'})).toEqual({note:'failed to open [redacted path] and [redacted path]'});
});
test('native origin aligns raw navigation, business, fault and CSV ticks through JSON roundtrip',()=>{
 const r=report({mode:'simulation'});r.manifest.clock.native={provider:'gazebo_nav2',originNs:'10000000000',businessEpochMs:EPOCH};r.outcome.tick=100;r.businessEvents=[ev(1,0,'Started','run','r'),ev(2,50,'Arrived','mission','m')];r.faults=[{tick:50,faultId:'cut',entityId:'amr-1'}];r.telemetry!.samples=[pose(0,1),pose(100,3)].map(s=>({...s,providerId:'gazebo_nav2',observedAt:null,simTimeNs:String(BigInt(s.simTimeNs!)+10000000000n)}));
 for(const imported of [r,JSON.parse(reportJson(r))]){const replay=openReplayV2(imported);expect(replay.range.toTick).toBe(100);expect(replay.seek(0).entities['amr-1']?.observed?.xM).toBe(1);expect(replay.seek(49).events).toHaveLength(1);expect(replay.seek(49).faults).toEqual([]);expect(replay.seek(50).events).toHaveLength(2);expect(replay.seek(100).entities['amr-1']?.observed?.xM).toBe(3);expect(reportCsv(imported)).toContain('telemetry,0,,0,amr-1');expect(reportCsv(imported)).toContain('telemetry,100,,100,amr-1');expect(reportCsv(imported).split('\n').find((line:string)=>line.startsWith('telemetry,100,'))).toMatch(/,12000000000$/);}
});
