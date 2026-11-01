import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
async function screen(page:Page,path:string){await page.goto(path);await expect(page.getByRole('button',{name:'Làm mới',exact:true})).toBeVisible();}
test('staff hand out a guest link, see the guest call and acknowledge it without closing a bill',async({page})=>{
 // An empty seating on table-2 (closed again at the end) so the shared fixture coordinator holds no extra orders for later specs.
 const sessionId='guest-e2e-'+randomUUID(),staff=(type:string,payload:object)=>page.request.post('http://127.0.0.1:3451/commands',{headers:{'x-test-actor':'cashier'},data:{type,payload,operationId:randomUUID()}});
 expect((await (await staff('Session.Open',{sessionId,tableId:'table-2'})).json()).status).toBe('accepted');
 await screen(page,'/guest-requests');
 const seat=page.locator('article.record').filter({hasText:'Bàn 02'}).filter({has:page.getByRole('button',{name:'Tạo link QR cho khách',exact:true})});
 await seat.getByRole('button',{name:'Tạo link QR cho khách',exact:true}).click();
 const link=seat.locator('code').filter({hasText:'/table/'});await expect(link).toBeVisible();
 // The guest side of the fixture coordinator: the same envelope the guest API builds (Guest.* type + the decoded signed token).
 const guestToken=JSON.parse(Buffer.from(String(await link.textContent()).replace('/table/',''),'base64url').toString());
 const call=await page.request.post('http://127.0.0.1:3451/commands',{headers:{'x-test-actor':'guest'},data:{type:'Guest.CallStaff',payload:{guestToken},operationId:randomUUID()}});
 expect((await call.json()).status).toBe('accepted');
 const staffOnly=await page.request.post('http://127.0.0.1:3451/commands',{headers:{'x-test-actor':'guest'},data:{type:'Bill.Close',payload:{billId:'any',guestToken},operationId:randomUUID()}});
 expect((await staffOnly.json()).code).toBe('FORBIDDEN');
 await page.getByRole('button',{name:'Làm mới',exact:true}).click();
 await expect(page.getByText(/Gọi nhân viên/).first()).toBeVisible();
 await page.getByRole('button',{name:'Đã xử lý',exact:true}).first().click();
 await expect(page.locator('.toast')).toHaveText('Đã ghi nhận');
 const snapshots=await (await page.request.get('/snapshots')).json() as {ref:{kind:string};state:{status:string}}[];
 expect(snapshots.filter(s=>s.ref.kind==='service-call').every(s=>s.state.status==='acknowledged')).toBe(true);
 expect(snapshots.filter(s=>s.ref.kind==='bill'&&s.state.status==='closed')).toHaveLength(0);
 expect((await (await staff('Session.Close',{sessionId})).json()).status).toBe('accepted');
});
