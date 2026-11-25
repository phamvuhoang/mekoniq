# Independent remediation review — coffee, ARM, packaging

> Tracked snapshot of the local implementation/review report. Interim results are preserved; later follow-ups supersede earlier findings. Temporary probe names refer to disposable review scripts, not committed artifacts. Local tool paths were normalized; commands require Node 24.22.2 on PATH. Final pin/full-CI/acceptance status is recorded in the [remediation index](../2026-11-05-plan-01-remediation.md).

Reviewed 2026-11-05, uncommitted implementation relative to source `e152814` and Lab `dfa05c2`, including new untracked implementation/test files. This is an interim review of the scoped work, not final Plan 01 acceptance. Runtime/gateway/mixed-workload and Lab UI implementation remain outside this review except the packaging HTTP boundary needed to reproduce a failure.

**Verdict: request changes.** R01–R05's original reproduction paths are repaired, but three concrete residual faults remain in the reviewed state. Findings were sent to root while reviewing; root has announced fixes to the two packaging findings. Those future edits are not verified by this report.

## Findings

### P2 — C1: Duplicate recipe resource IDs violate reservation/movement conservation

Locations: `source/packages/domain/src/beverage/recipe.ts:36–45`, `source/packages/domain/src/beverage/resources.ts:53–66,76–85`.

`parseRecipe` rejects duplicate step IDs but accepts duplicate `resourceId` entries. `reserveStock` consequently creates more than one reservation for the same job/step/ingredient. `consumeStep` uses one stable movement ID for that tuple, and each iteration starts from the unchanged input stock snapshot. Both reservations become consumed, but the repeated stock updates and movement IDs collapse to one deduction.

Reproduced through the real production registry, authorization and temporary SQLite store using the existing least-privilege coffee fixture: register a valid hashed `espresso@99` recipe with one 80 mL milk step and `resources=[milk 80 mL, milk 80 mL]`; reserve, start, complete with measured 80 mL, then confirm quality. **Every command was accepted**. The job contains two consumed 80 mL reservations (160 mL total), while stock changes from 2000 to 1920 mL, `movementSeq` is 1, and the two reservation entries reference the same effective movement. A direct pure-function probe also showed two same-ID `StockMovementRecorded` and two stock updates both setting 1920.

This is a residual admission/conservation gap, not a claim that the original repeated-step R04 reproduction still fails. Reject repeated resource IDs before reservation, or define aggregation and allocation semantics that preserve a unique job/step/ingredient reservation and measured quantity. Add a regression through command processing so duplicate aggregate event collapse cannot hide the mismatch.

### P2 — P1: Artifact import audit rejects the real exported runtime

Locations: `source/scripts/lab-runtime-audit.mjs:3–6`, identical `lab/scripts/runtime-audit.mjs:3–6`.

The regular expression treats literal `require(...)` text inside dependency-generated strings as an executable import. A fresh run of `tests/integration/lab-runtime-artifact.test.ts` fails the actual export with:

```text
NON_STANDALONE_IMPORT:ajv/dist/runtime/validation_error
at auditBundle (.../scripts/lab-runtime-audit.mjs:6:89)
```

This blocks producing the repaired source artifact and therefore the new clean pin/offline release. Root identified the bundled AJV code-generation string and is replacing the regex with syntax-aware inspection. Retest the actual exporter outside the source checkout, plus importer parity; standalone literal examples alone did not catch this regression.

### P2 — P2: Offline custom UI ports report readiness but cannot pair

Locations: `lab/scripts/offline-start.mjs:49–55,68–70` and proxy at `:28`; source admission contract `source/packages/lab-runtime/src/gateway.ts:11,41–44`.

The offline CLI accepts arbitrary non-operational `--ui-port`, prints a ready URL, and forwards the browser's original Host and Origin. The source gateway admits browser UI origins only at `127.0.0.1:4175/4176` and rejects a custom UI Host. The offline integration test uses 49175/49176 but checks boot readiness only, never browser pairing through the proxy.

Reproduced using the real source gateway and offline `staticServer`, both on OS-assigned ephemeral loopback ports, with no fixed-port UI: POST `/lab/v2/sessions` through the proxy with its browser Origin returns **403 `{error:"HOST_FORBIDDEN"}`**. Both servers and temporary storage were closed/removed. The default port's browser pairing was not tested in this review because root owns the fixed-port window.

Constrain the accepted UI port to the gateway's explicit contract or pass one exact allowed UI origin to the runtime; do not weaken Host/Origin/CSRF admission globally. Root intends the former. Test actual proxy pairing, authenticated reads, CSRF rejection and session expiry on the final bundle, not just direct health.

## R01–R05 assessment

| Finding | Assessment | Evidence / remaining boundary |
| --- | --- | --- |
| R01 cup removal | Addressed for original paths | Absence persists; unused verification is revoked; mid/post-preparation jobs remain held. Five removal regressions passed, including ready-for-pickup. Positive observation cannot silently resume uncertain preparation. |
| R02 arm interlocks | Addressed for original paths | Both pick/place call readiness/fault/freshness interlock before producing lease/effect events. Fault, offline and stale variants passed. This establishes command admission, not physical arm readiness. |
| R03 second cup | Addressed | Preparation count excludes already quality-counted jobs. Sequential delivered-cup and cancel/remake regressions passed. |
| R04 repeated ingredient steps | Original case addressed; conservation not fully closed | Repeated milk steps reserve separately and deduplicate by step. Explicit bean allocations handle mass versus brewed volume without invented conversion. C1 remains for duplicate resource IDs. |
| R05 manual delivery | Addressed for original paths | `Fulfillment.HandOff` atomically changes served quantity, exact bound job, human/customer custody and leases. Missing cup/pending transfer reject whole command. Nine conservation tests also cover separate/combined allocations and mission custody rejection. |

## Other reviewed behavior and evidence limits

- Policy checks use exact decimals for capacity/headspace and explicit ice displacement; no general mass/volume conversion is assumed. Policies are included in recipe hashes. Modelled quality and milk temperature require both simulation venue opt-in and simulated device state. Outliers remain raw uncertain evidence and do not deduct the implausible amount. Same-batch opening/cold-chain history survives reboot. Optional absent policies remain legacy behavior; a legacy recipe passing is not evidence of capacity or milk-policy validation.
- The ARM sweep uses adaptive interval subdivision and a conservative reach/sum-of-joint-motion bound, checks capsule self-pairs and sphere/AABB world objects, and blocks unresolved intervals at its tolerance rather than returning clear. All eight ARM safety-model tests passed, including clear endpoints with an intervening obstacle, held cup geometry, self collision, and unknown-custody retention after stop/reset.
- **ARM geometry limits remain material:** capsule links join DH frame origins; intentionally adjacent bodies are excluded from self-collision. Tests use the declared illustrative model, not meshes or measured mechanical dimensions. The current default PUMA tool translation is zero. Do not generalize the result to arbitrary nonzero tool geometry, physical grip, dynamics, spill or stop distance.
- **Runtime scene integration is partial:** `MockArmPlant` initializes `collision.world=[]`; `CoffeeDriver` does not feed project obstacles or AMR geometry into it. Runtime `arm-collision` injects a local sphere at the TCP. Synthetic tests demonstrate sphere/AABB checker capability, but current ordinary runs do not establish arm-versus-project-scene/robot collision checking. `armCollisionChecker:true` means checks executed, not that every scene object was represented. Full scene/robot ARM03 PASS would require the frame/geometry mapping or a clearly narrower evidence status.
- Stop request/acknowledged/observed are distinct modelled events occurring at the same model tick. Reset unlatches but does not resume the unknown program or release its held cup. This is not a measured controller latency or physical E-stop result.
- The backup XOR mutation always changes the selected byte and asserts that fact. The new verifier check passed across all 256 possible original byte values. This review did not independently rerun Supabase-backed upgrade recovery; root's separate seven-test result is not counted in the numbers below.
- Offline builder packages the current Node binary, built UI, pinned runtime, schemas, lock and notices; verifies file hashes and rejects symlinks/path escape. This does not establish a clean Linux host, cold reboot, or disconnected-network acceptance. Real final UI dependency/assets loading and browser authentication still need execution against the final pin.
- Importer scans candidate runtime before lock mutation. The current regex fault must be fixed before asserting a successful clean export/import. The final bundle must be rebuilt after source is committed/pinned; the current installed old runtime is not proof of the repaired implementation.

## Checks executed in this review

Node **24.22.2** with that version first on `PATH`.

Source focused command:

```text
node node_modules/vitest/vitest.mjs run
  tests/integration/coffee-review.test.ts
  tests/integration/coffee-conservation.test.ts
  tests/integration/coffee-policy.test.ts
  tests/integration/lab-v2-arm-safety-model.test.ts
  tests/unit/backup-verification.test.ts
  tests/integration/lab-runtime-artifact.test.ts
```

Result: **48 passed, 1 failed, 1 skipped**, six files, approximately 5.36 seconds. Failure is P1 above; skip is the clean-checkout exporter test. The 46 coffee/ARM/backup checks passed; two artifact checks passed. Skip is not pass.

Lab focused command: `node node_modules/vitest/vitest.mjs run tests/integration/runtime-artifact.test.ts tests/unit/launcher-output.test.ts`: **6 passed**, two files. Did not run fixed-port launcher/offline tests.

Additional probes: duplicate-resource consumption through pure functions and actual production command processing; ephemeral real gateway/offline-proxy pairing. No implementation edits, staging or commits; no operational service changes; no Supabase stop/start; no fixed-port UI; no Linux/hardware claims. This report is the only file written by this review. A fresh broad final review remains required after the active implementation, fixes, clean pin and acceptance evidence are complete.

## Scoped re-review — 2026-11-05, after the three fixes

**Verdict for C1/P1/P2 above: addressed. No new breakage found in this scoped re-review.** This supersedes their open status in the interim review, not the broader Plan 01 acceptance or ARM scene-integration limits. Changes remain uncommitted; final clean export/pin and broad review are still separate gates.

- **C1, duplicate resource conservation — addressed.** `parseRecipe` now rejects repeated resource IDs before registration, including same identity with different amount fields. `validateCoffeeRecipe` adds semantic uniqueness checks for resource IDs and allocation step IDs. Reviewed the actual code and four new admission regressions. Fresh `coffee-review` (16 tests) and `coffee-conservation` (9 tests) passed, retaining the valid repeated-step and per-job conservation paths. This verifies rejection of new ambiguous recipes; it is not a migration/reconciliation claim for any previously persisted invalid recipe.
- **P1, real exporter rejected by auditor — addressed.** Both audit implementations are byte-identical and now traverse TypeScript's parsed syntax rather than matching executable-import patterns inside comments/code-generation strings. Literal external import/export/require calls still reject; AJV string text passes. The actual export/start test outside the checkout now passes, including embedded SQLite migration and authenticated runtime work. The parser uses the existing pinned TypeScript development dependency during export/import; the packaged runtime does not gain that dependency.
- **P2, unusable custom offline UI port — addressed.** `offline-start.mjs` rejects a UI port other than 4175 before manifest validation, child start or port acquisition. The updated offline test rejects 49175, then successfully builds and boots with UI4175/runtime49176 and `PATH=/nonexistent`. The source Host/Origin protections remain intact. This finding concerned the new offline launcher; the existing development launcher's custom-port behavior was not changed by this fix.

Fresh reviewer verification, Node 24.22.2:

1. Source: `coffee-review.test.ts`, `coffee-conservation.test.ts`, `lab-runtime-artifact.test.ts` — **28 passed, 1 skipped**, three files, 4.63 seconds. The skipped test is the explicitly opt-in clean-checkout export; no skip was counted as pass.
2. Lab: `offline-bundle.test.ts`, `runtime-artifact.test.ts`, `launcher-output.test.ts` — **8 passed**, three files, 4.06 seconds. Root was notified of the exclusive fixed-port test window; its owned processes exited and the window was released afterward.
3. Independent real gateway/offline-proxy boundary probe: listeners used ephemeral loopback ports with the declared browser Host/Origin `127.0.0.1:4175`. Pairing returned **201**; authenticated access to an absent run reached **404**; the same anonymous access returned **401**; a mutation missing CSRF returned **403 CSRF_INVALID**; a forbidden origin returned **403 ORIGIN_FORBIDDEN**. Servers and temporary storage were closed/removed. This establishes proxy/auth admission with the declared UI identity, not a completed scenario in the final offline browser UI or expiry behavior.

No implementation edits, staging, commits or operational service changes. ARM scene integration is being implemented separately and was deliberately not reviewed or marked complete here. Full final pin/bundle/browser, cold-host/network-disconnection, Linux and hardware claims remain outside these results.
