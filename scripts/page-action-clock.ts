import type {Page} from '@playwright/test';
type Row=Record<string,unknown>;
export interface ActionCall {actionId:unknown;name:string;callAt:number}
export interface ResourceStart {name:string;startTime:number;responseEnd:number}
export interface PageActionTimes {actionId:string;startEpochMs:number;endEpochMs:number}
const ACTIONS=/\/lab\/v2\/runs\/[^/]+\/actions$/;
/** Runs in the page before any app script. Resource timing has no request body, so a thin fetch wrapper only names the action (actionId, URL, page-clock call time);
 * the PerformanceObserver (type 'resource', buffered) supplies the request start and end on the very same performance.now() timeline as the Pause click. */
function installInPage(source:string){
 const w=window as unknown as {__actionClock?:{calls:unknown[];entries:unknown[]}},re=new RegExp(source);if(w.__actionClock)return;
 const state=w.__actionClock={calls:[] as unknown[],entries:[] as unknown[]};performance.setResourceTimingBufferSize(100000);
 new PerformanceObserver(list=>{for(const e of list.getEntries() as PerformanceResourceTiming[])if(e.initiatorType==='fetch'&&re.test(new URL(e.name).pathname))state.entries.push({name:e.name,startTime:e.startTime,responseEnd:e.responseEnd});}).observe({type:'resource',buffered:true});
 const original=window.fetch;
 window.fetch=function(this:unknown,input:RequestInfo|URL,init?:RequestInit){
  try{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);
   if(re.test(url.pathname)&&(init?.method??'GET')==='POST'&&typeof init?.body==='string')state.calls.push({actionId:JSON.parse(init.body)?.actionId,name:url.href,callAt:performance.now()});}catch{/* an unreadable body is reported by correlatePageActions via the missing call */}
  return original.apply(this,arguments as unknown as [RequestInfo|URL,RequestInit?]);
 } as typeof fetch;
}
export const installPageActionClock=(page:Page)=>page.addInitScript(installInPage,ACTIONS.source);
/** Pure: pair every action call with its own resource entry (same URL, first unclaimed entry that starts at or after the call, in call order).
 * Returns times on the page timeline; nothing is clamped, so a request that started before the click stays visible to the reader. */
export function correlatePageActions(calls:ActionCall[],entries:ResourceStart[],timeOrigin:number):PageActionTimes[]{
 if(!Number.isFinite(timeOrigin)||timeOrigin<=0)throw Error('PAGE_ACTION_CLOCK_ORIGIN_INVALID');
 const seen=new Set<string>(),claimed=new Set<ResourceStart>(),out:PageActionTimes[]=[];
 for(const call of [...calls].sort((a,b)=>a.callAt-b.callAt)){
  if(typeof call.actionId!=='string'||!call.actionId)throw Error('PAGE_ACTION_ID_MISSING');
  if(seen.has(call.actionId))throw Error('PAGE_ACTION_ID_DUPLICATE:'+call.actionId);seen.add(call.actionId);
  const entry=[...entries].sort((a,b)=>a.startTime-b.startTime).find(e=>!claimed.has(e)&&e.name===call.name&&e.startTime>=call.callAt);
  if(!entry||!Number.isFinite(entry.startTime)||!Number.isFinite(entry.responseEnd)||entry.responseEnd<entry.startTime)throw Error('PAGE_ACTION_REQUEST_MISSING:'+call.actionId);
  claimed.add(entry);out.push({actionId:call.actionId,startEpochMs:timeOrigin+entry.startTime,endEpochMs:timeOrigin+entry.responseEnd});
 }
 return out;
}
/** Rewrite the ordering fields of every observed action (and its response row) to the page clock after the HTTP observer drained.
 * Playwright's own start/end stay beside them as playwright* and responseMs stays a Playwright duration. Any action without a page match throws. */
export function applyPageActionTimes(data:{actions:Row[];responses:Row[]},times:PageActionTimes[]){
 const by=new Map(times.map(t=>[t.actionId,t]));
 for(const row of [...data.actions,...data.responses.filter(r=>typeof r.actionId==='string')]){
  const t=by.get(row.actionId as string);if(!t)throw Error('PAGE_ACTION_UNMATCHED:'+String(row.actionId));
  Object.assign(row,{playwrightRequestStartEpochMs:row.requestStartEpochMs,playwrightResponseEndEpochMs:row.responseEndEpochMs,requestStartEpochMs:t.startEpochMs,responseEndEpochMs:t.endEpochMs});
 }
}
export async function applyPageActionClock(page:Page,data:{actions:Row[];responses:Row[]}){
 const state=await page.evaluate(()=>({origin:performance.timeOrigin,state:(window as unknown as {__actionClock?:{calls:unknown[];entries:unknown[]}}).__actionClock}));
 if(!state.state)throw Error('PAGE_ACTION_CLOCK_NOT_INSTALLED');
 applyPageActionTimes(data,correlatePageActions(state.state.calls as ActionCall[],state.state.entries as ResourceStart[],state.origin));
}
