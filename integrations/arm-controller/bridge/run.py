"""Entry point of the bridge service on the IPC: `python3 bridge/run.py --profile P --journal J [--socket S]`. The LinuxCNC port is opened
first; if the controller is unavailable the process exits 2 with a reason (systemd restarts it; nothing pretends to be a controller)."""
import argparse
import json
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bridge.arbiter import Arbiter
from bridge.journal import Journal
from bridge.linuxcnc_port import ControllerUnavailable, LinuxcncPort
from bridge.service import BridgeService


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--profile", required=True); a.add_argument("--journal", required=True); a.add_argument("--socket"); a.add_argument("--local-socket")
    a.add_argument("--lab-group"); a.add_argument("--local-group")
    o = a.parse_args()
    if bool(o.lab_group) != bool(o.local_group):
        a.error("--lab-group and --local-group must be provisioned together")
    profile = json.loads(Path(o.profile).read_text())
    try:
        ctl = LinuxcncPort(profile, str(Path(o.profile).resolve().parents[3]))
    except ControllerUnavailable as e:
        print(f"CONTROLLER_UNAVAILABLE: {e}", file=sys.stderr); sys.exit(2)
    arb = Arbiter(profile, Journal(o.journal), ctl, now_ms=lambda: int(__import__("time").time() * 1000))
    boot = arb.start()
    svc = BridgeService(profile, arb, ctl, socket_path=o.socket, local_socket_path=o.local_socket,
                        socket_groups={"lab": o.lab_group, "local": o.local_group} if o.lab_group else None)
    svc.start()
    print(json.dumps({"started": True, **boot}), flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        svc.stop()


if __name__ == "__main__":
    main()
