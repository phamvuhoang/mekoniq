// WEB09 (R4 plan V16): frame timing of the production build, measured the way scripts/measure-twin-ui.mjs and the R2b cell capture measure it: requestAnimationFrame intervals, long tasks and,
// on the replay canvas, the renderer's own `twin-render` events (data-measure-render, a draw per event: instant, duration, draw calls, world tick, whether the belief ghost was in the scene).
// Everything raw is stored with the browser clock (performance.timeOrigin + ms), so the Source reader recomputes percentiles, window and progress and ties the window to the Playwright attempt.
import type {Page} from '@playwright/test';
export type RenderEvent={atMs:number;durationMs:number;count:number;drawCalls:number;worldTick:number|null;belief:boolean};
export type Seek={atMs:number;tick:number};
export type Probe={timeOriginEpochMs:number;startMs:number;endMs:number;elapsedMs:number;firstFrameMs:number|null;lastFrameMs:number|null;seeks:Seek[];intervalsMs:number[];longTasksMs:number[];renders:RenderEvent[];visibilityState:string;userAgent:string;devicePixelRatio:number;webglRenderer:string|null};
export const WEB09_LIMIT_MS=33,WEB09_MIN_DURATION_MS=60000;
export const p95=(values:number[])=>{const o=[...values].sort((a,b)=>a-b);return o[Math.ceil(o.length*.95)-1];};
interface State {first:number|null;seeks:Seek[];frames:number[];tasks:number[];renders:RenderEvent[];last:number|null;active:boolean;start:number;observer:PerformanceObserver;canvas:HTMLElement|null;listener:((e:Event)=>void)|null}
declare global { interface Window { __web09?: State } }
export async function startProbe(page:Page,o:{replay?:boolean}={}){
 await page.evaluate(replay=>{
  const s:State={first:null,seeks:[],frames:[],tasks:[],renders:[],last:null,active:true,start:performance.now(),observer:new PerformanceObserver(list=>s.tasks.push(...list.getEntries().map(e=>e.duration))),canvas:null,listener:null};
  s.observer.observe({entryTypes:['longtask']});window.__web09=s;
  if(replay){
   const canvas=document.querySelector<HTMLElement>('#replay-stage canvas');if(!canvas)throw Error('WEB09_REPLAY_CANVAS_MISSING');
   canvas.dataset.measureRender='1';s.canvas=canvas;
   s.listener=e=>{const d=(e as CustomEvent).detail;s.renders.push({atMs:d.atMs,durationMs:d.durationMs,count:d.count,drawCalls:d.drawCalls,worldTick:d.worldTick,belief:canvas.dataset.beliefState==='data'&&/cup-1/.test(canvas.dataset.beliefs??'')});};
   canvas.addEventListener('twin-render',s.listener);
  }
  const raf=(t:number)=>{if(!s.active)return;if(s.first===null)s.first=t;if(s.last!==null)s.frames.push(t-s.last);s.last=t;requestAnimationFrame(raf);};
  requestAnimationFrame(raf);
 },!!o.replay);
}
export async function finishProbe(page:Page):Promise<Probe>{
 return page.evaluate(()=>{
  const s=window.__web09!;s.active=false;s.observer.disconnect();if(s.canvas&&s.listener){s.canvas.removeEventListener('twin-render',s.listener);delete s.canvas.dataset.measureRender;}
  const end=performance.now(),gl=document.createElement('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
  return {timeOriginEpochMs:performance.timeOrigin,startMs:s.start,endMs:end,elapsedMs:end-s.start,firstFrameMs:s.first,lastFrameMs:s.last,seeks:s.seeks,intervalsMs:s.frames,longTasksMs:s.tasks,renders:s.renders,visibilityState:document.visibilityState,userAgent:navigator.userAgent,devicePixelRatio,webglRenderer:ext&&gl?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):null};
 });
}
/** A cursor seek of the replay, stamped in the browser clock: a restart of playback is only ever an event written here, never inferred from a tick that went back. */
export async function seek(page:Page,tick:number){
 await page.locator('#replay-cursor').evaluate((el:HTMLInputElement,t)=>{window.__web09?.seeks.push({atMs:performance.now(),tick:t});el.value=String(t);el.dispatchEvent(new Event('input',{bubbles:true}));},tick);
}
