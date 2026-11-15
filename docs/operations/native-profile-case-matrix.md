# R3 profile qualification and reproduction

R3 records are evidence inputs with `accepted:false` and `dynamics:not_calibrated`. The recorder recomputes retained files; a doctor report, a supplied pass list, protocol double, numeric subset, or reviewer name in the candidate cannot establish native qualification. This tooling phase does not record the final candidates. Final Source CI, Lab checks and candidate recording follow independent B10/L06 review at one clean committed/exported/pinned tuple.

| Level | Recorded meaning | Current qualification boundary |
| --- | --- | --- |
| R3.0 | `DEP-PREP-01`: the supplied L00 handoff passes static document, path, hash, schema, profile and tuple checks | Does not rerun all code tests or authenticate an installed host. Final prepared records still await the final tuple. |
| R3.1 | Required native cases for this exact profile, ISA and scope are tested | Incomplete: no assigned host; the observation/verifier gaps below also remain. Assigning Linux alone does not close them. |
| R3.2 | Both physical branches have reviewed preparation code and a reproducible commissioning plan | L05 preparation was reviewed separately. This recorder does not rerun/sign commissioning conformance or authenticate dossier references; `PHYS-PREP-01` and the R3.2 record level remain `not_run` here. |

No R3 record changes G-HW, G-HW-READY, G-HW-ACCEPT, calibration G3, venue acceptance or any hardware manifest rank. Source owns mission/journal/custody. Lab has no hardware route. No performance portability between CPUs or architectures is inferred.

## Closed matrix

The executable authority is `scripts/sim-extension-r3.mjs:tableR3`. It returns fresh tables; modifying a returned array or supplying `requiredCases` cannot reduce requirements. All profiles require DEP-PREP-01. Every record also lists its full native cases, including cases outside the requested subset, and PHYS-PREP-01. `blockedNativeCases` retains every native case that is not tested.

| Profile | ISA | Allowed scope | Additional required cases | Native gate |
| --- | --- | --- | --- | --- |
| mujoco-linux-amd64 | amd64 | prepared, full | full: DEP-MJ-01, DEP-SEC-01 | G-NATIVE-MJ; never G-NATIVE-ARM |
| mujoco-linux-arm64 | arm64 | prepared, full | full: DEP-MJ-01, DEP-SEC-01 | G-NATIVE-MJ; current campaign adapters are amd64 only |
| engineering-amd64 | amd64 | prepared, motion, full | motion/full: DEP-NAV-01/02/03/04, DEP-SEC-01 | G-NATIVE-AMR |
| engineering-arm64 | arm64 | prepared, motion, full | motion/full: DEP-NAV-01/02/03/04, DEP-SEC-01 | G-NATIVE-AMR |
| xarm6-jazzy-sim | exact handoff ISA | prepared, motion, contact, full | motion: DEP-XARM-01/02, DEP-SEC-01; contact/full additionally DEP-XARM-03 | G-NATIVE-ARM, profile and scope bound |
| puma560-linuxcnc-sim | exact handoff ISA | prepared, terminal, full | terminal: DEP-CNC-01/02, ALG04, DEP-SEC-01; full additionally DEP-CNC-03 | G-NATIVE-ARM, profile and scope bound |

ROS profiles require Ubuntu 24.04. The current LinuxCNC candidate requires Debian 12; another distro/version needs a separately reviewed profile. The xArm producer's internal versioned profile ID is `xarm6-jazzy-sim-v1`; its qualification target is `xarm6-jazzy-sim`, and its environment is separately `engineering-amd64` or `engineering-arm64`. None substitutes for another. Native inventory still binds exact package/library/plugin/profile hashes per host. Common Source/Lab/schema/input identities must match. A selected native closure must match exactly; L00 `nativeClosureHash:null` remains an optional subject boundary, distinct from the observer checkout’s recorded native closure; native libraries on different ISAs need not have equal hashes.

## Required observations, readback gaps and next actions

`not_run` describes absent or insufficient observations. Actual malformed artifacts, identity conflicts, or observed failed assertions are failures and invalidate the supplied directory. A gate with a tooling gap remains `not_run`, with explicit blocker categories/reasons, rather than implying that only an external host is missing. A prepared record cannot mark a native gate tested.

| Case | Required observations | Supported readback and remaining gap | Next action |
| --- | --- | --- | --- |
| DEP-PREP-01 | L00 manifest and every declared input/schema/runtime/native/portable closure | Existing L00 validator, exact target profile/ISA/OS and Source/Lab/pin binding; recomputed locally | Assemble from final clean export and matching Lab commit; run verifier. |
| DEP-MJ-01 | Historical R2a M00 10 trials, three seeds, faults and exact engine/host/image; separate current R2b payload/cell campaign | Calls historical public checked probe and reviewed B10 current public checked probe separately. Historical/current subject and checker tuples stay distinct. Current subject must equal the R3 handoff. Both must pass; supplied inventory must be native-ready. No arm64 campaign implementation is supplied by these amd64 readers. | Assign exact host/image; execute both supported amd64 campaigns with their proper subjects. Implement/review a separate arm64 campaign before claiming arm64. |
| DEP-NAV-01 | Host/install inventory, canonical physical mapping, live TF and clocks | Reads the actual compiled canonical world, native inventory, raw clock observations and copied SQLite topic/timestamp coverage. Bag payloads are not deserialized into verified TF semantics. | Supply assigned-host capture, then implement/review TF-payload readback. |
| DEP-NAV-02 | FD01 load/travel/handoff/return, actual Nav2 feedback and Source confirmations | Checks retained Source journal/business ordering and raw coverage. It cannot independently join bag action UUIDs to every Source command/result. | Add reviewed UUID/command-to-feedback semantic readback; run actual nominal seeds. |
| DEP-NAV-03 | Obstacle/no-path/cancel/worker-loss, no false completion/replay, owned cleanup | Reuses the existing fault assessor and requires raw fault or Source cancel observation, no repeated effects and no false served/completed outcome. Complete isolation/cleanup qualification is not established. | Run all fixed fault records; add missing ownership/cleanup/security observations and their reader. |
| DEP-NAV-04 | Full bag/controller trace/report/replay and repeated nominal seeds | Fixed directory slots for nominal 7/42/99 and four fault cases; missing slots stay not_run. Verified byte copies are opened read-only. Topic/time coverage alone is not semantic replay qualification. | Retain complete actual cases and implement semantic replay checks. |
| DEP-XARM-01 | X0 mapping plus X1 fake system contract, cancel/result/freshness and actual controller restart | Reuses raw URDF/mapping checker; verifies mode/profile/ISA/source, bag topic counts, actual sample shape/clock/epoch, and Source/native command/run binding. X1 is `ros2_fake_system`, never dynamics/contact. | Capture complete X1 cases; add actual controller restart evidence. Same-run reopen refusal is insufficient. |
| DEP-XARM-02 | X2 actual Gazebo trajectory, limits/stop/controller restart and collision planning where required | X2 must be `gazebo_actual`; direct trajectory samples are retained as an observation subset. Action payload semantics and collision/restart qualification remain incomplete. | Implement/review the missing planning/restart observations and reader, then execute assigned-host cases. |
| DEP-XARM-03 | Actual G2 grip/release and transfer/contact observations | No supported X3 collector/verifier. A motion pass, fake gripper, or unobserved G2 support cannot close it. | Investigate G2 on assigned Jazzy/Harmonic stack; implement/review contact collection, or record observed unsupported reason. |
| DEP-CNC-01 | Installed controller inventory, terminal smoke and exact model/units | Existing strict actual-joint trace validator consumes `actual-joint-trace.json`; a `native_capture` JSON label is not authenticated execution or terminal qualification. | Capture assigned controller/install/terminal observations and implement their complete reader. |
| DEP-CNC-02 | Arbiter/tunnel/deadline/restart/fault, atomic command fencing and no auto-resume | Trace epochs remain separate segments. Epoch labels do not establish an atomic fence or continuous motion. | Add those missing controller/tunnel observations and readback. |
| DEP-CNC-03 | Package install/rollback/trust and manual GUI evidence | Native tool closure binds scripts/packaging bytes only; it does not establish installed provenance or a GUI verdict. | Execute assigned host package/trust/rollback/GUI checklist and add reviewed reader. |
| ALG04 | Actual/commanded angles, synchronized controller time and comparable controller Cartesian/DH/TCP endpoints | Calls `validateLinuxcncTrace`; numerical RTB/TypeScript FK parity and summary verdicts never establish overall ALG04. Controller timing, synchrony and Cartesian endpoints remain unavailable. No oracle is run merely to reread the trace. | Extend the producer under separate scope to capture required controller observations, then rerun ALG04. |
| DEP-SEC-01 | Profile-specific isolation, allowlists, one writer, endpoint/MDI/HAL refusals and no Lab→hardware route | No complete host artifact producer/reader exists. Docker containment flags, doctor output and portable security tests are insufficient. | Implement/review the explicit security observation contract and collector/reader before host qualification. |
| PHYS-PREP-01 | Both target dossiers, unknown-field/refusal, calibration/signature/conformance preparation | Existing L05 assessor checks reference structure only. This R3 recorder retains not_run; it cannot convert reference strings into measurements, signatures or live admission. | Use [target selection](physical-target-selection.md) and [arm preparation](arm-commissioning-preparation.md); review their separately recorded checks at the final tuple. |

## Input directories and interfaces

`record-sim-extension.mjs --release r3 --handoff DIR --native-records DIR --profile PROFILE --scope SCOPE --out NEW_DIR [--lab DIR] [--candidate-id ID]` copies bounded input files into a fresh external directory and recomputes qualification. It requires a clean audited Source checker and clean matching Lab pin. It does not launch a native/browser campaign, Docker, doctor, install, host provisioning or hardware command. `--plan` prints only the fixed matrix and performs no prerequisite probe. Duplicate/unknown options are rejected. Exit 0 means the requested scope is internally consistent, never accepted; exit 1 is a failed/incomplete requested scope; exit 2 is usage/preparation refusal.

For prepared-only recording, supply the final valid L00 handoff and a new empty native-records directory. Do not fabricate inventory. The handoff profile ID must equal the requested target. `DEP-PREP-01` can be tested while native cases and R3.2 remain not_run. Every automated record carries null reviewer fields.

When actual supported observations exist, put `index.json` in the native-records directory:

```json
{
  "schemaVersion": 1,
  "profile": "engineering-amd64",
  "architecture": "amd64",
  "subject": "replace this string with the exact handoff subject object",
  "records": {"engineering": {"directory": "engineering"}}
}
```

The example is a shape guide, not valid evidence. Roles are closed by target: MuJoCo accepts `historical`, `current`, optional `r2bQualification`; engineering accepts `engineering`; xArm accepts `xarm`; PUMA accepts `linuxcnc`. Every role value has only a single safe directory basename. The index and all supplied files are included in the outer inventory. Wrong profile/ISA/subject, unexpected roles or path escapes fail. Doctor-only files never populate native cases.

- `historical/` is a complete original L01 record; `current/` is a complete B10 native payload/cell record. They keep different subject tuples. Both require their exact recorded checker revision on readback. `r2bQualification/`, when supplied, is the complete public R2b directory of the R3 tuple; verification delegates to `verifyR2bDirectory`, including its reviewed browser/WEB05 readers. It is never a summary substitute for native execution.
- `engineering/` has fixed slots `nominal-7`, `nominal-42`, `nominal-99`, `obstacle-7`, `no-path-7`, `cancel-7`, `worker-loss-7`. Each slot is the **run directory** containing `run-manifest.json`, `bundle/`, Source journal/effects, `engineering-native-evidence.json`, native inventory/events/commands and `rosbag2/`. This is usually the producer's `run-1/`, not the outer campaign envelope. Copy complete retained runs; do not edit them or synthesize case names/results.
- `xarm/` has fixed slots `X1-nominal`, `X1-cancel`, `X1-restart`, `X2-nominal`, `X2-cancel`, `X2-restart`, holding original L03 output directories. Required raw files include hash-bound `native-inventory.json`, expanded URDF/mapping, observations, Source/native journals, command/outcome/lifecycle, native-started marker, bag coverage and verified bag. The slot name is checked against actual mode/case. A slot called restart still denotes the current producer's reopen-refusal probe, not a new controller-restart claim.
- `linuxcnc/` retains `actual-joint-trace.json` and the rest of the original L04 output. The strict model/frame/unit/samples/timing validator is reused. A separate `algorithm-results.json` pass label does not override missing controller timing.

Engineering readback correlates provider nanoseconds while validating each worker/Source origin and 20 ms tick mapping separately. Repeated worker readiness observations are allowed; receive-monotonic clocks are not compared across processes. xArm readback preserves the original unquoted integer nanosecond tokens exactly, including X1 system epoch timestamps. Its run inventory must report the selected available engineering environment, actual ISA and Ubuntu 24.04 through the shared profile reader. Consistent supplied inventory/mapping hashes do not authenticate the installed host or vendor trust.

All observed subsets are under `capabilities.observations`; `qualification:not_run` remains explicit. They do not reduce required cases. Preserve original failed/incomplete records. Readback inventories all files; symlinks, traversal and oversized evidence are refused. SQLite runs only against an owned temporary verified byte copy, never the supplied/original database; cleanup removes only that copy. Stop active writers and retain a consistent bag with the producer before transferring it. WAL recovery of original databases is not performed by this reader.

## Recipient sequence

1. Install/verify the exact selected profile under its separately authorized host scope. Follow [L00 transfer instructions](native-simulation-handoff.md). Retain exact Source/Lab/schema/input and per-host OS/ISA/engine/tool identities. Do not resolve a missing native package by borrowing another profile's image or declaring emulation native.
2. With Node 24.22.2 / pnpm 10.32.1, run L00 verification, then the selected read-only doctor. Use portable Python 3.11 with `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`; ROS uses its distro Python. Doctor is prerequisite evidence only.
3. Execute only the assigned profile's case commands, serially. [MuJoCo historical](mujoco-native-probe.md), [current B10](r2b-qualification.md), [engineering navigation](engineering-native-navigation.md), [xArm](xarm-native-sim.md) and [LinuxCNC](linuxcnc-native-sim-handoff.md) give exact producer commands and requirements. Examples after authorized host assignment:

   ```sh
   node scripts/native-sim/r2b-campaign.mjs --handoff "$current_handoff" --out "$new_current_record"
   node scripts/lab-sil.mjs run --scenario FD01 --seed 7 --out "$new_nav_record" --backend-set engineering-rigid-v1 --environment-profile engineering-amd64 --engineering-project robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json --engineering-case nominal
   pnpm exec tsx packages/lab-runtime/src/v2/sil/xarm-cli.ts --out "$new_xarm_record" --mode X2 --environment-profile engineering-amd64 --case nominal
   node scripts/lab-algorithm.mjs linuxcnc --trace "$retained_trace" --out "$new_algorithm_record"
   ```

   Repeat the fixed seeds/cases into new directories; a failed/unknown action is not resent or resumed by respawn. Missing tooling in the matrix must be implemented/reviewed before claiming the affected scope. These commands are not instructions to run hardware or provision a host as part of preparation.
4. Verify and replay/export using each producer's exact checker. Retain raw logs, clock mappings, bags/controller traces, report and archive bytes. Preserve before/after identities and each command's own exit status. Never replace a failed command's receipt with a successful trailing shell command. Clean up only named processes/containers/domains owned by that run; use its ownership receipt, never broad kill/reset/volume deletion. Rollback chooses the previous immutable tuple in a new run; it does not edit evidence or continue an uncertain action.
5. At the fixed final Source/Lab tuple, record and read back into a fresh directory **outside both repositories**:

   ```sh
   node scripts/record-sim-extension.mjs --release r3 --handoff "$handoff" --native-records "$records" --profile "$profile" --scope prepared --out "$new_candidate"
   node scripts/verify-r3.mjs "$new_candidate"
   LAB_SIMEXT_EVIDENCE_DIR="$new_candidate" pnpm test:acceptance -- sim-extension
   ```

   The acceptance suite routes R3 to mandatory asynchronous artifact readback. Requested native scopes fail while any required case is missing. Prepared candidates remain valid evidence of preparation with explicit native/tooling blockers. No final record is produced by this code/test handoff.
6. Submit the immutable candidate and a separate human review sidecar. The sidecar fields are `schemaVersion:1`, `documentType:r3-human-review`, SHA256 of the exact `qualification.json` bytes as `candidateSha256`, `candidateId`, `profile`, `architecture`, `scope`, `decision:accept|reject`, nonblank `reviewer`, and RFC3339 `reviewedAt`. Keep it **outside** the candidate so adding a review does not alter its inventory:

   ```sh
   node scripts/verify-r3.mjs "$new_candidate" --sidecar "$review_sidecar"
   ```

   This verifies binding and record consistency only, not the reviewer's identity or signature. The responsible reviewer supplies actual authorization/signing through the established process. It never changes the candidate's `accepted:false` or upgrades native/physical gates.

## Exact checker reproduction and publication

Record subject, producer, checker and publication identities separately. L01 and B10 native readers require their exact clean checker Source commit and full audited tool graph, not simply compatible-looking files. A later documentation/evidence commit is not automatically a valid historical checker. Use an isolated checkout at the **recorded checker SHA** with its lockfile dependencies and invoke that checkout's public verifier against the unchanged record. Never retag an old manifest or weaken identity checks to make HEAD accept it.

An R3 candidate that consumes both historical and current native records must be generated with a reviewed checker able to verify their recorded checker identities; records checked at different revisions are not silently transferable. At present this reader invokes the current audited public checkers and explicitly rejects old checker mismatches. Use independently retained exact-revision historical readback for review, or a new authorized historical-subject campaign at the final checker, without altering the old record. Prepared-only final records need neither native execution nor an identity workaround.

Evidence publication belongs under `docs/implementation/evidence/sim-extension/r3-<profile>-candidate-NN/` only after review and clean recording. Copy the immutable directory byte-for-byte and retain the built-from checker tuple separately from the later publication commit. Existing historical evidence and old producer identities remain unchanged.
