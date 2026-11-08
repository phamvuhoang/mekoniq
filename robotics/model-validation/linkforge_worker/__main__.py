"""python -m linkforge_worker: one JSON request on stdin, one JSON response line on stdout, everything else on stderr."""
import contextlib
import json
import sys


def main():
    raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        sys.stdout.write(json.dumps({"error": {"code": "REQUEST_TOO_LARGE", "detail": "request exceeds 8 MiB"}}) + "\n")
        return 1
    real_stdout = sys.stdout
    try:
        from .adapter import validate_request
        request = json.loads(raw)
        if request.get("protocol") != "mekoniq-linkforge/1":
            raise ValueError("unsupported protocol")
        with contextlib.redirect_stdout(sys.stderr):  # a stray print from a dependency must never corrupt the response line
            response = validate_request(request)
    except Exception as e:  # reported as a worker failure; the caller never gets a pass from a crash
        real_stdout.write(json.dumps({"error": {"code": "WORKER_EXCEPTION", "detail": f"{type(e).__name__}: {e}"[:1000]}}) + "\n")
        return 1
    real_stdout.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
