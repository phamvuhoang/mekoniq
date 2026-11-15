# SDD ledger — plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/README.md

## Latest resume index
Read [current-state.md](current-state.md) first for the active agent, reviewed tuple and remaining sequence; the rest of this file retains historical setup and rulings.

## Workspace and authorization
- User requested implementation on new worktrees; continuing 2026-11-14.
- Source worktree: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source @ 086121c73afcdb08240c393dcd87a6f1de861b58.
- Lab worktree: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab @ 8c5db25; original pin bb16724859ee8377be62389a851ac36ea4a0309a.
- Branch in both repos: codex/web-lab-to-physical. Original checkouts untouched.
- Ruling: Native create_worktree failed because workspace root is not a repo and tool has no repo parameter; use paired Git worktrees outside both repos — avoids modifying main .gitignore.
- Ruling: task-brief script only supports numeric headings, but plan uses B/L IDs; extracted exact task sections with a local regex — no requirements modified.
- Ruling: source/Lab documentation commits after recording do not invalidate recorded runtime identity; preserve both identities and verify candidate before changes.
- Ruling: user authorized implementation supersedes doc-authoring restriction; qualification tested, accepted:false remains explicit. No acceptance fabricated.
- Ruling: no Linux host/hardware provided; complete portable implementation and prepared tooling, record unavailable native execution without claiming gates.

## Per-task preflight
| Task | Checked consistency / ruling |
|---|---|
| B00 | Qualification now exists; recorded runtime bb16724 vs documentation HEAD 086121c must be distinguished. |
| B01 | Schema mass/provenance shape matches tests; semantic validation required beyond JSON types. |
| B02 | Finite servo and separate braking cap; full engine tests need own Python venv. |
| B03 | Tick commit follows durable append; no engine retry after append failure. |
| B04 | 18 campaign runs count expected faults as detected tests, not false delivered orders. |
| B05 | Factory interface from spec; one world, no mock arrival overwrite; helper alone is not lifecycle integration. |
| B06 | Phase contact whitelist and continuous prop; 10/25 tick windows must invalidate gaps. |
| B07 | Replay transport denial and file integrity; no physics from animation. |
| B08 | compareRuns unchanged; semantic study cannot inherit non-equivalent old reports. |
| B09 | Single writer ownership vs many concurrent SSE requests; no automatic public deployment. |
| B10 | Raw cases required; full qualification waits for all local gates and clean tuples. |
| L00 | prepared is not native qualified; platform linux alone insufficient provenance. |
| L01 | No native amd64 host supplied; implement probe, keep native verdict not_run until actual host. |
| L02 | No Linux supplied; engineering factory can be prepared, native outcomes cannot be fabricated. |
| L03 | Fake/native/contact distinct; not all G2 plugins known supported. |
| L04 | Separate Debian CNC lane; no physical HAL; unknown installed packages not pinned arbitrarily. |
| L05 | Undecided target schema valid, live readiness remains incomplete; no signature bypass. |
| L06 | Profile-specific required cases, missing host affects only dependent native gates. |

## Shared interfaces/files preflight
| Producer / consumer | Shared surface | Finding / sequencing |
|---|---|---|
| B00 / B10 | Baseline identity/qualification | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B00 / L00 | Baseline identity/qualification | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B00 / L06 | Baseline identity/qualification | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / B02 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / B03 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / B05 | schemas + generate-contracts; MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / B06 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / B07 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / B08 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / L00 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / L01 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B01 / L05 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B02 / B03 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B02 / B04 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B02 / B05 | MuJoCo session/snapshot + physical model; provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B02 / B06 | MuJoCo session/snapshot + physical model; provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B02 / L01 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B02 / L02 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B02 / L03 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B03 / B04 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B03 / B05 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B03 / B06 | MuJoCo session/snapshot + physical model; physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B03 / B07 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B03 / B08 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B03 / B10 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B03 / L01 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B04 / B05 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B04 / B06 | provider/catalog/readiness/scenario wiring; physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B04 / B07 | physics evidence/metrics readers; Lab viewer/reports/presets | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B04 / B08 | physics evidence/metrics readers; Lab viewer/reports/presets | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B04 / B10 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B04 / L02 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B04 / L03 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / B06 | MuJoCo session/snapshot + physical model; provider/catalog/readiness/scenario wiring; world ports, source lifecycle, coffee observations | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / B07 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / B08 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / L00 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / L01 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / L02 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / L03 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B05 / L05 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B06 / B07 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B06 / B08 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B06 / B10 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B06 / L01 | MuJoCo session/snapshot + physical model | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B06 / L02 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B06 / L03 | provider/catalog/readiness/scenario wiring | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B07 / B08 | schemas + generate-contracts; physics evidence/metrics readers; Lab viewer/reports/presets | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B07 / B10 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B07 / L00 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B07 / L05 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B08 / B10 | physics evidence/metrics readers | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B08 / L00 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B08 / L05 | schemas + generate-contracts | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B09 / L01 | container closures/persistence/host probes | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B10 / L00 | Baseline identity/qualification | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| B10 / L06 | Baseline identity/qualification | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L00 / L02 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L00 / L03 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L00 / L04 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L00 / L05 | schemas + generate-contracts; commissioning prerequisites | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L00 / L06 | Baseline identity/qualification; native lifecycle/profile inventory; commissioning prerequisites | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L02 / L03 | provider/catalog/readiness/scenario wiring; native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L02 / L04 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L02 / L06 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L03 / L04 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L03 / L06 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L04 / L06 | native lifecycle/profile inventory | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |
| L05 / L06 | commissioning prerequisites | Serialize mutations; later task consumes versioned producer contract, preserve legacy branch and tests. |

## Progress
- Setup: worktrees created; dependencies installed; baseline tests running.
- Task B00: pending; candidate located and 7 local gates tested, Cloud Run blocked_external.

- Baseline verification: source R2a acceptance 12/12; source mock/capability/schema 18/18; Lab unit 426/426; MuJoCo Python 43/43 (9.61s); contracts:check passed.
- Setup: independent .venv-mujoco/.venv-irsim/.venv-webots/.venv-linkforge installed from hashes; algorithm install in progress. No symlink to mutable main environments.
- Ruling: recorded source bb16724 and documentation HEAD 086121c have different portable closure (MuJoCo README); export and re-pin worktree after B00, never mutate qualification identity or main pin.
- Task B00: in_progress with /root/b00_baseline.

Task B00: complete (commits 086121c..e137b57, review clean by /root/review_b00). Fresh worktree export /tmp/mekoniq-r2b-baseline-e137b57-20261114 installed; pnpm check:source passed, Lab pin commit recorded next in git log. Accepted remains false.
Task B01: in_progress next; source BASE e137b57.

- Task B01 implementer: /root/b01_payload_contracts, source BASE e137b57, Lab BASE09dec0a. Ruling: minimal Lab Ajv registration belongs to B01 contract compatibility; implementer now owns both worktrees for this task and handles source commit → clean export → Lab import/sync/check/unit → Lab commit. Controller will review both diffs. Main checkouts remain read-only.
- Baseline original ports4175/4176 had no listeners when inspected. Recheck before any browser launcher; do not kill unrelated processes.
- All five portable venvs provisioned successfully from requirements.lock with hashes.

Ruling: MuJoCo engine.timestepMs is the substep duration (2), substeps=10, logical scene.clock.tickMs=20. Align mobile with existing arm convention, check cross-field product; B01 implementer notified.

Task B01: complete. Source 26199b8e3cddb3bb7b21b52a7e2c004d89b7ced6; Lab 1604e05fc5e74c1abac2279efc9dd29f4a7f1c24. Review /root/review_b01: spec compliant, Approved, no findings; checked fixture copied bytes, manifest/scene hashes and call sites. Implementer evidence: source 129 + Lab 426 + MuJoCo 25 + Webots 26 tests; contracts/typecheck/lint and clean export/check:source pass. Accepted remains false.
Ruling: split B02 into sequential B02a (real Python mobile compiler/worker + bounded dynamics probe/lock) and B02b (TypeScript compiler/provider/readiness/slot/catalog integration). This is a review boundary, not a scope reduction; parent B02 remains incomplete until both pass review. B02a source commit is exported/re-pinned by controller after review before B02b. No mobile capability is advertised by B02a.

- B03 preflight: legacy nav append is buffered, so awaiting append alone does not meet new durable-before-logical-commit requirement. New physics path must fsync observations (bounded internal WAL is acceptable), seal immutable chunks and make unpublished crash tail explicit. Do not mutate legacy format or evade 2,000 chunks/stream. Task brief now notes this and combined quota/report compatibility checks.

- Tool preflight: direct `node scripts/doctor.mjs` passed Node24/docker/python3/java/supabase on 2026-11-14; `pnpm doctor` is a pnpm builtin and returned silently, not script evidence. Webots executable reported R2025a. Use `pnpm run doctor` or direct script.
- B02 research checked primary versioned MuJoCo3.17 docs: modeling.html#contact-parameters (friction max unless explicit/priority), programming/simulation.html#contacts (transposed contact frame), XMLreference.html#contact-pair (force geom1→geom2), actuator velocity kv/forcerange. Links sent to implementer for spike provenance; runtime pin unchanged.

- B02a implementer checkpoint (pending independent review): 36 real MuJoCo probe runs (4 cases ×3 loads ×3 repeats) finite; claimed repeat position delta0, quaternion-angle max9.9e-8rad; max cup displacement4.41mm, tilt9.64e-4rad; circle wheel odometry residual0.137m/0.270rad preserved as observed. Gain2/brake6/curve unchanged, profile lock in progress. Controller requested per-tick repeat validation, strict session negatives and full arm regression before commit.
- Sequencing ruling for final evidence: finish all runtime/schema changes for prepared R3 lanes before the final shared source/Lab qualification recording. B10/L06 tooling can be implemented/reviewed sequentially, then one final clean tuple records R2b and prepared/native-not_run scopes. Do not run a costly full qualification then invalidate its runtime tuple by L00/L05 schema changes. Web functionality remains first priority (B02–B09 before R3 prep). Native cases still require actual host and remain not_run here.

Environment correction: B01 generated runtime export relocated intact on 2026-11-14 from ignored .superpowers/sdd/01-r2b-mobility/evidence-B01/runtime-export to /tmp/mekoniq-r2b-b01-export-26199b8-20261114. ESLint walks dot directories despite Git ignore and was linting bundled dependencies; source lint remains unchanged. All future full runtime exports go outside both repos; reports/logs stay in plan workspace.

Task B02a: in_review. Source BASE26199b8 → b647429a993215f5167bd30fa6ea0f30dcde65a0, clean. Implementer /root/b02a_mobile_engine DONE_WITH_CONCERNS limited to measured caster/odometry and downstream scope. Final83 Python(40 mobile),24 TS(4 files),contracts/typecheck/lint pass; final36 locked probes close every-tick model/scene/profile hashes and repeat. Initial36 exploratory probes preserved but explicitly inadmissible, not used for lock. Reviewer /root/review_b02a (gpt-6-astra high) has brief/report/diff; no Lab pin until review clean.

B02a review /root/review_b02a: Needs fixes, one Important finding. Missing/ambiguous projected LiDAR IDs are resolved only by scan() after create priming; unknown-lidar reached time0.02/tick0 then WORKER_FAILED/StopIteration. Fix round1 dispatched to original /root/b02a_mobile_engine: resolve typed sensor ref before engine construction/mutation, TDD negative factory/clock check; no numerical/probe input changes. No other findings confirmed. No Lab pin until scoped re-review clean.

B02a fix round1: source eef984e7b71ab68f67eda2d9c8d15b0f6c26d0dc, scoped re-review sent to /root/review_b02a with review-b647429..eef984e.diff. Four sensor-reference RED→GREEN cases;69 mobile/session +3 isolated arm-worker pass. Input/probe/fixture/engine pin bytes unchanged. Testing sequencing note: arm-worker cleanup uses global pgrep; running Python worker tests concurrently can trigger it. Run Python-worker and TS process-cleanup suites sequentially; resolved overlap is not a product bug.

B02a fix round1/5: 1 addressed, 0 open; commits b647429..eef984e. Scoped review /root/review_b02a Approved, no new defects; spec and quality gate clear. Controller clean export /tmp/mekoniq-r2b-b02a-export-eef984e-20261114 imported; check:source and Lab typecheck passed. Lab pin validation underway.

Task B02a: complete (source 26199b8..eef984e, review clean after one fix round; Lab cef5b6c29382e542678370b9a0da69d5f8c95351). Clean export/import/check:source and Lab typecheck +14 focused launcher/coffee tests pass. Artifact17cb03ce5c986ab169ad6063c60d9ffd025e2224840ba723acac92945d24a5fb, portableTools2ac07cfc9233940e805ef7cf28d311c4b8ccd85a314d3475371bc63292e4ff9b. Parent B02 remains in_progress. B02b BASE eef984e7b71ab68f67eda2d9c8d15b0f6c26d0dc, Lab cef5b6c; fresh implementation dispatch next.

Ruling: B02b uses a separate hashed mobile observation policy with tilt pi/4, height sanity -0.6/+4 radii and 0.10m relative load drop sustained5ticks; locked numerical inputs stay unchanged — no numeric stop values were specified and Webots tilt should not govern new tipping experiments — if unsuitable, revise registered policy identity and rerun affected campaigns, never reinterpret previous evidence. Implementer /root/b02b_mobile_provider owns B02b from eef984e; root handles reviewed export/pin.

- B03 preflight: schema broad maxima require semantic profile-aware caps; empty contacts can mean actual airborne state, not missing stream. New reader needs completeness derived from stored validated data, not manifest boolean. B09 Docker preflight available via OrbStack aarch64Linux10CPU/8GB; local VM only. Briefs updated.

- R3 read-only research via official GitHub connector: Jazzy d837f2e17f7f36043103b367fca3af8172626245 + SDK gitlink f36794320a285c0b4bf1cd8ef181cbff6e3b794a; source snapshots and content hashes saved beside L03 brief. Generic launch defaults classic/G1 while xarm6 wrapper selects gz; mimic declarations remain, so motion/contact scopes must remain distinct. No native qualification inferred. B10 copied-doc link rebasing noted.

B02b integration finding: existing navigation recorder requires scan.tick==snapshot.tick; MuJoCo correctly caches LiDAR at 5-tick cadence. New provider-scoped admission must require exactly floor(snapshot.tick/publishEveryTicks)*publishEveryTicks with original matching sample time/IDs, record only publications, reject stale/future/missing next publication. Legacy branch unchanged. Implementer notified; B03 consumes this seam.

- L04 primary-source preflight: LinuxCNC2.9 Python API differentiates Cartesian actual_position and joint values; cycle_time is a period, echo_serial_number a command acknowledgement, neither a sample timestamp. L04 brief now warns against fabricated controller clocks and points to existing inch/degree/SI conversion/model contract.

Ruling: mobile command acceleration ramps from previous sent command, not near-zero measured velocity — actual MuJoCo trace proves the old ramp is trapped below static-friction breakaway (NO_PROGRESS tick493), while direct probes move normally — if the command policy needs further adjustment, version/requalify it; preserve actual velocity checks and legacy defaults, never retune locked physics to conceal a controller defect.

B02b implementer checkpoint (not yet independently reviewed): previous-sent command ramp completed real MJ-FD01 seed7 at tick3443, served1, unchanged physics. SQLite Robot.Observe journal uses mujoco_serve_diff_drive; public journal intentionally reduced. Navigation report validates explicit engine/seed/stop/controller/profile refs. Edge/lifecycle/broad regression and research note underway.

- L03 source provenance check:21/21 imported R2a xArm source files match native Jazzy candidate Git blobs after localSHA256 verification. Adjacent research-xarm-model-source-parity-20261114.json records per-file hashes. This reduces model-source drift risk but is not expanded-URDF or native qualification.

B02b verification checkpoint (implementer report pending):4files/32focused mobile+arm-port pass; real MJ-FD01 seed7 completes tick3443 with reproducible trajectory/sensor/assertion digests. Typecheck/lint/contracts/CLI import-help pass. One broad regression running; discovered arm-only flag-on unavailable-env advertised MJ-FD01 without engineering. Fix scopes mobile scenario offering to live mobile capability while preserving R2a list. Sequential Python suite + selfreview/commit remain.

- B04 preflight: current B02b compiler exact-baselineSHA and Python probeId const intentionally block unregistered friction variants. B04 owns additive server-owned experiment admission and per-variant frozen/probed identity; never mislabel changed friction as b02a-locked. Baseline byte artifacts remain immutable.

Ruling: add sequential B00R baseline refresh after reviewed B02b/pin, before B03 — original main advanced with material R2a arm/gateway and recorder/native-identity fixes while qualification runs; user requested latest implementation and isolation — merge frozen source4f893ac6fb75dff414a3ee42a726defb7935c734/Lab a6ec316fb3ac2f71afff25e6fa77e931f4439e00 only into feature worktrees, resolve overlaps and verify/re-pin. Cost if wrong: isolated merge can be reverted, affected integration tests/campaigns rerun. Original checkouts/processes remain read-only. Brief task-B00R prepared, pending B02b gate.

Task B02b: in_review, source eef984e..3e0c60e4b57fd78b0c007a5361c6b85448c42e69 clean; /root/review_b02b (gpt-6-astra high) receives task brief/report and205735-byte review package. Broad771pass/3fixed targeted failures; previously skipped portable compile/serve/refuse-native case now1passed with existing .venv-irsim PATH (classification corrected), Python87pass, contracts/typecheck/lint pass. Original implementation agent /root/b02b_mobile_provider retained for fix rounds. No Lab pin until gate clear; then B00R frozen-upstream integration before B03.

B02b review1: spec issues found/Needs fixes. Important2: mobile stop monitor after adapter observation can confirm cancel using missing physics; uncertain create/start ACK failure permits same-run respawn. Controller verified paths; fixround1/5 dispatched to /root/b02b_mobile_provider with focused runner/reopen tests, legacy behavior preserved. Minor(deferred): stale worker README52 future-provider wording; B00R will correct. No export/pin until scoped re-review clean.

B02b fixround1 checkpoint: real runner response injection reproduced missing/clock-invalid physics converting accepted→cancelled; monitor moved ahead of observer/drain/valid telemetry and both regression cases GREEN. Startup fix design persists mobile create-pending latch before request; unknown create/start or pending reopen becomes STARTUP_UNKNOWN, no new same-run spawn. Controller cautioned ask() labels every explicit !ok response not_sent, so only phase-aware narrow known pre-mutation codes may clear latch; numerical/priming failures remain unknown. Tests will drop real create/start responses and count spawn across reopen.

B02b fixround1 checkpoint:9 new real-runner lifecycle cases GREEN(11.27s): missing/bad-clock physics during cancel stays unknown; lost create/start ACK prevents same-run/reopen spawn; persisted pre-create crash latch; post-priming PLANT_UNSTABLE/CONTACT_CAPACITY_EXCEEDED terminal; pre-mutation schema refusal permits later retry; slot held through close. New explicit mobile PlantPort.startupPolicy and optional cp.plant.startupAttempt. Typecheck pass; targeted mobile/IR-SIM recovery/Webots faults/arm worker+ports regression/lint underway. No Python/profile changes.

Read-only upstream refresh01:59Z: original source main11d25b47a18adafb88ac21adc249499109996bc5 /Labmaina7449541e118d01f65af0ad1466e0c963a173f3c, four sourcecommits afterfrozen4f893ac. Runtime/packages/robotics unchanged; newCloudRunqualificationguard414cee2 +docs/evidence/demo/envexample. Cloud supplement actualnativeamd64MJ-BV01completed4800,productionChrome4810served2 atpin4f893ac; acceptedfalse and noR3caseclosure. Noexternalcall/secrets/productionmutation. Existingmainauthorizations recorded inartifact are historical and not treated as this task deploymentpermission. GTMagent refreshinglocalclaims; R3briefsupdated.
Ruling: integrate this frozen upstream source11d25b4/Laba744954 after B09 and before L00/finalqualification as B00R2, in featureworktreesonly, with scopedcloudguard/docs merge review and clean export/pin. No active B04 edits interrupted; oldbaseline numerical/runtime bytes unchanged. Costifwrong: one extra merge/export/review and possible recorder conflicts; avoids stale host claims and keeps finalbranch aligned with current R2a production evidence without chasing movingmain.

Current progress pointer 2026-11-14T03:56Z: subsequent B00R/B03/B04a completion and B04b independent review are recorded in ../01-r2b-mobility/progress.md and ../progress.md. Current source681b8ad/Lab81d619d clean; parent B04 waits for B04b review, then B05. This setup ledger's earlier B02b entries are historical, not current pending work.

B05 completed and independentlyapproved afterR1recordererror-pathfixes, Source9f68476/Labda6f608; productiontwo-slotphysicalrig10/10,Sourcefactory/commit/recovery/slotimplemented, nofullcustodyclaim. B06nowactive forSource-correlatedserved2 andfaultworkflow. Per-task02ledger/report/review2holdexactevidence/rulings; B04/B05minorspreservedindeferredindex.

Execution update: B07 split recorded in02-r2b-cell-and-web/progress.md as B07a→B07b after B06 review; brief files prepared, not yet dispatched. Remaining sequence B06→B07a→B07b→B08→B09→B00R2→L00–L05→B10tooling/review→L06tooling/review→finalclean-tuplequalification→wholebranchreview.

B07 COMPLETE2026-11-15: task-B07b-review-2.md independently closesI1/I2/R72 atSourcee07685d/Labc20108c; no newImportant. Scopedfix/sourcepin verified. B08next; performanceD0/B10/externalgatesstillopen. Final390stripecauseunknown recordedB10, notclaimedvalidatedaway.

Rootfuturepreparation2026-11-15: B09/B00R2/L00/L01/L02 dispatch drafts prepared with explicitpendingbases/dependencyhandoffs; notdispatched. Existingbriefs read and old host/cloud/lock semantics preserved. Activeengineering remains B08 only.

Rootfuturepreparation: L03/L04/L05briefsread and dispatchdraftsprepared pendingbases/producerhandoffs. ExistingcontrollerJazzyandLinuxCNCprimaryresearch retained; no newresearchclaim/nativeexecution. L05ES256/JCSboundaryexplicit. Allfuturetasksstillpending; B08soleactive.

2026-11-15: B08 complete after full review and two scoped fix reviews. Final Source714e37f/Lab4741edf clean; I1 closed, MinorM1 deferred. Actual three-engine producer709a797 and pure consumer-validator714e37f identities kept distinct. Next B09 from this reviewed tuple; see02/task-B08-review-3.md and02/progress.md.

2026-11-15: B09 implementation complete/reviewed after1fixround, Source3c917ceee6a92c6b087f0bd37baaa4e0740d44a8/Lab538ba452c81005010a479f337aab0edbad6e5159. I1/I2closed, R63publicclose/R74authority/R75reclaimchecked; WEB05image/container remainsnot_run/blocked_environment underR76 andB10. NextB00R2 frozenupstreammerge, thenL00–L05/tooling/finalqualification.

Task B00R2: complete (Source3c917ce..d0f30749c0ddb474f0844c68be63a6f0fa4b1933; Lab538ba45..176bf348b6a839037473cc6d87413093ed17ff54; independent review1 PASS spec/PASS quality, no C/I/M). Root read full report. Cannot-verify items resolved: inherited tick semantics/external execution are intentionally historical/provenance-only underR77; current cloud/external prices/authorizations are dated retained claims and no new executionauthorization; tests-first chronology belongs imported upstream and no newruntime behavior was authored; newR2b/container/native/hardware/TLS/acceptance are explicitly open/outsideB00R2, not missing taskrequirements. Recorded actual24+1checks and cleanexport/pin inspected. No extra run needed. R77rawdecisionaudit81/81 exact/no missing-extra,77human entries. L00next.

Task L00: fix round 1/5 complete (2 addressed, 0 open; scoped review2 PASS, no new C/I/M). Root read complete review2 and its evidence/limits. Important L00-R1-01 OCI structural admission and L00-R1-02 effective checker checkout binding are both addressed. Full task review1 plus scoped review2 close this task; supplied host consistency is not origin authenticity or native execution, and external native/WEB05/hardware gates remain outside L00. No unresolved Cannot-verify task requirement. Original BASE Source d0f30749c0ddb474f0844c68be63a6f0fa4b1933 / Lab 176bf348b6a839037473cc6d87413093ed17ff54.
Task L00: complete (Source d0f3074..298db9bdbc207b14bdbef78ec8d70adf4e901c71; Lab 176bf34..7698aa628fc9a60598d1337b292bdcec2fe91fdc, review clean). Root verified clean heads, final115focused tests/contracts/types/lint/export/pin and239refs/10724081B handoff audit; root-L00-r1-handoff.json and task-L00-report.md retain all failed attempts and prior identities. The nonblocking inventory-negative precision observation remains in deferred-findings.md for final triage.
Task L01: active /root/l01_mujoco_native_probe (gpt-6-astra/high/fork_none). Original BASE Source 298db9bdbc207b14bdbef78ec8d70adf4e901c71 / Lab 7698aa628fc9a60598d1337b292bdcec2fe91fdc, both clean. Dispatch filled and sent; R81 exact historical arm-only adapter plus executable native probe tooling. No assigned Linux host and no Docker retry before finalB10 underR76; native results stay not_run/blocked_external. One implementer only; L02 follows independent L01 review.

Task L01: fix round 1/5 complete (4 addressed, 1 new Important open — L01-R2-01 final successful HTTP request state not persisted before strict raw-summary comparison; Source2f4837d..eeea18d/Lab69032d5..e8577a5). Full scoped review2 read; no Critical or other Important. Native stays not_run. Fix2/5 resumes original implementer from clean Sourceeeea18db88485e113aafe1cc15edd7f75ced2b66/Labe8577a5b7f4f6b615aa333b3f86126d06e1f0c05; fix-L01-r2-dispatch.md contains verbatim finding. Report prefix 40356B SHAb1f75fc143850247ef313541b352f9909c71a12adcc9c95f71c5de8fdf64a878 preserved before append. No new ruling: implementation defect. No L02 before scoped fix2 gate.

Task L01: fix2 SCOPED REVIEW READY. Rootreadfull50317Breport including9961Bappend;52portabletests/Source types+lint/Labpin+types passed oncheckedtree6a59ef54=Source874d05aedfbf573496994fd73016f19ef19e6932;Lab4a207b43c613cf0c1226a9ff3c1990a96ec5ac08clean. Sourcefixpackage19832B SHA714c10d87b882ea4c83e1ed5e8217d358c773fa8dac80e5ed7a2deffcf59869d;Lab3433B SHA8a507355a4f73a8509575b17af5cce7475237491db1b17eb2101eea88c884999. root-L01-r2-handoff/byteaudit verified184refs,6oldartifactsets,51+27+28logs/reportprefix40356B. Newhandoff /tmp/mekoniq-L01-fix2-preparation-sQ7TjS/handoff manifestd0016f8d04d9a2d6446d4e94722ace768957e64f8ea5c4f0b478a3783afa406c;probe2fc0b0d0958a2e37eee60bd8b1bf957779c2df3aedb8da478e000a4710c94e5f16not_run. Export /tmp/mekoniq-L01-fix2-export-a4Clal/runtime artifact7230dcac101d3010a9580b22f9c5d1ded01b79c917a6e7dff9182a9f262f7013, schema/portableunchanged. Reviewer verifiesonlyL01-R2-01+fixbreakage;noL02beforeverdict.

Task L01: fix round 2/5 (1 addressed, 0 open — L01-R2-01 final request completion persistence; Sourceeeea18d..874d05a/Labe8577a5..4a207b4). Rootreadcomplete task-L01-review-3.md; scopedAPPROVE,no new Important/Critical/out-of-scope observations. Prior4Importantclosedinreview2. Native qualification remainsnot_run; MinorR1-05 deferredcentralindex/B10finaltriage.
Task L01: complete (commits Source298db9bdbc207b14bdbef78ec8d70adf4e901c71..874d05aedfbf573496994fd73016f19ef19e6932; Lab7698aa628fc9a60598d1337b292bdcec2fe91fdc..4a207b43c613cf0c1226a9ff3c1990a96ec5ac08, fulltaskreview +two scopedfixreviews clean, one deferredMinor). Tooling preparation complete, not native execution. Final52portabletests+types/lint/exportpin, full historical52/182/9 evidence notcombined. Newhandoff184refs/9648529Bpreparedtrue/nativeReadyfalse;16nativecasesnot_run. Fullreports/reviews/rootaudits retainedforB10.
Task L02: starting — originalBASE Source874d05aedfbf573496994fd73016f19ef19e6932/Lab4a207b43c613cf0c1226a9ff3c1990a96ec5ac08, bothclean. Fresh architecture implementer, actualengineeringGazeboNav2factory/nativeclock/lifecycle/evidence; no assignedLinuxhost, exact unresolved locks remainunresolved/nativeexecutionnot_run. No DockerretryR76. Dispatch implement-L02-dispatch.md, report task-L02-report.md.

Task L02: full task review READY. Sourcee6db696b2ac1266fdeede8c2a64521cd4064481a/Lab7652851fb9e92e560c70e4e6675b85fa5f445cf4 clean; originalBASE874d05a/4a207b4. Rootreadfull25692Breport inclverificationcorrection;127TS/74Python+laterfocused4,types/contracts/Labchecks; focusedlint actualownexit0 nowretained. Fulllint27preexistingerrors5files remainsB10followup. Rootaudited180native/237portable refs,57schema,exportcachepin,5Macpreflightnot_run records(nominalrequested3);runtime89686e95/native6643ae33/portable5c58ddfa. Fullpackages163998B/3528B, root-L02-handoff.json andevidenceindex86files. R85inbrief/spec; nativeactualnot_run. No L03 untilindependentfulltaskreviewgate.

Task L02: review1 CHANGESREQUIRED spec/quality,2Important L02-R1 relativecanonicalprojectpath resolves underwrongcompilercwd;L02-R2 cachedTF lacksdynamicfreshness detection. NoCritical/Minor. Rootreadfullreview;bothimplementationdefects,noplanconflict/newruling. Cannotverify1–6 remainrequirednativeexternalnot_run underexistingpreparationscope,including physicalreadback/actualbagreplay;7broadCI/finalreview scheduledB10/L06,fulllintlegacyconfigtracked. NeitherImportantexcused. Fix1/5 originalagent fromcleane6db696/7652851; reportprefix25692B SHA6fd0359cda1e0a09b24ecd73deb8fc2ac57bf1b40f7ad876ee400a123ac1e1c1 snapshotpreserved. NoL03beforefixgate.

Task L02: fix1 SCOPED REVIEW READY. Source00d41e7f25ec1294b9bc8e8c81de3d8e1a869316/Lab82b5f92005673c99ba0d1f434ae4c512800fa75eclean. Rootreadfull43670Breportincl17978Bappend,128TS/85Python+laterCLI1/types/lint andLabcheckswithownexitreceipts;86old/63newfiles+reportprefix+180native/237portable refs auditedroot-L02-r1-handoff.json. R2actualguardRED6fail13pass→GREEN85combined; R1publicCLIinitialGREENwithrealcompiler andrelative/absoluteargv, parserunchanged, disputedforindependentreconciliation. Packages26692B/3433B; fixedBASEe6db696/7652851. Newruntimefbca966393c5fdb0216c1e826d16aea133f4632ae7cee514a7de0d04825435c6/nativef7236fd861ea3fcdee0364b0a92425c19b06952283f86dd35c05cd3754ea3a59;portable/schemaunchanged. Export/tmp/l02-fix1-runtime-00d41e7-20261115,5nativepreflightsnot_run. NoL03untilscopedverdict.
