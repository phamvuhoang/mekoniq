"""R01/R02 regressions at the real installer/import and signed policy boundaries."""
import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

from test_release_trust import VERIFY, INSTALL, VERIFY_INSTALL, FX, run, verify_signature


class ReleaseSecurityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="arm-release-security-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.art = self.root / "artifact"
        shutil.copytree(FX / "artifact", self.art)
        (self.art / "bridge").mkdir()
        (self.art / "bridge" / "__init__.py").write_text('VALUE = "SIGNED_SOURCE"\n')
        self.prefix = self.root / "installed"
        self.env = {**os.environ, "MEKONIQ_PYTHON": sys.executable}
        self.env.pop("PYTHONDONTWRITEBYTECODE", None)
        self.env.pop("PYTHONPYCACHEPREFIX", None)
        self.node = shutil.which("node")
        self.key = self.root / "key.pem"
        r = run([self.node, "-e", "const c=require('crypto'),fs=require('fs'); const k=c.generateKeyPairSync('ed25519'); fs.writeFileSync(process.argv[1],k.privateKey.export({format:'pem',type:'pkcs8'})); process.stdout.write(k.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64url'));", str(self.key)])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.policy = json.loads((FX / "trust-policy.json").read_text())
        self.policy.update(policyRevision=1)
        self.policy["keys"][0]["publicKey"] = r.stdout
        self.policy["keys"].append({**self.policy["keys"][0], "keyId": "test-key-2027"})
        self.policy_path = self.write_policy("initial", self.policy)
        self.manifest = json.loads((FX / "manifest.json").read_text())
        self.manifest["files"].append({"path": "bridge/__init__.py", "sha256": hashlib.sha256((self.art / "bridge/__init__.py").read_bytes()).hexdigest()})
        self.sign_artifact("test-key-2026")

    def sign(self, body, dest, key_id="test-key-2026"):
        payload = self.root / "payload.json"
        payload.write_text(json.dumps(body, sort_keys=True, separators=(",", ":")))
        r = run([self.node, "-e", "const c=require('crypto'),fs=require('fs');const b=fs.readFileSync(process.argv[1]),k=fs.readFileSync(process.argv[2]);fs.writeFileSync(process.argv[3],JSON.stringify({algorithm:'Ed25519',keyId:process.argv[4],manifestSha256:c.createHash('sha256').update(b).digest('hex'),signature:c.sign(null,b,k).toString('base64url')}));", str(payload), str(self.key), str(dest), key_id])
        self.assertEqual(r.returncode, 0, r.stderr)

    def sign_artifact(self, key_id):
        (self.art / "manifest.json").write_text(json.dumps(self.manifest))
        self.sign(self.manifest, self.art / "manifest.sig.json", key_id)

    def write_policy(self, name, policy):
        directory = self.root / name
        directory.mkdir(exist_ok=True)
        path = directory / "trust-policy.json"
        path.write_text(json.dumps(policy))
        self.sign(policy, directory / "trust-policy.sig.json")
        return path

    def install(self, policy=None):
        return run(["bash", str(INSTALL), "--prefix", str(self.prefix), "--artifact", str(self.art), "--trust-policy", str(policy or self.policy_path)], env=self.env)

    def inject_cache(self, root):
        source = root / "bridge/__init__.py"
        cache = Path(importlib.util.cache_from_source(str(source)))
        cache.parent.mkdir(exist_ok=True)
        cache.write_bytes(importlib.util.MAGIC_NUMBER + struct.pack("<I", 1) + b"0" * 8 + marshal.dumps(compile('VALUE = "UNSIGNED_PYC_EXECUTED"', str(source), "exec")))
        return cache

    def test_unsigned_unchecked_hash_cache_is_refused_before_install(self):
        self.inject_cache(self.art)
        r = self.install()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("FILE_NOT_IN_MANIFEST", r.stderr)
        self.assertFalse((self.prefix / "current").exists())

    def test_normal_import_remains_verifiable_but_replaced_runtime_cache_does_not(self):
        r = self.install()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        current = self.prefix / "current"
        imported = run([sys.executable, "-c", "import bridge; print(bridge.VALUE)"], cwd=current, env=self.env)
        self.assertEqual((imported.returncode, imported.stdout.strip()), (0, "SIGNED_SOURCE"), imported.stderr)
        for flag in ("-O", "-OO"):
            optimized = run([sys.executable, flag, "-c", "import bridge; print(bridge.VALUE)"], cwd=current, env=self.env)
            self.assertEqual((optimized.returncode, optimized.stdout.strip()), (0, "SIGNED_SOURCE"), optimized.stderr)
        self.assertEqual(len(list((current / "bridge/__pycache__").glob("*.pyc"))), 3)
        v = run(["bash", str(VERIFY_INSTALL), "--prefix", str(self.prefix)], env=self.env)
        self.assertEqual(v.returncode, 0, v.stdout + v.stderr)
        self.inject_cache(current)
        v = run(["bash", str(VERIFY_INSTALL), "--prefix", str(self.prefix)], env=self.env)
        self.assertEqual(v.returncode, 1, v.stdout + v.stderr)

    def test_runtime_cache_rejects_foreign_tags_optimization_and_symlinks(self):
        self.assertEqual(self.install().returncode, 0)
        current = self.prefix / "current"
        self.assertEqual(run([sys.executable, "-c", "import bridge"], cwd=current, env=self.env).returncode, 0)
        cache = next((current / "bridge/__pycache__").glob("*.pyc"))
        original = cache.read_bytes()
        for name in ("__init__.cpython-999.pyc", "__init__." + sys.implementation.cache_tag + ".opt-9.pyc"):
            foreign = cache.with_name(name)
            foreign.write_bytes(original)
            v = run(["bash", str(VERIFY_INSTALL), "--prefix", str(self.prefix)], env=self.env)
            self.assertEqual(v.returncode, 1, v.stdout + v.stderr)
            foreign.unlink()
        outside = self.root / "outside.pyc"
        outside.write_bytes(original)
        cache.unlink()
        cache.symlink_to(outside)
        v = run(["bash", str(VERIFY_INSTALL), "--prefix", str(self.prefix)], env=self.env)
        self.assertEqual(v.returncode, 1, v.stdout + v.stderr)
        self.assertIn("SYMLINK_NOT_ALLOWED", v.stdout)

    def test_signed_policy_replay_cannot_restore_a_revoked_artifact_key(self):
        self.assertEqual(self.install().returncode, 0)
        revoked = json.loads(json.dumps(self.policy))
        revoked["policyRevision"] = 2
        revoked["keys"][1]["status"] = "revoked"
        replacement = self.write_policy("revoked", revoked)
        r = self.install(replacement)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        replay = self.install(self.policy_path)
        self.assertEqual(replay.returncode, 3, replay.stdout + replay.stderr)
        self.assertIn("REVISION", replay.stderr)
        self.assertEqual(json.loads((self.prefix / "trust/trust-policy.json").read_text())["policyRevision"], 2)
        self.sign_artifact("test-key-2027")
        r = self.install(replacement)
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("KEY_REVOKED", r.stderr)

    def test_invalid_candidate_cannot_replace_active_policy(self):
        self.assertEqual(self.install().returncode, 0)
        active = (self.prefix / "trust/trust-policy.json").read_bytes()
        for field, value in (("cachedAt", "2020-01-01T00:00:00Z"), ("cachedAt", "2099-01-01T00:00:00Z"), ("offlineCacheValidityDays", 0), ("policyRevision", 1), ("policyRevision", True)):
            with self.subTest(field=field, value=value):
                candidate = {**self.policy, "policyRevision": 2, "note": "changed candidate", field: value}
                r = self.install(self.write_policy("candidate", candidate))
                self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
                self.assertEqual((self.prefix / "trust/trust-policy.json").read_bytes(), active)

    def test_expired_active_cache_cannot_authorize_policy_update(self):
        expired = {**self.policy, "cachedAt": "2020-01-01T00:00:00Z"}
        old = self.write_policy("expired", expired)
        new = self.write_policy("new", {**self.policy, "policyRevision": 2})
        rc, result = verify_signature.verify_policy_update(str(new), str(old))
        self.assertEqual(rc, 3, result)


if __name__ == "__main__":
    unittest.main()
