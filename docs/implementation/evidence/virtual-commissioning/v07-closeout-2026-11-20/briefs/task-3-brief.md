### Task 3: Verify CIL and cell evidence from durable truth; enforce jerk policy

Controller ruling from root: implement explicitly revised jerk-limited controller/profile for nominal, torque, latency and coarse experiments (same revised control for these four). Ideal stays a named legacy-compatibility profile without a jerk promise. Preserve historical replay by controller revision, legacy worker corpus and ideal equivalence. Make controller revisions visible; document that ideal vs nonideal is no longer device-only isolation across this compatibility boundary. Adjust bench catalog's old single-profile-file assumption to explicitly select its nominal starting profile. Do not merely ignore maxJerk based on a hidden drive-model condition.

Jerk regression must cover reaching a steady target, small target steps, reversal, release from stop and an abrupt requested slowdown. Clamping the final velocity to its target after a jerk-limited acceleration update can itself violate jerk; assert finite differences of the actual emitted command, not only internal acceleration state. Explicit stop/fault/interlock is the documented immediate-stop exception. Keep commands inside admitted drive limits and disclose any necessary transient target overshoot; don't tune plant/oracle to hide a controller issue.

**Files:** `v2/control/{cil-campaign,drive-run,diff-drive-base}.ts`, cell runner/campaign evidence readers under `v2/simulation3d` and `v2/control`, drive control fixture/campaign JSON, `tests/{unit,integration}/` drive/cell/campaign tests.

**Interfaces:** Outcome/served/attention and control evidence must derive from verified journal/checkpoint/streams. Repeated campaign cases require verified baselines. Preserve the specified no-drive legacy and ideal compatibility path explicitly; revised non-ideal controller behavior has a traceable revision/digest and preregistered oracle.

- [ ] Reproduce report mutation: latency source says NO_PROGRESS/served0 while report says completed/served1/attention[]. Resealed inventory must not hide semantic disagreement. Derive fulfillment counts, status and attention from durable Source data, compare then apply oracle.
- [ ] Command-trace RED: duplicate one wheel axis while preserving count must fail. Check unique exact axes, mode, tick/seq and consistent command/event replay. Dependencies absent/corrupt must be reported, not empty-pass or unhandled ENOENT.
- [ ] Expand DRV06 repetition coverage to every claimed experiment/profile; repeat case oracle follows its actual profile. Register new campaign revision/oracle before recording; leave old artifact directories unchanged and retain format-aware historical verification.
- [ ] Resolve O4 cell debt: report reads recorded world/drive evidence rather than mutable in-memory buffers; verifier rederives complete/events/outcome from durable records. Add corruption/report-mutation tests including restart or memory loss.
- [ ] Jerk RED: nominal commands exceed 10 m/s³. Implement a limit using acceleration history and dt, preserving immediate fault/interlock stop. Legacy/ideal compatibility must be named explicitly in revision/profile policy, not a silently ignored numeric field. Test acceleration, jerk, reversal, zero dt rejection, emergency stop and legacy golden equivalence.

```ts
expect(mutatedOutcomeVerification.issues).toContain('CIL_OUTCOME_NOT_FROM_JOURNAL');
expect(duplicateAxisVerification.issues.length).toBeGreaterThan(0);
expect(Math.abs((aNow - aPrev) / dt)).toBeLessThanOrEqual(maxJerk + 1e-10);
```

- [ ] Run targeted tests RED/GREEN and real mobile/cell checks. Commit changes and explicitly document any required new oracle observations before recording the final campaign. Root re-pins.


Historical compatibility clarification: legacy campaign records may still be checked against their immutable registered table and controller revision, but successful readback of the old nominal-only repeat table must not be described as full current DRV06 coverage. New campaign revision must carry complete per-experiment repeats and new evidence is the only basis for that expanded coverage claim. Preserve original files and explicitly disclose this boundary in the report/handover.

Controller clarification from real smoke: 9034f528 delivered nominal/coarse orders but exhausted the parking route outside arrival tolerance, then requested/emitted zero forever. Root authorizes a separately explicit revision-two navigation completion policy using the existing admitted measured-pose/odometry interface after confirmed rest. It must not change arrival tolerances, reset NO_PROGRESS simulated deadlines, count plan creation/commands as motion progress, run under fault/interlock/cancel, or replan after unknown/lost ACK. Keep legacy/ideal byte behavior and use the same policy across all four nonideal experiments; record navigation policy revision in profile/manifest. Add exact negative/control cases and real nominal/coarse/cell success before freezing final campaign.
