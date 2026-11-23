// WEB09 (R4 plan V16, contracts §10): frame p95 of the production build (a) with a real wheel bench's 5,000-sample plots on screen and (b) with the belief layer drawn on the offline replay of a real belief_estimated cell run. Limit: the R2b desktop-3D target.
// One spec per launcher (one-use pairing code):
//   node scripts/test-irsim-e2e.mjs --production-ui --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-perf.spec.ts
// Writes web09.json (raw intervals, workload, production build hash) beside the screenshots; scripts/r4-web09-readback.mjs in Source recomputes everything from it.
import {test,expect,type Request} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,cpSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {openInspector,openScenarioPicker} from '../support/twin';
import {startProbe,finishProbe,p95,WEB09_LIMIT_MS,WEB09_MIN_DURATION_MS} from '../support/web09';
// @ts-expect-error JavaScript CLI boundary
import {verifyProductionUi} from '../../scripts/production-ui.mjs';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL,dir=process.env.LAB_EVIDENCE_DIR;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const isCreate=(r:Request)=>r.method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url());
test('WEB09: frame p95 stays within the R2b target with a 5,000-sample plot and with the belief layer',async({page})=>{
 test.setTimeout(1800000);page.setDefaultTimeout(60000);expect(token).toBeTruthy();expect(dir,'LAB_EVIDENCE_DIR is required (the launcher sets it)').toBeTruthy();
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();await expect(page.getByTestId('runtime-popover')).toBeHidden();
 const url=new URL('/',page.url()).href,productionSha256:string=await verifyProductionUi({url,evidenceDir:dir!}),scenarios:object[]=[],kept=join(dir!,'web09');mkdirSync(kept,{recursive:true});
 // (a) a real wheel bench from the served starting profile; its trace is 10 chunks of 500 samples
 await openInspector(page,'control');
 const response=page.getByTestId('control-plot-response'),created=page.waitForResponse(r=>isCreate(r.request())),seen=(kind:string)=>page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith(`/${kind}`)&&r.url().includes('/lab/v2/runs/'),{timeout:180000});
 const reportSeen=seen('report'),traceSeen=seen('trace');await page.locator('#twin-ctl-run').click();const c=await created;expect(c.status()).toBe(201);const runId=(await c.json()).run.id as string;
 const benchReport=await(await reportSeen).body(),benchTrace=await(await traceSeen).body();writeFileSync(join(kept,'bench-report.json'),benchReport);writeFileSync(join(kept,'bench-trace.json'),benchTrace);
 await expect(response).toHaveAttribute('data-run',runId,{timeout:180000});
 const samples=Number(await response.getAttribute('data-samples')),points=await response.locator('polyline[data-series="actual"]').evaluateAll(ls=>ls.reduce((n,l)=>n+(l.getAttribute('points')??'').trim().split(' ').length,0));
 expect(points).toBe(samples);expect(samples).toBeGreaterThanOrEqual(5000);
 await page.evaluate(()=>{const a=document.querySelector('[data-testid="control-plots"]')!,b=document.querySelector('#twin-ctl-kp')!;let k=0;(window as unknown as {__scroll:number}).__scroll=window.setInterval(()=>{(k++%2?a:b).scrollIntoView({block:'start'});(a as HTMLElement).style.opacity=k%2?'1':'0.99';},100);});
 await startProbe(page);await page.waitForTimeout(WEB09_MIN_DURATION_MS+1000);const plot=await finishProbe(page);
 await page.evaluate(()=>clearInterval((window as unknown as {__scroll:number}).__scroll));
 await expect(response).toHaveAttribute('data-run',runId);
 scenarios.push({id:'plot-5000',workload:{runId,samplesPerSeries:samples,plottedPoints:points,stress:'scrollIntoView and a plot-wide opacity change every 100 ms',benchReport:{file:'web09/bench-report.json',sha256:sha(benchReport)},benchTrace:{file:'web09/bench-trace.json',sha256:sha(benchTrace)}},...plot});
 // (b) a real belief_estimated cell run, exported, opened on the offline replay, the belief ghost played for the whole window
 await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="mujoco-cell"]').click();await openInspector(page,'setup');
 await page.locator('#twin-grasp-mode-belief_estimated').check();await expect(page.locator('[data-action="twin-run"]').first()).toBeEnabled({timeout:120000});
 const made=page.waitForResponse(r=>isCreate(r.request()));await page.locator('[data-action="twin-run"]').first().click();const cell=await made;expect(cell.status()).toBe(201);
 const body=cell.request().postDataJSON();expect(body).toMatchObject({graspMode:'belief_estimated'});const cellRunId=(await cell.json()).run.id as string;
 await expect(page.locator('[data-action="twin-play"]').first()).toBeEnabled({timeout:120000});
 await page.locator('#twin-run-speed').selectOption('16');await page.locator('[data-action="twin-play"]').first().click();
 await expect(page.locator('#twin-transport-time')).toContainText(/tick (19|2\d)\d\d/,{timeout:600000});
 await page.locator('[data-action="twin-stop"]').first().click();await expect(page.locator('[data-action="twin-cancel"]').first()).toBeEnabled({timeout:60000});
 const folder=mkdtempSync('/tmp/mekoniq-web09-pkg-'),zip=join(folder,'belief.zip'),download=page.waitForEvent('download',{timeout:300000});
 await page.locator('[data-action="twin-world-export"]').first().click();await(await download).saveAs(zip);execFileSync('unzip',['-q',zip,'-d',join(folder,'pkg')]);
 const manifest=JSON.parse(readFileSync(join(folder,'pkg/manifest.json'),'utf8')),asset=manifest.assets.find((a:{role:string})=>a.role==='report'),raw=readFileSync(join(folder,'pkg',asset.path));
 const report=JSON.parse((asset.encoding==='gzip'?gunzipSync(raw):raw).toString()),beliefRecords=(report.perceptionEvidence.beliefs as {objectId:string;belief:unknown}[]).filter(r=>r.objectId==='cup-1'&&r.belief).length;
 cpSync(join(folder,'pkg'),join(kept,'belief-package'),{recursive:true});const packageManifest=readFileSync(join(kept,'belief-package/manifest.json'));
 expect(beliefRecords).toBeGreaterThan(0);
 const replay=await page.context().newPage();await replay.route('**/lab/**',r=>r.abort());await replay.setViewportSize({width:1440,height:900});
 await replay.goto('/#replay');await replay.getByRole('button',{name:'EN',exact:true}).click().catch(()=>{});
 await replay.locator('.replay-files>summary').click();await replay.locator('#replay-import').setInputFiles(join(folder,'pkg'));await expect(replay.locator('#replay-cursor')).toBeVisible({timeout:90000});
 const seek=(tick:number)=>replay.locator('#replay-cursor').evaluate((el:HTMLInputElement,t)=>{el.value=String(t);el.dispatchEvent(new Event('input',{bubbles:true}));},tick);
 const first=20;await seek(first);await expect(replay.getByTestId('belief-legend')).toHaveAttribute('data-state','data',{timeout:30000});await expect(replay.locator('#replay-stage canvas')).toHaveAttribute('data-belief-state','data');
 const max=Number(await replay.locator('#replay-cursor').getAttribute('max'));expect(max).toBeGreaterThan(first+500);
 // the replay advances one tick per 20 ms: play from the first estimate to the horizon and again, until the window is full
 await startProbe(replay,{replay:true});const began=Date.now();
 while(Date.now()-began<WEB09_MIN_DURATION_MS+1000){await seek(first);await replay.locator('[data-replay="play"]').click();await replay.waitForTimeout(Math.min(WEB09_MIN_DURATION_MS+1000-(Date.now()-began),(max-first)*20+500));}
 const belief=await finishProbe(replay);await replay.close();rmSync(folder,{recursive:true,force:true});
 scenarios.push({id:'belief-layer',workload:{runId:cellRunId,replayHorizonTick:max,firstTick:first,view:'3d',package:{dir:'web09/belief-package',manifestSha256:sha(packageManifest)}},...belief});
 expect(await verifyProductionUi({url,evidenceDir:dir!})).toBe(productionSha256);
 mkdirSync(dir!,{recursive:true});writeFileSync(join(dir!,'web09.json'),JSON.stringify({schemaVersion:2,kind:'web09-frame-timing',productionSha256,limitMs:WEB09_LIMIT_MS,minimumDurationMs:WEB09_MIN_DURATION_MS,viewport:{width:1440,height:900},scenarios})+'\n');
 for(const s of scenarios as {id:string;intervalsMs:number[];beliefFrames:number}[])expect(p95(s.intervalsMs),`frame p95 of ${s.id}`).toBeLessThanOrEqual(WEB09_LIMIT_MS);
});
