# Native simulation handoff v1

L00 prepares a bounded, verifiable directory for transfer. `prepared:true` means the declared files, Source/Lab receipts, schema set, portable closure and profile agree. `nativeReady:true` means supplied inventory/provenance records satisfy the exact profile prerequisites. Neither result authenticates a host, runs a case, accepts qualification, calibrates dynamics or authorizes motion. Candidate records remain `accepted:false`, dynamics `not_calibrated`.

No Linux host is assigned to this preparation. Native doctor/smoke/cases are `not_run` / `blocked_external`. Synthetic inventories in `tests/fixtures/native-handoff.ts` exercise protocol checks only. They are never execution evidence. A Linux container on a Mac, an emulated ISA or unknown origin cannot establish native readiness.

## Package and identity

Use one new directory and one subject per handoff. `manifest.json` follows `packages/contracts/schemas/native-handoff-v1.schema.json`; generated types are in `packages/contracts/generated/native-handoff.ts`.

- `subject` identifies the software under test: exact Source commit, recorded Lab commit, schema aggregate, portable closure digest, runtime artifact hash, `profileSha256`, execution kind and resolved platform image identity (or `null` while unbuilt).
- `checker` records the preparation checker build separately. CLI output records the currently executing checker's Git commit and a digest over its CLI, validator, inventory helper, schema and dependency lock. Changing the checker never substitutes for subject identity. Git commit alone is not the checker byte identity, especially in a dirty checkout.
- `refs` has only these roles: `runtimeManifest`, `labLock`, `runtime`, `project`, `world`, `model`, `profile`, `schema`, `engine`, `tool`, optional `archive`. Every ref declares its relative package path, SHA-256, exact byte length, original `sourcePath`, and producing `sourceCommit`. For `labLock` the producer is the **Lab commit**; other refs use the subject Source commit. The manifest records source provenance claims; it is not a signed attestation of Git history.
- Exported runtime manifest and Lab lock must both match the subject tuple and be clean. The runtime file must match `runtimeArtifactSha256`. The canonical model must match `profile.modelSha256`. Profile bytes must decode to the declared `profile` exactly.
- `schema` refs use original schema basenames as `sourcePath`. Their sorted name + newline + raw-byte aggregate must match `schemaHash`. All entries of the runtime manifest's portable closure must be supplied with their exact hashes and sizes. Schema entries map to `packages/contracts/schemas/<basename>`; other refs use their original source path. Engine and tool refs must belong to that subject closure. Do not combine an old image with newer worker/profile files.
- The subject `executionKind` is `mujoco_image`, `ros2_native` or `linuxcnc_native`. `mujoco_image` requires `profile.installation:{kind:"oci"}`. The two native execution kinds require `installation:{kind:"native_apt",sources,packageSources}` and `subject.image:null`; they are not a fallback for an unresolved image. Each native source locks `id`, `kind` (`apt_repository` or `source_archive`), `uri` and SHA-256 of its retained Release/repository record or source archive. Each required package maps by name to exactly one source ID. Source hashes may be `null` only during preparation.
- Profile locks list required packages with exact version and artifact hash, forbidden package names, OS version, ISA, model and clock domains. `null` package versions/hashes are valid preparation inputs; unresolved locks never satisfy native readiness. Runtime/compiler semantic compatibility still requires doctor and cases.
- Frames name the world, robot base and tool frame, with right-handed coordinates. Units are metres, radians, kilograms and seconds. Seeds and required case IDs are explicit. Case policy preserves Source authority and lost ACK → unknown/no resend.

Ref paths must be relative portable paths, without traversal, symlinks or case-folded collisions. Each file is at most 64 MiB, metadata/manifest/inventory/provenance JSON at most 1 MiB, at most 768 refs and 256 MiB total declared artifact bytes. Reads use bounded file descriptors and reject changed files. Archives are opaque bytes: they are never extracted or executed, and their interior is not semantically validated. Export copies only declared refs and writes the manifest last. It refuses existing output directories and leaves an interrupted output for inspection; use a different new path for retry. No recursive source-directory copy occurs.

Secret filenames and PEM/OpenSSH private-key content are rejected. This is defense in depth, not a general secret detector: select only reviewed non-secret artifacts, never encrypted/compressed credential backups, tunnel private keys, service credentials or runtime databases. A required SQLite record must first be a separately verified copy, never the original. No manifest launch string or path is treated as a command, module or shell.

## Recipient procedure

1. **Verify the transfer.** Use Node 24.22.2 / pnpm 10.32.1 and this checker checkout with its pinned dependencies. Retain the received manifest hash and checker output in a separate evidence directory.

   ```sh
   perl -e 'alarm 180; exec @ARGV' node scripts/native-handoff.mjs verify --input "$handoff_dir"
   ```

   Without a host, expect `prepared:true`, `nativeReady:false`, `HOST_INVENTORY_MISSING`, `qualification:not_run`. Unbuilt images and unresolved locks add prerequisites. CLI exit 0 means preparation integrity passed; it does **not** mean native readiness. Exit 1 means invalid input, integrity failure or export failure. Automated consumers must read `nativeReady` separately.

2. **Resolve the assigned host profile.** Only after a host/profile is assigned, collect actual OS/kernel, ISA, CPU, image, origin/virtualization/emulation, software artifacts and clock domains. The read-only `collectNativeInventory()` helper in `scripts/native-sim/host-preflight.mjs` records local facts but deliberately leaves origin, image, model, subject and exact software locks unknown. It never installs packages or infers origin from `process.platform`.

   Preserve the first unresolved profile. Resolve exact package artifact hashes/versions from the assigned host's package/source provenance into a **new handoff**; do not edit the received artifact or overwrite an unsuccessful attempt. Do not install/upgrade an engine merely to clear a gate. Portable workers retain Python 3.11; ROS uses the target distro Python. Run pytest with `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`.

   Inventory v1 fields are `schemaVersion`, `profileId`, `modelId`, `modelSha256`, `subject`, `os:{platform,id,version,kernel}`, `architecture` (`amd64` or `arm64`), `cpu:{model,cores}`, `image`, `installation` (matching the locked profile), `software:[{name,version,sha256}]`, `clockDomains`, and `provenance:{origin,hostOs,hostArchitecture,virtualization,emulation,evidencePath,evidenceSha256}`. Native origin is `linux_native`, host OS `linux`, same ISA, known virtualization (`bare_metal`, `vm` or `container`) and `emulation:none`. This is a supplied record, not independent proof of host authenticity. The responsible operator must retain trusted collection context.

   `evidencePath` is relative to the handoff root; its bytes must match `evidenceSha256`. Provenance JSON v1 records `kind` (`oci` or `native_apt`) and `inventorySha256`. OCI records also supply `platformManifestPath` and `imageConfigPath`; native_apt records supply `sources:[{id,path}]`, exactly one retained artifact for every locked source ID. Compute `inventorySha256` as SHA-256 of canonical JSON (`json-canonicalize`) of the complete inventory with only `provenance.evidencePath` and `provenance.evidenceSha256` removed. This avoids a circular digest while binding all inventory facts. The two image paths also resolve beneath the root, with the same symlink/size rules. Keep these recipient-side evidence files separately from the immutable subject refs; export does not copy undeclared recipient evidence.

   For native_apt, every source artifact must hash to the exact locked source digest, all package-to-source mappings must be complete and all actual package hashes/versions must match. Source records bind consistency; signature/trust verification and collection provenance remain the assigned host operator’s responsibility. Distro/version, ISA, model, profile ID and subject tuple must also match. Merely changing an image handoff’s installation label fails its locked execution-kind/profile checks.

   For OCI, platform manifest bytes must hash to the subject's `manifestDigest`; config bytes must hash to `configDigest`. Accept only OCI image manifest v1 / Docker distribution manifest v2 (schemaVersion 2), with the same config digest and Linux/same-ISA config. A multiarch base index is not a target platform manifest. The subject image and inventory image must match exactly.

   ```sh
   perl -e 'alarm 180; exec @ARGV' node scripts/native-handoff.mjs verify --input "$handoff_dir" --inventory "$inventory_file"
   ```

3. **Doctor.** Select the exact locked native profile from the subject checkout, independently verify its executable/library/package provenance, and run its read-only doctor. For existing ROS preparation:

   ```sh
   perl -e 'alarm 120; exec @ARGV' node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --environment-profile engineering-amd64 --json
   ```

   This can still report `ENGINEERING_LIFECYCLE_UNAVAILABLE` or unresolved inventory before L02. Do not treat L00 as implementation of L01–L04. Preserve the legacy `hostPreflight(vmRoot)` macOS UTM feasibility report (`ready_to_provision` is not `nativeReady`) and the strict two-argument native_apt Ubuntu 24.04/Jazzy arm64 profile validator. The optional third argument `{profile,subject}` checks the explicit new inventory expectations in memory; disk provenance checking belongs to `validateNativeHandoff`.

4. **Smoke, then cases.** On the assigned host, use the subject's fixed runner/profile commands. Never execute a manifest-supplied launch command. Preserve smoke stdout/stderr and failed attempts. Run the profile-specific nominal seeds and fault cases; lost ACK remains unknown with no resend or continuation by respawning. Source owns mission/journal/custody. One active world/runtime and one ACK in flight remain unchanged. Lab never routes to physical hardware. A doctor-only pass is not a campaign pass; an xArm run cannot close PUMA, nor arm64 close amd64. Motion, contact and hardware gates remain separate.

5. **Archive and verify.** Save raw controller/engine observations, timing/clock mapping, inputs, hashes, assertions and inventory in a new evidence directory. Verify with the matching subject reader. Copy/verify any retained SQLite; preserve every failed/incomplete attempt. Stop only processes owned by that run. No general Docker reset, host provisioning, cloud operation, commissioning signature or device motion is part of this handoff.

6. **Reviewer.** Submit immutable evidence and its exact subject/checker/profile/scope identities. Automatic records stay `accepted:false`. A human reviewer signs a separate hash/profile/scope-bound sidecar. No software-only record closes native or hardware/calibration gates.

## Producing a transfer

Assemble reviewed refs from one clean Source export and its matching committed Lab pin into `INPUT_DIR`, then:

```sh
perl -e 'alarm 180; exec @ARGV' node scripts/native-handoff.mjs export --input "$input_dir" --out "$new_handoff_dir"
perl -e 'alarm 180; exec @ARGV' node scripts/native-handoff.mjs verify --input "$new_handoff_dir"
```

This is a selected-file transfer, not a provisioning or archive extraction tool. Provision the subject checkout and engine from the locked sources under a separately assigned task. When runtime/schema/tool inputs change, first commit Source, export cleanly, import/sync/check/typecheck Lab and commit its pin; then assemble a new handoff with the new tuple. Keep the checker and subject commits independent.

## Historical R2a and current R2b

The historical R2a record has Source `4f893ac6fb75dff414a3ee42a726defb7935c734`, recorded Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`, schema `9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4`, portable closure `3d9c0b5f3e60e89327362c0c59bba8ceca4af55b0f08c44da0fbd23f3070bb1d`, and runtime `55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270`. Its deployed linux/amd64 registry digest is `sha256:fbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009`; local config ID `sha256:f650a2576cf7d44e8f9bf40934d862d8120170dd701e7da502a6ee032d12bd05` is a different identity, not a replacement for platform resolution evidence. Local records are under `docs/implementation/evidence/cloud-run/mekoniq-2026-11-14/` and `production/r2a-2026-11-14/`. HTTP MJ-BV01 completed tick 4800 / served 2; Chrome production completed tick 4810 / served 2. These remain historical `accepted:false`, not L01's 10-grasp/three-seed/fault/inventory/performance campaign.

Current R2b must use its own committed/exported/pinned tuple. Under controller ruling R76 its image remains `null`/unbuilt, actual WEB05 `not_run` / `blocked_environment`. A clean runtime artifact does not establish an image digest. L00 does not call Docker again or infer native/TLS/cloud/hardware qualification. A later image build/campaign produces a new handoff and evidence; it never relabels the old R2a image as current R2b.
