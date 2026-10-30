import { expect, test } from 'vitest';
import { createRestaurantLab } from '../support/restaurant-lab';
test('existing quote retains price after publication and input cannot change authoritative prices',async()=>{
 const lab=await createRestaurantLab();try {
  const q=await lab.command('cashier','Catalog.Quote',{items:[{itemId:'rice',quantity:'1',unitMinor:'1'}]});
  expect(q.value.totalMinor).toBe('50000');
  const publish=await lab.command('manager','Catalog.Publish',{version:2,prices:{rice:'60000'}});
  expect(publish.status).toBe('accepted');
  expect(q.value.totalMinor).toBe('50000');
  expect((await lab.command('cashier','Catalog.Quote',{items:[{itemId:'rice',quantity:'1'}]})).value.totalMinor).toBe('60000');
  expect((await lab.state<{items:{unitMinor:string}[]}>('catalog-version','1')).items[0]!.unitMinor).toBe('50000');
  expect((await lab.command('cashier','Catalog.Publish',{version:3,prices:{rice:'1'}})).code).toBe('FORBIDDEN');
 }finally{await lab.close();}
});
test('invalid quantities, sold-out items, missing station and stale menu are rejected',async()=>{
 const lab=await createRestaurantLab();try {
  for(const quantity of ['0','-1','1.5','01']) expect((await lab.command('cashier','Catalog.Quote',{items:[{itemId:'rice',quantity}]})).code).toBe('INVALID_QUANTITY');
  expect((await lab.command('manager','Catalog.Publish',{version:2,currency:'VND',items:[{id:'rice',name:'Cơm',stationId:'missing',unitMinor:'1'}]})).code).toBe('STATION_NOT_FOUND');
  await lab.command('manager','Catalog.Publish',{version:2,currency:'VND',items:[{id:'rice',name:'Cơm',stationId:'kitchen',unitMinor:'50000',available:false}]});
  expect((await lab.command('cashier','Catalog.Quote',{items:[{itemId:'rice',quantity:'1'}]})).code).toBe('ITEM_SOLD_OUT');
 }finally{await lab.close();}
});
