// The run bar's English strings (tr returns the English text): singular and plural (item 7), the simulation label without the raw mode token (I3).
import {expect,test,vi} from 'vitest';
vi.mock('../../src/i18n',()=>({tr:(_vi:string,_ja:string,en:string)=>en}));
import {runBar,simLabel,loopbackBlockedText,type RunBarState} from '../../src/ui/run-bar';
const bar=(o:Partial<RunBarState>={}):RunBarState=>({scenarioTitle:'Iced milk coffee',runtime:{state:'live',label:'Live',detail:''},mode:'Simulation · MOCK',status:'Running',simTimeS:4.2,served:'1',problems:0,primary:null,inspectorOpen:false,...o});
test('item 7: one problem, two problems; one note, two notes',()=>{
 expect(runBar(bar({problems:1}))).toMatch(/1 <span class="twin-narrow-hide">problem<\/span>/);
 expect(runBar(bar({problems:2}))).toMatch(/2 <span class="twin-narrow-hide">problems<\/span>/);
 expect(runBar(bar({notes:1}))).toContain('1 note<');expect(runBar(bar({notes:3}))).toContain('3 notes<');
});
test('I3: a simulation run reads "Simulation · not calibrated"; the raw token stays on the element; mock and before-run are unchanged',()=>{
 expect(simLabel('simulation',false)).toBe('Simulation · not calibrated');
 expect(simLabel('mock',false)).toBe('Simulation · MOCK');
 expect(simLabel(null,false)).toBe('Simulation · not run');
 expect(runBar(bar({mode:simLabel('simulation',false),modeToken:'simulation'}))).toMatch(/data-testid="mode-badge"[^>]*data-mode="simulation"/);
});
test('I5: LOOPBACK_BLOCKED names the causes and claims none; it never sends the user to the address the page is already on',()=>{
 const here=loopbackBlockedText('http://127.0.0.1:4175'),web=loopbackBlockedText('https://mekoniq-lab.vercel.app');
 for(const t of [here,web]){expect(t).not.toMatch(/^The browser blocked/);expect(t).toContain('runtime is running');expect(t).toContain('--allow-origin');}
 expect(here).not.toContain('open http://127.0.0.1:4175');expect(web).toContain('open http://127.0.0.1:4175');
});
