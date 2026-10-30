# Wave 08 — khuyến mãi, CRM, đặt bàn và mô hình nhà hàng Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn tất các nhóm quản trị thương mại và preset nhiều loại nhà hàng.

**Architecture:** Promotion/loyalty có ledger/limits, reservation có tài nguyên theo giờ, buffet/combo/weighted pricing dùng engine đã version. Mọi thay đổi kiểm cùng policy và offline rules.

**Tech Stack:** TypeScript domain, transactional limits, React backoffice/guest UI.

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

**Entry:** W05 và W07 phần inventory/reporting đạt; W04 grant/reconciliation sẵn.

**Exit:** Promotion, loyalty, booking/deposit, buffet/combo/món cân có API/UI/E2E; gate C đối chiếu F01–F22/F26.

**Đầu ra chạy được:** Khách đặt bàn có cọc, dùng combo/voucher, tích điểm sau settlement; hoàn món và đóng bill vẫn khớp các ledger.

### W08-T01: Promotion, voucher và giới hạn dùng

**Depends on:** W05-T01, W04-T02

**Files:**

- Create: `packages/domain/src/promotions/{rules,stacking,voucher,redemption}.ts`, `apps/operations-ui/src/routes/Promotions.tsx`.
- Test: `tests/integration/voucher-limits.test.ts`.

**Interfaces:**

- Consumes: Price snapshot/allocations, owned limit/grant, UTC+venue timezone.
- Produces: `Promotion.Publish`, `Voucher.Reserve`, `.Redeem`, `.Release`; prioritized deterministic discount plan.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("a single-use voucher cannot be spent twice concurrently", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("voucher","V1",{remaining:1,scope:"venue-a"});
    const rs=await Promise.all(["a","b"].map(id=>lab.command("cashier","Voucher.Redeem",
      {voucherId:"V1",billId:id},"voucher-"+id)));
    expect(rs.filter(r=>r.status==="accepted")).toHaveLength(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/voucher-limits.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Eligibility items/time/customer/channel/venue, priority and exclusion groups; no arbitrary uploaded JS rules. Discount capture snapshot và redemption atomic ở authoritative owner.

```sql
UPDATE voucher_balance SET remaining = remaining - 1
WHERE voucher_id = :id AND remaining > 0;
-- Chỉ redeem nếu affected rows = 1, trong transaction cùng ledger entry.
```

- [ ] **4. Nối vào runtime và lưu trữ.** Refund restores usage only theo snapshot policy và unique reversal source. Shared multi-venue voucher online authority hoặc bounded escrow; default offline deny redemption chứ không ignore limit.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/voucher-limits.test.ts`; kỳ vọng PASS. Timezone boundary, stacking cap cannot negative total, retry reservation, unknown payment reservation held, stale grant and parallel spend. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W08-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: enforce deterministic promotions and redemption limits"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W08-T02: CRM, consent và loyalty ledger

**Depends on:** W08-T01, W05-T03

**Files:**

- Create: `packages/domain/src/customers/{profile,consent,loyalty}.ts`, `apps/operations-ui/src/routes/Customers.tsx`.
- Test: `tests/integration/loyalty.test.ts`.

**Interfaces:**

- Consumes: Settled bill source ID, refund reversal link, customer scope/consent.
- Produces: `Customer.Upsert`, `Consent.Record`, `Loyalty.Earn`, `.Redeem`, `.Reverse`; identity linking audited.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("duplicate settlement cannot award duplicate loyalty", async () => {
  const lab = await createRestaurantLab();
  try {
    const p={customerId:"customer-1",settlementId:"pay-1",points:"50"};
    await lab.command("cashier","Loyalty.Earn",p,"earn-a");
    await lab.command("cashier","Loyalty.Earn",p,"earn-b");
    expect(await lab.count("LoyaltyEarned")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/loyalty.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Separate personally identifying customer data và financial records; consent versioned purpose/channel. Earn từ actual net settled values theo policy; reversing refund không quá points đã earn.

```sql
CREATE UNIQUE INDEX loyalty_source
ON loyalty_entry(organization_id, customer_id, source_event_id, entry_kind);
```

- [ ] **4. Nối vào runtime và lưu trữ.** Offline earned points pending until authoritative sync; shared redemption only online/escrow allowed. Customer merge lưu source linkage, financial history không hard delete; data request/retention workflow audit.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/loyalty.test.ts`; kỳ vọng PASS. Duplicate phone not auto merge wrong customer, consent withdrawal, cross-tenant read, reward redemption races/refund, offline shared balance deny. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W08-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: maintain customer consent and auditable loyalty"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W08-T03: Booking, waitlist và chuyển cọc vào bill

**Depends on:** W05-T02, W05-T03

**Files:**

- Create: `packages/domain/src/reservations/{booking,resource,waitlist,deposit}.ts`, `apps/operations-ui/src/routes/Reservations.tsx`.
- Test: `tests/integration/reservations.test.ts`.

**Interfaces:**

- Consumes: Table resource/time range, owner transactions, payment ledger.
- Produces: `Booking.Create`, `.Confirm`, `.CheckIn`, `.NoShow`, `Deposit.Apply`, `Waitlist.Promote`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("a paid deposit is applied to a bill only once", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("deposit","dep-1",{paidMinor:"200000",appliedMinor:"0"});
    const p={depositId:"dep-1",billId:"bill-1",amountMinor:"200000"};
    await lab.command("cashier","Deposit.Apply",p,"dep-a");
    await lab.command("cashier","Deposit.Apply",p,"dep-b");
    expect(await lab.count("DepositApplied")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/reservations.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Reservation overlap check under venue lock/time interval not browser; holds timeout only provisional no payment unknown release automatically. Deposit liability then applied/returned ledger distinct sales.

```ts
export function rangesOverlap(a:{start:number;end:number},b:{start:number;end:number}) {
  return a.start < b.end && b.start < a.end;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Cloud reservation request unconfirmed until venue resource owner ACK when required. Offline isolated booking provisional, không guarantee table. Check-in binds new table session, no-show requires defined policy and funds reconciliation.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/reservations.test.ts`; kỳ vọng PASS. Concurrent overlaps, adjacent intervals, timezone/business date, late arrival, partial deposit/refund, waitlist order and table merge dependency. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W08-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: manage reservations and deposits without double counting"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W08-T04: Buffet, combo, món cân và preset acceptance

**Depends on:** W08-T01..W08-T03, W07

**Files:**

- Create: `packages/domain/src/pricing/{buffet,combo,weighed}.ts`, `packages/domain/src/policy/preset-acceptance.ts`.
- Create: `tests/e2e/restaurant-presets.spec.ts`, `docs/implementation/gates/C-restaurant-suite.md`.
- Test: `tests/unit/restaurant-models.test.ts`.

**Interfaces:**

- Consumes: Quantity scale, recipe links, price/time policies and readiness.
- Produces: `Buffet.Start/Extend`, `Combo.Quote`, `WeighedItem.Quote`; cafe/table-service/buffet/robot-only/no-robot/chain preset templates.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { priceByMass } from "../../packages/domain/src/pricing/weighed";
test("weighed pricing uses integer mass rather than float multiplication", () => {
  expect(priceByMass("200000","375","1000")).toBe("75000");
  expect(() => priceByMass("200000","-1","1000")).toThrow();
});
```

- [ ] **2. Chạy RED.** `pnpm test:unit -- tests/unit/restaurant-models.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Weighed line stores measured quantity/unit/source/manual approval; buffet duration policy and monotonic elapsed evidence flag restart/clock issues; combo nested items snapshot individual stock mapping and discount allocation.

```ts
export function priceByMass(price:string,mass:string,unitMass:string) {
  const m=BigInt(mass), u=BigInt(unitMass);
  if (m<0n || u<=0n) throw new Error("INVALID_MASS");
  return String((BigInt(price)*m + u/2n)/u);
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** UI selects models and guided configuration; preset new version migration preview, không silently enable missing module. Reports display price basis and cost/loyalty consistent. Physical scale integration optional profile, no fake supported hardware.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:unit -- tests/unit/restaurant-models.test.ts`; kỳ vọng PASS. Combo refund one component, buffet extensions/reset clock, zero/negative/large mass, cafe/no-robot runs fully, robot-only no menu needed. Gate C includes F16–F20/F26 real workflows. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W08-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: support distinct restaurant pricing and service models"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Không tiêu điểm/voucher dùng chung khi offline nếu chưa có quyền phân bổ độc quyền.
- [ ] Cọc là khoản phải thực hiện/hoàn, không cộng doanh thu hai lần khi áp bill.
- [ ] Presets chỉ bật module đã có implementation và readiness, không hiện placeholder feature.
