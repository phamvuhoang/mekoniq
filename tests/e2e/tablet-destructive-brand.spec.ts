import {test,expect,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {Snapshot} from '../../packages/contracts/src/index';
test('populated unpaid bills and bookings keep destructive styling while original cancellation commands complete',async({page})=>{
 test.setTimeout(90000);
 const base='http://127.0.0.1:3451';
 const api=async(type:string,payload:object)=>{const response=await page.request.post(base+'/commands',{headers:{'x-test-actor':'manager'},data:{type,payload,operationId:randomUUID()}});const result=await response.json();expect(result.status,JSON.stringify(result)).toBe('accepted');return result;};
 const snapshots=async()=>await(await page.request.get(base+'/snapshots')).json() as Snapshot[];
 const initial=await snapshots(),free=initial.find(s=>s.ref.kind==='table'&&!s.state.activeSessionId);
 let sessionId:string;
 if(free){sessionId='brand-void-'+randomUUID();await api('Session.Open',{sessionId,tableId:free.ref.id});}
 else {const open=initial.find(s=>s.ref.kind==='session'&&s.state.status==='open'&&!s.state.frozenBillId);expect(open).toBeTruthy();sessionId=open!.ref.id;}
 const session=(await snapshots()).find(s=>s.ref.kind==='session'&&s.ref.id===sessionId)!;
 await api('Order.Place',{sessionId,tableId:session.state.tableId,menuVersion:1,items:[{itemId:'rice',quantity:'1'}]});
 const prepared=await api('Bill.Prepare',{sessionId}),billId=String(prepared.value.billId),bookingId='brand-booking-'+randomUUID();
 const startsAt=new Date(Date.now()+86400000).toISOString(),endsAt=new Date(Date.now()+90000000).toISOString();
 await api('Booking.Create',{bookingId,tableId:'table-1',startsAt,endsAt,partySize:2,name:'Brand review',depositRequiredMinor:'0'});
 const assertDanger=async(control:Locator)=>{
  await expect(control).toBeVisible();
  const appearance=()=>control.evaluate(n=>{const s=getComputedStyle(n);return {color:s.color,border:s.borderTopColor,background:s.backgroundColor};});
  expect.soft(await appearance()).toEqual({color:'rgb(255, 170, 160)',border:'rgb(255, 170, 160)',background:'rgb(13, 43, 46)'});
  await control.hover();expect.soft((await appearance()).color).toBe('rgb(255, 170, 160)');expect.soft((await appearance()).background).not.toBe('rgb(185, 251, 117)');
  await control.focus();await expect(control).toHaveCSS('outline-style','solid');
 };
 const cancel=async(control:Locator,type:string,payload:object)=>{
  let release=()=>{};const hold=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/commands',async route=>{if(route.request().postDataJSON().type===type)await hold;await route.continue();});
  const sent=page.waitForRequest(r=>r.url().endsWith('/commands')&&r.postDataJSON().type===type);
  const received=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().postDataJSON().type===type);
  await control.click();expect((await sent).postDataJSON()).toMatchObject({type,payload});
  await expect(control).toBeDisabled();await expect(control).toHaveCSS('color','rgb(168, 194, 198)');await expect(control).toHaveCSS('background-color','rgb(16, 47, 52)');
  release();expect((await(await received).json()).status).toBe('accepted');await page.unroute('**/commands');
 };
 await page.goto('/checkout');
 const bill=page.locator('article.record').filter({has:page.locator('strong',{hasText:billId})});
 const voidButton=bill.getByRole('button',{name:'Hủy hóa đơn (chưa thu tiền)',exact:true});await assertDanger(voidButton);
 await bill.getByLabel('Lý do hủy hóa đơn',{exact:true}).fill('brand review void');
 await page.screenshot({path:'.lab/brand-ui/source-final/tablet-checkout-populated-danger.png',fullPage:true});
 await cancel(voidButton,'Bill.Void',{billId,reason:'brand review void'});
 await expect.poll(async()=> (await snapshots()).find(s=>s.ref.kind==='bill'&&s.ref.id===billId)?.state.status).toBe('voided');
 await page.goto('/reservations');
 const booking=page.locator('article.record').filter({has:page.locator('strong',{hasText:'Brand review'})});
 const cancelButton=booking.getByRole('button',{name:'Hủy đặt bàn',exact:true});await assertDanger(cancelButton);
 await booking.getByLabel('Lý do hủy',{exact:true}).fill('brand review cancel');
 await page.screenshot({path:'.lab/brand-ui/source-final/tablet-reservations-populated-danger.png',fullPage:true});
 await cancel(cancelButton,'Booking.Cancel',{bookingId,reason:'brand review cancel'});
 await expect.poll(async()=> (await snapshots()).find(s=>s.ref.kind==='booking'&&s.ref.id===bookingId)?.state.status).toBe('cancelled');
});
test('ordinary text links use Aqua underline while navigation retains its current treatment',async({page})=>{
 await page.goto('/settings');await expect(page.getByRole('navigation')).toBeVisible();
 // A plain anchor verifies the adapter without introducing a product route or changing navigation.
 await page.locator('main').evaluate(main=>{const link=document.createElement('a');link.href='/device';link.textContent='Text-link fixture';main.append(link);});
 const link=page.getByRole('link',{name:'Text-link fixture',exact:true});await expect(link).toHaveCSS('color','rgb(99, 220, 197)');await expect(link).toHaveCSS('text-decoration-line','underline');
 const nav=page.getByRole('navigation').getByRole('link',{name:'Thiết bị',exact:true});await expect(nav).toHaveCSS('color','rgb(185, 251, 117)');await expect(nav).toHaveCSS('text-decoration-line','none');
 const manage=page.locator('.management-links a').first();await expect(manage).toHaveCSS('color','rgb(185, 251, 117)');await expect(manage).toHaveCSS('text-decoration-line','none');
});
