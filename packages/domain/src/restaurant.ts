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
import { registerCashShifts } from './cash/shift';
import { registerCashbook } from './cash/cashbook';
import { registerPrinting } from './printing/print';
import { registerBillSplit } from './billing/split';
import { registerBillMerge } from './billing/merge';
import { registerTenders } from './billing/tenders';
import { registerRefunds } from './billing/refund';
import { registerBillVoid } from './billing/void';
import { registerGuestTokens } from './service/guest-token';
import { registerServiceCalls } from './service/calls';
import { registerGuide } from './service/guide';
import { registerBussing } from './service/bussing';
import { registerMapBinding } from './fleet/map-binding';
import { registerReservations } from './fleet/reservations';
import { registerRecipes } from './inventory/recipe';
import { registerConsumption } from './inventory/consumption';
import { registerSuppliers } from './procurement/supplier';
import { registerPurchasing } from './procurement/purchase-order';
import { registerReceiving } from './procurement/goods-receipt';
import { registerReturns } from './procurement/return';
export function registerRestaurantModules(registry:ModuleRegistry):void {
 for(const register of [registerCatalog,registerSessions,registerOrders,registerCourses,registerAmendments,registerTableMoves,registerSessionMerge,registerKitchen,registerAllocations,registerHandOff,registerMissions,registerBills,registerPayments,registerCashShifts,registerCashbook,registerPrinting,registerBillSplit,registerBillMerge,registerTenders,registerRefunds,registerBillVoid,registerGuestTokens,registerServiceCalls,registerGuide,registerBussing,registerMapBinding,registerReservations,registerRecipes,registerConsumption,registerSuppliers,registerPurchasing,registerReceiving,registerReturns]) register(registry);
}
export const commandPermissions:Record<string,string>={
 'Catalog.Publish':'catalog.publish','Catalog.Quote':'catalog.read','Session.Open':'order.write',
 'Order.Place':'order.write','Order.Amend':'order.write','Order.Cancel':'order.write',
 'Session.Move':'order.write','Session.Merge':'order.write','Order.SendCourse':'order.write',
 'Kitchen.Accept':'kitchen.write','Kitchen.Ready':'kitchen.write','Kitchen.AckDelta':'kitchen.write','Kitchen.DisposePrepared':'kitchen.write',
 'Fulfillment.Allocate':'fulfillment.write','Fulfillment.HandOff':'fulfillment.write',
 'Mission.Create':'mission.write','Mission.ConfirmStop':'mission.write','Mission.Cancel':'mission.write',
 'Robot.Observe':'robot.observe','Robot.RequestStop':'robot.stop',
 'Shift.Open':'shift.write','Shift.Close':'shift.write','Cash.RecordMovement':'shift.write','Print.Request':'print','Print.ConfirmReprint':'print','Print.Observe':'print.observe','Print.Resolve':'print.resolve','Bill.Prepare':'billing.write','Payment.Claim':'payment.claim',
 'Payment.RecordCash':'payment.cash','Bill.Close':'billing.write',
 'Bill.Split':'billing.write','Bill.Merge':'billing.write','Bill.Void':'bill.void',
 'Payment.RecordTerminal':'payment.terminal','Payment.VerifyManual':'payment.verify','Refund.Record':'payment.refund',
 'Session.Close':'order.write','Guest.IssueToken':'order.write','Guest.AcknowledgeCall':'order.write','Robot.PairDisplay':'device.enroll',
 // Guest surfaces (QR via the cloud guest API, kiosk, paired robot screen) hold only guest.* permissions; the handler resolves their session.
 'Guest.PlaceOrder':'guest.order','Guest.CallStaff':'guest.call','Guest.ReportIssue':'guest.call','Guest.RequestBill':'guest.bill',
 'Mission.Guide':'mission.write','Mission.Bus':'mission.write','Mission.Resume':'mission.write',
 // Map binding is venue robot configuration (manager); zone reservations are asked/released by the robot executor (manager may release with evidence).
 'Robot.BindMap':'robot.configure','Zone.Reserve':'robot.traffic','Zone.Release':'robot.traffic',
 // Inventory (W07): recipes and the ingredient master are manager decisions; the kitchen records consumption/waste it caused.
 'Ingredient.Upsert':'inventory.write','Recipe.Publish':'inventory.write','Inventory.Consume':'inventory.consume','Inventory.RecordWaste':'inventory.consume',
 // Procurement (W07-T02): raising and approving an order and booking a delivery are separate permissions.
 'Supplier.Upsert':'procurement.write','Purchase.Create':'procurement.write','Purchase.Approve':'procurement.approve','Purchase.Close':'procurement.approve','Goods.Receive':'procurement.receive','Goods.Return':'procurement.receive',
};
