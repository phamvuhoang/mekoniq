# Bridge lifecycle and local IPC deployment

The systemd unit runs `current/bridge/run.py` directly; its package bootstrap works from an independent working directory. Python must have the LinuxCNC module and schema-validation dependencies installed. No controller is started by this service. Missing LinuxCNC exits with `CONTROLLER_UNAVAILABLE`; the hardware gate stays closed.

Provision a dedicated `mekoniq-arm` service account and disjoint client groups before enabling the unit:

- `mekoniq-lab`: only the provisioned Lab connector account.
- `mekoniq-arm-operators`: only the authorized desktop operator account(s).
- The service account belongs to both groups via `SupplementaryGroups`. Client accounts must never belong to both groups or run as the service UID. The root administrator remains trusted.

The sample identity test uses accounts `mekoniq-arm`, `mekoniq-lab`, and `mekoniq-operator`. An existing desktop account may replace the latter in deployment. Account creation and membership are host provisioning, not artifact installation. Do not add the desktop account to the service's primary group to gain access.

The unit passes `--lab-group mekoniq-lab --local-group mekoniq-arm-operators`. At **every bind**, the service sets each socket to private mode, assigns its channel group, then opens mode `0660` before listening. Missing groups, failed ownership changes, or identical channel groups fail startup. No inherited socket ACL is required. The runtime directory is service-owned `0711`: clients can traverse known paths but cannot list or change it. The journal's systemd state directory is `0700`. Requests still enforce owner kind and local-only operations by channel; filesystem permission is what prevents a Lab process from connecting to the operator channel. A direct developer invocation without both group flags deliberately keeps sockets at `0600`.

`AUTO_RUN` acceptance does not establish execution. The port must observe running/paused before normal idle can complete the original job; abort, controller rejection, disabled/fault state, and native error observations remain failures. A program that starts and finishes entirely between observations remains unresolved rather than receiving inferred success. One serialized collector in the port classifies native errors before every terminal outcome query, including RPC reconciliation. It retains those messages until the service fans them out exactly once; ordinary status reads do not finalize a job.

On same-boot bridge restart, all accepted unfinished effects and interrupted sends are queried once, never resent. Loss of the native port's in-memory command mapping leaves `CONTROLLER_OUTCOME_UNAVAILABLE`, persists a reconciliation gate across further restarts, and refuses ownership transfer. Repeated `not_found` does not clear that gate. Recovery needs trustworthy per-command controller evidence; this bridge has no UI acknowledgement that invents a terminal result. A known running/pending job also blocks new ownership until its terminal outcome is observed. An accepted staged program is completed only after its program identity is observed.

Continuous local jog is separate from interpreter state: it can move while interpreter state is idle. Its intent is journaled before send; release, lease expiry, revoke, and bridge restart issue stop for every outstanding joint. Failed stop acknowledgement retains the intent and blocks ownership transfer. This is a software ownership policy, not a safety-rated enabling device or physical E-stop. Automatic programs retain the existing hold-and-reconcile disconnect policy.

Verification from the source repository:

```sh
.venv/bin/python -m unittest discover -s integrations/arm-controller/tests -p test_bridge_regressions.py
.venv/bin/python -m unittest discover -s integrations/arm-controller/tests -p test_bridge_permissions_linux.py
```

The first command runs actual port/service/socket behavior with only the unavailable native LinuxCNC API substituted, including a standalone copied package invoked with the unit's command and two real seven-second renewal intervals. The second must run as root on an isolated provisioned Linux test host; it drops to the actual separate service, Lab, operator, and unprivileged UIDs to check allowed and forbidden channel access across service restarts. It does not create accounts or start LinuxCNC. macOS runs report this test `blocked_external`/skipped; they are not evidence of Linux user isolation, systemd execution, or controller/hardware operation. Final release verification must repeat entry-point checks against the clean signed export.

## SSH transport between simulation VMs

`source/scripts/native-sim/arm-tunnel.mjs` exports `startArmTunnel` for a server-owned SSH host alias. The caller provides an existing parent directory and a provisioned `known_hosts` file; the supervisor creates its own `0700` subdirectory and `0600` Unix socket. It forwards only `/run/mekoniq-arm/bridge.sock`. It uses an argument array, strict pinned host-key checking, batch authentication, no agent or X11 forwarding, bounded startup, and keepalives. It never copies private keys, removes an existing user socket, or restarts a disconnected tunnel. `close()` terminates only its own child and removes only its own socket/directory. The `sshExecutable` option is for a server-side executable/test double, never a browser request.

A ready local forwarding socket proves only SSH listener readiness. The caller must then use the arm adapter's protocol/status validation, expected model/profile and current controller epoch before admission. On reconnect, query the prior outcome and reconcile; do not replay stage/start or infer completion from the new socket. Loss of SSH or suspension must make the run attention/unknown. Lease expiry uses the controller's wall/monotonic clock even when Gazebo is paused.

On Debian provision a dedicated connector principal belonging only to `mekoniq-lab`, with no sudo, service-account or operator-group membership. Disable TCP forwarding, agent forwarding and X11 forwarding for that principal; permit local StreamLocal forwarding only. SSH `PermitOpen` does not constrain Unix socket targets: the installed service's filesystem permissions are the authority. Verify as that actual UID that the Lab socket is reachable and `local.sock`, the service journal, and program-file writes are denied. Run the Linux identity tests above after every group/service-profile change. Do not provision a remote shell that can elevate to the service/operator account.

The coordinator records provider clocks separately. A transfer barrier's `skewNs` is the spread between its own monotonic receipt times (`skewBasis=coordinator_receipt`), not the difference between VM clocks. Combined runs must request a correlated barrier policy with fresh nonce, participant boot/epoch, minimum sequence and observed stationary/paused state. A mismatched nonce, old sample, changed participant set or changed policy cannot complete that barrier. Old standalone fixtures retain explicitly labeled `legacy_ack` records; those are not combined-transfer proof. Pause coordination is bounded and requires the returned observed paused state; a transport ACK alone is partial.

Portable socket-supervisor and barrier tests run on macOS. Actual SSH drop/reconnect, VM suspend/resume, service identities and native controller restart remain separate Linux evidence; a protocol double does not qualify them.
