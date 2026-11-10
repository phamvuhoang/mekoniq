"""Robotics Toolbox forward kinematics, Jacobian and numerical IK for a modified-DH serial arm.

The inputs are plain numbers (SI: metres, radians). Nothing here reads a file, imports a model loader or compares against another implementation:
the verdict belongs to the caller, so this module cannot grade itself.
"""
import math

import numpy as np
from roboticstoolbox import DHRobot, RevoluteMDH
from spatialmath import SE3

from .errors import InputInvalid

MAX_JOINTS = 12
MAX_POSES = 10_000
# tol is on RTB's squared-error cost, so 1e-16 means a pose error near 1e-8
IK_SEED = 0  # ponytail: fixed seed so random restarts repeat; vary it only if a campaign wants restart diversity


def _finite(x, what):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        raise InputInvalid(f"{what} must be a finite number")
    return float(x)


def _vector(v, n, what):
    if not isinstance(v, list) or len(v) != n:
        raise InputInvalid(f"{what} must be a list of {n} numbers")
    return [_finite(x, what) for x in v]


def _robot(dh, limits=None):
    if not isinstance(dh, list) or not 1 <= len(dh) <= MAX_JOINTS:
        raise InputInvalid(f"dh must hold 1..{MAX_JOINTS} rows")
    links = []
    for i, row in enumerate(dh):
        if not isinstance(row, dict) or set(row) != {"a", "alpha", "d", "offset"}:
            raise InputInvalid(f"dh[{i}] must have exactly a, alpha, d, offset")
        kw = {k: _finite(row[k], f"dh[{i}].{k}") for k in ("a", "alpha", "d", "offset")}
        if limits is not None:
            kw["qlim"] = limits[i]
        links.append(RevoluteMDH(**kw))
    return DHRobot(links, name="algorithm-check")


def _poses(q, n, what="q"):
    if not isinstance(q, list) or not 1 <= len(q) <= MAX_POSES:
        raise InputInvalid(f"{what} must hold 1..{MAX_POSES} rows")
    return [np.array(_vector(row, n, f"{what}[{i}]")) for i, row in enumerate(q)]


def fk(p):
    robot = _robot(p.get("dh"))
    return {"T": [robot.fkine(q).A.tolist() for q in _poses(p.get("q"), robot.n)]}


def _num(x):
    return float(x) if math.isfinite(x) else None


def jacobian(p):
    robot = _robot(p.get("dh"))
    J, cond = [], []
    for q in _poses(p.get("q"), robot.n):
        j = robot.jacob0(q)
        J.append(j.tolist())
        cond.append(_num(np.linalg.cond(j)))  # inf (rank deficient) becomes null: JSON has no infinity
    return {"J": J, "cond": cond}


def ik(p):
    dh = p.get("dh")
    n = len(dh) if isinstance(dh, list) else 0
    limits = p.get("limits")
    if not isinstance(limits, list) or len(limits) != n:
        raise InputInvalid("limits must hold one [min, max] pair per joint")
    pairs = []
    for i, pair in enumerate(limits):
        lo, hi = _vector(pair, 2, f"limits[{i}]")
        if not lo < hi:
            raise InputInvalid(f"limits[{i}] minimum must be below maximum")
        pairs.append([lo, hi])
    robot = _robot(dh, pairs)
    targets, starts = p.get("T"), _poses(p.get("q0"), n, "q0")
    if not isinstance(targets, list) or len(targets) != len(starts) or not 1 <= len(targets) <= MAX_POSES:
        raise InputInvalid("T and q0 must have the same number of rows")
    out = []
    for T, q0 in zip(targets, starts):
        if not isinstance(T, list) or len(T) != 4:
            raise InputInvalid("each T must be a 4x4 matrix")
        A = np.array([_vector(row, 4, "T row") for row in T])
        if any(not lo <= v <= hi for v, (lo, hi) in zip(q0, pairs)):
            out.append({"ok": False, "q": [float(x) for x in q0], "reason": "Q0_OUT_OF_LIMITS"})
            continue
        sol = robot.ikine_LM(SE3(A, check=False), q0=q0, ilimit=200, slimit=10, tol=1e-16, joint_limits=True, seed=IK_SEED)
        q = np.asarray(sol.q, dtype=float).reshape(-1)
        ok = bool(sol.success) and bool(np.all(np.isfinite(q)))
        out.append({"ok": ok, "q": [float(x) for x in q], **({} if ok else {"reason": "IK_NOT_CONVERGED"})})
    return {"solutions": out}


OPS = {"rtb_fk": fk, "rtb_jacobian": jacobian, "rtb_ik": ik}
