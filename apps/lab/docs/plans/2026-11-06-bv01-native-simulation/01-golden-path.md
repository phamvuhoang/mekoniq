# Golden Path & Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.


> Qualification: [evidence index](../../implementation/evidence/bv01-native-simulation/README.md). Checked boxes record completed portable steps; mixed/native/clean-target/usability steps remain open where actual execution is missing. A skipped Linux assertion is not a native pass.

**Goal:** BV01 dùng chung plant ports, cup ledger đúng và report đủ fidelity; UI tái sử dụng controls hiện có.

**Architecture:** Domain không đổi authority. Tách plant khỏi CoffeeDriver, thêm correlated observations, report extension và bounded configuration.

**Tech Stack:** TypeScript, existing CellAdapter/domain journal, Vitest, Playwright, Lab Vite/Three.

**Spec:** [BVI-02..07](../../specs/2026-11-06-bv01-native-simulation/README.md), [interfaces](../../specs/2026-11-06-bv01-native-simulation/contracts-and-evidence.md).

## Global Constraints

Áp dụng nguyên văn [Global Constraints của plan tổng](README.md#global-constraints). Đây là task chưa thực thi. API mới chỉ được xuất sau schema/type/tests đồng bộ.

## I01 — Transfer contract và physical cup ledger

**Files:** New source `packages/contracts/schemas/lab-transfer-evidence.schema.json`, `packages/lab-runtime/src/v2/beverage/cup-ledger.ts`, `tests/contracts/lab-transfer-evidence.test.ts`, `tests/integration/lab-v2-cup-ledger.test.ts`. Modify source `scripts/generate-contracts.mjs` và generated outputs theo generator; `packages/lab-runtime/src/v2/beverage/plant-session.ts`.

**Interfaces:** Consumes existing CellReport và pending transfer identity. Produces `TransferObservation`, `CorrelatedTransferEvidence`, `CupPhysicalState`, `applyCupObservation(state, observation)` theo spec. Wrapper journal phải nhận cùng observationId+hash; không dùng pure reducer làm dedupe store.

- [x] Viết RED cho unknown không fallback nozzle, one parent, takeCup một lần, crash sau projection trước domain confirm; schema reject NaN/out-of-range/old epoch/wrong slot ở semantic validator. Core reducer example:

```ts
const o: TransferObservation = {
  observationId:'obs-1', runId:'run-1', cupId:'cup-1', transferId:'transfer-1',
  commandId:'command-1', payloadHash:'0'.repeat(64), deviceId:'arm-1', observerId:'arm-observer',
  bootId:'boot-1', controlEpoch:1, seq:'1', producer:'mock_arm', fidelity:'modeled',
  phase:'grasp', parent:'arm:arm-1/tcp', grip:{closed:true, objectPresent:true},
  clockDomain:'mock-1', observedMonotonicNs:'10', receivedMonotonicNs:'10', quality:'valid'
};
const held = applyCupObservation([], o);
expect(applyCupObservation(held, o)).toEqual(held);
expect(applyCupObservation(held, {...o, observationId:'obs-2', seq:'2', phase:'lost', parent:null})[0])
  .toMatchObject({parent:null, status:'lost'});
```

- [x] Run from source: `pnpm exec vitest run tests/contracts/lab-transfer-evidence.test.ts tests/integration/lab-v2-cup-ledger.test.ts`. RED phải do behavior/contract chưa có, không phải môi trường database.
- [x] Implement schema + generated type, ledger transition table, wrapper dedupe/hash conflict/ordering; modify plant-session to update attachment once, invoke takeCup and remove nozzle obstacle. Release thêm tray obstacle; unknown không chọn parent. Add checkpoint persistence and crash-cut tests using same temporary SQLite support as current lab-v2 suites.
- [x] GREEN focused command; `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm typecheck`. Verify old cell observation fixtures unchanged; new evidence namespace không vô tình đổi CellReport shape.
- [x] Commit explicit touched files: `feat: correlate cup observations and persist physical custody`. Evidence I01 records V02/V03 outcomes; native proof còn not_run.

## I02 — Shared workflow, guards và stage/start

**Files:** New source `packages/lab-runtime/src/v2/beverage/coffee-ports.ts`, `tests/support/bv01.ts`, `tests/integration/lab-v2-bv01-ports.test.ts`, `tests/integration/lab-v2-arm-stage-start.test.ts`. Modify source `v2/scenarios/coffee.ts`, `v2/scenario-runner.ts`, `v2/beverage/plant-session.ts`, `v2/arm/adapter.ts`, `v2/arm/session.ts` (all under `packages/lab-runtime/src`); existing coffee transfer/recovery tests. Modify lab `tests/e2e/coffee-journey.spec.ts` after pin.

**Interfaces:** Consumes I01 and existing CellAdapter; produces `CoffeePlantPorts` and optional fourth CoffeeDriver constructor argument. Test helper new `runBv01Case(name: 'happy'|'missing-grip'|'receiver-moves'|'reboot-after-stage'): Promise<{served:number; transferCount:number; attention:string[]; motionStarts:number; physicalParents:string[]}>` drives real source session/dispatcher with injected doubles; not hardcoded expected outcomes. Use current `tests/support/lab-v2.ts` to construct session. Helper records actual events, closes resources in finally.

- [x] RED tests shared mock sequence plus guards and stage timeout. Example:

```ts
const r = await runBv01Case('missing-grip');
expect(r.served).toBe(0);
expect(r.transferCount).toBe(0);
expect(r.attention).toContain('GRIP_EVIDENCE_MISSING');
const recovered = await runBv01Case('reboot-after-stage');
expect(recovered.motionStarts).toBeLessThanOrEqual(1);
```

- [x] Run source `pnpm exec vitest run tests/integration/lab-v2-bv01-ports.test.ts tests/integration/lab-v2-arm-stage-start.test.ts`.
- [x] Extract hardwired plants into default mock ports; await advance/recover/drain lifecycle. Keep mock checkpoint reader; native arm snapshot null. Pre-pick guard includes machine fault/ready/cup/brew; post-grasp requires grip; release guards dock/slot/epoch/observer. Map domain start to journaled derived stage + logical start. Timeout/unknown waits for query/reconcile; stage ACK never means job done. Add native-port double with null grip to prove no completion shortcut. Implement no-motion replay across stage/start crash cuts.
- [x] GREEN focused tests plus source `pnpm exec vitest run tests/integration/coffee-transfer.test.ts tests/integration/coffee-recovery.test.ts tests/integration/lab-v2-mock.test.ts`; after clean export/import run lab `pnpm test:mock-e2e -- coffee-journey.spec.ts`. Verify both recipes, cup conservation, CargoLoaded before served.
- [x] Commit source `refactor: share coffee workflow across simulated plant ports`; Lab test commit separate. Evidence V01/V03 uses actual source+pin.

## I03 — Controller evidence đến report, timeline và inspector

**Files:** New source `packages/contracts/schemas/lab-run-verification.schema.json`, `packages/contracts/schemas/lab-arm-collision-evidence.schema.json`, `tests/integration/lab-v2-controller-report.test.ts`. Modify source `scripts/generate-contracts.mjs`, generated outputs, `packages/lab-runtime/src/v2/report.ts`, `v2/reports/simulation-evidence.ts`, `v2/arm/session.ts`, `v2/gateway.ts`. Modify lab `src/scenarios/controls.ts`, `src/twin/arm/arm-view.ts`, `src/twin/arm/arm-telemetry.ts`, `src/ui/report-panel.ts`, `src/reports/evidence.ts`, `src/reports/replay.ts`; new lab `tests/unit/controller-report.test.ts`, `tests/e2e/controller-report.spec.ts`.

**Interfaces:** Consumes ArmCollisionEvidenceRecord; produces RunVerification extension from spec. Export common UI reader new `readArmVerdict(report: RunReport, cursorTick: number): 'pass'|'fail'|'not_run'` in Lab arm-view; legacy reports use existing evaluator. Native evidence tick mapping from coordinator explicit, not fake mock trace. Gateway read-only report retrieval for native run owned by authenticated session; file import uses bounded validator and origin imported.

- [x] RED legacy compatibility, native gap/empty trace, late collision and malicious artifact paths. Example lab unit after fixture built from report test support:

```ts
expect(readArmVerdict(reportWithCollisionAtTick20, 10)).toBe('not_run');
expect(readArmVerdict(reportWithCollisionAtTick20, 20)).toBe('fail');
expect(readArmVerdict(reportWithNoSamples, 20)).toBe('not_run');
```

Fixtures above are new constants in the same test: native report with one interval ending at tick20 and colliding=true; identical report with empty trace. Tạo helper mới `tests/support/controller-report.ts` trong Lab: `controllerReportFixture(collisionEndTick: number | null): RunReport`, clone baseline mock report từ `tests/support/coffee-replay.ts`, đổi mode=simulation và thêm verification đúng schema; null tạo empty trace. Hai constants lấy từ helper(20) và helper(null), không type-cast report thiếu field.
- [x] Run source `pnpm exec vitest run tests/integration/lab-v2-controller-report.test.ts`; Lab `pnpm exec vitest run tests/unit/controller-report.test.ts`.
- [x] Implement schema-driven extension, mode union, mapping to existing LabEvidenceV2; null/missing evidence remains not_run. Display producer, engine, model/world revision, coverage/reasons/artifact hashes. Keep mock canonical hash stable. Validate import path/size/hash and prevent imported evidence authorizing live run. Add timeline selected command correlation and VI/JA/EN labels.
- [x] GREEN focused + Lab existing `tests/unit/replay-arm-collision.test.ts` and `tests/integration/arm-evidence.test.ts`; after re-pin run `pnpm test:mock-e2e -- controller-report.spec.ts arm-simulation.spec.ts coffee-journey.spec.ts`. Browser native report fixture labeled fixture/controller evidence, not native execution proof.
- [x] Commit source `feat: publish controller verification in run reports`, Lab `feat: inspect controller evidence and replay coverage`; screenshots + V04 evidence.

## I04 — Minimal readiness trên control panel hiện có

**Files:** New source `packages/lab-runtime/src/v2/readiness.ts`, `tests/integration/lab-v2-readiness.test.ts`; modify source `v2/gateway.ts`, `v2/scenario-registry.ts`, `v2/scenario-matrix.ts`, `v2/sil/cli.ts`. Modify lab `src/scenarios/support.ts`, `src/scenarios/controls.ts`, `src/ui/report-panel.ts`; new lab `tests/unit/readiness.test.ts`.

**Interfaces:** Consumes single requiredBackends derivation and server-defined probes. Produces ReadinessSnapshot via authenticated endpoint in spec; UI renders reasons and disables unavailable Start. Import schema/export pin changes through R02 if wire schema changes.

- [x] RED tests required backend absent, expired snapshot, wrong world/profile, probe timeout and native fixture missing. Define source pure helper `canStartFromChecks(checks: ReadinessSnapshot['checks'], expired: boolean): boolean`; assert:

```ts
expect(canStartFromChecks([{id:'arm',status:'unknown',reasonCodes:['PROBE_TIMEOUT'],evidenceRef:null}], false)).toBe(false);
expect(canStartFromChecks([{id:'arm',status:'ready',reasonCodes:[],evidenceRef:null}], true)).toBe(false);
```

- [x] Run source `pnpm exec vitest run tests/integration/lab-v2-readiness.test.ts`; Lab `pnpm exec vitest run tests/unit/readiness.test.ts`.
- [x] Implement bounded probes, TTL and immediate runtime recheck; include host arch, protocol/model/world mismatch, clock readiness and unsupported runner. Render in existing controls; no shell command input, no new dashboard framework. Readiness must list gripper unimplemented even when LinuxCNC doctor is green.
- [ ] GREEN tests + scenario matrix tests; browser smoke Start denied before journal allocation when unavailable.
- [x] Commit `feat: explain scenario readiness from required backend checks` in each touched repo. Record V05; UI availability is not native acceptance.

## I05 — Scheduled faults qua existing controls

**Files:** New source `packages/lab-runtime/src/v2/fault-schedule.ts`, `tests/integration/lab-v2-fault-schedule.test.ts`; modify source `v2/scenario-runner.ts`, `v2/sil/campaign.ts`, contract schema `packages/contracts/schemas/lab-run-v2.schema.json` and generator outputs. New lab `src/scenarios/fault-schedule.ts`, `tests/unit/fault-schedule.test.ts`; modify lab `src/scenarios/controls.ts` `src/project/store.ts`, `src/project/schema.ts`, `src/shared/types.ts`; thêm schedule field vào source `packages/contracts/schemas/lab-project-v2.schema.json` và regenerate types.

**Interfaces:** Consumes FaultScheduleEntry shape/catalog from spec. New pure `dueFaults(entries: readonly FaultScheduleEntry[], firedIds: ReadonlySet<string>, elapsedSimMs: number, phase: 'brew'|'grasp'|'handoff'|'delivery'): readonly FaultScheduleEntry[]`. Persist fired IDs before dispatch; injection outcome journal separately. Unknown interrupted injection requires reconcile, not refire.

- [x] RED deterministic schedule/checkpoint and unsupported backend. Example:

```ts
const entries: FaultScheduleEntry[] = [{id:'f1',faultId:'cup-removed',targetId:'cell-1',trigger:{kind:'phase',value:'grasp'},durationMs:1000}];
expect(dueFaults(entries, new Set(), 10, 'grasp')).toHaveLength(1);
expect(dueFaults(entries, new Set(['f1']), 10, 'grasp')).toHaveLength(0);
```

- [x] Run source `pnpm exec vitest run tests/integration/lab-v2-fault-schedule.test.ts`; Lab `pnpm exec vitest run tests/unit/fault-schedule.test.ts`.
- [x] Implement bounded allowlisted editor fields, validate before run, freeze hash, share validation with immediate injection. Map catalog entries to existing faults; missing native implementation displays unsupported. Persist schedule in project export and replay fired markers; no arbitrary script editor.
- [x] GREEN test invalid durations/duplicate IDs/clock jump/phase trigger across restart and browser fault→attention→reconcile on current pin.
- [x] Commit `feat: schedule reproducible scenario faults`. V06 records separate protocol-double and native coverage.
