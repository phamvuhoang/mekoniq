# L03 fix round 1 scoped review

**Prepared-code gate: PASS with one nonblocking Minor finding (L03-R2-01).** L03-R1-01 through L03-R1-04 are **ADDRESSED**. No fix-introduced Important or Critical defect was found in the reviewed range.

**Native qualification: INCOMPLETE / NOT PASS. L03-R1-05 is NOT ADDRESSED.** R88 separates this unmet native gate from the prepared-code gate; it does not waive X1/X2/X3 requirements or grant native motion/contact readiness. Automatic acceptance remains false and dynamics remain not_calibrated.

## Scope and evidence

Read the filled dispatch first, then the requirements including R86/R87/R88, the full original review and the full implementation report with its appended fix chronology. This is a fix-only review, not a repeat full-task review.

Reviewed both complete supplied packages once in bounded passes:

- Source `2a7ec9c89935649835fc08eee4ebe81fc6190cf0` → `7b5b3a17e501f125efac18749ad5b8123940ce7c`, including `97af81b` and `7b5b3a1`; package 164,952 bytes, SHA-256 `35e94c0f98c001f675573c54cb0b9a99d0c8b38a9170f168540357e166cb2d3e`.
- Lab `020b818b6ce0b813c22b8826945a917fe4017816` → `58d082a9d57ea9216fa123ebb5d676ae1421b550`, including both pins `4a32dc9` and `58d082a`; package 3,475 bytes, SHA-256 `79e19871537c145d01790b6b706ab244a71ec1d4df29ecdf59218c94b540b82d`.

Independently checked both package hashes and the supplied root audit hash (`39210616fec7978e7dec9e67a3bf57b8bb8d2fd1a552046d91e4188a5e8de2fa`). Read `root-L03-r1-handoff.json` and inspected its evidence index. Both product worktrees reported clean status. The audit attributes final bytes to the relevant checks and retains original/intermediate tuples and evidence. These are local byte/receipt consistency statements, not effective Git graph attestation or host authentication.

Inspected retained final TS/Python and numeric-refinement log tails: 123 TS / 37 Python preceded the refinement; later 15 TS / 12 selected Python cover the later changed bytes, with 26 Python cases deselected. Counts overlap and are not additive. Earlier contracts/typecheck/changed-file lint and final export/import/sync/Lab checks are recorded as passing. No full repository CI or full lint pass is inferred.

Targeted outside-diff context was limited to the retained gripper macro/control/Gazebo snapshots, to establish whether the new static extension expectation matches their actual declarations, and the provider refusal/ready/close paths, to establish whether the CLI's preflight classification corresponds to the existing transport signal. No full original-task diff was reconstructed. No suites, services, xacro, native execution, Docker, cloud, hardware or SQLite access were performed. One specific read-only numeric equivalence probe is documented below. No helper agents were used. This report is the only review write.

## Original finding dispositions

### L03-R1-01 — ADDRESSED

`packages/lab-runtime/src/v2/sil/xarm-mapping.ts:62` and `robotics/manipulation/native_xarm/mapping.py:60` now validate the visual mesh's origin xyz/rpy and scale against pinned identity transforms/unit scale, treating omitted URDF defaults equivalently. They reject duplicate origins, extra mesh geometry and unexpected mesh attributes; links without an expected visual cannot acquire one. The projection preserves canonical mesh identities and adds explicit expected transforms.

`tests/integration/xarm-native-contract.test.ts:100` includes altered scale/displaced origin cases through both the raw reader and coherently resealed native-kind records. The mode/default positives at line 112 and Python tests at `robotics/manipulation/tests/test_native_xarm.py:233` and line 241 cover both modes, explicit defaults and altered rotation. This closes the reported nominal visual geometry defect. It does not certify collision/contact geometry or establish that native expansion occurred.

### L03-R1-02 — ADDRESSED

`packages/lab-runtime/src/v2/sil/xarm-mapping.ts:48` requires the exact expected joint count and attributes; line 58 checks the exact link set and declared endpoints, followed by traversal from the pinned world root. Python applies the corresponding graph checks at `robotics/manipulation/native_xarm/mapping.py:48`. Duplicate children/names remain rejected.

The projection and protocol fixture now declare TCP, world/world_joint and link_eef/joint_eef. The identity end-effector alias matches the supplied pinned device macro and preserves the canonical flange/tool transform; it is not a replacement R2a model. `tests/fixtures/xarm-native-protocol.urdf:102` contains the formerly missing declarations. Missing TCP/world/eef, orphan, extra/cyclic/dangling/altered joints and collapsed gripper attachment are rejected by the added tests cited above. The positive fixture remains explicitly synthetic.

### L03-R1-03 — ADDRESSED

`packages/lab-runtime/src/v2/sil/xarm-mapping.ts:31` and `robotics/manipulation/native_xarm/mapping.py:71` compare complete normalized extension trees against `robotics/manipulation/profiles/xarm6-sim-extensions.json:3`. This binds both ros2_control blocks, arm and drive_joint interface/limit definitions, seven transmissions, Gazebo selfCollide declarations, five G2 plugin bindings and mode-specific hardware identities. Joint mimic relations are independently checked. X2 requires the specified Harmonic control plugin and bounded generated parameter path; X1 does not admit that plugin. Whole-tree plugin/declaration counting rejects shadow/nested plugin placements outside the admitted extension trees.

The static expectation agrees with the retained pinned arm/device and targeted gripper macros, including the unconditional mimic declarations in both modes. The newly added negative tests reject unapproved Gazebo plugins, empty controls, changed control joint/interface, altered mimic bindings, extra hardware parameters and nested declarations, including resealed native-kind records.

The remaining external YAML contents and installed/plugin behavior are explicitly separate unresolved scope (`docs/operations/xarm-native-sim.md:51`, projection `controlParameterFiles`). Matching raw declarations does not establish that the old mimic plugin works in Harmonic or clear native execution/contact requirements. L03-R2-01 below is a nonblocking numeric-equivalence false rejection in this new comparison, not a recurrence of the unapproved-plugin admission defect.

### L03-R1-04 — ADDRESSED

`packages/lab-runtime/src/v2/sil/xarm-cli.ts:20` records lifecycle separately from ACK acceptance. Line 28 syncs command bytes with null ACK and records attempted/unknown before execute; line 29 preserves the received ACK and its unknown/rejected/accepted disposition. Line 23 limits not_run/blocked_external to an explicit initial preflight refusal. Lost ACK, action rejection and startup uncertainty produce attempted-case executed/fail. Cleanup errors are retained without overwriting an existing failure at line 42.

`tests/integration/xarm-native-cli.test.ts:10`, line 20 and line 27 cover lost ACK, rejection, startup versus preflight, durable pre-dispatch records, thrown transport and failed cleanup. These remain labeled protocol doubles. Source intent/unknown/no-resend behavior is unchanged. The operations document at line 43 correctly explains that executed means attempted case, not proof of movement.

### L03-R1-05 — NOT ADDRESSED; external native qualification remains incomplete

`docs/operations/xarm-native-sim.md:3` explicitly retains the incomplete native task; line 59 retains unobserved G2 and ten required contact trials. The report correctly distinguishes same-run reopen refusal from real controller restart and direct FollowJointTrajectory from collision-planned motion.

Inspected both final retained X1/X2 engineering-arm64 nominal manifests and lifecycle records under `evidence-L03/fix1/native-not-run-final/`. They bind Source `7b5b3a1`, report motion/contact not_run/blocked_external, accepted:false, dynamics:not_calibrated and 0/10 contact trials. Lifecycle is preflight_refused with command:not_attempted. OS/platform, apt/package/plugin/runtime inventory and vendor-overlay prerequisites remain unresolved. Their evidenceKind denotes requested mode, not an observation that native simulation ran.

Actual matching-host provenance, native expansion/readback, X1/X2 motion/fault/stop/controller-restart outcomes and X3 ten trials or an observed unsupported result are still required. No native gate DEP-XARM-01/02/SEC-01/03 passes from this review. R88 permits downstream portable preparation after the prepared-code gate; it does not convert this item to ADDRESSED.

## New fix-introduced finding

### L03-R2-01 — Minor, nonblocking: Python extension comparison rejects negative zero

Location: `robotics/manipulation/native_xarm/mapping.py:85`.

The new semantic normalizer rounds a float and then serializes it to JSON. Python preserves negative zero, so an equivalent `<offset>-0</offset>` or `<offset>-0e0</offset>` serializes as `-0.0` and differs from expected `0.0`. The TypeScript normalizer produces `0` and accepts both. This creates producer/consumer disagreement for legal, semantically identical numeric spelling.

A focused in-memory probe loaded only the existing protocol fixture and mapping functions, replacing `<offset>0</offset>` with the two spellings. Baseline passed both readers; Python rejected both mutations with XARM_CONTROL_DECLARATION_MISMATCH, while TypeScript accepted both. Python 3.11 ran with bytecode disabled; Node was 24.22.2. Both probe processes exited 0 and wrote no files. No covering suite was rerun.

Normalize rounded zero to positive zero before serialization and add a paired negative-zero equivalence regression when this parser is next touched. This is Minor because it falsely refuses an equivalent declaration; it does not admit changed semantics, enable native capability or affect the pinned source's currently emitted positive-zero spelling. It does not block the prepared-code gate under the dispatched Important/Critical threshold.

## Nonblocking out-of-scope observations and limits

No new untouched-code defect is raised in this scoped review. The inherited full-repository lint issue remains outside this fix and is not a CI pass. Native ROS/service/timing compatibility, real xacro output, external parameter contents, installed plugin provenance, collision/contact behavior, independent native replay and human qualification remain unverified as documented above.

The fix does not change optional handoff schemas or generated-versus-immutable artifact-role separation. Lab changes are its pin and generated provenance headers only; no hardware route is introduced. Canonical R2a model/locks, fixed synthetic selector versus physical identity, Source authority, unknown/no-resend and automatic accepted:false boundaries remain intact in the reviewed range and supplied preservation audit.
