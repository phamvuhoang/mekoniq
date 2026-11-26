"""The quick-stop sequence (K03 concern round): 0x0002 until the drive has left Quick stop active by itself, has been at rest for a whole tick, or the hold time is over;
only then 0x0000. Writing Disable voltage while a drive still ramps in Quick stop active removes torque and turns the ramp into a coast, whatever 605Ah says.
Pure: the caller keeps the counters. Used for a commanded quickStop, a worker-latched fault and `stop` alike."""
from .cia402 import DISABLE_VOLTAGE, QUICK_STOP_CW, device_state


def quick_stop_word(statusword: int, rest_cycles: int, elapsed_ms: float, *, rest_cycles_needed: int, hold_ms: float) -> int:
    if elapsed_ms >= hold_ms:
        return DISABLE_VOLTAGE
    s = device_state(statusword)
    if s == "operation_enabled" or s == "quick_stop_active" and rest_cycles < rest_cycles_needed:
        return QUICK_STOP_CW
    return DISABLE_VOLTAGE
