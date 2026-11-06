import {checkBrandAccessibility} from '../support/brand-accessibility';
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createSupabaseActor} from '../support/supabase-auth';
import {setupWave02} from '../support/wave02-db';
import {startCloud} from '../support/cloud-server';
let db:Awaited<ReturnType<typeof setupWave02>>,api:Awaited<ReturnType<typeof startCloud>>;
test.beforeAll(async()=>{db=await setupWave02();api=await startCloud({databaseUrl:process.env.DATABASE_URL!});});
test.afterAll(async()=>{await api?.close();await db?.close();});
let browserErrors:string[]=[];
test.beforeEach(async({page})=>{browserErrors=[];page.on('pageerror',error=>browserErrors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/hydration|did not match|Minified React/.test(message.text()))browserErrors.push(message.text());});});
test.afterEach(()=>{expect(browserErrors).toEqual([]);});
test('cloud login theme, local logo, keyboard focus, error and busy feedback',async({page})=>{
 await page.goto(api.url+'/login');await expect(page.locator('body')).toHaveCSS('background-color','rgb(7, 29, 33)');
 await expect(page.getByRole('link',{name:'MEKONIQ',exact:true}).locator('img')).toBeVisible();await checkBrandAccessibility(page);await page.screenshot({path:'.lab/brand-ui/source-final/cloud-login.png',fullPage:true});
 await page.getByLabel('Email',{exact:true}).focus();await expect(page.getByLabel('Email',{exact:true})).toHaveCSS('outline-style','solid');
 await page.getByLabel('Email',{exact:true}).fill('invalid@example.test');await page.getByLabel('Mật khẩu / Password',{exact:true}).fill('invalid-password');
 let release:()=>void=()=>{};const hold=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/v1/auth/login',async route=>{await hold;await route.fulfill({status:401,json:{code:'UNAUTHENTICATED'}});});
 await page.getByRole('button',{name:'Đăng nhập / Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Đang đăng nhập…'})).toBeDisabled();release();await expect(page.getByRole('main').getByRole('alert')).toContainText('Không đăng nhập được');await page.screenshot({path:'.lab/brand-ui/source-final/cloud-login-error.png',fullPage:true});
});

test('authenticated admin routes preserve navigation and deny an actor without configuration permission',async({page})=>{
 test.setTimeout(120000);
 const scope={organizationId:'brand-auth-'+randomUUID(),venueId:'venue'};const owner=await createSupabaseActor(db.admin,scope);const chef=await createSupabaseActor(db.admin,scope,'chef');
 try{
  await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'catalog','current',1,${db.admin.json({version:1,currency:'VND',items:[{id:'tea',name:'Trà',stationId:'bar',unitMinor:'20000',available:true}]})},'brand-public-menu')`;
  for(const route of ['','login','menu/'+scope.venueId+'?o='+scope.organizationId,'order/'+scope.venueId+'?o='+scope.organizationId,'table/invalid-brand-token']){await page.goto(api.url+'/'+route);await checkBrandAccessibility(page);for(const width of [390,800,1280]){await page.setViewportSize({width,height:900});await page.screenshot({path:'.lab/brand-ui/source-final/cloud-public-'+(route.split('/')[0]||'home')+'-'+width+'.png',fullPage:true});}}
  for(const user of [owner,chef]){await page.context().clearCookies();await page.goto(api.url+'/login');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Mật khẩu / Password',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Đăng nhập / Sign in',exact:true}).click();await page.waitForURL(api.url+'/admin/settings');
   if(user===chef){await expect(page.getByRole('heading',{name:'Không có quyền / Access denied'})).toBeVisible();await expect(page.getByRole('navigation')).toHaveCount(0);continue;}
   for(const route of ['settings','catalog','operations','promotions','customers','reservations','chain/configuration','chain/reports']){await page.goto(api.url+'/admin/'+route);await expect(page.getByRole('navigation')).toBeVisible();await expect(page.locator('body')).toHaveCSS('background-color','rgb(7, 29, 33)');await checkBrandAccessibility(page);for(const width of [390,800,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route).toBe(true);await page.screenshot({path:'.lab/brand-ui/source-final/cloud-admin-'+route.replaceAll('/','-')+'-'+width+'.png',fullPage:true});}}
  }
 }finally{await owner.cleanup();await chef.cleanup();}
});
