# B03 independent review 1

Reviewed source `d271a6c2f776d56e47ca98d1554ff1f13b594579..b631928b6707ce9c6fd39db7bd5ced2100e353c7` and Lab `3675dcaf189928cad80ded733ac64838a593d2b2..43c4d51daf22ffa7d06f4e06bcccc62f15f95e60` using the supplied commit/stat/context-diff packages. The task brief and implementation report were read first. No branch-wide diff/log was regenerated, and no subagent was used.

## Verdicts

- **Spec compliance: changes requested.** The implementation satisfies the main B03 ordering, evidence, metric, identity, compatibility and numerical-preservation requirements, but the configured byte quota does not cover initialization metadata (finding B03-R1-01).
- **Task quality: changes requested, one P2 finding.** The principal lifecycle and metric changes are well supported by meaningful failure tests and focused regression evidence. No other blocking defect was identified within this review's bounded scope.

## Finding B03-R1-01 — P2: apply the byte budget before publishing the initial manifest

**Location:** `source/packages/lab-runtime/src/v2/simulation3d/physics-evidence.ts:58–62` (configuration admission at line 52).

`maxBytes` accepts any positive safe integer through 100 MiB. `save()` writes the entire manifest unconditionally, and both initialization branches call it before `quota()` exists or is invoked. Consequently opening a fresh recorder can already exceed the supplied budget while returning a nonterminal recorder. The existing orphan/quota test checks a later append failure and does not cover this initialization path.

**Independent focused probe:** under Node 24.22.2, imported `openPhysicsRecorder` and the existing `tests/support/physics.ts` admission/identity/assumptions, opened a new temporary directory with `metricsPolicyDigest: 'e'.repeat(64)` and `maxBytes: 1`, then measured its files. Output:

```json
{"opened":true,"maxBytes":1,"files":[["manifest.json",750]],"storedBytes":750,"terminal":null}
```

The temporary directory was removed in `finally`. This was the only executed behavioral probe; it ran no native worker or runtime server.

**Why this needs correction:** the binding brief explicitly includes metadata in writer accounting and requires configured limits to be checked. A quota that only starts at append/flush does not enforce that contract. This probe does **not** establish an overflow under the default 100 MiB configuration or a false `complete:true`; its demonstrated impact is violation of smaller legal configured limits before recording begins.

**Requested change:** calculate the initial manifest's byte cost and required metadata reserve before publication, and reject an impossible configured budget without writing beyond it. Keep metadata publication/reopen/terminal accounting consistent with that policy. Add a focused regression asserting that a budget below the required metadata size cannot return a healthy recorder with stored bytes above the limit. Use byte length rather than JavaScript character count for serialized metadata.

## Compliance and code review observations

### Durable ordering and failure lifecycle

- The mobile branch validates snapshot identity/time and physics semantics, awaits a fsynced physics WAL append, then admits the navigation record before advancing the logical clock or notifying source adapters. The legacy branch retains its existing append order.
- Invalid/missing physics and durable append failure preserve the last logical tick, record the next advanced tick as a gap, terminate the plant, and leave legs unknown. Initial observation failure retains the startup uncertainty latch. The stateful stop monitor runs once per accepted observation, after recording and before source outcome observation.
- Published gzip chunks and an atomic manifest remain distinct from the WAL. Readers mark a nonempty WAL or write intent incomplete. Flush failures terminate the active plant; recovery/checkpoint and navigation gaps are joined into the optional physics report, including an unknown horizon beyond the logical tick. Report generation remains serialized with actions.
- The existing navigation writer lock and pending/startup recovery seams were inspected specifically for this integration. No new same-run respawn or retry path was introduced. Standalone physics-recorder callers remain responsible for ownership as documented; the source runner owns the navigation lock.

### Admission, reader and metrics

- Admission derives robot/prop/support/contact IDs and the drive transform from admitted scene/model/load bytes, with fixed 20 ms ticks and ten 2 ms substeps. The separate stop policy is byte-verified and compared with the registered policy before use. Profile identity fields and `metricsPolicyDigest` use the specified file-byte hashes, not canonical document digests.
- Record validation enforces required arrays/fields, canonical unique contact pairs, admitted identifiers, substep bounds, finite numbers, unit quaternions, contiguous tick/time and consistent redundant orientation. The reader adds chunk-count/byte/inflation/line/tick bounds, confinement, regular-file/hash checks and coverage matching. Genuine empty contact arrays remain legal.
- Metrics are computed from reader output. Incomplete physics coverage makes every physics metric unavailable. Stop distance additionally requires verified navigation coverage and joined ticks/time, with source command targets, actual velocity and registered stopped/hold policy. Existing navigation reader control/coverage checks were inspected for this use.
- Load displacement uses fixed support coordinates. Wheel residuals transform actual base pose into drive coordinates and wrap yaw. Tilt uses the actual quaternion. Available metrics reject nonfinite overflow. Raw tick-zero contact data is preserved, while interval contact metrics and threshold durations exclude priming; tick-zero-only interval metrics are unavailable. The documentation and boundary tests agree on `(0,lastTick]`.
- Support identity remains a coordinate reference, not a contact receipt or custody assertion. No interaction workflow or Lab-to-hardware route is added.

### Native observation extraction and compatibility

- The Python diff extracts the same pair aggregation into `ContactAccumulator`; the original contact point accumulation, canonical force sign, native-step order, timestep/substeps, torque range update, wheel integration, final forward pass and priming behavior remain unchanged. Added guards reject nonfinite force/impulse overflow. No numerical profile or locked input file is changed by this task.
- Native tests cover a resting box's force sign/map frame (including reversed canonical IDs), all ten actual mobile substeps, and a contact present mid-interval but absent on the final substep. They test native behavior rather than only protocol doubles.
- The report addition is optional and outside the existing canonical outcome projection. Lab adds a closed optional block with the generated manifest schema and metric shape, rejects contradictory completeness/available-metric claims, and preserves older reports. Existing imports clone the validated report rather than stripping the new block. Browser mobile provider admission, artifact consumption and display remain B04, as directed.
- No vendor/model assets, hardware qualification acceptance, deployments or historical evidence are changed in the supplied diff.

## Validation checked

Read retained logs rather than rerunning the reported suites:

| Evidence | Observed result |
| --- | --- |
| `b03-evidence-final.log` | 2 files / 28 tests passed: recorder and metrics |
| `b03-mobile-final.log` | 2 files / 23 tests passed, including 15 lifecycle and 8 worker/compiler/integration tests |
| `b03-python-final.log` | 51 passed |
| `b03-irsim-final.log` | 3 files / 25 tests passed |
| `b03-webots-final.log` | 2 files / 9 tests passed; repeatability worst pose difference 0 |
| `b03-focused-final.log` | 6 files / 60 tests passed, including BV01 golden |
| `b03-lab-pin-final.log` | 4 files / 26 tests passed after pin |
| Contracts/type/lint logs | Contract generation matches; type generation completes; no failure output in the supplied final logs |
| Pin/import logs | Imported and checked source `b631928`, schema/protocol/Node identity |

Sampled meaningful RED logs for precommit ordering, priming impulse, report-flush termination, pose contradiction, restart horizon, policy identity, concurrent appends and Lab contradiction rejection. These show actual behavior failures before their later complete-file GREEN runs. Filtered cases in those RED runs were not treated as passes.

The mobile final log records MJ-FD01 completion at tick 3443 and the scene/trajectory/sensor/assertion values stated in the implementation report. No new campaign or calibration claim is inferred from that result.

### Export and pin checks

Read `/tmp/mekoniq-b03-b631928-export-20261114-0835/manifest.json` and the Lab lock, and independently hashed the exported `runtime.mjs`:

- Source commit: `b631928b6707ce9c6fd39db7bd5ced2100e353c7`; exported `dirty:false`.
- Runtime actual SHA-256, export manifest and Lab lock all match `d3574993d403a4cdac1adad4d3fdab97cb4789e2103cb2b138a5e65fe2784755`.
- Schema aggregate identity matches `73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6`.
- Portable closure digest matches Lab's pin: `43b52af94a4af9c7c8f01319615b01c9dcbfb1c751b93dcac6392cecad8e1b97`.
- Native closure manifest identity: `e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7`.
- The source, export and generated Lab physics schema bytes independently hash identically to `2341e8ba2dfad329fe496ab109c5f2ee8bf6445fc53aee7756743f2c96f266c3`.

## Scoped limits / cannot verify

- Final suite results above are retained-log evidence; the review did not rerun them or independently reproduce their exit statuses. The only new execution was the isolated quota probe.
- Closure digest identities were compared, but every portable/native closure member was not rehashed. The runtime artifact and physics schema copies were independently hashed.
- Controller confirmation supplies clean-tree status. No Git status/log/diff was regenerated and no original checkout, process, runtime data or evidence was modified.
- Full CI/build, B04 browser mobile admission/display/artifact handling, later interaction workflows, a fresh 36-repeat qualification campaign and hardware/native commissioning were not reviewed or executed here. They remain with their assigned tasks/gates.
- A producer that forges observations and rewrites the entire hash chain remains outside the artifact integrity guarantee, as explicitly documented. No claim of calibrated safety or human acceptance is made.

Only this ignored review report was written in either worktree.
