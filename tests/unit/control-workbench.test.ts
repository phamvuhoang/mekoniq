// V07a (R4.2 §6.3, rulings 2–7): the Control tab's pure rules (draft bounds, A/B identity, export/import of a ControlProfileV1, the digest rule) and the tab
// inside the twin workspace (a run locks its draft, the run is read once and archived, cancel says "stopping" until the runtime confirms, suggestions only
// after a bench of that axis, results in words). Fixtures are the source's own drive-v1 files (same rule as replay-package.test.ts).
import {readFileSync} from 'node:fs';
import {afterEach,expect,test,vi} from 'vitest';
const store=new Map<string,string>([['mekoniq-locale','en']]);
vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,String(v));},removeItem:(k:string)=>{store.delete(k);}});
vi.stubGlobal('innerWidth',1440);
vi.stubGlobal('matchMedia',()=>({matches:false}));
vi.stubGlobal('document',{documentElement:{lang:'en'},getElementById:()=>null,querySelector:()=>null,activeElement:null,addEventListener(){},removeEventListener(){}});
vi.stubGlobal('location',{origin:'http://127.0.0.1:4175',hostname:'127.0.0.1'});
import type {ControlProfileV1,DriveTrace,TuningEnvelopeV1,TuningResultV1} from '../../src/shared/navigation2d';
import type {RunView,TwinHealth,TwinRuntime} from '../../src/scenarios/controls';
import {TwinRuntimeError} from '../../src/scenarios/controls';
import {hashJson} from '../../src/twin/hash';
const {BENCH_SET,benchDraft,comparable,exportControlProfile,importControlProfile,offeredFields,parseDraft,profileDigest,traceSeries}=await import('../../src/control/workbench');
const {tuningHtml}=await import('../../src/reports/control');
const {setLocale}=await import('../../src/i18n');
const {coffeeReplay}=await import('../support/coffee-replay');
const {backendSetOptions}=await import('../../src/scenarios/support');
const {TwinWorkspace}=await import('../../src/ui/workspace');

const fixture=<T,>(n:string):T=>JSON.parse(readFileSync(`../source/robotics/simulation-mujoco/fixtures/drive-v1/${n}`,'utf8')) as T;
const serve=fixture<ControlProfileV1>('serve-control-v1.json'),xarm=fixture<ControlProfileV1>('xarm6-control-v1.json'),envelope=fixture<TuningEnvelopeV1>('tuning-envelope-v1.json');
const NOMINAL='cf7b61f6b110bd4cf31c2fca3455350a8e29160b5791fd3b47345c5129468405',WHEELS=['amr-1/wheel-left','amr-1/wheel-right'];
const env=(id:string)=>envelope.axes.find(a=>a.axisId===id)!;
const seal=<T extends {digest:string},>(d:T):T=>{const {digest:_,...rest}=d;void _;return {...d,digest:hashJson(rest)};};
const ok=(value:number,unit:string)=>({available:true as const,value,unit,samples:5000,basis:'actual' as const});
const no=(reason:string,unit:string)=>({available:false as const,value:null,unit,reason});
const SUGGESTIONS=[5,10,20,40].flatMap(bw=>[0.7,1].map(z=>({bandwidthRadS:bw,damping:z,loop:{kp:0.0874395*bw*z*2,ki:Math.min(64,0.0874395*bw*bw),kd:0,integralLimit:6,slewLimit:null},accelerationLimit:null,clamped:bw===40?['ki' as const]:[]})));
const tuning=(o:Partial<TuningResultV1>={}):TuningResultV1=>({schemaVersion:1,documentType:'tuning-result',runId:'bench-1',status:'completed',unstable:null,fault:null,collision:null,axisIds:[...WHEELS],signal:{kind:'step',amplitude:2,atTick:10},seed:7,
 engine:{id:'mujoco_3d',version:'3.17.0',hostArch:'arm64'},plant:{plantModelDigest:serve.plantModelDigest,driveModelDigest:NOMINAL,controlProfileDigest:'c'.repeat(64),load:'empty'},effectiveInertia:{valueKgM2:0.0874395,basis:'wheel_straight_line',provenance:'assumed'},suggestions:SUGGESTIONS,
 policy:{finalWindowS:0.5,settleBand:0.02,holdWindowS:0.25},metrics:{riseTimeS:ok(0.1032,'s'),overshootPct:ok(0,'%'),settlingTimeS:no('NOT_SETTLED','s'),steadyStateError:ok(0.0662,'rad/s'),rmsError:ok(0.113,'rad/s'),peakTorqueNm:ok(4,'N m'),saturationRatio:ok(0,'ratio')},
 trace:{chunks:11,sha256:'e'.repeat(64),samples:5000},accepted:false,...o});

// ---- pure rules ----
test('the digest rule (sha256-canonical-json-v1 without the digest key) reproduces both source fixtures',()=>{
 expect(profileDigest(serve)).toBe('089a6b41bbf1a673ae1548320d1699e42126071e2e4f65e0e2a47a24485c8f80');expect(serve.digest).toBe(profileDigest(serve));
 expect(profileDigest(xarm)).toBe('1f727cb47d943039f1fc6e644a8e6bc8fb7f90db5a8336e8fdb5c179d39a0092');
});
test('only the fields the served envelope lists are offered: no kd or slew on a wheel, no acceleration limit on a joint',()=>{
 expect(offeredFields(env('amr-1/wheel-left'))).toEqual(['kp','ki','integralLimit','accelerationLimit']);
 expect(offeredFields(env('xarm-1/J3'))).toEqual(['kp','ki','kd','integralLimit','slewLimit']);
});
test('parseDraft refuses an empty, non-numeric or out-of-envelope field with a reason per field, and takes the rest as the server would',()=>{
 const wheel=env('amr-1/wheel-left'),d=(o:Record<string,string>={})=>({axisId:'amr-1/wheel-left',kp:'2',ki:'0',kd:'',integralLimit:'',slewLimit:'',accelerationLimit:'',...o});
 expect(parseDraft(d(),wheel)).toEqual({ok:true,control:{axisId:'amr-1/wheel-left',loop:{kp:2,ki:0,kd:0,integralLimit:null,slewLimit:null},accelerationLimit:null}});
 // a field the envelope does not list is not read at all
 expect(parseDraft(d({kd:'7',slewLimit:'abc'}),wheel)).toMatchObject({ok:true,control:{loop:{kd:0,slewLimit:null}}});
 const bad=parseDraft(d({kp:'',ki:'abc',accelerationLimit:'1000'}),wheel);
 if(bad.ok)throw new Error('expected a refusal');
 expect(Object.keys(bad.fields).sort()).toEqual(['accelerationLimit','ki','kp']);
 expect(bad.fields.kp).toMatch(/required/i);expect(bad.fields.ki).toMatch(/number/i);expect(bad.fields.accelerationLimit).toContain('[0.5, 100]');
 for(const x of ['NaN','Infinity','1e999','2 3'])expect(parseDraft(d({kp:x}),wheel).ok,x).toBe(false);
 expect(parseDraft(d({kp:'20.0001'}),wheel).ok).toBe(false);expect(parseDraft(d({kp:'-0.1'}),wheel).ok).toBe(false);
 expect(parseDraft(d({kp:'20'}),wheel).ok).toBe(true);expect(parseDraft(d({kp:'0,5'}),wheel)).toMatchObject({ok:true,control:{loop:{kp:0.5}}});
 // Ki > 0 needs an integral limit; Ki = 0 takes none (INTEGRAL_LIMIT_REQUIRED / _WITHOUT_KI on the server)
 expect(parseDraft(d({ki:'1'}),wheel)).toMatchObject({ok:false,fields:{integralLimit:expect.any(String)}});
 expect(parseDraft(d({ki:'1',integralLimit:'6'}),wheel)).toMatchObject({ok:true,control:{loop:{ki:1,integralLimit:6}}});
 expect(parseDraft(d({integralLimit:'2'}),wheel)).toMatchObject({ok:false,fields:{integralLimit:expect.any(String)}});
 // a joint: kd is required, an acceleration limit is never sent
 const j3=parseDraft({axisId:'xarm-1/J3',kp:'6000',ki:'0',kd:'',integralLimit:'',slewLimit:'',accelerationLimit:'3'},env('xarm-1/J3'));
 expect(j3).toMatchObject({ok:false,fields:{kd:expect.stringMatching(/required/i)}});
 expect(parseDraft({axisId:'xarm-1/J3',kp:'6000',ki:'0',kd:'150',integralLimit:'',slewLimit:'0.5',accelerationLimit:'3'},env('xarm-1/J3'))).toEqual({ok:true,control:{axisId:'xarm-1/J3',loop:{kp:6000,ki:0,kd:150,integralLimit:null,slewLimit:0.5},accelerationLimit:null}});
});
test('comparable: same plant, drive model, load, axis, signal, seed and engine; otherwise it lists what changed (no delta)',()=>{
 const a=tuning(),b=tuning({runId:'bench-2',plant:{...a.plant,controlProfileDigest:'f'.repeat(64)}});
 expect(comparable(a,b)).toEqual({ok:true});
 expect(comparable(a,tuning({plant:{...a.plant,plantModelDigest:'1'.repeat(64)}}))).toEqual({ok:false,changed:['plantModelDigest']});
 expect(comparable(a,tuning({plant:{...a.plant,driveModelDigest:'2'.repeat(64)}}))).toEqual({ok:false,changed:['driveModelDigest']});
 expect(comparable(a,tuning({plant:{...a.plant,load:'cup-center'}}))).toEqual({ok:false,changed:['load']});
 expect(comparable(a,tuning({signal:{kind:'step',amplitude:2,atTick:20}}))).toEqual({ok:false,changed:['signal']});
 expect(comparable(a,tuning({seed:8}))).toEqual({ok:false,changed:['seed']});
 expect(comparable(a,tuning({engine:{id:'mujoco_3d',version:'3.17.0',hostArch:'x86_64'}}))).toEqual({ok:false,changed:['engine']});
 expect(comparable(a,tuning({axisIds:['xarm-1/J3']}))).toEqual({ok:false,changed:['axis']});
 expect(comparable(a,tuning({seed:8,signal:{kind:'hold',ticks:100}}))).toEqual({ok:false,changed:['signal','seed']});
});
test('export: the run draft with tuned_in_simulation sources naming the bench, its trace and the runtime commit; sealed, importable, and bound to that bench',()=>{
 const control={axisId:'amr-1/wheel-left',loop:{kp:4,ki:0,kd:0,integralLimit:null,slewLimit:null},accelerationLimit:null},draft=benchDraft(serve,control,WHEELS);
 expect(draft.axes.map(a=>a.loop.kp)).toEqual([4,4]);expect(draft.revision).toBe(serve.revision+1);expect(draft.digest).toBe(profileDigest(draft));
 const result=tuning({plant:{...tuning().plant,controlProfileDigest:draft.digest}}),text=exportControlProfile(serve,control,result,{scenarioId:'MJ-BENCH-WHEEL',sourceCommit:'5'.repeat(40)}),p=JSON.parse(text) as ControlProfileV1;
 const tuned={kind:'tuned_in_simulation',benchRunId:'bench-1',scenarioId:'MJ-BENCH-WHEEL',traceSha256:'e'.repeat(64),sourceCommit:'5'.repeat(40)};
 expect(p.sources).toEqual({loop:tuned,limits:tuned,controller:serve.sources.controller});
 expect(p).toMatchObject({calibration:'not_calibrated',plantModelDigest:serve.plantModelDigest,driveModelDigests:serve.driveModelDigests,id:serve.id,revision:serve.revision+1});
 expect(p.axes.map(a=>a.loop.kp)).toEqual([4,4]);expect(p.digest).toBe(profileDigest(p));
 expect(importControlProfile(text,{plantModelDigest:serve.plantModelDigest,driveModelDigest:NOMINAL})).toEqual({ok:true,profile:p});
 // another draft than the one the bench ran is not that bench's profile
 expect(()=>exportControlProfile(serve,{...control,loop:{...control.loop,kp:5}},result,{scenarioId:'MJ-BENCH-WHEEL',sourceCommit:'5'.repeat(40)})).toThrow('EXPORT_RESULT_MISMATCH');
});
test('import refuses broken JSON, a schema failure, a wrong digest, another plant and a drive model it was not declared for',()=>{
 const plant={plantModelDigest:serve.plantModelDigest,driveModelDigest:NOMINAL};
 expect(importControlProfile(JSON.stringify(serve),plant)).toEqual({ok:true,profile:serve});
 expect(importControlProfile('{"schemaVersion":1,',plant)).toEqual({ok:false,reasonCodes:['INVALID_JSON']});
 const {calibration:_c,...noCalibration}=serve;void _c;
 expect(importControlProfile(JSON.stringify(noCalibration),plant)).toEqual({ok:false,reasonCodes:['SCHEMA_INVALID']});
 expect(importControlProfile(JSON.stringify(seal({...serve,sources:{...serve.sources,loop:{kind:'tuned_in_simulation',benchRunId:'x',scenarioId:'MJ-BENCH-WHEEL',traceSha256:'not-hex',sourceCommit:'5'.repeat(40)}}} as ControlProfileV1)),plant)).toEqual({ok:false,reasonCodes:['SCHEMA_INVALID']});
 expect(importControlProfile(JSON.stringify({...serve,revision:2}),plant)).toEqual({ok:false,reasonCodes:['DIGEST_MISMATCH']});
 expect(importControlProfile(JSON.stringify(xarm),plant)).toEqual({ok:false,reasonCodes:['DRIVE_PLANT_MISMATCH','DRIVE_MODEL_DIGEST_MISMATCH']});
 expect(importControlProfile(JSON.stringify(serve),{...plant,driveModelDigest:'f'.repeat(64)})).toEqual({ok:false,reasonCodes:['DRIVE_MODEL_DIGEST_MISMATCH']});
 expect(importControlProfile(JSON.stringify(serve).replace('"kp":2','"kp":1e999'),plant).ok).toBe(false);
 expect(importControlProfile('x'.repeat(2_000_000),plant)).toEqual({ok:false,reasonCodes:['PROFILE_TOO_LARGE']});
});
test('a recorded trace becomes command/actual/feedback, error and torque series; a null sample is a gap and saturated samples are bands',()=>{
 const s=(target:number,actual:number,saturated=false)=>({target,actual,feedback:actual,torqueNm:saturated?4:1,saturated});
 const t:DriveTrace={axisId:'amr-1/wheel-left',dtS:0.002,samples:[s(0,0),s(2,0.5,true),s(2,1,true),null,s(2,1.9)]};
 const r=traceSeries(t);
 expect(r.response.map(x=>x.id)).toEqual(['target','actual','feedback']);expect(r.response.find(x=>x.id==='feedback')!.dashed).toBe(true);
 expect(r.error[0]!.points.map(p=>p[1])).toEqual([0,1.5,1,NaN,0.10000000000000009]);
 expect(r.torque[0]!.points[3]![1]).toBeNaN();
 expect(r.bands).toEqual([{from:0.002,to:0.006,label:expect.any(String)}]);
});
test('a result in words: a drive fault on OVERSPEED says the response exceeded the drive speed limit; an unavailable metric shows its reason, never 0',()=>{
 const all=(reason:string)=>Object.fromEntries(Object.entries(tuning().metrics).map(([k,m])=>[k,no(reason,m.unit)]));
 const fault=tuningHtml(tuning({status:'drive_fault',fault:{tick:15,axisId:'xarm-1/J3',code:'OVERSPEED'},metrics:all('DRIVE_FAULT')}));
 expect(fault).toContain('OVERSPEED');expect(fault).toMatch(/exceeded the drive.s speed limit/);expect(fault).toContain('DRIVE_FAULT');expect(fault).toContain('tick 15');
 expect(fault).not.toMatch(/>\s*0(\.0+)?\s*(s|%|rad\/s)\s*</);
 expect(tuningHtml(tuning({status:'unstable',unstable:{tick:30,warning:'BADQACC'},metrics:all('PLANT_UNSTABLE')}))).toContain('BADQACC');
 expect(tuningHtml(tuning({status:'collision',collision:{tick:453,ids:['boundary-west']},metrics:all('COLLISION')}))).toContain('boundary-west');
 const done=tuningHtml(tuning());expect(done).toContain('Completed');expect(done).toContain('NOT_SETTLED');expect(done).toContain('0.103 s');
});
test('A/B: a comparable pair shows B − A per metric; any other pair lists the changed inputs and no delta',()=>{
 const a=tuning(),b=tuning({runId:'bench-2',metrics:{...a.metrics,riseTimeS:ok(0.08,'s')}});
 const ab=tuningHtml(b,a);expect(ab).toContain('data-testid="ab-delta"');expect(ab).toContain('−0.0232 s');
 const other=tuningHtml(tuning({seed:8}),a);expect(other).not.toContain('data-testid="ab-delta"');expect(other).toContain('data-testid="ab-changed"');expect(other).toContain('seed');
});
test('the bench set is not offered in the twin\'s backend-set picker',()=>{
 const h={protocolMajors:[2],sourceCommit:'d'.repeat(40),schemaHash:'a',scenarioIds:[],backends:[],backendSets:[{id:'mock-default',mode:'mock',access:'simulated',backends:[]},{id:BENCH_SET,mode:'simulation',access:'simulated',backends:[]}]} as TwinHealth;
 expect(backendSetOptions(h).map(s=>s.id)).toEqual(['mock-default']);
});

// ---- the tab in the twin workspace ----
const deferred=<T,>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const health=(o:Partial<TwinHealth>={}):TwinHealth=>({protocolMajors:[2],sourceCommit:'5'.repeat(40),schemaHash:'a'.repeat(64),scenarioIds:['MJ-BENCH-WHEEL','MJ-BENCH-ARM'],features:{readiness:true},backends:[],
 backendSets:[{id:BENCH_SET,mode:'simulation',access:'simulated',backends:['mujoco_3d','mujoco_arm']}],
 tuningEnvelope:envelope,benchSignals:{kinds:['step','trapezoid','hold'],maxTicks:500,amplitudes:{wheelRadS:[2,5],jointRad:[0.05,0.1,0.2]},suggestOptions:{bandwidthRadS:[5,10,20,40],damping:[0.7,1]},wheelDirection:'forward'},
 benchCatalog:{'MJ-BENCH-WHEEL':{plant:{id:'serve-payload-v1',revision:1,load:'empty',plantModelDigest:serve.plantModelDigest},axes:[{axis:'wheels',axisIds:[...WHEELS],mode:'csv',unit:'rad/s',direction:'forward'}],experiments:{'drive-nominal-v1':{anchorTick:4,driveModelDigest:NOMINAL}},startingProfile:serve},
  'MJ-BENCH-ARM':{plant:{id:'xarm6-g2-v1',revision:1,load:'empty',plantModelDigest:xarm.plantModelDigest},axes:[{axis:'J3',axisIds:['xarm-1/J3'],mode:'csp',unit:'rad',lowerRad:-3.927,upperRad:0.19198,startRad:-0.324460234973}],experiments:{'drive-nominal-v1':{anchorTick:4,driveModelDigest:xarm.driveModelDigests[1]!}},startingProfile:xarm}},...o} as TwinHealth);
type Panel={phase:string;importText(t:string):void};
type H={health:TwinHealth|null;healthChecked:boolean;control:Panel};
const workspaces:InstanceType<typeof TwinWorkspace>[]=[];
afterEach(()=>{for(const w of workspaces.splice(0))w.leave();});
function bench(o:{deferCreate?:boolean;deferStep?:boolean;refuse?:TwinRuntimeError;result?:(draftDigest:string,n:number)=>TuningResultV1;h?:TwinHealth;traceError?:Error;reportFailures?:number;proofs?:string[];startError?:Error}={}){
 const proofs=new Set(o.proofs??[]);let reportFailures=o.reportFailures??0;
 const calls:string[]=[],created:{bench:{controlProfile:ControlProfileV1;signal:unknown;axis:string}}[]=[],actions:{kind:string;revision:number}[]=[],pending:Record<string,{resolve:(v?:unknown)=>void}>={};
 let n=0;
 const view=(id:string,status:RunView['run']['status'],tick:number,revision:number):RunView=>({run:{schemaVersion:2,id,mode:'simulation',access:'simulated',backendSetId:BENCH_SET,backends:['mujoco_3d'],status,runRevision:revision,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:'5'.repeat(40),scenarioId:'MJ-BENCH-WHEEL',scenarioRevision:1,seed:7},tick,simTimeNs:String(tick*20_000_000),model:'mujoco_drive_bench',entities:[],workload:[],awaiting:[],attention:[],served:'0',coffee:null});
 const wait=async<T,>(key:string,v:T,defer?:boolean)=>{if(!defer)return v;const d=deferred<unknown>();pending[key]={resolve:()=>d.resolve(undefined)};await d.promise;delete pending[key];return v;};
 const rt={paired:true,get recoverableRunIds(){return [...proofs];},target:{base:'/lab/v2',kind:'same_origin'},forget(){},pair:async()=>{},health:async()=>o.h??health(),get:async()=>{throw new Error('not used');},
  create:async(r:{bench:never})=>{calls.push('create');if(o.refuse)throw o.refuse;created.push(structuredClone(r));const id=`bench-${++n}`;proofs.add(id);return wait('create',view(id,'ready',0,0),o.deferCreate);},
  action:async(v:RunView,kind:string)=>{calls.push(`${kind} ${v.run.id}`);actions.push({kind,revision:v.run.runRevision});const r=v.run.runRevision+1;
   if(kind==='start'){if(o.startError)throw o.startError;return view(v.run.id,'running',0,r);}
   if(kind==='cancel')return view(v.run.id,'cancelled',v.tick,r);
   const tick=v.tick+50;return wait('step',view(v.run.id,tick>=500?'completed':'running',Math.min(tick,500),r),o.deferStep);},
  report:async(id:string)=>{calls.push(`report ${id}`);if(reportFailures>0){reportFailures--;throw new TypeError('Failed to fetch');}const i=Number(id.split('-')[1])-1,digest=created[i]!.bench.controlProfile.digest;return {tuning:o.result?o.result(digest,i):tuning({runId:id,plant:{...tuning().plant,controlProfileDigest:digest}})} as never;},
  trace:async(id:string)=>{calls.push(`trace ${id}`);if(o.traceError)throw o.traceError;return {traces:[{axisId:'amr-1/wheel-left',dtS:0.002,samples:Array.from({length:5010},(_,j)=>({target:j<140?0:2,actual:2*(1-Math.exp(-Math.max(0,j-140)/60)),feedback:2*(1-Math.exp(-Math.max(0,j-145)/60)),torqueNm:1,saturated:j===150}))}],issues:[]};},
  archive:async(id:string)=>{calls.push(`archive ${id}`);},dropProof:(id:string)=>{calls.push(`drop ${id}`);proofs.delete(id);},
 };
 const w=new TwinWorkspace(()=>{},rt as unknown as TwinRuntime),h=w as unknown as H;workspaces.push(w);
 Object.assign(h,{health:o.h??health(),healthChecked:true});
 w.click('twin-inspector-tab','control');
 const run=()=>w.submit({id:'twin-ctl-form'} as HTMLFormElement);
 const idle=()=>vi.waitFor(()=>expect(h.control.phase).toBe('idle'));
 return {w,h,calls,created,actions,pending,run,idle};
}
test('Review Focus 1: a field edited after the run was created does not change that run\'s controlProfileDigest; the next run carries the new value',async()=>{
 const {w,created,pending,run,idle}=bench({deferCreate:true});
 expect(w.html()).toContain('data-testid="control-bench"');
 run();await vi.waitFor(()=>expect(pending.create).toBeDefined());
 w.input('twin-ctl-kp','5');
 pending.create!.resolve();await idle();
 const first=created[0]!.bench.controlProfile,locked=benchDraft(serve,{axisId:WHEELS[0]!,loop:{kp:2,ki:0,kd:0,integralLimit:null,slewLimit:null},accelerationLimit:null},WHEELS);
 expect(first.axes.map(a=>a.loop.kp)).toEqual([2,2]);expect(first.digest).toBe(locked.digest);
 run();await vi.waitFor(()=>expect(created).toHaveLength(2));pending.create!.resolve();await idle();
 const second=created[1]!.bench.controlProfile;
 expect(second.axes.map(a=>a.loop.kp)).toEqual([5,5]);expect(second.digest).not.toBe(first.digest);expect(second.digest).toBe(profileDigest(second));
 expect(created[1]!.bench).toMatchObject({axis:'wheels',signal:{kind:'step',amplitude:2,atTick:10}});
});
test('Ruling 7: a finished bench\'s report and trace are read once, then it is archived and its reclaim proof dropped; re-renders read nothing',async()=>{
 const {w,calls,run,idle}=bench();
 run();await idle();
 expect(calls).toEqual(['create','start bench-1',...Array(10).fill('step bench-1'),'report bench-1','trace bench-1','archive bench-1','drop bench-1']);
 for(let i=0;i<3;i++)w.html();
 expect(calls.filter(c=>c.startsWith('trace')||c.startsWith('report'))).toHaveLength(2);
 const html=w.html();expect(html).toContain('Completed');expect(html).toContain('data-testid="control-plot-response"');expect(html.match(/<polyline/g)!.length).toBeGreaterThanOrEqual(5);
});
test('Ruling 7: cancel says "stopping" until the runtime confirms; the cancel carries the revision of the step that was in flight',async()=>{
 const {w,calls,actions,pending,run,idle}=bench({deferStep:true});
 run();await vi.waitFor(()=>expect(pending.step).toBeDefined());
 w.click('twin-ctl-cancel');
 expect(w.html()).toMatch(/data-action="twin-ctl-cancel"[^>]*disabled[^>]*>[^<]*Stopping/);
 const stepRevision=actions.at(-1)!.revision+1;
 pending.step!.resolve();await idle();
 expect(actions.at(-1)).toEqual({kind:'cancel',revision:stepRevision});
 expect(calls).toContain('archive bench-1');expect(w.html()).not.toContain('Stopping');
});
test('Ruling 2: the gain suggestion is disabled with its reason until a bench of that axis gave suggestions; applying one fills the draft',async()=>{
 const {w,run,idle}=bench();
 expect(w.html()).toMatch(/<button[^>]*data-action="twin-ctl-suggest-apply"[^>]*disabled/);
 expect(w.html()).toContain('model-based starting point, not calibrated');
 run();await idle();
 expect(w.html()).not.toMatch(/<button[^>]*data-action="twin-ctl-suggest-apply"[^>]*disabled/);
 w.change('twin-ctl-suggest','6');w.click('twin-ctl-suggest-apply');
 const html=w.html();
 expect(html).toMatch(new RegExp(`id="twin-ctl-kp"[^>]*value="${String(SUGGESTIONS[6]!.loop.kp).replace('.','\\.')}"`));
 expect(html).toMatch(/id="twin-ctl-ki"[^>]*value="64"/);expect(html).toMatch(/id="twin-ctl-integralLimit"[^>]*value="6"/);
 // another axis has had no bench yet
 w.change('twin-ctl-axis-J3','J3');expect(w.html()).toMatch(/<button[^>]*data-action="twin-ctl-suggest-apply"[^>]*disabled/);
});
test('Ruling 3: an out-of-envelope value is blocked at the form with its reason and no run is created; a server refusal is shown with its codes, per field where it names one',async()=>{
 const {w,calls,run}=bench();
 w.input('twin-ctl-kp','25');run();
 expect(calls).toEqual([]);
 const html=w.html();expect(html).toContain('[0, 20]');expect(html).toMatch(/id="twin-ctl-kp"[^>]*aria-invalid="true"/);
 const refused=bench({refuse:new TwinRuntimeError('INVALID_BENCH_REQUEST',['GAIN_OUT_OF_ENVELOPE','INTEGRAL_LIMIT_REQUIRED'],422)});
 refused.run();await refused.idle();
 const r=refused.w.html();expect(r).toContain('GAIN_OUT_OF_ENVELOPE');expect(r).toMatch(/id="twin-ctl-integralLimit"[^>]*aria-invalid="true"/);
 expect(refused.calls).toEqual(['create']);
});
test('Ruling 4: a drive fault is shown with its cause in words; the OVERSPEED sentence appears in the tab',async()=>{
 const all=Object.fromEntries(Object.entries(tuning().metrics).map(([k,m])=>[k,no('DRIVE_FAULT',m.unit)]));
 const {w,run,idle}=bench({result:(digest)=>tuning({status:'drive_fault',fault:{tick:15,axisId:'amr-1/wheel-left',code:'OVERSPEED'},metrics:all,plant:{...tuning().plant,controlProfileDigest:digest}})});
 run();await idle();
 const html=w.html();expect(html).toMatch(/exceeded the drive.s speed limit/);expect(html).toContain('DRIVE_FAULT');
 // export binds a profile to a completed bench only
 expect(html).toMatch(/<button[^>]*data-action="twin-ctl-export"[^>]*disabled/);
});
test('Ruling 6: an import that is refused leaves the draft as it was; an accepted one becomes the draft',async()=>{
 const {w,h}=bench();
 h.control.importText(JSON.stringify(xarm));
 let html=w.html();expect(html).toContain('DRIVE_PLANT_MISMATCH');expect(html).toMatch(/id="twin-ctl-kp"[^>]*value="2"/);
 const tuned=seal({...serve,revision:4,axes:serve.axes.map(a=>({...a,loop:{...a.loop,kp:3.5}}))});
 h.control.importText(JSON.stringify(tuned));
 html=w.html();expect(html).toMatch(/id="twin-ctl-kp"[^>]*value="3.5"/);expect(html).toContain('serve-control-v1 r4');
});
test('a runtime without the bench catalog says the tab is unavailable and offers no run',()=>{
 const {w,calls,run}=bench({h:health({benchCatalog:undefined})});
 run();expect(calls).toEqual([]);expect(w.html()).toContain('data-testid="control-unavailable"');
});

// ---- fix round 1 ----
test('Fix 2: an in-flight bench is never offered as a twin run to reopen; after a reload a bench left open is offered in the Control tab only, to close',async()=>{
 const first=bench({deferStep:true});
 first.run();await vi.waitFor(()=>expect(first.pending.step).toBeDefined());
 expect(first.w.html()).not.toMatch(/data-action="twin-reclaim" data-value="bench-1"/);
 // a reload mid-bench: a new page with the same storage, whose runtime client still holds the bench's reclaim proof (and a twin run's)
 const again=bench({proofs:['bench-1','twin-run']});
 const html=again.w.html();
 expect(html).not.toMatch(/data-action="twin-reclaim" data-value="bench-1"/);expect(html).toMatch(/data-action="twin-reclaim" data-value="twin-run"/);
 expect(html).toMatch(/data-action="twin-ctl-orphan" data-value="bench-1"/);expect(html).not.toMatch(/data-action="twin-ctl-orphan" data-value="twin-run"/);
 again.w.click('twin-ctl-orphan','bench-1');
 await vi.waitFor(()=>expect(again.calls).toEqual(['archive bench-1','drop bench-1']));
 expect(again.w.html()).not.toContain('twin-ctl-orphan');
 first.w.click('twin-ctl-cancel');first.pending.step!.resolve();await first.idle();
 // a bench that ended normally leaves no proof and no mark behind
 expect(first.calls.slice(-2)).toEqual(['archive bench-1','drop bench-1']);expect(JSON.parse(store.get('mekoniq-lab-bench-runs')??'[]')).toEqual([]);
});
test('Fix 3: a trace that cannot be read keeps the result already read and says why; the bench is still archived',async()=>{
 const {w,calls,run,idle}=bench({traceError:new TwinRuntimeError('INVALID_RUNTIME_RESPONSE',[],502)});
 run();await idle();
 const html=w.html();expect(html).toContain('Completed');expect(html).toContain('0.103 s');expect(html).toContain('TRACE_READ_FAILED:INVALID_RUNTIME_RESPONSE');
 // a result, not a refusal: no server-reason list and no notice
 expect(html).not.toContain('data-testid="control-server-reasons"');expect(html).not.toContain('data-testid="control-notice"');
 expect(calls.slice(-3)).toEqual(['trace bench-1','archive bench-1','drop bench-1']);
 expect(html).not.toMatch(/<button[^>]*data-action="twin-ctl-export"[^>]*disabled/);
});
test('Fix 3: a report that cannot be read leaves the finished bench open with "read again"; reading it again shows the result, then archives it',async()=>{
 const {w,calls,run,idle}=bench({reportFailures:1});
 run();await idle();
 expect(calls).not.toContain('archive bench-1');expect(w.html()).toMatch(/data-action="twin-ctl-reread" data-value="bench-1"/);
 expect(w.html()).not.toMatch(/data-action="twin-reclaim" data-value="bench-1"/);expect(w.html()).not.toMatch(/data-action="twin-ctl-orphan"/);
 w.click('twin-ctl-reread','bench-1');
 await vi.waitFor(()=>expect(calls).toContain('drop bench-1'));await idle();
 expect(calls.filter(c=>c==='report bench-1')).toHaveLength(2);expect(calls.slice(-4)).toEqual(['report bench-1','trace bench-1','archive bench-1','drop bench-1']);
 const html=w.html();expect(html).toContain('Completed');expect(html).not.toContain('twin-ctl-reread');expect(html).toContain('data-testid="control-plot-response"');
});
test('Fix 4: strings from health and from a result are rendered inert',async()=>{
 const evil='"><x-evil data-evil="1">',h=health(),wheel=h.benchCatalog!['MJ-BENCH-WHEEL']!,nominal=wheel.experiments['drive-nominal-v1']!;
 const hostile=health({benchSignals:{...h.benchSignals!,kinds:['step',evil as never],amplitudes:{wheelRadS:[2,evil as never],jointRad:[0.05]}},
  tuningEnvelope:{...envelope,axes:envelope.axes.map(a=>a.axisId==='amr-1/wheel-left'?{...a,kp:{min:0,max:evil as never}}:a)},
  benchCatalog:{'MJ-BENCH-WHEEL':{...wheel,plant:{...wheel.plant,id:evil},experiments:{'drive-nominal-v1':nominal,[evil]:nominal} as never,axes:[...wheel.axes,{...wheel.axes[0]!,axis:evil as never,unit:evil as never}]}}});
 const {w,run,idle}=bench({h:hostile,result:(digest)=>tuning({suggestions:[{...SUGGESTIONS[0]!,bandwidthRadS:evil as never,damping:evil as never,clamped:[evil as never]}],plant:{...tuning().plant,controlProfileDigest:digest}})});
 run();await idle();
 for(const html of [w.html(),(w.change(`twin-ctl-axis-${evil}`,evil),w.html())]){expect(html).not.toContain('<x-evil');expect(html).not.toContain('data-evil="1"');expect(html).toContain('&lt;x-evil');}
});

test('Fix 5: an engine held by another MuJoCo run is said in words in three languages and the draft is kept; a finished twin MuJoCo run can be closed to free it',async()=>{
 const cap=bench({refuse:new TwinRuntimeError('BACKEND_UNAVAILABLE',['MUJOCO_CAPACITY'],422)});
 cap.w.input('twin-ctl-kp','3');cap.run();await cap.idle();
 expect(cap.calls).toEqual(['create']);
 for(const [l,words] of [['vi','đang bị một lần chạy MuJoCo khác giữ'],['ja','別のMuJoCo実行が使用中'],['en','held by another MuJoCo run']] as const){
  setLocale(l);const html=cap.w.html();expect(html,l).toContain(words);expect(html).toContain('MUJOCO_CAPACITY');expect(html).toMatch(/id="twin-ctl-kp"[^>]*value="3"/);
 }
 // the twin has no finished MuJoCo run open: nothing to close from here
 expect(cap.w.html()).not.toContain('twin-ctl-free-engine');
 // refused at start instead (409): the same words, and the bench run that was created is closed
 const start=bench({startError:new TwinRuntimeError('MUJOCO_CAPACITY',[],409)});start.run();await start.idle();
 expect(start.w.html()).toContain('held by another MuJoCo run');expect(start.calls).toEqual(['create','start bench-1','archive bench-1','drop bench-1']);
 // the twin's finished cell run holds the engine: one click closes it the way the twin's next run would (evidence first, then archive)
 const {view:cell,report:cellReport}=coffeeReplay();cell.run={...cell.run,id:'cell-run',backends:['mujoco_3d','mujoco_arm'],status:'completed'};cellReport.manifest.runId='cell-run';cellReport.outcome={...cellReport.outcome,tick:cell.tick,status:'completed'};
 Object.assign(cap.w,{view:cell,report:cellReport,openStreams:()=>{}});
 expect(cap.w.html()).toMatch(/data-action="twin-ctl-free-engine"/);
 cap.w.click('twin-ctl-free-engine');
 await vi.waitFor(()=>expect(cap.calls).toContain('archive cell-run'));
 await vi.waitFor(()=>expect(cap.w.html()).not.toContain('twin-ctl-free-engine'));
 expect(cap.w.html()).toContain('the engine is free');expect(cap.w.html()).toMatch(/id="twin-ctl-kp"[^>]*value="3"/);
});
