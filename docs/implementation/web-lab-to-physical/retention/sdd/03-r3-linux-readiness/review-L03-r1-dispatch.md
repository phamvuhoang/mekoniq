You are reviewing L03 fix round1 only. Full task review already occurred; do not repeat it or regenerate original-task diffs.
Read requirements first: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L03-brief.md, including R86/R87/R88.
Read full original review: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L03-review-1.md.
Read appended fix report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L03-report.md; preserve initial-report chronology.

FIX_BASE (the previous full-reviewed heads): Source2a7ec9c89935649835fc08eee4ebe81fc6190cf0 / Lab020b818b6ce0b813c22b8826945a917fe4017816.
Final HEADs: Source7b5b3a17e501f125efac18749ad5b8123940ce7c / Lab58d082a9d57ea9216fa123ebb5d676ae1421b550.
Source fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/review-2a7ec9c..7b5b3a1.diff (164952 bytes, SHA256 35e94c0f98c001f675573c54cb0b9a99d0c8b38a9170f168540357e166cb2d3e).
Lab fix package: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/03-r3-linux-readiness/review-020b818..58d082a.diff (3475 bytes, SHA256 79e19871537c145d01790b6b706ab244a71ec1d4df29ecdf59218c94b540b82d).
Root audit/own-exit checks: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/root-L03-r1-handoff.json (17730 bytes, SHA256 39210616fec7978e7dec9e67a3bf57b8bb8d2fd1a552046d91e4188a5e8de2fa); independent local byte/receipt audit passed, evidence file index root-L03-r1-evidence-file-index.json. Read report/check limits: 123 TS /37 Python before numeric refinement; final focused15 TS/12 selected Python, overlapping counts. Original and intermediate tuples preserved. No native execution or effective Git graph attestation..
All dispatch identities are filled; review scope covers both fix commits and both Lab pins, never HEAD~1.

Verbatim findings:
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



Scope disposition: R88 keeps R1-05 an explicitly unmet native qualification gate, not an addressed implementation result. Verify and report that limitation; do not grant native pass. The prepared-code fix gate requires each of R1-01 through04 addressed and no new fix-introduced Important/Critical breakage. Assess any locally actionable preparation gap distinctly from unavailable host execution, with the unchanged requirements and R88 as the scope boundary.

Read only the supplied fix packages once in bounded passes. Each includes the complete fix range, commits and context. Check each original code finding and new breakage introduced by this fix. Untouched-code observations go to a clearly labeled nonblocking out-of-scope section for final whole-branch triage. Named outside-diff context reads require a specific doubt; do not broadly crawl the repository. Do not rerun covering suites on the same bytes; only a specific unresolved code doubt justifies a focused read-only probe. Report missing/unreadable evidence, not silently recreate it.

Read-only product/index/HEAD; no fixes, helpers/subagents/reviewers, native services, Docker, cloud, hardware, original SQLite or evidence rewrites. Write only /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/03-r3-linux-readiness/task-L03-review-2.md. Native absent remains not_run/blocked_external; accepted:false, dynamics:not_calibrated, no Lab hardware routes. Preserve Source authority/unknown/no-resend, optional old-reader compatibility, canonical R2a model/locks, R86 generated-versus-immutable closure distinction and R87 synthetic selector versus physical identity. A protocol double or static mapping cannot qualify host/motion/contact.

Return explicit per-finding ADDRESSED/NOT ADDRESSED with file:line evidence, new fix-introduced findings with severity, out-of-scope observations and verdict for prepared-code gate plus separately incomplete native qualification. R1-05 must not be falsely declared addressed. Full report in the path above; short final with verdict/findings/path. No full-task review redo.
