You are the original L06 implementer returning for fix round 1/5. Read requirements first: task-L06-brief.md including every clarification, then your complete task-L06-report.md and complete task-L06-review-1.md in this directory. Root read all 18,482 review bytes (SHA256 4035e927b721a4633da24f2a950e7e5eb644e4daab47affb68f1038e844c04ff) and independently confirmed the named producer/consumer and shared profile-reader boundaries. Full review verdict: spec FAIL / quality REQUEST CHANGES.

FIX_BASE Source: 6bf54aa5cab5bc63bc32c1fae471606d71061a78
FIX_BASE Lab: c41f715bca9c224328879b44e3cbf5a296b59e06
Both independently clean at dispatch. Original task bases remain ac9b44d / 47343f9; subsequent review is a scoped fix review from FIX_BASE, not another full task review.

Use only /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source and sibling lab. One implementer, no helper agents or reviewers. Root does not edit product code. No Docker probe/build/container, native ROS/Gazebo/controller/physical execution, cloud operations, final browser/performance/qualification recording, main edits, merge/push/deploy. Existing R76 final-prerequisite deferral and R88 prepared-scope limits remain. No new collector phase. Preserve every retained input and old report/evidence byte; append your complete fix handoff to task-L06-report.md, retaining its original 17,523-byte prefix exactly. New evidence belongs under evidence-L06/fix1; no overwrite of prior logs, packages or exports.

Fix exactly I1–I3 below. M1 is tracked separately in the central deferred findings for final triage; do not expand this Important-finding loop to fix it. Preserve all required native cases and explicit observation/tooling limitations, accepted:false, not_calibrated and existing sidecar scope. None of these supported-observation corrections qualifies native or physical execution.

Verbatim Important findings:

### L06-R1-I1 — Supported X1 observations are rejected because wall-clock nanoseconds exceed JavaScript's safe-integer range

**Location:** `source/scripts/r3-native-readback.mjs:72`; producer `source/robotics/manipulation/native_xarm/ros.py:22`, `:47`, `:67`; fixture `source/tests/unit/r3-native-readback.test.ts:57`.

The new reader requires both `stampNs` and `clockNs` to satisfy `Number.isSafeInteger`. The real X1 producer sets `use_sim_time:false`, takes `clockNs` from the ROS system clock, and emits the joint header's epoch nanoseconds as `stampNs`. Current epoch nanoseconds are around 10^18, above `Number.MAX_SAFE_INTEGER` (approximately 9×10^15). Thus a valid X1 sample cannot pass this reader. The Python producer supports these arbitrary-precision integers; ordinary JavaScript `JSON.parse` also loses their exact low bits before validation.

X1 is explicitly supported in the fixed six-slot adapter. Supplying its valid retained observations therefore yields `R3_XARM_SAMPLE_INVALID` and invalidates a prepared record containing them. This is independent of the correctly deferred controller restart, collision planning and contact qualification. The positive test covers X2 with small simulation timestamps, so it does not exercise the supported X1 representation.

**Required correction:** read the existing timestamp representation without losing integer precision and compare the clocks in that representation. Preserve the existing retained bytes and avoid simply relaxing the check to permit rounded numbers. Add a producer-shaped X1 positive with realistic epoch nanoseconds, plus clock-reset/order negatives that reach this boundary after valid mapping/inventory admission. A portable fixture suffices; no ROS execution is needed to fix this incompatibility.

### L06-R1-I2 — Engineering readback incorrectly equates worker-relative and Source-relative ticks

**Location:** `source/scripts/r3-native-readback.mjs:43`; producer boundaries `source/packages/lab-runtime/src/v2/sil/engineering-native.ts:19`, `:92`, `:125`, `source/packages/lab-runtime/src/v2/backends/gazebo-nav2.ts:71`, `:103`, and `source/robotics/simulation/bridge/engineering_worker.py:115`.

The reader requires every retained Source `clockMapping` row to have a raw worker event with both identical `providerSimNs` and identical `sourceTick`. Those tick numbers do not share a guaranteed origin. The Python mapping chooses its origin at the first worker health observation. Source attaches its listener only after `startGazeboBackend` finishes readiness polling, then its separate `EngineeringClock` chooses the first event it receives as origin. The process event port delivers to current listeners; it does not replay earlier startup events.

A legitimate history can therefore have worker origin 1,000,000,000 ns and Source's first received event at 1,500,000,000 ns. At that same provider timestamp the worker records tick 25 while Source records tick 0. Both clocks obey their own implemented contracts, but the new wrapper throws `R3_RAW_CLOCK_MAPPING_MISSING`. Readiness can consume worker observations before Source subscription, so this is an actual producer/consumer mismatch, not a demand for new TF/UUID collection.

The synthetic fixture writes the same `clockMapping` array into both files (`tests/unit/r3-native-readback.test.ts:20` and `:22`), concealing the independent-origin behavior.

**Required correction:** correlate raw and Source observations using provider time while explicitly validating each origin and its 20 ms mapping, or another reviewed mapping that preserves the two clock domains. Do not require equal origin-relative ticks or conflate the two receive-monotonic clocks. Add a positive with worker startup observations before the first Source mapping and negatives for genuinely absent/inconsistent provider events. Keep TF/UUID/replay qualification not_run.

### L06-R1-I3 — The xArm adapter ignores the already-retained native inventory

**Location:** `source/scripts/r3-native-readback.mjs:58`, `:62`, `:75`; producer `source/robotics/manipulation/native_xarm/worker.py:17` and `:58`.

The xArm worker already writes `native-inventory.json` from the selected engineering profile before launch. The new reader neither requires this artifact nor reads it. Its profile/ISA admission uses manifest and mapping labels only. If an otherwise admitted X2 observation directory contains an unavailable inventory or an inventory for the other architecture, resealing declared artifact hashes still leaves `modelMapping:'tested'` and `sampleCoverage:'tested'`; deleting the inventory and removing its manifest reference is also not refused. Hashing a supplied inventory as an arbitrary artifact does not check its facts.

This contradicts the task's supported-observation admission boundary with exact profile/ISA/host identities. Unlike the missing restart/planning/contact collectors, the observation exists and has a shared profile-report reader already used by the new engineering adapter. An outer handoff inventory describes that handoff; it does not resolve a contradictory inventory inside an individual xArm run.

The overall native gate remains not_run, so this is **not** a demonstrated native-qualification bypass. It is an incomplete locally supported adapter and a misleading successful observation admission, which the R88 clarification explicitly does not excuse.

**Required correction:** require the retained run inventory, validate availability and its actual selected environment/ISA/OS through the applicable existing reader, and bind the supplied identities that the producer actually supports. Reject conflicting inventory rather than relying on copied labels. Retain the honest limits on installed-host authentication and vendor trust. Add coherent missing/unavailable/wrong-ISA inventory negatives after a valid X2 positive; do not add a new native collection phase to address this finding.


Execution and handoff requirements:

- Confirm each boundary against actual current producers before editing. Test realistic producer-shaped observations, not mutually fabricated labels. Write failing regression tests first; preserve genuine failing outputs and distinguish upstream-fixture failure from reaching the named boundary.
- I1 must preserve precision of the already-retained unquoted JSON integer tokens, including adjacent large integer order/reset differences; do not rewrite original observations, simply accept rounded Number values, or quietly change the producer protocol. Other sample validation stays strict.
- I2 must validate each implemented provider-to-tick origin and keep worker/Source receive-monotonic domains separate. Account for the actual raw event behavior during readiness rather than requiring synthetic identical arrays. Missing/inconsistent raw provider observations must remain refusals.
- I3 must use the existing applicable native profile reader, require/hash-bind the retained run inventory, and validate available environment/ISA/OS without claiming installed-host authentication. Add coherent missing, unavailable and wrong-ISA negatives after a valid X2 positive.
- Each check needs its own argv, cwd, relevant environment, exit/signal, start/end, immutable log/hash and before/after commit/status/changed-file hashes; no aggregate command status. Node 24.22.2 / pnpm 10.32.1; Python 3.11 existing environments, PYTHONDONTWRITEBYTECODE=1 and PYTEST_ADDOPTS=-p no:cacheprovider. Bound long commands. Do not silently change existing locks or environments. No original retained SQLite opens: verified copy only.
- Run focused regressions and affected public R3 integration, Source contracts/typecheck and scoped authored lint. Exact .superpowers/** lint exclusion is authorized to preserve ignored generated evidence bundles; do not claim an unqualified pnpm lint pass. Do not repeat full Source CI/final qualification in this fix stage.
- Commit Source fixes, make a clean fresh runtime export, import/sync and check/typecheck Lab, then commit its updated pin/headers. Any required runtime/closure/schema identity update must follow actual bytes. Preserve old export/cache and old B10 graph. No unrelated edits.
- Report original and fix bases, full final Source/Lab commits and clean status, complete scoped fix patches with byte sizes/SHA256, changed files, per-finding disposition, RED/GREEN counts with exact scopes (not summed), all check receipts, export/runtime/schema/native/portable/checker identities, full retention inventory and remaining limitations. Root will independently audit before a fresh scoped reviewer. If you find a direct dependency requiring a scope ruling, explain the concrete mismatch instead of inventing a waiver or broad rewrite.
