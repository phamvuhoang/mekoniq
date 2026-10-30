# Wave 02 — cloud identity, policy và đồng bộ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có cloud đa tenant với enrollment, policy và sync không mất/trùng dữ liệu.

**Architecture:** Cloud giữ identity/configuration và projection đã nhận. Command nghiệp vụ tại venue relay tới fixed coordinator; inbound facts không được biến thành live side effects.

**Tech Stack:** NestJS, PostgreSQL 18/RLS, signed grants, WebSocket, native SQLite sync.

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

**Entry:** W00 và W01 đạt kiểm thử phần mềm; pairing test được thay bằng enrollment production.

**Exit:** Hai tenant không đọc chéo; signed devices sync qua gap/retry; config revision được ACK áp dụng; cloud không là writer thứ hai.

**Đầu ra chạy được:** Thay feature trên cloud, ngắt WAN, tablet tiếp tục revision cũ và cloud báo pending; reconnect áp dụng revision mới và replay không trùng.

### W02-T01: Identity, tenant isolation và phiên nhân viên

**Depends on:** W00-T01..W00-T04

**Files:**

- Create: `apps/cloud-api/src/modules/identity/{auth,session,rbac,tenant-context}.ts`.
- Create: `apps/cloud-api/migrations/002_identity_rls.sql`, `tests/fixtures/identity.json`.
- Test: `tests/integration/tenant-auth.test.ts`.

**Interfaces:**

- Consumes: Cloud API lifecycle, PostgreSQL scoped transactions, actors fixture.
- Produces: `authorize(actor,permission,scope):Decision`; `/v1/auth/login`, `/refresh`, `/logout`; `withTenant(scope,work)` dùng SET LOCAL.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createLab } from "../support/lab";
test("tenant scope cannot be supplied to escape the signed session", async () => {
  const lab = await createLab();
  try {
    const r = await lab.http("owner-a", "GET", "/v1/venues/venue-b/orders");
    expect(r.status).toBe(403);
    expect(await lab.rlsVisibleIds("owner-a", "venues")).toEqual(["venue-a"]);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/tenant-auth.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Cloud login hash password bằng thư viện Argon2id; refresh hash, rotation/reuse detection; throttle login. Scope từ session/device cert, không body. Application DB role không owner/BYPASSRLS, FORCE RLS trên bảng tenant.

```sql
ALTER TABLE venue ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_scope ON venue USING (
  organization_id = current_setting('app.organization_id', true)
);
-- withTenant đặt app.organization_id bằng set_config(..., true) trong transaction.
```

- [ ] **4. Nối vào runtime và lưu trữ.** Guards cho REST/WS origin, CSRF cho cookie; local tablet cache offline grants ký cloud thay password. `rlsVisibleIds` trong test dùng chính application role. Audit login/deny nhưng không log credential.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/tenant-auth.test.ts`; kỳ vọng PASS. Pool reuse A→B không rò scope; session expired/revoked, forged role, guest scope, brute force và CSRF. Offline quyền hết hạn chuyển capture-only. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: enforce tenant and actor identity boundaries"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T02: Enrollment và sổ ownership của venue/robot

**Depends on:** W01-T02, W02-T01

**Files:**

- Create: `apps/cloud-api/src/modules/devices/{enrollment,grants,ownership}.ts`, `apps/cloud-api/migrations/003_device_ownership.sql`.
- Create: `packages/contracts/schemas/{offline-grant,ownership-grant}.schema.json`.
- Test: `tests/integration/device-grants.test.ts`.

**Interfaces:**

- Consumes: Keystore proof/public JWK, canonical signature verification.
- Produces: `POST /v1/devices/enroll`, `issueOfflineGrant`, `validateOwnership`; device/venue/control epochs monotonic persisted.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createLab } from "../support/lab";
test("expired heartbeat does not assign a second owner", async () => {
  const lab = await createLab();
  try {
    await lab.seed("ownership","venue-a",{owner:"device-a",epoch:1,status:"active"});
    await lab.advance(86400000);
    const r = await lab.command("owner", "Ownership.Acquire", {venueId:"venue-a",deviceId:"device-b"});
    expect(r.code).toBe("HANDOFF_REQUIRED");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/device-grants.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Enrollment nonce one-use/TTL, issuer+venue ACL, bound public key. Default offline grant 24h; expiry stops privileged commands but never destroys journal. Epoch chuyển chỉ qua handoff workflow W04.

```ts
export function mayAcquireOwner(current: {owner:string|null;status:string}) {
  return current.owner === null && current.status === "unassigned";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Replace test CA/enrollment code W01 release path; revocation and config propagation show per-device pending ACK. Re-enroll creates new epoch; old unsynced entries retain original signature for reconciliation.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/device-grants.test.ts`; kỳ vọng PASS. Replay enrollment, wrong venue/nonce, clock skew, key rotation pending journals, revoked grant late arrival. No endpoint accepts atRobot flag as authority. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: enroll devices and preserve exclusive ownership"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T03: Feature engine, dependency và cấu hình có version

**Depends on:** W02-T01, W00-T03

**Files:**

- Create: `packages/domain/src/policy/{registry,evaluate,transition,presets}.ts`.
- Create: `apps/cloud-api/src/modules/configuration/publish.ts`, `apps/operations-ui/src/routes/FeatureSettings.tsx`.
- Test: `tests/integration/feature-policy.test.ts`.

**Interfaces:**

- Consumes: Actor permissions, capabilities manifest, current config revision, open work count.
- Produces: `evaluateFeature(input):{allowed:boolean;reason:string;revision:number}`; `Configuration.Publish`, `Configuration.Apply`; preset versions.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createLab } from "../support/lab";
test("draining blocks new work but permits settling accepted work", async () => {
  const lab = await createLab();
  try {
    await lab.seed("feature","robot.delivery",{status:"draining",revision:2});
    expect((await lab.command("cashier","Policy.Check",{feature:"robot.delivery",intent:"new"})).code)
      .toBe("FEATURE_DRAINING");
    expect((await lab.command("cashier","Policy.Check",{feature:"robot.delivery",intent:"finish_existing"})).status)
      .toBe("accepted");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/feature-policy.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Registry explicit keys cho F01–F30; system invariants không toggle. Validate dependency graph cycle, missing config, robot readiness và actor; config compare-and-swap atomic với revision.

```ts
export function transitionFeature(enabled:boolean, openWork:number) {
  return enabled ? "enabled" : openWork > 0 ? "draining" : "disabled";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Cloud publish draft→validated→applied per venue; UI không nói applied khi mất ACK. Coordinator guard và worker guard gọi cùng engine; accepted aggregates giữ policy snapshot nhưng safety/permission vẫn kiểm.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/feature-policy.test.ts`; kỳ vọng PASS. Direct API bypass, stale config, disable while order/bill/mission open, cash-only/no-robot/robot-only presets; config unknown fields reject chứ không auto-enable. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: add versioned restaurant capability policies"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T04: Sync inbox/outbox, gaps và quarantine

**Depends on:** W02-T01, W02-T02, W00-T04

**Files:**

- Create: `packages/sync/src/{push,pull,cursor,reconcile-schema}.ts`.
- Create: `apps/cloud-api/src/modules/sync/{controller,ingest,projection}.ts`, `apps/cloud-api/migrations/004_sync.sql`.
- Test: `tests/integration/sync-replay.test.ts`.

**Interfaces:**

- Consumes: Journal envelope, AtomicStore, signed producer and payloadHash.
- Produces: `/v1/sync/handshake`, `/push`, `/pull`, `/ack`; `contiguousCursor(received:string[],previous:string):string`; per-entry results.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { contiguousCursor } from "../../packages/sync/src/cursor";
test("out-of-order entries cannot advance ACK across a gap", () => {
  expect(contiguousCursor(["1","3"], "0")).toBe("1");
  expect(contiguousCursor(["2","3"], "1")).toBe("3");
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/sync-replay.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Raw inbox+dedup key commit trước projection; records accepted không bị sửa nếu retry signature khác nhưng same canonical payload. Ingest unsupported schema vào quarantine, tách received cursor khỏi applied cursor.

```ts
export function contiguousCursor(values:string[], previous:string) {
  const received = new Set(values);
  let cursor = BigInt(previous);
  while (received.has(String(cursor + 1n))) cursor += 1n;
  return String(cursor);
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Client outbox chỉ bỏ entry sau ACK commit đúng producer/scope/hash; giữ retention chưa cloud ACK. Schema adapters versioned; report gaps/download missing without skipping. Worker applied watermark riêng để UI không coi quarantined data đã cập nhật bill.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/sync-replay.test.ts`; kỳ vọng PASS. O03/O09/O19: drop cloud ACK, resend, conflicting hash, gap filling, old schema và invalid signature. Reopen both databases giữ cursor/dedup. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: synchronize durable journals with explicit gaps"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T05: Cloud relay, scoped projection và worker side-effect firewall

**Depends on:** W02-T03, W02-T04

**Files:**

- Create: `apps/cloud-api/src/modules/relay/{commands,subscriptions}.ts`, `apps/cloud-worker/src/{outbox-worker,dispatch-effects}.ts`.
- Create: `packages/sync/src/effect-policy.ts`, `deploy/cloud/{api.Dockerfile,worker.Dockerfile}`.
- Test: `tests/integration/relay-effects.test.ts`.

**Interfaces:**

- Consumes: Fixed ownership epoch, event kind/source, worker handler registry.
- Produces: Cloud `202 pending` vs venue accepted; `mayEmitLiveEffect(kind):boolean`; resume cursor/snapshot projections scoped actor.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { mayEmitLiveEffect } from "../../packages/sync/src/effect-policy";
test("historical facts cannot enqueue physical or financial actions", () => {
  for (const kind of ["accepted_fact","observation","historical_import"] as const)
    expect(mayEmitLiveEffect(kind)).toBe(false);
  expect(mayEmitLiveEffect("intent")).toBe(true);
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/relay-effects.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Chỉ xử lý live intent sau ownership/policy/expiry validation; fact replay chỉ cập nhật projection. Relay không commit order riêng khi coordinator vắng. Worker retry bounded, dead-letter/unknown, không biến timeout thành failure chắc chắn.

```ts
export function mayEmitLiveEffect(kind: JournalKind) {
  return kind === "intent";
}
// Caller vẫn phải kiểm scope, epoch, policy, expiry và durable effect receipt.
```

- [ ] **4. Nối vào runtime và lưu trữ.** WS per-role snapshots; guest table token chỉ tới session của khách. Add OpenTelemetry operationId/correlation, redact secrets, worker lag/readiness. Build containers non-root, runtime secrets outside image.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/relay-effects.test.ts`; kỳ vọng PASS. Guest không thấy payment/internal robot config; lost relay ACK returns same result; historical import chạy worker vẫn không external call. Reconnect expired live intent được rejected/reconciled, không replay. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: relay scoped commands without duplicate execution"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] Auth/RLS kiểm trên role ứng dụng không bypass RLS; guest không đọc bill bàn khác.
- [ ] Sync ACK cursor liên tục, unknown schema được quarantine và nguyên bản được giữ.
- [ ] Cloud vẫn hiện pending khi venue không ACK; live side effects không phát từ historical facts.
