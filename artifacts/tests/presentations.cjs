/* Browser acceptance for the standalone HTML files. No application/backend test. */
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.ARTIFACT_QA_OUTPUT || '/tmp/mekoniq-artifact-qa-results';
fs.mkdirSync(out, {recursive:true});
const suites = {engineering:8, 'business-plan':11};
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
  await page.goto(pathToFileURL(path.join(root,'business-plan.html')).href);
  assert.equal(await page.locator('html').getAttribute('lang'),'ja');
  assert.deepEqual(await page.locator('.languages button').evaluateAll(es=>es.map(e=>e.dataset.value)),['ja','en','vi']);
  assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).getPropertyValue('--bg').trim()),'#0b151a');
  await page.locator('[data-action="language"][data-value="en"]').click();
  await page.goto(pathToFileURL(path.join(root,'business-plan.html')).href);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.goto(pathToFileURL(path.join(root,'engineering.html')).href);
  assert.equal(await page.locator('html').getAttribute('lang'),'vi');
  report.interactions.push('Japanese default / JA EN VI order / isolated language preference','engineering dark palette on Business Plan');
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
      if(deck==='business-plan'){
       assert(!/investor|trial/i.test(await page.locator('body').innerText()));
       assert(!/investor/i.test(await page.title()));
      }
      report.views++;
      if((size.width===1440&&lang==='vi'&&[0,1,5,6,9].includes(i))||(size.width===375&&lang==='ja'&&[0,4,6,9].includes(i)))
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
  await page.goto(url('business-plan','en','business-model'));
  assert.equal(await page.locator('#fee').getAttribute('max'),'15');
  await page.locator('#fee').fill('15');
  await page.locator('#venues').fill('100');
  assert.equal(await page.locator('#mrr-value').innerText(),'1,500');
  assert.equal(await page.locator('#arr-value').innerText(),'18,000');
  for(const width of [1440,768,375]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Maximum rental value must fit');
  }
  await page.setViewportSize({width:1440,height:900});
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
  await page.goto(url('business-plan','en','problem'));await page.locator('[data-action="problem"]').click();
  assert.equal(await page.locator('.island.connected').count(),4);
  await page.goto(url('business-plan','ja','product'));await page.locator('[data-action="journey"][data-value="2"]').click();
  assert.equal(await page.locator('.floor-mini').count(),1);
  await page.goto(url('business-plan','vi','customers'));await page.locator('[data-action="segment"][data-value="1"]').click();
  assert.equal(await page.locator('.module-chip.on').count(),2);
  report.interactions.push('MRR/12-month arithmetic','localized numbers and retained inputs','slider keys do not navigate','keyboard Home/End','problem comparison','product stage selection','customer presets');
  await page.goto(url('business-plan','en','robot-evolution'));
  assert.equal(await page.locator('.robot-stage').count(),3);
  for(let i=0;i<3;i++){
   await page.locator(`[data-action="future"][data-value="${i}"]`).click();
   assert.equal(await page.locator(`[data-action="future"][data-value="${i}"]`).getAttribute('aria-pressed'),'true');
  }
  assert.match(await page.locator('.evolution-detail').innerText(),/Cooking robot/);
  await page.locator('[data-action="language"][data-value="ja"]').click();
  assert.match(await page.locator('.evolution-detail').innerText(),/調理ロボット/);
  await page.goto(url('business-plan','en','milestones'));
  assert.match(await page.locator('.status-road').innerText(),/Code running internally/);
  assert.match(await page.locator('.status-road').innerText(),/No external demo yet/);
  report.interactions.push('15M monthly rent / maximum revenue values fit','three robot generations / translated selection','running code and no external demo / no trial or Investor copy');
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
