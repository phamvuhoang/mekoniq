# L02 fix round 1 — scoped re-review

## Verdict

- **L02-R1: ADDRESSED.** The claimed production defect is disproved by the exact FIX_BASE parser and the new actual-CLI regression. The original finding is withdrawn as a false positive; no redundant production edit is required.
- **L02-R2: ADDRESSED.** The actual listener/health seam now checks each required dynamic edge's provider timestamp and monotonic receipt age, distinguishes static sensor TF, and feeds the existing fatal latch and command/result refusal boundaries.
- **New Important/Critical fix-introduced issues: none identified.** No additional blocking finding.
- **Final scoped verdict: APPROVED for prepared code and regression coverage.** This is not a full-task re-review or native qualification. Actual native execution remains **not_run / blocked_external**, `accepted:false`, `dynamics:not_calibrated`; DEP-NAV-01–04/SEC-01, G-NATIVE-AMR and physical/commissioning gates remain open.

## Scope and evidence

Read the dispatch, binding L02 brief including R85, original review, fix1 report appendix, supplied Source and Lab fix packages, root handoff and evidence index. The initial combined tool display truncated; bounded continuation reads recovered the relevant patch and report content. No new full-task diff was generated.

- Source: `e6db696b2ac1266fdeede8c2a64521cd4064481a` → `00d41e7f25ec1294b9bc8e8c81de3d8e1a869316`; supplied patch SHA-256 `265e5697ec0d52ee7589c86456847344c621c93aa3ace6f5ce86d91f2f7bef2e`.
- Lab: `7652851fb9e92e560c70e4e6675b85fa5f445cf4` → `82b5f92005673c99ba0d1f434ae4c512800fa75e`; supplied patch SHA-256 `5f3c3cd413a87c10dfc16b55dbc9db5302c4e8af6003121daccbb6170a95cd4b`.

Named dependency reads were limited to `scripts/lab-sil.mjs` at FIX_BASE to verify upstream argument normalization; surrounding `engineering_session.py` health/execute/query/watch code to verify the changed observer's consumers; `NativeClockMapping` to verify clock-reset/stall behavior; and the owned Nav2 YAML's transform tolerance to assess the future-time allowance. These reads did not reopen unrelated implementation scope.

No helpers, test-suite reruns, native services, Docker, cloud, hardware, historical SQLite, product/index/HEAD changes or evidence rewrites occurred. Only this review report was written. Read-only checks compared the four directly covered final source/test files with their receipt hashes and the CLI bytes with FIX_BASE. Root's broader closure/pin/preservation audit is relied upon as attributed evidence, not claimed as newly repeated work.

## L02-R1 — ADDRESSED by contrary evidence and regression

**Locations:** `scripts/lab-sil.mjs:19`, `:30`, `:124`, `:127`, `:129`, `:179`, `:181`; `tests/integration/engineering-native-cli.test.ts:10`; `tests/support/engineering-cli-probes.mjs:11`.

The exact FIX_BASE defines `engineering-project` as a `path` option. `parse()` applies `resolve(v)` to that option in the calling process, and the entrypoint passes the parsed object to `run()`. Thus the downstream assignment at line 124 already receives an absolute path. The existence check, compiler `--project` and runtime `--fixture` preserve the same identity. The original review incorrectly inferred that the raw command-line string reached the assignment unchanged; its deterministic-failure claim is not supported. A direct byte comparison confirms the production CLI remains identical to FIX_BASE.

The new regression invokes the public CLI with both the R85 relative canonical path and its absolute equivalent. It asserts the actual compiler argv, changed compiler cwd, runtime argv and identical compiler manifests. The compiler runs for real. Its preload supplies host/probe doubles and intercepts native runtime execution only inside the test child; it does not replace the parser or add a production prerequisite bypass. That seam is suitable for a portable argument-boundary regression, not native admission evidence.

`initial-cli.log` and its own exit receipt show **1 passed, exit 0** on the unchanged production CLI. `final-cli.log` separately shows **1 passed, exit 0** after test-only interpreter discovery changed. Neither run skipped the test. The test explicitly becomes skipped/not_run when portable compiler dependencies are absent; that does not make these recorded executed runs skips. No artificial RED or production change is necessary to close this finding.

## L02-R2 — ADDRESSED by actual observer checks

**Locations:** `robotics/simulation/bridge/engineering_session.py:22` (observer), `:40` and `:44` (listener writes), `:51` (freshness policy), `:104` (actual wiring), `:140` (health integration), `:148` (fatal latch), `:210` and `:217` (existing command/result consumers).

The wrapper receives dynamic and static setter calls from the TransformListener and forwards them to the real buffer. It retains separate samples for `map`→`odom`, `odom`→`chassis/base` and `chassis/base`→`lidar/head`. Unrelated wheel messages cannot change the required dynamic edges' receipt deadlines. Both dynamic edges require receipts within 500 ms and provider timestamps no more than 500 ms behind the current simulation clock. The bounded future allowances are one second for AMCL and 500 ms for odometry; neither extends receipt age. The sensor edge must use static transport and does not expire. Static data cannot replace a dynamic edge, and the cache connectivity check remains additional to freshness.

The observer's lock covers setter forwarding/sample recording and freshness reads. Monotonic time is sampled under that lock, avoiding a concurrent newer receipt being mistaken for a negative age. Health appends these concrete reasons before readiness/fatal processing; after readiness, a failure remains latched even when the edge later refreshes. The unchanged session consumers reject new goals and return unknown query outcomes on unhealthy feedback while preserving existing receipts to prevent duplicate sends. The existing watcher still pauses on fatal health.

The portable tests now instantiate the real `EngineeringRosPorts`, exercise `_node()` wiring, drive the buffer supplied to its listener, and call the actual health and session guards. ROS transport, cache and action-server behavior are doubles; they no longer inject only a preselected health reason. Specific coverage in `robotics/simulation/tests/test_engineering_native_parity.py`:

- `:226`: either required dynamic edge expires while clock, scans, joints, unrelated wheel TF and the other edge remain fresh; provider time remains within tolerance, isolating receipt expiry; recovery cannot clear the latch.
- `:240`: newly received transforms with old provider timestamps fail for either edge.
- `:246`, `:291`: legitimate zero-stamped static sensor TF persists; dynamic/static substitution fails.
- `:256`: missing TF and clock reset remain refusals.
- `:265`: accepted and lost-ACK paths both refuse new goals/results after expiry and do not resend; an already successful action result cannot produce a healthy completion.
- `:285`: excessive future timestamps fail for both dynamic edges.

For the concrete wrapper compatibility question, I read the official [Jazzy TransformListener source](https://raw.githubusercontent.com/ros2/geometry2/jazzy/tf2_ros_py/tf2_ros/transform_listener.py). Its dynamic/static callbacks call the corresponding buffer setters; the constructor stores the supplied object without requiring a Buffer subclass. This supports the wrapper seam used here. It does not establish installed-host behavior. The owned `robotics/navigation/config/nav2_params.yaml:39` sets AMCL `transform_tolerance: 1.0`, consistent with the implemented allowance. Native TF timing/topology remains unqualified.

## Validation receipts and final-byte attribution

All receipt/log names below are under `evidence-L02/fix1/`. I inspected the actual logs and numeric exit fields, including the retained RED failures, rather than relying only on the appendix's totals. Commands ran from Source except the explicitly named Lab checks. Node receipts identify `v24.22.2`; Python receipts retain `PYTHONDONTWRITEBYTECODE=1` and disabled pytest cache.

| Receipt | Exact command | Recorded result |
| --- | --- | --- |
| `red-tf` | `perl -e 'alarm 170; exec @ARGV' .venv-irsim/bin/python -m pytest -p no:cacheprovider -q robotics/simulation/tests/test_engineering_native_parity.py` | 6 failed, 13 passed; exit 1 |
| `green-tf` | Same command as `red-tf` | 19 passed; exit 0; intermediate bytes only |
| `initial-cli`, `final-cli` | `perl -e 'alarm 80; exec @ARGV' pnpm exec vitest run tests/integration/engineering-native-cli.test.ts` | Each 1 passed; each exit 0 |
| `combined-python` | `perl -e 'alarm 180; exec @ARGV' .venv-irsim/bin/python -m pytest -p no:cacheprovider -q robotics/simulation/tests/test_engineering_native_parity.py robotics/simulation/tests/test_engineering_compiler.py robotics/simulation/tests/test_engineering_profile.py robotics/simulation/tests/test_engineering_worker.py robotics/simulation/tests/test_native_profile.py robotics/simulation/tests/test_nav2_session.py` | 85 passed, no skips; exit 0 |
| `combined-ts` | `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/engineering-native-cli.test.ts tests/integration/engineering-native-lifecycle.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/engineering-profile-routing.test.ts tests/integration/engineering-compiler.test.ts tests/unit/native-handoff.test.ts tests/security/native-handoff.test.ts tests/integration/lab-v2-native-profile.test.ts` | 128 passed / 8 files, no skips; exit 0 |
| `final-focused-lint` | `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint tests/integration/engineering-native-cli.test.ts tests/support/engineering-cli-probes.mjs` | Empty log, own exit 0 |
| `final-typecheck` | `perl -e 'alarm 300; exec @ARGV' pnpm typecheck` | Successful route generation/typecheck; exit 0 |
| `lab-check-source` | `perl -e 'alarm 120; exec @ARGV' pnpm check:source` | Verifies Source `00d41e7`, schema/protocol/Node; exit 0 |
| `lab-typecheck` | `perl -e 'alarm 180; exec @ARGV' pnpm typecheck` | `tsc --noEmit`; exit 0 |

Direct final-byte SHA-256 comparisons against receipt `after.changedFiles` all matched:

| File | SHA-256 | Applicable receipt |
| --- | --- | --- |
| `robotics/simulation/bridge/engineering_session.py` | `4dfc260011db6e5220cc9000f302e35a9d6317cad1b8408f925820cb8d07f6ff` | `combined-python` |
| `robotics/simulation/tests/test_engineering_native_parity.py` | `da39d9cd5482a73ecf61cdf7aba1c8ecde273137a974a7490e2ec40ece5253d6` | `combined-python` |
| `tests/integration/engineering-native-cli.test.ts` | `c03d53f7c37f04b820c5632ea58b8d76eebd5feff6696be9557c7e4e44c5379d` | `final-cli`, `final-focused-lint`, `final-typecheck` |
| `tests/support/engineering-cli-probes.mjs` | `7a8802bb7a9d3f4a157af1bae5a0548adc69e67fca4d0237e956c4838bc08b81` | Same three final receipts |

The combined TypeScript result predates the test's interpreter-discovery adjustment; the later focused CLI/typecheck/lint receipts cover that final edit. Tests executed on FIX_BASE plus the recorded working-tree bytes, subsequently committed, not on a falsely backdated final commit. No remaining concrete doubt required rerunning a suite.

## Preserved boundaries and out-of-scope observations

The fix changes no canonical input, requested-profile provenance, target mapping, native package lock or production CLI. Lab changes are the new pin and generated source-commit headers only. Root's audit records unchanged portable closure, 180 native/237 portable refs, 57 schemas, preserved historical evidence/report prefix and the new export; only `engineering_session.py` changed in the native closure. No evidence of a prerequisite bypass, alternate model mapping, repeated effect after unknown, old-run restart or Lab-to-hardware route was introduced by this patch.

Actual doctor, all five native case preflights and nominal verifier receipts still have exit **2**. Their logs report missing Linux/compiler dependencies/ROS/Gazebo/profile prerequisites. They provide refusal evidence, not a native campaign pass. Exact packages/plugins, native installation/startup, real freshness timing, physical readback, native fault/bag/replay coverage and acceptance still require the assigned host and human process.

No new wholly untouched-code issue is raised by this scoped review. The previously recorded full-lint failure of 27 historical-evidence errors remains a nonblocking out-of-scope B10 item; focused lint exit 0 is not a full repository lint pass. This report corrects R1's prior factual error without rewriting the original review or raw artifacts.
