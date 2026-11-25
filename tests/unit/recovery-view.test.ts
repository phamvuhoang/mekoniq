import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {attemptCounter,perceptionBlockHtml} from '../../src/reports/perception';
beforeEach(()=>setLocale('en'));
// the shape of source's REC01: attempt 0 does not grip, the table recovers (four steps, each recorded pending then done), attempt 1 lifts
const gates={belief:'pass',region:'pass',ik:'pass',sweep:'pass'};
const attempt=(index:number,decidedTick:number,outcome:string)=>({attemptId:`cup-1#${index}`,cupId:'cup-1',index,decidedTick,mode:'belief_estimated',beliefUsed:null,beliefErrorAtCommitM:0.006,gates,ikResidual:[],outcome});
const step=(n:number,action:string,recordedTick:number,done:boolean)=>({stepId:`cup-1#0/s${n}`,attemptId:'cup-1#0',rule:'grip-not-established',action,commandId:`recovery-${n}`,recordedTick,completedTick:done?recordedTick+20:null,result:done?'done':'pending'});
const ACTIONS=['open_gripper','retreat_pick_approach','await_fresh_belief','retry_pick'];
const recovery=ACTIONS.flatMap((a,i)=>[step(i+1,a,1500+i*40,false),step(i+1,a,1500+i*40,true)]);
const report=(extra:Record<string,unknown>={},ev:Record<string,unknown>={})=>({manifest:{perception:{graspMode:'belief_estimated'}},outcome:{tick:3000},attention:[],perceptionEvidence:{schemaVersion:1,beliefs:[],attempts:[attempt(0,1444,'grip_not_established'),attempt(1,1700,'lifted')],recovery,complete:true,issues:[],...ev},...extra});

test('each recovery step is one row: action, result and ticks; a step recorded pending then done shows once, as done',()=>{
 const html=perceptionBlockHtml(report());
 expect(html.match(/<li data-step=/g)).toHaveLength(4);
 for(const a of ACTIONS)expect(html).toContain(`<code>${a}</code>`);
 expect(html.match(/data-result="done"/g)).toHaveLength(4);expect(html).not.toContain('data-result="pending"');
 expect(html).toContain('tick 1500–1520');expect(html).toContain('grip-not-established');
 expect(html.match(/<tr data-attempt=/g)).toHaveLength(2);expect(html).toContain('data-outcome="grip_not_established"');expect(html).toContain('data-outcome="lifted"');
});
test('at a cursor a step that is not finished yet is pending, and one not recorded yet is absent',()=>{
 const mid=perceptionBlockHtml(report(),1510);
 expect(mid.match(/<li data-step=/g)).toHaveLength(1);expect(mid).toContain('data-result="pending"');expect(mid).not.toContain('data-result="done"');expect(mid).toContain('tick 1500');
 const later=perceptionBlockHtml(report(),1550);
 expect(later.match(/<li data-step=/g)).toHaveLength(2);expect(later.match(/data-result="done"/g)).toHaveLength(1);expect(later.match(/data-result="pending"/g)).toHaveLength(1);
 expect(perceptionBlockHtml(report(),1000)).not.toContain('data-step=');
});
test('a failed step is shown as failed',()=>{
 const failed=perceptionBlockHtml(report({},{recovery:[step(1,'open_gripper',1500,false),{...step(1,'open_gripper',1500,true),result:'failed'}]}));
 expect(failed).toContain('data-result="failed"');expect(failed).toContain('Failed');
});
test('what ended the run after recovery is said in words (the arm stop reason or the attention), never only as a code',()=>{
 const exhausted=perceptionBlockHtml(report({attention:[{reason:'TRANSFER_FAILED',tick:2100}],coffee:{armTrace:{stop:{reason:'RECOVERY_EXHAUSTED',events:[{tick:2090}]}}}}));
 expect(exhausted).toContain('data-testid="perception-ended"');expect(exhausted).toContain('RECOVERY_EXHAUSTED');expect(exhausted).toMatch(/used all|exhausted/i);expect(exhausted).toMatch(/person/i);
 const facts=perceptionBlockHtml(report({attention:[{reason:'RECOVERY_FACTS_MISSING',tick:1600}]}));expect(facts).toContain('RECOVERY_FACTS_MISSING');expect(facts).toMatch(/between the pads|not known/i);
 expect(perceptionBlockHtml(report({attention:[{reason:'RECOVERY_FACTS_MISSING',tick:1600}]}),1500)).not.toContain('perception-ended'); // not yet at the cursor
 expect(perceptionBlockHtml(report())).not.toContain('perception-ended');
});
test('the attempt counter is k of 3 (one try and two recoveries) for the cup at the cursor, and absent without attempts',()=>{
 const r=report();
 expect(attemptCounter(r,1443,'cup-1')).toBe('');expect(attemptCounter(r,1444,'cup-1')).toBe(' · attempt 1/3');expect(attemptCounter(r,1699,'cup-1')).toBe(' · attempt 1/3');expect(attemptCounter(r,1700,'cup-1')).toBe(' · attempt 2/3');
 expect(attemptCounter(r,2000,'cup-2')).toBe('');expect(attemptCounter({manifest:{}},2000,'cup-1')).toBe('');expect(attemptCounter(report({},{attempts:[]}),2000,'cup-1')).toBe('');
 setLocale('vi');expect(attemptCounter(r,1700,'cup-1')).toBe(' · lượt 2/3');setLocale('ja');expect(attemptCounter(r,1700,'cup-1')).toContain('2/3');
});
