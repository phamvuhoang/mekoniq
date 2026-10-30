# Wave 02 — cloud identity, policy và đồng bộ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có cloud đa tenant với enrollment, policy và sync không mất/trùng dữ liệu.

**Architecture:** Cloud giữ identity/configuration và projection đã nhận. Command nghiệp vụ tại venue relay tới fixed coordinator; inbound facts không được biến thành live side effects.

**Tech Stack:** Next.js Route Handlers/Vercel, Supabase PostgreSQL 17/RLS, Supabase Auth/Realtime/Storage, signed grants, HTTPS journal sync, native SQLite.

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

**Entry:** W00 và W01 đạt kiểm thử phần mềm; pairing test được thay bằng enrollment production.

**Exit:** Hai tenant không đọc chéo; signed devices sync qua gap/retry; config revision được ACK áp dụng; cloud không là writer thứ hai. Auth/Realtime/Storage chạy với Supabase local; profile Free không cần tính năng trả phí để hoạt động.

**Đầu ra chạy được:** Thay feature trên cloud, ngắt WAN, tablet tiếp tục revision cũ và cloud báo pending; reconnect áp dụng revision mới và replay không trùng.

### W02-T01: Identity, tenant isolation và phiên nhân viên

**Depends on:** W00-T01..W00-T04

**Files:**

- Create: `apps/cloud-web/src/server/modules/identity/{auth,session,rbac,tenant-context}.ts`.
- Create: `supabase/migrations/20261030000200_identity_rls.sql`, `tests/fixtures/identity.json`.
- Create: `apps/cloud-web/src/app/(backoffice)/admin/layout.tsx`, `apps/cloud-web/src/app/login/page.tsx`, `apps/cloud-web/src/server/supabase/{server,admin}.ts`, `tests/support/supabase-auth.ts`.
- Test: `tests/integration/tenant-auth.test.ts`.

**Interfaces:**

- Consumes: Next.js lifecycle, Supabase Auth local, scoped PostgreSQL transactions, actors fixture.
- Produces: `authorize(actor,permission,scope):Decision`; `/v1/auth/login`, `/refresh`, `/logout` gọi Supabase Auth; `withTenant(scope,work)` dùng SET LOCAL; protected Next.js admin layout.

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

- [ ] **3. Hiện thực phần cốt lõi.** Supabase Auth sở hữu password/session/refresh; Next.js kiểm JWT bằng verified claims, issuer/audience/expiry và membership hiện hành. Không xây bảng password/refresh-token riêng. Throttle và CSRF cho đường login/cookie; scope không lấy từ body. Application DB role không owner/BYPASSRLS, FORCE RLS trên bảng tenant; browser không được ghi ledger/ownership qua Data API.

```sql
ALTER TABLE venue ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_scope ON venue USING (
  organization_id = current_setting('app.organization_id', true)
);
-- withTenant đặt app.organization_id bằng set_config(..., true) trong transaction.
```

- [ ] **4. Nối vào runtime và lưu trữ.** REST guards và server admin layout dùng cùng authorize; cache dữ liệu riêng tư tắt. Fixture tạo user qua Supabase Auth local, kiểm role qua app DB connection thật. Admin key chỉ dùng module server-only để provision; public key không có quyền tenant nếu thiếu auth/RLS. Tablet giữ signed offline grants thay password; ghi rõ invite/reset production cần custom SMTP, local dùng mail sink. Audit login/deny không log credential.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/tenant-auth.test.ts`; kỳ vọng PASS. Pool reuse A→B không rò scope; session expired/revoked, forged role, guest scope, brute force và CSRF. Offline quyền hết hạn chuyển capture-only. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: enforce tenant and actor identity boundaries"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T02: Enrollment và sổ ownership của venue/robot

**Depends on:** W01-T02, W02-T01

**Files:**

- Create: `apps/cloud-web/src/server/modules/devices/{enrollment,grants,ownership}.ts`, `supabase/migrations/20261030000300_device_ownership.sql`.
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

- [ ] **4. Nối vào runtime và lưu trữ.** Replace test CA/enrollment code W01 release path; revocation/config propagation show per-device pending ACK. Device có signed HTTPS sync/pull riêng theo ACL, không cần giả Supabase JWT để tiếp tục upload fact khi phiên staff hết hạn; quyền live command vẫn kiểm grant/epoch. Re-enroll creates new epoch; old unsynced entries retain original signature for reconciliation.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/device-grants.test.ts`; kỳ vọng PASS. Replay enrollment, wrong venue/nonce, clock skew, key rotation pending journals, revoked grant late arrival. No endpoint accepts atRobot flag as authority. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: enroll devices and preserve exclusive ownership"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T03: Feature engine, dependency và cấu hình có version

**Depends on:** W02-T01, W00-T03

**Files:**

- Create: `packages/domain/src/policy/{registry,evaluate,transition,presets}.ts`.
- Create: `apps/cloud-web/src/server/modules/configuration/publish.ts`, `apps/cloud-web/src/components/backoffice/FeatureSettings.tsx`.
- Create: `apps/cloud-web/src/app/(backoffice)/admin/settings/page.tsx`.
- Test: `tests/integration/feature-policy.test.ts`.

**Interfaces:**

- Consumes: Actor permissions, capabilities manifest, current config revision, open work count.
- Produces: `evaluateFeature(input):{allowed:boolean;reason:string;revision:number}`; `Configuration.Publish`, `Configuration.Apply`; preset versions, gồm `trial-service` theo capability matrix §3.

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

- [ ] **4. Nối vào runtime và lưu trữ.** Cloud publish draft→validated→applied per venue; UI không nói applied khi mất ACK. Coordinator guard và worker guard gọi cùng engine; accepted aggregates giữ policy snapshot nhưng safety/permission vẫn kiểm. Preset `trial-service` có version, map các cờ `call/guide/order/pay` sang capability độc lập qua preview; mặc định module nâng cao tắt, chỉ tự thêm dependency bắt buộc của chức năng đã chọn và giải thích trên UI. W02 kiểm policy/schema của preset; luồng nghiệp vụ đầy đủ được kiểm ở W06-T06 khi các module tương ứng đã tồn tại.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/feature-policy.test.ts`; kỳ vọng PASS. Direct API bypass, stale config, disable while order/bill/mission open, cash-only/no-robot/robot-only presets; config unknown fields reject chứ không auto-enable. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: add versioned restaurant capability policies"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T04: Sync inbox/outbox, gaps và quarantine

**Depends on:** W02-T01, W02-T02, W00-T04

**Files:**

- Create: `packages/sync/src/{push,pull,cursor,reconcile-schema}.ts`.
- Create: `apps/cloud-web/src/server/modules/sync/{controller,ingest,projection}.ts`, `supabase/migrations/20261030000400_sync.sql`.
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

### W02-T05: Realtime hints, cloud relay và bounded jobs

**Depends on:** W02-T03, W02-T04

**Files:**

- Create: `apps/cloud-web/src/server/modules/relay/{commands,subscriptions}.ts`, `apps/cloud-web/src/server/jobs/{outbox-worker,dispatch-effects,claim,registry}.ts`.
- Create: `packages/sync/src/{effect-policy,realtime-hints}.ts`, `apps/cloud-web/src/app/internal/jobs/run/route.ts`.
- Create: `supabase/migrations/20261030000500_jobs_realtime.sql`, `deploy/vercel/{environment,job-policy}.json`, `scripts/run-jobs.mjs`.
- Test: `tests/integration/relay-effects.test.ts`.
- Test: `tests/integration/realtime-jobs.test.ts`.

**Interfaces:**

- Consumes: Fixed ownership epoch, durable journal/cursors, Supabase private channel authorization, job handler registry.
- Produces: Cloud `202 pending` vs venue accepted; `mayEmitLiveEffect(kind):boolean`; scoped hint `{scope,ref,revision,watermark}`; HTTP pull/catch-up; authenticated `POST /internal/jobs/run` bounded consumer.

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

- [ ] **3. Hiện thực phần cốt lõi.** Relay persist pending trước hint, receipt venue mới xác nhận đã nhận. Fact replay chỉ cập nhật projection; live intent cần ownership/policy/expiry. Jobs claim bằng DB lease/SKIP LOCKED, tối đa 20 job hoặc 20 giây/batch, checkpoint/retry/dead-letter; external unknown cần query trước retry. Không dựa process thường trú hoặc promise sau response. `mayEmitLiveEffect` chỉ là một predicate trong firewall đầy đủ.

```ts
export function mayEmitLiveEffect(kind: JournalKind) {
  return kind === "intent";
}
// Caller vẫn phải kiểm scope, epoch, policy, expiry và durable effect receipt.
```

- [ ] **4. Nối vào runtime và lưu trữ.** Supabase Realtime gửi hints private theo venue/RLS, gộp tối đa 1 hint/5 giây/venue; coordinator subscribe rồi HTTP pull theo cursor, có periodic pull khi hint mất. Guest table token dùng scoped HTTPS; không biến nó thành Supabase JWT. Supabase Cron kiểm due jobs mỗi phút, pg_net gọi route có HMAC timestamp/nonce và secret server-side khi cần; local runner gọi cùng consumer. Test scheduler setup và quyền pg_net/secret; không ping để né pause Free. Trace operationId, redaction, job lag và expired lease; telemetry pose/heartbeat ở LAN.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/relay-effects.test.ts` và `pnpm test:integration -- tests/integration/realtime-jobs.test.ts`; kỳ vọng PASS. Dùng Auth/Realtime/DB local thật: cross-tenant subscription bị từ chối; drop hint rồi catch-up đủ; expired JWT fallback signed device pull; restart consumer sau claim/side effect không tạo thêm effect. Test hai consumer, HMAC replay, batch deadline, Cron phục hồi job pending, unknown reconcile. Guest không thấy payment/config nội bộ; historical import không phát external call. Chạy `pnpm typecheck` và `pnpm lint`.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: relay scoped commands without duplicate execution"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W02-T06: Supabase Storage và profile Free có quota guards

**Depends on:** W02-T01, W02-T04, W02-T05

**Files:**

- Create: `apps/cloud-web/src/server/modules/storage/{signed-upload,manifest,finalize,garbage-collection}.ts`, `apps/cloud-web/src/server/modules/usage/{budget,metering}.ts`.
- Create: `supabase/migrations/20261030000600_storage_usage.sql`, `packages/contracts/schemas/asset-manifest.schema.json`, `packages/sync/src/assets.ts`.
- Create: `deploy/profiles/supabase-free.json`, `scripts/report-cloud-budget.mjs`, `docs/operations/supabase-free.md`.
- Modify: `tests/support/lab.ts`, `apps/cloud-web/src/server/{route-registry,request-context}.ts`, `apps/cloud-web/src/server/jobs/registry.ts`.
- Test: `tests/integration/storage-free-profile.test.ts`.

**Interfaces:**

- Consumes: Verified actor/device scope, Supabase Storage local, durable outbox/jobs, profile budget snapshot.
- Produces: `POST /v1/assets/uploads`, `/v1/assets/:id/finalize`; scoped signed download; manifest `pending|ready|missing|rejected` với hash/size; quota report có nguồn/thời điểm đo và unknown rõ ràng.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Dùng Supabase Storage thật cùng actor fixture; `Lab.http` hỗ trợ JSON body. Thêm upload interrupted, hash mismatch và retry finalize cùng ID vào file test.

```ts
import { expect, test } from "vitest";
import { createLab } from "../support/lab";
test("upload signing cannot escape the actor venue", async () => {
  const lab = await createLab();
  try {
    const r = await lab.http("owner-a", "POST", "/v1/assets/uploads", {
      venueId:"venue-b", kind:"menu_image", bytes:1024, mime:"image/png"
    });
    expect(r.status).toBe(403);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/storage-free-profile.test.ts`. Test phải thất bại ở scope/durability/budget invariant, không chỉ do thiếu local Storage hoặc fixture.

- [ ] **3. Hiện thực phần cốt lõi.** Private buckets/RLS và signed direct upload/download có TTL/scope; xác minh object/hash/size trước ready. DB metadata và object không atomic: finalize idempotent, pending/missing state, TTL cleanup không xóa file đang được tham chiếu. File profile cap 20 MiB; sync batch tối đa 1 MiB, không proxy blob qua Function 4.5 MB. Hash/import file lớn xử lý streaming/batch/checkpoint, không hứa hoàn tất trong một Function.

```ts
export function usageState(used:number|null, limit:number) {
  if (used === null) return "unknown";
  return used >= limit * 0.85 ? "critical" : used >= limit * 0.70 ? "warning" : "normal";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Profile khai báo quota DB/Storage/egress/Realtime/MAU cùng phạm vi project/organization đã kiểm; không ghi unknown thành zero. Usage counters/retention/job cleanup có transaction; quota actual đối chiếu dashboard/API được hỗ trợ, counter nội bộ chỉ là ước lượng khi chưa có số đo provider. Không dùng paid image transforms/branching/PITR làm dependency. Gần quota giảm hint/telemetry không thiết yếu, chặn upload mới có reason; không xóa fact tiền hoặc journal chưa ACK. Storage unreachable vẫn giữ local manifest/file để resume.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/storage-free-profile.test.ts`; kỳ vọng PASS. Test RLS trực tiếp, expired URL, MIME/size/hash mismatch, orphan cleanup, DB quota failure không ACK, reconnect không nhân đôi object/chứng từ. Chạy `pnpm cloud:budget` trên fixture và kiểm report không giả số đo hosted. Chạy `pnpm typecheck`, `pnpm lint`; capacity tháng và hosted Free thực được nghiệm thu ở W11-T02/T04.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W02-T06.md` với commands, runtime, local/hosted distinction và quota snapshot. Review/stage đúng task, `git commit -m "feat: support scoped storage and Supabase Free budgets"`. Chỉ đánh dấu sau khi kiểm thực tế.

## Wave acceptance

- [ ] Auth/RLS kiểm trên role ứng dụng không bypass RLS; guest không đọc bill bàn khác.
- [ ] Sync ACK cursor liên tục, unknown schema được quarantine và nguyên bản được giữ.
- [ ] Cloud vẫn hiện pending khi venue không ACK; live side effects không phát từ historical facts.
- [ ] Mất Realtime hint vẫn sync đủ; job bị ngắt có thể resume mà không nhân đôi side effect.
- [ ] Storage tenant isolation, upload interrupted và quota errors có kiểm thử; Supabase Free là profile chạy được, chưa tuyên bố vượt production capacity/recovery gate.
