"""Robot commissioning validator and CLI (W06-T05). READ-ONLY by default: it reads a commissioning record and prints a verdict. It never opens a
serial/CAN/ROS/network connection. The active-motion suite refuses to run without explicit target, observer and test-area config at execution.
The software only ever REQUESTS stop; resetting a stopped robot is a hardware action by the controller (docs/operations/safety-handoff.md).
Run: .venv/bin/python tests/hardware/commissioning.py validate <record.json> --target-payload-kg 20 --key <commissioning-public.jwk.json>"""
import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import rfc8785
from jsonschema import Draft7Validator, FormatChecker
from mekoniq_agent.protocol import _schema_path, verify_es256  # shared wire schema + the T03 ES256 verifier: no second crypto implementation

ROOT = Path(__file__).resolve().parents[2]
RANK = {"simulated": 0, "integration_tested": 1, "hardware_validated": 2, "venue_approved": 3}  # == robot-manifest.schema.json validation enum
PROFILES = ("wheeltec-s100", "zltech-differential")
GEOMETRY_KEYS = [k for k in json.loads((ROOT / f"robotics/hardware/profiles/{PROFILES[0]}.schema.json").read_text())["properties"]["geometry"]["required"] if k != "illustrative"]
_fmt = FormatChecker()
_manifest_validator = None


class ActiveMotionRefused(Exception):
    """Explicit refusal to move a robot; the message starts with the reason code."""


class Result:
    def __init__(self, status, reasons, manifest_accepted):
        self.status, self.reasons, self.manifest_accepted = status, reasons, manifest_accepted

    hardware_validated = property(lambda self: self.status == "hardware_validated")
    venue_approved = property(lambda self: self.status == "venue_approved")

    def as_json(self):
        return {"status": self.status, "reasons": self.reasons, "manifest_accepted": self.manifest_accepted}


def deployment_status(report):
    if not report.safety_verified or not report.payload_verified:
        return "integration_tested"
    return "venue_approved" if report.venue_acceptance_signed else "hardware_validated"


def _manifest_ok(manifest):
    global _manifest_validator
    if _manifest_validator is None:
        schema = json.loads(_schema_path().read_text())
        _manifest_validator = Draft7Validator({**schema, "anyOf": [{"$ref": "#/definitions/RobotManifest"}]}, format_checker=_fmt)
    return isinstance(manifest, dict) and _manifest_validator.is_valid(manifest)


def _signature_problem(record, key):
    """None when the record's ES256 signature (over JCS of the record without `signature`) verifies under `key`, else a reason code."""
    sig = record.get("signature")
    if sig is None:
        return "MANIFEST_UNSIGNED"
    if key is None:
        return "COMMISSIONING_KEY_MISSING"
    try:
        body = rfc8785.dumps({k: v for k, v in record.items() if k != "signature"})
        if sig["keyId"] == key.get("kid") and sig["alg"] == "ES256" and verify_es256(body, sig["value"], key):
            return None
    except Exception:  # unsignable body or malformed signature object: never a pass
        pass
    return "MANIFEST_SIGNATURE_INVALID"


def _evidence_reasons(r):
    """Reasons the record is not hardware evidence. Null/absent means unmeasured, never 'ok'; simulation geometry is never evidence."""
    out, vendor, g, i = [], r["vendor"], r["geometry"], r["interfaces"]
    if vendor["model"] is None: out.append("VENDOR_MODEL_MISSING")
    if vendor["firmware"] is None: out.append("VENDOR_FIRMWARE_MISSING")
    if r["control_bus"]["register_map"]["entries"] and r["control_bus"]["register_map"]["source"] is None: out.append("REGISTER_MAP_UNSOURCED")
    if g["illustrative"]: out.append("GEOMETRY_ILLUSTRATIVE")
    if g["measured_by"] is None or g["measured_on"] is None or any(g[k] is None for k in GEOMETRY_KEYS): out.append("GEOMETRY_UNMEASURED")
    if any(None in i[t].values() for t in ("odom", "scan", "tf")): out.append("INTERFACES_UNVERIFIED")
    if i["encoder"]["unit"] is None: out.append("ENCODER_UNITS_MISSING")
    if i["watchdog"]["independent_computer"] is not True or i["watchdog"]["timeout_s"] is None: out.append("WATCHDOG_NOT_INDEPENDENT")
    s = r["safety_evidence"]
    if s is None:
        out.append("SAFETY_EVIDENCE_MISSING")
    else:
        if s["estop"].get("independent_of_software") is not True: out.append("ESTOP_NOT_INDEPENDENT")
        out += [f"SAFETY_TEST_FAILED:{n}" for n in ("estop", "bumper", "cliff") if s[n]["result"] != "pass"]
        if s["firmware"] != vendor["firmware"]: out.append("SAFETY_FIRMWARE_MISMATCH")
    return out


def validate_commissioning(record, target_payload_kg=None, capability=None, commissioning_key=None):
    """Computes the highest honest validation level (never above `integration_tested` for null/simulated/unsigned evidence) and the reasons."""
    reasons = []
    profile = record.get("profile_id") if isinstance(record, dict) else None
    known = profile in PROFILES
    if known:
        schema = json.loads((ROOT / f"robotics/hardware/profiles/{profile}.schema.json").read_text())
        if not Draft7Validator(schema, format_checker=_fmt).is_valid(record):
            return Result("integration_tested", ["SCHEMA_INVALID"], False)
    elif not isinstance(record, dict) or "manifest" not in record:
        return Result("integration_tested", ["SCHEMA_INVALID"], False)
    else:
        reasons.append("PROFILE_UNKNOWN")  # e.g. a household vacuum: no chassis commissioning profile exists for it
    manifest, claim = record["manifest"], None
    manifest_ok = _manifest_ok(manifest)
    if manifest_ok:
        claim = manifest["validation"]
        if known and manifest["firmware"] != record["vendor"]["firmware"]: reasons.append("MANIFEST_FIRMWARE_MISMATCH")
        if capability is not None and capability not in manifest["capabilities"]: reasons.append("CAPABILITY_UNSUPPORTED")
        if known and any(c not in record["verified_capabilities"] for c in manifest["capabilities"]): reasons.append("CAPABILITY_UNVERIFIED")
        if known and capability is not None and capability in manifest["capabilities"] and capability not in record["verified_capabilities"]: reasons.append("CAPABILITY_UNVERIFIED")
    else:
        reasons.append("MANIFEST_INVALID")
        if capability is not None: reasons.append("CAPABILITY_UNSUPPORTED")
    if known: reasons += _evidence_reasons(record)
    safety_verified = not reasons
    payload, tested = [], record.get("tested_payload_kg")
    if not target_payload_kg or target_payload_kg <= 0: payload.append("TARGET_PAYLOAD_MISSING")
    elif tested is None: payload.append("PAYLOAD_UNTESTED")
    elif tested < target_payload_kg: payload.append("TESTED_PAYLOAD_BELOW_TARGET")
    if manifest_ok and target_payload_kg and int(manifest["maxLoadMinor"]) < target_payload_kg * 1000: payload.append("RATED_LOAD_BELOW_TARGET")  # grams
    reasons += payload
    problem = _signature_problem(record, commissioning_key)
    report = SimpleNamespace(safety_verified=safety_verified, payload_verified=not payload, venue_acceptance_signed=record.get("venue_acceptance") is not None and problem is None)
    status = deployment_status(report)
    sig_reported = problem is not None and (record.get("signature") is not None or RANK[status] >= 2 or (claim is not None and RANK[claim] >= 2))
    if sig_reported: reasons.append(problem)
    if problem is not None: status = "integration_tested"  # hardware_validated/venue_approved only on a verified commissioning signature
    if claim is not None and RANK[claim] > RANK[status]: reasons.append("CLAIM_EXCEEDS_EVIDENCE")
    return Result(status, reasons, manifest_ok and not sig_reported and (claim is None or RANK[claim] <= RANK[status]))


def run_active_motion(target=None, observer=None, test_area=None):
    """The only entry point that could move a robot. Config is taken from the caller at execution, never from defaults, env or files."""
    missing = [n for n, v in (("target", target), ("observer", observer), ("test_area", test_area)) if not (isinstance(v, str) and v.strip())]
    if missing:
        raise ActiveMotionRefused(f"ACTIVE_MOTION_CONFIG_MISSING: {', '.join(missing)} must be given explicitly at execution")
    # ponytail: no supplier ROS/CAN interface is bundled, so there is nothing to drive; add the supervised suite when the vendor package exists.
    raise ActiveMotionRefused("VENDOR_INTERFACE_NOT_PROVIDED: no vendor interface is available in this repository; nothing was moved")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate", help="read-only: print the verdict for a commissioning record")
    v.add_argument("record"); v.add_argument("--target-payload-kg", type=float); v.add_argument("--capability"); v.add_argument("--key", help="commissioning public JWK file")
    m = sub.add_parser("active-motion", help="supervised motion suite; refuses without explicit config")
    m.add_argument("--target"); m.add_argument("--observer"); m.add_argument("--test-area")
    a = ap.parse_args(argv)
    if a.cmd == "active-motion":
        try:
            run_active_motion(a.target, a.observer, a.test_area)
        except ActiveMotionRefused as e:
            print(str(e), file=sys.stderr)
            return 2
    key = json.loads(Path(a.key).read_text()) if a.key else None
    result = validate_commissioning(json.loads(Path(a.record).read_text()), a.target_payload_kg, a.capability, key)
    print(json.dumps(result.as_json(), indent=2))
    return 0 if not result.reasons else 1


if __name__ == "__main__":
    sys.exit(main())
