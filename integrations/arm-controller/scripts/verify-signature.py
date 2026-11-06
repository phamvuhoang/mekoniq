#!/usr/bin/env python3
"""Verify an arm controller artifact before anything is extracted or activated: Ed25519 signature (pure Python, RFC 8032) over the canonical
manifest under an allowlisted, active, unexpired key of the machine's trust policy; every file's sha256 and no file outside the manifest;
an unapproved downgrade against the installed manifest. Fails closed on a missing/expired trust cache. No third-party crypto on the IPC.
  verify-signature.py --artifact DIR --trust-policy FILE [--installed MANIFEST] [--now ISO] [--json]
Exit 0 ok · 1 tamper (hash/file) · 3 trust (signature/key/policy/downgrade)."""
import argparse
import base64
import hashlib
import json
import importlib.util
import marshal
from pathlib import Path
import os
import sys
from datetime import datetime, timedelta, timezone

# ---- Ed25519 (RFC 8032), affine arithmetic; verification only ----
P = 2 ** 255 - 19
Q = 2 ** 252 + 27742317777372353535851937790883648493
D = (-121665 * pow(121666, -1, P)) % P
I = pow(2, (P - 1) // 4, P)
_BY = (4 * pow(5, -1, P)) % P


def _xrecover(y):
    xx = (y * y - 1) * pow(D * y * y + 1, -1, P) % P
    x = pow(xx, (P + 3) // 8, P)
    if (x * x - xx) % P:
        x = x * I % P
    return P - x if x % 2 else x


_B = (_xrecover(_BY), _BY)


def _add(p1, p2):
    x1, y1 = p1; x2, y2 = p2
    den = D * x1 * x2 * y1 * y2
    return ((x1 * y2 + x2 * y1) * pow(1 + den, -1, P) % P, (y1 * y2 + x1 * x2) * pow(1 - den, -1, P) % P)


def _mul(p, e):
    q = (0, 1)
    while e:
        if e & 1:
            q = _add(q, p)
        p = _add(p, p); e >>= 1
    return q


def _decode(s):
    n = int.from_bytes(s, "little"); y = n & ((1 << 255) - 1); x = _xrecover(y)
    if (x & 1) != (n >> 255):
        x = P - x
    if (-x * x + y * y - 1 - D * x * x * y * y) % P:
        raise ValueError("POINT_NOT_ON_CURVE")
    return (x, y)


def ed25519_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    try:
        if len(public_key) != 32 or len(signature) != 64:
            return False
        r, a = _decode(signature[:32]), _decode(public_key)
        s = int.from_bytes(signature[32:], "little")
        if s >= Q:
            return False
        h = int.from_bytes(hashlib.sha512(signature[:32] + public_key + message).digest(), "little")
        return _add(r, _mul(a, h % Q)) == _mul(_B, s)
    except (ValueError, ZeroDivisionError):
        return False


# ---- manifest / policy ----
def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def b64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def parse_time(v):
    return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(timezone.utc)


def _version_key(v):
    core = v.split("+")[0].split("-")[0]
    return tuple(int(x) for x in core.split("."))


def policy_errors(policy, now):
    """Validate the signed revision and offline trust window before using or storing policy."""
    errors = []
    if type(policy.get("policyRevision")) is not int or policy["policyRevision"] < 1:
        errors.append("TRUST_POLICY_REVISION_INVALID")
    cached = policy.get("cachedAt")
    if not cached:
        errors.append("TRUST_CACHE_MISSING")
    else:
        try:
            days = policy.get("offlineCacheValidityDays")
            if type(days) is not int or days <= 0:
                raise ValueError("invalid cache lifetime")
            stamp = parse_time(cached)
            if stamp > now:
                errors.append("TRUST_CACHE_NOT_YET_VALID")
            elif now >= stamp + timedelta(days=days):
                errors.append("TRUST_CACHE_EXPIRED")
        except (ValueError, TypeError, AttributeError, OverflowError):
            errors.append("TRUST_CACHE_INVALID")
    return errors


def derived_cache(artifact, rel, listed, runtime_root):
    """Installed caches are allowed only when their code bytes equal compilation of signed source.

    Never unmarshal or execute untrusted bytes. Incoming artifacts never enable this exception.
    Unknown interpreter tags/optimizations fail closed; no cache directory is skipped.
    """
    try:
        cache = Path(artifact) / rel
        source = Path(importlib.util.source_from_cache(str(cache)))
        source_rel = str(source.relative_to(artifact))
        if source_rel not in listed or source.suffix != ".py":
            return False
        optimization = next((n for n in (0, 1, 2) if importlib.util.cache_from_source(str(source), optimization="" if n == 0 else n) == str(cache)), None)
        if optimization is None:
            return False
        data = cache.read_bytes()
        if data[:4] != importlib.util.MAGIC_NUMBER or len(data) < 16 or int.from_bytes(data[4:8], "little") not in (0, 1, 3):
            return False
        filenames = {os.path.abspath(source), os.path.realpath(source)}
        if runtime_root:
            filenames.add(os.path.abspath(os.path.join(runtime_root, source_rel)))
            filenames.add(os.path.realpath(os.path.dirname(runtime_root)) + "/" + os.path.basename(runtime_root) + "/" + source_rel)
        content = source.read_bytes()
        if hashlib.sha256(content).hexdigest() != listed[source_rel]:
            return False
        for filename in filenames:
            code = compile(content, filename, "exec", dont_inherit=True, optimize=optimization)
            if data[16:] == marshal.dumps(code):
                return True
        return False
    except (OSError, ValueError, TypeError, SyntaxError):
        return False


def verify(artifact, policy_path, installed=None, now=None, runtime_root=None):
    now = now or datetime.now(timezone.utc)
    reasons, out = [], {"ok": False, "artifact": artifact, "keyId": None, "filesChecked": 0, "downgrade": None}
    try:
        policy = json.loads(Path(policy_path).read_text())
    except (OSError, ValueError):
        return 3, {**out, "reasons": ["TRUST_POLICY_MISSING"]}
    try:
        manifest = json.load(open(os.path.join(artifact, "manifest.json")))
        sig = json.load(open(os.path.join(artifact, "manifest.sig.json")))
    except (OSError, ValueError) as e:
        return 3, {**out, "reasons": [f"MANIFEST_OR_SIGNATURE_MISSING:{type(e).__name__}"]}
    reasons.extend(policy_errors(policy, now))
    key = next((k for k in policy.get("keys", []) if k.get("keyId") == sig.get("keyId")), None)
    out["keyId"] = sig.get("keyId")
    if manifest.get("signed") is False or sig.get("algorithm") != "Ed25519":
        reasons.append("ARTIFACT_UNSIGNED")
    if key is None:
        reasons.append(f"KEY_UNKNOWN:{sig.get('keyId')}")
    else:
        if key.get("status") != "active":
            reasons.append(f"KEY_{str(key.get('status', 'INVALID')).upper()}:{key['keyId']}")
        if key.get("expiresAt") and now > parse_time(key["expiresAt"]):
            reasons.append(f"KEY_EXPIRED:{key['keyId']}")
        if key.get("validFrom") and now < parse_time(key["validFrom"]):
            reasons.append(f"KEY_NOT_YET_VALID:{key['keyId']}")
        body = canonical(manifest)
        if hashlib.sha256(body).hexdigest() != sig.get("manifestSha256") or not ed25519_verify(b64u(key["publicKey"]), body, b64u(sig.get("signature", ""))):
            reasons.append("SIGNATURE_INVALID")
    if reasons:
        return 3, {**out, "reasons": reasons}
    # files: every listed file matches, nothing else is present (manifest + signature excepted)
    listed = {f["path"]: f["sha256"] for f in manifest.get("files", [])}
    for path, want in listed.items():
        if Path(path).is_absolute() or ".." in Path(path).parts or str(Path(path)) != path:
            reasons.append(f"FILE_PATH_INVALID:{path}"); continue
        full = os.path.join(artifact, path)
        try:
            got = hashlib.sha256(open(full, "rb").read()).hexdigest()
        except OSError:
            reasons.append(f"FILE_MISSING:{path}"); continue
        if got != want:
            reasons.append(f"FILE_HASH_MISMATCH:{path}")
    for dirpath, dirs, files in os.walk(artifact):
        for name in dirs + files:
            if os.path.islink(os.path.join(dirpath, name)):
                reasons.append(f"SYMLINK_NOT_ALLOWED:{os.path.relpath(os.path.join(dirpath, name), artifact)}")
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), artifact)
            if rel not in listed and rel not in ("manifest.json", "manifest.sig.json"):
                if not runtime_root or not derived_cache(artifact, rel, listed, runtime_root):
                    reasons.append(f"FILE_NOT_IN_MANIFEST:{rel}")
    out["filesChecked"] = len(listed)
    if reasons:
        return 1, {**out, "reasons": sorted(reasons)}
    if manifest.get("hardwareEnabled") is not False or manifest.get("mode") != "simulation":
        return 3, {**out, "reasons": ["HARDWARE_FLAG_IN_ARTIFACT"]}
    if installed:
        try:
            cur = json.load(open(installed))
            older = _version_key(cur["version"]) > _version_key(manifest["version"]) or (
                _version_key(cur["version"]) == _version_key(manifest["version"]) and parse_time(cur["exportedAt"]) > parse_time(manifest["exportedAt"]))
            if older:                                                              # same semver core: the signed exportedAt decides (build metadata is not an order)
                allowed = manifest["version"] in policy.get("allowDowngradeTo", []) or policy.get("allowDowngrade") is True
                out["downgrade"] = {"from": cur["version"], "to": manifest["version"], "allowedByPolicy": allowed}
                if not allowed:
                    return 3, {**out, "reasons": [f"DOWNGRADE_REFUSED:{cur['version']}->{manifest['version']}"]}
        except (OSError, ValueError, KeyError):
            return 3, {**out, "reasons": ["INSTALLED_MANIFEST_UNREADABLE"]}
    return 0, {**out, "ok": True, "reasons": [], "version": manifest.get("version"), "sourceCommit": manifest.get("sourceCommit")}


def verify_policy_update(new_path, installed_path, now=None):
    """A replacement trust policy is accepted only with a sibling `trust-policy.sig.json` (same signature format as the manifest) under a key
    that is active in the INSTALLED policy; the new policy may rotate keys, but it cannot bootstrap itself."""
    now = now or datetime.now(timezone.utc)
    try:
        installed, new = json.loads(Path(installed_path).read_text()), json.loads(Path(new_path).read_text())
    except (OSError, ValueError):
        return 3, {"ok": False, "reasons": ["TRUST_POLICY_UNREADABLE"]}
    sig_path = os.path.join(os.path.dirname(new_path), "trust-policy.sig.json")
    try:
        sig = json.loads(Path(sig_path).read_text())
    except (OSError, ValueError):
        return 3, {"ok": False, "reasons": ["TRUST_POLICY_UPDATE_UNSIGNED"]}
    errors = policy_errors(installed, now) + policy_errors(new, now)
    if errors:
        return 3, {"ok": False, "reasons": ["TRUST_POLICY_UPDATE_INVALID:" + error for error in errors]}
    key = next((k for k in installed.get("keys", []) if k.get("keyId") == sig.get("keyId") and k.get("status") == "active"), None)
    if key is None or (key.get("expiresAt") and now >= parse_time(key["expiresAt"])) or (key.get("validFrom") and now < parse_time(key["validFrom"])):
        return 3, {"ok": False, "reasons": [f"TRUST_POLICY_UPDATE_INVALID:KEY_NOT_ACTIVE:{sig.get('keyId')}"]}
    body = canonical(new)
    if sig.get("algorithm") != "Ed25519" or hashlib.sha256(body).hexdigest() != sig.get("manifestSha256") or not ed25519_verify(b64u(key["publicKey"]), body, b64u(sig.get("signature", ""))):
        return 3, {"ok": False, "reasons": ["TRUST_POLICY_UPDATE_INVALID:SIGNATURE"]}
    if new["policyRevision"] <= installed["policyRevision"]:
        return 3, {"ok": False, "reasons": ["TRUST_POLICY_REVISION_REPLAY"]}
    return 0, {"ok": True, "reasons": [], "keyId": sig["keyId"], "policyRevision": new["policyRevision"], "keys": [k["keyId"] for k in new.get("keys", [])]}


def main():
    a = argparse.ArgumentParser(); a.add_argument("--artifact"); a.add_argument("--trust-policy"); a.add_argument("--installed"); a.add_argument("--now"); a.add_argument("--json", action="store_true")
    a.add_argument("--runtime-root", help="installed-only: verify derived caches against signed source at this import root")
    a.add_argument("--policy-update"); a.add_argument("--installed-policy")
    o = a.parse_args()
    if o.policy_update:
        rc, out = verify_policy_update(o.policy_update, o.installed_policy, parse_time(o.now) if o.now else None)
        print(json.dumps(out) if o.json else ("policy update verified" if rc == 0 else "REFUSED: " + ",".join(out["reasons"]))); sys.exit(rc)
    if not o.artifact or not o.trust_policy:
        print("usage: --artifact DIR --trust-policy FILE [--installed MANIFEST] | --policy-update NEW --installed-policy OLD", file=sys.stderr); sys.exit(2)
    rc, out = verify(o.artifact, o.trust_policy, o.installed, parse_time(o.now) if o.now else None, runtime_root=o.runtime_root)
    print(json.dumps(out) if o.json else ("verified " + str(out.get("version")) if rc == 0 else "REFUSED: " + ",".join(out["reasons"])))
    sys.exit(rc)


if __name__ == "__main__":
    main()
