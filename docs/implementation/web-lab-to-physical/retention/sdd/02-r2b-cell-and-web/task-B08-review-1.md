# B08 task review 1

## Verdict

**Spec Compliance: Issues.** Most B08 requirements are implemented and backed by retained evidence, but semantic admission does not enforce the declared baseline physics/empty-load content. Important finding I1 blocks trusting arbitrary imported studies within the advertised common-input scope.

**Task Quality: Needs fixes.** One Important finding, one Minor testing finding; no Critical finding. The findings do not allege that the retained clean X01 recording was fabricated or used the wrong inputs.

## Exact scope and method

- Task brief and implementer report: `task-B08-brief.md`, `task-B08-report.md`, plus `review-B08-dispatch.md`, read completely.
- Source: original base `e07685d947bad36a175b930031e0997e2991799e` to `709a797fa791727d0a8c830e935e0d80192843b0`; all 17 files/all hunks in supplied `review-e07685d..709a797.diff` read in bounded passes (1–360, 361–703, 704–833, 834–1011, 1012–1186).
- Lab: original base `c20108c6f87c6b5dc7e034184d26bd17651b1c03` to `3a904c21bb5805c1f6a4fa3d3bd096873d53ba41`; all 10 files/all hunks in supplied `review-c20108c..3a904c2.diff` read in bounded passes (1–310, 311–708, 709–885), including generated copies/pin.
- No regenerated Git range, Git mutations, product edits, helpers, SQLite opens, native/browser reruns or routine test suites. Only this ignored review report was written.
- Named outside-diff dependency checks: `navigation2d/contracts.ts:65–180`, to determine whether imported validators already enforce self-digests and engine/profile semantics (scene/model self-digests are checked; navigation evidence validator is schema validation); existing `lab/src/ui/workspace.ts:654` saved-report open handler, to establish that the new replay link opens synchronously before setting its requested tick. These dependencies were inspected once for those concrete risks, not reviewed as earlier-task scope.

## Findings

### Important I1 — Semantic study accepts a changed baseline physical input under the same name

**Location:** `source/packages/lab-runtime/src/v2/simulation3d/semantic-study.ts:18` (with the common projection assembled at lines 19–21).

The MuJoCo check only requires `loadProfileRef.id === 'empty'` and `physicsProfileRef.id === 'serve-drive-contact-v1'`. It never validates the referenced load's contents/empty population or the locked baseline physics bytes. `verifiedSimulationInput` verifies the declared file bytes and scene references, but does not establish those profile semantics. Neither reference/content participates in the returned common projection. The stricter registered-profile checks in `verifiedPhysicsInputs` are used only by physics A/B, not this path.

**Confirmed reproduction:** a read-only, in-memory probe loaded the retained clean X01 `study-input.json`, changed MuJoCo `drive-contact-profile.json` `contact.sliding` from 0.6 to 0.99, resealed its `digest`, recalculated its stored-byte hash/size, updated its scene file/ref, resealed the scene, and updated the scene/report identity mirrors. The unmodified IR-SIM/Webots inputs and original declared equivalence remained. `buildSemanticStudy` returned:

```json
{"status":"complete","reasons":[],"accepted":false}
```

The altered profile SHA256 was `ae053bc32b769d4e6d090286487a5eca5c3f9e5e89bc8d6f476b49a6215b069b`; the accepted common projection remained `58cd652a07fd4592503545ae10834780910c9bcd9e429e9de5670aa7b831d1d2`. An initial version without resealing the profile was also accepted. This is an input-admission defect, not a claim that hashes authenticate a producer or that the original recording used that modified profile.

**Impact:** altered material/actuator/numerical settings, or a nonempty/malformed load retaining the admitted name, can be presented as the registered common empty-load/baseline study. The UI then says inputs are equivalent and differences are engine observations even though the consumer did not enforce its declared experiment scope. This misses the task's verified common-input requirement and the report's explicit claim that empty load and baseline registered physics are required. It is not plan-mandated.

**Suggested fix:** verify the closed admitted MuJoCo profile content and self-digest against the registered baseline, and verify the empty-load document/model binding and empty population (including all derived references), before deriving semantic equivalence. Reuse narrowly applicable existing admission helpers or add a shared closed validator; do not simply add a mutable profile name to the common hash. Add fully resealed adjacent-input regressions that reach semantic admission and return `INPUTS_NOT_EQUIVALENT`, preserving the valid clean X01 readback. No native rerun is needed merely to prove rejection of offline altered inputs; any producer change would need its own appropriately scoped evidence.

### Minor M1 — Several advertised mismatch tests stop at stale hashes rather than the intended semantic check

**Locations:** `source/tests/fixtures/simulation-study/mismatched-world.json:3`; `source/tests/unit/semantic-study.test.ts:4`; `source/tests/unit/physics-comparison.test.ts:19`.

The named mismatched-world fixture embeds `{}` reports with hashes that are not the hash of `{}`. It therefore fails report integrity before comparing the two declared projection hashes. The adjacent physics-input negatives replace/re-hash individual artifacts but do not update scene-file references and scene/report digests, so they fail `SCENE_FILE_MISMATCH` before exercising the complete reconstruction whitelist. Similar world/frame/goal tests deliberately leave the scene seal stale. These are useful corruption checks, but they do not independently protect the claimed semantic/whitelist rejection paths.

**Impact:** future weakening of the semantic or reconstruction checks can leave these tests green, as illustrated by I1. Positive slow/fast/default tests do exercise the valid reconstruction path, and the implementation's exact reconstruction is a strength, so this testing gap is Minor by itself.

**Suggested fix:** retain corruption coverage, and add coherent resealed/rebound negative fixtures with valid upstream identity checks; assert a scope/reconstruction rejection reason rather than only `comparable:false`. Ensure the explicit mismatched-world fixture has valid report/compiled references before differing in its common projection.

## Requirement assessment and concrete strengths

- **Interfaces/schema/CLI:** implemented separate semantic and physics APIs, a closed versioned study schema, generated/synced contracts, and offline CLI with bounded input and exclusive output creation. No ranking field is allowed; percentiles are null. Legacy comparison code is untouched and a cross-backend null-delta regression is present.
- **Common inputs:** fresh compilation uses the actual Serve component/project fixtures for all three engines. Model/world/goal/frame, seed, scenario, controller identity and policy are represented in the derived common projection. Scene/model self-digests and artifact byte identities are checked. I1 is the missing closed physical-input admission for the semantic branch.
- **Controller/noise/clock:** additive server-owned controller wrapper selects the same existing previous-sent-command ramp and preserves the legacy plant. Noise-off, no actors/zones, deterministic scripted confirmations and 20 ms clock are checked. Actual retained clean reports identify the same controller version. No engine lock or default was changed by this diff.
- **Causal invariants:** source arrivals join mission/allocation/action-specific stops; scripted receipts and exact confirmation delay are checked; served requires its own handoff; unknown redispatch includes a new command ID for the same mission; cancel completion requires a prior request. The code does not demand cross-engine trace equality or global event-order equality. Nominal cancel/unknown clauses are explicitly `not_run`.
- **Geometry/dynamics:** durable byte-verified trajectory is used for arrival and navigation geometry. Five stopped ticks and original position/yaw tolerances are preserved. IR-SIM contact/slip/tipping are explicitly unsupported, never fake zero results. No calibrated accuracy claim is made.
- **Physics comparison:** same-engine/control/mechanics gate, closed registered experiment reconstruction, canonical mechanical bytes, provenance-derived physical/load/navigation/scene refs and speed policy reconstruction are substantial strengths. Only one registered load/speed/friction dimension can differ. Raw physics/control/trajectory recomputation prevents report-only metric invention. Output discloses windows, sample counts, one run per side, null percentiles and no performance winner. Lower-friction masking and the post-ramp zero-target start of stop-distance are preserved in user-visible scope text.
- **Lab:** separate reachable Report study tab, bounded read-only import, escaped output, accessible table/tab labels and arrow/Home/End focus behavior. Replay uses an existing matching saved run/scene with a sufficient tick horizon and otherwise provides guidance. No Lab-to-hardware route is added. New UI copy largely follows existing `tr(vi,ja,en)` conventions; raw imported limitations and technical identities remain source evidence strings. Existing 2D/reduced-motion/offline paths are retained.
- **Evidence/pin:** clean native X01, exclusive readback, matching export/pin tuple and post-pin checks are supported by the retained outputs below. Development and clean recordings are kept distinct. Automatic acceptance remains false. No deploy/provision/native-Linux/hardware work is represented as completed.

## Evidence checked and commands

Read retained `evidence-B08/final-identities.json` completely: clean Source/Lab/export/recorded/validator/pin identities, final study/input/CLI hashes, three unique clean run IDs/scenes/models, engine/lock/platform/controller records, and 12 pass/6 not_run/0 fail counts. Read `x01-final-709a797.log` completely: actual IR-SIM H2900, Webots H2961, MuJoCo H3451, all completed/served1, one integration test passed. Read `x01-cli-readback.log`, `physics-actual-readback2.log`, `lab-check-source-final.log`, `lab-sync-check-final.log`, `green-confirmation-scope.log`; inspected result tails of `combined-focused.log`, `lab-tests-post-pin.log`, `lab-build-final.log`, `b08-lab-browser-final.log`. These support 84 focused tests, later 16 semantic tests (overlap, not a sum), six retained B04a comparisons, Lab592 passed/1 skipped, matching pin/contracts and two offline browser checks. Earlier failure narratives were read in full in the report; skipped benchmark remains not_run.

Read development `recording.json` directly: Source base plus `-dirty`, `started`, empty engineRuns. Read clean `recording-complete.json` directly: Source709a797 and the three distinct final run IDs. Thus the development consumer/UI readbacks were not treated as the clean recording. Root's separate 174-location byte audit and screenshot inspection were handed off as such; I did not independently repeat that whole audit or inspect browser images.

Commands consisted of `cat`, bounded `sed`, `rg`, `wc`, result-tail reads, and two `node --import tsx --input-type=module` heredocs under Node24.22.2. The Node probes only read `/tmp/mekoniq-b08-x01-final-709a797-20261115-0110/study-input.json` and mutated parsed objects in memory; no file was written. They called existing offline comparison/hash/seal helpers, without any runtime/database/native engine. The first probe also substituted a Webots navigation evidence engine into an IR-SIM report; that was correctly rejected with `REPORT_INPUT_IDENTITY_MISMATCH`, so it is not a finding. The two friction probes and exact output are recorded in I1 above.

## Cannot verify / limits

This is a B08 task-scoped review, not a whole-branch qualification or repeat of earlier task gates. Existing runners, physics metric definitions and complete compiler implementations were not independently re-reviewed. I relied on the bounded dependency checks and retained outputs described above. Clean X01 establishes these three nominal recorded runs, not a statistical population, native cancel/unknown coverage, calibrated materials, measured ground truth, B07b performance, Linux/ROS2/Gazebo/LinuxCNC/device/hardware qualification, or human acceptance. Browser evidence uses the explicitly labeled development study; clean CLI/native identity is separate. All of those limits remain open as documented rather than being converted into new task failures.
