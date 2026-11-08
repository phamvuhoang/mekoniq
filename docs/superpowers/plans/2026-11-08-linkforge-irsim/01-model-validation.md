# Model và LinkForge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo physical contracts/projections và shadow validation không mất dữ liệu, có fixtures dùng cho 2D.

**Architecture:** Mở rộng canonical engineering theo opt-in; stateless Python validator đọc artifact đã hash và báo parity. Legacy URDF/SDF vẫn do compiler cũ sinh.

**Tech Stack:** TypeScript, JSON Schema/Ajv, Python3.11/linkforge-core1.6.0, Vitest/pytest.

**Spec:** [README](../../specs/2026-11-08-linkforge-irsim/README.md), [contracts](../../specs/2026-11-08-linkforge-irsim/contracts.md), [LinkForge pipeline](../../specs/2026-11-08-linkforge-irsim/workers-runtime.md).

## Global Constraints

Áp dụng nguyên văn toàn bộ [Global Constraints của plan tổng](README.md#global-constraints). Đặc biệt: candidate pins `linkforge-core==1.6.0`, `ir-sim==2.12.0`; Node24.22.2/pnpm10.32.1; không sửa trial/web, mock acceptance hoặc native gates. Paths trong task tính từ workspace.

---

## A00 — Chụp baseline, khóa môi trường và xác nhận APIs

**Files:** Create `source/docs/implementation/evidence/linkforge-irsim/baseline-01/{inventory,toolchains}.json`; create `source/robotics/{model-validation,navigation-2d}/pyproject.toml` và `requirements.lock`; create `source/scripts/bootstrap-portable-simulation.mjs`. Read research probe results, existing simulation requirements và Lab runtime lock. Không đổi native requirements.

**Interfaces:** Consumes source/Lab commits, scenario/backend inventories, Python path. Produces two interpreter paths `.venv-linkforge/bin/python`, `.venv-irsim/bin/python`, hash-locked requirements và `portable-worker-lock/1` metadata `{pythonVersion,platform,packages:[{name,version}],requirementsSha256}`.

- [ ] **Inventory trước mutation.** Chạy trong từng repo: `git status --short --branch`, `git rev-parse HEAD`; ghi pin Lab, schema/artifact hashes, scenario IDs, APIs, profile sets, external gate statuses và NR01–NR12. Đối chiếu nhánh feat bằng code inventory, không dùng ancestry như bằng chứng duy nhất. Dùng baseline research làm locator, không chép kết quả cũ thành test mới.
- [ ] **Chạy baseline đúng toolchain.** Source `pnpm contracts:check`, selected baseline command ở research; Lab `pnpm check:source`, `pnpm test`, `pnpm typecheck`. Ghi exit/pass/fail/skip. Node shell không phải24 thì dùng PATH tới bản24 đã có; không đổi global node. Native/hardware không chạy ghi not_run.
- [ ] **Provision tường minh, không runtime install.** Bootstrap dùng `execFile` và `python3.11 -m venv`, `python -m pip install --require-hashes -r requirements.lock`. Sinh lock bằng resolver có hashes, bao gồm core/IR-SIM và dependencies test/schema cần thiết. Python roots không nằm trong Git. Resolve LF với PyYAML>=6.0.3, không reuse lock6.0.2 của native. Không cài extras `all`/`keyboard`.
- [ ] **Reproduce API hazards trong test research.** Tạo `source/robotics/model-validation/tests/test_upstream_contract.py`: valid, missing joint, slash IDs, negative inertia, parser loss/repair. Negative test phải ghi observed behavior rồi kỳ vọng wrapper A02 chặn. IR-SIM smoke tạo2robots/yaw/polygon/offset/step/get_msg. API thiếu → stop phụ thuộc package đó với `BACKEND_INCOMPATIBLE`, không đổi version ngầm.
- [ ] **Chạy và lưu receipts.** `source/.venv-linkforge/bin/python -m pytest source/robotics/model-validation/tests/test_upstream_contract.py -q` từ workspace. Upstream behavior expected test pass không nghĩa integrated validation pass. Lưu environment/lock/artifact hashes. Commit riêng `chore: pin portable simulation worker prerequisites` sau khi các checks cần thiết pass.

**Acceptance:** Hai venv độc lập trên Mac; source/native locks không đổi; toolchains và blockers được chụp. Không G-LF/G-IR nào được đánh accepted tại đây.

## A01 — Contracts, per-entity drive và physical projection

**Files:** Create sáu schemas mới liệt kê trong plan tổng; modify `source/packages/contracts/schemas/{engineering-component,engineering-project,engineering-bundle}.schema.json`; modify `source/scripts/generate-contracts.mjs`; create generated `navigation2d.ts`; create `source/packages/lab-runtime/src/engineering/physical-model.ts`, `source/packages/lab-runtime/src/v2/navigation2d/contracts.ts`; modify `engineering/assembly.ts` và `engineering/contracts.ts`. Tests **new** `source/tests/contracts/navigation2d-contracts.test.ts`, `source/tests/unit/physical-model.test.ts`, `source/tests/unit/engineering-multi-drive.test.ts`.

**Interfaces:** Consumes existing EngineeringProject/ResolvedAssembly + source schema hash. Produces:

```ts
function projectPhysicalModel(
  input: EngineeringCompileInput, robotId: string, sourceSchemaHash: string
): RobotPhysicalModelV1;
function validateNavigationDocument(input: unknown):
  {ok:true;value:NavigationModel2DV1|NavigationSceneV1|ModelValidationReportV1}|
  {ok:false;issues:{path:string;code:string;message:string}[]};
```

Giữ `resolveAssembly` signature hiện có; thêm option `driveBindingsVersion?:1` chỉ cho profile mới. Type definitions từ [contracts spec](../../specs/2026-11-08-linkforge-irsim/contracts.md), không định nghĩa thêm JSON shape cạnh generated types.

- [ ] **Viết contract tests có input đối kháng.** Cases units/quaternion/non-finite, reversed inertia order, absent provenance, unknown fields/sensor type, map mismatch, duplicate robot ID, new profile on old feature flag. Invalid schema mới phải fail trước mutation; legacy fixtures vẫn validate.
- [ ] **Viết multi-drive regression trước code.** Dựng hai AMR từ `tests/support/engineering.ts`, namespace instances khác nhau, radius0.075/0.10, separation0.36/0.42. Assert map đúng robot, singleton null khi2; one-AMR legacy digest giữ nguyên bằng fixture frozen đã chụp A00.

```ts
expect(resolved.models.drive).toBeNull();
expect(resolved.models.drivesByEntity!['amr-1']!.leftJointId).toBe('r1-wheel-left/axle');
expect(resolved.models.drivesByEntity!['amr-2']!.model.parameters.drive).not.toEqual(
  resolved.models.drivesByEntity!['amr-1']!.model.parameters.drive
);
```

- [ ] **Chạy red.** Từ source: `pnpm exec vitest run tests/contracts/navigation2d-contracts.test.ts tests/unit/physical-model.test.ts tests/unit/engineering-multi-drive.test.ts`; expected thiếu schema/function/map assertions, không chấp nhận red do import sai unrelated.
- [ ] **Implement schemas/projection.** Preserve SourceRef và inertia ordering; per-entity link/joint closure; drive midpoint/frame; reject mixed ownership/sensor overwrite. Schema mới map optional extension, profile enum thêm `engineering-irsim-2d-v1`; native consumers không nhận multi-drive vô tình. Generator output mới có import tới engineering types; không redeclare Link/Joint.
- [ ] **Green + backward check.** `pnpm contracts:generate`, `pnpm contracts:check`, chạy ba tests mới và `tests/contracts/engineering-contracts.test.ts tests/unit/engineering-assembly.test.ts tests/unit/engineering-compile-fixtures.test.ts`; `pnpm typecheck`. Commit `feat: define portable robot and navigation contracts`.

**Acceptance:** LFIR-02/03/13 shapes rõ; old valid projects không thay canonical hash; unknown inertia không trở thành resolved runnable. New documents chưa có run implementation vẫn không advertised available.

## A02 — LinkForge worker, loss guards và validation API

**Files:** Create `source/robotics/model-validation/linkforge_worker/{__init__,__main__,adapter,names,parity}.py`, `tests/{test_validation,test_parity,test_names}.py`; create `source/packages/lab-runtime/src/engineering/{linkforge,validation-store}.ts`; modify `engineering/runtime-options.ts`, `v2/gateway.ts`; tests **new** `source/tests/integration/linkforge-validation.test.ts`, `source/tests/security/linkforge-artifacts.test.ts`. Read existing bundle-store/gateway/security tests trước thay đổi.

**Interfaces:**

```ts
interface RobotModelValidator {
  validate(input:{model:RobotPhysicalModelV1;urdf:ArtifactRef;bundleRoot:string}):
    Promise<ModelValidationReportV1>;
}
function createLinkForgeValidator(options:{python:string;workerRoot:string;
  timeoutMs:number;lockDigest:string}): RobotModelValidator;
```

Python `validate_request(request:dict)->dict` nhận validated internal request; `make_name_map(ids_by_kind:dict)->dict`; `compare_model(raw_description:dict, parsed_model)->list[dict]`. Đây là adapter-only code, không export thành public runtime arbitrary path API.

- [ ] **Negative tests trước implementation.** Tối thiểu LF01–LF06. Kiểm `ixx=-1` không pass dù parser cho valid; tên `/` được map và restore; parser drop một link có cùng số links cuối cũng bị set/graph parity phát hiện; missing sensor frame bị source check. Test duration/cleanup ở subprocess thật.

```python
assert report['result'] == 'fail'
assert {'INERTIA_INVALID', 'LF_IMPORT_MUTATION'} & {
    issue['code'] for issue in report['issues']
}
assert report['physicalModelDigest'] == request['model']['modelDigest']
```

- [ ] **Red run.** Từ source: `.venv-linkforge/bin/python -m pytest robotics/model-validation/tests -q`; `pnpm exec vitest run tests/integration/linkforge-validation.test.ts tests/security/linkforge-artifacts.test.ts`.
- [ ] **Implement pipeline đúng thứ tự spec.** Raw checks→name map→import→parity→validator→reference export→immutable report. Return errors có original IDs, preserve source/upstream attribution. Path/mesh sandbox chỉ bundle closure; XML size2MiB, reject DTD/entity/XACRO trước parser; không shell. Đừng dùng stdout warnings làm NDJSON response.
- [ ] **Wire authenticated API/cache.** POST validate chỉ nhận engineeringRef/robotId, verify ownership/closure; GET report theo grant. Persist ngoài bundle; cache theo full identity/pins. Flag off/missing worker→not_run; subprocess failure→failed; existing compile không bị phụ thuộc LF.
- [ ] **Green + regression.** Chạy Python/TS tests trên, thêm `tests/integration/engineering-gateway.test.ts tests/security/engineering-bundle.test.ts`. Check valid original URDF vẫn byte-identical trong bundle sau validate. Commit `feat: add loss-aware LinkForge shadow validation`.

**Acceptance:** G-LF1/2 chỉ tested với fixture đủ ở A03; upstream false-success hazards không tạo model pass. Model-validation không cần persistent service hay frontend.

## A03 — Serve fixture và nhà hàng có geometry thực

**Files:** Create `source/tests/fixtures/navigation2d/{serve-project,serve-components,serve-sensor-model,restaurant-10-tables,navigation-policy}.json`; create `source/tests/support/navigation2d.ts`; create `source/tests/unit/navigation2d-fixtures.test.ts`. Đưa fixture demo được review vào **new** `source/robotics/navigation-2d/fixtures/serve-demo-v1/` qua script export có hash; không sửa SKU vendor thành thông số đo giả.

**Interfaces:** `navigationFixture(name:'serve'|'wide'|'overhang'|'two-robot'|'enclosed-goal'): {input:EngineeringCompileInput;policy:NavigationPolicyV1}`. `NavigationPolicyV1` là schema policy trong navigation-scene, đúng values/spec. Fixture loader resolves components/models bằng source resolver, không dựng ResolvedAssembly thủ công rồi bypass checks.

- [ ] **Viết analytic fixture tests.** Đếm3khay,2support nghiêng,2bánh,1LiDAR; transform root/drive đúng; immutable source metadata; mỗi table có obstacle và handoff ở ngoài shape. Assert không có measured source trong dữ liệu minh họa.
- [ ] **Chạy red.** `pnpm exec vitest run tests/unit/navigation2d-fixtures.test.ts` tại source.
- [ ] **Tạo geometry/provenance.** Base 0.60×0.54m, variant0.58m; wheel radius0.09m/separation0.36m là fixture với mounts đúng. Ba khay và support có collision riêng; variant overhang có bề rộng0.65m. Tất cả mass/inertia từ box/cylinder formulas với source derived→assumed inputs, kiểm SPD và placement không penetration ngoài mounts. LiDAR range0.05–10m, horizontal FOV2π,360beams,10Hz, latency/dropout0, noise none; không gọi đó là thông số RPLIDAR đã khóa.
- [ ] **Đặt world/targets explicit.** World20×12m, 10 rectangle table obstacles, kitchen/pass/parking/handoff IDs ổn định. Cấu hình two-robot namespace instances độc lập và drive values khác nhau; enclosed goal phải nằm trong free pocket để test no-path, không admission target collision.
- [ ] **Green + cross-projection smoke.** Chạy fixture tests, A01 tests và A02 valid Serve report thật. Record geometry/model digest và LF issues, chưa đánh integrated gates. Commit `test: add traceable Serve and restaurant fixtures`.

**Acceptance:** B01 có input đủ để biên dịch; không cần hỏi/chốt linh kiện thương mại hoặc mượn hình renderer làm physical truth. Các giá trị giả định hiển thị rõ trong report và UI sau này.
