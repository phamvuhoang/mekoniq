import {afterEach,expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(vi:string)=>vi}));
import {runBar,runtimeWord,type RunBarState} from '../../src/ui/run-bar';
import type {LinkState} from '../../src/runtime/stream';
import {transportBar,type TransportState} from '../../src/ui/transport';
import {inspector,loadUi,saveUi,type TwinUiState} from '../../src/ui/inspector';
// U01 shell: run bar (level 1), transport bar (one for run and replay), details inspector (level 2, closed by default, four named tabs).
const bar=(o:Partial<RunBarState>={}):RunBarState=>({scenarioTitle:'Cà phê sữa đá',runtime:{state:'live',label:'SSE',detail:''},mode:'Mô phỏng · MOCK',status:'Đang chạy',simTimeS:4.2,served:'1',problems:0,primary:null,inspectorOpen:false,...o});
const transport=(o:Partial<TransportState>={}):TransportState=>({mode:'live',playing:false,canPlay:true,canStep:true,canPause:true,paused:false,canCancel:true,speeds:[1,4,16,64],speed:4,simTimeS:4.2,tick:210,...o});
const ui=(o:Partial<TwinUiState>={}):TwinUiState=>({inspectorOpen:false,tab:'objects',watch:false,displayOpen:false,problemsOpen:false,runtimeOpen:false,pickerOpen:false,caveatOpen:false,...o});
const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},m};};
afterEach(()=>vi.unstubAllGlobals());
test('the problem count shows only when there is a problem',()=>{
 expect(runBar(bar())).not.toContain('data-testid="problems-count"');
 expect(/data-testid="problems-count"[^>]*>([^]*?)<\/button>/.exec(runBar(bar({problems:2})))?.[1]).toContain('2');
 expect(/<button[^>]*data-testid="problems-count"[^>]*>/.exec(runBar(bar({problems:2})))?.[0]).toContain('data-action="twin-problems-toggle"');
});
test('the simulation label carries both an icon and text, and opens its explanation',()=>{
 const html=runBar(bar({mode:'Mô phỏng · MOCK'})),badge=/<button[^>]*data-testid="mode-badge"[^>]*>([^]*?)<\/button>/.exec(html)?.[1]??'';
 expect(badge).toContain('<svg');expect(badge).toContain('Mô phỏng · MOCK');
 expect(/<button[^>]*data-testid="mode-badge"[^>]*>/.exec(html)?.[0]).toContain('data-action="twin-caveat-toggle"');
});
test('idle transport disables every button; replay adds the cursor',()=>{
 const idle=transportBar(transport({mode:'idle',canPlay:false,canStep:false,canPause:false,canCancel:false}));
 const buttons=idle.match(/<button[^>]*>/g)??[];expect(buttons.length).toBeGreaterThan(0);
 for(const b of buttons)expect(b).toContain('disabled');
 expect(idle).not.toContain('twin-replay-cursor');
 expect(transportBar(transport({mode:'replay',replay:{fromTick:0,toTick:400,tick:100,playing:false,marks:[]}}))).toMatch(/<input[^>]*id="twin-replay-cursor"[^>]*type="range"|<input[^>]*type="range"[^>]*id="twin-replay-cursor"/);
});
test('replay: the transport carries play/stop, the marked scrubber, the recorded time and exit; no runtime action is enabled',()=>{
 const html=transportBar(transport({mode:'replay',replay:{fromTick:0,toTick:400,tick:100,playing:true,marks:[{tick:50,label:'job.started'}]}}));
 for(const a of ['twin-replay-play','twin-replay-exit'])expect(new RegExp(`<button[^>]*data-action="${a}"[^>]*>`).exec(html)?.[0],a).toMatch(/^<button(?![^>]*disabled)/);
 for(const a of ['twin-play','twin-stop','twin-cancel'])expect(html).not.toContain(`data-action="${a}"`);
 for(const a of ['twin-step','twin-pause'])expect(new RegExp(`<button[^>]*data-action="${a}"[^>]*disabled`).test(html),a).toBe(true);
 expect(html).toContain('Dừng phát');expect(html).toContain('list="twin-replay-marks"');expect(html).toContain('<option value="50" label="job.started">');
 expect(/data-testid="replay-time"[^>]*>([^<]*)</.exec(html)?.[1]).toBe('4.2 s · tick 210 / 400');
});
test('the measured speed shows only when it differs from the chosen speed by more than 10 %',()=>{
 expect(transportBar(transport({speed:4,measuredSpeed:3.9}))).not.toContain('measured-speed');
 expect(/data-testid="measured-speed"[^>]*>([^<]*)</.exec(transportBar(transport({speed:4,measuredSpeed:2.5})))?.[1]).toContain('2,5×');
});
test('a closed inspector is hidden and still holds all six tab panels',()=>{
 const html=inspector(ui(),{objects:'O',engineering:'E',report:'R',setup:'S',control:'C',diagnostics:'D'});
 expect(/<[^>]*data-testid="twin-inspector"[^>]*>/.exec(html)?.[0]).toMatch(/\shidden(\s|>|=)/);
 expect(html.match(/role="tabpanel"/g)).toHaveLength(6);
 for(const t of ['objects','engineering','report','setup','control','diagnostics'])expect(html).toContain(`data-testid="inspector-tab-${t}"`);
 expect(/<[^>]*data-testid="twin-inspector"[^>]*>/.exec(inspector(ui({inspectorOpen:true}),{objects:'O',engineering:'E',report:'R',setup:'S',control:'C',diagnostics:'D'}))?.[0]).not.toMatch(/\shidden(\s|>|=)/);
});
test('loadUi falls back to the defaults on empty or broken storage; saveUi keeps only the inspector state',()=>{
 const s=memory();vi.stubGlobal('localStorage',s);
 expect(loadUi()).toMatchObject({inspectorOpen:false,tab:'objects',watch:false});
 s.m.set('mekoniq-lab-twin-ui','{not json');expect(loadUi()).toMatchObject({inspectorOpen:false,tab:'objects'});
 s.m.set('mekoniq-lab-twin-ui','{"inspectorOpen":"yes","tab":"nowhere"}');expect(loadUi()).toMatchObject({inspectorOpen:false,tab:'objects'});
 saveUi(ui({inspectorOpen:true,tab:'engineering',watch:true}));
 expect(loadUi()).toMatchObject({inspectorOpen:true,tab:'engineering',watch:false});
 vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}});
 expect(loadUi()).toMatchObject({inspectorOpen:false,tab:'objects'});expect(()=>saveUi(ui())).not.toThrow();
});
test('runtime word: one plain word per state of the link, never the telemetry detail',()=>{
 const w=(link:LinkState,f:Parameters<typeof runtimeWord>[1],o:{paired?:boolean;replay?:boolean;playing?:boolean}={})=>runtimeWord(link,f,o.paired??true,!!o.replay,!!o.playing);
 expect(w('closed','unknown',{paired:false})).toEqual({state:'none',label:'Chưa ghép nối'});
 expect(w('live','live',{paired:false})).toEqual({state:'none',label:'Chưa ghép nối'});
 expect(w('closed','unknown',{paired:false,replay:true})).toEqual({state:'recorded',label:'Bản ghi'});
 expect(w('live','live',{replay:true,playing:true})).toEqual({state:'recorded',label:'Bản ghi'});
 expect(w('connecting','disconnected')).toEqual({state:'connecting',label:'Đang kết nối'});
 // not auto-running: no sample is due (the browser pumps the clock; the mock arm has no encoder), so the word follows the link alone
 for(const f of ['live','frozen_sim','stale','unknown'] as const)expect(w('live',f),f).toEqual({state:'live',label:'Trực tiếp'});
 // auto-running: an old sample means the link is slow; a sample of unknown quality does not
 for(const f of ['live','frozen_sim','unknown'] as const)expect(w('live',f,{playing:true}),f).toEqual({state:'live',label:'Trực tiếp'});
 expect(w('live','stale',{playing:true})).toEqual({state:'slow',label:'Chậm'});
 for(const l of ['polling','reconnecting'] as const)for(const playing of [false,true])expect(w(l,'disconnected',{playing}),l).toEqual({state:'slow',label:'Chậm'});
 for(const l of ['session_lost','run_lost','runtime_lost'] as const)for(const playing of [false,true])expect(w(l,'disconnected',{playing}),l).toEqual({state:'lost',label:'Mất kết nối'});
 for(const playing of [false,true])expect(w('live','disconnected',{playing})).toEqual({state:'lost',label:'Mất kết nối'});
 expect(w('closed','unknown')).toEqual({state:'live',label:'Sẵn sàng'});// paired, no run (yet)
});
test('the runtime chip shows the word and its state; a replay drops the primary action and tags the status as recorded',()=>{
 const html=runBar(bar({runtime:{state:'slow',label:'Chậm',detail:''},primary:{action:'twin-play',label:'Chạy tiếp',disabled:false}}));
 const chip=/<button[^>]*data-testid="runtime-chip"[^>]*>([^]*?)<\/button>/.exec(html);
 expect(chip?.[0]).toContain('data-state="slow"');expect(chip?.[1]).toContain('Chậm');expect(chip?.[1]).not.toContain('twin-telemetry');
 expect(html).not.toContain('recorded-tag');expect(html).toContain('data-testid="primary-action"');
 const replay=runBar(bar({runtime:{state:'recorded',label:'Bản ghi',detail:''},primary:null}));
 expect(replay).toContain('data-testid="recorded-tag"');expect(replay).not.toContain('primary-action');
 expect(replay.indexOf('data-testid="run-status"')).toBeLessThan(replay.indexOf('recorded-tag'));
});
test('replay: the run speed is not on the transport',()=>{
 expect(transportBar(transport())).toContain('id="twin-run-speed"');
 expect(transportBar(transport({mode:'replay',replay:{fromTick:0,toTick:400,tick:100,playing:false,marks:[]}}))).not.toContain('twin-run-speed');
});
test('I5: the runtime word says what the page knows: not tried yet, trying, failed, another commit, ready',()=>{
 const w=(attempt:'none'|'pending'|'failed'|'ok',o:{paired?:boolean;pin?:boolean;link?:LinkState}={})=>runtimeWord(o.link??'closed','unknown',o.paired??true,false,false,{attempt,pinMismatch:!!o.pin});
 // a session remembered for the runtime, nothing attempted in this page load: neutral, never "connecting"
 expect(w('none')).toEqual({state:'idle',label:'Chưa kết nối'});
 expect(w('pending')).toEqual({state:'connecting',label:'Đang kết nối'});
 // the attempt failed: an error word, never green, paired or not
 expect(w('failed')).toEqual({state:'failed',label:'Không kết nối được'});
 expect(w('failed',{paired:false})).toEqual({state:'failed',label:'Không kết nối được'});
 // connected to a runtime of another source commit than the pin: a warning word (runs stay blocked)
 expect(w('ok',{pin:true})).toEqual({state:'mismatch',label:'Khác phiên bản'});
 expect(w('ok')).toEqual({state:'live',label:'Sẵn sàng'});
 // a link that stopped answering stays an error
 expect(w('ok',{link:'runtime_lost'})).toEqual({state:'lost',label:'Mất kết nối'});
 for(const s of ['idle','failed','mismatch'])expect(runBar(bar({runtime:{state:s as never,label:'x',detail:''}}))).toContain(`data-state="${s}"`);
});
test('I4: Stop auto-run, Pause simulation and Cancel run carry three different icons; every transport button has a title equal to its label',()=>{
 const svg=(html:string,action:string)=>new RegExp(`data-action="${action}"[^>]*>(<svg[^]*?</svg>)`).exec(html)?.[1];
 const html=transportBar(transport({playing:true,canPause:true}));
 const icons=['twin-stop','twin-pause','twin-cancel'].map(a=>svg(html,a));
 expect(icons.every(Boolean)).toBe(true);expect(new Set(icons).size).toBe(3);
 for(const m of html.matchAll(/<button[^>]*>/g))expect(m[0]).toMatch(/title="[^"]+"/);
 expect(html).toMatch(/data-action="twin-stop"[^>]*title="Tạm dừng tự chạy"/);
});
