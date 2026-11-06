# Restore runbook — arm controller SIM install

Scope: the controller IPC running the **simulation** profile (`/opt/mekoniq-arm-sim`). Hardware profiles are provisioned separately and are
out of scope here. Nothing in this runbook enables hardware; a restore never touches the per-machine overlay unless the step says so.

## Layout on the IPC

```
/opt/mekoniq-arm-sim/
  releases/<version>/        verified artifacts (immutable; one directory per installed version)
  current -> releases/<v>    the active release (symlink swap = activation)
  machine/overlay.json       per-machine identity + calibration (provisioned; never in an artifact; hardwareEnabled stays false)
  trust/trust-policy.json    allowlisted signing keys + accepted policyRevision high-water mark (provisioned)
  state.json                 current / lastKnownGood / rolledBackFrom
/var/lib/mekoniq-arm/journal.jsonl   bridge journal (durable command outcomes; keep across restores)
```

## 1. Verify what is installed

```sh
bash /opt/mekoniq-arm-sim/current/scripts/verify-install.sh --prefix /opt/mekoniq-arm-sim
```

Exit 0 prints `verified <version>`; 1 = a file no longer matches the signed manifest (tamper or disk fault: do not run it); 3 = trust problem
(policy missing/expired, key revoked/expired, signature invalid). On 1 or 3 go to §3; never "fix" by editing the manifest or the policy.

## 2. Install a new signed artifact

```sh
# update: always the INSTALLED release's installer and verifier, never the new artifact's own (an artifact cannot vouch for itself)
python3 /opt/mekoniq-arm-sim/current/scripts/verify-signature.py --artifact <artifact> --trust-policy /opt/mekoniq-arm-sim/trust/trust-policy.json --installed /opt/mekoniq-arm-sim/current/manifest.json --json
bash /opt/mekoniq-arm-sim/current/scripts/install-sim.sh --prefix /opt/mekoniq-arm-sim --artifact <artifact> [--enable-service]
```

First install: run `install-sim.sh` from the **provisioning package** (the signed offline package that also carries the trust policy),
with `--trust-policy <provisioned policy>`; an installer started from inside the artifact under test exits 3 `INSTALLER_FROM_ARTIFACT`.
The installer runs the verifier itself before copying anything; a refused artifact leaves `releases/` and `current` untouched. A
**downgrade** (older semver core, or the same core exported earlier) is refused unless the trust policy's `allowDowngradeTo` names that
version. The previous release becomes `lastKnownGood`. Replacing an installed trust policy needs `trust-policy.sig.json` beside the new
policy, signed under a currently valid active key in the installed policy (`TRUST_POLICY_UPDATE_UNSIGNED` / `_INVALID` otherwise).
Both policies must have a positive integer `policyRevision` and a valid offline cache window. The candidate revision must be strictly greater
than the installed revision (`TRUST_POLICY_REVISION_REPLAY` otherwise); an identical installed policy can be supplied again unchanged.
The revision is inside the signed policy body. The installer retains it in `trust/trust-policy.json`, outside release rollback state.
A candidate with a future or expired `cachedAt`, or a nonpositive cache lifetime, cannot replace the active policy. The private policy
snapshot is published atomically only after the staged artifact verifies. Concurrent installs fail closed with `INSTALL_IN_PROGRESS`.
After an interrupted installer, remove a stale `.install-lock` only after confirming no installer is running.

Incoming artifacts must contain only manifest-listed regular files, plus the root manifest/signature. Unsigned `__pycache__` files and
symlinks are refused. The installer copies the signed allowlist and verifies the staged copy before activation. Ordinary Python execution
may create caches in an installed release. `verify-install.sh` and rollback accept these only when their code bytes exactly match a fresh
compilation of the hash-verified signed source, under the current Python interpreter and optimization 0, 1 or 2. The verifier neither
loads nor executes untrusted bytecode. Foreign interpreter tags, unsupported optimizations, symlinks, unknown files and altered cache code
fail verification. After changing Python versions, remove obsolete caches before re-verifying; do not add a blanket cache exemption.
Keep release and trust directories writable only by the provisioning administrator: verification does not protect files changed after it runs.

## 3. Roll back to last-known-good

```sh
bash /opt/mekoniq-arm-sim/current/scripts/install-sim.sh --prefix /opt/mekoniq-arm-sim --rollback
```

Rolls back only if (a) a last-known-good release exists, (b) it still verifies under the current trust policy, and (c) the machine
calibration schema in `machine/overlay.json` is one the old release declares compatible (`compatibleCalibrationSchemas`); otherwise exit 4
`CALIBRATION_INCOMPATIBLE` and the app stays where it is. App/config rollback and calibration are separate: a calibration change needs its
own provisioning step and the impact review of the hardware plan.

## 4. Trust recovery (missing / expired / revoked key)

Every verification fails closed. Recovery is a **signed offline recovery package** from the release manager: it carries the new
`trust-policy.json` (keys with validity windows, revocations, `cachedAt`, increasing `policyRevision`). While the existing trust cache is
valid, updates are verified against it. An expired trust cache cannot authorize its own recovery; use the trusted provisioning station.
Preserve the previously accepted revision floor during recovery. Policies without a revision need explicit provisioning migration;
normal updates never infer a revision or reset it. There is no checkbox or environment variable that skips the check.

## 5. Restore a machine from scratch

1. Install the OS image and the pinned packages (`packaging/dependencies.lock.json`; the lock is a candidate until a clean host verified it).
2. Provision `trust/trust-policy.json` and `machine/overlay.json` (identity; calibration only after its own commissioning step).
3. §2 with the signed artifact; `--enable-service` installs `packaging/systemd/mekoniq-arm-bridge.service`.
4. Restore `/var/lib/mekoniq-arm/journal.jsonl` from backup if continuity of command outcomes matters; the bridge reconciles pending
   commands on start and never resends one.
5. §1, then the LinuxCNC smoke (`scripts/smoke-sim.sh`) and the HMI acceptance (`docs/hmi-acceptance.md`) before anyone uses the cell.

Hardware stays disabled after every step above; enabling it is provisioning-controlled and needs the hardware gates of the plan.
