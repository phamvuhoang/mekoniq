"""Terminal smoke for the LinuxCNC simulation profile, run by LinuxCNC as the [DISPLAY] program of a temporary INI copy (scripts/smoke-sim.sh).
`run_sequence` is controller-agnostic: start/home/run/pause/resume/stop, then a controller fault and the proof that nothing resumes by itself.
Every step records requested vs observed state; a missing state fails the record. The real controller wrapper needs the `linuxcnc` module."""
import json
import math
import hashlib
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
        observed, error = {}, None
        try:
            act()
            def matches():
                nonlocal observed
                state = ctl.state()
                observed = {k: state.get(k) for k in expect}
                return all(observed[k] == v for k, v in expect.items())
            ok = bool(wait(matches, STEP_TIMEOUT_S))
        except Exception as exc:  # retain prior steps and the failing action, no retries
            ok, error = False, str(exc)
        steps.append({"step": name, "requested": expect, "observed": observed, "ok": ok, **({"error": error} if error else {})})
        log(f"{'ok' if ok else 'FAIL'} {name}: {observed} {error or ''}")
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


def sample_actual_joints(stat, epoch, sequence, clock=time.monotonic_ns):
    """One non-atomic status poll. Neither cycle_time nor echo_serial is a clock.
    Actual and desired joint arrays are independent fields, not Cartesian XYZABC.
    Missing samples remain null; a receive bracket is not controller synchrony.
    """
    before = clock()
    stat.poll()
    def side(attribute, name):
        raw = getattr(stat, attribute, None)
        if not isinstance(raw, (list, tuple)) or len(raw) < 6:
            return None
        values = list(raw[:6])
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in values):
            return None
        return {"sampleId": f"{epoch}:{sequence}:{name}", "rawDeg": values, "rad": [v * math.pi / 180 for v in values]}
    actual, commanded = side("joint_actual_position", "actual"), side("joint_position", "commanded")
    after = clock()
    return {"sequence": sequence, "epoch": epoch, "receiveMonotonicNs": [str(before), str(after)],
            "controllerTime": None, "synchrony": "unavailable", "actual": actual, "commanded": commanded}


def controller_epoch():
    """Refuse ambiguous/missing native process identity, never substitute a poll counter."""
    pids = subprocess.run(["pgrep", "-x", "milltask"], capture_output=True, text=True, timeout=5, check=True).stdout.split()
    if len(pids) != 1:
        raise RuntimeError("CONTROLLER_PROCESS_AMBIGUOUS")
    pid = pids[0]
    start = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    return f"{boot}:milltask:{pid}:{start}"


def trace_record(ctl):
    root = Path(__file__).resolve().parents[1]
    digest = lambda path: hashlib.sha256((root / path).read_bytes()).hexdigest()
    base = "models/puma560-reference/"
    return {"schemaVersion": 1, "kind": "linuxcnc_actual_joint_trace", "backend": "linuxcnc_sim", "provenance": "controller_sim",
            "evidenceKind": "native_capture", "sourceCommit": os.environ.get("MEKONIQ_SOURCE_COMMIT"),
            "controller": {"version": ctl.version(), "identityMethod": "linux-proc-boot-id-pid-starttime"},
            "model": {"id": "puma560-reference", "manifestSha256": digest(base+"manifest.json"), "dhSha256": digest(base+"modified-dh.json"),
                      "framesSha256": digest(base+"frames.json"), "profileSha256": digest("configs/sim/puma560/profile.json"),
                      "baseFrame": "arm_base", "tcpFrame": "tcp", "toolRevision": "tool-0-notool"},
            "units": {"rawJoint": "deg", "joint": "rad", "receiveTime": "ns"}, "clock": {"receive": "host_monotonic", "controller": "unavailable"},
            "samples": ctl.samples, "limitations": ["CONTROLLER_SAMPLE_TIME_UNAVAILABLE", "FIELD_SYNCHRONY_UNAVAILABLE", "SIM_LOOPBACK_NOT_PHYSICAL_FEEDBACK"],
            "accepted": False}


class LinuxcncController:
    """Thin port over the LinuxCNC Python interface (command/stat channels) plus halcmd for the fault fixture signal."""
    def __init__(self):
        import linuxcnc  # noqa: F401  (only on the Linux host)
        self.lc, self.c, self.s = linuxcnc, linuxcnc.command(), linuxcnc.stat()
        self.samples, self.epoch = [], controller_epoch()

    def version(self):
        return f"linuxcnc {getattr(self.lc, 'version', 'unknown')}"

    def state(self):
        epoch = controller_epoch()
        if epoch != self.epoch:
            raise RuntimeError("CONTROLLER_EPOCH_CHANGED_NO_AUTO_RESUME")
        sample = sample_actual_joints(self.s, epoch, len(self.samples))
        if controller_epoch() != epoch:
            raise RuntimeError("CONTROLLER_EPOCH_CHANGED_DURING_POLL")
        self.samples.append(sample)
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
        reason = f"LINUXCNC_PYTHON_MODULE_MISSING:{e}" if isinstance(e, ImportError) else f"CONTROLLER_INITIALIZATION_FAILED:{e}"
        rec = {"status": "blocked_external", "result": "not_run", "reasons": [reason]}
    else:
        try:
            rec = run_sequence(ctl, program, lambda m: print(m, flush=True), _poll)
        except Exception as e:  # preserve partial independent observations on controller loss
            rec = {"status": "fail", "reasons": [str(e)], "claims": "interrupted; no automatic resume"}
        if out:
            with open(os.path.join(out, "actual-joint-trace.json"), "x") as stream:
                json.dump(trace_record(ctl), stream, indent=1, allow_nan=False)
    if out:
        with open(os.path.join(out, "smoke-driver.json"), "x") as f:
            json.dump(rec, f, indent=1)
    sys.exit(0 if rec.get("status") == "pass" else 2 if rec.get("status") == "blocked_external" else 1)


if __name__ == "__main__":
    main()
