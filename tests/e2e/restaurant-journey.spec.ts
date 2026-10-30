import {test,expect,type Page} from '@playwright/test';
async function screen(page:Page,path:string){await page.goto(path);await expect(page.getByRole('button',{name:'Làm mới',exact:true})).toBeVisible();}
async function advance(page:Page){const response=await page.request.post('/test/advance',{data:{ms:5000}});expect(response.ok()).toBe(true);await page.getByRole('button',{name:'Làm mới',exact:true}).click();}
test('actual POS KDS fake-executor and cash ledger journey keeps stable IDs',async({page})=>{
 await screen(page,'/pos');
 await page.getByRole('button',{name:'Cơm'}).click();
 await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
 await expect(page.locator('.toast')).toHaveText('Đã ghi nhận');
 await screen(page,'/kitchen');
 await page.getByRole('button',{name:'Sẵn sàng',exact:true}).click();
 await screen(page,'/fleet');
 await page.getByRole('button',{name:'Giữ một phần',exact:true}).click();
 await page.getByRole('button',{name:'Tạo chuyến giao',exact:true}).click();
 await advance(page);
 await page.getByRole('button',{name:'Đã xếp đồ',exact:true}).click();
 await advance(page);
 await page.getByRole('button',{name:'Đã giao',exact:true}).click();
 await expect(page.locator('.badge').filter({hasText:'completed'})).toBeVisible();
 await screen(page,'/checkout');
 await page.getByRole('button',{name:'Mở ca thu ngân',exact:true}).click();
 await page.getByRole('button',{name:'Chuẩn bị hóa đơn',exact:true}).click();
 await expect(page.getByText('Còn phải thu: 50.000 ₫')).toBeVisible();
 await page.getByRole('button',{name:'Xác nhận đã thu tiền mặt',exact:true}).click();
 await page.getByRole('button',{name:'Đóng hóa đơn',exact:true}).click();
 await expect(page.locator('.badge').filter({hasText:'closed'})).toBeVisible();
 const snapshots=await (await page.request.get('/snapshots')).json();
 expect(snapshots.filter((s:{ref:{kind:string};state:{status:string}})=>s.ref.kind==='payment'&&s.state.status==='captured')).toHaveLength(1);
});
test('CSV import preview and approval do not trigger a second physical action',async({page})=>{
 await screen(page,'/import');
 await page.getByLabel('Mã sự cố / đợt bảo trì').fill('maintenance-browser');
 await page.getByLabel('Dữ liệu CSV phiếu cũ').fill('sourceType,sourceSeries,sourceNumber,totalMinor,paidCashMinor,occurredAt,fulfilled\npaper,BROWSER,001,50000,50000,2026-10-30T00:00:00Z,true');
 await page.getByRole('button',{name:'Kiểm tra và xem tổng',exact:true}).click();
 await page.getByRole('button',{name:'Duyệt đúng bản đã xem',exact:true}).click();
 await page.getByRole('button',{name:'Áp dụng / tiếp tục',exact:true}).click();
 await expect(page.getByText('applied · 1',{exact:true})).toBeVisible();
 const snapshots=await (await page.request.get('/snapshots')).json();
 expect(snapshots.filter((s:{ref:{kind:string}})=>s.ref.kind==='historical-receipt')).toHaveLength(1);
});
