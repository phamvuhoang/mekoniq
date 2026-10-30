# Wave 11 — chất lượng production, triển khai và chuyển đổi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phát hành bằng bằng chứng nghiệm thu, backup/restore và chuyển một nguồn điều khiển robot.

**Architecture:** Hardening diễn ra từ đầu; wave này kiểm độc lập toàn hệ thống và tạo release dossier theo profile. Cloud rollout và tablet update tách khỏi dữ liệu, hỗ trợ client cũ đang offline.

**Tech Stack:** Cloud containers, managed PostgreSQL/PITR, Android signed APK, CI artifact attestations, OpenTelemetry, load/fault tests.

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

- [ ] **4. Nối vào runtime và lưu trữ.** Cloud secret manager and device key rotation test queued old signatures valid historical provenance without new authority. Android database encryption chosen support profile, attachments encrypted/ACL, PII retention/delete workflow preserves required financial references.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:security -- tests/security/tenant-escape.test.ts`; kỳ vọng PASS. Run dependency/license/SBOM checks and signed artifact verification; no simplistic claim all security solved from unit tests. Record unresolved findings with release blocking severity. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "test: qualify production trust and data isolation boundaries"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W11-T02: Hiệu năng, observability và fault load

**Depends on:** W05, W06 software gate, W09 selected

**Files:**

- Create: `tests/load/restaurant.ts`, `scripts/run-load.mjs`, `deploy/observability/{dashboards,alerts}.json`.
- Create: `docs/operations/service-levels.md`.
- Create: `tests/support/load-report.ts`.
- Test: `tests/acceptance/load-budget.test.ts`.

**Interfaces:**

- Consumes: Metrics sync gaps/lag, command ACK/native result, traces operationId, same fixture traffic.
- Produces: `pnpm test:load`; measured report hardware/network/runtime identity; alerts for saturation/unknown state.

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

- [ ] **3. Hiện thực phần cốt lõi.** Workload20tablet/10robot/100bàn/10businesscommand per second, duration/ramp/seed recorded. Robot emulation explicitly for load, not hardware compatibility. CutWAN/slowDB/reconnect storms while preserve invariant.

```ts
export type LoadReport = {
  localAckP95Ms:number; kitchenDeliveryP95Ms:number;
  duplicateFinancialEffects:number; durationSeconds:number;
  tabletModel:string; appCommit:string; networkProfile:string;
};
```

- [ ] **4. Nối vào runtime và lưu trữ.** `run-load` creates dedicated venue, refuses production endpoint by default and requires verified test profile; metric dashboards show stale vs failed vs unknown. Android battery/temp/storage and bounded queue/backpressure tracked.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:load`; kỳ vọng PASS. Long 24h soak plus spike separately, rejected requests not counted successful latency, queue drain time after heal, metrics no PII/tokens. readMeasuredLoadReport reads artifact, never fixture PASS. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "perf: measure restaurant concurrency and recovery budgets"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W11-T03: Backup, migration và restore khi client cũ offline

**Depends on:** W04-T03..W04-T06, all release data modules

**Files:**

- Create: `scripts/{backup-verify,restore-rehearsal,migrate-release}.mjs`, `deploy/cloud/backup-policy.json`.
- Create: `tests/integration/upgrade-recovery.test.ts`, `docs/operations/{backup-restore,rolling-upgrade}.md`.
- Test: `tests/integration/upgrade-recovery.test.ts`.

**Interfaces:**

- Consumes: Journal original IDs, schema compatibility adapters, managed DB PITR configured at actual deployment.
- Produces: Expand/contract migration and rollback-forward artifacts; measured RPO/RTO report; n and n-1 client compatibility.

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

- [ ] **4. Nối vào runtime và lưu trữ.** Cloud provider actual backup/restore command bound via deployment profile, separate restore database never live overwrite. Native export/import uses original device epochs; verify hash, encrypted key recovery. Record expected and actual data loss/checkpoint delta.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:integration -- tests/integration/upgrade-recovery.test.ts`; kỳ vọng PASS. O19/O22 native/cloud, corruption/missing segment, late source import duplicate, restore loses idempotency row detected. Real managed DB rehearsal mandatory to claim RPO/RTO. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W11-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "ops: verify recoverable migrations and backup restoration"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W11-T04: Release pipeline và deployment có rollback

**Depends on:** W11-T01..W11-T03

**Files:**

- Create: `.github/workflows/release.yml`, `deploy/cloud/{compose.yml,release-manifest.schema.json}`, `scripts/{release,verify-release}.mjs`.
- Create: `docs/operations/{cloud-deployment,android-distribution,rollback}.md`.
- Test: `tests/acceptance/release-manifest.test.ts`.

**Interfaces:**

- Consumes: Container/APK digests, migration range, contracts versions, CI gates and target environment.
- Produces: Immutable release manifest, signed APK/container artifacts, dry-run deploy and rollback-forward plan; export `checkRelease(input:ReleaseCheckInput):{ok:boolean;reasons:string[]}` từ `scripts/verify-release.mjs`. `ReleaseCheckInput` có `requiredProfiles:string[]`, `profiles:Record<string,{status:string;hardwareRequired:boolean}>` cho profile gate, cùng manifest metadata được schema validate trước đó.

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

- [ ] **3. Hiện thực phần cốt lõi.** Manifest includes exact image/APK hash, schema read/write range, feature registry versions, enabled adapter/provider evidence; prerequisite jobs cannot be silently skipped. Config secrets external, startup rejects absent production auth/secrets.

```ts
export function hardwareProfileReady(p:{status:string;hardwareRequired:boolean}) {
  return !p.hardwareRequired || p.status==="venue_approved";
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** `checkRelease` duyệt mọi required profile: missing profile hoặc trạng thái chưa đạt thì thêm reason; `ok` chỉ true khi không còn reason. Hardware profile cần `venue_approved`; provider profile cần evidence sandbox/production theo W10, không coi `hardwareRequired:false` là tự đạt. CLI dùng cùng hàm và exit nonzero khi fail. Cloud deployment portable containers with managed DB and HTTPS; no venue server component added. Build/provision/dry-run locally first; actual publish/deploy target follows authorized environment instruction at execution, concrete manifest review precedes irreversible release.

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

- [ ] **3. Hiện thực phần cốt lõi.** UAT trial-service/cafe/table-service/buffet/robot-only/no-robot/chain; all selected UI/API/ledger/offline workflows. Với `trial-service`, chạy lại E2E W06-T06 bằng đúng container/APK release digest dùng cho bộ chức năng đầy đủ: venue mới chỉ khác setting/data đã provision; không sửa code, dùng migration riêng hay build riêng. Inventory scopes F01–F30 and evidence per provider/model; full parity claim only actual accepted scope, not generic marketing comparison.

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
