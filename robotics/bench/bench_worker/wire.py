"""The stdio line protocol (contracts §3, bench-wire-v1): one JSON request per stdin line, one JSON response per stdout line. Structural checks only (stdlib);
the TS side validates both directions with Ajv."""
import json

from . import BenchError

PROTOCOL = "mekoniq-bench/1"
OPS = ("describe", "open", "scan", "configure", "start", "step", "silence", "imuConfigure", "stop")
MAX_LINE_BYTES = 1 << 20


def parse_request(raw: bytes, session_id: str) -> dict:
    try:
        r = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        raise BenchError("BENCH_ORDER_VIOLATION", f"malformed request line: {e}")
    if not (isinstance(r, dict) and set(r) == {"protocol", "requestId", "sessionId", "expectedTick", "op", "payload"} and r["protocol"] == PROTOCOL
            and isinstance(r["requestId"], str) and 0 < len(r["requestId"]) <= 200 and isinstance(r["sessionId"], str)
            and isinstance(r["expectedTick"], int) and not isinstance(r["expectedTick"], bool) and r["expectedTick"] >= 0 and r["op"] in OPS and isinstance(r["payload"], dict)):
        raise BenchError("BENCH_ORDER_VIOLATION", "the request does not match BenchRequest")
    if r["sessionId"] != session_id:
        raise BenchError("BENCH_ORDER_VIOLATION", f"request for session {r['sessionId']!r}, this worker serves {session_id!r}")
    return r


def response(request_id, tick, result=None, error=None) -> str:
    out = {"requestId": request_id, "ok": error is None, "tick": tick}
    if error is None:
        out["result"] = result
    else:
        out["error"] = {"code": error.code, "detail": error.detail}
    return json.dumps(out, separators=(",", ":"), allow_nan=False)
