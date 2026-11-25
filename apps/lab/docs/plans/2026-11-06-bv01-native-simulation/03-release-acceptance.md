# Release Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.


> Qualification: [evidence index](../../implementation/evidence/bv01-native-simulation/README.md). Checked boxes record completed portable steps; mixed/native/clean-target/usability steps remain open where actual execution is missing. A skipped Linux assertion is not a native pass.

**Goal:** Có qualification trên đúng pin cho PostgreSQL, offline R-MOCK, usability và signed controller release; mọi blocker được ghi riêng.

**Architecture:** Giữ source artifact export/import hiện có; build theo OS/arch, kiểm manifest, cold installation và rollback. Release decision nằm ngoài run outcome.

**Tech Stack:** Existing CI/Supabase, Node24/pnpm, offline builder, Playwright, LinuxCNC installer/trust policy.

**Spec:** [BVI-01/08/11/12](../../specs/2026-11-06-bv01-native-simulation/README.md), [V13–16 và gates](../../specs/2026-11-06-bv01-native-simulation/verification.md).

## Global Constraints

Áp dụng nguyên văn [Global Constraints của plan tổng](README.md#global-constraints). Không tự ký bằng fixture key, không dùng test counts để accept release. Software R-READY không mở hardware.

## R01 — Baseline và full PostgreSQL integration

**Files:** Modify source `.github/workflows/ci.yml` chỉ nếu cần bổ sung job/report; new Lab `docs/implementation/evidence/bv01-native-simulation/R01-baseline.json`, `R01-postgres.json`. Code regression phát hiện phải sửa tại module tương ứng và thêm test có failing behavior, không đổi expected để che lỗi.

**Interfaces:** Consumes exact source/lab revisions + runtime lock; produces baseline và current-HEAD test records với commands/exit/results/skips. SQLite và Postgres records riêng.

- [x] Capture Git status/HEAD cả hai repo, Node/pnpm/Python, runtime artifact/schema hashes. Preserve existing uncommitted artifact report. Nếu cần clean worktree để chạy/export, tạo từ committed HEAD; không reset checkout người dùng.
- [x] Dùng isolated dev Supabase của repo sau khi kiểm Docker/resources và ports; không dừng instance đang chạy của người dùng. Run từ source:

```sh
pnpm supabase:start
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test:unit
pnpm test:contracts
pnpm test:integration
```

CI hiện đã có Supabase/full integration. Nếu host storage không đủ, chạy trên CI/host đủ điều kiện khi có access; không tạo PASS local hoặc gửi thay đổi CI ngoài authorization. Database instance của task mới là instance được teardown khi xong.
- [x] Phân loại skipped: optional measurement vs assertion bắt buộc; không suy full PG pass khi test filter SQLite. Failure nào tái hiện thì ghi RED test regression, fix, GREEN suite ảnh hưởng và rerun full integration vì failure đã có thật.
- [x] Save V13 với commit và actual suite report. Chạy Lab `pnpm check:source`, `pnpm typecheck`, `pnpm test` trên đúng artifact. Baseline mismatch report không tự cập nhật pin.
- [x] Commit `docs: record full database integration qualification` và code fixes riêng nếu có. Exit: evidence đầy đủ hoặc blocker cụ thể; thiếu Docker/storage không phải bug pass.

## R02 — Clean runtime pin, offline package và usability

**Files:** Modify Lab `config/source-runtime.lock.json`, `README.md`, `scripts/build-offline.mjs`, `scripts/offline-start.mjs` chỉ khi qualification phát hiện bug; new Lab `tests/e2e/offline-bv01.spec.ts`, `docs/implementation/evidence/bv01-native-simulation/R02-offline.json`, `R02-usability.md`. Source export existing `scripts/export-lab-runtime.mjs`. Packages lớn nằm ngoài Git hoặc release store theo convention hiện có.

**Interfaces:** Consumes source clean commit after I01–I03 (và later N tasks cho native release), outputs immutable runtime export + UI built against same pin + OS/arch-specific offline manifest. Không bundle remote credentials.

- [x] RED test reject offline UI pin mismatch và wrong OS/arch; browser test network requests chỉ loopback, no checkout/package manager dependency. Example trong new Playwright test sau launch fixture bắt đầu capture requests:

```ts
const unexpected: string[] = [];
page.on('request', req => {
  const u = new URL(req.url());
  if (u.protocol.startsWith('http') && !['127.0.0.1','localhost'].includes(u.hostname)) unexpected.push(req.url());
});
await page.goto('http://127.0.0.1:4175');
await expect(page.locator('#twin-fault')).toBeVisible();
expect(unexpected).toEqual([]);
```

Pair runtime và complete BV01 bằng helpers từ coffee journey trước assertions cuối. Request capture bổ sung quan sát, không thay bài ngắt network thật.
- [x] Commit source task changes trước export. Từ source, chọn output mới ngoài repo trên volume đủ dung lượng:

```sh
node scripts/export-lab-runtime.mjs /var/tmp/mekoniq-bvi-runtime --clean-checkout
```

Từ Lab:

```sh
node scripts/import-runtime.mjs /var/tmp/mekoniq-bvi-runtime
pnpm check:source
pnpm typecheck
pnpm test
pnpm build
pnpm test:mock-e2e -- coffee-journey.spec.ts arm-simulation.spec.ts controller-report.spec.ts
node scripts/build-offline.mjs --out /var/tmp/mekoniq-bvi-offline
```

Paths là ví dụ trên host build; đổi sang approved storage khi /var/tmp thiếu chỗ. Builder yêu cầu output chưa tồn tại; không xóa folder lạ để retry. Export --clean-checkout chỉ chứa committed source, giữ dirty artifacts ngoài scope.
- [ ] Copy package tới clean user/VM cùng OS/arch, không source checkout hoặc pnpm cache. Cold boot, disable external network interface trong guest/test machine, giữ loopback; `./start`, pairing, order→delivery, fault/reconcile/replay, import/export project/report. Verify rollback dùng previous package/pin và dữ liệu backup; không downgrade schema đang ghi không tương thích. Restore network sau test đúng interface task đã đổi.
- [ ] Build riêng macOS-arm64 và Linux-arm64; amd64 chỉ trên target build phù hợp. Offline package này là R-MOCK, không ngụ ý bundle ROS/Gazebo/LinuxCNC. Ghi startup time measured, không tự đặt SLA rồi suy đạt. Sửa README pin cũ `c1d1ea7` thành actual lock, giữ historical release link có nhãn lịch sử.
- [ ] Guided test ≥5 người dùng mới có consent: open/start, explain mock/native badge, inject missing cup, reconcile, replay, export. Log completion, trợ giúp, lỗi và thời gian từng task; không tự tạo người dùng/khảo sát giả. Nếu chưa có người tham gia, V15 blocked_external. Fix usability defects có severity trước release decision.
- [x] Commit Lab `chore: pin and qualify BV01 offline runtime`; record V14/V15 và R-MOCK pending/accepted theo đầy đủ criteria, không tự promote chỉ vì build xanh.

## R03 — Signed Linux package và qualification amd64

**Files:** Modify source `integrations/arm-controller/packaging/dependencies.lock.json` sau actual amd64 run, `packaging/systemd/mekoniq-arm-bridge.service`, `docs/restore-runbook.md`, `docs/bridge-deployment.md`, `scripts/install-sim.sh`, `scripts/verify-install.sh` khi có bug. Existing tests `tests/test_release_trust.py`, `tests/test_release_security.py`, `tests/test_bridge_permissions_linux.py` trong arm-controller. New evidence `R03-amd64-release.json` ở Lab evidence root.

**Interfaces:** Consumes source/controller clean revisions, actual dependency locks, provisioned signing/trust policy. Produces install/verify/rollback evidence trên clean Linux amd64; target architecture record tách ARM64.

- [ ] Run existing security regression tests trước install. Additional RED khi native installer/service phát hiện lỗi: denied group/channel, stale trust policy, downgrade cùng version/export time, invalid manifest/signature, calibration mismatch rollback. Không dùng custom crypto rewrite ngoài phạm vi bug thực.

```sh
cd integrations/arm-controller
../../.venv/bin/python -m pytest tests/test_release_trust.py tests/test_release_security.py tests/test_bridge_permissions_linux.py -q
```

- [ ] Provision clean amd64 target theo dependency profile được smoke; resolve image checksum/package versions. Chạy lại N02/N03 và required N06 campaign cho amd64. ARM64VM report giữ nguyên, không edit architecture để reuse.
- [ ] Export/sign theo existing controller tooling/runbook với khóa provisioned; verify trust policy independent artifact. Cài bằng installer trên clean target, reboot, verify service UIDs/groups, no operator socket access cho Lab, restore previous release theo calibration compatibility. `NO_ACTIVE_KEY` là not_run/blocker provisioning, không thêm fixture key vào production trust.
- [ ] Ghi V16 signed artifact hash, public key id/policy revision, install target/commands và negative cases. Không upload key. Nếu chỉ test key tạm thì đánh dấu test-signing, chưa đạt signed release thật.
- [ ] Commit `docs: qualify signed controller release on Linux amd64` và fixes cần thiết. Release reviewer đánh giá software R-READY; hardware/PILOT vẫn blocked theo spec gốc.
