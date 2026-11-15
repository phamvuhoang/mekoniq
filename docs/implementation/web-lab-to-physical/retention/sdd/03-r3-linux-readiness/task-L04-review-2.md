# L04 task review 2 — scoped fix round 1

## Verdicts

- **Prepared-code spec compliance: PASS for the scoped L04-R1 correction.** The Important reviewed-input staging defect is addressed. This does not complete the native L04 checklist.
- **Task quality: APPROVED for this fix round, with retained deferred Minor L04-R2.** No new fix-introduced Critical, Important or Minor finding was identified.
- **Native qualification: INCOMPLETE / not_run.** Required terminal, GUI, package/provenance, ALG04 clock/synchrony/Cartesian, command-fencing, security and hardware evidence remains absent. No whole-branch or native approval is granted.

Reviewed only Source `3edb4320d7146343a4b9df977c65d846472c473b` → `7d8bededd7b0ca57984d6f0d000eaa74ddea839d` and Lab `e8ed78b98399947a26e525b8f9902e3463aef36a` → `2ccfbddb86282a9547368302f6121c7ee09acb71`.

## Basis and method

Read the filled fix dispatch first, then the complete task brief including R89, full original review, full 43,224-byte implementer report including its chronological appendix, both complete supplied fix packages, and root's handoff audit. Package SHA256s match the dispatch: Source `64a860f556c25aafe8771ce690fe2fce44c6ca0da4943a9c6f5d810778f8f892`; Lab `29d1a888c438067c814da807e09309fa7d491aeb48294a14cb80896f007d45dd`. Root handoff and report SHA256s also match. Read-only HEAD/status checks confirmed the stated final commits and clean product worktrees before this report.

The only unchanged-context reads resolved a concrete fix risk: whether dropping arbitrary siblings also drops required configuration inputs, or whether refusing an existing destination breaks the launcher's temporary-directory lifecycle. The canonical INI and two HAL files establish the referenced staged files; `scripts/smoke-sim.sh:63` creates a private temporary parent and `:66` passes its new `config` child, compatible with the new destination creation. No additional execution check was needed.

Read the scoped green log and own-exit receipt. Its **34 passed plus 3 subtests passed** covers `test_actual_trace.py`, `test_smoke_launch.py` and `test_linuxcnc_sim.py`; the exit is 0. This check ran against dirty FIX_BASE, with the exact final three Source file hashes recorded in the receipt. Root's final-byte attribution maps those hashes to the committed files. These results overlap earlier task checks and are not additive independent native evidence. No suites, helper audits or native preflights were rerun during this review.

## Finding disposition

### Important — L04-R1: ADDRESSED

Evidence in `source/integrations/arm-controller/scripts/prepare_smoke.py`:

- `:13` captures the requested INI once, and `:14` parses that same snapshot. `:21` enumerates exactly the six reviewed configuration files; `:22`–`:25` compare captured bytes to canonical bytes and retain the checked snapshots.
- `:30` creates a fresh mode-0700 destination with no `exist_ok`. `:31`–`:34` write only retained non-INI snapshots using exclusive creation. There is no caller-directory copy and no reread of caller files while staging.
- `:35`–`:44` retain the existing path/display substitutions and serialize the INI parsed from checked bytes. GUI assets at `:38` come from the trusted package HMI directory, rather than caller siblings.

The requested concrete regression is present at `source/integrations/arm-controller/tests/test_actual_trace.py:129`: both terminal and GUI cases start with canonical configuration plus a populated `sim.var`, another INI and a nested sibling. Assertions at `:138`–`:144` exclude all three from staging, retain `PARAMETER_FILE = sim.var`, and leave the caller's parameter bytes unchanged. The generated startup directory therefore has no imported work offsets.

Additional regression cases at `:147` and `:168` cover later mutation of HAL/INI caller bytes and refusal to merge into an existing directory containing parameter state. The mutation tests demonstrate that admitted snapshots, rather than subsequent caller content, are used. The appended report accurately distinguishes the three behavioral RED failures from the two baseline guards that already passed.

`source/docs/operations/linuxcnc-native-sim-handoff.md:21` now describes the allowlist, same-snapshot parsing, excluded caller `sim.var`, and temporary per-run generated parameters. The launcher still removes its temporary staging tree on exit (`scripts/smoke-sim.sh:63`); generated-parameter retention was not introduced or falsely claimed. The original request allowed exclusion and only suggested retention if needed. Native startup compatibility still requires the assigned host; that separate obligation does not leave this portable staging defect open.

### New fix findings

None identified in the supplied fix range. Fresh-directory refusal matches the existing launcher call. Required INI/HAL/tool/profile dependencies are retained, terminal substitutions are preserved, and GUI copying continues from package assets. The fix changes neither model/schema bytes nor controller/bridge authority or routes.

### Untouched-code observation — Minor L04-R2: DEFERRED, NOT CLOSED

The original trace-admission versus oracle/transport capacity mismatch remains the Minor described in `task-L04-review-1.md`. Its locations remain `source/packages/lab-runtime/src/v2/algorithm/linuxcnc-trace.ts:35` and `:59`, with existing oracle/checker limits cited there. None of those files changes in this round. This review does not reclassify or close it; retain it for final whole-branch triage.

## Closure, Lab pin and evidence limits

The Lab package changes only the Source commit and runtime artifact hash in `config/source-runtime.lock.json`, plus generated Source-commit headers. Schema and portable-tool digests remain unchanged. Root's recorded audit binds the new clean export to artifact `a3a54f2664a60724344f7b05bf7265ed280fc036498a5e77e87b30102c138737`, 225 native closure members and 237 portable closure members. The native digest changes because the immutable staging script changes, as R89 requires. Generated runtime state remains outside that immutable closure. No Lab physical route is added.

Root's local-byte/receipt audit records preservation of all 114 original L04 evidence files, 414 earlier L03/L02 evidence files, the original report prefix and three older export/cache sets. This scoped review relies on that recorded preservation audit; it does not independently authenticate every historical artifact, the effective Git graph, a native host or package trust. The recorded clean export/import/sync, Lab check:source and typecheck receipts support the new pin. Full CI remains unclaimed.

No assigned native host, genuine native trace, terminal/GUI execution, resolved target package/source/trust provenance, native timing/synchrony/Cartesian endpoint proof, atomic command fence or human acceptance was produced by the fix. Earlier Mac refusals retain their old identities and are not evidence for executing the new commit. Candidate acceptance and physical readiness remain unchanged.

Only this review report was written. Product files, index, HEAD, canonical inputs, historical evidence and services were left untouched.
