# Lab Integration và Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thành vertical slice trên Lab, mở rộng hai robot và tạo release evidence đúng phạm vi.

**Architecture:** Lab dùng authenticated gateway/artifact pin có sẵn, renderer read-only và backend clock metadata. Batch runner dùng cùng source/provider; qualification phân biệt assertions software với native/hardware acceptance.

**Tech Stack:** TypeScript/Three.js, Vite, Playwright/Vitest, Node24 artifact scripts, pinned Python workers.

**Spec:** [UX/runtime](../../specs/2026-11-08-linkforge-irsim/workers-runtime.md), [verification/gates](../../specs/2026-11-08-linkforge-irsim/verification.md), [contracts](../../specs/2026-11-08-linkforge-irsim/contracts.md).

## Global Constraints

Áp dụng nguyên văn toàn bộ [Global Constraints của plan tổng](README.md#global-constraints). Không đổi `lab:mock`, Node-only offline behavior, existing native IDs hoặc R-MOCK acceptance. UI VI/JA/EN, 2D fallback và no-runtime editing đều phải giữ. Paths tính từ workspace.

---

## C01 — Lab vertical slice với model validation và IR-SIM

**Depends:** A02, B04, B05. Hoàn thành task này mới có integrated single-robot demo.

**Files:** Modify `lab/scripts/sync-engineering-contracts.mjs`; create generated `lab/src/shared/navigation2d.ts` và synced schemas; modify `lab/src/scenarios/engineering.ts`, `src/ui/{assembly-page,engineering-panel,workspace}.ts`, `src/scenarios/{catalog,preflight,support}.ts`, `src/twin/{overlays,scene}.ts`, `src/viewer/{twin3d,engineering-scene}.ts`, `src/reports/{replay,metrics}.ts`; create `lab/src/ui/model-validation-panel.ts`, `lab/src/twin/lidar.ts`, `lab/src/reports/navigation2d.ts`; create `lab/scripts/start-irsim.mjs`. Tests **new** `lab/tests/unit/{model-validation,irsim-controls,lidar-overlay,navigation2d-report}.test.ts`, `lab/tests/e2e/irsim-journey.spec.ts`, `lab/tests/integration/irsim-launcher.test.ts`. Extend source exporter portable manifest và Lab importer closure tests cùng task, final qualification ở C03.

**Interfaces:**

```ts
function projectScan(scan:LidarScanV1,poseAtScan:Pose):{
  hitPointsM:[number,number,number][];unknownBeams:number
};
function navigationEvidenceView(report:RunReport):{
  supported:boolean;provider:string|null;complete:boolean;reasons:string[]
};
```

Client methods `validateEngineeringModel(ref:EngineeringRef,robotId:string):Promise<ModelValidationReportV1>` và `readModelValidation(reportDigest:string):Promise<ModelValidationReportV1>` dùng existing session/CSRF client. Source-run control contract không có endpoint velocity mới cho frontend.

- [ ] **Viết red tests cho controls/layers và journey.** Mock/native behavior cũ giữ; simulation+source_fixed_step cho phép step/pacing, simulation+native giữ controls native. Sensor rendering dùng sample-time pose, fallback2D, missed beam không thành hit. Validation stale after edit, full graph IDs truy ngược UI.

```ts
expect(view.provider).toBe('irsim_2d');
expect(view.complete).toBe(false); // imported report with a missing scan chunk
expect(projected.hitPointsM).toHaveLength(1); // fixture: hit, miss, invalid
```

- [ ] **Run red unit/integration.** Lab: `pnpm exec vitest run tests/unit/model-validation.test.ts tests/unit/irsim-controls.test.ts tests/unit/lidar-overlay.test.ts tests/unit/navigation2d-report.test.ts tests/integration/irsim-launcher.test.ts`.
- [ ] **Sync/export source đã commit sạch.** Extend exporter `portableSimulationTools` riêng và importer verifies closure. Từ source dùng positional path đúng CLI: `node scripts/export-lab-runtime.mjs /tmp/mekoniq-irsim-runtime-c01`. Từ Lab chạy `node scripts/import-runtime.mjs /tmp/mekoniq-irsim-runtime-c01`, `node scripts/sync-engineering-contracts.mjs`, `pnpm check:source`; pin candidate trong commit riêng. Không dùng `--clean-checkout` để export code chưa commit vì nó sẽ export HEAD cũ. New sync copy navigation types/schemas từ source, tránh drift thủ công.
- [ ] **Implement UI và launcher.** Add model validation panel; chọn IR set chỉ khi health cho phép; clock controls theo execution metadata; projection root-drive đúng; layers physical/safety/planned/observed/scan/collision và provenance. Report imports fail closed on hash/unknown schema. `start-irsim.mjs` preflight venv/lock, loopback pairing, spawn chỉ own processes, no download; flag off mock launcher unchanged.
- [ ] **Run browser bằng real worker.** Tạo `lab/scripts/test-irsim-e2e.mjs` chạy isolated runtime/UI theo patterns mock runner, ports test riêng được truyền qua launcher, không dùng1880/1884. Add `test:irsim-e2e` script. Journey: load Serve→validate→world10tables→FD01→confirm load/handoff→pause/step→report→replay→edit width→stale→rerun. `pnpm test:irsim-e2e -- irsim-journey.spec.ts`; failure nếu Python/worker unavailable trong qualified CI, không silently skip. Capture VI/JA/EN desktop/tablet screenshots trong candidate evidence.
- [ ] **Green + legacy.** `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:runtime-e2e`, `pnpm test:mock-e2e`; include no-runtime draft/storage/undo and WebGL-loss paths. Commit `feat: expose portable simulation and model validation in Lab`.

**Acceptance:** Một vertical slice thực chạy đúng bundle/engine với UI/report matching; G-INT1 single-robot tested, full gate chờ NR qualification C03. Không coi screenshot riêng là evidence backend.

## C02 — Hai robots, fault suite và batch

**Depends:** C01, B03–B05.

**Files:** Create `source/packages/lab-runtime/src/v2/navigation2d/{scenario-fixtures,batch}.ts`, `source/scripts/{lab-irsim,record-irsim}.mjs`; modify new runner/controller và existing zone-bridge wiring (không đổi reservation domain semantics), scenario registry/matrix/allowlist; extend `lab/src/scenarios/{catalog,support}.ts`. Tests **new** `source/tests/integration/{irsim-fleet,irsim-faults,irsim-batch}.test.ts`, `source/tests/unit/irsim-cli.test.ts`, `lab/tests/e2e/irsim-fleet.spec.ts`.

**Interfaces:** `runIRSimBatch(options:{campaignPath:string;outDir:string;concurrency:1|2;sourceCommit:string}):Promise<{runs:{id:string;result:'pass'|'fail'|'not_run'}[];complete:boolean}>`. Campaign JSON server-owned entries `{scenarioId,scenarioRevision,fixtureId,seed,repeat,policyRef,expectedAssertions}`; refuse arbitrary module/shell/YAML paths from UI. CLI repository file input allowlist/path validation ở operator boundary.

- [ ] **Viết multi/fault red tests.** IR02–IR10, INT03;2robots thực trong cùng environment, distinct wheel/sensor configs; reservation pre-entry guard, full-footprint release, pending/unknown không bypass. Failed path/cancel được assertion pass khi business outcome đúng. Simultaneous goals map theo robotId, không list position.
- [ ] **Run red.** Source `pnpm exec vitest run tests/integration/irsim-fleet.test.ts tests/integration/irsim-faults.test.ts tests/integration/irsim-batch.test.ts tests/unit/irsim-cli.test.ts`.
- [ ] **Implement scenario bridge và campaign.** Reuse source Zone.Reserve/Release events, immutable actor schedules and policy overrides. Enable `IR-FD03`, `IR-FD04`, `IR-FD04-blocked`, `IR-FD07` chỉ sau providers/scenarios resolve đủ; không sửa FD legacy. Export `runIRSimBatch` từ `navigation2d/batch.ts`. No-progress watchdog, pair collision episode IDs, whole-footprint exit proof; no autonomous TTL ownership release.
- [ ] **Implement bounded batch runner.** Tối đa2world processes, per-run dirs/seed/hash/timeouts; từng task finalize evidence hoặc record failed/not_run. Exit1 khi bất kỳ required assertion fail/incomplete, exit2 prerequisite thiếu, exit0 chỉ khi tất cả required ran/pass. Truncate UI preview không truncate durable data. Example result oracle:

```ts
expect(summary.runs).toHaveLength(20);
expect(summary.complete).toBe(true);
expect(summary.runs.every(r=>r.result==='pass')).toBe(true);
expect(activeChildPidsAfterClose).toEqual(activeChildPidsBeforeStart);
```

- [ ] **Green real campaign và browser.** Twenty sequential runs +2 concurrent worlds, noisy repeats3 lần, cancel/worker death and collision cases; fake worker suite vẫn riêng label protocol_double. Lab `pnpm test:irsim-e2e -- irsim-fleet.spec.ts`; robot01 table05/robot02 table08→kitchen, khách đi ngang; report metrics từ trace. Commit `feat: qualify multi-robot IR-SIM scenarios and batch runs`.

**Acceptance:** G-IR2/3 tested with real-engine artifacts; all failure modes have expected/actual/oracle, không chỉ demo animation. Headless suite chạy được độc lập UI.

## C03 — Packaging, regression, evidence và native handoff

**Depends:** Tất cả task trước. Không provision Linux/hardware trong task này.

**Files:** Modify `source/scripts/export-lab-runtime.mjs`, portable bootstrap/manifests; modify `lab/scripts/{import-runtime,check-source,build-offline}.mjs` chỉ phần nhận diện portable tool distribution (mock bundle behavior giữ nguyên); add `source/robotics/{model-validation,navigation-2d}/README.md`, license inventory; update `lab/docs/simulation-compatibility.md` và READMEs. Create fresh evidence `source/docs/implementation/evidence/linkforge-irsim/candidate-01/`, `lab/docs/implementation/evidence/linkforge-irsim/candidate-01/`. Tests extend existing exporter/importer/offline/launcher plus **new** `source/tests/acceptance/linkforge-irsim.acceptance.test.ts`.

**Interfaces:** Qualification manifest `linkforge-irsim-qualification/1` chứa identities/command receipts/artifact digests/requirement-gate status; `accepted:false` mặc định. Metadata `portableSimulationTools` không ghi đè native `simulationTools` và không sửa old artifact manifests.

- [ ] **Viết fail-closed acceptance guard.** Reject wrong provider/protocol_double, dirty/changed source+Lab pin, absent expected assertions, missing/corrupt artifacts, not_run mislabeled pass, lost tick/sensor coverage. Existing mock/native gates không thể đóng bởi extension mới. Source `pnpm exec vitest run tests/acceptance/linkforge-irsim.acceptance.test.ts` trước artifacts phải báo thiếu evidence, không pass do empty tests.
- [ ] **Chốt clean candidate trước recording.** Commit source implementation; export artifact, import Lab, commit Lab pin/code. Capture both SHAs/locks/OS/arch/Python and baseline inventories. Verify closures and source/schema identity. Recorder mới reject existing output root, không rm historical directory. Nếu candidate-01 tồn tại, tạo candidate-02 bằng cùng procedure và update manifest refs một lần trước recording.
- [ ] **Chạy suites/quota/performance.** Source contracts/typecheck/new TS/Python suites + legacy regression; Lab unit/build/browser/e2e/offline checks. Đo60s steady-state workload spec và UI budget trên cùng host fixture; record p50/p95/RSS/disk/RTF. Native/hardware/fresh-machine chưa chạy ghi not_run với reason, không đổi gate ledger.
- [ ] **Ghi baseline compatibility bằng recorder hiện có.** Từ Lab chạy `node scripts/record-regression.mjs --suite physical-robot-lab --out docs/implementation/evidence/linkforge-irsim/candidate-01/regression`; guard chạy từ source với `LAB_V2_REGRESSION_DIR=../lab/docs/implementation/evidence/linkforge-irsim/candidate-01/regression pnpm exec vitest run tests/acceptance/lab-v2-mock.acceptance.test.ts`. Không dùng default output và không overwrite historical R-MOCK evidence. Update allowlist evidence paths có test root-boundary nếu recorder hiện có chưa cho root mới; không mở allowlist cả repo.
- [ ] **Ghi new-provider evidence.** `node scripts/record-irsim.mjs --out docs/implementation/evidence/linkforge-irsim/candidate-01` từ source sau khi script C02 đã có; script gọi cùng tests/worker/runner, stamps candidate identity trước/sau. Include LF01–06,CMP01–05,IR01–10,SEN01–02,EVI01–03,INT01–04; đặt `LAB_IRSIM_EVIDENCE_DIR=docs/implementation/evidence/linkforge-irsim/candidate-01` cho new acceptance test. Artifact không thể produce thì fail/block đúng scope, không fabricated report.
- [ ] **Distribution và rollback checks.** Fresh Mac developer setup dùng explicit bootstrap/pins; launcher runtime không cần network. Missing/corrupt Python tool bundle→IR unavailable nhưng mock vẫn hoạt động. Tắt flags/reimport old pin giữ data/report export; runtime mới đọc report cũ. Optional bundled-Python offline/fresh-machine profile chỉ accepted sau separate actual target smoke; mặc định release không claim support đó. License core/IR/transitive/assets manifests khớp files shipped.
- [ ] **Native handoff document.** Ghi model/URDF/SRDF hashes, name-map, check scope/assumptions và bước chạy native profiles cũ khi có Linux. Giữ Gazebo/Nav2 và MoveIt/LinuxCNC qualification riêng; chưa promote LF reference generator. Handoff ghi G-NATIVE/G-HW not_run hoặc blocked_external theo ledger hiện hữu.
- [ ] **Review và commit evidence.** So before/after NR rows và scenario inventory. Báo implemented/tested/gate scope, package limitations, không sửa accepted state tự động. Commit sanitized docs/evidence `docs: record portable simulation qualification`; code/pin thay đổi sau record yêu cầu candidate mới.

**Acceptance:** Reviewer có package review được: spec traceability, actual reports/replays, screenshots, clean identities, lock/license closure, rollback và mọi external blockers. Chỉ khi reviewer xác nhận đầy đủ mới ghi accepted cho sáu gate mới; R-MOCK/native/hardware vẫn giữ trạng thái riêng.
