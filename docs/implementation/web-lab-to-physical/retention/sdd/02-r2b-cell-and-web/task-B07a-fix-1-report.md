# B07a fix round1/5 — review1 I1–I4

Status: DONE_WITH_CONCERNS — all four Important findings are addressed and ready for scoped rereview. M1 remains deferred by the controller; no new native/browser/performance/acceptance claim.

## Exact review/integration tuple

- Fix BASE Source `a5b2ee0fb1d5f3799aca774d7930d66985a30321`; Lab `57d9c869387f408603645becb502dea394d8e2fe`.
- Final clean Source `5e09a48d4a8625276495694b1a29c04679bc6a77` — `fix: close replay validation and download lifecycle gaps`.
- Final clean Lab `be01048a9d1e642cd77cecab99e7a24d2d0368bb` — `chore: pin source runtime 5e09a48 and replay fixes`.
- Branch remains `codex/web-lab-to-physical`, authorized Source/Lab worktrees only. No helpers, original-main changes, trial/web, fixed operational ports, native worker/host/robot/cloud actions, push/deploy/merge or original evidence changes.

Evidence is under `evidence-B07a/fix-1/`. `final-provenance.json` binds committed validator files, the exact runtime/pin and unchanged retained packages. The full previous report and its earlier failed/pass invocations remain unchanged except an appended fix addendum.

## I1 — closed role/media/format and complete integrity admission

Source `web-replay-package-v1.schema.json` now has a closed role/media matrix and format/encoding rules, before asset IO:

| Roles | Media/format |
|---|---|
| report, events, scene, profile, vendor, trace; JSON model | `application/json`, `.json` or `.json.gz`; identity requires `.json`; gzip also preserves the existing compressed arm `.json` names |
| binary model | `model/stl`, `.stl`, identity only; existing bounded triangle/byte checks still apply |
| notice | `text/plain`, NOTICE/LICENSE or `.txt`, identity only |
| world, physics, navigation | `application/x-ndjson`, `.ndjson` for identity or `.ndjson.gz` for gzip |

A trace/model/profile NDJSON cannot skip validation; a model JSON cannot disguise itself as text/plain. Supported renderer JSON still receives nested dependency URL/format checks. A scene file reference must target an admitted model/profile/scene role, so relabeling a renderer component as vendor/trace metadata does not bypass those checks. A verified-path set additionally requires every admitted asset to have completed its encoded and decoded size/hash checks before a reader can be returned. World/physics stream refs remain mandatory; navigation NDJSON retains its line/tree checks. All three genuine v1 packages remain readable without changing their bytes.

Changed files: Source schema + generated navigation types, `replay/reader.ts`; Lab sync copies the schema, generated types and exact reader. No hand-diverged Lab implementation or new asset format/engine.

TDD: `reader-red.log` has3failed/6filtered against the original reader (unsupported role/media accepted, post-open metadata retained, post-sample metadata retained). Final reader has11/11passing. The closed-role test exercises zero-hash NDJSON trace, model.json/text/plain containing an external texture URL, and unsupported model.glb; all refuse before any read callback. Auxiliary admitted JSON roles each fail on a bad hash. Existing nested external URI tests remain.

Supplementary scene-role sensitivity: an initial `role-reference-red.log` fixture omitted its bundle prefix and was already refused for a missing ref; it is **not** claimed as a valid RED. The corrected fixture and temporarily removed scene-role guard produce1failed/10filtered in `role-reference-guard-red.log`; restoring the guard passes11/11 (`reader-green-restored.log`). The mutation is absent from the final commit.

## I2 — one idempotent disposal path

`openReplayPackage` now uses one disposal path for external abort, close and failed opening. It clears owned decoded cache, captured report/source-event values, scene values, bounds/verification state and the external signal listener, then aborts owned loading. Disposal is idempotent. Already-returned caller-owned samples/asset buffers remain caller responsibility.

External abort after successful open immediately makes `capturedReport` empty; post-sample abort also discards the cached chunk. Later calls refuse with ABORTED (manual close uses CLOSED). Cancellation is checked after each asynchronous digest and immediately before publishing the successfully opened reader, closing the final-digest race. No Source live state/world action is affected.

Tests cover during-load iterator cleanup, post-open abort, post-decoded-sample abort with unchanged caller sample, close idempotence and abort injected at the final digest boundary before successful publication. Lab adds the demonstrated matrix and post-sample abort regressions against the synced reader. `lab-reader-red.log` has2failed/2filtered against the old reader; after clean Source sync, `lab-reader-green.log` passes4/4 with its existing drift/no-runtime/close checks.

## I3 — Ruling62 download admission and lifetime

Indexed GETs now have a synchronous, process-wide admission check **after** private run/version/index admission and before file IO/allocation:

- Maximum4active indexed downloads.
- Maximum16MiB sum of reserved **encoded** asset sizes.
- No read queue. Excess429 `REPLAY_READ_CAPACITY`; other session/unknown run/version/index remains private404 before this limit.
- A reservation is released once, only after **both** owned IO cleanup and response `finish` or `close`.
- Client close aborts the owned read, but cannot release capacity while that read still runs. Completed IO also cannot release while its response still holds/queues the encoded buffer.
- Read errors, hash/size refusal, owner/version changes and aborted connections follow the same two-part lifetime. A post-header failure destroys the response rather than attempting another header block.
- Gateway close aborts/destroys owned downloads and waits for their IO/response cleanup before run/export cleanup.

The existing `readReplayInput(root,path,max)` gains only an optional fourth `{signal?:AbortSignal}` argument. It checks cancellation before IO, before allocation, between reads and after final stat; file handles still close in `finally`. Existing local CLI calls with no signal preserve their behavior. The gateway rechecks the same version remains registered after async IO as well as existing owner/session checks. Health publishes `maxConcurrentDownloads:4` and `maxDownloadBytes:16777216` for B07b. This bounds admitted work/queued encoded bytes, not total JS heap or browser performance.

The download test is explicitly a protocol/lifecycle fixture: synthetic hash-valid JSON assets, controlled owned-read gates, a real HTTP server/response and an instrumented binary `end` held before finish. It proves separately:

1. Two8MiB owned reads fill16MiB and refuse a third before another read; foreign session and invalid index still404.
2. Aborting the client while its read is pending does not release bytes until that controlled read's cleanup completes.
3. Two completed reads with responses held before finish still reserve16MiB after the handler returned.
4. With one8MiB response held, three small pending reads reach the4active cap while bytes remain below16MiB.
5. A read failure releases only after cleanup/error-response completion; a normal held response finish also restores admission.

The first baseline RED waited for a capacity response that the old handler never sent (`download-red-bounded.log`, timeout after a third owned read instead of429). Initial harness/diagnostic invocations (`download-red.log`, `download-green-initial.log`, `download-diagnostic.log`) had incomplete cleanup/timeout because the concurrent small-read failure was associated with a request by arrival order. The final harness uses the first actually completed error response and identifies the aborted read by its signal, so it does not assume network request ordering. Those initial logs are not passes or a product performance measurement. `download-green-finish.log` passes the full download lifetime test; final all gateway4/4 also pass.

## I4 — browser DELETE preflight

The parent real HTTP OPTIONS path advertises `GET, POST, DELETE` **only** for `/lab/v2/runs/:runId/replay/:exportId`. Other paths retain `GET, POST`; PUT and other methods are not added. Existing origin policy, credential policy, session ownership, readonly reclaim and CSRF enforcement stay in place.

`cors-red.log`:1failed/2filtered, actual parent preflight advertised onlyGET/POST. The fixed test checks OPTIONS with `Access-Control-Request-Method: DELETE`, then authorized cookie+CSRF DELETE on the proof-reclaimed version. It also checks bad origin403, unrelated actions route without DELETE, old owner404 and missing-cookie-CSRF403. Node fetch is used to inspect the real preflight response and operation; this is not a Playwright/browser-performance claim. `cors-green.log` and final gateway4/4 are green.

## Final focused checks and commands

Node24.22.2/pnpm10.32.1 via explicit nvm PATH; every long command has a Perl alarm. No Python/native engine was invoked. Filtered tests are not_run, not passes.

| Check | Actual final result |
|---|---|
| Source reader + gateway + exporter |3files/23passed, no skips, `focused-final.log` |
| Source contracts check |exit0, `contracts-check.log` |
| Source typecheck/lint |exit0, `typecheck-final.log`, `lint-final.log` |
| Actual revised Source reader on3existing packages |all rows/assets/scenes/H/metrics/events exact, `source-retained-readback.log` / `source-retained-summary.json` |
| Actual revised pure Lab reader on3existing packages |same exact results, `lab-retained-readback.log` / `lab-retained-summary.json` |
| Lab reader regressions/drift/no-runtime |1file/4passed, no skips, `lab-reader-green.log` |
| Clean export/import/sync/typecheck/check-source/sync-check |exit0, `runtime-export.log`, `lab-import.log`, `lab-sync.log`, `lab-typecheck.log`, `lab-check-source.log`, `lab-sync-check.log` |
| Committed Lab pin check |exit0, `lab-check-source-committed.log` |
| Original preservation |592original file hash/size checks, zero changes; `final-provenance.json` |
| Whitespace/final worktrees |diff check clean, Source/Lab clean |

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/web-replay-reader.test.ts tests/security/web-replay-gateway.test.ts tests/security/web-replay-export.test.ts
perl -e 'alarm 90; exec @ARGV' pnpm contracts:check
perl -e 'alarm 180; exec @ARGV' pnpm typecheck
perl -e 'alarm 180; exec @ARGV' pnpm lint
perl -e 'alarm 180; exec @ARGV' pnpm exec tsx /tmp/b07a-fix1-roundtrip-source.ts
perl -e 'alarm 180; exec @ARGV' pnpm exec tsx /tmp/b07a-fix1-roundtrip-lab.ts
# Lab
perl -e 'alarm 90; exec @ARGV' pnpm exec vitest run tests/unit/replay-package.test.ts
perl -e 'alarm 120; exec @ARGV' pnpm typecheck
perl -e 'alarm 120; exec @ARGV' pnpm check:source
node scripts/sync-engineering-contracts.mjs --check
```

Only the affected suites were run; previous broad/platform/native evidence is not relabeled as rerun. The three genuine package files remain at `/tmp/b07a-final-packages-ZYL6r5/{nominal,world-cup-fall,cup-fall}`, with unchanged manifests `b3eb6e7cc0e6c2287092c358e02ab3c860e76e5bc828a5ed41bae4e83bbebaea`, `98d43fafb890e9bd9cce7c0de6bdc182b46458ec8d601ba44a8f73494526e6e7`, `0300656468e9cf507a2844d3e784cf89c4b2e038ebcc1ce405bdc4e49383953f`. Revised Source and Lab readers verify10851/2376/521exact rows and22/22/8exact admitted model/profile files respectively, captured report/scene/event/receipt identity and exact final cursor. No new package/physics recording or original archive edit was needed. All producer/acceptance/calibration/R61 distinctions remain as before.

## Clean export/pin artifact tuple

Clean export `/tmp/b07a-fix1-runtime-cZatvv`, Source `5e09a48d4a8625276495694b1a29c04679bc6a77`, dirtyfalse:

- Runtime artifact SHA256 `e054dbfbbb865fca4c96d16a06dfe7ad40aaa31155af4af3511c67178ab3a7c1`.
- Runtime manifest SHA256 `fcb52572a6a8f6915f468473e78c9ed2e455943b51d928fa1e78f6ce355a12d9`,66170bytes.
- Schema hash `6efad9fb9d30d10767ab10452eb941a0de56c67cc21f3362d76d29512202030e`.
- Portable-tools digest `375d352c7e27271e4b8560a002d1dd89c4df3564df465544f40415382d4eb91a` (schema closure changed, no physics/model/controller change).
- Lab pin `be01048a9d1e642cd77cecab99e7a24d2d0368bb` names exactly this Source/schema/artifact tuple.

## Self-review, concerns and handoff

Self-review covered the complete fix diff, including all schema branches, every eager read path, disposal reentrancy/cancellation boundaries, synchronous download reservation, IO+finish/close release, error/close cleanup, owner/version recheck and route-limited preflight. Source and Lab retain one synced reader; existing source capture/physics/report paths were not redesigned. No open I1–I4 issue or new engineering blocker is known.

M1's machine-specific retained-evidence test paths remain deferred exactly as instructed, with no silent missing-input pass. B07b should consume sequentially and handle429 `REPLAY_READ_CAPACITY` truthfully; four slots/16MiB are a service resource policy, not a throughput guarantee. R61 raw-entry drilldown, B07b browser/performance and B09 cross-process writer ownership remain previously scoped limitations. Root owns the scoped rereview; none was delegated or substituted with this self-review.

## Controller review outcome and public shutdown qualification
Independent scoped review2 closedI1–I4 withno newfixbreakage. Its unchanged parent shutdown observation means the active abort/destroy-on-close claim above applies to **internal v2.close only**; public g.close waits server.close first and may wait for a held active response. Ruling63 schedules public-close ordering/regression with B09 drain/stop+data-root ownership. The request-level4download/16MiB reservation lifetime is reviewed; prompt public shutdown is not established here. M1retainedtestportability remains deferred. Full report: task-B07a-review-2.md.
