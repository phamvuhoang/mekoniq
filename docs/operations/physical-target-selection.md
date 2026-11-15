# Physical target selection dossier

PHYS-PREP-01 prepares a decision and its missing evidence. The target remains **undecided**. No physical driver, hardware admission, operational limits or commissioning signature is supplied by this task. G-HW, measured calibration, native qualification and venue acceptance remain open. Automatic candidates remain `accepted:false`; dynamics remain `not_calibrated`.

`packages/contracts/schemas/physical-target-dossier-v1.schema.json` is an additive document schema. The read-only `assessTargetDossier(value)` in `packages/lab-runtime/src/commissioning/target-dossier.ts` returns `{structurallyValid, readiness, missing, branchRequirements}`. `prepared` means complete sourced references, including references to measurement and signing arrangements. It does not open or authenticate those references, verify a signature, establish measurement quality, or change validation rank. It emits no manifest, `live` capability or admission decision. No runtime route consumes readiness.

## Start a dossier

Copy this template into a new decision record outside historical evidence. Null means missing; do not replace it with guessed values. The template contains no operational register, pinout, speed or force defaults.

```json
{
  "schemaVersion": 1,
  "targetKind": "undecided",
  "branch": null,
  "profileId": null,
  "identity": {"vendor": null, "model": null, "firmware": null, "sdk": null, "serial": null},
  "modelRevision": null,
  "prerequisites": {
    "host": null, "controller": null, "tool": null,
    "safety": null, "latency": null, "maintenance": null,
    "calibration": null, "observer": null, "signature": null,
    "vendorInterface": null, "operatingLimits": null, "conformance": null
  }
}
```

A non-null reference has exactly `value`, `sourceKind` (`vendor`, `measurement` or `owner`), `sourceRef`, and `owner`. `sourceRef` identifies a retained, revisioned document/measurement section and its digest; `owner` names the accountable person. `value` is the asserted identity or a concise description of the referenced prerequisite. Identity accepts only vendor or measurement sources; calibration and latency require measurement sources. Unknown/TBD values stay incomplete. A source kind is an assertion, not proof of authenticity. Actual evidence review remains mandatory even when assessment says prepared.

| Field | Required retained material; supplier/measurement/owner responsibility |
| --- | --- |
| identity.vendor/model | Supplier declaration and observed nameplate/readback, model revision, document SHA256 and licence/NOTICE where redistributed |
| identity.firmware/sdk | Exact controller firmware and SDK versions/commit, compatibility matrix, installed identity and vendor source |
| identity.serial | Actual device/controller serial read from assigned hardware; owner records method/date. The L03 synthetic selector `XI13050520BB00` cannot fill this field |
| modelRevision | Exact model/config hashes and Source subject commit; joint order/signs/offsets, SI units, frame/tool revision and measured placement |
| host | Assigned OS/ISA/host owner, native inventory, installed binary/plugin identities and package/source/trust evidence |
| controller | Actual controller/drive topology, boot/control identity mechanism, supported command/query/stop semantics and owner |
| tool | Actual flange/TCP/gripper/tool identity, payload/COM, measurement revision and vendor attachment limits |
| safety | Independent local stop/watchdog, test area, interlocks, risk assessment and accountable operator; supplier and measured evidence |
| latency | Measured command/ACK/feedback/stop timings, uncertainty, clock mapping, faults and predeclared acceptance policy |
| maintenance | Supplier support/spares, firmware changes, recovery/backup/restore and requalification responsibilities |
| calibration | Measured calibration dataset/raw-data hash, policy, held-out trials and report under the existing calibration protocol |
| observer | Explicit qualified observer, scope/availability and test-area approval for each planned execution |
| signature | Commissioning authority/key custody and intended signed-record reference; no private key or fabricated signature belongs in a dossier |
| vendorInterface | Supplier-sourced physical driver contract, installation/compatibility and licence review; separate implementation task |
| operatingLimits | Hardware/vendor/operator-established joint, speed, force, torque, load and stop limits, with measurement/source and owner; unresolved before motion |
| conformance | Planned or retained adapter conformance cases and raw receipt references; distinguish doubles from actual hardware |

Selecting an arm sets `targetKind:"arm"`, `branch:"xarm_ros2"` with `profileId:"arm-xarm-dossier-v1"`, or `branch:"custom_linuxcnc"` with `profileId:"arm-custom-dossier-v1"`. These two profile IDs identify **dossier document kinds only**. They are not executable hardware or simulator profiles and do not imply a physical profile exists. A selected chassis sets `targetKind:"chassis"`, `branch:null` and the existing `wheeltec-s100` or `zltech-differential` profile ID. Its commissioning record must still validate against `robotics/hardware/profiles/<profile>.schema.json` and the [existing Python authority](robot-commissioning.md). Never send arm dossiers to a chassis schema or replace chassis evidence with dossier readiness. Undecided returns both branch requirement lists, in xArm then custom order.

## Compare both arm branches before selecting

| Decision | xArm / xarm_ros2 | Custom or PUMA / custom_linuxcnc |
| --- | --- | --- |
| Host | Qualify the assigned Linux/ROS distribution, architecture and installed vendor/ROS stack separately from simulation locks | Qualify assigned Debian/ISA, LinuxCNC package/source/trust and controller hardware separately from SIM |
| Controller | Confirm exact vendor controller, firmware/SDK, authenticated physical connection, actual serial and supported query/cancel/stop behavior | Identify drives, feedback, homing, watchdog, limits, controller cycle and source-backed wiring; measured machine kinematics may differ from PUMA reference |
| Tool and process | Confirm actual end effector, TCP/payload/COM and collision/attachment assumptions | Measure actual tool/flange, joint order/signs/zero offsets, base placement and payload/COM; do not import SIM tool offsets as measurements |
| Safety | Supplier and operator establish independent local stop, permitted motion envelope, speed/force/load and supervised procedure | Machine builder/operator establish independent drive/energy stop, physical limits, interlocks and manual recovery |
| Latency and faults | Measure actual SDK/controller feedback/ACK/stop behavior; simulation polling bounds do not qualify hardware | Measure controller/drive feedback and clock/synchrony; host receive brackets are not controller timestamps |
| Maintenance | Evaluate SDK/firmware support, upgrade compatibility, spares and restoration | Evaluate builder ownership, electrical/drive documentation, spares, recovery and ongoing machine calibration |

Record costs, constraints, source documents, missing vendor responses and accountable owners for both branches. Keep `targetKind:undecided` until the user assigns hardware and the decision has evidence. This runbook chooses neither branch for the user.

## Existing producers and unresolved gates

[L00 native handoff](native-simulation-handoff.md) binds model/profile/provenance and supplied prerequisites; it is not physical qualification. Keep Source subject, producer, checker, Lab publication and pinned runtime identities separate, with byte digests and retained command exits.

[L03 xArm preparation](xarm-native-sim.md) provides fixed **simulation** probes. X1/X2/X3 native qualification is incomplete under R88. `syntheticSimModelSelector` is exclusively a simulation xacro selector, never a physical serial. The same-run reopen refusal does not demonstrate a controller restart. Direct FollowJointTrajectory does not establish collision planning. G2 contact/plugin behavior, installed provenance and physical identity remain independent prerequisites.

[L04 LinuxCNC preparation](linuxcnc-native-sim-handoff.md) exposes `validateLinuxcncTrace` / `runLinuxcncAlg04` and the additive `lab-algorithm.mjs linuxcnc` consumer. Raw actual and desired degrees, converted SI and receive brackets remain distinct from unavailable controller clocks/synchrony. FK parity at supplied actual joints establishes numerical model consistency, not measured controller accuracy. Epoch observations do not prove atomic controller fencing. Native terminal/GUI/trust/timing/Cartesian/security and hardware qualification remain unexecuted; the deferred trace/oracle capacity limitation remains a separate L04 issue. Immutable native scripts/packaging belong to nativeTools under R89; generated traces belong to evidence.

After hardware selection, commission a separate physical-driver and admission-authority task against the exact vendor/controller contract. See [arm commissioning preparation](arm-commissioning-preparation.md). Source/coordinator → robotics agent or cell gateway → vendor/controller is the physical path. Source owns mission, journal and custody. Lab remains simulation/replay, with no real credential, device/network route or backend toggle to hardware.
