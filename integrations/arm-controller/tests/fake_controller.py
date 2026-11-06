"""Fake LinuxCNC controller port for bridge tests: a scripted state machine with the same shape as bridge/linuxcnc_port.LinuxcncPort.
It proves the bridge (arbitration, journal, protocol), never the command mapping — that is the Linux integration of A02."""


class FakeController:
    def __init__(self, boot_id="ctl-boot-1"):
        self.boot_id, self.task, self.interp, self.homed, self.fault, self.program, self.calls, self.outcomes = boot_id, "on", "idle", True, None, None, [], {}
        self.raise_on = set()             # port method names that raise TimeoutError (reply lost after the effect)
        self.errors = []                  # error channel messages, drained by the single consumer

    def version(self): return "fake-linuxcnc"
    def state(self): return {"bootId": self.boot_id, "taskState": self.task, "interp": self.interp, "homed": self.homed, "fault": self.fault, "program": self.program,
                             "jointsDeg": [0, 0, 0, 0, 0.1, 0], "commandedDeg": [0, 0, 0, 0, 0.1, 0], "tcpInch": [17.0, 5.5, 7.2]}

    def _act(self, name, effect):
        self.calls.append(name); effect()
        if name in self.raise_on:
            self.raise_on.discard(name); raise TimeoutError("REPLY_LOST")

    def stage(self, program_id, path, sha256): self._act("stage", lambda: setattr(self, "program", program_id))
    def run(self, command_id): self._act("run", lambda: (setattr(self, "interp", "running"), self.outcomes.__setitem__(command_id, "running")))
    def pause(self, command_id): self._act("pause", lambda: setattr(self, "interp", "paused"))
    def resume(self, command_id): self._act("resume", lambda: setattr(self, "interp", "running"))
    def cancel(self, command_id): self._act("cancel", lambda: setattr(self, "interp", "idle"))
    def estop_reset(self): self._act("estop_reset", lambda: setattr(self, "task", "off"))
    def machine_on(self): self._act("machine_on", lambda: setattr(self, "task", "on"))
    def jog(self, joint, velocity): self.calls.append(("jog", joint, velocity))
    def jog_stop(self, joint): self.calls.append(("jog_stop", joint))
    def home_all(self): self._act("home_all", lambda: setattr(self, "homed", True))
    def finish(self, command_id, result="completed"): self.interp, self.outcomes[command_id] = "idle", result
    def outcome(self, command_id): return {"status": self.outcomes.get(command_id, "not_found"), "evidence": {"interp": self.interp, "program": self.program, "source": "fake-linuxcnc"}}
    def poll_errors(self): e, self.errors = self.errors, []; return e
    def reboot(self, boot_id): self.boot_id, self.task, self.interp, self.homed, self.program = boot_id, "estop", "idle", False, None
