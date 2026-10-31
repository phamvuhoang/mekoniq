import { expect, test } from 'vitest';
import { createRestaurantLab } from '../support/restaurant-lab';
import type {JsonObject} from '../../packages/contracts/src/index';
test('retry place order creates one kitchen input and changed payload conflicts',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.command('cashier','Session.Open',{sessionId:'session-1',tableId:'table-1'});
  const payload={sessionId:'session-1',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'2'}]};
  const first=await lab.command('cashier','Order.Place',payload,'place-1');
  expect(first.status).toBe('accepted');
  expect((await lab.command('cashier','Order.Place',payload,'place-1')).duplicate).toBe(true);
  expect(await lab.count('OrderAccepted')).toBe(1);expect(await lab.count('KitchenTicketCreated')).toBe(1);
  expect((await lab.command('cashier','Order.Place',{...payload,items:[{itemId:'rice',quantity:'3'}]},'place-1')).code).toBe('IDEMPOTENCY_CONFLICT');
  expect((await lab.command('cashier','Order.Place',{...payload,tableId:'table-2'})).code).toBe('TABLE_SESSION_MISMATCH');
 }finally{await lab.close();}
});
test('amendments append immutable lines and stale versions cannot replace them',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.command('cashier','Session.Open',{sessionId:'session-1',tableId:'table-1'});
  const placed=await lab.command('cashier','Order.Place',{sessionId:'session-1',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'1'}]});
  const orderId=String(placed.value.orderId);
  expect((await lab.command('cashier','Order.Amend',{orderId,expectedVersion:1,items:[{itemId:'tea',quantity:'1'}]})).status).toBe('accepted');
  expect((await lab.command('cashier','Order.Amend',{orderId,expectedVersion:1,items:[{itemId:'tea',quantity:'1'}]})).code).toBe('VERSION_CONFLICT');
  const order=await lab.state<{lines:JsonObject[];totalMinor:string}>('order',orderId);
  expect(order.lines).toHaveLength(2);expect(order.totalMinor).toBe('70000');
 }finally{await lab.close();}
});
