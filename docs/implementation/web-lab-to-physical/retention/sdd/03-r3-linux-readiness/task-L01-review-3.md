# L01 scoped fix-round2 re-review

**Final scoped verdict: APPROVE. L01-R2-01 is ADDRESSED.** No new Important or Critical issue was found in the fix. This approves the scoped preparation-tooling correction only; native qualification remains **not_run**.

## Scope and reviewed identities

Reviewed the binding `task-L01-brief.md`, prior `task-L01-review-2.md`, the complete 9,961-byte fix2 append in `task-L01-report.md`, supplied Source/Lab fix packages, retained covering outputs, and root handoff/byte-audit summaries. Review was confined to L01-R2-01, the changed code, and its exact writer/reader/staging dependencies. R1-01–04 were not reopened; deferred Minor R1-05 remains deferred.

| Repository | Fix BASE | Final HEAD |
| --- | --- | --- |
| Source | `eeea18db88485e113aafe1cc15edd7f75ced2b66` | `874d05aedfbf573496994fd73016f19ef19e6932` |
| Lab | `e8577a5b7f4f6b615aa333b3f86126d06e1f0c05` | `4a207b43c613cf0c1226a9ff3c1990a96ec5ac08` |

Read-only HEAD/status checks confirmed both final heads and clean working trees. Source `HEAD^{tree}` is `6a59ef54f7861d12b1901d88da63394df6b5a830`, matching retained `fix2/checked-source-tree.txt`. The reported final precommit covering checks therefore apply to the committed Source tree.

The supplied package identities are Source 19,832 bytes / SHA256 `714c10d87b882ea4c83e1ed5e8217d358c773fa8dac80e5ed7a2deffcf59869d`, and Lab 3,433 bytes / SHA256 `8a507355a4f73a8509575b17af5cce7475237491db1b17eb2101eea88c884999`, as independently audited by the root controller. I did not rederive a diff/log or repeat that byte audit. Source changes comprise the shared action writer, its declaration, the container delegation, observer staging list and three lifecycle regression cases. Lab changes remain its current runtime lock and two generated Source-commit headers.

## L01-R2-01 — ADDRESSED

**Required correction:** retain attempted requests before dispatch, persist successful completion before final result construction, preserve failure/in-flight semantics and strict raw-summary equality, and cover the real writer-to-reader ordering with a portable regression.

`scripts/native-sim/mujoco-probe-actions.mjs:6–8` constructs `received:false`, appends the request and awaits its filesystem save before calling the HTTP API. At line 9, a successful response marks that same request received and advances the private revision. Line 11 then **awaits the completed-state save before memory sampling or returning** at line 12. Rejected or still-pending API calls cannot reach either the received mutation or completion write; their previously retained attempted request remains false. A failed completion save propagates rather than returning a successful action result.

The container imports this helper at `scripts/native-sim/mujoco-probe-container.mjs:2` and creates its action function at line 47 after obtaining the actual run ID and initial revision. Calls remain serial and awaited at lines 48, 56 and 58. Consequently the final successful action has completed its second save before the business raw result is built at line 65 or `result.json` is written at line 87. Both the three business cases and worker-loss case use this path. The extracted counter and private revision retain the old action-ID/request/revision behavior; no later code depends on updates to the former outer revision variable. Timing is still sampled immediately after the HTTP response, before the added completion write, with the existing pre-dispatch save included in that elapsed sample.

`scripts/native-sim/mujoco-probe-core.mjs:17` adds the helper to the same `OBSERVER` set used to stage files at line 21 and independently compare their bytes during readback at line 96. The container's new relative import is therefore supplied and pinned. No subject/image file is replaced by the observer helper.

The reader remains strict and unchanged: `scripts/native-sim/mujoco-probe-raw.mjs:22` requires deep equality of retained `requests.json` and `raw.requests`; `mujoco-probe-core.mjs:113` still applies it to both business and worker-loss records. This fix repairs the writer rather than relaxing evidence acceptance.

The new test branch at `tests/unit/mujoco-native-probe.test.ts:197–218` imports the production helper, clears the synthetic request array, and gives it a real temporary-filesystem `save` callback. The substituted API verifies the pre-dispatch file is false and checks the exact action ID, route, method, initial revision and payload. The final-success case runs exactly one successful action, confirms the returned response and one completed timing sample, then passes its actual retained file through production `verifyBusinessRaw` at line 223 and checks file/summary equality at line 225. Its completed request file is produced by the writer itself. The in-flight case pauses inside the substituted API and inspects both disk and memory before releasing it into failure. Failed and in-flight cases retain false and no completed timing sample. Their final assertion at line 226 also confirms `assessCase` rejects the incomplete request via `SERIAL_NO_RESEND`; equal raw bytes alone do not imply a passed campaign.

## Covering evidence and attribution

I read the retained outputs under `evidence-L01/fix2/` and matched the reported commands to the changed files/tests:

- Focused `pnpm exec vitest run tests/unit/mujoco-native-probe.test.ts -t 'writer-'`, bounded by 60 seconds: `writer-red.log` records **1 failed / 2 passed / 40 unselected**. The final-success failure is exactly `HTTP_REQUEST_BYTES`. `writer-green.log` records **3 passed / 40 unselected** after the completion save. Unselected cases are not counted as passes.
- Covering `pnpm exec vitest run tests/unit/mujoco-native-probe.test.ts tests/security/mujoco-native-probe-checker.test.ts`, bounded by 120 seconds: `covering.log` records **52 passed in 2 files**, comprising 43 L01 unit cases and 9 checker-security cases, with no skipped cases in that covering invocation. The final committed test includes the additional incomplete-request refusal assertion.
- Source `pnpm typecheck`, bounded by 180 seconds: retained output shows route generation and TypeScript execution without errors. The reported 60-second scoped ESLint command names all five changed Source files; `lint.log` is empty. Its successful exit and `git diff --check` success are supplied by the implementation report/root handoff, not inferred from empty output alone.
- Lab import, schema sync, source checks and typecheck outputs show the new Source pin and successful checking. The current lock is `dirty:false`, Source `874d05a…`, runtime `7230dcac101d3010a9580b22f9c5d1ded01b79c917a6e7dff9182a9f262f7013`; its schema and portable closure match the reported current export.

No check was rerun: the retained meaningful RED/GREEN, final covering tree match and direct code inspection resolve the scoped ordering question. No broader historical suite count is attributed to this round.

## Boundaries and remaining qualification

The root handoff and byte audit establish the new 184 refs / 9,648,529 bytes, six preserved artifact sets, 51 + 27 + 28 retained evidence files, unchanged 40,356-byte prior report prefix and current export/pin/cache identity. I used those as byte/identity evidence and did not repeat the historical audits or treat them as semantic/native proof.

The retained independent preparation output is `prepared:true` / `nativeReady:false`, with `PACKAGE_LOCK_UNRESOLVED`, `SUBJECT_IMAGE_UNRESOLVED` and `HOST_INVENTORY_MISSING`. The new probe CLI output records `NATIVE_AMD64_HOST_UNASSIGNED`, all **16 cases not_run**, exit 2; independent readback exits 1 with `passed:false` / `not_qualified`. These remain accurate refusals.

Historical subject Source `4f893ac6fb75dff414a3ee42a726defb7935c734`, Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00` and runtime `55dd3585…` remain separate from current checker Source `874d05a…` / full-graph tool digest `f0052cf8449b7c978d432ead1c65a9ebfda784db166933ada3e9c6bba9f0557f` and the current Lab export. R81 historical adapter identity, R82 component versus full-runtime fault scopes, R83 current-R2b adapter ownership in B10 and R84 passive observation remain binding and are not altered by this fix. Source authority, one in-flight ACK, unknown/no replay/no resend/no respawn, immutable historical evidence, `accepted:false` and dynamics `not_calibrated` remain intact.

No new Important/Critical finding and no additional untouched-code observation is raised. This review used no helpers, test reruns, production `--plan`, Docker/native engine, cloud or hardware actions and opened no historical SQLite database. No product code, index, HEAD or branch state was mutated; only this review report was written. Native matrix and DEP-MJ-01 remain **not_run** regardless of this scoped tooling approval.
