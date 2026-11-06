"""Worker-side clock evidence (SIM-07/08): semantic barrier ledger with ACK/timeout/skew, a /clock-to-wall mapping fit, and TwinSample telemetry
with boot/seq identity, origin physics_sim and explicit quality. Pure Python; no Gazebo was run to pass these."""
import math

import pytest

from bridge.clock_barrier import BarrierLedger, clock_mapping
from bridge.telemetry import TelemetryStream, pose_from_gz


class Mono:
    def __init__(self):
        self.ns = 1_000_000

    def __call__(self):
        return self.ns


def test_barrier_completes_with_every_ack_and_records_skew():
    mono = Mono()
    ledger = BarrierLedger(timeout_ns=5_000_000_000, monotonic_ns=mono)
    ledger.open("amr-docked:m-1", ["gazebo_nav2", "linuxcnc_sim"])
    assert ledger.status("amr-docked:m-1") == {"status": "pending", "missing": ["gazebo_nav2", "linuxcnc_sim"], "skewNs": None}
    ledger.ack("amr-docked:m-1", "gazebo_nav2", sim_time_ns=40_000_000_000, clock_ns=1_700_000_000_000_000_000)
    mono.ns += 2_000_000
    ledger.ack("amr-docked:m-1", "linuxcnc_sim", sim_time_ns=None, clock_ns=1_700_000_000_004_000_000)
    assert ledger.status("amr-docked:m-1") == {"status": "complete", "missing": [], "skewNs": 4_000_000}
    record = ledger.record("amr-docked:m-1")
    assert [a["participant"] for a in record["acks"]] == ["gazebo_nav2", "linuxcnc_sim"]
    assert [a["receivedMonotonicNs"] for a in record["acks"]] == ["1000000", "3000000"]  # wire form: nanoseconds as digit strings
    assert record["sha256"] and len(record["sha256"]) == 64
    with pytest.raises(ValueError, match="BARRIER_PARTICIPANT_UNKNOWN"):
        ledger.ack("amr-docked:m-1", "browser", None, 1)


def test_barrier_times_out_naming_the_silent_participant_and_ignores_late_acks():
    mono = Mono()
    ledger = BarrierLedger(timeout_ns=1_000, monotonic_ns=mono)
    ledger.open("cup-ready:j-1", ["coffee_io_sim", "linuxcnc_sim"])
    ledger.ack("cup-ready:j-1", "coffee_io_sim", 1, 1)
    mono.ns += 1_000
    assert ledger.check_timeouts() == ["cup-ready:j-1"]
    assert ledger.status("cup-ready:j-1") == {"status": "timeout", "missing": ["linuxcnc_sim"], "skewNs": None}
    ledger.ack("cup-ready:j-1", "linuxcnc_sim", 1, 2)
    assert ledger.status("cup-ready:j-1")["status"] == "timeout"
    with pytest.raises(ValueError, match="BARRIER_ID_INVALID"):
        ledger.open("bad id", ["x"])


def test_clock_mapping_fits_offset_and_drift_and_refuses_too_few_samples():
    samples = [(sim, 1_700_000_000_000_000_000 + sim + sim // 1_000_000) for sim in range(0, 10_000_000_000, 1_000_000_000)]  # 1 ppm drift
    fit = clock_mapping(samples)
    assert fit["samples"] == 10 and abs(fit["offsetNs"] - 1_700_000_000_000_000_000) < 1_000 and abs(fit["driftPpm"] - 1.0) < 0.01
    assert fit["residualMaxNs"] < 10
    assert clock_mapping([(0, 1)]) == {"samples": 1, "offsetNs": None, "driftPpm": None, "residualMaxNs": None, "reason": "INSUFFICIENT_SAMPLES"}


def test_telemetry_stream_stamps_boot_seq_sim_time_and_physics_origin():
    stream = TelemetryStream(run_id="run-1", provider_id="gazebo_nav2", boot_id="boot-a")
    a = stream.sample("amr-1", "map", sim_time_ns=20_000_000, observed={"xM": 1.0, "yM": 2.0, "yawRad": 0.5})
    b = stream.sample("amr-1", "map", sim_time_ns=40_000_000, observed={"xM": 1.1, "yM": 2.0, "yawRad": 0.5}, quality="stale", reason_codes=["SENSOR_STALE"])
    assert (a["seq"], b["seq"]) == ("1", "2") and a["bootId"] == "boot-a" and a["simTimeNs"] == "20000000" and a["origin"] == "physics_sim"
    assert a["schemaVersion"] == 2 and a["runId"] == "run-1" and a["providerId"] == "gazebo_nav2" and a["quality"] == "valid" and a["commanded"] is None
    assert b["quality"] == "stale" and b["reasonCodes"] == ["SENSOR_STALE"] and a["receivedMonotonicNs"] == "0"  # stamped by the gateway, not here
    stream.reboot("boot-b")
    c = stream.sample("amr-1", "map", sim_time_ns=60_000_000, observed={"xM": 1.2, "yM": 2.0, "yawRad": 0.5})
    assert (c["bootId"], c["seq"]) == ("boot-b", "1")
    with pytest.raises(ValueError, match="SIM_TIME_INVALID"):
        stream.sample("amr-1", "map", sim_time_ns=-1, observed={"xM": 0, "yM": 0, "yawRad": 0})
    with pytest.raises(ValueError, match="OBSERVED_NOT_FINITE"):
        stream.sample("amr-1", "map", sim_time_ns=1, observed={"xM": float("nan"), "yM": 0, "yawRad": 0})


def test_pose_from_gz_converts_quaternion_to_yaw_and_keeps_metres():
    msg = {"name": "robot_amr_1", "position": {"x": 2.5, "y": 1.25, "z": 0.02}, "orientation": {"x": 0, "y": 0, "z": math.sin(math.pi / 4), "w": math.cos(math.pi / 4)}}
    assert pose_from_gz(msg) == {"xM": 2.5, "yM": 1.25, "yawRad": pytest.approx(math.pi / 2)}
    with pytest.raises(ValueError, match="POSE_INVALID"):
        pose_from_gz({"name": "x", "position": {"x": "1", "y": 0}, "orientation": {"x": 0, "y": 0, "z": 0, "w": 1}})
