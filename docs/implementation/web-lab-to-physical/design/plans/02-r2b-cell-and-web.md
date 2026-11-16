# R2b Continuous Cell and Web Experience — Implementation Plan

**Hiện trạng sau N1, 16/11:** [kết quả mới](../../post-n1-final-recording/status.md), [tái hiện](../../post-n1-final-recording/reproduce.md) và [disposition](../../post-n1-final-recording/dispositions.md) dùng Source `0d46403` / Lab `7c97b20`. Review giữ verdict lịch sử ở tuple/scope đã nêu; capture mới và bốn assertions mock chưa giải quyết, native/physical chưa nghiệm thu. Các snapshot/kế hoạch cũ bên dưới giữ ngày và identity riêng.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một cốc đi liên tục từ vòi, qua xArm, lên AMR tới bàn; người dùng xem/chạy/điều tra/replay trên cùng UI web.

**Architecture:** World port dùng chung một MuJoCo instance; scenario lifecycle source giữ authority. Browser chỉ hiển thị observations và gửi intent. Physics artifacts/replay package có integrity/coverage riêng.

**Tech Stack:** Toolchain/pin theo [Global Constraints](README.md#global-constraints), giữ three.js và fetch-SSE R2a.

**Spec:** [R2b §6–9](../02-r2b-web-lab-spec.md), [contracts/evidence](../03-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Không dùng hai workers cho arm–AMR trong cell; không teleport/weld cốc; không đổi semantics `MJ-BV01`; không hardware, không tự deploy.

## Task B05 — World seam và spike handoff chung engine

**Files:**

- Create `source/packages/contracts/schemas/lab-world-scene-v1.schema.json`.
- Create `source/packages/lab-runtime/src/v2/simulation3d/{world-ports,world-step,world-scene}.ts`.
- Modify `source/packages/lab-runtime/src/v2/{scenario-runner,capabilities}.ts`, `v2/navigation2d/readiness.ts`, `v2/beverage/coffee-ports.ts` ở seam được test.
- Create `source/robotics/simulation-mujoco/mujoco_worker/{compile_world,world_engine}.py`.
- Create fixture `source/robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1/`, gồm project, `lab-world-scene.json`, `handoff-policy.json`, `programs.json`, README.
- Test `source/tests/unit/world-step.test.ts`, `source/tests/integration/mujoco-world-rig.test.ts`, `source/robotics/simulation-mujoco/tests/test_world.py`.

**Interfaces:** `WorldPlantPorts`, `WorldPortsFactory`, `WorldPlantBindings` theo contracts §3; thêm `RunProviders.worldPorts` factory chỉ dành set `composition:'single_world'`. Factory nhận `WorldFactoryInput` chứa manifest/runId/directory/state/context/newBootId, trả world + AMR adapters + coffee ports + committed snapshot getter; không nhận transport URL từ browser. `stepWorldOnce(port, tick, append)` trả snapshot ACK sau append/commit; `append` nhận snapshot, là callback durable recorder do source cung cấp.

**Phạm vi refactor bắt buộc:** `scenario-runner.ts` hiện khởi tạo MockPlant, lấy dock/poses từ `cp.plant`, và `tick()` tăng clock rồi gọi `plant.advance(); coffee.advance()`. Tách view/checkpoint/adapters khỏi mock stepping cho world path. Giữ default mock branch; new branch chỉ tăng clock sau ACK/persist đúng. Không chỉ ghi đè `cp.plant.robots[].pose` sau khi MockPlant đã phát arrival.

- [ ] Viết golden regression trước seam: BV01 mock outcome, R2a arm ports behavior, dispatch count/custody/events; world dispatcher missing factory phải từ chối, không rơi xuống arm-only.
- [ ] Viết `world-step.test.ts`: prepare/step/append/commit mỗi thứ đúng 1 lần theo thứ tự; mất ACK không append/commit; append thất bại không commit và caller không được retry engine. Chạy fail.
- [ ] Định nghĩa shared physical-world bindings cho RobotAdapter và CoffeePlantPorts. Arm program được tách command preparation khỏi observation commit; coffee mock được advance đúng một lần, không tự tiến physics. Cùng snapshot cấp actual AMR dock, arm joints, props cho source.
- [ ] Compiler world ghép model trước khi `MjModel` được tạo; namespace IDs; bỏ tray support tĩnh cũ đúng ID, thay tray body con AMR. Sinh home/dock/waypoints từ scene mới, so FK/IK/sweep và không initial collision.
- [ ] Run rig nhỏ: AMR dock yên → arm gắp/đặt → rút → AMR đi 1 m; một cup free body. Ghi cup pose/velocity/contacts/custody qua mọi tick, xác nhận worker count=1 và total physics substeps=10×logical steps cộng priming đã khai.
- [ ] Rig 10/10 lần cùng cấu hình với offsets seed ±5 mm nếu còn trong miền fixture; không NaN, không prop jump, đúng receiver window. Không đạt: lưu probe, dừng full-cell, vẫn bàn giao B04/replay. Không đổi sang weld.
- [ ] Focused tests + legacy golden; commit `feat: coordinate arm and AMR through one MuJoCo world`; re-pin.

Thuật toán core mới trong `world-step.ts` phải thể hiện rõ thứ tự này; validation ACK chi tiết tiếp tục thuộc worker client:

```ts
export async function stepWorldOnce(
  port: WorldPlantPorts,
  tick: number,
  append: (snapshot: Sim3DSnapshotV1) => Promise<void>,
): Promise<Sim3DSnapshotV1> {
  const command = port.prepareTick(tick + 1);
  if (command.targetTick !== tick + 1) throw new Error('WORLD_TARGET_TICK_INVALID');
  const snapshot = await port.step(command);
  if (snapshot.tick !== tick + 1) throw new Error('WORLD_ACK_TICK_INVALID');
  await append(snapshot);
  await port.commit(snapshot);
  return snapshot;
}
```

`WorldPlantPorts` và `Sim3DSnapshotV1` được import từ contracts/interface ở spec. Caller giữ serialized action queue, pending operation journal và terminal failure latch; helper này không được dùng làm retry function. Clock R2a arm-only không bị đổi nhờ shared helper.

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/world-step.test.ts tests/unit/bv01-mock-golden.test.ts tests/unit/mujoco-arm-ports.test.ts
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_world.py -q
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-world-rig.test.ts
```

## Task B06 — Source workflow, custody và MJ-CELL-BV01

**Files:**

- Create `source/packages/lab-runtime/src/v2/simulation3d/{mujoco-world-ports,handoff-policy}.ts`.
- Modify `source/packages/lab-runtime/src/v2/{scenario-registry,scenario-matrix,twin-projection,report}.ts`, `v2/beverage/{coffee-ports,cup-ledger}.ts`, model scene/sweep integration trong world path.
- Add scenario/campaign fixture trong `source/robotics/simulation-mujoco/campaigns/`.
- Test `source/tests/unit/world-handoff-policy.test.ts`, `source/tests/integration/mujoco-cell-bv01.test.ts`, `mujoco-cell-faults.test.ts`, `source/tests/security/mujoco-world-authority.test.ts`.

**Interfaces:** `evaluateDockWindow(samples,policy):{ready:boolean;reasonCodes:string[]}` và `evaluateTrayReceipt(samples,policy):{ready:boolean;reasonCodes:string[]}` ở `handoff-policy.ts`. Input samples chứa tick, measured XY/yaw errors, v/ω, supportId, relative speed, insideSupportMargin, held; policy đủ thresholds từ fixture. Produces source-correlated transfer evidence qua CupLedger hiện có; new scenario `MJ-CELL-BV01` chỉ trong cell set.

- [ ] Test readiness windows: 9 stationary ticks chưa đủ, 10 đủ; moving dock reset window; sai robot/tray/epoch/command không accept; 24 release ticks chưa đủ, 25 đủ; missing/late sample invalidates window.
- [ ] Test custody: giver và receiver độc lập trong logic quan sát, cùng engine provenance; command success không tự thành grip/release. Prop giữ nguyên ID và dynamic pose sau chuyển custody.
- [ ] Implement state sequence spec; movement interlock tới khi arm ra withdrawal corridor. Capsule sweep đọc actual AMR geometry/pose từ world; allowedContacts chỉ phase/pair/region cụ thể, không bỏ toàn thân robot khỏi collision oracle.
- [ ] `propPlacements` chỉ ở create-at-nozzle và scripted recipient pickup; ledger transfer không placement. Mỗi placement có interaction record; reject move-held-prop, duplicate spawn, remove-before-confirmation.
- [ ] Nominal 3 seeds: served=2 sau hai confirmations, đầy đủ arm/AMR/cup traces; compare input/world/model digest end-to-end.
- [ ] Fault matrix: dock trôi, cup rơi trên đường, cancel khi giữ cốc, mất worker, mất ACK. Mỗi lỗi có đúng code/state/custody; không auto-open/no auto-resend/không served nhầm. Lost worker không tạo cốc mới khi reopen.
- [ ] Focused tests và R2a `MJ-BV01` hồi quy; commit `feat: deliver coffee through a continuous MuJoCo cell`; re-pin.

Test policy example (fixture samples tạo trực tiếp để không dùng output engine làm oracle cho chính nó):

```ts
const stationary = (tick:number) => ({tick,robotId:'amr-1',trayId:'tray-1',
  xyErrorM:0.004,yawErrorRad:0.005,vMps:0,omegaRadps:0,valid:true});
const policy = {robotId:'amr-1',trayId:'tray-1',maxXyM:0.01,maxYawRad:0.02,
  maxVMps:0.01,maxOmegaRadps:0.02,holdTicks:10};
expect(evaluateDockWindow(Array.from({length:9},(_,i)=>stationary(i+1)),policy).ready).toBe(false);
expect(evaluateDockWindow(Array.from({length:10},(_,i)=>stationary(i+1)),policy).ready).toBe(true);
```

```sh
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/unit/world-handoff-policy.test.ts tests/integration/mujoco-cell-bv01.test.ts tests/integration/mujoco-cell-faults.test.ts tests/security/mujoco-world-authority.test.ts
```

## Task B07 — Trải nghiệm web và replay không cần runtime

**Cập nhật thực thi 14/11:** chia tuần tự B07a (package/export, quyền truy cập snapshot và reader có giới hạn) → B07b (UI/offline entry, camera/story, browser/a11y/performance). Giữ toàn bộ checklist dưới đây; B07 chỉ hoàn tất sau review cả hai. Xem [quyết định triển khai](../05-implementation-decisions.md).

**Files:**

- Create `source/packages/contracts/schemas/web-replay-package-v1.schema.json`, `source/scripts/export-web-replay.mjs`.
- Create `lab/src/reports/replay-package.ts`, `lab/src/twin/story-camera.ts`; modify `lab/src/{reports/replay,reports/report-shape,twin/sample-buffer,viewer/twin3d,ui/run-bar,ui/problems,ui/report-panel,scenarios/catalog}.ts` và CSS/i18n cạnh mã hiện có.
- Create `lab/public/replays/catalog.json` và gói demo nhỏ sau khi có recording mới; không dùng trace tổng hợp làm replay “đã chạy”.
- Test `lab/tests/unit/replay-package.test.ts`, `story-camera.test.ts`, `lab/tests/e2e/{mujoco-cell,replay-offline,payload-story}.spec.ts`; source test `tests/security/web-replay-export.test.ts`.

**Interfaces:** exporter `node scripts/export-web-replay.mjs --input RUN_DIR --out NEW_DIR`; `openReplayPackage(manifest,readAsset)` validate schema/hash/coverage và trả reader không có runtime transport. `storyCameraTransition(state,event)` thuần; event `manual-orbit` tắt auto-follow, `enable-follow` bật lại. Catalogue chỉ chứa relative package URLs và digest, không token/runtime URLs.

- [ ] Test mở replay trước pairing với toàn bộ runtime HTTP/WebSocket bị chặn vẫn xem được; mọi action mutation trong replay bị từ chối. Hash sai/path escape/script/unknown fields không được hiển thị như trusted report.
- [ ] Export report/scene/asset/NOTICE/event/chunks, strip credentials/internal endpoints và giới hạn dung lượng. Round-trip so pose/phase/metrics với source artifact; thiếu chunk hiển thị gap và null metric.
- [ ] Thêm “Xem mẫu”, “Chạy thử”, “Thử một thay đổi” trong UI R2a; phase từ source events, camera theo phase optional; manual move hủy follow; preset stress có tên rõ.
- [ ] Cell renderer dùng actual sample/replay; reset buffer khi đổi run/boot/revision, không extrapolate qua gap. Vector contact hiển thị only-with-data; geometry/material không dựng lại trên mỗi tick.
- [ ] Import/export package offline; saved evidence không bị đổi khi project edit; changed inputs tạo run mới, không live mutate. Một mẫu displayed-decimated ghi rõ không đủ raw evidence để qualification.
- [ ] Browser test VI/JA/EN, 390/1024/1440 px, reduced motion/2D fallback, axe zero serious/critical, no-scroll theo R2a. Performance đo tiêu chí spec 3 phút với build production và host metadata; fail không được tính là pass do ảnh đẹp.
- [ ] Commit source exporter/contract rồi pin, commit Lab UX và replay catalogue; không publish replay hoặc đẩy main trong task này.

Kiểm transport-deny trong Playwright:

```ts
const mutations:string[] = [];
await page.route('**/lab/v2/**', async route => {
  if (route.request().method() !== 'GET') mutations.push(route.request().url());
  await route.abort();
});
await page.goto('/?replay=coffee-delivery-demo');
await page.getByRole('button',{name:'Phát bản ghi'}).click();
await expect(page.getByText('Bản ghi mô phỏng',{exact:true})).toBeVisible();
expect(mutations).toEqual([]);
```

URL/query và nhãn trên là mới được tạo trong B07, không phải route hiện có. Catalogue resolve replay ID locally, không lấy arbitrary URL từ query để fetch file private.

```sh
# Cwd lab
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/replay-package.test.ts tests/unit/story-camera.test.ts
perl -e 'alarm 600; exec @ARGV' pnpm test:mujoco-e2e -- mujoco-cell.spec.ts
perl -e 'alarm 600; exec @ARGV' pnpm exec playwright test tests/e2e/replay-offline.spec.ts tests/e2e/payload-story.spec.ts
```

## Task B08 — A/B có phạm vi và semantic study đa engine

**Files:**

- Create `source/packages/contracts/schemas/semantic-study-v1.schema.json`.
- Create `source/packages/lab-runtime/src/v2/simulation3d/{physics-comparison,semantic-study}.ts`, `source/scripts/compare-simulations.mjs`.
- Modify `lab/src/reports/compare.ts` để hiển thị tab study riêng; giữ `source/.../comparison.ts` compatibility logic.
- Test `source/tests/unit/semantic-study.test.ts`, `physics-comparison.test.ts`, `source/tests/integration/cross-engine-fd01.test.ts`, `lab/tests/unit/semantic-study-view.test.ts`.

**Interfaces:** `buildSemanticStudy(inputs:SemanticStudyInput):SemanticStudyV1`; `SemanticStudyInput` có `equivalence` (model/world/task/commonProjection refs), `runs` (report+artifact refs), `invariantPolicy`. `comparePhysicsRuns(a,b)` trả availability/reasons/window/population/deltas theo spec. CLI: `node scripts/compare-simulations.mjs --study STUDY_INPUT_JSON --out NEW_REPORT_JSON`.

- [ ] Negative tests khác world/frame/goal bindings/input digest bị `INPUTS_NOT_EQUIVALENT`; `compareRuns` cũ cross-backend vẫn `delta:null`; IR-SIM contact `unsupported`, không 0.
- [ ] Compile common empty-load Serve geometric projection cho IR-SIM/Webots/MuJoCo, noise off, confirmations deterministic; mỗi engine report mang đúng scene/model identities. Không tái dùng report legacy khác fixture.
- [ ] So invariant causal relations source (arrival→confirmation→served, cancel/unknown), goal/corridor và differences. Không assert byte/event total order hoặc trace equal giữa engines.
- [ ] A/B physics chỉ cùng engine/control/model, thay một load/speed/friction profile explicit; performance không xếp hạng từ một run/side. Population <3 không p50/p95 “thống kê”.
- [ ] UI ghi đúng mục nào comparable/unsupported và giải thích khác biệt; link về replay tick/run. Không headline “engine chính xác hơn” khi chưa có measured ground truth.
- [ ] Chạy X01 thật khi các engines có sẵn; thiếu Webots GUI ghi not_run/blocker, không âm thầm đổi thành double; commit `feat: compare physics experiments within explicit evidence scopes`; re-pin.

```ts
const study = buildSemanticStudy(mismatchedWorldInput);
expect(study.status).toBe('incomparable');
expect(study.reasonCodes).toContain('INPUTS_NOT_EQUIVALENT');
expect(Object.hasOwn(study,'winner')).toBe(false);
```

`mismatchedWorldInput` là fixture JSON mới ở `source/tests/fixtures/simulation-study/mismatched-world.json`; task tạo đủ hai report refs với common-projection hash khác, không dùng undocumented helper.

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study.test.ts tests/unit/physics-comparison.test.ts
perl -e 'alarm 1200; exec @ARGV' pnpm exec vitest run tests/integration/cross-engine-fd01.test.ts
```

## Task B09 — Gói web runtime, persistence và một writer

**Files:**

- Modify `source/deploy/lab-runtime/{Dockerfile,build.sh,README.md}`; thêm variable `LAB_DATA_DIR` default `/tmp/runs`, Linux persistent profile đặt `/data/runs`.
- Create `source/deploy/lab-runtime/single-host/compose.yaml`, `proxy.conf`, `README.md`, `source/docs/operations/lab-runtime-single-host.md`.
- Modify gateway/session/run ownership ở `source/packages/lab-runtime/src/v2/` trong đúng seam R2a, không mở hardware providers trong image.
- Test `source/tests/integration/lab-runtime-persistent.test.ts`, `source/tests/security/lab-run-writer.test.ts`; mở rộng test container hiện có cho new sets.

**Interfaces:** config operator-owned, exact Host/Origin, TLS proxy, one runtime instance và named volume. Writer identity `{runId,sessionId,controlEpoch}`; mutation khác writer bị `RUN_WRITER_CONFLICT`; read/report/SSE được dùng theo quyền session hiện có. Chuyển writer chỉ qua operation explicit có epoch tăng; không takeover tự động khi disconnect.

- [ ] Test hai token race cùng run chỉ một writer; read stream không block stop/action; pin mismatch chặn create. Bearer không lưu URL/query/localStorage, cookie path/CSRF cũ còn kiểm.
- [ ] Build image clean gồm mobility/cell assets/closures; manifest capabilities đúng, không quảng cáo Webots/ROS/hardware. `LAB_DATA_DIR` validate directory writable và persist; `/tmp` vẫn cho ephemeral demo R2a.
- [ ] Test kill container giữa run: chunks committed đọc được khi mở lại, run active không tự tiếp tục, unknown/interrupted đúng; saved finished run replay được. Không hứa restore `mjData` từ workflow checkpoint.
- [ ] Proxy config tắt buffering SSE, timeout khai rõ, forward Host theo allowlist; health/readiness, key rotation/re-pair, drain/stop và export runbook. Không mount Docker socket/host devices vào runtime container.
- [ ] Chạy local container E2E trên architecture máy; WEB05 tested chỉ ở arch đã chạy. WEB06 public HTTPS và Cloud Run smoke chờ đích deploy/người dùng giao; ghi reviewable deployment files hoàn chỉnh trước hành động external.
- [ ] Commit `build: package a persistent single-host simulation runtime`; re-pin nếu closure/runtime đổi. Không sửa record G-CLOUD1 cũ.

```ts
const results = await Promise.all([writerA.step(runId),writerB.step(runId)]);
expect(results.filter(r=>r.ok)).toHaveLength(1);
expect(results.filter(r=>r.code==='RUN_WRITER_CONFLICT')).toHaveLength(1);
expect(await engineStepCount(runId)).toBe(1);
```

`writerA/writerB` là hai client HTTP thật trong `lab-run-writer.test.ts` ghép nối session khác nhau; `engineStepCount` đọc instrumentation protocol-double chỉ trong test security. WEB05 engine integration kiểm riêng actual worker, không dùng số đếm double làm bằng chứng physics.

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/security/lab-run-writer.test.ts
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/lab-runtime-persistent.test.ts tests/integration/lab-runtime-container.test.ts
```

## Task B10 — Qualification R2b và regression đúng tuple

**Files:** Modify `source/scripts/{sim-extension-qualification,record-sim-extension,test-runner}.mjs`; test `source/tests/unit/sim-extension-qualification.test.ts`; create evidence **chỉ sau recording thật** trong `source/docs/implementation/evidence/sim-extension/r2b-candidate-01/` và Lab regression mới.

**Interfaces:** `--release r2b` chọn table mới theo contracts §9; thêm tùy chọn `--r2a-record DIR`, `--physics-campaign DIR`, `--semantic-study FILE`. Đây là CLI cần implement; hiện chưa có. Candidate incremental có `scope:'mobility'` và gate list riêng, không giả release full.

- [ ] Test table/case coverage, wrong source/Lab tuple, missing/corrupt artifacts, wrong engine/profile, double masquerading as native, accepted true, missing seed/repeat, and suite skip. G-HOST1 external không làm recorder bỏ các case local.
- [ ] Implement guard đọc actual artifacts; giữ bảng R1/R1.1/R2a hợp lệ và semantics G-CLOUD1 cũ. Dùng cùng lõi qualification, không một guard lỏng hơn chỉ cho R2b.
- [ ] Commit source runtime/tooling cuối và re-pin Lab; chạy CI order source (`contracts:check`, `typecheck`, `lint`, `build`, `test`) và Lab required checks đúng repo. Services thiếu ghi not_run, không tuyên bố full release.
- [ ] Record vào thư mục mới ngoài hai tree để không làm chúng dirty giữa campaign: R-MOCK, IR-SIM, R1, R1.1, R2a tại tuple mới, rồi physics/cell/study/web và R2b. Mac Webots cần GUI thức và `caffeinate -dims`; long commands có timeout hợp lý.
- [ ] Candidate giữ minimal raw successful/failed run, contact/cup/arm/AMR traces, reports, screenshots, timing/host metadata, case mapping, licenses và limitations. Không chỉ suite JSON như hạn chế R1.1.
- [ ] Chạy acceptance guard trên output mới, rồi mới copy vào cây và commit evidence. Superseded candidate chỉ xử lý theo quy ước history, không edit nội dung/sidecar cũ. Báo reviewer danh sách local tested và external còn mở; không tự accepted/push.

```sh
# Cwd source; sau khi table r2b và các env input đã có, output dir do mktemp cấp mới.
candidate_out=$(mktemp -d /tmp/mekoniq-r2b-candidate.XXXXXX)
perl -e 'alarm 10800; exec @ARGV' node scripts/record-sim-extension.mjs \
  --release r2b --candidate-id r2b-candidate-01 --out "$candidate_out" \
  --r2a-record "$R2A_RECORD_DIR" --physics-campaign "$PHYSICS_CAMPAIGN_DIR" \
  --semantic-study "$SEMANTIC_STUDY_FILE"
LAB_SIMEXT_EVIDENCE_DIR="$candidate_out" perl -e 'alarm 300; exec @ARGV' pnpm test:acceptance -- sim-extension
```

Các biến `R2A_RECORD_DIR`, `PHYSICS_CAMPAIGN_DIR`, `SEMANTIC_STUDY_FILE` là đường dẫn tuyệt đối output vừa record cùng tuple; recorder phải kiểm tồn tại/hash/source, không lấy default candidate lịch sử. Lệnh chưa chạy trong lúc viết plan.
