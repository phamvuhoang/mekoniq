"""Commissioning validation. Fixtures under tests/fixtures/hardware hold SYNTHETIC values and TEST-ONLY keys: nothing here was measured on a
robot, and a pass proves the validator's rules, never hardware, load or safety."""
import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator, FormatChecker

from commissioning import ActiveMotionRefused, main, run_active_motion, validate_commissioning

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests/fixtures/hardware"
PROFILES = ROOT / "robotics/hardware/profiles"
load = lambda p: json.loads(p.read_text())
KEY, WRONG_KEY = load(FIX / "commissioning-test.public.jwk.json"), load(FIX / "commissioning-wrong.public.jwk.json")


def profile_fixture(**overrides):
    """Complete UNSIGNED synthetic record (integration_tested manifest claim); overrides replace top-level fields."""
    return {**copy.deepcopy(load(FIX / "commissioning-complete.json")), **overrides}


def test_profile_without_independent_stop_evidence_is_not_venue_approved():
    profile = profile_fixture(safety_evidence=None, tested_payload_kg=0)
    result = validate_commissioning(profile, target_payload_kg=20)
    assert not result.venue_approved
    assert "SAFETY_EVIDENCE_MISSING" in result.reasons


def test_unmeasured_geometry_is_integration_tested():
    record = profile_fixture()
    record["geometry"]["chassis_mass_kg"] = None
    result = validate_commissioning(record, target_payload_kg=20)
    assert result.status == "integration_tested" and "GEOMETRY_UNMEASURED" in result.reasons
    assert validate_commissioning(load(PROFILES / "wheeltec-s100.instance.json")).status == "integration_tested"
    sim = profile_fixture(); sim["geometry"]["illustrative"] = True
    assert "GEOMETRY_ILLUSTRATIVE" in validate_commissioning(sim, target_payload_kg=20).reasons


def test_safety_verified_without_payload_is_integration_tested():
    result = validate_commissioning(load(FIX / "signed-venue-approved.json"), target_payload_kg=30, commissioning_key=KEY)
    assert result.status == "integration_tested" and "TESTED_PAYLOAD_BELOW_TARGET" in result.reasons
    untested = profile_fixture(tested_payload_kg=None)
    assert "PAYLOAD_UNTESTED" in validate_commissioning(untested, target_payload_kg=20).reasons


def test_everything_verified_without_signed_venue_acceptance_is_hardware_validated():
    result = validate_commissioning(load(FIX / "signed-hardware-validated.json"), target_payload_kg=20, capability="delivery", commissioning_key=KEY)
    assert result.status == "hardware_validated" and result.hardware_validated and not result.venue_approved
    assert result.reasons == [] and result.manifest_accepted


def test_signed_venue_acceptance_is_venue_approved():
    result = validate_commissioning(load(FIX / "signed-venue-approved.json"), target_payload_kg=25, commissioning_key=KEY)
    assert result.status == "venue_approved" and result.venue_approved and result.reasons == []


def test_unsigned_claim_is_refused():
    record = load(FIX / "signed-hardware-validated.json"); del record["signature"]
    result = validate_commissioning(record, target_payload_kg=20, commissioning_key=KEY)
    assert result.status == "integration_tested" and not result.manifest_accepted
    assert {"MANIFEST_UNSIGNED", "CLAIM_EXCEEDS_EVIDENCE"} <= set(result.reasons)
    assert "COMMISSIONING_KEY_MISSING" in validate_commissioning(load(FIX / "signed-hardware-validated.json"), target_payload_kg=20).reasons


def test_venue_acceptance_added_after_signing_is_refused():
    record = load(FIX / "signed-hardware-validated.json")
    record["venue_acceptance"] = load(FIX / "signed-venue-approved.json")["venue_acceptance"]
    record["manifest"]["validation"] = "venue_approved"
    result = validate_commissioning(record, target_payload_kg=20, commissioning_key=KEY)
    assert not result.venue_approved and "MANIFEST_SIGNATURE_INVALID" in result.reasons


@pytest.mark.parametrize("name", ["tampered", "wrong_key", "other_key_id", "garbled"])
def test_bad_signature_is_refused(name):
    record, key = load(FIX / "signed-venue-approved.json"), KEY
    if name == "tampered": record["tested_payload_kg"] = 30
    if name == "wrong_key": key = WRONG_KEY
    if name == "other_key_id": record["signature"]["keyId"] = "someone-else"
    if name == "garbled": record["signature"]["value"] = "A" * 86
    result = validate_commissioning(record, target_payload_kg=20, commissioning_key=key)
    assert result.status == "integration_tested" and not result.manifest_accepted and "MANIFEST_SIGNATURE_INVALID" in result.reasons


def test_tested_payload_below_target_is_refused_with_reason():
    result = validate_commissioning(profile_fixture(tested_payload_kg=19.9), target_payload_kg=20)
    assert "TESTED_PAYLOAD_BELOW_TARGET" in result.reasons and result.status == "integration_tested"
    assert "TARGET_PAYLOAD_MISSING" in validate_commissioning(profile_fixture()).reasons


@pytest.mark.parametrize("target", [float("nan"), float("inf"), -1, 0, True, "20"])
def test_non_finite_or_invalid_target_payload_is_refused(target):
    result = validate_commissioning(profile_fixture(), target_payload_kg=target)
    assert "TARGET_PAYLOAD_MISSING" in result.reasons and result.status == "integration_tested"
    signed = validate_commissioning(load(FIX / "signed-venue-approved.json"), target_payload_kg=target, commissioning_key=KEY)
    assert signed.status == "integration_tested" and not signed.manifest_accepted


def test_capability_unverified_is_reported_once():
    record = profile_fixture(verified_capabilities=[])
    assert validate_commissioning(record, target_payload_kg=20, capability="delivery").reasons.count("CAPABILITY_UNVERIFIED") == 1


def test_unsupported_capability_is_refused():
    signed = load(FIX / "signed-hardware-validated.json")
    result = validate_commissioning(signed, target_payload_kg=20, capability="bussing", commissioning_key=KEY)
    assert "CAPABILITY_UNSUPPORTED" in result.reasons and not result.hardware_validated
    assert "CAPABILITY_UNSUPPORTED" in validate_commissioning(signed, target_payload_kg=20, capability="fly", commissioning_key=KEY).reasons
    unverified = copy.deepcopy(signed); unverified["verified_capabilities"] = []
    assert "CAPABILITY_UNVERIFIED" in validate_commissioning(unverified, target_payload_kg=20, commissioning_key=KEY).reasons


def test_household_vacuum_cannot_satisfy_chassis_payload():
    vacuum = profile_fixture(profile_id="valetudo-vacuum", tested_payload_kg=25)
    vacuum["manifest"].update(adapter="valetudo", targetKind="valetudo", units="cm", maxLoadMinor="0", validation="hardware_validated")
    result = validate_commissioning(vacuum, target_payload_kg=20)
    assert result.status == "integration_tested" and not result.hardware_validated
    assert {"PROFILE_UNKNOWN", "RATED_LOAD_BELOW_TARGET"} <= set(result.reasons)


def test_safety_and_vendor_gaps_each_have_a_reason():
    cases = {
        "ESTOP_NOT_INDEPENDENT": lambda r: r["safety_evidence"]["estop"].update(independent_of_software=False),
        "SAFETY_TEST_FAILED:cliff": lambda r: r["safety_evidence"]["cliff"].update(result="fail"),
        "SAFETY_FIRMWARE_MISMATCH": lambda r: r["safety_evidence"].update(firmware="other"),
        "WATCHDOG_NOT_INDEPENDENT": lambda r: r["interfaces"]["watchdog"].update(independent_computer=False),
        "ENCODER_UNITS_MISSING": lambda r: r["interfaces"]["encoder"].update(unit=None),
        "INTERFACES_UNVERIFIED": lambda r: r["interfaces"]["scan"].update(verified_on=None),
        "VENDOR_FIRMWARE_MISSING": lambda r: r["vendor"].update(firmware=None),
        "MANIFEST_FIRMWARE_MISMATCH": lambda r: r["manifest"].update(firmware="other"),
        "VENDOR_BLOCKED_EXTERNAL": lambda r: r["vendor"].update(blocked_external="supplier docs missing"),
        "VENDOR_UNSOURCED": lambda r: r["vendor"].update(source=None),
        "ENCODER_UNSOURCED": lambda r: r["interfaces"]["encoder"].update(source=None),
        "CONTROL_BUS_UNSPECIFIED": lambda r: r["control_bus"].update(kind=None),
        "REGISTER_MAP_UNSOURCED": lambda r: r["control_bus"]["register_map"]["entries"].append({"name": "x", "address": 1, "unit": "u", "source_ref": "p1"}),
    }
    for code, mutate in cases.items():
        record = profile_fixture(); mutate(record)
        result = validate_commissioning(record, target_payload_kg=20)
        assert code in result.reasons and result.status == "integration_tested", code
    assert "MANIFEST_INVALID" in validate_commissioning(profile_fixture(manifest={"id": "x"}), target_payload_kg=20).reasons
    assert "SCHEMA_INVALID" in validate_commissioning(profile_fixture(tested_payload_kg="heavy"), target_payload_kg=20).reasons


def test_profile_instances_ship_unmeasured_and_blocked():
    for name in ("wheeltec-s100", "zltech-differential"):
        schema, instance = load(PROFILES / f"{name}.schema.json"), load(PROFILES / f"{name}.instance.json")
        Draft7Validator.check_schema(schema)
        assert not list(Draft7Validator(schema, format_checker=FormatChecker()).iter_errors(instance))
        assert instance["vendor"]["blocked_external"] and instance["safety_evidence"] is None and instance["manifest"] is None
        assert all(v is None for k, v in instance["geometry"].items() if k not in ("illustrative",))
        result = validate_commissioning(instance, target_payload_kg=20)
        assert result.status == "integration_tested" and "SAFETY_EVIDENCE_MISSING" in result.reasons
        # the sibling profile's schema must not accept this instance
        other = "zltech-differential" if name == "wheeltec-s100" else "wheeltec-s100"
        assert list(Draft7Validator(load(PROFILES / f"{other}.schema.json")).iter_errors(instance))


def test_active_motion_refuses_without_target_observer_and_area():
    for missing in ({}, {"target": "robot-1", "observer": "ops"}, {"target": "robot-1", "test_area": "bay-1"}, {"observer": "ops", "test_area": "bay-1"}, {"target": " ", "observer": "ops", "test_area": "bay-1"}):
        with pytest.raises(ActiveMotionRefused, match="ACTIVE_MOTION_CONFIG_MISSING"):
            run_active_motion(**missing)
    # even fully configured there is no vendor interface in this repo: still an explicit refusal, never a silent no-op
    with pytest.raises(ActiveMotionRefused, match="VENDOR_INTERFACE_NOT_PROVIDED"):
        run_active_motion(target="robot-1", observer="ops", test_area="bay-1")


def test_cli_is_read_only_by_default(tmp_path, capsys):
    path = tmp_path / "r.json"; path.write_text(json.dumps(load(FIX / "signed-hardware-validated.json")))
    key = FIX / "commissioning-test.public.jwk.json"
    assert main(["validate", str(path), "--target-payload-kg", "20", "--key", str(key)]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "hardware_validated"
    assert main(["validate", str(path), "--target-payload-kg", "40", "--key", str(key)]) == 1
    for bad in ("nan", "inf", "0", "-5"):
        with pytest.raises(SystemExit) as e: main(["validate", str(path), "--target-payload-kg", bad, "--key", str(key)])
        assert e.value.code == 2
    assert main(["active-motion"]) == 2 and "ACTIVE_MOTION_CONFIG_MISSING" in capsys.readouterr().err
