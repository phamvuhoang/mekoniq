# Spike X00 — tay máy đứng và bám trong Webots (R1.1)

- **Ngày:** 2026-11-11 · **Máy:** Apple M2 Pro, macOS (Darwin 25.5.0) · **Engine:** Webots R2025a (`--batch --minimize --mode=fast`, không render), Python `.venv-webots`
- **Spec:** [§6.1](../superpowers/specs/2026-11-10-webots-arm-design.md) · **Plan:** X00 · world và script nằm ngoài cây git (scratch); bản đầy đủ nhúng bên dưới
- **Kết luận: ĐẠT cả sáu tiêu chí.** Không tiêu chí nào cần chỉnh; khối lượng và `effort` giữ nguyên giá trị khởi đầu.

## Thiết lập

- Một `Robot` (supervisor, controller `<extern>`) với 6 `HingeJoint` lồng nhau theo `PUMA560_SI` (Craig modified DH, SI): `B_i = B_{i-1}·Rx(α_i)·Tx(a_i)·Rz(q_i)·Tz(d_i)`. Anchor khớp i trong khung link i−1 là `(a_i,0,0)`, trục là `Rx(α_i)·ẑ`, `endPoint` có `translation=(a_i, −d_i·sin α_i, d_i·cos α_i)` và `rotation=Rx(α_i)·Rz(q_home_i)` (pose endPoint phải khớp `position` khởi đầu, nếu không khớp bị lệch ngay tick 0).
- Link: `Cylinder` bán kính 0,025 m dọc đoạn `d` và đoạn `a` kế tiếp (link 5, 6 có thêm cầu/đoạn công cụ 0,06 m). `Physics` chỉ đặt `mass`; quán tính do Webots tính từ bounding object (**giả định**, không phải số đo).
- `RotationalMotor{maxVelocity=giới hạn khớp, maxTorque=effort}` + `PositionSensor` mỗi khớp. `basicTimeStep 20`, `optimalThreadCount 1`, `randomSeed 7`, `coordinateSystem ENU`, trọng lực mặc định.
- Lệnh: mỗi tick `setPosition(commanded)` với `commanded` theo đúng nội suy của `MockArmPlant.advance()`: mỗi khớp bước tối đa `maxVelocity·0.1·0.02` (= 0,004189 rad/tick) về waypoint, các khớp độc lập. Waypoint `W` và `ARM_CHOREOGRAPHY` đọc từ `mock-arm.ts`.
- Chạy `cup-pick` rồi `cup-place` từ `home`, dừng 60 tick (1,2 s) tại mỗi waypoint để đo ổn định. 25 tick đầu để engine ổn định trên `home`, không tính vào số đo.

## Số đo theo tiêu chí

| # | Tiêu chí | Ngưỡng | Đo được | |
|---|---|---|---|---|
| 1 | Giữ `home` 10 s (500 tick), không NaN | ≤ 0,005 rad | lệch lớn nhất **3,0e-5 rad**, không NaN | ĐẠT |
| 2 | `cup-pick` + `cup-place` ở tốc độ `MOCK_ARM_PARAMS`, sai số bám đỉnh | ≤ 0,05 rad | **0,0168 rad** (J1/J2/J3/J5 ≈ 0,0168; J4, J6 ≈ 0; RMS 0,007–0,012) | ĐẠT |
| 3 | Dừng tại mỗi waypoint | ≤ 25 tick, ≤ 0,01 rad | **2–3 tick** ở cả 6 waypoint (lệch lúc lệnh tới: 0,0146–0,0163) | ĐẠT |
| 4 | Hai lần chạy cùng seed | ≤ 1e-6 rad | **0,0 rad** (bit-exact, 960 tick mỗi lần) | ĐẠT |
| 5 | p95 thời gian tick | ≤ 15 ms | p50 **0,064 ms**, p95 **0,082 ms**, max 0,164 ms | ĐẠT |
| 6 | Va chạm với hộp tĩnh | có khi có hộp, không khi không | có hộp: **233/252 tick** có điểm tiếp xúc (tối đa 3 điểm), đầu tiên ở tick 18; không hộp: **0** điểm trong 960 tick | ĐẠT |

Ghi chú:
- Tick đo là một vòng `step(20)` của controller (chặn tới khi engine mô phỏng xong), không gồm thời gian khởi động Webots. Cảnh một tay máy nhỏ và không render nên số đo thấp hơn nhiều so với cảnh AMR hai robot của R1 (12 ms); đừng suy ra hiệu năng cho cảnh lớn hơn.
- Tiêu chí 6: hộp 0,12 m đặt tâm tại TCP của `pick` (từ FK). Tiếp xúc xuất hiện sớm hơn dự tính (tick 18, tay còn xa `pick`) và tôi chưa xác định link nào chạm, nên đây chỉ xác nhận "Webots báo tiếp xúc khi hộp cắt đường", chưa phải bài kiểm vị trí va chạm (việc của X06/WA06). Với hộp, cánh tay bị chặn: sai số bám tăng tới **0,204 rad**, vượt 0,03 rad ở tick 40 và 0,05 rad ở tick 45 của cửa sổ đo. Đây là cơ sở cho `followTolRad` và WA06.
- Tiêu chí 4 bit-exact là kết quả một máy, một phiên bản Webots; không dùng làm cam kết liên máy, nên `repeatJointRad` giữ 1e-6.
- Cảnh báo `USER or USERNAME environment variable not set` từ controller vô hại (môi trường tối thiểu giống `engine.py` của worker).

## Khảo sát `effort` (để X06/WA06 dùng)

J2 chịu trọng lực lớn nhất. Giữ các khớp khác ở giá trị khởi đầu, chạy `cup-pick`:

| `effortNm[1]` (J2) | Kết quả |
|---|---|
| 20 | **không giữ nổi**: tay võng ngay tick 0, sai số 2,29 rad |
| 5 | không giữ nổi, sai số 3,42 rad |
| 40, 80, 120, 200 | giữ được, sai số bám đỉnh 0,0168 rad như nhau |

Công thức cho WA06 "lỗi bám": hạ `effortNm[1]` xuống 20 hoặc thấp hơn thì sai số vượt `followTolRad` ngay từ tick 0, và phải bị phát hiện trong `followTicks`, không chờ `maxTicks`.

## Tham số chọn (đều giả định, nằm trong oracle profile `webotsArm`)

| Tham số | Giá trị | Căn cứ |
|---|---|---|
| `reachTolRad` | 0,01 | khớp tiêu chí 3; lệch lúc lệnh tới tối đa 0,0163 rồi hội tụ ≤ 3 tick |
| `settleTicks` | 10 | đo 2–3 tick, lấy khoảng 3× |
| `followTolRad` | 0,05 | bám bình thường tối đa 0,0168 (khoảng 3×); tay bị chặn vượt ngưỡng ở tick 45 |
| `followTicks` | 10 | 0,2 s liên tiếp quá ngưỡng thì báo `ARM_FOLLOWING_ERROR` |
| `repeatJointRad` | 1e-6 | tiêu chí 4; đo được 0 |
| `massKg[6]` | [8, 6, 4, 1.5, 1, 0.5] | giả định khởi đầu, không chỉnh |
| `effortNm[6]` | [200, 200, 100, 30, 20, 10] | giả định khởi đầu, không chỉnh. J2 giữ được từ 40 Nm trở lên |

Các số này là **ngưỡng kiểm thử ban đầu**, không phải năng lực đo của tay máy thật (mặc định 1 của spec §8).

## World generator (`gen_world.py`)

```python
"""X00 scratch: hand-written Webots world for the PUMA560_REFERENCE arm (modified DH, SI) with assumed masses/efforts. Not committed."""
import json, math, sys
P = json.load(open(sys.argv[1])); out = sys.argv[2]
box = len(sys.argv) > 3 and sys.argv[3] == "box"
MASS = [8, 6, 4, 1.5, 1, 0.5]; EFFORT = [200, 200, 100, 30, 20, 10]
if len(sys.argv) > 4: MASS = json.loads(sys.argv[4]); EFFORT = json.loads(sys.argv[5])
R = 0.025
L = P["model"]["links"]; LIM = P["model"]["limits"]; home = P["W"]["home"]
f = lambda v: f"{v:.12g}"
def rx_rz(al, q):  # Rx(al)*Rz(q) as axis-angle (the endPoint pose at the joint's initial position)
    ca, sa, cq, sq = math.cos(al/2), math.sin(al/2), math.cos(q/2), math.sin(q/2)
    w, x, y, z = ca*cq, sa*cq, -sa*sq, ca*sq   # (ca + sa i)(cq + sq k)
    n = math.sqrt(x*x+y*y+z*z)
    return (1, 0, 0, 0.0) if n < 1e-12 else (x/n, y/n, z/n, 2*math.atan2(n, w))
def rot_to(u):  # rotation taking +y to unit u
    ax = (u[2], 0.0, -u[0]); s = math.hypot(*ax); c = u[1]
    if s < 1e-12: return (1, 0, 0, 0.0 if c > 0 else math.pi)
    return (ax[0]/s, ax[1]/s, ax[2]/s, math.atan2(s, c))
def seg(p0, p1):
    d = [b-a for a, b in zip(p0, p1)]; n = math.sqrt(sum(x*x for x in d))
    if n < 1e-9: return None
    u = [x/n for x in d]; c = [(a+b)/2 for a, b in zip(p0, p1)]; r = rot_to(u)
    return f"Pose {{ translation {f(c[0])} {f(c[1])} {f(c[2])} rotation {f(r[0])} {f(r[1])} {f(r[2])} {f(r[3])} children [ Cylinder {{ height {f(n)} radius {R} }} ] }}"
def link_geom(i):
    parts = []; d = L[i]["d"]
    if abs(d) > 1e-9: parts.append(seg((0, 0, -d), (0, 0, 0)))
    if i < 5 and abs(L[i+1]["a"]) > 1e-9: parts.append(seg((0, 0, 0), (L[i+1]["a"], 0, 0)))
    if i == 5: parts.append(seg((0, 0, 0), (0, 0, 0.06)))
    if i == 0: parts.append(seg((0, 0, -0.1), (0, 0, 0)))
    parts = [p for p in parts if p]
    if not parts: parts = [f"Pose {{ children [ Sphere {{ radius {R+0.005} }} ] }}"]
    return "Group { children [ " + " ".join(parts) + " ] }"
def solid(i, ind):
    pad = "  " * ind
    nxt = ""
    if i < 5:
        a, al, d = L[i+1]["a"], L[i+1]["alpha"], L[i+1]["d"]
        nxt = hinge(i+1, ind+2)
    return (f"{pad}Solid {{\n{pad}  DEF L{i+1} Solid {{ name \"link{i+1}\" }}\n" if False else "")
def hinge(i, ind, parent_first=False):
    """HingeJoint of joint i (0-based) inside the previous body, endPoint = body i."""
    pad = "  " * ind
    a, al, d = L[i]["a"], L[i]["alpha"], L[i]["d"]
    anchor = (a, 0.0, 0.0); axis = (0.0, -math.sin(al), math.cos(al))
    tr = (a, -d*math.sin(al), d*math.cos(al)); rr = rx_rz(al, home[i])
    child = hinge(i+1, ind+3) if i < 5 else ""
    com = ""
    return (f"{pad}HingeJoint {{\n{pad}  jointParameters HingeJointParameters {{ position {f(home[i])} anchor {f(anchor[0])} {f(anchor[1])} {f(anchor[2])} axis {f(axis[0])} {f(axis[1])} {f(axis[2])} }}\n"
            f"{pad}  device [ RotationalMotor {{ name \"j{i+1}\" maxVelocity {f(LIM[i]['maxVelocity'])} minPosition {f(LIM[i]['min'])} maxPosition {f(LIM[i]['max'])} maxTorque {EFFORT[i]} }} PositionSensor {{ name \"j{i+1}_s\" }} ]\n"
            f"{pad}  endPoint DEF L{i+1} Solid {{\n{pad}    translation {f(tr[0])} {f(tr[1])} {f(tr[2])}\n{pad}    rotation {f(rr[0])} {f(rr[1])} {f(rr[2])} {f(rr[3])}\n"
            f"{pad}    children [\n{child}{pad}    ]\n{pad}    name \"link{i+1}\"\n{pad}    boundingObject {link_geom(i)}\n{pad}    physics Physics {{ density -1 mass {MASS[i]} }}\n{pad}  }}\n{pad}}}\n")
head = ('#VRML_SIM R2025a utf8\nWorldInfo {\n  basicTimeStep 20\n  optimalThreadCount 1\n  randomSeed 7\n  coordinateSystem "ENU"\n}\n'
        'Viewpoint { orientation 0 0 1 3.14 position 2 0 1 }\n')
body = "Robot {\n  name \"arm\"\n  controller \"<extern>\"\n  supervisor TRUE\n  children [\n" + hinge(0, 2) + "  ]\n}\n"
extra = ""
if box:
    tp = P["fk"]["pick"]["tcp"]["position"]
    extra = f"Solid {{ translation {f(tp[0])} {f(tp[1])} {f(tp[2])} name \"obstacle\" boundingObject Box {{ size 0.12 0.12 0.12 }} }}\n"
open(out, "w").write(head + body + extra)
```

## Controller (`arm_ctl.py`)

```python
"""X00 scratch: extern controller+supervisor for the spike arm. Replays the MockArmPlant interpolation (per-joint clamped step 0.1*maxVelocity*0.02) as setPosition targets and records every tick."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.environ["WEBOTS_HOME"], "Contents", "lib", "controller", "python"))
from controller import Supervisor
cfg = json.loads(sys.argv[1]); P = json.load(open(cfg["params"])); TICK = 20
W, LIM, CH = P["W"], P["model"]["limits"], P["choreo"]
step_max = [l["maxVelocity"] * P["params"]["speedFraction"] * P["params"]["dtS"] for l in LIM]
sup = Supervisor()
motors = [sup.getDevice(f"j{i+1}") for i in range(6)]
sens = [sup.getDevice(f"j{i+1}_s") for i in range(6)]
for s in sens: s.enable(TICK)
links = [sup.getFromDef(f"L{i+1}") for i in range(6)]
for l in links: l.enableContactPointsTracking(TICK, False)
q = list(W["home"]); cmd = list(q); tr = []; marks = []
def tick(target, label=None):
    for i, m in enumerate(motors): m.setPosition(target[i])
    t0 = time.perf_counter()
    if sup.step(TICK) < 0: sys.exit(3)
    ms = (time.perf_counter() - t0) * 1000
    contacts = sum(len(l.getContactPoints(False)) for l in links)
    tr.append({"tick": len(tr), "cmd": list(target), "act": [s.getValue() for s in sens], "ms": ms, "contacts": contacts})
def advance(goal):
    global q
    q = [goal[i] if abs(goal[i]-q[i]) <= step_max[i] else q[i] + (1 if goal[i] > q[i] else -1) * step_max[i] for i in range(6)]
    return q
for _ in range(cfg.get("lead", 25)): tick(q)           # let the engine settle on home before the measured window
start = len(tr)
if cfg["mode"] == "hold":
    for _ in range(cfg["ticks"]): tick(q)
else:
    for prog in cfg["programs"]:
        for stage in CH[prog]:
            goal = W[stage["waypoint"]]
            while any(abs(goal[i]-q[i]) > 0 for i in range(6)): tick(advance(goal))
            marks.append({"program": prog, "waypoint": stage["waypoint"], "arriveTick": len(tr)-1})
            for _ in range(cfg["dwell"]): tick(q)
json.dump({"start": start, "marks": marks, "trace": tr, "stepMax": step_max}, open(cfg["out"], "w"))
```

## Harness (`run.py`)

```python
import json, os, shutil, signal, subprocess, sys, time, random, getpass
from pathlib import Path
HOME = "/Applications/Webots.app"; world, cfg, work = sys.argv[1], json.loads(sys.argv[2]), Path(sys.argv[3]); work.mkdir(parents=True, exist_ok=True)
port = random.randint(20000, 29999); log = open(work/"webots.log", "wb")
env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": os.environ["HOME"], "TMPDIR": "/tmp"}
w = subprocess.Popen([f"{HOME}/Contents/MacOS/webots", "--batch", "--minimize", "--mode=fast", "--stdout", "--stderr", f"--port={port}", world], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
try:
    t = time.monotonic()
    while "Waiting for local or remote connection" not in (work/"webots.log").read_text(errors="replace"):
        if w.poll() is not None or time.monotonic() - t > 60: raise SystemExit("webots not ready: " + (work/"webots.log").read_text(errors="replace")[-400:])
        time.sleep(0.1)
    cenv = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "WEBOTS_HOME": HOME, "HOME": os.environ["HOME"], "WEBOTS_CONTROLLER_URL": f"ipc://{port}/arm"}
    py = "/Users/hoangpham/source/prv/robot/source/.venv-webots/bin/python"
    c = subprocess.run([py, "-I", "-B", "-X", "utf8", str(Path(__file__).parent/"arm_ctl.py"), json.dumps(cfg)], env=cenv, timeout=cfg.get("timeout", 300), capture_output=True, text=True)
    print("controller rc", c.returncode, c.stderr[-500:])
finally:
    try: os.killpg(w.pid, signal.SIGKILL)
    except ProcessLookupError: pass
    w.wait(); shutil.rmtree(Path("/tmp/webots")/getpass.getuser()/str(port), ignore_errors=True)
```
