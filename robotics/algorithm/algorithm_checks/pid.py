"""Independent reference for pid-v1, written from the specification (not ported from the TypeScript):

    e      = setpoint - y
    alpha  = dt / (dt + 1 / (2 pi fc))
    raw    = 0 on the first step, else -(y - y_prev) / dt            (derivative on the measurement)
    dF    += alpha * (raw - dF)
    Icand  = I + ki * e * dt
    uUnsat = kp * e + Icand + kd * dF
    u      = clamp(uUnsat, outMin, outMax)
    I      = I when u != uUnsat and sign(e) == sign(uUnsat - u), else Icand

against the exact (zero-order-hold) first-order plant  y[k+1] = a y[k] + (1 - a) K u[k - delay] + d[k],  a = exp(-dt / tau).
The measurement the controller sees is y[k] + noise[k]. Without derivative, delay or saturation the closed loop is linear and is also solved with scipy.signal.dlsim.
"""
import math

import numpy as np
from scipy.signal import dlsim

from .errors import InputInvalid

MAX_STEPS = 10_000
CONFIG_KEYS = {"kp", "ki", "kd", "dtS", "derivativeFilterHz", "outMin", "outMax"}


def _num(x, what):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        raise InputInvalid(f"{what} must be a finite number")
    return float(x)


def _series(v, n, what):
    if not isinstance(v, list) or len(v) != n:
        raise InputInvalid(f"{what} must be a list of {n} numbers")
    return [_num(x, what) for x in v]


def _sign(x):
    return (x > 0) - (x < 0)


def pid_response(p):
    cfg = p.get("config")
    if not isinstance(cfg, dict) or set(cfg) != CONFIG_KEYS:
        raise InputInvalid(f"config must have exactly {sorted(CONFIG_KEYS)}")
    kp, ki, kd, dt, fc, lo, hi = (_num(cfg[k], f"config.{k}") for k in ("kp", "ki", "kd", "dtS", "derivativeFilterHz", "outMin", "outMax"))
    if not (dt > 0 and fc > 0 and lo < hi):
        raise InputInvalid("config needs dtS > 0, derivativeFilterHz > 0 and outMin < outMax")
    plant = p.get("plant")
    if not isinstance(plant, dict) or set(plant) != {"gain", "tauS", "delaySteps"}:
        raise InputInvalid("plant must have exactly gain, tauS, delaySteps")
    gain, tau = _num(plant["gain"], "plant.gain"), _num(plant["tauS"], "plant.tauS")
    delay = plant["delaySteps"]
    if not (tau > 0) or isinstance(delay, bool) or not isinstance(delay, int) or not 0 <= delay <= 100:
        raise InputInvalid("plant needs tauS > 0 and an integer delaySteps in 0..100")
    r = p.get("setpoint")
    if not isinstance(r, list) or not 1 <= len(r) <= MAX_STEPS:
        raise InputInvalid(f"setpoint must hold 1..{MAX_STEPS} samples")
    n = len(r)
    r = _series(r, n, "setpoint")
    d, noise = _series(p.get("disturbance"), n, "disturbance"), _series(p.get("noise"), n, "noise")
    anti_windup = p.get("antiWindup", True)
    if not isinstance(anti_windup, bool):
        raise InputInvalid("antiWindup must be a boolean")

    a = math.exp(-dt / tau)
    alpha = dt / (dt + 1.0 / (2.0 * math.pi * fc))
    y, integral, d_f, prev = 0.0, 0.0, 0.0, None
    ys, us, ints, queue = [], [], [], [0.0] * delay
    touched = False
    for k in range(n):
        m = y + noise[k]
        e = r[k] - m
        raw = 0.0 if prev is None else -(m - prev) / dt
        d_f = d_f + alpha * (raw - d_f)
        cand = integral + ki * e * dt
        unsat = kp * e + cand + kd * d_f
        u = min(hi, max(lo, unsat))
        if u != unsat:
            touched = True
        integral = integral if (anti_windup and u != unsat and _sign(e) == _sign(unsat - u)) else cand
        prev = m
        ys.append(y)
        us.append(u)
        ints.append(integral)
        queue.append(u)
        y = a * y + (1.0 - a) * gain * queue.pop(0) + d[k]

    linear = None
    if kd == 0.0 and delay == 0 and not touched:
        c = kp + ki * dt
        A = np.array([[a - (1 - a) * gain * c, (1 - a) * gain], [-ki * dt, 1.0]])
        B = np.array([[(1 - a) * gain * c, 1.0, -(1 - a) * gain * c], [ki * dt, 0.0, -ki * dt]])
        C = np.array([[1.0, 0.0], [-c, 1.0]])
        D = np.array([[0.0, 0.0, 0.0], [c, 0.0, -c]])
        _, yout, _ = dlsim((A, B, C, D, dt), np.column_stack([r, d, noise]), x0=[0.0, 0.0])
        linear = [float(v) for v in yout[:, 0]]
    return {"y": ys, "u": us, "integral": ints, "linear": linear}


OPS = {"pid_response": pid_response}
