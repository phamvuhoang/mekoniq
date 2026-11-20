# Throwaway review check (not repo code): after one arm axis faults, do the still-enabled joints hold when the controller sends "target = latest measured position" every tick
# (what joint-trajectory-follower-v1 does), compared with a target latched once at the fault?
import sys
R = "/Users/hoangpham/source/prv/robot/source/robotics/simulation-mujoco"
sys.path.insert(0, R); sys.path.insert(0, R + "/tests")
import numpy as np
import probe_drive as P
from test_drive_engine import docs, arm_engine, arm_commands

def run(latched, ticks=250):
    am, ac = docs("xarm6", "nominal")
    e = arm_engine((am, ac)); seq = 0; reading = None
    for _ in range(100):                                   # enable and settle at HOME
        seq += 1; reading = e.step(None, None, [], arm_commands("xarm-1", P.HOME, P.OPEN, e.grip_range, e.opening_max_m, seq))
    q0 = e.data.qpos[e.arm_qpos].copy(); states0 = [d["state"] for d in reading["drives"]]
    e.drive.g.trip("xarm-1/J5")                             # one axis faults (the injection hook of the drive model)
    hold = None; worst = np.zeros(6)
    for _ in range(ticks):
        seq += 1
        meas = [d["positionRad"] for d in reading["drives"][:6]]
        hold = hold or list(meas)
        reading = e.step(None, None, [], arm_commands("xarm-1", hold if latched else meas, P.OPEN, e.grip_range, e.opening_max_m, seq))
        worst = np.maximum(worst, np.abs(e.data.qpos[e.arm_qpos] - q0))
    states = [d["state"] for d in reading["drives"]]; q1 = e.data.qpos[e.arm_qpos].copy(); e.close()
    return states0, states, np.degrees(q1 - q0), np.degrees(worst)

for latched in (False, True):
    s0, s1, drift, worst = run(latched)
    print("latched hold" if latched else "target = latest measurement (as the follower does)")
    print("  states before:", s0[:7]); print("  states after :", s1[:7])
    print("  drift after 5 s, deg J1..J6:", np.round(drift, 2).tolist(), "| worst:", np.round(worst, 2).tolist())
