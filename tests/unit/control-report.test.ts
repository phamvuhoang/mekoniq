import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {driveHtml,driveRows,driveSection,stateAt} from '../../src/reports/control';
import {validReportShape} from '../../src/reports/report-shape';
import type {DriveEvidenceBlock,RunReport} from '../../src/scenarios/controls';
import {report} from '../support/navigation-report';

const ok=(value:number):DriveEvidenceBlock['axes'][number]['trackingRms']=>({available:true,value,unit:'rad/s',samples:100,basis:'actual'});
const block=():DriveEvidenceBlock=>({testLevel:'controller_in_the_loop',complete:true,issues:[],ticks:100,events:[{tick:40,code:'TRACKING_DEGRADED',axisId:'amr-1/wheel-left'}],
 axes:[{axisId:'amr-1/wheel-left',mode:'csv',states:[{state:'disabled',fromTick:0},{state:'ready',fromTick:1},{state:'enabled',fromTick:3},{state:'fault',fromTick:60}],faults:[{fault:'OVERSPEED',firstTick:60}],enabledAtTick:3,saturatedSubsteps:4,trackingRms:ok(0.231),speedDeficit:{available:false,value:null,unit:'rad/s',reason:'NO_CRUISE_WINDOW'}},
  {axisId:'amr-1/wheel-right',mode:'csv',states:[{state:'disabled',fromTick:0}],faults:[],enabledAtTick:null,saturatedSubsteps:0,trackingRms:{available:false,value:null,unit:'rad/s',reason:'NEVER_ENABLED'}}]});
const withDrive=(b:DriveEvidenceBlock=block()):RunReport=>({...report(),driveEvidence:b,manifest:{...report().manifest,drive:{experimentId:'drive-nominal-v1',driveModelDigest:'a'.repeat(64),controlProfileDigest:'b'.repeat(64),controllers:[{id:'diff-drive-base-v1',revision:1}],testLevel:'controller_in_the_loop'}} as never});
beforeEach(()=>setLocale('en'));

test('a report without drive data says NO_DRIVE_DATA, never a zero; so does anything that is not a report',()=>{
 expect(driveSection(report())).toEqual({available:false,reason:'NO_DRIVE_DATA'});
 for(const bad of [null,undefined,42,'x',{},{driveEvidence:null},{driveEvidence:{axes:[]}},{driveEvidence:{axes:[],testLevel:'hardware'}}])expect(driveSection(bad),JSON.stringify(bad)).toEqual({available:false,reason:'NO_DRIVE_DATA'});
 const html=driveHtml(report());expect(html).toContain('data-available="false"');expect(html).toContain('NO_DRIVE_DATA');expect(html).toContain('No drive data');expect(html).not.toContain('<table');
});
test('a drive report gives the states of each axis and its tracking RMS, or the reason it could not be computed',()=>{
 const s=driveSection(withDrive());
 expect(s).toMatchObject({available:true,complete:true,issues:[],events:[{tick:40,code:'TRACKING_DEGRADED'}]});
 if(!s.available)throw new Error('unreachable');
 expect(s.axes.map(a=>[a.axisId,a.states])).toEqual([['amr-1/wheel-left',['disabled','ready','enabled','fault']],['amr-1/wheel-right',['disabled']]]);
 const html=driveHtml(withDrive());
 expect(html).toContain('data-available="true"');expect(html).toContain('drive-nominal-v1');expect(html).toContain('0.231 rad/s');expect(html).toContain('Unavailable (NEVER_ENABLED)');expect(html).toContain('disabled → ready → enabled → fault');
 expect(html).toContain('TRACKING_DEGRADED');expect(html).toContain('controller_in_the_loop');
});
test('the section reads in Vietnamese, Japanese and English, and an incomplete stream says so',()=>{
 const incomplete=withDrive({...block(),complete:false,issues:['PHYSICS_COVERAGE_INCOMPLETE']});
 setLocale('vi');expect(driveHtml(incomplete)).toContain('Drive ảo');expect(driveHtml(incomplete)).toContain('chưa đầy đủ');expect(driveHtml(report())).toContain('Không có dữ liệu drive');
 setLocale('ja');expect(driveHtml(incomplete)).toContain('仮想ドライブ');expect(driveHtml(incomplete)).toContain('不完全');expect(driveHtml(report())).toContain('ドライブデータなし');
 setLocale('en');expect(driveHtml(incomplete)).toContain('incomplete');expect(driveHtml(incomplete)).toContain('PHYSICS_COVERAGE_INCOMPLETE');
});
test('every runtime string is escaped',()=>{
 const evil=block();evil.axes[0]!.axisId='amr-1/<img src=x onerror=alert(1)>';evil.events[0]!.code='<script>x</script>';evil.issues=['"><b>'];
 const html=driveHtml(withDrive(evil));expect(html).not.toContain('<img');expect(html).not.toContain('<script>');expect(html).toContain('&lt;img');
});
test('the state at a cursor is the last transition not after it; before the first record there is none',()=>{
 const b=block();
 expect(stateAt(b,'amr-1/wheel-left',0)).toEqual({state:'disabled',fault:null});expect(stateAt(b,'amr-1/wheel-left',3)).toEqual({state:'enabled',fault:null});expect(stateAt(b,'amr-1/wheel-left',59)).toEqual({state:'enabled',fault:null});
 expect(stateAt(b,'amr-1/wheel-left',60)).toEqual({state:'fault',fault:'OVERSPEED'});expect(stateAt(b,'amr-1/ghost',5)).toBeNull();
 const late:DriveEvidenceBlock={...b,axes:[{...b.axes[0]!,states:[{state:'enabled',fromTick:5}],faults:[]}]};expect(stateAt(late,'amr-1/wheel-left',2)).toBeNull();
});
test('a fault is shown only while the axis is in the fault state: after a reset the axis shows its new state without it',()=>{
 const b=block();b.axes[0]!.states=[{state:'enabled',fromTick:3},{state:'fault',fromTick:60},{state:'disabled',fromTick:80},{state:'enabled',fromTick:90}];
 expect(stateAt(b,'amr-1/wheel-left',70)).toEqual({state:'fault',fault:'OVERSPEED'});
 expect(stateAt(b,'amr-1/wheel-left',85)).toEqual({state:'disabled',fault:null});expect(stateAt(b,'amr-1/wheel-left',95)).toEqual({state:'enabled',fault:null});
});
test('a block with a missing events, issues or axis member is no drive data, never an exception',()=>{
 const {events:_e,...noEvents}=block(),{issues:_i,...noIssues}=block();void _e;void _i;
 for(const bad of [noEvents,noIssues,{...block(),axes:[{axisId:'x'}]},{...block(),axes:[null]}])expect(driveSection({driveEvidence:bad}),JSON.stringify(bad).slice(0,60)).toEqual({available:false,reason:'NO_DRIVE_DATA'});
 expect(()=>driveHtml({...report(),driveEvidence:noEvents} as never)).not.toThrow();
});
test('the inspector rows of an entity are its own axes at the cursor, with the fault and the tracking error; a report without drive has none',()=>{
 const rows=driveRows(withDrive(),'amr-1',70);
 expect(rows.map(r=>r.key)).toEqual(['drive-amr-1/wheel-left','drive-amr-1/wheel-right']);
 expect(rows[0]).toMatchObject({observed:'fault · OVERSPEED',commanded:'RMS 0.231',unit:'rad/s',source:'modeled'});expect(rows[1]!.commanded).toBe('—');
 expect(driveRows(withDrive(),'arm-1',70)).toEqual([]);expect(driveRows(report(),'amr-1',70)).toEqual([]);expect(driveRows(null,'amr-1',0)).toEqual([]);
});
test('the browser report boundary admits the drive block and refuses a malformed or contradictory one',()=>{
 expect(validReportShape(report())).toBe(true);expect(validReportShape(withDrive())).toBe(true);
 const bad=(f:(b:DriveEvidenceBlock)=>unknown)=>{const b=block();return {...withDrive(),driveEvidence:f(b)};};
 for(const r of [bad(b=>({...b,testLevel:'hardware'})),bad(b=>({...b,extra:1})),bad(b=>({...b,ticks:'x'})),bad(b=>({...b,axes:[{...b.axes[0]!,trackingRms:{available:true,value:1,unit:'x'}}]})),bad(b=>({...b,axes:[{...b.axes[0]!,mode:'cst'}]}))])expect(validReportShape(r)).toBe(false);
});
