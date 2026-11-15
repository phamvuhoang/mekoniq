# L03 review 1 — spec compliance and task quality

**Spec-compliance verdict: NOT PASS.** The portable preparation is substantial, but R86/R87 have implementation defects and the required native X1/X2/X3 execution gates remain open. **Task-quality verdict: CHANGES REQUIRED.** Five Important findings; no Critical or Minor findings. Native readiness, contact readiness and human acceptance are not granted by this review.

## Review scope and evidence

Requirements were read first from `task-L03-brief.md`, including R78, R86 and R87, followed by the populated dispatch and complete implementer report. Reviewed the supplied complete original-base packages in bounded passes:

- Source `00d41e7f25ec1294b9bc8e8c81de3d8e1a869316` → `2a7ec9c89935649835fc08eee4ebe81fc6190cf0`, supplied package SHA-256 `b7e6d7b83e87e1bc54474845ebf5706c9c2eabfaf1fb23c1f51c788ff177fdab`.
- Lab `82b5f92005673c99ba0d1f434ae4c512800fa75e` → `020b818b6ce0b813c22b8826945a917fe4017816`, supplied package SHA-256 `9acb682f2669ddbc2ec57e29826c9afc927203f4b473d515dcd3bcf502883c29`.

Read `root-L03-handoff.json` and inspected the supporting evidence index. The root audit reports clean heads, 202 native closure members, 237 portable closure members, 57 schemas, 140 evidence files, and preservation of 86 + 63 prior L02 evidence files. These are local byte/receipt consistency statements, not native host authenticity or effective Git graph attestation. No full diffs were reconstructed. A few output-truncated portions were recovered in smaller reads; changed product files were otherwise reviewed through the packages.

The recorded test chronology is appropriately qualified: 136 TS / 92 Python precede later changes; 20 TS / 27 Python, then 13 TS / 28 Python cover the later focused scopes. These counts overlap. To check the concrete risk of overstated final evidence, inspected the retained `selfreview-ts`, `selfreview-python`, `final-mapping-ts`, `final-worker-python` and `combined-ts` log tails, plus the committed-identity X2 arm64 cancel refusal manifest. They agree with the disclosed scopes; the manifest is explicitly `not_run`, `accepted:false`, with missing OS/package/plugin/runtime/overlay reasons. Root reports final-byte attribution except the disclosed final EOF blank-line removal and later vendor whitespace attributes. Recorded contracts, typecheck, changed-files lint, export, import, sync and Lab checks passed. Historical full-repository lint remains unresolved; no full CI pass is inferred.

One focused, read-only semantic experiment was justified by a specific unresolved code doubt: whether both mapping implementations reject altered geometry and unsupported XML semantics. It imported only the local mapping validators under Node 24.22.2 and portable Python 3.11 with bytecode disabled. The supplied protocol fixture and all mutations remained in memory. It did not invoke a suite, ROS, Gazebo, xacro, Docker, cloud, hardware, or SQLite, and wrote no evidence/product files. Its results are recorded below. No helper agents were used. The only review write is this report.

## Important findings

### L03-R1-01 — Expanded geometry can change while canonical mapping still passes

**Severity: Important.** Locations: `packages/lab-runtime/src/v2/sil/xarm-mapping.ts:29`; `robotics/manipulation/native_xarm/mapping.py:35`; `robotics/manipulation/profiles/xarm6-native-mapping.json:370`.

The visual-mesh check compares only `mesh.filename`. It does not check the visual origin or mesh scale. Both validators accept adding `scale="1000 1000 1000"` to a canonical mesh, and independently accept a visual `<origin xyz="100 0 0" rpy="0 0 0"/>`. The TypeScript record validator also accepts each altered URDF with a coherently recomputed raw hash, matching subject/model/vendor/selector metadata and native-kind controller record.

This violates R87's independent verification of actual expanded geometry and R86's fail-closed handling of mismatched mapping. A canonical filename and source mesh hash do not establish the expanded geometry when URDF transforms/scales can change it. It is not a request to certify contact or collision geometry: the defect is in the explicitly claimed nominal visual geometry check itself. Check the pinned expected origin/scale semantics, including their defaults, and add coherently resealed negatives for both changes before treating mapping as resolved.

### L03-R1-02 — A mapping with an undeclared TCP link is accepted

**Severity: Important.** Locations: `packages/lab-runtime/src/v2/sil/xarm-mapping.ts:23`; `robotics/manipulation/native_xarm/mapping.py:22`; `tests/fixtures/xarm-native-protocol.urdf:93`.

The validators enforce expected joint attributes and uniqueness, but do not require every parent/child reference to resolve to a declared link or validate a connected, acyclic model graph. The supplied success fixture itself contains `joint_tcp` with child `link_tcp` and no `<link name="link_tcp">` declaration. Both validators accept it; the TypeScript validator accepts a native-kind mapping record over those bytes as well.

A missing tool-frame link is malformed model data, not a valid static mapping whose execution merely remains pending. It directly defeats the R86 malformed-artifact refusal and tool mapping requirement. Validate the complete expected link/joint graph, permitted attachment/world additions and referential integrity; make the protocol positive fixture structurally valid and retain the missing-TCP case as a negative. Separate native environment blockers do not repair an incorrectly cleared mapping prerequisite.

### L03-R1-03 — Plugin and control mapping is not closed as R86 requires

**Severity: Important.** Locations: `packages/lab-runtime/src/v2/sil/xarm-mapping.ts:31`; `robotics/manipulation/native_xarm/mapping.py:43`; `tests/fixtures/xarm-native-protocol.urdf:97`; `docs/operations/xarm-native-sim.md:48`.

Only the text of each `ros2_control/hardware/plugin` is checked. The readers do not validate the associated control joint/interface mapping or inspect Gazebo plugin declarations. In the focused check, appending `<gazebo><plugin name="unapproved" filename="libunapproved.so"/></gazebo>` passed both validators and passed the coherently resealed native-kind TypeScript record validator. The positive fixture also supplies a `ros2_control` block with no joint/interface entries and is accepted. A controller metadata array saying `joint1`…`joint6` does not independently validate the raw control definition.

R86 calls for a closed joint/tool/plugin semantic reader. The operations document explicitly says unexpected simulation plugins fail closed, which is false for the observed case. This is a static admission defect; the review does not claim the reader executes the injected plugin or that host/package gates were bypassed. Define and verify the expected mode-specific control blocks and permitted Gazebo/mimic declarations, including their joint bindings, or retain a distinct unresolved prerequisite for any deliberately unvalidated scope. Unapproved declarations must not silently receive a successful mapping result. Add native-kind resealed negatives, not just a changed hardware plugin string.

### L03-R1-04 — Lost ACK is recorded as a non-executed prerequisite refusal

**Severity: Important.** Location: `packages/lab-runtime/src/v2/sil/xarm-cli.ts:22` and `packages/lab-runtime/src/v2/sil/xarm-cli.ts:35`.

`accepted` is assigned only from `ack.accepted`; both catch paths choose `executed/fail` versus `not_run/blocked_external` solely from that boolean. If a command is durably dispatched and its ACK is lost, the provider correctly returns `{accepted:false, unknown:true}` and forbids retry. The CLI then throws and records the attempt as `not_run/blocked_external`, even though the controller may have accepted and executed it. An action-server rejection after actual native startup is also conflated with a host prerequisite refusal.

This loses the distinction between an unmet preflight prerequisite and an attempted command with unknown outcome, and contradicts the documented exit semantics. The six retained real preflights are legitimate `not_run` cases; this finding concerns an untested post-dispatch path, not those records. Track admission/startup/dispatch separately from successful acknowledgement. Preserve unknown command attempts as attempted/executed failures or an explicit unknown outcome with the command receipts, and reserve `not_run` for phases actually not attempted. Add a CLI-level lost-ACK case.

### L03-R1-05 — Required native execution and contact qualification are unfinished

**Severity: Important — external completion gap.** Locations: `docs/operations/xarm-native-sim.md:3`, `docs/operations/xarm-native-sim.md:33`, `robotics/manipulation/profiles/xarm6-jazzy-sim.json:16`, `robotics/manipulation/native_xarm/policy.py:56`; supporting task report “Actual execution and not_run scopes.”

The task requires actual ROS FakeSystem/FollowJointTrajectory X1, Gazebo/Harmonic X2 with native outcomes and stop/restart coverage, and the ten-trial G2 contact spike X3 (or an observed unsupported result with reason). None ran. Installed package/plugin locks remain unresolved, the public `restart` case only tests same-run reopening refusal, and `assess_contact()` always retains the unobserved G2 blocker. The six CLI refusals and protocol doubles cannot satisfy DEP-XARM-01/02/SEC-01 or DEP-XARM-03.

The implementation report is candid and the closed admission is correct. There was no assigned native Linux host, so this is not a recommendation to bypass authorization or fabricate evidence. It is nevertheless an unmet plan requirement, not a spec pass. Keep the task/gates explicitly incomplete until an authorized matching host supplies actual expansion/readback, installed provenance, motion/fault/stop/restart evidence and contact trials or an observed unsupported verdict. Source code preparation and externally blocked native qualification may be tracked separately, but neither is a completed native gate.

## Requirement disposition

“Met” below means supported within the reviewed preparation scope, not native qualification. “Finding” identifies an unmet requirement or concrete defect. “Cannot verify” identifies evidence this review cannot establish; it does not imply a pass.

| Requirement | Disposition | Evidence and limit |
| --- | --- | --- |
| Required native lock, profile, worker/client/observer, provider, tests and operations documentation | Met | All are present in the Source package. A fixed server CLI reaches the provider. |
| `createXarmSimProvider(serverConfig)` returns existing typed adapter and observations | Met, preparation scope | `CellAdapter`/`ArmStatusLike`, fixed program and separate contact refusal. Native integration remains unexecuted. |
| Immutable server-owned model, joint map, tool limits, launch/action; no browser IP/shell/arbitrary launch parameters | Met | Closed config keys, fixed program hash, fixed action and argument builder; no browser provider set added. Source-root check for native transport. |
| Fake/double and Gazebo evidence kinds distinct | Met | Injected ports are forced to `protocol_double`; X1 is `ros2_fake_system`, X2 `gazebo_actual`. CLI not-run kind denotes requested mode, explicitly documented. |
| Unit/sign/order/FK checks against R2a | Met, portable scope | Reordered positive-radian mapping and golden flange FK tests; recorded independent RTB comparison. Actual expanded/native TCP parity remains Cannot verify. |
| Missing feedback, stale sequence/epoch, lost result/ACK, timeout and restart refusal | Met, protocol scope | Python/TS negatives and durable fatal latches; no resend after uncertainty. Real native fault matrix remains finding L03-R1-05. |
| Correct classification of uncertain native attempts | Finding | L03-R1-04. |
| Exact Jazzy commit, submodule, source SHA-256/Git identities, license/NOTICE | Met, source inspection | Separate native lock and retained snapshots; source byte parity explicitly limited. |
| Real distro/package/plugin locks and qualified installation | Finding / Cannot verify | Unresolved by design; L03-R1-05. Source commit is not substituted for installed closure provenance. |
| Preserve R2a `vendor.lock.json` and explicit G2/1305/source-native mapping | Met for preservation and explicit mapping data | No old asset-lock change in complete package; root preservation audit agrees. Mapping validation defects are L03-R1-01/02/03. |
| X1 actual FakeSystem, finite trajectory/limits/cancel/result/freshness/no retry | Finding | Portable implementation/tests exist; actual X1 did not run. L03-R1-05. |
| X2 actual Harmonic path, commanded/actual joints/TCP/clock, planning/collision settings, full outcomes | Finding | Correct `gz` branch and expected hardware plugin are selected; observation/readback/bag preparation exists. Direct FollowJointTrajectory is explicitly not collision-planned motion. Actual execution/settings/coverage unverified: L03-R1-05. |
| X2 no fake fallback | Met | Native refusal occurs before ROS import/process launch when preflight fails; no automatic transport substitution. |
| Native stop/restart qualification | Finding | Public restart = successful cancellation then durable same-run refusal, not controller restart experimentation. L03-R1-05. |
| X3 ten G2 grip/release trials, support/receiver observations, collision provenance | Finding | 0/10; structural assessor is permanently blocked. No demonstrated unsupported result. L03-R1-05. |
| Alternate tool must be a separate profile, never relabeled G2 | Met | No substitute tool introduced; explicit G2 selection/provenance. |
| Source capability admission only for implemented/ready scope; motion/contact independent | Met | `moveit_gazebo_arm` remains unavailable, engineering-contact also retains its unimplemented process dependency; no physical `xarm_native` in Lab. |
| Contract tests followed by native cases and profile-scoped evidence | Met for portable checks/refusal records; Finding for actual native cases | Root audit and inspected logs support recorded tests/export/pin. L03-R1-05 prevents full completion. |
| R78 native_apt versus OCI provenance separation | Met in implementation; actual provenance Cannot verify | Worker uses L02 profile inspection; unresolved apt/plugin/overlay conditions remain blockers; no borrowed architecture or OCI bypass shown. |
| R86 optional role with exactly two artifacts and old-role compatibility | Met | Optional schema/generated type, exact two source paths, only xArm kind; absent mapping remains unresolved. |
| R86 bounded paths/hash/size/subject/secret handling and immutable closure separation | Met within diff/recorded checks | Role uses existing generic ref handling, extra size limits, both closure match sites and bySource lookup exclude generated refs; coherent closure-confusion tests present. Existing generic security implementation itself is outside this task diff. |
| R86 closed raw semantics, malformed/mismatched artifacts rejected | Finding | L03-R1-01/02/03. Static successful parsing cannot currently be treated as complete mapping consistency. |
| R86 subject/profile/model/vendor/producer/evidence kind binding | Met for checked metadata | Expected top-level provenance, mode-kind checks and coherent resealing negatives are present. Static consistency does not authenticate the claimed producer/host. |
| R87 fixed synthetic selector, pinned decoder, 1305/HT_BR2 explanation and wrong/older selector tests | Met | `XI13050520BB00`, fixed `robot_sn` argument, pinned decoder bytes, exact preflight decode and tests. Explicitly not a device identity or commissioning datum. |
| R87 independent actual expanded limits/geometry/inertia | Finding / Cannot verify | Limits and nominal inertia comparisons exist; geometry validation incomplete (L03-R1-01), actual expansion did not run (L03-R1-05). |
| Source commit → clean export → Lab re-pin | Met by supplied package and recorded audit | Final commits, clean export, exact artifact/schema/portable digest and Lab generated-header sync agree. No broader Git graph attestation inferred. |

## Global constraints and boundaries

| Constraint | Disposition |
| --- | --- |
| B00/R2a handoff dependency and preservation of prior R2a behavior | No R2a edits shown; historical B00 completion/entire ancestry Cannot verify from this task diff. Recorded scoped regression checks are not a universal behavioral proof. |
| Node/pnpm/Python versions and no portable rclpy installation | Met by recorded environment and prepared separation. Reviewer focused checks used Node 24.22.2/portable Python with bytecode disabled; no native interpreter claim. |
| Preserve pinned MuJoCo engine and 20 ms / 10 × 2 ms baseline, UI speed only pacing | Met for no change to portable engine/tick/UI. Native observer polling is separately described; native timing parity is not claimed. |
| Source authority; Lab simulation/replay only | Met in diff. Lab changes are the runtime pin and generated provenance headers. |
| One active world/in-flight ACK; unknown does not trigger resend/respawn continuation | No new MuJoCo-world path; worker lease/private partition and session single-flight protections present. Native effectiveness Cannot verify. Lost-ACK evidence labeling defect is L03-R1-04, not a demonstrated resend. |
| Optional/versioned fields, legacy behavior and archive compatibility | Additive optional role; recorded handoff/routing suites support scoped compatibility. Unchanged mock/IR-SIM/Webots bytes are not regenerated in this diff; broad behavior Cannot verify beyond provided checks. |
| SI/frame/model mapping; uncalibrated dynamics; vendor attribution | Explicit SI/joint/frame projection, `not_calibrated`, license/NOTICE. Expanded-model fidelity findings remain. No Source-cell/native-world placement equivalence asserted. |
| UI translations/a11y/reduced-motion/2D/no-runtime; no new framework | No UI/framework behavior changes in the packages. |
| Do not alter trial/web/operational ports/runtime data/historical evidence to clear gates | No such changes in supplied packages; root preservation audit reports historical evidence intact. Review did not access historical SQLite. |
| Automatic accepted:false; skip is not_run; human sidecar tied to subject/profile | Automatic records remain false and native skips are explicit. No human signoff is introduced or claimed. Human sidecar implementation is outside this diff. |
| No deployment, paid provisioning, real commissioning or robot execution | No such behavior in this change or this review. Native simulation remains blocked. |

## Strengths

- The report accurately separates prepared code, protocol doubles, source-byte parity, native observations and human qualification. It preserves failed checks and states the final-byte/overlapping-suite limits.
- Fixed server configuration, durable intent before I/O, one-flight guards, source-root checking, no retry after unknown and no same-run resume form a coherent refusal-first design.
- R86's dedicated generated-artifact role avoids corrupting canonical model singularity or immutable tool closure semantics; both closure-matching sites are covered.
- R87 addresses the actual pinned upstream selector trap rather than assuming `model1300:false` selects 1305, and keeps the synthetic value out of physical commissioning claims.
- Source export and Lab pin are scoped, with no runtime/browser hardware enablement. Contact stays independently closed.

## Cannot verify from the diff or supplied local records

Actual Linux apt/overlay/plugin identities; X1/X2 launch and ROS service compatibility; expanded URDF produced by real xacro; controller and TF timing/endpoint behavior; native cancellation, controller restart and lost-result injection; native trajectory outcomes; complete/continuous native bag capture or independent replay; G2 mimic/contact physics and collision behavior; ten native contact trials; calibration, hardware behavior, physical commissioning, human acceptance; full effective tool Git graph attestation; and a full repository CI pass. These remain unproven. Where the task expressly requires them, they are also the open completion finding L03-R1-05 rather than silently accepted “Cannot verify” items.

## Focused experiment record

Input: `tests/fixtures/xarm-native-protocol.urdf`, labeled protocol double. Python called `validate_urdf`; TypeScript called `validateXarmUrdf` and then `validateXarmMappingRecord` with a freshly computed URDF digest, exact expected subject/model/vendor/selector fields, `evidenceKind:gazebo_actual` and the currently accepted controller-readback shape. No evidence file was produced or represented as native.

| In-memory case | Python producer validator | TypeScript raw + resealed record validators |
| --- | --- | --- |
| Original fixture, missing declared TCP link | Accepted | Accepted |
| First visual mesh scaled 1000× | Accepted | Accepted |
| First visual moved 100 m | Accepted | Accepted |
| Added unapproved Gazebo plugin declaration | Accepted | Accepted |

Both focused processes exited 0. That confirms the admission defects; it is not a passing qualification test. Existing suites were not rerun, and no code fixes were made.
