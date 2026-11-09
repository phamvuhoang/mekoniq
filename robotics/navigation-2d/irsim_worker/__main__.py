"""python -m irsim_worker --run-id ID --bundle-root DIR --schema-dir DIR --lock-digest HEX [--scene-digest HEX]
NDJSON: one request per stdin line, one response per stdout line; every log goes to stderr. Fatal protocol or engine faults answer once and exit non-zero."""
import argparse
import contextlib
import json
import sys

from .protocol import MAX_LINE_BYTES, WorkerError, load_validators, parse_line
from .session import WorkerSession


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--bundle-root", required=True)
    ap.add_argument("--schema-dir", required=True)
    ap.add_argument("--lock-digest", required=True)
    ap.add_argument("--scene-digest")
    ap.add_argument("--fixture-sha256")  # the run's scenario-fixture.json (scripted actors), bound by the parent like the scene digest
    args = ap.parse_args(argv)
    out = sys.stdout
    validator, _ = load_validators(args.schema_dir)
    session = WorkerSession(run_id=args.run_id, bundle_root=args.bundle_root, lock_digest=args.lock_digest, expected_scene_digest=args.scene_digest, expected_fixture_sha256=args.fixture_sha256)

    def send(response):
        out.write(json.dumps(response, separators=(",", ":"), allow_nan=False) + "\n")
        out.flush()

    code = 0
    with contextlib.redirect_stdout(sys.stderr):  # an engine or library print must never corrupt the response stream
        while True:
            raw = sys.stdin.buffer.readline(MAX_LINE_BYTES + 2)
            if not raw:
                break
            try:
                request = parse_line(raw, validator)
            except WorkerError as e:
                send({"protocol": "mekoniq-irsim/1", "requestId": "invalid", "runId": args.run_id, "bootId": session.boot_id, "tick": session.tick, "ok": False, "error": {"code": e.code, "detail": e.detail}})
                session._fail()
                code = 1
                break
            response = session.handle(request)
            send(response)
            if session.state == "failed":
                code = 1
                break
    session._end_env()
    return code


if __name__ == "__main__":
    sys.exit(main())
