import {expect,test} from 'vitest';
// @ts-expect-error standalone qualification tooling
import * as reader from '../../scripts/r2b-readback.mjs';
// @ts-expect-error standalone qualification tooling
import {qualifyR2bStructure,SUITES_R2B} from '../../scripts/sim-extension-r2b.mjs';
const suites=()=>SUITES_R2B.map((s:{id:string})=>({...s,exitCode:0,result:{summary:{passed:1,failed:0,skipped:0}}}));
test('per-case artifact dispositions preserve independent success, real assertion failure and missing prerequisite separately',()=>{
 expect(typeof reader.artifactDispositionsFromGroups).toBe('function');
 const groups={physics:[],cell:[],regression:[],web:[],semantic:[],container:['WEB05_MISSING']},d=reader.artifactDispositionsFromGroups('full',groups);
 expect(d.MJ01.status).toBe('tested');expect(d.WEB05.status).toBe('not_run');const s=suites();s.find((x:{id:string})=>x.id==='web-container').exitCode=2;s.find((x:{id:string})=>x.id==='web-container').result=null;s.find((x:{id:string})=>x.id==='web-container').reason='IMAGE_UNBUILT';const q=qualifyR2bStructure({scope:'full',suites:s,lab:true,artifactDispositions:d});expect(q.cases.MJ01.status).toBe('tested');expect(q.cases.WEB05.status).toBe('not_run');expect(q.gates['G-MJ1'].status).toBe('tested');expect(q.gates['G-WEB1'].status).toBe('not_run');expect(q.gates['G-HOST1'].status).toBe('blocked_external');
 const bad=reader.artifactDispositionsFromGroups('full',{...groups,cell:['CELL:nominal-7:CELL_NOMINAL_OUTCOME','CELL_CAMPAIGN_INCOMPLETE']});expect(bad.CELL01.status).toBe('failed');const failed=suites();failed.find((x:{id:string})=>x.id==='web-container').exitCode=1;expect(qualifyR2bStructure({scope:'full',suites:failed,lab:true,artifactDispositions:d}).cases.WEB05.status).toBe('failed');
});
