"""The worker's command channel, one per axis (spec B1 §3): interpolation (hold or linear), then the acceleration ramp, then a count of bus cycles since the last new
`seq`. The order is the virtual drive's (`DriveGroup.substep`, ruling R3) and a test holds the two equal. It knows nothing about the bus or CiA 402."""
import math

from . import BenchError


class CommandChannel:
    def __init__(self, *, accel_rad_s2: float, max_speed_rad_s: float, cycles_per_tick: int, cycle_s: float, watchdog_ticks: int, interpolation: str):
        self.step, self.max_speed, self.cpt, self.linear = accel_rad_s2 * cycle_s, max_speed_rad_s, cycles_per_tick, interpolation == "linear"
        self.deadline = watchdog_ticks * cycles_per_tick
        self.seq = -1                      # seq 0 is a new command
        self.since = self.deadline         # no new seq yet: expired from the first cycle on
        self.prev = self.cur = self.ramp = 0.0
        self.sub = 0

    def check(self, command: dict) -> None:
        t, seq = command["target"], command["seq"]
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or abs(t) > self.max_speed:
            raise BenchError("BENCH_LIMIT_EXCEEDED", f"target {t} is outside +-{self.max_speed} rad/s")
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < max(self.seq, 0):
            raise BenchError("DRIVE_COMMAND_SEQ_INVALID", f"seq {seq} after {self.seq}")

    def accept(self, command: dict) -> bool:
        """Once per tick. A repeated seq keeps the previous target; returns whether the seq is new. Refuses (BenchError) before any change."""
        self.check(command)
        fresh = command["seq"] > self.seq
        self.prev = self.cur
        if fresh:
            self.seq, self.cur, self.since = command["seq"], float(command["target"]), 0
        self.sub = 0
        return fresh

    def cycle(self) -> tuple[float, bool]:
        self.sub += 1
        self.since += 1
        x = self.prev + (self.cur - self.prev) * self.sub / self.cpt if self.linear else self.cur
        self.ramp += max(-self.step, min(self.step, x - self.ramp))
        return self.ramp, self.since > self.deadline

    def neutral(self) -> None:
        """An axis that is not enabled drops its target, as the virtual drive does; a repeated seq cannot replay it."""
        self.prev = self.cur = self.ramp = 0.0
