import {test,expect,type Page} from '@playwright/test';
// Runs after the other specs against the same fixture coordinator, so scope everything to the article holding this test's dish.
async function screen(page:Page,path:string){await page.goto(path);await expect(page.getByRole('button',{name:'Làm mới',exact:true})).toBeVisible();}
test('cancelling an unprepared dish reaches the station as a delta ticket it must acknowledge',async({page})=>{
 await screen(page,'/pos');
 await page.locator('.menu-item',{hasText:'Cơm'}).click();
 await page.locator('.menu-item',{hasText:'Cơm'}).click();
 await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
 const mine=page.locator('article.record',{hasText:'Cơm × 2'});
 await expect(mine).toBeVisible();
 await mine.getByLabel('Lý do').fill('khách đổi ý');
 await mine.getByRole('button',{name:'Hủy món',exact:true}).click();
 await expect(page.locator('article.record',{hasText:'Cơm × 1 (đã hủy 1)'})).toBeVisible();
 const move=page.locator('article.record',{hasText:'Cơm × 1'}).getByRole('button',{name:'Chuyển bàn',exact:true});
 if(await move.isEnabled()){await move.click();await expect(page.locator('.toast')).toHaveText('Đã ghi nhận');} // only when a free table exists in the shared fixture
 await screen(page,'/kitchen');
 await expect(page.getByText('HỦY × 1',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Đã nhận (ACK)',exact:true}).click();
 await expect(page.getByText('HỦY × 1',{exact:false})).toHaveCount(0);
 const snapshots=await (await page.request.get('/snapshots')).json();
 expect(snapshots.filter((s:{ref:{kind:string};state:{status:string}})=>s.ref.kind==='kitchen-delta'&&s.state.status==='acknowledged')).toHaveLength(1);
});
test('a version conflict keeps the unsent draft and says a newer version exists',async({page})=>{
 await screen(page,'/pos');
 const mine=page.locator('article.record',{hasText:'Cơm × 1'});
 await expect(mine).toBeVisible();
 await mine.getByLabel('Lý do').fill('bản nháp của tôi');
 const snapshots=await (await page.request.get('/snapshots')).json();
 const order=snapshots.find((s:{ref:{kind:string};state:{status:string;lines:{name:string}[]}})=>s.ref.kind==='order'&&s.state.status==='open'&&s.state.lines.some(l=>l.name==='Cơm'));
 // another device amends the same order after this screen was rendered
 const other=await page.request.post('/commands',{data:{type:'Order.Amend',operationId:'e2e-other-device',payload:{orderId:order.ref.id,items:[{itemId:'tea',quantity:'1'}]},expectedVersion:order.version}});
 expect((await other.json()).status).toBe('accepted');
 await mine.getByRole('button',{name:'Hủy món',exact:true}).click();
 await expect(page.locator('.toast')).toHaveText('VERSION_CONFLICT');
 const refreshed=page.locator('article.record',{hasText:'Cơm × 1'});
 await expect(refreshed.getByText('Đã có bản mới hơn')).toBeVisible();
 await expect(refreshed.getByLabel('Lý do').first()).toHaveValue('bản nháp của tôi');
});
