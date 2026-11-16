# Task brief L05

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

## Task L05 — Target dossier và conformance chuẩn bị physical

**Dependency:** L00; làm được trước Linux. Target undecided là trạng thái hợp lệ của dossier, nhưng luôn không đủ cho live admission.

**Files:** Create `source/packages/contracts/schemas/physical-target-dossier-v1.schema.json`, `source/packages/lab-runtime/src/commissioning/target-dossier.ts`, `source/docs/operations/physical-target-selection.md`, `source/docs/operations/arm-commissioning-preparation.md`; modify `source/docs/operations/robot-commissioning.md` chỉ để link nhánh arm khi triển khai. Test `source/tests/unit/physical-target-dossier.test.ts`, `source/tests/security/physical-target-admission.test.ts`.

**Interfaces:** `assessTargetDossier(value)` trả `{structurallyValid,readiness:'prepared'|'incomplete',missing,branchRequirements}`. Dossier không tự phát hành commissioning manifest và không cấp `live:true`. `targetKind:'undecided'` chứa prerequisites cả hai arm paths; chassis và arm dùng schema/profile đúng loại.

- [ ] Test undecided/unknown vendor/firmware/SDK/serial luôn bị hardware admission từ chối; thiếu measured calibration/observer/signature cũng không được nâng cấp. Test signed simulation record không trở thành hardware_validated.
- [ ] Tạo template không có register/pinout/speed/force “mặc định chạy được”; mỗi field cần nguồn vendor/measurement/owner. Mô tả cách chọn xArm hoặc custom/PUMA theo host/controller/tool/safety/latency/maintenance, chưa gán người dùng một lựa chọn.
- [ ] Viết conformance checklist adapter: command IDs/idempotency, owner lease, boot/control epoch, deadline, freshness, disconnect→unknown, local stop, manual recovery. Doubles chỉ kiểm contract, không qualification robot.
- [ ] Tái dùng validator/chữ ký commissioning chassis hiện có đúng scope. Thêm arm dossier validator riêng; test keys không dùng để ký live manifest. Giữ `active-motion` refusal khi vendor interface chưa có.
- [ ] Runbook calibration dùng dữ liệu đo thật và protocol hiện có; tune/validation tách, ít nhất 3 validation trials độc lập mỗi điều kiện, units/frame/time/model revision đầy đủ. Limits vận hành chờ hardware/vendor/operator xác lập trước motion.
- [ ] Chốt đường triển khai physical qua source/coordinator → robotics agent/cell gateway → vendor/controller; Lab không có credential/route hoặc backend toggle đi hardware. Ghi cần task driver riêng sau hardware selection.
- [ ] Run focused schema/admission tests, đọc lại dossier từ góc người nhận; commit `docs: prepare both physical arm commissioning paths` cùng schema/validator nếu đã implement, re-pin phần schema cần thiết.

```ts
const result = assessTargetDossier(undecidedDossierFixture());
expect(result.structurallyValid).toBe(true);
expect(result.readiness).toBe('incomplete');
expect(result.branchRequirements.map(x => x.branch)).toEqual(['xarm_ros2','custom_linuxcnc']);
```

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/physical-target-dossier.test.ts tests/security/physical-target-admission.test.ts
pnpm contracts:check
```

**Exit:** PHYS-PREP-01 đạt, thiếu gì để chọn và chạy robot rõ ràng. G-HW/calibration/venue acceptance còn nguyên trạng thái cho tới evidence thật.


## Existing physical boundary preflight
- packages/lab-runtime/src/commissioning does not yet exist. Existing commissioned chassis verification is Python tests/hardware/commissioning.py and hardware profile schemas; it verifies ES256/JCS record signatures and validation rank. Do not duplicate it into a weaker TypeScript hardware admission path. Dossier assesses prerequisites, not approval.
- Robot SDK/VDA adapters reject hardware_validated/venue_approved without earned commissioning; preserve those existing boundaries and active-motion refusal. New arm dossier can list missing owner/vendor/measurement/signature refs without manufacturing operational defaults.
