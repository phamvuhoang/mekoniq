"""Lumped beverage process plant (no CFD, no heat transfer): flow, reservoir, cup mass and temperature. Pure; the native worker applies the mass to the cup body.

  delivered_ml = min(flow_ml_per_s * dt_s, remaining_recipe_ml, reservoir_ml)
  delta_mass_kg = delivered_ml * 1e-6 * density_kg_per_m3
Conservation is exact by construction: the reservoir loses precisely what the cup gains. State keys: elapsedS, volumeMl, targetMl, cupMassKg, <resourceId>Ml, cupPresent, blockedFlow, temperatureC."""
import math


def _val(model, key):
    node = model.get(key)
    if not isinstance(node, dict) or "value" not in node:
        raise ValueError(f"MODEL_PARAMETER_MISSING:{key}")
    return node["value"]


def step_process(state, model, dt_s):
    if not isinstance(dt_s, (int, float)) or not math.isfinite(dt_s) or dt_s < 0:
        raise ValueError("DT_INVALID")
    resource = model["reservoirs"][0]["resourceId"]
    level_key = f"{resource}Ml"
    if level_key not in state or "cupMassKg" not in state:
        raise ValueError(f"PROCESS_STATE_INVALID:{level_key if level_key not in state else 'cupMassKg'}")
    out = dict(state)
    out.setdefault("elapsedS", 0.0)
    out.setdefault("volumeMl", 0.0)
    out["deliveredMl"] = 0.0
    tau = model.get("temperature", {}).get("thermalTimeConstantSec", {}).get("value")
    if "temperature" in model and tau:
        current = out.get("temperatureC", model["temperature"]["initialC"]["value"])
        out["temperatureC"] = current + (model["temperature"]["targetC"]["value"] - current) * (1 - math.exp(-dt_s / tau))
    else:
        out["temperatureC"] = None  # unavailable is not zero
    if dt_s == 0:
        out["status"] = state.get("status", "idle")
        return out
    out["elapsedS"] = state.get("elapsedS", 0.0) + dt_s
    if state.get("status") in ("complete", "timeout", "stockout"):
        out["status"] = state["status"]  # terminal until the caller starts a new brew
        return out
    if not state.get("cupPresent", False):
        out["status"] = "no_cup"
        return out
    if state.get("blockedFlow", False):
        out["status"] = "blocked"
        return out
    if state.get("elapsedS", 0.0) >= _val(model, "maxDurationSec"):
        out["status"] = "timeout"
        return out
    if "targetMl" not in state:
        raise ValueError("PROCESS_STATE_INVALID:targetMl")
    flowing_dt = max(0.0, min(dt_s, out["elapsedS"] - _val(model, "startupDelaySec")))
    if flowing_dt == 0.0:
        out["status"] = "startup"
        return out
    remaining = max(0.0, state["targetMl"] - out["volumeMl"])
    reservoir = state[level_key]
    delivered = min(_val(model, "flowMlPerSec") * flowing_dt, remaining, reservoir)
    out["deliveredMl"] = delivered
    out["volumeMl"] += delivered
    out[level_key] = reservoir - delivered
    out["cupMassKg"] = state["cupMassKg"] + delivered * 1e-6 * _val(model, "densityKgPerM3")
    if out["volumeMl"] >= state["targetMl"] - 1e-12:
        out["status"] = "complete"
    elif out[level_key] <= 1e-12:
        out["status"] = "stockout"
    elif out["elapsedS"] >= _val(model, "maxDurationSec"):
        out["status"] = "timeout"
    else:
        out["status"] = "flowing"
    return out


def observe(state, fault):
    """What a sensor reports. A fault changes the reading only; the plant state is untouched."""
    seen = {"volumeMl": state.get("volumeMl", 0.0), "cupMassKg": state.get("cupMassKg"), "temperatureC": state.get("temperatureC")}
    if fault and fault.get("kind") == "sensor_bias":
        seen["volumeMl"] += fault["offsetMl"]
    elif fault and fault.get("kind") == "sensor_stuck":
        seen["volumeMl"] = fault["valueMl"]
    return seen
