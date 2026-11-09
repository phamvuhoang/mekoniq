# Gói 01 — Release 1: Algorithm + Webots (W00–W09)

Đọc [README](README.md) (Global Constraints, Review Focus) và [spec](../../specs/2026-11-10-simulation-extension-design.md) trước. Paths tính từ `source/` trừ khi bắt đầu bằng `lab/`. Viết tắt: `R` = `packages/lab-runtime/src/v2`, `S` = `packages/contracts/schemas`.

Tiền tố lệnh dùng chung, không lặp lại ở từng bước:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
```

---

### Task W00: Baseline và probe Webots

**Depends:** không. **Deliverable:** `docs/research/2026-11-10-simulation-extension.md`. Mã spike nằm ngoài repo, không commit.

**Files:**
- Create: `docs/research/2026-11-10-simulation-extension.md`

- [ ] **Step 1: Baseline xanh.** Chạy và ghi exit code + thời lượng vào tài liệu:

```sh
pnpm install --frozen-lockfile && pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm build
LAB_IRSIM_EVIDENCE_DIR=docs/implementation/evidence/linkforge-irsim/candidate-03 pnpm test:acceptance -- linkforge-irsim
(cd ../lab && pnpm install --frozen-lockfile && pnpm check:source && pnpm typecheck && pnpm exec vitest run)
```

Expected: tất cả exit 0. Suite nào đỏ ở baseline → dừng, báo cáo.

- [ ] **Step 2: Cài Webots R2025a.** Tải dmg chính thức bằng `curl -L` từ GitHub release `cyberbotics/webots` tag `R2025a` (không dùng Homebrew cask, đã bị vô hiệu), ghi sha256 dmg, kéo `Webots.app` vào `/Applications`. Ghi `"/Applications/Webots.app/Contents/MacOS/webots" --version` và `shasum -a 256` của executable.

- [ ] **Step 3: Viết spike trong scratch** (ngoài repo): một `.wbt` tay với sàn, hai robot hai-bánh-có-caster có LiDAR 360 tia, một supervisor; ba script extern controller Python 3.11 (venv trần + `PYTHONPATH=$WEBOTS_HOME/Contents/lib/controller/python`). Chạy Webots với `--batch --minimize --mode=fast --stdout --stderr --port=<port tự do>`.

- [ ] **Step 4: Đo bảy tiêu chí của spec §6.1** và ghi từng dòng `đạt/không đạt + số đo`: (1) version/sha; (2) extern controller nối được từ venv 3.11 — ghi **chính xác** biến môi trường/tham số đã dùng (`WEBOTS_CONTROLLER_URL` hay launcher `webots-controller`); (3) 1000 tick, `simTime == tick×20 ms`, engine đứng yên khi một controller chưa `step`; (4) LiDAR hữu hạn khi minimize, và có/không với `--no-rendering`; (5) hai lần chạy cùng seed, lệch pose cuối, có bit-identical không; (6) p50/p95 wall-clock mỗi tick, RSS; (7) kill Webots → controller thấy trong bao lâu, `pgrep -f Webots` sau đó.

- [ ] **Step 5: Ghi các quyết định rút ra** vào tài liệu: `basicTimeStep` chọn (ước của 20 ms), cờ dòng lệnh cuối cùng, cách nối controller, `speedMultipliers` (rút về `[1]` nếu p95 > 20 ms), và kết luận **TIẾP TỤC** hoặc **DỪNG (D07)** kèm tiêu chí trượt.

- [ ] **Step 6: Commit**

```sh
git add docs/research/2026-11-10-simulation-extension.md
git commit -m "docs: record simulation-extension baseline and Webots R2025a probe"
```

**Acceptance:** tài liệu có đủ bảy dòng tiêu chí với số đo thật; không có code spike trong repo.

---

### Task W01: Contracts cộng thêm

**Depends:** W00. **Files:**
- Create: `S/algorithm-result-v1.schema.json`, `S/sim3d-worker-v1.schema.json`
- Modify: `S/navigation-scene-v1.schema.json`, `S/navigation-run-evidence-v1.schema.json`, `scripts/generate-contracts.mjs` (thêm hai file vào `navFiles`), `R/navigation2d/contracts.ts` (validators mới)
- Test: `tests/contracts/sim-extension-contracts.test.ts`

**Interfaces — Produces** (sinh vào `packages/contracts/generated/navigation2d.ts`):

```ts
interface AlgorithmResultV1 {schemaVersion:1;checkerId:'rtb_kinematics'|'pid_reference';caseId:string;verdict:'pass'|'fail'|'not_run';
  metrics:Record<string,number|null>;oracleProfileDigest:string;inputDigest:string;toolVersions:Record<string,string>;reasons:string[]}
// sim3d-worker-v1: envelope và ops y hệt irsim-worker-v1, protocol 'mekoniq-sim3d/1'
interface Sim3DRobotStateV1 /* = mọi trường robot của IRSimSnapshotV1 */ {pose3d:{z:number;roll:number;pitch:number};wheels:{leftRadS:number;rightRadS:number}}
interface World3DV1 {obstacleHeightM:number;wallHeightM:number;floorFriction:number;casterFriction:number;provenance:'assumed'|'measured'}
```

- `navigation-scene-v1.engine`: `oneOf` [nhánh IR-SIM hiện tại nguyên văn | `{id:'webots_3d',version:'R2025a',basicTimeStepMs:<giá trị W00>}`]; thuộc tính tùy chọn `world3d: World3DV1`, **bắt buộc** khi `engine.id==='webots_3d'`, **cấm** ở nhánh IR-SIM.
- `navigation-run-evidence-v1`: `oneOf` theo `engine.id`; nhánh `webots_3d` yêu cầu `engineVersion`, `executableSha256`, `basicTimeStepMs`, `pythonVersion`, `lockDigest`, và `seed.engineSeedAlgorithm:'webots-worldinfo-seed-v1'`. Record trajectory thêm `pose3d` tùy chọn.
- Validators: `validateSim3DRequest`, `validateSim3DResponse`, `validateAlgorithmResult` cạnh các validator IR-SIM.

- [ ] **Step 1: Test đỏ** `tests/contracts/sim-extension-contracts.test.ts`:
  - `existing IR-SIM scenes keep their digest`: với mỗi scene trong `robotics/navigation-2d/fixtures/serve-demo-v1/manifest.json`, validate qua schema mới và sha256 file bằng giá trị trong manifest.
  - `IR-SIM branch rejects world3d` / `webots branch requires world3d and basicTimeStepMs`.
  - `evidence webots branch requires executableSha256`; `irsim branch rejects engineVersion`.
  - `AlgorithmResultV1 rejects NaN metric and unknown verdict`.
  - `sim3d response without pose3d is rejected`.
- [ ] **Step 2:** `pnpm test:contracts -- tests/contracts/sim-extension-contracts.test.ts` → FAIL (schema chưa có).
- [ ] **Step 3:** Viết/sửa schema, thêm vào `navFiles`, `pnpm contracts:generate`, thêm validators.
- [ ] **Step 4:** `pnpm contracts:check && pnpm typecheck && pnpm test:contracts` → PASS; `pnpm test:unit -- tests/unit/navigation2d-fixtures.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: additive contracts for algorithm results and the sim3d plant (scene/evidence branches by engine)`.

**Acceptance:** digest scene IR-SIM không đổi; `contracts:check` sạch.

---

### Task W02: Robotics Toolbox checker (G-ALG1)

**Depends:** W01. **Files:**
- Create: `robotics/algorithm/{pyproject.toml,requirements.in,requirements.lock,licenses.json,README.md,oracle-profile-v1.json}`, `robotics/algorithm/algorithm_checks/{__init__,__main__,kinematics}.py`, `robotics/algorithm/tests/test_kinematics.py`, `R/algorithm/{checker,kinematics-cases}.ts`
- Modify: `scripts/bootstrap-portable-simulation.mjs` (`WORKERS.algorithm`), `scripts/portable-licenses.mjs`, `scripts/native-sim/tool-identity.mjs` (`PORTABLE_TOOL_PATHS += 'robotics/algorithm'`)
- Test: `tests/integration/algorithm-kinematics.test.ts`, `tests/security/algorithm-checker.test.ts`

**Interfaces — Produces:**

```
python -I -B -X pycache_prefix=… -m algorithm_checks        # qua isolatedPythonArgs của engineering/python-env.ts
stdin : {"protocol":"mekoniq-algorithm/1","op":<op>,"payload":{…}}     (một dòng JSON, ≤ 1 MiB)
stdout: {"ok":true,"result":{…},"toolVersions":{…}} | {"ok":false,"error":{"code":…,"message":…}}
op rtb_fk       payload {dh:DhRow[], q:number[][]}                  -> {T:number[][][]}          // 4x4, m/rad
op rtb_jacobian payload {dh, q}                                     -> {J:number[][][], cond:number[]}
op rtb_ik       payload {dh, T:number[][][], q0:number[][], limits:[min,max][]} -> {solutions:{ok:boolean,q:number[]}[]}
DhRow = {a:number, alpha:number, d:number, offset:number}           // modified DH, SI
```

```ts
// R/algorithm/checker.ts
export interface AlgorithmCheckerOptions {python:string;root:string;timeoutMs?:number /* default 30_000 */}
export class AlgorithmCheckerError extends Error {constructor(readonly code:'CHECKER_NOT_INSTALLED'|'CHECKER_TIMEOUT'|'CHECKER_PROTOCOL'|'CHECKER_REJECTED',detail:string)}
export function createAlgorithmChecker(o:AlgorithmCheckerOptions):{call<T>(op:string,payload:unknown):Promise<{result:T;toolVersions:Record<string,string>}>}
// R/algorithm/kinematics-cases.ts
export function runKinematicsCases(checker:ReturnType<typeof createAlgorithmChecker>,profile:OracleProfileV1,seed:number):Promise<AlgorithmResultV1[]> // ALG01, ALG02, ALG03, ALG05
```

`oracle-profile-v1.json`: `{version:1, fk:{translationM:1e-6,rotationRad:1e-6}, ikTsToRtb:{translationM:1e-3,rotationRad:0.0087}, ikRtbToTs:{translationM:1e-6,rotationRad:1e-6}, jacobian:{normalized:1e-6,conditionRelative:1e-6}, seededPoses:50, pid:{sample:1e-9}}`. `oracleProfileDigest` = sha256 của file.

Bảng tham số: (a) `PUMA560_REFERENCE` từ `R/models/arm-kinematics.ts`, golden `tests/fixtures/digital-twin/arm-fk-golden.json`; (b) `integrations/arm-controller/models/puma560-reference/modified-dh.json` qua loader ở `R/arm/session.ts` (đổi inch/độ → SI ở TS), golden `reference-poses.json`. Python **không** tự so sánh, không đọc file nào.

- [ ] **Step 1: Lock.** `requirements.in`: `roboticstoolbox-python==1.5.0`, `numpy`, `scipy`. `uv pip compile --python-version 3.11 --generate-hashes requirements.in -o requirements.lock`. Thêm `WORKERS.algorithm` (venv `.venv-algorithm`) vào bootstrap; `node scripts/bootstrap-portable-simulation.mjs` → venv tạo được; `node scripts/portable-licenses.mjs` sinh `licenses.json`.
- [ ] **Step 2: Pytest đỏ** `robotics/algorithm/tests/test_kinematics.py`: `test_fk_identity_chain` (DH toàn 0 trừ một `d` → T tịnh tiến đúng `d`), `test_rejects_nan_and_oversize` (q chứa NaN → `INPUT_INVALID`; payload > 1 MiB → `INPUT_TOO_LARGE`), `test_unknown_op` → `OP_UNKNOWN`, `test_no_network_import` (assert `'robot_descriptions' not in sys.modules` sau `rtb_fk`).
- [ ] **Step 3:** `PYTHONPATH=robotics/algorithm .venv-algorithm/bin/python -m pytest robotics/algorithm/tests -q` → FAIL.
- [ ] **Step 4:** Viết `algorithm_checks`: dựng `DHRobot([RevoluteMDH(a=,alpha=,d=,offset=)…])`; `fkine`, `jacob0` + `numpy.linalg.cond`, `ikine_LM(…, q0=, joint_limits=True)`. Stdout chỉ có một dòng JSON; mọi thứ khác ra stderr. → pytest PASS.
- [ ] **Step 5: Vitest đỏ** `tests/integration/algorithm-kinematics.test.ts` (`describe.skipIf(!existsSync('.venv-algorithm/bin/python'))`):
  - `ALG01 both tables agree with RTB and their own golden` → mọi `AlgorithmResultV1` của ALG01 `verdict:'pass'`, `metrics.maxTranslationErrorM ≤ 1e-6`.
  - `ALG02 round trip both directions` → pass; nghiệm nằm trong `limits`.
  - `ALG03 jacobian and condition number` → pass; pose gần suy biến của `reference-poses.json` có `metrics.singularFlaggedBoth===1`.
  - `ALG05 beyond-reach and over-limit cases are rejected by both sides` → pass với `reasons` nêu mã từ chối của từng phía.
  - `a perturbed DH row makes ALG01 fail` (đổi `a2` thêm 1 mm chỉ ở phía Python) → `verdict:'fail'`.
- [ ] **Step 6: Test Review Focus #5** `tests/security/algorithm-checker.test.ts`: python không tồn tại → `CHECKER_NOT_INSTALLED` và `runKinematicsCases` trả `verdict:'not_run'` cho mọi case; entry double ngủ 60 s với `timeoutMs:200` → `CHECKER_TIMEOUT`, PID con đã chết; double in hai dòng JSON → `CHECKER_PROTOCOL`.
- [ ] **Step 7:** Viết `checker.ts` (spawn theo mẫu `createLinkForgeValidator`, env allowlist, kill theo deadline) và `kinematics-cases.ts`. → `pnpm test:integration -- tests/integration/algorithm-kinematics.test.ts` và `pnpm test:security -- tests/security/algorithm-checker.test.ts` PASS.
- [ ] **Step 8:** `pnpm typecheck && pnpm lint`; `pnpm test:integration -- tests/integration/portable-tool-closure.test.ts` PASS (root mới trong closure).
- [ ] **Step 9: Commit** `feat: Robotics Toolbox kinematics checker cross-checks both PUMA560 tables (ALG01-03, ALG05)`.

**Acceptance:** ALG01/02/03/05 `pass` trên RTB thật; ALG04 không có trong R1 (thuộc R3).

---

### Task W03: `pid-v1` và PID oracle (G-ALG2)

**Depends:** W02. **Files:**
- Create: `R/control/pid.ts`, `R/algorithm/pid-cases.ts`, `robotics/algorithm/algorithm_checks/pid.py`, `robotics/algorithm/tests/test_pid.py`, `scripts/lab-algorithm.mjs`
- Test: `tests/unit/pid.test.ts`, `tests/integration/algorithm-pid.test.ts`, `tests/unit/lab-algorithm-cli.test.ts`

**Interfaces — Produces:**

```ts
// R/control/pid.ts — thuần, không đọc đồng hồ
export interface PidConfig {kp:number;ki:number;kd:number;dtS:number;derivativeFilterHz:number;outMin:number;outMax:number}
export interface PidState {integral:number;dFiltered:number;prevMeasurement:number|null}
export const pidInit:()=>PidState
export function pidStep(c:PidConfig,s:PidState,setpoint:number,measurement:number):{u:number;state:PidState;saturated:boolean}
// R/algorithm/pid-cases.ts
export function runPidCases(checker,profile:OracleProfileV1,seed:number):Promise<AlgorithmResultV1[]> // PID01, PID02, PID03
```

Thuật toán `pid-v1` (cả TS và Python phải làm đúng thứ tự này để khớp 1e-9):

```
e      = setpoint - y
alpha  = dt / (dt + 1/(2*pi*fc))
raw    = prevMeasurement === null ? 0 : -(y - prevMeasurement)/dt        // đạo hàm trên measurement
dF     = dF + alpha*(raw - dF)
Icand  = I + ki*e*dt
uUnsat = kp*e + Icand + kd*dF
u      = clamp(uUnsat, outMin, outMax)
I      = (u !== uUnsat && sign(e) === sign(uUnsat - u)) ? I : Icand      // kẹp tích phân khi bão hòa cùng chiều
```

Plant kiểm thử (rời rạc ZOH chính xác): `y[k+1] = a*y[k] + (1-a)*K*u[k-delay] + d[k]`, `a = exp(-dt/tau)`. Tham số suy từ drive của fixture Serve trong test (không hardcode): `K = ωmax/τmax = 20/2.5 = 8 rad/s per N·m`; `tau = J/b` với `b = 2.5/20`, `J = (tổng khối lượng robot / 2) × 0.09²`. `dt = 0.02`, biên đầu ra `±2.5`.

Op Python: `pid_response` payload `{config:PidConfig, plant:{gain,tauS,delaySteps}, setpoint:number[], disturbance:number[], noise:number[]}` → `{y:number[],u:number[],integral:number[],linear:number[]|null}`. `noise` do TS sinh bằng `R/random.ts` và **truyền sang** (hai RNG khác nhau không bao giờ khớp). `linear` = nghiệm vòng kín tuyến tính bằng `scipy.signal.dlsim`, chỉ khi `kd===0`, không delay, và trace không chạm biên; ngoài ra `null`.

CLI: `node scripts/lab-algorithm.mjs run --out <dir> [--seed N]` → ghi `<dir>/algorithm-results.json` (`{results:AlgorithmResultV1[],oracleProfileDigest,lockDigest}`); exit 0 mọi `pass`, 1 có `fail`, 2 có `not_run`; từ chối `<dir>` đã tồn tại.

- [ ] **Step 1: Test đơn vị đỏ** `tests/unit/pid.test.ts`: `P only: u = kp*e`; `output never leaves [outMin,outMax]` (1000 bước, setpoint 100); `integral frozen while saturated in the error direction, resumes when error flips`; `first step has zero derivative`; `same inputs give identical outputs` (chạy hai lần, `toEqual`).
- [ ] **Step 2:** `pnpm test:unit -- tests/unit/pid.test.ts` → FAIL → viết `pid.ts` → PASS.
- [ ] **Step 3: Pytest đỏ → xanh** `test_pid.py`: `test_p_only_matches_linear` (`max|y-linear| ≤ 1e-9`), `test_rejects_nonfinite`, `test_length_mismatch` → `INPUT_INVALID`. Viết `pid.py` độc lập (không port từ TS: đọc đặc tả ở trên).
- [ ] **Step 4: Vitest đỏ** `tests/integration/algorithm-pid.test.ts`:
  - `PID01 step response P, PI, PID unsaturated` → `metrics.maxSampleError ≤ 1e-9`; với P và PI `metrics.maxLinearError ≤ 1e-9`; `overshoot`, `settlingTimeS` (dải 2%) của hai phía bằng nhau.
  - `PID02 saturation and recovery` → `metrics.maxAbsU ≤ 2.5`, `metrics.maxSampleError ≤ 1e-9`, `metrics.integralClampedSteps > 0`.
  - `PID03 delay 3 steps + seeded noise + load step` → `maxSampleError ≤ 1e-9`; chạy lại cùng seed cho cùng `inputDigest`.
  - `anti-windup removed on the Python side only → PID02 fails` (truyền cờ test `antiWindup:false` trong payload).
- [ ] **Step 5:** Viết `pid-cases.ts`, CLI. `pnpm test:integration -- tests/integration/algorithm-pid.test.ts` và `pnpm test:unit -- tests/unit/lab-algorithm-cli.test.ts` (parse cờ, từ chối out tồn tại, exit code) → PASS.
- [ ] **Step 6: Commit** `feat: pid-v1 reference controller with an independent Python oracle (PID01-03)`.

**Acceptance:** PID01–03 `pass`; `pid-v1` chưa được plant nào dùng (D09) — ghi rõ trong README của `robotics/algorithm`.

---

### Task W04: Fixed-step runner chung sau plant port

**Depends:** W01. **Files:**
- Create: `R/navigation2d/plant.ts`, `tests/fixtures/navigation2d/ir-chunk-hashes.json`
- Modify: `R/navigation2d/{runner,readiness,evidence}.ts`
- Test: `tests/integration/irsim-plant-port.test.ts`

**Interfaces — Produces:**

```ts
// R/navigation2d/plant.ts
export interface PlantIdentity {backendId:string;/** khối `engine` của evidence, đúng nhánh schema */engine:Record<string,unknown>;
  seedAlgorithm:string;limitations:readonly string[];coverage:{dynamics:boolean};capability:string /* 'irsim_navigation_v1' | 'sim3d_navigation_v1' */}
export interface PlantWorker {request(r:{protocol:string;requestId:string;runId:string;expectedTick:number;op:string;payload:unknown}):Promise<PlantResponse>;
  close(reason:string):Promise<void>;readonly state:'ready'|'failed'|'closed';readonly pid:number|undefined;readonly bootId:string|null;readonly stderrTail:string}
export interface PlantPort {identity:PlantIdentity;protocol:string;spawn(o:SpawnOptions):Promise<PlantWorker>;/** thêm pose3d vào record trajectory khi plant có */pose3d?(robot:unknown):{z:number;roll:number;pitch:number}|undefined}
export const irsimPlant:(runtime:IRSimRuntimeOptions)=>PlantPort
// runner.ts
export function createFixedStepScenarioRun(input:RunManifestInput,providers:RunProviders&{plant:PlantPort;runtime:IRSimRuntimeOptions}):Promise<ScenarioRun>
export const createIRSimScenarioRun /* giữ nguyên chữ ký; gọi createFixedStepScenarioRun với irsimPlant */
// readiness.ts: dispatcher chọn theo set.providers.amr
type PlantTable=Readonly<Record<string,{port:PlantPort;runtime:IRSimRuntimeOptions}>>
```

`WorkerLostError` dùng chung cho mọi plant (giữ ở `worker-client.ts`, re-export từ `plant.ts`).

- [ ] **Step 1: Ghi golden TRƯỚC khi sửa.** Viết `tests/integration/irsim-plant-port.test.ts`: chạy `IR-FD01` và `IR-FD07` bằng worker thật (seed cố định như `irsim-mission.test.ts`), tính sha256 của từng chunk trong run directory, so với `tests/fixtures/navigation2d/ir-chunk-hashes.json`; `UPDATE_GOLDEN=1` thì ghi file. Chạy `UPDATE_GOLDEN=1` **hai lần** trên code chưa sửa và `git diff --exit-code` giữa hai lần.
  - Hai lần khác nhau ở byte gzip → đổi sang hash NDJSON đã giải nén rồi lặp lại.
  - Vẫn khác → **DỪNG**, báo cáo trường nào không tất định; không tiếp tục W04.
- [ ] **Step 2:** Commit riêng golden + test: `test: pin IR-SIM evidence chunk hashes before the plant-port split`.
- [ ] **Step 3: Test đỏ bổ sung** trong cùng file: `dispatcher refuses a portable set whose amr provider has no plant` → `BACKEND_EXECUTION_DISABLED`; `a plant double with a different backendId writes that id into checkpoint.provider and report limitations` (dùng `entry` double của các test IR-SIM hiện có).
- [ ] **Step 4:** Tách: mọi chỗ `runner.ts` gọi `spawnIRSimWorker`, dựng request `'mekoniq-irsim/1'`, ghi `provider:'irsim_2d'`, limitations và `coverage.dynamics` → lấy từ `PlantPort`. `buildNavigationEvidence` nhận `PlantIdentity` thay vì hằng. Reader trajectory chấp nhận đúng tập khóa cũ hoặc cũ + `pose3d`. `dispatcher` nhận `PlantTable`.
- [ ] **Step 5:** `pnpm test:integration -- tests/integration/irsim-plant-port.test.ts` → PASS **không** `UPDATE_GOLDEN`. Rồi toàn bộ suite IR: `pnpm test:integration -- tests/integration/irsim-*.test.ts && pnpm test:security -- tests/security/irsim-*.test.ts && pnpm test:unit -- tests/unit/navigation2d-*.test.ts` → PASS.
- [ ] **Step 6:** `pnpm typecheck && pnpm lint`. **Commit** `feat: one fixed-step runner behind a plant port; IR-SIM chunk hashes unchanged`.

**Acceptance:** golden hash không đổi; không còn chuỗi `'irsim_2d'` hay `'mekoniq-irsim/1'` trong `runner.ts` (`grep -c` = 0).

---

### Task W05: Fixture `serve-3d-v1` và compiler `.wbt`

**Depends:** W04. **Files:**
- Create: `robotics/simulation-3d/{pyproject.toml,requirements.in,requirements.lock,licenses.json,README.md}`, `robotics/simulation-3d/fixtures/serve-3d-v1/{serve-3d-project.json,serve-3d-fleet-project.json,serve-3d-components.json,world3d.json,navigation-scene.json,navigation-scene-two-robot.json,manifest.json}`, `robotics/simulation-3d/webots_worker/{__init__,compile}.py`, `robotics/simulation-3d/tests/test_compile.py`
- Modify: `packages/lab-runtime/src/engineering/navigation-compiler.ts` (tham số `engine`, `world3d`), `scripts/{bootstrap-portable-simulation,portable-licenses}.mjs`, `scripts/native-sim/tool-identity.mjs`
- Test: `tests/unit/sim3d-fixtures.test.ts`

**Interfaces — Produces:**

```ts
// navigation-compiler.ts: tùy chọn mới, mặc định giữ hành vi cũ
compileNavigationScene(…, options?:{engine?:{id:'webots_3d';version:'R2025a';basicTimeStepMs:number};world3d?:World3DV1})
```

```py
# webots_worker/compile.py — thuần, không cần Webots
def compile_world(scene: dict, models: dict[str, dict], seed: int) -> str      # nội dung .wbt, tất định
class CompileError(Exception): code: str
# mã: MODEL_INERTIA_MISSING, MODEL_MASS_INVALID, JOINT_UNSUPPORTED, ASSET_PATH_ESCAPE, TIMESTEP_NOT_DIVISOR, WORLD3D_MISSING, NO_THIRD_CONTACT
```

Fixture: bản sao Serve từ `robotics/navigation-2d/fixtures/serve-demo-v1` + component `caster-ball` (cầu bán kính sao cho chạm sàn cùng mặt phẳng với bánh, khớp `fixed`, một trước một sau, khối lượng 0.15 kg, mọi giá trị `assumed`). `world3d.json`: `{obstacleHeightM:0.75, wallHeightM:1.2, floorFriction:0.8, casterFriction:0.02, provenance:'assumed'}`. `manifest.json` cùng dạng với fixture 2D. **Không sửa byte nào trong `serve-demo-v1`.** `requirements.in` của worker chỉ cần `jsonschema` (thư viện `controller` đến từ `WEBOTS_HOME`).

Ánh xạ `.wbt`: `WorldInfo{basicTimeStep, optimalThreadCount 1, randomSeed <seed>}`; mỗi robot một `Robot{controller "<extern>", synchronization TRUE, name <robotId>}` với `Solid`/`Physics{mass, inertiaMatrix}` cho từng link, `HingeJoint` + `RotationalMotor{maxVelocity, maxTorque}` + `PositionSensor` cho mỗi bánh, caster là `Solid` cầu có `contactMaterial "caster"`, `Lidar` theo sensor model (360 tia, 0.05–10 m, một layer); vật cản = polygon đùn `obstacleHeightM` (`IndexedFaceSet`), tên `DEF` = ID vật cản của scene; một `Robot{supervisor TRUE, controller "<extern>", name "mekoniq_supervisor"}`; `ContactProperties` cho cặp caster–sàn và bánh–sàn.

- [ ] **Step 1: Test đỏ** `tests/unit/sim3d-fixtures.test.ts`: `serve-demo-v1 manifest hashes are untouched` (so với giá trị trong `candidate-03/native-handoff.md` §2.1: `serve-project.json` bắt đầu `5ca48410be47efe5`, `navigation-scene.json` `4aff7df1b8daa33b`); `serve-3d-v1 resolves, has two caster links per robot, and its footprint equals the 2D footprint`; `scene compiled for webots carries engine.id webots_3d and world3d and validates`; `LiDAR mount height is below obstacleHeightM`.
- [ ] **Step 2:** FAIL → dựng fixture (qua đúng đường resolve/compile mà fixture 2D dùng; đọc README của `robotics/navigation-2d` để biết lệnh sinh) + sửa `navigation-compiler.ts` → PASS. `pnpm test:unit -- tests/unit/navigation2d-compiler.test.ts tests/unit/navigation2d-fixtures.test.ts` vẫn PASS.
- [ ] **Step 3: Pytest đỏ** `test_compile.py`: `test_deterministic` (hai lần gọi → cùng chuỗi); `test_contains_one_extern_robot_per_scene_robot_and_one_supervisor`; `test_obstacle_defs_match_scene_ids`; `test_timestep_must_divide_20ms` (7 → `TIMESTEP_NOT_DIVISOR`); `test_zero_mass_rejected`; `test_missing_inertia_rejected`; `test_prismatic_joint_rejected` → `JOINT_UNSUPPORTED`; `test_two_wheel_model_without_caster_rejected` (truyền model của `serve-demo-v1`) → `NO_THIRD_CONTACT`; `test_mesh_path_outside_bundle_rejected`.
- [ ] **Step 4:** Lock + bootstrap `.venv-webots`; `PYTHONPATH=robotics/simulation-3d:robotics/simulation .venv-webots/bin/python -m pytest robotics/simulation-3d/tests -q` FAIL → viết `compile.py` → PASS.
- [ ] **Step 5:** `pnpm test:integration -- tests/integration/portable-tool-closure.test.ts` PASS. **Commit** `feat: serve-3d-v1 fixture with casters and a deterministic Webots world compiler`.

**Acceptance:** compiler chạy không cần Webots; `serve-demo-v1` nguyên vẹn.

---

### Task W06: `webots_worker`, client, readiness (G-WB1)

**Depends:** W05, kết quả W00. **Files:**
- Create: `robotics/simulation-3d/webots_worker/{__main__,protocol,engine,supervisor,robot_controller,snapshot}.py`, `robotics/simulation-3d/tests/{test_protocol,test_snapshot}.py`, `R/simulation3d/{worker-client,webots,readiness,lidar-oracle}.ts`
- Modify: `R/capabilities.ts` (backend + set, D02), `R/navigation2d/readiness.ts` (ghép plant Webots vào `PlantTable`), `R/gateway.ts` (quảng bá `sim3d_navigation_v1` khi `webots_3d` installed+reachable), `packages/lab-runtime/src/cli.ts` (flag `MEKONIQ_LAB_WEBOTS`, `MEKONIQ_WEBOTS_HOME` mặc định `/Applications/Webots.app`)
- Test: `tests/integration/webots-worker.test.ts`, `tests/integration/webots-readiness.test.ts`, `tests/unit/sim3d-lidar-oracle.test.ts`

**Interfaces — Produces:**

```ts
// R/simulation3d/webots.ts
export const WEBOTS_AMR={id:'webots_3d',version:'R2025a',model:'webots_diff_drive',dynamics:true} as const
export interface WebotsRuntimeOptions extends IRSimRuntimeOptions {webotsHome:string;executableSha256:string;basicTimeStepMs:number}
export const webotsPlant:(runtime:WebotsRuntimeOptions)=>PlantPort      // protocol 'mekoniq-sim3d/1', capability 'sim3d_navigation_v1',
                                                                       // limitations gồm 'not_calibrated: every physical parameter is assumed'
// R/simulation3d/worker-client.ts
export function spawnSim3DWorker(o:SpawnOptions&{webotsHome:string;module:'webots_worker'}):Promise<PlantWorker>   // cùng luật ACK với spawnIRSimWorker
// R/simulation3d/readiness.ts
export interface WebotsOptions {enabled:boolean;python:string;workerRoot:string;lockPath:string;webotsHome:string;directory:string;entry?:string[]}
export function webotsFromOptions(o:WebotsOptions):Promise<{plant?:{port:PlantPort;runtime:WebotsRuntimeOptions};capability:BackendCapability;readinessChecks?:NativeReadinessChecks}>
// R/simulation3d/lidar-oracle.ts
export function castScan(scene:NavigationSceneV1,pose:{x:number;y:number;yaw:number},sensor:{beams:number;minM:number;maxM:number}):number[]
```

Worker: `python -I -B … -m webots_worker --run-id --bundle-root --schema-dir --lock-digest --scene-digest --webots-home [--fixture-sha256]`. `create`: compile `.wbt` vào run directory → chọn port tự do → khởi động Webots (cờ chốt ở W00) → supervisor nối → khởi động một tiến trình `robot_controller` mỗi robot → chờ tất cả sẵn sàng → đọc lại model từ engine. `step`: gửi `[v,ω]` → mỗi controller đổi sang `ω_L,R = (v ∓ ω·separation/2)/wheelRadius`, đặt motor velocity → mọi controller `step(20)` → supervisor gom pose/vận tốc/`pose3d`/contact → một snapshot. `collisionIds` = ID vật cản/robot mà solid **không phải bánh/caster** chạm. Capacity: tối đa **một** run Webots sống trên host (`maxActiveRuns:1`).

Reason code readiness (SX-11): `WEBOTS_DISABLED`, `WEBOTS_NOT_INSTALLED`, `WEBOTS_VERSION_MISMATCH`, `WEBOTS_NO_GUI_SESSION`, `WEBOTS_WORKER_UNAVAILABLE`, `WEBOTS_LOCK_MISMATCH`, `WEBOTS_PORT_IN_USE`.

Mọi test cần engine dùng `describe.skipIf(!webotsReady)` với `webotsReady` = executable tồn tại và `--version` đúng `R2025a`; test dùng double thì không skip.

- [ ] **Step 1: Pytest đỏ → xanh** (không cần Webots): `test_protocol.py` — envelope sai protocol → `PROTOCOL_MISMATCH`; `step` với `expectedTick` lệch → từ chối không đổi state; cùng `requestId` + cùng payload → trả lại receipt cũ; `test_snapshot.py` — `wheel_floor_contacts_are_not_collisions`, `body_obstacle_contact_yields_obstacle_id`, `nan_pose_raises_PLANT_UNSTABLE`, `body_velocity_to_wheel_speeds` (`v=0.5, ω=0` → hai bánh `0.5/0.09`; `v=0, ω=1` → `∓0.18/0.09`).
- [ ] **Step 2: Vitest đỏ với double** `tests/integration/webots-readiness.test.ts`: flag tắt → backend `installed:false`, reason bắt đầu `WEBOTS_DISABLED`, `/health` **bằng** snapshot trước khi có task này (so với `/health` khi không có tùy chọn Webots); `webotsHome` không tồn tại → `WEBOTS_NOT_INSTALLED`; double `--version` in `R2025b` → `WEBOTS_VERSION_MISMATCH` (Review Focus #3); double describe trả lockDigest khác → `WEBOTS_LOCK_MISMATCH`; double báo port bận → `WEBOTS_PORT_IN_USE` và không có `create` nào được gửi (Review Focus #1); double không bao giờ làm backend `installed:true`.
- [ ] **Step 3: Vitest đỏ với engine thật** `tests/integration/webots-worker.test.ts`:
  - `WB08 clock`: 500 `step` → `tick` đơn điệu, `simTimeNs === tick*20_000_000`, `bootId` không đổi; `step` thứ hai gửi khi cái đầu chưa ACK bị client từ chối.
  - `WB01 model parity`: sau `create`, `getState` trả khối `model` đọc từ engine; so với `RobotPhysicalModelV1`: khối lượng từng link ≤ 1e-6 kg, vị trí link ≤ 1e-4 m, trục bánh song song ≤ 1e-6, `wheelRadius`/`separation` ≤ 1e-4 m.
  - `WB01 stands`: 250 tick lệnh 0 → `|roll|,|pitch| ≤ 0.02 rad`, `|Δx|,|Δy| ≤ 1e-3 m`.
  - `WB02 lidar`: robot đứng yên tại spawn → `max|range − castScan| ≤ 0.03 m` trên các tia không sượt mép (bỏ tia mà hai tia kề lệch nhau > 0.2 m), mọi giá trị hữu hạn, `LidarScanV1` hợp lệ.
  - `drives straight`: `[0.3,0]` trong 100 tick → `Δx` trong `0.6 ± 0.05 m`, `|Δy| ≤ 0.02`.
  - `kill`: `SIGKILL` Webots giữa run → request kế tiếp ném `WorkerLostError` `outcome:'unknown'` trong ≤ 5 s; sau `close`, `pgrep -f "Webots.app"` rỗng và không còn `robot_controller`.
- [ ] **Step 4:** Viết worker + client + readiness + catalog/CLI. Chạy: pytest; `pnpm test:unit -- tests/unit/sim3d-lidar-oracle.test.ts`; `pnpm test:integration -- tests/integration/webots-readiness.test.ts tests/integration/webots-worker.test.ts` → PASS, **0 skipped** trên máy có Webots.
- [ ] **Step 5:** Nếu `WB01 stands` không đạt sau khi chỉnh `ContactProperties`/vị trí caster trong fixture (W05) → **DỪNG**, báo cáo số đo; không thêm ràng buộc khóa pitch.
- [ ] **Step 6:** Toàn bộ suite IR-SIM + `irsim-plant-port` vẫn PASS. `pnpm typecheck && pnpm lint`. **Commit** `feat: webots_3d plant worker, client and readiness (WB01, WB02, WB08)`.

**Acceptance:** G-WB1 có test xanh trên engine thật; flag tắt không đổi gì.

---

### Task W07: `WB-FD01` / `WB-FD07` qua source (G-WB2)

**Depends:** W06. **Files:**
- Create: `R/simulation3d/scenario-fixtures.ts`
- Modify: `R/scenario-registry.ts`, `R/scenario-matrix.ts`, `R/navigation2d/runner.ts` (kiểm `PLANT_UNSTABLE`)
- Test: `tests/integration/webots-mission.test.ts`, `webots-fleet.test.ts`, `webots-faults.test.ts`, `webots-evidence.test.ts`, `tests/security/webots-authority.test.ts`

**Interfaces — Produces:** scenario `WB-FD01` (`basedOn:'FD01'`, project `serve-3d-v1`), `WB-FD07` (`basedOn:'FD07'`, `serve-3d-fleet`); `scenarioIds` của set `engineering-webots-3d-v1` = hai ID này. Thêm hai rig chỉ dùng trong campaign, theo mẫu `RIG_SCENARIOS` của IR-SIM: `WB-FD01-cancel`, `WB-FD01-enginekill`. Oracle dùng lại nguyên các oracle của `IR-FD01`/`IR-FD07` trong `navigation2d/scenario-fixtures.ts` (xuất chúng ra dùng chung, không sao chép). Runner: nếu `|roll|` hoặc `|pitch|` > 0.35 rad, hay pose không hữu hạn → run kết thúc `failed` với `PLANT_UNSTABLE`.

- [ ] **Step 1: Test đỏ** (engine thật, `skipIf(!webotsReady)`):
  - `webots-mission`: `WB03` — `WB-FD01` tới bàn; **trước** confirmation journal không có served; sau confirmation → served, park; mọi assertion của FD01 pass; report có `provider:'webots_3d'`, `coverage.dynamics:true`, limitation `not_calibrated`.
  - `webots-fleet`: `WB04` — `BOTH_ROBOTS_MOVED`, `ZONE_SINGLE_OWNER` pass; report mang nguyên văn ghi chú tuần tự hóa `__venue_movement__` của IR04.
  - `webots-faults`: `WB05` — cancel giữa đường → dừng, không served; kill worker / kill Webots / deadline `step` 200 ms với double trễ → run `unknown`/suspended, không resend, không engine mới, không tiến trình sót (Review Focus #2: thêm case "Webots thoát sạch với exit 0 giữa run", mô phỏng người dùng Quit). `PLANT_UNSTABLE`: double trả `pitch:1.2` → run `failed` với đúng mã, trong ≤ 2 tick (Review Focus #4).
  - `webots-evidence`: `WB07` — đủ tick ở bốn stream; trajectory có `pose3d`; xóa một chunk → reader fail; `WB06` — ba run cùng seed: pose cuối lệch nhau ≤ dung sai đo ở W00 (ghi vào `oracle-profile-v1.json` khóa `webots.repeatPoseM`).
  - `webots-authority` (double): request từ browser không thể đặt `webotsHome`, port, đường dẫn `.wbt` hay `entry`; mọi trường lạ bị schema từ chối.
- [ ] **Step 2:** FAIL → thêm scenario, matrix rows, fixture specs, kiểm `PLANT_UNSTABLE` → PASS, 0 skipped.
- [ ] **Step 3:** Suite IR-SIM + `irsim-plant-port` PASS. **Commit** `feat: WB-FD01 and WB-FD07 run on the Webots plant under source authority (WB03-07)`.

**Acceptance:** G-WB2 có test xanh trên engine thật.

---

### Task W08: Export, Lab và hành trình trình duyệt (G-INT2)

**Depends:** W07. Hai repo; commit source trước, Lab re-pin sau.

**Files (source):** Modify `scripts/export-lab-runtime.mjs` (`portableSimulationTools.tools += algorithm_checks, webots_worker`; `flags += MEKONIQ_LAB_WEBOTS`; ghi `hostEngines:[{id:'webots_3d',version:'R2025a',bundled:false}]`), `tests/integration/lab-runtime-artifact.test.ts`.

**Files (lab):**
- Modify: `lab/src/scenarios/{support,catalog}.ts`, `lab/src/i18n/*`, `lab/src/viewer/twin3d.ts`, `lab/src/reports/replay.ts`, `lab/scripts/start-irsim.mjs` → nhận `--provider irsim|webots`, `lab/scripts/test-irsim-e2e.mjs` → nhận provider, `lab/package.json` (`lab:webots`, `test:webots-e2e`)
- Test: `lab/tests/unit/{backend-options,pose3d}.test.ts`, `lab/tests/integration/webots-launcher.test.ts`, `lab/tests/e2e/{webots-journey,webots-fleet}.spec.ts`

**Interfaces:** `backendSetOptions(health)` lấy capability cần thiết từ **bảng theo provider** `{irsim_2d:'irsim_navigation_v1', webots_3d:'sim3d_navigation_v1'}` thay cho chuỗi cứng ở `support.ts:17`. Launcher: `pnpm lab:webots` = `node scripts/start-irsim.mjs --provider webots`; mã dừng thêm `WEBOTS_NOT_INSTALLED`, `WEBOTS_VERSION_MISMATCH`. Twin 3D: khi sample có `pose3d` thì đặt `z/roll/pitch`; không có thì như cũ. LiDAR/contact vẫn chỉ 2D với `ONLY_2D_REASON` hiện có.

- [ ] **Step 1 (source):** test đỏ artifact (manifest có hai tool mới, `hostEngines`, không có byte Webots nào trong artifact) → sửa exporter → PASS → commit `feat: export algorithm and webots worker tools; Webots is a host engine, never bundled`.
- [ ] **Step 2 (lab): re-pin.** `node ../source/scripts/export-lab-runtime.mjs <dir>` (source sạch) → `node scripts/import-runtime.mjs <dir>` → `node scripts/sync-engineering-contracts.mjs && pnpm check:source` → commit `chore: pin source runtime <sha>`.
- [ ] **Step 3 (lab): test đơn vị đỏ → xanh.** `backend-options`: health không có `webots_3d` → danh sách option **bằng** snapshot hiện tại; có `webots_3d` nhưng thiếu `sim3d_navigation_v1` → option bị khóa với `CAPABILITY_MISSING:sim3d_navigation_v1`; đủ → chọn được. `pose3d`: sample có `pose3d` đặt đúng transform three.js (z-up → y-up qua `ROS_TO_THREE`); thiếu → z = 0. i18n: mọi khóa mới có đủ vi/ja/en (test i18n hiện có phải bắt được khóa thiếu).
- [ ] **Step 4 (lab): launcher.** `webots-launcher.test.ts`: không có Webots → exit với `WEBOTS_NOT_INSTALLED`, không mở cổng 4175/4176; closure đổi → `PORTABLE_TOOLS_MISMATCH`.
- [ ] **Step 5 (lab): e2e**, mỗi spec một launcher: `pnpm test:webots-e2e -- webots-journey.spec.ts` (Assembly → Validate → chọn set Webots → `WB-FD01` → xác nhận giao → report nêu `webots_3d`/`R2025a`/`not_calibrated` → replay chạy trong twin 3D → đổi ngôn ngữ vi/ja/en, chụp màn hình desktop + tablet); `pnpm test:webots-e2e -- webots-fleet.spec.ts` (`WB-FD07`, hai robot).
- [ ] **Step 6 (lab): regression.** `pnpm typecheck && pnpm exec vitest run && pnpm test:mock-e2e` và `pnpm test:irsim-e2e -- irsim-journey.spec.ts` → PASS. Commit `feat: Webots backend set, launcher and 3D pose in the twin`.

**Acceptance:** INT11, INT12 xanh; `lab:mock` và `lab:irsim` không đổi hành vi.

---

### Task W09: Campaign, qualification và record R1

**Depends:** W03, W08. **Files:**
- Create: `scripts/sim-extension-qualification.mjs`, `scripts/record-sim-extension.mjs`, `robotics/simulation-3d/campaigns/r1-qualification.json`, `tests/acceptance/sim-extension.acceptance.test.ts`, `tests/unit/sim-extension-qualification.test.ts`
- Modify: `scripts/irsim-qualification.mjs` (`qualify`/`checkQualification` nhận bảng và `documentType` làm tham số; export mặc định giữ hành vi cũ), `scripts/test-runner.mjs` (alias `sim-extension`), `R/navigation2d/batch.ts` (campaign chọn plant theo `backendSetId`), `scripts/lab-irsim.mjs` (cờ `--provider`)

**Interfaces — Produces:**

```js
// sim-extension-qualification.mjs
export const SUITES, CASES, GATES   // GATES = {'G-ALG1':['ALG01','ALG02','ALG03','ALG05'],'G-ALG2':['PID01','PID02','PID03'],
                                    //  'G-WB1':['WB01','WB02','WB08'],'G-WB2':['WB03','WB04','WB05','WB06','WB07'],
                                    //  'G-INT2':['INT11','INT12'],'G-REG1':['REG01']}
// CASES.ALG04 = {notRun:'R3: the joint trace needs a running LinuxCNC bridge'}  (không thuộc gate R1 nào)
// CASES.WB04.note = ghi chú tuần tự hóa của IR04, nguyên văn
// REG01 = {suites:['irsim-record'], …}: tested khi record linkforge-irsim cùng sourceCommit có đủ sáu gate tested
```

`record-sim-extension.mjs --release r1 --out docs/implementation/evidence/sim-extension/r1-candidate-NN --candidate-id r1-candidate-NN --irsim-record <dir candidate-04> [--lab DIR]`: cùng các từ chối với `record-irsim.mjs` (out tồn tại, source/Lab dirty, Lab pin khác commit, bytecode dưới tool root) + từ chối khi `--irsim-record` có `sourceCommit` khác. Ghi `qualification.json` (`documentType:'sim-extension-qualification'`, `accepted:false`, `acceptedBy:null`, `identity` gồm version + sha256 executable Webots, lock digest ba venv, `oracleProfileDigest`), `algorithm-results.json`, `campaign/`, `suites/`, `performance.json` (p50/p95 tick, RTF, RSS của Webots), `screens/`, `README.md`. Exit 0 ok / 1 failed / 2 not_run.

Campaign `r1-qualification.json` (≥ 20 run, tuần tự): `WB-FD01` ×3 cùng seed, `WB-FD07` ×3 cùng seed, `WB-FD01` ×6 và `WB-FD07` ×6 seed khác nhau, `WB-FD01-cancel` ×1, `WB-FD01-enginekill` ×1.

- [ ] **Step 1: Test đỏ** `tests/unit/sim-extension-qualification.test.ts`: suite có test skipped → case `not_run`, gate `not_run` (không `tested`); thiếu Webots → `G-WB1/2`, `G-INT2` `not_run`, `G-ALG1/2` vẫn `tested`; `accepted:true` trong record → `checkQualification` trả lỗi; record thiếu `algorithm-results.json` → lỗi; `--irsim-record` khác commit → từ chối; bảng cũ của `irsim-qualification.mjs` cho **cùng kết quả** trên `candidate-03` như trước khi tham số hóa.
- [ ] **Step 2:** FAIL → tham số hóa lõi, viết bảng/recorder/alias/campaign → PASS. `LAB_IRSIM_EVIDENCE_DIR=docs/implementation/evidence/linkforge-irsim/candidate-03 pnpm test:acceptance -- linkforge-irsim` vẫn PASS.
- [ ] **Step 3:** Commit source `feat: sim-extension qualification, recorder and acceptance guard`. Lab re-pin (như W08 Step 2), commit.
- [ ] **Step 4: Ghi regression IR-SIM** trên commit này (~20 phút): `node scripts/record-irsim.mjs --out docs/implementation/evidence/linkforge-irsim/candidate-04 --candidate-id candidate-04`. Expected: exit 0, sáu gate `tested`, IR07 giữ nguyên ghi chú. Theo quy ước repo, xóa `candidate-03` khỏi tree trong **cùng** commit ghi candidate-04 (vẫn còn trong git history) và cập nhật CLAUDE.md/README trỏ tới candidate-04. Chạy R-MOCK: `(cd ../lab && node scripts/record-regression.mjs --suite physical-robot-lab --out docs/implementation/evidence/sim-extension-r1/regression)`.
- [ ] **Step 5: Ghi candidate R1:** `node scripts/record-sim-extension.mjs --release r1 --out docs/implementation/evidence/sim-extension/r1-candidate-01 --candidate-id r1-candidate-01 --irsim-record docs/implementation/evidence/linkforge-irsim/candidate-04`. Rồi `LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r1-candidate-01 pnpm test:acceptance -- sim-extension` → PASS.
- [ ] **Step 6:** Recorder exit 1/2 → **không** sửa record bằng tay; sửa nguyên nhân, ghi `r1-candidate-02`, xóa candidate hỏng. Commit `docs: record linkforge-irsim candidate-04 and sim-extension r1-candidate-01` (source) và commit evidence phía Lab.
- [ ] **Step 7:** Viết `r1-candidate-01/README.md`: bảng gate (`tested`/`not_run`/`blocked`, tất cả `accepted:false`), những gì **không** được suy ra (cột cuối bảng gate của spec §6.3), số đo hiệu năng, danh sách giả định `assumed`. Cập nhật `docs/implementation/README.md` và mục LinkForge/IR-SIM của CLAUDE.md.

**Acceptance:** sáu gate R1 có trạng thái đúng với bằng chứng; không gate nào `accepted`; `ALG04` `not_run` có lý do.
