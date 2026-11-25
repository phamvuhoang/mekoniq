import {expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(vi:string)=>vi}));
import {KEYMAP,keyAction,shortcutsDialog} from '../../src/ui/keys';
import {replayMarks} from '../../src/ui/report-panel';
import type {RunReport} from '../../src/scenarios/controls';
// U03: keys of the twin page and the replay marks of the transport bar's scrubber.
const key=(k:string,o:{ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;tagName?:string;type?:string;isContentEditable?:boolean;repeat?:boolean}={})=>({key:k,ctrlKey:!!o.ctrlKey,metaKey:!!o.metaKey,altKey:!!o.altKey,repeat:!!o.repeat,target:{tagName:o.tagName??'DIV',type:o.type,isContentEditable:!!o.isContentEditable}});
test('every key of the map names its action outside fields',()=>{
 expect(KEYMAP).toEqual({' ':'twin-toggle-play',ArrowRight:'twin-step',f:'twin-camera-fit',i:'twin-inspector-toggle',w:'twin-watch','?':'twin-help',Escape:'twin-escape'});
 for(const [k,a] of Object.entries(KEYMAP))expect(keyAction(key(k),false),k).toBe(a);
 expect(keyAction(key('W'),false)).toBe('twin-watch');// Shift or Caps Lock
 expect(keyAction(key('x'),false)).toBeNull();
 expect(keyAction({...key('w'),target:null},false)).toBe('twin-watch');
});
test('typing, a modifier or an open dialog (except Escape) takes no action',()=>{
 for(const tagName of ['INPUT','SELECT','TEXTAREA','input'])for(const k of Object.keys(KEYMAP))expect(keyAction(key(k,{tagName}),false),`${tagName} ${k}`).toBeNull();
 expect(keyAction(key('w',{isContentEditable:true}),false)).toBeNull();
 for(const m of ['ctrlKey','metaKey','altKey'] as const)expect(keyAction(key('w',{[m]:true}),false),m).toBeNull();
 for(const k of Object.keys(KEYMAP))expect(keyAction(key(k),true),k).toBe(k==='Escape'?'twin-escape':null);
});
test('a range input (the replay scrubber) is not a typing field, but its arrows keep moving it; a held Space toggles play once',()=>{
 for(const k of [' ','f','i','w','?','Escape'])expect(keyAction(key(k,{tagName:'INPUT',type:'range'}),false),k).toBe(KEYMAP[k]);
 expect(keyAction(key('ArrowRight',{tagName:'INPUT',type:'range'}),false)).toBeNull();
 for(const type of ['text','password','number',undefined])expect(keyAction(key(' ',{tagName:'INPUT',type}),false),String(type)).toBeNull();
 expect(keyAction(key(' ',{repeat:true}),false)).toBeNull();
 expect(keyAction(key('ArrowRight',{repeat:true}),false)).toBe('twin-step');
});
test('the shortcuts dialog lists exactly the keys of the map, and is closed unless open',()=>{
 const html=shortcutsDialog(true);
 expect(html).toContain('data-testid="shortcuts"');
 expect(html.match(/<dt>/g)).toHaveLength(Object.keys(KEYMAP).length);
 for(const k of ['Space','→','F','I','W','?','Esc'])expect(html).toContain(`<kbd>${k}</kbd>`);
 expect(/<dialog[^>]*>/.exec(html)?.[0]).toMatch(/\sopen(\s|>)/);
 expect(/<dialog[^>]*>/.exec(shortcutsDialog(false))?.[0]??'').not.toMatch(/\sopen(\s|>)/);
});
test('replay marks: one per business-event tick, at most 200 evenly spaced, first and last kept',()=>{
 const at=(tick:number)=>new Date(Date.UTC(2026,0,1)+tick*20).toISOString();
 const report=(ticks:number[])=>({manifest:{clock:{tickMs:20}},businessEvents:ticks.flatMap((t,i)=>[{sequence:String(2*i),at:at(t),type:'job.started',kind:'job',id:`j${i}`},{sequence:String(2*i+1),at:at(t),type:'cup.moved',kind:'cup',id:`c${i}`}])}) as unknown as RunReport;
 const few=replayMarks(report([0,10,10,30]));
 expect(few.map(m=>m.tick)).toEqual([0,10,30]);expect(few[0]!.label).toContain('job.started');
 const ticks=Array.from({length:300},(_,i)=>i*5),marks=replayMarks(report(ticks));
 expect(marks).toHaveLength(200);
 expect(marks[0]!.tick).toBe(0);expect(marks.at(-1)!.tick).toBe(1495);
 for(let i=1;i<marks.length;i++)expect(marks[i]!.tick).toBeGreaterThan(marks[i-1]!.tick);
 expect(replayMarks(report(ticks),10)).toHaveLength(10);
 expect(replayMarks(report(ticks),1)).toEqual([marks[0]]);
});
test('item 1: on an inspector tab, Left and Right move between the tabs and never step the run',()=>{
 const tab=(k:string)=>({...key(k,{tagName:'BUTTON'}),target:{tagName:'BUTTON',role:'tab'}});
 expect(keyAction(tab('ArrowRight'),false)).toBe('twin-tab-next');expect(keyAction(tab('ArrowLeft'),false)).toBe('twin-tab-previous');
 expect(keyAction(key('ArrowRight',{tagName:'BUTTON'}),false)).toBe('twin-step');
});
