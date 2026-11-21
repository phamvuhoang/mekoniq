import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {faultHtml,faultSection} from '../../src/reports/faults';
import {report} from '../support/navigation-report';

const inv=(over:Record<string,string>={})=>['NO_FALSE_SERVE','NO_RESEND_AFTER_UNKNOWN','NO_MOTION_BEFORE_ENABLED','CUSTODY_UNCHANGED','LATCH_HELD','TORQUE_ZERO_AFTER_TIMEOUT'].map(id=>({id,result:over[id]??'pass',tick:over[id]==='violated'?9:null,evidence:'x'}));
const entry=(over:Record<string,unknown>={})=>({entryId:'e1',faultId:'encoder-dropout',targetId:'amr-1/wheel-right',params:{},durationMs:300,injection:{appliedTick:412,endedTick:427},
 detection:{by:'drive',code:'FEEDBACK_LOSS',tick:414,latencyTicks:2},firstCommandChangeTick:415,plantResponse:{axisState:'fault',axisFault:'FEEDBACK_LOSS',peakActualSpeedRadS:5,ticksToRest:16,baseTravelM:0.31},verdict:'detected_in_time',...over});
const fr=(entries:unknown[],invariants=inv())=>({schemaVersion:1,documentType:'fault-report',runId:'r',scheduleDigest:'a'.repeat(64),oracleDigest:'b'.repeat(64),entries,invariants,evidence:[],accepted:false});
const withFaults=(f:unknown)=>({...report(),faultReport:f}) as never;
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
