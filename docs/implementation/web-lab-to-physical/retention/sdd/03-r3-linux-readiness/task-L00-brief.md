# Task brief L00

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/03-r3-linux-readiness.md

## Global Constraints

- Chỉ bắt đầu implementation phụ thuộc R2a sau B00; không sửa spec/plan/code R2a trong lần soạn tài liệu này.
- Node 24.22.2; pnpm 10.32.1; portable workers Python 3.11; `PYTHONDONTWRITEBYTECODE=1` khi chạy pytest. Python ROS dùng bản của profile distro, không ép rclpy vào venv portable.
- Nền vật lý là engine pin của R2a đã bàn giao; snapshot nghiên cứu là `mujoco==3.17.0`. Không tự nâng lock ở B02.
- Một logical tick 20 ms; 10 substeps × 2 ms là baseline MuJoCo; tốc độ UI chỉ thay pacing.
- Source là authority mission/journal/custody, Lab chỉ simulation/replay. Không thêm Lab→hardware route.
- Một active world MuJoCo/runtime; một ACK đang bay; lost ACK → unknown, không resend hoặc respawn tiếp tục cùng run.
- New fields optional/versioned; mock BV01 golden, IR-SIM chunks, Webots bytes, archive readers và R2a behaviors giữ theo baseline.
- Geometry/units SI và frame đúng contract; dynamics `not_calibrated`; vendor files có commit/sha256/license/NOTICE.
- UI dùng `tr(vi,ja,en)`, giữ a11y/reduced-motion/2D/no-runtime path; không thêm framework/browser engine.
- Không sửa `trial/`, `web/`, cổng 1880/1884, runtime data hoặc evidence lịch sử để vượt gate.
- Mỗi mutation ở đúng repo; source runtime/schema/tool commit → export sạch → Lab re-pin commit. Không Git ở workspace root.
- Candidate tự động luôn `accepted:false`; human sidecar gắn hash/profile; skip là not_run.
- Task chuẩn bị không deploy, provision host trả phí, ký commissioning thật hoặc chạy robot. Các hành động đó cần đích/phạm vi người dùng giao khi thực thi.

## Execution context
All source/ and lab/ paths are relative to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/. Never edit original main checkouts. Read specs at /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical. User authorized implementation on new worktrees on 2026-11-14; original doc-only wording refers to authoring, not current authorization. No push/deploy/native hardware execution. Use Node 24.22.2 and PYTEST_ADDOPTS="-p no:cacheprovider" with PYTHONDONTWRITEBYTECODE=1 for workers.

## Task L00 — Handoff schema, validator và hồ sơ host

**Dependency:** B00; có thể làm trước B05–B10. Gói bàn giao R2b được tạo lại khi input/runtime thay đổi.

**Files:**

- Create `source/packages/contracts/schemas/native-handoff-v1.schema.json`.
- Create `source/packages/lab-runtime/src/v2/sil/native-handoff.ts`, `source/scripts/native-handoff.mjs`.
- Modify `source/scripts/native-sim/{host-preflight,profile-report}.mjs` để dùng inventory/identity checks chung, giữ API cũ.
- Create `source/docs/operations/native-simulation-handoff.md`, `source/tests/unit/native-handoff.test.ts`, `source/tests/security/native-handoff.test.ts`.

**Interfaces:** `validateNativeHandoff(root,manifest,inventory?)` trả `{prepared:boolean,nativeReady:boolean,issues:Issue[]}`; mỗi issue có code/path/severity. `nativeReady` chỉ là prerequisites cho chạy, chưa phải qualification. CLI mới `native-handoff.mjs export --input INPUT_DIR --out NEW_DIR` và `verify --input DIR [--inventory FILE]`; export chỉ copy các refs được schema cho phép, không chạy shell/launch từ manifest.

- [ ] Test gói hợp lệ chưa có host → `prepared:true,nativeReady:false`; thiếu hash/schema/frame/model → prepared false. Gói đã khai Linux native nhưng origin là Mac/emulated hoặc không biết origin → nativeReady false.
- [ ] Test symlink/path traversal/oversized archive/hash mismatch, lock unresolved và host arch khác. Test xArm inventory không đủ cho PUMA, arm64 không đủ cho amd64.
- [ ] Implement schema/validator/export. Manifest liệt kê source/Lab tuple, engine/tool hashes, project/world/model/profile refs, seeds, case policy, frames/units và required/forbidden packages; secrets/tunnel private key không đi vào gói.
- [ ] Chuẩn hóa host inventory: OS/kernel/ISA/CPU, platform image digest, virtualization/origin/emulation khai rõ, software hashes, clock domains. Không suy “Linux native thật” chỉ từ `process.platform` trong container.
- [ ] Viết runbook từng bước cho người nhận: verify → resolve host profile → doctor → smoke → cases → archive/verify → reviewer. Ghi kết quả dự kiến khi chưa có host là not_run/blocked_external.
- [ ] Run focused checks và contracts generation; commit `feat: prepare verifiable native simulation handoffs`; re-pin nếu runtime/schema đổi.

Test đầu tiên:

```ts
// fixture builders của test tạo file trong mkdtemp, không dùng native inventory giả làm evidence.
const result = await validateNativeHandoff(root,validManifest,undefined);
expect(result.prepared).toBe(true);
expect(result.nativeReady).toBe(false);
expect(result.issues.map(x => x.code)).toContain('HOST_INVENTORY_MISSING');
```

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/unit/native-sim-host-preflight.test.ts
pnpm contracts:generate
pnpm contracts:check
```

**Exit:** DEP-PREP-01 đạt; gói có thể mang sang host. Không đóng native gate.


## Existing API preflight
- scripts/native-sim/host-preflight.mjs is specifically read-only UTM/macOS provisioning feasibility; keep hostPreflight(vmRoot) and resourceDecision output/semantics. Do not turn its ready_to_provision into nativeReady. Add generic native inventory helper separately or opt-in without breaking existing macOS CLI/tests.
- profile-report.mjs validNativeProfileReport(v,id) currently validates strict native_apt Ubuntu24.04/Jazzy arm64. Preserve two-argument legacy behavior; any new amd64/xArm/CNC profile validation must use explicit locked profile expectations, not accept any Linux inventory. Update adjacent .d.mts declarations if exported APIs change.
- No native host supplied. Declared unresolved target-package versions are valid prepared inputs with missing prerequisites; nativeReady requires all required exact locks and matching actual inventory plus provenance. Unknown origin/emulation cannot qualify by process.platform=linux.

## New R2a cloud evidence (read-only controller refresh, 2026-11-14)
Original source/main11d25b47a18adafb88ac21adc249499109996bc5 now contains docs/implementation/evidence/cloud-run/mekoniq-2026-11-14 and production/r2a-2026-11-14. Runtime pin is still4f893ac6fb75dff414a3ee42a726defb7935c734; platform linux/amd64, deployed registry digestfbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009; local image config IDf650a2576cf7d44e8f9bf40934d862d8120170dd701e7da502a6ee032d12bd05 is a different identity. HTTP MJ-BV01 completedtick4800/served2, Chrome production completed4810/served2. Cloud guard supplement G-CLOUD1 tested, acceptedfalse; original record remainsblocked_external by historicaltable. Read these existing local records, no livecloud/secrets/actions. This narrows the former unknownamd64 gap for that case/pin, but is not the required10grasp/3seed/fault/inventory/performance L01campaign and not R2b/hardware qualification. Use actual R2a image identity as historical baseline; current B09/R2b image is a separate source pin. Do not rebuild HEAD and label it the exact handed R2a image. Existing Dockerfile pins a multiarch base index, not the target image platform manifest; require actual platform identity/resolution evidence and keep unresolved fields nativeReadyfalse. No host was assigned to this task to rerun qualification.

Historical baseline versus current probe tooling: use separate subject handoffs for the exact R2a runtime/image and the later R2b runtime/image; each retains its own source/Lab/schema/closure tuple. Current observer/probe tooling can have a different build commit, but record that separately from the software under test. Do not mix old image with newworker/profilefiles and call it the exact baseline, or broadly waive source identity checks to combine builds. A checker version is not a replacement for a target/runtime version.

## Controller ruling76 — unavailable Docker and deferred WEB05 execution
Ruling: B09's implementation may enter independent review and downstream portable preparation after its clean export/pin, while actual container WEB05 execution remains not_run/blocked_environment. Repeated Docker prerequisite observations produced no valid server metadata (two effective owned-child timeouts and an earlier root attempt requiring explicit owned-process cleanup); the final owned client60963 timed out15.013s and TERM-exited143 without daemon/container/volume changes. Do not reset unrelated Docker or repeat stalled attempts. Keep image identity null/unbuilt, distinct from clean runtime export artifact. Carry actual arm/mobile/cell image compile/readiness/run, competing named-volume containers, crash-release/committed chunks and finished replay into B10 final qualification; execute only when the Docker prerequisite is available, otherwise hand off the open gate explicitly. L00 must treat current R2b image origin as unresolved/nativeReadyfalse, separately from historical R2a images. Cost if wrong: container-only closure, permissions, filesystem or lifecycle defects may remain until execution; reviewed deployment code, portable-only compiler checks, actual Mac worker lifecycle and local process races reduce but do not replace that missing proof. This changes verification sequencing, not the acceptance threshold; no WEB05/native/TLS/cloud/hardware pass is inferred.

## Controller ruling78 — installation provenance
Ruling: L00 supports two explicit, discriminated installation provenance modes, OCI image and native_apt, selected by the locked subject profile rather than as a fallback for missing image evidence. OCI requires exact single-platform manifest/config bytes and platform identity; multiarch index/config ID alone is insufficient. native_apt requires its own exact distro/ISA/package/repository or archive provenance locks and matching actual inventory; unresolved locks/origin remain nativeReady:false. Existing MuJoCo R2a image campaign and current R2b image handoff remain OCI-bound: image:null/unbuilt cannot become ready by relabeling installation mode or borrowing ROS/CNC inventory. Preserve legacy two-argument native_apt validation unchanged. New mode support validates supplied consistency/prerequisites, not host authenticity, native execution, commissioning or acceptance. Reason: ROS and LinuxCNC host installations do not inherently have an OCI image, and the L00 contract must prepare both authorized branches without inventing one. Cost if wrong: a permissive mode switch could bypass required image provenance or mix incompatible package/host profiles; require focused mode/profile-confusion negatives, unresolved-lock refusal and unchanged current-R2b null-image regression before review.

## Controller ruling79 — static model compatibility
Ruling: complete L00 static compatibility with explicit supported document/profile kinds, reusing existing Lab-world/component and engineering-navigation/physical-model validators and adding a narrow adapter for the existing pinned PUMA model conventions when its refs can be bound cleanly. Do not leave the authorized custom/PUMA branch categorically unpreparable merely because its older DH/TCP JSON differs from ROS models; do not invent a generic translation or operational parameters. Validate actual document schemas/IDs/refs/frames/units and applicable joints/limits/inertia, with coherently resealed negative cases, rather than hash-only identity or labels. Unsupported combinations fail clearly. L03 still owns native expanded-URDF/controller/plugin/contact parity, and L04 owns actual controller/trace/ALG04; no static adapter claims that evidence. If PUMA binding requires undocumented semantics or substantive model translation, escalate the exact gap before inventing it. Reason: the L00 handoff must prepare both authorized branches using their real existing model data. Cost if wrong: extra multi-format admission complexity can falsely accept cross-model documents; closed discriminators, reused model conventions and independent static-compatibility review are required.

## Controller ruling80 — embedded shared-world provenance
Ruling: L00 may use an explicit bounded shared-world compatibility adapter rather than applying standalone navigation-scene input equality to the embedded adapted world. Existing generate-coffee-delivery-world-fixture.mjs copies the mobile physical/navigation baseline, changes the outer navigation world/project/pose/profile refs and seals the combined scene; current Source admission binds Lab project to outer scene.inputs.projectDigest. Preserve and validate original physical-model to navigation-model projection identity, and separately validate outer Lab project/world/frame/model bindings and the exact supported adaptation policy. Enumerate each intentional identity/field difference and reject all unsupported adaptations; no broad ignore mask, arbitrary input replacement, label-only approval or weakening of standalone validators. Existing fixture/evidence bytes remain unchanged. Require coherent resealed negative tests for altered source-model inputs, outer project/world identity and geometry/frames, and record the exact producer/adaptation evidence in the report. Reason: the existing reviewed shared-world format deliberately reuses baseline model provenance; generic standalone equality would reject the current valid format without testing its actual boundaries. Cost if wrong: an overly broad adapter could accept a different world or model under a valid hash; explicit reconstruction/binding, closed adaptation scope and independent review are mandatory. No native/physics rerun is implied by this new pure handoff consumer alone.

## Controller ruling81 — exact R2a arm-only adapter ownership
Ruling: assign the historical R2a arm-only static handoff adapter to L01's exact-R2a-image probe task, while L00 closes preparation only for its explicitly supported current shared-world/cell, canonical ROS AMR/xArm and pinned PUMA kinds. L00 must document arm-only as unsupported, never force it through newer world files; L01 must implement/review the old shape and frozen-model/ref bindings before its probe can admit that subject. The actual old runtime55dd3585... is retained and hash-verified at original Lab cache with Source4f893ac; use read-only verified copies and frozen Git objects, not a HEAD rebuild or mutation of original main/cache. Its existence is not image manifest/config, complete closure or native-execution proof. Reason: arm-only baseline adapter and old-image probe share exact historical semantics; keeping them in L01 avoids expanding L00 into probe-specific reconstruction while retaining an explicit viable dependency. Cost if wrong: L01 gains an additive schema/validator integration step and must preserve/retest all current static admission boundaries; neither task may claim arm-only preparation or DEP-MJ-01 until that adapter and required evidence exist.
