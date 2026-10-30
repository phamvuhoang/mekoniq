# Wave 09 — quản lý chuỗi và nền tảng tích hợp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quản lý nhiều chi nhánh, phát hành cấu hình và tiếp nhận kênh ngoài mà không phá quyền ghi tại venue.

**Architecture:** Cloud quản lý desired configuration và reports có watermark; coordinator ACK effective revision. Connector ingress/egress dùng signed messages, inbox/outbox và scoped service accounts.

**Tech Stack:** NestJS/PostgreSQL, React chain backoffice, OpenAPI SDK, webhook adapters, Node-RED examples.

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

**Entry:** W02 sync/policy và W05 business đạt; W08 cho chain promotions/loyalty.

**Exit:** Hai venue một online một offline không ảnh hưởng nhau; remote orders pending đúng; connector SDK/test kit chạy với sandbox protocols.

**Đầu ra chạy được:** Publish menu cho hai chi nhánh, một chi nhánh offline; nhận order ngoài có duplicate event, đúng một order chỉ sau venue ACK.

### W09-T01: Menu/config rollout theo chi nhánh

**Depends on:** W02-T03, W05-T01

**Files:**

- Create: `apps/cloud-api/src/modules/chain/{catalog-rollout,branch-overrides,rollout-state}.ts`.
- Create: `apps/operations-ui/src/routes/ChainConfiguration.tsx`.
- Test: `tests/integration/chain-rollout.test.ts`.

**Interfaces:**

- Consumes: Configuration.Publish/Apply, global+branch version and device ACK.
- Produces: `Chain.Publish`, `.RollBackForward`, `.CompareBranches`; desired/effective/failed/pending per branch.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("offline venue retains effective version until it acknowledges", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.partition("venue-b-wan");
    await lab.command("owner","Chain.Publish",{venues:["venue-a","venue-b"],revision:2});
    expect((await lab.state<{effective:number}>("venue-config","venue-b")).effective).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/chain-rollout.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Overlay chỉ field được phép, branch station/availability mappings validate locally. Rollback tạo revision mới trỏ snapshot cũ, không giảm revision hay edit accepted orders.

```ts
export function rolloutState(desired:number,effective:number) {
  return desired===effective ? "applied" : "pending";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Approval/publish role cloud; module readiness at venue có thể reject reason, retry same revision doesn't duplicate application. UI shows diff affected menu/preset, still running work pinned.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/chain-rollout.test.ts`; kỳ vọng PASS. One branch rejects missing station; others succeed; branch override collision and offline price snapshot remain stable. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W09-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: roll out versioned configuration across restaurant branches"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W09-T02: Báo cáo chuỗi và giới hạn dùng chung

**Depends on:** W05-T06, W08-T02, W09-T01

**Files:**

- Create: `apps/cloud-api/src/modules/chain/{reports,shared-entitlements}.ts`, `apps/operations-ui/src/routes/ChainReports.tsx`.
- Test: `tests/integration/chain-reporting.test.ts`.

**Interfaces:**

- Consumes: Synced ledger per venue, per-producer applied watermark, voucher/loyalty rights.
- Produces: `GET /v1/chain/reports`; `SharedBalance.Reserve/Reconcile`; per-branch lag and unreconciled quantities.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("missing venue data remains visible instead of reporting zero sales", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.partition("venue-b-wan");
    const report=await lab.report("chain-sales","2026-10-30");
    expect(report.incompleteVenueIds).toContain("venue-b");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/chain-reporting.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Reports aggregate only applied facts, mark source freshness. Shared redemption online authority by default; escrow grant exact bounded amount not duplicated on timeout; earning provisional until sync.

```ts
export function remainingEscrow(issued:string,used:string,returned:string) {
  return String(BigInt(issued)-BigInt(used)-BigInt(returned));
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Company owner can compare branches; branch manager scope never widened by report query. Define business date venue timezone and consolidated reporting timezone in response; exports include watermark.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/chain-reporting.test.ts`; kỳ vọng PASS. Duplicate branch journals, delayed historical import, revoked branch membership, shared redemption partition cannot overspend. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W09-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: report chain operations with explicit sync completeness"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W09-T03: Connector contract, online order ingress và effect receipts

**Depends on:** W02-T05, W03-T02

**Files:**

- Create: `integrations/core/src/{connector,inbox,outbox,webhook-signature,external-ids}.ts`.
- Create: `apps/cloud-api/src/modules/channels/{ingress,restaurant-ack}.ts`, `apps/guest-web/src/OnlineCheckout.tsx`.
- Test: `tests/integration/external-orders.test.ts`.

**Interfaces:**

- Consumes: Scoped external credentials, official webhook schema per profile; command routing.
- Produces: `Connector.verify/normalize/execute/query`; `ExternalOrder.Receive/Accept`; `202 received` + status endpoint; provider transaction IDs.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("duplicate external order waits for the venue rather than creating twice", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.partition("wan");
    const event={provider:"sandbox-channel",externalId:"ext-1",items:[{itemId:"tea",quantity:"1"}]};
    await lab.externalOrder(event); await lab.externalOrder(event);
    expect(await lab.count("ExternalOrderReceived")).toBe(1);
    expect(await lab.count("OrderAccepted")).toBe(0);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/external-orders.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Verify signature against raw body before parse, replay timestamp bound/provider event ID unique. Normalize items/currency without trusting external prices. Venue unavailable policy hold/reject with expiry, never falsely accepted.

```sql
CREATE UNIQUE INDEX external_order_identity
ON external_order(organization_id, venue_id, provider_id, merchant_id, external_id);
```

- [ ] **4. Nối vào runtime và lưu trữ.** Connector service account scope tenant/venue/channel; outbound timeouts become unknown then query, dead-letter requires operator action. Sandbox clearly tagged, real channel enabled only certified profile W10.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/external-orders.test.ts`; kỳ vọng PASS. Webhook forged/replayed/amount mismatch, duplicate differing payload quarantine, provider 429/retry, expired order when venue reconnects and partial fulfillment mapping. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W09-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: integrate external channels through durable verified commands"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W09-T04: Node-RED bridge và developer SDK

**Depends on:** W09-T03, W03-T04, W06-T01

**Files:**

- Create: `integrations/node-red/{flows.json,README.md}`, `integrations/sdk/src/{client,webhook-verifier}.ts`.
- Create: `tests/contract/automation-scopes.test.ts`, `docs/integrations/developer-guide.md`.
- Test: `tests/contract/automation-scopes.test.ts`.

**Interfaces:**

- Consumes: OpenAPI command endpoints, service account permissions, webhook signing/idempotency.
- Produces: Generated client `submitCommand`, `getCommandResult`; example subscribe fulfillment-ready→request delivery with explicit capability check.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("automation cannot bypass disabled delivery or access robot transport", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("feature","robot.delivery",{status:"disabled",revision:2});
    expect((await lab.command("integration","Mission.Create",{target:"table-1"})).code)
      .toBe("FEATURE_DISABLED");
    expect((await lab.http("integration","POST","/internal/robot/publish")).status).toBe(404);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:contracts -- tests/contract/automation-scopes.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Flow gọi API với operationId deterministic theo fulfillment source, handles accepted/pending/unknown; không embedded credentials trong flows. API evolution schema compatibility and rate limits documented.

```ts
const operationId = "delivery:" + externalFulfillmentId;
const result = await client.submitCommand({
  operationId, type:"Mission.Create", payload:{fulfillmentId:externalFulfillmentId}
});
// result.status pending/unknown phải query lại, không tạo operationId mới.
```

- [ ] **4. Nối vào runtime và lưu trữ.** SDK generator output kiểm drift; Node-RED docker optional for development/cloud management only, no requirement on-prem server. Events subscriptions narrow scope and audit integration identity.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:contracts -- tests/contract/automation-scopes.test.ts`; kỳ vọng PASS. Replay event produces one mission, token revoked, tenant spoof, stale map capability decline. Guide install/run commands tested using sandbox venue only. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W09-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: publish scoped automation and pos integration sdk"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Global/branch overrides có revision, preview và rollback forward; không thay snapshot bill.
- [ ] External request ACK received khác restaurant accepted.
- [ ] Node-RED không có credential bypass DB/MQTT motion; demo flows dùng API scopes.
