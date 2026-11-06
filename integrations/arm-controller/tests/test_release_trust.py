"""A06 trust: verify-signature.py (pure-Python Ed25519, RFC 8032 vector) and install-sim.sh / verify-install.sh fail closed on a tampered
manifest or file, a wrong/revoked/expired key, a missing trust policy, a signed-but-unapproved downgrade; a last-known-good rollback needs a
compatible calibration schema. Everything runs on a temp prefix without systemd; the scripts' Linux service enable is a separate flag."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from support import ROOT

FX = ROOT / "tests" / "fixtures" / "release"
VERIFY = ROOT / "scripts" / "verify-signature.py"
INSTALL = ROOT / "scripts" / "install-sim.sh"
VERIFY_INSTALL = ROOT / "scripts" / "verify-install.sh"
import sys  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
import importlib  # noqa: E402

verify_signature = importlib.import_module("verify-signature")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


class Ed25519Test(unittest.TestCase):
    def test_rfc8032_vector_1_and_a_flipped_bit(self):
        v = json.loads((FX / "rfc8032-vector.json").read_text())
        pk, sig, msg = bytes.fromhex(v["publicKey"]), bytes.fromhex(v["signature"]), bytes.fromhex(v["message"])
        self.assertTrue(verify_signature.ed25519_verify(pk, msg, sig))
        bad = bytearray(sig); bad[0] ^= 1
        self.assertFalse(verify_signature.ed25519_verify(pk, msg, bytes(bad)))
        self.assertFalse(verify_signature.ed25519_verify(pk, msg + b"x", sig))


class VerifierTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="arm-release-")); self.art = self.dir / "artifact"
        shutil.copytree(FX / "artifact", self.art); shutil.copy(FX / "manifest.json", self.art / "manifest.json"); shutil.copy(FX / "manifest.sig.json", self.art / "manifest.sig.json")
        self.policy = FX / "trust-policy.json"

    def verify(self, policy=None, installed=None, extra=()):
        cmd = [sys.executable, str(VERIFY), "--artifact", str(self.art), "--trust-policy", str(policy or self.policy), "--json", *(["--installed", str(installed)] if installed else []), *extra]
        r = run(cmd); return r.returncode, json.loads(r.stdout) if r.stdout.strip() else {"stderr": r.stderr}

    def test_valid_artifact_verifies_with_key_file_hashes_and_window(self):
        rc, out = self.verify()
        self.assertEqual((rc, out["ok"]), (0, True), out); self.assertEqual(out["keyId"], json.loads((FX / "manifest.sig.json").read_text())["keyId"]); self.assertEqual(out["filesChecked"], len(json.loads((FX / "manifest.json").read_text())["files"]))

    def test_tampered_manifest_file_or_signature_fail_closed(self):
        m = json.loads((self.art / "manifest.json").read_text()); m["version"] = "9.9.9"; (self.art / "manifest.json").write_text(json.dumps(m, indent=1))
        rc, out = self.verify(); self.assertEqual(rc, 3); self.assertIn("SIGNATURE_INVALID", out["reasons"])
        shutil.copy(FX / "manifest.json", self.art / "manifest.json")
        (self.art / "a.txt").write_bytes(b"tampered")
        rc, out = self.verify(); self.assertEqual(rc, 1); self.assertTrue(any(r.startswith("FILE_HASH_MISMATCH:a.txt") for r in out["reasons"]), out)
        shutil.copytree(FX / "artifact", self.art, dirs_exist_ok=True)
        (self.art / "extra.sh").write_text("echo not in manifest")
        rc, out = self.verify(); self.assertEqual(rc, 1); self.assertIn("FILE_NOT_IN_MANIFEST:extra.sh", out["reasons"])

    def test_wrong_revoked_expired_or_missing_trust_fails_closed(self):
        for name, code in (("trust-policy-wrong-key.json", "SIGNATURE_INVALID"), ("trust-policy-unknown-key.json", "KEY_UNKNOWN"), ("trust-policy-revoked.json", "KEY_REVOKED"), ("trust-policy-expired.json", "KEY_EXPIRED")):
            rc, out = self.verify(policy=FX / name); self.assertEqual(rc, 3, name); self.assertTrue(any(r.startswith(code) for r in out["reasons"]), (name, out))
        rc, out = self.verify(policy=self.dir / "missing.json"); self.assertEqual(rc, 3); self.assertIn("TRUST_POLICY_MISSING", out["reasons"])
        stale = json.loads(self.policy.read_text()); stale["cachedAt"] = "2020-01-01T00:00:00Z"; stale["offlineCacheValidityDays"] = 30; (self.dir / "stale.json").write_text(json.dumps(stale))
        rc, out = self.verify(policy=self.dir / "stale.json"); self.assertEqual(rc, 3); self.assertIn("TRUST_CACHE_EXPIRED", out["reasons"])

    def test_a_policy_without_a_cache_stamp_fails_closed_and_an_equal_version_exported_earlier_is_a_downgrade(self):
        policy = json.loads(self.policy.read_text()); policy["cachedAt"] = None; (self.dir / "nocache.json").write_text(json.dumps(policy))
        rc, out = self.verify(policy=self.dir / "nocache.json"); self.assertEqual(rc, 3); self.assertIn("TRUST_CACHE_MISSING", out["reasons"])
        installed = self.dir / "installed.json"; m = json.loads((FX / "manifest.json").read_text()); m["exportedAt"] = "2026-11-06T00:00:00.000Z"; installed.write_text(json.dumps(m))
        rc, out = self.verify(installed=installed); self.assertEqual(rc, 3); self.assertTrue(any(r.startswith("DOWNGRADE_REFUSED") for r in out["reasons"]), out)

    def test_signed_older_version_is_a_downgrade_unless_the_policy_names_it(self):
        installed = self.dir / "installed.json"; m = json.loads((FX / "manifest.json").read_text()); m["version"] = "0.2.0+newer"; installed.write_text(json.dumps(m))
        rc, out = self.verify(installed=installed); self.assertEqual(rc, 3); self.assertTrue(any(r.startswith("DOWNGRADE_REFUSED") for r in out["reasons"]), out)
        policy = json.loads(self.policy.read_text()); policy["allowDowngradeTo"] = [m0 := json.loads((FX / "manifest.json").read_text())["version"]]; (self.dir / "allow.json").write_text(json.dumps(policy))
        rc, out = self.verify(policy=self.dir / "allow.json", installed=installed); self.assertEqual(rc, 0); self.assertEqual(out["downgrade"], {"from": "0.2.0+newer", "to": m0, "allowedByPolicy": True})


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="arm-install-")); self.prefix = self.dir / "opt"; self.art = self.dir / "artifact"
        shutil.copytree(FX / "artifact", self.art); shutil.copy(FX / "manifest.json", self.art / "manifest.json"); shutil.copy(FX / "manifest.sig.json", self.art / "manifest.sig.json")
        self.env = {**os.environ, "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "MEKONIQ_PYTHON": sys.executable}

    def install(self, *extra, trust=FX / "trust-policy.json", art=None):
        return run(["bash", str(INSTALL), "--prefix", str(self.prefix), "--artifact", str(art or self.art), "--trust-policy", str(trust), *extra], env=self.env)

    def test_install_verifies_then_activates_sim_without_hardware_and_keeps_the_machine_overlay_apart(self):
        r = self.install(); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        current = self.prefix / "current"; self.assertTrue(current.is_symlink()); self.assertTrue((current / "manifest.json").exists())
        state = json.loads((self.prefix / "state.json").read_text()); self.assertEqual(state["current"], json.loads((FX / "manifest.json").read_text())["version"]); self.assertEqual(state["lastKnownGood"], None)
        self.assertEqual(json.loads((self.prefix / "machine" / "overlay.json").read_text()), {"schemaVersion": 1, "identity": None, "calibration": None, "hardwareEnabled": False, "note": "per-machine identity and calibration are provisioned here, never shipped in the artifact"})
        self.assertFalse((self.prefix / "machine" / "hardware.enabled").exists()); self.assertIn("mode: simulation", r.stdout)
        v = run(["bash", str(VERIFY_INSTALL), "--prefix", str(self.prefix)], env=self.env); self.assertEqual(v.returncode, 0, v.stdout + v.stderr); self.assertIn("verified", v.stdout)
        (current / "a.txt").write_bytes(b"tampered after install")
        v = run(["bash", str(VERIFY_INSTALL), "--prefix", str(self.prefix)], env=self.env); self.assertEqual(v.returncode, 1); self.assertIn("FILE_HASH_MISMATCH", v.stdout + v.stderr)

    def test_the_installer_inside_the_artifact_refuses_to_verify_that_artifact(self):
        (self.art / "scripts").mkdir(); shutil.copy(INSTALL, self.art / "scripts" / "install-sim.sh"); shutil.copy(VERIFY, self.art / "scripts" / "verify-signature.py")   # a real artifact ships its own installer
        r = run(["bash", str(self.art / "scripts" / "install-sim.sh"), "--prefix", str(self.prefix), "--artifact", str(self.art), "--trust-policy", str(FX / "trust-policy.json")], env=self.env)
        self.assertEqual(r.returncode, 3); self.assertIn("INSTALLER_FROM_ARTIFACT", r.stdout + r.stderr); self.assertFalse((self.prefix / "releases").exists())

    def test_an_installed_trust_policy_is_replaced_only_by_a_policy_signed_under_a_currently_active_key(self):
        self.assertEqual(self.install().returncode, 0)
        r = self.install(trust=FX / "trust-policy-unknown-key.json"); self.assertEqual(r.returncode, 3); self.assertIn("TRUST_POLICY_UPDATE_UNSIGNED", r.stdout + r.stderr)
        self.assertEqual(json.loads((self.prefix / "trust" / "trust-policy.json").read_text())["keys"][0]["keyId"], "test-key-2026")
        upd = self.dir / "update"; upd.mkdir(); shutil.copy(FX / "trust-policy-v2.json", upd / "trust-policy.json"); shutil.copy(FX / "trust-policy-v2.sig.json", upd / "trust-policy.sig.json")
        r = self.install(trust=upd / "trust-policy.json"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([k["keyId"] for k in json.loads((self.prefix / "trust" / "trust-policy.json").read_text())["keys"]], ["test-key-2026", "test-key-2027"])
        bad = self.dir / "bad"; bad.mkdir(); pol = json.loads((FX / "trust-policy-v2.json").read_text()); pol["cachedAt"] = "2026-11-07T00:00:00Z"; (bad / "trust-policy.json").write_text(json.dumps(pol)); shutil.copy(FX / "trust-policy-v2.sig.json", bad / "trust-policy.sig.json")   # content changed, signature not
        r = self.install(trust=bad / "trust-policy.json"); self.assertEqual(r.returncode, 3); self.assertIn("TRUST_POLICY_UPDATE_INVALID", r.stdout + r.stderr)

    def test_install_refuses_tamper_wrong_key_and_missing_policy_before_extracting(self):
        (self.art / "a.txt").write_bytes(b"tampered")
        r = self.install(); self.assertEqual(r.returncode, 1); self.assertFalse((self.prefix / "current").exists()); self.assertFalse((self.prefix / "releases").exists())
        shutil.copytree(FX / "artifact", self.art, dirs_exist_ok=True)
        r = self.install(trust=FX / "trust-policy-wrong-key.json"); self.assertEqual(r.returncode, 3); self.assertFalse((self.prefix / "releases").exists())
        r = self.install(trust=self.dir / "nope.json"); self.assertEqual(r.returncode, 3); self.assertIn("TRUST_POLICY_MISSING", r.stdout + r.stderr)

    def test_rollback_to_last_known_good_needs_a_compatible_calibration_schema(self):
        self.assertEqual(self.install().returncode, 0)
        newer = self.dir / "newer"; shutil.copytree(self.art, newer)
        m = json.loads((newer / "manifest.json").read_text()); m["version"] = "0.2.0+next"; m["compatibleCalibrationSchemas"] = [2]
        (newer / "manifest.json").write_text(json.dumps(m, indent=1))
        r = self.install(art=newer); self.assertEqual(r.returncode, 3, r.stdout + r.stderr)                  # a re-signed manifest is needed: an edited one is refused
        sig = json.loads((FX / "manifest-next.sig.json").read_text()); shutil.copy(FX / "manifest-next.json", newer / "manifest.json"); (newer / "manifest.sig.json").write_text(json.dumps(sig))
        r = self.install(art=newer); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        state = json.loads((self.prefix / "state.json").read_text()); self.assertEqual((state["current"], state["lastKnownGood"]), ("0.2.0+next", json.loads((FX / "manifest.json").read_text())["version"]))
        overlay = self.prefix / "machine" / "overlay.json"; o = json.loads(overlay.read_text()); o["calibration"] = {"schemaVersion": 2, "source": "test"}; overlay.write_text(json.dumps(o))
        r = run(["bash", str(INSTALL), "--prefix", str(self.prefix), "--rollback"], env=self.env); self.assertEqual(r.returncode, 4); self.assertIn("CALIBRATION_INCOMPATIBLE", r.stdout + r.stderr)
        o["calibration"] = {"schemaVersion": 1, "source": "test"}; overlay.write_text(json.dumps(o))
        r = run(["bash", str(INSTALL), "--prefix", str(self.prefix), "--rollback"], env=self.env); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        state = json.loads((self.prefix / "state.json").read_text()); self.assertEqual(state["current"], json.loads((FX / "manifest.json").read_text())["version"]); self.assertEqual(state["rolledBackFrom"], "0.2.0+next")
        self.assertEqual(run(["bash", str(VERIFY_INSTALL), "--prefix", str(self.prefix)], env=self.env).returncode, 0)


if __name__ == "__main__":
    unittest.main()
