import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics' / 'bench'))

import json

import pytest

from bench_worker import BenchError
from bench_worker.channel import CommandChannel

MUJOCO = Path(__file__).resolve().parents[2] / 'robotics' / 'simulation-mujoco'
sys.path.insert(0, str(MUJOCO))
from mujoco_worker.drive_model import DriveGroup  # noqa: E402  (pure module: no mujoco import)


def channel(**over):
    kw = dict(accel_rad_s2=20, max_speed_rad_s=20, cycles_per_tick=5, cycle_s=0.004, watchdog_ticks=5, interpolation="hold") | over
    return CommandChannel(**kw)


def cmd(seq, target, **over):
    return {"axisId": "amr-1/wheel-left", "seq": seq, "mode": "csv", "target": target, "enable": True, "quickStop": False, "faultReset": False} | over


def test_the_ramp_rises_by_accel_times_cycle_and_stops_at_the_target():
    ch = channel()
    ch.accept(cmd(1, 5.0))
    out = [ch.cycle()[0] for _ in range(5)]
    assert out == pytest.approx([0.08, 0.16, 0.24, 0.32, 0.40], abs=1e-12)
    for _ in range(200):
        ch.accept(cmd(ch.seq + 1, 5.0))
        for _ in range(5):
            t, _ = ch.cycle()
            assert t <= 5.0
    assert t == 5.0


def test_a_target_above_the_limit_is_refused_and_changes_nothing():
    ch = channel()
    ch.accept(cmd(1, 2.0))
    before = [ch.cycle()[0] for _ in range(5)]
    with pytest.raises(BenchError) as e:
        ch.accept(cmd(2, 25.0))
    assert e.value.code == "BENCH_LIMIT_EXCEEDED"
    with pytest.raises(BenchError):
        ch.accept(cmd(2, float("nan")))
    assert ch.seq == 1
    ch.accept(cmd(1, 2.0))  # the same seq: the channel still holds 2.0
    assert ch.cycle()[0] == pytest.approx(before[-1] + 0.08, abs=1e-12)


def test_a_backwards_seq_is_refused():
    ch = channel()
    ch.accept(cmd(3, 1.0))
    with pytest.raises(BenchError) as e:
        ch.accept(cmd(2, 1.0))
    assert e.value.code == "DRIVE_COMMAND_SEQ_INVALID"


def test_the_watchdog_expires_on_the_5th_tick_without_a_new_seq_as_drive_group_does():
    # The contract is DriveGroup's (test_the_channel_matches_drive_group): watchdogTicks 5 expires in the 5th tick without a new seq, not the 6th. Do not "fix" it.
    ch = channel()
    ch.accept(cmd(1, 1.0))
    flags = []
    for tick in range(6):
        ch.accept(cmd(1, 1.0))  # repeated: no error, no new seq
        flags += [ch.cycle()[1] for _ in range(5)]
    assert flags[:25] == [False] * 25  # 5 x 5 = 25 cycles since the last new seq ...
    assert flags[25] is True           # ... and the next cycle reports the watchdog
    ch.accept(cmd(2, 1.0))
    assert ch.cycle()[1] is False


def test_no_fresh_seq_yet_counts_as_expired():
    assert channel().cycle()[1] is True


def test_linear_interpolation_between_two_ticks():
    ch = channel(interpolation="linear")
    ch.accept(cmd(1, 0.0))
    [ch.cycle() for _ in range(5)]
    ch.accept(cmd(2, 0.4))
    assert [ch.cycle()[0] for _ in range(5)] == pytest.approx([0.08, 0.16, 0.24, 0.32, 0.40], abs=1e-12)


def test_neutral_drops_the_target_and_the_ramp():
    ch = channel()
    ch.accept(cmd(1, 2.0))
    [ch.cycle() for _ in range(5)]
    ch.neutral()
    assert ch.cycle()[0] == 0.0


# ---- the virtual drive is the reference (ruling R3): same command sequence, same applied target per substep, same watchdog tick ------------------------------------
FX = MUJOCO / "fixtures" / "drive-v1"
TARGETS = [0.0, 1.0, 1.0, 3.0, -2.0, -2.0, 5.0, 5.0, 0.4, 0.0, 0.4, 2.0, 2.5, -0.3]   # 14 fresh commands, then 6 repeats: 20 commands


@pytest.mark.parametrize("interpolation", ["hold", "linear"])
def test_the_channel_matches_drive_group(interpolation):
    model = json.loads((FX / "serve-drive-ideal-v1.json").read_text())
    control = json.loads((FX / "serve-control-v1.json").read_text())
    assert all(a["commandDelaySubsteps"] == 0 for a in model["axes"])
    for a in model["axes"]:
        a["watchdogTicks"], a["commandInterpolation"] = 5, interpolation
    for a in control["axes"]:
        a["accelerationLimit"] = 20
    g = DriveGroup(model, control, 0.002, 10, {a["axisId"]: (-20, 20) for a in model["axes"]})
    g.reset([0.0, 0.0])
    assert g.state == ["enabled", "enabled"]   # an ideal drive boots enabled: no enable gating before the comparison
    ch = channel(cycles_per_tick=10, cycle_s=0.002, interpolation=interpolation)
    seqs = list(range(1, 15)) + [14] * 6
    targets = TARGETS + [TARGETS[-1]] * 6
    vel, pos, compared, tripped_at, expired_at = [0.0, 0.0], [0.0, 0.0], 0, None, None
    for k, (seq, target) in enumerate(zip(seqs, targets)):
        cmds = [{"axisId": a["axisId"], "seq": seq, "mode": "csv", "target": target, "enable": True, "quickStop": False, "faultReset": False} for a in model["axes"]]
        g.begin_tick(cmds)
        ch.accept(cmds[0])
        for s in range(10):
            out = g.substep(pos, vel)
            t, expired = ch.cycle()
            n = k * 10 + s
            if expired and expired_at is None:
                expired_at = n
            if g.state[0] == "fault" and tripped_at is None:
                tripped_at = n
            if expired_at is None and tripped_at is None:
                assert g.applied[0] == pytest.approx(t, abs=1e-12), (k, s)
                compared += 1
            vel = [out["target"][i] if out["active"][i] else 0.0 for i in range(2)]
            pos = [p + v * 0.002 for p, v in zip(pos, vel)]
            g.sample(pos, vel, [0.0, 0.0], [False, False])
        g.end_tick()
    assert compared >= 180
    assert g.fault[0] == "COMMAND_TIMEOUT"
    assert expired_at == tripped_at == 18 * 10   # the fifth repeated tick, first substep, in both
