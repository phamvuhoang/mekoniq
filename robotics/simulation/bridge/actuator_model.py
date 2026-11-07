"""Bounded actuator reference model (pure). The native plugin must reproduce tests/vectors/actuator-vectors.json.

  tau_allowed = min(torque_speed_limit(|omega|, supply), current_limit * Kt * ratio * efficiency)
  tau_applied = clamp(tau_requested, -tau_allowed, +tau_allowed)

The torque-speed table is joint-side (already includes the gearbox) at the rated voltage; a lower supply scales the speed axis. Every parameter must be declared:
a missing curve or torque constant is an error, never zero or a default."""
import math


def _v(model, *path):
    """Declared scalar value at `path`; absence is an error naming the parameter."""
    node = model
    for key in path:
        if not isinstance(node, dict) or key not in node:
            raise ValueError("MODEL_PARAMETER_MISSING:" + path[-1])
        node = node[key]
    return node["value"] if isinstance(node, dict) and "value" in node else node


def _interp(table, speed):
    if speed > table[-1][0]:
        return 0.0  # beyond the last table speed no torque is available
    for (s0, t0), (s1, t1) in zip(table, table[1:]):
        if s0 <= speed <= s1:
            return t0 + (t1 - t0) * (speed - s0) / (s1 - s0)
    return table[0][1]


def step_actuator(state, command, model, dt_s):
    if not isinstance(dt_s, (int, float)) or not math.isfinite(dt_s) or dt_s < 0:
        raise ValueError("DT_INVALID")
    speed = state.get("speedRadSec") if isinstance(state, dict) else None
    if not isinstance(speed, (int, float)) or not math.isfinite(speed):
        raise ValueError("STATE_INVALID")
    requested = command.get("effortNm") if isinstance(command, dict) else None
    if not isinstance(requested, (int, float)) or not math.isfinite(requested):
        raise ValueError("COMMAND_INVALID")
    rated = _v(model, "voltageLimit")
    supply = command.get("supplyV", rated)
    if not isinstance(supply, (int, float)) or not math.isfinite(supply) or supply < 0:
        raise ValueError("SUPPLY_INVALID")
    rows = model.get("torqueSpeedTable") or []
    if len(rows) < 2:
        raise ValueError("MODEL_PARAMETER_MISSING:torqueSpeedTable")
    table = [(r["speed"]["value"], r["torque"]["value"]) for r in rows]
    ratio, eff = _v(model, "transmission", "ratio"), _v(model, "transmission", "efficiency")
    kt, current_limit = _v(model, "torqueConstantNmPerA"), _v(model, "currentLimit")
    if kt <= 0 or ratio <= 0 or not 0 < eff <= 1 or current_limit < 0:
        raise ValueError("MODEL_PARAMETER_INVALID")
    # a weaker supply compresses the speed range: the same torque is only available at proportionally lower speed
    torque_speed = 0.0 if supply == 0 else _interp(table, abs(speed) * rated / supply)
    current_cap = current_limit * kt * ratio * eff
    allowed = min(torque_speed, current_cap)
    applied = max(-allowed, min(allowed, requested))
    limits = []
    if abs(requested) > allowed:
        limits.append("current" if current_cap < torque_speed else "torque_speed")
    driving = applied * speed >= 0
    current = abs(applied) / (kt * ratio * eff) if driving else abs(applied) * eff / (kt * ratio)
    return {"effortNm": applied + 0.0, "currentA": current, "speedRadSec": speed, "limited": bool(limits), "limits": limits}
