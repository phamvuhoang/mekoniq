# R4.5 Calibration Toolkit and R4 Closeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Cập nhật 19/11:** V14 và V15 (R4.5) là **tùy chọn** và không chặn V16. Chỉ làm khi R4.5 được mở theo [R4-C §1](../04-r4-calibration-and-deferred-spec.md#1-kết-quả-sản-phẩm): có dữ liệu đo hoặc lịch phần cứng. V16 đóng R4 với R4.1–R4.4 và kiểm tra cloud.

**Goal:** Ghi qualification R4 trên hai đích Mac local và cloud, rồi đưa nhánh về `main`. Nếu R4.5 được mở: khi có log đo từ thiết bị thật, kỹ sư nhập được, so với mô phỏng, nhận dạng tham số trong biên khai trước và nhận một revision model mới có miền hiệu lực; Lab hiển thị đúng mức trưởng thành của model.

**Architecture:** Nhập log và đánh giá dùng lại `CalibrationDataset`/`assessCalibration` hiện có. Dự đoán và nhận dạng chạy lại chính bench run của bàn chỉnh, do TS điều phối; bộ tối ưu là hàm thuần ở TS. Mức model là hàm thuần của nguồn tham số. Không có dữ liệu đo thì chỉ có tự kiểm công cụ bằng dữ liệu tổng hợp, không sinh model.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R4-C](../04-r4-calibration-and-deferred-spec.md), [contracts §8–10](../05-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: Lab và runtime không điều khiển thiết bị đo; log được nhập từ file cục bộ và không được tải đi đâu; không ghi đè fixture hay profile gốc; dữ liệu tổng hợp không bao giờ tạo ra revision `calibrated`; G3 giữ `not_run` cho tới khi có dataset đo thật.

## Review Focus

1. **CSV có timestamp trùng hoặc lùi, thiếu cột, số không hữu hạn, hoặc đơn vị không khai trong sidecar:** từ chối có mã theo từng file; không tự sắp xếp lại, không tự quy đổi (test ở V14).
2. **Fit dừng ở biên hoặc không hội tụ:** tham số được đánh dấu `atBound`, bản ghi không sinh revision; không âm thầm nhận kết quả (test ở V15).
3. **Dataset đo ở cấu hình khác với model đang mở, hoặc plant đổi sau khi hiệu chuẩn:** `CONFIG_DIGEST_MISMATCH`; revision hiệu chuẩn cũ hiện là hết hiệu lực, không còn mang mức `calibrated` (test ở V14, V15).
4. **File do công cụ tự sinh bị đổi nhãn thành `measured`:** log có dấu `generator` của công cụ bị từ chối khi khai `measured` (test ở V14).
5. **Mở màn hình hiệu chuẩn khi chưa có bản ghi, hoặc với bản ghi của plant khác:** hiện "chưa có dữ liệu hiệu chuẩn" hoặc lý do từ chối; huy hiệu mức model không đổi (test ở V15).

---

## Task V14 — Nhập log đo, dự đoán từ bench và đánh giá

**Files:**

- Create `source/packages/lab-runtime/src/engineering/{calibration-import,bench-prediction}.ts`, `source/scripts/import-calibration-log.mjs`, `source/tests/fixtures/calibration/` (một bộ log **tổng hợp** có nhãn rõ: sidecar và ba file CSV).
- Modify `source/docs/engineering-lab/calibration-protocol.md` (thêm mục "Bài đo dùng tín hiệu bench" và định dạng log), `source/packages/lab-runtime/src/v2/control/bench-runner.ts` (xuất hàm chạy bench headless dùng chung).
- Test `source/tests/unit/calibration-import.test.ts`, `source/tests/integration/bench-prediction.test.ts`.

**Interfaces:** consumes `CalibrationDataset`, `PredictionSeries`, `assessCalibration`, `BenchSignal`, `DriveTrace`; produces

```ts
// engineering/calibration-import.ts
export interface CalibrationSidecar {
  sourceKind: 'measured' | 'synthetic'; generator?: string;            // generator có mặt nghĩa là do công cụ sinh
  deviceId: string; configDigest: string; clockDomain: string; clockOffsetNs: number;
  units: Record<string, 'rad' | 'rad/s' | 'N*m' | 'm' | 'm/s'>; uncertainty: Record<string, number>;
  policy: CalibrationDataset['policy'];
  attestation?: {operator: string; instrument: string; recordedAt: string};
  trials: {trialId: string; split: 'tune' | 'validation'; condition: string; file: string; axisId: string; signal: BenchSignal}[];
}
export function parseCalibrationCsv(text: string, channels: readonly string[]):
  {ok: true; timesNs: number[]; channels: Record<string, number[]>} | {ok: false; issues: string[]};
export function importCalibrationLog(sidecar: unknown, readText: (file: string) => Promise<string>):
  Promise<{ok: true; dataset: CalibrationDataset; sidecar: CalibrationSidecar} | {ok: false; issues: string[]}>;
// engineering/bench-prediction.ts
export type HeadlessBench = (input: {axisId: string; signal: BenchSignal; driveModel: DriveModelV1; control: ControlProfileV1; physicsOverride?: Record<string, number>}) => Promise<DriveTrace>;
export function predictTrials(dataset: CalibrationDataset, sidecar: CalibrationSidecar, models: {driveModel: DriveModelV1; control: ControlProfileV1; configDigest: string}, bench: HeadlessBench): Promise<PredictionSeries>;
// v2/control/bench-runner.ts
export function createHeadlessBench(runtime: MujocoRuntimeOptions): HeadlessBench;
```

Định dạng log: mỗi trial một file CSV, dòng đầu `time_ns,<kênh>…`, thời gian là số nguyên nanosecond tăng nghiêm ngặt, tối đa 200.000 dòng và 16 MiB. Sidecar JSON khai đơn vị, miền đồng hồ, độ bất định, policy và tín hiệu bench của từng trial. `physicsOverride` chỉ nhận đường dẫn tham số nằm trong tập đăng ký của V15; nó là input của công cụ ngoại tuyến, không có trên route của browser.

- [ ] Viết test, chạy fail trước: thời gian trùng hoặc lùi → `TIME_NOT_MONOTONIC`; thiếu cột khai trong sidecar → `CHANNEL_MISSING:<kênh>`; ô rỗng, `NaN`, `inf` → `VALUE_INVALID`; kênh không có đơn vị → `UNIT_MISSING:<kênh>`; 200.001 dòng → `LOG_TOO_LARGE`; `file` có `..` hoặc đường dẫn tuyệt đối → `LOG_PATH_REJECTED`; `sourceKind:'measured'` thiếu `attestation` → `ATTESTATION_REQUIRED`; `sourceKind:'measured'` có `generator` → `GENERATED_DATA_NOT_MEASURED`; `trialId` trùng giữa tune và validation → `CALIBRATION_SPLIT_LEAKAGE`. Positive: bộ fixture tổng hợp cho dataset đạt schema hiện có.
- [ ] Viết `parseCalibrationCsv` và `importCalibrationLog`. Không sắp xếp lại, không nội suy, không quy đổi đơn vị.
- [ ] Viết `createHeadlessBench` bằng cách tách phần chạy bench của V06 khỏi vòng đời gateway; `createBenchRun` dùng lại nó. Test V06 phải còn xanh.
- [ ] Viết `predictTrials`: với mỗi trial chạy đúng tín hiệu bench đã khai trên model hiện tại, lấy mẫu dự đoán theo đồng hồ của trace, điền `configDigest`, `clockDomain` và đơn vị từ model. Test integration: dataset fixture tổng hợp sinh từ chính model hiện tại cho `assessCalibration` trả `fail` với đúng một lý do `MEASURED_DATA_REQUIRED` (dữ liệu tổng hợp không qua được cổng), và residual từng kênh dưới dung sai; đổi `configDigest` trong sidecar cho `CONFIG_DIGEST_MISMATCH`.
- [ ] CLI `node scripts/import-calibration-log.mjs --sidecar <file> --out <dataset-moi.json>`: exit 0 khi nhập được, 1 khi có issue, 2 khi không đọc được input; file `--out` phải chưa tồn tại.
- [ ] Cập nhật giao thức hiệu chuẩn: bài đo trên thiết bị thật dùng **đúng các tín hiệu bench** của bàn chỉnh; ai chạy thiết bị, điều kiện an toàn và thiết bị đo là việc của người vận hành và nằm ngoài Lab.
- [ ] Commit `feat: import measured logs and predict them from bench runs`; re-pin Lab.

```ts
import {expect, test} from 'vitest';
import {parseCalibrationCsv} from '../../packages/lab-runtime/src/engineering/calibration-import';

test('a log whose clock does not strictly increase is refused, not reordered', () => {
  const csv = 'time_ns,command,position\n0,0,0\n2000000,1,0.001\n2000000,1,0.002\n';
  expect(parseCalibrationCsv(csv, ['command', 'position'])).toEqual({ok: false, issues: ['TIME_NOT_MONOTONIC']});
});
test('a declared channel that is missing from the file is named', () => {
  expect(parseCalibrationCsv('time_ns,command\n0,0\n', ['command', 'position'])).toEqual({ok: false, issues: ['CHANNEL_MISSING:position']});
});
```

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/calibration-import.test.ts
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/bench-prediction.test.ts tests/integration/mujoco-bench.test.ts
```

## Task V15 — Nhận dạng tham số, revision hiệu chuẩn và mức model

**Files:**

- Create `source/packages/contracts/schemas/calibration-record-v1.schema.json`; Modify `source/scripts/generate-contracts.mjs`.
- Create `source/packages/lab-runtime/src/engineering/{least-squares,identification,maturity}.ts`, `source/scripts/identify-drive-model.mjs`.
- Modify `source/packages/lab-runtime/src/v2/report.ts` và `v2/gateway.ts` (health và manifest mang mức model từng nhóm tham số).
- Lab, sau khi pin: Create `lab/src/reports/calibration.ts`, `lab/src/ui/calibration-panel.ts`; Modify `lab/src/ui/{workspace,control-panel,report-panel}.ts` (huy hiệu mức model).
- Test `source/tests/contracts/calibration-record.test.ts`, `source/tests/unit/{least-squares,identification,maturity}.test.ts`, `source/tests/integration/identification-selftest.test.ts`, `lab/tests/unit/{calibration-view,maturity-badge}.test.ts`, `lab/tests/e2e/calibration-view.spec.ts`.

**Interfaces:** consumes `importCalibrationLog`, `predictTrials`, `HeadlessBench`, `assessCalibration`; produces

```ts
// engineering/least-squares.ts: thuần, tất định
export function fitBoundedLeastSquares(residual: (x: readonly number[]) => Promise<number[]>,
  problem: {initial: number[]; lower: number[]; upper: number[]; maxIterations: number; tolerance: number; relativeStep: number}):
  Promise<{x: number[]; atBound: boolean[]; standardError: (number | null)[]; jacobianCondition: number;
    iterations: number; converged: boolean; objectiveInitial: number; objectiveFinal: number}>;
// engineering/identification.ts
export const IDENTIFIABLE_PATHS: readonly RegExp[];   // armatureKgM2[k]; jointDynamics.damping và frictionloss (một giá trị chung cho sáu khớp); driveModel.axes[k].torque.scale
export function validateIdentificationPlan(plan: unknown): {ok: boolean; reasonCodes: string[]};
export function identify(plan: IdentificationPlanV1, dataset: CalibrationDataset, sidecar: CalibrationSidecar,
  models: {driveModel: DriveModelV1; control: ControlProfileV1; configDigest: string}, bench: HeadlessBench, options: {toolSelfTest: boolean}): Promise<CalibrationRecordV1>;
export function writeCalibratedRevision(record: CalibrationRecordV1, base: {driveModel: DriveModelV1; physics: unknown}, outDir: string): Promise<{files: {path: string; sha256: string}[]}>;
// engineering/maturity.ts
export type ParameterMaturity = 'illustrative' | 'assumed' | 'nominal' | 'calibrated';
export function groupMaturity(sources: readonly SourceRef[], records: readonly CalibrationRecordV1[], currentConfigDigest: string): ParameterMaturity;
export function modelMaturity(input: {mock: boolean; groups: Record<'geometry' | 'inertia' | 'drive' | 'contact' | 'sensing', readonly SourceRef[]>;
  records: readonly CalibrationRecordV1[]; currentConfigDigest: string}): Record<string, ParameterMaturity>;
```

Bộ tối ưu: Gauss–Newton có giảm chấn với Jacobian sai phân tiến, mỗi bước chiếu về biên; tối đa 12 tham số; điểm bắt đầu, bước sai phân và số vòng lặp lấy từ plan nên kết quả tất định.

- [ ] Viết test bộ tối ưu, chạy fail trước: bài toán tuyến tính hai tham số có nghiệm đóng hội tụ về nghiệm trong 1e-6; nghiệm không ràng buộc nằm ngoài biên thì kết quả nằm trên biên và `atBound` đúng; residual trả `NaN` thì ném `RESIDUAL_INVALID`; hết `maxIterations` thì `converged:false`; hai tham số chỉ xuất hiện dưới dạng tổng trong residual cho `jacobianCondition` lớn hơn 1e8 và `standardError` là `null`.
- [ ] Viết test plan và bản ghi, chạy fail trước: 13 tham số, đường dẫn ngoài `IDENTIFIABLE_PATHS`, `lower ≥ upper`, `initial` ngoài biên, `datasetDigest` lệch dataset đều bị từ chối; `identify` chỉ dùng trial `tune` để fit (spy `bench` chỉ thấy `trialId` thuộc tune trong pha fit) và chỉ dùng `validation` để đánh giá; có tham số `atBound` hoặc `converged:false` thì `produced` rỗng; `jacobianCondition` vượt `maxJacobianCondition` của plan cho lý do `IDENTIFIABILITY_POOR` và `produced` rỗng; `sourceKind:'synthetic'` hoặc `toolSelfTest:true` thì `produced` rỗng dù residual đạt.
- [ ] Viết test mức model, chạy fail trước: mọi nguồn `assumed` → `assumed`; trộn `manufacturer` và `assumed` → `assumed`; toàn `manufacturer` → `nominal`; `derived` có bản ghi đạt, đúng `configDigest` → `calibrated`; cùng bản ghi nhưng `currentConfigDigest` khác → rơi về mức của nguồn gốc; model mock → `illustrative`.
- [ ] Viết ba module cho tới khi test đạt. `writeCalibratedRevision` ghi file **mới** với revision tăng, nguồn của tham số đã fit là `derived` trỏ tới digest dataset và digest bản ghi, kèm miền hiệu lực; từ chối ghi đè file đã có; không chạm file gốc.
- [ ] Tự kiểm công cụ (test integration, engine thật): sinh "số đo" tổng hợp bằng bench trên hai khớp J2 và J3 với tham số ẩn (armature của J3 × 1,3; damping chung + 0,5; `torque.scale` của J3 0,8) cộng lượng tử encoder; chạy `identify` từ giá trị danh định với `toolSelfTest:true`; kỳ vọng mỗi tham số phục hồi trong 5 % giá trị ẩn, `produced` rỗng, bản ghi mang `sourceKind:'synthetic'`. Dung sai 5 % là dung sai của bài tự kiểm, khai trong test trước khi chạy.
- [ ] CLI `node scripts/identify-drive-model.mjs --plan <file> --dataset <file> --sidecar <file> --out <thu-muc-moi>`: exit 0 khi bản ghi đạt và sinh revision, 1 khi không đạt (bản ghi vẫn được viết), 2 khi thiếu input.
- [ ] Health và manifest của run mang `modelMaturity` tính bằng `modelMaturity`; report hiện mức theo nhóm. Không có trường nào để gõ tay mức model.
- [ ] Lab: màn hình hiệu chuẩn đọc bản ghi từ file cục bộ (đồ thị đo so với dự đoán bằng `linePlot`, bảng residual, miền hiệu lực, cờ chạm biên, trạng thái hiệu lực); huy hiệu mức model ở header workspace, tab Điều khiển và panel báo cáo; ba ngôn ngữ. Test: không có bản ghi hiện "chưa có dữ liệu hiệu chuẩn"; bản ghi của plant khác bị từ chối kèm lý do và huy hiệu không đổi; bản ghi tổng hợp hiện nhãn "tự kiểm công cụ" và không đổi huy hiệu.
- [ ] Commit source `feat: identify drive and joint parameters within declared bounds`, re-pin, commit Lab `feat: show calibration records and model maturity`.

```ts
import {expect, test} from 'vitest';
import {groupMaturity} from '../../packages/lab-runtime/src/engineering/maturity';
const src = (kind: 'assumed' | 'manufacturer' | 'derived', contentSha256 = 'a'.repeat(64)) =>
  ({kind, documentId: 'd', revision: '1', locator: 'l', contentSha256});

test('a group is only as mature as its weakest parameter', () => {
  expect(groupMaturity([src('manufacturer'), src('assumed')], [], 'c1')).toBe('assumed');
  expect(groupMaturity([src('manufacturer')], [], 'c1')).toBe('nominal');
});
test('a derived parameter is calibrated only while its record is valid for the current configuration', () => {
  const record = {planDigest: 'p', datasetDigest: 'a'.repeat(64), sourceKind: 'measured', toolSelfTest: false, configDigest: 'c1',
    validation: {status: 'pass'}, produced: [{document: 'drive_model', id: 'x', revision: 2, digest: 'b'.repeat(64)}]} as never;
  expect(groupMaturity([src('derived')], [record], 'c1')).toBe('calibrated');
  expect(groupMaturity([src('derived')], [record], 'c2')).toBe('assumed');
});
```

```sh
perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/contracts/calibration-record.test.ts tests/unit/least-squares.test.ts tests/unit/identification.test.ts tests/unit/maturity.test.ts
perl -e 'alarm 3600; exec @ARGV' pnpm exec vitest run tests/integration/identification-selftest.test.ts
```

**Exit:** R4.5 bàn giao được: G-CAL1 có artifact tự kiểm. G3 vẫn `not_run`; không có revision `calibrated` nào tồn tại khi chưa có dữ liệu đo.

## Task V16 — Qualification R4 và đóng nhánh

**Files:**

- Create `source/scripts/{sim-extension-r4,record-sim-extension-r4,r4-readback}.mjs`, `source/docs/operations/r4-qualification.md`, `source/docs/implementation/virtual-commissioning/{README.md,status-<ngày>.md,design/}` (bản sao bộ thiết kế này, link tương đối đã sửa).
- Modify `source/tests/acceptance/` (bảng case/gate R4 của guard `sim-extension`), `source/docs/implementation/README.md`, `lab/docs/simulation-compatibility.md`, `lab/README.md`, `lab/scripts/measure-cell-production.ts` hoặc script đo tương ứng cho WEB09, `source/scripts/cloud-run-qualification.mjs` (bản bổ sung cloud của R4).
- Test `source/tests/unit/r4-readback.test.ts`, `source/tests/acceptance` hiện có.

**Interfaces:** consumes mọi verifier của V05–V13 (và của V14–V15 nếu R4.5 đã mở); produces recorder và guard cho release `r4` theo [contracts §10](../05-contracts-and-evidence.md#10-qualification-r4):

```
node scripts/record-sim-extension-r4.mjs --r2b-record DIR --cil-campaign DIR --fault-campaign DIR --tray-campaign DIR \
  --perception-study DIR --recovery-campaign DIR --bench-record DIR --container-record DIR --web-record DIR \
  --mock-regression DIR [--calibration-selftest DIR] --out DIR --candidate-id r4-candidate-NN
```

`--container-record` là kết quả CLD01 và CLD02 của commit đang ghi. `--calibration-selftest` chỉ truyền khi R4.5 đã mở; không truyền thì các case CAL và G-CAL1 ghi `not_run` với lý do `r45_not_opened` và không ảnh hưởng điều kiện đóng. CLD03 không đi qua recorder: nó là bản bổ sung sau deploy, kiểm bằng guard `cloud-run`.

- [ ] Viết bảng `CASES`/`GATES` của R4 đúng [contracts §9](../05-contracts-and-evidence.md#9-case-và-gate), và test reader: thiếu một campaign → case tương ứng `not_run` và gate không thành `tested`; artifact sai hash → từ chối; `accepted:true` ở bất kỳ đâu → từ chối; record R2b không cùng tuple → REG05 `not_run`; không có `--calibration-selftest` → G-CAL1 `not_run` mà R4 vẫn đủ điều kiện đóng; chưa có bản bổ sung cloud → CLD03 `not_run` với `deploy_order_pending` và G-CLOUD2 chưa `tested`.
- [ ] Nối `--bench-record` tới verifier theo đúng phiên bản campaign: `bench-v1` gắn profile lịch sử, `bench-v2` gắn profile khởi điểm sau đợt sửa V07. Không áp default hiện tại vào record cũ, không chỉ đọc nhãn pass trong summary. Đòi đủ trục/tín hiệu theo registry và TUNE01–TUNE05: admission/slot, metric, trace bền, e2e Control và vector gợi ý. TUNE04/TUNE05 là artifact kiểm riêng có command, exit code và identity; không suy từ 16 run rằng UI hoặc công thức đã đạt.
- [ ] Nối `--fault-campaign` tới verifier `fault-v1` của V08; ánh xạ từng case FLT ở contracts §9 từ lịch đã băm, receipt thực tế, oracle và evidence đọc lại. Thiếu receipt, trục, loại lỗi hoặc experiment bắt buộc làm case tương ứng chưa đạt; `not_fired` chỉ đạt khi oracle khai trước cho phép.
- [ ] Kiểm cùng tuple cho hai đầu vào trên: source commit, pin/runtime artifact, schema hash, portable tools digest, engine version/host architecture, registry/oracle digest và plant/drive/control digests có liên quan. Không dùng record cũ chỉ vì campaign ID giống nhau; không so byte giữa hai kiến trúc. Chữ ký acceptance nằm ngoài các verifier và vẫn do người review quyết định.
- [ ] Thêm negative test cho thiếu `--bench-record`, thiếu `--fault-campaign`, record thiếu run/TUNE04/TUNE05/FLT bắt buộc, trace gap/manifest sai schema, report bị sửa rồi seal lại inventory, oracle/tuple sai, checksum hỏng và record có `accepted:true`. Reader phải trả case/gate chưa đạt hoặc từ chối theo nguyên nhân, không pass rỗng.
- [ ] Viết recorder: từ chối output đã tồn tại, cây source hoặc Lab bẩn, pin Lab lệch commit source, bytecode dưới portable root; ghi `qualification.json` với `accepted:false`, identity trước/sau, kết quả từng suite, case và gate; archive thô ngoài Git, trong cây chỉ có JSON cấp trên và `index.json`.
- [ ] Đo WEB07–WEB09 trên build production của Lab: ba ngôn ngữ, ba bề rộng, axe, reduced motion cho mọi panel mới; replay package có stream mới mở offline và mọi mutation bị chặn; frame p95 với đồ thị 5.000 mẫu và lớp belief. Không đạt mục tiêu thì ghi fail, không đổi mục tiêu.
- [ ] Chạy cổng CI ở source (`pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm build && pnpm test:unit && pnpm test:contracts && pnpm test:adapters`, và `pnpm test:integration` khi Supabase chạy; không chạy được thì ghi rõ) và ở Lab (`pnpm check:source && pnpm typecheck && pnpm exec vitest run`).
- [ ] Ghi chuỗi theo thứ tự, mỗi bước exit 0 mới sang bước sau, output ngoài hai repo, `caffeinate -dims`, không commit Lab giữa chừng: Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → các campaign R4 → r4. Chạy guard trên bản đầy đủ.
- [ ] Viết `r4-qualification.md` (cách ghi, cách đọc, giới hạn), status mới (file mới, không sửa status cũ), cập nhật README triển khai và trang tương thích của Lab. Chép bộ thiết kế vào `source/docs/implementation/virtual-commissioning/design/`. Đề xuất nội dung cập nhật `CLAUDE.md` của workspace (lệnh, record, gotcha của R4) để người dùng duyệt.
- [ ] WEB10: kiểm hai bản ghi mẫu của R4 (`drive-fault`, `belief-recovery`) trên build production của Lab bằng `tests/e2e/replay-offline.spec.ts`: mở được không cần runtime, hash khớp `catalog.json`, có `not_calibrated`. Mẫu nào không tạo được thì ghi lý do; không thay bằng dữ liệu dựng tay.
- [ ] Cloud (CLD03), chỉ khi người dùng ra lệnh deploy: dựng và đẩy image, deploy theo [runbook Cloud Run](../../../../../docs/operations/lab-runtime-cloud-run.md) mục 3–4; rồi làm mục 5 với kịch bản của R4: health báo đúng commit và schema hash của pin, `MJ-CELL-BV01` với `drive-nominal-v1` phục vụ 2, một bench run hoàn tất, ghi ms/tick và tốc độ thật. Lưu thành bản bổ sung dưới `evidence/cloud-run/` có `checksums.json`; mở rộng `scripts/cloud-run-qualification.mjs` để guard `cloud-run` gắn bản bổ sung này với record R4. Chưa có lệnh → ghi CLD03 `not_run` và đóng phần local.
- [ ] Commit `docs: record r4-candidate-NN …` (index và sha256), xóa candidate bị thay thế khỏi cây. Fast-forward hai nhánh về `main`. Push và deploy chỉ theo lệnh của người dùng.

```sh
LAB_SIMEXT_EVIDENCE_DIR=<thư mục r4 đầy đủ> perl -e 'alarm 900; exec @ARGV' pnpm test:acceptance -- sim-extension
```

**Exit:** record R4 tồn tại với gate đúng trạng thái thực; G-CLOUD2 `tested` nếu đã có một lần deploy theo lệnh, nếu chưa thì CLD03 `not_run` có lý do; phần external (R4.5, G3, host, phần cứng) liệt kê riêng; mọi record `accepted:false`; `main` cục bộ sạch.

## Thứ tự và điểm dừng

| Sau | Dừng nếu |
|---|---|
| V14 | Bench headless làm test V06 đổi kết quả → sửa trước khi đi tiếp |
| V15 | Tự kiểm không phục hồi được tham số ẩn trong dung sai đã khai → không bàn giao công cụ; điều tra khả năng nhận dạng của tín hiệu bench, không nới dung sai |
| V16 | Bất kỳ recorder nào exit khác 0 → không ghi bước sau; reader từ chối capture → không sửa ngưỡng |
