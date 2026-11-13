"""Differential wheel targets and finite, velocity-dependent torque envelopes (SI)."""
import math


def wheel_targets(v_mps, omega_radps, radius_m, separation_m):
    if not all(math.isfinite(x) for x in (v_mps, omega_radps, radius_m, separation_m)) or radius_m <= 0 or separation_m <= 0:
        raise ValueError("finite velocity and positive wheel geometry required")
    return ((v_mps - omega_radps * separation_m / 2) / radius_m,
            (v_mps + omega_radps * separation_m / 2) / radius_m)


def torque_limits(actual_rad_s, target_rad_s, physics):
    """Directional envelope: torque opposing actual rotation uses the separate brake cap.

    The velocity servo chooses torque direction; the motoring curve uses ACTUAL speed,
    never the requested speed. At rest either direction is motoring.
    """
    speed = abs(actual_rad_s)
    curve = physics["driveCurve"]
    cap = curve[-1]["torqueNm"]
    for a, b in zip(curve, curve[1:]):
        if speed <= b["speedRadS"]:
            f = max(0, (speed - a["speedRadS"]) / (b["speedRadS"] - a["speedRadS"]))
            cap = a["torqueNm"] + f * (b["torqueNm"] - a["torqueNm"])
            break
    brake = physics["brakeTorqueNm"]
    return (-brake, cap) if actual_rad_s > 0 else (-cap, brake) if actual_rad_s < 0 else (-cap, cap)
