"""python -I -B -m bench_worker --role bus|sensors --kit FILE --bus sim|soem --session-id ID [--read-only]

Role `bus` answers every op but imuConfigure; role `sensors` (K06) gets its own branch below and never imports bus*. A malformed line, a request of another session or
an internal error answers once, stops the drives and exits 1; stdin closing is a stop. The last stderr line is {"event":"stopped","controlwords":[...]}."""
import argparse
import json
import sys

from . import BenchError
from .wire import MAX_LINE_BYTES, parse_request, response


def serve(session, session_id):
    out, code, stopped = sys.stdout, 0, None
    try:
        while True:
            raw = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
            if not raw:
                break
            result = None
            try:
                req = parse_request(raw, session_id)
            except BenchError as e:
                out.write(response("invalid", session.tick, error=e) + "\n")
                out.flush()
                code = 1
                break
            try:
                result = session.handle(req["op"], req["payload"], req["expectedTick"])
                line = response(req["requestId"], session.tick, result)
            except BenchError as e:
                line = response(req["requestId"], session.tick, error=e)
            except Exception as e:  # noqa: BLE001  an internal fault: answer, stop the drives, exit
                line, code = response(req["requestId"], session.tick, error=BenchError("WORKER_LOST", f"{type(e).__name__}: {e}")), 1
            out.write(line + "\n")
            out.flush()
            if code or req["op"] == "stop":
                stopped = result if req["op"] == "stop" and not code else None
                break
    finally:
        if stopped is None:
            stopped = session.handle("stop", {}, session.tick)
        sys.stderr.write(json.dumps({"event": "stopped", "controlwords": stopped["controlwords"]}) + "\n")
        sys.stderr.flush()
    return code


def main(argv=None):
    ap = argparse.ArgumentParser(prog="bench_worker")
    ap.add_argument("--role", required=True, choices=["bus", "sensors"])
    ap.add_argument("--kit", required=True)
    ap.add_argument("--bus", required=True, choices=["sim", "soem"])
    ap.add_argument("--session-id", required=True)
    ap.add_argument("--read-only", action="store_true")
    args = ap.parse_args(argv)
    if args.role == "sensors":
        print("bench_worker: the sensors role is added in K06", file=sys.stderr)
        return 2
    if args.bus == "soem":
        print("bench_worker: soem bus is added in K08", file=sys.stderr)
        return 2
    with open(args.kit, encoding="utf-8") as f:
        kit = json.load(f)
    if kit["bus"]["backend"] != args.bus:
        print(f"bench_worker: the kit's bus backend is {kit['bus']['backend']!r}, not {args.bus!r}", file=sys.stderr)
        return 2
    from .bus_sim import SimBus
    from .session import BenchSession
    return serve(BenchSession(kit, SimBus(kit), read_only=args.read_only), args.session_id)


if __name__ == "__main__":
    sys.exit(main())
