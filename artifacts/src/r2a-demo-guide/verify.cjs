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
const artifact = path.resolve(here, '../../mekoniq-r2a-demo-guide.html');
const staticOnly = process.argv.includes('--static');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receipt = {schemaVersion:1, recordedAt:new Date().toISOString(), artifact:path.basename(artifact), mode:staticOnly?'static':'browser', checks:[], passed:false};
const check = (name, details=true) => receipt.checks.push({name, details, passed:true});

(async () => {
  const bytes = fs.readFileSync(artifact), html = bytes.toString();
  const build = JSON.parse(fs.readFileSync(path.join(here, 'build-manifest.json')));
  const facts = JSON.parse(fs.readFileSync(path.join(here, 'facts.json')));
  receipt.sha256 = sha(bytes);
  assert.equal(receipt.sha256, build.sha256);
  for (const [name, digest] of Object.entries(build.inputs)) assert.equal(sha(fs.readFileSync(path.join(here,name))), digest, 'Changed input '+name);
  assert(!/<script[^>]+src=|<link[^>]+(?:href|rel)=|<iframe|<img[^>]+src="(?!data:)/i.test(html), 'External rendering dependency');
  assert(!/sb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}|BEGIN (?:RSA |EC )?PRIVATE KEY|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(html), 'Possible key/token embedded');
  for (const marker of ['RUNTIME_PIN_MISMATCH','MUJOCO_CAPACITY','LOOPBACK_BLOCKED','not_calibrated','1880/1884','Chạy lại cùng đầu vào','G-CLOUD1 = tested','cloud-run','71,3',facts.cloud.url,facts.runtimeSourceCommit,facts.labCommit]) assert(html.includes(marker), 'Missing scope marker '+marker);
  assert.equal(facts.cloud.qualificationGate.status, 'tested');
  assert.equal(facts.cloud.qualificationGate.basis, 'cloud-run supplemental guard');
  assert.equal(facts.cloud.httpStepWallMs, 71313);
  assert.equal(facts.humanAcceptance, false);
  assert.equal(facts.productionLabStatus, 'READY');
  assert.equal(facts.productionSourceStatus, 'READY');
  assert.notEqual(facts.labCommit, facts.productionLabCommit);
  assert.equal(facts.cloud.browserSmoke, 'passed');
  assert.equal(facts.manualBrowserChecks.status, 'not_run');
  const productionBytes = fs.readFileSync(path.resolve(here, '../../..', facts.productionBrowserSmoke.evidenceFile));
  assert.equal(sha(productionBytes), facts.productionBrowserSmoke.evidenceSha256);
  const production = JSON.parse(productionBytes);
  assert.equal(production.status, 'passed');
  assert.equal(production.accepted, false);
  assert.equal(production.manualBrowserCheck, 'not_run');
  assert.equal(production.runtimePin, facts.runtimeSourceCommit);
  assert.equal(production.labCommit, facts.productionLabCommit);
  assert.equal(production.sourceCommit, facts.productionSourceCommit);
  assert.equal(production.run.tick, facts.productionBrowserSmoke.finalTick);
  assert.equal(Number(production.run.served), facts.productionBrowserSmoke.served);
  assert.equal(production.run.wallMs, facts.productionBrowserSmoke.wallMs);
  assert(production.cleanup.length > 0 && production.cleanup.every(x => x.archived));
  assert.deepEqual(production.pageErrors, []);
  assert(html.includes(facts.productionLabCommit));
  assert(html.includes(facts.productionSourceCommit));
  assert(!/chờ bản pin mới|Cần cập nhật Lab production|neither main branch has been pushed|new pin pending|production đang chờ kết quả|production origin awaits results/.test(html), 'Stale deployment/browser status');
  for (const lang of ['vi','ja','en']) assert.equal([...html.matchAll(new RegExp('class="i18n" lang="'+lang+'"','g'))].length, build.translationTriples);
  for (const command of build.shellCommands) {
    const result = spawnSync('bash', ['-n'], {input:command, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
  for (const im of build.images) {
    assert.equal(sha(fs.readFileSync(path.join(here, im.file))), im.sha256);
    assert(html.includes('data-zoom="'+im.id+'"'));
    const original = path.resolve(here, '../../..', im.sourceEvidence);
    assert.equal(sha(fs.readFileSync(original)), im.sha256, 'Original evidence screenshot differs');
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML ids');
  for (const match of html.matchAll(/\bhref="#([^"]+)"/g)) assert(ids.includes(match[1]), 'Broken anchor '+match[1]);
  for (const match of html.matchAll(/\bhref="(\.\.\/docs\/[^"#]+)"/g)) assert(fs.existsSync(path.resolve(path.dirname(artifact),match[1])), 'Missing source link '+match[1]);
  check('Artifact/input/original screenshot hashes, translation triples, scope markers, source links, offline dependencies, secret scan and shell syntax', {translations:build.translationTriples, images:build.images.length, shellBlocks:build.shellCommands.length});
  if (staticOnly) { receipt.passed = true; return; }

  const pw = createRequire(path.resolve(here, '../../../package.json'))('@playwright/test');
  const options = {headless:true};
  if (process.env.PLAYWRIGHT_CHROMIUM) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
  else if (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) options.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await pw.chromium.launch(options);
  receipt.browser = browser.version();
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {if (/^https?:/.test(r.url())) requests.push(r.url());});
    await page.route(/^https?:/, r => r.abort());
    await page.goto(pathToFileURL(artifact).href+'?lang=vi');
    assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
    assert.equal(await page.locator('.feature').count(), 6);
    assert.equal(await page.locator('.shot').count(), 4);
    assert.equal(await page.locator('#demo .demo-steps>.step').count(), 5);
    for (const lang of ['vi','ja','en']) {
      await page.locator(`[data-lang-switch="${lang}"]`).click();
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      assert.equal(await page.locator(`[data-lang-switch="${lang}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator(`.i18n:not([lang="${lang}"]):visible`).count(), 0);
      assert.equal(await page.locator('.shot img').first().getAttribute('alt'), await page.locator('.shot img').first().getAttribute('data-alt-'+lang));
      for (const width of [1440,1024,768,390,320]) {
        await page.setViewportSize({width,height:1000});
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow: '+lang+' / '+width);
      }
    }
    check('VI/JA/EN text and image labels; no horizontal overflow at 320/390/768/1024/1440 px');
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-lang-switch="vi"]').click();
    assert(await page.locator('#route-local').isVisible());
    assert(!(await page.locator('#route-web').isVisible()));
    await page.locator('#tab-local').focus();
    await page.keyboard.press('ArrowRight');
    assert(await page.locator('#route-web').isVisible());
    assert.equal(await page.locator('#tab-web').getAttribute('aria-selected'), 'true');
    assert(await page.locator('#tab-web').evaluate(e => e === document.activeElement));
    await page.keyboard.press('Home');
    assert(await page.locator('#route-local').isVisible());
    await page.locator('[data-route-link="web"]').click();
    assert(await page.locator('#route-web').isVisible());
    await page.locator('#tab-local').click();
    check('Web/local buttons, arrow/Home keyboard navigation, focus and hero links');

    const copy = page.locator('[data-copy="launch-mujoco"]');
    const expected = await page.locator('#launch-mujoco').textContent();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async t => {window.__copied=t;}}}));
    await copy.click();
    assert.equal(await page.evaluate(() => window.__copied), expected);
    assert.equal(await page.locator('#toast').textContent(), 'Đã sao chép.');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async () => {throw new Error('denied');}}}));
    await copy.click();
    assert.equal(await page.evaluate(() => getSelection().toString()), expected);
    check('Copy preserves exact command bytes; denied clipboard selects text for manual copy');

    for (const box of await page.locator('.prep-check').all()) await box.check();
    assert.equal(await page.locator('#prep-count').textContent(), '4 / 4');
    await page.locator('[data-reset-checks]').click();
    assert.equal(await page.locator('#prep-count').textContent(), '0 / 4');
    check('Preparation checklist counts and resets without marking test evidence');

    for (const zoom of await page.locator('[data-zoom]').all()) {
      await zoom.click();
      assert(await page.locator('#lightbox').isVisible());
      assert(await page.locator('#lightbox-image').evaluate(i => i.naturalWidth === 1440 && i.naturalHeight === 900));
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#lightbox').isVisible()));
      assert(await zoom.evaluate(e => e === document.activeElement));
    }
    check('All four original images open at real dimensions; Escape restores keyboard focus');

    await page.emulateMedia({media:'print'});
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    assert(await page.locator('#route-local').isVisible());
    assert(await page.locator('#route-web').isVisible());
    assert.equal(await page.locator('details:not([open])').count(), 0);
    assert.equal(await page.locator('.copy:visible').count(), 0);
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('details[open]').count(), 0);
    await page.emulateMedia({media:'screen'});
    check('Print reveals both routes and all disclosure content; state is restored afterwards');

    // A prior Chrome157 capture from the print/resize test page contained a duplicated raster
    // near y=930 although its DOM had one toolbar. Capture deliverables from fresh pages,
    // without print-media transitions, and verify the source layout before taking the PNG.
    const preview = async (file, width) => {
      const capture = await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
      capture.on('pageerror', e => errors.push(e.message));
      capture.on('request', r => {if (/^https?:/.test(r.url())) requests.push(r.url());});
      await capture.route(/^https?:/, r => r.abort());
      await capture.goto(pathToFileURL(artifact).href+'?lang=vi');
      await capture.evaluate(async () => {
        await document.fonts.ready;
        await document.querySelector('.hero-shot img').decode();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      assert.equal(await capture.locator('.toolbar').count(), 1);
      assert.equal(await capture.locator('.mobile-brand').count(), 1);
      assert.equal(await capture.locator('[data-lang-switch]:visible').count(), 3);
      assert.equal(await capture.locator('.status-strip .status:visible').count(), 3);
      assert.equal(await capture.locator('.toolbar').evaluate(e => Math.round(e.getBoundingClientRect().top)), 0);
      if (width < 800) assert.equal(await capture.locator('.mobile-brand:visible').count(), 1);
      await capture.screenshot({path:path.join(here,file)});
      await capture.close();
    };
    await preview('desktop-preview.png',1440);
    await preview('mobile-preview.png',390);
    check('Fresh-page previews contain one toolbar at the top, one mobile brand and three status chips', {strategy:'fresh page per viewport; no print-media transitions'});
    const noJS = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    const staticPage = await noJS.newPage();
    await staticPage.goto(pathToFileURL(artifact).href);
    assert(await staticPage.locator('noscript').isVisible());
    assert(await staticPage.locator('#route-local').isVisible());
    assert(await staticPage.locator('#route-web').isVisible());
    assert.equal(await staticPage.locator('.feature:visible').count(), 6);
    assert(await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await noJS.close();
    check('No-JavaScript fallback keeps both demo routes and all features readable');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    check('Zero browser errors or HTTP resource requests; no runtime or operational services started');
    receipt.passed = true;
  } finally { await browser.close(); }
})().catch(e => {receipt.error=e.stack;process.exitCode=1;}).finally(() => {
  fs.writeFileSync(path.join(here,staticOnly?'verification-static.json':'verification.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({passed:receipt.passed,mode:receipt.mode,checks:receipt.checks.length,error:receipt.error}));
});
