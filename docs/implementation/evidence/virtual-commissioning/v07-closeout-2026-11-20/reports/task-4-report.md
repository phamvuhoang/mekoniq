# Task 4 · Lab Control closeout

Lab base 9f717a12e38522f8baf9f0d110a89f659dbcbb77. Implementation checkpoint aba95e6ab52bc35dea752cb0feafab0d4b4f21f2 on r4/virtual-commissioning. Runtime pin b74755e96e9a364ead530f66f755d3798f35bd2a, schema 8a1f111d006484d099f4c96d8c7d9386143998dab11ee20b83c5ba730cd2bbfd, artifact 4596a092c46614ed22b5beb47f977ca648c057abee3b9a0d2589de263defded5. The runtime Source tree was frozen. Contract sync added byte-identical bench-request and control-evidence schemas. Evidence is software-only, accepted:false.

## Implementation

- Each bench operation captures runtime, target, session generation and local workspace generation. Disconnection, a new credential or retargeting invalidates continuations. A late CREATE receipt leaves its mark and proof on its issuing runtime. Remote pin checks recheck the session before creation.
- Bench operations have a 30-second request deadline including body reads. Uncertain mutations receive no replay. CREATE without a confirmed ID acquires no engine and retains existing session/open-run bounds. For a successful START, an idle worker is covered by the host's 60-second resource lease. Recovery after confirmed or uncertain mutations is explicit.
- Per-run storage keys protect independent tab writes. Legacy aggregate entries remain readable, and per-entry tombstones suppress deleted legacy proofs. A stale heartbeat checks the current proof and mark before renewing. Read or archive ownership 404 can require proof-based reclaim. Archive acknowledgement must identify the requested run.
- Health validation checks nested profile, envelope, bounds, experiment and axis semantics. A bench report must identify its known run, scenario, source, backend set, seed, plant, drive, profile, signal and traced axes. The tuning result is checked against Source's schema and status-specific details. Trace objects and sample values are checked in axis order with their exact tick span and count. The endpoint assembles ten initial substeps plus at most 5,000 measured substeps. Both portions are validated against the Source DriveTrace schema, whose single-block sample limit is 5,000. A malformed tail sample and unmatched IDs retain reread. A validated result stays visible after trace/archive failures.
- Per-target session history keeps pending runs and up to eight recent results. Read again selects the recovered result. An explicit Close after an archive failure preserves already-read data, export and A/B. Pin mismatch can block creation while leaving close available.
- Wheel results label the measured wheel angular speed, straight-line/no-slip inertia assumption and final verified comparison tick with chassis/wheel surface speed. A historical measurement without paired chassis evidence displays its availability. Gain edits update their attribution. Revision numbers need not be globally unique: digest identifies each export. ControlProfileV1 admits one tuned reference per loop/limits field. A disjoint-axis export that would discard an unchanged axis’s tuned source is refused. The user can explicitly restore the server profile and run a new bench.
- Control shortcut help, named SVG plots, recoverable run IDs, failed free-engine notices, focus visibility, wheel trapezoid layout, isolated launcher ports and same-origin proxy host/origin support are covered in Lab. Remote bearer and same-origin cookie + CSRF paths are covered separately.

## Staging verification

Evidence directory: /Users/hoangpham/source/prv/robot/lab/runs/r4-v07-closeout/. RED logs retained in red.log (9 original lifecycle/proof failures), red-launcher.log (4 fixed-port failures), red-offline.log (occupied 4175), red-identity.log, red-terminal.log, red-view.log, red-heartbeat.log, red-archive-ack.log and cookie1.log (mobile banner). Toolchain was Node 24.22.2/pnpm 10.32.1 with PYTHONDONTWRITEBYTECODE=1 for runtime suites. Focused unit GREEN 90/90 in focus-green.log. Typecheck and check:source passed. Same-origin Control passed 1/1 (28.9s) after mobile layout repair; remote-origin bearer and 1×/16× mock pacing passed 1/1 (38.6s). Screenshots are under cookie/ and remote/. Historical evidence stayed intact.

## Clean checkpoint verification

All commands below ran from the clean Lab worktree at aba95e6ab52bc35dea752cb0feafab0d4b4f21f2. They exited 0. The launcher plus its owned UI/worker processes exited after each run. Original 4175/4176 listeners remained at 61448/61443. No acceptance, push or deployment was performed.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
pnpm typecheck
pnpm check:source
LAB_TWIN_MEASURE="$PWD/runs/r4-v07-closeout/twin-measure.json" perl -e 'alarm 330;exec @ARGV' pnpm exec vitest run --reporter=default --reporter=json --outputFile.json=runs/r4-v07-closeout/vitest-clean.json
LAB_IRSIM_SCREENSHOTS="$PWD/runs/r4-v07-closeout/clean-cookie" perl -e 'alarm 330;exec @ARGV' node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-control.spec.ts
LAB_TEST_UI_PORT=42555 LAB_TEST_RUNTIME_PORT=42556 LAB_TEST_EXTRA_PORT=42557 LAB_EVIDENCE_DIR="$PWD/runs/r4-v07-closeout/clean-remote" LAB_PW_OUTPUT_DIR="$PWD/runs/r4-v07-closeout/pw-clean-remote" perl -e 'alarm 250;exec @ARGV' node scripts/test-mock-e2e.mjs remote-origin.spec.ts
```

- 97 Vitest files, 719/719 tests passed in 39.50s, 0 skipped, 0 todo. All launchers ran: mock 12/12, IR-SIM 12/12, Webots 4/4, MuJoCo 6/6, offline bundle 2/2. The opt-in twin measurement ran. Machine-readable counts and per-case outcomes are in vitest-clean.json. Logs: full-clean.log, typecheck-clean.log and check-source-clean.log.
- Same-origin Control 1/1, 31.8s, 0 skipped, 0 retries. The real wheel, J3, gain change, suggestion, trapezoid and refusal paths ran. Every run mutation used a cookie and CSRF token with no Authorization header. Fourteen PNGs plus V07a-results.json (accepted:false) are in clean-cookie/. The three V07a-*-trapezoid-focus.png screenshots show focus and the sticky simulation banner together. Log: cookie-clean.log.
- Remote bearer/1×/16× mock pacing 1/1, 33.5s, 0 skipped, 0 retries. Twelve screenshots are in clean-remote/, including N03-paced-1x.png and N03-paced-16x.png. The one-use code field is masked on the pairing screenshot. Log: remote-clean.log.
- Staging full suite had a heartbeat race in the shared test storage and one opt-in measurement skip. The new heartbeat regression and explicit measurement setting exercised both on the clean checkpoint. Earlier RED runs with name filters report their unselected cases as skipped; final counts above come from the unfiltered suite.

The paced twin browser proof is for the mock twin’s shared transport controls. Real MuJoCo ran the Control bench. The wheel comparison is a single final verified observation; peak slip and payload acceleration are outside its measured scope. Hardware, production and human acceptance remain external gates.

## Review round 1

Lab commit `32f42548948b607e79ca2d99b4dbcd0d0a22cc3d` follows `aba95e6ab52bc35dea752cb0feafab0d4b4f21f2`. The Lab runtime pin and generated artifacts stayed at the original checkpoint. Qualification remains `accepted:false`.

- Health rows must advertise the two ordered wheel drive IDs or the exact selected arm joint. Each drive occurs once across rows. A bench CREATE requires the issuing runtime's usable proof, the selected immutable run identity, a ready status, zero ticks and the initial revision before START. CREATE does not echo the bench request. The first report checks its entire echoed request including the control-profile reference.
- The browser keeps confirmed run IDs and request context in the issuing target's history from CREATE. With an identified malformed response, the UI explains current-session recovery or the need for valid proof. It retains a run after an outstanding START/final STEP loses its session or target. A later ownership 404 may require explicit proof reclaim before reread. Cookie expiry and bearer expiry both invalidate the issuing session. The active target stays isolated while an earlier response arrives.
- Each action receipt must confirm its own allowed status, tick span and revision. Terminal START and zero-progress terminal STEP are valid. STEP may gain two revisions when idle expiry is confirmed. Contradictory receipts retain the last confirmed state for explicit recovery. No mutation is replayed. Verified reclaim can produce needs_attention and preserve original completed tuning. Null or replaced tuning after a confirmed completed bench, contradictory outcomes, bad echoes, and malformed reclaim responses retain the available result and proof. A validated stopped run with no result can close. Export and A/B continue to use the displayed history while the next bench is in flight.
- Malformed legacy JSON and malformed individual storage entries are skipped independently. The other valid marks and recovery credentials remain readable.

Round 1 evidence is in `lab/runs/r4-v07-closeout-round1/`. Before the fixes the focused review regressions reproduced 29 failures and 1 pass in red.log, 2 recovery failures in red-recovery.log, 1 authenticated cookie-expiry failure in red-401.log and 1 displayed-history comparison failure in red-display.log. The name filters excluded unrelated cases. Typecheck and all 132 focused tests in 2 files passed at staging with zero skips in typecheck.log and focus-green.log. git diff --check passed.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
R=runs/r4-v07-closeout-round1
perl -e 'alarm 80;exec @ARGV' pnpm exec vitest run tests/unit/control-workbench.test.ts tests/unit/twin-runtime-remote.test.ts
perl -e 'alarm 90;exec @ARGV' pnpm typecheck
perl -e 'alarm 120;exec @ARGV' pnpm check:source
LAB_TWIN_MEASURE="$PWD/$R/twin-measure.json" perl -e 'alarm 330;exec @ARGV' pnpm exec vitest run --reporter=default --reporter=json --outputFile.json="$R/vitest-clean.json"
LAB_IRSIM_SCREENSHOTS="$PWD/$R/clean-cookie" perl -e 'alarm 330;exec @ARGV' node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-control.spec.ts
LAB_TEST_UI_PORT=42555 LAB_TEST_RUNTIME_PORT=42556 LAB_TEST_EXTRA_PORT=42557 LAB_EVIDENCE_DIR="$PWD/$R/clean-remote" LAB_PW_OUTPUT_DIR="$PWD/$R/pw-clean-remote" perl -e 'alarm 250;exec @ARGV' node scripts/test-mock-e2e.mjs remote-origin.spec.ts
```

At clean commit `32f42548948b607e79ca2d99b4dbcd0d0a22cc3d` every command above exited 0. Typecheck and source verification passed. Vitest ran all 761 tests in 97 files (46.77 s), 0 failed, 0 skipped, 0 todo. This includes 12 IR-SIM, 12 mock, 6 MuJoCo and 4 Webots launcher cases plus 2 offline-bundle cases. The twin measurement ran. The per-case JSON is vitest-clean.json and the logs are typecheck-clean.log, check-source-clean.log and full-clean.log.

Real MuJoCo Control with same-origin cookie and CSRF passed 1/1 (43.7 s), zero retries/skips. Fourteen screenshots and V07a-results.json are in clean-cookie/. The 390, 1024 and 1440 px screenshots ending in trapezoid-focus.png cover the field and sticky banner. Remote mock bearer BV01 including both 1× and 16× pacing passed 1/1 (50.6 s), zero retries/skips. Twelve screenshots are in clean-remote/, including N03-paced-1x.png and N03-paced-16x.png. Logs are cookie-clean.log and remote-clean.log. Both launchers shut down their isolated listeners. The existing 4175/4176 PIDs remained 61448/61443. The hardware and human acceptance limitations from the original checkpoint still apply.

## Review round 2

Lab commit `b0512b416bbcf2d9e452c23a63580b28eaa738fb` follows `32f42548948b607e79ca2d99b4dbcd0d0a22cc3d`. A CREATE that resolves after its deadline or after its session changes retains the identified run under the issuing target. The recovery list exposes the available actions. The displayed result, export and A/B history keep their existing selection. A successful explicit reread may select a recovered result. The catalog checks a row's axis against the registered strings before building its expected drive ID, so malformed nested JSON renders BENCH_CATALOG_INVALID and sends no CREATE.

Round 2 artifacts are in `lab/runs/r4-v07-closeout-round2/`. On the previous checkpoint three deterministically held CREATE receipts displaced the newer completed bench, after same-target re-pair, while a different target was selected, and after the 30 s deadline in the same session. A JSON axis object with a null toString property threw during rendering. All four failed before changes (red.log) and passed after the fix (green.log). The filtered runs excluded 95 unrelated cases. Both covering unit files passed 136/136 at staging (focus-staging.log), typecheck passed (typecheck-staging.log) and git diff --check passed.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
R=runs/r4-v07-closeout-round2
perl -e 'alarm 80;exec @ARGV' pnpm exec vitest run tests/unit/control-workbench.test.ts -t 'round2|nested-axis-object'
perl -e 'alarm 100;exec @ARGV' pnpm exec vitest run tests/unit/control-workbench.test.ts tests/unit/twin-runtime-remote.test.ts
perl -e 'alarm 90;exec @ARGV' pnpm typecheck
perl -e 'alarm 120;exec @ARGV' pnpm check:source
LAB_TWIN_MEASURE="$PWD/$R/twin-measure.json" perl -e 'alarm 330;exec @ARGV' pnpm exec vitest run --reporter=default --reporter=json --outputFile.json="$R/vitest-clean.json"
LAB_IRSIM_SCREENSHOTS="$PWD/$R/clean-cookie" perl -e 'alarm 330;exec @ARGV' node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-control.spec.ts
```

The clean Control browser rerun covers the changed selection, rendering and export path. Round 1's clean remote bearer 1×/16× result supplies the browser evidence for the unchanged remote pacing path. The Source pin, generated contracts and hardware limitations remain as described above. Qualification remains `accepted:false`.

At review dispatch, exact-head typecheck and source verification exited 0. The clean full Vitest and real MuJoCo Control browser run were in progress.

Final results for clean Lab commit `b0512b416bbcf2d9e452c23a63580b28eaa738fb` are complete. All 765/765 Vitest cases in 97 files passed in 36.08 s, zero skips or todo, including the twin measurement, all 34 launcher cases (mock 12, IR-SIM 12, MuJoCo 6, Webots 4) and 2 offline-bundle cases. Logs and case counts are in full-clean.log and vitest-clean.json. The typecheck-clean.log and check-source-clean.log files record verification of TypeScript and the frozen Source schema. Real MuJoCo cookie/CSRF Control passed 1/1 in 34.0 s, zero retries or skips. Its 14 screenshots and V07a-results.json (`accepted:false`) are in clean-cookie/ and the run log is cookie-clean.log. The launcher exited and released ports 42455/42456, leaving the original 4175/4176 listeners at 61448/61443. The tracked Lab worktree was clean after verification.
