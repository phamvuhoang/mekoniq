# 04 — Lab Integration & Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng dùng một thiết kế xuyên suốt Lab và nhận report có phạm vi kiểm chứng rõ, trên artifact/runtime đã pin.

**Architecture:** Lab đọc engineering contracts/scene do source xuất; project store có revision và immutable run snapshot. Evidence/calibration xử lý trong source, UI hiển thị capability và blocker.

**Tech Stack:** Node 24.22.2, pnpm 10.32.1, TypeScript/Vitest, Three.js, Playwright, Python/pytest, source runtime artifact, native profiles của B01.

**Spec:** [Spec chính](../../specs/2026-11-06-physical-robot-lab/README.md), [verification](../../specs/2026-11-06-physical-robot-lab/verification.md).

## Global Constraints

- Node 24.22.2; pnpm 10.32.1; dependencies khóa theo lockfile, không nâng major để hoàn thành task.
- Business authority/contracts/adapters ở `source/`; presentation/project UX ở `lab/`.
- Không sửa `trial/`, không chạm robot hoặc cổng `1880`/`1884`; UI/runtime loopback `4175`/`4176`.
- Mỗi run khóa mode, seed, backend versions, model/world/recipe/profile revisions và clock domains.
- UI Việt/Nhật/Anh; mọi nhãn kết quả phải nêu provenance và không nâng simulation thành hardware evidence.
- Native test thiếu môi trường ghi `not_run` với blocker; test đã chạy sai assertion ghi `fail`.
- Không export dirty source; không ghi secrets, VM disk, SSH private key hoặc signing key vào Git.
- Không xóa dữ liệu host để provision VM; storage và RAM preflight phải đạt trước khi tải image lớn.
- Engineering profile không tự fallback sang mock, legacy hoặc hardware khi thiếu capability.
- Giữ toàn bộ chức năng và dữ liệu hiện hữu theo NR01–NR12; giới hạn MVP engineering không áp dụng cho các profile cũ.

---

## File map

| Trạng thái | Paths | Trách nhiệm |
|---|---|---|
| new | `lab/src/project/{engineering-store,engineering-repository,engineering-archive}.ts`, `lab/src/project/migrations/v2-engineering.ts` | Active design/history, persistence/closure, atomic conversion |
| new | `lab/src/design/assembly.ts`, `lab/src/viewer/engineering-scene.ts` | Assembly editor/inspector và render compiled scene |
| new | `lab/src/design/engineering-estimates.ts`, `lab/src/deployment/engineering-bundle.ts` | Assembly→estimate inputs và candidate engineering; giữ calculators/export v1 |
| modify | `lab/src/{app.ts,ui/workspace.ts,project/schema.ts,project/store.ts,runtime/compatibility.ts,viewer/twin3d.ts}` | Project routing; giữ storage/validation v1/v2 và S01 qua runtime/client.ts |
| modify | `lab/src/scenarios/{controls,catalog,preflight,support}.ts` | Client Twin v2 thực: compile/readiness/create/lockedInput/reset/reclaim và profile requirements |
| modify | `lab/src/{reports/report-shape.ts,reports/replay.ts,reports/verification.ts,reports/evidence.ts,reports/compare.ts,twin/inspector.ts,i18n/index.ts}` | Saved evidence/capability/compare ba ngôn ngữ |
| new | `source/packages/lab-runtime/src/engineering/{evidence,calibration}.ts` | Assessment/report/calibration provenance |
| modify | `source/packages/lab-runtime/src/v2/{report.ts,reports/verification.ts,reports/simulation-evidence.ts}` | Optional engineering evidence extension |
| modify | `source/scripts/export-lab-runtime.mjs`, `lab/scripts/{runtime-artifact.mjs,build-offline.mjs}` | Schema/catalog/blob packaging |
| modify | `lab/config/source-runtime.lock.json`, `lab/scripts/record-regression.mjs`, `source/tests/acceptance/lab-v2-mock.acceptance.test.ts` | Clean pin và evidence root/campaign mới, không dùng manifest lịch sử để xét revision mới |
| modify | `lab/scripts/measure-twin-ui.mjs` | Adapt constructor/store vào benchmark, giữ workload và thresholds |
| new | `lab/docs/implementation/evidence/physical-robot-lab/README.md` | Evidence index sau khi thực thi, không tạo pass trước |

### D01 — Một project từ catalog đến compiled viewer

**Dependencies:** A04/B02 cho editor/persistence/fixture gateway; B03 cho live engineering admission. **Interfaces:** `EngineeringProjectStore` trong engineering-store.ts: `constructor(project: EngineeringProject)`, `getDraft(): EngineeringProject`, `replaceDraft(project: EngineeringProject): void`, `snapshot(): EngineeringProject`, `undo(): boolean`, `redo(): boolean`, `subscribe(listener: () => void): () => void`. Snapshot deep-cloned/frozen, revision tăng khi edit/undo/redo. New `renderEngineeringScene(scene: CompiledScene, state: PhysicsSample[]): THREE.Group`; CompiledScene lấy từ B02 exported schema, không suy primitives riêng.

`EngineeringProjectRepository` trong engineering-repository.ts: `constructor(databaseName?: string)`, `save(archive: EngineeringArchiveFiles): Promise<void>`, `load(id: string): Promise<EngineeringArchiveFiles | null>`, `loadActive(): Promise<EngineeringArchiveFiles | null>`, `importArchive(files: EngineeringArchiveFiles): Promise<EngineeringArchiveFiles>`, `exportArchive(id: string): Promise<EngineeringArchiveFiles>`, `migrateLegacy(original: LabProject | LabProjectV2): Promise<EngineeringArchiveFiles>`, `close(): Promise<void>`. Lab-only `EngineeringArchiveFiles = { manifest: EngineeringArchive; files: Record<string, Uint8Array> }` ở engineering-archive.ts; manifest dùng generated schema A01, files có normalized relative path khớp blob manifest. Lưu draft thiếu content được phép với missingDigests. Không đọc/xóa database legacy khi autosave engineering; pure conversion v1→v2 reuse migration hiện hữu, giữ original và missing-data report.

`buildEngineeringCandidate(project: EngineeringProject, receipt: BundleReceipt | null, reports: RunReport[]): Promise<EngineeringCandidate>` trong engineering-bundle.ts giữ exact draft/hash và phân biệt current/historical evidence. `engineeringEstimateInputs(project: EngineeringProject, content: EngineeringArchiveFiles): {energy: EnergyInput | null; drive: DriveInput | null; stability: StabilityInput | null; problems: Problem[]}` trong engineering-estimates.ts resolve model JSON theo digest từ local closure, dùng input types của calculators hiện hữu. Dữ liệu chưa có source trả null/problem, không mượn thông số service preset.

**Files:** new/modify Lab project/editor/viewer/estimates/candidate và scenarios client files trong map; new `lab/tests/unit/{engineering-project,engineering-client,engineering-estimates,engineering-candidate}.test.ts`, `lab/tests/integration/{engineering-migration,engineering-storage}.test.ts`, `lab/tests/e2e/{engineering-design,legacy-campaign}.spec.ts`. Copy generated contracts từ source artifact bằng pipeline, ghi origin/hash; test fixture `lab/tests/support/engineering.ts` exports `makeEngineeringProject(): EngineeringProject`, `makeEngineeringArchive(): EngineeringArchiveFiles` và `makeEngineeringReceipt(project: EngineeringProject): Extract<BundleReceipt, {state:'compiled'}>` với actual fixture content hashes. Receipt fixture chỉ dùng portable client test.

- [ ] Viết regression snapshot và designer→Twin identity:
  ```ts
  import { expect, test } from 'vitest';
  import { EngineeringProjectStore } from '../../src/project/engineering-store';
  import { makeEngineeringProject } from '../support/engineering';
  test('editing draft does not mutate an existing run', () => {
    const store = new EngineeringProjectStore(makeEngineeringProject());
    const locked = store.snapshot();
    const edited = structuredClone(store.getDraft());
    edited.assembly.instances[0].pose.xyzM[0] += 0.1;
    store.replaceDraft(edited);
    expect(store.snapshot().assembly.instances[0].pose.xyzM[0])
      .not.toBe(locked.assembly.instances[0].pose.xyzM[0]);
  });
  ```
- [ ] RED trong lab: `pnpm exec vitest run tests/unit/engineering-project.test.ts tests/unit/engineering-client.test.ts tests/unit/engineering-estimates.test.ts tests/unit/engineering-candidate.test.ts tests/integration/engineering-migration.test.ts tests/integration/engineering-storage.test.ts`.
- [ ] Implement shared store, wire App/Twin constructors cùng instance; preserve legacy project mode, migrate v1/v2 to draft với missing-data report. Editor select/mount/connect/link/joint/port inspector, provenance and BOM. Compile receipt drives run readiness. Core snapshot:
  ```ts
  snapshot(): EngineeringProject {
    return structuredClone(this.project);
  }
  ```
  `this.project` private, getDraft cũng không trả mutable reference; deep freeze read snapshot nếu dùng shared refs. Viewer transforms ROS Z-up→Three Y-up một chỗ; exploded transform nằm trong view state, không ghi draft.
- [ ] Implement repository/archives theo spec §5.1: database engineering riêng, transaction original/draft/content/active pointer, schema+hash checks trước mutation, commit acknowledgement từ transaction.oncomplete. Viết fake-indexeddb tests quota/abort/blocked-open, migration lần hai giữ original, loadActive sau reload; browser test import/export file roundtrip với blob closure và undo/redo. Regression core:
  ```ts
  const archive = makeEngineeringArchive();
  await repository.save(archive);
  const exported = await repository.exportArchive(archive.manifest.project.id);
  await otherRepository.importArchive(exported);
  expect((await otherRepository.loadActive())?.manifest.project).toEqual(archive.manifest.project);
  ```
  Hai repositories dùng DB test khác nhau và đóng sau test. Corrupt blob import phải reject và giữ nguyên prior loadActive; thiếu blob có khai báo chỉ mở draft với blocker. Storage lỗi không làm mất RAM draft hoặc nút export.
- [ ] Wire client thật tại scenarios/controls.ts: generated EngineeringRef + CreateRun union, TwinRuntime.compileEngineering và readiness extension, requestForPreset giữ ref, health requirements theo backend set. Extend TwinPreset/lockedInput để giữ engineering snapshot/receipt, không ép wrapper qua validateProjectV2. Unit client test capture request body và assert:
  ```ts
  expect(requestForPreset(engineeringPreset).engineeringRef).toEqual({
    bundleDigest: receipt.bundleDigest, projectDigest: receipt.projectDigest,
  });
  ```
  `engineeringPreset` trong test được tạo từ project/receipt helper và projected v2 input; mock fetch trả exact source contracts. Test blocked receipt không có output digests, old health không có engineering capability, mismatch project/ref và đổi draft sau compile đều chặn Start trước POST; chỉ receipt compiled tạo ref. Legacy requests giữ shape cũ. Reset lấy lockedInput, không dùng this.preset hiện tại; proof reclaim nạp lại đúng snapshot và scene/blob grants, không tự phát motion.
- [ ] Implement candidate riêng và adapter estimates, giữ App routes legacy/deployment/S01. Candidate test với edited draft + old receipt phải reject `ENGINEERING_IDENTITY_MISMATCH`; receipt null vẫn xuất draft với blocker, không nhận report khác digest là evidence current. Legacy buildBundle/core-deployment tests giữ nguyên. Browser kiểm service/Valetudo estimates, functional connections, candidate download, no-runtime design/save/export và missing-data labels.
- [ ] Tạo legacy-campaign.spec.ts dùng mock launcher, pairing một lần cho cả spec; chạy preset mixed rồi campaign hai AMR qua UI, assert scenario IDs, hai AMR có activity trong campaign, served/cup owner từ source journal và cancel không xóa custody. Không chỉ assert có option trong dropdown. Giữ mọi preset cũ khi thêm engineering và không chuyển mode ngầm.
- [ ] GREEN focused + existing project/store/workspace/calculation/deployment tests, typecheck/build. Browser spec thử đổi wheel radius/component revision → compile → Twin same scene hash, mount error chặn run, missing blob fallback 2D có thông báo, chuyển VI/JA/EN không mất dữ liệu. Thêm V17/V19/V20 assertions vào engineering-design.spec.ts (source fixture gateway, không claim native). Chạy UI/brand/controller specs và paired inputs/fault/campaign commands theo D03 trước đánh dấu D01 hoàn thành; không chờ native mới kiểm legacy UI.
- [ ] Commit lab: `feat: share engineering assemblies across designer and twin`.

### D02 — Reports, replay và native browser journey

**Dependencies:** B03/C04/D01. **Interfaces:** source `assessEngineeringEvidence(manifest: EngineeringRunManifest, samples: PhysicsSample[]): EngineeringAssessment` trong engineering/evidence.ts. New schema/type `EngineeringRunManifest` chứa pinned identities/rates/thresholds/expected coverage từ spec; `EngineeringAssessment` gồm `status:'pass'|'fail'|'not_run'`, `reasons:string[]`, `capabilities`, `caseResults`, `artifactRefs`. Extend report optionally; old reports remain readable.

**Files:** source evidence/report files, new `source/packages/contracts/schemas/engineering-evidence.schema.json`, `source/tests/integration/engineering-evidence.test.ts`; Lab report/inspector/i18n; new `lab/tests/unit/engineering-report.test.ts`, `lab/tests/e2e/engineering-run.spec.ts`. Modify `lab/playwright.native.config.ts` to include new native spec.

- [ ] Test empty/truncated/mismatched/stale samples, unavailable scalar and fidelity separation:
  ```ts
  expect(assessEngineeringEvidence(manifest, []).status).not.toBe('pass');
  expect(assessEngineeringEvidence(manifest, missingContactWindow).reasons)
    .toContain('EVIDENCE_GAP');
  ```
  Define full manifest/sample fixtures in new source test from B03/C02 recorded schema examples. Empty data when test ran is fail; prerequisites prevented execution is not_run with explicit manifest status.
- [ ] RED source: `pnpm exec vitest run tests/integration/engineering-evidence.test.ts`; Lab: `pnpm exec vitest run tests/unit/engineering-report.test.ts`.
- [ ] Implement vector capability/provenance, coverage/time bounds, contact allowlist, numeric threshold checks and immutable replay. SavedEvidence giữ optional engineering snapshot/ref/closure; report cũ vẫn decode nguyên bản. inputScopes/runtimeScopes thêm assembly/controller/tool/process hashes, report compare kiểm capability vector và profile để không xếp hạng khác fidelity như nhau. Giữ JSON/CSV/HTML, KPI/human wait và imported controller replay. Report model:
  ```ts
  const status = manifest.execution === 'not_started'
    ? 'not_run'
    : reasons.length > 0 ? 'fail' : 'pass';
  ```
  Missing manifest fields fail schema; do not infer execution from file presence. Native UI labels real/desired simulation speed; old evidence stale on model edit; replay no command channel. Show blockers instead of green zero metrics. V19 browser restart/re-pair/reclaim: original engineeringRef, read-only scene/blob và report còn truy cập; reset tạo run mới từ locked input, mất closure thì chặn reset. Dùng native server lifecycle fixture, không thay bằng mock test để nhận native pass.
- [ ] GREEN focused + report/replay regression; browser native against clean pinned runtime and imported C04 bundle. Use current native test env names: `LAB_NATIVE_BASE_URL`, `LAB_NATIVE_PAIRING_TOKEN`, `LAB_NATIVE_IMPORT_BUNDLE`; set from local environment without writing tokens to logs/Git. Run `pnpm exec playwright test --config playwright.native.config.ts engineering-run.spec.ts` from lab. Execute FD01/BV01→report→replay + interrupted transfer and design edit; record video/screenshots with UI change evidence.
- [ ] Commit source and lab separately: `feat: report engineering physics evidence and replay scope`.

### D03 — Artifact, offline closure và qualification campaign

**Dependencies:** D02; consumes locks/vendor licenses/bundle closure. **Interfaces:** existing artifact lock/import/check/rollback; preserve protocol majors 1/2 with negotiated engineering capability. Export includes schema/hash, supported capabilities, catalog digest and blob manifest; old runtime rejects feature. Add CLI campaign ID `engineering-qualification` to source scenario campaign registry, running V05–13 fixtures/negative cases with seeds 23/41/67 and repeat 3.

**Files:** exporter/packaging/recorder/pin/acceptance in map; modify `lab/tests/integration/{runtime-artifact,offline-bundle}.test.ts`; new `lab/tests/unit/regression-recorder.test.ts`, `source/tests/unit/regression-evidence-root.test.ts`, `source/tests/integration/engineering-package.test.ts`; new source campaign fixture `source/tests/fixtures/digital-twin/campaigns/engineering-qualification.json`; update Lab README/docs compatibility only with observed results.

**Evidence interface mới:** recorder nhận `--out <directory>` và `--suite physical-robot-lab`; acceptance nhận `LAB_V2_REGRESSION_DIR` (absolute hoặc relative với lab root). Khi không truyền root, acceptance giữ đường dẫn legacy; physical gate luôn truyền root mới. Explicit --out phải chưa tồn tại, không `rm -rf` thư mục đã có. Suite mới giữ mọi source/Lab test được coverage table R-MOCK tham chiếu, bổ sung các NR/new engineering tests dưới đây và ghi manifest cùng format/checkpoints/SHA hiện hữu. Không gọi acceptance trong recorder (nó cần manifest đã flush). Không bỏ guard của `source/tests/support/regression-identity.ts`, không mở rộng mutable paths để cho code/pin bẩn qua.

- [ ] Test tampered mesh/schema, missing vendor license, absent native profile, interrupted import and rollback:
  ```ts
  expect(tamperedImport.exitCode).not.toBe(0);
  expect(lockAfterFailure).toEqual(lockBefore);
  expect(offlineManifest.blobs.every(blob => blob.sha256 && blob.license)).toBe(true);
  ```
  Extend existing artifact fixture helpers to create catalog/blob closure; `tamperedImport` must be real importer invocation, not a stub response. Native binary packages must carry license metadata too.
- [ ] RED source `pnpm exec vitest run tests/integration/engineering-package.test.ts`; Lab `pnpm exec vitest run tests/integration/runtime-artifact.test.ts tests/integration/offline-bundle.test.ts`.
- [ ] RED tests recorder/root mới: parse --out/--suite; root đã tồn tại không bị xóa; acceptance đọc đúng manifest/results qua explicit root; absent/tampered/stale identity vẫn reject. Implement root selection cùng path normalization, retain default legacy read path. Recorder suite mới truyền `LAB_PW_JSON`/`LAB_EVIDENCE_DIR` dưới root mới, bỏ `--evidence` hardcode legacy ở các lời gọi mock launcher; performance output và offline results cũng vào root mới. Tất cả referenced source integration/unit/contracts và Lab unit/integration/browser results cần có trong manifest, không chỉ subset NR. GREEN các tests mới trước commit source/Lab code.
- [ ] Implement blob/schema closure export, license/source manifest, capability checks, atomic import and retained rollback. Package portable Lab separately from Linux native runtime/models. Offline native claim requires all engine/vendor dependencies on clean target; browser bundle alone is insufficient.
- [ ] GREEN packaging tests. Commit source first, then export clean source:
  ```sh
  node scripts/export-lab-runtime.mjs /var/tmp/engineering-runtime-artifact
  ```
  From lab, import/check rồi **commit Lab code + lock/pin** trước recording; source code (kể cả acceptance root change) đã commit sạch trước export:
  ```sh
  node scripts/import-runtime.mjs /var/tmp/engineering-runtime-artifact
  pnpm check:source
  ```
  Các block kiểm dưới đây là phần bắt buộc của `--suite physical-robot-lab` mới: recorder thực thi một lần trên hai HEAD đã khóa, capture machine-readable results. Không chạy rời toàn bộ rồi lại lặp lần nữa chỉ để tạo manifest. Đây cũng là các lệnh focused có thể dùng khi sửa lỗi trước đợt recording cuối:
  ```sh
  pnpm typecheck
  pnpm test
  pnpm build
  pnpm test:runtime-e2e
  pnpm test:e2e -- ui.spec.ts brand-ui.spec.ts brand-accessibility.spec.ts controller-report.spec.ts engineering-design.spec.ts
  node scripts/test-mock-e2e.mjs twin-workspace.spec.ts coffee-journey.spec.ts twin-recovery.spec.ts twin-inputs.spec.ts fault-schedule.spec.ts arm-simulation.spec.ts twin-plan01.spec.ts legacy-campaign.spec.ts
  ```
  Engineering-design và legacy-campaign là specs tạo ở D01. Chạy tuần tự, không để hai launcher tranh cổng; recorder đặt `LAB_PW_JSON` riêng mỗi command dưới --out (mock launcher tự tách file theo spec). Không dùng `--evidence` của launcher hiện tại vì flag đó ghi vào evidence digital-twin-v2 cũ. `test:twin-e2e` chỉ là subset; block trên chạy đủ cả subset và các regressions bị bỏ sót. Test cần token mà skipped là gate fail. Paths must be fresh or handled by existing exporter safeguards; no destructive cleanup of user output.
- [ ] Source regression NR04–NR09, từ source sau commit/pin:
  ```sh
  pnpm exec vitest run tests/integration/lab-runtime.test.ts tests/integration/lab-runtime-gateway.test.ts tests/integration/lab-v2-mock.test.ts tests/integration/lab-v2-mixed.test.ts tests/integration/lab-v2-scenario-matrix.test.ts tests/integration/lab-v2-bv01-ports.test.ts tests/integration/lab-v2-bv01-recovery.test.ts tests/integration/lab-v2-cup-ledger.test.ts tests/integration/lab-v2-fault-schedule.test.ts tests/integration/lab-v2-recovery.test.ts tests/integration/lab-v2-stream.test.ts tests/integration/lab-v2-reclaim-targets.test.ts tests/integration/lab-v2-arm-stage-start.test.ts tests/integration/lab-v2-native-gateway.test.ts tests/integration/lab-v2-controller-report.test.ts tests/integration/engineering-profile-routing.test.ts
  python3 -m pytest robotics/simulation/tests/test_world_compiler.py -q
  ```
  Đây là minimum preservation set, không thay full source CI yêu cầu bởi README. Native checks chỉ được claim trên runner thực; portable doubles không nâng evidence scale.
- [ ] NR11/NR12 từ lab, output paths mới, dependencies đã có và không tải khi launch:
  ```sh
  node scripts/build-offline.mjs --out /var/tmp/engineering-offline
  LAB_TEST_OFFLINE_ROOT=/var/tmp/engineering-offline node scripts/test-mock-e2e.mjs offline-bv01.spec.ts twin-recovery.spec.ts
  node scripts/measure-twin-ui.mjs --duration-ms 60000 --output docs/implementation/evidence/physical-robot-lab/ui-performance.json
  ```
  Adapt benchmark constructor/store nếu D01 đổi API, giữ actual renderer, 2 AMRs + arm + 6 tables, 60 s mỗi profile và ngưỡng 33/50 ms. Thêm engineering-scene benchmark riêng có fixture/budget khai báo; không thay legacy benchmark bằng scene nhỏ hơn. Offline test trên build host không tự đóng clean-machine/Linux gate; native package cần inventory/closure và test riêng theo V15.
- [ ] Thực chạy recorder **sau khi các option mới được task này implement**, từ lab:
  ```sh
  node scripts/record-regression.mjs --suite physical-robot-lab --out docs/implementation/evidence/physical-robot-lab/regression
  ```
  Recorder thêm JSON/JUnit reporters vào child commands, giữ before/after identity checkpoints và đủ references của acceptance. Đường output mới, chưa tồn tại; rerun dùng thư mục mới và đồng bộ LAB_V2_REGRESSION_DIR, không ghi đè lịch sử. Nếu full CI cần local services, dùng `--ci` với services đã provision riêng; thiếu môi trường ghi blocker. Không commit/change code hoặc pin trong lúc recording.
- [ ] Sau recorder pass và manifest đã flush, chạy từ source, cả hai code trees vẫn sạch:
  ```sh
  LAB_V2_REGRESSION_DIR=docs/implementation/evidence/physical-robot-lab/regression LAB_V2_MOCK_EVIDENCE=../lab/docs/implementation/evidence/physical-robot-lab/mock-acceptance.json pnpm exec vitest run tests/acceptance/lab-v2-mock.acceptance.test.ts
  ```
  Acceptance dùng root relative với lab đã định nghĩa ở trên, kiểm đúng source HEAD/codeHash/clean pin và SHA từng result. Source commit hoặc Lab code/pin đổi sau recording bắt buộc record lại vào root mới; không disable identity check hoặc đọc manifest digital-twin-v2 cũ. Chỉ commit docs/evidence được allowlist sau khi acceptance đạt; đây không phải owner/hardware acceptance.
- [ ] Run native campaign **added in this task** on each claimed target:
  ```sh
  node scripts/lab-sil.mjs run --campaign engineering-qualification --seed 23 --repeat 3 --environment-profile engineering-arm64 --out /var/tmp/engineering-qualification-arm64-23
  node scripts/lab-sil.mjs verify --input /var/tmp/engineering-qualification-arm64-23
  ```
  Campaign file binds engineering project/profile per case; repeat seeds 41/67 with new output paths. Save cases.json/log hashes. Clean machine/network-off test separate from development machine; absent target remains not_run.
- [ ] Review spec V01–V15/V17–V21 against cases.json, fresh regression manifest và compatibility.json NR01–NR12, publish evidence index including blockers and exact commits. V16/G3 theo D04 độc lập. Baseline pass thành fail/skipped/not_run hoặc mất UI action chặn release; external gate đã not_run giữ lý do riêng. Commit order: source code → clean export → Lab code/pin → record/accept → Lab docs/evidence. Subjects: source `feat: package and qualify engineering simulation bundles`; lab code/pin `chore: pin engineering runtime and regression recorder`; lab evidence `test: record engineering qualification evidence`.

### D04 — Calibration tooling và measured-data gate

**Dependencies:** B04/C04; independent of UI shipping once contracts exist. **Interfaces:** `assessCalibration(dataset: CalibrationDataset, prediction: PredictionSeries): CalibrationResult`. Define schema `engineering-calibration.schema.json`: dataset has configDigest, instrument/revision, units, clockMapping, uncertainty, rawDigest, sourceKind, trialIds, split (tune/validation), channels/values; prediction same aligned channel/unit/clock identities; result has status/reasons/residuals/domain/calibratedCapabilities. Units mismatch never auto converted without declared conversion.

**Files:** new source engineering/calibration.ts, `source/packages/contracts/schemas/engineering-calibration.schema.json`, `source/tests/unit/engineering-calibration.test.ts`, `source/scripts/assess-engineering-calibration.mjs`; new `source/docs/engineering-lab/calibration-protocol.md`; update Lab report rendering to display affected capabilities and stale model refs.

- [ ] Test synthetic-as-measured reject, trial overlap, clock/unit mismatch, altered model hash and out-of-domain:
  ```ts
  expect(assessCalibration(simulatedDataset, prediction).reasons)
    .toContain('MEASURED_DATA_REQUIRED');
  expect(assessCalibration(overlappingTrials, prediction).reasons)
    .toContain('CALIBRATION_SPLIT_LEAKAGE');
  ```
  Fixtures in new test include all mandatory dataset metadata; synthetic data is only testing validator behavior, never promoted to measured evidence.
- [ ] RED: `pnpm exec vitest run tests/unit/engineering-calibration.test.ts`.
- [ ] Implement time-aligned residuals/uncertainty/validation split and component revision invalidation. Core scalar calculation:
  ```ts
  const absoluteError = Math.abs(predicted - measured);
  const withinTolerance = absoluteError <= Math.max(absoluteTolerance, relativeTolerance * Math.abs(measured));
  ```
  All variables above come from validated aligned channel + predeclared thresholds. No interpolation across clock gaps exceeding sample policy. Report missing datasets as CALIBRATION_DATA_REQUIRED.
- [ ] GREEN tests; create calibration protocol for empty/full payload straight/turn/brake, energy, arm TCP, grip, dispense mass. State instrumentation, minimum 3 independent trials per condition and withheld validation trials; thresholds per verification spec agreed before collecting. Do not run hardware motion or buy equipment in this plan.
- [ ] If existing authorized measured datasets are available, run new CLI `node scripts/assess-engineering-calibration.mjs --dataset /var/tmp/engineering-measured.json --prediction /var/tmp/engineering-prediction.json --out /var/tmp/engineering-calibration-report.json`. Files must be actual inputs, not generated fake measurements. Without them save G3 not_run and do not tick measured qualification.
- [ ] Commit software/protocol: `feat: assess engineering calibration against measured datasets`.

**Exit:** UI, qualification and distribution have separate evidence statuses. G3 remains open when measured data is missing; this does not reclassify a completed G1/G2 run as hardware ready.

