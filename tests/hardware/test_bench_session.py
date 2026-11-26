import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics' / 'bench'))

import io
import json
import subprocess

import pytest

from bench_worker import BenchError
from bench_worker.bus_sim import SimBus
from bench_worker.cia402 import ADVANCING
from bench_worker.session import BenchSession

BENCH = Path(__file__).resolve().parents[2] / 'robotics' / 'bench'
FIX = BENCH / 'fixtures'
AXES = ["amr-1/wheel-left", "amr-1/wheel-right"]
RAW = 20860.76


def kit(name="kit-sim-v1.json", **sim):
    k = json.loads((FIX / name).read_text())
    k["simSlave"].update(sim)
    return k


class Rig:
    def __init__(self, k=None, read_only=False, upto="start"):
        self.kit = k or kit()
        self.bus = SimBus(self.kit)
        self.s = BenchSession(self.kit, self.bus, read_only=read_only)
        self.seq = 0
        ops = ("open", "scan", "configure", "start")
        for op in ops[: ops.index(upto) + 1] if upto else ():
            self.do(op)

    def do(self, op, payload=None):
        return self.s.handle(op, payload or {}, self.s.tick)

    def cmds(self, target=0.0, enable=True, fresh=True, **over):
        if fresh:
            self.seq += 1
        return [{"axisId": a, "seq": self.seq, "mode": "csv", "target": target, "enable": enable, "quickStop": False, "faultReset": False} | over for a in AXES]

    def step(self, **kw):
        return self.do("step", {"commands": self.cmds(**kw)})

    def until(self, pred, n=100, **kw):
        for _ in range(n):
            r = self.step(**kw)
            if pred(r):
                return r
        raise AssertionError("condition never met")

    def enable(self):
        return self.until(lambda r: states(r) == ["enabled"] * 2)


def states(r):
    return [f["state"] for f in r["feedback"]]


def code(fn, *a, **kw):
    with pytest.raises(BenchError) as e:
        fn(*a, **kw)
    return e.value.code


def controlwords(r, axis=0):
    return [row["axes"][axis]["controlword"] for row in r["cycles"]]


# ---- read-only ------------------------------------------------------------------------------------------------------------------------------------------------
def test_read_only_refuses_every_write_and_every_enable():
    r = Rig(read_only=True, upto="scan")
    for op in ("configure", "start", "silence", "imuConfigure"):
        assert code(r.do, op) == "BENCH_READ_ONLY"
    assert code(r.step) == "BENCH_READ_ONLY"
    assert code(r.step, enable=False) == "BENCH_ORDER_VIOLATION"   # without an enable the read-only gate passes, the order gate does not
    assert r.bus.writes == []


# ---- configure --------------------------------------------------------------------------------------------------------------------------------------------------
MAPPING = ("1C12", "1C13", "1600", "1A00")


def with_sdo(k, *writes):
    for a in k["axes"]:
        a["sdoWrites"] = [dict(w) for w in writes]
    return k


def test_configure_writes_the_mapping_then_mode_torque_and_speed_limits_in_order():
    r = Rig(with_sdo(kit(), {"object": "6072:00", "value": 300, "bytes": 2}), upto="configure")
    for pos in (1, 2):
        objs = [(o, v) for p, o, v in r.bus.writes if p == pos]
        n = next(i for i, (o, _) in enumerate(objs) if o[:4] not in MAPPING)
        assert n > 0 and all(o[:4] in MAPPING for o, _ in objs[:n])
        assert [o for o, _ in objs[n:]] == ["6060:00", "6072:00", "607F:00"]
        assert objs[n] == ("6060:00", 9) and objs[n + 1] == ("6072:00", 300) and objs[n + 2] == ("607F:00", round(20 * RAW))
    assert not any(o.startswith("1010") for _, o, _ in r.bus.writes)


@pytest.mark.parametrize("obj,value,expect", [("1010:01", 0x65766173, "BENCH_SDO_NOT_LISTED"), ("1600:01", 0, "BENCH_SDO_NOT_LISTED"), ("6072:00", 1000, "BENCH_LIMIT_EXCEEDED")])
def test_configure_refuses_an_sdo_write_it_must_not_do_before_writing_anything(obj, value, expect):
    r = Rig(with_sdo(kit(), {"object": obj, "value": value, "bytes": 4}), upto="scan")
    assert code(r.do, "configure") == expect
    assert r.bus.writes == []
    assert code(r.do, "start") == "BENCH_ORDER_VIOLATION"


def test_limits_above_the_hard_ceiling_are_refused():
    k = kit()
    k["limits"]["maxSpeedRadS"] = 31
    r = Rig(k, upto="scan")
    assert code(r.do, "configure") == "BENCH_LIMIT_EXCEEDED" and r.bus.writes == []


@pytest.mark.parametrize("route", ["attribute", "simSlave"])
def test_a_readback_mismatch_stops_the_session(route):
    r = Rig(kit(corruptReadback="6072:00") if route == "simSlave" else None, upto="scan")
    if route == "attribute":
        r.bus.corrupt_readback = "6072:00"
    assert code(r.do, "configure") == "BENCH_SDO_READBACK_MISMATCH"
    assert code(r.do, "start") == "BENCH_ORDER_VIOLATION"
    assert code(r.step) == "BENCH_ORDER_VIOLATION"


def test_a_pdo_mapping_that_does_not_read_back_is_refused():
    r = Rig(kit(corruptReadback="1600:02"), upto="scan")
    assert code(r.do, "configure") == "BENCH_PDO_MAP_REFUSED"
    assert code(r.do, "start") == "BENCH_ORDER_VIOLATION"


def test_a_slave_identity_other_than_the_kit_expects_is_refused_at_configure():
    k = kit()
    k["axes"][1]["expect"]["productCode"] = "0x00000002"
    r = Rig(k, upto="scan")
    assert code(r.do, "configure") == "BENCH_IDENTITY_CHANGED" and r.bus.writes == []


# ---- order ------------------------------------------------------------------------------------------------------------------------------------------------------
def test_ops_out_of_order_are_refused():
    r = Rig(upto=None)
    assert code(r.do, "scan") == "BENCH_ORDER_VIOLATION"
    r.do("open")
    assert code(r.do, "start") == "BENCH_ORDER_VIOLATION"
    r.do("scan")
    assert code(r.step) == "BENCH_ORDER_VIOLATION"
    r.do("configure")
    assert code(r.step) == "BENCH_ORDER_VIOLATION"
    r.do("start")
    assert code(r.s.handle, "step", {"commands": r.cmds()}, r.s.tick + 1) == "BENCH_ORDER_VIOLATION"   # expectedTick must be the session's tick
    assert code(r.do, "imuConfigure") == "BENCH_ORDER_VIOLATION"   # a sensors op


def test_scan_with_another_slave_count_is_refused():
    r = Rig(kit(serials=["A", "B", "C"]), upto="open")
    assert code(r.do, "scan") == "BENCH_SLAVE_COUNT"


def test_scan_reports_identity_and_distinct_serials():
    slaves = Rig(upto="scan").do("scan")["slaves"]
    assert [(s["vendorId"], s["productCode"]) for s in slaves] == [("0x53494D00", "0x00000001")] * 2
    assert len({s["serial"] for s in slaves}) == 2


# ---- the full sequence, on both kits ---------------------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("name", ["kit-sim-v1.json", "kit-sim-ac-v1.json"])
def test_full_sequence(name):
    r = Rig(kit(name), upto="open")
    scan = r.do("scan")
    if name == "kit-sim-ac-v1.json":
        assert all("60FF:00" not in s["rxPdo"] for s in scan["slaves"])
    cfg = r.do("configure")
    assert all("60FF:00" in a["rxPdo"] for a in cfg["axes"])
    r.do("start")
    seen = [states(r.step(enable=False))]
    for _ in range(60):
        res = r.step(target=2.0)
        seen.append(states(res))
    for i in range(2):
        order = [s[i] for k, s in enumerate(seen) if k == 0 or s[i] != seen[k - 1][i]]
        assert order == ["disabled", "ready", "enabled"]
    fb = res["feedback"]
    assert [f["velocityRadS"] for f in fb] == pytest.approx([2.0, 2.0], abs=0.01)   # the right axis has polarity -1
    assert res["cycles"][-1]["axes"][1]["velocityRaw"] < 0
    assert [f["commandSeq"] for f in fb] == [r.seq] * 2 and [f["tick"] for f in fb] == [r.s.tick - 1] * 2
    assert len(res["cycles"]) == 5 and len(res["vendor"]) == 2 and res["timing"]["exchanges"] == 5


@pytest.mark.parametrize("name", ["kit-sim-v1.json", "kit-sim-ac-v1.json"])
def test_position_rises_monotonically(name):
    r = Rig(kit(name))
    pos = []
    for _ in range(60):
        pos.append([f["positionRad"] for f in r.step(target=2.0)["feedback"]])
    for i in range(2):
        p = [x[i] for x in pos]
        assert all(b >= a for a, b in zip(p, p[1:])) and p[-1] > p[0] + 0.5


def test_the_ac_kit_is_remapped_to_carry_the_velocity_target():
    r = Rig(kit("kit-sim-ac-v1.json"), upto="configure")
    rx = [o for p, o, v in r.bus.writes if p == 1 and o.startswith("1600:0") and o != "1600:00"]
    assert len(rx) == 2   # the kit's rx: 6040:00, 60FF:00
    vals = [v for p, o, v in r.bus.writes if p == 1 and o in ("1600:01", "1600:02")]
    assert vals[-1] >> 16 == 0x60FF


def test_the_ac_kit_on_sm_sync_does_not_reach_op():
    k = kit("kit-sim-ac-v1.json")
    k["bus"]["sync"] = "sm_sync"
    r = Rig(k, upto="configure")
    assert code(r.do, "start") == "BENCH_NOT_OPERATIONAL"
    assert code(r.step) == "BENCH_ORDER_VIOLATION"


# ---- worker faults override the drive state ---------------------------------------------------------------------------------------------------------------------
def test_command_timeout_is_latched_by_the_worker_and_cleared_only_by_a_reset_edge():
    r = Rig()
    r.until(lambda x: states(x) == ["enabled"] * 2, target=1.0, faultReset=True)
    for k in range(1, 6):   # the last new seq was tick 1 of 6; DriveGroup trips on the 5th tick without one (watchdogTicks 5), and so does the worker
        res = r.step(target=1.0, fresh=False, faultReset=True)
        if k < 5:
            assert states(res) == ["enabled"] * 2, k
    assert states(res) == ["fault"] * 2 and [f["fault"] for f in res["feedback"]] == ["COMMAND_TIMEOUT"] * 2
    assert res["vendor"][0]["statusword"] & 0x4F != 0x08   # the slave itself is not in Fault
    assert controlwords(res)[:2] == [0x0002, 0x0000]
    for _ in range(5):   # faultReset held at 1 with new seqs: no edge, no clear, nothing toward enable
        res = r.step(target=1.0, faultReset=True)
        assert states(res) == ["fault"] * 2 and not set(controlwords(res)) & ADVANCING
    r.step(enable=False)
    res = r.step(enable=False, faultReset=True)
    assert states(res) == ["disabled"] * 2 and [f["fault"] for f in res["feedback"]] == [None, None]
    assert states(r.enable()) == ["enabled"] * 2


@pytest.mark.parametrize("route", ["method", "event"])
def test_overspeed_is_latched_by_the_worker(route):
    raw = round(1.3 * 20 * RAW)
    r = Rig(kit(events=[{"atCycle": 40, "do": "force_velocity", "position": 1, "rawVelocity": raw}]) if route == "event" else None)
    r.enable()
    if route == "method":
        r.bus.force_velocity(1, raw)
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=20)
    cws = controlwords(res)
    assert res["feedback"][0]["fault"] == "OVERSPEED" and not set(cws[cws.index(0x0002):]) & ADVANCING   # from the cycle the input showed it on
    r.bus.force_velocity(1, None)
    res = r.step(target=1.0)   # enable still asked, the latch holds: nothing toward enable on the faulted axis
    assert res["feedback"][0]["state"] == "fault" and not set(controlwords(res)) & ADVANCING
    for _ in range(10):
        res = r.step(enable=False)
    assert res["feedback"][0]["fault"] == "OVERSPEED"
    res = r.step(enable=False, faultReset=True)
    assert states(res) == ["disabled"] * 2


@pytest.mark.parametrize("route", ["method", "event"])
def test_a_drive_error_code_outside_the_fault_map_is_an_external_trip_with_the_raw_code(route):
    r = Rig(kit(events=[{"atCycle": 40, "do": "inject_error", "position": 1, "code": 0x1234}]) if route == "event" else None)
    r.enable()
    if route == "method":
        r.bus.inject_error(1, 0x1234)
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=20)
    assert res["feedback"][0]["fault"] == "EXTERNAL_TRIP" and res["vendor"][0]["errorCode"] == 0x1234
    assert res["feedback"][1]["state"] == "enabled"


def test_a_slave_that_boots_in_fault():
    res = Rig(kit(initialErrorCode=0x7500)).step(enable=False)
    assert states(res)[0] == "fault" and res["vendor"][0]["errorCode"] == 0x7500


@pytest.mark.parametrize("route", ["wkc_loss", "cut_logic"])
def test_a_lost_working_counter_is_feedback_loss(route):
    ev = {"atCycle": 40, "do": "wkc_loss", "cycles": 8} if route == "wkc_loss" else {"atCycle": 40, "do": "cut_power", "logic": True}
    r = Rig(kit(events=[ev]))
    r.enable()
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=20)
    assert [f["fault"] for f in res["feedback"]] == ["FEEDBACK_LOSS"] * 2
    assert min(row["wkc"] for row in res["cycles"]) == 0


def test_cutting_motor_power_trips_the_drive():
    r = Rig(kit(events=[{"atCycle": 40, "do": "cut_power", "logic": False}]))
    r.enable()
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=20)
    assert res["feedback"][0]["fault"] == "EXTERNAL_TRIP" and res["vendor"][0]["errorCode"] == 0x3220


def test_velocity_scale_knob():
    r = Rig(kit(velocityScale=0.8))
    r.enable()
    for _ in range(60):
        res = r.step(target=2.0)
    assert [f["velocityRadS"] for f in res["feedback"]] == pytest.approx([1.6, 1.6], abs=0.01)


def test_enable_delay_cycles_delays_operation_enabled():
    fast, slow = Rig(kit(enableDelayCycles=1)), Rig(kit(enableDelayCycles=30))
    count = lambda rig: next(k for k in range(100) if states(rig.step()) == ["enabled"] * 2)
    assert count(slow) - count(fast) >= 5


# ---- quick stop -------------------------------------------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("option,after", [(2, "disabled"), (6, "quick_stop")])
def test_quick_stop_follows_605a_and_never_enables_while_commanded(option, after):
    r = Rig(kit(quickStopOption=option))
    r.enable()
    for _ in range(20):
        res = r.step(target=2.0)
    seen = []
    for _ in range(30):
        res = r.step(target=2.0, quickStop=True)
        seen.append(states(res)[0])
        assert "enabled" not in states(res) and not any(set(controlwords(res, i)) & ADVANCING for i in range(2))
    assert seen[0] == "quick_stop" and seen[-1] == after
    assert states(r.enable()) == ["enabled"] * 2   # level semantics: quickStop back to 0 with enable 1 re-enables


def test_a_repeated_seq_can_add_a_quick_stop_but_not_an_enable():
    r = Rig()
    r.enable()
    res = r.step(target=1.0, fresh=False, quickStop=True)
    assert controlwords(res)[0] == 0x0002 and "enabled" not in states(res)
    res = r.step(target=1.0, fresh=False, quickStop=False)   # still the same seq: the quick stop stays
    assert not any(set(controlwords(res, i)) & ADVANCING for i in range(2))


@pytest.mark.parametrize("why", ["quickStop", "latched", "read_only", "silenced"])
def test_the_last_gate_blocks_enabling_words_on_its_own(monkeypatch, why):
    import bench_worker.session as session_module
    r = Rig()
    r.enable()
    monkeypatch.setattr(session_module, "next_controlword", lambda *a: 0x000F)   # a broken table: the gate alone must hold
    if why == "latched":
        r.s.latched = ["COMMAND_TIMEOUT"] * 2
        monkeypatch.setattr(session_module, "QUICK_STOP_CW", 0x000F)
    if why == "read_only":
        r.s.read_only = True
    if why == "silenced":
        r.s.phase = "silenced"
    for i in range(2):
        assert r.s._gate(i, 0x000F, False) == (0x000F if why == "quickStop" else 0)
    if why in ("quickStop", "latched"):
        res = r.step(target=1.0, quickStop=why == "quickStop")
        assert not any(set(controlwords(res, i)) & ADVANCING for i in range(2))


def test_ignore_quick_stop_knob_keeps_the_slave_enabled():
    r = Rig(kit(ignoreQuickStop=True))
    r.enable()
    res = r.step(target=1.0, quickStop=True)
    assert states(res) == ["enabled"] * 2 and controlwords(res)[-1] == 0x0002


# ---- limits ------------------------------------------------------------------------------------------------------------------------------------------------------------
def test_a_target_above_the_limit_is_refused_and_the_applied_target_is_kept():
    r = Rig()
    r.enable()
    for _ in range(30):
        res = r.step(target=2.0)
    before = res["cycles"][-1]["axes"][0]["targetRaw"]
    assert code(r.step, target=25.0) == "BENCH_LIMIT_EXCEEDED"
    res = r.step(target=2.0, fresh=False)
    assert res["cycles"][-1]["axes"][0]["targetRaw"] == before


# ---- 32-bit wrap ------------------------------------------------------------------------------------------------------------------------------------------------------
def test_position_beyond_2_31_stays_monotonic():
    r = Rig(kit(initialPositionRaw=2**31 - 20000))
    pos, raws = [], []
    for _ in range(60):
        res = r.step(target=2.0)
        pos.append(res["feedback"][0]["positionRad"])
        raws += [row["axes"][0]["positionRaw"] for row in res["cycles"]]
    assert min(raws) < 0 < max(raws)   # the raw int32 wrapped
    steps = [b - a for a, b in zip(pos, pos[1:])]
    assert all(0 <= s < 0.1 for s in steps)


# ---- silence and stop ------------------------------------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("watchdog", [100, None])
def test_silence_ends_the_session(watchdog):
    r = Rig(kit(watchdogMs=watchdog))
    r.enable()
    for _ in range(30):
        r.step(target=1.0)
    assert code(r.do, "silence", {"ms": 0}) == "BENCH_LIMIT_EXCEEDED"
    res = r.do("silence", {"ms": 1000})
    v = [a["velocityRadS"] for a in res["axes"]]
    if watchdog:
        assert res["alState"] != "OP" and all(s["errorCode"] for s in res["slaves"]) and v == pytest.approx([0, 0], abs=1e-3)
    else:
        assert res["alState"] == "OP" and min(v) > 0.5
    for op in ("open", "scan", "configure", "start", "silence"):
        assert code(r.do, op) == "BENCH_ORDER_VIOLATION"
    assert code(r.step) == "BENCH_ORDER_VIOLATION"
    r.do("describe")
    assert r.do("stop")["controlwords"] == [0, 0]


@pytest.mark.parametrize("option", [2, 6])
def test_stop_ends_with_controlword_zero_on_every_axis(option):
    r = Rig(kit(quickStopOption=option))
    r.enable()
    for _ in range(20):
        r.step(target=2.0)
    assert r.do("stop")["controlwords"] == [0, 0]
    assert code(r.step) == "BENCH_ORDER_VIOLATION"


def test_stop_before_start_writes_nothing():
    r = Rig(upto="scan")
    assert r.do("stop")["controlwords"] == [0, 0] and r.bus.writes == []


# ---- the process: stdio lines, roles, stdin close = stop --------------------------------------------------------------------------------------------------------------
def run_worker(*args, stdin=""):
    # -I drops the working directory from sys.path, so the package root comes in as an argument (the shape of python-env.ts' bootstrap)
    boot = "import runpy, sys; sys.path.insert(0, sys.argv.pop(1)); runpy.run_module('bench_worker', run_name='__main__', alter_sys=True)"
    return subprocess.run([sys.executable, "-I", "-B", "-c", boot, str(BENCH), *args], input=stdin, capture_output=True, text=True, cwd=BENCH, timeout=60)


def req(op, tick=0, payload=None, rid=None):
    return json.dumps({"protocol": "mekoniq-bench/1", "requestId": rid or op, "sessionId": "t", "expectedTick": tick, "op": op, "payload": payload or {}})


def test_the_process_answers_one_line_per_request_and_stdin_close_is_stop():
    lines = [req("describe"), req("open"), req("scan"), req("configure"), req("start")]
    for t in range(3):
        lines.append(req("step", t, {"commands": [{"axisId": a, "seq": t + 1, "mode": "csv", "target": 0.5, "enable": True, "quickStop": False, "faultReset": False} for a in AXES]}, f"s{t}"))
    lines.append("{not json")
    p = run_worker("--role", "bus", "--kit", str(FIX / "kit-sim-v1.json"), "--bus", "sim", "--session-id", "t", stdin="\n".join(lines) + "\n")
    out = [json.loads(x) for x in p.stdout.splitlines()]
    assert [o["ok"] for o in out] == [True] * 8 + [False]
    assert out[-1]["error"]["code"] == "BENCH_ORDER_VIOLATION" and out[-1]["requestId"] == "invalid"
    assert all(set(o) <= {"requestId", "ok", "tick", "result", "error"} for o in out)
    assert out[7]["tick"] == 3 and len(out[7]["result"]["feedback"]) == 2
    assert json.loads(p.stderr.strip().splitlines()[-1]) == {"event": "stopped", "controlwords": [0, 0]}
    assert p.returncode == 1   # a malformed line is fatal: the worker stops the drives and exits


def test_stdin_closing_is_a_stop():
    p = run_worker("--role", "bus", "--kit", str(FIX / "kit-sim-v1.json"), "--bus", "sim", "--session-id", "t", stdin=req("describe") + "\n")
    assert p.returncode == 0 and json.loads(p.stderr.strip().splitlines()[-1]) == {"event": "stopped", "controlwords": [0, 0]}


def test_a_request_of_another_session_is_refused():
    p = run_worker("--role", "bus", "--kit", str(FIX / "kit-sim-v1.json"), "--bus", "sim", "--session-id", "other", stdin=req("describe") + "\n" + req("stop") + "\n")
    out = [json.loads(x) for x in p.stdout.splitlines()]
    assert out[0]["ok"] is False and out[0]["error"]["code"] == "BENCH_ORDER_VIOLATION"


@pytest.mark.parametrize("args,msg", [(("--role", "sensors", "--bus", "sim"), "K06"), (("--role", "bus", "--bus", "soem"), "soem bus is added in K08")])
def test_roles_and_buses_not_built_yet_exit_2(args, msg):
    p = run_worker(*args, "--kit", str(FIX / "kit-sim-v1.json"), "--session-id", "t")
    assert p.returncode == 2 and msg in p.stderr and p.stdout == ""


def test_the_bus_role_imports_no_sensor_module(monkeypatch, capsys):
    from bench_worker.__main__ import main
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO((req("describe") + "\n").encode())))
    assert main(["--role", "bus", "--kit", str(FIX / "kit-sim-v1.json"), "--bus", "sim", "--session-id", "t"]) == 0
    assert not [m for m in sys.modules if m.startswith("bench_worker.") and ("sensor" in m or "lidar" in m or "imu" in m)]
    assert json.loads(capsys.readouterr().out.splitlines()[0])["ok"] is True


def test_an_internal_fault_answers_worker_lost_and_still_stops(tmp_path):
    k = kit(events=[{"atCycle": 0, "do": "explode"}])
    (tmp_path / "kit.json").write_text(json.dumps(k))
    lines = [req("open"), req("scan"), req("configure"), req("start"),
             req("step", 0, {"commands": [{"axisId": a, "seq": 1, "mode": "csv", "target": 0.0, "enable": True, "quickStop": False, "faultReset": False} for a in AXES]})]
    p = run_worker("--role", "bus", "--kit", str(tmp_path / "kit.json"), "--bus", "sim", "--session-id", "t", stdin="\n".join(lines) + "\n")
    out = [json.loads(x) for x in p.stdout.splitlines()]
    assert out[-1]["ok"] is False and out[-1]["error"]["code"] == "WORKER_LOST" and p.returncode == 1
    assert json.loads(p.stderr.strip().splitlines()[-1]) == {"event": "stopped", "controlwords": [0, 0]}
