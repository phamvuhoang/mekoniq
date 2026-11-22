// V07a (R4.2 §6.3): the Control tab on the pinned runtime with the real MuJoCo worker. One spec per launcher (one-use pairing code); the wheel bench needs mujoco_3d:
//   node scripts/test-irsim-e2e.mjs --provider mujoco --mujoco-mobile [--ui-port 4185 --runtime-port 4186] mujoco-control.spec.ts
// Add --same-origin on alternate ports for the cookie + CSRF path. Otherwise LAB_TEST_RUNTIME_URL selects a direct bearer session.
import {test,expect,type Page,type Request,type Response} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openInspector} from '../support/twin';
import {sweepWeb07} from '../support/web07';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL,dir=process.env.LAB_IRSIM_SCREENSHOTS;
const shot=async(p:Page,name:string)=>{if(dir)await p.screenshot({path:`${dir}/V07a-${name}.png`,fullPage:true});};
const isCreate=(r:Request)=>r.method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url());
type Metric={available:true;value:number;unit:string}|{available:false;reason:string};
type Trace={axisId:string;dtS:number;samples:({target:number;actual:number;feedback:number|null;torqueNm:number;saturated?:boolean}|null)[]};
/** The page's own number format for a metric (svg-plot sig: three significant digits; a ratio as %). */
const shown=(m:Metric)=>m.available?m.unit==='ratio'?`${Number((m.value*100).toPrecision(3))} %`:`${Number(m.value.toPrecision(3))} ${m.unit}`:`(${m.reason})`;

test('Control tab: a wheel bench, A/B after a gain change, export and import, bounds, hidden while running, three languages, 390/1024/1440, a suggestion run, a trapezoid, a server refusal',async({page})=>{
 test.setTimeout(600000);page.setDefaultTimeout(30000);
 expect(token,'Run through scripts/test-irsim-e2e.mjs --provider mujoco --mujoco-mobile mujoco-control.spec.ts').toBeTruthy();
 const errors:string[]=[],creates:Request[]=[],mutations:Request[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(isCreate(r))creates.push(r);if(r.method()==='POST'&&r.url().includes('/lab/v2/runs'))mutations.push(r);});
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openInspector(page,'control');
 const bench=page.getByTestId('control-bench'),kp=page.locator('#twin-ctl-kp'),response=page.getByTestId('control-plot-response');
 await expect(page.getByTestId('control-banner')).toContainText('Simulation · not calibrated');
 await expect(page.locator('#twin-ctl-axis-wheels')).toBeChecked();await expect(kp).toHaveValue('2');
 // the tab takes the main area; the twin's viewport waits behind it
 await expect(page.getByTestId('twin-scene')).toBeHidden();
 for(const width of [390,1024,1440]){
  await page.setViewportSize({width,height:width===390?844:900});
  await page.locator('#twin-ctl-kind').selectOption('trapezoid');
  const focused=page.locator('#twin-ctl-acceleration');await focused.focus();await focused.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('control-banner')).toBeInViewport({ratio:1});await expect(focused).toBeInViewport({ratio:1});
  const hit=await focused.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;});expect(hit).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await shot(page,`${width}-trapezoid-focus`);
 }
 await page.locator('#twin-ctl-kind').selectOption('step');
 await page.locator('#twin-ctl-axis-wheels').scrollIntoViewIfNeeded();
 await shot(page,'1440-ready');

 /** One bench through the UI: its create request, report and trace as the page received them; `during` runs while it steps. */
 const runBench=async(start:()=>Promise<void>,during?:()=>Promise<void>)=>{
  const seen=(kind:string)=>(r:Response)=>r.request().method()==='GET'&&r.url().endsWith(`/${kind}`)&&r.url().includes('/lab/v2/runs/');
  const created=page.waitForResponse(r=>isCreate(r.request())),report=page.waitForResponse(seen('report'),{timeout:120000}),trace=page.waitForResponse(seen('trace'),{timeout:120000}),archived=page.waitForResponse(r=>r.url().endsWith('/archive'),{timeout:120000});
  await start();const c=await created;expect(c.status()).toBe(201);const id=(await c.json()).run.id as string;
  await during?.();
  const [rep,tr,ar]=await Promise.all([report,trace,archived]);
  for(const r of [rep,tr,ar]){expect(r.url()).toContain(id);expect(r.status()).toBe(200);}
  return {id,request:c.request().postDataJSON(),tuning:(await rep.json()).tuning,trace:(await tr.json()).traces[0] as Trace};
 };
 const runClick=()=>page.locator('#twin-ctl-run').click();
 /** The plots are the recorded trace: every non-null sample of the true state is one point of the "actual" line. */
 const checkPlots=async(r:{id:string;trace:Trace})=>{
  await expect(response).toHaveAttribute('data-run',r.id);
  const recorded=r.trace.samples.filter(Boolean).length;await expect(response).toHaveAttribute('data-samples',String(recorded));
  const points=await response.locator('polyline[data-series="actual"]').evaluateAll(ls=>ls.reduce((n,l)=>n+(l.getAttribute('points')??'').trim().split(' ').length,0));
  expect(points).toBe(recorded);
 };
 const checkMetrics=async(t:{metrics:Record<string,Metric>})=>{for(const [k,m] of Object.entries(t.metrics))await expect(page.locator(`[data-testid="tuning-result"] [data-metric="${k}"]`).last()).toContainText(shown(m));};

 // 1. the wheels on a 2 rad/s step from the served starting profile: metrics (or their reasons) and the recorded trace as plots
 const a=await runBench(runClick);
 await expect(page.getByTestId('wheel-measurement')).toContainText(`final verified tick ${a.tuning.wheelMeasurement.comparison.tick}`);
 expect(a.request.bench).toMatchObject({schemaVersion:1,scenarioId:'MJ-BENCH-WHEEL',axis:'wheels',signal:{kind:'step',amplitude:2,atTick:10},driveExperimentId:'drive-nominal-v1'});
 expect(a.request.bench.controlProfile.axes.map((x:{loop:{kp:number}})=>x.loop.kp)).toEqual([2,2]);
 expect(a.tuning.status).toBe('completed');
 await expect(bench).toHaveAttribute('data-phase','idle');await expect(page.getByTestId('tuning-metrics')).toBeVisible();
 await checkMetrics(a.tuning);await checkPlots(a);
 // §6.3 at 1440×900 (ruling 1): after a bench the three plots, the metric line, the gains and Run are in view side by side
 // the panel keeps the scroll offset it had in the 390 px stack (320 px of 1159); the design is "plots start under the sticky head" (scroll-padding), so align them there before measuring the fit
 await page.getByTestId('control-plot-response').evaluate(el=>el.scrollIntoView({block:'start'}));
 for(const id of ['control-plot-response','control-plot-error','control-plot-torque'])await expect(page.getByTestId(id),id).toBeInViewport({ratio:1});
 await expect(page.getByTestId('tuning-summary')).toBeInViewport({ratio:1});
 await expect(kp).toBeInViewport({ratio:1});await expect(page.locator('#twin-ctl-ki')).toBeInViewport({ratio:1});await expect(page.locator('#twin-ctl-run')).toBeInViewport({ratio:1});
 // a gain suggestion now exists for the wheels (from this bench's effective inertia)
 await expect(page.locator('[data-action="twin-ctl-suggest-apply"]')).toBeEnabled();await expect(page.locator('#twin-ctl-suggest-note')).toContainText('model-based starting point, not calibrated');
 await shot(page,'1440-first-bench');

 // 2. a value outside the server's bounds is stopped at the form with its reason; no run is created
 const before=creates.length;
 await kp.fill('999');await runClick();
 await expect(page.locator('#twin-ctl-kp-error')).toContainText('[0, 20]');await expect(kp).toHaveAttribute('aria-invalid','true');
 await page.waitForTimeout(500);expect(creates.length).toBe(before);

 // 3. Kp inside the bounds, run again: the same plant, drive, signal, seed and engine, so the table shows B − A
 await kp.fill('4');await expect(kp).not.toHaveAttribute('aria-invalid','true');
 const b=await runBench(runClick);
 expect(b.request.bench.controlProfile.axes.map((x:{loop:{kp:number}})=>x.loop.kp)).toEqual([4,4]);
 const ab=page.getByTestId('ab-delta');await expect(ab).toBeVisible();await expect(ab).toContainText('Δ B − A');await expect(ab).toContainText(`A · ${a.id.slice(0,8)}`);await expect(ab).toContainText(`B · ${b.id.slice(0,8)}`);
 await expect(ab.locator('[data-metric="rmsError"] td').nth(2)).not.toHaveText('—');
 await checkPlots(b);await shot(page,'1440-ab');
 // the banner stays in view when the panel is scrolled to its end
 const panel=page.locator('#inspector-panel-control');await panel.evaluate(e=>{e.scrollTop=e.scrollHeight;});
 await expect(page.getByTestId('control-banner')).toBeInViewport({ratio:1});await shot(page,'1440-scrolled');await panel.evaluate(e=>{e.scrollTop=0;});

 // 4. export: the profile of that bench, sourced to it; then another value, then the file: the draft is the file's
 const download=page.waitForEvent('download');await page.locator('[data-action="twin-ctl-export"]').click();const file=await (await download).path();
 const exported=JSON.parse(readFileSync(file,'utf8'));
 expect(exported.sources.loop).toEqual({kind:'tuned_in_simulation',benchRunId:b.id,scenarioId:'MJ-BENCH-WHEEL',traceSha256:b.tuning.trace.sha256,sourceCommit:exported.sources.loop.sourceCommit,axisIds:b.tuning.axisIds,driveModelDigest:b.tuning.plant.driveModelDigest});
 expect(exported.sources.loop.sourceCommit).toMatch(/^[0-9a-f]{40}$/);expect(exported.sources.limits).toEqual(exported.sources.loop);
 expect(exported).toMatchObject({calibration:'not_calibrated',plantModelDigest:b.tuning.plant.plantModelDigest});expect(exported.driveModelDigests).toContain(b.tuning.plant.driveModelDigest);
 expect(exported.axes.map((x:{loop:{kp:number}})=>x.loop.kp)).toEqual([4,4]);
 await expect(page.locator('#twin-ctl-io-note')).toContainText('for the tuned axes amr-1/wheel-left, amr-1/wheel-right');
 await kp.fill('3');
 await page.locator('#twin-ctl-import').setInputFiles(file);
 await expect(kp).toHaveValue('4');await expect(page.getByTestId('control-plant')).toContainText(`${exported.id} r${exported.revision}`);
 // a file of another plant is refused and the draft stays
 await page.locator('#twin-ctl-import').setInputFiles({name:'other.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exported,plantModelDigest:'0'.repeat(64)}))});
 await expect(page.getByTestId('control-notice')).toContainText('Profile not imported');await expect(page.getByTestId('control-notice')).toContainText('DRIVE_PLANT_MISMATCH');await expect(kp).toHaveValue('4');

 // 5. the imported profile runs (the server takes the exported file as a bench draft); the tab is hidden while it steps and shown once it is archived
 const c=await runBench(runClick,async()=>{await openInspector(page,'objects');await expect(bench).toBeHidden();await expect(page.getByTestId('twin-scene')).toBeVisible();});
 expect(c.request.bench.controlProfile.sources.loop.benchRunId).toBe(b.id);expect(c.request.bench.controlProfile.axes.map((x:{loop:{kp:number}})=>x.loop.kp)).toEqual([4,4]);
 await openInspector(page,'control');await expect(bench).toHaveAttribute('data-phase','idle');
 await checkPlots(c);await checkMetrics(c.tuning);

 // 6. the language changes while the plots are shown: the same plots of the same run, in each language
 for(const [lang,word,banner] of [['JA','応答','シミュレーション · 未校正'],['VI','Đáp ứng','Mô phỏng · chưa hiệu chuẩn'],['EN','Response','Simulation · not calibrated']] as const){
  await page.getByRole('button',{name:lang,exact:true}).click();await openInspector(page,'control');
  await expect(response.locator('figcaption')).toContainText(word);await expect(page.getByTestId('control-banner')).toContainText(banner);await checkPlots(c);
 }
 // the out-of-bounds reason in Japanese
 await page.getByRole('button',{name:'JA',exact:true}).click();await openInspector(page,'control');
 await kp.fill('25');await runClick();await expect(page.locator('#twin-ctl-kp-error')).toContainText('サーバーの範囲外');await kp.fill('4');
 // accessibility of the tab (serious and critical rules)
 await page.addScriptTag({path:join(process.cwd(),'node_modules/axe-core/axe.min.js')});
 const scan=()=>page.evaluate(async()=>{const r=await (window as unknown as {axe:{run(c:unknown,o:unknown):Promise<{violations:{impact:string;id:string;nodes:{target:unknown}[]}[]}>}}).axe.run('#inspector-panel-control',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});
 expect(await scan()).toEqual([]);

 // 7. 1024 and 390 px: no page scroll sideways; at 390 the form stacks above the results and a bench runs from the keyboard (Enter in a gain field), in Vietnamese
 await page.setViewportSize({width:1024,height:768});await expect(response).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await shot(page,'1024');
 await page.getByRole('button',{name:'VI',exact:true}).click();await openInspector(page,'control');
 await page.setViewportSize({width:390,height:844});
 const form=await page.locator('#twin-ctl-form').boundingBox(),results=await page.locator('#twin-ctl-results').boundingBox();expect(results!.y).toBeGreaterThan(form!.y+form!.height-1);
 await kp.fill('3');
 const d=await runBench(async()=>{await kp.press('Enter');});
 await expect(bench).toHaveAttribute('data-phase','idle');expect(await page.evaluate(()=>document.activeElement?.id)).toBe('twin-ctl-kp');
 expect(d.request.bench.controlProfile.axes.map((x:{loop:{kp:number}})=>x.loop.kp)).toEqual([3,3]);
 await expect(page.getByTestId('ab-delta')).toBeVisible();await checkPlots(d);await checkMetrics(d.tuning);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await scan()).toEqual([]);
 await response.scrollIntoViewIfNeeded();await shot(page,'390-bench');
 await page.setViewportSize({width:1440,height:900});await shot(page,'1440-final');expect(errors,'after 7').toEqual([]);

 // 9 (final-fix V07 M7). A gain suggestion applied, then run: the bench carries exactly the suggested gains, and B − A is against the last comparable bench (d)
 await page.getByRole('button',{name:'EN',exact:true}).click();await openInspector(page,'control');
 const pick=d.tuning.suggestions[1] as {loop:{kp:number;ki:number;kd:number;integralLimit:number|null;slewLimit:number|null}};
 await page.locator('#twin-ctl-suggest').selectOption('1');await page.locator('[data-action="twin-ctl-suggest-apply"]').click();
 await expect(kp).toHaveValue(String(pick.loop.kp));await expect(page.locator('#twin-ctl-ki')).toHaveValue(String(pick.loop.ki));
 const g=await runBench(runClick);
 expect(g.request.bench.controlProfile.axes.map((x:{loop:unknown})=>x.loop)).toEqual([pick.loop,pick.loop]);
 await expect(bench).toHaveAttribute('data-phase','idle');await expect(page.getByTestId('ab-delta')).toContainText(`A · ${d.id.slice(0,8)}`);
 await checkPlots(g);await checkMetrics(g.tuning);await shot(page,'1440-suggestion');expect(errors,'after 9').toEqual([]);

 // 10. a wheel trapezoid: the step metrics are SIGNAL_NOT_STEP, the tracking error, peak torque and saturation are measured; not compared with a step
 await page.locator('#twin-ctl-kind').selectOption('trapezoid');await page.locator('#twin-ctl-size').selectOption('2');
 await expect(page.locator('#twin-ctl-distance')).toHaveValue('4');await expect(page.locator('#twin-ctl-acceleration')).toHaveValue('10');await page.locator('#twin-ctl-atTick').fill('10');
 const z=await runBench(runClick);
 expect(z.request.bench.signal).toEqual({kind:'trapezoid',distance:4,peakVelocity:2,acceleration:10,atTick:10});
 expect(z.tuning.status).toBe('completed');expect(z.tuning.metrics.riseTimeS).toMatchObject({available:false,reason:'SIGNAL_NOT_STEP'});expect(z.tuning.metrics.rmsError.available).toBe(true);
 await expect(bench).toHaveAttribute('data-phase','idle');await checkMetrics(z.tuning);await checkPlots(z);await expect(page.getByTestId('ab-changed')).toContainText('signal');await shot(page,'1440-trapezoid');expect(errors,'after 10').toEqual([]);

 // 11. a draft the UI admits but the server refuses: the same trapezoid from tick 400 ends its motion past tick 500 (the form checks the start tick only). The runtime's reason is shown at its field; no run exists
 const runsBefore=creates.length;await page.locator('#twin-ctl-atTick').fill('400');
 const refusedAt=page.waitForResponse(r=>isCreate(r.request()));await runClick();const refusal=await refusedAt;
 expect(refusal.status()).toBe(422);const refusalBody=await refusal.json();expect(refusalBody.reasonCodes).toEqual(['SIGNAL_TOO_LONG']);expect(creates.length).toBe(runsBefore+1);
 await expect(page.getByTestId('control-server-reasons')).toContainText('SIGNAL_TOO_LONG');await expect(page.locator('#twin-ctl-atTick-error')).toContainText('SIGNAL_TOO_LONG');
 await expect(page.locator('#twin-ctl-atTick')).toHaveAttribute('aria-invalid','true');await expect(bench).toHaveAttribute('data-phase','idle');await shot(page,'1440-server-refusal');expect(errors,'after 11').toEqual([]);
 await page.locator('#twin-ctl-atTick').fill('10');await page.locator('#twin-ctl-kind').selectOption('step');expect(errors,'after the reset').toEqual([]);

 // 8. an arm axis: J3 on a 0.2 rad step with the served starting gains. The page shows the result the runtime gave, its cause in words (a drive fault on OVERSPEED
 //    is the model's physics, not a bug), never a delta against the wheels, and exports only a completed bench
 await page.getByRole('button',{name:'EN',exact:true}).click();await openInspector(page,'control');
 // the draft of J3 is the served starting profile's (the same file the runtime serves, read from the source checkout)
 const xarm=JSON.parse(readFileSync(join(process.cwd(),'../source/robotics/simulation-mujoco/fixtures/drive-v1/xarm6-control-v1.json'),'utf8')) as {axes:{axisId:string;loop:{kp:number;kd:number}}[]},j3=xarm.axes.find(x=>x.axisId==='xarm-1/J3')!;
 await page.locator('#twin-ctl-axis-J3').check();await expect(kp).toHaveValue(String(j3.loop.kp));await expect(page.locator('#twin-ctl-kd')).toHaveValue(String(j3.loop.kd));await expect(page.locator('#twin-ctl-accelerationLimit')).toHaveCount(0);
 await page.locator('#twin-ctl-size').selectOption('0.2');
 await page.locator('#twin-ctl-kd').evaluate(el=>el.scrollIntoView({block:'start'})); // same: the panel's scroll offset is left over from the previous tab state
 await expect(page.locator('#twin-ctl-kd')).toBeInViewport({ratio:1});await expect(page.locator('#twin-ctl-run')).toBeInViewport({ratio:1});
 const j=await runBench(runClick);
 expect(j.request.bench).toMatchObject({scenarioId:'MJ-BENCH-ARM',axis:'J3',signal:{kind:'step',amplitude:0.2,atTick:10}});
 const status=page.locator('[data-testid="tuning-result"] .control-status');
 if(j.tuning.status==='drive_fault'){await expect(status).toContainText(`${j.tuning.fault.code}`);if(j.tuning.fault.code==='OVERSPEED')await expect(status).toContainText('exceeded the drive’s speed limit');await expect(page.locator('[data-action="twin-ctl-export"]')).toBeDisabled();}
 else await expect(status).toContainText(j.tuning.status==='completed'?'Completed':j.tuning.status==='unstable'?'Unstable':'Collision');
 await checkMetrics(j.tuning);await expect(page.getByTestId('ab-changed')).toContainText('axis');await expect(page.getByTestId('ab-delta')).toHaveCount(0);
 if(dir)writeFileSync(`${dir}/V07a-results.json`,JSON.stringify({accepted:false,wheels:[a,b,c,d].map(r=>({runId:r.id,kp:r.request.bench.controlProfile.axes[0].loop.kp,status:r.tuning.status,metrics:r.tuning.metrics,trace:r.tuning.trace})),
  suggestion:{runId:g.id,loop:pick.loop,status:g.tuning.status,metrics:g.tuning.metrics,trace:g.tuning.trace},trapezoid:{runId:z.id,signal:z.request.bench.signal,status:z.tuning.status,metrics:z.tuning.metrics,trace:z.tuning.trace},
  serverRefusal:{status:refusal.status(),body:refusalBody},exported:{sources:exported.sources},j3:{runId:j.id,status:j.tuning.status,fault:j.tuning.fault,metrics:j.tuning.metrics}},null,1));
 for(const mutation of mutations){
  const h=await mutation.allHeaders();
  if(runtime){expect(!!h.authorization?.startsWith('Bearer ')).toBe(true);expect(h.cookie).toBeUndefined();expect(h['x-csrf-token']).toBeUndefined();}
  else {expect(new URL(mutation.url()).origin).toBe(new URL(page.url()).origin);expect(!!h.cookie).toBe(true);expect(h.authorization).toBeUndefined();expect(!!h['x-csrf-token']).toBe(true);}
 }
 await shot(page,'1440-j3');
 await sweepWeb07(page,{panel:'control',testId:'control-bench',reopen:()=>openInspector(page,'control')});
 expect(errors).toEqual([]);
});
