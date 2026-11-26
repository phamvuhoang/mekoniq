import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics' / 'bench'))

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


def coasted(r):
    return any(s.coasted_while_moving for s in r.bus.slaves)


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


@pytest.mark.parametrize("option", [2, 6])
def test_scan_reads_the_requested_objects_also_in_read_only(option):
    r = Rig(kit(quickStopOption=option), read_only=True, upto="open")
    assert [s["objects"] for s in r.do("scan", {"objects": ["605A:00"]})["slaves"]] == [{"605A:00": option}] * 2
    assert r.bus.writes == []


def test_scan_reads_strings_on_request_also_in_read_only_and_writes_nothing():
    r = Rig(read_only=True, upto="open")
    slaves = r.do("scan", {"strings": ["100A:00", "1009:00", "1008:00"], "objects": ["6502:00"]})["slaves"]
    assert [s["strings"] for s in slaves] == [{"100A:00": "SIM-FW 1.0.0", "1009:00": "SIM-HW 1", "1008:00": "MEKONIQ simulated CiA 402 slave"}] * 2
    assert [s["objects"] for s in slaves] == [{"6502:00": 0x104}] * 2      # pv (bit 2) and csv (bit 8)
    assert r.bus.writes == []
    assert [s["strings"] for s in Rig(upto="scan").do("scan")["slaves"]] == [{}, {}]


def test_scan_strings_and_modes_are_simslave_knobs_and_a_malformed_string_object_is_refused():
    r = Rig(kit(strings={"100A:00": "V1.07"}, supportedModes=0x80), upto="open")
    slaves = r.do("scan", {"strings": ["100A:00", "1009:00"], "objects": ["6502:00"]})["slaves"]
    assert [s["strings"] for s in slaves] == [{"100A:00": "V1.07", "1009:00": ""}] * 2
    assert [s["objects"]["6502:00"] for s in slaves] == [0x80] * 2
    for bad in (["100a:00"], "100A:00", [1]):
        assert code(Rig(upto="open").do, "scan", {"strings": bad}) == "BENCH_ORDER_VIOLATION"


def test_scan_without_objects_reads_none_and_a_malformed_object_is_refused():
    assert [s["objects"] for s in Rig(upto="scan").do("scan")["slaves"]] == [{}, {}]
    assert code(Rig(upto="open").do, "scan", {"objects": ["605A"]}) == "BENCH_ORDER_VIOLATION"


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
def test_command_timeout_trips_on_the_5th_tick_without_a_fresh_seq_as_drive_group_does_and_clears_only_on_a_reset_edge():
    r = Rig()
    r.until(lambda x: states(x) == ["enabled"] * 2, target=1.0, faultReset=True)
    for _ in range(10):   # at speed: a trip at rest would (rightly) disable at once, without the quick-stop ramp
        r.step(target=1.0, faultReset=True)
    # The contract is DriveGroup's: watchdogTicks 5 trips on the 5th tick without a new seq, not the 6th. Do not "fix" this to 6.
    for k in range(1, 6):
        res = r.step(target=1.0, fresh=False, faultReset=True)
        if k < 5:
            assert states(res) == ["enabled"] * 2, k
    assert states(res) == ["fault"] * 2 and [f["fault"] for f in res["feedback"]] == ["COMMAND_TIMEOUT"] * 2
    assert res["vendor"][0]["statusword"] & 0x4F != 0x08   # the slave itself is not in Fault
    assert controlwords(res)[0] == 0x0002   # the quick-stop sequence starts in the tripping cycle (its full history: test_the_quick_stop_ramp_is_held_*)
    for _ in range(5):   # faultReset held at 1 with new seqs: no edge, no clear, nothing toward enable
        res = r.step(target=1.0, faultReset=True)
        assert states(res) == ["fault"] * 2 and not set(controlwords(res)) & ADVANCING
    r.step(enable=False)
    res = r.step(enable=False, faultReset=True)
    assert states(res) == ["disabled"] * 2 and [f["fault"] for f in res["feedback"]] == [None, None]
    assert not coasted(r)
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
    for _ in range(60):   # the quick-stop ramp from 26 rad/s runs about 55 ticks before the cause (speed) is gone
        res = r.step(enable=False)
    assert res["feedback"][0]["fault"] == "OVERSPEED"
    res = r.step(enable=False, faultReset=True)
    assert states(res) == ["disabled"] * 2 and not coasted(r)


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


def test_a_stale_enable_on_a_disabled_axis_is_not_an_enable_timeout():
    # K03 minor: the enable timeout counted on an expired channel and reported EXTERNAL_TRIP where the cause is the stale command (no new seq)
    r = Rig(kit(motorPower=False))
    r.step()
    for _ in range(150):
        res = r.step(fresh=False)
    assert states(res) == ["disabled"] * 2 and [f["fault"] for f in res["feedback"]] == [None, None]
    for _ in range(100):   # fresh commands that cannot enable still latch (R-b)
        res = r.step()
    assert [f["fault"] for f in res["feedback"]] == ["EXTERNAL_TRIP"] * 2


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
@pytest.mark.parametrize("option,after", [(2, "disabled"), (6, "quick_stop")])   # what follows a commanded quick stop is the drive's own (605Ah, spec 5.1)
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
    assert seen[0] == "quick_stop" and seen[-1] == after and [f["fault"] for f in res["feedback"]] == [None, None] and not coasted(r)
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
        monkeypatch.setattr(session_module, "quick_stop_word", lambda *a, **k: 0x000F)
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
    rec = record(r)
    stop = r.do("stop")
    assert stop["controlwords"] == [0, 0]
    # the last word went out at rest; a bus out of OP reads nothing, so the speed is unknown there (the silence result above saw it at rest)
    assert stop["velocityRadS"] == ([None, None] if watchdog else pytest.approx([0, 0], abs=0.05))
    if not watchdog:   # the slave did not trip and still runs in Operation enabled: stop must hold the ramp, not cut torque
        assert_held(rec)
    assert not coasted(r)


@pytest.mark.parametrize("option", [2, 6])
def test_stop_ends_with_controlword_zero_on_every_axis(option):
    r = Rig(kit(quickStopOption=option))
    r.enable()
    for _ in range(20):
        r.step(target=2.0)
    stop = r.do("stop")
    assert stop["controlwords"] == [0, 0] and stop["velocityRadS"] == pytest.approx([0, 0], abs=0.05) and not coasted(r)
    assert code(r.step) == "BENCH_ORDER_VIOLATION"


def test_stop_before_start_writes_nothing():
    r = Rig(upto="scan")
    assert r.do("stop") == {"controlwords": [0, 0], "velocityRadS": [None, None]} and r.bus.writes == []


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


@pytest.mark.parametrize("role", ["bus", "sensors"])
def test_the_soem_bus_is_not_built_yet_exit_2(role):
    p = run_worker("--role", role, "--bus", "soem", "--kit", str(FIX / "kit-sim-v1.json"), "--session-id", "t")
    assert p.returncode == 2 and "soem bus is added in K08" in p.stderr and p.stdout == ""


# the role isolation, both ways, is tests/hardware/test_bench_sensors.py::test_the_two_roles_never_import_each_others_modules (a fresh process per role)


def test_an_internal_fault_answers_worker_lost_and_still_stops(tmp_path):
    k = kit(events=[{"atCycle": 0, "do": "explode"}])
    (tmp_path / "kit.json").write_text(json.dumps(k))
    lines = [req("open"), req("scan"), req("configure"), req("start"),
             req("step", 0, {"commands": [{"axisId": a, "seq": 1, "mode": "csv", "target": 0.0, "enable": True, "quickStop": False, "faultReset": False} for a in AXES]})]
    p = run_worker("--role", "bus", "--kit", str(tmp_path / "kit.json"), "--bus", "sim", "--session-id", "t", stdin="\n".join(lines) + "\n")
    out = [json.loads(x) for x in p.stdout.splitlines()]
    assert out[-1]["ok"] is False and out[-1]["error"]["code"] == "WORKER_LOST" and p.returncode == 1
    assert json.loads(p.stderr.strip().splitlines()[-1]) == {"event": "stopped", "controlwords": [0, 0]}


# ---- the quick-stop ramp is never cut short (K03 concern round, change 2) --------------------------------------------------------------------------------------------
REST = 0.05 * RAW   # channel.quickStopRestRadS default, in raw units


def record(rig):
    """Every exchange of the rig as (controlword, statusword, velocityRaw) of slave 1."""
    rec, orig = [], rig.bus.exchange

    def ex(outs):
        ins = orig(outs)
        rec.append((outs[0]["controlword"], ins[0]["statusword"], ins[0]["velocityRaw"]))
        return ins
    rig.bus.exchange = ex
    return rec


def at_speed(rig):
    rig.enable()
    for _ in range(30):
        res = rig.step(target=5.0)
    assert res["feedback"][0]["velocityRadS"] == pytest.approx(5.0, abs=0.01)


def trigger(rig, how):
    if how == "disable":
        for _ in range(40):
            rig.step(target=5.0, enable=False)
    elif how == "watchdog":
        for _ in range(45):
            rig.step(target=5.0, fresh=False)
    else:
        rig.do("stop")


def assert_held(rec, cpt=5):
    cws = [c for c, _, _ in rec]
    first = cws.index(0x0002)
    j = cws.index(0x0000, first)
    assert j - first >= 10 and set(cws[first:j]) == {0x0002}                     # 0x0002 ... 0x0002, several ticks of it
    left = rec[j - 1][1] & 0x6F != 0x0007                                          # (a) the drive left Quick stop active by itself
    rested = all(abs(v) < REST for _, _, v in rec[j - cpt:j])                      # (b) below the rest threshold for a whole tick
    assert left or rested, rec[j - cpt - 1:j + 1]


@pytest.mark.parametrize("option", [2, 6])
@pytest.mark.parametrize("how", ["disable", "watchdog", "stop"])   # the three paths whose goal is to end disabled (ruling round)
def test_the_quick_stop_ramp_is_held_until_rest_or_until_the_drive_leaves(option, how):
    r = Rig(kit(quickStopOption=option))
    at_speed(r)
    rec = record(r)
    trigger(r, how)
    assert_held(rec)
    assert not any(s.coasted_while_moving for s in r.bus.slaves)
    if how != "stop":
        assert r.do("stop")["controlwords"] == [0, 0]


@pytest.mark.parametrize("how", ["disable", "stop"])
def test_quick_stop_hold_ms_is_live_and_ends_the_hold_by_time(how):
    k = kit(quickStopOption=6)
    k["channel"]["quickStopHoldMs"] = 40
    r = Rig(k)
    at_speed(r)
    rec = record(r)
    trigger(r, how)
    cws = [c for c, _, _ in rec]
    first = cws.index(0x0002)
    assert cws.index(0x0000, first) - first == 10                                  # 40 ms = 10 cycles of 4 ms, then disable voltage while still moving
    assert r.bus.slaves[0].coasted_while_moving


def test_stop_with_the_default_hold_stays_inside_its_ack_deadline():
    r = Rig(kit(quickStopOption=6, quickStopDecelRawPerCycle=1))   # a drive that barely decelerates: only the hold time ends the stop
    at_speed(r)
    rec = record(r)
    t0 = __import__("time").monotonic()
    assert r.do("stop")["controlwords"] == [0, 0]
    assert __import__("time").monotonic() - t0 < 1.0
    assert len(rec) * 4 <= 2000 + 2 * 4                                           # the default hold of 2000 ms bounds the bus time too, far inside the 5 s ACK


# ---- the fault map travels in the kit (change 3) and the working-counter threshold (change 4) ------------------------------------------------------------------------
@pytest.mark.parametrize("raw,fault", [(0x7500, "COMMAND_TIMEOUT"), (0x2222, "EXTERNAL_TRIP"), (0x1234, "EXTERNAL_TRIP")])
def test_the_kit_fault_map_names_drive_errors_and_keeps_the_raw_code(raw, fault):
    k = kit()
    k["axes"][0]["faultMap"] = {"0x7500": "COMMAND_TIMEOUT", "0x2222": "OTHER"}
    r = Rig(k)
    r.enable()
    r.bus.inject_error(1, raw)
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=5)
    assert res["feedback"][0]["fault"] == fault and res["vendor"][0]["errorCode"] == raw


@pytest.mark.parametrize("knob,lost,expect", [(2, 3, "FEEDBACK_LOSS"), (None, 3, None)])
def test_wkc_error_cycles_to_loss_is_a_kit_knob(knob, lost, expect):
    k = kit(events=[{"atCycle": 40, "do": "wkc_loss", "cycles": lost}])
    if knob:
        k["channel"]["wkcErrorCyclesToLoss"] = knob
    r = Rig(k)
    r.enable()
    faults = set()
    for _ in range(12):
        faults |= {f["fault"] for f in r.step()["feedback"]}
    assert (expect in faults) if expect else faults == {None}


# ---- ruling round: a commanded quick stop is left to the drive; only fault, stop and disable release it at rest ------------------------------------------------------
def test_a_commanded_quick_stop_on_605a_6_is_held_by_the_drive_and_never_released_by_the_worker():
    r = Rig(kit(quickStopOption=6))
    at_speed(r)
    rec = record(r)
    for _ in range(60):
        res = r.step(target=5.0, quickStop=True)
    assert states(res) == ["quick_stop"] * 2 and res["feedback"][0]["velocityRadS"] == pytest.approx(0, abs=1e-3)
    assert {c for c, _, _ in rec} == {0x0002}
    assert not any(s.coasted_while_moving for s in r.bus.slaves)


def test_dropping_enable_at_rest_disables_at_once():
    r = Rig()
    r.enable()
    for _ in range(3):
        r.step(target=0.0)
    res = r.step(enable=False)
    assert controlwords(res)[0] == 0x0000 and states(res) == ["disabled"] * 2


@pytest.mark.parametrize("resume,after", [(True, "enabled"), (False, "quick_stop")])
def test_leaving_a_held_quick_stop_asks_for_operation_enabled(resume, after):
    r = Rig(kit(quickStopOption=6, quickStopResume=resume))
    at_speed(r)
    for _ in range(30):
        r.step(target=5.0, quickStop=True)
    rec = record(r)
    for _ in range(5):
        res = r.step(target=1.0)
    assert states(res) == [after] * 2
    assert 0x0000 not in {c for c, _, _ in rec}
    assert rec[0][0] == 0x000F


# ---- fix round 1 -----------------------------------------------------------------------------------------------------------------------------------------------------
def test_the_double_coasts_when_torque_is_cut_from_operation_enabled_at_speed():
    r = Rig()
    at_speed(r)
    v0 = r.bus.slaves[0].vel
    for _ in range(5):
        r.bus.exchange([{"controlword": 0x0000, "targetRaw": 0}] * 2)
    assert coasted(r) and r.bus.slaves[0].vel > 0.9 * v0   # freewheeling, not a 20 ms stop


SDO_FORBIDDEN = ["1010:01", "1600:01", "1A00:01", "1C12:00", "1C13:00", "6040:00", "6060:00", "60FF:00", "6071:00", "607A:00", "60B1:00", "60B2:00", "60FE:01"]


@pytest.mark.parametrize("obj", SDO_FORBIDDEN)
def test_kit_sdo_writes_can_never_command_motion_or_state(obj):
    r = Rig(with_sdo(kit(), {"object": obj, "value": 9 if obj == "6060:00" else 15, "bytes": 2}), upto="scan")
    assert code(r.do, "configure") == "BENCH_SDO_NOT_LISTED" and r.bus.writes == []


@pytest.mark.parametrize("faults", [False, True])
def test_a_lost_enable_latches_and_never_restarts_without_a_reset_edge(faults):
    r = Rig(kit(powerLossFaults=faults, events=[{"atCycle": 200, "do": "cut_power", "logic": False}, {"atCycle": 260, "do": "restore_power"}]))
    at_speed(r)
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=40, target=5.0)
    assert res["feedback"][0]["fault"] == "EXTERNAL_TRIP"
    for _ in range(40):   # power is back, enable is still asked, no reset edge: the axis stays down
        res = r.step(target=0.0)
        assert res["feedback"][0]["state"] == "fault" and not set(controlwords(res)) & ADVANCING
    if not faults:
        assert res["vendor"][0]["statusword"] & 0x4F == 0x40 and res["vendor"][0]["errorCode"] == 0   # the drive itself sits in Switch on disabled, no error
    r.step(target=0.0, faultReset=True)
    assert states(r.until(lambda x: states(x) == ["enabled"] * 2, n=10)) == ["enabled"] * 2


@pytest.mark.parametrize("rev,ok", [(None, True), ("1", True), ("0x00000001", True), ("2", False)])
def test_identity_includes_the_revision_when_the_kit_expects_one(rev, ok):
    k = kit()
    k["axes"][0]["expect"]["revision"] = rev
    r = Rig(k, upto="scan")
    if ok:
        r.do("configure")
    else:
        assert code(r.do, "configure") == "BENCH_IDENTITY_CHANGED" and r.bus.writes == []


# ---- fix round 2: a latched axis can still reset a faulted drive (R-a); an enable that does not succeed latches (R-b) ------------------------------------------------------
def drop_power_at_speed(k):
    r = Rig(k)
    at_speed(r)
    r.bus.cut_power()
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=10, target=5.0)
    assert res["feedback"][0]["fault"] == "EXTERNAL_TRIP" and res["vendor"][0]["statusword"] & 0x4F == 0x40   # worker latch, drive in Switch on disabled
    return r


def test_a_drive_fault_after_the_trip_needs_two_reset_edges_one_for_the_drive_one_for_the_latch():
    r = drop_power_at_speed(kit(powerLossFaults=False))
    for _ in range(20):
        r.step(target=0.0)
    r.bus.restore_power()
    r.bus.inject_error(1, 0x3220)
    res = r.until(lambda x: x["vendor"][0]["statusword"] & 0x4F == 0x08, n=5, target=0.0)
    res = r.step(target=0.0, faultReset=True)          # first rising edge: reset the drive, keep the worker latch
    cws = [row["axes"][0]["controlword"] for row in res["cycles"]]
    assert cws.count(0x0080) == 1 and cws[0] == 0x0080 and not set(cws) & ADVANCING
    assert res["vendor"][0]["statusword"] & 0x4F == 0x40 and res["feedback"][0]["fault"] == "EXTERNAL_TRIP"
    for _ in range(5):                                 # faultReset held high: no edge, no second pulse, no clear
        res = r.step(target=0.0, faultReset=True)
        assert 0x0080 not in controlwords(res) and res["feedback"][0]["fault"] == "EXTERNAL_TRIP"
    r.step(target=0.0)
    res = r.step(target=0.0, faultReset=True)          # second rising edge: the drive is not in Fault, the latch clears
    assert res["feedback"][0]["fault"] is None
    assert r.until(lambda x: x["feedback"][0]["state"] == "enabled", n=10)


def test_a_held_reset_never_clears_a_second_trip():
    r = drop_power_at_speed(kit(powerLossFaults=False))
    r.bus.restore_power()
    r.step(target=0.0, faultReset=True)
    r.until(lambda x: x["feedback"][0]["state"] == "enabled", n=10, faultReset=True)
    r.bus.inject_error(1, 0x3220)
    res = r.until(lambda x: x["feedback"][0]["state"] == "fault", n=5, faultReset=True)
    for _ in range(10):
        res = r.step(target=0.0, faultReset=True)
        assert res["feedback"][0]["state"] == "fault" and 0x0080 not in controlwords(res)


def test_an_enable_that_does_not_succeed_latches_after_enable_timeout_ticks():
    k = kit(powerLossFaults=False)
    k["channel"]["enableTimeoutTicks"] = 10
    r = drop_power_at_speed(k)
    res = r.step(target=0.0, faultReset=True)          # power still absent: the drive is not in Fault, the latch clears ...
    assert res["feedback"][0]["fault"] is None
    seen = [r.step(target=0.0)["feedback"][0] for _ in range(12)]
    assert [f["state"] for f in seen[:8]] == ["disabled"] * 8 and seen[-1]["fault"] == "EXTERNAL_TRIP"   # ... but the enable attempt does not stay armed
    r.bus.restore_power()
    for _ in range(20):
        res = r.step(target=0.0)
        assert res["feedback"][0]["state"] == "fault" and not set(controlwords(res)) & ADVANCING


def test_a_session_without_motor_power_never_enables_and_latches_at_the_timeout():
    k = kit(motorPower=False)
    k["channel"]["enableTimeoutTicks"] = 10
    r = Rig(k)
    seen = [r.step(target=0.0) for _ in range(12)]
    assert all(states(x) != ["enabled"] * 2 for x in seen) and [f["fault"] for f in seen[-1]["feedback"]] == ["EXTERNAL_TRIP"] * 2
    r.bus.restore_power()
    for _ in range(20):
        res = r.step(target=0.0)
        assert "enabled" not in states(res) and not any(set(controlwords(res, i)) & ADVANCING for i in range(2))
