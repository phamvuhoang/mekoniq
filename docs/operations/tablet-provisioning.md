# Tablet provisioning and qualification

This implementation uses an installed Capacitor Android app, a fixed coordinator and signed cloud enrollment. Release builds do not accept a test CA, unsigned authority, arbitrary SQL or arbitrary JS signing requests. Keep the coordinator plugged in and foreground/kiosk during service. A background Activity remains unavailable even if a JavaScript heartbeat arrives.

## Local build

Use Node 24, pnpm 10.32.1, JDK 21 and Android SDK 36. Set `ANDROID_HOME` to the installed SDK. From `source/`:

```sh
pnpm install --frozen-lockfile
pnpm build
apps/tablet-android/android/gradlew -p apps/tablet-android/android :app:assembleDebug :app:assembleDebugAndroidTest
```

The workspace dependency makes the tablet HTML build precede Capacitor sync. APKs are under `apps/tablet-android/android/app/build/outputs/apk/`. `assembleRelease` produces an **unsigned** release APK until deployment signing credentials are configured; the debug key is not a production release key.

## Managed profile and enrollment

The initial supported provisioning path is Android managed app restrictions supplied by the venue operator/DPC. Configure `organizationId`, `venueId`, opaque `deviceId`, `cloudBaseUrl` (HTTPS origin without a path), and `enrollmentIssuerJwk` (public P-256 key corresponding to the backend `DEVICE_GRANT_PRIVATE_KEY`). Configure `coordinatorEnabled` on exactly one tablet, `ownerEndpoint` (HTTPS LAN URL), `ownerFingerprint` (SHA-256 certificate fingerprint), and optional `coordinatorPort` (default 18443). Keys and bearer tokens are never embedded in the bundle.

1. Obtain a manager Supabase session through `/v1/auth/login`. On the tablet enrollment screen, provide that short-lived manager session and choose **Enroll device**. Native code obtains a one-time challenge and signs `{organizationId,venueId,nonce,deviceId,deviceEpoch,publicJwk,certificateFingerprint}` with the Keystore key.
2. First enrollment calls `POST /v1/venues/:venueId/devices/challenge`, then `POST /v1/devices/enroll`. The native-generated epoch must return unchanged; a previously used epoch cannot be reused for reenrollment.
3. Explicitly initialize the first owner once: `POST /v1/venues/:venueId/ownership/initialize` with manager authorization and `{ "deviceId": "<coordinator device>" }`. Existing ownership cannot be replaced by this endpoint.
4. Choose **Apply granted permissions**. Native code calls `POST /v1/venues/:venueId/devices/:deviceId/provision` with `{}`. An operator may provision another staff member through `{actorId:<existing staff UUID>}`; the server derives permissions and station scope from membership.
5. The response contains `authority:{grant,signature}`, `offlineGrant:{payload,signature}` and `pairingGrant:{grant,signature}`. Native verifies the pinned issuer, local epoch and scope before storing authority. Authority owner ID/epoch/public key are durable; app restart cannot overwrite the owner epoch. Station permissions are signed, never selected by a peer UI.

After enrolling the coordinator, configure the venue layout/timezone and feature revision in the cloud settings, and publish its catalog. The native HTTP loop pulls signed configuration and delegated commands, commits through the same router, and publishes durable receipts. A missing native recovery prerequisite is reported as unavailable, never a fabricated ACK.

## LAN pairing

On the coordinator's **Manage** screen, create a one-time pairing code. Copy it to the peer's pairing field and choose **Pair with coordinator** within its two-minute lifetime. The peer checks the provisioned endpoint/fingerprint, signs the offer internally, and submits its cloud-signed pairing grant. The coordinator consumes the nonce transactionally and stores the peer's identity/scope. mDNS is advisory; the pinned endpoint works when discovery is unavailable. Peer TLS requests carry a fresh signed proof, bounded timestamps and a durable anti-replay nonce. Shared commands are recorded as local durable intents before transmission; retries preserve operation IDs.

## Qualification

`pnpm test:android -- lifecycle` requires two distinct explicitly enrolled test serials. It must not target operational tablets or robots. Provide `COORDINATOR_SERIAL`, `PEER_SERIAL`, `ANDROID_HOME`, and `ANDROID_LAB_ENROLLMENT` pointing to a private JSON file:

```json
{"venueId":"test-venue","devices":[{"serial":"emulator-5580","testOnly":true,"packageId":"io.mekoniq.tablet"},{"serial":"emulator-5582","testOnly":true,"packageId":"io.mekoniq.tablet"}]}
```

Both devices must already have signed provisioning/pairing and a debug test app. The runner validates the selected serials/debuggable package, installs only this app on them, stops only the selected coordinator, checks the peer's durable pending intent, then restarts the coordinator. Missing prerequisites exit 2. Logs are under `.lab/android/`.

Single-emulator SQLite/Keystore results do not qualify two-peer TLS, real tablet sleep/Doze, Wi-Fi partitions, power loss or 24-hour operation. See `docs/implementation/tablet-support-matrix.json`; those checks remain required before Gate A.

For isolated software qualification, `ANDROID_HOME=... node scripts/two-emulator-lab.mjs` builds and provisions two explicitly named disposable API33 AVDs through a debug-only DeviceOwner receiver. It mints a local fixture issuer, resets only those debug device identities, signs fresh enrollment bundles, and runs real APK-to-APK TLS/domain commands. `--skip-build` uses already verified APKs. Private fixture material stays under ignored `.lab/`; the release APK excludes the receiver. This runner passed native pairing/order/restart/deduplication and an explicit transport partition. It does not qualify a physical AP, screen-off/Doze or 24-hour operation.

## Encrypted backup

In the native **Maintenance** screen, choose full encrypted export and a separate password of at least 12 characters. Android's document picker selects the destination. The archive contains original signed journal entries, operation receipts/fingerprints, counters, projections, outbox, inbox, cursors and authority public metadata; it contains no private key or bearer token. AES-GCM/PBKDF2 protects the archive and an internal device signature protects the complete snapshot. Export succeeds only after rereading and hashing the written file.

Inspect a backup before restoring. For a replacement device, provision `restoreProducerJwk` and any `restoreJournalKeys` from the trusted enrollment inventory; never trust a public key supplied by the archive itself. Native restore writes a new inactive database, preserves source IDs/counters, changes external pending/dispatching effects to unknown and locks restored grants until reconciliation. It does not activate ownership or replay physical/financial actions. Document-provider/power-loss and physical recovery qualification remain separate.

## Checkpoints and planned owner handoff

The runtime derives a signed device checkpoint from native producer sequence, real HTTPS cloud received/applied cursors and unresolved effects. Peers exchange checkpoints through the authenticated pinned TLS listener every ten seconds. A checkpoint expires after thirty seconds; a matching cursor alone cannot hide pending or unknown work. Repeated heartbeats with the same watermark preserve the checkpoint business version.

`Journal.fenceCurrentOwner({handoffId})` is a manager-only typed native operation. It requires an already committed preparing handoff, atomically freezes the old coordinator, and signs only that scoped coordinator fence proof. Robot executor fencing is a separate protocol requirement. The stopped listener cannot accept new venue work; the local old owner may finish only `Ownership.Fence` and `Ownership.Activate`. No checkbox or timeout grants replacement authority.

After the cloud has accepted the signed ownership activation, refresh provisioning on the replacement. Native installation requires a pinned-cloud signed authority with exactly the next epoch, `previousCoordinatorEpoch`, `handoffId`, and an original old-owner coordinator fencing proof verified against the previously provisioned public key. Missing or stale evidence leaves the replacement unavailable. The operator must update managed LAN endpoint/fingerprint settings to the enrolled replacement; no automatic trust-on-first-use is performed.

Cloud sync timestamps are stored only after native HTTPS receives an authenticated push receipt or watermark. They are connection progress, not a claim that a particular pending or quarantined command was accepted.

The final handoff provisioning bundle also carries complete signed current projections, original applied journal entries, enrolled producer keys and a receipt inventory count. Native installs active ownership and finalized robot fences together with the original operation receipts, journal IDs, producer counters and cursors in one transaction. A retry of an old accepted command returns its saved result without replaying effects. A missing receipt checkpoint, signature/key failure, producer gap, stale projection, unresolved local work or oversized bundle prevents installation. The initial bounded transfer supports at most 1,000 original entries, 10,000 projections, 1,000 producer keys and a 4 MiB response; larger histories require a future paged transfer and remain unavailable rather than truncating idempotency records.
