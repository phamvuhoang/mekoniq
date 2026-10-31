import { expect, test } from 'vitest';
import { createRestaurantLab } from '../support/restaurant-lab';
test('two dispatchers cannot allocate the same ready portion',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.seed('fulfillment','line-1',{ready:'1',allocated:'0',served:'0',quantity:'1',version:1,status:'open'});
  const results=await Promise.all([lab.command('cashier','Fulfillment.Allocate',{lineId:'line-1',quantity:'1',expectedVersion:1}),lab.command('cashier','Fulfillment.Allocate',{lineId:'line-1',quantity:'1',expectedVersion:1})]);
  expect(results.filter(r=>r.status==='accepted')).toHaveLength(1);expect(await lab.count('PortionAllocated')).toBe(1);
 }finally{await lab.close();}
});
test('partial readiness and manual handoff conserve portions and respect station scope',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.command('cashier','Session.Open',{sessionId:'session-1',tableId:'table-1'});
  const order=await lab.command('cashier','Order.Place',{sessionId:'session-1',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'2'},{itemId:'tea',quantity:'1'}]});
  const [lineId,teaId]=order.value.lineIds as string[];
  expect((await lab.command('chef','Kitchen.Ready',{lineId:teaId!,quantity:'1',stationId:'bar',expectedVersion:1})).code).toBe('FORBIDDEN');
  expect((await lab.command('chef','Kitchen.Ready',{lineId:lineId!,quantity:'1',stationId:'kitchen',expectedVersion:1})).status).toBe('accepted');
  const allocation=await lab.command('cashier','Fulfillment.Allocate',{lineId:lineId!,quantity:'1',expectedVersion:2});
  expect((await lab.command('cashier','Fulfillment.HandOff',{allocationId:allocation.value.allocationId!,expectedVersion:1})).status).toBe('accepted');
  const state=await lab.state<{ready:string;allocated:string;served:string}>('fulfillment',lineId!);
  expect(state).toMatchObject({ready:'0',allocated:'0',served:'1'});
 }finally{await lab.close();}
});
