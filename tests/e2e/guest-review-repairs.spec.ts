import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
test('staff opens a guest seating without POS and kiosk accepted cart renders empty',async({page})=>{
 const lab='guest-fix-'+randomUUID().slice(0,8),base='http://127.0.0.1:3451';
 const api=async(type:string,payload:object)=>(await page.request.post(base+'/commands',{headers:{'x-test-actor':'manager','x-test-lab':lab},data:{type,payload,operationId:randomUUID()}})).json();
 const snapshots=async()=>(await page.request.get(base+'/snapshots',{headers:{'x-test-lab':lab}})).json();
 const config=(await snapshots()).find((s:{ref:{kind:string}})=>s.ref.kind==='configuration');
 const revision=config.state.revision+1,features=Object.fromEntries(Object.entries(config.state.features).map(([k,v])=>[k,{status:k==='pos.order'?'disabled':(v as {status:string}).status,revision}]));
 expect((await api('Configuration.Apply',{revision,features})).status).toBe('accepted');
 await page.goto('/guest-requests?lab='+lab);
 const free=page.locator('article.record').filter({hasText:'Bàn 01'});
 await free.getByRole('button',{name:'Mở phiên bàn',exact:true}).click();
 await free.getByRole('button',{name:'Tạo mã kiosk',exact:true}).click();
 const token=await free.locator('code').textContent();expect(token).toBeTruthy();
 expect((await snapshots()).filter((s:{ref:{kind:string}})=>s.ref.kind==='order')).toHaveLength(0);
 await page.goto('/kiosk?actor=kiosk&lab='+lab);
 await page.getByLabel('Mã kiosk do nhân viên cấp').fill(token!);
 await page.getByRole('button',{name:'Bắt đầu',exact:true}).click();
 await page.getByRole('button',{name:/^Trà/}).click();
 const sent=page.waitForResponse(r=>r.url().endsWith('/commands'));
 await page.getByRole('button',{name:'Gửi món',exact:true}).click();expect((await (await sent).json()).status).toBe('accepted');
 await expect(page.locator('.cart-line')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Gửi món',exact:true})).toBeDisabled();
 expect((await snapshots()).filter((s:{ref:{kind:string}})=>s.ref.kind==='order')).toHaveLength(1);
 // A committed order whose reply is lost retains its draft and operation id; retry receives the original receipt.
 const operations:string[]=[];let lose=true,release!:()=>void;const replyHeld=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/commands',async route=>{
  const body=route.request().postDataJSON();if(body.type!=='Guest.PlaceOrder'){await route.continue();return;}
  operations.push(body.operationId);const response=await route.fetch();
  if(lose){lose=false;await replyHeld;await route.fulfill({response,json:{...await response.json(),status:'unknown',ack:'none'}});}else await route.fulfill({response});
 });
 await page.getByRole('button',{name:/^Trà/}).click();await page.getByRole('button',{name:'Gửi món',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Trà/})).toBeDisabled();release();
 await expect(page.locator('.toast')).toContainText('Chưa rõ');await expect(page.locator('.cart-line')).toHaveCount(1);
 await page.getByRole('button',{name:'Gửi món',exact:true}).click();await expect(page.locator('.cart-line')).toHaveCount(0);
 expect(operations).toHaveLength(2);expect(operations[0]).toBe(operations[1]);
 expect((await snapshots()).filter((s:{ref:{kind:string}})=>s.ref.kind==='order')).toHaveLength(2);
 await page.unroute('**/commands');
 // The same accepted-draft path is used by the paired robot's screen.
 expect((await api('Robot.PairDisplay',{deviceId:'device-robot',robotId:'sim-1'})).status).toBe('accepted');
 expect((await api('Mission.Create',{robotId:'sim-1',target:'table-1'})).status).toBe('accepted');
 await page.goto('/robot-screen?actor=robot-display&lab='+lab);
 await page.getByRole('button',{name:/^Trà/}).click();await page.getByRole('button',{name:'Gửi món',exact:true}).click();
 await expect(page.locator('.cart-line')).toHaveCount(0);await expect(page.getByRole('button',{name:'Gửi món',exact:true})).toBeDisabled();
 expect((await snapshots()).filter((s:{ref:{kind:string}})=>s.ref.kind==='order')).toHaveLength(3);
 // Occupied tables offer links, not another seating. Disabled sessions prevent opening free tables.
 await page.goto('/guest-requests?lab='+lab);await expect(page.locator('article.record').filter({hasText:'Bàn 01'}).getByRole('button',{name:'Mở phiên bàn',exact:true})).toHaveCount(0);
});

for(const mode of ['robot-only','sessions-disabled'])test('guest seating surface follows '+mode+' policy',async({page})=>{
 const lab='seating-'+randomUUID().slice(0,8),base='http://127.0.0.1:3451',headers={'x-test-actor':'manager','x-test-lab':lab};
 const config=(await (await page.request.get(base+'/snapshots',{headers})).json()).find((s:{ref:{kind:string}})=>s.ref.kind==='configuration');
 const revision=config.state.revision+1,enabled=mode==='robot-only'?['sessions','catalog','robot.order']:['guest.call'];
 const features=Object.fromEntries(Object.keys(config.state.features).map(k=>[k,{status:enabled.includes(k)?'enabled':'disabled',revision}]));
 const applied=await (await page.request.post(base+'/commands',{headers,data:{type:'Configuration.Apply',payload:{revision,features},operationId:randomUUID()}})).json();expect(applied.status,applied.code).toBe('accepted');
 await page.goto('/guest-requests?lab='+lab);await expect(page.getByRole('heading',{name:'Yêu cầu của khách',exact:true,level:2})).toBeVisible();
 if(mode==='robot-only'){
  await page.locator('article.record').filter({hasText:'Bàn 01'}).getByRole('button',{name:'Mở phiên bàn',exact:true}).click();
  await expect(page.locator('.toast')).toHaveText('Đã ghi nhận');
 }else await expect(page.getByRole('button',{name:'Mở phiên bàn',exact:true})).toHaveCount(0);
});
