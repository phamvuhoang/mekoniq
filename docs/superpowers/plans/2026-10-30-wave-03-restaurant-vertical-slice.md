# Wave 03 — menu đến bếp, robot giả lập và bill tiền mặt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo luồng nhà hàng chạy xuyên suốt bằng runtime thật trước khi mở rộng phạm vi POS.

**Architecture:** Các domain module cùng command kernel ở coordinator. Menu/order/KDS/fulfillment/mission/billing có state riêng, liên kết qua ID và lượng; UI dùng projection đã commit.

**Tech Stack:** TypeScript domain, SQLite coordinator, PostgreSQL projections, React tablet UI, deterministic robot fake.

**Spec:** [Production](../specs/2026-10-30-production-platform-design.md), [Continuity](../specs/2026-10-30-offline-continuity-design.md), [F01–F30](../../product/2026-10-30-capability-matrix.md).

## Global Constraints

- “Xây lại mã trong `source`; `trial` là nguồn tham khảo hành vi, không phải nhánh để sửa.”
- “Cloud là nền tảng trung tâm. Không lắp máy chủ riêng tại nhà hàng.”
- “Bản đầu dùng **coordinator cố định, không tự bầu leader khi timeout**.”
- “Tiền lưu số nguyên theo đơn vị tiền nhỏ nhất; VND là đồng. Không cộng tiền bằng float.”
- “Không tự phát lệnh di chuyển/thu tiền/in/xuất hóa đơn khi replay lịch sử.”
- “Cloud ACK là đã commit ở cloud; ACK LAN là coordinator đã commit.”
- Node.js 24 LTS; PostgreSQL 18; TypeScript strict; SQLite native trên Android; robot baseline ROS 2 Jazzy / Ubuntu 24.04 / Gazebo Harmonic.
- Đọc [plan tổng và hợp đồng dùng chung](2026-10-30-production-implementation-plan.md) trước task; mọi đường dẫn/command tính từ `source/`.
- Đây là kế hoạch, chưa có application files hoặc scripts bên dưới. Tạo chúng tại task sở hữu; không chạy lệnh triển khai/robot thật chỉ để kiểm tra tài liệu.
- Không đánh dấu PASS khi thiếu thiết bị/provider; ghi `blocked_external` cho đúng acceptance gate, tiếp tục task không phụ thuộc.

---

## Entry / exit

**Entry:** W00–W02 đạt; cloud và app cùng schema, identity/policy/transport hoạt động.

**Exit:** Hai POS, một KDS và một executor fake hoàn tất order→ready→load→handoff→cash receipt, kể cả mất WAN.

**Đầu ra chạy được:** Bàn 01 gọi hai món, bếp làm từng phần; một khay được giao bằng robot giả lập, một phần giao tay; thu tiền và sync không trùng.

### W03-T01: Catalog phiên bản và giá snapshot cơ bản

**Depends on:** W00-T03, W02-T03

**Files:**

- Create: `packages/domain/src/catalog/{menu,price-book,publish}.ts`, `apps/operations-ui/src/routes/MenuEditor.tsx`.
- Create: `tests/fixtures/restaurant-v1.json`, `tests/support/restaurant-lab.ts`.
- Test: `tests/integration/menu-snapshot.test.ts`.

**Interfaces:**

- Consumes: Money, config revision, feature authorization.
- Produces: `Catalog.Publish`, `Catalog.Quote`; `createRestaurantLab()` = createLab + fixture org/venue/actors/table/menu/robot có định nghĩa trong task.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("existing quote retains menu price after publication", async () => {
  const lab = await createRestaurantLab();
  try {
    const q = await lab.command("cashier","Catalog.Quote",{items:[{itemId:"rice",quantity:"1"}]});
    await lab.command("manager","Catalog.Publish",{version:2,prices:{rice:"60000"}});
    expect(q.value.totalMinor).toBe("50000");
    expect((await lab.command("cashier","Catalog.Quote",{items:[{itemId:"rice",quantity:"1"}]})).value.totalMinor)
      .toBe("60000");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/menu-snapshot.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Fixture: rice=50000 VND tại kitchen, tea=20000 tại bar, table-1, station kitchen/bar/wash, robot sim-1 2 khay không bắt buộc dock, actors cashier/chef/manager/guest. Snapshot name/price/station/version tại quote; actual place order revalidates quote version.

```ts
export function lineTotal(unitMinor:string, quantity:string) {
  if (!/^[1-9][0-9]*$/.test(quantity)) throw new Error("INVALID_QUANTITY");
  return String(BigInt(unitMinor) * BigInt(quantity));
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** CRUD menu bằng permission riêng; publish chặn item thiếu trạm/giá/currency. UI menu editor + cashier picker VI/EN; immutable menu versions, sold-out là availability riêng.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/menu-snapshot.test.ts`; kỳ vọng PASS. Client gửi giá giả, stale quote, item sold-out, category station missing và zero/negative quantity. Modifier/tax nâng ở W05, không bật giả trước đó. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W03-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: publish versioned menus and authoritative quotes"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W03-T02: Phiên bàn và vòng đời order có version

**Depends on:** W03-T01

**Files:**

- Create: `packages/domain/src/orders/{session,order,commands}.ts`, `packages/domain/src/orders/module.ts`.
- Create: `apps/operations-ui/src/routes/Pos.tsx`, `packages/sync/migrations/sqlite/002_orders.sql`.
- Test: `tests/integration/order-lifecycle.test.ts`.

**Interfaces:**

- Consumes: Catalog.Quote, AtomicStore, `createRestaurantLab`.
- Produces: `Session.Open`, `Order.Place`, `Order.Amend`, `Order.Cancel`; events `OrderAccepted`, `OrderAmended`, `OrderCancelled`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("retry place order creates one kitchen input", async () => {
  const lab = await createRestaurantLab();
  try {
    const payload = {sessionId:"session-1",tableId:"table-1",menuVersion:1,
      items:[{itemId:"rice",quantity:"2"}]};
    await lab.command("cashier","Session.Open",{sessionId:"session-1",tableId:"table-1"});
    await lab.command("cashier","Order.Place",payload,"place-1");
    await lab.command("cashier","Order.Place",payload,"place-1");
    expect(await lab.count("OrderAccepted")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/order-lifecycle.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Order chứa immutable line price, quantity, station, session và policy revision. Mọi amendment là delta mới và CAS; không sửa/xóa line đã chế biến bằng cách thay array nguyên khối.

```ts
if (command.expectedVersion !== order.version)
  return {ok:false,code:"VERSION_CONFLICT"};
if (order.status === "closed")
  return {ok:false,code:"ORDER_CLOSED"};
// Thành công trả DomainEvent; processor commit cùng journal và outbox.
```

- [ ] **4. Nối vào runtime và lưu trữ.** Register modules vào production coordinator và test lab. UI giữ giỏ tới accepted ACK, local/unknown state riêng; permission server-side và disabled QR không chặn POS.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/order-lifecycle.test.ts`; kỳ vọng PASS. Concurrent edits, close rồi gửi lệnh cũ, wrong tenant/table session và client retry changed payload. Order cancellation không tự refund hoặc hủy tải trên robot. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W03-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: persist table sessions and versioned restaurant orders"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W03-T03: KDS theo trạm và allocation số lượng

**Depends on:** W03-T02

**Files:**

- Create: `packages/domain/src/kitchen/{ticket,readiness}.ts`, `packages/domain/src/fulfillment/{allocation,handoff}.ts`.
- Create: `apps/operations-ui/src/routes/Kitchen.tsx`.
- Test: `tests/integration/kitchen-allocation.test.ts`.

**Interfaces:**

- Consumes: OrderAccepted line quantity và station; actor station scope.
- Produces: `Kitchen.Accept`, `Kitchen.Ready`, `Fulfillment.Allocate`, `Fulfillment.HandOff`; `ready-allocated-served` conservation.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("two dispatchers cannot allocate the same ready portion", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("fulfillment","line-1",{ready:"1",allocated:"0",served:"0",version:1});
    const results = await Promise.all([
      lab.command("cashier","Fulfillment.Allocate",{lineId:"line-1",quantity:"1",expectedVersion:1}),
      lab.command("cashier","Fulfillment.Allocate",{lineId:"line-1",quantity:"1",expectedVersion:1})
    ]);
    expect(results.filter(r => r.status==="accepted")).toHaveLength(1);
    expect(await lab.count("PortionAllocated")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/kitchen-allocation.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Trạm chỉ thấy ticket của mình; lượng ready là prepared chưa served, available=ready-allocated. Allocate và mission reference cập nhật trong transaction; cancellation trước load hoàn trả allocation, sau load đi return workflow.

```ts
export function availablePortions(ready:string, allocated:string) {
  const available = BigInt(ready) - BigInt(allocated);
  if (available < 0n) throw new Error("ALLOCATION_CORRUPT");
  return String(available);
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** KDS UI nhận/đang làm/sẵn sàng theo phần, reconnect theo cursor; outbox event duplicate không nhân ticket. Bàn/ticket ghi note chưa được sync rõ; âm thanh chỉ cue, không source of truth.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/kitchen-allocation.test.ts`; kỳ vọng PASS. Split kitchen/bar, partial prep, duplicate readiness, stale cancel và wrong station. Manual handoff dùng cùng allocation không tạo robot giả. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W03-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: track kitchen progress and reserve ready portions"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W03-T04: Mission state machine và simulator adapter

**Depends on:** W03-T03, W02-T02

**Files:**

- Create: `packages/domain/src/fleet/{mission,stop,scheduler,command-journal}.ts`.
- Create: `packages/robot-adapters/src/{contract,registry,simulator}.ts`, `apps/operations-ui/src/routes/Fleet.tsx`.
- Test: `tests/integration/simulated-delivery.test.ts`.

**Interfaces:**

- Consumes: RobotCommand schema, controlEpoch, fulfillment allocations, adapter contract trong plan tổng.
- Produces: `Mission.Create`, `Mission.ConfirmStop`, `Mission.Cancel`, `Robot.RequestStop`; `RobotAdapter`; deterministic simulator có clock/fault input.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("cancelling a loaded delivery requires a return stop", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("mission","m-1",{status:"executing",loaded:true,source:"kitchen",
      currentStopId:"table-stop",revision:2,robotId:"sim-1"});
    await lab.command("cashier","Mission.Cancel",{missionId:"m-1",expectedVersion:2});
    const m = await lab.state<{stops:{action:string}[]}>("mission","m-1");
    expect(m.stops.some(s=>s.action==="return")).toBe(true);
    expect(await lab.count("DeliveryHandedOff")).toBe(0);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/simulated-delivery.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** State/stop types đúng spec; old stop/token/revision reject. Simulator chỉ profile `simulated`; unknown driver không fallback. Persist command before adapter, status accepted không completed; map/parking không cần charging dock.

```ts
export function cancellationAction(loaded:boolean) {
  return loaded ? "return_then_unload" : "cancel_unloaded";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Scheduler lọc capability/map/load/battery rồi mới rank. Fleet UI hiển thị tải/stop/unknown; requestStop không đổi physical E-stop. Simulator faults: offline, blocked, delayed result, duplicate completed, reboot.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/simulated-delivery.test.ts`; kỳ vọng PASS. Các ca trial giao nhiều bàn, hủy đã tải, thu dọn không bỏ dở, stale confirm, retarget, pin thấp, timeout và queue tiếp; không port nguyên unsafe baseline payment behavior. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W03-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: execute persisted restaurant missions through simulator"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W03-T05: Bill snapshot và cash receipt tối thiểu

**Depends on:** W03-T02, W00-T03

**Files:**

- Create: `packages/domain/src/billing/{bill,settlement,payment-ledger}.ts`, `apps/operations-ui/src/routes/Checkout.tsx`.
- Create: `packages/domain/src/cash/basic-shift.ts` (Shift.Open tối thiểu; W05-T04 mở rộng).
- Test: `tests/integration/basic-settlement.test.ts`.

**Interfaces:**

- Consumes: Order lines snapshots, exact money, cashier authorization.
- Produces: `Shift.Open` tối thiểu, `Bill.Prepare`, `Payment.Claim`, `Payment.RecordCash`, `Bill.Close`; events `PaymentClaimed`, `CashRecorded`, `BillClosed`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("a customer claim cannot close a bill", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("bill","bill-1",{totalMinor:"100000",paidMinor:"0",status:"prepared",version:1});
    await lab.command("guest","Payment.Claim",{billId:"bill-1",method:"transfer"});
    expect((await lab.command("cashier","Bill.Close",{billId:"bill-1",expectedVersion:1})).code)
      .toBe("BALANCE_DUE");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/basic-settlement.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Bill immutable prepared snapshot; cash captured chỉ actor có quyền và active shift/test fixture. Claim là observation. Cash overpayment tính change riêng, payment ledger chỉ applied amount; close khi due=0 và không unresolved status.

```ts
export function dueMinor(total:string, applied:string, refunded:string) {
  return String(BigInt(total) - BigInt(applied) + BigInt(refunded));
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Tạo `Shift.Open` tối thiểu và nút mở ca trong Checkout để production journey không phụ thuộc fixture seed; W05-T04 mở rộng đóng ca/variance. Checkout lưu operation receipt, không lấy tổng từ client. QR tạm tính hiển thị claim pending, không giả provider settlement.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/basic-settlement.test.ts`; kỳ vọng PASS. Double tap cash, duplicate close, amount/currency mismatch và menu change after bill prepared. Wave03 chỉ tiền mặt, các phương thức khác hiển thị chưa bật. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W03-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: separate bill snapshots cash receipts and customer claims"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W03-T06: Ghép UI và kiểm thử vertical slice nhiều tablet

**Depends on:** W03-T01..W03-T05, W01-T05

**Files:**

- Create: `tests/e2e/restaurant-journey.spec.ts`, `tests/android/RestaurantJourneyTest.kt`.
- Modify: `apps/operations-ui/src/App.tsx`, `apps/tablet-android/src/coordinator-runtime.ts`.
- Create: `docs/operations/first-service.md`.
- Create: `tests/support/restaurant-journey.ts`.
- Test: `tests/integration/wan-outage-journey.test.ts`.

**Interfaces:**

- Consumes: Các command/module W03; lab network controls.
- Produces: Kịch bản `runRestaurantJourney(lab)` lưu ID output; POS/KDS/fleet/checkout release routes thật.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { runRestaurantJourney } from "../support/restaurant-journey";
import { createRestaurantLab } from "../support/restaurant-lab";
test("WAN loss leaves the LAN service journey operational", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.partition("wan");
    const result = await runRestaurantJourney(lab);
    expect(result.billStatus).toBe("closed");
    expect(result.missionStatus).toBe("completed");
    expect(await lab.cloudAppliedCount()).toBe(0);
    await lab.heal();
    await lab.sync();
    expect(await lab.count("CashRecorded")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/wan-outage-journey.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Helper `runRestaurantJourney` gọi Session.Open, Order.Place(rice1), Kitchen.Ready, Fulfillment.Allocate, Mission.Create, simulator advance, ConfirmStop load/handoff, Bill.Prepare, RecordCash50000, Close; tất cả qua router thật.

```ts
await lab.partition("wan");
const local = await runRestaurantJourney(lab);
await lab.heal();
await lab.sync();
return { local, pending: await lab.pendingCount("coordinator") };
```

- [ ] **4. Nối vào runtime và lưu trữ.** Playwright bấm UI thật cùng flow; Android test chạy 2 POS + KDS context và fake executor đánh dấu simulation. Không expose fixture query/test commands trong APK release.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/wan-outage-journey.test.ts`; kỳ vọng PASS. O01/O02 cơ bản; duplicate clicks/reconnect có cùng IDs. Kiểm role-sensitive projection, portraits, tiếng Việt/Anh và thao tác load/confirm không bị re-render nuốt. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W03-T06.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "test: verify the full restaurant journey without internet"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Món chưa ready không được gán khay; đã handoff không bị hủy bởi callback cũ.
- [ ] Customer payment claim không settlement; bill giữ giá snapshot.
- [ ] Tất cả giao diện tương tác với API/LAN thật; không dùng hardcoded demo state trong release.
