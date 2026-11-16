# R2b Mobility and Payload — Implementation Plan

**Hiện trạng sau N1, 16/11:** [kết quả mới](../../post-n1-final-recording/status.md), [tái hiện](../../post-n1-final-recording/reproduce.md) và [disposition](../../post-n1-final-recording/dispositions.md) dùng Source `0d46403` / Lab `7c97b20`. Review giữ verdict lịch sử ở tuple/scope đã nêu; capture mới và bốn assertions mock chưa giải quyết, native/physical chưa nghiệm thu. Các snapshot/kế hoạch cũ bên dưới giữ ngày và identity riêng.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một AMR MuJoCo mang payload có tiếp xúc, chạy source mission và hiển thị/report bằng dữ liệu thực từ plant.

**Architecture:** Mở compiler mobile/worker mode trong tool root MuJoCo R2a; thêm PlantPort vào runner navigation hiện có; durable physics recorder độc lập với SSE.

**Tech Stack:** Toolchain/pin theo [Global Constraints](README.md#global-constraints).

**Spec:** [R2b §2–5](../02-r2b-web-lab-spec.md), [contracts §1–5/7/9](../03-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Một AMR; free payload; no hardware; không đổi R2a engine pin; không nâng số samples giả thành evidence.

## Task B00 — Khóa baseline sau R2a

**Files:** Create `source/docs/implementation/post-r2a-baseline.md` khi R2a đã bàn giao; không sửa candidate R2a. Read `source/scripts/record-sim-extension.mjs`, `lab/config/source-runtime.lock.json`, R2a candidate và các acceptance sidecar.

**Interfaces:** consumes release tuple R2a; produces baseline gồm source/Lab/pin/schema/closure/engine/fixture/golden digests, gate status và open limitations. Không có runtime API mới.

- [ ] Chụp trạng thái và HEAD từng repo; ghi actual tuple, không copy `5e3029e` từ tài liệu nghiên cứu.
- [ ] Đọc qualification cuối và guard bằng command hiện có; kiểm pin Lab cùng source và record source/Lab đúng tuple. Thiếu R2a candidate: giữ trạng thái chưa bàn giao, chỉ làm tài liệu độc lập.
- [ ] Đọc golden tests hiện có và ghi tên/hashes; không tạo golden từ output sau refactor.
- [ ] Ghi những khác biệt mới với research snapshot, đặc biệt schema, clock/substeps, slip, image và arm ports.
- [ ] Commit riêng tài liệu baseline sau khi R2a không còn đang record. Không tự đưa candidate nghiên cứu thành accepted.

```sh
git -C source status --short
git -C lab status --short
git -C source rev-parse HEAD
git -C lab rev-parse HEAD
# Cwd source; LAB_SIMEXT_EVIDENCE_DIR do người thực thi đặt vào candidate R2a thực vừa đọc.
perl -e 'alarm 180; exec @ARGV' pnpm test:acceptance -- sim-extension
```

**Exit:** baseline review được; các gate thiếu phân rõ task nào bị chặn. R2a hoàn thành từng phần không đủ mở B05/B06 nếu arm chưa tested.

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

## Task B02 — Compiler/worker mobile và provider thật

**Files:**

- Create `source/robotics/simulation-mujoco/mujoco_worker/compile_mobile.py`, `mobile_engine.py`, `drive.py`.
- Modify `source/robotics/simulation-mujoco/mujoco_worker/{session,snapshot}.py`; giữ arm compiler path và behavior.
- Create `source/packages/lab-runtime/src/v2/simulation3d/mujoco-mobile.ts` và `source/packages/lab-runtime/src/engineering/mujoco-compiler.ts`.
- Modify `source/packages/lab-runtime/src/v2/{capabilities,scenario-registry,scenario-matrix}.ts`, `v2/navigation2d/{readiness,runner}.ts`, engineering compiler registry và CLI option wiring.
- Test `source/robotics/simulation-mujoco/tests/test_mobile.py`, `source/tests/integration/mujoco-mobile-worker.test.ts`, `mujoco-mobile-readiness.test.ts`, `source/tests/unit/mujoco-drive.test.ts`.

**Interfaces:** `compile_mobile(scene, physical_models, load_profile, physics) -> (mjcf,names)`; `wheel_targets(v_mps,omega_radps,radius_m,separation_m)->(left,right)`; `mujocoMobilePlant(runtime):PlantPort`; `MJ-FD01` dựa FD01, chỉ set `engineering-mujoco-3d-v1`.

- [ ] Viết tests wheel sign/frame, readback parity, fixed-step ACK/idempotency, bad-state warning và unsupported model. Chạy fail trước.
- [ ] Dựng chassis freejoint, wheel hinge, caster và props đúng projection; đọc MjModel actual để so geometry/axes/mass/inertia. Thiếu caster từ chối; không ràng buộc pitch hoặc reset chassis pose.
- [ ] Bọc wheel actuator velocity hữu hạn lực; mỗi 2 ms cập nhật force range theo actual wheel velocity và profile. Motoring cap nội suy drive curve; braking dùng `brakeTorqueNm` riêng đã khai, không suy torque braking từ đường cong motoring tại tốc độ cao. Ghi target/actual torque/saturation.
- [ ] Probe 10 s hold, straight/circle/stop ba loads, 3 repeats; ghi gain/brake/solver/timestep/gaps và p95 vào `source/docs/research/2026-11-mujoco-mobility-spike.md`. Chỉ khóa profile khi finite state, parity và repeat trong ngưỡng; trượt giữ nguyên artifact và dừng B03 campaign.
- [ ] Worker đọc đúng scene loại mobile hoặc arm; schema validate trước mutation. Một bước sai target tick/prop ID không tiến world. Mobile snapshot có robots, wheel odom, props, physics; arm path cũ còn byte/behavior regression.
- [ ] Readiness describe+create thật theo scene/profile; đăng ký provider/CLI/export; chuyển MuJoCo slot thành slot engine chung cho ba composition, có test arm đang giữ slot thì mobile bị từ chối.
- [ ] Runner mobile dùng stop policy theo profile; hằng tilt Webots vẫn nguyên. Thêm engine identity/seed/limitations đúng trong report, không còn nhãn planar-only cho dynamics.
- [ ] Focused engine tests và hồi quy R2a chạy xanh; commit `feat: run a payload AMR on the MuJoCo plant`; re-pin.

```python
from mujoco_worker.drive import wheel_targets
import pytest

def test_positive_yaw_turns_left_wheel_backwards():
    left, right = wheel_targets(0.0, 1.0, 0.09, 0.36)
    assert left == pytest.approx(-2.0)
    assert right == pytest.approx(2.0)
```

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests -q
perl -e 'alarm 600; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-readiness.test.ts tests/integration/mujoco-arm-worker.test.ts tests/integration/mujoco-arm-bv01.test.ts
```

**Exit:** AMR dùng engine thật, không mock fallback; R2a arm-only vẫn chạy. Không coi compile success là G-MJ1.

## Task B03 — Physics recorder, metric độc lập và fail-closed reader

**Files:**

- Create `source/packages/lab-runtime/src/v2/simulation3d/{physics-evidence,physics-metrics}.ts`.
- Modify `source/packages/lab-runtime/src/v2/navigation2d/runner.ts`, `v2/report.ts`, worker `mobile_engine.py`/`snapshot.py` và validators.
- Test `source/tests/unit/physics-metrics.test.ts`, `source/tests/integration/physics-evidence.test.ts`, `source/robotics/simulation-mujoco/tests/test_contact_metrics.py`.

**Interfaces:** consumes `PhysicsTickRecord`; produces `openPhysicsRecorder(options)`, `readPhysicsEvidence(root,manifest)`, `loadDisplacementM`/`integrateNormalImpulse` như spec. Recorder có `append(record)`, `flush()`, `finish(reason)`; options chứa directory/identity/maxBytes/maxTicks/chunkTicks; reader trả `{complete,records,gaps,issues}`. `append` sau tick duplicate/gap phải từ chối hoặc ghi gap explicit, không đảo thứ tự.

- [ ] Test impulse, tray-relative slip, missing series và support change; đọc lại có thiếu/corrupt/hash/path escape/decompression bomb/quota và kill giữa chunk/manifest phải incomplete.
- [ ] Test contact lực/map frame bằng hộp đứng trên sàn, contact thoáng qua ở substep giữa vẫn xuất hiện; actual engine kiểm impulse tích phân đúng mẫu.
- [ ] Implement physics writer/reader bounded; tái dùng helper compression/hash/confinement hiện có, không đổi format navigation cũ. Sidecar publish atomic; crash không làm `complete:true`.
- [ ] Gắn append sau ACK và trước logical commit cho mobile; append lỗi terminal suspend, không retry tick. Report metrics chỉ từ artifact reader đã validate.
- [ ] Negative test thiếu contact samples nhưng telemetry còn mượt phải báo coverage fail. Report không có physics vẫn import được.
- [ ] Focused tests; commit `feat: record and verify payload physics traces`; re-pin.

```ts
import {expect, test} from 'vitest';
import {integrateNormalImpulse} from '../../packages/lab-runtime/src/v2/simulation3d/physics-metrics';
test('integrates every substep instead of using the last force', () => {
  expect(integrateNormalImpulse([0,10,20,0],0.002)).toBeCloseTo(0.06,12);
  expect(() => integrateNormalImpulse([Number.NaN],0.002)).toThrow('CONTACT_FORCE_INVALID');
});
```

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/physics-metrics.test.ts tests/integration/physics-evidence.test.ts
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 180; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_contact_metrics.py -q
```

## Task B04 — Vertical slice tải trên Lab và campaign đầu tiên

**Files:**

- Create `source/robotics/simulation-mujoco/campaigns/payload-v1.json`, `source/scripts/lab-mujoco.mjs`, `source/packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts`.
- Create `lab/src/twin/payload.ts`, `lab/src/reports/physics.ts`; modify `lab/src/{scenarios/catalog,scenarios/support,twin/model,viewer/twin3d,ui/report-panel}.ts`, launcher/export wiring sau pin.
- Test `source/tests/integration/mujoco-payload-campaign.test.ts`, `lab/tests/unit/payload-view.test.ts`, `lab/tests/e2e/mujoco-payload.spec.ts`.

**Interfaces:** campaign command mới `node scripts/lab-mujoco.mjs run --campaign payload-v1 --out DIR`, `verify --input DIR`; `payload-campaign.ts` export `verifyPayloadCampaign(root:string):Promise<PayloadCampaignVerdict>` với `{expectedRuns:number,completedCases:number,missingArtifacts:string[],faultCases:{id:string,detected:boolean,falseServed:boolean}[],issues:string[]}`. CLI verify và test dùng cùng hàm đọc này. Renderer đọc `LoadObservation`/actual AMR, không tính physics. Preset ID `mujoco-payload`, default center load và 1×.

- [ ] Viết browser test preset → run → cốc chuyển động theo plant → dừng → report → replay. Dùng fixtures có tray quay để bắt lỗi gắn cốc vào world hay chassis bằng animation.
- [ ] Implement selector/capability/readiness và timeline metrics đơn giản trong panel R2a; profile đổi tạo new run identity. Giữ mock/IR-SIM/Webots/R2a presets.
- [ ] Viết campaign 18 runs theo case matrix, mỗi run có artifact và source journal. Fixture fault là server-owned test case; không nhận runtime path/code từ browser.
- [ ] Recorder/verify từ chối missing run, skip không giải thích, wrong seed/profile, outcome không đúng expected fault. Dùng exit 0 cho all case assertions đúng, 1 cho fail, 2 cho prerequisite thiếu.
- [ ] Chạy browser spec bằng launcher cho provider mới, ba ngôn ngữ; chụp live và replay cùng tick/object. Ghi limitations not_calibrated/localization ground_truth.
- [ ] Commit source/campaign, re-pin, rồi Lab UI commit; tạo candidate incremental R2b.1 theo B10 khi muốn bàn giao sớm, không gắn nhãn full R2b.

Ví dụ harness assertion trong test campaign (harness API được tạo ở task này):

```ts
// verifyPayloadCampaign(root:string) đọc manifest/chunks, không khởi động engine.
const result = await verifyPayloadCampaign(recordedDirectory);
expect(result.expectedRuns).toBe(18);
expect(result.completedCases).toBe(18);
expect(result.missingArtifacts).toEqual([]);
expect(result.faultCases.every(c => c.detected && !c.falseServed)).toBe(true);
```

`recordedDirectory` là `mkdtemp` của integration test sau chạy fixture campaign; không trỏ historical evidence để kiểm code mới.

```sh
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-payload-campaign.test.ts
# Cwd lab; launcher MuJoCo hiện có được mở để chọn preset mobile tại task này.
perl -e 'alarm 600; exec @ARGV' pnpm test:mujoco-e2e -- mujoco-payload.spec.ts
```

**Exit:** một AMR có payload chạy thật trên Lab, report/replay tương ứng; lỗi vật lý quan sát được; full cell vẫn chưa tuyên bố có.
