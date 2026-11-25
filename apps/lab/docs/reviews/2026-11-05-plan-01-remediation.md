# Plan 01 remediation — implementation and verification record

2026-11-05. Scope: R01–R12 from the [original review](2026-11-05-plan-01-code-review.md), the backup corruption test, and all 18 remaining Plan 01 software gaps under the [remediation plan](../plans/2026-11-05-digital-twin/04-plan-01-remediation.md). Implementation and final pinned-runtime regressions are complete: all 18 former software gaps have executed evidence, with no remaining software finding from the scoped reviews. R-MOCK remains unaccepted; the human/Linux/physical gates below are separate. This does not implement Plans 02/03.

## Final software evidence

| Item | Recorded result |
|---|---|
| Clean source and runtime revision | `c1d1ea70e42937d421070674f07d00edc7c41245` |
| Lab regression code baseline | `aa70d65fdb72f16b64ee7002fbb05c15ee1e690f`; subsequent documentation/evidence commits preserve the checked code hash |
| Runtime artifact SHA-256 | `21986126e1949d5f25d5af66952e664fa0c08cc3393de45287c8c64379f223f0` |
| Schema hash | `09a5a11b4b689628314ea1646eb6b683ffbb07f6dd6173a52935ddfa13579f48` |
| Full CI-equivalent regression | All 21 commands exit 0, no missing results. Source: unit 65 passed / 0 failed / 0 skipped; contracts 37 passed / 0 failed / 0 skipped; adapters 50 passed / 0 failed / 0 skipped; integration 689 passed / 0 failed / 1 skipped; Python 178 tests, 0 failures, 0 errors. Typecheck/lint/contracts check/build passed. Lab: 153 passed / 0 failed / 1 skipped; typecheck/build/source check passed. |
| Browser / renderer | All recorded UI, twin, mock, S01, immutable-input and offline journeys passed. 60-second desktop 3D and tablet 2D emulation both meet their declared frame/paint p95 limits. Actual 15/60 FPS and acknowledged renderer suspension are recorded separately. |
| Acceptance | 41 passed, 0 failed, 0 skipped. 106 rows: 96 pass, 4 unsupported physical fidelity, 5 requiring a human/device, 1 requiring Linux. Zero `NOT_IMPLEMENTED`. |
| Offline archive | `releases/mekoniq-lab-plan01-macos-arm64-c1d1ea7.tar.gz`, 40022790 bytes; SHA-256 `4f4f126d438a0bcb87246941b9b266cff9e47934cb67790a79589395f696cf81`; exact package boot check exit 0 |
| Renderer capture SHA-256 | `0518660e664f3d9d972eb992418ae8fe736b589b2f5b9566c9dfc206bb610751` |
| R-MOCK acceptance | **Not accepted**. Owner evidence review and external gates remain open. |

The installed runtime is identified by [`source-runtime.lock.json`](../../config/source-runtime.lock.json). The [compatibility snapshot](../../config/simulation-compatibility.json), [mock report](../implementation/evidence/digital-twin-v2/mock-report.md), [acceptance results](../implementation/evidence/digital-twin-v2/F08-test-results.json) and [regression manifest](../implementation/evidence/digital-twin-v2/regression/manifest.json) record exact revisions, commands, timestamps and checksums. All runs used Node 24.22.2 / pnpm 10.32.1; Python checks used 3.12.12 on the recorded macOS arm64 host. The full integration run includes clean-export coverage. Optional skipped measurements do not satisfy pass rows.

## R01–R12 behavior changes

| Review item | Implemented correction | Regression entry points |
|---|---|---|
| R01 | Persist absent-cup observations; invalidate pre-dispense verification; hold preparation/quality/transfer when evidence is missing. Safe empty-cup correction emits a fresh bound observation. | Source `coffee-review`, `coffee-policy`, `lab-v2-software-gaps` |
| R02 | Check arm readiness, fault and freshness before either transfer leg; rejected requests acquire no new lease/effect. | Source `coffee-review` |
| R03 | Count prepared coffee once; sequential cups of one order and valid remakes respect the quantity ledger. | Source `coffee-review`, `coffee-policy` |
| R04 | Reserve/consume repeated ingredient steps independently with job/step deduplication. Reject duplicate resource/allocation identities before admission. | Source `coffee-review`, `coffee-conservation`, `coffee-policy` |
| R05 | Manual coffee handoff atomically updates fulfillment, job, custody and leases; removed or pending-transfer cups refuse the entire handoff. | Source `coffee-review`, `coffee-conservation` |
| R06 | Localization loss stays latched while idle, moving or awaiting confirmation; commands cannot silently restore it. | Source `lab-v2-runtime-review` |
| R07 | Persist an independent publication sequence; same-tick action samples survive recording, stream cursors and replay. | Source `lab-v2-runtime-review`, `lab-v2-stream`; Lab `workspace-replay-freshness` |
| R08 | Rebuild replay cup/job/arm/measurement/served state at the selected time; filter plant and collision evidence; keep unavailable history explicit. | Lab `workspace-replay-freshness`, `report-replay`, `arm-scene-scope` |
| R09 | Repaint scene and inspector when freshness/link category changes with no new pose sample. | Lab `workspace-replay-freshness` |
| R10 | Correlate wait by mission/stop/allocation; partial, duplicate and cancelled confirmations have explicit treatment in both KPI implementations. | Source `lab-human-wait`; Lab `report-human-wait` |
| R11 | Measure footprint separation between robot pairs separately from wall clearance; one robot reports `SINGLE_ROBOT`. | Source `lab-v2-runtime-review`; both human-wait/KPI suites |
| R12 | Recheck authorization and close both open SSE streams at pairing expiry, releasing registrations. | Source `lab-v2-stream` |

Source remains authoritative for business state, inventory, custody and effects. Mock correction/reconciliation never fabricates native success or replays an uncertain irreversible command. The backup regression now changes a byte with XOR and asserts the mutation occurred; a unit check covers all 256 initial byte values. This fixes a deterministic weakness in the test injection without claiming every historical failure had the same cause.

## Eighteen former software gaps

The table records implemented behavior and its checks. Final pass rows belong to the regenerated acceptance evidence, not this implementation inventory. Test stems below refer to `.test.ts` under source `tests/integration` or Lab `tests/unit`, unless another location is named.

| Requirement | Implemented scope | Checks / artifact |
|---|---|---|
| QA-02b | Locked design/configuration/recipe/model/adapter/profile hashes and explicit uncalibrated provenance. | Source `lab-v2-software-gaps` |
| QA-09b | Immutable saved reports; model/world/recipe/profile scope staleness, including the declared arm profile. | Lab `report-evidence`; browser `twin-inputs.spec.ts` |
| FD02-cups | Identified food and coffee allocations share one mission with separate kitchen/cell loads and conserved custody. | Source `lab-v2-mixed` |
| BV02-capacity | Capacity/headspace admission includes declared ice displacement assumptions. | Source `coffee-policy` |
| BV04-outlier | Implausible measurements retain raw evidence and do not book invalid stock consumption. | Source `coffee-policy` |
| BV06-capacity | Cup/recipe capacity constraints checked before reservation/effects. | Source `coffee-policy` |
| BV07-timeout | Bounded transient-interlock and pickup waits preserve poured/unknown cup state. | Source `lab-v2-software-gaps` |
| BV08-milk-policy | Versioned batch/cold-handling evidence persists across reboot and gates preparation/quality. | Source `coffee-policy` |
| CAMPAIGN-FD02+FD07+BV01+BV03 | Versioned two-AMR food/coffee contention workload with two identified cups; queue/travel/human-wait/cell-busy KPIs. It ends after customer handoffs; parking is covered by separate scenarios. | Source `lab-v2-mixed`, `tests/unit/lab-process-metrics.test.ts`, `lab-v2-report` |
| ARM03 | Conservative capsule swept collision checks and declared project/AMR scene integration with bounded geometry evidence. | Source `lab-v2-arm-safety-model`, `lab-v2-arm-scene`; Lab `arm-scene-scope` |
| ARM05 | Modeled following-error/stop/E-stop states; reset preserves uncertain program and cup custody. | Source `lab-v2-arm-safety-model`, `lab-v2-arm-faults` |
| SYS01-render | Fixed-seed/fixed-step journal independence across measured 15/60 FPS and acknowledged CDP debugger suspension with zero draws; no OS background-tab policy claim. | Lab browser `twin-plan01.spec.ts`; [recorded renderer independence](../implementation/evidence/digital-twin-v2/plan01-render-independence.json) |
| SYS02-reclaim | Proof-protected durable reclaim; exact stored project/seed; view/reconcile fencing; explicit target selection for multiple robots. | Source `lab-v2-stream`, `lab-v2-reclaim-targets`; Lab `workspace-reclaim` |
| SYS03-reorder | Delay/reorder real observations while retaining identity and preventing duplicate serving/execution. | Source `lab-v2-software-gaps` |
| UX-05-reset-speed | New immutable run at tick zero; preserved old evidence; wall-clock pacing with fixed simulation steps. | Lab `workspace-replay-freshness`; browser `twin-inputs.spec.ts` |
| UX-18-speed | Explicit positive AMR speed limit up to 0.5 m/s reaches admission and plant without mutating the active run. | Source `lab-v2-software-gaps`; Lab `core-design-world`, `workspace-replay-freshness` |
| R-MOCK-offline-bundle | Platform-specific bundle includes Node, compiled UI dependencies, pinned runtime/schemas, lock and integrity inventory. | Lab `tests/integration/offline-bundle.test.ts`; `scripts/build-offline.mjs` |
| UI-perf-p95 | Rerunnable >=60 s actual-renderer capture for 2 AMRs, arm and six tables; desktop and emulated tablet 2D thresholds declared before capture. | `scripts/measure-twin-ui.mjs`; [final capture](../implementation/evidence/digital-twin-v2/plan01-ui-performance.json) |

Other corrected edges include repeat project migration, retry after synchronous IndexedDB open failure, bounded SSE reconnect backoff, active-run retention during preset selection, localized common state labels, artifact audit parsing, launcher token/port handling and legacy checkpoint receiver-evidence initialization. These are software corrections, not additional hardware claims.

## Independent review follow-ups

The coffee/arm/packaging review found duplicate recipe resource identities, audit false positives in a real exported bundle, and a custom offline UI port that violated runtime origin admission. Scoped re-review marked those three findings addressed. The offline UI port remains 4175; importing/exporting still rejects real external executable dependencies and credential shapes.

The runtime/Lab review found reclaimed edited inputs replaced by preset defaults (RL01) and missing reconciliation targets (RL02). Reclaim now returns the source record's locked inputs, validated by Lab for scene/evidence/reset. Waiting-stop reclaim is covered by real FD01 seed 42 at tick 691: its completed navigation still exposes the known load-stop robot. Multiple active robots produce separate identities and require explicit selection in the UI. Scoped re-review at 12:42 marked RL01/RL02 resolved; its result does not replace final exported-runtime browser or release acceptance.

The final arm review resolved **AR01–AR03**. AR01 restores source-only CI's optional sibling-fixture policy, while `LAB_V2_REQUIRE_LAB_FIXTURES=1` still fails when the required Lab fixture is missing. AR02 gives inactive project AMRs explicit, hashed static parking poses and retains them as obstacles; absent parking remains unknown rather than clearance. AR03 replays retained collision intervals/first-failure geometry at their recorded times, clips interval ranges, excludes future worlds, and marks truncated history incomplete. The adjacent future stop/reset leak is also fixed by reconstructing state from cursor-bounded observed/reset events. The independent review's real BV01 probe retained the tick-1 collision and stop stages from a final tick-1450 report, with no collision result at tick 0.

A full-source preflight initially recorded three regressions: FD02-cups could not load, its cancellation case could not reach return, and a manifest assertion expected only one profile. The first two were resolved by AR02's inactive-AMR treatment; the stale assertion now checks the exact runtime and declared arm-scene profiles, hashes and immutability. The subsequent **60 tests across seven source suites passed**, with typecheck and diff checks also passing. This scoped follow-up resolves those three preflight failures; the final whole-CI and exported-runtime results above supersede this preflight.

Detailed executed commands, red-to-green results and limitations remain in the implementation/review reports:

- [Coffee domain and policy implementation](plan01-remediation-details/coffee-report.md).
- [Lab implementation and RL01/RL02/AR03 regressions](plan01-remediation-details/lab-report.md).
- [Runtime implementation](plan01-remediation-details/runtime-report.md).
- [Arm scene implementation and evidence scope](plan01-remediation-details/arm-scene-report.md).
- [Root packaging, arm and backup work](plan01-remediation-details/root-report.md).
- [Runtime/Lab scoped re-review](plan01-remediation-details/review-runtime-lab.md).
- [Coffee/arm/packaging scoped re-review](plan01-remediation-details/review-coffee-arm-packaging.md).
- [Final arm review and AR01–AR03 resolution](plan01-remediation-details/review-arm-final.md).

## Operating and fidelity boundaries

Build the offline package after importing a clean runtime and rebuilding the UI:

```sh
pnpm check:source
pnpm build
node scripts/build-offline.mjs --out /tmp/mekoniq-lab-offline
cd /tmp/mekoniq-lab-offline
./start
```

The output directory must be new. `./start` executes the bundled Node; the recipient needs no package-manager install or download. Build separately on each OS/architecture. Pair via the terminal's one-use code at `http://127.0.0.1:4175`. See [README](../../README.md) for storage and port details.

Arm scene claims require a valid versioned SI profile, declared base transform/heights and known compiled AMR geometry. Missing profiles retain self/injected-only scope. Bounds are conservative and illustrative; unresolved sweeps do not pass. Reported checks and retained geometry evidence establish the declared model's behavior only. See [compatibility and fidelity](../simulation-compatibility.md).

The cell-adapter contract change requires `lab-v2-provider/2`. The compatibility snapshot records the new contract hashes; the `/1` snapshot remains historical, and external providers need fresh binding evidence.

| Remaining gate | Status / limit |
|---|---|
| Owner evidence review | Final software verification and clean pin are recorded above; release acceptance remains an owner decision. |
| UX-01-time | Needs representative human task timing. |
| Fresh macOS / network-off / cold boot | Needs actual host setup/disconnection/reboot evidence. A package-manager-free process test does not close these. |
| R-MOCK-linux | Requires a fresh Linux build/run; macOS evidence does not transfer. |
| Physical tablet timing | Separate device gate. The existing capture uses tablet viewport emulation on a Mac. |
| R-SIM / G-SIM-NAV / G-SIM-ARM | Require their provider, scene and fidelity evidence under Plan 02/03. Mock geometric checking alone does not close them. |
| G-HW-READY / G-HW-ACCEPT / G-VENUE | Require calibrated/native/physical and venue evidence. No robot, servo, grip, spill or physical stopping validation is claimed. |

No acceptance status, historical failure, final runtime pin or evidence checksum is silently replaced by this document.

## Evidence guard closure

The final evidence audit found and resolved four additional tooling issues: expanded parameterized test names failed source-only lookup; empty/failed renderer captures could pass; stored results did not bind Lab code identity; and the FPS test did not assert actual suspension. The recorder now verifies clean source/Lab identities before and after each command, rejects revision drift, and only permits explicit Lab documentation/evidence paths to differ after recording. Capture validity requires real render calls, nonempty positive percentiles, adequate samples and no page errors. SYS01 measures actual cadence and an acknowledged debugger pause with zero draws. Chrome lifecycle freeze alone did not suspend rendering on this host and is no longer claimed as evidence.

[Identity implementation](plan01-remediation-details/evidence-identity-report.md) and [independent evidence review](plan01-remediation-details/evidence-guard-review.md) record focused validation. Final release results remain in the evidence fields above.

## Clean CI generation

The recorded full source integration completed with 688 passed and two optional skips, then the identity guard correctly stopped because Next.js dev regenerated a tracked `next-env.d.ts`. The file is now ignored/untracked while preserved locally; `pnpm typecheck` first runs the app's `next typegen`, as required by the installed Next.js guide. Validation started with that generated declaration absent and passed typecheck, the full build and two real cloud integration tests. The recorder's CI mode runs the full integration superset once with clean-export coverage enabled; its default mode retains the smaller focused suite. This change affects generation/evidence tooling; runtime packages are unchanged. Final recorded results above supersede this diagnostic run.

## Final harness corrections

Final browser checks exposed stale translated selectors and an asynchronous run-creation race. Coffee reconciliation now selects the exact action in its panel; the input journey waits for the successful create response and matching new run ID before reading its immutable manifest. It asserts reset preservation, edited speed/configuration identity and reopening the original report. The coffee and workspace journeys verify the installed source badge; the recorder binds the input journey to the same clean Lab code and runtime pin. The FD08 acceptance check now expects the deliberately immediate `MAP_CHANGED` hold from R06; its no-handoff/no-duplicate assertions remain intact. Scoped independent review approved these test corrections. The final full recorder and all 41 acceptance tests passed after them.

The historical backup corruption test's no-op injection was fixed; its seven tests and the whole integration suite passed in the final recording. This removes the known injection weakness without claiming to explain the earlier observed failure frequency.
