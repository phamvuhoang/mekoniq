import { test, expect } from '@playwright/test';

const routes = ['design', 'restaurant', 'scenarios', 'twin', 'results', 'deployment'];
test('canonical theme, original artwork and keyboard focus', async ({ page }) => {
  await page.goto('/#design');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(7, 29, 33)');
  const brand = page.getByRole('link', { name: 'MEKONIQ Robot Lab', exact: true });
  await expect(brand).toBeVisible();
  await expect(brand.locator('.brand-horizontal')).toHaveAttribute('src', '/brand/assets/MEKONIQ_Horizontal_White_Transparent_v2.png');
  await expect(brand.locator('.brand-horizontal')).toHaveCSS('width', '180px');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(brand).toBeFocused();
  await expect(brand).toHaveCSS('outline-color', 'rgb(99, 220, 197)');
});

for (const control of ['skip', 'brand'] as const) test(`startup health rendering preserves ${control} keyboard position and native activation`, async ({page}, info) => {
  let release!:()=>void, captured!:()=>void, first=true;
  const gate=new Promise<void>(done=>release=done), responseReady=new Promise<void>(done=>captured=done);
  await page.route('**/lab/v1/health',async route=>{
    if(!first||route.request().method()!=='GET'){await route.continue();return;}
    first=false;const response=await route.fetch();
    info.annotations.push({type:'test-response-scheduling-input',description:`Actual loopback startup health HTTP ${response.status()}, held until ordinary keyboard focus; not qualification evidence.`});
    captured();await gate;await route.fulfill({response});
  });
  try {
    await page.goto(control==='skip'?'/#design':'/#restaurant');
    const skip=page.locator('.skip-link'),brand=page.getByRole('link',{name:'MEKONIQ Robot Lab',exact:true}),target=control==='skip'?skip:brand;
    await expect(brand).toBeVisible();await responseReady;
    await page.keyboard.press('Tab');await expect(skip).toBeFocused();
    if(control==='brand'){await page.keyboard.press('Tab');await expect(brand).toBeFocused();}
    const original=await target.elementHandle();expect(original).not.toBeNull();release();
    await expect.poll(()=>original!.evaluate(node=>node.isConnected)).toBe(false);
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('href',control==='skip'?'#workspace':'#design');
    await page.keyboard.press('Tab');await expect(control==='skip'?brand:page.getByRole('button',{name:'VI',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(target).toBeFocused();
    if(control==='brand')await expect(brand).toHaveCSS('outline-color','rgb(99, 220, 197)');
    await page.keyboard.press('Enter');await expect(page).toHaveURL(control==='skip'?/#workspace$/:/#design$/);
    await expect(control==='skip'?page.locator('#workspace'):brand).toBeFocused();
  } finally {release();}
});

for (const width of [390, 1024, 1512]) test(`six workspaces and three locales at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.url().includes('/brand/') && !response.ok()) failures.push(response.url()); });
  await page.goto('/');
  for (const language of ['VI', 'JA', 'EN']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    for (const route of routes) {
      await page.locator(`.nav-item[href="#${route}"]`).click();
      await expect(page.locator(`.nav-item[href="#${route}"]`)).toHaveAttribute('aria-current', 'page');
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator(width < 768 ? '.brand-compact' : '.brand-horizontal')).toBeVisible();
      if (language === 'EN') await page.screenshot({ path: `${process.env.LAB_BRAND_EVIDENCE_DIR ?? testInfo.outputDir}/lab-${route}-${width}.png`, fullPage: true });
    }
  }
  expect(await page.evaluate(() => document.fonts.check('14px "Be Vietnam Pro"'))).toBe(true);
  expect(failures).toEqual([]);
});

test('primary, disabled and unknown states retain readable semantics', async ({ page }) => {
  await page.goto('/#design');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.locator('#chassis').selectOption('valetudo');
  const disabled = page.locator('#battery');
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS('opacity', '1');
  await page.locator('.nav-item[href="#scenarios"]').click();
  const unavailable = page.getByRole('button', { name: 'Create run', exact: true });
  await expect(unavailable).toBeDisabled();
  await expect(unavailable).toHaveCSS('background-color', 'rgb(16, 47, 52)');
  await expect(unavailable).toHaveCSS('color', 'rgb(168, 194, 198)');
  await page.locator('.nav-item[href="#deployment"]').click();
  const primary = page.getByRole('button', { name: 'Export draft candidate', exact: true });
  await expect(primary).toHaveCSS('background-color', 'rgb(185, 251, 117)');
  await primary.hover();
  await expect(primary).toHaveCSS('background-color', 'rgb(185, 251, 117)');
  await expect(primary).toHaveCSS('color', 'rgb(7, 29, 33)');
  await page.locator('.nav-item[href="#twin"]').click();
  await expect(page.getByTestId('preflight')).toContainText('fail');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
});
