# Android distribution

The tablet app is the HTML bundle plus the native Android shell (`apps/tablet-android`). A release needs a **signed** APK: `scripts/release.mjs` records its sha256 and `signed` is true only when `apksigner verify` accepts the file — the unsigned `app-release-unsigned.apk` from a plain Gradle build is refused.

1. Build the release APK (`./gradlew assembleRelease`) from the same commit as the cloud build; sign it with the venue-operator's keystore (kept outside the repository; key custody and rotation are the operator's).
2. Install through MDM or `adb install -r` on supported tablets only (the support profile in the plan: models/OS versions are an input a person supplies). Keep the previous APK for rollback.
3. Kiosk/foreground-service settings, battery exemptions and the coordinator tablet choice are venue provisioning (see the Android qualification evidence); distribution does not replace the physical-tablet qualification (Gate A).
4. Rolling out: tablets keep working offline on the old build; the cloud accepts both schema ranges (`rolling-upgrade.md`). Update the coordinator last, outside service hours, after its outbox is drained.
5. Not done here: a signing keystore, Play/MDM enrolment, versionCode policy, and installation on any device.
