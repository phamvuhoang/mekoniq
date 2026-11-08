"""Test double: the real worker, but the process dies right after applying a step and before acknowledging it."""
import os

from irsim_worker import __main__ as worker
from irsim_worker import session

original = session.WorkerSession.handle


def handle(self, request):
    response = original(self, request)
    if request["op"] == "step":
        os._exit(9)  # applied, never acknowledged
    return response


session.WorkerSession.handle = handle
raise SystemExit(worker.main())
