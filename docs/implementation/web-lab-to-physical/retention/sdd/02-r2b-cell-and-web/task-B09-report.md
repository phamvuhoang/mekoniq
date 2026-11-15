# B09 implementation report

Status: DONE_WITH_CONCERNS. Implementation is ready for root's independent review under R76; actual container WEB05 is `not_run/blocked_environment`. `accepted:false`. No image was built, pushed or deployed. No native-amd64, public HTTPS, Cloud Run or hardware qualification is claimed.

## Scope and identities

Worktrees: `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source` and sibling `lab`, branch `codex/web-lab-to-physical`. Original main checkouts, trial/web and running robots were out of scope. No helpers/reviewers were spawned.

| Item | Identity |
| --- | --- |
| Original Source base | `714e37f9b8251663c3d7a3d3e668a0c35ca2d493` |
| Original Lab base | `4741edfcda3b421197235c50daed7c09b340bedf` |
| Source commit | `f419bdc0ef522f037e4a7717374e9135fbe5fce8` — `build: package a persistent single-host simulation runtime` |
| Lab commit | `701ad719c43572c2981a2542f4c6bbec51f656e5` — `chore: pin source runtime f419bdc` |
| Clean export | `/tmp/b09-runtime-HIN3kP`, `dirty:false` |
| Runtime artifact SHA256 | `75beea81c09f7330a03faa14b68e3fb6db8cf0aa5dc60b3138497a1562987f91` |
| Manifest SHA256 | `fb7b4eb9bdb900453a287863e6c6cff410408da1a9cf7e76432ba4dd60b2be1f` |
| Schema hash | `53af7456cbdfec26685f902484865f8a43d64edcf63624f41f37701db2ccb8a9` |
| Portable tools digest | `a9887059ec3cb0ccbb88e2082ef5132625678fdf622ea0d6bd615162a14017f9` |
| MuJoCo requirements lock | `a3c78091c9042b3a9b0428eaa9b140eb2b9c3a1bb89e57033fb1f81f9f0b4d84` |
| Container image ID/digest | **null / unbuilt** |
| Execution host | Darwin arm64; Node v24.22.2, pnpm 10.32.1; existing Python 3.11.15, MuJoCo 3.17.0 |

Runtime bytes changed; schema and portable-tool closure digests remained unchanged. Lab lock points to the clean Source export; generated engineering/navigation2d source-commit headers were synchronized. Both Git worktrees are clean. Report/logs live in the ignored task directory, outside these commits.

## Changes and authority contract (R74)

Pairing now returns an independently generated public `sessionId`. It is not the bearer/cookie token map key and is not a reclaim proof. There is no session-listing endpoint.

Added `POST /runs/:runId/writer` with `{operation:'grant_read'|'transfer', recipientSessionId, controlEpoch}`. Only the current authenticated writer can use it, and the recipient must be an active paired session in this runtime. Explicit readers receive scoped snapshot/report/SSE/display/download access. They cannot step, reconcile, export, archive, delete or transfer. Unrelated sessions still receive private 404 responses.

Transfer retains explicitly authorized readers, changes the single writer and durably increments the control epoch. `X-Lab-Control-Epoch` may be omitted only by the original epoch-zero writer; supplied mismatches always fail, and later writers must supply the current epoch. Motion conflicts return `RUN_WRITER_CONFLICT`. Origin/CSRF checks apply to the new route, and the exact v2 CORS allow-header list adds the epoch header while legacy behavior stays unchanged.

Per-run queues linearize authority/expiry checks with actions, transfers, reclaim and archive work at execution. They recheck readiness after queued work starts. An action admitted before transfer cannot execute afterward using stale authority. Expiration of the creator cannot close the active recipient's run. Read authority is also rechecked after asynchronous captured report/display/file preparation. Disconnect/expiry never grants control.

Reclaim clears previous writer/read grants, advances the persisted fencing epoch and restores `view_reconcile` only. Existing proof-owner replay/export/archive/delete housekeeping remains separate from explicit reader privileges and does not grant motion. Reclaim epoch metadata is written through temporary file, file fsync, rename and directory fsync; bearer tokens are not persisted by this metadata. Durable epochs fence stale sessions; they are not a distributed controller or a promise of resumable physics.

Changed seams: `v2/gateway.ts`, `v2/reclaim-store.ts`, public `gateway.ts`, writer/remote security tests. Existing one-world and captured-report interfaces remain the baseline; no arbitrary controller/plant settings route was added.

## Data-root process ownership

New `v2/data-root.ts` canonicalizes an operator-owned, writable, non-symlink directory and owns a dedicated `.runtime-owner.sqlite` connection with a held `BEGIN IMMEDIATE` transaction. A permanent versioned metadata table and integrity checks distinguish valid initialized state from uncertain/corrupt state. Busy roots fail `LAB_DATA_DIR_BUSY`; corrupt/empty/uncertain locks fail `LAB_DATA_DIR_LOCK_INVALID`; unsuitable roots fail closed. There is no PID-file takeover, deletion of a live/unknown lock, or namespace-based ownership inference.

The public gateway acquires the lease before `prepareV2` constructs CLI providers. Another process cannot create a world before discovering the conflict. A failed listener startup releases its own initialized resources. Normal shutdown releases the lease only after all admitted request/file work and owned workers settle. Kernel SQLite locks release after the owning child exits, including SIGKILL; no automatic motion resumes when a new process obtains the lease.

Independent child-process tests race two gateways against one root, kill only the owning child and reopen committed mock state at tick 20 with `needs_attention` / `view_reconcile`. This is **local mock persistence/lease evidence**, not an actual-worker container crash test. Scope is one host with a local filesystem honoring SQLite locks; NFS/multi-host use is not supported or qualified.

## Public shutdown ordering and R63 proof

Public `g.close()` is idempotent. It stops request admission, starts server closure, calls v2 `beginClose()` to abort owned captures/downloads, ends SSE and destroys held responses, then waits for admitted handlers and pending owned reads, closes legacy/v2 workers, waits for server closure and releases the data-root lease last. Worker-close errors are not swallowed by the final v2 shutdown loop. Event-stream lifetime includes both response closure and any pending journal pump, preventing lease release while that pump still owns I/O.

The public API is exercised with an already-held asset response and pending owned file read, without draining the client first. Protocol-double worker-close and SSE journal-read barriers verify that a competing runtime remains refused until the held work settles. The RED SSE test specifically demonstrated premature lease release before the lifetime fix. These are bounded protocol/mock cleanup proofs, not physical-engine execution.

A separate **actual Darwin arm64 MuJoCo** public-gateway test creates an arm run, advances to tick 20, calls public close while the world remains active, verifies its owned child is gone, reopens the root and cold/repeatedly reclaims retained state without a replacement world. `actual-worker-processes.json` records PID/start/argv/ancestry and all observed children absent afterward: describe 63516, arm smoke 63651, actual run **63777**, restart describe 63945. Actual run ID `964196d3-a84b-4c7a-866d-d5271400de2a`, scene digest `807062c69c390271b1c19c8ba14374879590ba6dfac6528913b5e7653b98945c`. Test command exit 0, elapsed 4.635 s. The test fixture uses manifest `sourceCommit:'test'`, synthetic schema identity and seed 7; implementation commit is f419bdc, but this fixture is not a qualification artifact. No claim combines held-I/O doubles with this actual idle-active-world shutdown into one container test.

## Recovery fix and R75

The actual arm test first exposed an existing cold-reclaim bug: public shutdown already killed its worker, but reclaim created a new MuJoCo child before applying its read-only hold. The failure is retained in `actual-worker-green2.log`; owned PID 58485 was closed in cleanup and confirmed gone. Root approved R75 before changing this lifecycle.

Explicit gateway cold reclaim now passes server-owned `reclaimOnly`, which requires an existing identity-validated checkpoint and selects retained/frozen arm ports before any physical provider/world creation. Client JSON cannot set this flag. Missing checkpoint/fresh state and missing required shared-world retained state fail closed. Direct runner reopen behavior outside this explicit path is unchanged.

Recovery does not call normal physical initialization, rewrite scene/bundle, substitute boot identity, or publish synthetic new motion/contact/sensor observations. Retained state and scene bytes are checked unchanged. Derived retained poses are marked stale; live arm report coverage is explicitly `RECLAIM_PLANT_UNAVAILABLE`, and Source-only reconciliation uses unknown observations instead of querying a new physical adapter. Existing retained report references are preserved. Focused world/mobile tests cover no-respawn and absent-checkpoint refusal; actual mobile recovery preserves the observed worker spawn count after tick 5.

## Image closure and deployment files

The CLI accepts `LAB_DATA_DIR` with explicit `--data-dir` precedence. The image defaults to `/tmp/runs` and prepares an owned `/data/runs`; the single-host compose file mounts a persistent local volume there. No application source is supplied through an ambient host mount.

Added explicit `--engineering-portable-only` / `portableOnly` configuration. The image registers only the available MuJoCo engineering compiler (`engineering-mujoco-3d-v1`), publishes registered compiler profiles in health information and refuses unavailable native rigid/contact profiles with `PROFILE_COMPILER_UNAVAILABLE`. Its TypeScript mobile compilation path does not require Python PyYAML/native compiler roots. Existing default engineering mode remains opt-in and unchanged. The existing native helper-only compile/serve/refuse-native test runs with the already-installed `.venv-irsim/bin/python`; this is not native simulation execution.

`prepare-catalog.mjs` materializes the committed serve-payload fixture components/models into the image catalog (9 components). `build.sh` retains clean export/archive closure checks and includes catalog preparation. The Dockerfile retains the MuJoCo lock/worker/fixture/schema closure, quotes the operator data dir and explicitly selects portable engineering. The full required serve-payload, xarm6 and coffee-delivery-cell fixture manifests are included.

Added `deploy/lab-runtime/single-host/{compose.yaml,proxy.conf,README.md}` and `docs/operations/lab-runtime-single-host.md`: immutable image references supplied by the operator; non-root runtime/proxy, read-only filesystems, no capabilities/new privileges, no runtime public port, tmpfs, local named data volume, no devices/Docker socket, explicit stop timeouts, TLS certificate mounts, exact Host forwarding/guard and Origin allowlist, SSE buffering disabled and explicit proxy timeouts. Runbook covers readiness versus liveness, key rotation/re-pair, drain/stop, recovery/export/backup and no physics restore. Proxy image must support the documented uid/envsubst setup; no particular unverified image digest was invented.

Compose interpolation/config validation passed without a daemon using nonsecret example env values. A separate **STATIC_BUILD_CONTEXT_ONLY** audit invoked build.sh with an explicitly fake Docker executable that inspected its temporary clean context; it did not build an image or contact the daemon. It audited 158 files, all 3 required fixture manifests, 9 catalog components, no tests/bytecode/.env leaks, valid entrypoint JSON, and executed bundled runtime `--help`; runtime SHA equals the clean export. `build-context-audit.json` states `dockerDaemonUsed:false`, `imageId:null`, `accepted:false`. The script's final `built b09-context-audit-only` line reflects the fake boundary's zero exit and must not be interpreted as an image build. The log begins with the explicit NO IMAGE BUILT label.

## Docker prerequisite and R76 handoff

The earlier successful Docker inventory is historical. Root's first attempt required explicit cleanup of its owned shell/client. B09's first effective subprocess check owned PID 56783 and timed out after 15.011 s, TERM exit 143. The final check ran `docker info --format '{{json .}}'` in an owned process group; PID **60963**, timeout **15.013 s**, TERM exit **143**. Its formatted output has blank server ID/version/architecture and zero resources, so it is not valid server metadata. Read-only context inspection found the orbstack socket but did not prove server availability. See `docker-recheck.json`; no daemon, unrelated process, container or volume was reset or changed.

R76 permits independent implementation review and downstream portable preparation after clean export/pin. No more stalled Docker attempts were made. Actual WEB05 remains `not_run/blocked_environment`; image identity remains null/unbuilt, distinct from the host runtime export. B10 must execute the following only if the prerequisite becomes available, otherwise explicitly hand off the open gate:

- Actual image arm readiness/run and mobile compile → readiness → run.
- Actual image shared-cell completed execution.
- Two competing containers sharing the named data volume, refused before a second world starts.
- Container kill/restart, crash-release and committed-chunk hash preservation.
- No automatic world resume on recovery; finished-run replay and clean stop from that image.

Neither local Darwin workers nor the static context audit qualify Linux arm64 containers. Native Linux amd64, public HTTPS/WEB06, Cloud Run and hardware are also not_run/unqualified. L00 must keep current R2b image origin unresolved and `nativeReady:false`, separately from historical R2a image evidence. This defers verification sequencing, not acceptance criteria.

## Verification commands and results

All logs below are in `.superpowers/sdd/02-r2b-cell-and-web/evidence-B09/`. Run from the Source worktree unless specified. Environment: `export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"`; Python-bearing tests set `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`. Long suites used Perl alarm. A skipped or name-filtered test is not_run, never a pass.

```sh
ENGINEERING_PYTHON="$PWD/.venv-irsim/bin/python" PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/security/lab-run-writer.test.ts tests/security/web-replay-gateway.test.ts tests/integration/lab-runtime-persistent.test.ts tests/integration/lab-runtime-container.test.ts tests/integration/lab-runtime-gateway.test.ts tests/integration/lab-runtime-remote.test.ts tests/integration/engineering-runtime-options.test.ts tests/integration/lab-v2-runtime-review.test.ts tests/unit/world-runner.test.ts
```

`regression-final.log`: **66 passed / 2 not_run**, 8 passed files / 1 skipped container file, 22.82 s. Breakdown: writer 6, replay gateway 4, persistent 8, legacy gateway 6, remote 15, engineering 4, v2 review 7, world runner 16. Container 2 skipped. Writer tests use two real HTTP clients/tokens and an explicitly authorized protocol-double engine: exactly one racing write executes; unrelated access remains private404. Delayed transfer/action, expiry/reclaim and current-owner expiration boundaries are covered. This engine count is security evidence only.

```sh
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/lab-runtime-persistent.test.ts tests/unit/world-runner.test.ts tests/integration/mujoco-mobile-lifecycle.test.ts -t 'reclaim|actual Mac'
PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/integration/lab-runtime-persistent.test.ts -t 'actual Mac'
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/acceptance/lab-v2-mock.acceptance.test.ts -t BV01
```

`reclaim-focused.log`: 4 passed / 36 unselected not_run, actual arm/mobile and retained-world recovery. `actual-worker-owned-record.log` with `actual-worker-processes.json`: 1 passed / 7 unselected not_run, process identity recording described above. `mock-bv01-golden.log`: 2 passed / 39 unselected not_run, 37.88 s; BV01 recipe/custody regression and QA03 FD07/BV01/FD03/FD04-reopen deterministic repeats. These are focused regressions, not a rerun of B06 qualification campaigns.

`engineering-cors-final.log`: 19 passed with the existing venv Python helper and exact CORS header assertions. Earlier default-python helper skip was corrected, not counted as passing. `artifact-test.log`: 4 passed / 1 optional clean-checkout mode not_run; ordinary artifact checks include exported runtime startup away from Source with embedded SQLite migration. A real clean export was executed directly below; the optional `LAB_V2_CLEAN_EXPORT=1 --clean-checkout` test path was not enabled.

```sh
perl -e 'alarm 300; exec @ARGV' pnpm contracts:check
perl -e 'alarm 300; exec @ARGV' pnpm typecheck
perl -e 'alarm 300; exec @ARGV' pnpm lint
perl -e 'alarm 900; exec @ARGV' pnpm build
node scripts/export-lab-runtime.mjs /tmp/b09-runtime-HIN3kP
# In sibling Lab:
node scripts/import-runtime.mjs /tmp/b09-runtime-HIN3kP
node scripts/sync-engineering-contracts.mjs
pnpm check:source
pnpm typecheck
```

All passed. Logs: `contracts.log`, `typecheck-release.log`, `lint-release.log`, `build-release.log`, `clean-export.log`, `lab-import.log`, `lab-sync.log`, `lab-check-source.log`, `lab-typecheck.log`; export path also recorded in `runtime-export-path.txt`. `git diff --check` passed. No full repository `pnpm test`, native campaign, public proxy execution or container suite pass is claimed.

## RED attempts and corrections retained

| Evidence | Observation and resolution |
| --- | --- |
| `persistent-red.log` | Competing runtime/corrupt ownership state accepted before data-root lease implementation. |
| `public-close-red.log` | Held public response delayed owned cleanup; second close also exposed non-idempotence. Public close ordering/idempotence fixed. |
| `ownership-close-green.log` | First implementation had a port-variable scope ReferenceError; corrected, `ownership-close-green2.log` 7 passed. |
| `writer-red.log`, `writer-red2.log` | Test catalog retained MUJOCO_DISABLED fixture reason; fixture corrected, not product evidence. |
| `writer-red3.log` | Genuine public session ID, writer-route and CORS failures before implementation; `writer-green.log` 4 passed, final expanded writer file 6 passed. |
| `process-writer-green.log` | Child fixture incorrectly depended on direct esbuild; switched to existing tsx. `process-engineering-green.log` 8 passed / 1 then-unavailable default Python helper. |
| `engineering-red.log` | Catalog fixture shape error; corrected. |
| `engineering-red2.log` | Genuine native simulation-root requirement blocked portable-only engineering; explicit profile option fixed. |
| `sse-close-red.log` | Root lease released with pending SSE journal I/O; event-stream lifetime fixed. |
| `actual-worker-sse-green.log` | Cell setup lacked mobile/engineering fixture enablement; scoped actual shutdown proof to arm, without claiming cell qualification. |
| `actual-worker-green2.log` | Genuine cold arm reclaim spawned new world; R75 approved frozen recovery. Failed owned worker cleaned. |
| `reclaim-arm-green.log` | Actual arm recovery passed after R75 fix. |
| `reclaim-stale-red.log` | Derived retained poses incorrectly reported valid; now stale without changing committed physical state/telemetry. |
| `regression.log` | 64 passed, 1 exact CORS-list failure, 3 not_run; updated exact expected new header and used verified existing helper interpreter, final 66/2. |
| `typecheck-first.log`, `lint-first.log` | WIP option typing/node events typing and empty-catch lint failures corrected; final gates passed. |

No failed log was rewritten to imply success. Temporary test runs used unique roots and owned processes. No original raw SQLite/archive was opened for mutation; historical recordings were unchanged. Existing replay tests use their established retained-byte inputs; new process/worker tests use disposable roots.

## Self-review and remaining concerns

Reviewed the full Source original-base diff (30 files, +539/-79), including new ownership/deployment/tests, and Lab original-base diff (pin plus two generated headers). Checked private404 versus reader/writer/proof authority, epoch write-before-transfer, execution-time checks, failed-start lease cleanup, held read/worker close barriers, frozen reclaim versus ordinary direct reopen, image advertised compiler availability, clean closure and exact pin. No known implementation blocker remains from self-review; independent review is still required.

The concrete open risk is unexecuted container closure/permissions/filesystem/lifecycle behavior, plus unexecuted proxy/TLS deployment behavior. Static config/context validation, actual Mac worker lifecycle and local process races reduce these risks but cannot replace image execution. Persistence assumes a supported local filesystem and an operator-owned root; it is not a multi-host lease. Cold recovery intentionally provides retained/stale/unknown views, never a restored live MuJoCo state. All qualification records remain `accepted:false`; root owns review and B10 owns the explicitly open WEB05 gate under R76.


## Fix round 1 addendum — 2026-11-15

Independent review 1 required I1 cold-reclaim run-ID serialization and I2 required retained-state validation. Both are implemented for scoped re-review in Source `3c917ceee6a92c6b087f0bd37baaa4e0740d44a8` and clean Lab pin `538ba452c81005010a479f337aab0edbad6e5159`. The fix report is `task-B09-fix-1-report.md`; retained RED/GREEN logs use `evidence-B09/fix1-*`. Related regressions passed 48/48, including actual Mac intact arm public close/cold/repeated reclaim, and the final committed-head writer check passed 8/8. Contracts/lint/final typecheck and clean export/Lab import/sync/check/type passed.

New clean export `/tmp/b09-fix1-runtime-VrRq1n` has runtime SHA256 `18967bcf397be1e1d43ca86fae2cdae3558be90772981c9c112b071ff54aabae`, manifest SHA256 `196e1aebc1c56a97137c578ea5e4d08da3dded171eef2ef09705cf3ff00d753c`; schema/tools unchanged. The original static context audit remains tied to f419bdc/75beea81 and was not retagged or repeated. Original report prefix is preserved at 21480 bytes, SHA256 `c3635559793e64e434830b371a12409d12ee5c69003fb235c5ce5c8f044b69de`. All prior failures and qualification limits remain recorded. R76 still applies: image null/unbuilt, WEB05 not_run/blocked_environment, accepted:false; independent scoped re-review pending.
