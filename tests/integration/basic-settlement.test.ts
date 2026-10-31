import { expect, test } from 'vitest';
import { createRestaurantLab } from '../support/restaurant-lab';
test('a customer payment claim cannot close a bill or mutate paid balance',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.seed('bill','bill-1',{totalMinor:'100000',paidMinor:'0',currency:'VND',status:'prepared',version:1});
  expect((await lab.command('guest','Payment.Claim',{billId:'bill-1',method:'transfer'})).status).toBe('accepted');
  expect((await lab.command('cashier','Bill.Close',{billId:'bill-1',expectedVersion:1})).code).toBe('BALANCE_DUE');
  expect((await lab.state<{paidMinor:string}>('bill','bill-1')).paidMinor).toBe('0');
 }finally{await lab.close();}
});
test('cash requires a real open shift; retry does not take money twice and overpayment returns change',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.seed('bill','bill-1',{totalMinor:'50000',paidMinor:'0',currency:'VND',status:'prepared',version:1});
  const payload={billId:'bill-1',expectedVersion:1,amountMinor:'100000',currency:'VND'};
  expect((await lab.command('cashier','Payment.RecordCash',payload)).code).toBe('ACTIVE_SHIFT_REQUIRED');
  expect((await lab.command('cashier','Shift.Open',{shiftId:'shift-1',currency:'VND'})).status).toBe('accepted');
  const paid=await lab.command('cashier','Payment.RecordCash',payload,'cash-1');
  expect(paid.status).toBe('accepted');expect(paid.value.changeMinor).toBe('50000');
  expect((await lab.command('cashier','Payment.RecordCash',payload,'cash-1')).duplicate).toBe(true);
  expect(await lab.count('CashRecorded')).toBe(1);
  expect((await lab.command('cashier','Bill.Close',{billId:'bill-1',expectedVersion:2},'close-1')).status).toBe('accepted');
  expect((await lab.command('cashier','Bill.Close',{billId:'bill-1',expectedVersion:2},'close-1')).duplicate).toBe(true);
  expect((await lab.state<{cashMinor:string}>('shift','shift-1')).cashMinor).toBe('50000');
 }finally{await lab.close();}
});
