# R4.2–R4.3 Control Workbench, Fault Studio and Tray Scenario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng chỉnh gain một trục và đọc đáp ứng trên web, soạn lịch lỗi và đọc báo cáo lỗi, rồi chạy khay ba cốc với năm biến thể và nhận một câu gợi ý có số đo.

**Architecture:** Bench run là họ scenario server-owned đi qua route tạo run và `simulationFactory`; trace 500 Hz do worker ghi. Lỗi là danh mục đóng có biên, chèn tại đúng lớp và trả biên nhận; báo cáo lỗi do reader dựng từ stream. Scenario khay dùng fixture mới dẫn xuất, không sửa fixture R2b.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R4-A §6–7](../02-r4-control-chain-spec.md), [contracts §4–5, §7, §9](../05-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: bench tối đa 500 tick và 5.000 mẫu trace mỗi trục; lịch lỗi tối đa 16 mục; mọi giá trị người dùng nhập được kiểm ở server theo biên server giữ; không thêm thư viện đồ thị.

## Review Focus

1. **Sửa ô gain trong lúc bench đang chạy:** run đang chạy giữ profile cũ; giá trị mới chỉ vào run kế tiếp (test ở V07).
2. **Gain làm plant bất ổn:** kết quả `unstable` có tick và cảnh báo, slot engine được nhả, run kế tiếp tạo được ngay (test ở V06).
3. **Hai lỗi chồng thời gian trên cùng trục, hoặc lỗi hẹn sau khi run kết thúc:** từ chối chồng lấn ở admission; mục chưa tới giờ báo `not_fired`, không tính là đã kiểm (test ở V08).
4. **Đổi ngôn ngữ, ẩn tab hoặc thu cửa sổ xuống 390 px giữa lúc đang vẽ đồ thị:** đồ thị và bảng thay thế vẫn đúng dữ liệu, không trống (test ở V07, V09).
5. **Nhập profile của plant khác hoặc file hỏng:** từ chối có lý do, bản nháp hiện tại không đổi (test ở V07).

---

## Task V06 — Bench run và metric đáp ứng

> Trước khi làm: đọc [các mục còn mở O1–O8 và quyết định D1–D4](01-drive-and-cil.md#quyết-định-chốt-ở-đầu-v06-người-dùng-duyệt-cả-bốn-ngày-2011) ở cuối plan 01. Người dùng đã duyệt D1–D4 ngày 20/11; chúng thay cho các chỗ tương ứng của task này (ref drive của bench nằm trong `create.payload.bench`, J của bánh lấy từ physical model). Thứ tự: xóa O8, một commit sửa O1–O3, rồi mới làm bench.

**Files:**

- Create `source/packages/contracts/schemas/bench-request-v1.schema.json`; Modify `control-evidence-v1.schema.json` (thêm `TuningResultV1`), `lab-run-v2.schema.json` (trường `bench` tùy chọn), `sim3d-worker-v1.schema.json` (`create.payload.bench`, `snapshot.driveTrace`, readback `effectiveInertiaKgM2`), `source/scripts/generate-contracts.mjs`.
- Create `source/packages/lab-runtime/src/v2/control/{bench-signals,tuning-metrics,gain-suggest,tuning-envelope,bench-runner}.ts`.
- Modify `source/packages/lab-runtime/src/v2/{scenario-registry,capabilities,gateway}.ts`, factory portable mà `src/cli.ts` truyền làm `simulationFactory`, `source/robotics/simulation-mujoco/mujoco_worker/{session,drive_model,engine,mobile_engine,snapshot}.py`, `source/scripts/lab-mujoco.mjs` (lệnh `bench`).
- Test `source/tests/unit/{bench-signals,tuning-metrics,gain-suggest,tuning-envelope}.test.ts`, `source/tests/integration/mujoco-bench.test.ts`, `source/tests/security/lab-bench.test.ts`, `source/robotics/simulation-mujoco/tests/test_bench.py`.

**Interfaces:** consumes `DriveGroup.trace()`, `ControlProfileV1`, `TuningEnvelopeV1`, `ControlMetric`; produces

```ts
// control/bench-signals.ts
export type BenchSignal =
  | {kind: 'step'; amplitude: number; atTick: number}
  | {kind: 'trapezoid'; distance: number; peakVelocity: number; acceleration: number; atTick: number}
  | {kind: 'hold'; ticks: number};
export const BENCH_MAX_TICKS = 500;
export const BENCH_AMPLITUDES = {wheelRadS: [2, 5], jointRad: [0.05, 0.1, 0.2]} as const;
export const SUGGEST_OPTIONS = {bandwidthRadS: [5, 10, 20, 40], damping: [0.7, 1]} as const;   // tập đăng ký cho gợi ý gain
export function validateBenchSignal(signal: unknown, axis: {mode: 'csp' | 'csv'; lower?: number; upper?: number; start?: number}): {ok: boolean; reasonCodes: string[]};
export function benchTarget(signal: BenchSignal, start: number, tick: number): number;
// control/tuning-metrics.ts
export function stepResponseMetrics(trace: DriveTrace, signal: {t0S: number; y0: number; amplitude: number},
  policy: {finalWindowS: number; settleBand: number; holdWindowS: number}): Record<'riseTimeS' | 'overshootPct' | 'settlingTimeS' | 'steadyStateError' | 'rmsError' | 'peakTorqueNm' | 'saturationRatio', ControlMetric>;
// control/gain-suggest.ts
export function suggestGains(input: {mode: 'csp' | 'csv'; inertiaKgM2: number; bandwidthRadS: number; damping: number}, envelope: AxisEnvelope):
  {loop: {kp: number; ki: number; kd: number; integralLimit: number | null; slewLimit: number | null}; clamped: string[]};
// control/tuning-envelope.ts
export function withinEnvelope(control: AxisControl, envelope: AxisEnvelope): string[];   // mã lý do, rỗng là đạt
// control/bench-runner.ts
export function createBenchRun(input: RunManifestInput & {bench: BenchRequestV1}, providers: RunProviders): Promise<ScenarioRun>;
```

Scenario mới trong registry: `MJ-BENCH-WHEEL` và `MJ-BENCH-ARM`, có dấu `bench:true`, không đơn hàng, thuộc set mới `engineering-mujoco-bench-v1` (`mode:'simulation'`, backend `mujoco_3d` và `mujoco_arm`, `bundle:false`, cùng `execution` với các set MuJoCo hiện có). `bundle:false` là bắt buộc: set có `scenarioIds` mà cần bundle sẽ bị gateway từ chối khi không có engineering ref. `checkScenario` chấp nhận scenario bench như đã chấp nhận `rig`. Health trả thêm `tuningEnvelope` và danh mục tín hiệu để Lab đọc, không hardcode.

- [ ] Viết test thuần, chạy fail trước: metric trên đáp ứng bậc hai dạng đóng (bên dưới); đáp ứng không vào dải 2 % trả `NOT_SETTLED` cho settling, sai số xác lập và giá trị cuối; trace thiếu mẫu trả `TRACE_GAP`; biên độ ngoài tập đăng ký hoặc đưa khớp ra ngoài giới hạn bị từ chối; `benchTarget` của `trapezoid` có diện tích bằng `distance`; `suggestGains` với `mode:'csp'`, *J* = 0,5, *ωₙ* = 20, *ζ* = 1 cho `kp` = 200, `kd` = 20 và `ki` = 0; kết quả vượt envelope bị kẹp và liệt kê trong `clamped`; `withinEnvelope` bắt NaN, âm, vượt trần.
- [ ] Viết bốn module thuần cho tới khi test đạt.
- [ ] Worker: `create.payload.bench:true` bật ghi trace cho tối đa 2 trục; `snapshot.driveTrace` mang đúng `substeps` mẫu mỗi tick; readback thêm quán tính hiệu dụng của trục tại tư thế hiện tại đọc từ ma trận quán tính của model. Test Python: trace có 10 mẫu mỗi tick, mẫu cuối trùng trạng thái cuối tick; bật trace trên 3 trục bị từ chối trước khi tạo engine.
- [ ] Viết `createBenchRun`: lấy slot engine chung, tạo worker với scene bench (wheel: `serve-payload-v1` tải `empty`; arm: `xarm6-g2-v1` không cốc ở `home`), mỗi tick gửi `driveCommands` từ `benchTarget`, ghi trace bằng recorder riêng của bench (chunk bất biến, hash và quota theo helper của physics-evidence; không dùng trace trong bộ nhớ của run arm-only), kết thúc ở `BENCH_MAX_TICKS` hoặc khi tín hiệu xong. `PLANT_UNSTABLE` → outcome `unstable` kèm tick và tên cảnh báo, đóng worker, nhả slot. Report có `tuning: TuningResultV1` dựng từ trace **đã đọc lại**.
- [ ] Nối gateway: `bench` trong run request chỉ hợp lệ với hai scenario bench; bản nháp control profile được kiểm bằng `validateControlProfile` và `withinEnvelope` trước khi tạo run; vi phạm trả 422 kèm mã. Bench dùng cùng phiên, CSRF, quyền writer, giới hạn run.
- [ ] Test integration với engine thật: bench bánh `step` 2 rad/s với profile khởi điểm hoàn tất, `tuning.metrics.riseTimeS.available` là true; bench khớp J3 `step` 0,1 rad hoàn tất; bench với `kp` ở trần envelope nhân thêm bằng cách ghi thẳng file profile trong test (bỏ qua envelope có chủ ý) kết thúc `unstable` và run thứ hai tạo được ngay sau đó.
- [ ] Test security: `bench` với scenario không phải bench bị 422; trường lạ trong `bench` bị 422; phiên khác không điều khiển được bench run; 501 tick bị từ chối.
- [ ] CLI: `node scripts/lab-mujoco.mjs bench --axis <id> --signal <json> --profile <file> --out DIR`, exit 0/1/2 như các lệnh khác.
- [ ] Commit `feat: run single-axis bench runs and compute response metrics`; re-pin Lab.

```ts
import {expect, test} from 'vitest';
import {stepResponseMetrics} from '../../packages/lab-runtime/src/v2/control/tuning-metrics';

test('step metrics match the closed-form second-order response', () => {
  const zeta = 0.5, wn = 10, wd = wn * Math.sqrt(1 - zeta ** 2), dtS = 0.002;
  const samples = Array.from({length: 1500}, (_, k) => {
    const t = k * dtS, y = 1 - Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + zeta / Math.sqrt(1 - zeta ** 2) * Math.sin(wd * t));
    return {target: 1, actual: y, feedback: y, torqueNm: 0};
  });
  const m = stepResponseMetrics({axisId: 'a', dtS, samples}, {t0S: 0, y0: 0, amplitude: 1}, {finalWindowS: 0.2, settleBand: 0.02, holdWindowS: 0.2});
  const value = (x: unknown) => (x as {available: true; value: number}).value;
  expect(m.overshootPct.available).toBe(true);
  expect(value(m.overshootPct)).toBeCloseTo(16.30, 1);          // exp(-pi*zeta/sqrt(1-zeta^2))
  expect(value(m.settlingTimeS)).toBeGreaterThan(0.72);         // sau đáy thứ hai (-2,66 %) tại 0,7255 s
  expect(value(m.settlingTimeS)).toBeLessThanOrEqual(0.812);    // cận bao 2 %
  expect(Math.abs(value(m.steadyStateError))).toBeLessThan(1e-3);
});
test('a response that never enters the 2 % band has no settling time', () => {
  const samples = Array.from({length: 500}, (_, k) => ({target: 1, actual: 1 + 0.1 * Math.sin(k / 5), feedback: null, torqueNm: 0}));
  const m = stepResponseMetrics({axisId: 'a', dtS: 0.002, samples}, {t0S: 0, y0: 0, amplitude: 1}, {finalWindowS: 0.2, settleBand: 0.02, holdWindowS: 0.2});
  expect(m.settlingTimeS).toEqual({available: false, value: null, unit: 's', reason: 'NOT_SETTLED'});
});
```

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/bench-signals.test.ts tests/unit/tuning-metrics.test.ts tests/unit/gain-suggest.test.ts tests/unit/tuning-envelope.test.ts
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-bench.test.ts tests/security/lab-bench.test.ts
```

### V06 — trạng thái ngày 20/11 và ghi chú cho V07

Xong trên nhánh `r4/virtual-commissioning`, chưa push: source `9805ec6` (O1–O3), `d99e2ea`+`2ae03ec` (contracts, metric), `38c2233` (worker), `abd24f1`+`ffe869c` (runner, gateway, CLI), `9c9175d` (đợt sửa sau review toàn phần); Lab pin cuối `51e8953` (pin `9c9175d`). Mỗi phần qua review riêng và một review toàn phần; ledger và mọi quyết định ở `source/.superpowers/sdd/02-workbench-faults-tray/progress.md`. Khác plan, theo quyết định ghi trong ledger:

- Bench có **bốn** kết quả trong `report.tuning.status`: `completed`, `drive_fault` (một trục chốt lỗi, có `fault:{tick, axisId, code}`), `unstable` (engine báo `PLANT_UNSTABLE`), `collision` (`collision:{tick, ids}`). Không gain nào trong profile làm engine mất ổn định: giới hạn mô-men chặn lực và drive ngắt `OVERSPEED`, nên "gain quá cao" hiện ra là `drive_fault`. Ba kết quả không phải `completed` đều cho mọi metric `unavailable` có lý do. Trạng thái run luôn là `completed`; UI phải đọc `tuning.status`.
- Ref drive của bench đi trong `create.payload.bench` (D1); bản nháp profile của người dùng đi nguyên byte, không bao giờ được seal lại; lệch plant là 422 `DRIVE_PLANT_MISMATCH` (D2).
- Bánh chỉ chạy tiến (`WHEEL_REVERSE_UNSUPPORTED`): tín hiệu lùi đã đăng ký đâm tường phía tây. Health chưa nói điều này.
- Tín hiệu phải kết thúc trong 500 tick tính từ mốc (tick đầu sau khi mọi trục enable; 4 với drive nominal), không thì `TICK_OUT_OF_RANGE`; dữ liệu tick 0 là đường nền, trần 5.000 mẫu tính tick 1–500.
- Trace đã ghi đọc qua `GET /lab/v2/runs/:id/trace` (cùng cổng đọc với report, chỉ bản đọc lại đã kiểm), tối đa khoảng 1 MB; lấy một lần khi run xong, không poll.
- J của bánh là `I_bánh + m·r²/2` (`wheel_straight_line`), J của khớp là đường chéo ma trận quán tính; J của kẹp thấp hơn thực (chỉ khớp dẫn).

Ghi chú cho V07 (từ review toàn phần, chưa làm): bước 0,2 rad trên khớp với gain khởi điểm luôn ngắt `OVERSPEED` (vật lý thật, UI cần giải thích); ẩn set bench khỏi bộ chọn set của twin; đóng hoặc lưu trữ mỗi bench run (giới hạn 20 run mở, khoảng 6 MB mỗi bench tay máy); xử lý cả `INVALID_RUN_REQUEST` và `INVALID_BENCH_REQUEST` (cùng dạng `issues`); `atTick` mặc định nhỏ; nên lấy danh mục trục, đơn vị, giới hạn khớp, mốc theo thí nghiệm và profile khởi điểm từ server thay vì gõ cứng; `suggestGains` chỉ có một bản cài đặt. Kết quả có `engine.hostArch` cho `comparable()`. CLD01/CLD02 của R4.2 chạy ở V07; CLD02 còn nợ từ sau `5e93570`.

## Task V07 — Tab Điều khiển trên Lab

**Files (lab, sau khi pin source của V06):**

- Create `lab/src/control/workbench.ts`, `lab/src/ui/{control-panel,svg-plot}.ts`.
- Modify `lab/src/ui/workspace.ts` (tab mới), `lab/src/runtime/target.ts` (tạo bench run, đọc envelope từ health), `lab/src/reports/control.ts` (phần `tuning`), stylesheet hiện có của workspace.
- Test `lab/tests/unit/{svg-plot,control-workbench}.test.ts`, `lab/tests/e2e/mujoco-control.spec.ts`.

**Interfaces:** consumes `TuningResultV1`, `tuningEnvelope` của health; produces

```ts
// ui/svg-plot.ts: chuỗi SVG thuần, không script, có <title> và <desc>
export function linePlot(series: {id: string; label: string; points: readonly (readonly [number, number])[]; dashed?: boolean}[],
  options: {width: number; height: number; xLabel: string; yLabel: string; bands?: {from: number; to: number; label: string}[]}): string;
export function plotTable(series: {id: string; label: string; points: readonly (readonly [number, number])[]}[], maxRows: number): string;
// control/workbench.ts
export interface WorkbenchDraft {axisId: string; kp: string; ki: string; kd: string; integralLimit: string; accelerationLimit: string}
export function parseDraft(draft: WorkbenchDraft, envelope: AxisEnvelope): {ok: true; control: AxisControl} | {ok: false; fields: Record<string, string>};
export function comparable(a: TuningResultV1, b: TuningResultV1): {ok: true} | {ok: false; changed: string[]};
export function exportControlProfile(base: ControlProfileV1, control: AxisControl, result: TuningResultV1): string;
export function importControlProfile(text: string, plant: {plantModelDigest: string; driveModelDigest: string}): {ok: true; profile: ControlProfileV1} | {ok: false; reasonCodes: string[]};
```

- [ ] Viết test unit, chạy fail trước: `linePlot` với 5.000 điểm trả SVG có đúng một `<polyline>` mỗi series và không chứa `<script>`; series rỗng trả khung có chữ "không có dữ liệu" theo ngôn ngữ hiện tại; `parseDraft` từ chối rỗng, NaN, ngoài envelope và trả lý do theo từng ô; `comparable` trả `changed` khi khác plant digest, tín hiệu hoặc seed; `importControlProfile` từ chối JSON hỏng, sai schema, sai digest, plant khác.
- [ ] Viết ba module cho tới khi test đạt. Mọi chuỗi qua `tr(vi, ja, en)`.
- [ ] Nối tab: chọn trục → form có biên từ envelope → "Chạy thử" tạo bench run mới → đồ thị lệnh/thực/phản hồi, sai số, mô-men có vùng bão hòa → bảng metric (metric không tính được hiện lý do) → A/B với lần chạy trước khi `comparable` → "Gợi ý từ quán tính" → "Xuất profile" / nhập profile. Banner cố định: *Mô phỏng · chưa hiệu chuẩn*.
- [ ] Test Review Focus 1 trong unit test của workspace: sửa ô sau khi run đã tạo không đổi `controlProfileDigest` của run đang chạy; lần "Chạy thử" kế tiếp mang giá trị mới.
- [ ] Viết spec e2e (một spec cho một launcher): bench hai bánh `step` → metric hiện → đổi Kp trong biên → chạy lại → bảng A/B có delta → xuất → nhập lại → bản nháp bằng file; nhập giá trị ngoài biên thấy lý do và không có request tạo run; lặp ở 390 px và ở ba ngôn ngữ; đổi ngôn ngữ giữa lúc đồ thị đang hiện thì đồ thị còn nguyên; ẩn tab trong lúc bench chạy rồi hiện lại sau khi run xong thì đồ thị và metric đúng với trace đã ghi.
- [ ] `pnpm typecheck && pnpm exec vitest run`, rồi chạy spec; commit Lab `feat: add the control workbench tab`.
- [ ] CLD01 cho R4.2 (cwd source): thêm ca vào `tests/integration/lab-runtime-container-r4.test.ts`: trong image `linux/arm64` dựng từ commit hiện tại, một bench run `step` trên bánh phải hoàn tất, trả `TuningResultV1` có metric, và slot engine được nhả (tạo được run thứ hai ngay sau đó). Dựng lại image `linux/amd64` (CLD02). Commit `test: run a bench step inside the runtime image`.

```sh
# cwd lab
pnpm typecheck && perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/svg-plot.test.ts tests/unit/control-workbench.test.ts
perl -e 'alarm 900; exec @ARGV' pnpm test:mujoco-e2e -- mujoco-control.spec.ts
```

**Exit:** R4.2 bàn giao được: G-TUNE1 có artifact; profile xuất ra gắn plant và nhãn `tuned_in_simulation`; bench run chạy được trong image cloud (CLD01).

### V07 — trạng thái ngày 20/11 và đợt sửa trước V08

V07 đã triển khai ở source `a93ae08d`, Lab `e352c5d` (pin runtime `77b38f7`). Tab Điều khiển, A/B, gợi ý, xuất/nhập và campaign `bench-v1` có 16 run tại `evidence-archive/r4-2-bench-77b38f7`, mọi record `accepted:false`. Các commit source sau pin chỉ đổi tài liệu. Không xem trạng thái triển khai này là acceptance.

[Review V01–V07](../REVIEW-v01-v07-2026-11-20.md) tìm thêm lỗi slew-only, ngữ nghĩa seq, tín hiệu rời rạc, reader/verifier và vòng đời UI. Người dùng đã yêu cầu sửa toàn bộ trước handover V08. Kế hoạch sửa được theo dõi tại `source/docs/superpowers/plans/2026-11-20-r4-v07-closeout.md`; bằng chứng mới phải ở thư mục mới, không sửa archive cũ. Lượt review đã chạy đạt TUNE04 cùng origin bằng cookie/CSRF trên cổng riêng và một e2e twin có pacing; sau thay đổi code phải chạy lại trên pin cuối.

**Đóng đợt sửa 20/11:** runtime `34cf316b`, Lab `6973aa21` (pin `7357cb0`), Source retention-only `3411b832`. Source unit 1.250/1.250, Lab 769/769, TUNE04 cookie/CSRF 1/1, CLD01 image arm64 và CLD02 native amd64 266/266 đạt. `cil-v2` 38/38 ghi tại `b74755e9` và kiểm lại bằng verifier cuối; `bench-v2` 16/16 ghi mới tại `34cf316b`. Review gốc giữ nguyên, mọi record `accepted:false`; CI tổng quát/CLD03/acceptance có phạm vi riêng được ghi trong [handover V08](HANDOVER-v08.md). Code và evidence có bản sao ngoài máy; archive CIL dùng verification copy chỉ có khóa công khai và mapping hash. Đọc handover trước khi dùng checksum hoặc tiếp tục sửa worker.

## Task V08 — Danh mục lỗi, chèn có biên nhận, oracle và báo cáo lỗi

**Files:**

- Modify `source/packages/contracts/schemas/{lab-fault-schedule,sim3d-worker-v1,physics-evidence-v1,world-evidence-v1,control-evidence-v1,lab-run-v2}.schema.json` (`params`; `faultInjections`/`faultReceipts`; ý định và biên nhận trong bản ghi tick; `FaultReportV1`; `driveFaultSchedule` trong run request).
- Create `source/packages/lab-runtime/src/v2/control/{drive-faults,sensor-transforms,fault-campaign}.ts`, `source/packages/lab-runtime/src/v2/fault-report.ts`, `source/robotics/simulation-mujoco/fixtures/fault-v1/{fault-oracle-v1.json,README.md,manifest.json}`, `source/robotics/simulation-mujoco/campaigns/fault-v1.json`.
- Modify `source/packages/lab-runtime/src/v2/{fault-schedule,random,gateway}.ts`, `v2/navigation2d/runner.ts`, `v2/simulation3d/mujoco-world-ports.ts`, `source/robotics/simulation-mujoco/mujoco_worker/{drive_model,session,snapshot}.py`, `source/scripts/lab-mujoco.mjs`.
- Test `source/tests/unit/{drive-faults,sensor-transforms,fault-report,gaussian}.test.ts`, `source/tests/integration/mujoco-drive-faults.test.ts`, `source/robotics/simulation-mujoco/tests/test_drive_faults.py`.

**Interfaces:** consumes `FaultScheduleEntry`, `dueFaults`, `DriveGroup`, `Stream`; produces

```ts
// v2/random.ts (thêm, không đổi stream hiện có)
export function gaussianPair(stream: Stream): [number, number];   // tiêu đúng hai số đều; u1 lấy trong (0, 1]
// control/drive-faults.ts
export type DriveFaultId = 'encoder-dropout' | 'motor-weak' | 'drive-trip' | 'command-delay' | 'command-loss' | 'grip-weak' | 'lidar-noise' | 'drive-reset';
export const DRIVE_FAULTS: Readonly<Record<DriveFaultId, {layer: 'command' | 'drive' | 'feedback' | 'sensor'; target: 'axis' | 'gripper' | 'lidar';
  appliedBy: 'worker' | 'runtime'; campaignOnly?: true; params: Readonly<Record<string, {min: number; max: number; multipleOf?: number; required: boolean}>>}>>;
export function validateDriveFaultSchedule(entries: readonly FaultScheduleEntry[], context: {axes: readonly string[]; lidars: readonly string[]; campaign: boolean}): {ok: boolean; reasonCodes: string[]};
// control/sensor-transforms.ts
export function lidarNoise<T extends {rangesM: (number | null)[]; states: string[]}>(scan: T, params: {sigmaM: number; dropoutFraction: number}, stream: Stream): T;
// v2/fault-report.ts
export function buildFaultReport(input: {schedule: readonly FaultScheduleEntry[]; receipts: readonly FaultReceipt[];
  drives: readonly {tick: number; drives: readonly DriveAxisSnapshot[]}[]; controllerEvents: readonly ControllerEvent[];
  attention: readonly {tick: number; reason: string}[]; physics: readonly PhysicsTickRecord[]; oracle: FaultOracleV1}): FaultReportV1;
```

Biên tham số đúng như bảng [R4-A §7.1](../02-r4-control-chain-spec.md#71-danh-mục-lỗi). `fault-oracle-v1.json` khai cho từng loại lỗi: bên phải phát hiện, mã, hạn (tick) và sáu invariant; file được khóa và băm trước campaign.

- [ ] Viết test thuần, chạy fail trước: `encoder-dropout` với `durationMs` 10 hoặc 6.000 bị từ chối; `command-delay` 25 ms (không phải bội của 2) bị từ chối; 17 mục bị từ chối; hai `motor-weak` chồng thời gian trên cùng trục bị từ chối, trên hai trục khác nhau thì đạt; `drive-reset` ngoài campaign bị từ chối; lỗi drive trên run không có drive model bị `FAULT_BACKEND_UNSUPPORTED`; lịch mock/native cũ cho đúng kết quả cũ. `gaussianPair` tái lập theo seed và có trung bình/độ lệch chuẩn mẫu trong dung sai trên 10.000 cặp. `lidarNoise` với `sigmaM:0, dropoutFraction:0` trả scan bằng scan vào và vẫn tiêu đủ ba số mỗi tia. `buildFaultReport`: mục không có biên nhận `start` là `not_fired`; phát hiện sau hạn là `detected_late`; biên nhận lệch tham số ném `FAULT_EVIDENCE_INVALID`.
- [ ] Viết các module thuần cho tới khi test đạt.
- [ ] Worker: `DriveGroup` nhận `faultInjections` trong `begin_tick`, kiểm biên rồi mới áp dụng, trả biên nhận trong snapshot. `encoder-dropout` trả `positionRad:null` và `velocityRadS:null` theo contracts §2; không điền phản hồi cuối kèm cờ ẩn. `motor-weak`/`grip-weak` nhân giới hạn lực; `drive-trip` chốt `EXTERNAL_TRIP`; `command-delay` đổi độ dài hàng đợi lệnh; `drive-reset` tạo sườn lên `faultReset`. Test Python cho từng loại, gồm: không loại nào ghi vào `qpos`/`qvel`.
- [ ] Runtime: lịch lỗi drive đến từ `driveFaultSchedule` của run request, không từ project. Run mobile vẫn từ chối `project.faultSchedule` như cũ; `driveFaultSchedule` trên run không có drive model bị từ chối. `dueFaults` hiện có quyết định mục đến hạn; mục do worker thực hiện đi vào `faultInjections` của đúng tick, mục `command-loss` làm runner giữ nguyên `seq`, mục `lidar-noise` biến đổi scan trước khi vào controller và ghi cả hai scan. Ý định được ghi trước lệnh; biên nhận được đối chiếu sau ACK và ghi vào bản ghi tick của recorder đang dùng (physics với run mobile, world-evidence với cell).
- [ ] Gateway: health thêm `faultCatalog` (id, lớp, biên); route `validate` nhận thêm thân tùy chọn `{driveFaultSchedule, backendSetId, scenarioId, driveExperimentId}` và chạy `validateDriveFaultSchedule` khi có; route tạo run chạy cùng kiểm đó trước khi tạo run.
- [ ] Viết campaign `fault-v1` (tối thiểu 16 run theo contracts §9) và verifier trong `fault-campaign.ts` cùng kiểu `verifyCilCampaign`. Test integration: `encoder-dropout` 300 ms trên bánh phải khi đang chạy cho `FEEDBACK_LOSS` đúng hạn oracle, run `needs_attention`, served 0; `command-loss` 200 ms cho `COMMAND_TIMEOUT`; `grip-weak` trong `MJ-CELL-BV01` không tạo phục vụ giả và custody còn ở vòi hoặc ở tay theo quan sát; mục hẹn tick 29.000 trên run kết thúc sớm là `not_fired`.
- [ ] Commit `feat: inject bounded drive, feedback and sensor faults with receipts`; re-pin Lab.

```ts
import {expect, test} from 'vitest';
import {validateDriveFaultSchedule} from '../../packages/lab-runtime/src/v2/control/drive-faults';
const entry = (faultId: string, targetId: string, at: number, durationMs: number, params: Record<string, number> = {}) =>
  ({id: `${faultId}-${targetId}-${at}`, faultId, targetId, trigger: {kind: 'elapsed_sim_ms' as const, value: at}, durationMs, params});
const context = {axes: ['amr-1/wheel-left', 'amr-1/wheel-right'], lidars: ['amr-1/lidar-1'], campaign: false};

test('overlapping faults of one kind on one axis are refused', () => {
  const overlap = [entry('motor-weak', 'amr-1/wheel-left', 1000, 2000, {torqueScale: 0.8}), entry('motor-weak', 'amr-1/wheel-left', 2500, 1000, {torqueScale: 0.5})];
  expect(validateDriveFaultSchedule(overlap, context)).toEqual({ok: false, reasonCodes: ['FAULT_OVERLAP']});
  const split = [overlap[0]!, {...overlap[1]!, targetId: 'amr-1/wheel-right'}];
  expect(validateDriveFaultSchedule(split, context).ok).toBe(true);
});
test('parameters outside the catalog bounds are refused', () => {
  expect(validateDriveFaultSchedule([entry('command-delay', 'amr-1/wheel-left', 0, 1000, {delayMs: 25})], context).reasonCodes).toEqual(['FAULT_PARAM_INVALID']);
  expect(validateDriveFaultSchedule([entry('drive-reset', 'amr-1/wheel-left', 0, 20)], context).reasonCodes).toEqual(['FAULT_CAMPAIGN_ONLY']);
});
```

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/drive-faults.test.ts tests/unit/sensor-transforms.test.ts tests/unit/fault-report.test.ts tests/unit/gaussian.test.ts
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -m pytest -p no:cacheprovider robotics/simulation-mujoco/tests/test_drive_faults.py -q
perl -e 'alarm 3600; exec @ARGV' node scripts/lab-mujoco.mjs run --campaign fault-v1 --out /tmp/mekoniq-fault-v1 && node scripts/lab-mujoco.mjs verify --input /tmp/mekoniq-fault-v1
```

### V08 — trạng thái ngày 21/11

Đã triển khai trên nhánh `r4/virtual-commissioning` của Source (không đổi Lab ở V08 ngoài việc re-pin, xem handover V09). Phạm vi: lịch lỗi drive là input của run (`driveFaultSchedule`), danh mục tám lỗi có biên, chèn có biên nhận ở worker và runtime, báo cáo lỗi dựng lại từ stream, campaign `fault-v1`.

**Quyết định và sai khác so với plan (mỗi mục là một ruling):**

1. `DriveFaultEntryV1` (trong `drive-io-v1`) thay cho việc sửa `lab-fault-schedule`: schema đó bị băm vào tham chiếu lịch sử R2a (`scripts/native-sim/r2a-arm-baseline.json`); sửa nó làm hỏng test nhập khẩu R2a. `targetId` của lịch drive cho phép `/` (tên trục `amr-1/wheel-left`).
2. Cửa sổ lỗi là hàm thuần của tick: bắt đầu ở `ceil(x/20)+1`, đóng ở `+ceil(durationMs/20)`, `end` trước `start`. Không có tập "đã bắn" cần lưu; chạy lại hay resume cho cùng ý định. `durationMs` bội của 20 (một tick); `drive-trip`/`drive-reset` rộng đúng một tick.
3. Biên nhận lặp lại `params`; mọi biên nhận của một tick cùng `bootId`/`requestDigest`. Reader đối chiếu ý định, lịch và biên nhận từng tick; thiếu hoặc thừa là `FAULT_EVIDENCE_INVALID`.
4. `command-loss`: runtime lặp lại lệnh cuối cùng đã gửi (kể cả `seq`) cho trục bị câm; replay áp dụng đúng dòng thời gian của lịch trước khi so với wire. Worker chỉ kiểm giới hạn điều hướng (v, ω) cho cặp bánh **mới**; cặp có một bánh lặp seq không phải lệnh của controller nào (campaign tìm ra: trước đó worker từ chối bước).
5. Cell: lỗi do runtime áp dụng nằm trong `command.faultInjections`/`faultReceipts`; lỗi worker trả `snapshot.faultReceipts`. Cell không có biến đổi LiDAR (`lidars:[]`). Cell halted không sinh cốc mới (lỗi trục tay máy lúc rảnh làm cốc thứ hai chồng lên cốc ở vòi, worker từ chối, run kết thúc bằng exception).
6. Mobile: ý định ghi vào checkpoint **trước** lệnh. Cell: ý định chỉ nằm trong bản ghi tick sau ACK (cell không có checkpoint hook); mất ACK ở cell vẫn là unknown, không gửi lại, nhưng ý định của tick đó không bền riêng.
7. Oracle `fault-oracle-v1` (đã niêm phong, `assumed`): phát hiện bắt buộc cho `encoder-dropout` (drive, `FEEDBACK_LOSS`, 3 tick), `drive-trip` (controller `DRIVE_FAULT`, 2 tick), `command-loss` (drive `COMMAND_TIMEOUT`, 5 tick). `motor-weak`, `command-delay`, `lidar-noise`, `drive-reset`, `grip-weak` không bắt buộc (grip-weak không hứa cốc tụt). Sáu invariant: `NO_FALSE_SERVE`, `NO_RESEND_AFTER_UNKNOWN`, `NO_MOTION_BEFORE_ENABLED`, `CUSTODY_UNCHANGED`, `LATCH_HELD`, `TORQUE_ZERO_AFTER_TIMEOUT`. `NO_FALSE_SERVE` so số phục vụ của journal với số phục vụ trước khi có trục nào chốt lỗi không hồi phục; `CUSTODY_UNCHANGED` ở cell chỉ là proxy (không có cốc nào chuyển sang `unknown`).
8. `fault-v1` có 23 run (15 mobile, 8 cell). `lidar-noise` chỉ có một cảm biến và `grip-weak` một trục kẹp, nên hai run của chúng khác tham số chứ không khác đối tượng. Một run `drive-reset` (sau `drive-trip`, tick kế tiếp: reset ở 12.400 ms không bao giờ tới vì attention dừng run). Kỳ vọng khóa trước lần ghi đầu; chỉ đổi vì không thể tới được (m13), không nới.
9. (Sau review độc lập, cùng ngày) `command-loss` nhường cho khóa chuyển động của world: khi `movementInterlocked` đúng (dừng đã chốt sau lỗi drive, chương trình đang chạy), runtime gửi lệnh mới thay vì lặp lệnh cũ, và replay dùng chính cờ đã ghi trong lệnh. Hợp đồng handover V08 "khóa chuyển động dùng target đã nhận" giữ nguyên (test cũ không đổi). Worker chỉ bỏ kiểm giới hạn điều hướng cho cặp có bánh bị câm và vẫn chặn bánh mới vượt `(v_max + ω_max·sep/2)/R`. Sinh cốc chỉ bị chặn khi cell halted **và** có lịch lỗi. `LATCH_HELD` chỉ cho phép xóa bằng biên nhận `drive-reset` được chèn. Cell không dựng được báo cáo lỗi thì lý do nằm ở `driveEvidence.issues`. Hai run `command-loss` của cell chuyển sang 55 s (AMR đang chạy; ở 30 s target giữ bằng 0 nên campaign không phủ ca này).
10. Review độc lập (Opus, ngữ cảnh mới): 0 Critical, 5 Important đã sửa ở mục 9, 9 Minor hoãn: phát hiện đếm mã đã chốt sẵn; phát hiện của controller lỏng theo trục; `NO_MOTION_BEFORE_ENABLED` không thể fail vì worker tự giữ target; `NO_RESEND_AFTER_UNKNOWN` cố định 0 ở cell và verifier; `driveFaultIntents` trong checkpoint chưa có người đọc; verifier chưa đối chiếu `faultInjections` trong wire và `custodyChanged` của cell lấy từ chính báo cáo; `firstCommandChangeTick` dựa trên `targetApplied`; `command-loss` ở trigger 0 không có gì để lặp; mã lý do `FAULT_SCHEDULE_INVALID` so với `FAULT_SCHEDULE_TOO_LONG` giữa validate và catalog.
11. Lint hạn chế: `lidar-noise` được verifier dựng lại từ các lần xuất bản thật trong evidence điều hướng cùng stream của mục tiêu; không có quy tắc chấp nhận gần đúng.

## Task V09 — Studio lỗi trên Lab

**Files (lab, sau khi pin source của V08):**

- Create `lab/src/ui/fault-timeline.ts`, `lab/src/reports/faults.ts`.
- Modify `lab/src/scenarios/fault-schedule.ts` (danh mục và biên đọc từ health), `lab/src/ui/fault-schedule.ts` (ô tham số theo biên, nút "Kiểm tra"), `lab/src/ui/report-panel.ts`, `lab/src/ui/workspace.ts` (nhảy tới tick), `lab/src/ui/replay-workspace.ts` (phần lỗi của report khi xem bản ghi), `lab/public/replays/catalog.json`.
- Create `lab/public/replays/drive-fault/` (bản ghi mẫu, WEB10).
- Test `lab/tests/unit/{fault-timeline,fault-report-view}.test.ts`, `lab/tests/e2e/mujoco-faults.spec.ts`, `lab/tests/e2e/replay-offline.spec.ts` (mẫu mới).

**Interfaces:** consumes `faultCatalog` của health, `FaultReportV1`; produces

```ts
// ui/fault-timeline.ts
export function faultTimeline(entries: readonly FaultScheduleEntry[], catalog: FaultCatalog, horizonMs: number): string;   // SVG + danh sách tương đương cho a11y
// reports/faults.ts
export function faultSection(report: unknown): {available: false; reason: string} | {available: true; rows: FaultRow[]};
export interface FaultRow {entryId: string; title: string; injected: string; detection: string; controller: string; plant: string; invariants: string; verdict: string; tick: number | null}
```

- [ ] Viết test unit, chạy fail trước: dòng thời gian xếp mục theo bốn lớp và có danh sách chữ tương đương; lỗi không có trong danh mục của runtime không xuất hiện trong danh sách chọn; report không có phần lỗi cho `{available:false, reason:'NO_FAULT_DATA'}`; mục `not_fired` có `tick: null` và nhãn riêng; `detected_late` có nhãn riêng.
- [ ] Viết hai module và nối trình soạn: chọn loại lỗi → đối tượng hợp lệ theo lớp → tham số trong biên → trigger → thêm; "Kiểm tra" gọi route `validate` và hiện mã lý do theo từng mục; lịch lỗi drive là input của run: studio giữ nó trong trạng thái workspace, lưu/nhập/xuất thành file JSON riêng và gửi kèm run request; không ghi vào project (cell từ chối project lệch digest fixture).
- [ ] Panel báo cáo thêm phần lỗi; bấm một dòng đặt con trỏ replay/viewport tại tick áp dụng. Ba ngôn ngữ; bàn phím; 390 px dùng danh sách thay dòng thời gian.
- [ ] Spec e2e: soạn `encoder-dropout` 300 ms trên bánh phải → Kiểm tra đạt → chạy `MJ-FD01` với `drive-nominal-v1` → báo cáo có dòng phát hiện đúng hạn → bấm dòng, con trỏ về tick áp dụng; soạn hai mục chồng nhau → Kiểm tra hiện `FAULT_OVERLAP` và không tạo run; thu cửa sổ 390 px giữa lúc dòng thời gian đang hiện thì danh sách thay thế còn đúng mục.
- [ ] `pnpm typecheck && pnpm exec vitest run`, chạy spec; commit Lab `feat: compose fault timelines and read fault reports`.
- [ ] Bản ghi mẫu thứ nhất (WEB10): chạy `MJ-CELL-BV01` seed 42 với `drive-nominal-v1` và một mục `drive-trip` trên bánh phải trong lúc AMR chở cốc; xuất replay package bằng nút "Xuất replay" hiện có; thêm vào `lab/public/replays/drive-fault/` và `catalog.json` theo đúng dạng ba mẫu hiện có (tiêu đề ba ngôn ngữ, `manifestSha256`, `recording`, `horizon`, `provenance` ghi `accepted:false; not_calibrated`). Xem bản ghi không cần runtime phải thấy AMR dừng và phần lỗi của report; package thiếu phần lỗi thì hiện "không có dữ liệu". Mở rộng `lab/tests/e2e/replay-offline.spec.ts` cho mẫu mới: mở được không cần runtime, hash manifest khớp `catalog.json`, phần lỗi hiện đúng. Commit Lab `feat: add the drive fault sample replay`.
- [ ] CLD01 cho phần lỗi (cwd source): thêm ca vào `tests/integration/lab-runtime-container-r4.test.ts`: trong image `linux/arm64`, `MJ-FD01` với `drive-nominal-v1` và một mục `encoder-dropout` chạy tới kết quả, report có `FaultReportV1` với biên nhận chèn. Commit `test: run a scheduled drive fault inside the runtime image`.

```sh
# cwd lab
perl -e 'alarm 900; exec @ARGV' pnpm test:mujoco-e2e -- mujoco-faults.spec.ts
```

### V09 — trạng thái ngày 21/11

Đã triển khai trên nhánh `r4/virtual-commissioning`: Lab `5cf41d6` (studio, báo cáo) và `7d5b5c6` (bản ghi mẫu `drive-fault`), Source `af4d81ad` (ca CLD01). Runtime không đổi so với V08 (`6d686125`), nên pin Lab `1d66e08` giữ nguyên.

**Đã làm:** studio lỗi drive cho hai preset MuJoCo (`mujoco-cell`, `mujoco-payload`): danh mục từ `health.faultCatalog`, đối tượng theo loại, tham số trong biên, lịch là input của run (không vào project), "Kiểm tra" gọi `POST /lab/v2/projects/validate` mà không tạo run, nhập/xuất file lịch JSON riêng (`documentType: drive-fault-schedule`), dòng thời gian bốn lớp kèm danh sách chữ (danh sách là view duy nhất ở ≤ 520 px), phần lỗi trong panel báo cáo và trong workspace replay offline, bấm một dòng đặt con trỏ replay tại tick áp dụng, bộ chọn thí nghiệm drive cho run.

**Rulings:**

1. Lab chưa có chỗ chọn thí nghiệm drive cho run (chỉ bench có). Studio thêm bộ chọn: cell gửi `driveExperimentId` trong request; run mobile ghi vào project kỹ thuật (hủy biên nhận, biên dịch lại).
2. Trường văn bản (`twin-df-at`, tham số) giữ giá trị khi `change` mà **không** vẽ lại: `change` bắn ở lúc blur, tức mousedown của nút kế tiếp, và vẽ lại ở đó nuốt cú click (e2e bắt được: nút "Thêm lỗi" mất click đầu tiên sau khi gõ). "Thêm lỗi" đọc các ô tại chỗ.
3. Bản ghi mẫu dùng seed 7 của preset cell (Lab không có ô seed; plan ghi 42) và dừng auto-run ở tick ~2550 chứ không hủy: cell bị giữ không hủy được ("Running"), run không dừng sẽ chạy tới `PICKUP_TIMEOUT` tick 9400 và export 30 s bị hết hạn. Gói là prefix bất biến của run sống (export của chính nút "Xuất replay"). Lỗi `drive-trip` bánh phải ở 48 s, khi AMR chở cốc đầu (tick 2293–2664 trong run seed 7 đã ghi).
4. CLD01 chạy trong image `linux/arm64` (không phải `MJ-FD01`): ca lỗi đi qua API công khai trên cell (`encoder-dropout` bánh trái ở 1 s), vì `MJ-FD01` cần biên dịch bundle kỹ thuật qua API. `MJ-FD01` được e2e Lab phủ trên runtime local thật.
5. `drive-reset` không có trong health nên không bao giờ hiện trong studio; validate từ chối `FAULT_CAMPAIGN_ONLY` (ca CLD01 kiểm điều này).

**Kiểm chứng:** Lab unit 783/783 (1 skip có sẵn), `pnpm build` đạt; e2e `mujoco-faults.spec.ts` đạt trên runtime MuJoCo thật (soạn → kiểm tra đạt → chồng lấn bị từ chối `FAULT_OVERLAP` không tạo run → 390 px còn danh sách → chạy `MJ-FD01` → dòng `detected_in_time` `FEEDBACK_LOSS` tick 601 → bấm dòng, con trỏ về 601 → ba ngôn ngữ); `replay-offline.spec.ts` 4/4 (mẫu mới mở không cần runtime, hash manifest khớp `catalog.json`, con trỏ nhảy tới 2401); CLD01 trong image arm64 đạt (cell phục vụ 2, ca lỗi có biên nhận, bench, read-only root).

**Chưa làm:** CLD02 (image amd64) cho R4.3 (sau V10); TUNE04 không đổi; chưa chạy lại e2e Lab cho các đường khác ngoài ba spec trên.
6. (Sau review độc lập) Lab `78a7807`..`c4bfcee`: kết quả "Kiểm tra" gắn với đúng body đã hỏi (sửa lịch là về trạng thái chưa kiểm); lịch có mục mà chưa chọn thí nghiệm drive thì Kiểm tra/Chạy bị chặn và run trước không bị đóng; chạy lại/đặt lại dùng lịch của chính run đó; giá trị đang gõ sống sót qua vẽ lại; `not_detected` không còn vẽ như thất bại. Chọn thí nghiệm drive cho run mobile chờ lần kiểm tra sẵn sàng đang chạy (runtime trả mã bận cho probe thứ hai mà không ai thử lại).
7. Review độc lập (Opus, ngữ cảnh mới): 0 Critical, 4 Important đã sửa ở mục 6. Hoãn (Minor): `check()` thiếu tham số tùy chọn trả OK sớm (hiện mọi tham số bắt buộc); lịch nhập vào không kiểm với đối tượng của preset (chỉ Kiểm tra từ chối); đọc cả file trước khi kiểm cỡ; phần replay rỗng có nhãn cho gói cũ; `isReport` không chặn số mục/kích thước gói và đòi đúng 6 invariant; nhảy trong twin không dừng replay đang phát; nhãn làn SVG bị kéo giãn do `preserveAspectRatio="none"`; nút "Xóa" không có tên mục; `role="alert"` bị đọc lại khi vẽ lại; `requestForPreset` theo id preset chứ không theo backend set (cùng kiểu `worldExperimentId`); `revokeObjectURL` ngay sau `click`; e2e không khẳng định `project.faultSchedule` ở đường cell và test timeline chưa khẳng định mục ngoài chân trời không bị vẽ.
8. **Rủi ro mở:** e2e `mujoco-faults.spec.ts` đạt 12 lần trong các vòng lặp nhưng thất bại 3 trong số các lần chạy nguội ngay sau một đợt vitest/compile: hai triệu chứng khác nhau (nút Chạy bị khóa 180 s sau khi chọn thí nghiệm; run ở "Running" mà không tới "Needs attention" trong 180 s). Không tái hiện được dưới chẩn đoán; chưa rõ nguyên nhân (nghi tải lúc khởi động hoặc probe sẵn sàng chồng nhau).

## Task V10 — Scenario khay ba cốc

**Files:**

- Create `source/scripts/generate-tray-fixture.mjs`, `source/robotics/simulation-mujoco/fixtures/serve-tray-v1/` (project/scene/model dẫn xuất từ `serve-payload-v1` giữ nguyên byte phần chung; `cup-triple.json`, `cup-triple-low-friction.json`, `tray-policy-v1.json`, `actor-proxy-v1.json`, `feasibility.json`, `NOTICE`, `README.md`, `manifest.json`).
- Create `source/packages/lab-runtime/src/v2/simulation3d/{tray-experiments,tray-oracle,tray-campaign}.ts`, `source/robotics/simulation-mujoco/campaigns/tray-v1.json`.
- Modify `source/robotics/simulation-mujoco/mujoco_worker/{compile_mobile,mobile_engine,session}.py` (proxy actor), `source/packages/lab-runtime/src/v2/{scenario-registry,capabilities}.ts`, `v2/navigation2d/scenario-fixtures.ts`, `src/engineering/mujoco-compiler.ts`, `source/scripts/lab-mujoco.mjs`.
- Lab, sau khi pin: Create `lab/src/reports/design-hint.ts`; Modify `lab/src/scenarios/catalog.ts` (preset `mujoco-tray`), `lab/src/reports/compare.ts`, `lab/src/ui/report-panel.ts`.
- Test `source/tests/unit/{tray-fixture,tray-oracle,tray-experiments}.test.ts`, `source/tests/integration/mujoco-tray.test.ts`, `source/robotics/simulation-mujoco/tests/test_mobile_actor.py`, `lab/tests/unit/design-hint.test.ts`, `lab/tests/e2e/mujoco-tray.spec.ts`.

**Interfaces:** produces

```ts
// scenario-registry.ts
// ['MJ-TRAY01', {id:'MJ-TRAY01', revision:1, title:'Three cups on one tray: kitchen -> eighth table -> parking', robots:1,
//   orders:[{actor:'guest-1', table:7, quantity:3, atTick:[25,25]}], confirm:{mode:'scripted', delayTicks:50}, park:true, maxTicks:30000}]
// simulation3d/tray-experiments.ts: registry đóng, năm id của R4-A §7.4; comparedWith là biến thể khác đúng một input
export const TRAY_EXPERIMENTS: Readonly<Record<'tray-nominal-v1' | 'tray-low-friction-v1' | 'tray-accel-high-v1' | 'tray-torque-limited-v1' | 'tray-person-crossing-v1',
  {load: 'cup-triple' | 'cup-triple-low-friction'; driveExperimentId: string; accelerationPolicy: 'nominal' | 'high'; actor: boolean; comparedWith: string | null}>>;
// simulation3d/tray-oracle.ts
export function coulombSlipBoundMps2(mu: number, gravityMps2?: number): number;
export function slipOnset(records: readonly PhysicsTickRecord[], propId: string, epsilonM: number): {tick: number} | null;
export function supportAccelerationMps2(records: readonly PhysicsTickRecord[], tick: number, windowTicks: number): number | null;
// lab/src/reports/design-hint.ts
export interface TraySummary {experimentId: string; accelerationLimitMps2: number; maxLoadSlipM: {available: boolean; value: number | null}; serviceTimeS: {available: boolean; value: number | null}}
export function designHint(pair: {accepted: boolean; changed: string[]; a: TraySummary; b: TraySummary}): {available: true; text: string} | {available: false; reason: string};
```

- [ ] Viết test, chạy fail trước: `coulombSlipBoundMps2(0.6)` gần 5,886 và `(0.15)` gần 1,4715; `slipOnset` trả `null` khi dịch chuyển trong khung khay không vượt epsilon; fixture sinh hai lần trùng byte; `cup-triple` có ba prop `free` không xuyên nhau và nằm trong đa giác đỡ sau margin; phần chung với `serve-payload-v1` trùng hash; `designHint` trả `{available:false}` khi cặp run không được chấp nhận hoặc một metric không có, và câu trả về có đủ bốn số cùng câu cảnh báo cuối trong ba ngôn ngữ.
- [ ] Sinh fixture. Ghi `feasibility.json`: khoảng cách cốc–cốc, cốc–mép, kết quả compile và readback. Profile khay trơn hạ ma sát của cả cốc lẫn mặt khay, vì engine lấy giá trị lớn hơn của hai mặt; readback ghi ma sát hiệu dụng của cặp. Không đạt thì đổi bố trí có revision, không ép về tâm.
- [ ] Worker: compiler nhận actor có khai proxy (hộp `mocap`, không va chạm vật lý với robot ngoài việc được LiDAR nhìn thấy và được báo tiếp xúc), `actorUpdates` đặt vị trí proxy mỗi tick; scene không khai actor giữ từ chối `MODEL_UNSUPPORTED` như cũ. Test Python: proxy xuất hiện trong scan ở đúng hướng; tiếp xúc robot–proxy được báo là collision ngoài dự kiến; `actorUpdates` cho actor không khai bị từ chối trước khi đổi trạng thái.
- [ ] Đăng ký `MJ-TRAY01`, năm thí nghiệm và lịch actor của biến thể D trong `scenario-fixtures.ts`. Biến thể B chọn navigation policy có `maxAccelerationMps2` cao hơn bằng cùng cơ chế mà `payload-fast-v1` chọn `maxLinearMps`: trường `mujocoExperimentId` của engineering project nhận thêm năm id khay, selector đóng tạo project/bundle mới. Giới hạn gia tốc của `diff-drive-base-v1` đặt không thấp hơn policy.
- [ ] Viết campaign `tray-v1` (A × 3 seed; A′, B, C, D mỗi biến thể 2 run) và verifier. Oracle của A′ và B: nếu gia tốc khay đo được vượt `coulombSlipBoundMps2(μ)` cộng dung sai của `tray-policy-v1` thì phải có `slipOnset`; nếu không vượt thì không được có; trường hợp gia tốc đạt được thấp hơn cận ở mọi tick được ghi `no_slip_expected` kèm gia tốc lớn nhất. Oracle của D: robot dừng, không có tiếp xúc robot–proxy, tiếp tục sau khi proxy rời đường, served đủ sau xác nhận.
- [ ] Test integration với engine thật: A seed 7 phục vụ đủ 3 sau xác nhận, trượt lớn nhất dưới ngưỡng cảnh báo của policy; D không có collision với proxy.
- [ ] Lab: preset `mujoco-tray` với chọn biến thể; câu gợi ý trong panel so sánh theo [R4-A §7.5](../02-r4-control-chain-spec.md#75-gợi-ý-thiết-kế). Spec e2e: chạy A′ rồi B, panel so sánh hiện câu gợi ý hoặc lý do không đủ dữ liệu; ba ngôn ngữ.
- [ ] Commit source `feat: add the three-cup tray scenario and its experiments`, re-pin, commit Lab `feat: add the tray preset and measured design hints`.
- [ ] CLD01 cho khay: thêm ca vào `tests/integration/lab-runtime-container-r4.test.ts`: trong image `linux/arm64`, `MJ-TRAY01` biến thể `tray-nominal-v1` seed 42 hoàn thành và phục vụ 3. Catalog portable của image (`deploy/lab-runtime/prepare-catalog.mjs`) phải chứa project của khay; thiếu thì run bị từ chối có mã, không rơi về project khác. Dựng lại image `linux/amd64` (CLD02). Commit `test: run the tray scenario inside the runtime image`.

```ts
import {expect, test} from 'vitest';
import {coulombSlipBoundMps2} from '../../packages/lab-runtime/src/v2/simulation3d/tray-oracle';
test('the slip bound is mu times g', () => {
  expect(coulombSlipBoundMps2(0.6)).toBeCloseTo(5.886, 3);
  expect(coulombSlipBoundMps2(0.15)).toBeCloseTo(1.4715, 4);
  expect(() => coulombSlipBoundMps2(0)).toThrow('FRICTION_INVALID');
});
```

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/tray-fixture.test.ts tests/unit/tray-oracle.test.ts tests/unit/tray-experiments.test.ts
perl -e 'alarm 3600; exec @ARGV' node scripts/lab-mujoco.mjs run --campaign tray-v1 --out /tmp/mekoniq-tray-v1 && node scripts/lab-mujoco.mjs verify --input /tmp/mekoniq-tray-v1
```

**Exit:** R4.3 bàn giao được: G-FLT1 và G-TRAY1 có artifact từng run; run có lỗi và khay chạy được trong image cloud (CLD01); bản ghi mẫu lỗi drive có trong catalog. Biến thể nào không khả thi được ghi blocked có lý do; không đổi tên kết quả.

### V10 — trạng thái ngày 21/11

Phần mềm xong trên nhánh `r4/virtual-commissioning`: Source `b1983ca9` (runtime, ghi và verify), `793f17be` (evidence `docs/implementation/evidence/virtual-commissioning/v10-tray-2026-11-21/`); Lab `dc47182` (pin `b1983ca9`) và `aebf4e4`. Chưa push, chưa deploy, mọi record `accepted:false`.

**Đã làm:** fixture `serve-tray-v1` (ba cốc, hai profile ma sát, `tray-policy-v1`, `actor-proxy-v1`, `feasibility.json`; phần chung với `serve-payload-v1` trùng byte); oracle Coulomb và registry năm biến thể; proxy người cho MuJoCo mobile (mocap box, LiDAR thấy, chạm báo là va chạm ngoài dự kiến; người đến từ `scenario-fixture.json` buộc bằng digest `--fixture-sha256`); `MJ-TRAY01`; compiler/verifier/so sánh theo "núm" (ma sát, gia tốc, drive, người); `report.trayEvidence` dựng từ bản ghi bền; campaign `tray-v1` 11 ca (verify exit 0, raw ở `robot/evidence-archive/r4-tray-v1-b1983ca9/`); Lab: preset `mujoco-tray`, chọn biến thể, `designHint`/`trayHint`, khối gợi ý ở panel so sánh, ba ngôn ngữ; CLD01 trong image `linux/arm64` đạt (khay phục vụ 3, tick 5636, 43,9 s).

**Kết quả đo (đọc, không hứa):** A completed served 3, trượt cửa sổ 0,96 mm; A′ completed, 4,14 mm, gia tốc khay cao nhất 0,87 < cận Coulomb 1,47 → `no_slip_expected`; B (2,5/3 m/s²) needs_attention ở tick 1295, trượt 32,7 mm, gia tốc đạt 1,89 > cận → trượt có và đúng chỗ; C needs_attention ở tick 3977; D completed served 3, dừng 63 tick cạnh người, không chạm, đi tiếp.

**Rulings:**

1. "Núm" thay cho "tệp": ma sát = profile cốc + profile tiếp xúc khay đổi cùng lúc (engine lấy ma sát lớn hơn của hai mặt; đọc lại từ engine: hiệu dụng 0,6 và 0,15); gia tốc = policy điều hướng + giới hạn của base controller (không thấp hơn policy, 0,5/1 → 2,5/3). `comparePhysicsRuns` đếm núm; drive của biến thể suy ra từ id (project nêu drive khác bị từ chối `MUJOCO_EXPERIMENT_DRIVE_CONFLICT`). Lab chấp nhận cặp ở mức báo cáo (cùng kịch bản, seed, bộ backend, commit, ngưỡng, lịch lỗi; đúng một núm là gia tốc), vì Lab không đọc lại bằng chứng.
2. **Trượt đọc trong cửa sổ 25 tick (0,5 s).** Engine có ma sát mềm: cốc trôi ~40 mm trong cả nhiệm vụ 110 s dù gia tốc thấp hơn cận 8 lần (cửa sổ ≤ 1 mm). Số "độ trượt lớn nhất" trong câu gợi ý và các ngưỡng 5/20 mm là số cửa sổ; trôi tích lũy được báo cáo, không phán xét. "A dưới ngưỡng cảnh báo" của plan đúng theo cách đọc này (0,96 mm), sai nếu đọc tích lũy (41 mm).
3. Dung sai oracle chọn từ dữ liệu: trượt cửa sổ 8 mm đã đo ở 0,77 cận (ma sát mềm trượt trước cận, không bao giờ sau) nên dung sai dưới cận là 0,5 và trên cận là 0,3 m/s², không khẳng định gì trong dải; khởi trượt được chấp nhận từ lúc gia tốc vào dải dưới cận đến 40 tick sau khi ra khỏi dải trên.
4. B và C là kết quả, không phải thất bại của oracle: từ giới hạn điều hướng 1,0 m/s² trở lên (đã thử 1,0; 1,2; 1,5; 1,8; 2,0; 2,5) planner giả định giảm tốc mà drive giả định không có (vượt, CONTACT, NO_PROGRESS hay LOAD_FELL); chỉ 0,8 hoàn thành. Giữ B ở 2,5/3 theo "gắt" của spec. Hệ quả: câu gợi ý cho cặp A′→B nói "không đủ dữ liệu" (không có thời gian phục vụ), kèm lý do.
5. Lịch người D chọn từ chạy thật: băng ngang tại x 5,5 (khe giữa hai bàn), 0,8 m/s, bắt đầu tick 1875, kết thúc ngoài tuyến. Hai lịch trước hỏng: kết thúc trên tuyến (NO_PROGRESS) và băng tại x 8 (sau lúc chờ robot quay rồi lệch hướng, chạm bàn 06).
6. `report.trayEvidence` dựng khi bản ghi không có khoảng trống (một lần dừng do monitor, ví dụ LOAD_FELL, đánh dấu coverage chưa đủ nhưng không mất bản ghi).
7. Review độc lập (Opus, ngữ cảnh mới): 0 Critical, 4 Important đã sửa ở `b1983ca9` mỗi cái có test: verifier campaign so đầu vào thật của run với registry (chính sách, load, ma sát, gia tốc, drive); verifier ghim tài liệu drive đã đăng ký và từ chối drive xung đột; lịch lỗi drive là đầu vào của so sánh (cả Source lẫn Lab); `slipFailM` làm hỏng biến thể (trừ B).

**Hoãn (Minor):** `actors.py` chưa dùng `confined()` và `FileNotFoundError` thô; id actor chưa kiểm với id prop; oracle khai ở fixture người không chạy (`ACTOR_SCHEDULE_APPLIED`…); núm `actor` chưa so sánh được qua `comparePhysicsRuns` (study-physics từ chối `actorUpdates`) và `note` là chữ của payload; `summariseTrayRun` trả trượt 0 khi không có bản ghi cốc và cứng `CUPS`; docstring `tray-oracle` (mốc tham chiếu, `gravityMps2` không dùng); `RESUMED_AFTER_PASS` không xét vị trí người; proxy là vật rắn (cần ruling, `actor-proxy-v1.json` không nằm trong bundle); Lab lặp ánh xạ biến thể→drive; readiness không kiểm lịch người của D; campaign không replay lệnh controller (CIL-v2 phủ cùng drive).

**Kiểm chứng:** Python worker 315/315; Source unit 1340 + contracts 121, typecheck, lint, `contracts:check` đạt; `mujoco-tray(-compile)` integration đạt; Lab unit 699, `pnpm build` đạt; e2e Lab `mujoco-tray.spec.ts` đạt; CLD01 (arm64, `b1983ca9`) đạt. Integration đầy đủ của Source sau V10: 174 tệp đạt, 24 tệp lỗi: 22 là bộ cloud/Supabase (không có DB cục bộ), `drive-evidence.test.ts` lỗi có sẵn từ `59583a0f`, và `lab-v2-mock` (thứ tự registry có thêm `MJ-TRAY01`, đã sửa kỳ vọng). **Chưa chạy:** CLD02 (amd64) và CLD03.

### Xử lý review V08–V10 ngày 21/11 (REVIEW-v08-v10-2026-11-21.md)

Sửa trên nhánh `r4/virtual-commissioning`: Source `1012ae33` (code), `0950c68a` và `1d2b7ab5` (evidence ghi lại); Lab pin `fd0e9b8` (`1012ae33`) và `5221ad2`. Mỗi lỗi có test; ca tích hợp quan sát wire thật.

| Mục | Xử lý |
|---|---|
| R01 | Khóa di chuyển chỉ nhường ở hai bánh; khớp tay máy vẫn mất lệnh (test cell J2: seq trên wire đứng yên 10 tick). Mục bị supervisor ghi đè có `overriddenBy` ở biên nhận và báo cáo, verdict `not_fired`. |
| R02 | `receiptsMatch`: run, boot, scene, request digest, tick, và không nhận biên nhận thừa kể cả ở tick không nợ; áp dụng ở cell và mobile. Trace campaign giữ `faultInjections` thật; verifier so với lịch từng tick. |
| R03 | Invariant có `not_evidenced`: mô-men sau timeout khi run kết thúc trước horizon hoặc không đo, custody sau transfer chưa rõ, số lần gửi lại không ai đếm. Kiểm "không chuyển động" đọc mode trục. 23 ca ghi lại: 2 TORQUE, 1 CUSTODY, 8 RESEND (cell) là `not_evidenced`. |
| R04 | Verifier khay chặn mọi phát hiện của reader (định danh, policy, gap); chỉ một ngoại lệ hẹp cho dừng do monitor (LOAD_FELL…). Runner dùng chung hàm. |
| R05 | Oracle D có đối chứng âm: lần dừng mà run A cùng seed (không người) cũng có thì không tính; chạy tiếp phải khi người đã ra xa. |
| R06 | Oracle Coulomb xét từng cốc, tại điểm khay dưới cốc (từ pose bản đồ và pose trong support), theo từng đợt gia tốc (`episodeGapTicks` 25); trượt phải rơi vào đợt của chính cốc đó. B ghi lại: `slip_expected_and_found`. |
| R08 | Verifier khay so toàn bộ tài liệu đã dùng với đăng ký (hình dạng load, profile tiếp xúc, hình dạng control profile gắn plant, policy controller và dừng) và đọc người từ luồng control đã ghi (file fixture buộc, từng `actorUpdates`). |
| R09 | `RUN_ENDED` (run đang chạy/tạm dừng không được tính) và `SPEED_SHORTFALL` cho C (cần bánh được lệnh trên 1 rad/s ít nhất 100 tick). |
| R10 | Study nhận `driveAxes` của mô hình drive; test dùng bản ghi vật lý thật (có `drives`). |
| R11 | Oracle niêm phong được giữ cùng run; đọc lạnh sau reclaim dựng lại fault report từ luồng giữ lại, thiếu đầu vào thì ghi lý do. |
| R07, R12, R13, R14 | Lab: lịch bị từ chối không đóng run live (0 lời gọi archive); hàng đợi readiness tuần tự; fault report phải thuộc báo cáo chứa nó (run, scheduleDigest, mục, chân trời); gợi ý thiết kế so toàn bộ định danh và nêu "cửa sổ 0,5 s"; Lab hiện `not_evidenced` và mục bị ghi đè. |

**Verifier cũ bị từ chối:** bản ghi `tray-v1` ở `b1983ca9` nay `verify` exit 1 (`TRAY_INPUTS_NOT_REGISTERED:policySha`, policy khay có thêm `episodeGapTicks`); archive gốc giữ nguyên, bản ghi mới ở `1012ae33` (11/11) và `fault-v1` ở `1012ae33` (23/23) thay thế làm bằng chứng.

**Còn mở (không sửa trong đợt này):** cell chậm đưa lỗi drive lên attention của Source (có từ trước V08: `c04` 1251→7438, `c01/c02` ~124–132 s mô phỏng); custody và số lần gửi lại chưa có phép đo độc lập (nên `not_evidenced`), mô-men sau timeout cần đuôi quan sát sau khi run dừng; `firstCommandChangeTick` lấy `targetApplied` của worker; phát hiện nhận latch có sẵn trước lúc chèn; ý định chỉ nhìn thấy trước lúc gửi trong tiến trình, `writeCheckpoint` mặc định không fsync (chưa nói rõ phạm vi bền); so sánh A→A′ bằng dữ liệu thật mới có test ở mức bản ghi (chưa có cặp đầy đủ), núm `actor` chưa so sánh được; Lab không tự thử lại khi runtime trả bận từ client khác và chưa có ca e2e đổi nhanh biến thể; Minor cũ của V10. **CLD02 cần máy Linux x86_64 thật** (`scripts/r4-cld02.sh`), chưa chạy; CLD03 phụ thuộc lệnh deploy.

**Kiểm chứng:** Python 315/315; Source unit 1356 và contracts 121, typecheck, lint, `contracts:check`; integration `mujoco-drive-faults` và `mujoco-tray` đạt; `tray-v1` 11/11 và `fault-v1` 23/23 verify exit 0; Lab unit 709, e2e `mujoco-faults`, `mujoco-tray`, `mujoco-control`, `replay-offline` đạt; CLD01 (arm64, `1012ae33`) đạt, khay phục vụ 3.

