import type { ModuleRegistry } from './modules';
import { registerCatalog } from './catalog/publish';
import { registerSessions } from './orders/session';
import { registerOrders } from './orders/module';
import { registerKitchen } from './kitchen/ticket';
import { registerAllocations } from './fulfillment/allocation';
import { registerHandOff } from './fulfillment/handoff';
import { registerMissions } from './fleet/mission';
import { registerBills } from './billing/bill';
import { registerPayments } from './billing/payment-ledger';
import { registerCashShifts } from './cash/basic-shift';
export function registerRestaurantModules(registry:ModuleRegistry):void {
 for(const register of [registerCatalog,registerSessions,registerOrders,registerKitchen,registerAllocations,registerHandOff,registerMissions,registerBills,registerPayments,registerCashShifts]) register(registry);
}
export const commandPermissions:Record<string,string>={
 'Catalog.Publish':'catalog.publish','Catalog.Quote':'catalog.read','Session.Open':'order.write',
 'Order.Place':'order.write','Order.Amend':'order.write','Order.Cancel':'order.write',
 'Kitchen.Accept':'kitchen.write','Kitchen.Ready':'kitchen.write',
 'Fulfillment.Allocate':'fulfillment.write','Fulfillment.HandOff':'fulfillment.write',
 'Mission.Create':'mission.write','Mission.ConfirmStop':'mission.write','Mission.Cancel':'mission.write',
 'Robot.Observe':'robot.observe','Robot.RequestStop':'robot.stop',
 'Shift.Open':'shift.write','Bill.Prepare':'billing.write','Payment.Claim':'payment.claim',
 'Payment.RecordCash':'payment.cash','Bill.Close':'billing.write',
};
