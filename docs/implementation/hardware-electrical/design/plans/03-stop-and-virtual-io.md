# R5.3 Stop Behaviour and Virtual I/O — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một phương án phần cứng được chạy trên plant R4 khi phải dừng: ba chức năng dừng có biên nhận, metric và báo cáo; campaign `stop-v1` trên khay ba cốc; hai điểm DI ảo với ba lỗi I/O và campaign `vio-v1`.

**Architecture:** Chức năng dừng ánh xạ vào cơ chế sẵn có của drive ảo (`quickStop`, `trip`, `onDisable`). Dừng khẩn là một injection do worker áp dụng trước kênh lệnh, cùng đường ý định và biên nhận với lỗi R4. Điểm I/O là một lớp mỏng trong worker đọc tiếp xúc sau mỗi `mj_step`; controller chỉ nhận mẫu đã lọc.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R5-B §2–6](../04-r5-stop-diagnostics-spec.md), [R5-A §8](../03-r5-hardware-electrical-spec.md#8-gói-ứng-viên-phần-cứng-và-drive-model-suy-ra), [contracts §4–6](../05-r5-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: không sửa `FaultOracleV1`, `FaultReportV1`, danh mục 8 lỗi của R4, fixture `drive-v1`, `fault-v1`, `serve-tray-v1`; mọi fixture là thư mục mới (`stop-v1`, `io-v1`); không đổi gain, ngưỡng hay policy của `MJ-TRAY01`.

## Review Focus

1. **Dừng khẩn và lệnh của controller tới cùng một tick:** worker áp dụng dừng khẩn trước; lệnh bị bỏ qua và được đếm; mô-men bằng 0 trong chính tick đó (test ở E12).
2. **Pause, pacing 64×, tab ẩn giữa lúc một lịch dừng đang chờ:** tick áp dụng không đổi vì lịch tính theo thời gian mô phỏng (test ở E12).
3. **Run không về nghỉ trong cửa sổ quan sát** (thả trôi trên khay trơn): metric là `unavailable` với `NOT_AT_REST`, báo cáo vẫn sinh, verdict của oracle không phụ thuộc metric đó (test ở E13).
4. **Report và replay R4 cũ không có `io` hay dừng:** nhập được, hiện "không có dữ liệu", không số 0 (test ở E13, E14).
5. **Mẫu I/O `acyclic` giữa hai lần poll:** controller thấy mẫu cũ kèm tick cũ và không coi nó là mới; quá hạn thì dừng `normal` với `IO_FEEDBACK_STALE` (test ở E14).

---

## Task E11 — Drive model suy từ hồ sơ thiết bị

**Files:**

- Create `source/packages/lab-runtime/src/engineering/electrical/drive-derivation.ts`.
- Modify `source/packages/lab-runtime/src/engineering/electrical/compile.ts` (điền `driveModelDraft`), `source/scripts/generate-drive-fixture.mjs` (sinh thêm fixture mới, không đổi file cũ).
- Create `source/robotics/simulation-mujoco/fixtures/stop-v1/` (ở task này: `serve-drive-hw-a-brake-v1.json`, `serve-drive-hw-a-coast-v1.json`, `serve-control-hw-a-v1.json`, `README.md`, `manifest.json`).
- Test `source/tests/unit/electrical-drive-derivation.test.ts`, `source/tests/unit/drive-fixture.test.ts` (thêm ca; ca cũ không đổi).

**Interfaces:** consumes `DriveModelV1`, `ControlProfileV1`, `validateDriveModel`, `validateControlProfile`, `sealDriveDocument` (`v2/control/drive-io.ts`), `groupMaturity` (`engineering/maturity.ts`); produces

```ts
export function deriveDriveModel(base: DriveModelV1, context: DesignContext): {model: DriveModelV1;
  changes: {axisId: string; field: string; from: unknown; to: unknown; source: SourceRef}[]; unverified: CheckResult[]};
```

- [ ] Viết test trước: hồ sơ cho `feedback.countsPerRev` và `watchdog` có nguồn hãng → hai trường của trục đổi, `changes` có đúng hai mục, `sources.encoder` và `sources.watchdog` thành `manufacturer`, năm nhóm còn lại giữ nguyên nguồn của `base`; nhóm có một trường hãng và một trường giả định giữ `assumed`; `revision` bằng `base.revision + 1`, `id` mới, `digest` hợp lệ; `base` không bị sửa (so `JSON.stringify` trước và sau); drive chỉ có `pv` mà control profile có `accelerationLimit: null` → check `ELD_MODE_UNSUPPORTED` kèm chi tiết "pv needs an acceleration limit"; hồ sơ không có phanh mà `stopFunctions` đòi `torque_off_brake` → check `blocking`.
- [ ] Test mức trưởng thành: `groupMaturity(Object.values(model.sources), [], digest)` trả `'assumed'` khi còn ít nhất một nhóm `assumed`, và `'nominal'` chỉ khi cả bảy nhóm là `manufacturer`. Ghi vào test số nhóm hãng thực của HW-A sau khi nhập hồ sơ.
- [ ] Implement. Một trường chỉ được thay khi `SourceRef` của giá trị trong hồ sơ là `manufacturer`. `watchdogTicks = ceil(ms / 20)`. Giá trị `velocityLimitRadS` suy từ tốc độ định mức của motor qua tỉ số hộp số bằng phép nhân và chia; không dùng hàm siêu việt.
- [ ] Mở rộng generator: `serve-drive-hw-a-brake-v1` = model suy từ `serve-hw-a-v1` với `onDisable:'brake'`; `serve-drive-hw-a-coast-v1` = cùng model với `onDisable:'coast'`, `brakeTorqueNm:null` (khác đúng hai trường, có test). Nếu hồ sơ BLV-R 60 W không có phanh (đợt nghiên cứu ghi phanh chỉ có ở bản 100 W trở lên), biến thể `brake` giữ `brakeTorqueNm` của fixture R4 với nguồn `assumed` và README ghi rõ đây là giả định về một phanh ngoài.
- [ ] Xác nhận fixture R4 giữ byte: `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/drive-fixture.test.ts`. Expected: PASS, manifest `drive-v1` không đổi.
- [ ] Commit `feat: derive a drive model revision from a hardware option`; re-pin Lab.

## Task E12 — Lịch dừng: ba chức năng, ý định và biên nhận

**Files:**

- Create `source/packages/contracts/schemas/stop-evidence-v1.schema.json`; Modify `source/scripts/generate-contracts.mjs` (`navFiles`: `'stop-evidence-v1': 'StopEvidenceV1'`).
- Modify `source/packages/contracts/schemas/{sim3d-worker-v1,physics-evidence-v1,lab-run-v2}.schema.json` (chỉ thêm trường tùy chọn `stopInjections`, `stopReceipts`, `stopIntents`, `stopSchedule`).
- Create `source/packages/lab-runtime/src/v2/control/stop-functions.ts`.
- Modify `source/packages/lab-runtime/src/v2/control/diff-drive-base.ts` (revision controller mới nhận yêu cầu dừng), `source/packages/lab-runtime/src/v2/control/drive-run.ts`, `source/packages/lab-runtime/src/v2/simulation3d/mujoco-mobile.ts`, `source/packages/lab-runtime/src/v2/gateway.ts` (admission `stopSchedule`, health `stopCatalog`).
- Modify `source/robotics/simulation-mujoco/mujoco_worker/{drive_faults.py,mobile_engine.py,session.py,snapshot.py}`.
- Test `source/tests/contracts/stop-contracts.test.ts`, `source/tests/unit/stop-functions.test.ts`, `source/tests/unit/diff-drive-base.test.ts` (thêm ca), `source/robotics/simulation-mujoco/tests/test_stop.py`, `source/tests/integration/mujoco-stop.test.ts`.

**Interfaces:** consumes `DriveGroup.trip`, `faultStartTick` (`v2/control/drive-faults.ts`), `FaultReceipt`; produces

```ts
// v2/control/stop-functions.ts
export type StopFunctionId = 'normal' | 'protective' | 'emergency';
export const MAX_STOP_ENTRIES = 4;
export function validateStopSchedule(entries: readonly StopScheduleEntryV1[], context: {axes: readonly string[]; functions: readonly StopFunctionV1[]; missionEndMs: number | null}): {ok: boolean; reasonCodes: string[]};
export function stopTimeline(entries: readonly StopScheduleEntryV1[], tick: number): {due: StopScheduleEntryV1[]};      // hàm thuần của lịch và tick, như lịch lỗi R4
export function stopIntentsForTick(entries, tick, functions): {controller: {entryId: string; function: 'normal' | 'protective'}[]; worker: StopInjection[]};
```

```python
# drive_faults.py
def apply_stop(group, injections, tick) -> list[dict]   # trip mọi trục trong injection['axes'] với EXTERNAL_TRIP; trả biên nhận; gọi TRƯỚC begin_tick của tick đó
```

- [ ] Negative test admission: run không có drive → `STOP_BACKEND_UNSUPPORTED`; 5 mục → `STOP_SCHEDULE_TOO_LONG`; chức năng không có trong `stopFunctions` của fixture → `STOP_FUNCTION_UNKNOWN`; hai mục cùng thời điểm → `STOP_OVERLAP`; trigger không phải `elapsed_sim_ms` → `STOP_TRIGGER_INVALID`; `protective` trên drive có `stop.quickStop:false` → `STOP_FUNCTION_UNSUPPORTED`. Lịch rỗng → `ok`.
- [ ] Test controller (hàm thuần, không engine): yêu cầu `normal` ở tick *t* → setpoint giảm theo gia tốc thiết kế của policy và lệnh vẫn `enable:true`; yêu cầu `protective` → lệnh có `quickStop:true` từ tick *t* và không lệnh nào sau đó có mục tiêu khác 0; sau `protective`, một setpoint mới từ điều hướng **không** làm controller bỏ `quickStop` (chốt).
- [ ] Test worker (`test_stop.py`, engine thật): injection `emergency` trên hai bánh ở tick *t* cùng lúc với lệnh vận tốc khác 0 → sau `step`, cả hai trục `fault` với `EXTERNAL_TRIP`, mô-men ghi nhận ở mọi substep của tick *t* bằng 0, biên nhận có `appliedTick == t`; với drive model `coast` xe còn vận tốc sau 10 tick, với `brake` vận tốc bánh giảm nhanh hơn (so hai chuỗi, không so với ngưỡng tuyệt đối); `faultReset` giữ ở 1 không xóa lỗi, sườn lên sau khi injection hết thì xóa.
- [ ] Test tích hợp (`mujoco-stop.test.ts`, runtime thật, `MJ-TRAY01`): một run với `stopSchedule` `emergency` và `driveFaultSchedule` `command-loss` phủ cùng tick → biên nhận dừng có mặt, run ở `needs_attention`, không phục vụ; cùng run với pacing 64× cho cùng `appliedTick`; run không có `stopSchedule` cho evidence trùng byte với R4 (so với golden hiện có của `tray-v1`).
- [ ] Viết schema `stop-evidence-v1` phần lịch và biên nhận theo [contracts §4](../05-r5-contracts-and-evidence.md#4-wire-dừng-và-io-trong-một-tick) (phần báo cáo và I/O thêm ở E13, E14). Trường mới trong ba schema mở rộng đều tùy chọn; message và evidence R4 phải còn hợp lệ nguyên byte.
- [ ] Implement theo thứ tự: `stop-functions.ts` → controller revision mới (giữ `diffDriveBaseV1` và revision 2 nguyên vẹn; thêm revision 3 nhận `stopRequest`) → `apply_stop` và gọi nó ở đầu tick trong `mobile_engine.py` → runner ghi ý định trước, đối chiếu biên nhận theo cách `fault-report.ts` đang làm → admission và `stopCatalog` trong health.
- [ ] `pnpm contracts:generate && pnpm contracts:check && pnpm typecheck && pnpm lint`; pytest của tool root; commit `feat: scheduled stop functions with intents and receipts`; re-pin Lab.

`MobileEngine.step` nhận thêm tham số từ khóa `stop_injections=None`; biên nhận nằm trong `read()["stopReceipts"]`. Fixture `mobile_hw_a_coast` và ba helper `cruise`, `wheel_commands`, `substep_torques` là **mới**, thêm vào `tests/conftest.py` trong task này theo cách các fixture drive hiện có được dựng.

```python
# robotics/simulation-mujoco/tests/test_stop.py
def test_emergency_stop_wins_over_a_motion_command_in_the_same_tick(mobile_hw_a_coast):
    eng = mobile_hw_a_coast
    t = cruise(eng) + 1                                   # tick đầu tiên sau khi đạt tốc độ hành trình
    eng.step(0.0, 0.0, commands=wheel_commands(velocity_rad_s=8.0, seq=t),
             stop_injections=[{"entryId": "s1", "function": "emergency", "axes": ["amr-1/wheel-left", "amr-1/wheel-right"]}])
    snapshot = eng.read()
    assert all(d["state"] == "fault" and d["fault"] == "EXTERNAL_TRIP" for d in snapshot["drives"])
    assert max(abs(x) for x in substep_torques(eng)) == 0.0
    assert [r["appliedTick"] for r in snapshot["stopReceipts"]] == [t]
```

## Task E13 — Metric dừng, báo cáo dừng và campaign `stop-v1`

**Files:**

- Modify `source/packages/contracts/schemas/stop-evidence-v1.schema.json` (thêm `StopPolicyV1`, `StopOracleV1`, `StopReportV1`).
- Create `source/packages/lab-runtime/src/v2/control/stop-metrics.ts`, `source/packages/lab-runtime/src/v2/control/stop-report.ts`, `source/packages/lab-runtime/src/v2/control/stop-campaign.ts`, `source/packages/lab-runtime/src/v2/control/stop-hint.ts`.
- Create `source/scripts/generate-stop-fixture.mjs`; thêm vào `source/robotics/simulation-mujoco/fixtures/stop-v1/`: `stop-policy-v1.json`, `stop-oracle-v1.json`, `stop-functions-v1.json`, `survey.json`; Create `source/robotics/simulation-mujoco/campaigns/stop-v1.json`.
- Modify `source/scripts/lab-mujoco.mjs` (nhận `--campaign stop-v1`).
- Test `source/tests/unit/stop-metrics.test.ts`, `source/tests/unit/stop-report.test.ts`, `source/tests/unit/stop-campaign-table.test.ts`, `source/tests/unit/stop-hint.test.ts`.

**Interfaces:** consumes stream `drives`, physics và khay của R4, `createMobileStopMonitor` (`v2/simulation3d/mujoco-mobile.ts`), `runTrayCampaign` làm mẫu; produces

```ts
// stop-metrics.ts
export type Unavailable = {unavailable: 'NOT_AT_REST' | 'NOT_APPLICABLE' | 'STREAM_MISSING' | 'TOO_FEW_SAMPLES' | 'RUN_ENDED'};
export interface StopMetrics {stopTimeMs: number | Unavailable; stopDistanceM: number | Unavailable; peakDecelerationMps2: number | Unavailable;
  torqueZeroTick: number | Unavailable; cupMaxSlipMm: number | Unavailable; cupTipped: boolean | Unavailable; postStopDriftMm: number | Unavailable; wheelSlip: boolean | Unavailable}
export function stopMetrics(input: {appliedTick: number; function: StopFunctionId; base: readonly {tick: number; x: number; y: number; speedMps: number}[];
  drives: readonly DriveTickRecord[] | null; tray: TrayEvidence | null; policy: StopPolicyV1}): StopMetrics;
// stop-campaign.ts
export const STOP_CAMPAIGN = 'stop-v1';
export const STOP_CASES: readonly StopCase[];          // đúng 16 mục: S1 ×4, S2 ×4, S3 ×4, S4 ×1, S5 ×3
export function runStopCampaign(options: CampaignOptions): Promise<StopCampaignVerdict>;
export function verifyStopCampaign(dir: string): Promise<StopCampaignVerdict>;
// stop-hint.ts
export function stopHint(a: StopReportV1, b: StopReportV1): {vi: string; ja: string; en: string} | null;   // null khi hai run khác quá một input hoặc thiếu metric
```

- [ ] Đọc `prepareMobileStopMonitor` và `createMobileStopMonitor` trước khi viết. Phần nào đã đo đúng định nghĩa ở [contracts §5](../05-r5-contracts-and-evidence.md#5-định-nghĩa-metric-dừng) thì gọi lại; không viết bộ đo thứ hai cho cùng một đại lượng.
- [ ] Test metric trên vector giải tích (không engine): xe đi 0,8 m/s, giảm tốc đều 0,5 m/s² từ tick 100 → `stopTimeMs` 1600 và `stopDistanceM` 0,64 trong dung sai một tick (`0,8² / (2 × 0,5) = 0,64`); chuỗi không bao giờ xuống dưới `restSpeedMps` → cả hai là `{unavailable:'NOT_AT_REST'}`; `function:'normal'` → `torqueZeroTick` là `NOT_APPLICABLE`; `drives: null` → `STREAM_MISSING`; run không có khay → `cupMaxSlipMm` là `NOT_APPLICABLE`.
- [ ] Test bảng campaign: `STOP_CASES` có 16 mục với id duy nhất; S4 có cả `stopSchedule` và `command-loss`; ba mục S5 giống hệt nhau trừ `repeat`; mọi mục dùng `MJ-TRAY01`.
- [ ] Test báo cáo: dựng từ stream, không đọc lại lịch làm bằng chứng; mục không có biên nhận → `not_fired`; năm invariant theo [contracts §6](../05-r5-contracts-and-evidence.md#6-oracle-và-invariant) với kết quả `pass`, `violated`, `not_applicable`, `not_evidenced`; `decidingParameters` liệt kê cản lăn, ma sát caster, mô-men phanh kèm `SourceRef` đọc từ fixture; `accepted:false`.
- [ ] Test câu gợi ý: hai report khác đúng `function` và có đủ metric → ba chuỗi khác rỗng, mỗi chuỗi chứa hai quãng đường và kết bằng câu về bài thả trôi; khác cả tốc độ → `null`; một bên `NOT_AT_REST` → `null`.
- [ ] Sinh fixture: `stop-policy-v1` với giá trị ở contracts §5; `stop-oracle-v1`; `survey.json` ghi tick đạt tốc độ hành trình ổn định và tốc độ đó, lấy từ **một run khảo sát thật** của `MJ-TRAY01` biến thể A (chạy, đọc, ghi; không ước lượng). Tốc độ không đạt 0,8 m/s → áp dụng [README §4](README.md#4-khi-nào-dừng-một-nhánh).
- [ ] Implement runner theo mẫu `tray-campaign.ts` (cùng cách dựng runtime, cùng `campaign.json`, cùng verifier dựng lại từ artifact). Ghi campaign ra ngoài repo:

```sh
caffeinate -dims perl -e 'alarm 5400; exec @ARGV' node scripts/lab-mujoco.mjs run --campaign stop-v1 --out ../evidence-archive/r5-stop-v1-$(git log -1 --format=%h -- . ':(exclude)apps/lab')
node scripts/lab-mujoco.mjs verify --input ../evidence-archive/r5-stop-v1-<sha>
```

Thư mục đặt tên theo commit source tính theo đường dẫn, là commit mà `lab-mujoco.mjs` ghi vào campaign; `HEAD` có thể là một commit pin nằm trên nó.

- [ ] Expected: 16/16 run có artifact; verifier exit 0; ba run S5 trùng bit; oracle không fail vì quãng đường hay độ trượt. Ghi vào commit message bốn `stopDistanceM` của nhóm S1 (hoặc lý do `unavailable`).
- [ ] CLD04 của R5.3: một run S1 `emergency`+`coast` trong image arm64.
- [ ] Commit `feat: stop metrics, stop report and the stop-v1 campaign`; re-pin Lab.

## Task E14 — I/O ảo, lỗi I/O và campaign `vio-v1`

**Files:**

- Create `source/robotics/simulation-mujoco/probe_io.py`, `source/docs/research/2026-12-virtual-io-spike.md` (spike).
- Create `source/robotics/simulation-mujoco/mujoco_worker/io_model.py`; Modify `mobile_engine.py`, `session.py`, `snapshot.py`, `drive_faults.py`.
- Modify `source/packages/contracts/schemas/{stop-evidence-v1,sim3d-worker-v1,physics-evidence-v1,navigation-scene-v1,lab-run-v2}.schema.json` (thêm `IoModelV1`, `IoPointSnapshotV1`, lỗi I/O, `engine.ioModelRef`, `ioFaultSchedule`; tất cả tùy chọn).
- Create `source/packages/lab-runtime/src/v2/control/io-points.ts`, `source/packages/lab-runtime/src/v2/control/io-faults.ts`, `source/packages/lab-runtime/src/v2/control/io-campaign.ts`.
- Create `source/robotics/simulation-mujoco/fixtures/io-v1/` (`io-model-hw-a-v1.json`, `io-fault-oracle-v1.json`, scene `MJ-IO01`, `README.md`, `manifest.json`), `source/robotics/simulation-mujoco/campaigns/vio-v1.json`.
- Test `source/robotics/simulation-mujoco/tests/test_io_model.py`, `source/tests/unit/io-points.test.ts`, `source/tests/unit/io-faults.test.ts`, `source/tests/integration/mujoco-io.test.ts`.

**Interfaces:** consumes `ContactAccumulator` và `_sample_contacts` của `mobile_engine.py`, `ElectricalBundleV1.allocation`; produces

```python
# io_model.py: không import mujoco
class IoGroup:
    def __init__(self, model: dict, substeps: int): ...
    def sample(self, raw: dict[str, bool]) -> None          # gọi sau mỗi mj_step với trạng thái thật của từng điểm
    def stage_faults(self, injections: list[dict]) -> None  # di-stuck-on / di-stuck-off
    def end_tick(self, tick: int) -> list[dict]             # [{'pointId','value','valid','sampleTick','actual'}]
```

```ts
// io-points.ts
export function splitIoSnapshot(io: readonly IoPointSnapshotV1[]): {feedback: IoFeedback[]; evidence: IoPointSnapshotV1[]};   // feedback không có 'actual'
export function ioFresh(sample: IoFeedback, tick: number, model: IoModelV1): boolean;
// io-faults.ts
export type IoFaultId = 'di-stuck-on' | 'di-stuck-off' | 'io-bus-loss';
export const IO_FAULTS: Readonly<Record<IoFaultId, {layer: 'io' | 'channel'; appliedBy: 'worker' | 'runtime'; params: Readonly<Record<string, FaultParamBound>>}>>;
```

- [ ] **Spike trước, không sửa worker:** `probe_io.py` dựng scene `serve-payload-v1` thêm một hộp tĩnh cao 0,08 m cách điểm xuất phát 2 m trên đường thẳng, chạy xe ở 0,2 m/s. Ghi: tick tiếp xúc đầu tiên, geom nào chạm, xe có nghiêng quá 2° không, và 3 lần lặp có trùng bit không. Kỳ vọng: tiếp xúc giữa geom thân xe và hộp, không lật, trùng bit. Không đạt → dừng task theo [README §4](README.md#4-khi-nào-dừng-một-nhánh), commit tài liệu spike, G-VIO1 `not_run`.

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 900; exec @ARGV' .venv-mujoco/bin/python -I -B robotics/simulation-mujoco/probe_io.py --out /tmp/mekoniq-io-spike
```

- [ ] Test `IoGroup` (không engine): lọc rung 5 substep — 4 substep đúng không đổi giá trị, 5 thì đổi; điểm `acyclic` với `pollEveryTicks: 3` chỉ đổi `sampleTick` mỗi 3 tick; `di-stuck-off` giữ `value:false` trong khi `actual:true`; `di-stuck-on` ngược lại; hết cửa sổ lỗi thì `value` theo `actual` sau đúng thời gian lọc rung.
- [ ] Test TS: `splitIoSnapshot` trả `feedback` có đúng các khóa `['pointId','sampleTick','valid','value']`; `ioFresh` sai khi `tick − sampleTick` vượt `2 × pollEveryTicks`.
- [ ] Test controller: `bumper-front` đúng và mới → yêu cầu `protective`, lý do `BUMPER_ACTIVE`; đúng từ tick đầu → không có lệnh chuyển động nào; mẫu không mới → dừng `normal`, lý do `IO_FEEDBACK_STALE`.
- [ ] Test tích hợp (`mujoco-io.test.ts`, `MJ-IO01`): danh định → tiếp xúc, DI đúng sau thời gian lọc, dừng `protective`, quãng đường sau tiếp xúc được ghi; `di-stuck-off` → controller **không** nhận tín hiệu, verdict `not_detected_as_declared`, và giám sát bám vận tốc của R4 (`TRACKING_DEGRADED`) là bên phát hiện muộn hơn; `di-stuck-on` → không chuyển động, phát hiện trong hạn của oracle; `io-bus-loss` → `IO_FEEDBACK_STALE` trong hạn; scene không có `ioModelRef` cho evidence trùng byte R4.
- [ ] Implement worker rồi runtime. `io-model-hw-a-v1.json` do generator sinh từ `serve-hw-a-v1`: cách lộ ra bus và chu kỳ poll lấy từ điểm I/O mà bundle đã gán cho `bumper-front` và `estop-status`; `debounceSubsteps` là `assumed`.
- [ ] Đo chi phí tick trước và sau trên `MJ-TRAY01` bằng `scripts/native-sim/tick-cost-probe.mjs`; ghi JSON. Vượt ngân sách → áp dụng điều kiện dừng về ngưỡng reader.
- [ ] Ghi và kiểm campaign `vio-v1` (tối thiểu 10 run) ra `../evidence-archive/r5-vio-v1-<sha>`, cùng cách với `stop-v1`. Expected: verifier exit 0; ba run danh định cùng seed trùng bit.
- [ ] CLD04 của R5.3b: một run danh định `MJ-IO01` trong image arm64.
- [ ] Commit `feat: virtual digital inputs, I/O faults and the vio-v1 campaign`; re-pin Lab.

**Exit:** G-STP1 kiểm được; G-VIO1 kiểm được hoặc `not_run` có lý do và số đo spike.
