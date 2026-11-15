# B07a — bounded replay package, Source boundary and pure Lab reader

Status: DONE_WITH_CONCERNS — B07a implementation and focused checks are complete. Final Source `a5b2ee0fb1d5f3799aca774d7930d66985a30321` / Lab `57d9c869387f408603645becb502dea394d8e2fe` is the clean review tuple. B07b UI/browser/performance and B09 cross-process ownership remain separate. No acceptance, calibrated-dynamics, native-host or hardware claim.

## Scope and review tuple

Authorized worktrees only: `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/{source,lab}`, branch `codex/web-lab-to-physical`. Original bases: Source `0624b5ad4645a5a7cc655b11084f5ce8d7e79a75`, Lab `4fabc5a5638d78a0289f09a9af240af858e98b4b`.

- Source product commit `716e16b9d487c956d774faa10f3328ea38c61a1f` — `feat: export bounded immutable web replay packages`.
- Lab initial reader/pin commit `c95b68b18dc6d9f0f1e9215aee1549345ab2773e` — `chore: pin source runtime 716e16b and replay reader`.
- Final Source/Lab occupancy-guard heads and clean-export hashes: see the final integration addendum and `evidence-B07a/final-validation-provenance.json`.

No helper agents, original-main changes, trial/web, operational ports1880/1884, native worker/host, physical robot, cloud, push/deploy/merge or outreach/spend. HTTP tests use exact-owned ephemeral loopback ports and close only their own gateways. No database in original evidence was opened; the actual Source reopen test copies the complete original nominal directory into a unique owned test directory before Source can create SQLite sidecars/recovery checkpoints. All original raw files remain unchanged.

## Source format and exporter

`packages/contracts/schemas/web-replay-package-v1.schema.json` is a strict, additive v1 schema. `WebReplayPackageV1` is generated in `packages/contracts/generated/navigation2d.ts`; the Lab sync copies the schema and generated types. Existing mock/IR-SIM/Webots/R2a archive readers and fixed-load admission were not loosened.

Public command:

```sh
node scripts/export-web-replay.mjs --input RUN_DIR --out NEW_DIR
```

Implementation: `packages/lab-runtime/src/v2/replay/{export,reader}.ts`. Typed Source APIs:

```ts
loadRetainedReplay(directory:string):Promise<CapturedReplay>
exportWebReplay(capture:CapturedReplay,output:string,options?:{signal?:AbortSignal}):Promise<ReplayManifest>
readReplayInput(root:string,path:string,max:number):Promise<Buffer>
ScenarioRun.captureReplay?(options?:{signal?:AbortSignal}):Promise<CapturedReplay>
```

`CapturedReplay` is Source-only: `{directory,report,rawReportSha256?,world?:{records,admission,sceneBytes?},mobile?:{scene,files,physics,navigation,sceneBytes?,receipt?}}`. It is never put on `RunReport`, wire JSON, checkpoints or browser requests. The CLI consumes retained `nominal-report.json`, `fault-report.json` or `report.json`, exact retained admitted files, captured report metadata and immutable named chunks. It never opens the source journal database, searches an installed latest fixture or starts a model. Other retained root layouts require an explicit supported adapter; the CLI does not guess arbitrary filenames/paths.

Every file read rejects traversal, symlinks at the admitted root/relative components and a non-file leaf; no-follow open, preallocation size limits and inode size/mtime read checks apply. World closure reuses `prepareWorldAdmission`, `captureWorldPrefixDisk` and `materializeWorldPrefix`; fixed mobile data reuses `preparePhysicsAdmission`/`readPhysicsEvidence`, its separate strict admission and original captured manifest. Model/profile/scene byte identities are retained; raw scene bytes are checked against the admitted semantic document. Output refuses an existing destination and an output inside the evidence directory. Each export owns one random sibling staging directory, fsyncs files including the manifest, and publishes by directory rename. A process-local destination reservation refuses same-destination overlap; different simultaneous same-H exports have independent owned paths. Failure/abort releases the reservation and removes only its own staging directory. B09 still owns competing-process data-root writer exclusion; this does not claim a cross-process no-overwrite lock or power-loss recovery protocol.

A package contains the captured public report, Source business events, exact scene/model/profile/NOTICE assets, all world or physics rows, and the original arm trace/props when present. World and physics display chunks use deterministic gzip at250rows/chunk, with encoded+decoded hashes and byte sizes. Original report file SHA is retained separately; report/event credentials and internal endpoint fields are redacted under declared `reportTransform:'credential_redaction_v1'`. No signing keys, journal databases, session/reclaim tokens, worker executable or arbitrary custom/executable asset formats are exported. All current reference packages fit25MiB with full coverage: **there is no sampling/decimation implementation or implicit every-five-tick display reduction**. `coverage.sampled` is alwaysfalse. A larger source run is refused at the explicit package/read limits, rather than silently requalified or trimmed.

`provenance.kind:'imported_integrity_only'`, `accepted:false`, `calibration:'not_calibrated'` and `scope:'display_only_not_requalification'` are required. Internal digest verification does not authenticate a producer. Captured Source report identities, observations and check results remain original recording claims; they are not a fresh qualification or hardware acceptance. Legacy ARM03 truncation, full-world geometric sweep, native contacts, Source custody and physical lost/unknown state remain distinct fields.

## Capture horizon, ownership and cancellation

Ruling57 uses the reviewed B06 action-serialized H/state/journal capture and recorder-serialized immutable chunkrefs+synced tail. `ArmReportCapture.materialize(replay?:WorldReplaySink)` is an optional Source-only sink through that same deferred path. `WorldReplaySink` receives owned copies of validated `WorldEvidenceRecord[]` and the admitted scene/files/context only after reconstruction, outside Source actions. Its mutation/error cannot change live critical state, the normal report, shared admission, another export or world lifecycle. `materializeWorldArmReport` still reconstructs the normal report and sweep from its own independent values. No second dispatcher/capture algorithm, fresh post-capture journal query, flush/finish/repair/resend/respawn or raw report field was introduced.

`captureReplay` and an export can proceed outside Source actions while stepping continues. Actual API tests hold immutable trace publication, advance Source7→8, then require capture/trace H7. Two real retained Source reopen captures return H10850 with zero factory calls and independently owned world data. A separate actual materializer test captures trusted H7 with a recorded ACK8, passes only ticks0..7 to the sink and reports `publication.uncommittedTicks:1`. A throwing/aborted sink does not damage a later report. Export cancellation affects that request only; a pending capture slot remains reserved until its owned work stops and cleanup finishes.

H coverage, recorder finalization and mission outcome remain independent. A report captured before close keeps `prefixCovered:true/streamFinalized:false`, even if the separately retained raw manifest has since finalized. Closed-reopen captures may honestly show finalized evidence with `WORLD_RESTART_UNKNOWN` business/recovery state; they do not resume the world or claim mission completion. All three final saved-report packages preserve their capture-time `streamFinalized:false`. H+1 observations/events cannot become a measurement atH. Earlier-cursor aggregates are explicitly unavailable.

## Live owner-scoped transport

Normal supported live composition: configured Source `engineering-mujoco-cell-v1` / `MJ-CELL-BV01` shared-world runtime, with operator MuJoCo prerequisites and existing composition readiness. `portableSimulationFromOptions` carries a verified configured-world marker to CLI/gateway health. Only that marker advertises `web_replay_package_v1`, `sim3d_world_experiments_v1`, `worldExperiments` and `features.replayExport.available:true`; provider installation alone does not imply a world factory. No native launch was needed to re-prove the already-reviewed B06 provider.

- `POST /lab/v2/runs/:runId/replay`, body `{}` →201 `{exportId,manifest}`. Cookie requests require the existing CSRF token; bearer requests use existing rules. Extra fields, paths and query parameters are refused.
- `GET /lab/v2/runs/:runId/replay/:exportId` → captured immutable manifest.
- `GET /lab/v2/runs/:runId/replay/:exportId/assets/:index` → stored encoded bytes; index is the decimal index in `manifest.assets`, never a supplied path/URL. Every read checks its admitted size/hash and rechecks owner/session after asynchronous disk IO. Binary responses use no-store/nosniff.
- `DELETE /lab/v2/runs/:runId/replay/:exportId` → `{deleted:true}`, deleting only that version.

Other-session/unknown runs/versions return private404 before limits or artifact information. Reclaim transfers read access to existing versions to the proof-bearing session and preserves view/reconcile-only robot controls; it does not confer motion authority. Live mobile fixed-step, arm-only, mock, IR-SIM and Webots export are explicitly unsupported by this new capture seam; existing behavior/readers remain baseline. In particular, B04 mobile replay is supported from a retained campaign by CLI, **not** by pretending the mobile runner has B06's capture seam. B07b must use the declared supported backend and handle422 `REPLAY_PROVIDER_UNSUPPORTED` / `REPLAY_EXPORT_REFUSED`.

Capacity/lifetime: at most2pending+retained versions per run;2active captures/exports process-wide;8pending+retained versions overall (each package≤25MiB). Excess returns429 `REPLAY_VERSION_LIMIT` or `REPLAY_CAPACITY`. Any crash-stale/untracked/unreadable entry has unknown size and immediately refuses NEW exports with429 `REPLAY_RECOVERY_REQUIRED`; a symlink/non-directory export root is also refused without following it. Bounded directory iteration uses an8-entry buffer and consumes at most8known entries, or stops at the first unknown entry. It never deletes or adopts unknown files. Scan/admission/reservation and deletion use a short serial queue; capture/materialization is outside it. Every live package output and its publication staging are under the single reserved `replay-exports/:exportId/` directory (`package/` final, random staging inside that owned wrapper), so crash residue in current or legacy staging layout is detected. Existing valid tracked versions remain usable while new exports are blocked. Normal DELETE, archive, expired-run cleanup and gateway close remove only this process's recorded export directories. Expiry cleanup is lazy at existing readiness/create cleanup points; an idle expired process may retain bounded files until cleanup/close, but cannot add authenticated versions. Graceful close aborts and waits for pending owned exports before closing runs. Unknown/crash folders require an operator/B09 ownership decision; no garbage-collection service or unsafe recovery was added. Per-process reservations and directory occupancy do not establish a cross-process writer lock.

## Registered stress selections

Optional create-run `worldExperimentId` is versioned in the request schema, immutable manifest input/checkpoint hash/reclaim record and report manifest. IDs are `world-nominal-v1`, `world-dock-drift-v1`, `world-cup-fall-v1`. They are admitted only for mode`simulation`, backend`engineering-mujoco-cell-v1`, scenario`MJ-CELL-BV01`. Absent selection preserves the old nominal path. Existing Source-only campaign injection remains separate; conflicting campaign/request selection refuses.

The last two IDs reuse B06 registry entries and fixed cup`cup-1`, phase/target/frame/duration/force. Dock drift is2000N map-X for10substeps before release; cup fall is[30,0,30]N map for10substeps during supported transport. The browser sends no cup/body ID, force vector, tick, physics override or same-run mutation. Tests refuse arm/mobile/Webots/mock old modes and forbidden force/target/timing fields/action edits. Readiness still proves the configured base composition; the per-run scene/admission then binds the one fixed registered disturbance. Label the cup case as external-impact fall, e.g. “Cốc rơi do tác động”, and show its registered disturbance. No natural cornering/slip claim.

## Browser contract and budgets

`lab/src/reports/replay-package.ts` is the exact Source portable reader copied by `sync-engineering-contracts.mjs` (schema import rewritten to the synced Lab schema); the sync check detects drift. It imports only AJV and its package schema, with no runtime transport, executor, hardware route, SQLite, model worker or URL fetch.

```ts
openReplayPackage(
  manifest:string|Uint8Array,
  readAsset:ReplayReadAsset,
  options?:{signal?:AbortSignal}
):Promise<ReplayReader>

type ReplayReadAsset=(
  asset:Readonly<ReplayAsset>,
  options:{signal:AbortSignal;maxBytes:number}
)=>AsyncIterable<Uint8Array>|Promise<AsyncIterable<Uint8Array>>;
```

The caller supplies bounded manifest bytes/text, not an already unbounded parsed object. For a live endpoint object, use its bounded serialized manifest and map `asset.path` to the manifest's numeric index; offline catalogue IDs must resolve to fixed relative package roots. `readAsset` must stream only that admitted immutable asset, enforce `maxBytes`, honor the passed signal and release its file/network reader in`finally`. The portable reader never interprets a path as an arbitrary URL. Stream chunks are copied into owned buffers, so reusing a producer buffer cannot mutate evidence. Nested external texture/buffer/mesh URLs and executable/custom render references are refused; document-source URLs are provenance only, never fetched. Known binary STL files must have exact triangle-count/byte-length agreement and≤100000triangles per asset.

| Bound | Value |
|---|---:|
| Manifest before parsing |256KiB |
| Total stored assets **plus manifest** |25MiB |
| Per encoded asset before allocation |8MiB |
| Per decoded asset before allocation/inflation |16MiB |
| Sum of declared decoded assets |512MiB |
| NDJSON line before parse |256KiB |
| Rows per decoded chunk |1000 (exporter uses250) |
| Samples per stream / public tick |30001 /30000 |
| Asset refs / streams |512 /3 |
| JSON lexical tokens per document/line; parsed nodes per asset/chunk; depth |1000000 /1000000 /32 |

A compressed high-expansion input cannot evade the declared decoded limit: output is bounded during `DecompressionStream` consumption and rechecked for exact decoded size/hash. Token/depth preflight runs before JSON allocates arrays/objects; line count is checked before splitting. Duplicate paths, stream refs and orphan world/physics chunks refuse. Scene→model/profile byte refs and captured run/boot/scene/H identities must agree.

Opening verifies assets/coverage sequentially without keeping world history. Cursor operations serialize; the reader caches at most one decoded row chunk and drops it before loading another or returning a separate asset. A load owns at most one encoded buffer (8MiB) and one decoded output buffer(16MiB), plus bounded text/parsed structures, captured report and model metadata. The total512MiB decoded budget is a whole-package work bound, **not** a512MiB resident allocation. Actual JS heap/GPU and browser180s performance are not measured here; B07b must measure them rather than infer a heap number from byte caps.

`ReplayReader` exposes deeply frozen `manifest`/`capturedReport`, `sampleAt('world'|'physics'|'navigation',integerTick)`, async`samples(kind)`, admitted`readAsset(path)`, `metricsAt(tick)`, `eventsAt(tick)` and`close()`. Samples/asset outputs are caller-owned copies; callers must release their own retained views/GPU objects. `sampleAt` is exact, including nonmultiples of5, and returnsnull where the declared stream has no sample; there is no interpolation/extrapolation. `metricsAt(tick<H)` returnsnull metrics/physicsMetrics/worldSweep with`CAPTURE_HORIZON_ONLY`; H returns the original capture-H objects and their existing availability/reasons, never substituted zeros. `eventsAt` filters original Source events by recorded`at <= businessEpochMs + tick*20`; absent/invalid Source clock returns`events:null/EVENT_CLOCK_UNAVAILABLE`. A close/abort drops the internal decoded cache/report, releases the external abort listener and cancels the decoder/underlying streaming iterator. `capturedReport` is capture-time metadata; B07b must not present its outcome/attention/final aggregates as measurements at an earlier cursor.

## Exact native-artifact roundtrips and story handoff

Fresh final package root: `/tmp/b07a-final-packages-ZYL6r5`. `retained-roundtrip-summary-final.json` and `lab-retained-roundtrip-summary-final.json` validate the same bytes using the actual Source and actual pure Lab readers. Every displayed world/physics row is deep-equal to its retained admitted original, all admitted models/profiles and scenes are byte-equal, exact final cursor/metrics/event filtering passes, and close clears the owned report. This is retained-native readback, not new native execution. HTTP scheduling/capacity tests are explicitly protocol doubles.

| Package | Original | H / samples | Stored bytes including manifest | Decoded asset bytes | Manifest SHA256 |
|---|---|---:|---:|---:|---|
|nominal|`/tmp/mekoniq-b06-nominal-7-1iGdiu`|10850 /10851|18365397|138127785|`b3eb6e7cc0e6c2287092c358e02ab3c860e76e5bc828a5ed41bae4e83bbebaea`|
|world-cup-fall|`/tmp/mekoniq-b06-world-cup-fall-v1-7-J19pL7`|2375 /2376|8968994|36988567|`98d43fafb890e9bd9cce7c0de6bdc182b46458ec8d601ba44a8f73494526e6e7`|
|cup-fall (mobile)|`/tmp/mekoniq-b04a-final-681b8ad-20261114-0954/cup-fall`|520 /521|841774|2988363|`0300656468e9cf507a2844d3e784cf89c4b2e038ebcc1ce405bdc4e49383953f`|

Each world package has22exact admitted model/profile files (including14vendor meshes); mobile has8. Nominal has4physical lifecycle interactions and9actual program/stage contexts. World fall has2lifecycle interactions and1native disturbance applied at2347(`world-2349`, target`cup-1`, forceMapN`[30,0,30]`); Source attention retains`LOAD_FELL` and `CUP_RECONCILE_REQUIRED:PHYSICAL_UNKNOWN` at2370. It also retains original `WORLD_NATIVE_CONTACT` sweep reason and floor/prop-cup-1 first unexpected contact at2375 separately; publication terminal isnull at the saved report capture, not a fabricated LOAD_FELL publication terminal. Mobile terminal remains`LOAD_FELL`/incomplete physics, with exact520frozen in-air pose and Source attention at520. All three saved reports are prefix-covered, non-finalized snapshots, modeled/not_calibrated/accepted:false.

B07b phase ribbon and issue/object/tick inputs are present as **data**, without a fabricated generic`phase` field:

- `world` rows carry `snapshot.tick/simTimeNs/robots/arms/props/physics`, `command.worldControl.program.{programId,stage,waypoint,commandId,transferId,cupId,sourceEventId,payloadHash,controlEpoch}`, `attachmentProxyPropId`, `movementInterlocked`, `stopLatched`. Use `programId/stage/waypoint` for actual Source program context; programnull does not invent a named stage. Nominal context counts are in the final audit.
- `capturedReport.businessEvents` / `source-events.json.gz` / `eventsAt(cursor)` retain `CoffeeStepStarted/Completed`, `CoffeeQualityConfirmed`, `CoffeeTransferRequested`, `CupBound`, `CupTransferRequested/Observed/EvidenceRecorded/Confirmed`, `CupHandedOff`, `CoffeeJobLoaded/Delivered`, `MissionArrived/Completed`, etc., with original sequence/at/type/kind/id/state. Derive business phases from these exact state transitions and the manifest Source clock; do not turn a free-cup pose or world birth into custody proof.
- `capturedReport.attention[]` keeps exact `reason,tick,robotId?,subjectId?,commandId?`; use these existing IDs and the scene/prop binding for issue selection. World records' `interactions[].eventId` and `command.worldInteractions[].eventId` bind Source event/cupId/propId/kind/tick; disturbance receipts retain their actual target tick and body/prop ID. CupLedger owner and physical lost/unknown remain separate. Signed map extent, original units and xArm/G2 component identity are preserved without translation; inherited illustrative arm-puma-reference remains an explicit design asset, not a renamed physical model.
- Mobile B04 has no coffee/arm phases or B06 worldStep disturbance event. Its scheduled `manifest.simulationPerturbation` fixes `payload-cup-forward-impulse-v1`, cup-1, target501/frameSample500/support frame. The added exact `observations/payload-perturbation.json` is a **modeled worker receipt**, separately verified against `case.json` artifact hash/size, run/boot/scene/load-profile/target identity, registered force dose, reconstructed support-frame force and actual before/after physics poses500/501. It is not a Source custody/event receipt. SHA256`07040d0f89cad008dd9fd32f70fcfcca5deb83eee067cf82468828e983aa57d6`; actual forceMapN`[0.034104216777046115,29.999980610748224,-0.0005070778116320744]`. Missing/unknown/mismatch/future receipt refuses this export. Never infer applied from scheduled alone.
- Public business events preserve sequence/at/type/kind/id/state, but not raw journal entryId/event-index mapping. A program `sourceEventId` or interaction `eventId` remains an opaque preserved Source reference; the browser cannot independently resolve it to an entryId from this package. B07b can link cup/command/mission/state/tick fields, and must mark the raw-entry link unavailable. The Source producer's same-capture sweep validates that correlation using its owned original journal; the package does not requalify it or invent IDs. Raw historical source-journal JSON remains in the original archive.
- Existing check IDs `world-full-capsule-v1` and `ARM03`, original outcomes and reasons are retained. These historical reports have no `verification` block/hypothesis-ID array; it remains absent/unavailable, not a fabricated pass. Mobile has no arm/world check IDs.

Earlier draft packages under `/tmp/b07a-retained-packages-L3lOv2` and preliminary summaries/logs remain unchanged. The preliminary script mistakenly counted a nonexistent`worldControl.phase` and counted only B06 `worldStep.disturbances`, so `phases:[]/faults:0` did not mean the Source context or B04 fault was missing. The final fresh package/audit uses exact program/stage fields and separately reports B04's worker receipt. No historical recording was rewritten to fix an audit counter.

## Supplemental licensing/provenance

Ruling56: B06 retained admitted bundle omitted NOTICE/vendor manifest. The exporter carries pinned verbatim licensing-record bytes, never latest fixture geometry. `xarm-licensing.json` stores original NOTICE/fixture/vendor records and verifies their fixed SHA256s plus the complete relevant admitted component and all14mesh identities before emitting `kind:'supplemental_licensing'`.

Upstream xarm_ros2 commit`ac736c92b02de7ca7e0be6f737d77d46707464d8`, BSD-3-Clause. NOTICE SHA`7b06a81d2e13936d721ea6ab2d0e3fc00901600a4f4c2cd6aa2829698518303c`; vendor record SHA`4c8e12ba58f748c0a5aefd879a5b349261fe0ea10d0255f2c3485cd1c5c2dbfe`; fixture manifest SHA`51bad5842206673d9f417a5f0f4813ac904f64b12a53cbfb403e1e12294b3407`; component SHA`0e2f40ef5a4569ea3e76879ed078fffd55d514b42c25c60072ebd7d27af3445a`. Unknown component/mesh mapping or tampered NOTICE refuses. No proxy geometry or invented licensing fallback.

B04 first-party Serve geometry uses its exact canonical physical SHA`830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9`; supplemental Source record commit`681b8adb8ed473f7195062773b23fabc3b922cd5`, NOTICE SHA`80aded154e782fa1260475402e6e7051545373f876b638c5ad1d4ae34c432196`, fixture record SHA`c93d677ab4c71bfaa2d345b687377eae21964bc44180ac4f5906df3bd7e102c8`. It states no vendor meshes/code are redistributed. Both supplements list their matching asset paths; neither is relabeled as originally admitted runtime input, producer authentication or acceptance.

## TDD and verification evidence

Commands use Node24.22.2/pnpm10.32.1 via explicit nvm PATH and bounded Perl alarms. Logs are under `evidence-B07a/`; filtered tests are not_run, not passes. No Python worker/native campaign ran.

- `export-red.log`, `reader-red.log`, `lab-reader-red.log`: expected missing exporter/reader module collection REDs (zero tests collected; not behavior-failure counts).
- `capture-red.log`: actual Source API regression fails because `captureReplay` is absent; `capture-green-initial.log` then passes.
- `selectors-red.log`: registered selection helper/schema unavailable; `selectors-green.log` then passes; final old-mode/forbidden force/timing/target/action tests are in the full focused run.
- `gateway-red.log`: initial HTTP fixture itself was rejected at create before reaching the missing replay route; this is retained setup failure, not claimed as a valid route RED. Corrected fixture uses exact cell scenario/readiness with explicit protocol-double provider. Final gateway output verifies ownership, same-H independent publications, view-only reclaim, no caller paths, abort capacity, valid-sibling preservation,2active/8overall limits and owned close cleanup.
- `event-cursor-red.log`:1failed missing `eventsAt`; `event-cursor-green.log`/`reader-final.log` pass6.
- `redaction-red.log`:1failed exposes private token/API key; `redaction-green.log` passes the focused test.
- `receipt-red.log`:1failed missing modeled B04 receipt asset; `receipt-negatives-green.log`:3passed/5filtered. It covers actual retained B04 roundtrip, nested credential redaction and independently rehashed receipt boot/horizon/force/pose/missing-file refusals. `gateway-receipt-green.log`:2/2passes after the receipt addition.
- `stale-occupancy-red.log`:1failed429 expected/422 observed on crash-stale directories; final guard GREEN is in the integration addendum.
- `focused-final.log`:110passed/1failed after a new event-cursor test was added while an older module was already loaded. `focused-final-02.log`:110passed/1failed because a synthetic stream test lacked the newly required scene binding; corrected fixture and `reader-final.log`6/6pass. Neither invocation is reported as111/111.
- **`focused-final-03.log`:14files/113passed, no skips**, before the narrow B04 receipt and crash-stale occupancy additions. Suites: web-replay export/gateway, mujoco-world-authority, replay reader/capture, world experiment/runner/evidence/report-files/sweep/bootstrap, payload experiments/contracts and Lab v2 contracts. New capture publication-blocking regression and latest reader are also18/18 in`capture-reader-final.log`. Subsequent affected receipt/gateway/occupancy checks are recorded separately, not passed off as a rerun of all113.
- `typecheck-commit.log`, `lint-commit.log`, `contracts-commit.log`:exit0 for initial product commit; latest occupancy gates are in the final addendum. `git diff --check` clean.
- Lab `lab-focused.log`:5files/37passed, no skips (new pure reader+existing payload-view, physics/navigation report shape and metrics); `lab-typecheck.log`, `lab-check-source.log`, `lab-sync-check.log` exit0. Committed `lab-check-source-committed.log` passes. Actual Lab reader subsequently round-trips all three retained packages in`lab-retained-roundtrip-final.log` without runtime transport.

Representative exact commands:

```sh
perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/security/web-replay-export.test.ts tests/security/web-replay-gateway.test.ts tests/security/mujoco-world-authority.test.ts tests/unit/web-replay-reader.test.ts tests/unit/web-replay-capture.test.ts tests/unit/world-experiment.test.ts tests/unit/world-runner.test.ts tests/unit/world-evidence.test.ts tests/unit/world-report-files.test.ts tests/unit/world-sweep.test.ts tests/unit/world-bootstrap.test.ts tests/unit/payload-experiments.test.ts tests/contracts/mujoco-payload.test.ts tests/integration/lab-v2-contracts.test.ts
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/security/web-replay-export.test.ts -t 'receipt inventory|retained B04|public exports redact'
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/security/web-replay-gateway.test.ts
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm lint
perl -e 'alarm 90; exec @ARGV' pnpm contracts:check
perl -e 'alarm 180; exec @ARGV' pnpm exec tsx /tmp/b07a-roundtrip-final.ts
perl -e 'alarm 180; exec @ARGV' pnpm exec tsx /tmp/b07a-lab-roundtrip-final.ts
```

`original-preservation-final.json` verifies all469original B06 campaign files against authoritative Freeze04 inventory, all41B04cup-fall files and exact original82-file nominal/41-file mobile path inventories (592hash/size checks including the repeated nominal inventory), zero mismatches. Raw originals and earlier drafts are unchanged. `final-validation-provenance.json` records validating file/script hashes, clean export/source/pin tuple and package raw-report digests; original dirty-B06 recording Source identity and original clean-B04 recording commit remain in their reports.

## Self-review and B07b work remaining

Self-review read the changed capture flow, gateway ownership/capacity/cleanup and new exporter/portable reader, plus the generated schema/type/pin diff. Corrected symlink preflight ordering, bounded metadata/line parsing, one-chunk serialized ownership, nested asset checks, exact scene bindings, caller-mutability, publication retry cleanup, raw H+1 clipping, abort isolation and final cursor semantics are covered. A final review identified crash-stale output slots escaping a process-only count; the narrow occupancy guard addresses that without deleting unknown ownership.

B07b should consume the committed reader/capability/types and the three exact final packages, choose catalogue IDs locally, add no-runtime/offline entry/rendering/story/camera/a11y/i18n and test all browser transport blocked. Use integer tick step1 for new native packages; signed map extent and actual body/free-cup poses remain Source data. Filter Source event/attention ribbon by cursor and keep aggregate H-only availability. Provide separate scheduled/applied receipt/Source custody labels, truthful external-impact fall title, and separate sweep/native-contact/ARM03/acceptance statements. Handle limits, refusal, close/abort and GPU resource release explicitly. No UI scaffolding, browser performance measurement or new runtime-to-hardware route is included here.

Concerns/limits remain explicit: actual JS/GPU memory and production browser180s/IPC/pause budgets are unmeasured B07b gates; model dynamics remain uncalibrated; release/hardware/native-host qualification is B10/later; cross-process data-root ownership/durable writer recovery is B09. These are scoped limitations, not concealed passing tests. No known unresolved B07a engineering failure remains; independent controller review is next.

## Final integration addendum — Ruling60 recovery guard

Source final `a5b2ee0fb1d5f3799aca774d7930d66985a30321` (`fix: refuse unowned replay export residue`), following intermediate `e41d304` (`fix: count stale replay exports against capacity`) and product `716e16b`. Lab final `57d9c869387f408603645becb502dea394d8e2fe` (`chore: pin source runtime a5b2ee0`), following reader/pin `c95b68b`. Both final worktrees are clean. Intermediate e41d304 counted residue as slots; Ruling60 correctly treats untracked size as unknown and fails closed for any residue instead. Only the final a5b2ee0/57d9c86 tuple is the final admission/pin contract. Earlier code/logs/exports and c95b68b pin evidence remain preserved.

Final clean runtime `/tmp/b07a-recovery-runtime-AqOIn4`, dirtyfalse; runtime artifact SHA`8a5e16ae271e24581283588ead7c9e43713e8fe46b0e2246f011e8c672e753d7`; manifest SHA`830ef141a89a7cde87621b4db864c3c52d4acbe5ee069921e271a88f32a8102c`/66168bytes; schemaHash`70a7768687deb7b231dc71da0c9735c72f09026b5eb0b87af94dc9ce270439a9`; portable-tools digest`7157ca10faae1f208ad3e083a0b6b889de7a5caf2941d365707ecfdfc1962872`. Initial clean716e16b runtime remains at`/tmp/b07a-runtime-hK28cc`; its manifest/artifact/pin provenance is copied to`initial-validation-provenance.json` rather than overwritten. New schema files explain the additive portable-closure digest change; no Python physics/controller/model/profile bytes changed.

R60 storage namespace: all NEW gateway package publication output and random staging are inside the one reserved `replay-exports/:exportId/` wrapper. A successful wrapper contains`package/`; an interrupted owned wrapper or legacy root-level`.replay-*` is unknown after restart and refuses new exports. A process never deletes an unowned wrapper, symlink, non-directory or unreadable entry; existing tracked versions remain readable. Reservations/scan/deletion are serialized independently of Source actions and world materialization. Cleanup keeps work registered until owned IO stops and cleanup completes; per-request directory ownership is set only after successful exclusive mkdir, so an EEXIST collision cannot authorize deleting someone else's directory.

There is no additional product capture scratch directory in OS-temp. B06's existing content-addressed arm trace/props report publications remain Source run evidence under the existing report-writer ownership/deduplication semantics; export never garbage-collects those raw/derived Source evidence files. CLI staging is an owned random sibling of the caller's explicitly chosen NEW_DIR, outside the gateway's managed registry; it is limited to that invocation and cleaned on failure, while intentional CLI final outputs are caller-managed. Retained validation/package paths under`/tmp/b07a-*` are explicit task artifacts, not hidden live-export staging. No recovery/GC service or cross-process writer lock was added.

`recovery-guard-final-02.log`:3/3gateway tests pass. The new test wraps the real directory iterator only to count consumption: sixteen unknown entries produce exactly one yielded entry, iterator cleanup occurs, new export refuses429before capture/write, a symlink export root is not followed, and its sentinel/unknown data remain unchanged after close. Existing tests cover valid sibling reads with foreign staging present, two simultaneous same-H versions, serialized global/run caps, abort capacity cleanup, DELETE/reclaim and owned close cleanup. `recovery-guard-final.log` retains an intermediate test-instrumentation failure: direct spying on a native ESM namespace was not configurable; the test uses an explicit fs-module mock wrapping the real opendir instead. It was not a product defect or native test.

`typecheck-recovery-final.log` and `lint-recovery-final.log` exit0; `git diff --check` clean. Final clean export, Lab import/sync/check/typecheck/check-sync/committed check all pass (`runtime-export-recovery.log`, `lab-import-recovery.log`, `lab-sync-recovery.log`, `lab-check-source-recovery.log`, `lab-typecheck-recovery.log`, `lab-sync-check-recovery.log`, `lab-check-source-final.log`). The portable reader/schema body and all three final replay package bytes are unchanged by this gateway-only follow-up, so prior37/37Lab and actual Lab retained-reader roundtrips remain applicable without repeating unrelated browser/native work.

Root separately performed stored+decompressed asset byte/hash audit of all three final packages: `evidence-B07a/root-package-byte-audit.json`, zero mismatches. This independent check is cited only as byte integrity; it is not schema validation, producer authenticity, Source/native/browser execution or requalification. All package sizes/hashes above remain final.

### Ruling61 — public event shape and unavailable raw-entry drilldown

The controller explicitly keeps the current public event shape. Raw journal entryId/event-index resolution is unavailable in this display-only package; phase/issue/object/tick navigation uses preserved Source business transitions and program/cup/command/interaction fields and ticks. The producer sweep separately checks original journal correlation. B07b must show the raw-entry link as unavailable and must not infer custody from proximity or opaque IDs. No second mapping/schema/export round was added. A future journal-inspection UX needs an additive sanitized mapping and a fresh package; old packages/archives stay unchanged. This is an accepted B07a scope limitation under Ruling61, not an unresolved product change. Final tuple remains Source `a5b2ee0fb1d5f3799aca774d7930d66985a30321` / Lab `57d9c869387f408603645becb502dea394d8e2fe`.

## Fix round1/5 — review1 I1–I4

All four Important findings are addressed in Source `5e09a48d4a8625276495694b1a29c04679bc6a77` / Lab `be01048a9d1e642cd77cecab99e7a24d2d0368bb`, both clean. The strict role/media/format matrix and complete eager hash check close validation disguises; one disposal path clears owned reader state on post-open/post-sample abort; Ruling62 indexed reads reserve4downloads/16MiB through both IO cleanup and response finish/close; route-specific browser DELETE preflight now preserves owner/origin/CSRF policy. Source focused23/23 and Lab4/4pass; contracts/type/lint/export/import/sync/committed pin checks pass. Actual revised Source and Lab readers verify the three existing packages unchanged;592original hash/size checks have zero changes. No new native campaign, package recording, UI work or M1 fix. Full exact RED/GREEN/history, changed contracts, clean artifact hashes and final pin are in `task-B07a-fix-1-report.md` and `evidence-B07a/fix-1/final-provenance.json`. Previous results above are preserved and are not claimed as rerun. Root scoped rereview is the next gate.

## Controller review outcome and public shutdown qualification
Independent scoped review2 closedI1–I4 withno newfixbreakage. Its unchanged parent shutdown observation means the active abort/destroy-on-close claim above applies to **internal v2.close only**; public g.close waits server.close first and may wait for a held active response. Ruling63 schedules public-close ordering/regression with B09 drain/stop+data-root ownership. The request-level4download/16MiB reservation lifetime is reviewed; prompt public shutdown is not established here. M1retainedtestportability remains deferred. Full report: task-B07a-review-2.md.
