import {test,expect} from '@playwright/test';
test('POS shows the server quote for modifiers, tax and a coupon and the placed order keeps its charge snapshot',async({page})=>{
 const bun={id:'bun',name:'Bún',stationId:'kitchen',unitMinor:'40000',available:true,taxProfileId:'vat',modifierGroups:[
  {id:'size',name:'Cỡ',kind:'size',min:1,max:1,options:[{id:'s',name:'Nhỏ',priceMinor:'40000'},{id:'l',name:'Lớn',priceMinor:'60000'}]},
  {id:'top',name:'Thêm',min:0,max:1,options:[{id:'egg',name:'Trứng',priceMinor:'7000'}]}]};
 const pricing={taxProfiles:[{id:'vat',name:'VAT',rateBps:1000,inclusive:false}],defaultTaxProfileId:null,service:null,discountOrder:'before_tax',discounts:[{id:'c10',name:'Giảm 10%',kind:'percent',valueBps:1000}]};
 const items=[{id:'rice',name:'Cơm',stationId:'kitchen',unitMinor:'50000',available:true},{id:'tea',name:'Trà',stationId:'bar',unitMinor:'20000',available:true},bun];
 const published=await page.request.post('/commands',{data:{type:'Catalog.Publish',operationId:'e2e-pricing-menu',payload:{version:2,currency:'VND',items,pricing}}});
 const result=await published.json();expect(result,JSON.stringify(result)).toMatchObject({status:'accepted'});
 await page.goto('/pos');await expect(page.getByRole('button',{name:'Làm mới',exact:true})).toBeVisible();
 await page.locator('select').first().selectOption('table-2');
 await page.getByRole('button',{name:'Bún'}).click();
 await page.getByLabel(/Lớn/).check();await page.getByLabel(/Trứng/).check();
 await page.getByRole('button',{name:'Thêm vào giỏ',exact:true}).click();
 await page.getByLabel('Giảm 10%').check();
 await page.getByRole('button',{name:'Tính giá',exact:true}).click();
 // (60000 + 7000) = 67000; 10% coupon = 6700; tax 10% of 60300 = 6030; total 66330
 await expect(page.getByText('Giá từ máy chủ · 66.330 ₫')).toBeVisible();
 await expect(page.getByText('Giảm giá: 6.700 ₫')).toBeVisible();
 await expect(page.getByText('Thuế: 6.030 ₫')).toBeVisible();
 await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
 await expect(page.locator('.toast')).toHaveText('Đã ghi nhận');
 const find=async()=>(await (await page.request.get('/snapshots')).json()).find((s:{ref:{kind:string};state:{tableId:string}})=>s.ref.kind==='order'&&s.state.tableId==='table-2');
 await expect.poll(async()=>Boolean(await find())).toBe(true); // the toast can show before the order is readable
 const order=await find();
 expect(order.state.totalMinor).toBe('66330');
 expect(order.state.lines[0].charges.map((c:{kind:string})=>c.kind)).toEqual(['base','modifier','discount','service','tax'].filter(k=>k!=='service'));
 expect(order.state.lines[0].pricing).toMatchObject({profileRevision:2,steps:['base','modifier','discount','service','tax']});
});
