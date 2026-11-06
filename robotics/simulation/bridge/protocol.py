"""Worker protocol between the Lab runtime (Node) and the simulation worker (Python): JSON lines over stdio, one request per line, an allowlist of
operations with typed arguments. Nothing on this channel names a topic, an executable, a file or a shell command; a robot is addressed by its
compiled namespace and a goal by its durable command id."""
import json
import math
import re
import uuid

GOAL_NAMESPACE = uuid.UUID("c1a4d3f0-5b2e-4d0c-9e7a-1f2b3c4d5e6f")  # fixed: a goal UUID derives from run/robot/command and survives a worker restart
ID = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
NAMESPACE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
DIGITS = re.compile(r"^[0-9]{1,20}$")
TARGET_FIELDS = {"waypointId": "id", "mapId": "id", "mapRevision": "str", "frame": "str", "x": "num", "y": "num", "yaw": "num?"}
OPS = {
    "capability": {},
    "execute": {"commandId": "id", "robotId": "ns", "target": "target", "expiresAt": "str", "speedLimitMps": "pos?"},
    "cancel": {"commandId": "id", "robotId": "ns"},
    "stop": {"robotId": "ns", "reason": "str"},
    "query": {"commandId": "id", "robotId": "ns"},
    "pause": {"paused": "bool"},
    "step": {"targetTimeNs": "digits"},
    "barrier": {"barrierId": "id", "participants": "nslist", "nonce":"id?", "bootId":"id?", "afterSeq":"digits?", "state":"str?"},
    "cup_pose": {"runId":"id", "worldRevision":"id", "fixtureId":"id", "xM":"worldnum", "yM":"worldnum", "zM":"worldnum"},
    "bind_transfer": {"runId":"id", "worldRevision":"id", "cupId":"id", "fixtureId":"id", "transferId":"id", "commandId":"id", "payloadHash":"sha", "controlEpoch":"epoch", "robotId":"ns", "slot":"slot"},
    "native_blocker": {"enabled":"bool"},
    "close": {},
}


class ProtocolError(ValueError):
    def __init__(self, code, detail=None):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code, self.detail = code, detail


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_strict(raw):
    """No duplicate keys, no NaN/Infinity (mirrors parseJsonStrict / mekoniq_agent.protocol.parse_strict)."""
    def pairs(items):
        keys = [k for k, _ in items]
        if len(keys) != len(set(keys)):
            raise ProtocolError("INVALID_JSON", "duplicate key")
        return dict(items)

    def bad(_):
        raise ProtocolError("INVALID_JSON", "non-finite number")
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=bad)
    except ProtocolError:
        raise
    except (ValueError, TypeError) as e:
        raise ProtocolError("INVALID_JSON", str(e)[:80]) from e


def _check(kind, value, where):
    optional = kind.endswith("?")
    kind = kind.rstrip("?")
    if value is None:
        if optional:
            return
        raise ProtocolError("ARGS_INVALID", where)
    ok = {"id": lambda v: isinstance(v, str) and bool(ID.match(v)), "ns": lambda v: isinstance(v, str) and bool(NAMESPACE.match(v)),
          "str": lambda v: isinstance(v, str) and 0 < len(v) <= 200, "num": _is_num, "pos": lambda v: _is_num(v) and v > 0,
          "bool": lambda v: isinstance(v, bool), "digits": lambda v: isinstance(v, str) and bool(DIGITS.match(v)),
          "nslist": lambda v: isinstance(v, list) and 0 < len(v) <= 8 and all(isinstance(x, str) and NAMESPACE.match(x) for x in v),
          "worldnum":lambda v:_is_num(v) and abs(v)<=100, "sha": lambda v: isinstance(v,str) and bool(re.fullmatch(r"[0-9a-f]{64}",v)), "epoch":lambda v:type(v) is int and 1<=v<=9007199254740991, "slot":lambda v:type(v) is int and 1<=v<=100,
          "target": lambda v: isinstance(v, dict)}[kind]
    if not ok(value):
        raise ProtocolError("ARGS_INVALID", where)
    if kind == "target":
        validate_fields(value, TARGET_FIELDS, where)


def validate_fields(args, schema, where):
    if not isinstance(args, dict):
        raise ProtocolError("ARGS_INVALID", where)
    unknown = sorted(set(args) - set(schema))
    if unknown:
        raise ProtocolError("ARGS_UNKNOWN_FIELD", f"{where}.{unknown[0]}")
    for key, kind in schema.items():
        _check(kind, args.get(key), f"{where}.{key}")


def validate_args(op, args):
    if op not in OPS:
        raise ProtocolError("OP_NOT_ALLOWED", op)
    validate_fields(args, OPS[op], op)
    return args


def request_id_of(request):
    """Best-effort id of a parsed request, so an error reply can still be matched by the caller."""
    return request["id"] if isinstance(request, dict) and isinstance(request.get("id"), str) else None


def check_request(request):
    """-> (request id, op, args). Shape {id, op, args} exactly; op in the allowlist; args per op."""
    if not isinstance(request, dict) or set(request) != {"id", "op", "args"} or not isinstance(request["id"], str) or not isinstance(request["op"], str):
        raise ProtocolError("REQUEST_SHAPE")
    validate_args(request["op"], request["args"])
    return request["id"], request["op"], request["args"]


def parse_request(line):
    return check_request(parse_strict(line))


def _line(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"


def response(request_id, result):
    return _line({"id": request_id, "ok": True, "result": result})


def error(request_id, code, detail=None):
    return _line({"id": request_id, "ok": False, "error": {"code": code, "detail": detail}})


def event(kind, payload):
    return _line({"event": kind, "payload": payload})


# Executor/Nav2 port statuses -> the SIL command states the Lab adapter understands (contract.ts NativeExecutionState).
NATIVE_TO_STATE = {"accepted": "executing", "executing": "executing", "canceling": "executing", "succeeded": "completed", "canceled": "cancelled",
                   "aborted": "failed", "unknown": "unknown", "not_found": "unknown"}


def terminal_state(native_status):
    return NATIVE_TO_STATE.get(native_status, "unknown")
