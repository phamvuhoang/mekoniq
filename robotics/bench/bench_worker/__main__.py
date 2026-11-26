"""bench_worker --role bus|sensors --kit FILE --bus sim|soem --session-id ID [--read-only]

Launch recipe (copy it as is): `-I` drops the working directory from sys.path (safe-path mode, Python >= 3.11), so `python -I -m bench_worker` cannot find the
package; pass the package root (the directory that holds `bench_worker/`, i.e. robotics/bench) as an argument to a fixed bootstrap:

    <python> -I -B -c "import runpy, sys; sys.path.insert(0, sys.argv.pop(1)); runpy.run_module('bench_worker', run_name='__main__', alter_sys=True)" \
        <abs path>/robotics/bench --role bus --kit <abs path to kit.json> --bus sim --session-id <id> [--read-only]

Role `bus` answers every op but imuConfigure; role `sensors` (K06) answers describe, open, step, imuConfigure, stop and never imports bus*. A malformed line, a request of another session or
an internal error answers once, stops the drives and exits 1; stdin closing is a stop. The last stderr line is {"event":"stopped","controlwords":[...]} (the sensors role: {"event":"stopped"})."""
import argparse
import json
import os
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
        sys.stderr.write(json.dumps({"event": "stopped"} | ({"controlwords": stopped["controlwords"]} if "controlwords" in stopped else {})) + "\n")
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
    if args.bus == "soem":
        print("bench_worker: soem bus is added in K08", file=sys.stderr)
        return 2
    with open(args.kit, encoding="utf-8") as f:
        kit = json.load(f)
    if kit["bus"]["backend"] != args.bus:
        print(f"bench_worker: the kit's bus backend is {kit['bus']['backend']!r}, not {args.bus!r}", file=sys.stderr)
        return 2
    if args.role == "sensors":
        from .sensor_session import SensorSession
        return serve(SensorSession(kit, os.path.dirname(os.path.abspath(args.kit)), read_only=args.read_only), args.session_id)
    from .bus_sim import SimBus
    from .session import BenchSession
    return serve(BenchSession(kit, SimBus(kit), read_only=args.read_only), args.session_id)


if __name__ == "__main__":
    sys.exit(main())
