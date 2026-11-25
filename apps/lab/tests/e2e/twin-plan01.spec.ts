import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import type {RunReport,RunView} from '../../src/scenarios/controls';
const token=process.env.LAB_TEST_PAIRING_TOKEN;
const normalize=(report:RunReport)=>{
 const ids=new Map<string,string>(),norm=(value:unknown):unknown=>typeof value==='string'?value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,id=>{const key=id.toLowerCase();if(!ids.has(key))ids.set(key,`uuid#${ids.size+1}`);return ids.get(key)!;}):Array.isArray(value)?value.map(norm):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,norm(v)])):value;
 return norm({served:report.outcome.served,status:report.outcome.status,events:report.businessEvents,effects:report.effects,metrics:report.metrics});
};
// Rendering is an explicit read-only consumer. The runner receives the same fixed steps while view cadence and renderer suspension vary.
test('SYS01: normalized journal/effects are identical at 15/60 FPS and while the browser renderer is debugger-paused',async({page,context})=>{
 test.skip(!token,'Requires the real exported runtime launcher.');test.setTimeout(180000);
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();await page.locator('#twin-pair-token').fill(token!);
 const paired=page.waitForResponse(r=>r.url().endsWith('/lab/v2/sessions')&&r.request().method()==='POST');await page.getByRole('button',{name:'Pair runtime',exact:true}).click();const {csrfToken}=await (await paired).json();
 const health=await (await context.request.get('/lab/v2/health')).json(),fixture=await (await context.request.get('/fixtures/twins/restaurant-v2.json')).json();
 const headers={'X-CSRF-Token':csrfToken,Origin:'http://127.0.0.1:4175'},reports:RunReport[]=[],measurements:unknown[]=[];
 const cdp=await context.newCDPSession(page);await cdp.send('Debugger.enable');
 for(const variant of [{fps:15,speed:4,paused:false},{fps:60,speed:64,paused:false},{fps:60,speed:64,paused:true}]){
  const created=await context.request.post('/lab/v2/runs',{headers,data:{project:fixture.project,scenarioId:'FD01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-amr',access:'simulated',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}}});expect(created.ok()).toBe(true);let view=await created.json() as RunView;
  await page.evaluate(async({view,fps})=>{
   const scenePath='/src/twin/scene.ts',layersPath='/src/twin/overlays.ts',catalogPath='/src/scenarios/catalog.ts';
   const {renderTwin}=await import(scenePath),{defaultLayers}=await import(layersPath),{presetById}=await import(catalogPath);
   document.body.innerHTML='<div id="sys01-stage"></div>';const state={view,drawTimes:[] as number[],nextDue:0,startedMs:Date.now(),active:true},frame={preset:presetById('delivery'),report:null};
   const draw=(now:number)=>{if(!state.active)return;if(now+0.5>=state.nextDue){const stage=document.getElementById('sys01-stage')!;stage.innerHTML=renderTwin({...frame,view:state.view},{view:'2d',layers:defaultLayers(),selected:null});if(!stage.querySelector('svg.twin-plan [data-entity="amr-1"]'))throw new Error('SYS01_EMPTY_RENDER');state.drawTimes.push(Date.now());state.nextDue+=1000/fps;if(state.nextDue<=now)state.nextDue=now+1000/fps;}requestAnimationFrame(draw);};requestAnimationFrame(draw);(window as unknown as {sys01:typeof state}).sys01=state;
  },{view,fps:variant.fps});
  await page.waitForTimeout(1500);expect(pageErrors).toEqual([]);
  let pauseStartMs:number|null=null,resumeStartMs:number|null=null;
  if(variant.paused){const acknowledged=new Promise<void>(resolve=>cdp.once('Debugger.paused',()=>resolve()));await cdp.send('Debugger.pause');await acknowledged;pauseStartMs=Date.now()+1;} // first whole millisecond after the actual debugger-paused event
  const action=async(kind:string,payload:Record<string,unknown>={})=>{const r=await context.request.post(`/lab/v2/runs/${view.run.id}/actions`,{headers,data:{actionId:crypto.randomUUID(),expectedRevision:view.run.runRevision,kind,payload}});expect(r.ok()).toBe(true);view=await r.json() as RunView;};
  const start=Date.now();await action('start');let steps=0;
  while(view.run.status!=='completed'&&steps++<400){await action('step',{ticks:25});if(!variant.paused)await page.evaluate(view=>{(window as unknown as {sys01:{view:RunView}}).sys01.view=view;},view);await new Promise(r=>setTimeout(r,500/variant.speed));}
  expect(view.run.status).toBe('completed');expect(view.served).toBe('1');
  const runEndedMs=Date.now();
  if(variant.paused){resumeStartMs=Date.now();await cdp.send('Debugger.resume');}
  await page.waitForTimeout(1000);expect(pageErrors).toEqual([]);
  const render=await page.evaluate(()=>{const state=(window as unknown as {sys01:{active:boolean;drawTimes:number[];startedMs:number}}).sys01;state.active=false;return {drawTimes:state.drawTimes,startedMs:state.startedMs,endedMs:Date.now()};});
  const segments=variant.paused?[{startMs:render.startedMs,endMs:pauseStartMs!},{startMs:resumeStartMs!,endMs:render.endedMs}]:[{startMs:render.startedMs,endMs:render.endedMs}];
  const cadence=segments.map(segment=>{
   const timestamps=render.drawTimes.filter(t=>t>=segment.startMs&&t<segment.endMs),intervals=timestamps.slice(1).map((t,i)=>t-timestamps[i]!).sort((a,b)=>a-b);
   const measuredFps=(timestamps.length-1)*1000/(timestamps.at(-1)!-timestamps[0]!);
   expect(timestamps.length).toBeGreaterThanOrEqual(variant.fps*0.7*(segment.endMs-segment.startMs)/1000);
   expect(Number.isFinite(measuredFps)).toBe(true);expect(measuredFps).toBeGreaterThanOrEqual(variant.fps*0.8);expect(measuredFps).toBeLessThanOrEqual(variant.fps*1.1);
   const medianIntervalMs=intervals[Math.floor(intervals.length/2)]!;expect(medianIntervalMs).toBeGreaterThanOrEqual(1000/variant.fps*0.8);expect(medianIntervalMs).toBeLessThanOrEqual(1000/variant.fps*1.25);
   return {...segment,draws:timestamps.length,measuredFps,medianIntervalMs};
  });
  const drawsDuringRun=render.drawTimes.filter(t=>t>=start&&t<runEndedMs).length;
  const pausedDraws=variant.paused?render.drawTimes.filter(t=>t>=pauseStartMs!&&t<resumeStartMs!):[];
  if(variant.paused){expect(resumeStartMs!-pauseStartMs!).toBeGreaterThan(500);expect(pausedDraws).toEqual([]);}else expect(drawsDuringRun).toBeGreaterThan(10);
  reports.push(await (await context.request.get(`/lab/v2/runs/${view.run.id}/report`)).json());measurements.push({...variant,configuredFps:variant.fps,wallMs:runEndedMs-start,steps,draws:render.drawTimes.length,drawTimesMs:render.drawTimes,cadence,drawsDuringRun,pauseStartMs,resumeStartMs,pausedDraws,pageErrors:[...pageErrors],suspension:variant.paused?'CDP Debugger.paused acknowledged; renderer JavaScript suspended while HTTP source steps continued':'active'});
  expect((await context.request.post(`/lab/v2/runs/${view.run.id}/archive`,{headers,data:{}})).ok()).toBe(true);
 }
 expect(normalize(reports[1]!)).toEqual(normalize(reports[0]!));expect(normalize(reports[2]!)).toEqual(normalize(reports[0]!));
 if(process.env.LAB_EVIDENCE_DIR)await writeFile(`${process.env.LAB_EVIDENCE_DIR}/plan01-render-independence.json`,JSON.stringify({capturedAt:new Date().toISOString(),sourceCommit:health.sourceCommit,measurements,identical:true,note:'CDP Debugger.pause suspends real renderer JavaScript; the RAF loop is not disabled by the harness. HTTP source steps continue outside the page. Page lifecycle freeze did not suspend RAF in this Chrome build, so this evidence claims debugger suspension only, not OS background-tab throttling.'},null,2)+'\n');
});
