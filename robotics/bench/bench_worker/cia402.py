"""CiA 402 as data (spec B1 §5.1): statusword -> device state -> neutral state, and the next controlword. No state lives here."""
DISABLED, READY, ENABLED, QUICK_STOP, FAULT = "disabled", "ready", "enabled", "quick_stop", "fault"

SHUTDOWN, SWITCH_ON, ENABLE_OPERATION, DISABLE_VOLTAGE, QUICK_STOP_CW, FAULT_RESET = 0x0006, 0x0007, 0x000F, 0x0000, 0x0002, 0x0080
ADVANCING = frozenset((SHUTDOWN, SWITCH_ON, ENABLE_OPERATION))   # the controlwords that lead toward Operation enabled

# (mask, value, device state, neutral state, controlword while enable is wanted, controlword while quick stop is commanded)
STATES = (
    (0x004F, 0x0000, "not_ready_to_switch_on", DISABLED, DISABLE_VOLTAGE, DISABLE_VOLTAGE),
    (0x004F, 0x0040, "switch_on_disabled", DISABLED, SHUTDOWN, DISABLE_VOLTAGE),
    (0x006F, 0x0021, "ready_to_switch_on", READY, SWITCH_ON, DISABLE_VOLTAGE),
    (0x006F, 0x0023, "switched_on", READY, ENABLE_OPERATION, DISABLE_VOLTAGE),
    (0x006F, 0x0027, "operation_enabled", ENABLED, ENABLE_OPERATION, QUICK_STOP_CW),
    # Released with enable: transition 16 back to Operation enabled (605Ah 5-7). To be confirmed against the pinned drive manual at the first hardware session.
    # A drive without transition 16 stays in Quick stop active; the enable attempt then times out (channel.enableTimeoutTicks), the worker latches
    # EXTERNAL_TRIP (session.py, R-b) and the stop sequence (stopseq rule 2) ends the axis disabled.
    (0x006F, 0x0007, "quick_stop_active", QUICK_STOP, ENABLE_OPERATION, QUICK_STOP_CW),
    (0x004F, 0x000F, "fault_reaction_active", FAULT, DISABLE_VOLTAGE, DISABLE_VOLTAGE),
    (0x004F, 0x0008, "fault", FAULT, DISABLE_VOLTAGE, DISABLE_VOLTAGE),
)
UNKNOWN = (None, None, "unknown", FAULT, DISABLE_VOLTAGE, DISABLE_VOLTAGE)   # a statusword outside the table fails closed


def _row(statusword):
    return next((r for r in STATES if statusword & r[0] == r[1]), UNKNOWN)


def device_state(statusword: int) -> str:
    return _row(statusword)[2]


def neutral_state(statusword: int) -> str:
    return _row(statusword)[3]


def next_controlword(statusword: int, enable: bool, quick_stop: bool, reset_edge: bool) -> int:
    row = _row(statusword)
    if row[2] == "fault":
        return FAULT_RESET if reset_edge else DISABLE_VOLTAGE   # a fault is never left toward enable without a reset pulse first
    if quick_stop:
        return row[5]
    return row[4] if enable else DISABLE_VOLTAGE


def neutral_fault(error_code: int, fault_map: dict[str, str]) -> str:
    code = fault_map.get(f"0x{error_code:04X}")
    return code if code in ("COMMAND_TIMEOUT", "FEEDBACK_LOSS", "FOLLOWING_ERROR", "OVERSPEED", "EXTERNAL_TRIP") else "EXTERNAL_TRIP"
