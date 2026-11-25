# UTM & Native Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.


> Qualification: [evidence index](../../implementation/evidence/bv01-native-simulation/README.md). Checked boxes record completed portable steps; mixed/native/clean-target/usability steps remain open where actual execution is missing. A skipped Linux assertion is not a native pass.

**Goal:** Qualify Gazebo/Nav2 và LinuxCNC trong hai Linux VM, sau đó chạy combined BV01 có nguyên nhân lỗi và evidence đầy đủ.

**Architecture:** Ubuntu coordinator và worker local; Debian controller/QtVCP với Lab/operator Unix sockets riêng; SSH StreamLocal chỉ nối Lab channel. Một run journal, nhiều clock domains, SIM gripper có observation explicit.

**Tech Stack:** UTM QEMU/HVF ARM64, Ubuntu 24.04/Jazzy/Harmonic, Debian 12/linuxcnc-uspace/QtVCP, OpenSSH, Node/Python.

**Spec:** [BVI-09..11](../../specs/2026-11-06-bv01-native-simulation/README.md), [clock/transport/plant contracts](../../specs/2026-11-06-bv01-native-simulation/contracts-and-evidence.md).

## Global Constraints

Áp dụng nguyên văn [Global Constraints của plan tổng](README.md#global-constraints). Native evidence cần raw execution; VM ARM64 không qualify IPC amd64. Provisioning dùng [UTM runbook](utm-runbook.md), không tự chọn image x86 trên M2 để bỏ qua dependency lỗi.

## N01 — Provision hai VM có inventory

**Files:** New source `robotics/simulation/profiles/utm-ubuntu-arm64.lock.json`, `integrations/arm-controller/packaging/dependencies.arm64-vm.lock.json`; new Lab `docs/implementation/evidence/bv01-native-simulation/N01-vm-inventory.json`. Không sửa verified status của lock amd64 cũ. ISO/VM disks nằm ngoài repo.

**Interfaces:** Produces guest identity/arch/kernel/UTM version, OS image URL+sha256, package manifest, SSH host key fingerprints (public), selected profile revision; required input cho N02/N03/N04. Không persist private key/password.

- [x] Preflight host storage/RAM/UTM như runbook; lưu actual values và status. Hiện tại RED=`VM_STORAGE_INSUFFICIENT`; chưa có writable destination đủ chỗ. Người dùng cung cấp volume hoặc giải phóng dung lượng; không xóa dữ liệu tự động.
- [ ] Khi storage đạt budget: cài UTM chính thức, xác minh ứng dụng/signature; tạo Ubuntu `mekoniq-amr` 4 CPU/8 GiB/64 GiB và Debian `mekoniq-arm` 2 CPU/4 GiB/32 GiB, ARM64 hypervisor bật. Boot từng VM, install OS, SSH key auth, stock kernel; không USB passthrough robot. Save stopped clean baseline.
- [ ] Kiểm trong từng guest:

```sh
uname -m
uname -r
cat /etc/os-release
dpkg --print-architecture
df -h /
free -m
```

Expected aarch64/arm64, đúng OS/version, đủ free disk. Hostname khác nhau; SSH fingerprints so với console VM, không tắt StrictHostKeyChecking.
- [ ] Lưu inventory có checksum, không runtime pass. Test reboot + SSH reconnect. Ghi rõ snapshots/copies là clean powered-off, không restore một active command journal giữa run.
- [ ] Commit metadata `docs: record isolated UTM native simulation profiles`. Exit N01=hai VM boot được; nếu chỉ một VM thành công thì ghi riêng, không tick cả task.

## N02 — Gazebo/Nav2 standalone ARM64

**Files:** Modify source `robotics/simulation/profiles/utm-ubuntu-arm64.lock.json` (N01), `robotics/simulation/bridge/launch_plan.py`, `robotics/simulation/launch/lab_world.launch.py`, `scripts/lab-sil.mjs`; new source `robotics/simulation/tests/test_native_profile.py`, `tests/integration/lab-v2-native-profile.test.ts`. Chỉ sửa launch/runtime khi smoke phát hiện thiếu cấu hình; không thay fixture assertion để chạy qua.

**Interfaces:** Consumes Ubuntu inventory, existing world compiler/worker/campaign. Produces doctor profile selection và native run artifacts cho FD01/02/03/04/07. Thêm CLI option mới `--environment-profile utm-ubuntu-arm64` cho doctor/run; expected architecture/image lock theo profile, không báo digest amd64 khi thực chạy native apt ARM64.

- [x] RED portable profile test: unknown arch/profile và missing actual package inventory bị chặn. Add fixture data `{profile:'utm-ubuntu-arm64', arch:'amd64'}`; expect `PROFILE_ARCH_MISMATCH`. Run source `pnpm exec vitest run tests/integration/lab-v2-native-profile.test.ts` và `.venv/bin/python -m pytest robotics/simulation/tests/test_native_profile.py -q`.
- [ ] Trong Ubuntu, install dependency theo runbook; capture apt package versions. Verify renderer bằng sample sensor thật, không chỉ `gz --version`. Không GUI window ban đầu; GPU sensor vẫn có thể cần EGL/renderer. Nếu renderer không chạy, thử configuration supported và ghi kết quả; không xóa sensors.
- [x] Implement explicit environment profile resolution, node/Python/ROS package checks, native headless flag propagation. GREEN portable tests. Build ROS packages với lock và local source clean revision.
- [ ] Native commands từ source checkout trong Ubuntu, sau profile option được implement:

```sh
node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile utm-ubuntu-arm64 --json
node scripts/lab-sil.mjs run --scenario FD01 --seed 17 --repeat 3 --environment-profile utm-ubuntu-arm64 --out /var/tmp/mekoniq-evidence/N02-FD01
node scripts/lab-sil.mjs verify --input /var/tmp/mekoniq-evidence/N02-FD01
```

Sau FD01 pass, chạy cùng lệnh cho FD02, FD03, FD04, FD07 với output directory riêng. Doctor/run/verify hiện chưa nhận environment-profile; N02 phải thêm và test trước dùng. Không chạy food-beverage campaign nếu còn BV01 chưa có runner.
- [ ] Check process /clock/Nav2 lifecycle/sensors, world revision, contacts/separation/fault artifacts; 3 repeats không mất coverage. Save V07/V08 status, real-time factor, render backend. Commit `feat: qualify explicit ARM64 native navigation profile` với metadata đã resolve; không đổi false thành pass khi run chưa thực hiện.

## N03 — LinuxCNC terminal và GUI qualification

**Files:** Modify source `integrations/arm-controller/packaging/dependencies.arm64-vm.lock.json`, `configs/sim/puma560/profile.json`, `scripts/smoke_driver.py`, `scripts/smoke-sim.sh`, `docs/hmi-acceptance.md` trong cùng arm-controller root khi smoke cần fix. Existing tests `tests/test_linuxcnc_sim.py`, `tests/test_bridge_permissions_linux.py`, `tests/test_arbiter.py`, `tests/test_bridge_recovery.py`. New evidence N03-terminal/N03-gui riêng.

**Interfaces:** Consumes Debian inventory, actual LinuxCNC Python module/profile/program hashes. Produces CONTROLLER-POC ARM64 terminal + GUI evidence, không gripper qualification.

- [ ] Resolve candidate từ apt repository chính thức theo Debian/ARM64; pin exact versions/checksums sau install. Debian distro package có thể khác candidate2.9.10; nếu khác, lưu candidate mới và compatibility verdict, không sửa metadata thành version chưa cài.
- [x] Run portable bridge tests trong interpreter riêng tránh package `bridge` trùng ROS tree:

```sh
cd integrations/arm-controller
../../.venv/bin/python -m pytest tests/test_arbiter.py tests/test_bridge_recovery.py tests/test_bridge_permissions_linux.py -q
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir /var/tmp/mekoniq-evidence/N03-terminal
```

Preflight exit2→not_run; after controller starts failed assertion→fail. Nếu shell smoke không chạy stock kernel, sửa SIM HAL/profile selection, không chọn hardware mode.
- [ ] Kiểm FK/IK A01 reference poses/units, actual joints + epoch, program completion observed, pause/resume/cancel; prove restart while bridge alive. RED regression cho lỗi native tìm thấy, GREEN cùng suite trước lặp smoke.
- [ ] Mở desktop UTM và QtVCP với profile. Thực hiện `docs/hmi-acceptance.md` checklist thật; chụp GUI và log actions/ownership. `--gui` script chỉ dùng khi verifier nhận được driver record hợp lệ; không coi process/window open là pass checklist. Không dùng Xvfb-only record thay GUI acceptance.
- [ ] Save V09/V10, updated profile/model hashes và package inventory. Commit `fix: qualify LinuxCNC SIM profile on Debian ARM64` nếu có code fix, hoặc `docs: record controller VM qualification` nếu chỉ evidence.

## N04 — SSH channel và cross-VM clocks

**Files:** New source `scripts/native-sim/arm-tunnel.mjs`, `tests/unit/native-arm-tunnel.test.ts`, `tests/integration/lab-v2-remote-arm-clock.test.ts`; modify source `packages/lab-runtime/src/v2/backends/clock-barrier.ts`, `v2/arm/adapter.ts`, `v2/arm/session.ts`, `integrations/arm-controller/docs/bridge-deployment.md`. Test bridge ACL existing `integrations/arm-controller/tests/test_bridge_permissions_linux.py`.

**Interfaces:** Consumes server-defined SSH alias + pinned known_hosts + remote Lab socket, no UI arbitrary destinations. Produces local per-run Unix socket and supervisor lifecycle consumed by existing connectBridge(socketPath). New helper `withinReceiptWindow(receipts: readonly bigint[], maxSkewNs: bigint): boolean`; receipt timestamps from same coordinator, never provider clocks.

- [x] RED clock/barrier tests:

```ts
expect(withinReceiptWindow([], 100n)).toBe(false);
expect(withinReceiptWindow([1000n, 1050n], 100n)).toBe(true);
expect(withinReceiptWindow([1000n, 1300n], 100n)).toBe(false);
```

Also require participant cardinality, mismatched duplicate barrier key error, paused-state ACK, foreign monotonic clocks with huge offset not subtracted. Run source `pnpm exec vitest run tests/unit/native-arm-tunnel.test.ts tests/integration/lab-v2-remote-arm-clock.test.ts`.
- [x] Implement supervisor spawn argv array/no shell; local dir0700/socket0600, bounded readiness timeout, kill only owned process; cleanup only owned socket. Use SSH `-N -a -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -L localSocket:remoteLabSocket alias`. No agent/X11 forwarding, no local operator socket, no auto-unlink arbitrary path.
- [ ] On Debian, dedicated SSH principal only member of Lab group, no sudo/operator group; disable TCP/agent/X11 forwarding for that principal, allow local StreamLocal. Verify actual service/ACL group identities from installed profile. Do not assume PermitOpen restricts Unix sockets; filesystem ACL is authority. Verify principal cannot read/connect operator socket or modify program files.
- [ ] GREEN portable tests; native tunnel drop, controller reboot, VM suspend/resume, stale telemetry and lease expiry. Every reconnect requires hello/epoch/query, no motion auto replay. Provider clocks recorded separately; coordinator age drives freshness. Lease still expires when Gazebo paused.
- [ ] Save V12 transport prerequisites, commit `feat: supervise isolated arm tunnel and clock-domain barriers`. Native tunnel success alone does not imply combined BV01 pass.

## N05 — SIM gripper, receiver and geometry coupling

**Files:** New source `integrations/arm-controller/bridge/sim_gripper.py`, `tests/test_sim_gripper.py` in arm-controller root; modify `bridge/linuxcnc_port.py`, `bridge/arbiter.py`, `bridge/service.py`, `configs/sim/puma560/profile.json`, `configs/sim/puma560/machine.hal`, `programs/cup-pick.ngc`, `programs/cup-place.ngc`. Modify source `packages/lab-runtime/src/v2/beverage/plant-session.ts`, `v2/arm/session.ts`, `robotics/simulation/bridge/scene_loop.py`; new source `tests/integration/lab-v2-native-cup.test.ts`.

**Interfaces:** Consumes I01 observations, I02 ports, N03 actual joints and profile, receiver-side Gazebo tray evidence. Thêm negotiated simScene/SimSceneUpdate theo spec; cập nhật source `packages/contracts/schemas/arm-command.schema.json`, `arm-observation.schema.json`, generated outputs, TS contract validators và Python `bridge/protocol.py` trong cùng task. Test strict-one-shape và reject simScene trên non-SIM/old bridge; wire actual gripper output/state vào telemetry có provenance. Produces modeled TransferObservation with producer linuxcnc_virtual_grip/gazebo_tray. New Python pure `next_grip(*, close_output: bool, cup_in_zone: bool, fault: bool) -> str` returns held/empty/open/fault; stateful wrapper adds observed timing/epoch/correlation, never directly confirms domain.

- [x] RED behavior tests:

```python
def test_close_without_cup_never_proves_grasp():
    assert next_grip(close_output=True, cup_in_zone=False, fault=False) == "empty"
    assert next_grip(close_output=True, cup_in_zone=True, fault=True) == "fault"
```

Additional cases controller done/null grip, cup taken twice, wrong receiver, releasing after receiver moved, stale sample, command epoch mismatch, nozzle/tray collision duplicates. Run arm-controller `../../.venv/bin/python -m pytest tests/test_sim_gripper.py tests/test_arbiter.py -q`; source `pnpm exec vitest run tests/integration/lab-v2-native-cup.test.ts`.
- [x] Implement virtual plant using actual controller state, SIM scene context từ coordinator với seq/lease/freshness guard và M64/M65 output0; không mở M66 increment này; finite geometry/tolerance values in fixture, unit conversions; no model commands that bypass arbiter. Extend allowlist only for explicit SIM pin/opcode/timeout; test arbitrary pin/M-code forbidden and non-SIM profile denial. Recompute program hashes/reference transforms; verify reachable pick/place and checker before native motion simulation.
- [x] Feed receiver observation independently from Gazebo tray state; match run/cup/transfer/command/epoch, two observers, dock/slot. Wire takeCup+ledger and attachment restoration after restart; dropped/unknown cup no longer exists at nozzle. Allowed contact phase bounded; held cup geometry remains collision-tested.
- [ ] GREEN portable tests, then native pick/place cycle with cup present/missing/gripper fault/receiver absent. Record raw HAL I/O/joints and modeled plant outputs; produce V11. Grip remains modeled, no claim force/physical sensor.
- [ ] Commit `feat: model controller-driven cup grip and handoff observations`. Re-pin controller programs + source runtime before combined run.

## N06 — BV01 native runner và Lab access

**Files:** New source `tests/fixtures/digital-twin/sil/bv01.json`, `tests/integration/lab-v2-bv01-sil.test.ts`; modify source `packages/lab-runtime/src/v2/sil/campaign.ts`, `sil/cli.ts`, `scenario-registry.ts`, `scenario-matrix.ts`, `gateway.ts`, `reports/simulation-evidence.ts` under v2; `scripts/lab-sil.mjs`, `tests/fixtures/digital-twin/campaigns/food-beverage.json`. Lab modify `src/scenarios/controls.ts`, `src/scenarios/support.ts`, new `tests/e2e/native-run-report.spec.ts`.

**Interfaces:** Consumes I02 workflow/I03 report/I04 readiness + N02/N04/N05 providers. Produces native RunReport from same source domain and one runId; RunHandle control/subscribe/report lifecycle compatible with existing gateway caller. No native CLI run hidden behind a mock gateway run ID.

- [x] RED admission rejects absent arm/grip/fixture, campaign requires exact backend set, zero samples not pass. Use real coordinator with provider doubles for portable tests and label protocol_double. Native flag never inferred from a double's hello alone.
- [x] Run source `pnpm exec vitest run tests/integration/lab-v2-bv01-sil.test.ts`; current CLI preflight BV01 rejected is expected before implementation.
- [x] Implement BV01 fixture/registration, common CoffeeDriver invocation in SIL loop, required backend doctor dispatch including remote LinuxCNC probe, barrier transfer and report persistence. Gateway binds authenticated native run to session and streams actual observations. CLI/native UI both use the same provider factory. Implement deadline cancellation and safe teardown without fake terminal successes.
- [ ] GREEN portable tests; after resource/transport gates, run in Ubuntu:

```sh
node scripts/lab-sil.mjs run --scenario BV01 --seed 23 --repeat 3 --backend-set coffee-simulation --environment-profile utm-ubuntu-arm64 --out /var/tmp/mekoniq-evidence/N06-BV01
node scripts/lab-sil.mjs verify --input /var/tmp/mekoniq-evidence/N06-BV01
```

These options/runner are N02/N06 deliverables. backend set definition must include actual Gazebo+coffee I/O+LinuxCNC requirements, not default mock arm. Native browser test runs against these providers, not `test:mock-e2e` launcher; configure Playwright baseURL to SSH-forwarded4175 and pair with runtime. Record native browser run separately from fixture-based report rendering test.
- [ ] Repeat required faults: missing cup, grip failure, AMR disconnect/delay, blocker, controller restart, tunnel loss during transfer. Check served-after-handoff requires CargoLoaded, cup ledger, collision coverage and both engine samples. Import report into Mac Lab read-only and verify hash/fidelity/replay. Save V12 and gate decision; commit `feat: run controller-backed BV01 through native simulation`.
