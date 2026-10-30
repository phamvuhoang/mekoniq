# Wave 04 — partition, đối soát và nhập bù bảo trì Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đáp ứng đủ offline LAN, isolated devices và nhập bù sau shutdown.

**Architecture:** Giữ một coordinator; isolated ticket không tự sửa aggregate chung. Settlement grant khóa bill, historical imports chỉ tạo facts; handoff giữ unknown resources bị khóa.

**Tech Stack:** SQLite/PostgreSQL journal, TypeScript domain, Android exports, CSV parser, HTML reconciliation UI.

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

**Entry:** W03 đạt; có bill/order/mission thật để test partition, không chỉ journal note.

**Exit:** O01–O22 được chạy ở mức software/Android phù hợp, robot-specific cases dùng fake và sẽ qualify thật ở W06; gate A đạt.

**Đầu ra chạy được:** Chia hai POS thành hai mạng, ghi cùng bàn rồi nối lại; nhập lại file bảo trì hai lần không tăng doanh thu hoặc phát lệnh robot.

### W04-T01: Isolated capture và conflict workbench

**Depends on:** W02-T04, W03-T02, W03-T05

**Files:**

- Create: `packages/domain/src/continuity/{isolated-ticket,observations,reconciliation}.ts`.
- Create: `apps/tablet-web/src/screens/{IsolatedSales,Reconciliation}.ts`.
- Test: `tests/integration/partition-conflicts.test.ts`.

**Interfaces:**

- Consumes: JournalKind observation, device epoch/sequence, cached menu/policy.
- Produces: `Continuity.CaptureTicket`, `Continuity.RecordPaymentObservation`, `Continuity.LinkTicket`, `Continuity.ResolveConflict`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("same table in two partitions preserves both sources", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.partition("lan");
    await lab.command("device-a","Continuity.CaptureTicket",{id:"a-1",table:"table-1",totalMinor:"50000"});
    await lab.command("device-b","Continuity.CaptureTicket",{id:"b-1",table:"table-1",totalMinor:"20000"});
    await lab.heal(); await lab.sync();
    expect(await lab.count("IsolatedTicketRecorded")).toBe(2);
    expect(await lab.unresolvedConflictCount()).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/partition-conflicts.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Isolated tickets có namespace riêng; existing shared bill mutation bị chặn. New local takeaway cash trong grant được ghi; không giả settlement của bill snapshot không sở hữu. Conflict resolution cần manager và version, giữ link/audit hai nguồn.

```ts
export function mayMutateShared(mode:string, hasGrant:boolean) {
  return mode === "coordinated" || hasGrant;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** UI cảnh báo dữ liệu cache thời điểm nào; quantity/preparation observations hiển thị pending. Resolve duplicate chỉ tạo link/compensation có lý do, không delete cash record; paper source references dùng chung ở T04.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/partition-conflicts.test.ts`; kỳ vọng PASS. O04/O05, permission expiry chuyển capture-only, stock availability chưa biết, order tới bill đã closed. Không tự gộp theo bàn/time. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W04-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: reconcile isolated restaurant activity without data loss"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W04-T02: Settlement grants độc quyền và tiền chưa rõ

**Depends on:** W04-T01, W02-T02, W03-T05

**Files:**

- Create: `packages/domain/src/billing/{settlement-grant,grant-reconciliation}.ts`, `packages/contracts/schemas/settlement-grant.schema.json`.
- Test: `tests/integration/settlement-grants.test.ts`.

**Interfaces:**

- Consumes: Bill immutable version, ownership epoch, device signer, external payment state.
- Produces: `SettlementGrant.Issue`, `.Use`, `.Reconcile`; signed amount/method bound capability.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("expiry does not release an unconfirmed collection right", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("grant","grant-1",{billId:"bill-1",deviceId:"device-a",status:"issued",expiresAtMs:1000});
    await lab.advance(2000);
    expect((await lab.command("manager","SettlementGrant.Issue",{billId:"bill-1",deviceId:"device-b"})).code)
      .toBe("GRANT_UNRECONCILED");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/settlement-grants.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Lock remaining balance trong transaction; partial grants cộng không quá due. Pending/unknown provider payment chặn re-collection. Expiry cấm new spend nhưng không thu hồi ownership để cấp tiếp.

```ts
export function grantBlocksReissue(status:string) {
  return status === "issued" || status === "partially_used" || status === "unknown";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Native commit kiểm grant signed, device/currency/bill version, sum spent; UI new order cho bàn có frozen bill tạo supplemental bill. Excess late external payment thành unapplied funds, không sửa cash receipt.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/settlement-grants.test.ts`; kỳ vọng PASS. O06, two concurrent spends, restart before ACK, forged grant, duplicate receipt, refund/close khi unresolved và expired offline auth. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W04-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: reserve offline settlement rights until reconciled"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W04-T03: Maintenance window, export và phiếu dự phòng

**Depends on:** W04-T01, W03-T04

**Files:**

- Create: `packages/domain/src/continuity/{maintenance-window,checkpoint,export}.ts`.
- Create: `apps/tablet-web/src/screens/Maintenance.ts`, `docs/templates/maintenance-receipts.csv`.
- Create: `apps/tablet-android/android/app/src/main/java/io/mekoniq/tablet/export/JournalExport.kt`.
- Test: `tests/integration/maintenance-checkpoint.test.ts`.

**Interfaces:**

- Consumes: Device cursor inventory, mission loads, open bills/grants, native file export.
- Produces: `Maintenance.Prepare`, `.Enter`, `.Resume`, `Continuity.Export`; encrypted export manifest hashes; printable numbered form.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("full shutdown exposes unresolved cargo instead of declaring clean", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("mission","m-1",{loaded:true,status:"executing"});
    const r = await lab.command("manager","Maintenance.Enter",{mode:"full_shutdown"});
    expect(r.code).toBe("UNRESOLVED_CARGO");
    expect(await lab.count("MaintenanceEntered")).toBe(0);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/maintenance-checkpoint.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Prepare inventory all enrolled devices/checkpoints/unknowns; planned shutdown requires load disposition and explicit list missing devices. Unplanned incident capture không đòi checkpoint tồn tại. Export preserves original IDs/signatures, separate encrypted key handling.

```ts
export function checkpointClean(s:{loadedMissions:number;unknownGrants:number;missingDevices:number}) {
  return s.loadedMissions === 0 && s.unknownGrants === 0 && s.missingDevices === 0;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** PDF/CSV template gồm series/no, occurredAt confidence, table/items/prices/tax/discount/payment/fulfillment/staff; export qua Android Storage Access Framework, không upload secrets. Local journal pending chặn normal reset.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/maintenance-checkpoint.test.ts`; kỳ vọng PASS. O08/O13/O22, export interrupted/hash mismatch/restore dry-run. Cloud-only maintenance không bắt operator nhập lại journal thủ công. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W04-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: prepare auditable maintenance and offline recording"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W04-T04: Import lịch sử idempotent và duyệt theo receipt

**Depends on:** W04-T01..W04-T03, W02-T05

**Files:**

- Create: `packages/domain/src/continuity/{import-batch,import-validator,import-apply,source-links}.ts`.
- Create: `apps/tablet-web/src/screens/ImportHistory.ts`, `tests/fixtures/import/maintenance.csv`.
- Test: `tests/integration/historical-import.test.ts`.

**Interfaces:**

- Consumes: Money, source identity, provenance, side-effect firewall, manager approval.
- Produces: `Import.Validate`, `.Preview`, `.Approve`, `.Apply`, `.Amend`; per-row result + stable source key.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
test("import and re-import never repeat money or robot commands", async () => {
  const lab = await createRestaurantLab();
  try {
    const receipt = {sourceType:"paper",sourceSeries:"M1",sourceNumber:"001",
      totalMinor:"50000",paidCashMinor:"50000",fulfilled:true};
    await lab.importApproved([receipt]);
    await lab.importApproved([receipt]);
    expect(await lab.count("HistoricalReceiptRecorded")).toBe(1);
    expect(await lab.effectCount("robot.execute")).toBe(0);
    expect(await lab.effectCount("payment.capture")).toBe(0);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/historical-import.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Dedup venue+sourceType+series+number, hash changed→conflict; approval snapshot hash chống file đổi sau preview. Apply transaction mỗi receipt, checkpoint từng row. Device exports giữ IDs gốc và late paper/device source link gỡ double revenue.

```ts
export function sourceKey(r:{venueId:string;sourceType:string;sourceSeries:string;sourceNumber:string}) {
  return JSON.stringify([r.venueId,r.sourceType,r.sourceSeries,r.sourceNumber]);
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Preview gross/net/discount/payment/stock impact trước approve. historical_import chỉ tạo ledger/projection; unknown transfer/terminal là observation. Serving pending work phải qua command mới. CSV formula escaping cho export; input bounded rows/bytes và parser quoted fields chuẩn.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/historical-import.test.ts`; kỳ vọng PASS. O14–O18, duplicate file rename/order, changed receipt, kill midway, approval reuse, occurredAt/recordedAt, corrected applied row dùng amendment. Inventory chưa bật giữ deferred adjustment exception để W07 đối soát. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W04-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: import maintenance history without replaying live actions"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W04-T05: Handoff, restore và reconciliation của robot

**Depends on:** W04-T02, W04-T03, W03-T04

**Files:**

- Create: `packages/domain/src/continuity/{handoff,recovery-inventory}.ts`, `packages/domain/src/fleet/reconcile.ts`.
- Create: `apps/tablet-web/src/screens/Recovery.ts`, `docs/operations/coordinator-recovery.md`.
- Test: `tests/integration/ownership-handoff.test.ts`.

**Interfaces:**

- Consumes: Device epochs, journal cursor, controlEpoch/native goal, unresolved grants and region occupancy.
- Produces: `Ownership.PrepareHandoff`, `.Fence`, `.Activate`; `Robot.Reconcile`; never timeout takeover.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("unknown robot goal prevents activating a replacement coordinator", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("robot","sim-1",{controlEpoch:3,goalState:"unknown"});
    const r = await lab.command("manager","Ownership.Activate",{venueId:"venue-a",newDeviceId:"device-b"});
    expect(r.code).toBe("RESOURCE_UNRECONCILED");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/ownership-handoff.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Prepare freezes new shared work; transfer checkpoint then fence old owner and persist executor epoch ACK; only then activate new owner. Old missing owner requires physical/protocol evidence fencing, otherwise capture mode. Replay log recovery never clears idempotency keys.

```ts
export function canActivate(s:{fenced:boolean;cursorComplete:boolean;unknownResources:number}) {
  return s.fenced && s.cursorComplete && s.unknownResources === 0;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Restore UI displays sources missing, loaded trays, unknown goals/payments, stale map and reservations; stale commands expire/quarantine. Reconcile query native adapter separately from resend; operator release có audit.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/ownership-handoff.test.ts`; kỳ vọng PASS. O10/O11/O20/O22 with fake executor crash windows; same tests run real adapter in W06. Partition during each handoff step never two active epochs. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W04-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: fence ownership during controlled recovery"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W04-T06: Gate A: chạy toàn bộ bộ continuity

**Depends on:** W04-T01..W04-T05

**Files:**

- Create: `tests/acceptance/continuity-suite.ts`, `tests/android/ContinuityAcceptanceTest.kt`.
- Create: `docs/implementation/gates/A-continuity.md`, `docs/operations/maintenance-recovery.md`.
- Test: `tests/acceptance/continuity-suite.test.ts`.

**Interfaces:**

- Consumes: O01–O22 mappings trong plan tổng; real DBs, Android lab và fake adapter.
- Produces: `runContinuityScenario(id,lab):Promise<ScenarioReport>`; report per scenario physical/software status.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { continuityScenarioIds } from "./continuity-suite";
test("all continuity cases have executable registered scenarios", () => {
  const expected = Array.from({length:22},(_,i)=>"O"+String(i+1).padStart(2,"0"));
  expect(continuityScenarioIds().sort()).toEqual(expected);
});
// Mỗi scenario còn assert state/ledger/native action count;
// kiểm registration này không thay các behavioral tests.
```

- [ ] **2. Chạy RED.** `pnpm test:acceptance -- continuity`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Scenario registry trỏ từng test thực đã có, không no-op case. O13 chạy soak 24h trên Android ngoài quick CI; clock injection kiểm expiry nhanh riêng. Compile signed release APK để kiểm test hooks bị loại.

```ts
export type ScenarioReport = {
  id:string; software:"passed"|"failed";
  android:"passed"|"failed"|"not_run";
  hardware:"passed"|"failed"|"not_required"|"not_run";
  evidence:string[];
};
```

- [ ] **4. Nối vào runtime và lưu trữ.** Gate A đòi DB/Android checks, prototype staff walkthrough và import dry-run; actual robot gate để B. Persist report artifacts commit+versions; fail release jobs khi mandatory test not_run.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:acceptance -- continuity`; kỳ vọng PASS. O01–O22 trace verified, confirm counts/money/IDs after heal, no live effect replay. Báo cáo riêng 24h soak vs time-advanced unit tests. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W04-T06.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "test: qualify disconnected operation and maintenance recovery"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Ghi độc lập vẫn giữ nguyên nguồn; không LWW cho tiền hoặc mission.
- [ ] Bill/grant/robot unknown không được auto takeover; expired grant không giải phóng hạn mức.
- [ ] Import có dry-run, review, partial resume, amendments và late-device dedup; cloud/whole-app maintenance đều có runbook.
