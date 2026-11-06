"""Terminal smoke for the LinuxCNC simulation profile, run by LinuxCNC as the [DISPLAY] program of a temporary INI copy (scripts/smoke-sim.sh).
`run_sequence` is controller-agnostic: start/home/run/pause/resume/stop, then a controller fault and the proof that nothing resumes by itself.
Every step records requested vs observed state; a missing state fails the record. The real controller wrapper needs the `linuxcnc` module."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

STEP_TIMEOUT_S = 30.0


def run_sequence(ctl, program, log, wait):
    """ctl: controller port (estop_reset, machine_on, home_all, program_open, auto_run, auto_pause, auto_resume, abort, inject_fault, clear_fault, state, version).
    wait(pred, timeout) polls pred until true or timeout and returns the last value. Returns the evidence record."""
    steps = []

    def step(name, act, expect):
        act()
        ok = bool(wait(lambda: all(ctl.state().get(k) == v for k, v in expect.items()), STEP_TIMEOUT_S))
        observed = {k: ctl.state().get(k) for k in expect}
        steps.append({"step": name, "requested": expect, "observed": observed, "ok": ok})
        log(f"{'ok' if ok else 'FAIL'} {name}: {observed}")
        return ok
    sequence = [
        ("estop_reset", ctl.estop_reset, {"estop": False}), ("machine_on", ctl.machine_on, {"machineOn": True}), ("home_all", ctl.home_all, {"homed": True}),
        ("program_open", lambda: ctl.program_open(program), {"program": program}), ("auto_run", ctl.auto_run, {"running": True}),
        ("auto_pause", ctl.auto_pause, {"paused": True}), ("auto_resume", ctl.auto_resume, {"paused": False}), ("abort", ctl.abort, {"running": False}),
        ("inject_fault", ctl.inject_fault, {"fault": True}), ("observe_fault", lambda: None, {"machineOn": False, "running": False}),
        ("clear_fault", ctl.clear_fault, {"fault": False}), ("observe_no_auto_resume", lambda: None, {"running": False, "paused": False, "machineOn": False}),
    ]
    status = "pass"
    for name, act, expect in sequence:
        if not step(name, act, expect):
            status = "fail"
            break
    return {"backend": "linuxcnc_sim", "provenance": "controller_sim", "controller": ctl.version(), "program": program, "status": status, "steps": steps,
            "claims": "software controller sequence on a virtual HAL; no drive, timing, load or safety evidence"}


class LinuxcncController:
    """Thin port over the LinuxCNC Python interface (command/stat channels) plus halcmd for the fault fixture signal."""
    def __init__(self):
        import linuxcnc  # noqa: F401  (only on the Linux host)
        self.lc, self.c, self.s = linuxcnc, linuxcnc.command(), linuxcnc.stat()

    def version(self):
        return f"linuxcnc {getattr(self.lc, 'version', 'unknown')}"

    def state(self):
        self.s.poll()
        lc = self.lc
        fault = any(j.get("fault", False) for j in self.s.joint if isinstance(j, dict)) if isinstance(getattr(self.s, "joint", None), (list, tuple)) else False
        return {"estop": self.s.task_state == lc.STATE_ESTOP, "machineOn": self.s.task_state == lc.STATE_ON, "homed": all(self.s.homed[:6]) if self.s.homed else False,
                "program": self.s.file or None, "running": self.s.interp_state in (lc.INTERP_READING, lc.INTERP_WAITING) and not self.s.paused, "paused": bool(self.s.paused), "fault": fault}

    def estop_reset(self): self.c.state(self.lc.STATE_ESTOP_RESET); self.c.wait_complete()
    def machine_on(self): self.c.state(self.lc.STATE_ON); self.c.wait_complete()
    def home_all(self): self.c.mode(self.lc.MODE_MANUAL); self.c.wait_complete(); self.c.home(-1)
    def program_open(self, path): self.c.mode(self.lc.MODE_AUTO); self.c.wait_complete(); self.c.program_open(path)
    def auto_run(self): self.c.auto(self.lc.AUTO_RUN, 0)
    def auto_pause(self): self.c.auto(self.lc.AUTO_PAUSE)
    def auto_resume(self): self.c.auto(self.lc.AUTO_RESUME)
    def abort(self): self.c.abort(); self.c.wait_complete()
    def inject_fault(self): subprocess.run(["halcmd", "sets", "mekoniq-fault-inject", "true"], check=True)
    def clear_fault(self): subprocess.run(["halcmd", "sets", "mekoniq-fault-inject", "false"], check=True)


def _poll(pred, timeout):
    end = time.monotonic() + timeout
    while True:
        v = pred()
        if v or time.monotonic() >= end:
            return v
        time.sleep(0.1)


def main():
    out = os.environ.get("MEKONIQ_SMOKE_EVIDENCE")
    program = str(Path(os.environ.get("MEKONIQ_SMOKE_PROGRAM", Path(__file__).resolve().parents[1] / "programs/demo-six-axis.ngc")).resolve())
    try:
        ctl = LinuxcncController()
    except Exception as e:  # noqa: BLE001 - the record says why, the wrapper exits 2
        rec = {"status": "blocked_external", "result": "not_run", "reasons": [f"LINUXCNC_PYTHON_MODULE_MISSING:{type(e).__name__}"]}
    else:
        rec = run_sequence(ctl, program, lambda m: print(m, flush=True), _poll)
    if out:
        with open(os.path.join(out, "smoke-driver.json"), "w") as f:
            json.dump(rec, f, indent=1)
    sys.exit(0 if rec.get("status") == "pass" else 2 if rec.get("status") == "blocked_external" else 1)


if __name__ == "__main__":
    main()
