# Wave 11 — chất lượng production, triển khai và chuyển đổi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phát hành bằng bằng chứng nghiệm thu, backup/restore và chuyển một nguồn điều khiển robot.

**Architecture:** Hardening diễn ra từ đầu; wave này kiểm độc lập toàn hệ thống và tạo release dossier theo profile. Cloud rollout và tablet update tách khỏi dữ liệu, hỗ trợ client cũ đang offline.

**Tech Stack:** Next.js/Vercel, Supabase Free PostgreSQL/Auth/Realtime/Storage, logical backup, Android signed APK, CI artifact attestations, OpenTelemetry, load/fault tests.

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

**Entry:** Các wave thuộc release profile đã đạt; mọi F/O có evidence hoặc declared blocked không được quảng bá. Provider/hardware thực cần input đã ghi ở W10/W06.

**Exit:** Gate D và production release có đủ evidence, runbook, rollout/rollback và initial live acceptance; không dùng từ hoàn thành đầy đủ nếu còn chức năng bắt buộc blocked.

**Đầu ra chạy được:** Diễn tập restore, update khi một tablet offline, một ca vận hành có WAN outage và import maintenance, rồi đối soát tiền/robot cuối ca.

### W11-T01: Security qualification và dữ liệu nhạy cảm

**Depends on:** W02, W04, W05, release-selected W09/W10

**Files:**

- Create: `tests/security/{tenant,session,device,webhook,payload,guest}.test.ts`.
- Create: `docs/operations/{secrets,access-retention,incident-response}.md`, `scripts/release-security.mjs`.
- Test: `tests/security/tenant-escape.test.ts`.

**Interfaces:**

- Consumes: Auth/RLS/ACL/enrollment/policy primitives and generated schema limits.
- Produces: Security acceptance report, key rotation/backup encryption/local encryption deployment profile.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("foreign-scope signed journal is denied before projection", async () => {
  const lab = await createRestaurantLab();
  try {
    const r=await lab.pushSignedAs("device-b", {organizationId:"org-a",venueId:"venue-a"});
    expect(r.code).toBe("DEVICE_SCOPE_MISMATCH");
    expect(await lab.count("ForeignFactApplied")).toBe(0);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:security -- tests/security/tenant-escape.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Test hostile client direct commands, guest token leakage, RLS pool context, revoked credentials, replay, map zip bomb, body/CSV size and websocket floods. Secrets redaction tested; release strips debug/test routes.

```ts
export function validDeviceScope(device:{organizationId:string;venueId:string},
  entry:{organizationId:string;venueId:string}) {
  return device.organizationId===entry.organizationId && device.venueId===entry.venueId;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Vercel environment scopes tách production/preview; Supabase DB/admin/job secrets chỉ server-side. Kiểm bundle HTML/APK/Next public assets không chứa service-role key, connection string hoặc job secret. Xoay Auth/job/device keys giữ historical provenance nhưng không cấp quyền mới cho chữ ký cũ. Kiểm Storage RLS/signed URL TTL và private Realtime tenant isolation. Android encryption theo support profile; PII retention giữ reference tài chính cần thiết.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:security -- tests/security/tenant-escape.test.ts`; kỳ vọng PASS. Run dependency/license/SBOM checks and signed artifact verification; no simplistic claim all security solved from unit tests. Record unresolved findings with release blocking severity. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "test: qualify production trust and data isolation boundaries"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W11-T02: Hiệu năng, observability và fault load

**Depends on:** W05, W06 software gate, W09 selected

**Files:**

- Create: `tests/load/restaurant.ts`, `scripts/run-load.mjs`, `deploy/observability/{dashboards,alerts}.json`.
- Create: `tests/load/supabase-free.ts`, `tests/fixtures/load/supabase-free.json`, `tests/acceptance/supabase-free-capacity.test.ts`, `tests/integration/cloud-unavailable.test.ts`.
- Create: `docs/operations/service-levels.md`.
- Create: `tests/support/load-report.ts`.
- Test: `tests/acceptance/load-budget.test.ts`.

**Interfaces:**

- Consumes: Metrics sync gaps/lag, command ACK/native result, traces operationId; W02-T06 Free quota profile và actual provider usage snapshot.
- Produces: `pnpm test:load`, `pnpm test:load:free`; measured reports tách benchmark LAN, capacity Free và pause/quota recovery; alerts for saturation/unknown state.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { readMeasuredLoadReport } from "../support/load-report";
test("load gate uses measured local and kitchen latency", () => {
  const report = readMeasuredLoadReport();
  expect(report.localAckP95Ms).toBeLessThanOrEqual(500);
  expect(report.kitchenDeliveryP95Ms).toBeLessThanOrEqual(1000);
  expect(report.duplicateFinancialEffects).toBe(0);
});
```

- [ ] **2. Chạy RED.** `pnpm test:load`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Benchmark LAN giữ 20 tablet/10 robot/100 bàn/10 command mỗi giây, ghi duration/ramp/seed. Free fixture riêng: 1 venue, 3 tablet, 1 simulated robot, 20 bàn, 100 order/ngày; tối thiểu 7 ngày dữ liệu mô phỏng, đo bytes/index/objects/egress/Realtime fanout và ngoại suy 30 ngày có overhead thực. Kiểm module đầy đủ và trial-service cùng build; không coi tăng tốc đồng hồ là soak thực hoặc robot emulation là hardware acceptance.

```ts
export type LoadReport = {
  localAckP95Ms:number; kitchenDeliveryP95Ms:number;
  duplicateFinancialEffects:number; durationSeconds:number;
  tabletModel:string; appCommit:string; networkProfile:string;
  profile:"lan-scale"|"supabase-free-compatible";
  providerUsage?:{measuredAt:string;source:string;dbBytes:number|null;
    storageBytes:number|null;egressBytes:number|null;realtimeMessages:number|null};
};
```

- [ ] **4. Nối vào runtime và lưu trữ.** `run-load` chỉ dùng test venue/endpoint đã xác minh; không vô tình vượt quota production. Meter/report theo project/organization đúng quota, dữ liệu chưa đo ghi unknown. Dashboard hiển thị ngưỡng 70%/85%, sync backlog, cloud pause/quota error; không cần paid log drain/metrics endpoint. Inject lỗi Auth/Realtime/Storage/DB riêng: LAN vẫn chạy, failed commit không ACK, signed pull bù missed hints, cảnh báo operator cần resume project. Android battery/temp/storage và bounded queue/backpressure theo dõi riêng.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy `pnpm test:load`, `pnpm test:load:free`, `pnpm test:integration -- tests/integration/cloud-unavailable.test.ts`; kỳ vọng PASS với artifact mới. Soak 24h và spike riêng; request bị từ chối không tính latency thành công. Local có thể kiểm guards nhưng hosted Free capacity cần số đo trên project Free, không dùng local resource limit làm bằng chứng hosted. Đo queue drain sau recovery, session expiry và cloud pause; không auto-ping né pause. Thiếu số đo = gate chưa đạt, không fixture PASS. Chạy `pnpm typecheck`, `pnpm lint`.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "perf: measure restaurant concurrency and recovery budgets"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W11-T03: Backup, migration và restore khi client cũ offline

**Depends on:** W04-T03..W04-T06, all release data modules

**Files:**

- Create: `scripts/{backup-verify,restore-rehearsal,migrate-release,export-storage}.mjs`, `deploy/profiles/backup-policy.json`.
- Create: `tests/integration/upgrade-recovery.test.ts`, `docs/operations/{backup-restore,rolling-upgrade}.md`.
- Test: `tests/integration/upgrade-recovery.test.ts`.

**Interfaces:**

- Consumes: Journal original IDs, schema compatibility adapters, Supabase logical exports + Storage copies + Auth/config/key inventory, independent encrypted backup target.
- Produces: Expand/contract migration and rollback-forward artifacts; Free restore report và measured production RPO/RTO riêng; n and n-1 client compatibility. Managed PITR là lựa chọn bổ sung, không prerequisite khởi chạy Free.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("old offline client sync survives a schema upgrade and restored cloud", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.partition("wan"); await lab.createOfflineReceipt("legacy-op");
    await lab.upgradeCloud("next-schema");
    await lab.restoreCloudCheckpoint("before-receipt");
    await lab.heal(); await lab.sync(); await lab.sync();
    expect(await lab.count("CashRecorded")).toBe(1);
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:integration -- tests/integration/upgrade-recovery.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Implement explicit upcasters, unknown schema raw retention; destructive migration blocked until clients/checkpoints known. Restore dedup receipts with event store, gaps repaired by devices; old backup cannot trigger live outbox replay.

```ts
export function migrationAllowed(s:{unknownClients:number;pendingJournals:number;
  backwardCompatible:boolean}) {
  return s.backwardCompatible || (s.unknownClients===0 && s.pendingJournals===0);
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Export DB có snapshot/manifest/receipts, copy Storage objects và inventory Auth users/identities/config/secrets cần phục hồi; không mặc định `db dump` bao gồm mọi managed schema hoặc file Storage. Backup mã hóa ra nơi độc lập, restore sang môi trường riêng bằng thủ tục được hỗ trợ; bảo toàn user ID/membership hoặc migration identity có đối soát. Không khôi phục token cũ thành quyền live, không chạy lại external outbox unknown. Native export/import giữ device epochs, kiểm hash và key recovery. Ghi lịch backup, chi phí/đích lưu độc lập và độ mất dữ liệu thực.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/upgrade-recovery.test.ts`; kỳ vọng PASS. Kiểm O19/O22, corruption/missing segment/object, Auth login sau restore, late import dedup, mất receipt phải phát hiện. Free functional restore phải đạt không cần PITR; recovery production RPO ≤5 phút/RTO ≤30 phút là gate có đo thật riêng, không đánh đồng dump thủ công hoặc local pass với SLA. Thiếu bằng chứng recovery chặn công bố production tương ứng, không chặn phát triển/chạy bản Free. Chạy `pnpm typecheck`, `pnpm lint`.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "ops: verify recoverable migrations and backup restoration"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W11-T04: Release pipeline và deployment có rollback

**Depends on:** W11-T01..W11-T03

**Files:**

- Create: `.github/workflows/release.yml`, `apps/cloud-web/vercel.json`, `deploy/vercel/{release-manifest.schema.json,regions.json}`, `scripts/{release,verify-release}.mjs`.
- Create: `docs/operations/{cloud-deployment,android-distribution,rollback}.md`.
- Test: `tests/acceptance/release-manifest.test.ts`.

**Interfaces:**

- Consumes: Next.js build checksum/Vercel deployment ID, signed APK digest, Supabase migration checksums/major/extensions, contracts versions, CI gates và target environment.
- Produces: Immutable release manifest, Next.js build và signed APK, dry-run deploy và rollback-forward plan; export `checkRelease(input:ReleaseCheckInput):{ok:boolean;reasons:string[]}` từ `scripts/verify-release.mjs`. `ReleaseCheckInput` có `requiredProfiles:string[]`, `profiles:Record<string,{status:string;hardwareRequired:boolean}>` cho profile gate, cùng manifest metadata được schema validate trước đó. Profile Free functional/capacity và recovery target có evidence riêng.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { checkRelease } from "../../scripts/verify-release.mjs";
test("release refuses an unverified required adapter", () => {
  expect(checkRelease({requiredProfiles:["valetudo-r1"],
    profiles:{"valetudo-r1":{status:"integration_tested",hardwareRequired:true}}}).ok)
    .toBe(false);
});
```

- [ ] **2. Chạy RED.** `pnpm test:acceptance -- release-manifest`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Manifest ghi exact Next.js build/APK hash, deployment ID, Supabase version/migration checksum, schema read/write range, feature registry và adapter/provider evidence. Verify Free profile không dùng paid prerequisite; credential/email/backup được ghi theo target. Preview/staging không nối production DB. Thiếu production auth/job secrets thì readiness từ chối; prerequisite jobs không được skip âm thầm.

```ts
export function hardwareProfileReady(p:{status:string;hardwareRequired:boolean}) {
  return !p.hardwareRequired || p.status==="venue_approved";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** `checkRelease` duyệt mọi required profile: missing/chưa đạt thì thêm reason, `ok` chỉ true khi không còn reason. Hardware cần `venue_approved`, provider cần evidence W10; Free cần hosted functional/capacity và recovery target riêng theo deployment. CLI dùng cùng hàm, fail exit nonzero. Vercel root `apps/cloud-web`, build workspace dependencies; region gần Supabase, Supavisor connection config, Node runtime và maxDuration đủ cho batch 20 giây. Commercial target dùng Vercel Pro hoặc plan cho phép commercial; không dùng Hobby làm mặc định nhà hàng. Chuẩn bị build/config/dry-run trước; deploy thật theo môi trường đã được cho phép khi thực thi, không tạo tài khoản/mua gói ở bước lập plan.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:acceptance -- release-manifest`; kỳ vọng PASS. Staging install from clean artifacts, DB unavailable readiness503, deploy bad migration automatic stop, old app still sync, rollback app retains new financial facts. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "ops: package verifiable cloud and tablet releases"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W11-T05: UAT, cutover một nguồn điều khiển và đóng chương trình

**Depends on:** W11-T04, all required F01–F30 acceptance tasks

**Files:**

- Create: `docs/implementation/gates/{D-full-scope,production-release}.md`, `docs/operations/{cutover,first-shift,post-release}.md`.
- Create: `scripts/verify-completion.mjs`, `tests/acceptance/first-shift.test.ts`.
- Test: `tests/acceptance/first-shift.test.ts`.

**Interfaces:**

- Consumes: F/O traceability, test reports, customer UAT evidence, commission profiles and trial shutdown confirmation.
- Produces: Full scope acceptance inventory and runbook; no claim complete when mandatory rows blocked.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
test("new dispatcher cannot activate while trial still owns the robot", async () => {
  const lab=await createRestaurantLab();
  try {
    await lab.seed("control-owner","robot-1",{owner:"trial",fenced:false});
    expect((await lab.command("manager","Ownership.Activate",{robotId:"robot-1",newOwner:"production"})).code)
      .toBe("OLD_OWNER_NOT_FENCED");
  } finally { await lab.close(); }
});
```

- [ ] **2. Chạy RED.** `pnpm test:acceptance -- first-shift`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** UAT trial-service/cafe/table-service/buffet/robot-only/no-robot/chain; all selected UI/API/ledger/offline workflows. Với `trial-service`, chạy lại E2E W06-T06 bằng đúng Next.js build/Vercel deployment và APK digest dùng cho bộ chức năng đầy đủ, cả profile Supabase Free: venue mới chỉ khác setting/data đã provision; không sửa code, dùng migration riêng hay build riêng. Inventory scopes F01–F30 and evidence per provider/model; full parity claim only actual accepted scope, not generic marketing comparison.

```ts
export function programComplete(rows:{required:boolean;status:string}[]) {
  return rows.filter(r=>r.required).every(r=>r.status==="accepted");
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Cutover closes/reconciles trial bills/missions, backup/export config dry-run, confirms sole robot emitter, one supervised delivery then ca. Backout stop dispatch first, reconcile loads and money, never restore old financial snapshot over fresh sales.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:acceptance -- first-shift`; kỳ vọng PASS. First shift totals/KDS/robot state after reconnect, documented handoff/support owner, post-release monitoring/backup scheduled. This task cannot pass merely because docs exist. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "ops: accept production scope and controlled restaurant cutover"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] RPO ≤5 phút, RTO ≤30 phút và hiệu năng theo spec phải có số đo; không chỉ có file cấu hình.
- [ ] Không triển khai lên production hoặc gửi lệnh robot thật trong lúc chỉ đang kiểm tra plan.
- [ ] Cutover xác nhận trial ngừng command emission trước activation; rollback không khôi phục snapshot mất giao dịch mới.
