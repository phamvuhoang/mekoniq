const c = require('./common.cjs');
(async () => {
  const labUrl = process.env.GUIDE_LAB_PUBLIC_URL;
  if (!labUrl || new URL(labUrl).protocol !== 'https:') throw new Error('HTTPS_LAB_PUBLIC_URL_REQUIRED');
  const manifest=[],browser=await c.launch();
  try {
    const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
    await page.goto('https://www.mekoniq.app/login',{waitUntil:'domcontentloaded'});
    await c.expect(page.getByLabel('Email',{exact:true})).toBeVisible();
    await c.expect(page.getByRole('button',{name:'Đăng nhập / Sign in',exact:true})).toBeVisible();
    await c.capture(page,manifest,{id:'source-production-login',title:'MEKONIQ: đăng nhập production',repo:'source',environment:'production-public',scope:'Public production login only, anonymous fresh browser; no sign-in, no customer or admin data. revision identifies repository snapshot accompanying guide, not an independently verified deployment commit.'});
    await page.goto(labUrl,{waitUntil:'domcontentloaded'});
    await c.expect(page.locator('h1').first()).toBeVisible();
    await c.capture(page,manifest,{id:'lab-public-home',title:'MEKONIQ Lab: trang công khai',repo:'lab',environment:'production-public',scope:'Public Lab landing page only, anonymous fresh browser. revision identifies repository snapshot accompanying guide, not an independently verified deployment commit.'});
  }finally{await browser.close();c.saveManifest('public',manifest);}
})().catch(()=>{console.error('Public capture failed; verify public URLs and visible selectors.');process.exitCode=1;});
