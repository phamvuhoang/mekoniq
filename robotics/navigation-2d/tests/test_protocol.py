import json

import pytest

from irsim_worker.protocol import MAX_LINE_BYTES, Receipts, WorkerError, load_validators, parse_line, payload_hash


@pytest.fixture(scope="module")
def validators():
    from irsim_testkit import SCHEMAS
    return load_validators(SCHEMAS)


def req(op="getState", payload=None, **over):
    return {"protocol": "mekoniq-irsim/1", "requestId": "r1", "runId": "run", "expectedTick": 0, "op": op, "payload": payload if payload is not None else {}, **over}


def line(value):
    return (json.dumps(value) + "\n").encode()


def test_valid_requests_of_every_op_pass(validators):
    request, _ = validators
    samples = [req("describe"), req("create", {"sceneRef": "navigation-scene.json", "seed": 7}), req("start"), req("pause"), req("resume"), req("getState"), req("stop", {"reason": "done"}),
               req("step", {"targetTick": 1, "velocities": [{"robotId": "amr-1", "vMps": 0.1, "omegaRadps": 0.0}], "actorUpdates": []}),
               req("step", {"targetTick": 1, "velocities": [], "actorUpdates": [], "singleStep": True})]
    for s in samples:
        assert parse_line(line(s), request) == s


@pytest.mark.parametrize("bad", [
    req(op="shell"), req(protocol="mekoniq-irsim/2"), req(extra="x"), req("create", {"sceneRef": "a", "seed": -1}), req("create", {"sceneRef": "a", "seed": 1.5}),
    req("step", {"targetTick": 0, "velocities": [], "actorUpdates": []}), req("step", {"targetTick": 1, "velocities": []}), req("start", {"x": 1}), req(expectedTick=-1),
], ids=["unknown-op", "protocol", "extra-field", "negative-seed", "float-seed", "tick-zero", "missing-actor-updates", "payload-on-start", "negative-tick"])
def test_schema_violations_are_fatal_not_repaired(validators, bad):
    with pytest.raises(WorkerError) as e:
        parse_line(line(bad), validators[0])
    assert e.value.fatal and e.value.code == "INVALID_REQUEST"


def test_oversize_garbage_and_non_finite_json_fail_closed(validators):
    request, _ = validators
    with pytest.raises(WorkerError) as e:
        parse_line(b"x" * (MAX_LINE_BYTES + 1), request)
    assert (e.value.code, e.value.fatal) == ("REQUEST_TOO_LARGE", True)
    for raw in (b"{not json}\n", b'{"a": NaN}\n', b'{"a": Infinity}\n'):
        with pytest.raises(WorkerError) as e:
            parse_line(raw, request)
        assert e.value.code == "INVALID_JSON"


def test_receipts_return_the_stored_answer_and_reject_a_changed_payload():
    r = Receipts()
    a = req("pause")
    assert r.lookup(a) is None
    r.store(a, {"answer": 1})
    assert r.lookup(req("pause")) == {"answer": 1}
    with pytest.raises(WorkerError) as e:
        r.lookup(req("resume"))  # same requestId, different op
    assert e.value.code == "IDEMPOTENCY_CONFLICT" and not e.value.fatal
    assert payload_hash(a) == payload_hash(req("pause"))


def test_receipt_memory_is_bounded():
    r = Receipts()
    for i in range(400):
        r.store(req(requestId=f"id{i}"), {"i": i})
    assert r.lookup(req(requestId="id0")) is None and r.lookup(req(requestId="id399")) == {"i": 399}
