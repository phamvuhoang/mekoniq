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
import { registerStocktake } from './inventory/stocktake';
import { registerSchedule } from './workforce/schedule';
import { registerAttendance } from './workforce/attendance';
import { registerApproval } from './workforce/approval';
import { registerPromotions } from './promotions/rules';
import { registerVouchers } from './promotions/voucher';
import { registerRedemption } from './promotions/redemption';
import { registerConsent } from './customers/consent';
import { registerCustomers } from './customers/profile';
import { registerLoyalty } from './customers/loyalty';
import { registerBookings } from './reservations/booking';
import { registerWaitlist } from './reservations/waitlist';
import { registerDeposits } from './reservations/deposit';
import { registerServiceModels } from './pricing/buffet';
import { registerSuppliers } from './procurement/supplier';
import { registerPurchasing } from './procurement/purchase-order';
import { registerReceiving } from './procurement/goods-receipt';
import { registerReturns } from './procurement/return';
export function registerRestaurantModules(registry:ModuleRegistry):void {
 for(const register of [registerCatalog,registerSessions,registerOrders,registerCourses,registerAmendments,registerTableMoves,registerSessionMerge,registerKitchen,registerAllocations,registerHandOff,registerMissions,registerBills,registerPayments,registerCashShifts,registerCashbook,registerPrinting,registerBillSplit,registerBillMerge,registerTenders,registerRefunds,registerBillVoid,registerGuestTokens,registerServiceCalls,registerGuide,registerBussing,registerMapBinding,registerReservations,registerRecipes,registerConsumption,registerSuppliers,registerPurchasing,registerReceiving,registerReturns,registerStocktake,registerSchedule,registerAttendance,registerApproval,registerPromotions,registerVouchers,registerRedemption,registerConsent,registerCustomers,registerLoyalty,registerBookings,registerWaitlist,registerDeposits,registerServiceModels]) register(registry);
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
 'Ingredient.Upsert':'inventory.write','Recipe.Publish':'inventory.write','Inventory.Consume':'inventory.consume','Inventory.RecordWaste':'inventory.consume','Inventory.ResolveException':'inventory.write',
 // Procurement (W07-T02): raising and approving an order and booking a delivery are separate permissions.
 'Supplier.Upsert':'procurement.write','Purchase.Create':'procurement.write','Purchase.Approve':'procurement.approve','Purchase.Close':'procurement.approve','Goods.Receive':'procurement.receive','Goods.Return':'procurement.receive',
 // Stocktake (W07-T03): counting is a floor task, approving and applying the difference is not.
 'Stocktake.Open':'inventory.count','Stocktake.Count':'inventory.count','Stocktake.Approve':'inventory.approve','Stocktake.Apply':'inventory.approve',
 // Workforce (W07-T04). Punching someone else's time is a manager's workforce.approve (see requiredPermissions); permissions themselves are an identity-workflow matter.
 'Staff.Schedule':'workforce.write','Staff.ClockIn':'workforce.clock','Staff.ClockOut':'workforce.clock','Staff.ApproveCorrection':'workforce.approve','Staff.SetPermissions':'identity.delegate',
 // Promotions and vouchers (W08-T01): publishing rules and issuing/allocating vouchers is a manager's job; spending a voucher at the till is the cashier's.
 'Promotion.Publish':'promotion.write','Voucher.Issue':'promotion.write','Voucher.GrantEscrow':'promotion.write','Voucher.Reserve':'voucher.redeem','Voucher.Redeem':'voucher.redeem','Voucher.Release':'voucher.redeem',
 // CRM and loyalty (W08-T02): the till enrols, records consent and earns/spends points; merging people, erasing data and reversing points are a manager's customer.manage.
 'Customer.Upsert':'loyalty.write','Consent.Record':'loyalty.write','Loyalty.Earn':'loyalty.write','Loyalty.Redeem':'loyalty.write','Loyalty.Reverse':'customer.manage','Customer.Merge':'customer.manage','Customer.Erase':'customer.manage',
 // Reservations (W08-T03): front-of-house staff take, confirm, seat and cancel bookings and take deposits; returning a deposit or forfeiting one for a no-show is a manager's deposit.manage.
 'Booking.Create':'reservation.write','Booking.Confirm':'reservation.write','Booking.CheckIn':'reservation.write','Booking.NoShow':'reservation.write','Booking.Cancel':'reservation.write','Waitlist.Join':'reservation.write','Waitlist.Promote':'reservation.write','Deposit.Receive':'reservation.write','Deposit.Apply':'reservation.write','Deposit.Return':'deposit.manage',
 // Service models (W08-T04): quotes are catalog reads (a manual weight additionally needs weighed.manual, see requiredPermissions); a buffet start/extension is ordering.
 'Combo.Quote':'catalog.read','WeighedItem.Quote':'catalog.read','Buffet.Start':'order.write','Buffet.Extend':'order.write',
};
