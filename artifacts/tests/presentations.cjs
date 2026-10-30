/* Browser acceptance for the standalone HTML files. No application/backend test. */
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.ARTIFACT_QA_OUTPUT || '/tmp/mekoniq-artifact-qa-results';
fs.mkdirSync(out, {recursive:true});
const suites = {engineering:8, investor:10};
const locales = ['vi','ja','en'];
const failures=[], errors=[], requests=[];
const report={views:0,interactions:[],failures,errors,externalRequests:requests};
const url=(deck,lang,hash='')=>pathToFileURL(path.join(root,deck+'.html')).href+'?lang='+lang+'#'+hash;
async function run(){
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const context=await browser.newContext({offline:true,reducedMotion:'reduce'});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  for(const [deck,count] of Object.entries(suites)){
   for(const size of [{width:1440,height:900},{width:1024,height:768},{width:768,height:1024},{width:375,height:812}]){
    await page.setViewportSize(size);
    for(const lang of locales){
     await page.goto(url(deck,lang));
     assert.equal(await page.locator('html').getAttribute('lang'),lang);
     for(let i=0;i<count;i++){
      const id=await page.locator('.slide').getAttribute('data-page');
      const heading=await page.locator('main h1').innerText();
      assert(heading.length>5);
      const layout=await page.evaluate(()=>{
       const box=document.documentElement;
       const diagrams=[...document.querySelectorAll('.network .map-node')].map(n=>{
        const a=n.getBoundingClientRect(),b=n.closest('.network').getBoundingClientRect();
        return {text:n.innerText,clipped:a.left<b.left-1||a.right>b.right+1||a.top<b.top-1||a.bottom>b.bottom+1};
       }).filter(x=>x.clipped);
       return {overflow:box.scrollWidth>innerWidth+1,width:box.scrollWidth,viewport:innerWidth,diagrams};
      });
      if(layout.overflow||layout.diagrams.length)failures.push({deck,lang,size:size.width,id,...layout});
      assert(!/undefined|\[object Object\]/.test(await page.locator('main').innerText()));
      report.views++;
      if((size.width===1440&&lang==='vi'&&[0,1,5,6].includes(i))||(size.width===375&&lang==='ja'&&[0,4,6].includes(i)))
       await page.screenshot({path:path.join(out,`${deck}-${id}-${lang}-${size.width}.png`),fullPage:true});
      if(i<count-1)await page.locator('.footer [data-action="next"]').click();
     }
    }
   }
   console.log(`${deck}: all slides × 3 languages × 4 viewports checked`);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.goto(url('engineering','vi','architecture'));
  await page.locator('[data-action="node"][data-value="2"]').click();
  assert.match(await page.locator('.detail-panel h2').innerText(),/owner/);
  await page.goto(url('engineering','en','data-flow'));
  await page.locator('[data-action="flow-step"][data-value="6"]').click();
  await page.locator('[data-action="drop"]').click();
  assert.match(await page.locator('.trace-line').last().innerText(),/duplicate: true.*count: 1/);
  await page.locator('[data-action="language"][data-value="ja"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'),'ja');
  assert.match(await page.locator('.trace-line').last().innerText(),/duplicate: true/);
  await page.goto(url('engineering','en','offline'));
  for(let i=0;i<4;i++){
   await page.locator(`[data-action="network"][data-value="${i}"]`).click();
   assert.equal(await page.locator(`[data-action="network"][data-value="${i}"]`).getAttribute('aria-pressed'),'true');
  }
  assert.match(await page.locator('.detail-panel').innerText(),/history|import/i);
  await page.goto(url('engineering','en','capabilities'));
  assert.equal(await page.locator('.cap').count(),30);
  await page.locator('[data-action="preset"][data-value="2"]').click();
  assert.equal(await page.locator('[data-action="cap"][data-value="8"]').evaluate(e=>e.classList.contains('enabled')),false);
  assert.equal(await page.locator('[data-action="cap"][data-value="7"]').evaluate(e=>e.classList.contains('enabled')),true);
  await page.locator('[data-action="cap"][data-value="29"]').click();
  assert.match(await page.locator('.cap-detail').innerText(),/Maintenance/);
  report.interactions.push('architecture selection','lost ACK / dedup illustration','language preserves flow state','four network modes','30 capabilities / no-robot manual fulfillment');
  await page.goto(url('investor','en','business-model'));
  await page.locator('#venues').fill('12');
  await page.locator('#fee').fill('2.3');
  assert.equal(await page.locator('#mrr-value').innerText(),'27.6');
  assert.equal(await page.locator('#arr-value').innerText(),'331.2');
  await page.locator('[data-action="language"][data-value="vi"]').click();
  assert.equal(await page.locator('#mrr-value').innerText(),'27,6');
  assert.equal(await page.locator('#venues').inputValue(),'12');
  await page.locator('#venues').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.slide').getAttribute('data-page'),'business-model');
  assert.equal(await page.locator('#venues').inputValue(),'13');
  await page.locator('main').focus();await page.keyboard.press('Home');
  assert.equal(await page.locator('.slide').getAttribute('data-page'),'vision');
  await page.keyboard.press('End');
  assert.equal(await page.locator('.slide').getAttribute('data-page'),'next-milestone');
  await page.goto(url('investor','en','problem'));await page.locator('[data-action="problem"]').click();
  assert.equal(await page.locator('.island.connected').count(),4);
  await page.goto(url('investor','ja','product'));await page.locator('[data-action="journey"][data-value="2"]').click();
  assert.equal(await page.locator('.floor-mini').count(),1);
  await page.goto(url('investor','vi','customers'));await page.locator('[data-action="segment"][data-value="1"]').click();
  assert.equal(await page.locator('.module-chip.on').count(),2);
  report.interactions.push('MRR/12-month arithmetic','localized numbers and retained inputs','slider keys do not navigate','keyboard Home/End','problem comparison','product stage selection','customer presets');
  for(const deck of Object.keys(suites)){
   await page.goto(url(deck,'ja'));
   assert(await page.locator('body').evaluate(e=>e.classList.contains('paused')));
   const animations=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length);
   assert.equal(animations,0,'reduced-motion must leave no running CSS animations');
   await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
   assert.equal(await page.locator('main .slide').count(),suites[deck]);
   await page.emulateMedia({media:'print'});
   await page.pdf({path:path.join(out,`${deck}-ja-print.pdf`),printBackground:true,preferCSSPageSize:true});
   await page.emulateMedia({media:'screen'});
   await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
   assert.equal(await page.locator('main .slide').count(),1);
  }
  report.interactions.push('reduced motion','full-deck print rendering','offline file:// with zero network requests');
  await context.close();
  const animated=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference',offline:true});
  const p=await animated.newPage();
  await p.goto(url('engineering','en','data-flow'));
  await p.locator('[data-action="flow-play"]').click();
  await p.waitForTimeout(1650);
  assert.equal(await p.locator('.stage.current').getAttribute('data-value'),'1');
  await p.locator('[data-action="motion"]').click();
  await p.waitForTimeout(1600);
  assert.equal(await p.locator('.stage.current').getAttribute('data-value'),'1');
  report.interactions.push('flow autoplay and global pause');
  await animated.close();
 } finally {await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify(report,null,2));
 assert.equal(errors.length,0,'No page errors');
 assert.equal(requests.length,0,'Portable HTML must not request network assets');
 assert.equal(failures.length,0,'No clipped nodes or horizontal overflow');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
