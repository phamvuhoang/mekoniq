import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
// W08-T04 tablet screen: the weighed price and the combo parts must stay on screen after the command (the screen re-renders on refresh, so the result cannot live in a node the render replaces).
const coordinator='http://127.0.0.1:3451';
test('weighed price and combo parts are still shown after the screen refreshes',async({page})=>{
 const lab=`models-screen-${randomUUID().slice(0,8)}`;
 const items=[
  {id:'tea',name:'Trà',stationId:'bar',unitMinor:'20000',available:true},
  {id:'burger',name:'Burger',stationId:'kitchen',unitMinor:'60000',available:true},
  {id:'set',name:'Combo burger',stationId:'kitchen',unitMinor:'80000',available:true,combo:{components:[{itemId:'burger',quantity:'1'},{itemId:'tea',quantity:'2'}]}},
  {id:'fish',name:'Cá theo cân',stationId:'kitchen',unitMinor:'200000',available:true,weighed:{unitMass:'1000',unit:'g'}}];
 const published=await (await page.request.post(coordinator+'/commands',{headers:{'x-test-actor':'manager','x-test-lab':lab},data:{type:'Catalog.Publish',payload:{version:2,currency:'VND',items,pricing:{taxProfiles:[],defaultTaxProfileId:null,service:null,discountOrder:'before_tax',discounts:[]}},operationId:randomUUID()}})).json();
 expect(published.status,JSON.stringify(published)).toBe('accepted');
 await page.goto(`/models?actor=manager&lab=${lab}`);
 await expect(page.getByRole('button',{name:/^(Làm mới|Refresh)$/})).toBeVisible();
 await page.getByLabel('Khối lượng (g/ml)').fill('820');
 await page.getByRole('button',{name:'Tính tiền theo cân',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Thành tiền'})).toContainText('164.000');
 await page.getByRole('button',{name:'Xem thành phần combo',exact:true}).click();
 const parts=page.getByRole('status').filter({hasText:'Burger'});
 await expect(parts).toContainText('Burger ×1');await expect(parts).toContainText('Trà ×2');
});
