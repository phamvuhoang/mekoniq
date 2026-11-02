# Robot commissioning (S100 / ZLTECH chassis)

Status: **schemas, validator and tests only.** The WHEELTEC S100 and ZLTECH supplier SDK, firmware, pinout, CAN/RS485 register maps and every measurement (dimensions, load, stop distance) are **not in this repository**. No robot has been touched. `robotics/hardware/profiles/*.instance.json` therefore ship with every vendor value `null` and a `blocked_external` marker. Do not fill them from memory or from the web.

## What exists

| Item | Path |
|---|---|
| Profile schemas (fields, units, constraints) | `robotics/hardware/profiles/{wheeltec-s100,zltech-differential}.schema.json` |
| Unmeasured instances (blocked_external) | `robotics/hardware/profiles/*.instance.json` |
| Validator + read-only CLI | `tests/hardware/commissioning.py` |
| Tests (synthetic fixtures, TEST-ONLY keys) | `tests/hardware/test_profile_validation.py`, `tests/fixtures/hardware/` |

A commissioning **record** is one JSON document: vendor model/firmware (+ source document), `/odom` `/scan` `/tf` evidence, encoder unit, watchdog independence, control-bus register map (only with a cited source), geometry (same keys as `robotics/description/config/geometry_hardware.template.yaml`), supervised safety evidence, tested payload, verified capabilities, optional venue acceptance, a `RobotManifest` (validated against the **shared** `packages/contracts` schema, never a copy) and an ES256 `signature`.

## Levels

Same ladder as the manifest and `profileReason` (R-W06-VALIDATION): `simulated` -> `integration_tested` -> `hardware_validated` -> `venue_approved`. Only the last two are dispatchable for a non-simulator driver.

```
safety_verified  = vendor model/firmware, geometry measured (not illustrative, no null), /odom /scan /tf verified,
                   encoder unit, independent watchdog computer, E-stop independent of software, E-stop/bumper/cliff passed,
                   safety firmware == vendor firmware, manifest valid and its capabilities all verified
payload_verified = tested_payload_kg >= target, rated load (manifest.maxLoadMinor, grams) >= target
integration_tested  unless safety_verified and payload_verified
hardware_validated  when both hold and the record signature verifies
venue_approved      when additionally venue_acceptance is present (it is covered by the signature)
```

A manifest that claims `hardware_validated` or `venue_approved` is refused (`CLAIM_EXCEEDS_EVIDENCE`, `MANIFEST_UNSIGNED`, `MANIFEST_SIGNATURE_INVALID`, `COMMISSIONING_KEY_MISSING`) unless the record carries a valid ES256 signature over its RFC 8785 canonical JSON without `signature`, checked with the T03 verifier (`mekoniq_agent.protocol.verify_es256`) against the commissioning public JWK. `signature.keyId` must equal the JWK `kid`. The validator never signs; key custody is outside this repo.

A household vacuum (Valetudo) has no chassis profile (`PROFILE_UNKNOWN`) and its rated load fails a 20-30 kg target (`RATED_LOAD_BELOW_TARGET`). A requested capability absent from the manifest is `CAPABILITY_UNSUPPORTED`.

## Procedure (when the supplier package and a robot are available)

1. Obtain the supplier SDK/firmware/pinout/register-map documents. Record `vendor.source`; add register entries only with a `source_ref` into that document.
2. Read the actual model and firmware from the robot; fill `vendor`. Measure geometry (`measured_by`, `measured_on`) and replace the nulls.
3. Verify `/odom`, `/scan`, `/tf` live and the encoder unit; confirm the watchdog runs on a computer independent of the navigation computer.
4. Under supervision (see `safety-handoff.md`): measure braking/turn behaviour, then E-stop, bumper and cliff paths; record actual payload, speed, stop distances and firmware.
5. Build the manifest with the real `maxLoadMinor`; run `validate`; a commissioning officer signs; a venue acceptance is added and the record re-signed.

```sh
.venv/bin/python tests/hardware/commissioning.py validate record.json --target-payload-kg 20 --capability delivery --key commissioning.public.jwk.json
```

The CLI is read-only: it reads files and prints a verdict (exit 0 only with no reasons). `active-motion` exists only to refuse: it needs `--target`, `--observer` and `--test-area` given at execution, and even then it stops with `VENDOR_INTERFACE_NOT_PROVIDED` because no vendor interface exists here.

## Limits

A passing test here proves the validator's rules on synthetic data. It is not a measurement, not a payload or safety result, and not a safety certification. Simulation (Gazebo, `geometry_sim.yaml`) never proves load or safety.
