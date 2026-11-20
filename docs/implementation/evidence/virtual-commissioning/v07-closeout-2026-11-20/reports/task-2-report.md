# Task 2 · Bench signals, trace evidence, readiness and host cleanup

Base `f4bd7734` and round-2 head `8815aa987ca1856b86b07b26995c155e5c969895` on `source/r4/virtual-commissioning`. Host Darwin arm64, Node v24.22.2, pnpm 10.32.1, .venv-mujoco with MuJoCo 3.17.0. No new dependency, campaign oracle change, or baseline corpus edit. Lab pinning and other-host qualification are owned by the parent task.

## Commits

| Commit | Change |
| --- | --- |
| `68fbd58e` | Wheel CSV targets integrate the exact displacement over the current 20 ms tick. The 2 ms settling calculation counts elapsed intervals. Admission requires a valid engine anchor. Metric units and unavailable results share helpers. |
| `93d55160` | Registered the drive trace manifest schema, generated types and shared fail-closed reader. Added gap masking and a completed real-run report reread. |
| `4c605af1` | Checked server envelope bounds against the represented drive modes. Negative shared vectors name a reason asserted by TS and Python. The public worker error code stays `DRIVE_DOCUMENT_INVALID` with the specific rule in `error.detail`. Added the repeated-sequence gripper session test. |
| `608d5add` | Added a host idle lease, preserved tick-zero instability as an explicit result, and introduced wheel angular-speed and no-slip annotations plus a body comparison. Documented disk retention and cold review. |
| `7466e727` | Bound the wheel comparison to the verified final trace record, enforced provider agreement, published the admitted envelope from the configured root, and wired operator lease configuration. Added cumulative trace bounds, stable corrupt-record issues and explicit settling-window insufficiency. |
| `bd4c0c03` | Preserved the first append failure reason, bounded chunk reads at declared bytes and validated published axes for single-provider hosts. |
| `8815aa98` | Published trace coverage only after the manifest commit and preserved the durable prefix on buffer flush failure. |

## RED and regression evidence

The test commands below were executed from `source/`. TS selections used `perl -e 'alarm N; exec @ARGV' pnpm exec vitest run <files> -t <selection>` or the complete files. Filtered-out cases in intermediate selections are excluded from the reported pass counts. The complete final suite includes those cases. Python ran with `-B`, `PYTHONDONTWRITEBYTECODE=1` and `-p no:cacheprovider`.

| Test boundary | Observed before the repair | Observed after the repair |
| --- | --- | --- |
| Signal and settling, `tests/unit/{bench-signals,tuning-metrics}.test.ts` | 7 failed, 26 passed. Point sampling produced zero speed on the first interval, invalid direct sampler inputs and absent anchors passed, and indices 5–129 qualified as 250 ms. Log `/tmp/v07-task2-signal-red.log`. | 40/40 including gain suggestions. Distances 0.01, 0.015, 0.5 and 5.013 rad integrate to the requested displacement to 12 decimals. Index 130 is the first sample satisfying a 250 ms hold after index 5. `/tmp/v07-task2-signal-green.log`. |
| Shared trace reader and report, `tests/integration/mujoco-bench.test.ts` | All 3 selected regressions failed. A retained chunk overrode a declared tick gap, invalid run ticks allocated a trace, and the completed wheel report still claimed available RMS. `/tmp/v07-task2-trace-red.log`. | Reader/recorder and report selection 5/5. Coverage contradictions, overlap, missing ranges, null/malformed gaps and foreign identity return bounded issue codes. Hash failure/truncated gzip rows leave affected samples null. Explicit tick 200 removes exactly ten samples per axis. |
| Missing discriminator and mode-specific envelope, contracts/security | 2 failed, 25 passed. Bounds admitted incompatible fields and a missing signal kind returned `INVALID_FIELD`. `/tmp/v07-task2-admit-red.log`. | 27/27. Missing kind returns exactly `FIELD_REQUIRED` in the HTTP shape refusal before engine construction. Wheel kd is absent or [0,0], wheel slew and CSP acceleration are absent, and limit bounds require positive minima. |
| Shared actuator admission reasons, `test_drive_model.py -k shared_vectors` | 13 rejected vectors produced old descriptive details, 7 admitted vectors passed. `/tmp/v07-task2-python-red.log`. | All shared vectors enforce reason parity on the same rejected rule and the wire error code separately. TS may additionally report schema/envelope issues. |
| Dock drift with repeated gripper seq, `test_session.py -k dock_drift` | Isolated in-memory mutation replaced the one accepted-gripper lookup with its raw-request counterpart. Both parameterized cases failed. `/tmp/v07-task2-gripper-mutation.py`, `/tmp/v07-task2-gripper-red.log`. | Both cases passed on production. Real worker session/engine, scene-admitted dock preset, opening-command reversal in both directions. The test stages the held-cup observation specifically to isolate the opening predicate. It does not measure a full grasp cycle. |
| Host idle, priming instability, measurement basis and collision, integration | Three selected failures: no lease policy/expiry, create-time instability became `PLANT_START_FAILED`, and the wheel result lacked its measurement basis. A real admitted forward wheel step on a west-facing copied fixture already hit `boundary-west` at tick 193. `/tmp/v07-task2-lifecycle-red.log`. | Four selected tests passed. Last ACK tick 2 was retained on expiry at 119999 ms after progress at 59999 ms. A new run acquired the same engine slot and finished normally. No step was replayed. |
| Provider identity and envelope | The first mismatched arm/mobile lock returned no reason. `/tmp/v07-task2-readiness-red.log`. | Validated lock, interpreter, worker root, engine version and schema directory disagreement, actual scene clock, invalid revisions, invalid envelope, and HTTP health from a resealed copied-provider envelope. `/tmp/v07-task2-readiness-green.log`. |
| Insufficient window and catalog measurement basis | Two failures when a last-tick step claimed `NOT_SETTLED` after just one tick and wheel health lacked measurement metadata. `/tmp/v07-task2-window-red.log`. | An entire observation window shorter than the hold duration is `WINDOW_INVALID`. A sufficiently long observation which fails to sustain the band remains `NOT_SETTLED`. Wheel catalog axes expose their quantity and assumption. |
| Durable body comparison | A real step's final row had no body speed, while the report gave 0.17002931297474685 m/s. `/tmp/v07-task2-wheel-red.log`. | A rehashed final observation of 0.073 m/s produced exactly that comparison. A final-tick gap, absent legacy scalar or corrupt scalar suppressed it. A malformed record generates `TRACE_RECORD_INVALID`. `/tmp/v07-task2-wheel-green.log`. |
| Total compressed budget and bounded record errors | 2 failures for excessive declared chunk bytes and arbitrary JSON parser text in a corrupt-record issue. `/tmp/v07-task2-bounds-red.log`. | The reader checks the manifest plus sum of chunk bytes before chunk reads, caps inflation, and returns stable codes for unreadable, compressed, malformed or truncated records. |

## Behavioral decisions and self-review

- CSV speed is the signed position difference across the tick divided by 0.02 seconds. Admission retains wheel forward-only rules, CSP signed displacements, enable delay, range and total duration checks. The sampled wheel speed is angular. CSP continues to sample position at its registered tick.
- A completed run computes metrics using verified, durable chunks. Manifest structure, identity, coverage and chunk topology precede sample use. A bad chunk blocks its range. A trusted prefix can still serve independent metric windows. Each declared gap masks its inclusive ticks even if the chunk still hashes correctly. No manifest can authenticate itself against a coordinated rewrite. External saved result digests and archive inventories provide the independent comparison.
- New wheel results and wheel catalog axes identify `quantity=wheel_angular_speed` and `inertiaAssumption=straight_line_no_slip`. Wheel metrics use the first wheel's true angular samples. The comparison is the simulated chassis forward velocity versus the mean true angular velocity of both wheels multiplied by the admitted wheel radius at the final verified tick, both in m/s. The chassis observation is a finite, optional field of the hashed NDJSON tick. Preexisting rows are readable and omit the comparison. The independent campaign verifier recomputes it and rejects a re-inventoried edited result.
- A protocol response double is used for priming `PLANT_UNSTABLE`, around a real spawned worker and its actual describe identity. Tick zero has no confirmed sample or chunk and every metric is unavailable with `PLANT_UNSTABLE`. The result still carries the host, plant, drive, draft, warning and manifest digest. The schema allows zero chunks only for a tick-zero unstable result with zero samples.
- The real collision test changes only the copied scene's initial pose to `[1,1.5,π]` before create. The normal admission, bundle, real worker, command and contact paths then produce the collision. The registered nominal wheel fixture and campaign file are untouched.
- The complete sweep caught a pre-Task-1 J3 integration assertion claiming that every priming CSP `targetApplied` equaled static home. Approved inactive-drive semantics hold each substep's current pre-step position. J2 differed from home by 8.684663699298767e-8 rad. The corrected assertions check all seven issued home targets exactly and every selected J3 priming target against the preceding actual substep, plus the last applied target against its final recorded target. The first sample is checked against home to 12 decimals. No tolerance was widened.
- Health reports bounded readiness reasons and serves the validated envelope from the selected provider root. One provider can serve its own scenario. When both providers are present their interpreter, worker root, engine, schema directory and lock must agree. The wheel scene must match the bench clock. The admission path still validates the draft before acquiring the engine slot.
- The host lease defaults to 60000 ms and has an injectable clock/scheduler. The operator override `MEKONIQ_BENCH_IDLE_MS` is server-only. Successful start and confirmed ticks renew it. Snapshots, reports, duplicates, pause and resume do not renew it. Serialized expiry closes the worker and releases the slot with `BENCH_IDLE_EXPIRED` and the last confirmed tick, without a synthetic drive fault or an unconfirmed step.
- Disk policy and retrieval are in `docs/operations/lab-runtime-single-host.md`. A 16 MiB per-run compressed trace cap coexists with an operator-bounded volume, monitoring and verified archival. Historical/expired evidence is retained. Cold review uses a read-only copy and the pinned bounded reader. A run without a saved independent digest has that provenance limitation. Cold execution returns `RECOVERY_CHECKPOINT_MISSING`. Aggregate retention, external backups, human acceptance and hardware qualification remain operator/reviewer work.

## Clean-head validation

All five commands below were executed on `7466e727`, returned exit code 0, and used the following environment. The source working tree was clean before and after the run.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
BENCH_RECORDED_DIR=../evidence-archive/r4-2-bench-77b38f7 perl -e 'alarm 360; exec @ARGV' pnpm exec vitest run tests/unit/{bench-signals,tuning-metrics,gain-suggest}.test.ts tests/contracts/{control-profile-admission,drive-contracts}.test.ts tests/integration/{mujoco-bench,mujoco-bench-campaign,mujoco-arm-readiness}.test.ts tests/security/lab-bench.test.ts
perl -e 'alarm 240; exec @ARGV' .venv-mujoco/bin/python -B -m pytest -q -p no:cacheprovider robotics/simulation-mujoco/tests/{test_session,test_drive_model,test_drive_engine,test_bench,test_worker_protocol_regression}.py
perl -e 'alarm 150; exec @ARGV' pnpm contracts:check
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm lint
```

| Check | Result | Log |
| --- | --- | --- |
| Bench unit/contracts/integration/security plus adjacent arm readiness | 9 files passed, 96 tests passed, 59.66 s. Includes the older 16-case recording check, fresh J3 and wheel case verification and re-inventoried tampered comparisons. | `/tmp/v07-task2-7466e727-focused.log` |
| Five Python suites, including pre-fix protocol fixtures | 166 passed in 23.92 s. | `/tmp/v07-task2-7466e727-python.log` |
| Schema generation | `Contract generation matches schema.` | `/tmp/v07-task2-7466e727-contracts.log` |
| Typecheck | Next route types generated; TypeScript exited 0. | `/tmp/v07-task2-7466e727-typecheck.log` |
| Lint | ESLint exited 0 with no diagnostics. | `/tmp/v07-task2-7466e727-lint.log` |
| Patch hygiene | `git diff --check f4bd7734..7466e727` exited 0. `git status --porcelain=v1` was empty. | Local source checkout |

The intermediate compiler run caught a mismatch between the optional `saturated` field in generic metrics input and the required boolean in the durable sample. The final codec uses the generated strict durable-record type and shared field definitions. An intermediate strict Ajv error in the zero-chunk conditional was corrected by declaring the nested trace object. The final five checks above ran after both corrections. Full fleet/browser and new tuple-wide 16-case qualification are separate closeout tasks.

## Independent review · fix round 1

Review base `7466e727`. The three Important findings in `/tmp/r4-task2-review.md` are addressed in `bd4c0c03b0dfc7ff6a00d220ae7319d4e4ddfc41`.

- The outer step-loss handler used to add `STEP_ACK_LOST` after a failed append had already recorded `TRACE_RECORD_INVALID` for the same tick. The recorder now preserves the first terminal gap. A real arm worker confirmed ticks 0–4, flushed them, and received a malformed tick-5 trace via a wrapped ACK. The worker closed, the terminal cause survived, and the shared reader returned all 50 confirmed samples equal to the previously recorded prefix plus ten null samples for tick 5.
- The file reader now receives each manifest entry's validated byte length as its read cap. The helper checks actual file size against the cap before loading content. The sum of permitted chunk sizes plus the manifest is already bounded by 16 MiB. The regression reduces the declaration of one genuine chunk by one byte. The reader rejects it through the bounded read path, preserves the neighboring valid chunk, and still separately checks exact bytes and hash for files within bounds.
- The envelope is validated against the full nine-axis bench registry derived from the closed request axes and shared mode helper. Unknown envelope entries produce `ENVELOPE_AXIS_UNKNOWN`. Selected drive-model axes must agree with their registered modes. Both an arm-only host given a resealed nonzero wheel kd bound and a wheel-only host given a resealed CSP acceleration bound refuse to publish the envelope/catalog and block readiness with `BENCH_ENVELOPE_INVALID`. Valid single-provider hosts preserve the original full document and digest while offering their own scenario.

Before the changes the following integration selection failed all three selected tests in `/tmp/v07-task2-round1-red.log`: duplicate tick-5 gaps, a post-read `TRACE_HASH_MISMATCH`, and an empty provider refusal list. The contract selection independently failed its unknown-axis test in `/tmp/v07-task2-round1-contract-red.log`. Afterward the four selected regressions passed, with the intermediate test-name filter excluding unrelated cases. Log `/tmp/v07-task2-round1-green.log`.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-bench.test.ts -t 'declared byte length|failed recorder append|single installed provider'
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/contracts/drive-contracts.test.ts -t 'every published envelope'
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-bench.test.ts tests/contracts/drive-contracts.test.ts -t 'declared byte length|failed recorder append|single installed provider|every published envelope'
```

Clean-head validation after the review changes ran the three relevant complete files with no test-name filter.

```sh
perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-bench.test.ts tests/contracts/drive-contracts.test.ts tests/security/lab-bench.test.ts
perl -e 'alarm 150; exec @ARGV' pnpm contracts:check
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm lint
```

Results on `bd4c0c03`: 47/47 tests, 3/3 files, 39.82 seconds. Each of the four commands exited 0. Contract generation matched, TypeScript finished cleanly and ESLint produced no diagnostics. Logs `/tmp/v07-task2-bd4c0c03-{focused,contracts,typecheck,lint}.log`. `git diff --check 7466e727..HEAD` was clean. This round touched four TypeScript files. The worker and its frozen response corpus retain their prior 166/166 test evidence.

## Independent review round 2 · Buffered publication failure

The reviewer reproduced the remaining confirmed-prefix issue on `bd4c0c03` with a real 5,200-byte trace quota and ten-tick chunks. After committing tick 0 and buffering ticks 1–9, publishing at tick 10 failed. The recorder wrote a gap beginning at 10. The reader correctly requires the missing tail to start at or before the first tick after the durable prefix (tick 1). A separate test injected a single manifest write failure after the second chunk file reached disk. The old implementation then claimed durable coverage through tick 10 while the live state had confirmed tick 9.

The recorder stages each chunk entry and its proposed manifest. It advances coverage only after durable manifest publication. A failed flush clears the rejected RAM buffer, records one gap from the last published tick plus one through the attempted tick, and preserves the original reason. A malformed next observation still allows earlier buffered observations to be published if their own writes succeed. Normal publication reserves terminal metadata space. Cleanup can retry terminal metadata. An unlisted chunk that reached disk remains in place for operator inspection. A persistent storage outage can prevent the terminal metadata itself from reaching disk.

Both regressions failed on the previous implementation. The real quota produced gap [10,10]. The injected manifest write failure produced coverage.lastTick 10 and gap [10,10]. Log `/tmp/v07-task2-round2-red.log`, 2 selected and 2 failed. After repair, both produce coverage.lastTick 0 and gap [1,10]. A read at the confirmed tick 9 returns ten verified tick-0 samples and ninety nulls. A read at tick 10 returns the same ten samples and one hundred nulls. Both reads return the original TRACE_TERMINAL cause, the explicit TRACE_GAP:1-10 with that cause, and TRACE_TAIL_MISSING. After gap/finish cleanup, exactly one chunk is listed and the injected-write case still retains its unlisted file.

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
perl -e 'alarm 120; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-bench.test.ts -t 'durable bench trace|failed recorder append'
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-bench.test.ts
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm lint
```

Commit `8815aa987ca1856b86b07b26995c155e5c969895` changes the recorder and its integration tests. The durable-trace selection passed 9/9 in 5.59 s. The final quota/write selection (`-t 'while publishing buffered ticks'`, 90 s alarm) passed 2/2 in 8.93 s, including physical file retention. The complete MuJoCo bench integration file passed 22/22 in 81.60 s, with engine-backed cases enabled. TypeScript and ESLint each exited 0. Logs `/tmp/v07-task2-round2-{green,quota-save-clean,bench,typecheck,lint}.log`. The committed diff passed `git diff --check`; the source working tree was clean.
