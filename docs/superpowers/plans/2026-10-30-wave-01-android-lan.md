# Wave 01 — Android durable store và coordinator LAN Implementation Plan

> Execution 2026-10-30: phần mềm đã hiện thực trên `feat/w00-w04-production-foundation`. Trạng thái từng task và giới hạn kiểm chứng nằm trong [task index](2026-10-30-plan-index.json) và [verification](../../implementation/verification.md). Gate A chưa được chấp nhận; checklist thiết kế gốc bên dưới không thay thế bằng chứng chạy thử.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy ứng dụng tablet thật, nhận command qua LAN và ACK sau commit SQLite.

**Architecture:** Capacitor dùng UI/domain TypeScript; native Kotlin sở hữu SQLite, Keystore và listener TLS. Coordinator chỉ healthy khi cả service và domain foreground runtime xử lý được.

**Tech Stack:** HTML/CSS/TypeScript + Vite, Capacitor Android, Kotlin, SQLite, Android Keystore, TLS, instrumentation tests.

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

**Entry:** W00 đạt; có Android SDK/JDK tương thích bản Capacitor đã khóa và ít nhất hai emulator, sau đó hai tablet trong support matrix.

**Exit:** Hai tablet pair, xử lý command qua LAN khi WAN bị cắt; suspend/kill/full disk không phát ACK giả.

**Đầu ra chạy được:** Tablet B gửi note tới coordinator A, thấy ba mức ACK; restart A vẫn đọc một note; app A suspend khiến B báo isolated.

### W01-T01: Native SQLite bridge kiểm CAS và batch atomic

**Depends on:** W00-T04

**Files:**

- Create: `apps/tablet-android/{package.json,capacitor.config.ts}`, `apps/tablet-android/android/`.
- Create: `apps/tablet-android/android/app/src/main/java/io/mekoniq/tablet/storage/{JournalDatabase,JournalPlugin}.kt`.
- Configure: `apps/tablet-android/android/app/build.gradle.kts` cho instrumentation runner và source set `tests/android/` dùng ở các wave sau.
- Create: `packages/sync/src/storage/android.ts`.
- Test: `apps/tablet-android/android/app/src/androidTest/java/io/mekoniq/tablet/JournalAtomicityTest.kt`.

**Interfaces:**

- Consumes: `CommitBatch` schema W00-T04, SQLite migrations dùng chung.
- Produces: Capacitor `Journal.commitBatch(batch):Promise<CommitReceipt>`, `readSnapshot(ref)`, `pendingOutbox()`, `ack(receipt)`; Kotlin `JournalDatabase.commit(batch)`.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```kotlin
@Test fun staleBatchDoesNotPartiallyWrite() {
    val db = JournalDatabase.testDatabase(context)
    db.commit(testBatch(operationId = "op-1", expectedVersion = 0))
    assertThrows(VersionConflict::class.java) {
        db.commit(testBatch(operationId = "op-2", expectedVersion = 0))
    }
    assertEquals(1, db.journalCount())
    assertEquals(1, db.outboxCount())
    db.close()
}
```

- [ ] **2. Chạy RED.** `apps/tablet-android/android/gradlew -p apps/tablet-android/android connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.mekoniq.tablet.JournalAtomicityTest`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Tạo instrumentation fixture `testBatch` với cùng aggregate `note-1`; parser allowlist schema batch, deny arbitrary SQL. Kiểm scope, expected version, owner epoch và idempotency trước mutation trong cùng SQLite transaction.

```kotlin
db.beginTransaction()
try {
    validateBatch(batch)
    verifyExpectedVersions(batch)
    val receipt = applyBatchAndJournal(batch)
    db.setTransactionSuccessful()
    return receipt
} finally {
    db.endTransaction()
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Adapter Android thực hiện AtomicStore qua typed plugin. `applyBatchAndJournal` chỉ ghi các operation đã định nghĩa trong CommitBatch, cấp sequence native. Bridge serialize BigInt thành decimal strings và trả lỗi typed `STORAGE_FULL`, `VERSION_CONFLICT`, `INVALID_BATCH`. Đăng ký thư mục test chung từ Gradle root `apps/tablet-android/android`; giữ source set instrumentation mặc định:

```kotlin
android {
    defaultConfig {
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    sourceSets.getByName("androidTest").java.srcDir(
        rootProject.file("../../../tests/android")
    )
}
```

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `apps/tablet-android/android/gradlew -p apps/tablet-android/android connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.mekoniq.tablet.JournalAtomicityTest`; kỳ vọng PASS. Kill sau SQLite commit trước bridge callback, reopen file, duplicate response và lỗi full disk. Chạy fixture parity với Node SQLite adapter. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W01-T01.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: add native transactional tablet storage"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W01-T02: Keystore và identity của thiết bị

**Depends on:** W01-T01, W00-T02

**Files:**

- Create: `apps/tablet-android/android/app/src/main/java/io/mekoniq/tablet/identity/{DeviceKeys,IdentityPlugin}.kt`.
- Create: `packages/contracts/schemas/device-proof.schema.json`, `tests/fixtures/contracts/es256.json`.
- Test: `apps/tablet-android/android/app/src/androidTest/java/io/mekoniq/tablet/DeviceIdentityTest.kt`.

**Interfaces:**

- Consumes: Canonical bytes W00-T02; profile chữ ký trong plan tổng.
- Produces: `DeviceKeys.sign(bytes):ByteArray`, `publicJwk():String`, `Identity.deviceEpoch():String`; key không export.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```kotlin
@Test fun signatureSurvivesRestartWithoutExportingKey() {
    val keys = DeviceKeys(context, "mekoniq-test")
    val payload = canonicalFixtureBytes()
    val signature = keys.sign(payload)
    val reopened = DeviceKeys(context, "mekoniq-test")
    assertTrue(verifyEs256(reopened.publicJwk(), payload, signature))
    assertFalse(verifyEs256(reopened.publicJwk(), payload + byteArrayOf(1), signature))
}
```

- [ ] **2. Chạy RED.** `apps/tablet-android/android/gradlew -p apps/tablet-android/android connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.mekoniq.tablet.DeviceIdentityTest`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** P-256 signing bằng Android Keystore; tạo epoch mới khi enrollment mới. Test helpers `canonicalFixtureBytes` đọc fixture W00, `verifyEs256` dùng Java Signature và chuyển JOSE raw r||s sang DER qua thư viện kiểm chứng, không tự crypto.

```kotlin
val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
    .setDigests(KeyProperties.DIGEST_SHA256)
    .build()
val generator = KeyPairGenerator.getInstance("EC", "AndroidKeyStore")
generator.initialize(spec)
generator.generateKeyPair()
```

- [ ] **4. Nối vào runtime và lưu trữ.** JS chỉ nhận public JWK/signature/device epoch. API enrollment thật nối W02-T02; ở wave này dùng fixture CA chỉ cho test build, production từ chối test CA. Uninstall không được tự lấy identity cũ bằng device name.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `apps/tablet-android/android/gradlew -p apps/tablet-android/android connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.mekoniq.tablet.DeviceIdentityTest`; kỳ vọng PASS. Node và Python verify chữ ký Android trên golden fixture; payload đổi fail. Dùng Android hardware/software-backed capability báo đúng, không mặc định có StrongBox. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W01-T02.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: secure tablet identity with native keystore"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W01-T03: LAN listener, pairing và heartbeat domain runtime

**Depends on:** W01-T01, W01-T02

**Files:**

- Create: `apps/tablet-android/android/app/src/main/java/io/mekoniq/tablet/lan/{LanService,PairingRegistry,Discovery}.kt`.
- Create: `apps/tablet-android/src/{coordinator-runtime,lan-bridge}.ts`, `packages/sync/src/coordinator-health.ts`.
- Test: `tests/unit/coordinator-health.test.ts`.

**Interfaces:**

- Consumes: AtomicStore, signer; fixed coordinator ID và venueEpoch từ provisioning.
- Produces: `coordinatorReady({serviceUp,runtimeLastSeenMs,nowMs,storeWritable}):boolean`; LAN POST `/v1/commands`, GET `/v1/health`, WS `/v1/events`; pairing theo certificate scope.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { expect, test } from "vitest";
import { coordinatorReady } from "../../packages/sync/src/coordinator-health";
test("listener alive cannot hide suspended domain runtime", () => {
  expect(coordinatorReady({serviceUp:true, runtimeLastSeenMs:1000,
    nowMs:5000, storeWritable:true})).toBe(false);
});
```

- [ ] **2. Chạy RED.** `pnpm test:unit -- tests/unit/coordinator-health.test.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Heartbeat domain mỗi 500 ms; readiness TTL 2 giây là tham số app, không phải safety watchdog. Request hết hạn/không tới domain trả 503/unknown, không ACK success. Listener TLS kiểm identity paired; mDNS không cấp quyền.

```ts
export function coordinatorReady(s: {
  serviceUp:boolean; runtimeLastSeenMs:number; nowMs:number; storeWritable:boolean
}) {
  return s.serviceUp && s.storeWritable &&
    s.nowMs - s.runtimeLastSeenMs <= 2000;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** Native service queue request có bounded capacity 100 và timeout 5 giây; domain xử lý một aggregate transaction/CAS, response theo receipt thật. Tạo fixture pairing QR chứa endpoint fingerprint + one-time nonce; nonce tiêu thụ một lần. Không auto-elect khi health down.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:unit -- tests/unit/coordinator-health.test.ts`; kỳ vọng PASS. Hai thiết bị gọi command qua TLS; foreign venue key bị từ chối, replay nonce bị từ chối; mDNS tắt vẫn nối endpoint đã pair. Test app pause/suspend thay vì chỉ giả variable. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W01-T03.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: coordinate trusted tablets over local network"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W01-T04: UI trạng thái kết nối, outbox và role shell

**Depends on:** W01-T03

**Files:**

- Create: `apps/tablet-web/src/{router,main}.ts`, `apps/tablet-web/src/screens/DeviceStatus.ts`.
- Create: `apps/tablet-web/{index.html,package.json,vite.config.ts}`, `apps/tablet-web/src/styles.css`, `apps/tablet-web/public/` cho font/audio cần offline.
- Create: `packages/ui/src/{SyncStatus,OfflineBanner}.ts`, `packages/ui/locales/{vi,en}.json`.
- Create: `apps/tablet-web/src/transport/session.ts`, `apps/tablet-android/src/ui-entry.ts`.
- Test: `tests/e2e/device-status.spec.ts`.

**Interfaces:**

- Consumes: CommandResult ACK levels và real status subscription; Playwright `page` fixture.
- Produces: `SyncStatus({level:'local'|'venue'|'cloud'|'unknown'})`; app paths `/device`, `/pos`, `/kitchen`, `/fleet`, `/settings` với role guard.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```ts
import { test, expect } from "@playwright/test";
test("local commit is not presented as cloud sync", async ({page}) => {
  await page.goto("/device?fixture=local-only");
  await expect(page.getByText("Đã lưu trên thiết bị")).toBeVisible();
  await expect(page.getByText("Đã đồng bộ cloud", {exact:true})).toHaveCount(0);
  await expect(page.getByRole("button", {name:"Xóa dữ liệu"})).toBeDisabled();
});
```

- [ ] **2. Chạy RED.** `pnpm test:e2e -- tests/e2e/device-status.spec.ts`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Fixture query chỉ tồn tại trong test build. UI có last sync time, pending count, owner endpoint và lý do unavailable; không dựa vào navigator.onLine để xác nhận owner reachable.

```ts
export function SyncStatus({level}: {level:"local"|"venue"|"cloud"|"unknown"}) {
  const label = {local:"Đã lưu trên thiết bị", venue:"Nhà hàng đã nhận",
    cloud:"Đã đồng bộ cloud", unknown:"Chưa xác định kết quả"}[level];
  const node = document.createElement("span");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.textContent = label;
  return node;
}
```

- [ ] **4. Nối vào runtime và lưu trữ.** HTML entry/DOM router chạy từ local bundle; Capacitor trỏ build `tablet-web`, fonts/audio không cần CDN. Safe text rendering và cleanup subscriptions khi đổi screen. Tạo transport interface cloud/relay/LAN cùng command envelope; backoff+jitter, retry giữ operationId. Role route chỉ hiển thị capability module đã đăng ký; không gọi Next.js SSR/Server Actions cho tác vụ LAN.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:e2e -- tests/e2e/device-status.spec.ts`; kỳ vọng PASS. Test 1280×800, 800×1280, touch, keyboard, VI/EN, stale draft vẫn giữ; pending journal chặn reset. Native APK dùng bundle local khi startup mất WAN. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W01-T04.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "feat: show durable delivery and connectivity status on tablets"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

### W01-T05: Qualification vòng đời Android và hai thiết bị

**Depends on:** W01-T01..W01-T04

**Files:**

- Create: `scripts/android-lab.mjs`, `tests/android/coordinator-lifecycle.yaml`, `docs/operations/tablet-provisioning.md`.
- Create: `docs/implementation/tablet-support-matrix.json`.
- Test: `tests/android/LifecycleAcceptanceTest.kt`.

**Interfaces:**

- Consumes: LanService, native Journal, APK, two enrolled device fixtures; `AndroidLab` harness tạo ở task này.
- Produces: `pnpm test:android -- lifecycle`; matrix theo model/OS/API/WebView/app version, evidence URI và verified/not_verified.

- [ ] **1. Viết test hành vi và fixture cụ thể.** Tạo test dưới đây trong file đã chỉ định; helper chỉ dùng hợp đồng ở plan tổng. Bổ sung các ca trong mục kiểm chứng của task.

```kotlin
@Test fun stoppedCoordinatorDoesNotAcknowledgePeerOrders() {
    val lab = AndroidLab.connectedPair()
    lab.forceStopCoordinator()
    val result = lab.peerSendNote("op-lifecycle")
    assertEquals("unknown", result.status)
    assertEquals("isolated", lab.peerMode())
    assertEquals(1, lab.peerPendingCount())
}
```

- [ ] **2. Chạy RED.** `pnpm test:android -- lifecycle`. Kỳ vọng: test mới thất bại ở invariant chưa có; nếu lỗi toolchain/fixture thì sửa nguyên nhân đó trước, không coi là RED hợp lệ.

- [ ] **3. Hiện thực phần cốt lõi.** Harness điều khiển emulator qua adb và app test channel có chữ ký test, tắt ở release. Coverage WAN off/LAN on, screen off, Doze, app force-stop, reboot, storage full và coordinator healthy hồi phục.

```sh
adb -s "$COORDINATOR_SERIAL" shell am force-stop io.mekoniq.tablet
adb -s "$PEER_SERIAL" shell am instrument -w \
  -e class io.mekoniq.tablet.LifecycleAcceptanceTest \
  io.mekoniq.tablet.test/androidx.test.runner.AndroidJUnitRunner
```

- [ ] **4. Nối vào runtime và lưu trữ.** android-lab yêu cầu 2 serial khác nhau, cấm target robot/thiết bị không enroll test; log model/build và exit failure nếu thiếu device thay vì skip xanh. Tablet thật qualify foreground/kiosk cắm nguồn trước gate A.

- [ ] **5. Chạy GREEN và kiểm tra hồi quy.** Chạy lại `pnpm test:android -- lifecycle`; kỳ vọng PASS. Không chấp nhận chỉ unit test heartbeat. Điều kiện bị OS dừng được hiển thị và journal vẫn tồn tại sau restart. Chạy `pnpm typecheck` và `pnpm lint` cho workspace đã tạo; không chạy test phần cứng với fake rồi ghi đạt hardware.

- [ ] **6. Ghi bằng chứng và commit.** Cập nhật `docs/implementation/evidence/W01-T05.md`: commit, command, runtime, kết quả, giới hạn. Review diff chỉ chứa task; stage các file trong **Files**, test và evidence, rồi `git commit -m "test: qualify android coordinator lifecycle and recovery"`. Chỉ đánh dấu checkbox khi bước tương ứng đã chạy.

## Wave acceptance

- [ ] APK build được, giao diện VI/EN phân biệt trạng thái lưu/nhận/sync; không secret trong bundle.
- [ ] Keystore signer và SQLite batch chạy native; không đọc private key trong JS.
- [ ] Có bằng chứng hai tablet thật cùng AP; emulator không thay kết quả sleep/Doze thiết bị.
