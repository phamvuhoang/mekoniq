import type { ModuleRegistry } from './modules';
import { registerCatalog } from './catalog/publish';
import { registerSessions } from './orders/session';
import { registerOrders } from './orders/module';
import { registerCourses } from './orders/course';
import { registerAmendments } from './orders/amendment';
import { registerTableMoves } from './orders/move-table';
import { registerSessionMerge } from './orders/merge-session';
import { registerKitchen } from './kitchen/ticket';
import { registerAllocations } from './fulfillment/allocation';
import { registerHandOff } from './fulfillment/handoff';
import { registerMissions } from './fleet/mission';
import { registerBills } from './billing/bill';
import { registerPayments } from './billing/payment-ledger';
import { registerCashShifts } from './cash/basic-shift';
import { registerBillSplit } from './billing/split';
import { registerBillMerge } from './billing/merge';
import { registerTenders } from './billing/tenders';
import { registerRefunds } from './billing/refund';
import { registerBillVoid } from './billing/void';
export function registerRestaurantModules(registry:ModuleRegistry):void {
 for(const register of [registerCatalog,registerSessions,registerOrders,registerCourses,registerAmendments,registerTableMoves,registerSessionMerge,registerKitchen,registerAllocations,registerHandOff,registerMissions,registerBills,registerPayments,registerCashShifts,registerBillSplit,registerBillMerge,registerTenders,registerRefunds,registerBillVoid]) register(registry);
}
export const commandPermissions:Record<string,string>={
 'Catalog.Publish':'catalog.publish','Catalog.Quote':'catalog.read','Session.Open':'order.write',
 'Order.Place':'order.write','Order.Amend':'order.write','Order.Cancel':'order.write',
 'Session.Move':'order.write','Session.Merge':'order.write','Order.SendCourse':'order.write',
 'Kitchen.Accept':'kitchen.write','Kitchen.Ready':'kitchen.write','Kitchen.AckDelta':'kitchen.write','Kitchen.DisposePrepared':'kitchen.write',
 'Fulfillment.Allocate':'fulfillment.write','Fulfillment.HandOff':'fulfillment.write',
 'Mission.Create':'mission.write','Mission.ConfirmStop':'mission.write','Mission.Cancel':'mission.write',
 'Robot.Observe':'robot.observe','Robot.RequestStop':'robot.stop',
 'Shift.Open':'shift.write','Bill.Prepare':'billing.write','Payment.Claim':'payment.claim',
 'Payment.RecordCash':'payment.cash','Bill.Close':'billing.write',
 'Bill.Split':'billing.write','Bill.Merge':'billing.write','Bill.Void':'bill.void',
 'Payment.RecordTerminal':'payment.terminal','Payment.VerifyManual':'payment.verify','Refund.Record':'payment.refund',
};
