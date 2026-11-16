# Task brief B04b — Lab payload preset, rendering, report and replay

Original parent B04 is split sequentially into source B04a then Lab B04b. All B04 exit criteria remain; parent is incomplete until both reviewed. Read the final B03/B04a reports for implemented source interfaces and pins before UI edits.

## Global Constraints

- Chỉ bắt đầu implementation phụ thuộc R2a sau B00; không sửa spec/plan/code R2a trong lần soạn tài liệu này.
- Node 24.22.2; pnpm 10.32.1; portable workers Python 3.11; `PYTHONDONTWRITEBYTECODE=1` khi chạy pytest. Python ROS dùng bản của profile distro, không ép rclpy vào venv portable.
- Nền vật lý là engine pin của R2a đã bàn giao; snapshot nghiên cứu là `mujoco==3.17.0`. Không tự nâng lock ở B02.
- Một logical tick 20 ms; 10 substeps × 2 ms là baseline MuJoCo; tốc độ UI chỉ thay pacing.
- Source là authority mission/journal/custody, Lab chỉ simulation/replay. Không thêm Lab→hardware route.
- Một active world MuJoCo/runtime; một ACK đang bay; lost ACK → unknown, không resend hoặc respawn tiếp tục cùng run.
- New fields optional/versioned; mock BV01 golden, IR-SIM chunks, Webots bytes, archive readers và R2a behaviors giữ theo baseline.
- Geometry/units SI và frame đúng contract; dynamics `not_calibrated`; vendor files có commit/sha256/license/NOTICE.
- UI dùng `tr(vi,ja,en)`, giữ a11y/reduced-motion/2D/no-runtime path; không thêm framework/browser engine.
- Không sửa `trial/`, `web/`, cổng 1880/1884, runtime data hoặc evidence lịch sử để vượt gate.
- Mỗi mutation ở đúng repo; source runtime/schema/tool commit → export sạch → Lab re-pin commit. Không Git ở workspace root.
- Candidate tự động luôn `accepted:false`; human sidecar gắn hash/profile; skip là not_run.
- Task chuẩn bị không deploy, provision host trả phí, ký commissioning thật hoặc chạy robot. Các hành động đó cần đích/phạm vi người dùng giao khi thực thi.

## Execution context
All source/ and lab/ paths are relative to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/. Never edit original main checkouts. Read specs at /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical. User authorized implementation on new worktrees on 2026-11-14; original doc-only wording refers to authoring, not current authorization. No push/deploy/native hardware execution. Use Node 24.22.2 and PYTEST_ADDOPTS="-p no:cacheprovider" with PYTHONDONTWRITEBYTECODE=1 for workers.

## Owned implementation scope

- Create lab/src/twin/payload.ts and lab/src/reports/physics.ts; modify lab/src/{scenarios/catalog,scenarios/support,twin/model,viewer/twin3d,ui/report-panel}.ts and necessary launcher/export/browser-schema wiring.
- Preset ID `mujoco-payload`, default center load and1×. Implement registered selector/capability/readiness using B04a source APIs; changed profile creates a new run. Keep mock/IR-SIM/Webots/R2a presets.
- Render the actual AMR/load from committed plant observations with admitted model/load geometry and digest; no client physics or motion animation. Real tray and free cup must be visible. Reuse existing panel/timeline UX rather than a new framework/browser engine.
- Reuse B03's generated physics schema registration and optional PhysicsReportBlock, extending closed validation for B04a payload fields and every new value consumed. Old reports without physics remain importable/unavailable. Admit the new provider after validation, replacing B02b's deliberately temporary unsupported-provider test.
- Implement concise timeline physics metric display and report/replay using B03 verified definitions. Do not let final aggregate values appear measured at an earlier replay cursor. Missing evidence is unavailable/gapped, never zero or interpolated through gaps.
- Source should stay unchanged unless a concrete B04a compatibility defect emerges; escalate that seam instead of inventing a parallel API. If source runtime/schema changes are necessary, commit/export/re-pin before Lab UI commit.

## Required verification and handoff

Use TDD for new behavior with lab/tests/unit/payload-view.test.ts and lab/tests/e2e/mujoco-payload.spec.ts. Browser acceptance: preset→readiness→run→actual moving/free cup→stop→report→replay; include rotated tray/relative-load fixture to catch world/chassis attachment animation. Cover empty load, changed registered profile/new identity, malformed imports and old report absence. Exercise source engine through the correct MuJoCo launcher, not a protocol double presented as native simulation. Run three languages with labels/tr(vi,ja,en), keep keyboard/a11y/reduced-motion/2D/no-runtime behavior; source full WEB04 qualification remains B10. Capture live and replay at matching tick/object and inspect screenshots, including mobile390px and desktop. State not_calibrated/localization ground_truth truthfully. Do not add marketing quiz or gates to product flows.

Use the ui-ux-pro-max skill as relevant to the existing product design, not as permission to replace framework or brand. Explain visible state and user decisions, not internal implementation detail. Existing UI/browser regression tests need only focused affected paths; broad whole-branch regression is B10.

Commands (Lab): `perl -e 'alarm 600; exec @ARGV' pnpm test:mujoco-e2e -- mujoco-payload.spec.ts`, plus focused unit/typecheck/check:source. Runtime pin must be the reviewed B04a source (or subsequently reviewed seam fix); no historical runtime substitute. Full original B04 exit: one AMR with payload runs actual engine through Lab, corresponding report/replay and visible physical faults, while shared-world cell remains unclaimed until B05/B06.

## Lab preflight findings
- Current viewer/twin3d.ts draws AMRs as a generic cylinder; this would leave a payload floating in space above an invisible tray. New payload preset must render the admitted Serve physical geometry/tray at actual base pose, from synced/pinned model input with digest agreement. Keep legacy drawings untouched. A small payload.ts model adapter is preferable to modifying model.ts's shared asset compiler, which has a source/Lab parity test. Use link transforms in canonical base frame, then map-to-three transform exactly once.
- Current observed cup path already exists: TwinSample observed.positionM/quaternionXyzw -> entity.plant -> TwinPoses.cups; reuse for mobile payload but do not fabricate business cup ownership from support contact. Free load can exist without a coffee ledger entry; expose a simulation payload entity with explicit provenance.
- Twin3d uses xarmLayout.cup dimensions for all plant cups today. New payload view must use the admitted load geometry (and hash), not quietly latest xArm dimensions even when numerically equal.
- Lab sync-engineering-contracts currently syncs schemas and explicit fixture lists (Serve/Webots/xArm). Add new payload schemas/fixtures through that script, not manual generated edits.
- Some arm inspector labels treat any physics_sim other than providerId=mujoco_arm as Webots. For new mobile/cell labels use explicit provider/engine identities, preserve old labels.
- Browser report import has permissive top-level structure. Explicitly validate new physics evidence and telemetry pose fields consumed by UI; do not call unvalidated extra JSON trusted. Missing old-report physics stays unavailable.
- Preserve replay gaps and per-cursor visibility: a later final physics summary must not leak as a metric measured at an earlier tick. Scrubbing backward hides not-yet-created payloads and future faults.

Additional concrete UI targets: src/reports/metrics.ts currently titles every navigation evidence block "Navigation evidence (IR-SIM 2D)" and appends planar-only limitations. Update explicit engine wording for the new provider when modifying report UI, leaving actual IR-SIM limitations true. src/twin/pose3d.ts/placeBody and viewer/twin3d.ts/TwinPoses are existing map-Z-up to Three-Y-up boundaries; keep canonical model transforms in map/base coordinates and convert once. Reuse existing tests for report XSS/import validation and backward replay visibility.
Source B03 owns the durable reader/report producer and already supplies minimal browser physics schema/block validation. B04b extends payload/provider validation and adds display/replay. This boundary does not permit trusting arbitrary imported physics JSON.

Mobile telemetry is now produced by B04a navigation2d/runner.ts through its own record()/entities() path. Consume the reviewed source payload contract and handoff below; do not duplicate the R2a coffee ledger path or fabricate business cup ownership.

B02b Lab pin compatibility commit5770521 added engineVersionOf explicit MuJoCo branch, while temporarily keeping NAVIGATION_PROVIDERS=['irsim_2d','webots_3d']; tests/unit/navigation2d-report.test.ts asserts mobile evidence stays unsupported at that intermediate stage. B04 now owns full admission: update that temporary test to assert correctly validated MuJoCo identity, metrics and rendering, plus unknown-engine refusal. Do not preserve temporary unsupported UI after building the required mobile preset. Lab RunReport in src/scenarios/controls.ts is a handwritten mirror of source report.ts; B03 already added its optional physics block. Extend it only for any genuinely new B04a fields, with matching closed import validation; generated shared schemas alone do not update this interface.

PhysicsEvidence profile identities are the exact admitted profile file-byte SHA256s from the engine refs (not profile.digest or numericalInputsDigest). B03 brief/report documents this contract ruling. Campaign/reader/browser comparisons must use the same identities; still validate each profile document digest separately.

B03 interval metric convention: aggregate contacts/durations exclude raw tick0 priming and cover(0,lastTick]; raw tick0 remains initial observation, initial pose/slipbaseline/max tilt may includeit. Tick0-only interval metricisunavailable. Preserve the producer window labels ratherthan reinterpretingasN+1logicalintervals.

## UI/UX preflight (controller, 2026-11-14)

Applied ui-ux-pro-max to targeted concerns, not a new design system: Lab package pins vanilla TypeScript/Vite and Three0.180.0; existing styles/main.css uses brand tokens, dark shell, visible focus and44px controls. Preserve that design. Historical twin screenshot reviewed at docs/implementation/evidence/sim-extension-r2a/regression/brand-ui/lab-twin-1512.png is a disconnected mock/proxy scene, useful only for layout—not proof of current payload rendering. B04b must capture its own actual provider screenshots.

- Payload cup can be visually tiny in whole-floor view; keep a clear way to frame the AMR/tray/load using the existing fit/selection affordance. Inspect actual screenshot legibility at390/desktop, not only canvas presence or DOM pass. Do not change physical dimensions for visibility. General automatic phase camera remains B07.
- New selection/inspector/timeline actions must be usable through tap/click and keyboard; do not make orbit drag the only route to understand a payload. W3C distinguishes non-drag pointer alternatives from keyboard support: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html . Keep existing touch navigation exit and native page scroll behavior.
- Use existing freeOne/resource lifecycle at viewer/twin3d.ts126 and shared-arm geometry convention. Added payload geometry/materials must not accumulate across run/profile/replay swaps; do not dispose shared resources still owned elsewhere. Skill's Three guidance refers to0.185.1, but applicable disposal rule was verified against pinned r180 manual: https://raw.githubusercontent.com/mrdoob/three.js/r180/manual/en/cleanup.html . Do not upgrade Three or copy unrelated CapsuleGeometry advice.
- Meters/radians and reason codes belong in Details/Inspector where useful; default story shows payload/load, run state, time, issue. Labels and metric unavailable reasons must remain readable in VI/JA/EN. Color supplements text and shapes; no force vector when corresponding stream is unavailable.

B03 consumer handoff (reviewed sourcef0fb70f /Lab989632a): Lab alreadyadds PhysicsReportBlock in controls.ts and optional block validation in report-shape.ts, syncing the existing physics-evidence-v1 schema. Consume/reuse this reviewed seam; B04b owns full mobileprovider admission, actualgeometry/telemetry validation and display/replay, not a duplicate optionalblocktype. Read finalB03report/commit beforeediting.

B04a coverage ruling now requires actualcupfall proof (supplement to18originalcases unless one alreadyfalls naturally). Consume its finalnamedserver-ownedstress/perturbation ID if exposed; neverbrowser forcevectors orledgerdrop. Inspectactualfallframe and reportreason; fullfaultselectorAPI/handoff comes fromreviewedB04a report.

## Current B04a handoff preflight (confirm against final reviewed report)
At the B04a implementation snapshot the closed registry is simulation3d/payload-experiments.ts: payload-empty-v1, payload-center-v1, payload-offset-v1, payload-slow-v1, payload-fast-v1, payload-friction-low-v1, payload-friction-high-v1. These are seven complete registered experiments, not arbitrary independently combinable load/speed/friction controls. Use one clear experiment selector or constrain combinations to actual registered IDs; changing selection creates a new project/bundle/run. Baseline linear/angular caps .5/1, slow .2/.4, fast1/2; friction variants change the default geom sliding parameter .6 to .3/.9 and have their own locks; this is not an assertion that the effective floor-wheel coefficient takes those values. Final report/registry is authoritative if corrected in review.

TwinPayloadState carries payloadKind:'free', propId, supportId, loadProfileSha256, sceneDigest, admitted geometry, positionM and quaternionXyzw, on entityId payload:<propId>; normal robot and payload telemetry share committed tick/sequence but own entity identity. The server-only cup impulse and braking-tail policy are campaign-only inputs at present, not browser options. Normal user cancellation may legitimately leave stopDistance unavailable because it closes after the first observed stop; do not fabricate a complete hold window or silently turn every UI cancel into the campaign policy. Label the reason clearly.

B04 visible-fault proof may use the actual B04a recorded cup-fall report/telemetry through the validated read-only import/replay path; show the correct object/tick and observed fall/reason, not a synthetic renderer fixture labelled engine evidence. The ordinary browser run still exercises the actual live provider. Full offline catalogue and live selectable stress preset belong to B07. Campaign-only launch options are not silently exposed as arbitrary browser inputs. If source lacks a necessary read/import seam, report the concrete gap before a scoped fix.

## Launcher integration preflight
Lab scripts/start-irsim.mjs currently documents/provisions MuJoCo arm-only: MUJOCO_BACKEND=mujoco_arm, readiness checks only arm, prepareMujoco adds --mujoco-python/worker/lock but no engineering catalog/compiler args (roughly lines130–139). B04b must wire the actual engineering mobile path and verify its required pinned portable tools/Python before claiming readiness. Preserve the existing arm-only path when optional engineering prerequisites are absent; do not silently make a previously valid R2a launcher unusable or advertise mobile without a usable compiler/catalog. New mobile browser checks must use the correct selected path.

The test wrapper scripts/test-irsim-e2e.mjs currently compares a global pgrep worker list before/after; it does not kill matched workers. It may falsely attribute an unrelated new process to this test. Keep native tests serialized and never treat that match as kill authorization. If touching cleanup or if interference arises, scope any assertion/cleanup to the launcher's exact owned run root and process identity, following B00R's ownership rule. Existing untouched services remain outside scope.

## Final B04a metric/material semantics
The actual final B04a report documents max-friction mixing: floor stays0.8, cup stays0.6; low default geom input0.3 is masked at those contacts, while high0.9 can alter effective contact behavior. Do not label the low preset “slippery floor” or promise visibly more slip. Show it as a named material-parameter experiment, with the masking limitation accessible in Details; B08 reports observed effects, including none. Baseline/low finalcase both3443 is consistent with that limitation. Official pinned-version contact rule: https://mujoco.readthedocs.io/en/3.17.0/modeling.html#contact-parameters (equal priority uses component-wise maximum; explicit contact pairs override geom inputs).

B03 stopDistance starts when the plant receives an actual zero target after the controller's ramp, not at the browser cancel click. Keep that exact window in metric help/Details; it is not total reaction-plus-ramp stopping distance. Normal cancel may lack the five-sample window; campaign brake slow/fast add the registered tail. No metric definition or value is changed by UI labelling.

## Reviewed starting point
B04a is independently spec-compliant/quality-approved at source681b8adb8ed473f7195062773b23fabc3b922cd5 /Labcbeb5817cd65d53182aa080df3e566ad656d4945. Read task-B04a-report.md for exact typed/API/export/experiment handoff. Final real campaign /tmp/mekoniq-b04a-final-681b8ad-20261114-0954 has19/19 independently verified cases, including actual cup-fall at520; verification leaves1643paths/1453files unchanged. Report/schema inspection and recorded fault replay need no campaign rerun. Export /tmp/mekoniq-b04a-681b8ad-export-20261114-0954 is already imported/pinned. B04b should not repeat72variantprobes or19casecampaign without a new numerical/runtime concern.

## Controller ruling — paused cancellation observation
Actual browser testing found that cancel while paused leaves the Source clock paused, so cancellation remains pending and the physical world/slot is still owned. The payload UI may journal cancel first, then resume only that run's clock and drive bounded observation steps until Source confirms cancelled/attention. This is a simulation UI action, not a new controller/completion policy; no campaign tail or metric changes. Guard current run/view epoch and writer access across every await, ignore late responses, stop on errors/unknown/attention/budget or a subsequent explicit user pause, and never locally mark terminal or claim capacity released. Keep the pending/attention explanation if Source has not closed. Test pausedcancel and interruption/stale-epoch paths; preserve existing other-provider controls.

## Controller ruling — initial payload clock
Self-review found that shared create() inherits an automatic unpaced250-tick (+5s) bootstrap from legacy stepped presets. For mujoco-payload only, begin at committed tick0 and wait for explicit user Play at the selected default1x or explicit step action. Preserve declared native priming and all other presets. Test that create does not issue a step, then prove initial render and the affected Play/stop/replay journey through the actual provider. Earlier captures remain development evidence; final capture identities must describe the corrected path.
