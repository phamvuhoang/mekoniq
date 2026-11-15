# Arm commissioning preparation

This is a preparation checklist for both `xarm_ros2` and `custom_linuxcnc`. No robot, host or vendor interface has been assigned. Neither branch earns physical qualification from these documents, doubles, simulation signatures or the target dossier. G-HW, native, calibration and venue gates remain open; automatic records stay `accepted:false`. Dynamics remain `not_calibrated` until measured evidence supports a narrowly stated calibrated capability.

Begin with the [physical target dossier](physical-target-selection.md). Its references may become structurally complete without their claims being true. Review actual retained evidence independently. Existing `tests/hardware/commissioning.py` and `mekoniq_agent.protocol.verify_es256` remain authoritative for the earned **chassis** validation ladder. Arm document validation is separate and grants no admission; a real arm record/admission authority needs its own reviewed driver task after hardware selection. Test-only keys never sign a live manifest.

## Before any physical execution

1. The user assigns the specific hardware, host, venue, scope and responsible operator. Record actual vendor/model/controller/serial, exact firmware/SDK and tool, not the L03 simulation selector or PUMA SIM profile. Select the matching dossier branch and retain both alternatives in the decision history.
2. Obtain supplier manuals, source-backed interfaces, compatibility, licence/NOTICE, installation and service material. Every electrical pin/register and operating limit needs a vendor document or measurement and an accountable owner. No guessed defaults are allowed. Keep secrets outside version control and Lab.
3. Resolve the native branch's outstanding host/package/provenance requirements using [xArm native SIM](xarm-native-sim.md) or [LinuxCNC native SIM](linuxcnc-native-sim-handoff.md). Native simulation remains a separate gate from hardware. An installed lock, protocol double or Mac/Linux container cannot substitute for actual native observations.
4. Implement and review a **separate physical driver task** through Source/coordinator → robotics agent/cell gateway → vendor/controller. Bind physical identity, owner/boot/control epochs and the earned commissioning record at this boundary. Lab retains only simulation/replay, with no physical credential, device/network route, or hardware backend toggle.
5. Establish vendor/operator motion, joint, speed, force, torque, payload and stop limits **before motion**. Prepare the independent local stop, energy isolation, cleared test area, fixture security, qualified observer and manual recovery procedure under [safety handoff](safety-handoff.md). Record instrument uncertainty and predeclare tolerances; the repository supplies no runnable physical limits.
6. Obtain execution-specific authorization and reviewed evidence/signature custody. Automatic results remain unaccepted. A human decision is a separate sidecar bound to raw evidence hashes, profile, subject commit and exact scope. A dossier's `signature` field references that process; assessment never verifies the signature.

The existing chassis `active-motion` entrypoint still refuses without explicit target/observer/test-area. Even with those arguments it refuses with `VENDOR_INTERFACE_NOT_PROVIDED`. No arm path bypasses that refusal or causes motion in this task.

## Physical adapter conformance plan

Run doubles first to check the contract, then repeat applicable cases under separately authorized, supervised hardware execution with fresh evidence directories. Keep each command argv, own exit status, subject/producer/checker identity, byte hashes and failed attempts. A double result is portable contract evidence only.

| Case | Contract and required observations |
| --- | --- |
| Command identity/idempotency | Source and gateway persist intent before transport; bind command/run/payload hashes. Repeated identical ID returns its original receipt without a second effect; conflicting reuse is refused. One ACK is in flight. Capture SDK/controller goal IDs where available |
| Owner lease | One active physical command owner. Reject wrong, expired or revoked owner before I/O. Document the actual controller-side enforcement; process observations alone do not prove an atomic fence |
| Boot/control epoch | Bind controller boot identity and Source control epoch. Reject stale/wrong epochs; changed identity latches unknown. A process restart cannot silently continue the same run |
| Deadline | Bound dispatch/ACK/result/cancel deadlines from the reviewed physical policy. Expired commands never move. Late messages remain tied to their original command and do not revive a closed run |
| Freshness | Separate actual feedback from commanded setpoints, clock domains, source sequence and host receive bracket. Reject stale/out-of-order/foreign feedback. Terminal success requires authoritative result plus fresh observed actual state; transport ACK is insufficient |
| Disconnect or lost ACK/result | Latch unknown; persist uncertainty and original receipt. No automatic resend, respawn, reconnect-to-continue, or same-run resume. Reconnection alone does not complete motion |
| Local stop | Request stop while confirming the independent physical stop path separately. ACK/cancel acceptance is not a stopped observation. Measure physical stopping evidence under the approved test plan; software never certifies the safety stop |
| Manual recovery | Operator isolates/inspects hardware, reconciles actual state and ownership, records observer decision, and explicitly authorizes a fresh run/epoch. Reset of an independent stop remains a controller/operator action |

xArm needs actual SDK/controller capability coverage for command/query/cancel/stop and physical tool identity; fixed directFJT simulation motion cannot establish collision-planned hardware behavior. Custom/PUMA needs source-backed drive/feedback/homing/limit topology, actual measured kinematics and controller-side command semantics. LinuxCNC epoch guards are identity observations; the guard-to-NML-write race requires native/physical evidence and a reviewed fencing design. Do not claim the present SIM gateway is a physical driver.

## Measured calibration and validation

Use the existing `engineering-calibration.schema.json`, `assessCalibration(dataset,prediction)` in `packages/lab-runtime/src/engineering/calibration.ts`, and `PredictionSeries` contract. These tools compare measured channels under a declared policy; they do not commission a robot or verify physical safety.

1. Freeze the exact model/config digest, Source revision, controller/firmware/SDK, actual machine/tool revision and placement. Retain base→flange→TCP and world/cell transforms, joint order/sign/offsets, frame names, SI conversion provenance and uncertainties in a hash-bound companion measurement record. Dataset units must match prediction units exactly; the evaluator assumes no conversion or frame equivalence. Keep custom/PUMA raw inches/degrees and converted metres/radians separately where applicable.
2. Use calibrated real instruments. Preserve instrument ID/revision, measurement method/operator/date, raw files and `rawDigest`. Set dataset `sourceKind:"measured"` only for actual measurements. Simulated/synthetic fixtures, nominal mass/inertia and reference FK cannot become measured evidence by changing a label.
3. Predeclare conditions, channels, absolute/relative tolerances, uncertainty budget, clock domain/mapping, timestamp origin, mapping uncertainty and maximum clock gap. Supplier/hardware/operator owners establish all operational limits before collection. Retain controller sample time where actually available; host receive brackets, `cycle_time`, ACK serial numbers and UI pacing do not supply missing synchrony.
4. Separate tuning from validation before fitting. Use distinct trial IDs and raw recordings. Freeze the tuned model before collecting at least **three independent validation trials per condition**; set `policy.minTrialsPerCondition` to at least 3 for this commissioning procedure. The general calibration schema allows smaller policies for other uses, so the operator/reviewer must enforce this procedure's floor. Enumerate every planned condition and verify coverage manually; a wholly omitted condition cannot be detected by counting present trials. Repeated rows, overlapping recording windows, copied traces and duplicate tune/validation trials are not independent trials.
5. Supply measured channels and aligned timestamps for every validation trial; retain predictions for the identical frozen digest. Check uncertainty against tolerances, units, clocks and interpolation gaps. The evaluator rejects simulated/synthetic data, digest/unit/clock mismatch, split leakage, empty or insufficient validation data and unsupported extrapolation/gaps. Inspect each residual and domain; do not infer synchronized tracking accuracy from unsynchronized command/actual fields.
6. Review raw evidence, timing monotonicity, frame transformations, condition coverage and trial independence outside the structural evaluator. Record excluded/failed trials with reasons. Model, tool, fixture, firmware, controller or calibration changes invalidate the relevant evidence and require fresh scoped validation; never retune against held-out trials and reuse their pass.
7. Retain dataset, prediction, raw/companion hashes, policy, assessment, command exits, instrument/operator/observer identities and model revision. State which capability/domain is supported. Leave dynamics outside that domain `not_calibrated`. This numerical/calibration result does not close G-HW, local-stop, controller admission or venue acceptance.

## Handoff for eventual execution

The recipient should be able to identify the selected machine and why it was chosen, retrieve every vendor/measurement reference, find unresolved prerequisites and their owners, and name the separate driver/admission task. Record native terminal/GUI/controller restart/tunnel loss/contact/timing/Cartesian cases as `not_run`/`blocked_external` until performed on assigned targets. Preserve all unsuccessful attempts and historical qualification records; never rewrite an old candidate to make a gate pass. Any retained SQLite is a verified copy, never the original recording. Keep Docker R76 no-retry until the final B10 prerequisite.

Portable preparation checks from Source use Node 24.22.2 / pnpm 10.32.1 and Python 3.11. On a fresh checkout, provision a separate test environment first (these are operator setup commands, not runtime downloads):

```sh
python3.11 -m venv .venv-commissioning
.venv-commissioning/bin/python -m pip install 'jsonschema==4.26.0' 'rfc8785==0.1.4' 'rfc3339-validator==0.1.4' 'six==1.17.0' 'pytest==9.2.0'
export MEKONIQ_COMMISSIONING_PYTHON="$PWD/.venv-commissioning/bin/python"
```

These are the dependency versions used by the portable checks; they do not resolve a native/vendor lock. The test imports the repository agent through `PYTHONPATH`, uses its existing verifier, and fails on a missing interpreter/dependency. It never silently skips commissioning coverage. A pre-provisioned equivalent Python 3.11 environment can be assigned explicitly. Then run:

```sh
export PYTHONDONTWRITEBYTECODE=1
export PYTEST_ADDOPTS='-p no:cacheprovider'
export MEKONIQ_COMMISSIONING_PYTHON='<absolute Python 3.11 interpreter with commissioning dependencies>'
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/physical-target-dossier.test.ts tests/security/physical-target-admission.test.ts
PYTHONPATH=robotics/agent:tests/hardware perl -e 'alarm 300; exec @ARGV' "$MEKONIQ_COMMISSIONING_PYTHON" -m pytest tests/hardware/test_profile_validation.py -q
perl -e 'alarm 300; exec @ARGV' pnpm contracts:check
```

These are validator/protocol refusals and test-only signatures. They open no physical connection, commission no robot and sign no live manifest.
