import sys, copy, json
sys.path.insert(0, "/Users/hoangpham/source/prv/robot/source/robotics/simulation-mujoco")
sys.path.insert(0, "/Users/hoangpham/source/prv/robot/source/robotics/simulation-mujoco/tests")
from test_drive_model import Rig, doc, DT, SUB
from mujoco_worker.drive_model import DriveGroup

# (a) stale target on re-enable (wheel csv, nominal)
r = Rig()
r.enable_all()
for _ in range(3): r.tick(target=8.0)
print("enabled, applied", r.g.applied, r.g.cmd_in)
# disable (enable False) for 5 ticks with target 0
for _ in range(5): r.tick(target=0.0, enable=False)
print("disabled states", r.states(), "cmd_in", r.g.cmd_in, "applied", r.g.applied)
# re-enable, commanding target 0 the whole time
r.log.clear()
for k in range(4):
    r.tick(target=0.0)
    print("tick", k, r.states(), [ (o["active"][0], o["target"][0]) for o in r.log[-10:]])

# (a2) after watchdog fault + reset
r = Rig(); r.enable_all()
for _ in range(2): r.tick(target=8.0)
for _ in range(6): r.tick(seq=r.seq, target=8.0)
print("fault", r.faults())
r.tick(target=0.0, faultReset=True)
r.log.clear()
for k in range(4):
    r.tick(target=0.0)
    print("after reset tick", k, r.states(), [ (o["active"][0], o["target"][0]) for o in r.log[-10:]])

# (b) accel limiter with command delay
for delay in (0, 1, 50):
    def edit(m):
        for a in m["axes"]:
            a["commandDelaySubsteps"] = delay; a["enableDelaySubsteps"] = 0; a["watchdogTicks"] = None
    m, c = doc("serve-drive-nominal-v1.json"), doc("serve-control-v1.json"); edit(m)
    for a in c["axes"]: a["accelerationLimit"] = 100.0   # rad/s^2 -> 0.2 rad/s per substep
    g = DriveGroup(m, c, DT, SUB, {a["axisId"]: (-20, 20) for a in m["axes"]}); g.reset([0, 0])
    seq = 0; outs = []
    for t in range(40):
        seq += 1
        g.begin_tick([{"axisId": a["axisId"], "seq": seq, "mode": "csv", "target": 10.0, "enable": True, "quickStop": False, "faultReset": False} for a in m["axes"]])
        for s in range(SUB):
            o = g.substep([0, 0], [0, 0]); outs.append(o["target"][0]); g.sample([0, 0], [0, 0], [0, 0], [False, False])
        g.end_tick()
    first = next((i for i, x in enumerate(outs) if x >= 10.0 - 1e-9), None)
    print("delay", delay, "substeps to reach 10 rad/s:", first, "expected", 50 + delay)
