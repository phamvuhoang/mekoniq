const {chromium}=require('../../../node_modules/@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL,fileURLToPath}=require('node:url');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const artifact=path.resolve(__dirname,'../../mekoniq-platform-lab-guide-2026-11-06.html');
const output=path.resolve(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const results={artifact:path.basename(artifact),recordedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),checks:[],errors:[],externalRequests:[]};
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>results.errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url()))results.externalRequests.push(r.url());});
 await page.route('https://**/*',r=>r.abort());await page.route('http://**/*',r=>r.abort());
 const check=(name,details=true)=>results.checks.push({name,passed:true,details});
 try{
  await page.goto(pathToFileURL(artifact).href);
  assert.equal(await page.locator('.feature').count(),54);
  assert.equal(await page.locator('.shot').count(),21);
  assert.equal(await page.locator('.shot img').evaluateAll(xs=>xs.filter(x=>!x.src.startsWith('data:image/png;base64,')||!x.alt).length),0);
  check('54 feature groups / 21 embedded screenshots with alt text');
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow at ${width}`);
   check('responsive '+width);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#repo-filter').selectOption('source');assert.equal(await page.locator('.feature:visible').count(),30);
  await page.locator('#repo-filter').selectOption('lab');assert.equal(await page.locator('.feature:visible').count(),24);
  await page.locator('#search').fill('ca phe');assert((await page.locator('.feature:visible').count())>0);
  await page.locator('#search').fill('no-feature-should-match-xyz');assert.equal(await page.locator('.feature:visible').count(),0);assert(await page.locator('#no-results').isVisible());
  await page.locator('#reset').click();assert.equal(await page.locator('.feature:visible').count(),54);
  await page.locator('#status-filter').selectOption('todo');assert.equal(await page.locator('.feature:visible').count(),3);
  check('repo/status/search without accents, empty state and reset');
  await page.locator('#gallery-filter').selectOption('lab');assert.equal(await page.locator('.shot:visible').count(),8);
  const zoom=page.locator('.shot:visible .zoom').first();await zoom.click();assert(await page.locator('#lightbox').isVisible());
  await page.keyboard.press('Escape');assert(!(await page.locator('#lightbox').isVisible()));assert(await zoom.evaluate(x=>x===document.activeElement));
  check('gallery filter, real image modal, Escape and focus restoration');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}}));
  await page.locator('[data-copy]').first().click();assert((await page.evaluate(()=>window.__copied)).includes('nvm use 24.22.2'));
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('clipboard denied');}}}));
  await page.locator('[data-copy]').first().click();assert((await page.evaluate(()=>getSelection().toString())).includes('nvm use 24.22.2'));
  check('copy command and clipboard-denied selection fallback');
  const commands=await page.locator('code[data-lang="sh"]').allTextContents();
  for(const command of commands){const r=spawnSync('bash',['-n'],{input:command,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  check('shell syntax only; deployment commands not executed',commands.length);
  const links=await page.locator('a[href]').evaluateAll(as=>as.map(a=>a.getAttribute('href')));
  for(const link of links){
   if(link.startsWith('#'))assert(await page.locator(link).count(),`missing anchor ${link}`);
   else if(!/^(https?:|data:)/.test(link))assert(fs.existsSync(fileURLToPath(new URL(link,pathToFileURL(artifact)))),`missing file ${link}`);
  }
  check('internal anchors and repository links exist');
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.feature:visible').count(),54);assert.equal(await page.locator('.shot:visible').count(),21);
  assert.equal(await page.locator('.copy:visible').count(),0);check('print includes all features and images despite active filters');
  await page.emulateMedia({media:'screen'});await page.locator('#reset').click();await page.locator('#gallery-filter').selectOption('all');
  await page.waitForFunction(()=>document.getElementById('toast').textContent==='');
  await page.evaluate(()=>{getSelection().removeAllRanges();scrollTo(0,0);});
  await page.screenshot({path:path.join(output,'mekoniq-platform-lab-guide-preview.png')});
  await page.setViewportSize({width:390,height:1000});await page.screenshot({path:path.join(output,'src/platform-guide/mobile-preview.png')});
  const noJs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  const staticPage=await noJs.newPage();await staticPage.goto(pathToFileURL(artifact).href);
  assert.equal(await staticPage.locator('.feature:visible').count(),54);assert.equal(await staticPage.locator('.shot:visible').count(),21);await noJs.close();check('content available with JavaScript disabled');
  assert.equal(results.errors.length,0);assert.equal(results.externalRequests.length,0);check('zero JavaScript errors and zero external asset/network requests');
  const text=fs.readFileSync(artifact,'utf8');assert(!/sb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/.test(text));assert(!/BEGIN (?:RSA |EC )?PRIVATE KEY/.test(text));check('no embedded Supabase keys or private-key material');
  results.passed=true;
 }finally{
  await browser.close();fs.writeFileSync(path.join(output,'mekoniq-platform-lab-guide-verification.json'),JSON.stringify(results,null,2)+'\n');
 }
 console.log(JSON.stringify({passed:results.passed,checks:results.checks.length,screenshots:21,errors:results.errors,externalRequests:results.externalRequests}));
})().catch(e=>{console.error(e);process.exit(1);});
