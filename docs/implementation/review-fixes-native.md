# Native review repairs

Scope: review items 2, 3, 5, 6 and 7. Native network isolation (item 4) is documented separately by the coordinating agent. No device, live trial service, commit, merge or push is part of these repairs.

## Verification command

Run from `source/` with Android SDK and JDK 21 configured:

```sh
apps/tablet-android/android/gradlew -p apps/tablet-android/android \
  :app:testDebugUnitTest --tests io.mekoniq.tablet.NativeReviewTest \
  --max-workers=1 -Pkotlin.compiler.execution.strategy=in-process --console=plain
```

The suite uses actual native SQLite through Robolectric and JCA ES256 signing. It does not substitute mocked successful network delivery for venue acceptance.

## 2 — Persistent effect payload shape

The commit writer stored the entire `{id,type,payload}` envelope in `outbox.payload_json`; consumers already expected its inner payload. Fresh robot/configuration/intent workers therefore could not read operation or robot IDs. Writers now store inner payloads, retain the immutable effect envelope in the signed journal, and mark persisted encoding explicitly. Migration unwraps only matching legacy envelopes, uses signed effect metadata to distinguish already-flat rows, and preserves receipts, IDs, delivery status and attempts. Native schema v3 uses explicit payload encoding plus an indexed unknown/non-observation/observation classification. Signed archives with exactly the known v1 or v2 outbox column layouts receive only their missing metadata defaults; all other column mismatches remain rejected. The signed archive envelope version does not change.

RED: the two effect/reopen and v1 migration tests both failed on missing `operationId` (`/tmp/native-review-2-red.log`). GREEN: both passed (`/tmp/native-review-2-green.log`, 8 seconds).

## 3 — Checkpoint freshness scope

Every command's universal read set includes checkpoints. Applying TTL rejection to every such read blocked ordinary orders after any unrelated device checkpoint expired. Version CAS remains universal; TTL is checked only when a safety transition consumes clean checkpoints. Missing-device preparations and cloud-only maintenance remain available. Safety transitions re-read every active enrolled device, including devices absent from the old prepared checkpoint set: epoch, complete status, pending count, expiry and received/applied coverage must all match current native state.

RED: an ordinary order raised `VersionConflict` (`/tmp/native-review-3-red.log`). GREEN: order, isolated capture, missing-device preparation, safety rejection and cloud-only maintenance pass in the five-test suite (`/tmp/native-review-5-green.log`). A fixture hash mismatch discovered during development was corrected; it is not counted as a behavioral failure.

## 5 — Atomic signed configuration projection

A signed peer projection updated configuration snapshots but left persisted authority policy revision unchanged. The transaction now requires a matching authenticated authority/configuration revision, refuses rollback or dirty configuration conflicts, and updates snapshots, authority and cursor together.

RED: a mixed signed configuration/policy packet was accepted (`/tmp/native-review-5-red.log`). GREEN: the mixed packet rolls back; a valid revision advances authority, rejects old-revision commands and accepts the new revision (`/tmp/native-review-5-green.log`, five tests, 6 seconds).

## 6 — Recipient closure acceptance

The native boundary allowed only local `SettlementGrant.Return` creation, rejecting the coordinator's derived acceptance. The two paths are distinct: local creation signs internally; derived acceptance verifies the enrolled recipient's original journal, command/provenance binding, original returned-grant event, closure ES256 signature and authoritative receipt inventory. The coordinator preserves the recipient signature and never signs a closure on its behalf.

RED: a real native recipient return followed by coordinator acceptance failed `INVALID_GRANT_RETURN` (`/tmp/native-review-6-red.log`). The first six regressions passed in `/tmp/native-review-7-red.log`; only the two newly introduced item-7 tests failed. The closure test also rejects a coordinator-forged source journal and a recipient-signed journal containing an invalid inner closure signature, with atomic rollback.

## 7 — Venue observation selection and acknowledgments

The old reader limited the first 100 journal rows before filtering observations. Raw intents could permanently hide later observations, and terminal venue receipts did not acknowledge their original intent journals. The repair classifies immutable journals once into indexed native metadata and applies venue/scope/producer/observation predicates in SQL before `LIMIT 100`, without relying on Android JSON1 support. Terminal venue receipts acknowledge the original intent only at venue level; original journal and cloud ACK state remain separate. Existing terminal intent acknowledgments are recovered only from persisted terminal receipts plus confirmed intent state.

RED: the capture behind 100 intents was silently skipped, and terminal venue ACK remained zero (`/tmp/native-review-7-red.log`). After repair, the intent ACK test passes. The selection test asserts the actual eligible queue and reaches `OWNER_NOT_PROVISIONED` through the real flush path; its initial post-fix Robolectric null-profile fixture was corrected to an explicit managed bundle, preserving the exact expected transport error. That corrected test passed in `/tmp/native-review-archive-safety-red.log`; no successful TLS delivery is fabricated.

## Environment limits

During verification, host load exceeded 110 and the coordinating agent confirmed local Supabase health also timed out. One Kotlin build was interrupted before tests; that run is neither a behavioral RED nor a pass. Remaining verification is serialized with one worker and in-process Kotlin. Physical tablets, AP partitions, Doze and soak acceptance are outside these JVM regressions.

## Archive and safety follow-up RED

The signed v1/v2 archive regression reproduced `RESTORE_SCHEMA_MISMATCH`, and a newly enrolled device after preparation was incorrectly allowed to enter full shutdown (`/tmp/native-review-archive-safety-red.log`: three selected tests, two intended failures, corrected observation-selection test passed). The repair adds only known outbox defaults before the existing strict column check, and native safety transitions now revalidate all current active devices. Tests additionally cover changed device epoch, expired checkpoint and a valid complete inventory.

Malformed JSON and declared legacy envelopes that conflict with signed effect metadata fail closed; the repair does not delete records or invent acknowledgments to bypass corruption. Final native verification: all 27 cases covering this repair scope passed (NativeReviewTest 9, ArchiveTest 2, NativeStoreTest 12, ProvisioningTest 2, RuntimeQueueTest 2). The full 29-case invocation had one additional NetworkIsolationTest fixture failure at its two-second TCP accept setup, before its heartbeat/cancellation assertion; the other network test passed. The coordinating agent owns that unchanged-timeout rerun. Full invocation: `/tmp/native-review-final-green.log`, 19m46s under the documented host pressure. No JVM OOM occurred with 768 MiB, one worker and in-process Kotlin.

All nine review regression cases are GREEN, including the 100-intent selection and terminal venue ACK lifecycle. The signed v1/v2 archive cases preserve receipts and keep restored effects unknown; missing mandatory columns remain rejected. New-device, changed-epoch, expired and complete-current checkpoint scenarios are covered in the native safety regression. No physical/device acceptance is inferred from these JVM tests.

## Known follow-up outside this repair scope

Static observation, not reproduced by a regression in this task: `apps/tablet-android/src/coordinator-runtime.ts:16` chooses `AndroidStore.ackLevel` from the initial coordinator role, while later dispatch checks current authority (`:31`). `packages/sync/src/command-processor.ts:27` uses that store ACK level. Whether a fenced former coordinator can display a venue ACK for a later local capture needs a separate runtime test; this is a pre-existing, unverified follow-up, and no change is made here.

## Final APK verification

After the coordinating agent's final production workspace build and Capacitor asset sync, `:app:assembleDebug :app:assembleRelease :app:assembleDebugAndroidTest --offline --no-daemon --max-workers=1 -Dorg.gradle.jvmargs=-Xmx768m -Pkotlin.compiler.execution.strategy=in-process` passed (14m48s; 171 tasks, 18 executed). No JVM tests or device instrumentation were rerun in this build.

Release artifact: `apps/tablet-android/android/app/build/outputs/apk/release/app-release-unsigned.apk`.

- SHA-256: `2adcbcbb6f3547d041828601b523a741d162976e8fce4ca6248de0423e7d77a3`.
- APK bytes: 3657593.
- `aapt dump xmltree` and `aapt dump badging` show no debug DeviceOwner receiver, debuggable flag or test-only flag in release.
- Release remains unsigned; no deployment, device installation or physical qualification was performed.

The coordinating agent subsequently reported the separate network rerun 2/2 GREEN after increasing only fixture startup preparation to 15 seconds and asserting native request activity. Measured heartbeat/cancellation assertions remain one second and socket EOF two seconds. The original full-run fixture failure remains recorded above.
