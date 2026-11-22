# R4.1 Virtual Drive and Controller-in-the-Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AMR và tay máy MuJoCo chạy qua một drive ảo có trạng thái, giới hạn, encoder và trễ; controller thuần chỉ đọc phản hồi đo được; campaign CIL có evidence theo trục.

**Architecture:** Vòng lặp và giới hạn của drive là actuator gốc của MuJoCo; module thuần `drive_model.py` trong worker thêm máy trạng thái, kênh lệnh/phản hồi và watchdog ở mỗi substep; hai controller TS chuyển setpoint hiện có thành `DriveCommandV1`. Drive là tùy chọn theo cặp ref trong scene; không có ref thì đường R2b giữ nguyên byte.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R4-A §2–5, §8](../02-r4-control-chain-spec.md), [contracts §1–5, §7, §9](../05-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: không đổi gain, ngưỡng, policy hay fixture R2b; mọi fixture drive là file mới; chế độ lệnh chỉ `csp` và `csv`.

## Review Focus

1. **Run vừa tạo, drive còn `disabled`:** robot không được nhúc nhích trước khi trình tự enable xong, và mission không được hết hạn im lặng trong lúc chờ (test ở V04).
2. **Encoder thô khi đứng yên:** phản hồi lượng tử rung quanh 0 không được làm controller báo `TRACKING_DEGRADED` giả hay làm odometry trôi (test ở V04).
3. **Lỗi drive lúc tay đang giữ cốc:** trục phanh, cốc vẫn giữa hai má, custody không đổi, không có lệnh mở kẹp (test ở V04).
4. **Pause, pacing 64×, tab ẩn:** không sinh `COMMAND_TIMEOUT` vì watchdog đếm tick mô phỏng (test ở V03 và V04).
5. **Report và replay R2b cũ không có `drives`:** nhập được, hiện "không có dữ liệu drive", không số 0 (test ở V05).

---

## Task V00 — Khóa baseline sau R2b/R3

**Files:**

- Create `source/docs/implementation/post-r2b-baseline.md`. Read `lab/config/source-runtime.lock.json`, `source/docs/implementation/web-lab-to-physical/status-*.md`, các record trong `source/docs/implementation/evidence/`.
- Modify `lab/src/ui/workspace.ts` (`frame()`), `lab/tests/unit/workspace-generation.test.ts`.

**Interfaces:** consumes tuple R2b/R3 đã đóng; produces tài liệu baseline gồm source/Lab HEAD, pin, schema hash, closure, engine lock, digest fixture, tên và hash golden, trạng thái từng gate, giới hạn còn mở, số đo chi phí tick trên Mac và trên cloud; và bản sửa lỗi hiển thị của run cell đã hoàn thành. Không có API mới.

- [ ] Chụp `git -C source status --short`, `git -C lab status --short`, HEAD hai repo, nội dung lock. Cây bẩn hoặc pin lệch → dừng và báo, không tự sửa.
- [ ] Sửa lỗi hiển thị của baseline ở Lab, viết test dưới đây và chạy fail trước. Run cell `completed` phải giữ khung cuối sau khi ticker dừng: trong `frame()`, cặp world/view không hết hạn theo 500 ms khi `run.status` là `completed`, và khung cuối đó không mang nhãn `stale`. `paused`, `cancelled` và `failed` giữ hành vi hiện tại. Thay đổi đủ dùng là thêm `done=this.view?.run.status==='completed'` và đổi điều kiện thành `stale=held&&!done&&performance.now()-this.worldReceived>500`; ngày 19/11 đã thử ngoài repo: test mới fail trên code hiện tại và cả 35 test đạt với thay đổi này. Chạy lại `tests/unit/workspace-generation.test.ts` (34 test hiện có phải đạt) và `pnpm typecheck`. Commit Lab `fix: keep the final frame of a completed cell run`. Bản sửa này độc lập với R4 và không đổi pin; nếu người dùng muốn demo sớm thì đưa thẳng lên `lab/main` trước khi mở nhánh R4.
- [ ] Chạy guard hiện có trên record đang ở trong cây và ghi nguyên kết quả: `LAB_SIMEXT_EVIDENCE_DIR=<record> pnpm test:acceptance -- sim-extension`, `LAB_IRSIM_EVIDENCE_DIR=<record> pnpm test:acceptance -- linkforge-irsim`. R2b còn G-WEB1 `not_run` thì ghi đúng như vậy và liệt kê task R4 nào bị chặn.
- [ ] Ghi tên và hash các golden: mock BV01, IR-SIM chunk, Webots bytes, MJ-BV01, payload 19 ca, cell 3 seed + 5 fault, ba replay package.
- [ ] Đo chi phí tick của cell bằng probe hiện có và ghi JSON nguyên văn: `node scripts/native-sim/tick-cost-probe.mjs --ticks 1500 --seed 1 --chunk 25`. Số đối chiếu ngày 19/11 trên máy phát triển: 13,3 ms/tick.
- [ ] Baseline cloud: đọc `GET /lab/v2/health` của dịch vụ Cloud Run và ghi `sourceCommit`, `schemaHash`, danh sách scenario. Chạy `MJ-CELL-BV01` trên dịch vụ đó từ Lab, với khóa truy cập do người dùng đặt trong môi trường; ghi phục vụ, tick cuối, thời gian tường, ms/tick và tốc độ thật. Không có khóa → ghi `not_run` kèm lý do rồi đi tiếp. Không tự tìm khóa, không deploy.
- [ ] Commit `docs: lock the post-R2b baseline for R4`.

```ts
// lab/tests/unit/workspace-generation.test.ts — cellLoop và observe là helper đã có trong file
test('a completed cell run keeps its final committed frame after the ticker stops',async()=>{
 const {internal,observe}=await cellLoop('running'),{sceneEntities}=await import('../../src/twin/scene');
 observe(9,13,{status:'completed'});await internal.refreshWorld();await internal.refreshWorld();expect(internal.ticker).toBeUndefined();
 const live=sceneEntities(internal.frame());expect(live.length).toBeGreaterThan(0);
 internal.worldReceived=performance.now()-600;
 const f=internal.frame();expect(f.world?.quality).toBe('valid');expect(sceneEntities(f).map(e=>e.id)).toEqual(live.map(e=>e.id));
});
```

**Exit:** baseline review được; gate thiếu được nêu rõ kèm task bị chặn; run cell đã hoàn thành giữ hình 3D; số chi phí tick trên Mac đã ghi, số trên cloud đã ghi hoặc `not_run` có lý do. Không tự đưa record nào thành accepted.

### V00 — phần làm thêm sau review ngày 19/11 (đã xong)

V00 đã chạy: Lab `260f4aa` (bản sửa hiển thị đầu) và source `c19785d` trên nhánh `r4/virtual-commissioning` (tài liệu baseline). Review cho thấy bước sửa ở trên của plan này quá hẹp và test của nó có một assertion rỗng. Phần làm thêm nằm ở Lab `65a4593` và ở bản sửa của tài liệu baseline:

- `frame()` giữ cặp world/view khớp đúng view hiện tại (cùng run, tick, revision) cho run `completed`, `cancelled` và `needs_attention`. Cặp cũ hơn view chỉ được giữ 500 ms, hoặc vẽ `stale` khi run đang `running`.
- `refreshWorld()` chỉ dừng đọc cho run đã kết thúc khi đã giữ cặp của view cuối, hoặc khi runtime nói không còn world; không dừng khi còn action đang chạy. Lý do: runtime tick tiếp tới hết bước sau khi nhiệm vụ xong và chỉ tăng revision khi bước trả về. Lần đọc lỗi hoặc lệch horizon được đọc lại, tối đa 75 lần. View đổi sau khi đã dừng thì đọc lại.
- Lần đọc lỗi không làm mất khung cuối đã giữ của run đã kết thúc; run đang chờ xử lý thì vẫn hiện lỗi.
- Nhãn tuổi quan sát ẩn ở ba trạng thái trên.

Đã kiểm: 49 test của `workspace-generation.test.ts`, 537 test unit của Lab, `tsc --noEmit`; chạy thật qua trình duyệt trên runtime local cho ca hoàn thành và ca hủy; chạy không qua trình duyệt với runtime thật ở ba trạng thái kết thúc.

**Chưa sửa, để lại cho V09:** run có `world-cup-fall-v1` vẫn trống hình khi dừng. `applyView()` xóa world khi lý do dừng khớp `WORLD_UNKNOWN|WORLD_RESTART|ENGINE_|WORKER_|PLANT_|PHYSICAL_UNKNOWN`, rồi hiện nhãn sai `WORLD_SCENE_IDENTITY_MISMATCH` và đọc lại liên tục. Mọi demo lỗi của R4.3 kết thúc ở `needs_attention`, nên V09 phải quyết định quy tắc này và đặt mã lỗi drive sao cho hình còn hiện.

## Task V01 — Spike: drive trên actuator gốc của engine

**Files:**

- Create `source/robotics/simulation-mujoco/probe_drive.py`, `source/docs/research/2026-11-virtual-drive-spike.md`, thư mục output thô `source/docs/research/virtual-drive-spike/`.
- Không sửa module nào của worker ở task này.

**Interfaces:** consumes `compile_mobile`, `compile_cell`, `torque_limits` hiện có; produces bảng quyết định trong tài liệu spike: cách bật/tắt trục, cách phanh, cách trễ lệnh, ánh xạ gain của control profile sang thuộc tính actuator, giá trị khởi điểm của năm thí nghiệm drive ([R4-A §5.4](../02-r4-control-chain-spec.md#54-thí-nghiệm-cil-có-đăng-ký)), chi phí thêm mỗi tick.

Đã kiểm trước ngày 19/11 trên wheel đã cài (arm64), với model một khớp ([nghiên cứu §1.1](../01-research.md#11-kiểm-lại-sau-khi-r3-đã-push-và-deploy-1911)): `pid` với `ki=0` trùng bit với `position`; `delay` gốc dời đáp ứng đúng số substep và đổi được lúc chạy qua `actuator_delay`; bộ đệm trễ với `delay=0` trùng bit; bit nhóm của `disableactuator` cho lực 0; đổi `forcerange` lúc chạy có hiệu lực. Spike này lặp lại các điểm đó trên model thật của cell và làm phần chưa kiểm: trạng thái tích phân khi tắt trục, phanh, đường worker, chi phí. Mọi kết luận trùng bit chỉ áp dụng cho kiến trúc đã chạy; output ghi `platform.machine()`.

- [ ] Viết probe dựng model mobile (`serve-payload-v1`, tải `cup-center`) và model arm (`xarm6-g2-v1`) bằng compiler hiện có, rồi chạy cùng một chương trình lệnh theo hai đường: legacy (đặt `ctrl` trực tiếp) và có lớp cổng (lệnh đi qua máy trạng thái và kênh lệnh tối giản cài ngay trong probe).
- [ ] Ca 1 — model lý tưởng: 300 tick mobile và 300 tick arm, so `qpos`, `qvel` từng tick bằng `numpy.array_equal`. Kỳ vọng trùng bit. Không trùng → ghi tick lệch đầu tiên và độ lệch, dừng task. Ghi thêm SHA-256 của chuỗi `qpos`/`qvel` theo tick của đường legacy (mobile 300 tick, arm 300 tick, world 500 tick) vào tài liệu spike, kèm kiến trúc. Đó là mốc của đường legacy trước khi V03 sửa engine: `MJ-BV01` chưa có digest nào được commit, test hiện có của nó chỉ so trong dung sai.
- [ ] Ca 2 — actuator `pid` của engine: đổi actuator của hai bánh và của một khớp sang `pid` với `ki > 0` và giới hạn tích phân, chạy bước nhảy. Kỳ vọng không có cảnh báo BADQPOS/BADQVEL/BADQACC và đáp ứng hội tụ. Ghi ánh xạ chính xác từ `kp`/`ki`/`kd`/`integralLimit`/`slewLimit` sang thuộc tính actuator, kèm giá trị đọc lại từ `MjModel`.
- [ ] Ca 3 — bật/tắt và phanh: so hai cách tắt trục (nhóm actuator với `disableactuator`; `forcerange` bằng 0) trên cùng kịch bản; chọn cách cho lực đúng bằng 0 và không để trạng thái tích phân chạy tiếp khi tắt. Phanh bằng ma sát khớp: tay máy tắt drive giữ tư thế trong 500 tick với `brake` và chuyển động với `coast`.
- [ ] Ca 4 — trễ lệnh: hàng đợi phía probe so với `delay` gốc của actuator ở 1, 10 và 50 substep; ghi sai khác đầu ra và cách nào đổi được độ trễ lúc chạy (lỗi `command-delay` cần điều đó).
- [ ] Ca 5 — lặp và chi phí: mỗi cấu hình chạy 3 lần, kỳ vọng trùng bit; đo thời gian tường mỗi tick của vòng lặp probe với 2 trục và với 9 trục, 2.000 tick mỗi lần, ghi p50/p95.
- [ ] Ghi tài liệu spike: phương pháp, số đo, quyết định cho từng mục trên, giá trị khởi điểm đã chọn kèm nhãn `assumed`, và mô tả phương án định hình tham chiếu cùng điều kiện mở (chỉ mô tả, không cài). Commit `docs: record the virtual drive numerics spike`; re-pin Lab.

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 900; exec @ARGV' .venv-mujoco/bin/python -I -B robotics/simulation-mujoco/probe_drive.py --out /tmp/mekoniq-drive-spike
```

**Exit:** các quyết định cơ chế được khóa bằng số đo, hoặc gói 01–02 dừng theo [README §4](README.md#4-khi-nào-dừng-một-nhánh) với artifact giữ nguyên.

## Task V02 — Hợp đồng drive, fixture và mock drive

**Files:**

- Create `source/packages/contracts/schemas/{drive-model-v1,control-profile-v1,drive-io-v1,control-evidence-v1}.schema.json`.
- Modify `source/packages/contracts/schemas/{sim3d-worker-v1,physics-evidence-v1,world-evidence-v1,navigation-scene-v1,arm-cell-scene-v1,lab-world-scene-v1}.schema.json`, `source/scripts/generate-contracts.mjs` (thêm bốn schema vào `navFiles`).
- Create `source/scripts/generate-drive-fixture.mjs`, `source/robotics/simulation-mujoco/fixtures/drive-v1/` (bảy drive model: `serve-drive-{ideal,nominal,torque-limited,latency,coarse-encoder}-v1.json`, `xarm6-drive-{ideal,nominal}-v1.json`; `serve-control-v1.json`, `xarm6-control-v1.json`, `tuning-envelope-v1.json`, `control-oracle-v1.json`, `README.md`, `manifest.json`).
- Create `source/packages/lab-runtime/src/v2/control/{drive-io,controller,mock-drive}.ts`.
- Test `source/tests/contracts/drive-contracts.test.ts`, `source/tests/unit/{drive-io,mock-drive,drive-fixture}.test.ts`.

**Interfaces:** produces

```ts
// control/drive-io.ts
export type {DriveModelV1, ControlProfileV1, DriveCommandV1, DriveFeedbackV1, DriveAxisSnapshot};
export function validateDriveModel(value: unknown): {ok: boolean; reasonCodes: string[]};
export type {TuningEnvelopeV1, AxisEnvelope};   // AxisEnvelope: biên {min, max} cho kp, ki, kd, integralLimit, slewLimit, accelerationLimit của một trục
export function validateControlProfile(value: unknown, model: DriveModelV1, envelope: TuningEnvelopeV1): {ok: boolean; reasonCodes: string[]};
export function validateDriveRefs(scene: {engine: Record<string, unknown>}): {ok: boolean; reasonCodes: string[]};
export function splitDriveSnapshot(drives: readonly DriveAxisSnapshot[]): {feedback: DriveFeedbackV1[]; evidence: DriveAxisSnapshot[]};
// control/controller.ts: MotionController, ControllerEvent đúng như R4-A §5.3
// control/mock-drive.ts: protocol double, không phải plant
export function createMockDrive(model: DriveModelV1, control: ControlProfileV1): {
  step(commands: readonly DriveCommandV1[]): DriveAxisSnapshot[]};
// scripts/generate-drive-fixture.mjs
export function generateDriveFixture(outDir: string): Promise<void>;
```

- [ ] Viết negative schema test: thiếu một trong hai ref; trục trùng id; 17 trục; `mode` lạ; `countsPerRev` ≤ 0; `onDisable:'brake'` thiếu `brakeTorqueNm`; `followingError` trên trục `csv`; `kd` khác 0 trên trục `csv`; `ki > 0` thiếu `integralLimit`; gain âm, NaN; gain ngoài envelope; `scale` ngoài (0, 1]; path thoát bundle; digest sai; trường lạ. Positive: `serve-drive-nominal-v1.json` và `serve-control-v1.json` từ fixture.
- [ ] Chạy để thấy validator và fixture chưa có.
- [ ] Viết schema theo [contracts §2–3](../05-contracts-and-evidence.md#2-tài-liệu-mới). Trường mới trong `sim3d-worker-v1`, `physics-evidence-v1`, `world-evidence-v1` (lệnh và bản ghi của cell) và ba schema scene đều tùy chọn; message và scene R2b phải còn hợp lệ nguyên byte.
- [ ] Sinh fixture tất định từ số đã khóa ở V01. `serve-drive-ideal-v1`/`xarm6-drive-ideal-v1`: không lượng tử, trễ 0, `watchdogTicks:null`, `enableDelaySubsteps:0`; control profile có gain bằng gain R2b: bánh `kp = velocityGainNmsPerRad`, `kd:0`; khớp `kp` và `kd` lấy `kp`/`kv` của `physics.json`; mọi trục `ki:0`, `integralLimit:null`, `slewLimit:null`. Mọi nguồn `assumed`, `calibration:'not_calibrated'`.
- [ ] Viết `splitDriveSnapshot` và test danh sách khóa của phần `feedback`.
- [ ] Viết mock drive: trục động học lý tưởng theo lệnh, cùng máy trạng thái và watchdog theo đặc tả, gắn nhãn `protocol_double` trong identity. Test: lệnh tới trục `disabled` bị bỏ; watchdog theo số lần `step`.
- [ ] Sinh fixture hai lần vào hai thư mục tạm và so byte; `pnpm contracts:generate && pnpm contracts:check`; focused tests; commit `feat: define the neutral drive contract and drive fixtures`; re-pin Lab.

```ts
import {expect, test} from 'vitest';
import {splitDriveSnapshot, validateDriveRefs} from '../../packages/lab-runtime/src/v2/control/drive-io';

test('a scene with a drive model but no control profile is refused', () => {
  const scene = {engine: {id: 'mujoco_3d', driveModelRef: {id: 'serve-drive-nominal-v1', revision: 1, sha256: 'a'.repeat(64), path: 'serve-drive-nominal-v1.json'}}};
  expect(validateDriveRefs(scene)).toEqual({ok: false, reasonCodes: ['DRIVE_PROFILE_PAIR_REQUIRED']});
});
test('the controller view carries no true state', () => {
  const axis = {axisId: 'amr-1/wheel-left', state: 'enabled', fault: null, commandSeq: 3, positionRad: 1, velocityRadS: 2, torqueNm: 0.5, tick: 7,
    targetApplied: 2, actualPositionRad: 1.0004, actualVelocityRadS: 2.01, saturatedSubsteps: 0, followingErrorRad: null} as const;
  const {feedback} = splitDriveSnapshot([axis]);
  expect(Object.keys(feedback[0]!).sort()).toEqual(['axisId', 'commandSeq', 'fault', 'positionRad', 'state', 'tick', 'torqueNm', 'velocityRadS']);
});
```

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/contracts/drive-contracts.test.ts tests/unit/drive-io.test.ts tests/unit/mock-drive.test.ts tests/unit/drive-fixture.test.ts
pnpm contracts:generate && pnpm contracts:check
```

## Task V03 — Drive model trong worker

**Files:**

- Create `source/robotics/simulation-mujoco/mujoco_worker/drive_model.py`.
- Modify `source/robotics/simulation-mujoco/mujoco_worker/{compile,compile_mobile,compile_world,engine,mobile_engine,world_engine,session,snapshot,protocol}.py`.
- Test `source/robotics/simulation-mujoco/tests/{test_drive_model,test_drive_engine}.py`, `source/tests/integration/mujoco-drive-worker.test.ts`.

**Interfaces:** consumes fixture và schema của V02, các quyết định đã khóa ở V01; produces

```python
# drive_model.py: không import mujoco
def quantize(angle_rad: float, counts_per_rev: int | None) -> float
def actuator_spec(axis_model: dict, axis_control: dict) -> dict   # loại actuator và thuộc tính MJCF theo ánh xạ đã khóa ở V01; compiler dùng
class DriveGroup:
    def __init__(self, model: dict, control: dict, dt_s: float, substeps: int, axis_limits: dict): ...
    def begin_tick(self, commands: list[dict]) -> None        # kiểm hết rồi mới đổi trạng thái; WorkerError(code) nếu từ chối
    def substep(self, true_pos, true_vel) -> dict             # {'ctrl': ndarray, 'force_scale': ndarray, 'active': ndarray[bool], 'braked': ndarray[bool]}
    def sample(self, true_pos, true_vel, torque, saturated) -> None   # gọi sau mỗi mj_step: kênh phản hồi và trace
    def end_tick(self) -> list[dict]                          # DriveAxisSnapshot từng trục, thứ tự theo model
    def trace(self) -> list[dict]                             # rỗng trừ khi bench (V06)
```

Worker: `create` đọc hai file ref khi scene có cặp ref, dựng `DriveGroup`; `step` nhận `driveCommands` theo quy tắc [contracts §3](../05-contracts-and-evidence.md#3-wire-một-tick-có-drive); snapshot thêm `drives`. `protocol.py` thêm năm mã từ chối `DRIVE_*`. Vòng lặp servo là actuator của engine; `DriveGroup` không tính mô-men.

Ba điều cần nhớ từ nguồn engine ([nghiên cứu U07–U09](../01-research.md#31-dự-án-plc--mujoco-engine-và-các-chuẩn-liên-quan)): actuator `pid` nhận nhiều ô `ctrl`, nên mọi chỗ ghi `ctrl` phải lập chỉ mục theo `actuator_ctrladr`, không theo id actuator như code hiện tại; mỗi trục có drive cần một nhóm actuator riêng trong 0–30 để tắt độc lập; sức chứa bộ đệm trễ gốc (`nsample`) cố định lúc compile.

- [ ] Viết test Python thuần, chạy fail trước: `quantize(0.001, 4096)` trả bội gần nhất của `2π/4096`; trục `disabled` bỏ qua lệnh và ghi nhận; trình tự enable mất đúng `enableDelaySubsteps`; `faultReset` giữ nguyên ở 1 không xóa lỗi thứ hai; watchdog chốt `COMMAND_TIMEOUT` sau đúng `watchdogTicks` tick có `seq` không đổi; `seq` giảm bị từ chối trước khi đổi trạng thái; trễ lệnh *n* substep dời đầu ra đúng *n* mẫu; nội suy `linear` cho mẫu giữa tick nằm giữa hai lệnh; phản hồi trễ đúng `feedbackDelaySubsteps`; vận tốc phản hồi là sai phân của vị trí đã lượng tử trên `velocityWindowSubsteps`; phản hồi không hợp lệ liên tục `feedbackLossSubsteps` substep chốt `FEEDBACK_LOSS`; `actuator_spec` trả actuator vị trí/vận tốc khi `ki = 0` và không có slew, trả `pid` khi có.
- [ ] Viết `drive_model.py` theo thứ tự substep của contracts §3 và các quyết định đã khóa ở V01.
- [ ] Viết test engine thật, chạy fail trước: đường legacy (scene không có ref) cho đúng ba digest đã ghi ở V01 trên cùng kiến trúc; model lý tưởng trùng bit với đường legacy trên mobile 300 tick, arm 300 tick và world 500 tick; gain đọc lại từ `MjModel` bằng gain của control profile cho cả hai loại actuator; arm với `onDisable:'brake'` giữ tư thế khi tắt drive, cùng model với `coast` thì khớp chuyển động (chứng minh phanh là mô hình, không phải khóa pose); mô-men bánh không vượt đường đặc tính nhân `scale`; profile có `ki > 0` compile thành actuator `pid` và bước nhảy hội tụ; trạng thái sau `pause` 10 giây tường rồi `resume` không có `COMMAND_TIMEOUT`; không đường nào của lớp drive ghi vào `qpos`/`qvel`.
- [ ] Nối `DriveGroup` vào ba engine quanh các lần `mj_step`. Compiler lấy loại actuator và gain từ `actuator_spec`; tầm lệnh kiểm ở `begin_tick`. Scene không có ref đi đúng nhánh cũ, không dựng `DriveGroup`.
- [ ] Chạy lại toàn bộ pytest của worker và các test integration R2b của mobile, arm, cell; xác nhận golden không đổi.
- [ ] Đo chi phí tick bằng `tick-cost-probe` theo cặp xen kẽ trong cùng phiên: legacy rồi cell có drive trên 9 trục, ít nhất 3 cặp, ghi load average. So hai số tách riêng: phần không tính ghi bền, `(wallMs − fsyncTotalMs)/ticks`, là phần lớp drive tác động (ngày 19/11: 10,2–11,0 ms/tick qua ba lần đo); và số fsync mỗi tick, phải giữ 1,119. Không so với một số tuyệt đối đo ở phiên khác: tổng ms/tick dao động 13,3–16,6 theo độ trễ ghi bền của máy. Ghi số vào tài liệu spike. Vượt ngân sách → áp dụng [README §4](README.md#4-khi-nào-dừng-một-nhánh).
- [ ] Worker ghi `hostArch` (`platform.machine()` chuẩn hóa về `arm64` hoặc `x86_64`) vào identity nó trả khi mở phiên; runtime chép vào manifest của run. Test: trường có mặt và thuộc hai giá trị đó; report cũ không có trường vẫn nhập được. Trường này vào hash ở đâu: xem [contracts §1](../05-contracts-and-evidence.md#1-identity-và-tương-thích), chốt ngày 19/11.
- [ ] Commit `feat: step MuJoCo axes through a virtual drive model`; re-pin Lab.

```python
import math, pytest
from mujoco_worker.drive_model import quantize
from mujoco_worker.protocol import WorkerError

def test_quantize_snaps_to_encoder_counts():
    step = 2 * math.pi / 4096
    assert quantize(0.001, 4096) == pytest.approx(round(0.001 / step) * step, abs=1e-15)
    assert quantize(0.001, None) == 0.001

def test_watchdog_trips_after_stale_ticks(nominal_group):          # watchdogTicks = 5
    nominal_group.enable_all()
    for _ in range(5):
        nominal_group.begin_tick(nominal_group.commands(seq=1, target=1.0)); nominal_group.run_substeps()
    assert nominal_group.states() == ['enabled', 'enabled']
    nominal_group.begin_tick(nominal_group.commands(seq=1, target=1.0)); nominal_group.run_substeps()
    assert nominal_group.faults() == ['COMMAND_TIMEOUT', 'COMMAND_TIMEOUT']

def test_decreasing_seq_is_refused_before_any_mutation(nominal_group):
    nominal_group.begin_tick(nominal_group.commands(seq=4, target=1.0))
    before = nominal_group.snapshot()
    with pytest.raises(WorkerError) as e:
        nominal_group.begin_tick(nominal_group.commands(seq=3, target=1.0))
    assert e.value.code == 'DRIVE_COMMAND_SEQ_INVALID' and nominal_group.snapshot() == before
```

`nominal_group` là fixture pytest của file test, dựng `DriveGroup` từ `serve-drive-nominal-v1.json`; các helper `enable_all`, `commands`, `run_substeps`, `states`, `faults`, `snapshot` thuộc fixture test, không thuộc module sản phẩm.

```sh
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 600; exec @ARGV' .venv-mujoco/bin/python -m pytest -p no:cacheprovider robotics/simulation-mujoco/tests -q
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-drive-worker.test.ts tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-arm-worker.test.ts tests/integration/mujoco-world-rig.test.ts
```

**Exit:** drive chạy trên engine thật; đường legacy giữ byte; không coi compile được là G-DRV1.

## Task V04 — Controller TS, thí nghiệm đăng ký và nối provider

**Files:**

- Create `source/packages/lab-runtime/src/v2/control/{diff-drive-base,joint-follower,drive-experiments}.ts`, `source/scripts/generate-controller-vectors.mjs`, `source/tests/fixtures/control/{diff-drive-base-v1,joint-trajectory-follower-v1}.vectors.json`.
- Modify `source/packages/lab-runtime/src/v2/navigation2d/runner.ts` (chỗ gom `velocities` trước khi gọi plant), `v2/simulation3d/{mujoco-mobile,mujoco-arm-ports,mujoco-world-ports}.ts`, `src/engineering/mujoco-compiler.ts`, `v2/report.ts`, `source/packages/contracts/schemas/{engineering-project,lab-run-v2}.schema.json` (trường `driveExperimentId` tùy chọn: ở engineering project cho run mobile, ở run request cho cell).
- Test `source/tests/unit/{diff-drive-base,joint-follower,drive-experiments,controller-vectors}.test.ts`, `source/tests/integration/{mujoco-drive-mobile,mujoco-drive-cell}.test.ts`.

**Interfaces:** consumes `MotionController`, `DriveCommandV1`, `DriveFeedbackV1`, `splitDriveSnapshot`, `createMockDrive`; produces

```ts
// control/diff-drive-base.ts
export interface DiffDriveBaseConfig {axisLeft: string; axisRight: string; wheelRadiusM: number; wheelSeparationM: number;
  maxWheelAccelRadS2: number; enableTimeoutTicks: number; trackingDegradedRadS: number; trackingDegradedTicks: number}
export const diffDriveBaseV1: MotionController<DiffDriveBaseState, {vMps: number; omegaRadps: number}, DiffDriveBaseConfig>;
// control/joint-follower.ts
export interface JointFollowerConfig {axes: string[]; gripperAxis: string; gripperMap: {loRad: number; hiRad: number; openingMaxM: number};
  enableTimeoutTicks: number; followTolRad: number; followTicks: number}
export const jointTrajectoryFollowerV1: MotionController<JointFollowerState, {positionsRad: number[]; openingM: number | null}, JointFollowerConfig>;
// control/drive-experiments.ts: registry đóng
export const DRIVE_EXPERIMENTS: Readonly<Record<'drive-ideal-v1'|'drive-nominal-v1'|'drive-torque-limited-v1'|'drive-latency-v1'|'drive-coarse-encoder-v1',
  {mobileModel: string; armModel: string; mobileControl: string; armControl: string}>>;
export const driveExperiment: (id: string) => (typeof DRIVE_EXPERIMENTS)[keyof typeof DRIVE_EXPERIMENTS];  // ném 'DRIVE_EXPERIMENT_UNREGISTERED'
```

- [ ] Viết test thuần, chạy fail trước: với phản hồi mọi trục `disabled`, hai controller chỉ phát lệnh `enable` và target bằng 0 hoặc bằng phản hồi; quá `enableTimeoutTicks` phát `DRIVE_NOT_READY`; đổi `{vMps:0, omegaRadps:1}` với bán kính 0,09 m và khoảng cách 0,36 m cho bánh trái −2 rad/s, bánh phải +2 rad/s; bước lệnh bị giới hạn bởi `maxWheelAccelRadS2 × 0,02`; một trục `fault` thì mọi trục nhận target giữ và không có `faultReset`; follower không đổi target kẹp theo hướng mở khi có lỗi; phản hồi đứng yên với encoder 1.024 counts/vòng trong 500 tick không sinh `TRACKING_DEGRADED` và odometry không đổi quá một bước lượng tử; cùng chuỗi phản hồi cho cùng chuỗi lệnh ở hai lần chạy (tính thuần).
- [ ] Viết hai controller. Odometry của base controller tích phân từ `positionRad` của phản hồi, cùng công thức với worker.
- [ ] Sinh bộ vector chuẩn cho từng controller (cấu hình, chuỗi setpoint và phản hồi gồm enable, chạy, lỗi; kèm chuỗi lệnh và sự kiện kỳ vọng) và commit. Test khẳng định file đã commit bằng kết quả sinh lại và phát lại vector qua controller cho đúng từng lệnh. Đây là thứ một bản cài đặt khác (Python, C) phải qua về sau.
- [ ] Viết registry và nối hai điểm chọn, theo đúng cách mỗi loại run đã chọn input của mình. Run mobile: `driveExperimentId` là trường của engineering project, `mujoco-compiler.ts` đọc nó lúc compile như `mujocoExperimentId` và ghi file drive model, control profile cùng ref và digest vào bundle. Cell: `driveExperimentId` là trường của run request như `worldExperimentId`; world ports ghi cùng các file vào scene của run. Không có trường thì không ghi gì và đường R2b giữ byte. Giá trị ngoài registry bị từ chối trước khi tạo bundle hoặc run. `driveExperimentId` trên `MJ-BV01` (arm-only) bị từ chối.
- [ ] Nối runner: khi scene có cặp ref, `velocities` của controller điều hướng đi qua `diffDriveBaseV1` thành `driveCommands`; mục tiêu khớp và độ mở kẹp của máy trạng thái arm đi qua `jointTrajectoryFollowerV1`. Phản hồi lấy bằng `splitDriveSnapshot`; phần evidence đi tới recorder. Quyết định đến nơi/đã dừng vẫn dùng quan sát plant như R2b.
- [ ] Sự kiện `DRIVE_FAULT` và `DRIVE_NOT_READY` chuyển run sang `needs_attention` với lý do; không gửi `faultReset`; không tăng served.
- [ ] Manifest/report thêm digest drive model, control profile, id/revision controller, `testLevel:'controller_in_the_loop'`; run không có drive không có các trường này.
- [ ] Test integration với engine thật, chạy fail trước: `MJ-FD01` + `drive-ideal-v1` cho snapshot trùng bit với run không drive cùng seed trong 300 tick; `MJ-FD01` + `drive-nominal-v1` phục vụ 1, tick đầu tiên có vận tốc bánh khác 0 không sớm hơn tick enable xong; `MJ-CELL-BV01` + `drive-nominal-v1` seed 7 phục vụ 2; tạm dừng run 2 giây tường ở pacing 64× không sinh lỗi drive.
- [ ] Test lỗi drive tự nhiên (CIL05), chạy fail trước. Dùng drive model thử nghiệm dựng trong thư mục tạm của test, không đăng ký: `velocityLimitRadS` của bánh thấp hơn tốc độ hành trình → drive chốt `OVERSPEED` giữa mission, run `needs_attention`, served 0, không có `faultReset` trong mọi lệnh đã ghi. Biến thể cell: `velocityLimitRadS` của J2 thấp hơn tốc độ nhấc → lỗi xảy ra khi tay đang giữ cốc; sau 100 tick cốc vẫn giữa hai má theo quan sát engine, custody còn ở tay, không có lệnh nào làm tăng độ mở kẹp.
- [ ] Focused tests và hồi quy R2b; commit `feat: run MuJoCo missions through motion controllers and a virtual drive`; re-pin Lab.

```ts
import {expect, test} from 'vitest';
import {diffDriveBaseV1} from '../../packages/lab-runtime/src/v2/control/diff-drive-base';
const config = {axisLeft: 'amr-1/wheel-left', axisRight: 'amr-1/wheel-right', wheelRadiusM: 0.09, wheelSeparationM: 0.36,
  maxWheelAccelRadS2: 1000, enableTimeoutTicks: 25, trackingDegradedRadS: 1, trackingDegradedTicks: 25};
const fb = (state: 'disabled' | 'enabled' | 'fault') => (['amr-1/wheel-left', 'amr-1/wheel-right'] as const).map(axisId =>
  ({axisId, state, fault: state === 'fault' ? 'EXTERNAL_TRIP' as const : null, commandSeq: 0, positionRad: 0, velocityRadS: 0, torqueNm: 0, tick: 0}));

test('a disabled drive gets an enable request and no motion target', () => {
  const out = diffDriveBaseV1.step(diffDriveBaseV1.init(config), {tick: 0, setpoint: {vMps: 0.5, omegaRadps: 0}, feedback: fb('disabled')});
  expect(out.commands.map(c => [c.enable, c.target, c.faultReset])).toEqual([[true, 0, false], [true, 0, false]]);
});
test('positive yaw turns the left wheel backwards', () => {
  const out = diffDriveBaseV1.step(diffDriveBaseV1.init(config), {tick: 0, setpoint: {vMps: 0, omegaRadps: 1}, feedback: fb('enabled')});
  expect(out.commands.map(c => c.target)).toEqual([-2, 2]);
});
test('a faulted axis stops both wheels and is never reset by the controller', () => {
  const out = diffDriveBaseV1.step(diffDriveBaseV1.init(config), {tick: 9, setpoint: {vMps: 0.5, omegaRadps: 0}, feedback: fb('fault')});
  expect(out.commands.every(c => c.target === 0 && !c.faultReset)).toBe(true);
  expect(out.events.map(e => e.code)).toContain('DRIVE_FAULT');
});
```

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/diff-drive-base.test.ts tests/unit/joint-follower.test.ts tests/unit/drive-experiments.test.ts
perl -e 'alarm 1800; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-drive-mobile.test.ts tests/integration/mujoco-drive-cell.test.ts
```

## Task V05 — Evidence theo trục, metric và campaign CIL

**Files:**

- Create `source/packages/lab-runtime/src/v2/control/{drive-metrics,cil-campaign}.ts`, `source/robotics/simulation-mujoco/campaigns/cil-v1.json`.
- Modify `source/packages/lab-runtime/src/v2/simulation3d/{physics-evidence,world-evidence}.ts`, `v2/report.ts`, `source/scripts/lab-mujoco.mjs` (thêm campaign `cil-v1`).
- Lab, sau khi pin: Create `lab/src/reports/control.ts`; Modify `lab/src/ui/report-panel.ts`, `lab/src/twin/inspector.ts`.
- Test `source/tests/unit/drive-metrics.test.ts`, `source/tests/integration/{drive-evidence,mujoco-cil-campaign}.test.ts`, `lab/tests/unit/control-report.test.ts`.
- Create `source/tests/integration/lab-runtime-container-r4.test.ts` (CLD01; các đợt sau thêm ca vào file này).

**Interfaces:** consumes `DriveAxisSnapshot`, recorder physics hiện có; produces

```ts
// control/drive-metrics.ts
export type ControlMetric =
  | {available: true; value: number; unit: string; samples: number; basis: 'actual' | 'feedback'}
  | {available: false; value: null; unit: string; reason: string};
export function trackingRms(records: readonly {tick: number; drives: readonly DriveAxisSnapshot[]}[], axisId: string, window: {fromTick: number; toTick: number}): ControlMetric;
export function speedDeficit(records: readonly {tick: number; drives: readonly DriveAxisSnapshot[]}[], axisId: string, policy: {minCruiseTicks: number}): ControlMetric;
// control/cil-campaign.ts
export function runCilCampaign(options: {root: string; out: string; sourceCommit: string; caseId?: string; signal: AbortSignal}): Promise<CilCampaignVerdict>;
export function verifyCilCampaign(root: string): Promise<CilCampaignVerdict>;
export interface CilCampaignVerdict {expectedRuns: number; completedCases: number; missingArtifacts: string[]; issues: string[];
  equivalence: {id: string; bitIdentical: boolean}[]; faultCases: {id: string; detected: boolean; falseServed: boolean}[]}
// lab/src/reports/control.ts
export function driveSection(report: unknown): {available: false; reason: string} | {available: true; axes: {axisId: string; states: string[]; trackingRms: ControlMetric}[]};
```

- [ ] Viết test, chạy fail trước: `trackingRms` trên cửa sổ có tick thiếu trả `{available:false, reason:'TRACE_GAP'}`; `speedDeficit` không có đoạn lệnh không đổi đủ dài trả `NO_CRUISE_WINDOW`; recorder từ chối bản ghi `drives` thiếu trục so với drive model; đọc lại bắt thiếu/hỏng/quota và kill giữa chunk; report R2b không có `drives` cho `driveSection` trả `{available:false, reason:'NO_DRIVE_DATA'}`.
- [ ] Mở rộng recorder: `drives` ghi cùng `PhysicsTickRecord` sau ACK và trước logical commit, với world recorder tương tự. Giữ nguyên định dạng và quota hiện có.
- [ ] Viết metric và phần `drive` của report: metric chỉ lấy từ artifact reader đã kiểm.
- [ ] Viết campaign `cil-v1` theo [contracts §9](../05-contracts-and-evidence.md#9-case-và-gate): 5 thí nghiệm × 3 seed trên `MJ-FD01`, 3 lần lặp, cell 3 seed + 5 fault. Verify từ chối thiếu run, sai seed/thí nghiệm, kết quả không khớp oracle. Exit 0 khi mọi assertion đúng, 1 khi fail, 2 khi thiếu điều kiện.
- [ ] Lab: phần drive trong panel báo cáo (trạng thái theo trục, RMS sai số bám) và trạng thái drive trong inspector, ba ngôn ngữ; không có dữ liệu thì hiện đúng lý do.
- [ ] Chạy campaign vào thư mục tạm ngoài hai repo, verify exit 0; commit source `feat: record drive evidence and the CIL campaign`, re-pin, commit Lab `feat: show drive state and tracking in reports`.
- [ ] CLD01 cho R4.1: viết `lab-runtime-container-r4.test.ts` theo mẫu `lab-runtime-container.test.ts` (cổng chỉ trên `127.0.0.1`, khóa truy cập ngẫu nhiên, root chỉ đọc, `/tmp` là tmpfs, từ chối image cũ bằng `IMAGE_STALE`). Ca đầu: trong image `linux/arm64` dựng từ commit hiện tại, `MJ-CELL-BV01` với `driveExperimentId:'drive-nominal-v1'` hoàn thành và phục vụ 2, report có phần `drive`, `docker diff` rỗng, tiến trình không chạy root. Commit `test: run the drive cell inside the runtime image`.
- [ ] CLD02: dựng image `linux/amd64` từ cùng commit và chạy pytest của tool root trong image, theo cách README của image mô tả (thư mục `tests/` mount chỉ đọc). Ghi kết quả vào tài liệu baseline; không chạy cell đầy đủ dưới giả lập.

```ts
import {expect, test} from 'vitest';
import {verifyCilCampaign} from '../../packages/lab-runtime/src/v2/control/cil-campaign';

test('the recorded CIL campaign is complete and never serves falsely', async () => {
  const result = await verifyCilCampaign(recordedDirectory);       // mkdtemp của chính test sau khi chạy campaign
  expect(result.expectedRuns).toBe(26);
  expect(result.completedCases).toBe(26);
  expect(result.missingArtifacts).toEqual([]);
  expect(result.equivalence.every(e => e.bitIdentical)).toBe(true);
  expect(result.faultCases.every(c => c.detected && !c.falseServed)).toBe(true);
});
```

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/drive-metrics.test.ts tests/integration/drive-evidence.test.ts
perl -e 'alarm 5400; exec @ARGV' node scripts/lab-mujoco.mjs run --campaign cil-v1 --out /tmp/mekoniq-cil-v1
node scripts/lab-mujoco.mjs verify --input /tmp/mekoniq-cil-v1
# CLD01, CLD02: cây source sạch tại commit vừa tạo
deploy/lab-runtime/build.sh mekoniq-lab-runtime:r4 --platform linux/arm64
LAB_CONTAINER_IMAGE=mekoniq-lab-runtime:r4 perl -e 'alarm 1200; exec @ARGV' pnpm test:integration -- tests/integration/lab-runtime-container-r4.test.ts
deploy/lab-runtime/build.sh mekoniq-lab-runtime:r4-amd64 --platform linux/amd64
```

**Exit:** R4.1 bàn giao được: G-DRV1 và G-CIL1 có artifact từng run; cell có drive chạy hết trong image arm64 (CLD01) và image amd64 dựng được (CLD02). CLD03 chạy khi người dùng ra lệnh deploy. Bàn giao sớm ghi candidate theo V16, không gắn nhãn R4 đầy đủ.

## Việc phải sửa sau review V01–V05 (ngày 19/11, trước V06) — đã xong ngày 20/11

Review ở source `3092d95` / Lab `5a00a40`. Campaign `cil-v1` kiểm lại đạt 26/26 với verifier hiện tại, nhưng G-DRV1 và G-CIL1 **chưa đóng** cho tới khi các mục dưới đây xong. Script tái hiện và số đo nằm ở [probes/review-v05/](../probes/review-v05/). Mỗi mục: viết test fail trước, rồi sửa. **Trạng thái 20/11:** mọi mục chặn đã sửa ở `5e93570` và được kiểm lại (mục *Kiểm lại ngày 20/11* ở cuối); các mục còn mở đánh số O1–O8.

**Chặn V06**

- [x] **Chi phí view của cell có drive tăng theo số tick.** `coffee.view()` gọi `ports.report()`, và `report()` dựng lại `driveEvidence` trên toàn bộ `driveRows` trong bộ nhớ. Đo: một view tốn 0,79 ms ở tick 500, 2,24 ms ở tick 2.000, 6,31 ms ở tick 4.000; cell không có drive giữ 0,12 ms. Log CLD01 ghi 37,7 ms/tick cho cả run trong container (ngân sách 1× là 20 ms). Sửa: view không dựng phần drive; report dựng từ stream `world-evidence` đã đọc lại, đúng [contracts §7](../05-contracts-and-evidence.md#7-evidence-giới-hạn-và-replay). Test: chi phí view ở tick 4.000 không lớn hơn ở tick 500 quá một biên khai trước; rồi ghi DRV08 bằng cặp đo xen kẽ. **Đã sửa (`5e93570`):** `report()` của ports không còn mang phần drive; `driveReport()` riêng, chỉ `CoffeeDriver.report()` gọi. Test `mujoco-drive-view-cost` đo ở tick 300 và 1.500 (thay cho 500 và 4.000); kiểm lại 20/11: 0,07 ms ở cả hai, ngang cell không drive. DRV08 theo cặp xen kẽ (4.000 tick): legacy 14,55 và 14,61, drive 15,93 và 17,08 ms/tick. CLD01 chạy lại: 13,2 ms/tick. Khác plan: report cell vẫn dựng từ hàng trong bộ nhớ; verifier dựng lại phần trục từ stream và so (O4).
- [x] **Oracle của `drive-coarse-encoder-v1` đã bị nới sau khi thấy kết quả** (`events: []` thành `eventsAllowed` ở `4b36956`, trong khi ghi chú vẫn nói "Locked before the recording"). Sự kiện được cho qua là báo động giả: run seed 19 của encoder thô và của nominal trùng bit ở cả 3.211 tick về trạng thái thật, lệnh và mô-men; độ phân giải vận tốc đo là 2,45 rad/s trong khi bánh quay khoảng 1,4 rad/s. Sửa: trả oracle về `events: []`, sửa bộ giám sát bám trong `diff-drive-base.ts` để không báo khi sai lệch nhỏ hơn độ phân giải của phép đo, và ghi lại campaign. **Đã sửa:** oracle về `events: []`; `velocityResolutionRadS` (2,45 rad/s với 256 count, cửa sổ 5 substep) dẫn xuất từ drive model ở cả runtime và verifier; campaign ghi lại, ba seed không có sự kiện.
- [x] **CIL03 chưa được chứng minh.** Ba run `drive-torque-limited-v1` không có `TRACKING_DEGRADED`, thiếu hụt vận tốc không lớn hơn nominal (hai trên ba seed còn nhỏ hơn), thời gian nhiệm vụ gần như không đổi. Oracle chỉ kiểm metric "có mặt". Hoặc làm thí nghiệm đủ nặng và khẳng định thiếu hụt so với nominal theo biên khai trước, hoặc ghi CIL03 là không quan sát được ở fixture này và bỏ khỏi `coverage`. **Đã sửa theo cách thứ nhất:** torque ×0,1; oracle `speedDeficitAtLeastTimesNominal: 1.25` khai trước lần ghi lại, verifier so từng bánh. Ghi được: thiếu hụt 0,47–0,75 rad/s so với 0,30 của nominal, 7 `TRACKING_DEGRADED` mỗi seed, cả 3 seed `needs_attention` (`NO_PROGRESS`), served 0.
- [x] **Tay máy võng sau khi một trục lỗi.** `joint-follower.ts` gửi target bằng vị trí đo mới nhất ở mỗi tick, nên các khớp còn bật mất độ cứng: J3 lệch 16,2° sau 5 giây, so với 0,18° khi chốt target lúc lỗi. Sửa: chốt target một lần khi vào nhánh lỗi và nhánh chưa bật. Test trên engine thật với cốc đang được kẹp. **Đã sửa:** `latch` chốt một lần khi vào nhánh giữ, nhả khi mọi trục `enabled`. Test engine thật bước run đã dừng thêm 250 tick: lệnh không đổi, các khớp còn bật lệch < 0,02 rad, cốc còn giữa hai má.
- [x] **Drive áp lại target cũ sau khi xóa lỗi.** `drive_model.py` giữ `cmd_in`/kênh lệnh của lúc trước lỗi; sau `faultReset` và enable với target 0, bánh chạy lại ở 8 rad/s trong 7 substep. Sửa: đặt lại kênh lệnh khi rời và khi vào `enabled` (csv về 0, csp về vị trí hiện tại). **Đã sửa:** `_neutral()` đưa kênh lệnh của mọi trục không nhận lệnh về trung tính (`cmd`, `prev`, `applied`, `ramp`, hàng đợi trễ). Test trục `csv` đạt; test trục `csp` luôn skip (O3).
- [x] **Worker chết với một lệnh hợp lệ theo schema.** Bước world thiếu lệnh của kẹp cho `StopIteration`, `WORKER_FAILED`, phiên `failed`, thay vì `DRIVE_COMMAND_REQUIRED`. Cùng gốc: `begin_tick` chạy sau khi phiên đã tiêu `world_disturbance_consumed` và `perturbation_done`, nên một lần từ chối làm mất nhiễu loạn một lần. Sửa: một hàm kiểm thuần `check(commands)` gọi trong phiên trước mọi thay đổi trạng thái. **Đã sửa:** `DriveGroup.check()` thuần; phiên gọi `_check_drive_commands` trước mọi thay đổi trạng thái, ở mobile và world. Test: thiếu lệnh kẹp → `DRIVE_COMMAND_REQUIRED`, phiên sống; lần từ chối không tiêu `world_disturbance_consumed`.
- [x] **Giới hạn gia tốc sai khi có trễ lệnh.** Bộ giới hạn lấy mốc là đầu ra đã trễ, nên giới hạn thực bằng giới hạn chia cho (trễ + 1): trễ 1 substep cần 99 substep thay vì 51; trễ 50 không bao giờ tới đích. Chưa lộ vì profile đang để `null`, nhưng V06–V07 cho người dùng sửa trường này. **Đã sửa:** bộ giới hạn có mốc riêng `ramp` trước kênh trễ; test trễ 0, 1 và 50 tới đích sau đúng 50 + trễ substep.

**Nên sửa cùng đợt**

- [x] Verifier: `events` lấy từ chính report nên không được kiểm; oracle lỗi và sự kiện chỉ so số lượng; `bitIdentical:false` không tạo issue (chỉ CLI bắt); `enableSequence` từ chối kết cục dừng vì lỗi drive mà ghi chú oracle cho phép; stream, bundle và campaign con của cell chưa gắn với run và commit đang kiểm; phần drive của report cell chỉ được đếm số trục. **Đã sửa một phần:** faults và events so nguyên danh sách; sự kiện controller của run mobile được tính lại bằng cách phát lại `diff-drive-base-v1` trên phản hồi và lệnh đã ghi (test bỏ, thêm, dời một sự kiện đều bị bắt); `bitIdentical:false` thành issue; `enableSequence` chấp nhận lỗi về sau; campaign con của cell gắn commit, thí nghiệm, kiến trúc, và phần trục của report cell được dựng lại từ stream. Chưa xong: sự kiện của cell (O4).
- [x] Worker bỏ kiểm giới hạn điều hướng trên đường drive: hai bánh ở 20 rad/s là 1,8 m/s, trong khi giới hạn đã admission là 0,5 m/s. Tính lại (v, ω) từ lệnh bánh và dùng `VELOCITY_TARGET_OUT_OF_RANGE` như đường cũ. **Đã sửa:** `_check_drive_commands` tính (v, ω) từ hai lệnh bánh ở mobile và world; có test.
- [x] Interlock: việc đặt target bánh về 0 nằm ngoài controller (`mujoco-world-ports.ts` ghi đè `baseState.targets`), nên vector chuẩn của controller không phủ và run mobile không có hành vi tương ứng. Đưa thành một đầu vào dừng của controller, hoặc dùng `quickStop`. **Đã sửa:** đầu vào `stop` của `diff-drive-base-v1`; vector chuẩn `stop-now-ignores-the-acceleration-limit`.
- [x] **`hostArch`: người dùng đã quyết ngày 19/11, chỉ đi vào phần có hash khi run có drive.** Quy tắc đầy đủ ở [contracts §1](../05-contracts-and-evidence.md#1-identity-và-tương-thích). Ba việc: **Đã làm cả ba** (test digest có và không có ref; `manifest.drive.hostArch` lấy từ `describe` của worker cho mobile và cell; `campaign.json`, kể cả campaign con của cell, ghi `hostArch`, verifier báo `CIL_HOSTARCH`).
  - Evidence điều hướng: trong `evidenceDigests` (`navigation2d/evidence.ts`), `inputs.engine.hostArch` chỉ có khi `scene.engine.driveModelRef` có mặt. Khối `engine` của tài liệu vẫn ghi trường này cho mọi run MuJoCo mobile. Test: scene không có ref cho cùng digest dù identity có hay không có `hostArch`; scene có ref cho digest khác nhau giữa `arm64` và `x86_64`.
  - Run có drive: `driveManifest` (`control/drive-run.ts`) ghi `hostArch` lấy từ identity của worker, cho cả mobile và cell. Hiện run cell không ghi kiến trúc ở đâu: report, manifest và `campaign.json` của `r4-cil-v1-4b36956` đều không có trường nào về kiến trúc.
  - Campaign: `campaign.json` ghi `hostArch`; verifier báo issue khi report của run có drive thiếu trường này và không so trùng bit giữa hai run khác `hostArch`.
  - Đính chính so với bản review: review viết rằng digest của run cũ đổi. Điều đó không gây hậu quả gì: header digest vốn đã chứa `sourceCommit` và kiến trúc của host, và không có golden digest nào được lưu, nên không có gì phải ghi lại. Lý do giữ quy tắc là để công thức digest của run không có drive nguyên như R2b.
- [x] Model lý tưởng vẫn bật ngưỡng `OVERSPEED`, nên "trùng bit với đường cũ" chỉ đúng khi tốc độ không vượt 1,2 lần giới hạn. Cho phép tắt ở model lý tưởng, hoặc ghi rõ giới hạn này ở DRV02. **Giữ nguyên, ghi giới hạn** ở mục *Known limit* của tài liệu spike.
- [x] Nhỏ: bộ đếm bão hòa cũ của bánh dùng công thức R2b trên run có drive và lệch với `drives[].saturatedSubsteps`; `WorldEngine.__init__` ghi `ctrl` theo id actuator trên đường drive; `buildDriveEvidence` báo metric "available" trên stream bị cắt; Lab `stateAt` còn hiện lỗi sau khi trục rời trạng thái lỗi và `driveSection` ném lỗi với block thiếu `events`. **Đã sửa** cả năm điểm, trừ bộ đếm bão hòa cũ: giữ công thức R2b có chủ ý (đổi sẽ phá ideal = legacy), ghi trong tài liệu spike.

**Xong khi:** mỗi mục chặn có test đã fail trước rồi đạt; pytest worker, `contracts:check`, typecheck và các suite unit, integration của phần đã đổi đạt; campaign `cil-v1` được ghi lại ở commit mới, verifier exit 0, và file oracle không đổi sau lần ghi đó; CLD01 chạy lại và ghi ms/tick của cell có drive; DRV08 có số đo theo cặp xen kẽ; Lab re-pin trên nhánh R4; hai cây sạch, chưa push. **Đạt ngày 20/11.**

**Đã kiểm lại và đạt (review 19/11):** pytest worker 175, `contracts:check`, typecheck; verifier trên bằng chứng đã ghi exit 0; ba cặp ideal so với legacy và các lần lặp trùng bit trên arm64; đường cũ của worker không đổi khi scene không có ref; lớp drive không ghi `qpos`/`qvel`; controller chỉ nhận trường phản hồi đo được.

### Kiểm lại ngày 20/11 (source `009f068`, Lab `477a65f`, pin `5e93570`)

Chạy lại, không dựa vào ledger: pytest worker 183 đạt và 1 skip; `contracts:check`; typecheck source và Lab; 99 test unit của drive và controller; 10 test integration trên engine thật (`mujoco-drive-cell`, `mujoco-drive-view-cost`, `mujoco-drive-mobile`); 58 test Lab (`control-report`, `workspace-generation`); `check:source` của Lab. Verifier `cil-v1` chạy lại trên `robot/evidence-archive/r4-cil-v1-5e93570/`: exit 0, 26/26, oracle trùng file trong repo, không có commit code nào sau `5e93570`. Không push, không deploy, mọi record `accepted:false`. G-DRV1 và G-CIL1 có đủ artifact cho bàn giao sớm R4.1; gate chỉ thành `tested` ở qualification V16. **V06 được bắt đầu.**

### Còn mở sau kiểm lại (không chặn V06)

- [ ] **O1. Kiểm admission ở TS và Python lệch nhau.** `validateControlProfile` cho qua ba trường hợp mà `actuator_spec` của worker từ chối lúc create: `accelerationLimit` trên trục `csp` (envelope còn cho khớp tay máy 0,5–50), `slewLimit: 0` trên trục `csv` (envelope bánh là 0–0), `ki > 0` với `integralLimit: 0`. Ở V06 bản nháp của người dùng đi qua kiểm 422 nên một bản nháp như vậy sẽ hỏng ở create thay vì bị từ chối có lý do. Chốt ở đầu V06 (D3).
- [ ] **O2. Run cell không kiểm profile thuộc plant nào.** `mujoco-world-ports.ts` gọi `admitDriveDocuments(..., null)` và worker không truyền digest plant khi đọc drive của world, nên `plantModelDigest` của profile kết hợp không bao giờ được so (run mobile có kiểm). Sửa ở đầu V06 (D2); phải xong trước khi đóng V07 ("profile gắn plant").
- [ ] **O3. Test `csp` của `_neutral` không bao giờ chạy.** `test_a_position_axis_that_is_enabled_again_holds_where_it_is_not_where_it_was_commanded` dùng `Rig()` mặc định là fixture bánh (`csv`) nên luôn skip; nhánh giữ vị trí khi bật lại một khớp tay máy chưa có test. Cần trước V08 (studio lỗi reset trục).
- [ ] **O4. Verifier phần cell chưa đủ.** Sự kiện của controller chỉ được kiểm khoảng tick và trục, không tính lại; cờ `complete` lấy từ chính report; report cell dựng từ hàng trong bộ nhớ, không từ stream đã đọc lại như [contracts §7](../05-contracts-and-evidence.md#7-evidence-giới-hạn-và-replay). Làm trước qualification V16.
- [ ] **O5. Encoder thô không tác động lên chuyển động.** Run `drive-coarse-encoder-v1` trùng nominal về trạng thái thật (cùng tick kết thúc, cùng metric) vì vòng servo đóng trên trạng thái thật ([R4-A §5.2](../02-r4-control-chain-spec.md#52-cơ-chế-số)). Ngưỡng 2,45 rad/s lớn hơn tốc độ bánh (khoảng 1,4 rad/s) nên bộ giám sát bám gần như tắt ở thí nghiệm này, và odometry của controller không có trong report. Thí nghiệm hiện chỉ chứng minh "không báo động giả". Không sửa ở R4.1; nói rõ khi demo, và ở V07 metric bench ghi `basis`, đường phản hồi vẽ riêng.
- [ ] **O6. CLD02 chưa chạy lại** sau `5e93570`; số 166/174 là của `4b36956`. Chạy cùng CLD01/CLD02 của V07.
- [x] **O7. Tài liệu lệch** (bảng spec, README và contracts §5 theo D4 đã sửa 20/11; checkbox V00–V05 để nguyên vì ledger là bản ghi): bảng [R4-A §5.4](../02-r4-control-chain-spec.md#54-thí-nghiệm-cil-có-đăng-ký) vẫn ghi torque ×0,4 (thực tế ×0,1, tài liệu spike ghi lý do); [README](../README.md) của bộ thiết kế vẫn ghi "chưa có dòng code nào"; checkbox các task V00–V05 trong plan này chưa đánh dấu.
- [x] **O8. Cache pytest sót** (đã xóa 20/11) dưới hai portable tool root, Git bỏ qua: `source/robotics/navigation-2d/.pytest_cache` và `source/robotics/model-validation/.pytest_cache` (19/11 02:41). Xóa trước khi ghi record hay demo.

### Quyết định chốt ở đầu V06 (người dùng duyệt cả bốn ngày 20/11)

**D1. Bench tay máy lấy drive ở đâu.** Giữ `arm-cell-scene-v1` khóa (hash của nó nằm trong `scripts/native-sim/r2a-arm-baseline.json`). Cả hai bench nhận cặp ref trong `create.payload.bench` (`driveModelRef`, `controlProfileRef`, tối đa 2 `axisIds`), đọc và kiểm bằng đúng đường `_drive_docs` hiện có (nằm trong bundle, sha256, digest, `driveModelDigests`, digest plant). Manifest và header trace của bench ghi hai digest. Ref trong scene vẫn là đường của run nhiệm vụ. Không chọn: schema scene arm mới (đụng khóa R2a) hoặc bench tay máy trong world (13 ms/tick, kéo theo AMR và điều hướng, đáp ứng lẫn với cell).

**D2. Profile gắn với plant nào.**
- AMR: `plantModelDigest` là digest physical model của AMR, không phụ thuộc tải. Tải của bench (`empty`) ghi trong `TuningResultV1`; `comparable` coi hai lần chạy khác tải là không so được.
- Tay máy: sha256 của component, như fixture hiện có.
- Cell: kiểm profile kết hợp bằng digest tính từ chính scene (`hashJson({mobile, arm})`), không truyền `null` (sửa O2 ở commit đầu V06).
- Chỉ fixture của registry được seal lại theo plant đã compile. Profile người dùng gửi không bao giờ được seal lại; lệch plant là 422 `DRIVE_PLANT_MISMATCH`. Profile đã chỉnh muốn dùng cho cell hay campaign thì vào registry thành revision mới ([R4-A §5.4](../02-r4-control-chain-spec.md#54-thí-nghiệm-cil-có-đăng-ký)), không nhập lúc chạy.

**D3. Một bảng luật theo mode, TS và Python dùng chung** (sửa O1):

| Trường | `csp` (khớp, kẹp) | `csv` (bánh) |
|---|---|---|
| `kp` | N·m/rad | N·m·s/rad |
| `ki` | N·m/(rad·s), actuator `pid` của engine | N·m/rad trên tích phân sai số vận tốc (ánh xạ V03) |
| `kd` | N·m·s/rad | phải bằng 0 |
| `integralLimit` | N·m; > 0 khi `ki` > 0; `null` khi `ki` = 0 | như `csp` |
| `slewLimit` | rad/s hoặc `null` | phải `null` |
| `accelerationLimit` | phải `null` | rad/s² hoặc `null` |

Envelope lên revision 2: trường không có trong envelope của một trục nghĩa là trục đó không nhận trường ấy (thay cho biên 0–0); bỏ `accelerationLimit` khỏi trục `csp`, bỏ `kd` và `slewLimit` khỏi trục `csv`; `integralLimit.min` > 0. `validateControlProfile` kiểm đúng bảng này. Thêm một bộ vector tài liệu (hợp lệ và không hợp lệ) mà `validateControlProfile` và `actuator_spec` phải cho cùng kết luận, chạy ở cả vitest và pytest.

**D4. Công thức gợi ý gain.** Cùng một dạng bậc hai cho hai mode:
- `csp`: `kp` = J·ωₙ², `kd` = 2ζωₙJ, `ki` = 0 (khớp test của plan: J = 0,5, ωₙ = 20, ζ = 1 cho 200 và 20).
- `csv`: vòng PI vận tốc có đặc tính J·s² + kp·s + ki, nên `kp` = 2ζωₙJ, `ki` = J·ωₙ², `integralLimit` = trần mô-men của trục trong envelope.
- J của khớp tay máy lấy từ đường chéo ma trận quán tính tại tư thế hiện tại, như plan. J của bánh **không** lấy được như vậy: đường chéo chỉ có quán tính của bánh, khối lượng thân xe nối qua tiếp xúc không nằm trong đó. Dùng J = I_bánh + m·r²/2 từ physical model (đi thẳng, mỗi bánh gánh nửa khối lượng), nhãn `assumed`.
- Kết quả vượt envelope bị kẹp và liệt kê trong `clamped`. Metric đáp ứng tính trên `actual` và ghi `basis`; đường phản hồi (lượng tử, trễ) vẽ riêng (O5).

**Thứ tự đề xuất:** xóa O8; commit đầu V06 gồm O1/D3, O2/D2 và O3 (nhỏ, cùng vùng code, có test fail trước); sau đó mới làm bench theo D1 và D4.

