"""Wire side of the executor: RobotCommand validation against the SHARED schema, canonical hash, ES256 verification and a signed outbound
channel. The agent only dials OUT (MQTT/WebSocket to cloud or LAN); nothing here listens, so there is no cloud-direct ROS endpoint.
Broker/WebSocket clients are not bundled: a Transport is injected (tests use an in-memory loopback)."""
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
from typing import Callable, Protocol

import rfc8785
from jsonschema import Draft7Validator, FormatChecker


def _schema_path():
    env = os.environ.get("MEKONIQ_CONTRACTS_DIR")
    if env:
        return Path(env) / "wire.schema.json"
    for parent in Path(__file__).resolve().parents:  # editable install inside the repo
        found = parent / "packages/contracts/schemas/wire.schema.json"
        if found.is_file():
            return found
    raise FileNotFoundError("wire.schema.json not found: set MEKONIQ_CONTRACTS_DIR to the shared contracts schemas directory")


_validator = None


def validate_command(command):
    """Raises ValueError unless `command` is a RobotCommand per the shared packages/contracts schema (never a forked copy) and canonicalizable."""
    global _validator
    if _validator is None:
        schema = json.loads(_schema_path().read_text())
        _validator = Draft7Validator({**schema, "anyOf": [{"$ref": "#/definitions/RobotCommand"}]}, format_checker=FormatChecker())
    if not isinstance(command, dict) or not _validator.is_valid(command):
        raise ValueError("INVALID_COMMAND")
    command_hash(command)


def command_hash(value):
    """sha256(RFC 8785 JCS) hex — same bytes as packages/contracts hashPayload and the Kotlin JournalDatabase.hash."""
    try:
        return hashlib.sha256(rfc8785.dumps(value)).hexdigest()
    except Exception as e:  # rfc8785 errors: ints outside 2^53, non-finite, unsupported types
        raise ValueError("INVALID_COMMAND") from e


def parse_strict(raw):
    """JSON ingress: no duplicate keys, no NaN/Infinity (mirrors parseJsonStrict)."""
    def pairs(items):
        keys = [k for k, _ in items]
        if len(keys) != len(set(keys)):
            raise ValueError("DUPLICATE_KEY")
        return dict(items)
    def bad(_):
        raise ValueError("INVALID_JSON")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=bad)


# --- ES256 (JOSE raw r||s over P-256/SHA-256), verification only. Pure Python so no crypto dependency is added; public inputs only. ---
_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
_G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296, 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def _add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0]:
        if (a[1] + b[1]) % _P == 0:
            return None
        m = (3 * a[0] * a[0] - 3) * pow(2 * a[1], -1, _P) % _P
    else:
        m = (b[1] - a[1]) * pow(b[0] - a[0], -1, _P) % _P
    x = (m * m - a[0] - b[0]) % _P
    return x, (m * (a[0] - x) - a[1]) % _P


def _mul(k, point):
    result = None
    while k:
        if k & 1:
            result = _add(result, point)
        point = _add(point, point)
        k >>= 1
    return result


def _b64url(value, length):
    if not isinstance(value, str) or not value.isascii():
        raise ValueError("INVALID_BASE64URL")
    try:
        raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError) as e:
        raise ValueError("INVALID_BASE64URL") from e
    if len(raw) != length or base64.urlsafe_b64encode(raw).rstrip(b"=").decode() != value:  # canonical encoding only, like the TS verifier
        raise ValueError("INVALID_BASE64URL")
    return raw


def verify_es256(data, signature, jwk):
    try:
        if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256" or jwk.get("alg", "ES256") != "ES256" or jwk.get("use", "sig") != "sig":
            return False
        if "key_ops" in jwk and "verify" not in jwk["key_ops"]:
            return False
        x, y = (int.from_bytes(_b64url(jwk[k], 32), "big") for k in ("x", "y"))
        sig = _b64url(signature, 64)
        r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
        if not (0 < x < _P and 0 < y < _P and (y * y - x * x * x + 3 * x - _B) % _P == 0 and 0 < r < _N and 0 < s < _N):
            return False
        e, w = int.from_bytes(hashlib.sha256(data).digest(), "big"), pow(s, -1, _N)  # high-S is valid JOSE (Android/Java/OpenSSL emit it)
        point = _add(_mul(e * w % _N, _G), _mul(r * w % _N, (x, y)))
        return point is not None and point[0] % _N == r
    except (ValueError, KeyError, TypeError, AttributeError):
        return False


class Transport(Protocol):
    """Outbound-only link (agent dials MQTT/WebSocket, cloud or LAN). `poll` returns inbound messages already received."""
    def send(self, topic: str, payload: bytes) -> None: ...
    def poll(self) -> list: ...


class Channel:
    """Signed envelope `{"payload":…, "keyId":…, "signature":…}` where the signature covers JCS(payload). Inbound commands from an untrusted key
    or with a bad signature never reach the executor. Outbound messages are signed through the `signer` hook (key custody is the caller's:
    Keystore/HSM/secure element — no private key is handled here)."""
    def __init__(self, executor, transport, trusted_keys, signer: Callable[[bytes], str], key_id, topic_prefix="mekoniq/robot"):
        self.executor, self.transport, self.trusted, self.signer, self.key_id = executor, transport, trusted_keys, signer, key_id
        self.topic = f"{topic_prefix}/{executor.profile.robot_id}"

    def publish(self, topic_suffix, payload):
        envelope = {"payload": payload, "keyId": self.key_id, "signature": self.signer(rfc8785.dumps(payload))}
        self.transport.send(f"{self.topic}/{topic_suffix}", json.dumps(envelope).encode())

    def advertise_ready(self):
        """Only after startup recovery/reconcile: a not-ready executor is never announced as available."""
        if not self.executor.ready:
            raise RuntimeError("EXECUTOR_NOT_READY")
        p = self.executor.profile
        self.publish("ready", {"type": "executor_ready", "robotId": p.robot_id, "executorId": p.executor_id, "controlEpoch": self.executor.journal.control_epoch(p.robot_id)})

    def handle(self, raw):
        try:
            envelope = parse_strict(raw)
            jwk = self.trusted.get(envelope["keyId"])
            if jwk is None or not verify_es256(rfc8785.dumps(envelope["payload"]), envelope["signature"], jwk):
                return self._reply(None, "INVALID_SIGNATURE")
            command = envelope["payload"]
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            return self._reply(None, "INVALID_ENVELOPE")
        try:
            result = self.executor.submit(command)
        except Exception as e:
            result = {"accepted": False, "unknown": False, "reason": getattr(e, "code", "EXECUTOR_ERROR")}
        return self._reply(command.get("commandId") if isinstance(command, dict) else None, None, result)

    def _reply(self, command_id, reason, result=None):
        result = result or {"accepted": False, "unknown": False, "reason": reason}
        self.publish("result", {"type": "command_result", "commandId": command_id, **result})
        return result

    def pump(self):
        return [self.handle(raw) for raw in self.transport.poll()]
