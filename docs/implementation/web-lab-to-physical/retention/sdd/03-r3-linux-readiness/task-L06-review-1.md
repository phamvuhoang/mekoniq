# L06 tooling — independent full task review 1

**Tooling spec verdict: FAIL — changes required.** The fixed matrix, mandatory public artifact readback, recorder, sidecar and supported directory adapters are present. The supported L02/L03 readback boundaries nevertheless have the locally correctable defects below.

**Tooling quality verdict: REQUEST CHANGES.** Three Important findings and one Minor finding; no Critical finding. None requires a new native collector phase, assigning a host, running Docker or operating hardware. This review cannot complete parent L06/B10, final recording, native qualification, physical commissioning or human acceptance.

Reviewed original bases Source `ac9b44dc1bf01bce2406b6f91ac3e141c043c739` / Lab `47343f930b712dd6ac64ed7cd874de3c0aca2188` through final Source `6bf54aa5cab5bc63bc32c1fae471606d71061a78` / Lab `c41f715bca9c224328879b44e3cbf5a296b59e06`. Independent HEAD/status reads matched both final commits and clean trees.

## Scope and evidence

Read the ready dispatch, requirements-first L06 brief including all appended clarifications, complete L06 implementer report, complete original-base Source and Lab packages, authoritative B10 interfaces, B10 report with appended fix handoff and both B10 reviews. Read the packages once in bounded passes; no replacement diff was generated. Independently hashed the supplied Source package (84,545 bytes, `4ac415e85c23c580768752b0cbd1235f3c52cab34196c39708f7793736f0a04c`), Lab package (2,624 bytes, `beb0f7c6a3f877d42364f988d31792b85fb4ec1e3d1de2946ef9021bbcec40c3`) and L06 report (17,523 bytes, `ed6d841eb0fddf80ba9010d7e59e82c02bcc2d9f9b33f15bbaeea0da94598165`).

Focused outside-diff reads addressed concrete integration risks: xArm timestamp representation and retained inventory production; engineering clock origins, event delivery and retained manifest shape; the copied-bag inventory boundary; the strict existing LinuxCNC trace consumer; and the actual recipient commands/readback/cleanup references. These were code/document reads, not native observations. A few initially named dependency paths did not exist; focused searches located the actual consumers. No missing evidence was recreated.

Read root handoff identity, receipt, attribution and preservation summaries, the check index and relevant retained log results. Root's independent audit attributes all 11 Source / 3 Lab final file bytes, 35 own-exit receipts, export/cache/pin, 226 native / 238 portable references, 58 schemas and 806 preserved prior files. That is attributed byte/receipt evidence, not my rerun, behavioral coverage of every file, or host authentication. The native/portable/schema closures are unchanged from B10. The runtime is `574ab85f8db59a87d0da22bc9706e07c13e92e70821d0187f6d6aa31b270ffd7`; the recorded final checker graph is `8d569ad7b3a9bd39b7dd4f5d12f0f2a88a7b7572ff271a4fe7bd01f32e856e5c`.

No suite, Docker/native/browser/cloud/physical operation, original SQLite open, helper agent or implementation fix was performed. Only this review report was written. Findings below are established by the supplied implementation and focused producer-code comparison; no new execution result is claimed.

## Important findings

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

## Minor finding

### L06-R1-M1 — The arm64 MuJoCo case reports only an external prerequisite despite its known adapter gap

**Location:** `source/scripts/r3-readback.mjs:18`, `:35`, `:73`.

For `mujoco-linux-arm64`, `DEP-MJ-01` keeps `category:'external'` and reason `ASSIGNED_HOST_CASE_ARTIFACTS_MISSING`. The missing arm64 campaign adapter is added only to the aggregate `capabilities.toolingLimitations`. The per-case row, `blockedNativeCases` and native-gate blocker consequently tell a recipient that this case only lacks host artifacts, although assigning a host cannot supply the absent adapter.

The runbook and aggregate capability are honest, and the native gate does not pass. Still, the brief specifically requires tooling gaps to remain explicit in returned profile/case/level results. Give this case a tooling-and-observation disposition naming the arm64 adapter gap, preserving absent-host prerequisites separately. Add a prepared arm64 assertion that checks the case and gate blocker, not only the aggregate limitation list.

## Strengths and requirement assessment

- The authoritative six-profile matrix returns fresh copies and keeps prepared, motion, contact, terminal and full separate. Required cases cannot be lowered through caller pass lists. Motion does not remove contact from the complete case inventory; terminal keeps the additional full-scope package/GUI case visible. No architecture or arm branch closes another's gate.
- New R3 records require `accepted:false` and null reviewer fields. The historical synchronous entrypoint explicitly refuses structure-only R3 qualification; recorder, offline CLI and acceptance use the asynchronous directory reader. Derived cases, gates, blockers, levels and capabilities are recomputed, and the outer inventory is compared before and after readback. Historical accepted compatibility remains at its original scope.
- The recorder has the requested flags, a probe-free fixed-table plan, clean Source/checker and matching Lab pin checks, fresh external output, bounded input copying and stability checks. It does not launch native/browser campaigns. Its complete final invocation remains deliberately deferred. Lab changes are only the pin and two generated commit headers; schema bytes are unchanged.
- Sidecars bind exact qualification bytes, candidate/profile/ISA/scope, reviewer/time and decision while leaving automated acceptance false. The CLI correctly describes this as consistency/binding verification, not signature or authorship authentication. Neither sidecars nor prepared results promote physical scope.
- MuJoCo historical/current records delegate to the audited public L01/B10 paths, and optional R2b input delegates to `verifyR2bDirectory`. No weaker browser/WEB05 verifier was introduced. Exact historical checker mismatch remains a refusal; the runbook separates exact-revision reproduction from a new authorized historical-subject campaign. Image/config/platform/package/companion identity requirements are inherited rather than replaced by a summary.
- SQLite is opened only on an owned verified byte copy. The reader refuses WAL/SHM inputs for the selected bag and cleans only its temporary directory. Topic/time counts are explicitly not TF/action payload semantics. No original database was opened in this review.
- The recipient sequence links existing profile installation/doctor/case procedures, distinguishes run directories from campaign envelopes, gives recorder/readback/acceptance and external-sidecar commands, and preserves owned cleanup, immutable rollback and uncertain-action no-resend rules. It does not imply host assignment alone resolves the named tooling gaps.

## Disposition of the six inherited limitations

1. **Engineering TF/UUID/semantic replay:** these are real missing verification capabilities, not host-only prerequisites. The matrix leaves DEP-NAV cases required and not_run with tooling reasons. This is appropriate under the clarification excluding a new collector phase. I2 is separate: supported clock observation readback must work with its existing producer.
2. **xArm restart/planning/G2:** the matrix correctly treats reopen refusal as something narrower than controller restart, direct FJT as narrower than collision-planned motion, and unobserved G2 as unobserved rather than proved unsupported. X3 remains required for contact/full. I1/I3 are defects in the claimed supported X1/X2 adapters, not requests to complete those deferred collectors.
3. **LinuxCNC timing/Cartesian/fencing/install/trust:** the wrapper consumes the actual `actual-joint-trace.json` through the strict existing model/frame/unit/sample validator and preserves epoch segments. It does not rerun an oracle or promote a numeric verdict/native_capture label to ALG04. The missing controller observations and terminal/GUI/package/trust readers are explicitly open; immutable R89 closure membership does not authenticate an installed controller.
4. **DEP-SEC-01:** no complete host producer/reader is supplied. The case stays required with an explicit tooling-and-observation reason; doctor JSON, Docker flags and portable tests cannot close it. Consequently none of the native required scopes can currently qualify. This is an accurately exposed inherited limitation under the clarified tooling scope, not a native gate waiver.
5. **arm64 MuJoCo:** amd64 adapters cannot qualify arm64. The capability/runbook disclosure is correct; M1 requires that same distinction in the case/blocker output. Implementing a new arm64 campaign is not requested as this review fix.
6. **L05 / PHYS-PREP-01 / R3.2:** the separate L05 prepared-code approval remains valid at its own tuple and scope. This recorder does not requalify its conformance or authenticate dossier references; its PHYS-PREP-01 and R3.2 remain not_run. That is a conservative record boundary, not evidence that L05 was never reviewed or that physical preparation/commissioning has been executed here.

## Verification adequacy and exact tested-byte limits

The retained `combined-final` log reports six files / 119 tests before the optional-native-closure refinement. The later complete R3 selection reports 21 passed / 26 filtered (not_run), followed by final full Source typecheck and scoped lint of the two affected files. Earlier whole authored-tree lint used exactly the narrow `.superpowers/**` exclusion. The clean final checker test reports one passed / 46 filtered and reaches B10's audited reader. These overlapping scopes must not be summed or described as a final full CI pass.

The initial R3 RED did demonstrate historical R1 fallthrough with `issues=[]`; missing-module directory creation is only creation-stage evidence. The first xArm RED failed on an upstream X1/X2 fixture mismatch. Its corrected second RED tests observation admission while native qualification stays not_run. Relocation and optional-closure RED/GREEN records are distinct genuine regressions. L06 receipt `argv`/`logSha256`/before-after attribution is distinct from B10's receipt shape; the 35th final audit receipt follows the 34-entry implementer index.

Current tests cover useful semantic rejections with coherent resealing, copied-directory reproducibility and sidecar binding. They do not cover producer-shaped X1 epoch timestamps, independently initialized engineering clocks, or contradictory xArm run inventory. The documented checks therefore do not resolve I1–I3. No new tests were run during this review.

## Cannot verify from this diff/review

1. Actual Linux/ROS/Gazebo/xArm/LinuxCNC/MuJoCo execution, native image/build/load provenance, per-host package/trust/install behavior, timing, motion/contact results, isolation or security outcomes. No host was assigned or exercised.
2. TF payload semantics, action UUID correlation, controller restart/collision planning/G2 support, LinuxCNC synchrony/Cartesian/controller accuracy/atomic fencing, full DEP-SEC-01 or arm64 campaign behavior. Explicit refusal is not evidence those features were executed or demonstrated unsupported.
3. The complete real R3 recorder at the final tuple, final Source CI/owned services, required Lab/browser/WEB05 checks, the final release recording chain, or final prepared candidates. Recorded synthetic directory/CLI tests do not establish those deferred outcomes.
4. Authenticated producer/checker/host identity or reviewer signature merely from consistent supplied JSON/hashes; the entire Git graph; exact historical reproduction in a separately provisioned checkout. Root's byte audit does not establish these properties.
5. Original retained SQLite behavior, live WAL recovery or ROS CDR semantic replay. No original database was opened; source inspection establishes the intended copy/read-only design only.
6. Final post-fix retention/publication completeness, all renderer-specific links, or physical dossier authenticity, calibration, commissioning, venue acceptance and G-HW gates. Historical records and separate L05 approval must retain their original identities.

Fix I1–I3 and review their coherent portable regression evidence before approving L06 tooling. Carry M1 into that correction or explicit tracked disposition. Preserve the existing final-recording sequence and all native/physical limits; this task review is not the final whole-branch review.
