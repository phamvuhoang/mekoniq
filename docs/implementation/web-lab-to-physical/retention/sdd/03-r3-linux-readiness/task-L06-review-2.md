# L06 fix round 1 — independent scoped review 2

**Scoped specification verdict: PASS.** I1–I3 are resolved within the supported-observation tooling scope.

**Scoped quality verdict: APPROVE.** No new Critical, Important or Minor finding in the fix or its immediate integration. M1 remains open and centrally deferred for final triage, exactly as dispatched; this approval neither resolves M1 nor repeats the original full-task or final whole-branch review.

This approves the prepared tooling corrections only. Parent L06/B10, final clean-tuple CI/recording, native qualification, physical commissioning and human acceptance remain incomplete. Automated records retain `accepted:false`, dynamics/calibration remain `not_calibrated`, and the required unqualified cases remain visible.

## Reviewed scope and identity

Reviewed FIX_BASE Source `6bf54aa5cab5bc63bc32c1fae471606d71061a78` / Lab `c41f715bca9c224328879b44e3cbf5a296b59e06` through final Source `6e5eee9d7d504b0365422eb0ef7096e74e72e210` / Lab `283696be56bdaea1d310a1e56182f49792cf3b2c`. Independent Git HEAD/status reads matched both final commits and clean trees. No diff was regenerated or widened to the original task bases.

Read the requirements-first brief with all clarifications, complete original review, complete fix dispatch and complete append-only implementer report. Read both complete supplied scoped packages in bounded passes. Independently checked their byte counts and SHA256 values:

| Input | Bytes | SHA256 |
| --- | ---: | --- |
| `review-L06-r1-source.diff` | 23,431 | `a58d9f8bcbe33f7844feccaa75ea4c7e61308da325fce3209d31cb54cf889c5a` |
| `review-L06-r1-lab.diff` | 2,624 | `dd246e57e592e4d481161337db2c856cba245f65e3d814b2f62131aca6b253e4` |
| `task-L06-review-1.md` | 18,482 | `4035e927b721a4633da24f2a950e7e5eb644e4daab47affb68f1038e844c04ff` |
| `task-L06-report.md` | 31,598 | `f0236adbd71ffe0119f02d4f87d1321d9dd5133ee512e0f1dfe47c022ad36325` |

The Source package changes only `scripts/r3-native-readback.mjs`, its unit fixtures/tests and directly related recipient instructions. The Lab package changes only the runtime pin and two generated Source-commit headers; generated schema bodies are unchanged.

Focused outside-fix reads addressed named dependency risks: Python X1 integer emission and retained inventory production; worker health-event repetition and clock initialization; Source subscription timing, deduplication and its existing clock assessor; shared inventory-reader admission; exact xArm mapping identity; and whether BigInt values escape the observation reader or change public R3 case/gate derivation. Those reads were limited to the actual relevant producer, shared validator and immediate public-reader sections. They did not become a new native collector review.

No helper, product edit, suite/campaign rerun, Docker/cloud/native/browser/physical operation, or original SQLite engine open was performed. Only this review report was written. Recorded checks below are inspected evidence, not executions by this reviewer.

## Finding dispositions

### L06-R1-I1 — Resolved

**Fix locations:** `source/scripts/r3-native-readback.mjs:16`, `:89`, `:92`, `:93`; regression fixtures at `source/tests/unit/r3-native-readback.test.ts:81` through `:105`.

`xarmObservation` now uses the JSON parser's token source for `stampNs` and `clockNs`. Canonical nonnegative unquoted integer tokens are converted directly to BigInt; the rounded Number argument is never used to reconstruct nanoseconds. Quoted strings, fractional/exponent forms and negative values are not converted into accepted timestamps. Comparisons therefore preserve adjacent epoch nanoseconds, while safe sequence checks, finite vector/time checks, timestamp ordering, clock ordering, receive-time ordering and boot/epoch continuity remain in place. The parsed BigInts stay local to validation; the returned observation summary contains no BigInt requiring JSON serialization.

This matches `robotics/manipulation/native_xarm/ros.py:22`, `:48`, `:58`, `:67` and `worker.py:71`: X1 uses the system clock, constructs Python integer timestamps and emits them as unquoted JSON numbers. No producer protocol or original observations are rewritten.

The X1 fixture selects the proper mode/plugin/mesh mapping and passes the existing mapping and inventory boundaries before the sample checks. Its positive uses `1789999999123456789` and the adjacent integer, then checks the original observation bytes are unchanged. Four coherent negatives exercise stamp reset, repeated stamp, clock reset and clock-before-stamp. The first three assert the epoch/order error, preventing an upstream generic sample rejection from masquerading as targeted coverage. The existing small-integer X2 positive remains covered.

The RED positive fails at the original `R3_XARM_SAMPLE_INVALID` boundary; GREEN passes the exact-token positive and intended negatives. No unresolved I1 requirement remains in this scope.

### L06-R1-I2 — Resolved

**Fix locations:** `source/scripts/r3-native-readback.mjs:19` through `:27`, `:57` through `:62`; regression fixtures at `source/tests/unit/r3-native-readback.test.ts:106` through `:129`.

The raw-worker reader validates nonnegative integer-string provider/receive times, a safe nonnegative tick, its own first-provider-time origin and the producer's floor division by 20,000,000 ns. Provider time and worker-local receipts cannot decrease. Repeated provider timestamps are admitted with their unchanged tick, matching repeated health polling. Source's existing assessor still independently validates its own origin, strictly changed provider timestamps, receive-time ordering and 20 ms tick mapping. Cross-record correlation now uses exact provider time only; relative ticks and receive-monotonic values are not compared between processes.

The behavior matches `robotics/simulation/bridge/engineering_worker.py:105` through `:119` and `engineering_session.py:124` through `:135`. It also matches `packages/lab-runtime/src/v2/sil/engineering-native.ts:19` through `:25`, `:55` through `:74`, `:91` through `:92`, and the event-port/startup sections of `packages/lab-runtime/src/v2/backends/gazebo-nav2.ts`: worker health can emit before Source subscribes; Source retains changed timestamps from its own first observed event.

The positive fixture includes worker startup observations at 1,000,000,000 ns, duplicates before and after subscription, and a Source origin of 1,500,000,000 ns. Worker/Source ticks at that provider time are respectively 25/0, and their receipt domains deliberately differ. Eight coherent negatives target a missing provider observation, incorrect worker tick/origin, worker provider reset, worker receipt reset, incorrect Source tick/origin and Source receipt reset. Expected error assertions establish that the appropriate validation boundary is reached.

The raw validator's allowance for duplicates does not weaken Source's changed-time contract. Missing or inconsistent observations still refuse admission. TF payload semantics, action UUID correlation and semantic replay/isolation qualification remain `not_run`. No unresolved I2 requirement remains in this scope.

### L06-R1-I3 — Resolved

**Fix locations:** `source/scripts/r3-native-readback.mjs:76` through `:88`; regression fixtures at `source/tests/unit/r3-native-readback.test.ts:130` through `:144`.

`native-inventory.json` is now a required retained artifact. The pre-existing artifact loop checks its declared byte hash before inventory admission. The reader additionally requires `available === true` and calls `validNativeProfileReport(inventory, m.subjectProfileId)`. The manifest binds that selected engineering environment to the requested ISA; the existing mapping validator binds the same environment, architecture and Source/model identities.

`scripts/native-sim/profile-report.mjs:4` through `:10` validates the selected engineering profile, Linux, matching ISA, Ubuntu 24.04, Jazzy and the supported inventory/package/runtime/provenance structure. This is the applicable existing shared reader. `robotics/manipulation/native_xarm/worker.py:17` through `:19`, `:58` through `:59` retains the `inspect_profile` report before launch; `robotics/simulation/bridge/native_profile.py:134` and `:137` through `:139` confirm its identity shape. The correction does not invent a Source commit or host identity field that this inventory producer does not supply.

Every inventory negative first demonstrates valid X2 admission. Missing, unbound, unavailable, wrong-ISA, wrong-OS and wrong-environment variants then reseal the relevant artifact declarations and reach the intended missing-trace or inventory predicate. A separate unresealed mutation still reaches the artifact-hash refusal. The RED output demonstrates six prior erroneous supported-observation admissions, with full qualification still `not_run`; GREEN rejects them at the intended boundaries.

These are consistency checks of supplied reports and bytes. They do not authenticate the installed host, vendor tree, package origin or native execution, and the new documentation says so. No unresolved I3 requirement remains in this scope.

### L06-R1-M1 — Open, centrally deferred; unchanged

The arm64 MuJoCo case's per-case external-only blocker remains the original Minor finding at `source/scripts/r3-readback.mjs:18`, `:35`, `:73`. The aggregate tooling gap remains disclosed, but M1's requested per-case/blocker refinement has not been implemented. The dispatch explicitly excludes it from this Important-finding loop and carries it to final triage. This review does not silently resolve it or convert host assignment into an arm64 campaign implementation.

## Immediate regression assessment

No new Critical, Important or Minor finding was found. The scoped edits preserve the original review's relevant strengths: mandatory artifact readback, immutable required-case matrices, exact subject/checker distinction, strict new-record `accepted:false`, separate sidecar scope, verified-copy bag handling and explicit unqualified native/physical results. The public reader continues to consume summary observations, bind the slot's case/mode/seed and retain native limitations; the local BigInt representation does not reach its serialized result.

The shared historical qualification core, audited L01/B10 readers, native collectors, LinuxCNC reader and physical-preparation code were not changed by this fix. Existing full-review conclusions about those components are carried forward, not independently requalified here. The recipient instructions now accurately describe inventory requirements and both clock boundaries without claiming host authentication.

## Verification adequacy and exact limits

Inspected the actual regression fixtures, full retained RED output, GREEN and combined logs, the check index and own-exit receipts. Independently hash-matched all 15 receipt files and their log bytes against the root handoff/receipt declarations. The index has 14 entries; the final audit's own receipt is the fifteenth. An empty lint/diff log was accepted only alongside its own recorded exit 0.

| Invocation | Recorded outcome | Meaning |
| --- | --- | --- |
| `producer-red` | 18 failed / 19 passed, 37 total; own exit 1 | Old reader plus final regression-test bytes. Both producer-shaped positives reach the old blanket rejection. Six coherent I3 variants are wrongly admitted as supported observations. |
| `producer-green` | 37 passed; own exit 0 | Fixed reader and the same regression-test bytes, including all targeted I1–I3 boundaries and the 16 prior native-reader tests. |
| `combined` | Six files / 141 passed; own exit 0 | The final reader/test bytes plus public R3 directory/CLI/sidecar, historical qualification, native handoff, engineering, xArm and B10 coverage. |

These scopes overlap and are not summed. The three I1 ordering negatives and seven I2 mapping negatives in RED were stopped by the earlier blanket rejection; they are useful expected-boundary regressions, not ten independent historical admission bypasses. Clock-before-stamp, missing-provider and wrong-inventory-hash negatives already refused in RED. The I3 RED results never establish a native-qualification bypass.

The combined command is exactly `perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/unit/sim-extension-qualification.test.ts tests/unit/r3-native-readback.test.ts tests/unit/native-handoff.test.ts tests/integration/engineering-native-evidence.test.ts tests/integration/xarm-native-contract.test.ts tests/unit/r2b-readback.test.ts`. Its historical recorder test explicitly uses an owned fake Docker executable; it does not show installed Docker execution.

Full Source typecheck and contracts, scoped lint of the two authored code/test files, diff check, clean export, Lab import/sync/check-source/typecheck, both commits and the final audit have own exit 0. These are the requested fix-stage checks, not full Source CI or whole-tree lint. No Lab standalone script changed. The fixtures compile a portable model and create their own temporary synthetic SQLite bags; their contents do not establish ROS CDR semantics or native execution.

RED ran at FIX_BASE with only the test file modified. GREEN's receipt records the final reader hash `530db9125d9742aebf85d7097c140161122914c9589e5a2f1c3257ec2505ecd8` and test hash `b6fc5731e2d43e1d52ff72a4188d60cfbe634d5a7ae6be8ed0e4d64302614335`. Combined records those same code/test hashes and the final documentation hash. These pre-commit checked bytes are attributed to the final commit by the supplied root audit; they are not falsely described as tests started at the clean final HEAD. Export ran at the clean final Source commit, and Lab checks cover the final pin/header bytes before its commit.

The recorded runtime is `17bbdc1a92569f8fcb2de02b25e55ba3c774a515ca4f70ae917bd6e97964e3af`, raw export-manifest hash `82aa925b02054298610b1ab13eacea9a1ef816e063f7f223feee0fa053658010`, and final clean checker graph `2c65f80647bc1bca34be17954c67e2a6c180b830360ee7b6a90808036547246c`. The 58-schema aggregate `c2bdaca0b5ce9b03ee52a8c497719f4ea83b2cbb0e23c4e18365099fd163fa12`, native closure `35aebff4ba065eae48c088a91c94fd7a08af6fd723560e0fdb68cbdc112cce0b` (226 references) and portable closure `778c336cd3bcffa975cbea2967915f27fd5f94124ec986e75f2dac031d55df93` (238 references) remain unchanged.

Root's independent audit reports preservation of all 942 old indexed files, the original 17,523-byte report prefix and review 1, both prior runtime caches, and indexing of 98 new fix-evidence files. This reviewer checked the supplied package/report hashes and inspected the attribution/preservation record; it did not repeat the complete closure/old-file audit. Byte/receipt attribution is neither proof that each check exercises every behavior nor installed-host authentication.

## Cannot verify — inherited limits retained

1. **Actual native execution and host properties:** no Linux/ROS/Gazebo/xArm/LinuxCNC/MuJoCo host, native image/build/load provenance, per-host package/trust/install behavior, timing, motion/contact, isolation or security outcome was exercised here. A supplied available inventory is not authentication.
2. **Unimplemented or unobserved semantics:** engineering TF deserialization, action UUID correlation and semantic replay; actual xArm controller restart, collision-planned motion, G2 contact and bag action semantics; LinuxCNC controller timing/synchrony, comparable Cartesian/DH/TCP endpoints, observed controller accuracy, continuous motion/atomic fencing and terminal/GUI/package/trust qualification; complete per-profile DEP-SEC-01 and the arm64 MuJoCo campaign adapter remain open. Same-run reopen refusal is not controller restart, direct FJT is not collision planning, G2 unobserved is not demonstrated unsupported, and numerical parity is not controller accuracy. Host assignment alone cannot supply missing collectors/readers. M1 remains separately deferred.
3. **Final execution/recording:** the complete real R3 recorder at the final tuple, full Source CI/owned services, required Lab/browser/WEB05 checks, the final release recording chain and final prepared/native candidates remain pending. The recorded synthetic directory/CLI tests do not close them; parent L06/B10 remain incomplete.
4. **Authenticity and historical reproduction:** consistent JSON/hashes do not authenticate producer/checker/host identity or reviewer signature. This review does not audit the entire Git graph or reproduce historical records in separately provisioned exact-revision checkouts. Historical subject/checker identities must remain distinct from this fix and later publication commits; no old evidence is retagged.
5. **Original database behavior:** no original retained SQLite database was opened. Live WAL recovery, ROS CDR payload interpretation and original-database semantic replay were not verified. The unchanged copied-bag design and synthetic tests establish only their narrower scope.
6. **Publication and physical acceptance:** final post-fix retention/publication completeness, all renderer-specific links, dossier authenticity, calibration, commissioning, venue acceptance and G-HW gates remain unverified. The separate L05 prepared-code approval keeps its original tuple; PHYS-PREP-01/R3.2 are not requalified by this review. Human acceptance remains a separate hash/profile/scope-bound sidecar and cannot be inferred from this approval.

I1–I3 need no further correction in this scoped loop. Continue the established final-triage and clean-tuple recording sequence with M1 and the above limits explicitly retained.
