# L04 task review 1

## Verdicts

- **Spec compliance: CHANGES REQUESTED for portable preparation; native task qualification remains INCOMPLETE / not_run.** Important finding **L04-R1** is locally actionable without a native host. The absent Debian host, installed package provenance, terminal/GUI evidence and native timing are separate external qualification gaps, not invented portable failures.
- **Task quality: CHANGES REQUESTED.** Address **L04-R1** before describing the staged launch inputs as the reviewed closure. **L04-R2** is a minor input-limit mismatch. No Critical finding.

Reviewed Source `7b5b3a17e501f125efac18749ad5b8123940ce7c` → `3edb4320d7146343a4b9df977c65d846472c473b` and Lab `58d082a9d57ea9216fa123ebb5d676ae1421b550` → `e8ed78b98399947a26e525b8f9902e3463aef36a`, including both Source commits and both Lab pins. This is the requested task-scoped review, not whole-branch approval or native qualification.

## Review basis and method

Read the full task brief including R89 first, then the filled dispatch, complete implementer report and both supplied original-base diff packages in bounded passes. No diffs were reconstructed, covering suites rerun, services launched, historical databases opened, product files changed or helpers spawned.

The review used the root's independently audited local-byte/receipt handoff as recorded evidence. It does not independently attest effective Git graph integrity, native execution authenticity, installed package trust or remote host identity. The reported 138 TS tests and 69 Python tests plus eight subtests precede the guard follow-up; the final 71 Python tests plus eight subtests cover that follow-up and overlap the earlier Python count. They are not additive independent suites. Full CI and native qualification remain unclaimed.

Focused outside-diff reads addressed named risks only:

1. Whether copying the entire caller configuration directory introduces controller-consumed inputs beyond the checked files: canonical INI, virtual HAL and the configuration file list. This establishes L04-R1.
2. Whether exact native DH, SI conversion and TCP conventions reach both FK implementations: `loadArmModel`, `toSI`, `forwardKinematics`, the pinned DH/frames files and RTB FK entry point. The pinned no-tool TCP is the flange, so omission of a separate RTB tool transform is correct for this exact model.
3. Whether checker bounds and failures agree with the new admission contract: the RTB pose cap, checker request cap and result collector. This establishes L04-R2.
4. Changed-context cuts in the smoke diff: the remainder of the launcher and `_poll`/controller action methods were read to assess interruption reporting, process launch and timeout behavior.

## Findings

### Important — L04-R1: stage only reviewed inputs, not the entire caller directory

**Location:** `source/integrations/arm-controller/scripts/prepare_smoke.py:25`; supporting existing configuration at `source/integrations/arm-controller/configs/sim/puma560/mekoniq.ini:23`.

The new guard compares six specific files to the canonical directory, but then `shutil.copytree(profile.parent, destination, ...)` copies every sibling except Python caches. The canonical INI explicitly consumes `PARAMETER_FILE = sim.var`, while `sim.var` is neither among the six validated files nor present in the reviewed canonical directory. A caller can supply a directory containing the six unchanged reviewed files plus a populated `sim.var`; all new checks pass and that extra controller input is staged. Persistent parameters/work offsets therefore need not start from the reviewed/default state. This requires no race and no changed HAL or INI.

This does **not** demonstrate a hardware route or arbitrary HAL execution. It demonstrates a concrete hole in the new reviewed-input guarantee: extra runtime state can influence the native run without appearing in the six-file admission binding or the immutable Source closure. The runbook's statement that staging contains only byte-matching reviewed inputs is consequently inaccurate. This is a preparation defect that can be fixed and behaviorally tested locally; it should not be deferred as missing host evidence.

**Requested correction:** stage an explicit allowlist of reviewed files into a new configuration directory, or explicitly define, validate and bind every additional controller-consumed startup input. Do not copy arbitrary caller siblings. Add a portable regression using an otherwise canonical directory with an extra `sim.var`, proving it is refused or excluded; retain generated runtime parameters separately as run evidence if needed.

**Current test limitation:** the added staging test modifies `machine.hal`, so it verifies mutation of a checked file but does not cover extra consumed files.

### Minor — L04-R2: trace admission exceeds the single-call oracle limits

**Location:** `source/packages/lab-runtime/src/v2/algorithm/linuxcnc-trace.ts:35` and `:59`; supporting existing limits at `source/robotics/algorithm/algorithm_checks/kinematics.py:15` and `source/packages/lab-runtime/src/v2/algorithm/checker.ts:14`.

The validator accepts up to 100,000 samples, then submits all actual joint rows in one `rtb_fk` request. The existing RTB implementation accepts at most 10,000 poses, and the checker transport separately caps requests at 1 MiB. Consequently, inputs accepted as valid by this new consumer can deterministically fail before any FK residual is calculated. For example, a trace with 10,001 short valid joint rows meets the new sample bound but exceeds RTB's row bound. `collectResults` correctly retains the rejection reason, but presents a failed numerical verdict for an unsupported batch size.

The current short terminal sequence is unlikely to reach that size, so this is not a blocker for its ordinary capture. Align the admitted capacity with the actual transport/oracle bounds, or use bounded batches with explicitly aggregated maxima. Test the supported boundary so longer imported traces have predictable behavior. This is distinct from a genuine numerical residual failure.

## Strengths and requirement assessment

- **Independent actual input:** the recorder reads `joint_actual_position` and `joint_position` separately, records raw degrees and converted radians, and keeps missing/nonfinite data missing. Cartesian `actual_position` is not repurposed as six angles. The checker receives supplied actual joints; RTB does not generate the trace. The real-RTB test asserts the actual payload and uses different commanded values.
- **Native model binding:** the exact PUMA manifest is pinned; declared manifest members are verified; supplied DH/frame/profile/tool identity must match. SI conversion preserves inch lengths, degree joint values and radian alpha. The pinned native model is passed to FK rather than the illustrative in-code PUMA table. The no-tool TCP is appropriate for the RTB flange result.
- **Honest timing:** receive-monotonic brackets surround polling and field reads. `controllerTime:null`, unavailable controller clock and unavailable synchrony are explicit. Neither `cycle_time` nor `echo_serial_number` becomes a fabricated clock. Validation refuses absent/reversed timing and bad sequences. There is no interpolation or claim that within-poll commanded/actual delta is synchronized following error.
- **Separate metrics:** raw commanded-versus-actual delta and numerical FK translation/rotation residuals remain distinct. The controller Cartesian-versus-DH/TCP residual stays not_run. Numerical failure remains fail; numerical pass is downgraded to overall ALG04 not_run. Protocol doubles remain explicitly disqualified as native evidence, and every generated report remains `accepted:false`.
- **Epoch handling:** native main wires the pre-action guard, state polling checks before and after the read, uncertain samples are discarded, prior steps and the failing action survive normal sequence exceptions, and consumer coverage splits at epoch changes. No retry/resend/automatic continuation was introduced. The report correctly states that the guard is not an atomic controller-side command fence. Native restart races and compatibility remain unqualified.
- **Evidence boundaries:** fresh/nonempty output refusal and exclusive driver/trace writes reduce accidental overwrites. Smoke output binds available trace bytes, and the CLI separately records retained input SHA, supplied subject commit and local checker identity. These fields are not presented as authentication. Kill-before-flush and absent traces remain explicit limitations.
- **R89:** both requested immutable directories are added to the existing deterministic native closure. Tests cover membership and mutation of recorder and package-lock bytes. Existing exclusions and symlink refusal are preserved in the diff. The Lab change is limited to the final Source pin/artifact and generated Source-commit headers; schema and portable tool digests stay unchanged. Closure inclusion is not a claim that candidate packages were installed or trusted.
- **Candidate/package honesty:** inventory preserves package/source/ISA mappings and raw query evidence. The dependency lock explicitly remains unresolved, with no invented Debian host or relabeled ARM64/amd64 identity. Package trust and retained source/archive provenance are still obligations.

## Native requirements still open

The implementation cannot satisfy the full L04 acceptance checklist from the supplied evidence. No assigned Debian host/package resolution, real terminal sequence, actual native joint trace, native restart/tunnel/deadline/arbiter conformance, target install/verify/rollback, separate GUI checklist or human acceptance exists. DEP-CNC-01/02/03, full ALG04 and SEC-01 therefore remain open. Mac exit-2 preflight refusals are valid refusal evidence only. Portable security/recovery/trust tests are not substitutes for those executions.

The controller time/synchrony and comparable Cartesian endpoint limitations are accurately disclosed. They prevent full native ALG04 qualification even if the numerical subset succeeds. The observation-only epoch guards do not prove command fencing across a restart. These limitations are not disguised as passes and are not additional discovered implementation findings in this review.

## Cannot verify from diff

- The target host's LinuxCNC API/process naming, process epoch identity, installed binary/source packages, signed apt provenance or exact ISA compatibility.
- Actual command acceptance, terminal transitions, native sample behavior, restart/tunnel-loss races, hardware exclusion on a running host, package lifecycle or GUI acceptance.
- Authenticated native execution or effective retained Git graph attestation. Caller labels, local checkout fields and closure consistency are insufficient for those claims.
- Full CI or unlisted regressions. Recorded focused successes are accepted only for the reported checked bytes and their stated scope; no additional execution was performed during review.
- Every preserved historical artifact independently. Root's recorded local-byte audit supports preservation; this review does not expand that into a stronger provenance claim.

After L04-R1 is corrected, portable preparation can be reconsidered without an assigned native host. Full L04 qualification must remain incomplete until its required external evidence exists.
