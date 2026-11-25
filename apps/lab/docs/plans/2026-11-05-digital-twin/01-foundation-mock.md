# Lab v2 Foundation & Coffee Mock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một lệnh khởi động Lab chạy được food delivery và coffee cell mock, với source nghiệp vụ thật, scene twin, thử lỗi và báo cáo tái lập.

**Architecture:** Giữ S01/v1; xây v2 trong source theo các module nhỏ. Lab dùng artifact pin và generated contracts; không chạy bản sao business domain trong browser.

**Tech Stack:** Node 24, pnpm 10.32.1, TS/Vite/Three, SQLite journal hiện có, Vitest/Playwright.

**Spec:** [Contracts](../../specs/2026-11-05-digital-twin/architecture-contracts.md), [UX](../../specs/2026-11-05-digital-twin/product-experience.md), [verification](../../specs/2026-11-05-digital-twin/verification.md).

## Global Constraints

- Platform/domain/contracts/adapters đặt trong `source/`; trải nghiệm, project editor/viewer đặt trong `lab/`.
- Không sửa `trial/`, không chạm robot đang chạy hoặc cổng `1880`/`1884`; dev UI/runtime vẫn `4175`/`4176`.
- Mỗi run khóa mode, backend versions, model/world/recipe revision và seed.
- UI Việt/Nhật/Anh, giữ nhận diện navy/lime.
- Test snippets dưới đây là nội dung test cần tạo, không phải API hiện có. Các command dành cho file mới chỉ chạy sau task tạo file đó.

## F01 — Contract v2, capability và authority boundary

**Depends:** baseline. **Requirements:** CORE-02/03/04/11.

**Files (workspace-relative):**
- Create `source/packages/contracts/schemas/{lab-project-v2,lab-run-v2,lab-action-v2,twin-sample-v2,asset-revision,coffee-recipe,cell-command,cell-observation,lab-evidence-v2}.schema.json`.
- Create `source/packages/lab-runtime/src/v2/{contracts,capabilities,gateway}.ts` và `source/tests/integration/lab-v2-contracts.test.ts`.
- Modify `source/packages/lab-runtime/src/gateway.ts`, `source/scripts/export-lab-runtime.mjs`, `source/packages/contracts/src/index.ts` theo generator hiện có; không sửa v1 schema bytes.

**Interfaces:** `admitBackend(mode, backendSet, capabilityCatalog): AdmissionResult` trả `{ok,reasonCodes}`; `validateProjectV2(unknown)` trả typed project hoặc structured issues. Backend catalog server-owned; body không cho role/endpoint/actor. Shared cell envelope gồm `commandId, deviceId, controlEpoch, expiresAt, recipeRevision, programRef, payloadHash`, typed payload theo capability; observation gồm matching identity + bootId/seq/result.

- [ ] Tạo negative contract tests: mock + native backend bị reject, project chèn endpoint bị reject, caller gửi actorRef bị reject, mode update không được phép. Thêm v1 fixture regression và exact-byte hashes v1.

```ts
expect(admitBackend('mock', ['valetudo_native'], catalog)).toEqual({
  ok: false, reasonCodes: ['MODE_BACKEND_MISMATCH']
});
expect(validateProjectV2({...coffeeProject, endpoint: 'http://device'}).ok).toBe(false);
```

- [ ] Run từ `source/`: `node node_modules/vitest/vitest.mjs run tests/integration/lab-v2-contracts.test.ts`; red do thiếu modules, sau đó viết schema/discriminated unions và routing v2 để tests pass.
- [ ] Giữ pairing/CSRF/ownership/quotas v1; thêm cookie path v2 riêng và capability denial server-side. Artifact manifest thêm `protocolMajors:[1,2]`, `protocolMajor:2` và new schema hash; runtime chưa bật backend khi chỉ có schema.
- [ ] Run `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm typecheck` và v1 `lab-runtime*.test.ts`; mọi v1 behavior không đổi, v2 reject đúng codes. Review/commit riêng source.

## F02 — Asset model, world revision và migration

**Depends:** F01. **Requirements:** CORE-02/05, DT-01/03.

**Files:** Create `source/packages/lab-runtime/src/v2/{assets,frames,project-migration}.ts`, `source/tests/integration/lab-v2-model.test.ts`, `source/packages/lab-runtime/src/v2/models/{arm-kinematics,exact-quantity}.ts`, `source/tests/integration/lab-v2-arm-model.test.ts`; create `lab/src/project/migrations/v1-v2.ts`, `lab/src/twin/{model,frames}.ts`, `lab/fixtures/twins/{restaurant-v2,coffee-cell-v2}.json`; modify `lab/src/project/{schema,store}.ts`, `lab/src/shared/types.ts`, `lab/src/viewer/robot.ts`; create `lab/tests/integration/project-v2-migration.test.ts`.

**Interfaces:** `migrateV1Project(project): {projectV2,warnings}`; `compileAsset(asset): {visual,collision,frames,capabilities}`; `transformPose(from,to,pose,frameGraph)` rejects unknown frame. Contracts come from generated source artifact. Asset visual và collision có cùng geometry source nhưng được phép giản lược mesh có kiểm sai số.

- [ ] Tạo fixtures v1 service/Valetudo, v2 AMR/cell/cup và negative missing units/bad quaternion/cyclic frames. Test v1 DB interruption giữ nguyên backup và readable project.

```ts
const result = migrateV1Project(v1Restaurant);
expect(result.projectV2.world.handoffPoints[0].position).toEqual([1, 2, 0]);
expect(result.warnings).toContain('GEOMETRY_ILLUSTRATIVE');
expect(compileAsset(unmeasuredValetudo).capabilities.dynamics).toBe(false);
```

- [ ] Run source model + Lab migration tests để chứng minh red; implement IndexedDB transaction backup vào `legacyProjects`, maintain v1 reader, clear rollback khi upgrade blocked/validation fails.
- [ ] Tạo một model service thống nhất geometry; collision shape không lấy bán kính/khay hardcode của viewer cũ. Unknown measurements giữ null/reasons; không gán inertia cho Valetudo. Test frame inverse roundtrip error <1e-9 cho synthetic double fixtures và sample inch→m/deg→rad.
- [ ] Implement reference mock arm FK + seeded numerical IK (damped least squares, bounded iterations), joint limits/velocity/singularity rejection từ pinned PUMA model; không chỉ joint animation. Test independent golden FK poses, unreachable target, wrong units, limits, branch continuity và near-singularity. `solvePose(model,target,seed)` trả solution + residual/condition hoặc structured rejection; chưa gọi LinuxCNC và mọi result gắn `mock_kinematic`. Pose oracle/revision dùng lại với A01 để kiểm độc lập controller sau này. Define `ExactDecimal` fixed-point helper cho quantity (`subtract`, `abs`, `compare`, conversion with explicit scale), không dùng binary-float cho inventory conservation.
- [ ] Run từ `lab/`: `pnpm test:integration`, `pnpm typecheck`; từ `source/`: focused model và arm-model tests. Review schema export và screenshot footprint/mesh overlay; commit mỗi repo tương ứng.

## F03 — Scenario runtime, deterministic AMR mock và recovery

**Depends:** F01/F02. **Requirements:** CORE-03/04/07/08, FD scenarios.

**Files:** Create `source/packages/lab-runtime/src/v2/{session,clock,random,scenario-registry,scenario-runner,backend-registry,checkpoint,report}.ts`, `source/packages/lab-runtime/src/v2/backends/mock-amr.ts`; create `source/tests/integration/{lab-v2-mock,lab-v2-recovery}.test.ts`; extend exporter include modules; reuse `source/packages/robot-adapters/src/dispatch.ts`, domain authorization and journal APIs without loosening checks.

**Interfaces:** `Clock.advance(ticks)` fixed 20ms; `createScenarioRun(manifest, providers)` returns `{start,action,snapshot,report,close}`; `MockAmrAdapter implements RobotAdapter` with simulator manifest/identity, owns modeled pose/path. `canonicalOutcome(report)` strips volatile identities, keeps causal outcome/events/metrics. `ScenarioDefinition` declarative actions only, no user executable scripts.

- [ ] Write tests fixed seed+inputs twice equal outcome digest, different actor seed changes workload; paused ticks stable; entity ID deterministic logical mapping; 2 robots can't own same constrained corridor; collision/unreachable doesn't complete mission.

```ts
const first = await executeFixture('FD01', {seed: 42});
const second = await executeFixture('FD01', {seed: 42});
expect(canonicalOutcome(first)).toEqual(canonicalOutcome(second));
expect(first.businessEvents.some(e => e.type === 'RobotCommandObserved')).toBe(true);
```

`RobotCommandObserved` là event hiện có trong `source/packages/domain/src/fleet/mission.ts`; fixture runner phải trả events đọc từ journal, không tự tạo event mirror để test xanh.

- [ ] Run focused mock tests red; implement registry and per-run source fixture generalizing hardcoded one table/meal. Reuse real source commands and production admission. Mock route uses footprint grid + bounded kinematic movement for visible layout effects; label model `mock_kinematic`, no dynamics claim. Unknown geometry disallows collision metric.
- [ ] Order per tick: scripted inputs → domain decisions/outbox → model advance → observations → journal/twin projection; use PRNG stream per actor to avoid unrelated UI changing RNG. Completion originates at adapter observation after reaching modeled goal, never from scene animation.
- [ ] Persist checkpoint + logical pending operations; inject crash after journal commit and before checkpoint, duplicate arrival, expired command, observer reboot. Restart returns `needs_attention` for uncertain effect; no resend until reconciled, unresolved cargo retained.
- [ ] Run `node node_modules/vitest/vitest.mjs run tests/integration/lab-v2-mock.test.ts tests/integration/lab-v2-recovery.test.ts tests/integration/lab-runtime.test.ts`; expected all green, no robot network transport instantiated. Review/commit source.

## F04 — Coffee domain, device adapters và cup ownership

**Depends:** F01/F03. **Requirements:** CORE-09, BV-01..08, ARM mock.

**Files:** Create `source/packages/domain/src/beverage/{module,job,recipe,resources,transfer,recovery}.ts`; modify `source/packages/domain/src/modules.ts`/application registry at actual export point; create `source/packages/cell-adapters/package.json`, `src/{contract,dispatch,mock-coffee,mock-arm}.ts`; create `source/packages/lab-runtime/src/v2/scenarios/coffee.ts`, `source/tests/integration/{coffee-job,coffee-transfer,coffee-recovery}.test.ts`; create `lab/fixtures/recipes/{espresso,iced-milk-coffee}.json`.

**Interfaces:** `CellAdapter` exposes `describe`, `execute`, `cancel`, `observe`, `reconcile` using F01 typed envelopes, distinct from navigation `RobotAdapter`. Canonical domain commands: `Coffee.RegisterRecipe` (versioned recipe), `Coffee.ReserveJob` (order/cup/resource reservations), `Coffee.ObserveCup` (presence/identity), `Coffee.StartJob` (begin ready job), `Coffee.StartStep` (brew/ice/milk), `Coffee.ObserveDevice` (bound feedback), `Coffee.ConfirmQuality` (verify quantities + publish kitchen-ready once), `Cup.RequestTransfer`/`Cup.ConfirmTransfer` (ownership), `Coffee.CancelJob`/`Coffee.Reconcile` (disposition), `Coffee.RecordCleaning` (audited readiness). Exact schemas generated in task; platform station authorization applies to each command. These names are canonical for plan02, no second Beverage registry. `CoffeeJob` contains ordered step states, resource reservations, cup/recipe IDs and immutable revisions. Job transition table follows simulation spec, terminal complete requires fulfillment handoff, not brew done alone.

- [ ] Tests: brew only after cup+machine ready; ice jam halts workflow; empty milk rejects step; invalid/unknown quantity cannot pass automatic quality; duplicate brew completion never charges/consumes twice; cup transfer one owner; cancel after pour retains consumed inventory and physical cup disposition.

```ts
const after = decideCoffeeJob(jobAwaitingCup, {
  type: 'Coffee.StartJob', payload: {jobId: 'coffee-1'}
});
expect(after.rejectionCode).toBe('CUP_NOT_CONFIRMED');
const reconciled = applyTransfer(sourceCup, sameTransferReceiptTwice);
expect(reconciled.cup.ownerId).toBe('amr-1');
expect(reconciled.inventoryMovementCount).toBe(1);
```

`decideCoffeeJob` and `applyTransfer` are pure new domain functions owned by this task; fixtures include relevant complete state/command envelope through test helper using source authorization.

- [ ] Run focused coffee tests red; implement durable steps `reserve → await_cup → brew/ice/milk recipe steps → quality_check → transfer → delivery`, with `needs_attention/quarantined/cancelled` outcomes. Model resource leases for machine/nozzle/arm/handoff zone; expired ownership never permits another controller to assume cup state.
- [ ] Implement mock per-device completion/quantity and deterministic fault injection, arm joint trajectory từ F02 FK/IK/limits model, interpolation labeled illustrative; no claimed torque/physical grip. For mock fixtures use recipe volume/time values tagged illustrative and unit conversion to SI; no hardware-ready flag. Attach cup only on grasp confirmation, release only on receiver evidence.
- [ ] Integrate W07 recipe/inventory consumption through existing module API, tracking reservation vs irreversible dispense; failed/cancelled job records waste and no blind rollback of physical consumption. Operator/manual handoff uses same domain with human provenance.
- [ ] Run focused tests + source contracts/typecheck; business events include recipe/job/cup/transfer IDs and observer identity. Verify registry doesn't expose cell execution to existing native robot adapter accidentally; review/commit source.

## F05 — Twin workspace và operations experience

**Depends:** F02; fixtures allow parallel work with F03/F04. **Requirements:** UX, DT-02/04.

**Files:** Create `lab/src/twin/{scene,selection,overlays,inspector,coffee-cell,amr}.ts`, `lab/src/scenarios/{catalog,controls,preflight}.ts`, `lab/src/ui/{workspace,operations-panel,engineering-panel}.ts`; modify `lab/src/app.ts`, `src/styles/main.css`, `src/i18n/index.ts`, `src/viewer/fallback.ts`; create `lab/tests/e2e/{twin-workspace,coffee-journey}.spec.ts`.

**Interfaces:** `renderTwin(snapshot, viewState)` read-only; `selectEntity(entityId)` shared across scene/timeline/inspector; UI action only via runtime client. ViewState is not execution permission. Split large app by these responsibilities without rewriting unrelated BOM/cost screens.

- [ ] Playwright test first: coffee preset → missing-cup fault → visible reason and affected entity → correction/confirm → complete; switch 2D retains selection/state; engineering panel shows units/observed vs commanded/age; mobile keyboard-only controls work.

```ts
await page.getByRole('button', {name: 'Cà phê sữa đá'}).click();
await page.getByRole('button', {name: 'Chạy mock'}).click();
await expect(page.getByTestId('mode-badge')).toContainText('MOCK');
await expect(page.getByTestId('cup-owner')).toHaveText('Coffee cell');
```

Fixture strings localized through existing `tr(vi,ja,en)`; tests use test IDs for dynamic telemetry and role labels for user actions. Avoid relying on CSS color for status.

- [ ] Implement persistent mode/backend/revision bar, layer toggles footprint/path/contacts/frames, operator next-action card, engineering joint/sensor/cup details, cycle/resource queue and cause links; legends identify modeled/observed/unknown. No physical E-Stop-looking button in browser.
- [ ] Run `pnpm typecheck`, focused Playwright tests and `pnpm build`; evidence screenshots ≥1280px and mobile, VI/JA/EN, WebGL disabled/reduced motion. Review mismatch geometry fix and actionable faults, commit Lab.

## F06 — Continuous telemetry, replay, compare và reports

**Depends:** F03/F04/F05. **Requirements:** CORE-05/06/10, DT-02/05.

**Files:** Create `source/packages/lab-runtime/src/v2/{telemetry,event-stream,twin-projection,comparison,residuals}.ts`, `source/tests/integration/{lab-v2-stream,lab-v2-report,lab-v2-residuals}.test.ts`; create `lab/src/twin/{store,freshness}.ts`, `lab/src/runtime/stream.ts`, `lab/src/reports/{replay,compare}.ts`, `lab/tests/e2e/twin-recovery.spec.ts`; modify `lab/src/runtime/client.ts`, `lab/src/reports/metrics.ts`.

**Interfaces:** `TwinStore.apply(sample)` orders provider bootId+seq, bounded state buffer; `snapshotAt(cursor)` read-only; `compareRuns(a,b)` includes compatibility reasons and definitions/population/coverage. Report separates business events (durable) from lossy high-rate telemetry.

- [ ] Tests simulate duplicate/out-of-order samples, epoch reset, dropped stream, Last-Event-ID too old, slow browser, stale pose while heartbeat continues, paused sim, lost runtime/re-pair; inspect final command count remains unchanged during replay.

```ts
store.apply(sample({seq: '7', observed: {x: 2}}));
store.apply(sample({seq: '6', observed: {x: 9}}));
expect(store.entity('amr-1').observed.x).toBe(2);
expect(compareRuns(mockReport, hardwareReport).comparable).toBe(false);
```

- [ ] Implement SSE durable event cursor + separate coalesced telemetry stream, snapshot resync and explicit gap record. Poll fallback per spec; v1 still returns 501 for events. Apply action receipts separately from high-rate telemetry revision.
- [ ] Implement read-only scrub/playback, trace command→observation→business transition, A/B scenario compare, CSV/JSON + shareable HTML report with source manifest, sample counts/seed list and missing evidence. Never render customer text via unsafe HTML. Exports omit tokens/paths/private keys.
- [ ] Implement `alignObservations(predicted,observed,alignmentProfile)` và `computeResiduals(aligned)` cho translation m, quaternion angular rad, cycle s, quantity m³/kg; loại sample stale/unknown/missing frame, báo coverage và skew. Không nội suy qua gap quá profile threshold. Test synthetic known offset, missing timestamps, out-of-order và unit errors; result unavailable khi thiếu calibration/alignment, không trả residual 0. Tách calibration dataset IDs khỏi held-out validation IDs; validator reject overlap. Drift vượt ngưỡng profile chỉ tạo recommendation/evidence invalidation, không tự ghi controller parameters. F06 hoàn thành bằng synthetic fixtures; H02 bổ sung shadow data thật.
- [ ] Run focused stream/report tests, Playwright reconnect/replay, existing report metrics tests. Measure memory/latency using verification workload; record actual values, do not set green badge if measurement missing. Review/commit both repositories.

## F07 — One-command mock launcher, install và runtime artifact

**Depends:** F01–F06. **Requirements:** CORE-01/12.

**Files:** Create `lab/scripts/start-mock.mjs`, `lab/scripts/test-mock-e2e.mjs`, `lab/tests/integration/mock-launcher.test.ts`; modify `lab/package.json`, `lab/scripts/{import-runtime,runtime-artifact,start-runtime,check-source}.mjs`, `lab/config/source-runtime.lock.json`, `lab/README.md`; modify `source/scripts/export-lab-runtime.mjs` and tests for standalone artifact.

**Interfaces:** new `pnpm lab:mock` runs installed artifact with mock allowlist + UI. New `pnpm test:mock-e2e` boots isolated temp run dirs, pairs and executes food/coffee without manual token entry; production user launcher still pairs securely (terminal one-use token or one-use handshake kept out of URL/log history).

- [ ] Launcher tests fail on unsupported Node, missing/corrupt artifact, busy port, dirty exporter, unavailable backend; Ctrl-C only terminates owned children. No automatic network download on start or secret committed to bundle.
- [ ] Implement manifest protocol compatibility and generated contracts import as one transaction with lock update; old artifact retained for rollback. Export source from clean temporary checkout if user's checkout dirty; never use `--allow-dirty` for imported release.
- [ ] From `source/`, export artifact using existing exporter syntax; from `lab/`, import with `node scripts/import-runtime.mjs <artifact-dir>`, `pnpm check:source`, `pnpm lab:mock`. Clean machine first installs exact lock dependencies; offline release has those and assets vendored.
- [ ] Test fresh macOS and Linux profile, network disabled after install. FD01 and BV01 complete through actual source journal; launcher boot-to-ready được đo riêng (10 cold starts trên host ghi rõ cấu hình, mục tiêu đề xuất p95 ≤30 s sau install; không tính tải dependencies); mục tiêu usability 3/5 phút trong verification đo riêng. Publish setup/troubleshooting with “preview only” message when runtime missing, never animation masquerading as working source.
- [ ] Run `pnpm test:mock-e2e`, `pnpm build`, existing `pnpm test:runtime-e2e` for S01 artifact compatibility; review/commit source artifact and Lab pin separately with recorded hashes.

## F08 — R-MOCK acceptance và handoff simulation teams

**Depends:** F07. **Requirements:** toàn bộ R-MOCK assertions thuộc QA/UX/FD/BV/SYS.

**Files:** Create `source/tests/acceptance/lab-v2-mock.acceptance.test.ts`, `lab/docs/implementation/evidence/digital-twin-v2/mock-report.md`, `lab/config/simulation-compatibility.json`; update Lab docs progress (actual evidence only).

- [ ] Build table mapping every mock-capable scenario from verification to test + expected outcomes; unsupported physical assertions remain `not_run` + reason `UNSUPPORTED_FIDELITY`, không pass. 20 seeds for stochastic scenarios and repeated same-seed run; retain canonical digests and failure traces.
- [ ] Run acceptance headless plus guided usability tasks with representative users. Two runs compare wait/travel/brew/transfer and intervention counts; missing/censored durations remain explicit. Record baseline host specs and thresholds before timing run.
- [ ] Confirm source regression suites, Lab unit/integration/build and browser acceptance all pass; verify no hardware adapter reachable in mock by transport deny tests, not merely hidden buttons.
- [ ] Freeze v2 contracts, fixture manifests, provider interface and code revisions for plan 02/03. Mark R-MOCK accepted only after evidence review; leave R-SIM/hardware states blocked until corresponding runs.

**Handoff:** Các plan [02](02-simulation.md) và [03](03-arm-hardware.md) dùng source domain/adapter contracts đã freeze ở đây. Không dùng simulator completion timing 1000 ms cũ làm baseline physical cycle time.
