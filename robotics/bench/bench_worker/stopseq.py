"""Ending a motion, in three rules (K03 ruling round; spec B1 5.1 and 5.4). Read this before the first real motor turns.

1. A commanded quick stop (`quickStop: true` with `enable: true`) is left to the drive. The worker writes 0x0002 for as long as the command says so and never
   0x0000 on its own; 605Ah decides what follows: 1-3 end in Switch on disabled, 5-7 stay in Quick stop active holding the axis. (That path is the CiA 402
   table, not this module.)
2. A worker-latched fault, `stop` (or stdin closing) and a command with `enable: false` all mean "end disabled", and must not cut a ramp short: writing Disable
   voltage (0x0000) while the drive still decelerates removes torque and turns the ramp into a coast. So: an axis at rest (below quickStopRestRadS for one
   whole tick) gets 0x0000 at once; a moving axis in Operation enabled or Quick stop active gets 0x0002, held until the drive has left those states by itself,
   or it has been at rest for a whole tick, or quickStopHoldMs has elapsed; only then 0x0000.
3. Leaving a held quick stop (`quickStop: false, enable: true` in Quick stop active) asks for Operation enabled with 0x000F (transition 16, table again).
   A drive without transition 16 stays in Quick stop active: after channel.enableTimeoutTicks the worker latches EXTERNAL_TRIP (session.py, R-b) and rule 2
   ends the axis disabled.

Pure: the caller keeps the counters (cycles at rest in a row, ms since the sequence began)."""
from .cia402 import DISABLE_VOLTAGE, QUICK_STOP_CW, device_state


def quick_stop_word(statusword: int, rest_cycles: int, elapsed_ms: float, *, rest_cycles_needed: int, hold_ms: float) -> int:
    moving = rest_cycles < rest_cycles_needed and elapsed_ms < hold_ms
    return QUICK_STOP_CW if moving and device_state(statusword) in ("operation_enabled", "quick_stop_active") else DISABLE_VOLTAGE
