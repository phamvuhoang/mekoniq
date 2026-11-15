# B03 — durable physics observations and independent metrics

Status: DONE. Implementation/self-review, focused verification, clean source commit/export and Lab compatibility/pin commit complete; independent controller review remains. Source BASE `d271a6c2f776d56e47ca98d1554ff1f13b594579`; Lab BASE `3675dcaf189928cad80ded733ac64838a593d2b2`. Work is confined to `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/{source,lab}`. No original checkout, historical evidence, trial/web, deployment, provisioning or hardware action changed. Controller owns independent review.

## Implementation

- `simulation3d/physics-evidence.ts`: `openPhysicsRecorder`, serialized `append`/`flush`/`finish`/`gap`, `readPhysicsManifest`, `readPhysicsEvidence`, admission preparation and semantic observation validation. Append fsyncs a bounded NDJSON WAL (and directory) before returning. Immutable gzip chunks and atomic fsynced manifests publish in bounded batches. WAL/crash intent never qualifies as published coverage; a reopen never resumes appends. Reader checks schema, supplied run/boot/scene/profile/policy identity, contiguous clocks, declared geometry/prop/support IDs, 10 substeps, samples, unit quaternions, redundant orientation, byte/hash/path/symlink/size/decompression/chunk/tick limits and coverage. It returns explicit records/gaps/issues and verified completeness.
- Quotas: each provider-scoped navigation/physics writer at most100MiB, total at most200MiB; larger configured limits refused. Physics accounts existing chunks, WAL, orphan files and metadata before writes. Defaults30,000ticks, chunk250ticks; reader2,000chunks,256KiB lines,16MiB compressed/64MiB inflated chunks,400MiB aggregate inflation. No permanent per-tick chunk baseline.
- `navigation2d/runner.ts`: mobile-only ACK → independent structure/semantics validation → durable physics append → navigation append admission → logical clock/snapshot commit → exactly one stateful stop monitor → source observations. Malformed ACK/evidence-write failure preserves prior logical tick, records known-advanced gap, makes legs unknown and never retries/respawns. Initial failure preserves startup latch. Report-time flush failure terminates before another step. Recovery-created navigation gaps and checkpoint gaps join physics report coverage, including an unknown step beyond the last committed tick. Reports flush physics then perform bounded disk readback; metrics never come from the live buffer. Legacy ordering remains unchanged.
- `simulation3d/physics-metrics.ts`: pure force integration rejects invalid dt/force/overflow; support-relative max XY load displacement rejects missing/changed reference and prop identity; actual quaternion tilt and threshold duration; actual base→drive transform for wheel XY/wrapped-yaw residual; aggregate contact peak/impulse; stop-distance windows use verified navigation targets/actual velocity and registered hold thresholds. Missing/incomplete series and nonfinite overflow are unavailable, never fabricated zero.
- `RunReport.physicsEvidence` carries the inline v1 manifest, hash of its serialized bytes, verified completeness/issues and metrics. It is optional and deliberately outside canonicalOutcome. No legacy default metric block is added. Chunk paths are relative to `physics/`.
- Profile identity is exact scene-ref file-byte SHA-256, separate from canonical document/numerical digests. metricsPolicyDigest is the separate admitted mobile observation/stop policy byte SHA. Documented in `docs/research/2026-11-physics-evidence-v1.md`.
- `mobile_engine.py` extracts the already existing contact aggregation into production `ContactAccumulator` for direct native tests, preserving accumulation order and values. New guards reject nonfinite contact forces/impulse overflow terminally. **No mj_step ordering, dt/substeps, drive/solver/contact inputs, wheel integration, priming or raw tick-zero contact semantics changed.** `snapshot.py` needed no change: its existing optional physics representation already carries the required observations.
- Priming ruling: rawtick0 retains its actual pre-logical20ms priming contact interval. Aggregate contact metrics use **(0,lastTick]**, excluding priming; tick0-only interval metrics unavailable. Initial pose participates in max tilt/load reference. Tilt threshold duration counts only positive-tick20ms intervals. No profile/schema retune.
- Load supportId remains the declared coordinate reference, never a contact receipt. No custody inference, interaction stream, receipt-gated cell workflow or mobile UI activation was added.
- Lab minimal seam: sync the existing physics schema, optional `PhysicsReportBlock` typing and browser report-shape validation (including incomplete→unavailable and contradictory-completeness refusal). Old reports remain valid; the optional block survives intact. Mobile `NAVIGATION_PROVIDERS` admission remains B04.

## Files

Source: new physics-evidence.ts/physics-metrics.ts; navigation2d/{contracts,evidence,runner}.ts (evidence.ts only exports the existing fsynced atomic helper, unchanged legacy serialization); v2/report.ts; simulation3d/mujoco-mobile.ts limitation wording; mobile_engine.py; new native test_contact_metrics.py; new physics-metrics.test.ts/physics-evidence.test.ts/support/physics.ts; expanded mobile lifecycle/worker tests; new versioned research/contract-convention note.

Lab: scripts/sync-engineering-contracts.mjs; src/reports/report-shape.ts; src/scenarios/controls.ts; generated physics-evidence-v1 schema; physics-report-shape.test.ts; final source lock/generated headers from pin.

## RED evidence

All logs are retained in ignored `evidence-B03/`. Commands below run from source unless stated. Environment: Node24.22.2 + pnpm10.32.1 via `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`; native Python uses `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`. Every filtered/skipped case in a targeted RED is **not_run**, never counted as passed.

- `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/physics-metrics.test.ts tests/integration/physics-evidence.test.ts`: initial API RED was missing modules/collection failure,0tests (`b03-red-initial.log`), followed by meaningful behavior failures and GREEN below. The first implementation round21passed/1failed due exact-zero expectation for wrapped2π numerical residue2.449e-16; corrected test to1e-12 tolerance.
- `perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-lifecycle.test.ts -t 'pending cancellation'`:2failed/7filtered, logical tick261 instead260 (`b03-red-order.log`).
- `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 180; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_contact_metrics.py -q`: missing ContactAccumulator import collection failure (`b03-red-contact.log`); after extraction actual native3passed, expanded guard checks in final run.
- `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/physics-metrics.test.ts`: stop-window RED1failed/5passed, unavailable instead.4m (`b03-red-stop.log`); priming boundary RED1failed/6passed,10.2Ns instead.2Ns (`b03-red-priming.log`); tilt-duration RED1failed/7passed, undefined instead.02s (`b03-red-tilt.log`).
- lifecycle `-t 'report flush'`:1failed/11filtered, running instead needs_attention (`b03-red-flush.log`).
- lifecycle `-t 'rejects pose'`:1failed/13filtered, inconsistent redundant pose allowed261 instead260 (`b03-red-pose.log`).
- lifecycle `-t 'joins the explicit'`: after correcting a harness initially reading a navigation manifest before any flush,1failed/14filtered, physics complete true insteadfalse on restored in-flight checkpoint (`b03-red-restart.log`).
- recorder `-t 'supplied identity'`:1failed/18filtered, mismatched policy still complete (`b03-red-policy.log`). Recorder `-t 'concurrent callers'`:1failed/19filtered, second concurrent append rejected before first completed (`b03-red-concurrent.log`).
- Lab `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/physics-report-shape.test.ts`:1failed/1passed, malformed optional block accepted (`b03-red-lab.log`); later incomplete manifest with available finite metric accepted (`b03-red-lab-contradiction.log`).

## GREEN / regressions

- Final metric/recorder command: `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/physics-metrics.test.ts tests/integration/physics-evidence.test.ts`: **2files/28passed**, no skips (`b03-evidence-final.log`). Covers impulse/overflow, rotated supports, missing/reference changes, nonzero drive-frame offset/wrapped yaw, stop windows, priming/duration, malformed contact coverage, hash/path/symlink/bomb/order/missing corruption, quotas/orphans, concurrent append serialization, and owned-child SIGKILL between chunk publication and manifest rename.
- Focused compatibility: `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/physics-metrics.test.ts tests/integration/physics-evidence.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts tests/unit/bv01-mock-golden.test.ts tests/contracts/navigation2d-contracts.test.ts tests/contracts/sim3d-mujoco-schema.test.ts`: **6files/60passed**, no skips (`b03-focused-final.log`), before the later concurrency/restart cases. BV01 outcome digest/arm golden unchanged. Final newer mobile/reader runs are recorded below.
- IR-SIM: with `.venv-irsim/bin` additionally on PATH, `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/irsim-evidence.test.ts tests/integration/irsim-evidence-terminal.test.ts tests/integration/irsim-recovery.test.ts`: **3files/25passed**, no skips,121.64s (`b03-irsim-final.log`). Includes real repeatability, archive records, pending/crash/gap/quota/write-terminal/recovery and completed/cancelled reopen behavior.
- Webots, after IR-SIM exited: `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/webots-evidence.test.ts tests/integration/webots-faults.test.ts`: **2files/9passed**, no skips,100.89s (`b03-webots-final.log`). Three-run repeatability worst pose difference0. Corrected owned-process kill helper logs directory/PID/PGID/start/runId; no global selector used. Historical/original qualification artifacts untouched.
- Source `perl -e 'alarm 120; exec @ARGV' pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`: exit0; contracts match schema (`b03-contracts-final.log`, `b03-types-final.log`, `b03-lint-final.log`). Diff checks clean.
- Lab `perl -e 'alarm 90; exec @ARGV' pnpm typecheck`, and `perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/unit/physics-report-shape.test.ts tests/unit/navigation2d-report.test.ts tests/unit/mujoco-coffee.test.ts`: **3files/24passed**, no skips (`b03-lab-final.log`, `b03-lab-types.log`). Old/IR-SIM/Webots report paths and arm UI compatibility retained.

## Limits / not_run

No whole-branch CI/build repeated: B10 owns that. No B04 web/mobile UI workflow/browser qualification, B05/B06 interactions, physical commissioning or hardware tests executed. No new qualification candidate or accepted:true claim. No automatic36-repeat locked probe rerun: contact changes are observation extraction/finite guards, not numerical stepping/input changes. Existing real mission and mobile/native regressions establish the bounded behavior described above, not a new complete campaign.

A fully forged producer/contact stream with all hashes rewritten cannot be detected without an external trust anchor; genuine airborne contact arrays may be empty. Uncalibrated simulation is not hardware safety evidence. Recorder standalone callers supply admitted semantics and expected identity/policy; the source runner supplies all bindings and owns its pre-existing navigation writer lock. Source startup/step lifecycle and runtime admission remain the engine single-owner authority.

## Final identities and final newer checks

- Source BASE→HEAD: `d271a6c2f776d56e47ca98d1554ff1f13b594579` → **`b631928b6707ce9c6fd39db7bd5ced2100e353c7`**, `feat: record and verify payload physics traces` (15files,512insertions/32deletions).
- Lab BASE→HEAD: `3675dcaf189928cad80ded733ac64838a593d2b2` → **`43c4d51daf22ffa7d06f4e06bcccc62f15f95e60`**, `chore: pin source runtime b631928` (8files,573insertions/8deletions; includes the535-line generated physics schema).
- Both `git status --short` outputs are empty after commits. No push performed.
- Final mobile command after all runner/recovery/serialization changes: `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-mobile-worker.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts`: **2files/23passed, no skips,48.18s**, `b03-mobile-final.log`. Includes15lifecycle cases and8worker/compiler/integration cases.
- Final Python after native extraction and finite/overflow guard cases: `perl -e 'alarm 180; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_contact_metrics.py robotics/simulation-mujoco/tests/test_mobile.py -q`: **51passed, no skips,3.17s**, `b03-python-final.log`. PYTHONDONTWRITEBYTECODE/PYTEST_ADDOPTS flags above applied.
- Final real source-driven MJ-FD01 still completes **tick3443**, served1, complete physics readback with available interval contact impulse. Scene `ff01c15980dbd6b10ac50988353ae11537255d26d8b0b5ce4e339ff34f575884`; trajectory `def1455d28b3d8dc653327ff06de8effb5412fdfea2dfc5d4af83f547895861b`; sensor `32c1982ac92b9c43754a00c4cd8edb075abb76f91c4830785790ddda77a02b90`; assertion `5986b2aa09480aebec7e32768071f106a406a21843879a90a8cdb24815dd0898` — all exactly B02b.
- Runtime export: `/tmp/mekoniq-b03-b631928-export-20261114-0835` via `perl -e 'alarm 180; exec @ARGV' node scripts/export-lab-runtime.mjs <dir>`, clean commit, **dirty:false** (`b03-export.log`). Nothing exported under .superpowers.
- Actual runtime.mjs SHA-256 verified against manifest: **`d3574993d403a4cdac1adad4d3fdab97cb4789e2103cb2b138a5e65fe2784755`**.
- Schema hash **`73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6`**; portable closure **`43b52af94a4af9c7c8f01319615b01c9dcbfb1c751b93dcac6392cecad8e1b97`**; native closure **`e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7`**. Lab lock matches source/runtime/schema/portable closure.
- Lab import: `perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs <dir>`, then `node scripts/sync-engineering-contracts.mjs` (`b03-import.log`). `perl -e 'alarm 120; exec @ARGV' pnpm check:source` verifies sourceb631928/schema/protocol1/2/Node24 (`b03-pin-check.log`).
- Final post-pin Lab `pnpm typecheck` exit0; `perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/unit/physics-report-shape.test.ts tests/unit/navigation2d-report.test.ts tests/unit/mujoco-coffee.test.ts tests/unit/launcher-output.test.ts`: **4files/26passed**, no skips (`b03-lab-pin-final.log`).
- No unresolved test failure remains. Filtered RED cases were not counted as passing and all affected complete files subsequently passed. A couple of intermediate test-harness parse/early-manifest mistakes were corrected; they were not treated as production RED evidence. Logs copied after final runs to `evidence-B03/`.

## Review fix round 1 — B03-R1-01 (P2), 2026-11-14

Status: **DONE**, finding addressed; scoped independent re-review remains with controller. Fix BASE source `b631928b6707ce9c6fd39db7bd5ced2100e353c7`, Lab `43c4d51daf22ffa7d06f4e06bcccc62f15f95e60`.

Confirmed the review's initial-manifest gap: initialization called the atomic writer before any quota check; a positive tiny configured quota could publish its750-byte manifest and return healthy. All physics atomic publications now go through one byte-budget guard before opening the temporary file. It counts **all existing files + full new temporary bytes**, including the old target, existing tmp/orphan files, WAL and intent; no credit is taken for a later rename/truncation. Serialized metadata uses `Buffer.byteLength`, not JavaScript character count.

Healthy initialization, append and chunk/manifest flush preflight additionally reserve the serialized worst-case terminal document: existing manifest plus one explicit gap,200-code-unit reason/terminal strings at the worst JSON escape cost (six bytes per code unit), safe-integer tick widths, and bounded intent bytes. Impossible initial budgets fail before publishing any file. A terminal or reopen publication obeys the same atomic-overlap budget; if it cannot fit, the file is not written. A terminal that disk/quota refuses remains in memory and the source checkpoint as already designed, never exceeding the cap to force out a reason. Flush preflight includes the proposed new chunk ref and new manifest's byte size/reserve. This is conservative headroom, not a new public schema or a change to the legacy navigation writer helper.

Changed source files: `physics-evidence.ts`, focused `physics-evidence.test.ts`, mobile lifecycle test helper/one quota case, and the existing physics-evidence-v1 convention document. No runner behavior, Python engine, profile, schema, metric definitions or Lab product code changed. The fresh real-create lifecycle test confirms a1-byte physics budget refuses after creation with logicaltick0, STARTUP_UNKNOWN, no physics files, and no second spawn before/after reopen.

### Exact RED / GREEN evidence

Environment for source commands:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'
```

RED before implementation:

```sh
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/integration/physics-evidence.test.ts -t 'metadata'
```

`b03-r1-red.log`: **3failed,20filtered (not_run)**. All three failures were “promise resolved instead of rejecting”: impossible initial budgets, multibyte metadata reserve, and reopen with only the already-stored byte budget. The Unicode test was then tightened to compare equal-length200-character ASCII versus Chinese run/boot IDs under the same5,000-byte budget; the former fits the required reserve, the latter does not. Repeated maximal escaped terminal/gap requests cannot grow disk bytes past the cap. An additional append-budget regression verifies admitted observations leave enough headroom to publish the quota-terminal reason and failed-tick gap.

Initial GREEN:

```sh
perl -e 'alarm 60; exec @ARGV' pnpm exec vitest run tests/integration/physics-evidence.test.ts tests/unit/physics-metrics.test.ts
```

`b03-r1-green-first.log`: **2files/31passed**, no skips.

Final requested covering GREEN:

```sh
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/physics-evidence.test.ts tests/unit/physics-metrics.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts
```

`b03-r1-green.log`: **3files/48passed**, no skips,21.59s — recorder24, metrics8, mobile lifecycle16. Covers initialization, append, flush and restart failure behavior as well as the new byte-budget cases. Native workers use fresh owned directories; no other engine tests ran concurrently.

```sh
perl -e 'alarm 120; exec @ARGV' pnpm typecheck
perl -e 'alarm 60; exec @ARGV' pnpm exec eslint packages/lab-runtime/src/v2/simulation3d/physics-evidence.ts tests/integration/physics-evidence.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts
git diff --check
```

All exit0 (`b03-r1-typecheck.log`, `b03-r1-lint.log`). Self-review traced the peak atomic overlap through initial save, healthy append, chunk/intent/new-manifest flush, terminal save and reopen; confirmed every physics `writeDurable` call is guarded. Existing files remain counted even if their names will be overwritten. No silent terminal-write quota bypass remains.

### Commits, export and pin

- Source **`b631928b6707ce9c6fd39db7bd5ced2100e353c7` → `f0fb70f9733bc6eb103fe8e8972cd45926af918d`**, `fix: reserve physics metadata within byte quotas`,4files/55insertions/11deletions.
- Lab **`43c4d51daf22ffa7d06f4e06bcccc62f15f95e60` → `989632ae5b4b6f1cf8feebf57f0cb9301918d231`**, `chore: pin source runtime f0fb70f`,3files/4insertions/4deletions (lock and generated commit headers only).
- Clean export `/tmp/mekoniq-b03-r1-f0fb70f-export-20261114-0848`, command `perl -e 'alarm 180; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-b03-r1-f0fb70f-export-20261114-0848`, **dirty:false** (`b03-r1-export.log`). Exported runtime.mjs independently hashed to **`b8e984e1c9c8b082b32bd56e62a2464b6825ddb3096fdb1658702b8d1e20a4ab`**, matching manifest and Lab lock.
- Schema hash remains `73a81d17532f07c09239453707ae52bc904e24cd0b8e1cdbc7bf8a38e7ad73a6`; portable closure remains `43b52af94a4af9c7c8f01319615b01c9dcbfb1c751b93dcac6392cecad8e1b97`; native closure remains `e6924dff72ce8bf9919140e9ce73e9072edc56fa46fe3dff0a0260cd69e25ba7`.
- Lab commands: `perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs <export-dir>` then `node scripts/sync-engineering-contracts.mjs`; `perl -e 'alarm 90; exec @ARGV' pnpm check:source`; `perl -e 'alarm 90; exec @ARGV' pnpm typecheck`. All exit0, checking sourcef0fb70f/schema/protocol1/2/Node24 (`b03-r1-import.log`, `b03-r1-pin-check.log`, `b03-r1-lab-types.log`).
- Both worktrees clean after commits. Logs copied into `evidence-B03/`. No push/deploy/provision/hardware action.

Not_run in this scoped fix: full IR-SIM/Webots suites, Python51, FD01 full mission, whole-branch CI/build and Lab browser/unit suites. No new change required those repeats; earlier task results remain their prior-commit evidence, not claims of reruns. No unresolved failing check or new concern remains from this fix.
