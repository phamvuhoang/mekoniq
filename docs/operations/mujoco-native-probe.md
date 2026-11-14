# Prepared MuJoCo Linux amd64 compatibility probe (L01)

L01 is prepared tooling. No native Linux host is assigned and no image was fetched, built or executed during implementation. DEP-MJ-01 is `not_run` / `blocked_external`; candidates remain `accepted:false`, dynamics `not_calibrated`. The existing 2026-11-14 cloud MJ-BV01 record is narrower historical evidence, not this matrix. Nothing here qualifies G-NATIVE-ARM, hardware, commissioning or physical safety.

## Identity and preparation

The supported subject is exactly Source `4f893ac6fb75dff414a3ee42a726defb7935c734`, Lab `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`, runtime SHA256 `55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270`, schema `9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4`, portable closure `3d9c0b5f3e60e89327362c0c59bba8ceca4af55b0f08c44da0fbd23f3070bb1d`. `scripts/native-sim/r2a-arm-baseline.json` fixes the old fixture, engine lock, relevant typed schemas, SI/frame/joint mapping and static ArmCellScene. The adapter is `mujoco_r2a_arm_v1`; it does not substitute B05/B06 world files.

The recorded registry digest is `sha256:fbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009`. Its platform manifest/config bytes are not yet verified here. The historical local config ID `f650a257…` is a different identity and is not assumed to be that registry image's config. A tag or base multiarch index cannot close this prerequisite. If the historical registry digest proves to be an index rather than the single-platform manifest, stop for an explicit resolution adapter/review; do not change the known digest or accept an unrelated image.

Use the pinned Node 24.22.2/pnpm 10.32.1 environment. From a clean committed observer Source checkout:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
# Set these to absolute existing paths and a NEW task-owned output directory.
# runtime_cache is read-only; no commands execute through it.
perl -e 'alarm 180; exec @ARGV' node scripts/native-sim/prepare-mujoco-r2a.mjs \
  --runtime-cache "$runtime_cache" --lab "$lab_repo" --out "$handoff_dir"
perl -e 'alarm 180; exec @ARGV' node scripts/native-handoff.mjs verify --input "$handoff_dir"
```

Preparation reads the frozen Source/Lab Git objects, compares every portable closure entry with its archived receipt, and copies the verified cached runtime. It never resets a checkout, rebuilds the old runtime, runs input code or mutates the original cache. The new `robotics/simulation-mujoco/profiles/linux-amd64.json` is observer-authored compatibility data, not a file from the historical build. Derived refs retain their *subject* binding through `sourceCommit`; `derived/observer/…` and `preparation.json` separately identify their producer. The derived world is the frozen arm-only builder's seed-42 scene with arm-1 and two cups; business cases produce their own actual scenes inside the old runtime. `prepared:true` does not mean native ready. The initial image is null and the installed engine artifact hash is deliberately unresolved.

## Before an assigned-host run

The user must assign a native Linux amd64 machine or same-ISA VM. This command does not provision or contact cloud services. Run on that host outside any container; a Mac-hosted Linux container is refused before Docker is contacted. The Docker daemon must be local over a Unix socket and the exact image must already be installed. There is no image pull/build path, device mount, privileged mode, host-network mode or hardware endpoint.

In a new copy of the handoff, retain the real single-platform manifest/config bytes and L00's hash-bound inventory/provenance record. Resolve `subject.image`, including the exact manifest and config digests, from those bytes. Resolve the single required `mujoco==3.17.0` package SHA256 to the actual installed `libmujoco` artifact in that image; retain its path, bytes, version and digest. Update the profile bytes/ref and `subject.profileSha256` together. Do not use a wheel lock hash as the installed-library hash. L00 validates supplied records; the probe independently measures the installed image runtime, its worker/schema files, package list, actual library and Python/Node/OS versions before cases start.

Supply `inventory.json` using the L00 OCI inventory contract and its real provenance artifacts (see [native handoff](native-simulation-handoff.md)). Inventory describes the Debian 12 image execution environment; `host-observed.json` separately records the host. Supply `host-assignment.json` with `{schemaVersion:1, assigned:true, assignedBy:<operator>, machineIdSha256:<SHA256 of exact /etc/machine-id bytes>, hostOs:"linux", hostArchitecture:"amd64", emulation:"none", virtualization:"bare_metal"|"vm"}`. The assignment is an explicit operator attestation, not cryptographic host authentication. The probe checks the local machine identity, host ISA/OS, container indicators, registered QEMU/Rosetta handlers and local daemon ISA. Unknown origin or emulation cannot pass. Preserve the host provider's independent provenance alongside the L00 receipt.

Image inventory must be obtained from the exact already-installed subject under the assigned-host task, never synthesized to match the profile. Missing image/config/provenance/package data remains a prerequisite failure. Do not run Docker on the implementation Mac to fill it in.

## Execution and readback

```sh
# Both paths absolute; output must be NEW and outside the Source tree.
perl -e 'alarm 1800; exec @ARGV' node scripts/native-sim/mujoco-probe.mjs \
  --handoff "$handoff_dir" --out "$native_evidence_dir"
perl -e 'alarm 180; exec @ARGV' node scripts/native-sim/mujoco-probe.mjs \
  --verify "$native_evidence_dir"
```

The CLI requires a clean, byte-verified Git checker before execution and after assessment. Its identity is separate from the old subject. Readback uses the same observer code pin and compares retained observer files with the reader's fixed code. The subject's own pinned runtime produces the reports; the reader checks their Source/schema identity, raw trace hashes, inputs and copied journal bytes. A unit log or a caller's `passed` string is insufficient.

Cases run serially in private containers (`--pull never`, network none, read-only root, all capabilities dropped, no-new-privileges, nonroot user, bounded memory/PIDs). Loopback HTTP is internal to that container; no host port is exposed. Only read-only observer files and the task's evidence output are mounted. A container is cleaned up only if its unique ownership label matches this invocation.

| Cases | Scope and required evidence |
| --- | --- |
| M00 seeds 1–10 | Verbatim `scene.py` / `run.py` fenced blocks from the frozen spike document; document and extracted-byte hashes are retained. Exact 20 ms tick, ten 2 ms substeps, original randomized ±5 mm offsets and no tuning. Require ten complete contact grasps, lift/slip/tracking/release thresholds, raw pose/contact traces and zero warnings. |
| MJ-BV01 seeds 7, 42, 99 | Unchanged historical subject **bytes** with separately hashed passive Node wire observation. The real gateway runs the full business scenario, Source reports two served cups and the actual arm/prop traces. |
| bad-state | R82: original WorkerSession plus real original MuJoCo engine, with observer-owned qvel-NaN injection at the first post-start step. Retain compiled MJCF, request/response bytes, before/injected/after NPZ states and actual warning deltas. Require PLANT_UNSTABLE, failed state, bounded stop and no successful post-fault step. This component subcase makes no Source custody/served claim. |
| worker-loss | SIGKILL only the task-owned worker PID observed in this run's passive spawn trace. Require Source WORKER_LOST/latched stop, unknown program, zero served, five further observations, no respawn, no repeated/overlapping worker request and no successful post-loss ACK. |
| long-run | 180,000 real M00 engine ticks (1,800,000 substeps), 3,600 simulated seconds. Retain clock drift, timing samples, periodic raw poses, final pose and warnings. This is an engine clock/stability check, not a Source long-run journal campaign. |

The observer forwards the exact spawn arguments/options, original child object and stdin write arguments/return value; it never rewrites requests/ACKs or pauses subject pipes. No environment or bearer credentials are recorded. It bounds its trace and records a completion seal. Overflow, invalid/truncated lines, unobserved exit, missing ACKs or an incomplete seal fail relevant assertions. Timing includes observer overhead: M00/long-run engine-step timing, worker step IPC roundtrip, and HTTP action timing are distinct. p50/p95 use nearest rank; max and samples are retained. Memory is Python peak RSS for engine-only cases and the peak *sampled* process-namespace RSS at HTTP action boundaries for business cases.

Each process writes stdout/stderr incrementally and retains a receipt on failure, timeout or abort. The outer budget is 25 minutes, with case-specific bounds and owned-container cleanup inside the 30-minute wrapper. The runtime is closed before retained journals are copied and byte-verified; original journals exist only in the disposable container's private `/tmp`. Inputs, warnings and unsuccessful artifacts remain. Never retry/resume a lost run or overwrite an evidence directory; choose a new output for a new attempt. Spontaneous BADQACC/PLANT_UNSTABLE fails the nominal case and requires a separate investigation. Tuning or engine upgrades establish a new baseline and require rerunning every claimed architecture.

`record-sim-extension.mjs --mujoco-probe DIR` optionally copies and re-verifies this supplemental record. It keeps the old subject and observer identities and does not change existing release/hardware gate tables or acceptance. A claimed pass that fails readback is refused.

## Explicit remaining work

The entire native matrix is `not_run` until an assigned host, verified original image records and measured locked engine artifact exist. Native arm64 requires an independent profile and record. R83 assigns the executable current R2b payload/cell native adapter to B10 tooling before final tooling review; it uses its own current Source/Lab/schema/image tuple. The R2a image can never stand in for it. R84's passive observation adds measurement overhead and may refuse qualification when trace completeness cannot be established; it does not manufacture missing observations.
