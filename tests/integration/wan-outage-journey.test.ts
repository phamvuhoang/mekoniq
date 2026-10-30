import { expect, test } from 'vitest';
import { runRestaurantJourney } from '../support/restaurant-journey';
import { createRestaurantLab } from '../support/restaurant-lab';
test('WAN loss leaves the local durable restaurant journey operational',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.partition('wan');const result=await runRestaurantJourney(lab);
  expect(result.billStatus).toBe('closed');expect(result.missionStatus).toBe('completed');
  expect(await lab.cloudAppliedCount()).toBe(0);expect(await lab.count('CashRecorded')).toBe(1);
  await lab.heal();await lab.sync();
  expect(await lab.cloudAppliedCount()).toBeGreaterThan(0);
  expect(await lab.count('CashRecorded')).toBe(1);
  expect(await lab.pendingCount()).toBe(0);
  await lab.sync();expect(await lab.count('CashRecorded')).toBe(1);
 }finally{await lab.close();}
});
