"""mekoniq-irsim/1: envelope validation against the shared irsim-worker-v1 schema, typed errors and idempotency receipts. No engine import."""
import hashlib
import json
import math
from pathlib import Path

import jsonschema
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

PROTOCOL = "mekoniq-irsim/1"
MAX_LINE_BYTES = 2 * 1024 * 1024
RECEIPT_LIMIT = 256
OPS = ("describe", "create", "start", "step", "pause", "resume", "getState", "stop")


class WorkerError(Exception):
    """A typed refusal. `fatal` errors (protocol or internal) end the run: the session becomes failed and the process exits."""

    def __init__(self, code, detail, fatal=False):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail, self.fatal = code, str(detail)[:1000], fatal


def load_validators(schema_dir):
    registry = Registry()
    for file in sorted(Path(schema_dir).glob("*.schema.json")):
        schema = json.loads(file.read_text())
        resource = Resource.from_contents(schema, default_specification=DRAFT7)
        registry = registry.with_resource(file.name, resource)
        if "$id" in schema:
            registry = registry.with_resource(schema["$id"], resource)
    request = jsonschema.Draft7Validator({"$ref": "irsim-worker-v1.schema.json"}, registry=registry)
    response = jsonschema.Draft7Validator({"$ref": "irsim-worker-v1.schema.json#/definitions/IRSimResponseV1"}, registry=registry)
    return request, response


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def payload_hash(request):
    return hashlib.sha256(canonical({"op": request["op"], "expectedTick": request["expectedTick"], "payload": request["payload"]}).encode()).hexdigest()


def reject_non_finite(value, path="request"):
    if isinstance(value, float) and not math.isfinite(value):
        raise WorkerError("INVALID_REQUEST", f"{path} is not finite", fatal=True)
    if isinstance(value, dict):
        for k, v in value.items():
            reject_non_finite(v, f"{path}/{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            reject_non_finite(v, f"{path}/{i}")


def parse_line(raw, validator):
    """One NDJSON line -> a schema-valid request. Anything else is fatal: the worker never guesses at a malformed request."""
    if len(raw) > MAX_LINE_BYTES:
        raise WorkerError("REQUEST_TOO_LARGE", f"{len(raw)} bytes exceed {MAX_LINE_BYTES}", fatal=True)
    try:
        request = json.loads(raw, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
    except ValueError as e:
        raise WorkerError("INVALID_JSON", e, fatal=True)
    errors = sorted(validator.iter_errors(request), key=lambda e: list(e.absolute_path))
    if errors:
        raise WorkerError("INVALID_REQUEST", f"/{'/'.join(str(p) for p in errors[0].absolute_path)}: {errors[0].message}", fatal=True)
    reject_non_finite(request)
    return request


class Receipts:
    """Bounded request-id -> (payload hash, response) memory: an exact repeat gets the stored answer, a different payload under the same id is a conflict."""

    def __init__(self):
        self._items = {}

    def lookup(self, request):
        known = self._items.get(request["requestId"])
        if known is None:
            return None
        if known[0] != payload_hash(request):
            raise WorkerError("IDEMPOTENCY_CONFLICT", f"requestId {request['requestId']} was used with a different payload")
        return known[1]

    def store(self, request, response):
        self._items[request["requestId"]] = (payload_hash(request), response)
        while len(self._items) > RECEIPT_LIMIT:
            self._items.pop(next(iter(self._items)))
