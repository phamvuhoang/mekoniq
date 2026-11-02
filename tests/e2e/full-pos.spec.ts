import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
// Isolated: every test drives its own fixture coordinator (X-Test-Lab), so it neither depends on nor disturbs the shared lab other specs use.
const coordinator='http://127.0.0.1:3451';
function harness(page:Page,lab=`full-pos-${randomUUID().slice(0,8)}`){
 const url=(path:string,actor='manager',extra='')=>`${path}?actor=${actor}&lab=${lab}${extra}`;
 return {
  lab,url,
  async screen(path:string,actor='manager',extra=''){await page.goto(url(path,actor,extra));await expect(page.getByRole('button',{name:/^(Làm mới|Refresh)$/})).toBeVisible();},
  async api(type:string,payload:object,actor='cashier'){return (await page.request.post(coordinator+'/commands',{headers:{'x-test-actor':actor,'x-test-lab':lab},data:{type,payload,operationId:randomUUID()}})).json();},
  async snapshots(){return (await page.request.get(coordinator+'/snapshots',{headers:{'x-test-lab':lab}})).json() as Promise<{ref:{kind:string;id:string};version:number;state:Record<string,unknown>}[]>;},
 };
}
// The toast keeps its last text across renders: clear it first so only THIS action's acceptance satisfies the wait.
async function submit(page:Page,button:ReturnType<Page['locator']>){await page.locator('.toast').evaluate(n=>{n.textContent='';});await button.click();await expect(page.locator('.toast')).toHaveText('Đã ghi nhận');}
const bill=(page:Page,id:string)=>page.locator('article.record').filter({has:page.locator('strong',{hasText:new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)})});
const value=(page:Page,label:string)=>page.locator('dt',{hasText:new RegExp(`^${label}$`)}).first().locator('xpath=following-sibling::dd[1]');

test('QR order, amendment to two stations, three-way split, two tenders, partial refund, reconciled shift and the matching report',async({page})=>{
 const h=harness(page);
 // A seating on table-1 that the guest orders into through its QR link.
 expect((await h.api('Session.Open',{sessionId:'full-pos-seat',tableId:'table-1'})).status).toBe('accepted');
 await h.screen('/guest-requests');
 const seat=page.locator('article.record').filter({hasText:'Bàn 01'}).filter({has:page.getByRole('button',{name:'Tạo link QR cho khách',exact:true})});
 await seat.getByRole('button',{name:'Tạo link QR cho khách',exact:true}).click();
 const link=seat.locator('code').filter({hasText:'/table/'});await expect(link).toBeVisible();
 const guestToken=JSON.parse(Buffer.from(String(await link.textContent()).replace('/table/',''),'base64url').toString());
 const ordered=await h.api('Guest.PlaceOrder',{items:[{itemId:'rice',quantity:'3'},{itemId:'tea',quantity:'2'}],menuVersion:1,guestToken},'guest');
 expect(ordered.status,JSON.stringify(ordered)).toBe('accepted');
 // the same token cannot act as staff
 expect((await h.api('Bill.Close',{billId:'any',guestToken},'guest')).code).toBe('FORBIDDEN');

 // Staff amend the guest order: one rice (kitchen) and one tea (bar) less, each reaching its own station as a delta ticket.
 await h.screen('/pos');
 const table=page.locator('article.record').filter({hasText:'Bàn 01'});
 await expect(table.getByText('Cơm × 3')).toBeVisible();
 await table.getByLabel('Lý do').nth(0).fill('khách đổi ý');await submit(page,table.getByRole('button',{name:'Hủy món',exact:true}).nth(0));
 await expect(table.getByText('Cơm × 2 (đã hủy 1)')).toBeVisible();
 await table.getByLabel('Lý do').nth(1).fill('bớt một ly');await submit(page,table.getByRole('button',{name:'Hủy món',exact:true}).nth(1));
 await expect(table.getByText('Trà × 1 (đã hủy 1)')).toBeVisible();
 await h.screen('/kitchen');
 await expect(page.getByText(/HỦY × 1 · kitchen/)).toBeVisible();await expect(page.getByText(/HỦY × 1 · bar/)).toBeVisible();
 expect((await h.snapshots()).filter(s=>s.ref.kind==='kitchen-delta').map(s=>s.state.stationId).sort()).toEqual(['bar','kitchen']);
 for(let i=0;i<2;i++){await submit(page,page.getByRole('button',{name:'Đã nhận (ACK)',exact:true}).first());}

 // Checkout: shift, bill, equal split three ways (2 rice + 1 tea = 120.000 ₫ -> 40.000 ₫ each).
 await h.screen('/checkout');
 await submit(page,page.getByRole('button',{name:'Mở ca thu ngân',exact:true}));
 await submit(page,page.getByRole('button',{name:'Chuẩn bị hóa đơn',exact:true}));
 await expect(page.getByText('Còn phải thu: 120.000 ₫')).toBeVisible();
 await page.getByLabel('Chia đều cho số người').fill('3');await submit(page,page.getByRole('button',{name:'Chia đều hóa đơn',exact:true}));
 const children=(await h.snapshots()).filter(s=>s.ref.kind==='bill'&&s.state.parentBillId).map(s=>s.ref.id).sort();
 expect(children).toHaveLength(3);
 const [a,b,c]=children as [string,string,string];
 for(const id of children)await expect(bill(page,id).getByText('Còn phải thu: 40.000 ₫')).toBeVisible();
 // A: cash 50.000 ₫ given, 10.000 ₫ change; B: card terminal; C: exact cash.
 await bill(page,a).getByLabel('Khách đưa tiền mặt (VND)').fill('50000');await submit(page,bill(page,a).getByRole('button',{name:'Xác nhận đã thu tiền mặt',exact:true}));
 await expect(bill(page,a).getByText(/tiền thối 10\.000/)).toBeVisible();
 await bill(page,b).getByLabel('Đơn vị máy POS').fill('acme');await bill(page,b).getByLabel('Mã cửa hàng (MID)').fill('m-1');await bill(page,b).getByLabel('Mã giao dịch trên phiếu').fill('t-1');
 await submit(page,bill(page,b).getByRole('button',{name:'Ghi nhận giao dịch thẻ',exact:true}));
 await submit(page,bill(page,c).getByRole('button',{name:'Xác nhận đã thu tiền mặt',exact:true}));
 for(const id of children){await submit(page,bill(page,id).getByRole('button',{name:'Đóng hóa đơn',exact:true}));}
 await expect(bill(page,c).locator('.badge')).toHaveText('closed'); // the last close's refresh has rendered before typing
 // Partial cash refund on A after close; the reason looks like a spreadsheet formula on purpose.
 await bill(page,a).getByLabel('Số tiền hoàn').fill('10000');await bill(page,a).getByLabel('Lý do hoàn tiền').fill('=món nguội');
 await submit(page,bill(page,a).getByRole('button',{name:'Hoàn tiền',exact:true}));
 await expect(bill(page,a).getByText(/đã hoàn 10\.000/)).toBeVisible();

 // Shift close reconciled: 0 + 90.000 tendered - 10.000 change - 10.000 refund = 70.000 ₫.
 await h.screen('/cash');
 await expect(page.getByText(/Tiền mặt cần có trong két: 70\.000/)).toBeVisible();
 await page.getByLabel('Tiền mặt đếm được (VND)').fill('70000');await submit(page,page.getByRole('button',{name:'Đóng ca và đối soát',exact:true}));
 await expect(page.getByText(/chênh lệch 0/)).toBeVisible();

 // The report on the tablet reads the same ledger facts (fixture coordinator clock: 2026-10-30 UTC).
 await h.screen('/reports');
 await page.getByLabel('Ngày kinh doanh').fill('2026-10-30');await page.getByRole('button',{name:'Xem báo cáo',exact:true}).click();
 await expect(page.locator('[data-report-status]')).toHaveAttribute('data-report-status','current');
 await expect(value(page,'Doanh thu gộp')).toHaveText('120.000 ₫');
 await expect(value(page,'Trả hàng / hoàn tiền')).toHaveText('10.000 ₫');
 await expect(value(page,'Doanh thu thuần')).toHaveText('110.000 ₫');
 await expect(value(page,'Hóa đơn đã đóng')).toHaveText('3');
 await expect(value(page,'Chênh lệch')).toHaveText('0 ₫');
 await expect(value(page,'Cơm')).toHaveText('2');await expect(value(page,'Trà')).toHaveText('1');
 await expect(value(page,'Tiền thối')).toHaveText('10.000 ₫');
 const cash=page.locator('article.record').filter({has:page.locator('strong',{hasText:/^Tiền mặt$/})});
 await expect(cash.locator('dt',{hasText:/^Đã áp vào hóa đơn$/}).locator('xpath=following-sibling::dd[1]')).toHaveText('80.000 ₫');
 const card=page.locator('article.record').filter({has:page.locator('strong',{hasText:/^Máy POS thẻ$/})});
 await expect(card.locator('dt',{hasText:/^Đã áp vào hóa đơn$/}).locator('xpath=following-sibling::dd[1]')).toHaveText('40.000 ₫');
 const shift=page.locator('article.record').filter({hasText:'Đã đóng · đã đối soát'});
 await expect(shift.locator('dt',{hasText:/^Tiền cần có$/}).locator('xpath=following-sibling::dd[1]')).toHaveText('70.000 ₫');
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Xuất CSV',exact:true}).first().click()]);
 expect(download.suggestedFilename()).toBe('sales-2026-10-30.csv');
 const csv=await readFile(await download.path(),'utf8');
 expect(csv).toContain('kind,id,businessDate,effectiveAt,appliedAt,method,status,amountMinor,reference,reason');
 expect(csv).toContain(`"'=món nguội"`);expect(csv).not.toMatch(/,=món/);
 // VI/EN
 await page.getByRole('button',{name:'Switch to English'}).click();
 await expect(page.getByRole('heading',{name:'Sales',level:2})).toBeVisible();await expect(value(page,'Net sales')).toHaveText('110.000 ₫');
 // nothing was written to make the report agree
 const facts=await h.snapshots();
 expect(facts.filter(s=>s.ref.kind==='payment'&&s.state.status==='captured')).toHaveLength(3);
 expect(facts.filter(s=>s.ref.kind==='refund')).toHaveLength(1);
 expect(facts.filter(s=>s.ref.kind==='bill'&&s.state.status==='closed').map(s=>s.ref.id).sort()).toEqual(children);
});

test('reports: permission denial, offline and unsynced states, recovery, and touch layout in portrait and landscape',async({page})=>{
 const h=harness(page);
 await h.screen('/reports','cashier');
 await expect(page.getByRole('heading',{name:'Không có quyền truy cập'})).toBeVisible();
 await expect(page.getByRole('navigation').getByRole('link',{name:'Báo cáo'})).toHaveCount(0);
 // Coordinator unreachable: local figures, labelled offline with their load time.
 await h.screen('/reports','manager','&fixture=local-only');
 await expect(page.locator('[data-report-status]')).toHaveAttribute('data-report-status','offline');
 await expect(page.getByText(/Mất kết nối bộ điều phối/).first()).toBeVisible();
 // Recovery: back on the coordinator the same screen is current again.
 await h.screen('/reports');
 await expect(page.locator('[data-report-status]')).toHaveAttribute('data-report-status','current');
 // Never synced (no snapshots at all): a statement, never a column of zeros.
 await page.route('**/snapshots',route=>route.fulfill({json:[]}));
 await h.screen('/reports');
 await expect(page.locator('[data-report-status]')).toHaveAttribute('data-report-status','unsynced');
 await expect(page.getByText('Chưa có dữ liệu đồng bộ. Không hiển thị số liệu (không phải bằng 0).')).toBeVisible();
 await expect(page.locator('dt',{hasText:'Doanh thu thuần'})).toHaveCount(0);
 await page.unroute('**/snapshots');
 for(const [name,viewport] of [['portrait',{width:800,height:1280}],['landscape',{width:1280,height:800}]] as const){
  await page.setViewportSize(viewport);
  for(const path of ['/reports','/checkout']){
   await h.screen(path);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${path} ${name} overflows`).toBe(true);
   const small=await page.locator('main button:visible').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height<44).length);
   expect(small,`${path} ${name} touch targets`).toBe(0);
   await page.screenshot({path:`.lab/full-pos${path.replace('/','-')}-${name}.png`,fullPage:true});
  }
 }
});
