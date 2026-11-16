# Task brief B01

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/01-r2b-mobility.md

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

## Task B01 — Contracts, fixture payload và dock feasibility

**Files:**

- Create `source/packages/contracts/schemas/load-profile-v1.schema.json`, `physics-evidence-v1.schema.json`.
- Modify `source/packages/contracts/schemas/navigation-scene-v1.schema.json`, `sim3d-worker-v1.schema.json`, `source/scripts/generate-contracts.mjs`.
- Create `source/robotics/simulation-mujoco/fixtures/serve-payload-v1/` chứa project, load profiles, drive-contact profile, NOTICE và README provenance.
- Create `source/packages/lab-runtime/src/v2/simulation3d/load-profile.ts`, `source/scripts/generate-payload-fixture.mjs`.
- Test `source/tests/contracts/mujoco-payload.test.ts`, `source/tests/unit/payload-fixture.test.ts`.

**Interfaces:** consumes physical projection/Serve components và R2a cup dimensions; produces `LoadProfileV1`, `PhysicsTickRecord` theo contracts, `validateLoadProfile(value:unknown):{ok:boolean;reasonCodes:string[]}`; generator export `generatePayloadFixture(outDir:string):Promise<void>`.

- [ ] Viết negative schema test: mass≤0, inertia sai, quaternion không chuẩn hóa, duplicate prop, offset ngoài support, path escape, 9 props và unknown field đều bị từ chối. Dùng file `cup-center.json` từ fixture như positive.
- [ ] Chạy test để thấy validator/fixture chưa có.
- [ ] Sinh fixture từ Serve canonical components; tạo empty/center/offset đúng spec. Drive profile có `velocityGainNmsPerRad`, `brakeTorqueNm`, drive curve và sources; giá trị bắt đầu của gain/brake là assumptions explicit, B02 đo và khóa trước campaign.
- [ ] Mở engine branch MuJoCo và optional `snapshot.physics`; giữ các message/scene cũ hợp lệ. Quaternion norm/support fit kiểm ở semantic validator, không chỉ JSON number type.
- [ ] Tính khả thi dock xArm: đọc cell-layout R2a và geometry tray; lưu reachable/không reachable, khoảng cách/IK residual, proposed fixture diff. Kết quả chưa đạt không chặn AMR-only nhưng chặn cell.
- [ ] Chạy generate 2 lần vào thư mục tạm, byte-compare; generate contracts và focused checks; commit `feat: define payload profiles and MuJoCo mobility evidence`; re-pin Lab.

Test chính cần có nội dung tương đương:

```ts
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';
import {validateLoadProfile} from '../../packages/lab-runtime/src/v2/simulation3d/load-profile';
test('a free payload cannot have non-positive mass', () => {
  const value = JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/serve-payload-v1/cup-center.json','utf8'));
  value.props[0].massKg = 0;
  expect(validateLoadProfile(value)).toEqual({ok:false,reasonCodes:['LOAD_MASS_INVALID']});
});
```

Schema chốt `props[].massKg` là SI number; provenance ở `props[].sources.mass`. Không dùng shape khác trong generator và validator.

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/contracts/mujoco-payload.test.ts tests/unit/payload-fixture.test.ts
pnpm contracts:generate
pnpm contracts:check
```


## Verified implementation context
- B00 starts from source 086121c / Lab 8c5db25, whose recorded R2a runtime is bb16724. Do not change old qualification artifacts.
- Real dependency environments are installed in THIS source worktree: .venv-mujoco, .venv-irsim, .venv-webots, .venv-linkforge, .venv-algorithm. No main venv symlink.
- Canonical Serve 3D fixture generation is scripts/export-sim3d-fixtures.ts using tests/support/navigation2d.ts; the guessed generate-serve-3d-fixture.mjs does not exist. Read committed physical-model-amr-1.json, project/components, world3d and navigation-scene in robotics/simulation-3d/fixtures/serve-3d-v1. Keep existing fixture bytes intact.
- SourceRef lives in engineering-component schema/generated engineering: kind, documentId, revision, locator, contentSha256, optional uncertaintyAbs. New profile sources should reuse this contract.
- xArm cell-layout.json cup radius 0.04 m / height 0.1 m / empty 0.02 kg + drink 0.3 kg; frame arm_base. Do not confuse the fixed R2a tray with AMR tray.
- Compiler/readiness runtime enablement comes in B02: B01 defines validated schemas/fixtures but must not advertise a working mobile provider.
- Freeze interface details in your report for the next task. Schema-derived TS types must remain generated, not hand-edited.
- Required review follows your report. Do not spawn subagents. Commit your source changes; controller handles ordered export/import/Lab pin after clean review, so do not mutate Lab during source implementation.
