// U05 fix round 1: the run bar's count keeps its meaning (blockers and attention items); notes are listed after them in the same panel and not counted.
// Notes only: the button is still shown, neutral, labelled as notes with their number. The next-step strip ignores notes.
import {expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(vi:string,ja:string,en:string)=>`${vi}|${ja}|${en}`}));
import {runBar,type RunBarState} from '../../src/ui/run-bar';
import {armMeshProblems,nextStrip,problemCounts,problemsPanel,type Problem} from '../../src/ui/problems';
const bar=(o:Partial<RunBarState>={}):RunBarState=>({scenarioTitle:'BV01',runtime:{state:'live',label:'SSE',detail:''},mode:'MOCK',status:'running',simTimeS:1,served:'0',problems:0,primary:null,inspectorOpen:false,...o});
const button=(html:string)=>/<button[^>]*data-action="twin-problems-toggle"[^>]*>[^]*?<\/button>/.exec(html)?.[0]??null;
const problem:Problem={id:'p',severity:'attention',text:'x',codes:['CUP_MISSING']},note:Problem={id:'n',severity:'notice',text:'y',codes:['ARM_MESH_UNAVAILABLE']};

test('problemCounts: notes are not problems',()=>{
 expect(problemCounts([])).toEqual({problems:0,notes:0});expect(problemCounts([note])).toEqual({problems:0,notes:1});
 expect(problemCounts([problem,problem])).toEqual({problems:2,notes:0});expect(problemCounts([problem,note])).toEqual({problems:1,notes:1});
});
test('no rows: no button',()=>{expect(button(runBar(bar()))).toBeNull();});
test('notes only: a neutral button labelled as notes with their number opens the same panel; no problem count',()=>{
 const b=button(runBar(bar({notes:1})))!;
 expect(b).not.toContain('data-testid="problems-count"');expect(b).toContain('twin-problems notes-only');expect(b).toContain('aria-controls="twin-problems"');
 expect(/data-testid="notes-count"[^>]*>([^<]*)</.exec(b)?.[1]).toBe('1 lưu ý|1 件の注意|1 note');
 expect(button(runBar(bar({notes:2})))).toContain('2 lưu ý|2 件の注意|2 notes');
});
test('problems only: the problem count as before, no notes count',()=>{
 const b=button(runBar(bar({problems:2})))!;
 expect(b).toContain('data-testid="problems-count"');expect(b).not.toContain('notes-only');expect(b).not.toContain('notes-count');expect(b).toContain('>2 <');
});
test('problems and notes: the problem count is shown; the notes count is there for assistive technology and tests only',()=>{
 const b=button(runBar(bar({problems:2,notes:1})))!;
 expect(b).toContain('data-testid="problems-count"');expect(b).not.toContain('notes-only');expect(b).toContain('>2 <');
 expect(/<span class="visually-hidden" data-testid="notes-count">([^<]*)</.exec(b)?.[1]).toBe(', 1 lưu ý|1 件の注意|1 note');
});
test('the next-step strip takes its codes from the problem its step answers (item 8), never from a note',()=>{
 const next={title:'t',detail:'d',action:{id:'a',label:'l'}},problem_={...problem,action:{id:'a',label:'l'}};
 expect(nextStrip([note,problem_],next)).toContain('CUP_MISSING');expect(nextStrip([note,problem],next)).not.toContain('<code>');
 expect(nextStrip([note,problem_],next)).toContain('CUP_MISSING');expect(nextStrip([note,problem],next)).not.toContain('ARM_MESH_UNAVAILABLE');
 expect(nextStrip([note],next)).not.toContain('<code>');
});
test('the two arm-mesh notes: the unusable blob named; a revision mismatch naming both revisions, in three languages',()=>{
 const lab='a'.repeat(64),run='b'.repeat(64);
 const [u]=armMeshProblems([{entityId:'arm-1',code:'ARM_MESH_UNAVAILABLE',detail:`ARM_MESH_UNAVAILABLE:${'c'.repeat(64)}`}]);
 expect(u).toMatchObject({severity:'notice',codes:['ARM_MESH_UNAVAILABLE'],entityId:'arm-1'});
 expect(u!.text.split('|')).toHaveLength(3);for(const t of u!.text.split('|'))expect(t).toContain(`ARM_MESH_UNAVAILABLE:${'c'.repeat(12)}`);
 const [m]=armMeshProblems([{entityId:'arm-1',code:'ARM_MODEL_REVISION_MISMATCH',lab,run}]);
 expect(m).toMatchObject({severity:'notice',codes:['ARM_MODEL_REVISION_MISMATCH']});
 expect(m!.text.split('|')).toHaveLength(3);for(const t of m!.text.split('|')){expect(t).toContain('a'.repeat(12));expect(t).toContain('b'.repeat(12));}
});

test('U06: the panel is headed by what it holds: problems, notes, or both (label and heading alike)',()=>{
 const head=(rows:Problem[])=>{const h=problemsPanel(rows,true);return {label:/aria-label="([^"]*)"/.exec(h)?.[1],h3:/<h3>([^<]*)<\/h3>/.exec(h)?.[1]};};
 expect(head([problem])).toEqual({label:'Vấn đề|問題|Problems',h3:'Vấn đề|問題|Problems'});
 expect(head([note])).toEqual({label:'Lưu ý|注意|Notes',h3:'Lưu ý|注意|Notes'});
 expect(head([problem,note])).toEqual({label:'Vấn đề và lưu ý|問題と注意|Problems and notes',h3:'Vấn đề và lưu ý|問題と注意|Problems and notes'});
});
