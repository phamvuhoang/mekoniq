import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {faultHtml,faultSection} from '../../src/reports/faults';
import {report} from '../support/navigation-report';
import {hashJson} from '../../src/twin/hash';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const inv=(over:Record<string,string>={})=>['NO_FALSE_SERVE','NO_RESEND_AFTER_UNKNOWN','NO_MOTION_BEFORE_ENABLED','CUSTODY_UNCHANGED','LATCH_HELD','TORQUE_ZERO_AFTER_TIMEOUT'].map(id=>({id,result:over[id]??'pass',tick:over[id]==='violated'?9:null,evidence:'x'}));
const entry=(over:Record<string,unknown>={})=>({entryId:'e1',faultId:'encoder-dropout',targetId:'amr-1/wheel-right',params:{},durationMs:300,injection:{appliedTick:412,endedTick:427},
 detection:{by:'drive',code:'FEEDBACK_LOSS',tick:414,latencyTicks:2},firstCommandChangeTick:415,plantResponse:{axisState:'fault',axisFault:'FEEDBACK_LOSS',peakActualSpeedRadS:5,ticksToRest:16,baseTravelM:0.31},verdict:'detected_in_time',...over});
const fr=(entries:unknown[],invariants=inv())=>({schemaVersion:1,documentType:'fault-report',runId:'r',scheduleDigest:'a'.repeat(64),oracleDigest:'b'.repeat(64),entries,invariants,evidence:[],accepted:false});
// a fault report bound to the report that carries it: same run, the manifest's schedule (hashed as the runtime hashes it), ticks within the outcome
const withFaults=(f:unknown)=>{const base=report(),x=f as {entries:{entryId:string;faultId:string;targetId:string}[]},entries=x.entries.map(e=>({id:e.entryId,faultId:e.faultId,targetId:e.targetId,trigger:{kind:'elapsed_sim_ms',value:0},durationMs:300,params:{}})),hash=hashJson(entries);
 return {...base,manifest:{...base.manifest,driveFaultSchedule:{entries,hash}},outcome:{...base.outcome,tick:500},faultReport:{...x,runId:base.manifest.runId,scheduleDigest:hash}} as never;};
beforeEach(()=>setLocale('en'));

test('a report without a fault report says NO_FAULT_DATA, never an empty table; so does anything malformed',()=>{
 expect(faultSection(report())).toEqual({available:false,reason:'NO_FAULT_DATA'});
 for(const bad of [null,undefined,42,{},{faultReport:null},{faultReport:{documentType:'fault-report'}},{faultReport:fr([],[])},{faultReport:{...fr([entry()]),documentType:'x'}},{faultReport:fr([{...entry(),verdict:'maybe'}])}])
  expect(faultSection(bad),JSON.stringify(bad)).toEqual({available:false,reason:'NO_FAULT_DATA'});
 const html=faultHtml(report());expect(html).toContain('data-available="false"');expect(html).toContain('NO_FAULT_DATA');expect(html).toContain('No fault data');expect(html).not.toContain('<table');
});
test('a detected fault reads: what was injected, who detected it and when, the controller, the plant, the invariants and a verdict, with the tick to jump to',()=>{
 const s=faultSection(withFaults(fr([entry()])));if(!s.available)throw new Error('unreachable');
 expect(s.rows).toHaveLength(1);const r=s.rows[0]!;
 expect(r).toMatchObject({entryId:'e1',tick:412,verdictCode:'detected_in_time'});
 expect(r.title).toContain('encoder-dropout');expect(r.title).toContain('amr-1/wheel-right');
 expect(r.injected).toContain('412');expect(r.injected).toContain('427');
 expect(r.detection).toContain('FEEDBACK_LOSS');expect(r.detection).toContain('414');expect(r.detection).toContain('+2');
 expect(r.controller).toContain('415');expect(r.plant).toContain('0.31');expect(r.invariants).toBe('6/6 pass');expect(r.verdict).toBe('Detected in time');
});
test('not_fired has no tick and its own label; detected_late and not_detected have theirs; nothing is claimed for a fault that did not fire',()=>{
 const nf=entry({verdict:'not_fired',injection:{appliedTick:null,endedTick:null},detection:{by:null,code:null,tick:null,latencyTicks:null},firstCommandChangeTick:null,plantResponse:{axisState:null,axisFault:null,peakActualSpeedRadS:null,ticksToRest:null,baseTravelM:null}});
 const late=entry({entryId:'e2',verdict:'detected_late',detection:{by:'drive',code:'COMMAND_TIMEOUT',tick:20,latencyTicks:8}}),none=entry({entryId:'e3',verdict:'not_detected',detection:{by:null,code:null,tick:null,latencyTicks:null}});
 const s=faultSection(withFaults(fr([nf,late,none])));if(!s.available)throw new Error('unreachable');
 expect(s.rows.map(r=>r.verdict)).toEqual(['Not fired','Detected late','Not detected']);
 expect(s.rows[0]!.tick).toBeNull();expect(s.rows[0]!.injected).toBe('—');expect(s.rows[0]!.detection).toBe('—');expect(s.rows[0]!.plant).toBe('—');
 expect(s.rows[1]!.detection).toContain('+8');expect(s.rows[2]!.detection).toContain('Not detected');
 const html=faultHtml(withFaults(fr([nf,late])));
 expect(html).toContain('data-verdict="not_fired"');expect(html).toContain('data-verdict="detected_late"');
 expect(html.match(/data-action="twin-fault-jump"/g)).toHaveLength(1);   // only the fired entry can be jumped to
});
test('a violated invariant is named, in the row and in the summary',()=>{
 const s=faultSection(withFaults(fr([entry()],inv({LATCH_HELD:'violated',CUSTODY_UNCHANGED:'not_applicable'}))));if(!s.available)throw new Error('unreachable');
 expect(s.rows[0]!.invariants).toBe('4/6 pass · 1 violated (LATCH_HELD) · 1 n/a');
 expect(faultHtml(withFaults(fr([entry()],inv({LATCH_HELD:'violated'}))))).toContain('data-violated="true"');
});
test('every runtime string is escaped, and the section reads in Vietnamese, Japanese and English',()=>{
 const html=faultHtml(withFaults(fr([entry({targetId:'<img src=x onerror=alert(1)>'})])));expect(html).not.toContain('<img');expect(html).toContain('&lt;img');
 setLocale('vi');expect(faultHtml(withFaults(fr([entry()])))).toContain('Phát hiện đúng hạn');expect(faultHtml(report())).toContain('Không có dữ liệu lỗi');
 setLocale('ja');expect(faultHtml(withFaults(fr([entry()])))).toContain('期限内に検出');expect(faultHtml(report())).toContain('障害データなし');
});

import {faultBlockHtml} from '../../src/reports/faults';
test('only a run that had a drive fault schedule shows the section; a package that lost its report says why',()=>{
 expect(faultBlockHtml(report())).toBe('');expect(faultBlockHtml(null)).toBe('');
 const scheduled={...report(),manifest:{...report().manifest,driveFaultSchedule:{entries:[],hash:'x'}}};
 expect(faultBlockHtml(scheduled)).toContain('NO_FAULT_DATA');
 expect(faultBlockHtml(withFaults(fr([entry()])))).toContain('data-available="true"');
});

// R13: a fault report is shown only for the report that carries it: its run, the manifest's schedule (by the runtime's hash), entries of that schedule, ticks within the outcome
test('a fault report whose nested identity does not match the report that carries it is refused, with the reason',()=>{
 const ok=withFaults(fr([entry()])) as unknown as {manifest:{runId:string;driveFaultSchedule?:{entries:{id:string}[];hash:string}};outcome:{tick:number};faultReport:{runId:string;scheduleDigest:string;entries:{entryId:string;injection:{appliedTick:number}}[]}};
 expect(faultSection(ok).available).toBe(true);
 const refused=(edit:(r:typeof ok)=>void)=>{const r=structuredClone(ok);edit(r);return faultSection(r);};
 expect(refused(r=>{r.faultReport.runId='6f3de442-33de-4ec8-af42-92b2e46b1513';})).toEqual({available:false,reason:'FAULT_RUN_MISMATCH'});
 expect(refused(r=>{r.faultReport.scheduleDigest='f'.repeat(64);})).toEqual({available:false,reason:'FAULT_SCHEDULE_MISMATCH'});
 expect(refused(r=>{delete r.manifest.driveFaultSchedule;})).toEqual({available:false,reason:'FAULT_SCHEDULE_MISMATCH'});
 expect(refused(r=>{r.manifest.driveFaultSchedule!.entries[0]!.id='other';})).toEqual({available:false,reason:'FAULT_SCHEDULE_MISMATCH'});   // entries no longer hash to the digest
 expect(refused(r=>{(r.manifest.driveFaultSchedule!.entries[0] as Record<string,unknown>).durationMs=Infinity;})).toEqual({available:false,reason:'FAULT_SCHEDULE_MISMATCH'});   // not hashable: refused, never thrown
 expect(refused(r=>{r.faultReport.entries[0]!.entryId='other';})).toEqual({available:false,reason:'FAULT_ENTRY_UNSCHEDULED'});
 expect(refused(r=>{r.outcome.tick=411;})).toEqual({available:false,reason:'FAULT_BEYOND_HORIZON'});
 const shown=faultHtml((()=>{const r=structuredClone(ok);r.faultReport.runId='x';return r;})() as never);expect(shown).toContain('data-available="false"');expect(shown).toContain('FAULT_RUN_MISMATCH');expect(shown).not.toContain('<table');
});
test('the shipped drive-fault sample shows its verdict; a copy whose nested run and schedule ids were altered does not',()=>{
 const sample=JSON.parse(gunzipSync(readFileSync(new URL('../../public/replays/drive-fault/report.json.gz.bin',import.meta.url))).toString());
 expect(faultSection(sample)).toMatchObject({available:true,rows:[{verdictCode:'detected_in_time'}]});
 const other=structuredClone(sample);other.faultReport.runId='6f3de442-33de-4ec8-af42-92b2e46b1513';other.faultReport.scheduleDigest='f'.repeat(64);
 expect(faultSection(other)).toEqual({available:false,reason:'FAULT_RUN_MISMATCH'});
 const schedule=structuredClone(sample);schedule.faultReport.scheduleDigest='f'.repeat(64);expect(faultSection(schedule)).toEqual({available:false,reason:'FAULT_SCHEDULE_MISMATCH'});
});

// ---- review R03: an invariant the runtime could not evidence is shown as such, never as a pass; an entry whose injection the supervisor overrode says so ----
test('not_evidenced invariants are accepted, counted apart from passes and shown in words',()=>{
 const f=fr([entry()],inv({TORQUE_ZERO_AFTER_TIMEOUT:'not_evidenced',NO_RESEND_AFTER_UNKNOWN:'not_evidenced'}));
 const s=faultSection(withFaults(f));if(!s.available)throw new Error('unreachable');
 expect(s.rows[0]!.invariants).toContain('4/6');expect(s.rows[0]!.invariants).toMatch(/2 not evidenced/);
 setLocale('vi');expect((faultSection(withFaults(f)) as {rows:{invariants:string}[]}).rows[0]!.invariants).toContain('chưa có bằng chứng');
 setLocale('ja');expect((faultSection(withFaults(f)) as {rows:{invariants:string}[]}).rows[0]!.invariants).toContain('証拠なし');
});
test('an entry whose injection the world supervisor overrode is shown as not fired, with the reason',()=>{
 const f=fr([entry({verdict:'not_fired',injection:{appliedTick:null,endedTick:null,overriddenBy:'WORLD_MOVEMENT_INTERLOCK'},detection:{by:null,code:null,tick:null,latencyTicks:null}})]);
 const s=faultSection(withFaults(f));if(!s.available)throw new Error('unreachable');
 expect(s.rows[0]).toMatchObject({verdictCode:'not_fired'});expect(s.rows[0]!.injected).toContain('WORLD_MOVEMENT_INTERLOCK');
});
