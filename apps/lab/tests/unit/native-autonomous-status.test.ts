import {expect,test,vi,afterEach} from 'vitest';
import {coffeeReplay} from '../support/coffee-replay';
import type {RunView,TwinRuntime} from '../../src/scenarios/controls';
import type {StreamHandlers} from '../../src/runtime/stream';
let handlers:StreamHandlers<RunView,unknown>;
vi.mock('../../src/runtime/stream',()=>({openRunStreams:(_id:string,_cursor:string,h:typeof handlers)=>{handlers=h;return {close(){},state:'live'};}}));
vi.mock('../../src/i18n',()=>({tr:(_v:string,_j:string,e:string)=>e}));
afterEach(()=>vi.unstubAllGlobals());
test.each(['heartbeat','polling'])('autonomous native hold becomes visible via %s without business events',async channel=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('innerWidth',600);vi.stubGlobal('document',{getElementById:()=>null,activeElement:null});
 const {TwinWorkspace}=await import('../../src/ui/workspace'),{view}=coffeeReplay();view.run.mode='simulation';view.run.status='running';view.run.runRevision=1;
 const held=structuredClone(view);held.run.runRevision=2;held.run.status='needs_attention';held.attention=[{reason:'ARM_OWNER_LOST',tick:held.tick}];const get=vi.fn(async()=>held),render=vi.fn();
 const w=new TwinWorkspace(render,{paired:true,get,report:async()=>coffeeReplay().report} as unknown as TwinRuntime),h=w as unknown as {view:RunView;openStreams(v:RunView):void;apply(v:RunView):Promise<void>};Object.assign(w,{view});h.openStreams(view);
 try{if(channel==='heartbeat')handlers.onHeartbeat?.({monotonicNs:'1',tick:held.tick,paused:false,runRevision:2});else handlers.onSnapshot?.(held);await vi.waitFor(()=>expect(h.view.run.status).toBe('needs_attention'));expect(w.html()).toContain('ARM_OWNER_LOST');expect(w.html()).toContain('twin-reconcile');const n=get.mock.calls.length;handlers.onHeartbeat?.({monotonicNs:'2',tick:held.tick,paused:false,runRevision:2});await Promise.resolve();expect(get.mock.calls).toHaveLength(n);}finally{w.leave();}
});
