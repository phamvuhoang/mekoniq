import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {faultTimeline} from '../../src/ui/fault-timeline';
import type {FaultCatalog} from '../../src/scenarios/drive-faults';

const catalog:FaultCatalog=[
 {id:'encoder-dropout',layer:'feedback',target:'axis',appliedBy:'worker',params:{durationMs:{min:20,max:5000,required:true}}},
 {id:'command-delay',layer:'command',target:'axis',appliedBy:'worker',params:{durationMs:{min:20,max:60000,required:true},delayMs:{min:20,max:200,multipleOf:2,required:true}}},
 {id:'drive-trip',layer:'drive',target:'axis',appliedBy:'worker',params:{durationMs:{min:20,max:20,required:true}}},
 {id:'lidar-noise',layer:'sensor',target:'lidar',appliedBy:'runtime',params:{durationMs:{min:20,max:60000,required:true}}}];
const e=(faultId:string,targetId:string,at:number,durationMs:number,params:Record<string,number>={})=>({id:`${faultId}-${at}`,faultId,targetId,trigger:{kind:'elapsed_sim_ms' as const,value:at},durationMs,params});
beforeEach(()=>setLocale('en'));

test('entries sit in the lane of their layer, in the order command, drive, feedback, sensor, and every lane is present even when empty',()=>{
 const html=faultTimeline([e('encoder-dropout','amr-1/wheel-right',2000,300),e('command-delay','amr-1/wheel-left',1000,5000,{delayMs:100}),e('drive-trip','amr-1/wheel-left',8000,20)],catalog,20000);
 const lanes=[...html.matchAll(/data-lane="(\w+)"/g)].map(m=>m[1]);expect(lanes).toEqual(['command','drive','feedback','sensor']);
 const inLane=(lane:string)=>(html.match(new RegExp(`<g data-lane="${lane}"[\\s\\S]*?</g>`))??[''])[0];
 expect(inLane('command')).toContain('command-delay');expect(inLane('drive')).toContain('drive-trip');expect(inLane('feedback')).toContain('encoder-dropout');expect(inLane('sensor')).not.toContain('<rect');
});
test('an entry is placed by its start and width on the horizon, clamped to the plot, and a one-tick trip is still visible',()=>{
 const html=faultTimeline([e('encoder-dropout','amr-1/wheel-right',5000,5000),e('drive-trip','amr-1/wheel-left',19990,20),e('encoder-dropout','amr-1/wheel-left',30000,300)],catalog,20000);
 const rects=[...html.matchAll(/<rect data-entry="([^"]+)" x="([\d.]+)" width="([\d.]+)"/g)].map(m=>({id:m[1]!,x:Number(m[2]),w:Number(m[3])}));
 const by=Object.fromEntries(rects.map(r=>[r.id,r]));
 expect(by['encoder-dropout-5000']!.x).toBeGreaterThan(0);expect(by['encoder-dropout-5000']!.w).toBeGreaterThan(by['drive-trip-19990']!.w);
 expect(by['drive-trip-19990']!.w).toBeGreaterThanOrEqual(3);expect(by['drive-trip-19990']!.x+by['drive-trip-19990']!.w).toBeLessThanOrEqual(100.0001);
 expect(html).toContain('data-beyond="true"');   // an entry past the horizon is listed and flagged, not drawn off the plot
});
test('the text list is the accessible equivalent: one item per entry with fault, target, start, duration and parameters',()=>{
 const html=faultTimeline([e('command-delay','amr-1/wheel-left',1000,5000,{delayMs:100})],catalog,20000);
 const list=(html.match(/<ol class="fault-timeline-list"[\s\S]*?<\/ol>/)??[''])[0];
 expect(list).toContain('command-delay');expect(list).toContain('amr-1/wheel-left');expect(list).toContain('1000');expect(list).toContain('5000');expect(list).toContain('delayMs 100');
 expect(html).toContain('role="img"');expect(html).toMatch(/aria-label="[^"]*1 [^"]*"/);
 expect(faultTimeline([],catalog,20000)).toContain('data-empty="true"');
});
test('a fault the runtime does not offer is listed as unknown, never silently dropped, and runtime strings are escaped',()=>{
 const html=faultTimeline([e('mystery','<b>x</b>',100,100)],catalog,20000);
 expect(html).toContain('data-unknown="true"');expect(html).not.toContain('<b>x</b>');expect(html).toContain('&lt;b&gt;');
});
test('lane names read in three languages',()=>{
 setLocale('vi');expect(faultTimeline([],catalog,1000)).toContain('Kênh lệnh');setLocale('ja');expect(faultTimeline([],catalog,1000)).toContain('指令チャネル');setLocale('en');expect(faultTimeline([],catalog,1000)).toContain('Command channel');
});
