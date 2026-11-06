"""A06: the release manifest of the controller artifact is schema-checked and hashes every file; the signature covers the canonical manifest;
the SIM install never carries a hardware enable, credentials or a sibling checkout dependency. Fixtures are produced by the Node exporter's
pure functions over a tiny synthetic tree (tests/fixtures/release); a real export is exercised by tests/unit/export-arm-controller.test.ts."""
import hashlib
import json
import unittest
from pathlib import Path

from jsonschema import Draft7Validator, FormatChecker

from support import ROOT

FX = ROOT / "tests" / "fixtures" / "release"
SCHEMA = json.loads((ROOT / "packaging" / "release-manifest.schema.json").read_text())
load = lambda n: json.loads((FX / n).read_text())


class ReleaseManifestTest(unittest.TestCase):
    def setUp(self):
        self.v = Draft7Validator(SCHEMA, format_checker=FormatChecker()); self.m = load("manifest.json")

    def test_fixture_manifest_validates_and_hashes_every_artifact_file(self):
        self.assertEqual(sorted(e.message for e in self.v.iter_errors(self.m)), [])
        files = {f["path"]: f for f in self.m["files"]}
        on_disk = sorted(str(p.relative_to(FX / "artifact")) for p in (FX / "artifact").rglob("*") if p.is_file())
        self.assertEqual(sorted(files), on_disk)
        for path, f in files.items():
            self.assertEqual(f["sha256"], hashlib.sha256((FX / "artifact" / path).read_bytes()).hexdigest(), path)
        self.assertEqual(self.m["mode"], "simulation"); self.assertFalse(self.m["hardwareEnabled"]); self.assertEqual(self.m["claims"]["hardware"], "not_accepted")
        self.assertNotIn("production ready", json.dumps(self.m).lower())

    def test_schema_refuses_hardware_enable_credentials_and_unsigned_claims(self):
        for mutate, what in [(lambda m: m.__setitem__("hardwareEnabled", True), "hardware"), (lambda m: m.__setitem__("credentials", {"token": "x"}), "credentials"),
                             (lambda m: m["trust"].__setitem__("algorithm", "none"), "alg"), (lambda m: m.__setitem__("files", []), "no files"), (lambda m: m["files"][0].__setitem__("sha256", "nope"), "hash"),
                             (lambda m: m.__setitem__("machineOverlay", {"path": "machine/", "note": "x", "calibration": {"serial": "123"}}), "calibration in image"), (lambda m: m["claims"].__setitem__("hardware", "accepted"), "hardware claim")]:
            m = json.loads(json.dumps(self.m)); mutate(m)
            self.assertFalse(self.v.is_valid(m), what)

    def test_signature_file_names_the_key_and_covers_the_canonical_manifest(self):
        sig = load("manifest.sig.json")
        self.assertEqual(sig["algorithm"], "Ed25519"); self.assertEqual(sig["keyId"], self.m["trust"]["keyId"]); self.assertEqual(sig["manifestSha256"], hashlib.sha256(json.dumps(self.m, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest())
        self.assertNotIn("privateKey", json.dumps(sig)); self.assertNotIn("secret", json.dumps(sig).lower())
        policy = load("trust-policy.json")
        self.assertEqual([k["keyId"] for k in policy["keys"] if k["status"] == "active"], [sig["keyId"]])
        self.assertFalse(policy["allowDowngrade"]); self.assertGreaterEqual(policy["offlineCacheValidityDays"], 1)

    def test_repo_trust_policy_ships_no_key_and_fails_closed(self):
        policy = json.loads((ROOT / "packaging" / "trust-policy.json").read_text())
        self.assertEqual(policy["keys"], []); self.assertFalse(policy["allowDowngrade"]); self.assertIn("NO_ACTIVE_KEY", policy["note"])
        self.assertNotIn("BEGIN", (ROOT / "packaging" / "trust-policy.json").read_text())
        for p in ROOT.rglob("*"):
            if p.is_file() and p.suffix in (".pem", ".key", ".jks", ".keystore"):
                self.fail(f"private key material in the package: {p}")


if __name__ == "__main__":
    unittest.main()
