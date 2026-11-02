"""Shared vectors (tests/fixtures/contracts/*), ES256, strict ingress and the signed outbound channel."""
import copy
import json
from pathlib import Path

import pytest
import rfc8785
from mekoniq_agent.executor import Executor
from mekoniq_agent.journal import ExecutorError
from mekoniq_agent.ownership import Profile
from mekoniq_agent.protocol import Channel, command_hash, parse_strict, validate_command, verify_es256
from .support.executor_fixtures import FakeNativeNavigation, command_fixture, profile_fixture

FIXTURES = Path(__file__).resolve().parents[3] / "tests/fixtures/contracts"
VECTORS = json.loads((FIXTURES / "robot-executor-vectors.json").read_text())
NOW = VECTORS["nowMs"]


def patched(base, patch):
    out = {**copy.deepcopy(base), **{k: v for k, v in patch.items() if k != "$delete"}}
    for key in patch.get("$delete", []):
        out.pop(key, None)
    return out


def vector_profile():
    p = VECTORS["profile"]
    return Profile(p["organizationId"], p["venueId"], p["robotId"], "agent-1", p["controlEpoch"], p["mapId"], p["mapRevision"], p["frame"])


def vector_executor(tmp_path, native=None):
    native = native or FakeNativeNavigation()
    return Executor(tmp_path / "v.db", native, vector_profile(), clock=lambda: NOW), native


def test_base_command_matches_schema_and_shared_hash():
    validate_command(VECTORS["baseCommand"])
    assert command_hash(VECTORS["baseCommand"]) == VECTORS["baseHash"]


@pytest.mark.parametrize("case", VECTORS["invalidCommands"], ids=lambda c: c["name"])
def test_invalid_commands_fail_the_shared_schema(case):
    with pytest.raises(ValueError, match="INVALID_COMMAND"):
        validate_command(patched(VECTORS["baseCommand"], case["patch"]))


@pytest.mark.parametrize("case", VECTORS["admission"], ids=lambda c: c["name"])
def test_admission_vectors(tmp_path, case):
    ex, native = vector_executor(tmp_path)
    for step in case["steps"]:
        command = patched(VECTORS["baseCommand"], step["command"])
        expect = step["expect"]
        if "throws" in expect:
            with pytest.raises(ExecutorError) as raised:
                ex.submit(command)
            assert raised.value.code == expect["throws"]
        else:
            result = ex.submit(command)
            assert {k: result.get(k) for k in expect} == expect
            if expect.get("reason"):
                assert not result["accepted"]
    accepted = {s["command"].get("commandId", "c-1") for s in case["steps"] if s["expect"].get("accepted")}
    assert native.start_count == len(accepted)  # one native goal per accepted command, none for refusals or duplicates


def test_es256_golden_vectors_from_typescript_verify():
    golden = json.loads((FIXTURES / "es256.json").read_text())
    assert len(golden) >= 5
    for g in golden:
        data = g["canonical"].encode()
        assert verify_es256(data, g["signature"], g["publicJwk"])
        assert not verify_es256(data + b" ", g["signature"], g["publicJwk"])
        assert not verify_es256(data, g["signature"][:-1] + ("A" if g["signature"][-1] != "A" else "B"), g["publicJwk"])
        assert not verify_es256(data, g["signature"], {**g["publicJwk"], "crv": "P-384"})
        assert not verify_es256(data, g["signature"], {**g["publicJwk"], "x": g["publicJwk"]["y"]})
    assert not verify_es256(b"{}", golden[0]["signature"][:-1], golden[0]["publicJwk"])


def test_signed_robot_command_vector_verifies_and_rejects_tampering():
    signed, base = VECTORS["signed"], VECTORS["baseCommand"]
    assert verify_es256(rfc8785.dumps(base), signed["signature"], signed["publicJwk"])
    for case in signed["tampered"]:
        assert not verify_es256(rfc8785.dumps(patched(base, case["patch"])), signed["signature"], signed["publicJwk"]), case["name"]


@pytest.mark.parametrize("raw", ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}', '{"a":NaN}', '{"a":Infinity}'])
def test_strict_ingress_rejects_duplicates_and_non_finite(raw):
    with pytest.raises(ValueError):
        parse_strict(raw)


class Loopback:
    def __init__(self):
        self.inbound, self.sent = [], []

    def send(self, topic, payload):
        self.sent.append((topic, json.loads(payload)))

    def poll(self):
        out, self.inbound = self.inbound, []
        return out


def channel(tmp_path):
    ex, native = vector_executor(tmp_path)
    link, signed = Loopback(), []
    def signer(data):
        signed.append(data)
        return "test-signature"  # key custody (Keystore/HSM) is behind this hook; no private key is handled in the agent
    keys = {VECTORS["signed"]["keyId"]: VECTORS["signed"]["publicJwk"]}
    return Channel(ex, link, keys, signer, "agent-key-1"), link, native, signed


def envelope(payload, key_id=None, signature=None):
    s = VECTORS["signed"]
    return json.dumps({"payload": payload, "keyId": key_id or s["keyId"], "signature": signature or s["signature"]}).encode()


def test_channel_executes_only_a_correctly_signed_command_and_signs_the_reply(tmp_path):
    ch, link, native, signed = channel(tmp_path)
    link.inbound = [envelope(VECTORS["baseCommand"])]
    [result] = ch.pump()
    assert result["accepted"] is True and native.start_count == 1
    topic, sent = link.sent[-1]
    assert topic == "mekoniq/robot/robot-1/result" and sent["keyId"] == "agent-key-1" and sent["signature"] == "test-signature"
    assert sent["payload"] == {"type": "command_result", "commandId": "c-1", **result} and signed[-1] == rfc8785.dumps(sent["payload"])


@pytest.mark.parametrize("make", [
    lambda: envelope(patched(VECTORS["baseCommand"], {"target": {**VECTORS["baseCommand"]["target"], "x": 99}})),  # payload altered after signing
    lambda: envelope(VECTORS["baseCommand"], key_id="unknown-key"),
    lambda: envelope(VECTORS["baseCommand"], signature="A" * 86),
    lambda: b'{"payload":{},"payload":{},"keyId":"vector-key-1","signature":"x"}',  # duplicate key
    lambda: b"not json",
    lambda: b'{"payload":{"commandId":"c-1"}}',
])
def test_channel_drops_unsigned_forged_or_malformed_input_before_the_executor(tmp_path, make):
    ch, link, native, _ = channel(tmp_path)
    link.inbound = [make()]
    [result] = ch.pump()
    assert result["accepted"] is False and result["reason"] in {"INVALID_SIGNATURE", "INVALID_ENVELOPE"}
    assert native.start_count == 0 and ch.executor.journal.open("robot-1") == []


def test_channel_advertises_only_when_ready(tmp_path):
    ch, link, native, _ = channel(tmp_path)
    ch.advertise_ready()
    assert link.sent[-1][1]["payload"] == {"type": "executor_ready", "robotId": "robot-1", "executorId": "agent-1", "controlEpoch": 1}
    ch.executor.ready = False  # e.g. recovery not finished
    with pytest.raises(RuntimeError, match="EXECUTOR_NOT_READY"):
        ch.advertise_ready()
