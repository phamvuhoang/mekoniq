import {checkBrandAccessibility} from '../support/brand-accessibility';
import {test,expect} from '@playwright/test';
let browserErrors:string[]=[];
test.beforeEach(async({page})=>{browserErrors=[];page.on('pageerror',error=>browserErrors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/hydration|did not match|Minified React/.test(message.text()))browserErrors.push(message.text());});});
test.afterEach(()=>{expect(browserErrors).toEqual([]);});
test('tablet brand uses local artwork, dark first paint and touch targets across routes',async({page})=>{
 await page.goto('/device');
 await expect(page.locator('body')).toHaveCSS('background-color','rgb(7, 29, 33)');
 await expect(page.locator('.brand img')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [390,800,1280]){await page.setViewportSize({width,height:1280});if(width===390){await expect(page.locator('.brand img')).toHaveCSS('width','40px');await expect.poll(()=>page.locator('.brand img').evaluate(n=>(n as HTMLImageElement).currentSrc)).toContain('MEKONIQ_Icon_Transparent.svg');}expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await expect(page.getByRole('button',{name:'Xóa dữ liệu',exact:true})).toBeDisabled();
 const height=await page.getByRole('button',{name:'Làm mới',exact:true}).evaluate(n=>n.getBoundingClientRect().height);expect(height).toBeGreaterThanOrEqual(56);
 await page.route('**/session',route=>route.fulfill({status:401,json:{code:'ENROLLMENT_REQUIRED'}}));await page.goto('/device');await expect(page.locator('.enrollment')).toBeVisible();await checkBrandAccessibility(page);await page.screenshot({path:'.lab/brand-ui/source-final/tablet-enrollment.png',fullPage:true});
});

test('all tablet route surfaces remain responsive, offline stays readable and print uses ink',async({page})=>{
 test.setTimeout(120000);
 const routes=['device','isolated','pos','kitchen','fleet','robot-setup','checkout','cash','print','inventory','staff','reports','guest-requests','kiosk','robot-screen','settings','recovery','import','reconciliation','models','recipes','purchasing','stocktake','inventory-reports','promotions','customers','reservations','invoices','maintenance','robot'];
 await page.setViewportSize({width:800,height:1280});
 for(const route of routes){await page.goto('/'+route+(route==='kiosk'?'?actor=kiosk':route==='robot-screen'?'?actor=robot-display':''));await expect(page.getByRole('button',{name:'Làm mới',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route).toBe(true);await checkBrandAccessibility(page);for(const width of [390,800,1280]){await page.setViewportSize({width,height:1280});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' '+width).toBe(true);await page.screenshot({path:'.lab/brand-ui/source-final/tablet-'+route+'-'+width+'.png',fullPage:true});}}
 await page.goto('/device?fixture=local-only');await expect(page.locator('.offline-banner').first()).toBeVisible();await expect(page.locator('.offline-banner').first()).toContainText('Không kết nối');await page.screenshot({path:'.lab/brand-ui/source-final/tablet-isolated.png',fullPage:true});
 await page.emulateMedia({media:'print'});await expect(page.locator('body')).toHaveCSS('background-color','rgb(246, 248, 244)');await expect(page.locator('dt').first()).toHaveCSS('color','rgb(20, 48, 52)');
});

test('snapshot polling preserves keyboard focus and an unsent field draft',async({page})=>{
 await page.goto('/inventory');
 const field=page.getByLabel('Mã nguyên liệu',{exact:true});await field.fill('unsent-draft');await expect(field).toBeFocused();
 const response=await page.request.post('http://127.0.0.1:3451/commands',{headers:{'x-test-actor':'manager'},data:{type:'Ingredient.Upsert',operationId:'brand-focus-ingredient',payload:{ingredientId:'brand-snapshot',name:'Snapshot update',baseUnit:'piece'}}});expect((await response.json()).status).toBe('accepted');
 await expect(page.locator('.toast')).toContainText('Bản nháp vẫn được giữ',{timeout:10000});await expect(field).toBeFocused();await expect(field).toHaveValue('unsent-draft');await expect(field).toHaveCSS('outline-style','solid');await page.screenshot({path:'.lab/brand-ui/source-final/tablet-keyboard-draft.png',fullPage:true});
});
