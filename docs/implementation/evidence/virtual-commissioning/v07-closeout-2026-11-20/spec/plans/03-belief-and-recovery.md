# R4.4 Belief World, Perception Error and Bounded Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tay máy gắp theo vị trí cốc mà nó tin, với sai số nhận thức bật/tắt được; Lab đo tỷ lệ gắp theo mức sai số trên một quần thể run và phục hồi có giới hạn khi gắp hụt.

**Architecture:** Bộ ước lượng mô phỏng và belief world chạy ở runtime TS trên observation đã commit; worker không đổi ngoài hai nhiễu loạn đăng ký, một cho rig và một cho cell. Mã chọn điểm gắp chỉ nhận `BeliefView`; mỗi lượt gắp tạo một chương trình dẫn xuất đã qua bốn cửa kiểm. Phục hồi là bảng quy tắc khai báo, chỉ áp dụng cho thất bại đã biết.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R4-B](../03-r4-perception-recovery-spec.md), [contracts §6–7, §9](../05-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: không render camera, không thêm thư viện IK hay behavior tree; run ở chế độ `fixed_program` không có chính sách phục hồi phải giữ byte R2b; ngưỡng xác nhận kẹp/nhấc/đỡ của oracle hiện có không đổi; gói này không phụ thuộc drive ảo.

## Review Focus

1. **Cốc bị xê dịch sau khi ước lượng được công bố:** trước cam kết thì cửa tuổi chặn và hệ thống chờ; sau cam kết thì lượt gắp hụt được phát hiện và phục hồi quan sát lại (test ở V12, V13).
2. **Vị trí tin nằm ngoài vùng đăng ký hoặc ngoài tầm với:** từ chối có mã trước lệnh chuyển động đầu tiên, tay không rời tư thế hiện tại (test ở V11).
3. **Cốc rơi xuống sàn, hoặc còn giữa hai má nhưng đang trượt:** không phục hồi, không mở kẹp, `needs_attention` (test ở V13).
4. **Bộ ước lượng mất mẫu kéo dài:** chờ tới `beliefWaitTicks` rồi gọi người; run không treo và không gắp bằng ước lượng cũ (test ở V11, V13).
5. **Mở replay ở giữa run, hoặc mở report R2b cũ:** lớp belief vẽ đúng dữ liệu tại con trỏ; không có stream thì hiện "không có dữ liệu nhận thức", không vẽ ghost trùng cốc thật (test ở V12).

---

## Task V11 — Hợp đồng belief, bộ ước lượng mô phỏng và gắp theo niềm tin

**Files:**

- Create `source/packages/contracts/schemas/{perception-profile-v1,belief-evidence-v1}.schema.json`; Modify `{arm-cell-scene-v1,lab-world-scene-v1,lab-run-v2}.schema.json` (`graspMode`, `perceptionProfileRef`, `recoveryPolicyRef`), `source/scripts/generate-contracts.mjs`.
- Create `source/scripts/generate-perception-fixture.mjs`, `source/robotics/simulation-mujoco/fixtures/perception-v1/` (`perception-ground-truth-v1.json`, `perception-nominal-v1.json`, các profile của study, `README.md`, `manifest.json`).
- Create `source/packages/lab-runtime/src/v2/perception/{pose-estimator-sim,belief,grasp-conditioning,belief-evidence}.ts`.
- Modify `source/packages/lab-runtime/src/v2/simulation3d/{mujoco-arm-ports,mujoco-world-ports,arm-cell-scene}.ts`, `source/packages/cell-adapters/src/mock-arm.ts` (cho phép plant thay ba waypoint gắp của chương trình đang chạy trước lệnh chuyển động đầu tiên của lượt).
- Test `source/tests/contracts/belief-contracts.test.ts`, `source/tests/unit/{pose-estimator-sim,belief,grasp-conditioning}.test.ts`, `source/tests/integration/mujoco-belief-pick.test.ts`.

**Interfaces:** consumes `actorStream`, `gaussianPair` (đã có sau V08; nếu gói 03 chạy trước gói 02 thì task này thêm `gaussianPair` vào `v2/random.ts` theo đúng chữ ký ở [plan 02 V08](02-workbench-faults-tray.md#task-v08--danh-mục-lỗi-chèn-có-biên-nhận-oracle-và-báo-cáo-lỗi)), `solvePose`, kiểm sweep ARM03; produces

```ts
// perception/pose-estimator-sim.ts
export interface TruthSample {tick: number; positionM: [number, number, number]; inRegion: boolean}
export function createPoseEstimator(profile: PerceptionProfileV1, seed: number, objectId: string): {
  update(tick: number, truthAt: (tick: number) => TruthSample | null): BeliefRecord | null};   // null khi tick không phải tick cập nhật
// perception/belief.ts
export interface BeliefView {get(objectId: string, tick: number):
  {status: 'ok'; belief: BeliefObject} | {status: 'unavailable' | 'stale'; reason: 'BELIEF_UNAVAILABLE' | 'BELIEF_STALE'}}
export function createBeliefWorld(maxAgeTicks: number): {apply(record: BeliefRecord): void; view(): BeliefView};
// perception/grasp-conditioning.ts
export type GraspRefusal = 'BELIEF_UNAVAILABLE' | 'BELIEF_STALE' | 'BELIEF_OUT_OF_REGION' | 'GRASP_UNREACHABLE' | 'ARM_COLLISION' | 'ARM_SWEEP_UNCERTAIN';
export function planBeliefGrasp(input: {view: BeliefView; cupId: string; tick: number; attemptIndex: number;
  region: {centerM: [number, number]; halfExtentM: [number, number]};
  graspOffsets: Record<'pickApproach' | 'pick' | 'lift', {positionM: [number, number, number]; quaternionXyzw: [number, number, number, number]}>;
  seeds: Record<'pickApproach' | 'pick' | 'lift', number[]>;
  solve: (pose: {positionM: number[]; quaternionXyzw: number[]}, seed: number[]) => {ok: true; q: number[]; residual: {positionM: number; orientationRad: number; condition: number}} | {ok: false; reason: string};
  sweep: (waypoints: number[][]) => {ok: true} | {ok: false; code: 'ARM_COLLISION' | 'ARM_SWEEP_UNCERTAIN'}}):
  {ok: true; waypoints: Record<'pickApproach' | 'pick' | 'lift', number[]>; attempt: GraspAttempt} | {ok: false; code: GraspRefusal; attempt: GraspAttempt};
// perception/belief-evidence.ts: recorder và reader cho stream `belief` và `attempts`, cùng nguyên tắc chunk/hash/quota của physics-evidence
export function openBeliefRecorder(options: {directory: string; identity: object; maxBytes: number}): Promise<{appendBelief(r: BeliefRecord): Promise<void>; appendAttempt(a: GraspAttempt): Promise<void>; appendRecovery(s: RecoveryStep): Promise<void>; finish(reason: string): Promise<void>}>;
export function readBeliefEvidence(root: string, manifest: unknown): Promise<{complete: boolean; beliefs: BeliefRecord[]; attempts: GraspAttempt[]; recovery: RecoveryStep[]; issues: string[]}>;
```

`solve` và `sweep` là tham số để `planBeliefGrasp` thuần và kiểm được; ports truyền `solvePose` với ngưỡng oracle hiện có và kiểm sweep ARM03 với hình học/cặp tiếp xúc hiện có.

- [ ] Viết negative schema test: `sigmaM` hoặc `biasM` vượt 0,03 m; `dropoutProbability` 0,95; `updateEveryTicks` 0; `maxAgeTicks` 0; vùng nhìn không có trong scene; `fixed_program` kèm `perceptionProfileRef`; trường lạ. Positive: hai profile từ fixture.
- [ ] Viết test bộ ước lượng, chạy fail trước: bias (0,007; 0), σ = 0, trễ 5, chu kỳ 10 → tại tick 20, `positionM` bằng truth của tick 15 cộng (0,007; 0; 0), `observedTick` 15, `publishedTick` 20; tick 21 trả `null`; vật ngoài vùng nhìn cho bản ghi `belief:null`, `dropped:false`, lý do `OUT_OF_VIEW`; hai bộ ước lượng cùng seed khác `dropoutProbability` cho cùng nhiễu ở các tick cả hai cùng công bố; cùng seed và profile cho cùng dãy; profile ground truth cho `errorM` bằng 0 ở mọi tick.
- [ ] Viết test belief world và cách ly truth, chạy fail trước: quá `maxAgeTicks` trả `stale`; chưa có bản ghi trả `unavailable`; quét sâu mọi giá trị `BeliefView.get` trả về không có khóa nào khớp `/truth|actual|error/i`; kiểu trả về không có thuộc tính `truthAtObservedTick` (`expectTypeOf`).
- [ ] Viết test `planBeliefGrasp`, chạy fail trước: bốn cửa theo đúng thứ tự (belief → vùng → IK → sweep), cửa trượt đầu tiên quyết định mã và các cửa sau ghi `not_evaluated`; mọi kết quả, kể cả từ chối, trả một `GraspAttempt` đầy đủ; `sweep` không được gọi khi IK trượt.
- [ ] Viết bốn module cho tới khi test đạt; sinh fixture hai lần và so byte.
- [ ] Nối ports của cell: `graspMode` trong run request chọn chế độ, chỉ hợp lệ với `MJ-CELL-BV01`; `MJ-BV01` giữ `fixed_program`. Ở hai chế độ belief, khi job gắp của Source bắt đầu và trước mỗi lượt thử, plant gọi `planBeliefGrasp`, ghi `GraspAttempt` vào stream **trước**, rồi thay ba waypoint gắp của chương trình đang chạy; bị từ chối thì chương trình thất bại với mã đó trước lệnh chuyển động. Source vẫn stage và start một job như R2b; `packages/domain` và journal không đổi. Bộ ước lượng chạy mỗi tick trên observation đã commit. Chế độ `fixed_program` không dựng bộ ước lượng, không ghi stream.
- [ ] Test integration với engine thật: `MJ-BV01` seed 42 và `MJ-CELL-BV01` seed 7 ở `fixed_program` cho report trùng hash với baseline R2b; `MJ-CELL-BV01` seed 7 ở `belief_ground_truth` phục vụ 2 và mỗi cốc có một `GraspAttempt` `lifted`; với `dropoutProbability` 0,9 và seed cho chuỗi mất mẫu dài, run chuyển `needs_attention` với `BELIEF_UNAVAILABLE` sau `beliefWaitTicks`, không có lệnh chuyển động tới tư thế gắp; với profile thử nghiệm có bias đưa vị trí tin ra ngoài vùng đăng ký, lượt gắp bị từ chối `BELIEF_OUT_OF_REGION` và mọi mục tiêu khớp đã gửi bằng tư thế trước đó; `graspMode` khác `fixed_program` trên `MJ-BV01` bị từ chối 422.
- [ ] `pnpm contracts:generate && pnpm contracts:check`; focused tests; commit `feat: grasp from a belief world fed by a simulated pose estimator`; re-pin Lab.

```ts
import {expect, test} from 'vitest';
import {createPoseEstimator} from '../../packages/lab-runtime/src/v2/perception/pose-estimator-sim';
const profile = {schemaVersion: 1, id: 't', revision: 1, digest: '0'.repeat(64), updateEveryTicks: 10, latencyTicks: 5, biasM: [0.007, 0], sigmaM: [0, 0],
  dropoutProbability: 0, visibleRegionId: 'nozzle-stand', maxAgeTicks: 50} as never;
const truthAt = (tick: number) => ({tick, positionM: [0.49 + tick * 1e-4, 0, 0.151] as [number, number, number], inRegion: true});

test('an estimate is the delayed truth plus the declared bias', () => {
  const estimator = createPoseEstimator(profile, 42, 'cup-1');
  for (let t = 0; t < 20; t++) estimator.update(t, truthAt);
  const r = estimator.update(20, truthAt)!;
  expect(r.belief!.observedTick).toBe(15);
  expect(r.belief!.publishedTick).toBe(20);
  expect(r.belief!.positionM[0]).toBeCloseTo(0.49 + 15e-4 + 0.007, 12);
  expect(r.errorM).toBeCloseTo(0.007, 12);
  expect(estimator.update(21, truthAt)).toBeNull();
});
```

```sh
perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/contracts/belief-contracts.test.ts tests/unit/pose-estimator-sim.test.ts tests/unit/belief.test.ts tests/unit/grasp-conditioning.test.ts
perl -e 'alarm 3600; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-belief-pick.test.ts tests/integration/mujoco-arm-bv01.test.ts tests/integration/mujoco-cell-bv01.test.ts
```

## Task V12 — Rig gắp, study sai số nhận thức và lớp belief trên Lab

**Files:**

- Create `source/scripts/generate-pick-rig-fixture.mjs`, `source/robotics/simulation-mujoco/fixtures/pick-rig-v1/` (dẫn xuất từ `xarm6-g2-v1` giữ nguyên byte model/physics/programs; `rig-policy.json` cho lệch sinh cốc tối đa 0,03 m và vùng làm việc; `NOTICE`, `README.md`, `manifest.json`), `source/robotics/simulation-mujoco/campaigns/perception-gap-v1.json`.
- Create `source/packages/lab-runtime/src/v2/perception/{pick-rig,perception-study}.ts`.
- Modify `source/robotics/simulation-mujoco/mujoco_worker/{engine,session}.py` (nhiễu loạn đăng ký `rig-cup-nudge-v1` cho scene rig), `source/scripts/lab-mujoco.mjs`.
- Lab, sau khi pin: Create `lab/src/twin/belief.ts`, `lab/src/reports/perception.ts`; Modify `lab/src/viewer/twin3d.ts`, `lab/src/twin/scene.ts`, `lab/src/ui/{workspace,report-panel}.ts`, `lab/src/reports/replay-package.ts`.
- Test `source/tests/unit/{perception-study,pick-rig-fixture}.test.ts`, `source/tests/integration/mujoco-pick-rig.test.ts`, `source/robotics/simulation-mujoco/tests/test_rig_nudge.py`, `lab/tests/unit/{belief-view,perception-report}.test.ts`, `lab/tests/e2e/mujoco-belief.spec.ts`.

**Interfaces:** produces

```ts
// perception/perception-study.ts
export const PERCEPTION_STUDY_POINTS: readonly {id: string; mode: 'fixed_program' | 'belief_ground_truth' | 'belief_estimated';
  truthOffsetM: 0 | 0.02; profileId: string | null; nudge: boolean; seeds: readonly number[]}[];   // đúng bảng R4-B §8.2, tổng 92 lượt; độ lớn lệch theo điểm, hướng lệch rút từ stream `rig:<seed>`
export function wilsonInterval(successes: number, n: number, z?: number): {low: number; high: number};
export function runPerceptionStudy(options: {root: string; out: string; sourceCommit: string; pointId?: string; signal: AbortSignal}): Promise<PerceptionStudyVerdict>;
export function verifyPerceptionStudy(root: string): Promise<PerceptionStudyVerdict>;
export interface PerceptionStudyVerdict {expectedRuns: number; completedRuns: number; missingArtifacts: string[]; issues: string[]; study: PerceptionStudyV1 | null}
// perception/pick-rig.ts
export interface PickRigResult {runId: string; outcome: GraspAttempt['outcome']; attempts: number; recovered: boolean; attention: boolean; ticks: number; unexpectedContacts: number; directory: string}
export function runPickRig(input: {seed: number; mode: string; truthOffsetM: number; profileId: string | null; nudge: boolean; recoveryPolicyId: string | null; directory: string}, runtime: MujocoRuntimeOptions): Promise<PickRigResult>;
// lab/src/twin/belief.ts
export function beliefAt(records: readonly BeliefRecord[], tick: number): {available: false; reason: string} | {available: true; belief: BeliefObject; truthM: [number, number, number]; errorM: number};
```

- [ ] Viết test, chạy fail trước: `wilsonInterval(8, 10)` cho cận dưới gần 0,4902 và cận trên gần 0,9433; `wilsonInterval(0, 10)` cho 0 và gần 0,2775; `n = 0` ném `POPULATION_EMPTY`; `PERCEPTION_STUDY_POINTS` cộng đúng 92 lượt, điểm tất định chỉ có một seed, và cùng seed cho cùng hướng lệch; fixture rig sinh hai lần trùng byte và phần chung với `xarm6-g2-v1` trùng hash; `beliefAt` trả `{available:false, reason:'NO_BELIEF_DATA'}` khi stream rỗng và lấy bản ghi mới nhất không muộn hơn con trỏ khi có.
- [ ] Worker: `rig-cup-nudge-v1` là lực mô phỏng đăng ký lên cốc trong một số substep cố định, chỉ hợp lệ cho scene rig, có biên nhận trước/sau như nhiễu loạn world hiện có; không ghi `qpos`/`qvel`. Test Python: cốc dịch trên mặt đỡ trong khoảng đăng ký và không rời mặt đỡ; preset trên scene khác bị từ chối.
- [ ] Viết `runPickRig`: một lượt sinh cốc với lệch thật rút từ stream `rig:<seed>`, chạy đúng một lượt gắp–nhấc–đặt qua ports của V11, trả kết quả và đường dẫn artifact. Rig là scenario chỉ dành cho campaign.
- [ ] Viết study và verifier: mỗi lượt có artifact riêng; verifier từ chối thiếu lượt, sai seed/điểm, hoặc tỷ lệ tính sai so với artifact. `PerceptionStudyV1` ghi cho từng điểm số lượt, thành công lần đầu, thành công sau phục hồi, cần người xử lý, khoảng Wilson, trung vị thời gian, va chạm ngoài dự kiến, sai số belief tại cam kết. Không có trường xếp hạng.
- [ ] Test integration với engine thật: một lượt rig `belief_ground_truth` lệch 20 mm cho `lifted`; một lượt có `rig-cup-nudge-v1` trước cam kết với `maxAgeTicks` nhỏ cho `BELIEF_STALE` rồi gắp bằng ước lượng mới.
- [ ] Lab: lớp belief ở viewport 3D và 2D (vị trí tin nét đứt, vị trí thật đặc, đoạn nối kèm sai lệch), khung chọn chế độ trước khi tạo run, bảng lượt gắp, màn hình study trong Report dùng `linePlot` của V07 nếu đã có, nếu chưa thì bảng số. Replay đọc stream từ package; không tính lại ước lượng.
- [ ] Spec e2e: chạy preset cell ở `belief_estimated` danh định → ghost hiện, bảng lượt gắp có dòng → mở replay tại giữa run, ghost khớp bản ghi tại con trỏ → mở report R2b cũ, thấy "không có dữ liệu nhận thức"; ba ngôn ngữ; 390 px.
- [ ] Chạy study vào thư mục tạm ngoài hai repo, verify exit 0; commit source `feat: add the pick rig and the perception gap study`, re-pin, commit Lab `feat: draw belief against truth and show the perception study`.

```ts
import {expect, test} from 'vitest';
import {PERCEPTION_STUDY_POINTS, wilsonInterval} from '../../packages/lab-runtime/src/v2/perception/perception-study';
test('the Wilson interval matches the reference values', () => {
  expect(wilsonInterval(8, 10).low).toBeCloseTo(0.4902, 3);
  expect(wilsonInterval(8, 10).high).toBeCloseTo(0.9433, 3);
  expect(wilsonInterval(0, 10)).toEqual({low: 0, high: expect.closeTo(0.2775, 3)});
  expect(() => wilsonInterval(0, 0)).toThrow('POPULATION_EMPTY');
});
test('the registered study has 92 rig runs', () => {
  expect(PERCEPTION_STUDY_POINTS.reduce((n, p) => n + p.seeds.length, 0)).toBe(92);
});
```

```sh
perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/unit/perception-study.test.ts tests/unit/pick-rig-fixture.test.ts
perl -e 'alarm 7200; exec @ARGV' node scripts/lab-mujoco.mjs run --campaign perception-gap-v1 --out /tmp/mekoniq-perception-gap-v1 && node scripts/lab-mujoco.mjs verify --input /tmp/mekoniq-perception-gap-v1
```

## Task V13 — Phục hồi có giới hạn

**Files:**

- Create `source/packages/contracts/schemas/recovery-policy-v1.schema.json`, `source/robotics/simulation-mujoco/fixtures/recovery-v1/{pick-recovery-v1.json,README.md,manifest.json}`, `source/packages/lab-runtime/src/v2/perception/recovery-policy.ts`, `source/robotics/simulation-mujoco/campaigns/recovery-v1.json`.
- Modify `source/scripts/generate-contracts.mjs`, `source/packages/cell-adapters/src/mock-arm.ts` (điểm hỏi chính sách tại lúc xác nhận kẹp cho biết không có cốc giữa hai má, nơi hôm nay chương trình chạy tiếp với `objectPresent:false`; không có chính sách thì đi đúng nhánh cũ; nhánh `CUP_DROPPED` không đổi), `source/packages/lab-runtime/src/v2/simulation3d/{mujoco-arm-ports,mujoco-world-ports}.ts` (cung cấp fact, thực hiện bước, ghi `RecoveryStep`), `v2/simulation3d/cell-campaign.ts` (tùy chọn chế độ belief), `source/scripts/lab-mujoco.mjs`.
- Modify, cho `world-cup-nudge-v1` (REC06): `source/packages/lab-runtime/src/v2/simulation3d/{world-disturbance,world-ports}.ts`, `source/packages/lab-runtime/src/v2/gateway.ts` (danh sách `worldExperiments`), `source/robotics/simulation-mujoco/mujoco_worker/{world_engine,session}.py`, `source/packages/contracts/schemas/{world-evidence-v1,lab-world-scene-v1,sim3d-worker-v1,lab-run-v2}.schema.json`.
- Lab, sau khi pin: Modify `lab/src/reports/perception.ts`, `lab/src/ui/report-panel.ts`, thanh phase của workspace (lượt *k/n*), `lab/src/twin/cell.ts` và `lab/src/ui/workspace.ts` (thí nghiệm mới trong preset cell), `lab/public/replays/catalog.json`. Create `lab/public/replays/belief-recovery/` (bản ghi mẫu, WEB10).
- Test `source/tests/contracts/recovery-policy.test.ts`, `source/tests/unit/recovery-policy.test.ts`, `source/tests/integration/{mujoco-recovery-rig,mujoco-cell-belief}.test.ts`, `source/robotics/simulation-mujoco/tests/test_world_nudge.py`, `source/tests/integration/lab-runtime-container-r4.test.ts`, `lab/tests/unit/recovery-view.test.ts`, `lab/tests/e2e/replay-offline.spec.ts`.

**Interfaces:** consumes `GraspAttempt`, `RecoveryStep`, `planBeliefGrasp`, `runPickRig`; produces

```ts
// perception/recovery-policy.ts
export type RecoveryTrigger = 'GRIP_NOT_ESTABLISHED' | 'BELIEF_UNAVAILABLE' | 'BELIEF_STALE';
export type RecoveryFact = 'arm_state_fresh' | 'no_unknown_command' | 'cup_on_declared_support' | 'cup_not_between_pads';
export type RecoveryAction = 'open_gripper' | 'retreat_pick_approach' | 'await_fresh_belief' | 'retry_pick';
export function validateRecoveryPolicy(value: unknown): {ok: boolean; reasonCodes: string[]};
export function decideRecovery(policy: RecoveryPolicyV1, failure: {code: string}, facts: ReadonlySet<RecoveryFact>, attemptsSoFar: number):
  | {action: 'recover'; rule: string; steps: RecoveryAction[]}
  | {action: 'attention'; reason: 'RECOVERY_NOT_APPLICABLE' | 'RECOVERY_FACTS_MISSING' | 'RECOVERY_EXHAUSTED'};
```

`pick-recovery-v1` đúng bảng [R4-B §7.2](../03-r4-perception-recovery-spec.md#72-chính-sách): hai quy tắc, mỗi quy tắc `maxAttempts: 2`, `beliefWaitTicks: 250`, nguồn `assumed`. Quy tắc `grip-not-established` (trigger `GRIP_NOT_ESTABLISHED`) đòi cả bốn fact; quy tắc `belief-not-usable` (trigger `BELIEF_UNAVAILABLE` và `BELIEF_STALE`) đòi `arm_state_fresh` và `no_unknown_command`. Phục hồi nằm trong plant tay máy, dưới `CellAdapter`: một job gắp của Source chạy suốt các lượt, `commandId` của bước phục hồi là id nội bộ của plant.

- [ ] Viết test thuần, chạy fail trước: đủ fact và `attemptsSoFar` 0 → `recover` với đúng dãy bước của quy tắc; thiếu `cup_not_between_pads` → `RECOVERY_FACTS_MISSING`; `attemptsSoFar` 2 → `RECOVERY_EXHAUSTED`; mã `CUP_DROPPED`, `ARM_COLLISION` hoặc bất kỳ mã ngoài danh mục → `RECOVERY_NOT_APPLICABLE`; chính sách có bước hoặc fact ngoài danh mục, 9 quy tắc, hoặc `maxAttempts` 4 bị `validateRecoveryPolicy` từ chối; quy tắc có `open_gripper` mà không đòi `cup_not_between_pads` bị từ chối (`RECOVERY_OPEN_REQUIRES_NOT_HELD`).
- [ ] Viết module cho tới khi test đạt.
- [ ] Nối: khi lượt gắp thất bại ở run có `recoveryPolicyRef`, ports tính fact **từ observation đã commit của tick hiện tại** (khớp mới và hợp lệ; không có lệnh unknown; cốc được engine báo đứng trên mặt đỡ đã khai trong cửa sổ quan sát; không có má nào chạm cốc), gọi `decideRecovery`, rồi với mỗi bước: tạo `commandId` nội bộ của plant, ghi `RecoveryStep` trước, thực hiện, ghi kết quả. `retry_pick` gọi lại `planBeliefGrasp` với `attemptIndex` tăng. Kết quả `attention` đi đúng đường chốt và `needs_attention` hiện có. Run không có `recoveryPolicyRef` không chạm đoạn mã mới.
- [ ] Viết campaign `recovery-v1` trên rig và test integration với engine thật, mỗi ca một assertion chính:
  - REC01: `rig-cup-nudge-v1` sau cam kết → lượt 1 `grip_not_established`, có `RecoveryStep` ghi trước từng bước, lượt 2 `lifted`.
  - REC02: bias cố định lớn hơn dung sai gắp quan sát được ở study → hai lượt thất bại, rồi `RECOVERY_EXHAUSTED`, `needs_attention`.
  - REC03: nudge trước cam kết với ước lượng quá tuổi → `BELIEF_STALE`, chờ, gắp bằng ước lượng mới.
  - REC04: ba biến thể không được phục hồi: cốc bị đẩy rơi khỏi giá (không còn trên mặt đỡ đã khai); mất worker giữa lượt gắp; cốc còn giữa hai má. Mỗi biến thể: không có `RecoveryStep`, không có lệnh mở kẹp sau thất bại, `needs_attention`, served 0.
- [ ] Cell: `MJ-CELL-BV01` ở `belief_estimated` với `perception-nominal-v1` và `pick-recovery-v1`, ba seed phục vụ 2; năm fault R2b cho đúng kết quả phát hiện/custody/served như baseline (REC05).
- [ ] REC06, phục hồi nhìn thấy được trong cell: thêm `world-cup-nudge-v1` vào registry world experiment theo đúng mẫu `world-cup-fall-v1` (preset ở runtime và ở worker, enum trong bốn schema, danh sách trong health, điều kiện trigger trong `mujoco-world-ports.ts`). Trigger mới `after_belief_commit`: một lần, ở tick đầu tiên sau khi lượt gắp chỉ số 0 của `cup-1` đã ghi bản ghi cam kết và trước khi kẹp đóng. Lực và số substep lấy đúng của `rig-cup-nudge-v1`. Admission từ chối thí nghiệm này khi chế độ gắp là `fixed_program` (`WORLD_EXPERIMENT_SCOPE_INVALID`). Test Python: cốc dịch quá dung sai gắp đã quan sát ở study và vẫn `restingOn` mặt đỡ đã khai; không đường nào ghi `qpos`/`qvel`. Test integration, ba seed: có ý định và biên nhận, lượt 1 `grip_not_established`, có `RecoveryStep`, lượt 2 `lifted`, phục vụ 2. Không có lực nào thỏa cả hai điều kiện trong cell → ghi REC06 blocked kèm số đo; không sửa pose.
- [ ] Lab: bảng lượt gắp thêm các bước phục hồi; thanh phase hiện lượt hiện tại trên tổng cho phép; `world-cup-nudge-v1` có trong danh sách thí nghiệm của preset cell khi chế độ là belief, với nhãn nguyên nhân như hai thí nghiệm hiện có; ba ngôn ngữ.
- [ ] Commit source `feat: recover a failed pick only from known states, within a bound`, re-pin, commit Lab `feat: show grasp attempts and recovery steps`.
- [ ] Bản ghi mẫu thứ hai (WEB10): chạy REC06 seed 42 trên runtime local, xuất replay package bằng nút "Xuất replay" hiện có, thêm `lab/public/replays/belief-recovery/` và mục trong `catalog.json` theo đúng dạng ba mẫu hiện có. Mở rộng `lab/tests/e2e/replay-offline.spec.ts`: không cần runtime, thấy vị trí tin cạnh vị trí thật, bảng lượt gắp có hai lượt và các bước phục hồi. Commit Lab `feat: add the belief recovery sample replay`.
- [ ] CLD01 cho R4.4 (cwd source): thêm ca vào `tests/integration/lab-runtime-container-r4.test.ts`; nếu gói 01 chưa tạo file này thì tạo theo mô tả ở [V05](01-drive-and-cil.md#task-v05--evidence-theo-trục-metric-và-campaign-cil). Trong image `linux/arm64` dựng từ commit hiện tại, cell `belief_estimated` với `pick-recovery-v1` và `world-cup-nudge-v1` phục vụ 2 với đúng một lần phục hồi. Dựng lại image `linux/amd64` (CLD02). Commit `test: run belief recovery inside the runtime image`.

```ts
import {expect, test} from 'vitest';
import {decideRecovery} from '../../packages/lab-runtime/src/v2/perception/recovery-policy';
import policy from '../../robotics/simulation-mujoco/fixtures/recovery-v1/pick-recovery-v1.json';
const all = new Set(['arm_state_fresh', 'no_unknown_command', 'cup_on_declared_support', 'cup_not_between_pads'] as const);

test('a known failed grip is retried with a fresh observation', () => {
  expect(decideRecovery(policy as never, {code: 'GRIP_NOT_ESTABLISHED'}, all, 0)).toEqual(
    {action: 'recover', rule: 'grip-not-established', steps: ['open_gripper', 'retreat_pick_approach', 'await_fresh_belief', 'retry_pick']});
});
test('a cup that may still be held is never released by recovery', () => {
  const held = new Set([...all].filter(f => f !== 'cup_not_between_pads'));
  expect(decideRecovery(policy as never, {code: 'GRIP_NOT_ESTABLISHED'}, held, 0)).toEqual({action: 'attention', reason: 'RECOVERY_FACTS_MISSING'});
});
test('the bound and the scope are enforced', () => {
  expect(decideRecovery(policy as never, {code: 'GRIP_NOT_ESTABLISHED'}, all, 2)).toEqual({action: 'attention', reason: 'RECOVERY_EXHAUSTED'});
  expect(decideRecovery(policy as never, {code: 'CUP_DROPPED'}, all, 0)).toEqual({action: 'attention', reason: 'RECOVERY_NOT_APPLICABLE'});
});
```

```sh
perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/contracts/recovery-policy.test.ts tests/unit/recovery-policy.test.ts
perl -e 'alarm 5400; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-recovery-rig.test.ts tests/integration/mujoco-cell-belief.test.ts tests/integration/mujoco-cell-faults.test.ts
```

**Exit:** R4.4 bàn giao được: G-BEL1 và G-REC1 có artifact từng lượt; REC06 cho thấy một lần phục hồi trong cell; cell belief chạy được trong image cloud (CLD01); bản ghi mẫu phục hồi có trong catalog. Kết quả study được ghi đúng như quan sát; không điều chỉnh mô hình sai số hay ngưỡng oracle để có đường cong đẹp.
