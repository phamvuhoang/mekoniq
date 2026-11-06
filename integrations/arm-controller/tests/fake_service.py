"""Test-only: the real BridgeService + Arbiter over the FakeController on a given socket, for the TS adapter's cross-runtime test.
`python3 tests/fake_service.py --socket PATH --journal PATH` prints `ready` and serves until SIGTERM. Never installed."""
import argparse
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from support import ROOT  # noqa: E402
from fake_controller import FakeController  # noqa: E402
from bridge.arbiter import Arbiter  # noqa: E402
from bridge.journal import Journal  # noqa: E402
from bridge.service import BridgeService  # noqa: E402

a = argparse.ArgumentParser(); a.add_argument("--socket", required=True); a.add_argument("--journal", required=True)
o = a.parse_args()
profile = json.loads((ROOT / "configs" / "sim" / "puma560" / "profile.json").read_text())
ctl = FakeController(boot_id="fake-ctl-1")
arb = Arbiter(profile, Journal(o.journal), ctl, now_ms=lambda: int(time.time() * 1000)); arb.start()
svc = BridgeService(profile, arb, ctl, socket_path=o.socket, status_hz=10)
svc.start()
print("ready", flush=True)
try:
    threading.Event().wait()
except KeyboardInterrupt:
    pass
finally:
    svc.stop()
