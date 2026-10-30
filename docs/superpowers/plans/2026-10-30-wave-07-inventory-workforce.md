# Wave 07 — kho, mua hàng và nhân sự vận hành Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bổ sung quản trị chi phí nguyên liệu và nhân sự với ledger có thể đối soát.

**Architecture:** Stock movements append-only theo source event và recipe version. Receipt/procurement/stocktake có quyền và audit; offline observations cùng continuity workflow.

**Tech Stack:** TypeScript domain, SQLite/PostgreSQL projections, HTML tablet, Next.js backoffice, decimal quantities.

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

**Entry:** W05 POS/billing và W04 historical import đạt; không cần chờ vendor robot còn blocked.

**Exit:** Món chế biến trừ kho một lần; mua/nhận/trả/kiểm kê và ca nhân viên có UI/API/report.

**Đầu ra chạy được:** Nhận hàng hai đợt, chế biến món, hủy món đã làm ghi hao hụt, kiểm kê tạo adjustment và báo cáo giá vốn.

### W07-T01: Recipe, đơn vị và tiêu hao khi chế biến

**Depends on:** W03-T03, W04-T04

**Files:**

- Create: `packages/domain/src/inventory/{recipe,uom,movement,consumption}.ts`.
- Create: `apps/tablet-web/src/screens/{Recipes,Inventory}.ts`.
- Test: `tests/integration/stock-consumption.test.ts`.

**Interfaces:**

- Consumes: KitchenPrepared source event, quantity scaled integer, recipe version snapshot.
- Produces: `Recipe.Publish`, `Inventory.Consume`, `Inventory.RecordWaste`; idempotency source+recipe line.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("replayed preparation consumes stock once", async () => {
  const lab = await createRestaurantLab();
  try {
    const data={sourceEventId:"prep-1",recipeVersion:"rice-v1",quantity:"2"};
    await lab.command("chef","Inventory.Consume",data,"stock-a");
    await lab.command("chef","Inventory.Consume",data,"stock-b");
    expect(await lab.count("StockConsumed")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/stock-consumption.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Recipe conversions có dimension/scale; reject kg→piece thiếu conversion. Consumption tại kitchen-prepared theo policy đã snapshot, cancel đồ đã chế biến tạo waste/disposition, không tự restock.

```sql
CREATE UNIQUE INDEX stock_source_recipe
ON stock_movement(venue_id, source_event_id, recipe_version, ingredient_id, movement_kind);
```

- [ ] **4. Nối vào runtime và lưu trữ.** Recipes UI version publish; native same commands offline. Historical import recipe missing mở exception thay vì dùng current recipe. FIFO hoặc weighted-average policy được version; bản đầu weighted-average được đo với exact quantities.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/stock-consumption.test.ts`; kỳ vọng PASS. Unit conversion, fractional quantity, recipe updated mid-order, returned uncooked ingredient requires explicit receipt, duplicate historical source. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W07-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: derive stock consumption from versioned recipes"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W07-T02: Nhà cung cấp, mua hàng, nhận/trả và giá vốn

**Depends on:** W07-T01

**Files:**

- Create: `packages/domain/src/procurement/{supplier,purchase-order,goods-receipt,return,cost}.ts`.
- Create: `apps/tablet-web/src/screens/Purchasing.ts`.
- Test: `tests/integration/procurement.test.ts`.

**Interfaces:**

- Consumes: Stock movement ledger, purchase order versions and supplier refs.
- Produces: `Purchase.Create`, `.Approve`, `Goods.Receive`, `.Return`; partial receipts, moving weighted cost.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("repeated delivery note does not receive twice", async () => {
  const lab = await createRestaurantLab();
  try {
    const p={purchaseId:"po-1",supplierReceipt:"SUP-10",ingredientId:"rice-raw",quantity:"1000"};
    await lab.command("manager","Goods.Receive",p,"receive-a");
    await lab.command("manager","Goods.Receive",p,"receive-b");
    expect(await lab.count("GoodsReceived")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/procurement.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Supplier external receipt scoped supplier+venue+number; qty receiving bounded remaining unless explicit approved tolerance. Cost layers/weighted numerator use integer scales; returns reference original receipt cost.

```ts
export function receivable(ordered:string, received:string, tolerance:string) {
  return String(BigInt(ordered) + BigInt(tolerance) - BigInt(received));
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Procurement UI create→approve→receive partial→close; API ownership venue, inventory postings same transaction; AP accounting outside scope, export payable summary only.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/procurement.test.ts`; kỳ vọng PASS. Concurrent receive, overreceive, supplier note reused altered payload, return exceeds receipt, currency/UOM mismatch and offline receipt reconciliation. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W07-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: track purchasing receipts returns and ingredient cost"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W07-T03: Kiểm kê, hao hụt và lịch sử điều chỉnh

**Depends on:** W07-T01, W07-T02

**Files:**

- Create: `packages/domain/src/inventory/{stocktake,adjustment,valuation}.ts`, `apps/tablet-web/src/screens/Stocktake.ts`.
- Test: `tests/integration/stocktake.test.ts`.

**Interfaces:**

- Consumes: Stock ledger checkpoint/time, counted values, manager permission.
- Produces: `Stocktake.Open`, `.Count`, `.Approve`, `.Apply`; delta at count checkpoint, never absolute overwrite.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { stocktakeAdjustment } from "../../packages/domain/src/inventory/stocktake";
import { applyAdjustment } from "../../packages/domain/src/inventory/stocktake";
test("stocktake preserves movements after the counted checkpoint", () => {
  expect(stocktakeAdjustment({atCheckpoint:"100",counted:"90"})).toBe("-10");
  expect(applyAdjustment({current:"120",delta:"-10"})).toBe("110");
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/stocktake.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Count sheet snapshot ledger watermark; adjustment tính counted-minus-checkpoint then append to current stock. Missing clock confidence requires review, không last-write-wins quantity.

```ts
export function stocktakeAdjustment(s:{atCheckpoint:string;counted:string}) {
  return String(BigInt(s.counted)-BigInt(s.atCheckpoint));
}
export function applyAdjustment(s:{current:string;delta:string}) {
  return String(BigInt(s.current)+BigInt(s.delta));
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Reason codes waste/spoilage/count correction, evidence photos optional, approval separation configurable. Reports show estimated/missing cost explicitly.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/stocktake.test.ts`; kỳ vọng PASS. Concurrent sales during count, count duplicate/changed import, stock negative policy, stale approval and partial apply recovery. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W07-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: apply auditable inventory adjustments without overwriting movement"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W07-T04: Lịch ca, chấm công và báo cáo vận hành

**Depends on:** W02-T01, W05-T06, W07-T01..W07-T03

**Files:**

- Create: `packages/domain/src/workforce/{schedule,attendance,approval}.ts`, `apps/tablet-web/src/screens/{Staff,InventoryReports}.ts`.
- Create: `apps/cloud-web/src/components/backoffice/OperationsReports.tsx`, `apps/cloud-web/src/app/(backoffice)/admin/operations/page.tsx`; cloud reports có watermark, thao tác venue qua relay, chấm công/kho tại tablet không phụ thuộc Next.js.
- Create: `packages/domain/src/reporting/{stock,food-cost,attendance}.ts`.
- Test: `tests/integration/workforce-reporting.test.ts`.

**Interfaces:**

- Consumes: Staff identities/roles, business date, ledger watermark.
- Produces: `Staff.Schedule`, `.ClockIn`, `.ClockOut`, `.ApproveCorrection`; inventory/cost/attendance report projections.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("a kitchen actor cannot grant itself refund permission", async () => {
  const lab = await createRestaurantLab();
  try {
    expect((await lab.command("chef","Staff.SetPermissions",
      {userId:"chef",permissions:["refund"]})).code).toBe("FORBIDDEN");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/workforce-reporting.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Clock-in/out event sources immutable; late attendance changes manager amendment, overlap/night shift rules timezone aware. Report joins are projections, not updates to source ledgers.

```ts
export function attendanceDuration(startMs:number,endMs:number) {
  if (endMs < startMs) throw new Error("NEGATIVE_DURATION");
  return endMs-startMs;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Staff UI controls station assignment/permission via cloud identity workflow; offline grant revocation pending explicit. Stock/food-cost report costs matched recipe/purchase version, CSV escaped.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/workforce-reporting.test.ts`; kỳ vọng PASS. Overnight shift, duplicate offline punch, different device identity, concurrent permission change, report ledger reconciliation and no payroll claims. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W07-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: manage staff operations and inventory reporting"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Source ID idempotency và recipe snapshot giữ đúng cả khi import lịch sử.
- [ ] Stocktake không ghi đè movements giữa thời điểm đếm và apply.
- [ ] Nhân sự vận hành không biến thành module tính lương/thuế ngoài scope.
