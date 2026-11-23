// WEB09 (R4 plan V16): frame timing of the production build. The collector runs inside the page, like scripts/measure-twin-ui.mjs: requestAnimationFrame intervals and long tasks.
// The raw intervals are stored, not only a percentile, so the Source reader recomputes p95 itself. `belief` also counts the frames at which the replay canvas drew the belief ghost.
import type {Page} from '@playwright/test';
export type Probe={elapsedMs:number;intervalsMs:number[];longTasksMs:number[];beliefFrames:number;visibilityState:string;userAgent:string;devicePixelRatio:number;webglRenderer:string|null};
export const WEB09_LIMIT_MS=33,WEB09_MIN_DURATION_MS=60000;
export const p95=(values:number[])=>{const o=[...values].sort((a,b)=>a-b);return o[Math.ceil(o.length*.95)-1];};
declare global { interface Window { __web09?: {frames:number[];tasks:number[];last:number|null;active:boolean;start:number;belief:number;observer:PerformanceObserver} } }
export async function startProbe(page:Page,o:{belief?:boolean}={}){
 await page.evaluate(belief=>{
  const s={frames:[] as number[],tasks:[] as number[],last:null as number|null,active:true,start:performance.now(),belief:0,observer:new PerformanceObserver(list=>s.tasks.push(...list.getEntries().map(e=>e.duration)))};
  s.observer.observe({entryTypes:['longtask']});window.__web09=s;
  const raf=(t:number)=>{if(!s.active)return;if(s.last!==null)s.frames.push(t-s.last);s.last=t;
   if(belief){const c=document.querySelector<HTMLElement>('#replay-stage canvas');if(c?.dataset.beliefState==='data'&&/cup-1/.test(c.dataset.beliefs??''))s.belief++;}
   requestAnimationFrame(raf);};
  requestAnimationFrame(raf);
 },!!o.belief);
}
export async function finishProbe(page:Page):Promise<Probe>{
 return page.evaluate(()=>{
  const s=window.__web09!;s.active=false;s.observer.disconnect();
  const gl=document.createElement('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
  return {elapsedMs:performance.now()-s.start,intervalsMs:s.frames,longTasksMs:s.tasks,beliefFrames:s.belief,visibilityState:document.visibilityState,userAgent:navigator.userAgent,devicePixelRatio,webglRenderer:ext&&gl?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):null};
 });
}
