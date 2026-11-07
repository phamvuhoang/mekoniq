#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const here = __dirname;
const staticOnly = process.argv.includes('--static');
const arg = process.argv.find(a => a.startsWith('--artifact='));
const artifact = arg ? path.resolve(arg.slice(11)) : path.resolve(here, here.split(path.sep).at(-2) === 'src' ? '../../mekoniq-platform-lab-guide-2026-11-07.html' : 'mekoniq-platform-lab-guide-2026-11-07.html');
const receipt = {schemaVersion:1, recordedAt:new Date().toISOString(), artifact:path.basename(artifact), mode:staticOnly?'static':'browser', checks:[], passed:false};
const check = (name, details=true) => receipt.checks.push({name, details, passed:true});
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
 const bytes=fs.readFileSync(artifact), text=bytes.toString();
 const build=JSON.parse(fs.readFileSync(path.join(here,'build-manifest.json')));
 receipt.sha256=sha(bytes); assert.equal(receipt.sha256,build.sha256);
 for(const [name,digest] of Object.entries(build.inputs)) assert.equal(sha(fs.readFileSync(path.join(here,name))),digest,'Changed input '+name);
 assert(text.includes('<html lang="vi">')); assert(!/<script[^>]+src=|<link[^>]+(?:href|rel)=|<iframe|<img[^>]+src="(?!data:)/i.test(text),'External rendering dependency');
 assert(!/sb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}|BEGIN (?:RSA |EC )?PRIVATE KEY|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text),'Possible key/token embedded');
 for (let n=1;n<=30;n++) assert(text.includes('id="feature-F'+String(n).padStart(2,'0')+'"'),'Missing platform capability');
 for(const prefix of ['A','B','C','D']) for(let n=1;n<=4;n++) assert(text.includes(prefix+'0'+n),'Missing implementation task');
 for(const marker of ['ENGINEERING_EVIDENCE_NOT_PASSED','runnable=false','G1','G2','G3','1880/1884','MODEL_UNQUALIFIED','Port.link','N*m/A','not_run','NR01–NR12','production','stability']) assert(text.includes(marker),'Missing scope/limit '+marker);
 for(const command of build.commands){const result=spawnSync('bash',['-n'],{input:command,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 for(const im of build.screenshots){assert.equal(sha(fs.readFileSync(path.join(here,im.file))),im.sha256);assert(text.includes('shot-'+im.id));}
 const anchorIds=new Set([...text.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 assert.equal(anchorIds.size,[...text.matchAll(/\bid="([^"]+)"/g)].length,'Duplicate HTML ids');
 for(const match of text.matchAll(/\bhref="#([^"]+)"/g)) assert(anchorIds.has(match[1]),'Broken anchor '+match[1]);
 check('Input/artifact/image hashes, complete scope, self-contained resources, anchors, secret scan, shell syntax');
 if(!staticOnly){
  let pw;
  try {pw=require('@playwright/test');} catch {
   const workspaceRequire=createRequire(path.resolve(here,'../../../package.json'));
   pw=workspaceRequire('@playwright/test');
  }
  const options={headless:true};
  if(process.env.PLAYWRIGHT_CHROMIUM) options.executablePath=process.env.PLAYWRIGHT_CHROMIUM;
  else if(fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) options.executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser=await pw.chromium.launch(options);
  try {
   const page=await browser.newPage({viewport:{width:1440,height:1000}});
   const errors=[], requests=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())) requests.push(r.url());});
   await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(artifact).href);
   const all=await page.locator('.feature').count(),shots=await page.locator('.shot').count();
   assert(all>=54);assert.equal(shots,build.screenshots.length);
   for(const width of [1440,1024,768,390,320]){
    await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow '+width);
   }
   check('Desktop/tablet/mobile widths have no document overflow');
   await page.setViewportSize({width:1440,height:1000});
   await page.locator('#repo-filter').selectOption('source');assert.equal(await page.locator('.feature:visible').count(),await page.locator('.feature[data-repo="source"]').count());
   await page.locator('#repo-filter').selectOption('lab');assert.equal(await page.locator('.feature:visible').count(),await page.locator('.feature[data-repo="lab"]').count());
   await page.locator('#search').fill('ca phe');assert(await page.locator('.feature:visible').count()>0);
   await page.locator('#search').fill('not-a-real-feature-zzzz');assert.equal(await page.locator('.feature:visible').count(),0);assert(await page.locator('#no-results').isVisible());
   await page.locator('#reset').click();assert.equal(await page.locator('.feature:visible').count(),all);
   await page.locator('#status-filter').selectOption('todo');assert.equal(await page.locator('.feature:visible').count(),await page.locator('.feature[data-state="todo"]').count());
   check('Repository/status/accent-free search, empty result and reset work');
   await page.locator('#gallery-filter').selectOption('lab');assert.equal(await page.locator('.shot:visible').count(),await page.locator('.shot[data-shot-repo="lab"]').count());
   const zoom=page.locator('.shot:visible .zoom').first();await zoom.click();assert(await page.locator('#lightbox').isVisible());
   assert.equal(await page.locator('#lightbox-image').evaluate(i=>i.naturalWidth>0),true);
   await page.keyboard.press('Escape');assert(!(await page.locator('#lightbox').isVisible()));assert(await zoom.evaluate(e=>e===document.activeElement));
   check('Gallery filter and real-pixel dialog with Escape/focus restoration');
   const first=page.locator('[data-copy]').first();const expected=await page.locator('#'+await first.getAttribute('data-copy')).textContent();
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t;}}}));await first.click();assert.equal(await page.evaluate(()=>window.__copied),expected);
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));await first.click();assert.equal(await page.evaluate(()=>getSelection().toString()),expected);
   check('Command copy and denied-clipboard selection fallback');
   await page.emulateMedia({media:'print'});assert.equal(await page.locator('.feature:visible').count(),all);assert.equal(await page.locator('.shot:visible').count(),shots);assert.equal(await page.locator('.copy:visible').count(),0);
   check('Print reveals all filtered content and removes controls');
   await page.emulateMedia({media:'screen'});await page.locator('#reset').click();await page.locator('#gallery-filter').selectOption('all');
   const resetPreview=async()=>{await page.evaluate(()=>{getSelection().removeAllRanges();document.activeElement?.blur();document.getElementById('toast').textContent='';scrollTo({top:0,left:0,behavior:'instant'});});await page.waitForFunction(()=>scrollY===0);};
   await resetPreview();await page.screenshot({path:path.join(here,'desktop-preview.png')});
   await page.setViewportSize({width:390,height:1000});await resetPreview();await page.screenshot({path:path.join(here,'mobile-preview.png')});
   const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}), staticPage=await noJS.newPage();await staticPage.goto(pathToFileURL(artifact).href);
   assert.equal(await staticPage.locator('.feature:visible').count(),all);assert.equal(await staticPage.locator('.shot:visible').count(),shots);assert(await staticPage.locator('noscript').isVisible());await noJS.close();
   check('No-JavaScript reading fallback');assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);check('Zero browser errors or external resource requests');
  } finally {await browser.close();}
 }
 receipt.passed=true;
})().catch(e=>{receipt.error=e.stack;process.exitCode=1;}).finally(()=>{
 fs.writeFileSync(path.join(here,staticOnly?'verification-static.json':'verification.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({passed:receipt.passed,mode:receipt.mode,checks:receipt.checks.length,error:receipt.error}));
});
