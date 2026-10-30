# Wave 05 — POS, thu ngân và trải nghiệm phục vụ đầy đủ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện vận hành tại một nhà hàng trước pilot robot thật.

**Architecture:** Mở rộng các aggregate đã chạy ở W03, giữ cùng ledger/policy/offline semantics. Mỗi màn hình gọi command thật và có permission, revision, audit.

**Tech Stack:** Domain TypeScript, HTML tablet/Next.js guest, SQLite/Supabase PostgreSQL, signed table sessions, local print spool.

**Spec:** [Production](../specs/2026-10-30-production-platform-design.md), [Continuity](../specs/2026-10-30-offline-continuity-design.md), [F01–F30](../../product/2026-10-30-capability-matrix.md).

## Global Constraints

- “Xây lại mã trong `source`; `trial` là nguồn tham khảo hành vi, không phải nhánh để sửa.”
- “Cloud là nền tảng trung tâm. Không lắp máy chủ riêng tại nhà hàng.”
- “Bản đầu dùng **coordinator cố định, không tự bầu leader khi timeout**.”
- “Tiền lưu số nguyên theo đơn vị tiền nhỏ nhất; VND là đồng. Không cộng tiền bằng float.”
- “Không tự phát lệnh di chuyển/thu tiền/in/xuất hóa đơn khi replay lịch sử.”
- “Cloud ACK là đã commit ở cloud; ACK LAN là coordinator đã commit.”
- Node.js 24 LTS; Supabase PostgreSQL 17; TypeScript strict; SQLite native trên Android; robot baseline ROS 2 Jazzy / Ubuntu 24.04 / Gazebo Harmonic.
- Next.js web/API trên Vercel; Supabase Auth/Realtime/Storage và profile Free bắt buộc; tablet HTML bundle + native Android. Tuân theo [stack và giới hạn Free](../specs/2026-10-30-vercel-supabase-free-stack.md); không thêm dịch vụ trả phí bắt buộc để khởi chạy.
- Đọc [plan tổng và hợp đồng dùng chung](2026-10-30-production-implementation-plan.md) trước task; mọi đường dẫn/command tính từ `source/`.
- Đây là kế hoạch, chưa có application files hoặc scripts bên dưới. Tạo chúng tại task sở hữu; không chạy lệnh triển khai/robot thật chỉ để kiểm tra tài liệu.
- Không đánh dấu PASS khi thiếu thiết bị/provider; ghi `blocked_external` cho đúng acceptance gate, tiếp tục task không phụ thuộc.

---

## Entry / exit

**Entry:** Gate A W04 đạt; mọi mở rộng tiếp tục chạy continuity regression.

**Exit:** Modifiers, courses, bàn/bill tách gộp, cash/mixed/manual transfer, refund, ca, print, QR và hỗ trợ khách có E2E.

**Đầu ra chạy được:** Gọi món từ QR, sửa order xuống hai trạm, chia bill ba người, thu tiền hai phương thức, refund một phần và đóng ca đối soát.

### W05-T01: Giá đầy đủ: modifier, thuế/phí và discount allocation

**Depends on:** W03-T01, W00-T03

**Files:**

- Create: `packages/domain/src/catalog/{modifier,availability}.ts`, `packages/domain/src/pricing/{quote,tax,discount}.ts`.
- Modify: `apps/cloud-web/src/components/backoffice/MenuEditor.tsx`, `apps/tablet-web/src/screens/Pos.ts`.
- Test: `tests/unit/pricing.test.ts`.

**Interfaces:**

- Consumes: Exact money allocateMinor, menu version, tax/service profiles.
- Produces: `quoteOrder(input):Quote`; normalized immutable charge lines có order-of-operations explicit.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { allocateMinor } from "../../packages/domain/src/shared/money";
import { quoteTaxExclusive } from "../../packages/domain/src/pricing/tax";
test("discount cents remain conserved across a three-way split", () => {
  const shares = allocateMinor("10001", [1n,1n,1n]);
  expect(shares.map(BigInt).reduce((a,b)=>a+b,0n)).toBe(10001n);
  expect(quoteTaxExclusive("100000",1000)).toBe("10000");
});
```

- [ ] **2. Chạy RED.** `pnpm test:unit -- tests/unit/pricing.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Modifier min/max selection, size price, sold-out/time availability; discount trước/sau tax là profile versioned, không suy luật thuế. Basis points integer; rounding half-up positive, reversals reference exact original allocations.

```ts
export function quoteTaxExclusive(baseMinor:string, rateBps:number) {
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new Error("INVALID_RATE");
  return String((BigInt(baseMinor) * BigInt(rateBps) + 5000n) / 10000n);
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** UI preview/server re-quote bằng same policy revision. Snapshot modifier names/prices/tax/service calculation trên order và prepared bill; changing menu không recompute lịch sử.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:unit -- tests/unit/pricing.test.ts`; kỳ vọng PASS. Tax inclusive/exclusive, zero-price modifier, currencies mismatch, repeated coupon allocations, availability crossing day/timezone, stale cart explicit re-confirm. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W05-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: price configurable restaurant menus without rounding loss"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W05-T02: Chuyển/gộp bàn và amendment xuống bếp

**Depends on:** W03-T02, W03-T03

**Files:**

- Create: `packages/domain/src/orders/{move-table,merge-session,course,amendment}.ts`.
- Modify: `apps/tablet-web/src/screens/{Pos,Kitchen}.ts`.
- Test: `tests/integration/table-order-amendments.test.ts`.

**Interfaces:**

- Consumes: Session/order version locks, KDS ready/allocated/served quantities.
- Produces: `Session.Move`, `.Merge`, `Order.SendCourse`, `Order.Amend`; KDS delta tickets.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("prepared food cancellation does not erase kitchen work", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("order-line","line-1",{ordered:"2",prepared:"1",allocated:"0",version:2});
    await lab.command("manager","Order.Amend",{lineId:"line-1",cancelQuantity:"1",reason:"guest",expectedVersion:2});
    expect(await lab.count("KitchenCancellationRequested")).toBe(1);
    expect(await lab.count("PreparedFoodDiscarded")).toBe(0);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/table-order-amendments.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Lock cả session nguồn/đích theo sorted ID, expected versions cho cả hai. Gộp không xóa source session refs hoặc bill. Đồ đã chế biến tạo choice return/waste/manual disposition riêng; delta KDS phải ACK.

```ts
const lockOrder = [sourceSessionId, targetSessionId].sort();
if (sourceSessionId === targetSessionId) return {ok:false,code:"SAME_SESSION"};
if (sourceHasGrant || targetHasGrant) return {ok:false,code:"GRANT_UNRECONCILED"};
```

- [ ] **4. Nối vào runtime và lưu trữ.** Table occupancy phục vụ hoạt động độc lập identity waypoint robot; bàn đổi tên không đổi physical map binding. UI conflict giữ draft và chỉ rõ bản mới; guest token bị rotate khi session đóng/khách mới.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/table-order-amendments.test.ts`; kỳ vọng PASS. Concurrent merge, order added during split, stale guest link, transfer while mission en route retarget version, kitchen bar courses partial ready. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W05-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: preserve table and kitchen history through service changes"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W05-T03: Split/mixed tender/refund và bill ledger

**Depends on:** W05-T01, W04-T02

**Files:**

- Create: `packages/domain/src/billing/{split,merge,tenders,refund,void}.ts`.
- Modify: `apps/tablet-web/src/screens/Checkout.ts`.
- Test: `tests/integration/financial-lifecycle.test.ts`.

**Interfaces:**

- Consumes: Bill snapshot allocations, grant rights, applied/unapplied money.
- Produces: `Bill.Split`, `.Merge`, `Payment.VerifyManual`, `Refund.Record`, `Bill.Void`; exact immutable financial ledger.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("concurrent refunds cannot exceed the captured balance", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("payment","pay-1",{capturedMinor:"100000",refundedMinor:"0",version:1});
    const rs = await Promise.all([1,2].map(i=>lab.command("manager","Refund.Record",
      {paymentId:"pay-1",amountMinor:"70000",expectedVersion:1}, "refund-"+i)));
    expect(rs.filter(r=>r.status==="accepted")).toHaveLength(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/financial-lifecycle.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Split by line/quantity/equal amounts với exact discount/tax apportionment. Cash/card-terminal observation/transfer manual đều typed, manual verified có người/lý do/evidence. Refund chỉ phần chưa hoàn, không void payment captured.

```ts
export function refundableMinor(captured:string, refunded:string) {
  return String(BigInt(captured) - BigInt(refunded));
}
export function canRefund(captured:string, refunded:string, request:string) {
  return BigInt(request) > 0n && BigInt(request) <= BigInt(refundableMinor(captured,refunded));
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Unique external payment references scoped provider+merchant+transaction; charge unknown chặn thu lại theo policy. Customer claim vẫn pending; full reconciliation giữ overpayment, fees/change riêng khỏi gross sales.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/financial-lifecycle.test.ts`; kỳ vọng PASS. Partial payment, mixed tender, duplicate webhook observations, closed bill amendments, refunds do not invent stock return, authorization matrix cashier/manager. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W05-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: complete auditable restaurant billing and refunds"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W05-T04: Ca, sổ két và hàng đợi in

**Depends on:** W05-T03

**Files:**

- Create: `packages/domain/src/cash/{shift,cashbook}.ts`, `integrations/printing/src/{spool,escpos,receipt}.ts`.
- Create: `apps/tablet-web/src/screens/{CashShift,PrintQueue}.ts`.
- Test: `tests/integration/cash-print.test.ts`.

**Interfaces:**

- Consumes: Cash ledger, payment source ID, side-effect receipt and printer profile.
- Produces: `Shift.Open`, `.Close`, `Cash.RecordMovement`, `Print.Request`, `.ConfirmReprint`; printer states pending/sent/unknown/confirmed.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("printer timeout cannot undo the recorded sale", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("bill","bill-1",{status:"closed",paidMinor:"50000"});
    await lab.fault("printer-timeout");
    await lab.command("cashier","Print.Request",{billId:"bill-1"});
    expect((await lab.state<{status:string}>("bill","bill-1")).status).toBe("closed");
    expect(await lab.effectCount("printer.send")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/cash-print.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Expected cash=opening+cash receipts+cash-in-cash-out-cash refunds-change; shift close records variance/approver. ESC/POS driver profile native network/USB tùy thiết bị đã kiểm, no guaranteed printer ACK.

```ts
export function expectedCash(x:{opening:bigint;receipts:bigint;in:bigint;out:bigint;refunds:bigint;change:bigint}) {
  return String(x.opening + x.receipts + x.in - x.out - x.refunds - x.change);
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Durable local spool, ESC/POS render golden byte fixtures; uncertain send chuyển unknown, người dùng reprint tạo attempt mới có dấu bản in lại. KDS không phụ thuộc printer success.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/cash-print.test.ts`; kỳ vọng PASS. Shift multi-cashier permissions, reopened day adjustment, cash count mismatch, lost printer ACK, Bluetooth/USB unsupported clearly disabled; physical printer gate W11. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W05-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: reconcile cash shifts and persist print attempts"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W05-T05: Guest QR, kiosk và support/guide/bussing

**Depends on:** W05-T02, W03-T04, W02-T03

**Files:**

- Create: `apps/cloud-web/src/components/guest/{Menu,Cart,TableSession}.tsx`, `apps/tablet-web/src/screens/{RobotDisplay,GuestRequests}.ts`.
- Create: `apps/cloud-web/src/app/(guest)/menu/[venueId]/page.tsx`, `apps/cloud-web/src/app/(guest)/table/[token]/page.tsx`, `apps/tablet-web/src/screens/Kiosk.ts`.
- Create: `packages/domain/src/service/{guest-token,calls,guide,bussing}.ts`.
- Test: `tests/integration/guest-boundaries.test.ts`.

**Interfaces:**

- Consumes: Guest session tokens, menu/order APIs, robot capability policy.
- Produces: `Guest.CallStaff`, `.RequestBill`, `.ReportIssue`, `Mission.Guide`, `.Bus`; QR/kiosk/robot ordering flags riêng.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("an old QR token cannot order for the next table occupant", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.command("cashier","Session.Open",{sessionId:"session-1",tableId:"table-1"});
    const token = await lab.guestToken("session-1");
    await lab.command("cashier","Session.Close",{sessionId:"session-1"});
    await lab.command("cashier","Session.Open",{sessionId:"session-2",tableId:"table-1"});
    expect((await lab.guestCommand(token,"Order.Place",{items:[{itemId:"tea",quantity:"1"}]})).code)
      .toBe("SESSION_EXPIRED");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/guest-boundaries.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Guest scopes chỉ session/table của mình, calls cooldown/coalesce idempotent. Guide require known destination/capability; bussing loaded không cancel bỏ dở. Robot màn hình paired với robot identity, không tin URL robotId.

```ts
export function guestSessionValid(token:{sessionId:string;revision:number},
  session:{id:string;revision:number;status:string}) {
  return token.sessionId===session.id && token.revision===session.revision &&
    session.status==="open";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Web guest Next.js dùng scoped HTTPS API, báo pending cho tới venue receipt; ảnh menu qua Storage, không lộ private map/chứng từ. Kiosk/màn robot là HTML bundle native để dùng LAN. Local guest HTTPS option cần trusted cert/DNS/static bundle độc lập Next.js server; mặc định cloud guest báo rõ khi venue unreachable, staff nhập thay. Voice cues VI/EN không làm source of truth; touch controls ≥48px.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/guest-boundaries.test.ts`; kỳ vọng PASS. QR ordering disabled while staff POS enabled; robot ordering independent delivery; guests cannot settle/clear E-stop; service call alert acknowledgement never closes bill. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W05-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: serve scoped guest and robot-facing restaurant workflows"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W05-T06: Báo cáo ca/doanh thu và UX end-to-end

**Depends on:** W05-T01..W05-T05

**Files:**

- Create: `packages/domain/src/reporting/{sales,shift,robot-kpi}.ts`, `apps/tablet-web/src/screens/Reports.ts`.
- Create: `tests/e2e/full-pos.spec.ts`, `docs/operations/cashier-kitchen.md`.
- Test: `tests/integration/sales-reconciliation.test.ts`.

**Interfaces:**

- Consumes: Ledger facts, business date/timezone, projection watermark.
- Produces: `GET /v1/reports/sales`, `/shifts`, `/robot-kpi`; CSV escaped export, effective/applied timestamps.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("late historical receipt adjusts the original business day", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.importApproved([{sourceType:"paper",sourceSeries:"M1",sourceNumber:"2",
      occurredAt:"2026-10-29T14:00:00Z",businessDate:"2026-10-29",
      totalMinor:"50000",paidCashMinor:"50000",fulfilled:true}]);
    expect((await lab.report("sales","2026-10-29")).netMinor).toBe("50000");
    expect((await lab.report("sales","2026-10-30")).netMinor).toBe("0");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/sales-reconciliation.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Ledger là nguồn tổng, materialized views rebuild được theo checkpoint. Report phân biệt revenue/payment/cash/change/refund, khung ca timezone và late adjustments. Không sửa ledger để khớp báo cáo.

```ts
export function netSales(gross:string, discount:string, returns:string) {
  return String(BigInt(gross) - BigInt(discount) - BigInt(returns));
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** E2E cover đầy đủ workflow mô tả demo, permissions, recovery UI, touch portrait/landscape, VI/EN. Loading/empty/error/stale/offline có rõ trạng thái, không hiển thị số zero thay missing sync.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/sales-reconciliation.test.ts`; kỳ vọng PASS. Report sum reconciles bill/payment/refund ledger, UTC ngày khác VN, CSV injection escaping. Rerun continuity scenarios impacted by new billing handlers. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W05-T06.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: reconcile operational reports and complete pos acceptance"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Tổng tiền/số lượng bảo toàn qua tách/gộp/hoàn, không đưa float vào ledger.
- [ ] QR chỉ đúng phiên bàn; nhân viên không được tự cấp quyền hoặc sửa policy offline.
- [ ] In unknown và payment unknown đi reconciliation, không retry vô hạn.
