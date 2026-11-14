'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {chromium, expect} = createRequire('/Users/hoangpham/source/prv/robot/lab/package.json')('@playwright/test');
const key = fs.readFileSync(0, 'utf8').trim();
assert(key.length >= 32, 'Expected access key on stdin');
const root = __dirname;
const origin = 'https://mekoniq-lab.vercel.app';
const runtime = 'https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app';
const expectedPin = '4f893ac6fb75dff414a3ee42a726defb7935c734';
let token = '', browser, context, page, timer;
const owned = new Set(), pending = new Set(), errors = [], stepCounts = {finished:0};
const receipt = {schema:'mekoniq-production-browser-smoke/1',startedAt:new Date().toISOString(),origin,runtime,sourceCommit:'d1a2522a89f17d0f9d8d2c444975778844f74425',labCommit:'a7449541e118d01f65af0ad1466e0c963a173f3c',runtimePin:expectedPin,automated:true,manualBrowserCheck:'not_run',accepted:false,checks:[],cleanup:[]};
const scrub = value => JSON.stringify(value, (k,v) => /^(sessionToken|csrfToken|reclaimToken)$/.test(k) ? '<redacted>' : v, 2).replaceAll(key,'<redacted>').replaceAll(token || '\u0000','<redacted>')+'\n';
const save = (name,value) => fs.writeFileSync(path.join(root,name),scrub(value));
const check = (name,details=true) => {receipt.checks.push({name,passed:true,details});console.log(name+': passed');};
async function api(p,post=false) {
  const res = await fetch(runtime+'/lab/v2'+p,{method:post?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+token,...post?{'Content-Type':'application/json'}:{}},...post?{body:'{}'}:{},signal:AbortSignal.timeout(120000)});
  const body = await res.json();
  assert.equal(res.status,200,p+': HTTP '+res.status+' '+(body.code || body.error || ''));
  return body;
}
(async()=>{
 try {
  const lockRes = await fetch(origin+'/source-runtime.lock.json',{signal:AbortSignal.timeout(60000)});
  assert.equal(lockRes.status,200);
  const lock = await lockRes.json();assert.equal(lock.sourceCommit,expectedPin);save('production-runtime-lock.json',lock);check('Production Lab runtime pin');
  browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  receipt.browser = browser.version();
  context = await browser.newContext({viewport:{width:1440,height:900},locale:'vi-VN'});
  page = await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{
   if(r.url()!==runtime+'/lab/v2/runs' || r.request().method()!=='POST' || r.status()!==201)return;
   const work = r.json().then(v=>{if(v.run?.id)owned.add(v.run.id);}).catch(e=>errors.push(String(e)));
   pending.add(work);work.finally(()=>pending.delete(work));
  });
  page.on('requestfinished',r=>{if(r.url().endsWith('/actions')&&r.method()==='POST'&&r.postDataJSON()?.kind==='step')stepCounts.finished++;});
  await page.goto(origin+'/#twin',{waitUntil:'networkidle'});
  const box = page.getByTestId('runtime-popover');await expect(box).toBeVisible();
  await page.locator('label',{hasText:'Địa chỉ khác'}).click();
  await page.locator('#twin-runtime-url').fill(runtime);
  await page.locator('#twin-pair-token').fill(key);
  const paired = page.waitForResponse(r=>r.url()===runtime+'/lab/v2/sessions'&&r.request().method()==='POST',{timeout:120000});
  await page.getByRole('button',{name:'Ghép nối runtime'}).click();
  const pairRes = await paired;assert.equal(pairRes.status(),201);
  token = (await pairRes.json()).sessionToken;assert.equal(typeof token,'string');assert(token.length>0);
  await expect(box).toBeHidden({timeout:120000});
  const health = await api('/health');assert.equal(health.sourceCommit,expectedPin);assert.equal(health.schemaHash,lock.schemaHash);
  save('browser-runtime-health.json',health);check('Pairing and runtime identity from production origin');
  await page.getByTestId('scenario-picker').click();
  await page.getByRole('button',{name:'MuJoCo · cà phê với tay máy xArm 6',exact:true}).click();
  const primary = page.getByTestId('primary-action');await expect(primary).toHaveText('Chạy MuJoCo (tay máy)',{timeout:180000});await expect(primary).toBeEnabled({timeout:180000});
  await primary.click();
  await expect(page.getByTestId('run-status')).toContainText('Đang chạy',{timeout:180000});
  await expect(page.getByTestId('mode-badge')).toHaveText('Mô phỏng · chưa hiệu chuẩn');
  const canvas = page.locator('#twin-stage canvas');
  await expect.poll(()=>canvas.getAttribute('data-arm-model'),{timeout:60000}).toBe('mesh');
  assert.equal(await canvas.getAttribute('data-arm-mesh-links'),'14');assert.equal(await canvas.getAttribute('data-arm-supports'),'2');
  check('MuJoCo preset, xArm mesh and cell supports');
  await page.locator('#twin-run-speed').selectOption('16');
  const start = Date.now();
  await page.locator('#twin-transport [data-action="twin-play"]').click();
  timer = setInterval(()=>console.log('MuJoCo browser run: '+stepCounts.finished+' step requests completed'),30000);
  await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:600000});
  clearInterval(timer);timer=null;
  await expect(page.getByTestId('report-pending')).toHaveCount(0,{timeout:60000});
  await expect(page.getByTestId('run-served').locator('b')).toHaveText('2');
  await Promise.all(pending);assert.equal(owned.size,1);
  const runId = [...owned][0], report = await api('/runs/'+runId+'/report');
  save('production-mujoco-report.json',report);
  // Existing R2a lab-e2e-mujoco-coffee.log records 4810. The UI first steps 250 ticks,
  // then batches of 20; the HTTP CL01 producer uses batches of 50 and reports 4800.
  // The runner computes terminal status after the complete requested batch.
  assert.equal(report.outcome.status,'completed');assert.equal(report.outcome.served,'2');assert.equal(report.outcome.tick,4810);
  assert.equal(BigInt(report.outcome.simTimeNs),BigInt(report.outcome.tick)*20000000n);
  assert.deepEqual(report.attention,[]);
  assert.equal(report.manifest.scenario.id,'MJ-BV01');assert.equal(report.arm.armPlant.engine,'mujoco_3d');assert.equal(report.arm.armPlant.calibration,'not_calibrated');assert.equal(report.arm.collision.result,'pass');
  assert.equal(await canvas.getAttribute('data-plant-cups-dropped'),'0');
  await expect(page.getByTestId('problems-count')).toHaveCount(0);assert.deepEqual(errors,[]);
  receipt.run={runId,status:report.outcome.status,tick:report.outcome.tick,served:report.outcome.served,wallMs:Date.now()-start,stepRequests:stepCounts.finished};
  // No screenshots or traces while the secret input exists.
  assert.equal(await page.locator('#twin-pair-token').count(),0);
  await page.screenshot({path:path.join(root,'production-mujoco-completed.png')});
  check('MJ-BV01 completed in production UI',receipt.run);
  receipt.status='passed';
 } catch(e) {receipt.status='failed';receipt.error=String(e);process.exitCode=1;}
 finally {
  if(timer)clearInterval(timer);
  if(context)await context.close().catch(()=>{});
  await Promise.all(pending);
  for(const runId of owned){try{const data=await api('/runs/'+runId+'/archive',true);assert.equal(data.archived,true);receipt.cleanup.push({runId,archived:true});}catch(e){receipt.cleanup.push({runId,error:String(e)});receipt.status='failed';process.exitCode=1;}}
  if(browser)await browser.close().catch(()=>{});
  receipt.finishedAt=new Date().toISOString();receipt.pageErrors=errors;save('browser-smoke.json',receipt);console.log(scrub(receipt));
 }
})();
