# B02b scoped re-review — fix round 1

## Finding Verdicts

- **Validate mobile observations before publishing source events — ADDRESSED.** `packages/lab-runtime/src/v2/navigation2d/runner.ts:436` checks the mobile monitor before adapter observation, source draining, distance derivation and valid telemetry. A rejected observation retains its acknowledged evidence tick, then marks the plant lost and returns. `tests/integration/mujoco-mobile-lifecycle.test.ts:33` covers missing physics and a mismatched physics clock during pending cancellation, asserting no cancelled source observation, unknown adapter state, no valid fault-tick telemetry and retained evidence horizon.
- **Uncertain startup ACK must prohibit same-run respawn/reopen — ADDRESSED.** `packages/lab-runtime/src/v2/navigation2d/runner.ts:261` persists the startup latch before sending create. Lines 270–278 retain it and mark uncertain startup lost; line 298 recovers the pending latch, line 500 rejects another start, and line 584 exposes needs_attention. Successful create makes all subsequent startup failures terminal regardless of delivery label. `packages/lab-runtime/src/v2/simulation3d/mujoco-mobile.ts:10` supplies a closed pre-mutation refusal allowlist; unrecognized explicit create errors are unknown at `runner.ts:250`. Lifecycle tests cover dropped create/start ACKs after actual execution, persisted in-flight recovery, post-priming numerical/contact-capacity errors, a genuine schema refusal permitting another attempt, and slot retention through close.

## New Breakage in the Fix Diff

- None identified. The startup policy/checkpoint field is optional and enabled only for mobile; providers without the mobile monitor retain their previous observation/tilt ordering.

## Checks

- Reviewed `review-3e0c60e..5235791.diff` once against both prior Important findings and the appended fix report. No Git commands, test reruns, native execution or process-management actions were performed.
- Verified the concrete named risk that an allowlisted refusal might occur after mutation: `robotics/simulation-mujoco/mujoco_worker/session.py:184` performs scene/profile/model admission before engine construction at line 242 and priming at line 247; `compile_mobile.py:123` and `mobile_engine.py:33` place the additional allowlisted compiler failures before model/data construction.
- Read retained RED logs for both findings and `evidence-B02b/b02b-fix1-lifecycle-green.log`: nine lifecycle tests passed, including all amended failure paths. Read the affected regression result: seven files passed, one failed; 59 tests passed and two Webots global-process assertions failed. The retained scoped Webots rerun records two passes and five filtered/not_run cases. These results do not establish absence of external-process interference.

## Out-of-Scope Observations

- The pre-existing global Webots worker-kill/isolation concern remains controller-owned B00R work, as documented in `task-B02b-report.md:185`; it is outside this four-file fix diff. No related process action was taken during this review.
- The stale README wording remains deferred to B00R (`task-B02b-review-1.md:8`). Clean export/Lab pin and newer frozen upstream integration remain controller-owned, unverified by this scoped review.

## Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** Both Important findings are closed for source HEAD `5235791218c6330c358676fe36ae0ed978be3654`.
