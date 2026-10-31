# Android network review fix: issue 4

Date: 2026-10-31. Base `1713276`; existing `feat/w00-w04-production-foundation` checkout, no worktree.

## Root cause and RED

Installed Capacitor Android 8.6.0 `Bridge.execute` posts to its shared plugin `taskHandler`. Identity cloud/enrollment/provision calls queued synchronous HTTPS on that handler, so a WAN TLS handshake blocked queued heartbeat and LAN poll work.

`NetworkIsolationTest.stalledProvisioningDoesNotBlockCapacitorHeartbeatOrLanPoll` invokes the real registered Identity plugin through the real Capacitor Bridge under Robolectric. A loopback TCP server accepts HTTPS and deliberately never answers the TLS hello. Before the fix the heartbeat future times out after one second. Fixture-only WebView service-worker/provider setup errors were corrected before this behavioral RED; they are not counted as reproductions.

`cloud-network-cancellation.test.ts` also failed before the fix: the JS deadline abandoned the promise without aborting the native request (`aborted=false`).

## Changes and GREEN

Cloud/enrollment/provision I/O uses a dedicated bounded executor (two workers, eight queued requests, 30-second native deadline). Cancellation by request ID, runtime close and plugin destruction interrupt tasks and close the tracked transport socket. Socket close is required: a test showed `HttpsURLConnection.disconnect()` alone did not interrupt a stalled TLS handshake on the JVM. The socket factory delegates to the original TLS factory and preserves certificate/hostname verification; it does not accept an untrusted certificate.

The cloud loop supplies an AbortSignal, aborts on its own deadline and on close, and a native wrapper maps it to the same request ID without serializing the signal. Native cancellation callbacks remain off blocking disconnect work.

Commands:

```sh
ANDROID_HOME="$HOME/Library/Android/sdk" apps/tablet-android/android/gradlew -p apps/tablet-android/android :app:testDebugUnitTest --tests io.mekoniq.tablet.NetworkIsolationTest
pnpm test:unit -- tests/unit/cloud-network-cancellation.test.ts
```

The aggregate native run passed 28/29; the network cancellation case missed its TCP fixture startup deadline before exercising cancellation. The fixture now allows up to 15 seconds to become ready and explicitly requires the native request to remain active. The one-second heartbeat/cancel assertions and two-second socket EOF assertion are unchanged. This setup adjustment does not count as a production fix.

Final targeted rerun: **2/2 native tests passed** (Gradle exit 0, XML 0 failures/0 errors). Together with the unchanged 27/27 native core cases, all 29 distinct JVM tests were exercised successfully in separate runs. This is not represented as a clean aggregate invocation.

Scoped GREEN before the aggregate run: 2 native tests (unblocked heartbeat/poll and real socket EOF on native cancellation), 3 TypeScript tests (deadline abort, close abort and correlated native cancellation). The combined final regression is recorded in the review repair verification document.

## Limits

This proves behavior with the installed Capacitor Bridge and JVM HTTPS transport, not Android radio/AP behavior or a physical WAN soak. Gate A and its device qualification requirements remain unchanged.
