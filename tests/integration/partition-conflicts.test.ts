import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
test('independent same-table captures preserve sources and require explicit linking',async()=>{
  const lab=await createContinuityLab();
  try {
    await lab.command('device-a','Continuity.CaptureTicket',{id:'a-1',table:'table-1',totalMinor:'50000'});
    await lab.command('device-b','Continuity.CaptureTicket',{id:'b-1',table:'table-1',totalMinor:'20000'});
    expect(await lab.count('IsolatedTicketRecorded')).toBe(2);
    expect(await lab.unresolvedConflictCount()).toBe(1);
    expect((await lab.command('cashier','Continuity.ResolveConflict',{id:'table:table-1',reason:'Two genuine visits',expectedVersion:1})).status).toBe('rejected');
    expect((await lab.command('manager','Continuity.ResolveConflict',{id:'table:table-1',reason:'Two genuine visits',expectedVersion:1})).status).toBe('accepted');
    expect(await lab.unresolvedConflictCount()).toBe(0);
    expect(await lab.count('IsolatedTicketRecorded')).toBe(2);
  }finally{await lab.close();}
});
test('payment observations do not settle shared bills',async()=>{
  const lab=await createContinuityLab();
  try {
    await lab.seed('bill','bill-1',{status:'prepared',totalMinor:'50000',paidMinor:'0'});
    await lab.command('device-a','Continuity.RecordPaymentObservation',{billId:'bill-1',amountMinor:'50000',method:'transfer'});
    expect((await lab.state<{paidMinor:string}>('bill','bill-1')).paidMinor).toBe('0');
    expect(await lab.count('PaymentObserved')).toBe(1);
  }finally{await lab.close();}
});
test('LAN partition retains two device journals; authenticated recovery links without erasing either',async()=>{
 const lab=await createContinuityLab();try{
  await lab.partition('lan');
  expect((await lab.command('device-a','Continuity.CaptureTicket',{id:'a-offline',table:'table-1',totalMinor:'50000'})).ack).toBe('local');
  expect((await lab.command('device-b','Continuity.CaptureTicket',{id:'b-offline',table:'table-1',totalMinor:'20000'})).ack).toBe('local');
  expect((await lab.command('device-b','Order.Place',{sessionId:'shared'})).status).toBe('unknown');
  expect(await lab.count('IsolatedTicketRecorded')).toBe(2);
  await lab.heal();await lab.sync();
  expect(await lab.unresolvedConflictCount()).toBe(1);
  expect(await lab.count('IsolatedTicketRecorded')).toBe(2);
  expect(await lab.count('IsolatedTicketRecovered')).toBe(2);
  await lab.sync();expect(await lab.count('IsolatedTicketRecovered')).toBe(2);
 }finally{await lab.close();}
});
