"""Controller port over the LinuxCNC Python interface (command/stat channels; one serialized error-channel collector retains events for the service). Units are the
profile's (inch/deg) on the controller and SI on the wire. Absent `linuxcnc`, the port is unavailable: the bridge refuses with a reason, it
never pretends. Only the operations the arbiter needs exist here: no MDI, no HAL, no file browsing."""
import math
import os
import subprocess
import time
import threading
from functools import wraps


class ControllerUnavailable(RuntimeError):
    pass


INCH, DEG = 0.0254, math.pi / 180


def _locked(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return call


class LinuxcncPort:
    def __init__(self, profile, program_root):
        try:
            import linuxcnc
        except ImportError as e:
            raise ControllerUnavailable(f"LINUXCNC_PYTHON_MODULE_MISSING:{e}") from e
        self.lc, self.c, self.s, self.e = linuxcnc, linuxcnc.command(), linuxcnc.stat(), linuxcnc.error_channel()
        self.profile, self.root, self._program, self._boot, self._boot_at = profile, program_root, None, None, 0.0
        self._lock, self._pending_errors = threading.RLock(), []
        self._execution_seen, self._failure = False, None
        self._sim_hal = None
        if profile["mode"] == "simulation" and profile.get("simulationScene"):
            # Fixed SIM-only component; https://linuxcnc.org/docs/stable/html/config/python-hal-interface.html
            try:
                import hal
            except ImportError as e:
                raise ControllerUnavailable("LINUXCNC_HAL_MODULE_MISSING") from e
            self._sim_hal = hal.component("mekoniq_sim_grip")
            self._sim_hal.newpin("object-present", hal.HAL_BIT, hal.HAL_OUT)
            self._sim_hal["object-present"] = False
            self._sim_hal.ready()
            hal.connect("mekoniq_sim_grip.object-present", "mekoniq-sim-object-present")
        self.current, self.done = None, {}                 # the job the controller is executing, and terminal results per job id

    def publish_virtual_grip(self, state):
        # Only the modeled input pin; no joint/drive command and no caller-selected pin.
        if self.profile["mode"] != "simulation" or self._sim_hal is None:
            raise ControllerUnavailable("SIM_GRIP_PIN_UNAVAILABLE")
        self._sim_hal["object-present"] = state["state"] == "held" and not state["reasonCodes"]

    def version(self):
        return f"linuxcnc {getattr(self.lc, 'version', 'unknown')}"

    def boot_id(self, force=False):
        """Start time of the running linuxcnc task process (Linux /proc), re-read at most once a second so a controller restart under a live
        bridge is seen; without /proc or a task process, a per-bridge value (a restart is then seen through the ESTOP transition)."""
        if force or self._boot is None or time.monotonic() - self._boot_at > 1.0:
            self._boot_at = time.monotonic()
            try:
                pid = subprocess.run(["pgrep", "-o", "-x", "milltask"], capture_output=True, text=True, check=True).stdout.split()[0]
                start = open(f"/proc/{pid}/stat").read().split(")")[-1].split()[19]
                self._boot = f"milltask-{pid}-{start}"
            except Exception:  # noqa: BLE001 - no /proc or no task: a per-port boot id, which still changes with the bridge
                if force:
                    return None  # unknown process identity cannot authorize recovered transfer proof
                self._boot = self._boot or f"bridge-{os.getpid()}-{int(time.monotonic() * 1000)}"
        return self._boot

    @_locked
    def recovery_identity(self):
        # Normal telemetry caches /proc for one second; a recovery proof within its
        # 500 ms freshness window must force an uncached controller-process check.
        return self.boot_id(force=True)

    @_locked
    def state(self):
        self.s.poll()
        lc = self.lc
        joints = [self.s.joint[i] for i in range(6)] if isinstance(self.s.joint, (list, tuple)) else []
        fault = next((f"JOINT_{i}_FAULT" for i, j in enumerate(joints) if j.get("fault")), None) if joints else None
        interp = "paused" if self.s.paused else "running" if self.s.interp_state in (lc.INTERP_READING, lc.INTERP_WAITING) else "idle" if self.s.interp_state == lc.INTERP_IDLE else "unknown"
        if self.current:
            if fault or self.s.task_state != lc.STATE_ON or getattr(self.s, "state", None) == lc.RCS_ERROR:
                self._failure = self._failure or fault or "CONTROLLER_ERROR_OR_DISABLED"
            if interp in ("running", "paused"):
                self._execution_seen = True
            # AUTO_RUN is asynchronous: idle before execution is no completion evidence.
            # Cancellation/errors remain failures even after the interpreter returns idle.
        return {"bootId": self.boot_id(), "taskState": {lc.STATE_ESTOP: "estop", lc.STATE_ESTOP_RESET: "off", lc.STATE_OFF: "off", lc.STATE_ON: "on"}.get(self.s.task_state, "off"),
                "interp": interp, "homed": all(self.s.homed[:6]) if self.s.homed else False, "fault": fault, "program": self._program,
                "jointsDeg": [j["input"] for j in joints] or None, "commandedDeg": [j["output"] for j in joints] or None, "velocityDegS": [j.get("velocity", 0.0) for j in joints] or None,
                "followingErrorDeg": [j.get("ferror_current", 0.0) for j in joints] or None, "gripperCloseOutput": bool(self.s.dout[0]) if self.profile["mode"] == "simulation" and getattr(self.s, "dout", None) else None, "tcpInch": list(self.s.actual_position[:3]) if self.s.actual_position else None, "mode": {lc.MODE_MANUAL: "manual", lc.MODE_AUTO: "auto", lc.MODE_MDI: "mdi"}.get(self.s.task_mode, "unknown")}

    @_locked
    def stage(self, program_id, path, sha256):
        self.c.mode(self.lc.MODE_AUTO)
        if self.c.wait_complete() != self.lc.RCS_DONE:
            raise ControllerUnavailable("AUTO_MODE_NOT_ACKNOWLEDGED")
        program_path = os.path.realpath(os.path.join(self.root, path))
        self._program = None
        self.c.program_open(program_path)
        if self.c.wait_complete() != self.lc.RCS_DONE:
            raise ControllerUnavailable("PROGRAM_OPEN_NOT_ACKNOWLEDGED")
        self.s.poll()
        if os.path.realpath(getattr(self.s, "file", "")) != program_path:
            raise ControllerUnavailable("PROGRAM_OPEN_NOT_OBSERVED")
        self._program = program_id

    @_locked
    def run(self, command_id):
        self._collect_errors()  # retain earlier events without assigning them to the next job
        self.c.mode(self.lc.MODE_AUTO)
        if self.c.wait_complete() != self.lc.RCS_DONE:
            raise ControllerUnavailable("AUTO_MODE_NOT_ACKNOWLEDGED")
        self.current, self._execution_seen, self._failure = command_id, False, None
        try:
            self.c.auto(self.lc.AUTO_RUN, 0)
        except Exception:
            self._failure = "START_SEND_INTERRUPTED"
            raise

    def pause(self, command_id): self.c.auto(self.lc.AUTO_PAUSE); self.c.wait_complete()
    def resume(self, command_id): self.c.auto(self.lc.AUTO_RESUME); self.c.wait_complete()
    @_locked
    def cancel(self, command_id):
        if self.current:
            self._failure = "ABORT_REQUESTED"
        self.c.abort(); self.c.wait_complete()
    def estop_reset(self): self.c.state(self.lc.STATE_ESTOP_RESET); self.c.wait_complete()
    def machine_on(self): self.c.state(self.lc.STATE_ON); self.c.wait_complete()

    def jog(self, joint, velocity_deg_s):
        self.c.mode(self.lc.MODE_MANUAL); self.c.wait_complete(); self.c.jog(self.lc.JOG_CONTINUOUS, 1, joint, velocity_deg_s)

    def jog_stop(self, joint):
        self.c.jog(self.lc.JOG_STOP, 1, joint)
        if self.c.wait_complete() != self.lc.RCS_DONE:
            raise ControllerUnavailable("JOG_STOP_NOT_ACKNOWLEDGED")
    def home_all(self): self.c.mode(self.lc.MODE_MANUAL); self.c.wait_complete(); self.c.home(-1)

    @_locked
    def outcome(self, command_id):
        """Per job id: running while it is the current job, its recorded terminal result afterwards, not_found when this port never ran it."""
        self._collect_errors()
        st = self.state()
        # Every terminal query (including RPC reconciliation) classifies native errors first.
        # The collector retains these events until the service fans them out exactly once.
        if self.current and st["interp"] == "idle" and (self._failure or self._execution_seen):
            self.done[self.current] = {"status": "failed" if self._failure else "completed", "reason": self._failure}
            self.current = None
        if command_id == self.current:
            return {"status": "running" if self._execution_seen else "accepted", "evidence": {"interp": st["interp"], "program": st["program"], "source": self.version()}}
        if command_id in self.done:
            return {"status": self.done[command_id]["status"], "evidence": {"reason": self.done[command_id]["reason"], "interp": st["interp"], "fault": st["fault"], "program": st["program"], "source": self.version()}}
        return {"status": "not_found", "evidence": {}}

    @_locked
    def poll_errors(self):
        self._collect_errors()
        out, self._pending_errors = self._pending_errors, []
        return out

    def _collect_errors(self):
        """The only native error-channel reader; callers hold _lock. Classification never discards events."""
        while True:
            m = self.e.poll()
            if not m:
                return
            kind, text = m
            if self.current and kind in (self.lc.NML_ERROR, self.lc.OPERATOR_ERROR):
                self._failure = "CONTROLLER_ERROR"
            self._pending_errors.append({"kind": {self.lc.NML_ERROR: "nml_error", self.lc.OPERATOR_ERROR: "operator_error", self.lc.OPERATOR_TEXT: "operator_text", self.lc.OPERATOR_DISPLAY: "operator_display"}.get(kind, "unknown"), "text": str(text)[:500]})

    @staticmethod
    def to_si(state):
        """deg -> rad, inch -> m for the wire; None stays None with a reason downstream."""
        rad = lambda v: None if v is None else [x * DEG for x in v]
        return {"commandedRad": rad(state.get("commandedDeg")), "actualRad": rad(state.get("jointsDeg")), "velocityRadS": rad(state.get("velocityDegS")), "followingErrorRad": rad(state.get("followingErrorDeg")),
                "tcpM": None if state.get("tcpInch") is None else [x * INCH for x in state["tcpInch"]]}
